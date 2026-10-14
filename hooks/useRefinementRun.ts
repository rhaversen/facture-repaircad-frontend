"use client";

import { useCallback, useRef, useState } from "react";

import {
  createRefinementRun,
  fetchRun,
  postMessage,
} from "@/lib/flowApi";
import {
  loadRefinementState,
  storeRefinementState,
} from "@/lib/forgeStore";
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
export interface RefinementRun {
  runId: string | null;
  run: FlowRun | null;
  runningDoc: RunningDoc;
  initializing: boolean;
  error: string;
  sending: boolean;
  /**
   * Initialize the refinement run for this repair run: restore the
   * persisted run if one exists (no bootstrap message), or create + seed
   * a new one. Once final repair guidance has been produced the stored
   * run is spent — re-entering creates a fresh run for a new round.
   * Returns the run id, or null while inputs are missing or on failure.
   */
  initialize: (
    handoffMarkdown: string,
    designId: string,
    runKey: string,
    options?: {
      /** Fabrication/design intent from the main run's running doc. */
      designIntent?: string;
      /** The handoff variant the picked design came from, e.g.
       *  "forge_handoff_2" — omitted when unknown. */
      handoffVariant?: string;
    },
  ) => Promise<string | null>;
  /** Poll the run to keep `run`/`runningDoc` current; also persists the
      "final guidance exists" flag that drives the re-entry rule. */
  reconcile: () => Promise<FlowRun | null>;
  /** Send a user chat turn; resolves once the turn is posted + re-polled. */
  sendMessage: (content: string) => Promise<void>;
}

export function useRefinementRun(): RefinementRun {
  const [runId, setRunId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<FlowRun | null>(null);
  const [runningDoc, setRunningDoc] = useState<RunningDoc>({});
  const [sending, setSending] = useState(false);

  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const runIdRef = useRef<string | null>(null);
  /** Main repair-run id the persistence entry is keyed by. */
  const runKeyRef = useRef<string | null>(null);
  /** Whether the "final guidance exists" flag is already persisted, so the
      2s polling reconcile doesn't rewrite storage on every tick. */
  const guidanceFlaggedRef = useRef(false);

  const initialize = useCallback(
    async (
      handoffMarkdown: string,
      designId: string,
      runKey: string,
      options?: {
        designIntent?: string;
        handoffVariant?: string;
      },
    ): Promise<string | null> => {
      if (!handoffMarkdown?.trim() || !designId || !runKey) {
        return null;
      }

      /* Single-flight guard: effects fire this on every mount, and
         concurrent calls share one in-flight bootstrap. */
      if (inFlightRef.current) {
        return inFlightRef.current;
      }
      if (runKeyRef.current && runKeyRef.current !== runKey) {
        /* The main run switched (screen remounts with a different run id):
           start a blank view before the persistence lookup for the new key. */
        runIdRef.current = null;
        setRunId(null);
        setRun(null);
        setRunningDoc({});
        guidanceFlaggedRef.current = false;
      }
      runKeyRef.current = runKey;

      /* Same-session re-fire (an effect re-running while this view is
         mounted): a run for this key is already active — return it
         untouched. Never spend or re-seed a live run just because a
         re-render retried initialization. Fresh entry arrives with a
         null runIdRef: a remount, or the run-switch reset above — and
         follows the resume/create paths below, where the spent-round
         rule ("guidance exists → new run") still applies. */
      if (runIdRef.current) {
        return runIdRef.current;
      }

      setInitializing(true);
      setError("");

      const work = (async () => {
        try {
          /* Resume path: a refinement run was already bootstrapped for
             this repair run and this round has not produced final
             guidance yet — the same conversation continues, so fetch it
             without replaying the bootstrap. The run is gone on the API,
             or it did produce guidance (that round is over), so fall
             through to recreation. */
          const stored = loadRefinementState(runKey);
          if (stored && !stored.guidanceGenerated) {
            let resumedId: string | null = null;
            try {
              const fetched = await fetchRun(stored.runId);
              if (Boolean(fetched.runningDoc?.final_guidance?.trim())) {
                storeRefinementState(runKey, {
                  runId: fetched._id,
                  guidanceGenerated: true,
                });
              } else {
                runIdRef.current = stored.runId;
                setRunId(stored.runId);
                setRun(fetched);
                setRunningDoc(fetched.runningDoc ?? {});
                guidanceFlaggedRef.current = false;
                resumedId = stored.runId;
              }
            } catch {
              /* Run no longer exists on the API — recreate below. */
            }
            if (resumedId) {
              return resumedId;
            }
          }

          const created = await createRefinementRun();
          const createdRunId = created?._id;
          if (!createdRunId) {
            throw new Error("Flow did not return a refinement run ID.");
          }

          const intent = options?.designIntent?.trim() ?? "";
          const handoffVariant = options?.handoffVariant?.trim() ?? "";

          const sections: string[] = [
            "# Setup — initialization payload, not user text",
            "",
            "This is a machine-sent bootstrap payload, not a user refinement " +
              "request. Record it into your persistent state and do not reply " +
              "to it: no acknowledgement, clarification question, Forge " +
              "instruction, or fabrication/assembly guidance in response. Do " +
              "not alter the selected repair strategy, confirmed repair " +
              "constraints, fabrication process, material strategy, required " +
              "part decomposition, assembly strategy, or form-integration " +
              "intent, and do not rephrase or rewrite any of the sections " +
              "below.",
            "",
            "If you are asked which design this round is anchored to, cite the " +
              "id below verbatim.",
            "",
            `CURRENT FORGE DESIGN ID: ${designId}`,
          ];
          if (handoffVariant) {
            sections.push(
              `HANDOFF VARIANT: ${handoffVariant}`,
            );
          }
          if (intent) {
            sections.push(
              "",
              "# Fabrication design intent",
              "",
              intent,
            );
          }
          sections.push(
            "",
            "# Selected Forge handoff",
            "",
            handoffMarkdown.trim(),
            "",
            "# Later refinement messages",
            "",
            "Subsequent user messages are refinement feedback routed through " +
              "the pipeline stages. Do not treat this bootstrap as user " +
              "refinement and do not narrate the sections above when the " +
              "later user turns arrive.",
          );

          const bootstrapMessage = sections.join("\n");

          const response = await postMessage(
            createdRunId,
            bootstrapMessage,
          );

          setRun(response.run ?? null);
          setRunningDoc(response.run?.runningDoc ?? {});

          runIdRef.current = createdRunId;
          setRunId(createdRunId);
          guidanceFlaggedRef.current = false;
          storeRefinementState(runKey, {
            runId: createdRunId,
            guidanceGenerated: false,
          });

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
        const hasGuidance = Boolean(
          latestRun.runningDoc?.final_guidance?.trim(),
        );
        /* Remember that this round is finished: the next time this repair
           run's CAD view initializes, it must create a fresh run instead of
           resuming or extending this one. */
        if (hasGuidance && !guidanceFlaggedRef.current && runKeyRef.current) {
          guidanceFlaggedRef.current = true;
          storeRefinementState(runKeyRef.current, {
            runId: runIdRef.current ?? "",
            guidanceGenerated: true,
          });
        } else if (!hasGuidance) {
          guidanceFlaggedRef.current = false;
        }
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
