import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* The backend's GLB is a flat scene with the Z-up → Y-up rotation already
   applied on its root, so it mounts as-is. It ships no normals: creased ones
   are baked in once per parse. */
async function parseGlb(buffer: ArrayBuffer): Promise<THREE.Group> {
	const gltf = await new GLTFLoader().parseAsync(buffer, "");
	gltf.scene.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		const creased = toCreasedNormals(child.geometry, THREE.MathUtils.degToRad(10));
		child.geometry.dispose();
		child.geometry = creased;
	});
	return gltf.scene;
}

/* A few parsed models, LRU by design + revision, so moving between the picker
   and a design never parses the same revision twice. */
const CACHE_LIMIT = 6;
const cache = new Map<string, THREE.Group>();

/** The model of one design revision. Each call gets its own clone (sharing
 *  the geometry), since a three.js object can only sit in one scene at a
 *  time. `fetch` only runs on a cache miss. */
export async function loadGlb(
	designId: string,
	revision: string,
	fetch: () => Promise<ArrayBuffer>,
): Promise<THREE.Group> {
	const key = `${designId}@${revision}`;
	let scene = cache.get(key);
	if (scene === undefined) {
		scene = await parseGlb(await fetch());
		if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
	} else {
		cache.delete(key);
	}
	cache.set(key, scene);
	return scene.clone(true);
}
