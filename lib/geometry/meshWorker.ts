/// <reference lib="webworker" />
/** The mesh worker: one Web Worker's entry — serve MeshRequest messages
 *  (lowered SolidDocument) with buildMesh results. Transferables: the
 *  typed arrays move to the main thread zero-copy.
 *
 *  NO init step and NO kind discriminator, mirroring the backend's
 *  src/rendering/meshWorker.ts: the manifoldCAD entry module top-level-
 *  awaits the WASM instantiation, so importing mesher.ts at all implies
 *  the kernel is ready, and there is at most one request in flight (the
 *  client replaces this worker after every job), so port order resolves
 *  everything. Messages posted before the entry module finishes
 *  evaluating simply queue in the port. */

import { buildMesh, type MeshMode } from "./mesher";
import type { SolidDocument } from "./types";

export interface MeshRequest {
	geometry: SolidDocument;
	mode?: MeshMode;
}

export type MeshRequestIn = MeshRequest;

export type MeshReply =
	| { mesh: { positions: Float32Array; indices: Uint32Array; min: [number, number, number]; max: [number, number, number]; volume: number; groups: import("./mesher").MeshGroup[] } }
	/** A mesh-build failure is a design outcome, not an infrastructure
	 *  crash — carried as normal reply content with the mesh nulled. */
	| { mesh: null; meshError: string };

const post = (msg: MeshReply, transfer?: Transferable[]): void => {
	self.postMessage(msg, transfer ?? []);
};

self.addEventListener("message", (ev: MessageEvent<MeshRequestIn>) => {
	const msg = ev.data;
	try {
		const mesh = buildMesh(msg.geometry, msg.mode ?? "shells");
		post(
			{
				mesh: {
					positions: mesh.positions,
					indices: mesh.indices,
					min: mesh.min,
					max: mesh.max,
					volume: mesh.volume,
					groups: mesh.groups.map((g) => ({ ...g })),
				},
			},
			[mesh.positions.buffer, mesh.indices.buffer],
		);
	} catch (err) {
		post({
			mesh: null,
			meshError: err instanceof Error ? err.message : String(err),
		});
	}
});
