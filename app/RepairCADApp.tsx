"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import RunList from "@/features/runs/RunList";
import DescribeRepair from "@/features/intake/DescribeRepair";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import ReviewIntake from "@/features/intake/ReviewIntake";
import CadModelView from "@/features/forge/CadModelView";
import CaseClarification from "@/features/chat/CaseClarification";
import FlowChatEmbed, {
  AccessTokenGate,
} from "@/features/chat/FlowChatEmbed";
import RepairProgress from "@/components/RepairProgress";
import { useRepairRun } from "@/hooks/useRepairRun";
import { useIntake } from "@/hooks/useIntake";
import {
  readAccessToken,
  saveAccessToken,
  clearAccessToken,
  subscribeToTokenStorage,
} from "@/lib/tokenStorage";
import { buildIntakeMessage, buildClarificationAnnotations } from "@/lib/intakeMessageUtils";
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
    The token lives in localStorage, so the first client render cannot know it
    yet. Rather than flipping state in an effect, derive "loaded" from the
    first client render via useSyncExternalStore — no cascading render.
  */
  const accessToken = useSyncExternalStore(
    subscribeToTokenStorage,
    readAccessToken,
    () => null,
  );

  const repairRun = useRepairRun({ accessToken });
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
    if (!accessToken || s2NodeIdValue !== null) return;
    s2NodeId()
      .then(setS2NodeIdValue)
      .catch((err) => {
        console.error("Could not resolve pipeline node ids:", err);
      });
  }, [accessToken, s2NodeIdValue]);

  const handoffMarkdown = runningDoc?.provisional_cad_handoff?.trim() ?? "";
  const handoffReady = run?.status === "idle" && handoffMarkdown !== "";
  const hasConversation = messages.some((message) => message.role === "user");
  const conversationReady = handoffReady || (run !== null && hasConversation);

  const waitingForCaseClarification =
    run?.status === "idle" &&
    s2NodeIdValue !== null &&
    run?.currentNodeId === s2NodeIdValue;

  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [prevHandoffReady, setPrevHandoffReady] = useState(handoffReady);
  if (prevHandoffReady !== handoffReady) {
    setPrevHandoffReady(handoffReady);
    if (!handoffReady) setHandoffDismissed(false);
  }

  let screen = requestedScreen;
  if (screen >= 1 && screen <= 4 && conversationReady) screen = CHAT_SCREEN;
  if (screen === CHAT_SCREEN && handoffReady && !handoffDismissed) {
    screen = CAD_SCREEN;
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
    if (!accessToken) {
      // Re-arm so a different token bootstraps too.
      bootstrappedRef.current = false;
      return;
    }
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
  }, [accessToken]);

  useEffect(() => {
    if (screen === CHAT_SCREEN) reconcileRunRef.current();
    if (screen === RUN_LIST) listRunsRef.current();
  }, [screen]);

  // Poll while waiting for the pipeline to finish so the derived screen
  // auto-advances to Forge as soon as the handoff document lands.
  useEffect(() => {
    if (
      screen !== CHAT_SCREEN ||
      handoffReady ||
      waitingForCaseClarification
    ) {
      return;
    }
    const interval = setInterval(() => reconcileRunRef.current(), 5000);
    return () => clearInterval(interval);
  }, [screen, handoffReady, waitingForCaseClarification]);

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
      const { messages: loadedMessages } = await selectRun(selectedRunId);
      // Clear any earlier dismissal so a completed run still auto-advances.
      setHandoffDismissed(false);
      // Fresh runs are seeded with one assistant greeting, so "no
      // conversation" means no user turn yet: open the intake wizard.
      const hasUserTurn = loadedMessages.some((message) => message.role === "user");
      setScreen(hasUserTurn ? CHAT_SCREEN : 1);
    } catch {
      // Error handled in hook; stay on the list.
    }
  }

  function handleViewRuns() {
    setScreen(RUN_LIST);
  }

  function handleLogout() {
    clearAccessToken();
    setScreen(RUN_LIST);
  }

  function handleChangeToken() {
    clearAccessToken();
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

  if (!accessToken) {
    return <AccessTokenGate onSaved={saveAccessToken} onLogout={handleLogout} />;
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
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-[1500px] px-12 pt-6 max-[640px]:px-5">
          <RepairProgress currentStep={4} />
        </div>

        <div
          className={`${
            waitingForCaseClarification
              ? "grid grid-cols-[minmax(0,1.4fr)_minmax(420px,1fr)] items-start gap-5 p-6 max-[1050px]:grid-cols-1"
              : ""
          } min-h-screen`}
        >
          <div className="min-w-0">
            <FlowChatEmbed
              runId={activeRunId}
              accessToken={accessToken}
              onChangeToken={handleChangeToken}
              onLogout={handleLogout}
              onNewRun={handleCreateRun}
              onViewRuns={handleViewRuns}
            />
          </div>

          {waitingForCaseClarification && (
            <div className="sticky top-6 max-h-[calc(100vh_-_48px)] min-w-0 overflow-y-auto">
              <CaseClarification
                question=""
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
        accessToken={accessToken}
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
