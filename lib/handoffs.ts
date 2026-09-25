import type { RunningDoc } from "./types";

export const HANDOFF_FIELDS = [
  "forge_handoff_1",
  "forge_handoff_2",
  "forge_handoff_3",
] as const;

/**
  Collect the handoff documents the pipeline supplied, in variant order.
  Any count is valid — the Forge design count follows the pipeline, not a
  config constant. Empty/missing fields are skipped.
*/
export function collectHandoffs(runningDoc: RunningDoc | undefined | null): string[] {
  if (!runningDoc) return [];
  const handoffs: string[] = [];
  for (const field of HANDOFF_FIELDS) {
    const value = runningDoc[field];
    if (typeof value === "string" && value.trim() !== "") {
      handoffs.push(value.trim());
    }
  }
  return handoffs;
}

export function handoffsReady(
  runningDoc: RunningDoc | undefined | null,
): boolean {
  return collectHandoffs(runningDoc).length > 0;
}
