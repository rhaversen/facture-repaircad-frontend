import axios from "axios";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { FORGE_BASE } from "@/lib/env";
import { FORGE_MODEL, FORGE_REASONING_EFFORT } from "@/lib/config";
import type { ForgeDesign } from "@/lib/types";

/*
  Forge shares the Facture session cookie, so RepairCAD never needs a
  separate Forge login.
*/
const forgeAxios = axios.create({ baseURL: FORGE_BASE, withCredentials: true });

export async function createDesign(): Promise<string> {
  const res = await forgeAxios.post("/designs");
  return res.data._id;
}

/** Copy an existing design (tree + parameter values) into a new document. */
export async function duplicateDesign(designId: string): Promise<string> {
  const res = await forgeAxios.post(`/designs/${designId}/duplicate`);
  return res.data._id;
}

/** Ask Forge to stop the design's running turn at its next step boundary. */
export async function stopDesign(designId: string): Promise<void> {
  try {
    await forgeAxios.post(`/designs/${designId}/stop`);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status !== 404) throw err;
  }
}

/** Merge-patch the design's parameter values: each sent key sets that param's
 *  user value, null clears it, keys not sent are untouched. */
export async function patchParameters(designId: string, values: Record<string, number>) {
  const res = await forgeAxios.patch(`/designs/${designId}/parameters`, {
    values,
  });
  return res.data;
}

export async function sendDesignMessage(designId: string, message: string) {
  await forgeAxios.post(`/designs/${designId}/chat`, {
    message,
    model: FORGE_MODEL,
    reasoningEffort: FORGE_REASONING_EFFORT,
  });
}

/** Fetch a design's user-facing projection. Returns null on 404. */
export async function getDesign(designId: string): Promise<ForgeDesign | null> {
  try {
    const res = await forgeAxios.get(`/designs/${designId}`);
    return res.data.design;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

/** Fetch a design's stored mesh render as raw FMSH bytes. Returns null on
 *  204 — the backend's explicit "nothing renderable" signal. */
export async function getDesignMeshBytes(designId: string): Promise<ArrayBuffer | null> {
  const res = await forgeAxios.get(`/designs/${designId}/mesh`, {
    responseType: "arraybuffer",
    validateStatus: (s) => s === 200 || s === 204,
  });
  if (res.status === 204) return null;
  return res.data as ArrayBuffer;
}

/** Fetch a design's stored mesh render and decode its binary FMSH payload
 *  into a three.Group. Returns null on 204. Decode or transport failures
 *  throw. */
export async function getDesignMesh(designId: string): Promise<THREE.Group | null> {
  const bytes = await getDesignMeshBytes(designId);
  if (bytes === null) return null;
  return parseMeshArrayBuffer(bytes);
}

/** Stateless one-off render with the given params merged over the design's
 *  stored values. Nothing is persisted server-side. Returns a decoded
 *  three.Group, or null on 204. */
export async function renderDesignWithParams(
  designId: string,
  values: Record<string, number>,
): Promise<THREE.Group | null> {
  const res = await forgeAxios.post(
    `/designs/${designId}/renders`,
    { values },
    {
      responseType: "arraybuffer",
      validateStatus: (s) => s === 200 || s === 204,
    },
  );
  if (res.status === 204) return null;
  return parseMeshArrayBuffer(res.data as ArrayBuffer);
}

export type StreamEvent =
  | { type: "running"; data: boolean }
  | { type: "overview"; data: unknown }
  | { type: "mesh"; data: string }
  | { type: "render-start"; data: "" }
  | { type: "render-none"; data: "" }
  | { type: "usage"; data: unknown }
  | { type: "error"; data: string }
  | { type: "end"; data: "" };

/** Subscribe to a design's live SSE event stream. Yields parsed events until
 *  the connection closes or the signal aborts. */
export async function* subscribeDesignStream(
  designId: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${FORGE_BASE}/designs/${designId}/stream`, {
    headers: { Accept: "text/event-stream" },
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `stream failed (${res.status})`);
  }
  if (res.body === null) {
    throw new Error("Stream response body is null");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let eventType = "message";
      let data = "";

      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data = line.slice(5).trim();
        }
      }

      const ev = parseStreamEvent(eventType, data);
      if (ev !== null) {
        yield ev;
      }
    }
  }
}

function parseStreamEvent(eventType: string, data: string): StreamEvent | null {
  try {
    switch (eventType) {
      case "running":
        return { type: "running", data: JSON.parse(data) };
      case "render-start":
        return { type: "render-start", data: "" };
      case "render-none":
        return { type: "render-none", data: "" };
      case "overview":
        return { type: "overview", data: JSON.parse(data) };
      case "mesh":
        // base64-encoded FMSH bytes — keep raw, decode on demand
        return { type: "mesh", data };
      case "usage":
        return { type: "usage", data: JSON.parse(data) };
      case "error":
        return { type: "error", data: JSON.parse(data) };
      case "end":
        return { type: "end", data: "" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/*
  Mesh decoding — mirrors facture-forge-frontend. The backend renders a flat
  triangle soup in mm, Z-up, framed as a binary FMSH buffer: 'FMSH' magic,
  uint16 version, uint16 metadata JSON length, metadata JSON, then Float32
  positions and Uint32 indices (all little-endian).
*/

const FMSH_MAGIC = "FMSH";
const FMSH_VERSION = 1;

const DEFAULT_MESH_COLOR = "#b0b8c4";

interface MeshGroupMeta {
  color: string;
  partId: string;
  shapeId: string;
  start: number;
  count: number;
}

interface MeshMeta {
  units: string;
  volume: number;
  size: [number, number, number];
  groups: MeshGroupMeta[];
  count?: number;
}

/** Decode a base64-encoded SSE `mesh` frame body into a three.Group.
 *  Throws on any decode failure — a corrupt frame is a bug. */
export function parseMeshBase64(base64String: string): THREE.Group {
  const bin = atob(base64String);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodeMesh(bytes);
}

/** Decode raw FMSH mesh bytes into a three.Group. */
export function parseMeshArrayBuffer(arrayBuffer: ArrayBuffer): THREE.Group {
  return decodeMesh(new Uint8Array(arrayBuffer));
}

function decodeMesh(buffer: Uint8Array): THREE.Group {
  if (buffer.byteLength < 8) throw new Error("mesh buffer truncated (no header)");
  const magic = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
  if (magic !== FMSH_MAGIC) throw new Error(`bad mesh magic "${magic}"`);
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const version = dv.getUint16(4, true);
  if (version !== FMSH_VERSION) throw new Error(`unsupported mesh format version ${version}`);
  const metaLen = dv.getUint16(6, true);
  const metaEnd = 8 + metaLen;
  if (metaEnd > buffer.byteLength) throw new Error("mesh metadata truncated");
  const meta = JSON.parse(new TextDecoder().decode(buffer.subarray(8, metaEnd))) as MeshMeta;
  const count = meta.count ?? 0;
  const posBytes = count * 4;
  const idxBytes = buffer.byteLength - metaEnd - posBytes;
  if (idxBytes < 0) throw new Error("mesh positions truncated");
  if (idxBytes % 4 !== 0) throw new Error("mesh index byte length not a multiple of 4");
  // buffer.buffer may be a shared pool with a nonzero byteOffset — slice
  // out aligned copies for the typed-array views.
  const abs = buffer.byteOffset;
  const positions = new Float32Array(buffer.buffer.slice(abs + metaEnd, abs + metaEnd + posBytes), 0, count);
  const indices = new Uint32Array(buffer.buffer.slice(abs + metaEnd + posBytes, abs + buffer.byteLength), 0, idxBytes / 4);

  // Build one mesh per shell group exactly like forge-frontend's viewport:
  // shared position buffer, per-group index slice, creased normals, and the
  // part identity. The group carries the Z-up → Y-up rotation in three space.
  const group = new THREE.Group();
  const positionAttr = new THREE.Float32BufferAttribute(positions, 3);
  for (const g of meta.groups) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", positionAttr);
    geometry.setIndex(
      new THREE.Uint32BufferAttribute(indices.slice(g.start * 3, (g.start + g.count) * 3), 3),
    );
    // Creased normals keep hard edges crisp while staying smooth on curves.
    // Returns a non-indexed geometry with per-corner normals; use directly.
    const creased = toCreasedNormals(geometry, THREE.MathUtils.degToRad(50));
    geometry.dispose();
    const color = /^#[0-9a-fA-F]{6}$/.test(g.color) ? new THREE.Color(g.color) : new THREE.Color(DEFAULT_MESH_COLOR);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    const object = new THREE.Mesh(creased, material);
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.partId = g.partId;
    group.add(object);
  }
  return group;
}

export { FORGE_BASE };
