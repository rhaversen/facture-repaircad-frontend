"use client";

import { useEffect, useState } from "react";

import type { ForgePhase } from "@/lib/types";

/*
  Screen-6 entry check: the generating page never kicks off a Forge
  generation on its own. On mount it rehydrates any persisted design or
  variant set for this run (localStorage, else server-side recovery) — an
  existing design renders immediately with no LLM call.

    checking — the existence check is still running
    exists   — a design was restored and is being rendered
    missing  — nothing was persisted; the UI must ask the user to generate
*/
export function useDesignExists({
  phase,
  rehydrate,
  reset,
  accessToken,
  runId,
  handoffMarkdown,
}: {
  phase: ForgePhase;
  rehydrate: (args: {
    accessToken: string;
    runId: string | null;
    handoffMarkdown: string;
  }) => Promise<boolean>;
  reset: () => void;
  accessToken: string;
  runId: string | null;
  handoffMarkdown: string;
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
      rehydrate({ accessToken, runId, handoffMarkdown }).then((restored) => {
        if (cancelled) return;
        if (restored) {
          setState("exists");
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
