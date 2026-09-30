/// <reference lib="webworker" />
/** The mesh worker: one Web Worker's entry — serve MeshRequest messages
 *  (lowered SolidDocument) with buildMesh results. Transferables: the
 *  typed arrays move to the main thread zero-copy.
 *
 *  The entry deliberately has NO static imports and NO init handshake,
 *  mirroring the backend's src/rendering/meshWorker.ts in spirit but
 *  guarding against the one browser-specific hazard: the manifoldCAD
 *  entry module top-level-awaits WASM instantiation. Static-importing it
 *  delays worker evaluation; if that stalls (bundler dev chunk loading
 *  inside a module worker), the port queue stays paused with no error
 *  event and the job hangs. Instead the bare entry evaluates instantly,
 *  and mesher is imported lazily at job time — so a boot stall surfaces
 *  as a normal job failure, not a silent void. */

import type { MeshMode } from "./mesher";
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
	void (async () => {
		try {
			const { buildMesh } = await import("./mesher");
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
	})();
});
