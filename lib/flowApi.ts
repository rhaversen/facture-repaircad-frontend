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

export async function postMessage(
  runId: string,
  content: string,
  photos?: File[],
): Promise<TurnResponse> {
  if (photos && photos.length > 0) {
    const formData = new FormData();
    formData.append("content", content);
    formData.append("model", FLOW_MODEL);
    for (const file of photos) {
      formData.append("photos", file, file.name);
    }
    const res = await flowApi.post(`/runs/${runId}/messages`, formData);
    return res.data;
  }
  const res = await flowApi.post(`/runs/${runId}/messages`, {
    content,
    model: FLOW_MODEL,
  });
  return res.data;
}

export function runningDocOf(run: FlowRun | null | undefined): RunningDoc {
  return run?.runningDoc ?? {};
}
