import axios from "axios";

import { FORGE_BASE } from "@/lib/env";
import { FORGE_MODEL, FORGE_REASONING_EFFORT } from "@/lib/config";
import type {
  DesignFrontend,
  GeometrySummary,
  Parameter,
  StreamEvent,
} from "@/lib/types";

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

/** What PATCH /designs/:id/parameters returned on success: the freshly
 *  computed parameter projection (value/set flags updated), the new
 *  geometry summary (null when the previous build had none), and the
 *  rebuild's outcome (null when the hub is busy — an in-flight turn). */
export interface ParametersResult {
  parameters: Parameter[];
  geometry: GeometrySummary | null;
  build: { ok: boolean; errors: number } | null;
}

/** Per-name misfit reasons from a rejected PATCH (HTTP 400): each key is a
 *  parameter name, each value the backend's message for it. */
export class ParameterErrors extends Error {
  readonly details: Readonly<Record<string, string>>;
  constructor(message: string, details: Readonly<Record<string, string>>) {
    super(message);
    this.details = details;
  }
}

/** Set one or more parameter values (numbers, in each parameter's own
 *  unit) — or null to return a parameter to its default. Atomic: any bad
 *  value rejects the whole PATCH with a 400 carrying per-name reasons
 *  (thrown as ParameterErrors), and a live agent turn rejects with 409. */
export async function setParameters(
  designId: string,
  values: Record<string, number | null>,
): Promise<ParametersResult> {
  try {
    const res = await forgeAxios.patch(`/designs/${designId}/parameters`, {
      values,
    });
    return res.data as ParametersResult;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response !== undefined) {
      const body = err.response.data as
        | { error?: string; details?: Record<string, string> }
        | null
        | undefined;
      const message =
        body?.error ?? `Request failed with status ${err.response.status}`;
      if (err.response.status === 400 && body?.details) {
        throw new ParameterErrors(message, body.details);
      }
      throw Object.assign(new Error(message), {
        status: err.response.status,
      });
    }
    throw err;
  }
}

export async function sendDesignMessage(designId: string, message: string) {
  await forgeAxios.post(`/designs/${designId}/chat`, {
    message,
    model: FORGE_MODEL,
    reasoningEffort: FORGE_REASONING_EFFORT,
  });
}

/** Fetch a design's user-facing projection: parameter list and geometry
 *  summary. Returns null on 404. */
export async function getDesign(
  designId: string,
): Promise<DesignFrontend | null> {
  try {
    const res = await forgeAxios.get(`/designs/${designId}`);
    return res.data.design;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

/** What GET /designs/:id/geometry returned. */
export type GeometryFetch =
  | { status: "none" } // 204 — no build has produced geometry yet
  | { status: "unchanged" } // 304 — same revision the caller already has
  // the GLB
  | { status: "ok"; blob: ArrayBuffer; revision: string };

/** Fetch the design's stored geometry GLB. Sends If-None-Match when the
 *  caller knows the current revision, so an unchanged model costs a 304
 *  instead of the file transfer. */
export async function fetchDesignGeometry(
  designId: string,
  knownRevision?: string,
): Promise<GeometryFetch> {
  const res = await forgeAxios.get(`/designs/${designId}/geometry`, {
    responseType: "arraybuffer",
    // 204/304 carry no body but axios must not treat either as an error.
    validateStatus: (s) => s === 200 || s === 204 || s === 304,
    ...(knownRevision
      ? { headers: { "If-None-Match": JSON.stringify(knownRevision) } }
      : {}),
  });
  if (res.status === 204) return { status: "none" };
  if (res.status === 304) return { status: "unchanged" };
  const etag = (res.headers["etag"] as string | undefined) ?? "";
  return {
    status: "ok",
    blob: res.data as ArrayBuffer,
    // "" when the server doesn't expose ETag (cross-origin); glb.ts
    // never caches under an empty revision key.
    revision: etag.replace(/^"|"$/g, ""),
  };
}

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
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const ev = parseStreamEvent(block);
      if (ev !== null) {
        yield ev;
      }
    }
  }
}

/** Parse one SSE event block (`event: NAME\ndata: DATA`) into a StreamEvent.
 *  Returns null for keepalive comment blocks (`: keepalive`) and malformed
 *  frames rather than fabricating an event. Unknown event names are
 *  dropped so a newer backend can't crash an older client. */
function parseStreamEvent(block: string): StreamEvent | null {
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event: ")) eventName = line.slice(7).trim();
    else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    else if (line === "data:") dataLines.push("");
  }
  if (eventName.length === 0) return null;
  const data = dataLines.join("\n");

  switch (eventName) {
    case "running":
      return { type: "running", data: data === "true" };
    case "geometry":
      try {
        return { type: "geometry", data: JSON.parse(data) as GeometrySummary };
      } catch {
        return null;
      }
    case "parameters":
      try {
        return { type: "parameters", data: JSON.parse(data) as Parameter[] };
      } catch {
        return null;
      }
    case "stop":
      return { type: "stop", data: data === "true" };
    case "usage":
      try {
        return {
          type: "usage",
          data: JSON.parse(data) as {
            inputTokens?: number;
            outputTokens?: number;
            turns?: number;
          },
        };
      } catch {
        return null;
      }
    case "error":
      try {
        return { type: "error", data: JSON.parse(data) as string };
      } catch {
        // Some error payloads may be plain strings rather than JSON
        return { type: "error", data };
      }
    case "end":
      return { type: "end", data: "" };
    default:
      return null;
  }
}

export { FORGE_BASE };
