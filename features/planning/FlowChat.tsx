import { FLOW_MODEL } from "@/lib/config";
import { FLOW_EMBED_BASE } from "@/lib/env";

/*
  A Flow conversation, embedded. The iframe owns streaming, markdown and the
  composer; the shared Facture session cookie signs it in. The first two
  messages (the greeting and this app's opening turn) are hidden.
*/
export default function FlowChat({ runId, title }: { runId: string; title: string }) {
  const params = new URLSearchParams({
    run: runId,
    model: FLOW_MODEL,
    showTitle: "0",
    showIntro: "0",
    hideMessages: "2",
  });
  return (
    <iframe
      title={title}
      src={`${FLOW_EMBED_BASE}?${params}`}
      className="h-full min-h-[420px] w-full flex-1 bg-black"
      allow="clipboard-write"
    />
  );
}
