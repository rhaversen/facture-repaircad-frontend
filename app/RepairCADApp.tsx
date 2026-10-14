"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import RunList from "@/features/runs/RunList";
import DescribeRepair from "@/features/intake/DescribeRepair";
import AnnotatePhotos from "@/features/intake/AnnotatePhotos";
import ReviewIntake from "@/features/intake/ReviewIntake";
import CadModelView from "@/features/forge/CadModelView";
import ChatScreen from "@/features/chat/ChatScreen";
import { useRepairRun } from "@/hooks/useRepairRun";
import { useIntake } from "@/hooks/useIntake";
import { authUrl, getMe, logout } from "@/lib/auth";
import {
  buildIntakeMessage,
  buildClarificationAnnotations,
} from "@/lib/intakeMessageUtils";
import {
  deriveScreen,
  hasUserTurn,
  handoffReadyFor,
  runShowsProgress,
  screenForSelectedRun,
  stepNav,
  timelineStepStates,
  RUN_LIST,
  CHAT_SCREEN,
  CAD_SCREEN,
  CAD_SUBSTEP_PICKER,
  CAD_SUBSTEP_CALIBRATION,
  CAD_SUBSTEP_GUIDANCE,
  type TimelineNavState,
  type TimelineRoundState,
} from "@/lib/runProgress";
import { collectHandoffs } from "@/lib/handoffs";
import { s2NodeId } from "@/lib/pipeline";

/*
  Screen ids: 7 run list (home), 1-4 intake wizard, 5 conversation, 6 CAD.
  The rendered screen is DERIVED from run state (conversationReady /
  handoffReady) on top of the user's requestedScreen choice — no jump
  effects. handoffDismissed keeps "Back to chat" sticky until the handoff
  clears, which re-arms the auto-advance.
*/

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
    clearRun,
    reconcileRun,
  } = repairRun;

  const intake = useIntake();

  // ── Derived screen state ────────────────────────────────────────────────

  const [requestedScreen, setScreen] = useState<number>(RUN_LIST);

  /*
    Run provenance for auto-generate: a run created in this browser session
    (bootstrap of an empty workspace, the New-repair button, or reaching the
    chat normally) may auto-generate its CAD models when its handoff lands —
    the user is watching the run live, so no extra Generate click is needed.
    Runs opened from the runs list are never registered, keeping the manual
    Generate gate there (each browsed run would otherwise auto-generate
    three designs on entry).
  */
  const [liveRunIds, setLiveRunIds] = useState<Set<string>>(new Set());
  const registerLiveRun = useCallback((id: string) => {
    setLiveRunIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const [s2NodeIdValue, setS2NodeIdValue] = useState<string | null>(null);
  useEffect(() => {
    if (!authChecked || s2NodeIdValue !== null) return;
    s2NodeId()
      .then(setS2NodeIdValue)
      .catch((err) => {
        console.error("Could not resolve pipeline node ids:", err);
      });
  }, [authChecked, s2NodeIdValue]);

  const handoffs = collectHandoffs(runningDoc);

  const waitingForCaseClarification =
    run?.status === "idle" &&
    s2NodeIdValue !== null &&
    run?.currentNodeId === s2NodeIdValue;

  const [handoffDismissed, setHandoffDismissed] = useState(false);

  // The CAD sub-state reported by CadModelView (its useForge designId
  // and final guidance). While the conversation screen is up, the shell
  // owns markers 5/6/7 — 5 is gated by handoffReady, and 6/7 mirror this
  // real selection state instead of a placeholder.
  const [cadSelectionMade, setCadSelectionMade] = useState(false);
  const [hasAfterCadRun, setHasAfterCadRun] = useState(false);
  const [roundState, setRoundState] = useState<TimelineRoundState>("none");
  function handleCadStateChange(state: {
    cadSelectionMade: boolean;
    hasAfterCadRun: boolean;
    roundState: TimelineRoundState;
  }) {
    setCadSelectionMade(state.cadSelectionMade);
    setHasAfterCadRun(state.hasAfterCadRun);
    setRoundState(state.roundState);
  }
  const activeRunId = runId ?? run?._id ?? null;
  /* A run switch starts fresh design state — the previous run's CAD
     selection must not enable markers 6/7 for the new run. */
  useEffect(() => {
    setCadSelectionMade(false);
    setHasAfterCadRun(false);
    setRoundState("none");
  }, [activeRunId]);

  const screen = deriveScreen({
    run,
    messages,
    handoffs,
    handoffDismissed,
    requestedScreen,
  });

  // Re-arm the CAD auto-advance whenever the handoff clears (e.g. a new
  // turn restarts the pipeline), so the next handoff advances again.
  const [prevHandoffReady, setPrevHandoffReady] = useState(
    handoffReadyFor(run, handoffs),
  );
  const currentHandoffReady = handoffReadyFor(run, handoffs);
  if (prevHandoffReady !== currentHandoffReady) {
    setPrevHandoffReady(currentHandoffReady);
    if (!currentHandoffReady) setHandoffDismissed(false);
  }

  /*
    Timeline navigation is decided by stepNav (lib/runProgress) — a pure
    function of the visible screen plus the run state — so no marker can
    ever jump into a state that isn't reachable. Every step has some
    outcome: navigation, a no-op (CAD sub-states), or a lock with a
    reason (rendered as a disabled marker + tooltip).
  */
  const timelineState: TimelineNavState = {
    screen,
    conversationReady:
      run !== null && (hasUserTurn(messages) || runShowsProgress(run)),
    handoffReady: currentHandoffReady,
    clarificationActive: waitingForCaseClarification,
    /* The app shell only renders the timeline while screens 1-5 are up
       (screen 6 renders its own) — CadModelView fills the CAD sub-state
       fields from Forge itself there. cadSelectionMade/roundState
       are the real values reported up from CadModelView so the markers
       stay accurate from the conversation too. */
    cadStep: CAD_SCREEN,
    cadSelectionMade,
    afterCadRunExists: hasAfterCadRun,
    roundState,
  };
  const { states: stepStates, reasons: stepReasons } = timelineStepStates(
    timelineState,
    screen,
  );

  function handleTimelineStep(step: number) {
    const action = stepNav(timelineState, step);
    if (action.kind !== "navigate") return;
    /* Leaving CAD dismisses the handoff so the auto-advance doesn't drag
       the user straight back into the CAD workspace. */
    if (screen === CAD_SCREEN && action.target < CAD_SCREEN) {
      setHandoffDismissed(true);
    }
    if (action.target === 2) intake.openAnnotationScreen();
    setScreen(action.target);
  }

  /* Return to the conversation from the CAD workspace; same dismissal
     as handleTimelineStep so the demo flags are not duplicated below. */
  function handleBackToChat() {
    if (screen !== CAD_SCREEN) return;
    setHandoffDismissed(true);
    setScreen(CHAT_SCREEN);
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
        createRunRef
          .current()
          .then((created) => {
            registerLiveRun(created._id);
            setScreen(1);
          })
          .catch(() => {
            // Error handled in hook; the empty list stays visible.
          });
      }
    });
  }, [authChecked, registerLiveRun]);

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

  function handleToAllRuns() {
    /* Drop the active run and request the list; the list reloads itself
       whenever the derived screen lands there. */
    clearRun();
    setScreen(RUN_LIST);
  }

  async function handleCreateRun() {
    try {
      const created = await createRun();
      registerLiveRun(created._id);
      setScreen(1);
    } catch {
      // Error handled in hook; stay on the list.
    }
  }

  async function handleSelectRun(selectedRunId: string) {
    // A run re-entered from the list is browsed, not live — any still-
    // missing models then need the manual Generate button, and an empty
    // run must not fire three designs just because it was opened.
    setLiveRunIds((prev) => {
      if (!prev.has(selectedRunId)) return prev;
      const next = new Set(prev);
      next.delete(selectedRunId);
      return next;
    });
    try {
      const { messages: loadedMessages, run: loadedRun } =
        await selectRun(selectedRunId);
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

  async function handleLogout() {
    await logout();
    window.location.assign(authUrl());
  }

  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [clarificationError, setClarificationError] = useState("");

  async function handleSubmit(
    annotatedCopies: Record<string, { file: File; url: string }>,
  ) {
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
        [clarification.content.trim(), ...annotationLines]
          .filter(Boolean)
          .join("\n\n") ||
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
        "The clarification could not be processed. Please try again.",
      );
    } finally {
      setClarificationSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (!authChecked || !loggedIn) {
    return null;
  }

  const shouldAutoGenerate =
    activeRunId !== null && liveRunIds.has(activeRunId);

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
        s2NodeId={s2NodeIdValue}
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
        onStepClick={handleTimelineStep}
        clickStates={stepStates}
        reasons={stepReasons}
        onContinue={() => {
          intake.openAnnotationScreen();
          setScreen(2);
        }}
        onAllRuns={handleToAllRuns}
      />
    );
  }

  if (screen === 2) {
    return (
      <AnnotatePhotos
        intake={intake}
        onBack={() => setScreen(1)}
        onContinue={() => setScreen(3)}
        onAllRuns={handleToAllRuns}
        onStepClick={handleTimelineStep}
        clickStates={stepStates}
        reasons={stepReasons}
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
        onAllRuns={handleToAllRuns}
        onStepClick={handleTimelineStep}
        clickStates={stepStates}
        reasons={stepReasons}
        onSubmit={handleSubmit}
        submitting={submitting}
        submissionError={submissionError}
      />
    );
  }

  if (screen === CHAT_SCREEN) {
    return (
      <ChatScreen
        runId={activeRunId}
        messages={messages}
        waitingForCaseClarification={waitingForCaseClarification}
        clarificationSubmitting={clarificationSubmitting}
        clarificationError={clarificationError}
        onAllRuns={handleToAllRuns}
        onStepClick={handleTimelineStep}
        clickStates={stepStates}
        reasons={stepReasons}
        onClarificationSubmit={handleClarificationSubmit}
      />
    );
  }

  if (screen === CAD_SCREEN) {
    return (
      <CadModelView
        handoffs={handoffs}
        runId={activeRunId}
        shouldAutoGenerate={shouldAutoGenerate}
        onAllRuns={handleToAllRuns}
        onBackToChat={handleBackToChat}
        onCadStateChange={handleCadStateChange}
      />
    );
  }

  return null;
}
