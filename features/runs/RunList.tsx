"use client";

import Page from "@/components/Page";
import { BUILD_LABEL } from "@/lib/config";
import { collectHandoffs } from "@/lib/handoffs";
import type { FlowRun } from "@/lib/types";

function formatRunDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/*
  Replaces the raw status chip with a stage word the user already
  knows from the timeline. Priority: design ready (CAD handoffs
  exist) → parked at the post-intake clarification (S2 node) → intake
  not yet submitted → intake in flight → everything else settled.
*/
function runStage(
  run: FlowRun,
  s2NodeId: string | null
): string {
  if (run.status === "failed") return "Failed";
  if (collectHandoffs(run.runningDoc).length > 0) return "Design ready";
  const clarification =
    s2NodeId !== null && run.currentNodeId === s2NodeId;
  if (clarification) {
    return run.status === "running"
      ? "Clarifying model details…"
      : "Awaiting your clarification";
  }
  if (run.runningDoc == null || !hasText(run.runningDoc.forge_instruction))
    return "Setting up your repair";
  if (run.status === "running") return "Analyzing repair…";
  return "Ready for generation";
}

/* Failed → red, intake → neutral gray, every other stage → the
   timeline's brand-blue tint. */
function runStageClasses(stage: string): string {
  if (stage === "Failed") return "bg-[#fff0f0] text-[#a22c2c]";
  if (stage === "Setting up your repair")
    return "bg-[#e7e9ed] text-ink-soft";
  return "bg-[#eef2fb] text-[#2c67d7]";
}

interface RunListProps {
  runs: FlowRun[];
  loading: boolean;
  error: string;
  creating: boolean;
  createError: string;
  selecting: boolean;
  selectError: string;
  /** pipeline.ts node id of the post-intake clarification step, used
    to label runs parked there waiting for the case clarification. */
  s2NodeId?: string | null;
  onCreateRun: () => void;
  onSelectRun: (runId: string) => void;
  onLogout: () => void;
}

export default function RunList({
  runs,
  loading,
  error,
  creating,
  createError,
  selecting,
  selectError,
  s2NodeId = null,
  onCreateRun,
  onSelectRun,
  onLogout,
}: RunListProps) {
  const busy = loading || creating || selecting;

  return (
    <Page>
      <div className="flex items-center justify-between gap-3 pt-6">
        <h1>Your repairs</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy}
            onClick={onCreateRun}
          >
            ＋ New repair
          </button>
          <button type="button" className="btn-ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      <p className="mb-9 mt-3 text-[17px] leading-relaxed text-muted">
        Continue an existing repair run or start a new one.
      </p>

      {(error || createError || selectError) && (
          <p className="mt-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
            {error || createError || selectError}
          </p>
        )}

        {loading ? (
          <p className="mt-6 text-faint">Loading runs...</p>
        ) : runs.length === 0 ? (
          <p className="mt-6 text-faint">
            No repairs yet. Start your first one with &quot;New repair&quot;.
          </p>
        ) : (
          <ul className="mt-6 flex list-none flex-col gap-3 p-0">
            {runs.map((candidate) => (
              <li key={candidate._id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 rounded-[10px] border border-line bg-surface px-4.5 py-4 text-left text-ink hover:bg-[#eef1f6] disabled:hover:bg-surface"
                  disabled={busy}
                  onClick={() => onSelectRun(candidate._id)}
                >
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span className="flex items-center gap-2.5 font-semibold">
                      Repair run
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${runStageClasses(
                          runStage(candidate, s2NodeId)
                        )}`}
                      >
                        {runStage(candidate, s2NodeId)}
                      </span>
                    </span>

                    <span className="text-[13px] text-muted-2">
                      Created {formatRunDate(candidate.createdAt)} · Updated{" "}
                      {formatRunDate(candidate.updatedAt)}
                    </span>
                  </span>

                  <span className="text-sm font-semibold whitespace-nowrap text-brand">
                    Open →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

      <div className="mt-8 text-xs text-faint-2">Build {BUILD_LABEL}</div>
    </Page>
  );
}
