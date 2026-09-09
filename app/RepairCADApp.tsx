"use client";

import { useEffect, useRef, useState } from "react";

import RunList from "@/features/runs/RunList";
import DescribeRepair from "@/features/intake/DescribeRepair";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import ReviewIntake from "@/features/intake/ReviewIntake";
import CadModelView from "@/features/forge/CadModelView";
import CaseClarification from "@/features/chat/CaseClarification";
import FlowChatEmbed from "@/features/chat/FlowChatEmbed";
import RepairProgress from "@/components/RepairProgress";
import { useRepairRun } from "@/hooks/useRepairRun";
import { useIntake } from "@/hooks/useIntake";
import { authUrl, getMe, logout } from "@/lib/auth";
import { buildIntakeMessage, buildClarificationAnnotations } from "@/lib/intakeMessageUtils";
import {
  deriveScreen,
  handoffReadyFor,
  screenForSelectedRun,
} from "@/lib/runProgress";
import { s2NodeId } from "@/lib/pipeline";

/*
  Screen ids: 7 run list (home), 1-4 intake wizard, 5 conversation, 6 CAD.
  The rendered screen is DERIVED from run state (conversationReady /
  handoffReady) on top of the user's requestedScreen choice — no jump
  effects. handoffDismissed keeps "Back to chat" sticky until the handoff
  clears, which re-arms the auto-advance.
*/
const RUN_LIST = 7;
const CAD_SCREEN = 6;
const CHAT_SCREEN = 5;

export default function RepairCADApp() {
  /*
    Auth lives in the shared Facture session cookie, so the first client
    render cannot know it yet. A single /auth/me check settles it once; an
    unauthenticated visitor is sent to the central auth page.
  */
  const [authChecked, setAuthChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    getMe().then((user) => {
      if (user === null) {
        window.location.assign(authUrl());
        return;
      }
      setLoggedIn(true);
      setAuthChecked(true);
    });
  }, []);

  const repairRun = useRepairRun();
  const {
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
    submitClarification,
    listRuns,
    createRun,
    selectRun,
    reconcileRun,
  } = repairRun;

  const intake = useIntake();

  // ── Derived screen state ────────────────────────────────────────────────

  const [requestedScreen, setScreen] = useState<number>(RUN_LIST);

  const [s2NodeIdValue, setS2NodeIdValue] = useState<string | null>(null);
  useEffect(() => {
    if (!authChecked || s2NodeIdValue !== null) return;
    s2NodeId()
      .then(setS2NodeIdValue)
      .catch((err) => {
        console.error("Could not resolve pipeline node ids:", err);
      });
  }, [authChecked, s2NodeIdValue]);

  const handoffMarkdown = runningDoc?.provisional_cad_handoff?.trim() ?? "";

  const waitingForCaseClarification =
    run?.status === "idle" &&
    s2NodeIdValue !== null &&
    run?.currentNodeId === s2NodeIdValue;

  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const screen = deriveScreen({
    run,
    messages,
    handoffMarkdown,
    handoffDismissed,
    requestedScreen,
  });

  // Re-arm the CAD auto-advance whenever the handoff clears (e.g. a new
  // turn restarts the pipeline), so the next handoff advances again.
  const [prevHandoffReady, setPrevHandoffReady] = useState(
    handoffReadyFor(run, handoffMarkdown),
  );
  const currentHandoffReady = handoffReadyFor(run, handoffMarkdown);
  if (prevHandoffReady !== currentHandoffReady) {
    setPrevHandoffReady(currentHandoffReady);
    if (!currentHandoffReady) setHandoffDismissed(false);
  }

  // ── Bootstrap + sync effects ────────────────────────────────────────────

  /*
    listRuns/reconcileRun/createRun are plain hook functions with new
    identities every render, so they must never sit in effect dependency
    arrays — that re-fires the effect on every fetch, which updates state,
    which renders again: an infinite loop. Latest-refs keep the effects
    stable while the calls always hit the current closures.
  */
  const listRunsRef = useRef(listRuns);
  const createRunRef = useRef(createRun);
  const reconcileRunRef = useRef(reconcileRun);
  useEffect(() => {
    listRunsRef.current = listRuns;
    createRunRef.current = createRun;
    reconcileRunRef.current = reconcileRun;
  });

  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (!authChecked) return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    listRunsRef.current().then((existing) => {
      if (existing !== null && existing.length === 0) {
        createRunRef.current()
          .then(() => setScreen(1))
          .catch(() => {
            // Error handled in hook; the empty list stays visible.
          });
      }
    });
  }, [authChecked]);

  useEffect(() => {
    if (screen === CHAT_SCREEN) reconcileRunRef.current();
    if (screen === RUN_LIST) listRunsRef.current();
  }, [screen]);

  // Poll while waiting for the pipeline to finish so the derived screen
  // auto-advances to Forge as soon as the handoff document lands.
  useEffect(() => {
    if (
      screen !== CHAT_SCREEN ||
      currentHandoffReady ||
      waitingForCaseClarification
    ) {
      return;
    }
    const interval = setInterval(() => reconcileRunRef.current(), 5000);
    return () => clearInterval(interval);
  }, [screen, currentHandoffReady, waitingForCaseClarification]);

  // The embed reports every status transition; a settled turn is any
  // non-running status (idle or failed) — reconcile on both.
  useEffect(() => {
    function onFlowMessage(event: MessageEvent) {
      if (
        event.source === null ||
        event.data?.source !== "flow-embed" ||
        event.data?.type !== "status"
      ) {
        return;
      }
      if (event.data.status !== "running") {
        reconcileRunRef.current();
      }
    }
    window.addEventListener("message", onFlowMessage);
    return () => window.removeEventListener("message", onFlowMessage);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleCreateRun() {
    try {
      await createRun();
      setScreen(1);
    } catch {
      // Error handled in hook; stay on the list.
    }
  }

  async function handleSelectRun(selectedRunId: string) {
    try {
      const {
        messages: loadedMessages,
        run: loadedRun,
      } = await selectRun(selectedRunId);
      // Clear any earlier dismissal so a completed run still auto-advances.
      setHandoffDismissed(false);
      // Fresh runs are seeded with one assistant greeting, so "no user turn
      // in the transcript" usually means the intake wizard. But a transcript
      // alone cannot decide this: a messages fetch that comes back empty or
      // partial (legacy docs, hiccup) must not dump a progressed run back
      // into intake — runningDoc/status carry the progress signal too.
      setScreen(screenForSelectedRun(loadedRun, loadedMessages));
    } catch {
      // Error handled in hook; stay on the list.
    }
  }

  function handleViewRuns() {
    setScreen(RUN_LIST);
  }

  async function handleLogout() {
    await logout();
    window.location.assign(authUrl());
  }

  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [clarificationError, setClarificationError] = useState("");

  async function handleSubmit(annotatedCopies: Record<string, { file: File; url: string }>) {
    const intakeMessage = buildIntakeMessage({
      description: intake.description,
      photos: intake.photos,
      annotations: intake.annotations,
    });
    try {
      await submitIntake({
        intakeMessage,
        photos: intake.photos,
        annotatedCopies,
      });
      setScreen(CHAT_SCREEN);
    } catch {
      // Error handled in hook; stay on Review so the user can retry.
    }
  }

  async function handleClarificationSubmit(clarification: {
    content: string;
    photos: { id: string; file: File }[];
    annotations: unknown[];
    annotatedCopies: Record<string, { file: File; url: string }>;
  }) {
    setClarificationSubmitting(true);
    setClarificationError("");
    try {
      const annotationLines = buildClarificationAnnotations(
        clarification.photos as never,
        clarification.annotations as never,
      );
      const message =
        [
          clarification.content.trim(),
          ...annotationLines,
        ].filter(Boolean).join("\n\n") ||
        "I have attached the requested clarification photos.";
      await submitClarification({
        message,
        photos: clarification.photos,
        annotatedCopies: clarification.annotatedCopies,
      });
      // Refresh immediately so the derivation sees whether the pipeline
      // proceeds or sends the case back for another clarification round.
      await reconcileRun();
    } catch {
      setClarificationError(
        "RepairCAD could not process the clarification. Please try again.",
      );
    } finally {
      setClarificationSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (!authChecked || !loggedIn) {
    return null;
  }

  const activeRunId = runId ?? run?._id ?? null;

  if (screen === RUN_LIST) {
    return (
      <RunList
        runs={runs}
        loading={runsLoading}
        error={runsError}
        creating={creatingRun}
        createError={createError}
        selecting={selectingRun}
        selectError={selectError}
        onCreateRun={handleCreateRun}
        onSelectRun={handleSelectRun}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === 1) {
    return (
      <DescribeRepair
        description={intake.description}
        onDescriptionChange={intake.setDescription}
        photos={intake.photos}
        onAddPhotos={intake.addPhotos}
        onRemovePhoto={intake.removePhoto}
        onContinue={() => {
          intake.openAnnotationScreen();
          setScreen(2);
        }}
        onNewRun={handleCreateRun}
        onViewRuns={handleViewRuns}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === 2) {
    return (
      <PhotoAnnotation
        intake={intake}
        onBack={() => setScreen(1)}
        onReview={() => setScreen(3)}
      />
    );
  }

  if (screen === 3) {
    return (
      <ReviewIntake
        description={intake.description}
        photos={intake.photos}
        annotations={intake.annotations}
        onBack={() => setScreen(2)}
        onSubmit={handleSubmit}
        submitting={submitting}
        submissionError={submissionError}
      />
    );
  }

  if (screen === CHAT_SCREEN) {
    /*
      One page, one conversation: the layout is locked to the viewport height
      (no page scrollbar). The iframe scrolls its own transcript, and the
      clarification sidebar scrolls its own form — exactly two scrollers, side
      by side, both clearly bounded by the header above them.
    */
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="shrink-0 px-12 pt-4 max-[640px]:px-5">
          <RepairProgress currentStep={4} />
        </div>

        <div
          className={`${
            waitingForCaseClarification
              ? "grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(420px,1fr)] items-stretch gap-5 px-6 pb-4 max-[1050px]:grid-cols-1 max-[1050px]:overflow-y-auto"
              : "flex min-h-0 flex-1 flex-col px-6 pb-4"
          }`}
        >
          <div className="min-h-0 min-w-0 flex-1 px-5 py-6 max-[1050px]:h-[75dvh] max-[1050px]:flex-none">
            <FlowChatEmbed
              runId={activeRunId}
              onLogout={handleLogout}
              onNewRun={handleCreateRun}
              onViewRuns={handleViewRuns}
              onOpenCad={() => setScreen(CAD_SCREEN)}
              cadReady={currentHandoffReady}
            />
          </div>

          {waitingForCaseClarification && (
            <div className="min-h-0 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-white">
              <CaseClarification
                question=""
                embedded
                onSubmit={handleClarificationSubmit}
                submitting={clarificationSubmitting}
                error={clarificationError}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screen === CAD_SCREEN) {
    return (
      <CadModelView
        handoffMarkdown={handoffMarkdown}
        runId={activeRunId}
        onBack={() => {
          setHandoffDismissed(true);
          setScreen(CHAT_SCREEN);
        }}
        onNewRun={handleCreateRun}
        onViewRuns={handleViewRuns}
        onLogout={handleLogout}
      />
    );
  }

  return null;
}
