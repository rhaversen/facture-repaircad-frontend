import axios from "axios";

import { FLOW_API_BASE } from "./env";
import { pipelineId, refinementPipelineId } from "./pipeline";
import { FLOW_MODEL } from "./config";
import type { FlowMessage, FlowRun, PipelineSummary, RunningDoc } from "./types";

export const flowApi = axios.create({
  baseURL: FLOW_API_BASE,
  withCredentials: true,
});

export interface TurnResponse {
  run?: FlowRun;
  messages?: FlowMessage[];
}

export async function fetchPipelines(): Promise<PipelineSummary[]> {
  const res = await fetch(`${FLOW_API_BASE}/public/pipelines`, {
    credentials: "include",
  });
  const data = await res.json();
  return data.pipelines ?? [];
}

export async function fetchRuns(): Promise<FlowRun[]> {
  const res = await flowApi.get("/runs");
  const pipeline = await pipelineId();
  return (res.data.runs ?? []).filter(
    (candidate: FlowRun) => candidate.pipelineId === pipeline,
  );
}

export async function createRun(): Promise<FlowRun> {
  const res = await flowApi.post("/runs", { pipelineId: await pipelineId() });
  return res.data.run;
}

export async function createRefinementRun(): Promise<FlowRun> {
  const res = await flowApi.post(
    "/runs",
    { pipelineId: await refinementPipelineId() },
  );
  return res.data.run;
}

export async function fetchRun(runId: string): Promise<FlowRun> {
  const res = await flowApi.get(`/runs/${runId}`);
  return res.data.run;
}

export async function fetchMessages(runId: string): Promise<FlowMessage[]> {
  const res = await flowApi.get(`/runs/${runId}/messages`);
  return res.data.messages ?? [];
}

/** Upload images to attach to the next message; the returned asset ids ride
 *  on the postMessage call's `imageIds`. Assets are user-level — no run is
 *  needed to attach, and the referencing run is decided at send time (the
 *  forge pattern). The backend normalizes (re-encodes to ≤1024px JPEG,
 *  strips EXIF) and dedupes by hash, so previews rendered from the ORIGINAL
 *  File may differ slightly from the stored asset.Errors surface here so
 *  callers keep the user's draft intact. */
export async function uploadImages(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  const res = await flowApi.postForm("/uploads", formData);
  return res.data.images ?? [];
}

/** Resume a settled run with the user's reply — text and/or pre-uploaded
 *  image asset ids (photos are only accepted on attachPhotos nodes).
 *  Returns 202 immediately (the fire-and-forget contract): the turn runs
 *  detached on the server; poll /runs/:id until it settles. Plain JSON —
 *  the heavy image payloads were already stored by /uploads. */
export async function postMessage(
  runId: string,
  content: string,
  imageIds?: string[],
): Promise<TurnResponse> {
  const res = await flowApi.post(`/runs/${runId}/messages`, {
    content,
    model: FLOW_MODEL,
    ...(imageIds && imageIds.length > 0 ? { imageIds } : {}),
  });
  return res.data;
}

export function runningDocOf(run: FlowRun | null | undefined): RunningDoc {
  return run?.runningDoc ?? {};
}
