"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import CalibrationPanel from "./CalibrationPanel";
import { guideFrameBox } from "./guides";
import { CadCanvas, type GuideFrameRequest } from "./viewport";
import { DownloadIcon, NextIcon } from "@/components/icons";
import { Button, ErrorBox, Loading, Title } from "@/components/ui";
import FlowChat from "@/features/planning/FlowChat";
import { useDesign } from "@/hooks/useDesign";
import { useFlowRun } from "@/hooks/useFlowRun";
import { downloadBlob, exportScene } from "@/lib/exportModel";
import { createRun, fetchMessages, resolvePipelines, sendMessage } from "@/lib/flow";
import { errorText, fetchStepContext } from "@/lib/forge";
import {
  bootstrapMessage,
  guidanceRequest,
  hiddenMessageCount,
  modelUpdateMessage,
  viewFiles,
} from "@/lib/refinement";
import { loadRefinement, storeRefinement } from "@/lib/store";

/*
  Steps 6 and 7 for one picked design. Each design has one AfterForge
  assistant for good: it is started the first time the design is opened
  (once Forge has finished building it), bootstrapped with the design's
  brief, the planning run's fabrication intent and Forge's step context, and
  remembered in localStorage, so every later visit continues the same
  conversation. Each forge_instruction it produces is sent straight to this
  design; while Forge works, the parameters are locked and the chat's
  composer is hidden. When a Forge turn finishes, the assistant is sent the
  model's fresh step context, and the chat hides everything up to the latest
  context message: the user sees a fresh conversation while the assistant
  keeps the whole history. The final view asks the assistant for the repair
  guidance.
*/
export default function Workspace({
  designId,
  handoff,
  handoffVariant,
  designIntent,
  final,
  onFinal,
}: {
  designId: string;
  handoff: string;
  handoffVariant: string;
  designIntent: string;
  final: boolean;
  onFinal: () => void;
}) {
  const design = useDesign(designId);
  const { model, running, turnsDone, applying, parameters, send } = design;
  const busy = running !== false || applying;

  // ── The design's AfterForge assistant ──
  const [storedId, setStoredId] = useState(() => loadRefinement(designId));
  const refinement = useFlowRun(storedId);
  // A remembered run the server no longer has is started over.
  const refinementId = refinement.missing ? null : storedId;
  const [refinementError, setRefinementError] = useState("");
  const starting = useRef(false);
  const loaded = design.design !== null;
  // The Forge turn whose model the assistant was last given. `turnsDone`
  // counts from zero on every mount, as does this.
  const [contextTurn, setContextTurn] = useState(0);
  useEffect(() => {
    if (refinementId !== null || !loaded || busy || starting.current || refinementError) return;
    starting.current = true;
    const turn = turnsDone;
    (async () => {
      const stepContext = await fetchStepContext(designId);
      const views = await viewFiles(stepContext.images);
      const run = await createRun((await resolvePipelines()).refinement);
      await sendMessage(
        run._id,
        bootstrapMessage({ designId, handoff, handoffVariant, designIntent, parameters, stepContext }),
        views,
      );
      // Remembered only once bootstrapped, so a stored run always has its setup behind it.
      storeRefinement(designId, run._id);
      setStoredId(run._id);
      setContextTurn(turn);
    })()
      .catch((err) => {
        console.error("Could not start the refinement assistant:", err);
        setRefinementError(errorText(err, "Could not start the refinement assistant."));
      })
      .finally(() => {
        starting.current = false;
      });
  }, [
    refinementId,
    loaded,
    busy,
    refinementError,
    turnsDone,
    designId,
    handoff,
    handoffVariant,
    designIntent,
    parameters,
  ]);

  const doc = refinement.run?.runningDoc;
  const seenRunId = refinement.run?._id ?? null;
  const refinementIdle = refinement.run !== null && refinement.run.status !== "running";

  // A finished Forge turn sends the assistant the model as it now is.
  const contextStale = refinementId !== null && turnsDone > contextTurn;
  const updating = useRef(false);
  const refreshRefinement = refinement.refresh;
  useEffect(() => {
    if (!contextStale || busy || !refinementIdle || updating.current) return;
    updating.current = true;
    const turn = turnsDone;
    (async () => {
      const stepContext = await fetchStepContext(designId);
      const views = await viewFiles(stepContext.images);
      await sendMessage(refinementId!, modelUpdateMessage({ parameters, stepContext }), views);
      await refreshRefinement();
    })()
      .catch((err) => console.error("Could not send the assistant the new model:", err))
      .finally(() => {
        // Marked done even on failure: the next Forge turn tries again.
        setContextTurn(turn);
        updating.current = false;
      });
  }, [contextStale, busy, refinementIdle, turnsDone, designId, refinementId, parameters, refreshRefinement]);

  // The chat starts after the latest context message, counted again once
  // each new one is in.
  const [hidden, setHidden] = useState<{ runId: string; turn: number; count: number } | null>(null);
  useEffect(() => {
    // Only once the run is known to exist.
    if (refinementId === null || seenRunId !== refinementId || contextStale) return;
    if (hidden?.runId === refinementId && hidden.turn === contextTurn) return;
    fetchMessages(refinementId)
      .then((messages) =>
        setHidden({ runId: refinementId, turn: contextTurn, count: hiddenMessageCount(messages) }),
      )
      .catch((err) => console.error("Could not load the refinement conversation:", err));
  }, [refinementId, seenRunId, contextStale, contextTurn, hidden]);
  const hiddenCount = hidden?.runId === refinementId ? hidden.count : null;

  // Each new instruction goes to the design once. Whatever instruction the
  // run already holds when this page first sees it went out on an earlier visit.
  const instruction = doc?.forge_instruction?.trim() ?? "";
  const applied = useRef<{ runId: string; instruction: string } | null>(null);
  useEffect(() => {
    if (seenRunId === null) return;
    if (applied.current?.runId !== seenRunId) {
      applied.current = { runId: seenRunId, instruction };
      return;
    }
    if (instruction === "" || instruction === applied.current.instruction || busy) return;
    applied.current = { runId: seenRunId, instruction };
    void send(instruction);
  }, [seenRunId, instruction, busy, send]);

  // ── Guides ──
  const [activeGuide, setActiveGuide] = useState<string | null>(null);
  const [guideFrame, setGuideFrame] = useState<GuideFrameRequest | null>(null);
  function showGuide(name: string) {
    const guide = design.guides.find((g) => g.param === name);
    if (!guide) return;
    const frame = guideFrameBox(guide);
    setGuideFrame((prev) => ({
      center: frame.center.toArray(),
      radius: frame.radius,
      ...("normal" in frame.facing
        ? { normal: frame.facing.normal.toArray() }
        : { axis: frame.facing.axis.toArray() }),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }

  // ── Final ──
  const [requesting, setRequesting] = useState(false);
  const [finalError, setFinalError] = useState("");
  async function getFinal() {
    // The assistant already wrote it on an earlier visit, and its conversation ended there.
    if (doc?.final_guidance?.trim()) return onFinal();
    setRequesting(true);
    setFinalError("");
    try {
      await sendMessage(refinementId!, guidanceRequest(parameters));
      await refinement.refresh();
      onFinal();
    } catch (err) {
      setFinalError(errorText(err, "Could not request the repair guidance."));
    } finally {
      setRequesting(false);
    }
  }
  const canFinish = model !== null && !busy && !contextStale && refinementIdle && !requesting;

  if (final) {
    const guidance = doc?.final_guidance?.trim() ?? "";
    return (
      <div className="flex flex-1 flex-col gap-6">
        <Title
          actions={
            model && (
              <Button onClick={() => downloadBlob(exportScene(model), `${designId}.stl`)}>
                <DownloadIcon size={16} />
                STL
              </Button>
            )
          }
        >
          Your repair
        </Title>
        <div className="flex min-h-[560px] flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
          <ModelFrame label={model ? null : "Rendering the final model…"}>
            {model && <CadCanvas model={model} />}
          </ModelFrame>

          <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-surface lg:flex-1">
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3">
              <h2 className="text-sm font-medium text-muted">How to repair it</h2>
              {guidance && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    downloadBlob(
                      new Blob([guidance], { type: "text/markdown;charset=utf-8" }),
                      "repair-instructions.md",
                    )
                  }
                >
                  <DownloadIcon size={14} />
                  Download
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 max-lg:max-h-[60vh]">
              {guidance ? (
                <div className="markdown-body">
                  <ReactMarkdown>{guidance}</ReactMarkdown>
                </div>
              ) : refinementIdle ? (
                <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">
                  The assistant stopped without writing the instructions. Go back to Refine to continue.
                </p>
              ) : (
                <Loading className="h-full">Writing the instructions…</Loading>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[600px] flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
      <ModelFrame
        label={model === null ? "Loading the model…" : running ? "Forge is updating the design…" : null}
        dimmed={applying}
        error={design.error}
      >
        {model && (
          <CadCanvas
            model={model}
            guides={design.guides}
            activeGuide={activeGuide}
            guideFrame={guideFrame}
          />
        )}
      </ModelFrame>

      <CalibrationPanel
        parameters={parameters}
        disabled={busy}
        onApply={design.applyParameters}
        activeGuide={activeGuide}
        onSelectGuide={setActiveGuide}
        onShowGuide={showGuide}
        hasGuides={(name) => design.guides.some((g) => g.param === name)}
        footer={(unapplied) => (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="primary"
              disabled={!canFinish || unapplied}
              title={unapplied ? "Apply or discard your parameter changes first" : undefined}
              onClick={getFinal}
            >
              {requesting ? "Requesting…" : "Finish"}
              {!requesting && <NextIcon size={16} />}
            </Button>
            {finalError && <span className="text-xs text-danger">{finalError}</span>}
          </div>
        )}
      />

      <aside className="flex h-[75dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-surface lg:h-auto lg:flex-1">
        <div className="shrink-0 border-b border-border/70 px-5 py-3.5">
          <h2 className="text-sm font-medium text-muted">Ask for changes</h2>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {refinementId && hiddenCount !== null && (
            <FlowChat
              key={hiddenCount}
              runId={refinementId}
              title="CAD refinement"
              hideMessages={hiddenCount}
              composerHidden={busy || contextStale}
            />
          )}
          {refinementId && (busy || contextStale) && (
            <p className="flex shrink-0 items-center gap-2 border-t border-border/70 px-5 py-3 text-sm text-muted">
              <span className="cad-spinner size-4 shrink-0 border-2" />
              {running
                ? "Forge is updating the design…"
                : applying
                  ? "Applying your change…"
                  : "Showing the assistant the new model…"}
            </p>
          )}
          {refinementError ? (
            <div className="m-4 flex flex-col items-start gap-3">
              <ErrorBox className="w-full">{refinementError}</ErrorBox>
              <Button onClick={() => setRefinementError("")}>Try again</Button>
            </div>
          ) : (
            (!refinementId || hiddenCount === null) && (
              <Loading className="absolute inset-0 bg-surface">
                {refinementId
                  ? "Loading the conversation…"
                  : running
                    ? "Building the design first…"
                    : "Starting the assistant…"}
              </Loading>
            )
          )}
        </div>
      </aside>
    </div>
  );
}

/* The viewport's frame, with a spinner veil while `label` is set and a dim
   veil while a change is being applied. */
function ModelFrame({
  label = null,
  dimmed = false,
  error = "",
  children,
}: {
  label?: string | null;
  dimmed?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-viewport max-lg:h-[560px]">
      {children}
      {label && <Loading className="absolute inset-0 bg-viewport/80">{label}</Loading>}
      {dimmed && !label && <div className="pointer-events-none absolute inset-0 bg-viewport/60" />}
      {error && (
        <p className="absolute right-3 bottom-3 left-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger backdrop-blur-md">
          {error}
        </p>
      )}
    </div>
  );
}
