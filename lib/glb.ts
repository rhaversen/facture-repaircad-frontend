import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GlbModel } from "./types";

/** Parse a GLB buffer from the backend's /designs/:id/geometry endpoint
 *  into the structure the viewport consumes. The backend writes a flat
 *  scene — root node "design" with one mesh per part, part identity in
 *  each object's `name`, Z-up→Y-up rotation pre-applied — so the client
 *  walks the parsed graph and indexes meshes by name without any axis
 *  fixup or hierarchy reasoning of its own. */
async function parseGlb(buffer: ArrayBuffer, designId: string): Promise<GlbModel> {
	const loader = new GLTFLoader();
	const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
		loader.parse(buffer, "", resolve, reject);
	});
	const root = gltf.scene;
	root.name = designId;

	// The backend emits one glTF primitive per color run, and GLTFLoader
	// wraps multi-primitive meshes in a Group: the part node keeps its
	// name while the child meshes get `plate_1`-style unique names.
	// Rewrite each child back to the part's name so the flat
	// name-equals-part identity the viewport relies on (picking, the
	// partMeshes index) survives the extra nesting level.
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Group) || obj.name.length === 0) return;
		const prefix = `${obj.name}_`;
		for (const child of obj.children) {
			if (
				child instanceof THREE.Mesh &&
				child.name.startsWith(prefix) &&
				/^\d+$/.test(child.name.slice(prefix.length))
			) {
				child.name = obj.name;
			}
		}
	});

	const partMeshes = new Map<string, THREE.Mesh[]>();
	root.traverse((child) => {
		if (child instanceof THREE.Mesh && child.name.length > 0) {
			// The paint color is read exactly once, here — the viewport
			// replaces mesh materials with its own instances, so the
			// loader material's `#rrggbb` name would be lost on every
			// cache-hit clone. userData survives clone(true), so the
			// color rides along to each revisit.
			const loaded = child.material as THREE.MeshStandardMaterial | undefined;
			const paint = /^#([0-9a-fA-F]{6})$/.exec(loaded?.name ?? "");
			child.userData.paintColor = paint !== null ? parseInt(paint[1], 16) : null;
			const list = partMeshes.get(child.name) ?? [];
			list.push(child);
			partMeshes.set(child.name, list);
		}
	});

	return { scene: root, partMeshes, parts: [...partMeshes.keys()] };
}

/** Bake creased normals into every part mesh of a freshly parsed model.
 *  The GLB ships no normals; creasing here (at cache-fill time) keeps
 *  revisits from re-paying the toCreasedNormals cost — the viewport
 *  recognizes pre-processed geometry via the `creased` flag. */
function creaseAll(model: GlbModel): GlbModel {
	for (const objs of model.partMeshes.values()) {
		for (const obj of objs) {
			const creased = toCreasedNormals(obj.geometry, THREE.MathUtils.degToRad(10));
			obj.geometry.dispose();
			obj.geometry = creased;
			creased.userData.creased = true;
		}
	}
	return model;
}

/** Revisions worth of parsed+creased models, LRU by key. Three entries
 *  covers immediate conv-arounds and back-and-forth browsing without
 *  holding the whole design history on the heap. */
const CACHE_LIMIT = 3;
const cache = new Map<string, GlbModel>();

function cacheKey(designId: string, revision: string): string {
	return `${designId}\u0000${revision}`;
}

/** Rebuild the partMeshes index against a clone's own meshes — the map
 *  must point at the meshes the viewport will mutate, not the cached
 *  originals. clone(true) shares geometry references, so the crease
 *  work is reused while the clone's materials/objects stay independent. */
function reindexClone(clone: THREE.Group): Map<string, THREE.Mesh[]> {
	const partMeshes = new Map<string, THREE.Mesh[]>();
	clone.traverse((child) => {
		if (child instanceof THREE.Mesh && child.name.length > 0) {
			const list = partMeshes.get(child.name) ?? [];
			list.push(child);
			partMeshes.set(child.name, list);
		}
	});
	return partMeshes;
}

/** Parse + crease a GLB the first time a revision is seen; afterwards
 *  hand out a deep clone that shares the creased BufferGeometries. The
 *  clone-per-visit contract matters because the viewport's fade-out
 *  disposes materials (and GPU geometry buffers) of the outgoing group;
 *  clones isolate those mutations while the cached CPU arrays survive.
 *  An empty revision (cross-origin response whose ETag is not CORS-
 *  exposed) is parsed but never cached — a single revision-less entry
 *  would otherwise shadow fresh bytes for every later revision. The
 *  buffer is only read on a miss. */
export async function parseGlbCached(revision: string, buffer: ArrayBuffer, designId: string): Promise<GlbModel> {
	if (revision.length !== 0) {
		const key = cacheKey(designId, revision);
		const hit = cache.get(key);
		if (hit !== undefined) {
			// Refresh recency (Map iteration = insertion order).
			cache.delete(key);
			cache.set(key, hit);
			const scene = hit.scene.clone(true);
			return { scene, partMeshes: reindexClone(scene), parts: hit.parts };
		}
	}
	const model = await parseGlb(buffer, designId);
	creaseAll(model);
	if (revision.length !== 0) {
		cache.set(cacheKey(designId, revision), model);
		if (cache.size > CACHE_LIMIT) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
	}
	return model;
}

/** Cheap revision probe so the hub can skip the GLB fetch entirely when
 *  the cached revision already matches the design summary. */
export function cacheHas(designId: string, revision: string): boolean {
	return cache.has(cacheKey(designId, revision));
}
