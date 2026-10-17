"use client";

import { useEffect, useState } from "react";

import Page from "@/components/Page";
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

export default function RunList({
  onOpen,
  onNew,
  onLogout,
}: {
  onOpen: (runId: string) => void;
  onNew: () => void;
  onLogout: () => void;
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

  return (
    <Page>
      <div className="flex items-center justify-between gap-3">
        <h1 className="mb-0">Your repairs</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full px-3.5 py-1.5 text-[13px]"
            onClick={onNew}
          >
            ＋ New repair
          </button>
          <button type="button" className="btn-ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>
      <p className="intro mt-3">Continue an existing repair or start a new one.</p>

      {error && <p className="error-box">{error}</p>}

      {runs === null ? (
        !error && <p className="text-faint">Loading repairs…</p>
      ) : runs.length === 0 ? (
        <p className="text-faint">No repairs yet. Start your first one with &quot;New repair&quot;.</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {runs.map((run) => {
            const stage = stageLabel(run, clarificationNode);
            return (
              <li key={run._id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 border border-line bg-surface px-4.5 py-4 text-left font-normal text-ink hover:bg-[#eef1f6]"
                  onClick={() => onOpen(run._id)}
                >
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span className="flex items-center gap-2.5 font-semibold">
                      Repair run
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          stage === "Failed"
                            ? "bg-[#fff0f0] text-[#a22c2c]"
                            : stage === "Not submitted"
                              ? "bg-[#e7e9ed] text-ink-soft"
                              : "bg-brand-tint text-[#2c67d7]"
                        }`}
                      >
                        {stage}
                      </span>
                    </span>
                    <span className="text-[13px] text-muted-2">
                      Created {formatDate(run.createdAt)} · Updated {formatDate(run.updatedAt)}
                    </span>
                  </span>
                  <span className="text-sm font-semibold whitespace-nowrap text-brand">Open →</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 text-xs text-faint-2">Build {BUILD_LABEL}</div>
    </Page>
  );
}
