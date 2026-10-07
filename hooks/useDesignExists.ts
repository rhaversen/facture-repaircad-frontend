"use client";

import { useEffect, useState } from "react";

import type { ForgePhase } from "@/lib/types";

/*
  Screen-6 entry check: on mount it rehydrates any persisted design or
  variant set for this run (localStorage, else server-side recovery) — an
  existing design renders immediately with no LLM call. With autoGenerate
  there is nothing to restore either, the page generates the models itself;
  without it the UI falls back to the explicit Generate button.

    checking — the existence check (or the auto-generate it triggered) runs
    exists   — a design was restored and is being rendered
    missing  — nothing was persisted and no auto-generate is armed; the UI
               must ask the user to generate
*/
export function useDesignExists({
  phase,
  rehydrate,
  reset,
  runId,
  handoffs,
  autoGenerate = false,
  generate,
}: {
  phase: ForgePhase;
  rehydrate: (args: {
    runId: string | null;
    handoffs: string[];
  }) => Promise<boolean>;
  reset: () => void;
  runId: string | null;
  handoffs: string[];
  autoGenerate?: boolean;
  generate: (args: { handoffs: string[]; runId: string | null }) => Promise<void>;
}) {
  const [state, setState] = useState<"checking" | "exists" | "missing">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;
    /*
      StrictMode remounts immediately after the first mount (mount → cleanup
      → mount). Starting on a macrotask lets the first cleanup cancel the
      pending start, so the check — and anything downstream of it — only ever
      runs once; a real unmount also cancels the timer and resets.
    */
    const timer = setTimeout(() => {
      rehydrate({ runId, handoffs }).then((restored) => {
        if (cancelled) return;
        if (restored) {
          setState("exists");
        } else if (autoGenerate) {
          // Nothing to restore on an armed live run: generate the models
          // right away (the double-fire risk during StrictMode remounts is
          // absorbed by generate()'s busy lock). Staying in "checking" lets
          // the generating page render as soon as the phase leaves idle.
          void generate({ handoffs, runId });
        } else {
          // Nothing was restored: return the hook to idle so the UI offers
          // an explicit Generate button instead of auto-generating.
          reset();
          setState("missing");
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      reset();
    };
    // Runs once per mount — the entry check must not restart mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    "checking"/"missing" only gate the UI while the hook state is the sole
    authority. As soon as the flow reports progress through its own phase —
    including parking in "choosing" — the normal screen must render, or the
    picker would be stuck behind this check forever.
  */
  const overriding = state === "checking" || state === "missing";
  if (overriding) {
    const active =
      phase === "initializing" ||
      phase === "choosing" ||
      phase === "calibrating" ||
      phase === "finalizing" ||
      phase === "ready" ||
      phase === "error";
    if (active) {
      return { checking: false, exists: true, missing: false };
    }
  }

  return {
    checking: state === "checking",
    exists: state === "exists",
    missing: state === "missing",
  };
}
