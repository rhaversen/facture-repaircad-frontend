/// <reference lib="webworker" />
/** The mesh worker: one Web Worker's entry — init manifold once, then
 *  serve MeshRequest messages (lowered SolidDocument) with buildMesh
 *  results. Transferables: the typed arrays move to the main thread
 *  zero-copy. */

import { buildMesh, initManifold, type MeshMode } from "./mesher";
import type { SolidDocument } from "./types";

export interface MeshRequest {
	kind: "mesh";
	/** Monotonic job id — the main thread uses it to match replies and
	 *  cancel stale requests. */
	seq: number;
	geometry: SolidDocument;
	mode?: MeshMode;
}

export type MeshRequestIn = MeshRequest;

export type MeshReply =
	| { kind: "mesh"; seq: number; positions: Float32Array; indices: Uint32Array; min: [number, number, number]; max: [number, number, number]; volume: number; groups: import("./mesher").MeshGroup[] }
	| { kind: "failed"; seq: number; error: string }
	| { kind: "ready"; seq: number };

const post = (msg: MeshReply, transfer?: Transferable[]): void => {
	self.postMessage(msg, transfer ?? []);
};

void initManifold().then(() => {
	post({ kind: "ready", seq: 0 });
});

self.addEventListener("message", (ev: MessageEvent<MeshRequestIn>) => {
	const msg = ev.data;
	if (msg.kind !== "mesh") return;
	try {
		const mesh = buildMesh(msg.geometry, msg.mode ?? "shells");
		const groups = mesh.groups.map((g) => ({ ...g }));
		post(
			{
				kind: "mesh",
				seq: msg.seq,
				positions: mesh.positions,
				indices: mesh.indices,
				min: mesh.min,
				max: mesh.max,
				volume: mesh.volume,
				groups,
			},
			[mesh.positions.buffer, mesh.indices.buffer],
		);
	} catch (err) {
		post({ kind: "failed", seq: msg.seq, error: err instanceof Error ? err.message : String(err) });
	}
});
