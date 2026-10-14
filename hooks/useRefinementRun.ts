"use client";

import { useCallback, useRef, useState } from "react";

import {
  createRefinementRun,
  fetchRun,
  postMessage,
} from "@/lib/flowApi";
import type { FlowRun, RunningDoc } from "@/lib/types";

/*
  Creates the second Flow run used only for CAD refinement. The run is seeded
  once the provisional Forge design exists, so the refinement agent receives
  both the repair handoff and the exact Forge design it should work with.

  The bootstrap context is currently sent as the first user message because
  the public Flow API exposes run creation + messages, but no separate hidden
  context field. If Flow later adds a hidden run-context/handoff API, this is
  the one place that should be swapped over to it.
*/
export function useRefinementRun() {
  const [runId, setRunId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<FlowRun | null>(null);
  const [runningDoc, setRunningDoc] = useState<RunningDoc>({});
  const [sending, setSending] = useState(false);

  const initializationKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const runIdRef = useRef<string | null>(null);

  const initialize = useCallback(
    async ({
      handoffMarkdown,
      designId,
    }: {
      handoffMarkdown: string;
      designId: string;
    }): Promise<string | null> => {
      if (!handoffMarkdown?.trim() || !designId) {
        return null;
      }

      const key = `${designId}:${handoffMarkdown.length}`;
      if (initializationKeyRef.current === key && runIdRef.current) {
        return runIdRef.current;
      }
      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      setInitializing(true);
      setError("");

      const work = (async () => {
        try {
          const created = await createRefinementRun();
          const createdRunId = created?._id;
          if (!createdRunId) {
            throw new Error("Flow did not return a refinement run ID.");
          }

          const bootstrapMessage = [
            "# Role",
            "",
            "You refine the existing Forge CAD design for this repair — you never create a replacement design for it.",
            "",
            "# Bootstrap — initialization payload, not a request",
            "",
            "This is a machine-sent setup payload, not a user request. Record it silently in your persistent state — the active design id and the repair requirements below — and do not reply to it. Do not acknowledge this message: no confirmation, preamble, status update, initiative, or summary in response to it.",
            "",
            `CURRENT FORGE DESIGN ID: ${designId}`,
            "Use this id as the target for every instruction you issue; if asked to look up the active design, your answer is this id. If you are later asked to produce the id, cite it verbatim.",
            "",
            "# Repair requirements (authoritative)",
            "",
            handoffMarkdown.trim(),
            "",
            "# Responding to user requests",
            "",
            "For a design change, reply with one short line of what you did, then a forge_instruction targeting the active design. Never target a different design, and only produce replacement-plan output if the user explicitly asks.",
            "Never narrate reading or reproducing the requirements above — that is context, not content to echo.",
          ].join("\n");

          const response = await postMessage(
            createdRunId,
            bootstrapMessage,
          );

          setRun(response.run ?? null);
          setRunningDoc(response.run?.runningDoc ?? {});

          initializationKeyRef.current = key;
          runIdRef.current = createdRunId;
          setRunId(createdRunId);

          return createdRunId;
        } catch (err) {
          console.error("Could not initialize CAD refinement run:", err);
          setError(
            (err as { response?: { data?: { error?: string } } })?.response?.data
              ?.error ??
              (err instanceof Error ? err.message : "") ??
              "Could not start the CAD refinement assistant.",
          );
          throw err;
        } finally {
          setInitializing(false);
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = work;
      return work;
    },
    [],
  );

  const reconcile = useCallback(
    async (): Promise<FlowRun | null> => {
      if (!runIdRef.current) {
        return null;
      }
      try {
        // Fetch this run directly: fetchRuns() filters out runs from any
        // pipeline other than the RepairCAD intake pipeline, so the
        // AfterForge refinement run (and its forge_instruction) would be
        // invisible there.
        const latestRun = await fetchRun(runIdRef.current);
        setRun(latestRun);
        setRunningDoc(latestRun.runningDoc ?? {});
        return latestRun;
      } catch (err) {
        console.error("Could not reconcile refinement run:", err);
        return null;
      }
    },
    [],
  );

  /*
    Send a user chat turn to the refinement run. The refinement agent (R3)
    translates the message into forge_instruction output, which the CAD
    screen picks up via reconcile() and forwards to Forge.
  */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!runIdRef.current || !content?.trim()) {
        throw new Error("Refinement run is not ready.");
      }
      setSending(true);
      try {
        await postMessage(runIdRef.current, content.trim());
        await reconcile();
      } catch (err) {
        console.error("Could not send refinement message:", err);
        throw err;
      } finally {
        setSending(false);
      }
    },
    [reconcile],
  );

  return {
    runId,
    run,
    runningDoc,
    initializing,
    error,
    sending,
    initialize,
    reconcile,
    sendMessage,
  };
}
