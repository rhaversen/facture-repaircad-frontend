import axios from "axios";

import { FLOW_API_BASE } from "./env";
import { pipelineId, refinementPipelineId } from "./pipeline";
import { FLOW_MODEL } from "./config";
import type { FlowMessage, FlowRun, PipelineSummary, RunningDoc } from "./types";

export const flowApi = axios.create({ baseURL: FLOW_API_BASE });

export function bearer(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export interface TurnResponse {
  run?: FlowRun;
  messages?: FlowMessage[];
}

export async function fetchPipelines(token: string | null): Promise<PipelineSummary[]> {
  const res = await fetch(`${FLOW_API_BASE}/public/pipelines`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  return data.pipelines ?? [];
}

export async function fetchRuns(token: string): Promise<FlowRun[]> {
  const res = await flowApi.get("/runs", bearer(token));
  const pipeline = await pipelineId();
  return (res.data.runs ?? []).filter(
    (candidate: FlowRun) => candidate.pipelineId === pipeline,
  );
}

export async function createRun(token: string): Promise<FlowRun> {
  const res = await flowApi.post(
    "/runs",
    { pipelineId: await pipelineId() },
    bearer(token),
  );
  return res.data.run;
}

export async function createRefinementRun(token: string): Promise<FlowRun> {
  const res = await flowApi.post(
    "/runs",
    { pipelineId: await refinementPipelineId() },
    bearer(token),
  );
  return res.data.run;
}

export async function fetchRun(token: string, runId: string): Promise<FlowRun> {
  const res = await flowApi.get(`/runs/${runId}`, bearer(token));
  return res.data.run;
}

export async function fetchMessages(
  token: string,
  runId: string,
): Promise<FlowMessage[]> {
  const res = await flowApi.get(`/runs/${runId}/messages`, bearer(token));
  return res.data.messages ?? [];
}

export async function postMessage(
  token: string,
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
    const res = await flowApi.post(`/runs/${runId}/messages`, formData, bearer(token));
    return res.data;
  }
  const res = await flowApi.post(
    `/runs/${runId}/messages`,
    { content, model: FLOW_MODEL },
    bearer(token),
  );
  return res.data;
}

export function runningDocOf(run: FlowRun | null | undefined): RunningDoc {
  return run?.runningDoc ?? {};
}
