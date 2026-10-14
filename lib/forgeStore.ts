/*
  Run → design persistence. Each run entry is just the current selection:
  the design the user settled on, which phase of the CAD workspace it is in,
  and the variant ids that were generated for the run — the candidates also
  stay recorded after a pick so the picker can be reopened any time with the
  original set. A finished (or in-progress) calibration can be rehydrated
  from the persisted Forge design — GET /designs/:id/mesh re-renders the
  stored model, and confirmed parameter values are PATCHed to Forge the
  moment each one is confirmed (not batched at finish) — so a page refresh
  or run re-entry never pays for a new LLM generation and never loses a
  confirmed measurement. A "choosing" entry stores the variant ids, so a
  refresh while the picker is open re-renders them (no LLM call) and
  reopens the picker. Entries survive navigation and refresh in the same
  browser; anything that fails to rehydrate (deleted design, other user's
  token) is dropped and the flow falls back to full generation.
*/
export const DESIGN_STORE_KEY = "repaircad.forgeDesigns";

export interface StoredDesignState {
  designId?: string;
  phase: string;
  variantDesignIds?: string[];
}

function readDesignStore(): Record<string, StoredDesignState> {
  try {
    const raw = window.localStorage.getItem(DESIGN_STORE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDesignStore(store: Record<string, StoredDesignState>) {
  try {
    window.localStorage.setItem(DESIGN_STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota/private-mode failures only cost rehydration, never correctness.
  }
}

export function loadStoredDesignState(runId: string | null): StoredDesignState | null {
  if (!runId) return null;
  const entry = readDesignStore()[runId];
  if (entry === undefined || typeof entry.phase !== "string") {
    return null;
  }
  if (typeof entry.designId !== "undefined" && typeof entry.designId !== "string") {
    return null;
  }
  if (
    entry.variantDesignIds !== undefined &&
    (!Array.isArray(entry.variantDesignIds) ||
      !entry.variantDesignIds.every((id) => typeof id === "string"))
  ) {
    return null;
  }
  if (entry.phase === "choosing") {
    if (
      !Array.isArray(entry.variantDesignIds) ||
      entry.variantDesignIds.length === 0
    ) {
      return null;
    }
    return entry;
  }
  if (typeof entry.designId !== "string") {
    return null;
  }
  return entry;
}

export function storeDesignState(runId: string | null, entry: StoredDesignState) {
  if (!runId) return;
  const store = readDesignStore();
  // Variant ids are written once the candidates are known and kept forever
  // after a pick — they are what lets the picker be reopened with the run's
  // original candidates, so later phase writes must not drop them.
  if (entry.variantDesignIds === undefined && store[runId]?.variantDesignIds) {
    entry = { ...entry, variantDesignIds: store[runId].variantDesignIds };
  }
  store[runId] = entry;
  writeDesignStore(store);
}

export function clearStoredDesignState(runId: string | null) {
  if (!runId) return;
  const store = readDesignStore();
  delete store[runId];
  writeDesignStore(store);
}

/**
 * Persistent AfterForge refinement (stage-6) run per repair run, so
 * revisiting the CAD workspace resumes the same conversation instead of
 * bootstrapping a new run. `guidanceGenerated` flips once the running doc
 * holds final repair guidance — re-entering after that starts a fresh
 * refinement run (a new round over the finalized design).
 */
export const REFINEMENT_STORE_KEY = "repaircad.refinementRuns";

export interface RefinementPersist {
  runId: string;
  guidanceGenerated: boolean;
}

function readRefinementStore(): Record<string, RefinementPersist> {
  const raw = localStorage.getItem(REFINEMENT_STORE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function loadRefinementState(runId: string): RefinementPersist | null {
  const stored = readRefinementStore()[runId];
  return stored && typeof stored.runId === "string" ? stored : null;
}

export function storeRefinementState(
  runId: string,
  state: RefinementPersist,
): void {
  const stored = readRefinementStore();
  stored[runId] = state;
  localStorage.setItem(REFINEMENT_STORE_KEY, JSON.stringify(stored));
}
