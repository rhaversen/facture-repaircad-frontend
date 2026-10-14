"use client";

import { FLOW_EMBED_BASE } from "@/lib/env";
import { FLOW_MODEL } from "@/lib/config";

/*
  Reusable Flow conversation frame — a bare iframe for embedding inside other
  screens (the full-page Repair Planning view, the CAD refinement workspace).
  The iframe owns streaming, markdown and photos; this app only supplies the
  URL parameters. The shared Facture session cookie covers the host page and
  the same-domain embed.
*/
export function FlowChatFrame({
  runId,
  title = "CAD conversation",
  disabled = false,
  disabledMessage,
}: {
  runId: string | null;
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
      className="h-full min-h-[420px] w-full bg-black"
      allow="clipboard-write"
    />
  );
}
