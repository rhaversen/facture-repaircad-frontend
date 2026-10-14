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
  /**
   * designId → index into the run's handoff document array. Generated for
   * the picker run; the refinement bootstrap needs the picked variant's
   * handoff, so a refresh/picker-reopen that had no explicit handoff falls
   * back to `variantHandoffs[designId]` → index.
   */
  variantHandoffs?: Record<string, number>;
  /** Index of the picked design's handoff (same space as variantHandoffs). */
  handoffIndex?: number;
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
  if (
    entry.variantHandoffs !== undefined &&
    (typeof entry.variantHandoffs !== "object" ||
        entry.variantHandoffs === null ||
        Array.isArray(entry.variantHandoffs) ||
        Object.values(entry.variantHandoffs).some(
          (v) => typeof v !== "number" || !Number.isInteger(v) || v < 0,
        ))
    ) {
      return null;
    }
  if (
    entry.handoffIndex !== undefined &&
    (typeof entry.handoffIndex !== "number" ||
      !Number.isInteger(entry.handoffIndex) ||
      entry.handoffIndex < 0)
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

// Metadata written once a set of variants is known (their ids and the
// handoff index each one was generated from) outlives phase updates the
// same way the design id does — a later write must not drop it out of a
// live entry.
function storeSameRunVariants(
  entry: StoredDesignState,
  preserved?: StoredDesignState,
): StoredDesignState {
  let next = entry;
  if (next.variantDesignIds === undefined && preserved?.variantDesignIds) {
    next = { ...next, variantDesignIds: preserved.variantDesignIds };
  }
  if (next.variantHandoffs === undefined && preserved?.variantHandoffs) {
    next = { ...next, variantHandoffs: preserved.variantHandoffs };
  }
  // handoffIndex follows the picked design across later phase writes (a
  // refinement copy inherits its source design's handoff), so an entry that
  // omits it keeps the previously stored one.
  if (next.handoffIndex === undefined && preserved?.handoffIndex !== undefined) {
    next = { ...next, handoffIndex: preserved.handoffIndex };
  }
  return next;
}

export function storeDesignState(runId: string | null, entry: StoredDesignState) {
  if (!runId) return;
  const store = readDesignStore();
  store[runId] = storeSameRunVariants(entry, store[runId]);
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
