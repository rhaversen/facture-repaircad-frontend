/** The thin wasm executor: SolidNode → manifold-3d solids. No geometry
 *  recipes live here — codegen lowered them into the boolean tree — so
 *  this module is the generic interpreter every runtime needs (mirrors
 *  the backend's src/geometry/exec.ts). */

import ModuleFactory from "manifold-3d";
import type { Manifold as TManifoldClass, CrossSection as TCrossClass, Mat4 } from "manifold-3d/manifoldCAD";

import { assertNever, type Poly, type SolidNode } from "./types";

export type Solid = TManifoldClass;

/** The GC-wrapped manifoldCAD entry leaks its wrapper registry (≈8 MB per
 *  300-point swept chain) and double-deletes manually released objects,
 *  aborting the wasm heap mid-render (mirrors the frontend executor and
 *  the backend exec). The raw root entry has no registry: await the
 *  module factory, call setup(), and delete wrappers exactly when their
 *  consumer is done — the pattern mirrored from lib/wasm.js. */
let _api: {
	Manifold: typeof TManifoldClass;
	CrossSection: typeof TCrossClass;
} | null = null;

async function getApi() {
	if (_api) return _api;
	const mod: unknown = await ModuleFactory();
	(mod as { setup: () => void }).setup();
	const { Manifold, CrossSection: XS } = mod as {
		Manifold: typeof TManifoldClass;
		CrossSection: typeof TCrossClass;
		setup: () => void;
	};
	_api = { Manifold, CrossSection: XS };
	return _api;
}

let ManifoldAPI: typeof TManifoldClass;
let CrossSection: typeof TCrossClass;

/** Await before any buildSolid call — bootstraps and binds the raw module. */
export async function ensureManifold(): Promise<{
	Manifold: typeof TManifoldClass;
	CrossSection: typeof TCrossClass;
}> {
	const api = await getApi();
	ManifoldAPI = api.Manifold;
	CrossSection = api.CrossSection;
	return api;
}

/** The instance matrix is a row-major 4×4 over column vectors — the same
 *  layout Manifold's Mat4 consumes. The single runtime check lives here so
 *  a layout change fails loudly instead of corrupting transforms. */
export function toMat4(m: readonly number[]): Mat4 {
	if (m.length !== 16) {
		throw new Error(`matrix must have 16 elements, got ${m.length}`);
	}
	return m as unknown as Mat4;
}

const toVec2 = (poly: Poly): Array<[number, number]> => poly.map((p) => [p[0], p[1]]);

/** Execute one lowered node — the executor's whole contract. */
export async function buildSolid(node: SolidNode): Promise<Solid> {
	await getApi();
	switch (node.kind) {
		case "extrude":
			return ManifoldAPI.extrude(CrossSection.ofPolygons([toVec2(node.poly)]), node.h);
		case "revolve":
			return ManifoldAPI.revolve(node.poly.map((p) => [p[0], p[1]] as [number, number]), node.segments);
		case "cylinder":
			return ManifoldAPI.cylinder(node.h, node.r1, node.r2, node.segments);
		case "sphere":
			return ManifoldAPI.sphere(node.r, node.segments);
		case "hull": {
			const at = (p: readonly number[]): Solid =>
				ManifoldAPI.sphere(node.r, node.segments).translate([p[0], p[1], p[2]]);
			const pts = node.points;
			if (pts.length === 1) return at(pts[0]);
			// hull consumes every operand wrapper — release the moved
			// spheres so repeated capsule legs don't leak the wasm heap.
			const moved = pts.map(at);
			const hull = ManifoldAPI.hull(moved);
			moved.forEach((m) => m.delete());
			return hull;
		}
		case "hull-chain": {
			// Windowed local hulls along the swept chain. One hull over ALL
			// swept spheres is the global convex hull: over a concave path
			// (a church arch) it fills in the opening, and at 300+ swept
			// points its mesh and wasm memory peak exhaust the worker heap
			// mid-render (mirrors the backend exec). Small overlapping
			// windows of consecutive spheres keep each local hull's
			// triangle count and memory bounded and keep concave bends
			// concave; the shared spheres between windows guarantee
			// adjacent hulls connect. Dedupe repeated consecutive corners
			// first, then release every wrapper the moment it's dead —
			// spheres after their hull, hull after its add — so a long
			// chain never accumulates intermediates.
			const seen = new Set<string>();
			const pts = node.points.filter((p) => {
				const key = `${p[0]},${p[1]},${p[2]}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
			const WINDOW = 8;
			const STRIDE = WINDOW - 2;
			let acc: Solid | undefined;
			for (let i = 0; i < pts.length; i += STRIDE) {
				const spheres = pts
					.slice(i, i + WINDOW)
					.map((p) => ManifoldAPI.sphere(node.r, node.segments).translate([p[0], p[1], p[2]]));
				const hull = ManifoldAPI.hull(spheres);
				spheres.forEach((s) => s.delete());
				const next = acc ? acc.add(hull) : hull;
				acc?.delete();
				acc = next;
				if (acc !== hull) hull.delete();
			}
			return acc as Solid;
		}
		case "translate":
			return (await buildSolid(node.node)).translate([...node.offset] as [number, number, number]);
		case "rotate":
			return (await buildSolid(node.node)).rotate([...node.rotDeg] as [number, number, number]);
		case "add":
			return (await buildSolid(node.a)).add(await buildSolid(node.b));
		case "subtract":
			return (await buildSolid(node.a)).subtract(await buildSolid(node.b));
		case "intersect":
			return (await buildSolid(node.a)).intersect(await buildSolid(node.b));
		default:
			return assertNever(node);
	}
}
