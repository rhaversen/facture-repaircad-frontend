"use client";

import { useRef, useState } from "react";

import {
  createRun as apiCreateRun,
  fetchMessages,
  fetchRun,
  fetchRuns,
  postMessage,
  type TurnResponse,
} from "@/lib/flowApi";
import type { FlowMessage, FlowRun, RunningDoc } from "@/lib/types";

const POLL_INTERVAL_MS = 4000;
// A turn is waited out for up to a day: long pipelines and Forge render turns
// can run for many minutes.
const POLL_ITERATIONS = 21600;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SubmitIntakeArgs {
  intakeMessage: string;
  photos: { id: string; file: File }[];
  annotatedCopies: Record<string, { file: File } | undefined>;
}

export interface SubmitClarificationArgs {
  /** Fully built clarification message (text + annotation summary). */
  message: string;
  photos: { id: string; file: File }[];
  annotatedCopies?: Record<string, { file: File } | undefined>;
}

/**
  Owns the active RepairCAD pipeline run: fetching it, listing runs, creating
  and selecting runs, submitting intake/clarification turns, and reconciling
  run state from the server. Turn responses follow two backend contract
  shapes: a synchronous reply carries the full conversation, while the
  fire-and-forget contract returns the run only — the transcript is then
  polled until the run leaves "running".
*/
export function useRepairRun({ accessToken }: { accessToken: string | null }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [messages, setMessages] = useState<FlowMessage[]>([]);
  const [runningDoc, setRunningDoc] = useState<RunningDoc>({});

  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");

  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [creatingRun, setCreatingRun] = useState(false);
  const [createError, setCreateError] = useState("");
  const [selectingRun, setSelectingRun] = useState(false);
  const [selectError, setSelectError] = useState("");

  // Shared mutable view of state for async code paths that must not depend on
  // stale closures.
  const stateRef = useRef({ accessToken, runId });
  stateRef.current = { accessToken, runId };

  async function applyTurnResponse(response: TurnResponse, activeRunId: string) {
    if (Array.isArray(response.messages)) {
      setRun(response.run ?? null);
      setMessages(response.messages);
      setRunningDoc(response.run?.runningDoc ?? {});
      return response;
    }
    await pollUntilIdle(activeRunId);
    return response;
  }

  async function pollUntilIdle(activeRunId: string): Promise<boolean> {
    const token = stateRef.current.accessToken;
    if (!token) return false;
    for (let i = 0; i < POLL_ITERATIONS; i++) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const [updated, loadedMessages] = await Promise.all([
          fetchRun(token, activeRunId),
          fetchMessages(token, activeRunId),
        ]);
        setRun(updated);
        setRunningDoc(updated?.runningDoc ?? {});
        setMessages(loadedMessages);
        if (updated?.status !== "running") {
          return true;
        }
      } catch (e) {
        console.warn("Poll attempt failed:", e);
      }
    }
    return false;
  }

  async function listRuns(): Promise<FlowRun[] | null> {
    const token = stateRef.current.accessToken;
    if (!token) return null;
    setRunsLoading(true);
    setRunsError("");
    try {
      const pipelineRuns = await fetchRuns(token);
      setRuns(pipelineRuns);
      return pipelineRuns;
    } catch (error) {
      console.error("Could not load runs:", error);
      setRunsError("Could not load your runs. Please try again.");
      return null;
    } finally {
      setRunsLoading(false);
    }
  }

  async function createRun(): Promise<FlowRun> {
    const token = stateRef.current.accessToken;
    if (!token) throw new Error("Missing access token");
    setCreatingRun(true);
    setCreateError("");
    try {
      const created = await apiCreateRun(token);
      setRunId(created._id);
      setRun(created);
      setMessages([]);
      setRunningDoc({});
      return created;
    } catch (error) {
      console.error("Could not create run:", error);
      setCreateError("Could not start a new run. Please try again.");
      throw error;
    } finally {
      setCreatingRun(false);
    }
  }

  async function selectRun(runIdToSelect: string): Promise<{
    run: FlowRun;
    messages: FlowMessage[];
  }> {
    const token = stateRef.current.accessToken;
    if (!token) throw new Error("Missing access token");
    setSelectingRun(true);
    setSelectError("");
    try {
      const [selectedRun, loadedMessages] = await Promise.all([
        fetchRun(token, runIdToSelect),
        fetchMessages(token, runIdToSelect),
      ]);
      setRunId(runIdToSelect);
      setRun(selectedRun);
      setRunningDoc(selectedRun?.runningDoc ?? {});
      setMessages(loadedMessages);
      return { run: selectedRun, messages: loadedMessages };
    } catch (error) {
      console.error("Could not open run:", error);
      setSelectError("Could not open that run. Please try again.");
      throw error;
    } finally {
      setSelectingRun(false);
    }
  }

  async function submitIntake({
    intakeMessage,
    photos,
    annotatedCopies,
  }: SubmitIntakeArgs) {
    const token = stateRef.current.accessToken;
    if (!token) throw new Error("Missing access token");
    setSubmitting(true);
    setSubmissionError("");
    try {
      // Attach to the run created via "New run" when one is active; otherwise
      // create it here so intake can also start on its own.
      let activeRunId = stateRef.current.runId;
      if (!activeRunId) {
        const created = await apiCreateRun(token);
        activeRunId = created._id;
        setRunId(activeRunId);
        stateRef.current.runId = activeRunId;
      }

      const files = photos
        .map((photo) => annotatedCopies[photo.id]?.file ?? photo.file)
        .filter((file): file is File => file !== undefined);

      const response = await postMessage(token, activeRunId, intakeMessage, files);
      return await applyTurnResponse(response, activeRunId);
    } catch (error) {
      console.error("RepairCAD intake submission failed:", error);
      setSubmissionError(
        "RepairCAD could not process the intake. Please try again.",
      );
      throw error;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitClarification({
    message,
    photos,
    annotatedCopies,
  }: SubmitClarificationArgs) {
    const token = stateRef.current.accessToken;
    const activeRunId = stateRef.current.runId;
    if (!token || !activeRunId) return null;
    if (!message.trim() && photos.length === 0) return null;

    try {
      const files = photos
        .map((photo) => annotatedCopies?.[photo.id]?.file ?? photo.file)
        .filter((file): file is File => file !== undefined);

      const response = await postMessage(token, activeRunId, message, files);
      return await applyTurnResponse(response, activeRunId);
    } catch (error) {
      console.error("RepairCAD clarification submission failed:", error);
      await reconcileRun();
      throw error;
    }
  }

  /** Send a plain chat turn. Only used outside the embed flows. */
  async function sendMessage(content: string): Promise<TurnResponse | null> {
    const token = stateRef.current.accessToken;
    const activeRunId = stateRef.current.runId;
    if (!token || !activeRunId || !content.trim()) return null;

    try {
      const response = await postMessage(token, activeRunId, content.trim());
      return await applyTurnResponse(response, activeRunId);
    } catch (error) {
      const httpStatus = (error as { response?: { status?: number } })?.response
        ?.status;
      const isProxyTimeout = httpStatus === 524 || httpStatus === 504;

      if (isProxyTimeout) {
        // Cloudflare 524/504: the proxy gave up but the backend keeps
        // running. Poll until the agent loop finishes.
        const resolved = await pollUntilIdle(activeRunId);
        if (resolved) return null;
      }

      await reconcileRun();
      throw error;
    }
  }

  /** Re-fetch the run + its messages from the server. Best-effort recovery:
   *  used when a turn response was lost (timeout / 524 / 400 on completed). */
  async function reconcileRun(): Promise<void> {
    const token = stateRef.current.accessToken;
    if (!token) return;
    try {
      let activeRunId = stateRef.current.runId;

      if (!activeRunId) {
        const pipelineRuns = await fetchRuns(token);
        if (pipelineRuns.length === 0) return;

        // An intake POST that failed after creating the run leaves an empty
        // run behind; don't recover onto one — fall back to the latest run
        // that produced its handoff document.
        activeRunId = pipelineRuns[0]._id;
        const newestMessages = await fetchMessages(token, activeRunId).catch(
          () => null,
        );
        const newestIsEmpty =
          newestMessages === null || newestMessages.length === 0;
        if (newestIsEmpty) {
          const finished = pipelineRuns.find(
            (candidate) =>
              (candidate.runningDoc?.provisional_cad_handoff ?? "").trim() !==
              "",
          );
          if (finished !== undefined && finished._id !== activeRunId) {
            activeRunId = finished._id;
          }
        }
        setRunId(activeRunId);
        stateRef.current.runId = activeRunId;
      }

      const [updated, loadedMessages] = await Promise.all([
        fetchRun(token, activeRunId),
        fetchMessages(token, activeRunId),
      ]);
      setRun(updated);
      setRunningDoc(updated?.runningDoc ?? {});
      setMessages(loadedMessages);
    } catch (e) {
      console.error("Could not reconcile run state:", e);
    }
  }

  // In-flight + coalescing guards: overlapping calls collapse into the
  // running one, so effect re-fires from identity churn are no-ops.
  const reconcileInFlightRef = useRef<Promise<void> | null>(null);

  async function reconcileRunGuarded(): Promise<void> {
    if (reconcileInFlightRef.current !== null) {
      return reconcileInFlightRef.current;
    }
    reconcileInFlightRef.current = reconcileRun().finally(() => {
      reconcileInFlightRef.current = null;
    });
    return reconcileInFlightRef.current;
  }

  return {
    runId,
    run,
    messages,
    runningDoc,
    runs,
    runsLoading,
    runsError,
    creatingRun,
    createError,
    selectingRun,
    selectError,
    submitting,
    submissionError,
    submitIntake,
    sendMessage,
    submitClarification,
    listRuns,
    createRun,
    selectRun,
    reconcileRun: reconcileRunGuarded,
  };
}
