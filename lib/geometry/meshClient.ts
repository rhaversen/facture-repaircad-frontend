"use client";

/** Main-thread access to the mesh worker: lowered SolidDocument in →
 *  MeshPayload out. The worker owns the manifold WASM; this module just
 *  dispatches, matches replies by seq, and handles worker restart on
 *  failure. */

import type { MeshGroup, MeshPayload } from "./mesher";
import type { SolidDocument } from "./types";

import type { MeshReply, MeshRequestIn } from "./meshWorker";

let worker: Worker | null = null;
let nextSeq = 1;
/** seq → resolve; each job holds its own promise. Stale replies (a
 *  superseded request) resolve too but are dropped by the caller's
 *  seq check. */
const pending = new Map<number, { resolve: (r: MeshReply) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
	if (worker !== null) return worker;
	worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
	worker.addEventListener("message", (ev: MessageEvent<MeshReply>) => {
		const job = pending.get(ev.data.seq);
		if (job === undefined) return;
		pending.delete(ev.data.seq);
		if (ev.data.kind === "failed") job.reject(new Error(ev.data.error));
		else job.resolve(ev.data);
	});
	worker.addEventListener("error", (ev) => {
		const err = new Error(ev.message || "mesh worker crashed");
		// Every in-flight job rejects; the pool restarts on the next call.
		for (const job of pending.values()) job.reject(err);
		pending.clear();
		worker = null;
	});
	return worker;
}

/** Build one mesh from a lowered geometry document. Resolves null for an
 *  empty document (no instances). Throws on worker/geometry failure. */
export async function meshFromGeometry(geometry: SolidDocument): Promise<MeshPayload | null> {
	if (geometry.instances.length === 0) return null;
	const w = ensureWorker();
	const seq = nextSeq++;
	const reply = await new Promise<MeshReply>((resolve, reject) => {
		pending.set(seq, { resolve, reject });
		w.postMessage({ kind: "mesh", seq, geometry, mode: "shells" } satisfies MeshRequestIn);
	});
	if (reply.kind !== "mesh") throw new Error("unexpected worker reply");
	const positions = reply.positions;
	const indices = reply.indices;
	const size: [number, number, number] = [
		reply.max[0] - reply.min[0],
		reply.max[1] - reply.min[1],
		reply.max[2] - reply.min[2],
	];
	const groups: MeshGroup[] = reply.groups
		.filter((g) => g.count > 0)
		.map((g) => ({ color: g.color, partId: g.partId, shapeId: g.shapeId, start: g.start, count: g.count }))
		.sort((a, b) => a.start - b.start);
	return {
		positions,
		indices,
		size,
		units: geometry.units,
		volume: reply.volume,
		groups,
	};
}
