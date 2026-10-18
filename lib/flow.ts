import axios from "axios";

import { FLOW_MODEL } from "./config";
import { FLOW_API_BASE } from "./env";
import type { FlowMessage, FlowRun, RunningDoc } from "./types";

const flowApi = axios.create({ baseURL: FLOW_API_BASE, withCredentials: true });

/*
  Pipelines are bound by NAME, the stable contract; their ids change whenever
  the flow server reseeds. A missing name means the contract changed and the
  app must be redeployed against it, so there is no fallback.
*/
const MAIN_PIPELINE = "RepairCAD2.0";
const REFINEMENT_PIPELINE = "AfterForge2.0";
const CLARIFICATION_NODE_LABEL = "S2";

export interface Pipelines {
  main: string;
  refinement: string;
  clarificationNode: string;
}

let pipelines: Promise<Pipelines> | null = null;

export function resolvePipelines(): Promise<Pipelines> {
  pipelines ??= flowApi.get("/public/pipelines").then((res) => {
    const list: { _id: string; name: string; nodes?: { _id: string; label?: string }[] }[] =
      res.data.pipelines ?? [];
    const main = list.find((p) => p.name === MAIN_PIPELINE);
    const refinement = list.find((p) => p.name === REFINEMENT_PIPELINE);
    const clarification = main?.nodes?.find((n) =>
      (n.label ?? "").includes(CLARIFICATION_NODE_LABEL),
    );
    if (!main || !refinement || !clarification) {
      throw new Error(`The flow server is missing the ${MAIN_PIPELINE} or ${REFINEMENT_PIPELINE} pipeline.`);
    }
    return {
      main: main._id,
      refinement: refinement._id,
      clarificationNode: clarification._id,
    };
  });
  pipelines.catch(() => {
    pipelines = null;
  });
  return pipelines;
}

export async function listRuns(): Promise<FlowRun[]> {
  const [{ main }, res] = await Promise.all([resolvePipelines(), flowApi.get("/runs")]);
  return (res.data.runs ?? []).filter((run: FlowRun) => run.pipelineId === main);
}

export async function createRun(pipelineId: string): Promise<FlowRun> {
  const res = await flowApi.post("/runs", { pipelineId });
  return res.data.run;
}

/** Null when the run is gone (deleted, or not this user's). */
export async function fetchRun(runId: string): Promise<FlowRun | null> {
  try {
    const res = await flowApi.get(`/runs/${runId}`);
    return res.data.run;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

export async function fetchMessages(runId: string): Promise<FlowMessage[]> {
  const res = await flowApi.get(`/runs/${runId}/messages`);
  return res.data.messages ?? [];
}

/* Images upload first as user-level assets; their ids ride on the message. */
async function uploadImages(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const res = await flowApi.postForm("/uploads", form);
  return res.data.images ?? [];
}

/* Starts a turn on a settled run. The server answers 202 at once and the turn
   runs detached; follow it by polling the run until it is no longer running. */
export async function sendMessage(runId: string, content: string, files: File[] = []) {
  const imageIds = await uploadImages(files);
  await flowApi.post(`/runs/${runId}/messages`, {
    content,
    model: FLOW_MODEL,
    ...(imageIds.length > 0 ? { imageIds } : {}),
  });
}

/** The pipeline's handoff documents, one per design to generate. */
export function handoffsOf(doc: RunningDoc | undefined): string[] {
  return [doc?.forge_handoff_1, doc?.forge_handoff_2, doc?.forge_handoff_3]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim());
}

export type RunStage = "intake" | "planning" | "clarification" | "designs";

/*
  Where a main run is, from the run alone (plus whether it has a user turn,
  which only matters before the pipeline has written anything). The handoff
  makes it final: from then on the run is only ever in the design stage.
*/
export function stageOf(
  run: FlowRun,
  hasUserTurn: boolean,
  clarificationNode: string,
): RunStage {
  // The handoff node writes its fields as it goes; wait for it to finish.
  if (handoffsOf(run.runningDoc).length > 0 && run.status !== "running") return "designs";
  const untouched =
    run.status !== "running" && Object.keys(run.runningDoc ?? {}).length === 0;
  if (untouched && !hasUserTurn) return "intake";
  if (run.status === "idle" && run.currentNodeId === clarificationNode) return "clarification";
  return "planning";
}
