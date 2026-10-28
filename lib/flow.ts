import axios from "axios";

import { FLOW_MODEL } from "./config";
import { FLOW_API_BASE } from "./env";
import { FORGE_MAX_IMAGES } from "./forge";
import type { FlowMessage, FlowRun, MessageContentPart, RunningDoc } from "./types";

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
   runs detached; follow it by polling the run until it is no longer running.
   Uploaded assets reach the transcript with their asset ids attached by the
   backend ([photo asset id: ...] tags for the agent, imageId metadata on the
   photo parts for this client) — the source the S9 gather field's id roster
   and referencePhotoParts resolve against. */
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

/* Parse the forge_reference_photos document into asset ids. The canonical
   shape is a JSON array of id strings (["dah0a8ef0", ...]). The agent writes
   the list per its S9 few-shots; ids are the ones the backend attaches to
   the transcript's photos (see idPhotoParts). */
export function forgeReferencePhotoIds(doc: RunningDoc | undefined): string[] {
  const docText = (doc?.forge_reference_photos ?? "").trim();
  if (docText === "") return [];
  /* Order is the agent's chosen send order; duplicates collapse to the
     first occurrence. Case is preserved — matching in referencePhotoParts
     compares ids the way the roster and frontend both carry them. */
  const dedupe = (list: string[]): string[] => {
    const seen = new Set<string>();
    return list.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(docText);
  } catch {
    parsed = null; // not JSON — tolerate malformed docs via bracket matching
  }
  const parsedIds = Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
    : null;
  if (parsedIds) return dedupe(parsedIds);
  /* Prose tolerance: the agent wrapped ids in a bracket group on a line the
     JSON parser rejected (markdown, leading commentary). Harvest
     id-shaped tokens inside bracket groups only, so stray English words
     elsewhere in the line never disguise themselves as ids. */
  const ids: string[] = [];
  for (const group of docText.matchAll(/\[([^\]]*)\]/g)) {
    for (const match of group[1].matchAll(/"([a-z0-9_-]{6,32})"|'([a-z0-9_-]{6,32})'|\b([a-z0-9_-]{6,32})\b/gi)) {
      ids.push(match[1] ?? match[2] ?? match[3]);
    }
  }
  return dedupe(ids);
}

/** The transcript's photos with the asset id the backend attaches to each
    hydrated photo part (`imageId` metadata on the file part from the API's
    read path). Aggregated in transcript order, ids deduplicated. The agent
    copies these ids into its gather fields, so this is the mapping
    `referencePhotoParts` resolves against. */
function idPhotoParts(messages: FlowMessage[]): Array<{ id: string; part: MessageContentPart }> {
  const seen = new Set<string>();
  const found: Array<{ id: string; part: MessageContentPart }> = [];
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const part of m.content as MessageContentPart[]) {
      const id = typeof part?.imageId === "string" ? part.imageId : "";
      if (!id || seen.has(id)) continue;
      const isPhoto =
        (part?.type === "file" && typeof part?.data === "string") ||
        part?.type === "user-image";
      if (!isPhoto) continue;
      seen.add(id);
      found.push({ id, part });
    }
  }
  return found;
}

/** The transcript's photos for the Forge handoff: exactly the ones the
    document's id list names (resolved against the ids each user message
    declares in its text). A document that names none sends none. Capped at
    what one Forge message can carry. */
export function referencePhotoParts(
  doc: RunningDoc | undefined,
  messages: FlowMessage[],
  maxPhotos = FORGE_MAX_IMAGES,
): MessageContentPart[] {
  const ids = forgeReferencePhotoIds(doc);
  if (ids.length === 0) return [];
  const byId = new Map(idPhotoParts(messages).map(({ id, part }) => [id, part]));
  /* Emit in the document's send order; missing ids simply drop out. */
  const picked = ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as MessageContentPart] : []));
  return picked.slice(0, maxPhotos);
}

/** Photo parts as uploadable JPEG files, named after their 1-based position
    among the run's photos. */
export async function photoFilesOf(parts: MessageContentPart[]): Promise<File[]> {
  return Promise.all(
    parts.map(async (part, index) => {
      const blob = await (await fetch(String(part.data))).blob();
      return new File([blob], `repair-photo-${index + 1}.jpg`, {
        type: blob.type || "image/jpeg",
      });
    }),
  );
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
