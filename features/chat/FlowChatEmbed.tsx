"use client";

import { AUTH_BASE, FLOW_EMBED_BASE } from "@/lib/env";
import { FLOW_MODEL } from "@/lib/config";

/*
  Reusable Flow conversation frame — a bare iframe for embedding inside other
  screens (the CAD refinement workspace). The iframe owns streaming, markdown
  and photos; this app only supplies the URL parameters. The shared Facture
  session cookie covers both the host page and the same-domain embed.
*/
export function FlowChatFrame({
  runId,
  title = "RepairCAD conversation",
  disabled = false,
  disabledMessage,
}: {
  runId: string;
  title?: string;
  disabled?: boolean;
  disabledMessage?: string;
}) {
  if (!runId) {
    return null;
  }

  const params = new URLSearchParams({
    run: runId,
    model: FLOW_MODEL,
    showTitle: "0",
    showIntro: "0",
    hideMessages: "2",
    disableChat: disabled ? "1" : "0",
  });
  if (disabledMessage) {
    params.set("disabledMessage", disabledMessage);
  }

  return (
    <iframe
      title={title}
      src={`${FLOW_EMBED_BASE}?${params.toString()}`}
      className="h-full min-h-[420px] w-full rounded-xl border border-line bg-black"
      allow="clipboard-write"
    />
  );
}

export default function FlowChatEmbed({
  runId,
  onLogout,
  onNewRun,
  onViewRuns,
  onOpenCad,
  cadReady = false,
}: {
  runId: string | null;
  onLogout: () => void;
  onNewRun: () => void;
  onViewRuns: () => void;
  onOpenCad: () => void;
  cadReady?: boolean;
}) {
  const params = new URLSearchParams({
    run: runId ?? "",
    model: FLOW_MODEL,
    showTitle: "0",
    showIntro: "0",
    hideMessages: "2",
  });

  /*
    Fills whatever container mounts it; the host decides the height (viewport
    app layout on desktop, fixed share of the viewport on small screens) so
    the page itself never scrolls while the conversation is up.
  */
  return (
    <main className="relative mx-auto flex h-full min-h-0 w-full max-w-[900px] flex-col gap-4 rounded-2xl border border-line bg-white px-6 pb-6 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="text-lg font-bold">RepairCAD</div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn-utility"
            onClick={onOpenCad}
            disabled={!cadReady}
            title={
              cadReady
                ? "Open the CAD & refinement workspace"
                : "Available once RepairCAD has produced a CAD handoff"
            }
          >
            CAD workspace →
          </button>
          <button type="button" className="btn-utility" onClick={onNewRun}>
            New run
          </button>
          <button type="button" className="btn-utility" onClick={onViewRuns}>
            All runs
          </button>
          <a className="btn-utility" href={AUTH_BASE} target="_blank" rel="noreferrer">
            Account
          </a>
          <button type="button" className="btn-ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      <iframe
        title="RepairCAD conversation"
        src={`${FLOW_EMBED_BASE}?${params.toString()}`}
        className="min-h-0 w-full flex-1 rounded-xl border border-line bg-black"
        allow="clipboard-write"
      />
    </main>
  );
}
