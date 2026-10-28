import axios from "axios";

import { FORGE_MODEL, FORGE_REASONING_EFFORT } from "./config";
import { FORGE_BASE } from "./env";
import type { Design, GeometrySummary, Parameter } from "./types";

/* Forge shares the Facture session cookie, so no separate login is needed. */
const forgeApi = axios.create({ baseURL: FORGE_BASE, withCredentials: true });

/** The server's error text when it sent one, else the error's own message. */
export function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: string } | undefined;
    if (body?.error) return body.error;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Images one Forge message can carry: the per-request cap of its
    /uploads and the length cap of a chat call's `imageIds` alike. */
export const FORGE_MAX_IMAGES = 10;

/** Upload images as user-level forge assets; the returned ids ride on the
    next design chat's `imageIds`. */
export async function uploadImages(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const res = await forgeApi.postForm("/uploads", form);
  return res.data.images ?? [];
}

export async function createDesign(): Promise<string> {
  const res = await forgeApi.post("/designs");
  return res.data._id;
}

/** Null when the design is gone (deleted, or not this user's). */
export async function getDesign(designId: string): Promise<Design | null> {
  try {
    const res = await forgeApi.get(`/designs/${designId}`);
    return res.data.design;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

/* Starts an agent turn on the design; it runs detached and is followed on the
   design's stream. 409 while another turn is running. */
export async function sendDesignMessage(designId: string, message: string, imageIds: string[] = []) {
  await forgeApi.post(`/designs/${designId}/chat`, {
    message,
    model: FORGE_MODEL,
    reasoningEffort: FORGE_REASONING_EFFORT,
    ...(imageIds.length > 0 ? { imageIds } : {}),
  });
}

/* Sets parameter values and rebuilds. Atomic: one bad value rejects all (400),
   and a running agent turn rejects with 409. */
export async function setParameters(
  designId: string,
  values: Record<string, number | null>,
): Promise<{
  parameters: Parameter[];
  geometry: GeometrySummary | null;
  /** The rebuild's verdict; null when the build could not run at all. */
  build: { ok: boolean } | null;
}> {
  const res = await forgeApi.patch(`/designs/${designId}/parameters`, { values });
  return res.data;
}

/** The stored GLB, or null when no build has produced geometry yet. */
export async function fetchGeometry(designId: string): Promise<ArrayBuffer | null> {
  const res = await forgeApi.get(`/designs/${designId}/geometry`, {
    responseType: "arraybuffer",
    validateStatus: (status) => status === 200 || status === 204,
  });
  return res.status === 204 ? null : (res.data as ArrayBuffer);
}

export interface StepContext {
  /** The text the Forge agent itself reads before a step: the source, the
      build's verdict, user-set values and the compiler's report. */
  text: string;
  /** The build's rendered views, as JPEG data URIs. */
  images: { view: string; jpeg: string }[];
}

/* Built fresh by the server on every request, never stored. */
export async function fetchStepContext(designId: string): Promise<StepContext> {
  const res = await forgeApi.get(`/designs/${designId}/step-context`, { params: { images: true } });
  return { text: res.data.text ?? "", images: res.data.images ?? [] };
}

export type StreamEvent =
  | { type: "running"; running: boolean }
  | { type: "geometry"; geometry: GeometrySummary }
  | { type: "parameters"; parameters: Parameter[] }
  | { type: "end" };

/*
  A design's live event stream. It stays open across turns: it opens with the
  `running` flag (plus the live turn's latest frames), and every later turn
  announces itself with `running` and closes with `end`. Frames this app does
  not use are dropped.
*/
export async function* designStream(
  designId: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${FORGE_BASE}/designs/${designId}/stream`, {
    headers: { Accept: "text/event-stream" },
    credentials: "include",
    signal,
  });
  if (!res.ok || res.body === null) throw new Error(`Design stream failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const event = parseFrame(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      if (event !== null) yield event;
    }
  }
}

function parseFrame(block: string): StreamEvent | null {
  let name = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  try {
    switch (name) {
      case "running":
        return { type: "running", running: data === "true" };
      case "geometry":
        return { type: "geometry", geometry: JSON.parse(data) };
      case "parameters":
        return { type: "parameters", parameters: JSON.parse(data) };
      case "end":
        return { type: "end" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
