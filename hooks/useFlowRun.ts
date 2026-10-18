"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchMessages, fetchRun } from "@/lib/flow";
import type { FlowRun } from "@/lib/types";

const POLL_MS = 3000;

async function load(runId: string) {
  const run = await fetchRun(runId);
  if (run === null) return null;
  // Only a run the pipeline has not touched yet needs its transcript: there
  // it alone tells an unsent intake from a sent one.
  const untouched = Object.keys(run.runningDoc ?? {}).length === 0;
  const hasUserTurn = !untouched || (await fetchMessages(runId)).some((m) => m.role === "user");
  return { run, hasUserTurn };
}

/*
  A Flow run kept current: fetched on mount, re-fetched every few seconds
  while a turn is running (or the last fetch failed), and whenever an
  embedded chat for it reports a status change, since the embed starts turns
  this app never sees otherwise. `refresh` is for callers that just started
  a turn themselves.
*/
export function useFlowRun(runId: string | null) {
  const [state, setState] = useState<{ run: FlowRun; hasUserTurn: boolean } | null>(null);
  // The id of a run the server says does not exist.
  const [missingId, setMissingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (runId === null) return;
    try {
      const next = await load(runId);
      if (next === null) setMissingId(runId);
      else setState(next);
      setError("");
    } catch (err) {
      console.error("Could not load run:", err);
      setError("Could not load this repair. Retrying…");
    }
  }, [runId]);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    function onEmbedMessage(event: MessageEvent) {
      if (event.data?.source === "flow-embed" && event.data.runId === runId) void refresh();
    }
    window.addEventListener("message", onEmbedMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onEmbedMessage);
    };
  }, [runId, refresh]);

  // A run fetched for another id is never handed out.
  const run = state !== null && state.run._id === runId ? state.run : null;
  const missing = runId !== null && missingId === runId;
  const running = run?.status === "running";
  useEffect(() => {
    if (missing || (!running && !error)) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [missing, running, error, refresh]);

  return { run, missing, hasUserTurn: state?.hasUserTurn ?? false, error, refresh };
}
