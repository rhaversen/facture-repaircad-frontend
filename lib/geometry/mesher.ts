/** The Manifold mesh frontend: lowered SolidDocument → mesh geometry via
 *  manifold-3d. Runs inside a Web Worker (see meshWorker.ts) — the generic
 *  interpreter side of the executor (mirrors the backend's
 *  src/geometry/mesher.ts). */

import { buildSolid, ensureManifold, toMat4, type Solid } from "./solidOps";
import type { SolidDocument } from "./types";

export interface MeshGroup {
	/** The color the part declared ('' when none). */
	color: string;
	/** The placed part this shell belongs to — the drill-down identity.
	 *  Every positive instance contributes exactly one group. */
	partId: string;
	/** The shape the part instantiates. */
	shapeId: string;
	/** First triangle index (into `indices`, in triangles). */
	start: number;
	/** Triangle count. */
	count: number;
}

export interface MeshResult {
	/** Flat positions: 3 floats per vertex. */
	positions: Float32Array;
	/** Triangle indices: 3 per face. */
	indices: Uint32Array;
	min: [number, number, number];
	max: [number, number, number];
	volume: number;
	groups: MeshGroup[];
}

/** Worker output as consumed by the UI: MeshResult with the final
 *  bounding size and the document's units folded in. */
export interface MeshPayload {
	positions: Float32Array;
	indices: Uint32Array;
	size: [number, number, number];
	units: string;
	volume: number;
	groups: MeshGroup[];
}

/** 'shells' keeps per-part shells for drill-down; 'union' merges
 *  everything into one watertight body per color group. */
export type MeshMode = "shells" | "union";

/** Build the full mesh for one lowered SolidDocument. Resolution is baked
 *  into the solid nodes at lowering time — no fn arg needed here. Async
 *  to bootstrap the raw wasm module (awaited by the worker wrapper;
 *  no top-level await needed). */
export async function buildMesh(doc: SolidDocument, mode: MeshMode = "shells"): Promise<MeshResult> {
	await ensureManifold();
	const positions: number[] = [];
	const indices: number[] = [];
	const groups: MeshGroup[] = [];
	let volume = 0;

	const appendMesh = (group: MeshGroup, mesh: ReturnType<Solid["getMesh"]>): void => {
		const stride = mesh.numProp;
		const baseVertex = positions.length / 3;
		for (let v = 0; v < mesh.vertProperties.length / stride; v++) {
			positions.push(
				mesh.vertProperties[v * stride],
				mesh.vertProperties[v * stride + 1],
				mesh.vertProperties[v * stride + 2],
			);
		}
		group.start = indices.length / 3;
		group.count = mesh.triVerts.length / 3;
		for (const t of mesh.triVerts) {
			indices.push(t + baseVertex);
		}
	};

	const emptyResult = (): MeshResult => ({
		positions: new Float32Array(0),
		indices: new Uint32Array(0),
		min: [0, 0, 0],
		max: [0, 0, 0],
		volume: 0,
		groups: [],
	});

	const positives = doc.instances.filter((i) => i.op === "union");
	const negatives = doc.instances.filter((i) => i.op === "subtract");
	if (positives.length === 0) {
		return emptyResult();
	}

	// §15 Phase 7 cutting scope: a subtract tool with empty ancestry is a
	// top-level cutter scoped to the whole top-level union; a nested tool
	// is scoped only to the subtree rooted at its direct enclosing copy —
	// instance ids compose parent-first (enclosing.part), so "subtree of
	// A" = ids starting 'A.' plus A itself.
	const inToolScope = (toolAncestry: readonly string[], partId: string): boolean => {
		if (toolAncestry.length === 0) return true;
		const root = toolAncestry[0];
		return partId === root || partId.startsWith(`${root}.`);
	};

	const tools: Array<{ solid: Solid; scope: (partId: string) => boolean }> = [];
	for (const neg of negatives) {
		const ancestry = neg.ancestry ?? [];
		const solid = (await buildSolid(neg.solid)).transform(toMat4(neg.matrix));
		tools.push({ solid, scope: (partId: string) => inToolScope(ancestry, partId) });
	}
	const toolsFor = (inst: { partId: string }): Solid[] => tools.filter((t) => t.scope(inst.partId)).map((t) => t.solid);

	if (mode === "union") {
		// One watertight body per COLOR group. The union of same-colored
		// instances is one group entry; identity (partId) is meaningless
		// for a merged body, so the first contributing instance's ids
		// stand for the group.
		const groupSolids = new Map<string, { group: MeshGroup; solid: Solid | null }>();
		for (const inst of positives) {
			const s = (await buildSolid(inst.solid)).transform(toMat4(inst.matrix));
			let cut = s;
			for (const tool of toolsFor(inst)) {
				cut = cut.subtract(tool);
			}
			const key = inst.color ?? "";
			let entry = groupSolids.get(key);
			if (entry === undefined) {
				entry = {
					group: { color: key, partId: inst.partId, shapeId: inst.shapeId, start: 0, count: 0 },
					solid: null,
				};
				groupSolids.set(key, entry);
				groups.push(entry.group);
			}
			if (cut.volume() <= 0) continue;
			entry.solid = entry.solid === null ? cut : entry.solid.add(cut);
		}
		for (const { group, solid } of groupSolids.values()) {
			if (solid === null) continue;
			volume += solid.volume();
			appendMesh(group, solid.getMesh());
		}
	} else {
		// Shell soup: cut each positive independently and emit one group per
		// shell — the per-part identity the frontend's drill-down keys on.
		const cuts: Array<{ group: MeshGroup; cut: Solid }> = [];
		for (const inst of positives) {
			const s = (await buildSolid(inst.solid)).transform(toMat4(inst.matrix));
			let cut = s;
			for (const tool of toolsFor(inst)) {
				cut = cut.subtract(tool);
			}
			if (cut.volume() <= 0) continue;
			const group: MeshGroup = {
				color: inst.color ?? "",
				partId: inst.partId,
				shapeId: inst.shapeId,
				start: 0,
				count: 0,
			};
			groups.push(group);
			cuts.push({ group, cut });
		}
		if (cuts.length > 0) {
			// Exact volume despite overlaps: unioning the cut shells is the
			// true (A∪B)−tools solid — its volume, not the per-part sum.
			let volSolid = cuts[0].cut;
			for (let i = 1; i < cuts.length; i++) {
				volSolid = volSolid.add(cuts[i].cut);
			}
			volume += volSolid.volume();
			for (const { group, cut } of cuts) {
				appendMesh(group, cut.getMesh());
			}
		}
	}

	const positionsArr = new Float32Array(positions);
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (let i = 0; i < positionsArr.length; i += 3) {
		minX = Math.min(minX, positionsArr[i]);
		maxX = Math.max(maxX, positionsArr[i]);
		minY = Math.min(minY, positionsArr[i + 1]);
		maxY = Math.max(maxY, positionsArr[i + 1]);
		minZ = Math.min(minZ, positionsArr[i + 2]);
		maxZ = Math.max(maxZ, positionsArr[i + 2]);
	}
	return {
		positions: positionsArr,
		indices: new Uint32Array(indices),
		min: [minX, minY, minZ],
		max: [maxX, maxY, maxZ],
		volume,
		groups,
	};
}
