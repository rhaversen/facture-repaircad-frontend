"use client";

/** Client-side meshing glue: a lowered SolidDocument fetched from Forge's
 *  POST /:id/geometry route, meshed locally in the geometry worker,
 *  converted to a scene Group keyed for drill-down. */

import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { meshFromGeometry } from "@/lib/geometry/meshClient";
import type { MeshPayload } from "@/lib/geometry/mesher";
import type { THREE_Group } from "@/lib/types";

/** Render tier requested from the geometry route — the backend bakes
 *  per-feature sagitta resolution into the solid nodes. */
export type MeshQuality = "draft" | "standard" | "fine";

export const MESH_QUALITY: MeshQuality = "draft";

const DEFAULT_MESH_COLOR = "#b0b8c4";

/** Convert the worker's mesh payload into a three.Group: one mesh per
 *  color group, shared position buffer, creased normals, and the part
 *  identity. The viewer's Model rotation handles Z-up → Y-up. */
export function meshPayloadToGroup(payload: MeshPayload): THREE_Group {
	const group = new THREE.Group();
	const positionAttr = new THREE.Float32BufferAttribute(payload.positions, 3);
	for (const g of payload.groups) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", positionAttr);
		geometry.setIndex(
			new THREE.Uint32BufferAttribute(payload.indices.slice(g.start * 3, (g.start + g.count) * 3), 3),
		);
		// Creased normals keep hard edges crisp while staying smooth on
		// curves. Returns a non-indexed geometry with per-corner normals.
		const creased = toCreasedNormals(geometry, THREE.MathUtils.degToRad(10));
		geometry.dispose();
		const color = /^#[0-9a-fA-F]{6}$/.test(g.color)
			? new THREE.Color(g.color)
			: new THREE.Color(DEFAULT_MESH_COLOR);
		const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
		const object = new THREE.Mesh(creased, material);
		object.castShadow = true;
		object.receiveShadow = true;
		object.userData.partId = g.partId;
		group.add(object);
	}
	return group;
}

/** Mesh a lowered geometry document in the worker and convert it to a
 *  scene Group. Resolves null for an empty document. Throws on
 *  worker/geometry failure. */
export async function meshGeometryToGroup(
	geometry: import("@/lib/geometry/types").SolidDocument,
): Promise<THREE_Group | null> {
	const payload = await meshFromGeometry(geometry);
	return payload === null ? null : meshPayloadToGroup(payload);
}
