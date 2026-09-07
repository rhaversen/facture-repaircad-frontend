"use client";

import { AppHeader, AppShell, Card } from "@/components/AppShell";
import { BUILD_LABEL } from "@/lib/config";
import type { FlowRun } from "@/lib/types";

function formatRunDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

interface RunListProps {
  runs: FlowRun[];
  loading: boolean;
  error: string;
  creating: boolean;
  createError: string;
  selecting: boolean;
  selectError: string;
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
  onCreateRun,
  onSelectRun,
  onLogout,
}: RunListProps) {
  const busy = loading || creating || selecting;

  return (
    <AppShell>
      <Card>
        <AppHeader
          utilities={
            <button type="button" className="btn-ghost" onClick={onLogout}>
              Sign out
            </button>
          }
        />

        <h1>Your repairs</h1>

        <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
          Continue an existing repair run or start a new one.
        </p>

        <div className="mt-8 flex justify-end">
          <button type="button" onClick={onCreateRun} disabled={busy}>
            {creating ? "Creating..." : "New run"}
          </button>
        </div>

        {(error || createError || selectError) && (
          <p className="mt-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
            {error || createError || selectError}
          </p>
        )}

        {loading ? (
          <p className="mt-6 text-faint">Loading runs...</p>
        ) : runs.length === 0 ? (
          <p className="mt-6 text-faint">
            No runs yet. Start your first repair with &quot;New run&quot;.
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
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                          candidate.status === "running"
                            ? "bg-brand-soft text-brand"
                            : candidate.status === "idle"
                              ? "bg-[#e5f5ea] text-[#1d7a3d]"
                              : candidate.status === "failed"
                                ? "bg-[#fff0f0] text-[#a22c2c]"
                                : "bg-[#e7e9ed] text-ink-soft"
                        }`}
                      >
                        {candidate.status}
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
      </Card>
    </AppShell>
  );
}
