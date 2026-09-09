import axios from "axios";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import type { Group } from "three";

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

/** Fetch the on-demand 3MF render as raw bytes. Returns null on 204. */
export async function getDesign3mfBytes(designId: string): Promise<ArrayBuffer | null> {
  const res = await forgeAxios.get(`/designs/${designId}/3mf`, {
    responseType: "arraybuffer",
    validateStatus: (s) => s === 200 || s === 204,
  });
  if (res.status === 204) return null;
  return res.data as ArrayBuffer;
}

/** Stateless one-off render with the given params merged over the design's
 *  stored values. Nothing is persisted server-side. */
export async function renderDesignWithParams(
  designId: string,
  values: Record<string, number>,
): Promise<ArrayBuffer | null> {
  const res = await forgeAxios.post(
    `/designs/${designId}/renders`,
    { values },
    {
      responseType: "arraybuffer",
      validateStatus: (s) => s === 200 || s === 204,
    },
  );
  if (res.status === 204) return null;
  return res.data as ArrayBuffer;
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
        // base64-encoded 3MF bytes — keep raw, decode on demand
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

const loader = new ThreeMFLoader();
(
  loader as unknown as { rotationQuantization: number }
).rotationQuantization = 16;

/** Parse base64-encoded 3MF bytes (from SSE mesh events) into a three.Group. */
export function parseMeshBase64(base64String: string): Group {
  const binary = atob(base64String);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return loader.parse(bytes.buffer);
}

/** Parse raw 3MF bytes into a three.Group. */
export function parseMeshArrayBuffer(arrayBuffer: ArrayBuffer): Group {
  return loader.parse(arrayBuffer);
}

export { FORGE_BASE };
