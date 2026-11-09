"use client";

import { useEffect, useState } from "react";

import { NextIcon, PlusIcon, WrenchIcon } from "@/components/icons";
import Page from "@/components/Page";
import { Button, Empty, ErrorBox, Loading, Title } from "@/components/ui";
import { BUILD_LABEL } from "@/lib/config";
import { listRuns, resolvePipelines, stageOf } from "@/lib/flow";
import type { FlowRun } from "@/lib/types";

const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : "");

/* The stage word, in the timeline's vocabulary. hasUserTurn is not known here;
   an untouched run reads as "Not submitted" either way. */
function stageLabel(run: FlowRun, clarificationNode: string): string {
  if (run.status === "failed") return "Failed";
  switch (stageOf(run, false, clarificationNode)) {
    case "designs":
      return "Designs ready";
    case "clarification":
      return "Awaiting your clarification";
    case "intake":
      return "Not submitted";
    default:
      return run.status === "running" ? "Planning…" : "Awaiting your reply";
  }
}

/* The stage, as the color of a dot beside its word. */
function stageTone(stage: string): string {
  if (stage === "Failed") return "bg-danger";
  if (stage === "Not submitted") return "bg-subtle";
  if (stage === "Designs ready") return "bg-success";
  if (stage.startsWith("Awaiting")) return "bg-warning";
  return "bg-accent";
}

export default function RunList({
  onOpen,
  onNew,
}: {
  onOpen: (runId: string) => void;
  onNew: () => void;
}) {
  const [runs, setRuns] = useState<FlowRun[] | null>(null);
  const [clarificationNode, setClarificationNode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([listRuns(), resolvePipelines()])
      .then(([list, pipelines]) => {
        setRuns(list);
        setClarificationNode(pipelines.clarificationNode);
      })
      .catch((err) => {
        console.error("Could not load runs:", err);
        setError("Could not load your repairs. Please reload the page.");
      });
  }, []);

  const newButton = (
    <Button variant="primary" onClick={onNew}>
      <PlusIcon size={16} />
      New repair
    </Button>
  );

  return (
    <Page home narrow>
      <Title actions={runs !== null && runs.length > 0 ? newButton : undefined}>Repairs</Title>

      {error && <ErrorBox>{error}</ErrorBox>}

      {runs === null ? (
        !error && <Loading />
      ) : runs.length === 0 ? (
        <Empty icon={<WrenchIcon size={28} />} action={newButton}>
          No repairs yet.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {runs.map((run) => {
            const stage = stageLabel(run, clarificationNode);
            return (
              <li key={run._id}>
                <button
                  type="button"
                  className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-border/70 bg-surface p-4 text-left transition-colors hover:border-border-strong"
                  onClick={() => onOpen(run._id)}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted transition-colors group-hover:text-foreground">
                    <WrenchIcon size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">Repair run</span>
                    <span className="truncate text-xs text-subtle" title={`Created ${formatDate(run.createdAt)}`}>
                      Updated {formatDate(run.updatedAt)}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2 text-sm text-muted" title={stage}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${stageTone(stage)}`} />
                    <span className="max-sm:hidden">{stage}</span>
                  </span>
                  <span className="text-subtle transition-colors group-hover:text-foreground">
                    <NextIcon size={16} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto pt-4 text-xs text-subtle">Build {BUILD_LABEL}</div>
    </Page>
  );
}
