"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import RunList from "@/features/runs/RunList";
import DescribeRepair from "@/features/intake/DescribeRepair";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import ReviewIntake from "@/features/intake/ReviewIntake";
import CadModelView from "@/features/forge/CadModelView";
import CaseClarification from "@/features/chat/CaseClarification";
import FlowChatEmbed, { FlowChatActions } from "@/features/chat/FlowChatEmbed";
import RepairProgress from "@/components/RepairProgress";
import { AppHeader, AppShell, Card } from "@/components/AppShell";
import { useRepairRun } from "@/hooks/useRepairRun";
import { useIntake } from "@/hooks/useIntake";
import { authUrl, getMe, logout } from "@/lib/auth";
import { buildIntakeMessage, buildClarificationAnnotations } from "@/lib/intakeMessageUtils";
import { describeMessageContent } from "@/lib/messageContent";
import {
  deriveScreen,
  handoffReadyFor,
  screenForSelectedRun,
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

  /*
    Run provenance for auto-generate: a run created in this browser session
    (bootstrap of an empty workspace, the New-run button, or reaching the
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

  const activeRunId = runId ?? run?._id ?? null;
  const shouldAutoGenerate = activeRunId !== null && liveRunIds.has(activeRunId);

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
      <AppShell>
        <Card className="!max-w-[1600px] !px-10">
          <AppHeader />

          <RepairProgress currentStep={2} />

          <h1>Annotate your photos</h1>

          <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
            Mark important parts of the photo and briefly describe what they show
            or why they matter for the repair.
          </p>

          <PhotoAnnotation intake={intake} withSizeReference />

          {intake.photos.length > 0 && !intake.hasMeasurementReference && (
            <p className="mt-6 -mb-3 text-right text-sm text-[#a05a00]">
              Mark at least one annotation as a size reference (with its known
              dimension) to continue.
            </p>
          )}

          <div className="mt-9 flex justify-between gap-4 max-[640px]:flex-col-reverse max-[640px]:[&>button]:w-full">
            <button type="button" className="btn-secondary" onClick={() => setScreen(1)}>
              ← Back
            </button>

            <button
              type="button"
              disabled={!intake.hasMeasurementReference}
              onClick={() => setScreen(3)}
            >
              Review →
            </button>
          </div>
        </Card>
      </AppShell>
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
      One page, two states:
      - While the pipeline sends the case back for clarification there is no
        conversation to follow — the last assistant question is shown as a
        focused card next to the response form instead of the full transcript.
      - Otherwise the whole conversation embed fills the page, with its own
        header actions and its own scrolling transcript.
      Both states are locked to the viewport height (no page scrollbar).
    */
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastQuestion = describeMessageContent(lastAssistant?.content);

    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="shrink-0 px-6 pb-4 pt-4 max-[640px]:px-5">
          <RepairProgress currentStep={4} flush />
        </div>

        {waitingForCaseClarification ? (
          <div className="flex min-h-0 flex-1 justify-center overflow-y-auto overscroll-contain px-6 pb-4 max-[640px]:px-4">
            <div className="max-h-full w-full max-w-[860px]">
              <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)] max-[640px]:p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-lg font-bold">Repair clarification</div>
                  <FlowChatActions
                    onLogout={handleLogout}
                    onNewRun={handleCreateRun}
                    onViewRuns={handleViewRuns}
                  />
                </div>

                <CaseClarification
                  question={lastQuestion}
                  embedded
                  onSubmit={handleClarificationSubmit}
                  submitting={clarificationSubmitting}
                  error={clarificationError}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
            <FlowChatEmbed
              runId={activeRunId}
              onLogout={handleLogout}
              onNewRun={handleCreateRun}
              onViewRuns={handleViewRuns}
              onOpenCad={() => setScreen(CAD_SCREEN)}
              cadReady={currentHandoffReady}
            />
          </div>
        )}
      </div>
    );
  }

  if (screen === CAD_SCREEN) {
    return (
      <CadModelView
        handoffs={handoffs}
        runId={activeRunId}
        shouldAutoGenerate={shouldAutoGenerate}
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
