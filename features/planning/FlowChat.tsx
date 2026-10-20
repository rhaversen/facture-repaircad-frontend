"use client";

import { useEffect, useRef } from "react";

import { FLOW_MODEL } from "@/lib/config";
import { FLOW_EMBED_BASE } from "@/lib/env";

/*
  A Flow conversation, embedded. The iframe owns streaming, markdown and the
  composer; the shared Facture session cookie signs it in. The first two
  messages (the greeting and this app's opening turn) are hidden unless the
  host says how many to hide.
  `composerHidden` takes the composer away without reloading the frame: it is
  posted on every change and again whenever the frame reports it is ready.
*/
export default function FlowChat({
  runId,
  title,
  hideMessages = 2,
  composerHidden = false,
}: {
  runId: string;
  title: string;
  hideMessages?: number;
  composerHidden?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const params = new URLSearchParams({
    run: runId,
    model: FLOW_MODEL,
    showTitle: "0",
    showIntro: "0",
    hideMessages: String(hideMessages),
  });

  useEffect(() => {
    const post = () =>
      frame.current?.contentWindow?.postMessage(
        { source: "flow-host", type: "composer", hidden: composerHidden },
        new URL(FLOW_EMBED_BASE, window.location.href).origin,
      );
    post();
    function onEmbedMessage(event: MessageEvent) {
      if (event.source === frame.current?.contentWindow && event.data?.type === "ready") post();
    }
    window.addEventListener("message", onEmbedMessage);
    return () => window.removeEventListener("message", onEmbedMessage);
  }, [composerHidden]);

  return (
    <iframe
      ref={frame}
      title={title}
      src={`${FLOW_EMBED_BASE}?${params}`}
      className="h-full min-h-[420px] w-full flex-1 bg-black"
      allow="clipboard-write"
    />
  );
}
