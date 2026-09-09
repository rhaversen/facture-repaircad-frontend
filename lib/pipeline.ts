import { fetchPipelines } from "./flowApi";
import type { PipelineSummary } from "./types";

/*
  Pipeline binding resolved by NAME — the names are the stable contract, not
  the Mongo ObjectIds, which change whenever the flow server's pipelines are
  (re)seeded or redeployed. Unlike the Vite app's top-level await, this is
  resolved lazily on first client-side use and cached.

  There is no fallback: if any name is missing the resolution throws, because
  a mismatch means the pipeline contract changed and RepairCAD must be
  redeployed against the new pipeline.
*/
const MAIN_PIPELINE_NAME = "RepairCAD2.0";
const REFINEMENT_PIPELINE_NAME = "AfterForge2.0";
const S2_NODE_LABEL_FRAGMENT = "S2";

let resolution: Promise<{
  pipelineId: string;
  refinementPipelineId: string;
  s2NodeId: string;
}> | null = null;

function resolveFrom(pipelines: PipelineSummary[]) {
  const main = pipelines.find((p) => p.name === MAIN_PIPELINE_NAME);
  if (!main) {
    throw new Error(`No "${MAIN_PIPELINE_NAME}" pipeline on the flow server.`);
  }
  const refinement = pipelines.find((p) => p.name === REFINEMENT_PIPELINE_NAME);
  if (!refinement) {
    throw new Error(
      `No "${REFINEMENT_PIPELINE_NAME}" pipeline on the flow server.`,
    );
  }
  const s2Node = (main.nodes ?? []).find((node) =>
    (node.label ?? "").includes(S2_NODE_LABEL_FRAGMENT),
  );
  if (!s2Node) {
    throw new Error(
      `No node label containing "${S2_NODE_LABEL_FRAGMENT}" in "${MAIN_PIPELINE_NAME}".`,
    );
  }
  return {
    pipelineId: main._id,
    refinementPipelineId: refinement._id,
    s2NodeId: s2Node._id,
  };
}

export function resolvePipelineIds() {
  if (resolution === null) {
    resolution = fetchPipelines().then(resolveFrom);
    resolution.catch(() => {
      resolution = null;
    });
  }
  return resolution;
}

export async function pipelineId(): Promise<string> {
  return (await resolvePipelineIds()).pipelineId;
}

export async function refinementPipelineId(): Promise<string> {
  return (await resolvePipelineIds()).refinementPipelineId;
}

export async function s2NodeId(): Promise<string> {
  return (await resolvePipelineIds()).s2NodeId;
}
