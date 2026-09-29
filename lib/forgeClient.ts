import axios from "axios";

import { FORGE_BASE } from "@/lib/env";
import { FORGE_MODEL, FORGE_REASONING_EFFORT } from "@/lib/config";
import type { ForgeDesign } from "@/lib/types";
import type { SolidDocument } from "@/lib/geometry/types";

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
export async function patchParameters(designId: string, values: Record<string, number | null>) {
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

export type DesignGeometry = SolidDocument;

/** Fetch a design's lowered geometry — wasm-ready solid nodes, no mesh.
 *  `values` merges over the stored parameter values for just this fetch
 *  (nothing is persisted); omitted params fall back to the user's stored
 *  value, else the spec default. `fn` picks the baked curved-surface
 *  resolution. Returns null on 204 — the backend's explicit "nothing
 *  renderable yet" signal. A 422 is a bare error (the compile
 *  diagnostics are the agent's, never the frontend's). */
export async function getDesignGeometry(
  designId: string,
  opts?: { values?: Record<string, number>; fn?: number },
): Promise<DesignGeometry | null> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(opts?.values ?? {})) {
    params.append(`values[${name}]`, String(value));
  }
  if (opts?.fn !== undefined) params.set("fn", String(opts.fn));
  try {
    const res = await forgeAxios.get(`/designs/${designId}/geometry`, {
      params,
      validateStatus: (s) => s === 200 || s === 204,
    });
    if (res.status === 204) return null;
    return res.data as DesignGeometry;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 422) {
      const body = err.response.data as { error?: string };
      throw new Error(body?.error ?? "Compile failed.");
    }
    throw err;
  }
}

export type StreamEvent =
  | { type: "running"; data: boolean }
  | { type: "overview"; data: unknown }
  | { type: "geometry"; data: SolidDocument }
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
      case "geometry":
        // The lowered geometry — the client meshes it in the geometry worker.
        return { type: "geometry", data: JSON.parse(data) };
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

export { FORGE_BASE };
