import { fetchMessages, fetchRuns } from "./flowApi";
import { refinementPipelineId } from "./pipeline";

const DESIGN_ID_MARKER = "CURRENT FORGE DESIGN ID:";

function messageText(message: {
  content: string | { type: string; text?: string }[] | undefined;
}): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

function extractDesignId(text: string): string | null {
  const markerIndex = text.indexOf(DESIGN_ID_MARKER);
  if (markerIndex === -1) return null;
  const rest = text.slice(markerIndex + DESIGN_ID_MARKER.length);
  // Id runs to end of line; trim stray markdown backticks/whitespace.
  const line = rest.split("\n", 1)[0].replace(/[`*]/g, "").trim();
  return /^[a-f0-9]{24}$/i.test(line) ? line : null;
}

/**
  Rebuild the run → Forge design mapping from the server after localStorage
  was cleared. The refinement run's bootstrap message (persisted in the Flow
  transcript) embeds both the originating handoff document and the design id,
  so the design a run produced can be found by matching the handoff text.
  Returns the newest matching design id, or null when nothing matches.
*/
export async function recoverDesignIdForRun({
  handoffMarkdown,
}: {
  handoffMarkdown: string;
}): Promise<string | null> {
  const needle = handoffMarkdown?.trim();
  if (!needle) return null;

  let runs;
  try {
    const refinementPipeline = await refinementPipelineId();
    const all = await fetchRuns();
    runs = all.filter(
      (candidate) => candidate.pipelineId === refinementPipeline,
    );
  } catch (err) {
    console.warn("[Forge] design recovery: could not list runs:", err);
    return null;
  }

  // Newest first — the latest refinement run for this handoff is the
  // authoritative design the user was last working with.
  runs.sort((a, b) =>
    String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")),
  );

  for (const candidate of runs) {
    try {
      const messages = await fetchMessages(candidate._id);
      for (const message of messages) {
        const text = messageText(message);
        if (!text.includes(needle)) continue;
        const designId = extractDesignId(text);
        if (designId) return designId;
      }
    } catch (err) {
      // Unreadable run (deleted, forbidden) — keep scanning the rest.
      console.warn("[Forge] design recovery: could not read run messages:", err);
    }
  }

  return null;
}
