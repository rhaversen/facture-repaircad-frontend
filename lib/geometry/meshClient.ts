"use client";

/** Main-thread access to the mesh worker: lowered SolidDocument in →
 *  MeshPayload out.
 *
 *  THE INVARIANT — one job per worker, always replaced, mirroring the
 *  backend's src/rendering/meshPool.ts: the worker serves exactly ONE
 *  build over its lifetime, and whichever way it ends — reply, failure,
 *  error event — a fresh worker spawns IMMEDIATELY so the next job finds
 *  one ready. The manifold-3d WASM linear memory grows per build and is
 *  never returned to the embedder, so a reused worker ratchets toward
 *  "memory access out of bounds"; killing it after every job deletes
 *  that failure class by construction.
 *
 *  ONE request is ever posted to a worker, so there is no reply id and
 *  no kind discriminator — the outcome reads off `mesh === null`.
 *  Concurrent callers serialize behind a promise chain; a stale reply
 *  (from a worker replaced mid-flight) is dropped by the target check. */

import type { MeshGroup, MeshPayload } from "./mesher";
import type { SolidDocument } from "./types";

import type { MeshReply, MeshRequestIn } from "./meshWorker";

/** Persistently failing spawns (bad worker URL, WASM load failure) must
 *  not respawn at full speed forever — a debounce between death-spawns,
 *  and after repeated deaths the lane fails jobs fast instead of
 *  spinning a doomed respawn loop. */
const SPAWN_FAILURE_LIMIT = 8;
const SPAWN_GUARD_MS = 25;
/** No reply within this window counts as worker death — the backend's
 *  meshPool watchdog uses the same window (JOB_TIMEOUT_MS). */
const JOB_TIMEOUT_MS = 5 * 60_000;

let worker: Worker | null = null;
let spawnFailures = 0;
let broken = false;
let spawnGuard: ReturnType<typeof setTimeout> | null = null;
/** Resolves when a faulted respawn's debounce has elapsed and the lane
 *  is live again — jobs arriving during the debounce await this. */
let boot: Promise<void> | null = null;
/** Serializes concurrent callers — the tail every new job awaits. */
let laneTail: Promise<unknown> = Promise.resolve();
/** The settled job slot — non-null from postMessage until the worker's
 *  one reply (or its death / timeout) delivers here. */
let pending: {
	resolve: (r: MeshReply) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
} | null = null;

function spawn(): void {
	if (broken || worker !== null || spawnGuard !== null) return;
	worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
	worker.addEventListener("message", (ev: MessageEvent<MeshReply>) => {
		// A replaced worker's late events must not touch the lane.
		if (worker !== ev.target) return;
		replaceWorker(false);
		const job = pending;
		pending = null;
		if (job === null) return;
		if (job.timer !== null) clearTimeout(job.timer);
		if (ev.data.mesh === null) job.reject(new Error(ev.data.meshError));
		else job.resolve(ev.data);
	});
	worker.addEventListener("error", (ev) => {
		if (worker !== ev.target) return;
		replaceWorker(true);
		const job = pending;
		pending = null;
		if (job !== null) {
			if (job.timer !== null) clearTimeout(job.timer);
			job.reject(new Error(ev.message || "mesh worker crashed"));
		}
	});
}

/** The replacement policy, applied after EVERY way a stint ends —
 *  reply or failure: the WASM heap is ratcheted once the worker has run
 *  one build, so it is never reused. `failed` counts error events
 *  toward the broken flag. */
function replaceWorker(failed: boolean): void {
	worker?.terminate();
	worker = null;
	if (!failed) {
		spawn();
		return;
	}
	spawnFailures++;
	if (spawnFailures > SPAWN_FAILURE_LIMIT) {
		broken = true;
		boot = null;
		return;
	}
	boot = new Promise<void>((resolve) => {
		spawnGuard = setTimeout(() => {
			spawnGuard = null;
			spawn();
			resolve();
		}, SPAWN_GUARD_MS);
	});
}

/** Build one mesh from a lowered geometry document. Resolves null for an
 *  empty document (no instances). Rejects on geometry failure (the
 *  worker's curated meshError) and on worker death. */
export async function meshFromGeometry(geometry: SolidDocument): Promise<MeshPayload | null> {
	if (broken) throw new Error("mesh worker unavailable");
	const run = laneTail.then(() => buildOnLane(geometry));
	// A rejected job must not poison the lane — later jobs still run.
	laneTail = run.catch(() => undefined);
	return run;
}

async function buildOnLane(geometry: SolidDocument): Promise<MeshPayload | null> {
	if (geometry.instances.length === 0) return null;
	// Posting to a not-yet-live lane loses the job — no reply ever comes
	// and the lane chain hangs every later job behind it. Wait out a
	// faulted respawn's debounce instead.
	if (worker === null && boot !== null) await boot;
	if (broken) throw new Error("mesh worker unavailable");
	const reply = await new Promise<MeshReply>((resolve, reject) => {
		const timer = setTimeout(() => {
			if (pending === null || pending.timer !== timer) return;
			replaceWorker(true);
			const job = pending;
			pending = null;
			job.reject(new Error(`mesh build timed out after ${JOB_TIMEOUT_MS}ms`));
		}, JOB_TIMEOUT_MS);
		pending = { resolve, reject, timer };
		spawn();
		if (worker === null) {
			clearTimeout(timer);
			pending = null;
			reject(new Error("mesh worker could not start"));
			return;
		}
		// Posting before the worker module finishes evaluating is fine —
		// the job queues in the port (no init handshake needed).
		worker.postMessage({ geometry } satisfies MeshRequestIn);
	});
	const mesh = reply.mesh;
	if (mesh === null) throw new Error("no mesh returned");
	const positions = mesh.positions;
	const indices = mesh.indices;
	const size: [number, number, number] = [
		mesh.max[0] - mesh.min[0],
		mesh.max[1] - mesh.min[1],
		mesh.max[2] - mesh.min[2],
	];
	const groups: MeshGroup[] = mesh.groups
		.filter((g) => g.count > 0)
		.map((g) => ({ color: g.color, partId: g.partId, shapeId: g.shapeId, start: g.start, count: g.count }))
		.sort((a, b) => a.start - b.start);
	return {
		positions,
		indices,
		size,
		units: geometry.units,
		volume: mesh.volume,
		groups,
	};
}
