"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import CalibrationPanel from "./CalibrationPanel";
import { guideFrameBox } from "./guides";
import { CadCanvas, type GuideFrameRequest } from "./viewport";
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
      <div className="flex min-h-[600px] flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-6 flex shrink-0 items-start justify-between gap-5 max-[800px]:flex-col">
            <div>
              <h1 className="text-[30px]">Final repair model</h1>
              <p className="intro mb-0">
                Rendered from the calibrated design. The repair guidance is drafted from this model.
              </p>
            </div>
            {model && (
              <button
                type="button"
                className="btn-secondary shrink-0 max-[800px]:w-full"
                onClick={() => downloadBlob(exportScene(model), `${designId}.stl`)}
              >
                Download STL
              </button>
            )}
          </div>
          <ModelFrame label={model ? null : "Rendering the final model…"}>
            {model && <CadCanvas model={model} />}
          </ModelFrame>
        </section>

        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white lg:flex-1">
          <div className="flex shrink-0 items-start justify-between gap-5 border-b border-line-soft px-6 py-5 max-[800px]:flex-col max-[800px]:px-5">
            <div>
              <h2 className="mb-1.5 text-xl">Repair instructions</h2>
              <p className="m-0 text-sm leading-relaxed text-muted-2">
                Fabrication, assembly, and installation guidance for this repair.
              </p>
            </div>
            {guidance && (
              <button
                type="button"
                className="btn-secondary shrink-0 max-[800px]:w-full"
                onClick={() =>
                  downloadBlob(
                    new Blob([guidance], { type: "text/markdown;charset=utf-8" }),
                    "repair-instructions.md",
                  )
                }
              >
                Download instructions
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-[800px]:max-h-[60vh]">
            {guidance ? (
              <div className="markdown-body leading-[1.65]">
                <ReactMarkdown>{guidance}</ReactMarkdown>
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[#cbd0d6] p-5 leading-relaxed text-[#7a828d]">
                {refinementIdle
                  ? "The assistant finished without writing the instructions. Go back to Refine & Calibrate to continue the conversation."
                  : "The repair instructions are being written and will appear here when they are ready."}
              </div>
            )}
          </div>
        </aside>
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
            <button
              type="button"
              disabled={!canFinish || unapplied}
              title={unapplied ? "Apply or discard your parameter changes first" : undefined}
              onClick={getFinal}
            >
              {requesting ? "Requesting…" : "Get final model →"}
            </button>
            {unapplied && <span className="text-[12px] text-muted">Apply your changes first</span>}
            {finalError && <span className="text-[12px] text-red-600">{finalError}</span>}
          </div>
        )}
      />

      <aside className="flex h-[75dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white lg:h-auto lg:flex-1">
        <div className="shrink-0 border-b border-line-soft px-5 py-4.5">
          <h2 className="mb-1.5 text-lg">Refine your repair</h2>
          <p className="m-0 text-sm leading-[1.45] text-muted-2">
            Ask to change the model, clarify a measurement, or inspect the current repair design.
          </p>
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
            <p className="m-0 flex shrink-0 items-center gap-2 border-t border-line-soft px-5 py-3 text-sm text-muted-2">
              <span className="cad-spinner m-0 size-4 shrink-0 border-2" />
              {running
                ? "Forge is updating the design…"
                : applying
                  ? "Applying your change…"
                  : "Showing the assistant the new model…"}
            </p>
          )}
          {refinementError ? (
            <div className="m-4">
              <p className="error-box">{refinementError}</p>
              <button type="button" className="btn-secondary mt-3" onClick={() => setRefinementError("")}>
                Try again
              </button>
            </div>
          ) : (
            (!refinementId || hiddenCount === null) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/90 p-6 text-center text-sm text-muted-2">
                <div className="cad-spinner" />
                <p className="m-0">
                  {refinementId
                    ? "Loading the conversation…"
                    : running
                      ? "Forge is building the design. The assistant starts when it is done."
                      : "Starting the refinement assistant…"}
                </p>
              </div>
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
    <div className="relative flex min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-xl border border-line-soft bg-white max-lg:h-[560px]">
      {children}
      {label && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 p-6 text-center text-ink-soft">
          <div className="cad-spinner" />
          <p>{label}</p>
        </div>
      )}
      {dimmed && !label && <div className="pointer-events-none absolute inset-0 bg-white/60" />}
      {error && (
        <p className="absolute right-3 bottom-3 left-3 rounded-md bg-[#fff0f0] px-3 py-2 text-[12px] text-[#a22c2c]">
          {error}
        </p>
      )}
    </div>
  );
}
