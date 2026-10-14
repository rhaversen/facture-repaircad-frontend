"use client";

import ReactMarkdown from "react-markdown";
import { Stage } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import RepairProgress from "@/components/RepairProgress";
import { AppShell, Card } from "@/components/AppShell";
import { FlowChatFrame } from "@/features/chat/FlowChatEmbed";
import { useRefinementRun } from "@/hooks/useRefinementRun";
import { useForge } from "@/hooks/useForge";
import { useDesignExists } from "@/hooks/useDesignExists";
import { downloadBlob, exportScene } from "@/lib/exportModel";
import type { GlbModel, Guide } from "@/lib/types";
import {
  CAD_SCREEN,
  cadStepFor,
  stepNav,
  timelineStepStates,
  type TimelineNavState,
} from "@/lib/runProgress";
import {
  CadCanvas,
  DesignPicker,
  Model,
} from "./viewport";
import CalibrationPanel from "./CalibrationPanel";

interface CadModelViewProps {
  handoffs: string[];
  runId: string | null;
  /*
    True when the run went through its whole pipeline inside this browsing
    session and the user came here straight from the chat: the models then
    generate without an extra click. A run opened straight from the runs
    list keeps the manual Generate gate (browsing would otherwise generate
    three designs per opened run).
  */
  shouldAutoGenerate?: boolean;
  onNewRun: () => void;
  /** Back to the conversation (repair planning) from the CAD timeline. */
  onBackToChat?: () => void;
}

/*
  Screen 6 — the Forge workspace. Renders the provisional CAD model produced
  from the RepairCAD handoff document, the variant picker while candidates
  stream in (re-openable at any time from timeline step 5), the calibration
  wizard with per-parameter guides and measurements, the refinement chat (a
  second Flow run), and the final repair instructions. The same <Canvas>
  instance hosts every phase, so the camera keeps its orientation throughout.
*/
export default function CadModelView({
  handoffs,
  runId,
  shouldAutoGenerate = false,
  onNewRun,
  onBackToChat,
}: CadModelViewProps) {
  const forge = useForge();
  const {
    phase,
    model,
    guides,
    error,
    parameters,
    statusMessage,
    buildReport,
    variants,
    designId,
    busy,
    settingParam,
    confirmedValues,
    generate,
    rehydrate,
    reloadCurrentDesignGeometry,
    reopenDesignPicker,
    refineDesign,
    chooseDesign,
    confirmParamValue,
    finishCalibration,
    reset,
  } = forge;

  /*
    Entry check: render a persisted design/variant set immediately (no LLM
    call). When nothing is persisted, a live run generates the models itself
    while a browsed run keeps the manual Generate gate.
  */
  const { checking: entryChecking, missing: entryMissing } = useDesignExists({
    phase,
    rehydrate,
    reset,
    runId,
    handoffs,
    autoGenerate: shouldAutoGenerate,
    generate,
  });

  /*
    Second Flow conversation used for iterative CAD refinement. It is
    separate from the initial RepairCAD reasoning run. The chat lives on the
    design page only, so the refinement run bootstraps once a design has
    been picked — while the picker is open there is nothing to refine yet.
  */
  const {
    runId: refinementRunId,
    runningDoc: refinementRunningDoc,
    initializing: refinementInitializing,
    error: refinementError,
    initialize: initializeRefinement,
    reconcile: reconcileRefinement,
  } = useRefinementRun();

  useEffect(() => {
    const bootstrapHandoff = handoffs[0] ?? "";
    if (!bootstrapHandoff.trim()) return;
    if (designId === null) return;
    initializeRefinement({
      handoffMarkdown: bootstrapHandoff,
      designId,
    }).catch((err) => {
      console.error("Could not start refinement conversation:", err);
    });
  }, [handoffs, designId, initializeRefinement]);

  // Keep the refinement run synchronized so forge_instruction / final_guidance
  // produced by R3 becomes visible to this component.
  useEffect(() => {
    if (!refinementRunId) return;
    reconcileRefinement();
    const interval = setInterval(() => reconcileRefinement(), 2000);
    return () => clearInterval(interval);
  }, [refinementRunId, reconcileRefinement]);

  const lastProcessedForgeInstructionRef = useRef<string | null>(null);

  // The chat lives only on the design page: every refinement targets the
  // current design, single-duplicate, linearly. While "choosing" there is no
  // design to refine and no chat is rendered.
  useEffect(() => {
    if (phase !== "ready" && phase !== "calibrating") return;
    const instruction = refinementRunningDoc?.forge_instruction?.trim();
    if (!instruction || busy) return;
    if (lastProcessedForgeInstructionRef.current === instruction) return;
    // Marked before dispatch so a polling doc cannot start the same round
    // twice; a failed round surfaces in the error phase, and a corrected
    // instruction (different text) triggers cleanly.
    lastProcessedForgeInstructionRef.current = instruction;
    refineDesign({
      feedback: instruction,
      runId,
    }).catch((err) => {
      console.error("Forge refinement failed:", err);
    });
  }, [phase, busy, refinementRunningDoc, runId, refineDesign]);

  const isLoading = phase === "initializing" || phase === "finalizing";
  // From the moment a param change is applied until the rebuilt model is
  // shown, the model is greyed out (dimmed) instead of spinning.
  const modelPending = (busy || settingParam !== null) && !isLoading;

  let spinnerLabel = statusMessage;
  if (phase === "initializing" && spinnerLabel === "") {
    spinnerLabel = "Generating initial model...";
  } else if (phase === "finalizing" && spinnerLabel === "") {
    spinnerLabel = "Finalising model with your measurements...";
  }

  /*
    Guides visibility: single selection. Active guides are shown; every
    other parameter's are hidden (null = none shown). The panel sets this
    on row hover or click. Reset with the design switch.
  */
  const [activeGuideParam, setActiveGuideParam] = useState<string | null>(null);
  const guideVisible = useCallback(
    (name: string) => name === activeGuideParam,
    [activeGuideParam],
  );
  // Guides are keyed by parameter name for the panel's per-row disc and
  // the viewport's matching.
  const guidesByParam = useMemo(() => {
    const map = new Map<string, Guide[]>();
    for (const g of guides) {
      const list = map.get(g.param);
      if (list === undefined) map.set(g.param, [g]);
      else list.push(g);
    }
    return map;
  }, [guides]);

  // A design switch invalidates the active guide selection.
  const [prevDesignId, setPrevDesignId] = useState(designId);
  if (prevDesignId !== designId) {
    setPrevDesignId(designId);
    setActiveGuideParam(null);
  }

  function handleConfirmParam(paramName: string, value: number) {
    confirmParamValue(paramName, value);
  }

  function handleRegenerate() {
    if (busy) return;
    const ok = window.confirm(
      "Regenerate the model from scratch?\n\nAny measurements you have already entered will be reset and the current design will be discarded. This cannot be undone.",
    );
    if (!ok) return;
    reset();
    generate({ handoffs, runId });
  }

  const finalGuidance = refinementRunningDoc?.final_guidance?.trim() ?? "";

  /*
    The CAD workspace owns three timeline sub-steps: 5 while the
    rough-design picker is open (or a model is still being generated),
    6 while refining/calibrating, 7 once the repair guidance has landed.
  */
  const currentCADStep = cadStepFor(phase, finalGuidance !== "");

  function handleDownloadFinalGuidance() {
    if (!finalGuidance) return;
    const blob = new Blob([finalGuidance], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "repair-instructions.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // Downloads reuse the already-parsed scene — it carries the per-part
  // material data the exporters need, which a fresh GLTFLoader.parse would
  // not reproduce.
  function handleDownload() {
    if (designId === null || model === null) return;
    try {
      downloadBlob(exportScene(model.scene), `${designId}.stl`);
    } catch (err) {
      console.error("Mesh download failed:", err);
    }
  }

  const pickerKey = useMemo(
    () => variants.map((v) => v.designId).join(","),
    [variants],
  );

  // Which candidate the user has "Select"ed in the picker. Selection alone
  // no longer commits — the Continue button below the tiles does. The state
  // lives here, not in DesignPicker, because a tile finishing generation
  // remounts the picker (pickerKey) and a mounted-state selection would be
  // lost; a stale selection referring to a vanished candidate is
  // dropped below.
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(
    null,
  );

  const [prevVariants, setPrevVariants] = useState(variants);
  if (prevVariants !== variants) {
    setPrevVariants(variants);
    setPickerSelectedId((prev) =>
      prev !== null && variants.some((v) => v.designId === prev) ? prev : null,
    );
  }

  const showFinalGuidanceSection = phase === "ready";

  /*
    The CAD column of the timeline is decided by the shared stepNav:
    1–3 (and 4) mean "back to the conversation", 5/6/7 open the CAD
    sub-states. The CAD workspace itself has always run past its intake
    and handoff, so those flags are true here.
  */
  const cadNav: TimelineNavState = {
    screen: CAD_SCREEN,
    conversationReady: true,
    handoffReady: true,
    clarificationActive: false,
    cadStep: currentCADStep,
    cadSelectionMade: designId !== null,
    hasFinalGuidance: finalGuidance !== "",
  };
  const { states: stepStates, reasons: stepReasons } =
    timelineStepStates(cadNav, CAD_SCREEN);

  function handleTimelineStep(step: number) {
    const action = stepNav(cadNav, step);
    if (action.kind !== "navigate") return;
    if (step < 5) {
      onBackToChat?.();
      return;
    }
    if (step === 5) {
      /* Reopen the variant picker with the run's recorded
         candidates — works from any CAD phase. */
      reopenDesignPicker({ runId });
      return;
    }
    if (step === 6) {
      /* Restore the current design's calibration view when the
         model state was dropped (e.g. jumped in from the picker). */
      if (model === null && designId !== null) {
        reloadCurrentDesignGeometry();
      }
      return;
    }
    /* step 7: the guidance section lives on this page — reveal it. */
    const el = document.getElementById("repair-guidance-section");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AppShell fill>
      <Card fill className="!max-w-[1500px]">
        <div className="relative mb-6 shrink-0">
          <button
            type="button"
            title="Start a new run"
            className="btn-utility absolute -top-2 right-0"
            onClick={onNewRun}
          >
            ＋ New run
          </button>
          <RepairProgress
            currentStep={currentCADStep}
            onStepClick={handleTimelineStep}
            clickStates={stepStates}
            reasons={stepReasons}
          />
        </div>

        {entryChecking ? (
          <div className="flex min-h-[480px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white">
            <div className="flex flex-col items-center justify-center p-6 text-center text-ink-soft">
              <div className="cad-spinner" />
              <p>Checking for an existing design…</p>
            </div>
          </div>
        ) : entryMissing ? (
          <div className="relative flex min-h-[480px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white">
            <div className="max-w-[420px] p-6 text-center text-ink-soft">
              <strong>No model has been generated for this repair yet.</strong>
              <p className="mt-2.5 text-[13px] text-[#8a93a1]">
                Start a new generation from your repair handoff document.
              </p>
              <button
                type="button"
                className="mt-4.5 bg-brand px-5 py-3 font-semibold text-white shadow-[0_1px_2px_rgba(29,58,153,0.25)] hover:bg-brand-dark"
                onClick={() => generate({ handoffs, runId })}
              >
                Generate model
              </button>
            </div>
          </div>
        ) : phase === "error" ? (
          <div className="relative flex min-h-[480px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white">
            <div className="max-w-[420px] p-6 text-center text-[#ffb4b4]">
              <strong className="mb-2 block text-lg">Forge could not generate the model.</strong>
              <p>{error || "Unknown error."}</p>
              <button
                type="button"
                className="btn-secondary mt-4.5"
                onClick={() => {
                  reset();
                  generate({ handoffs, runId });
                }}
              >
                Try again
              </button>
            </div>
          </div>
        ) : phase === "choosing" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto pb-24">
              <div className="shrink-0">
                <h1 className="text-[30px]">Choose a rough shape for the design</h1>
                <p className="mb-4 mt-0 text-[17px] leading-relaxed text-muted">
                  Several candidates were generated from your repair handoff.
                  Select the one you want — the other candidates are kept while
                  you decide. This step is only about getting the right{" "}
                  <strong>shape</strong> — the next step will ask you for
                  accurate measurements, so no need to judge the exact
                  dimensions here.
                </p>
              </div>
              <div className="min-w-0">
                <DesignPicker
                  key={pickerKey}
                  variants={variants}
                  selectedId={pickerSelectedId}
                  onSelected={setPickerSelectedId}
                />
              </div>
            </div>

            {/*
              Pinned to the bottom edge of the card (absolute, not part of
              the scroll flow) so the commit button is always reachable
              without scrolling to the tiles.
            */}
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border border-line-soft bg-surface px-5 py-3.5 shadow-[0_-6px_16px_rgba(16,24,40,0.06)]">
              <span className="text-[14px] text-muted">
                {pickerSelectedId !== null
                  ? `Design ${variants.findIndex((v) => v.designId === pickerSelectedId) + 1} is selected. Pick another tile to switch.`
                  : "Select a design to continue."}
              </span>
              <button
                type="button"
                className={`bg-brand px-6 py-3 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(29,58,153,0.25)] ${
                  pickerSelectedId !== null
                    ? "hover:bg-brand-dark"
                    : "cursor-not-allowed opacity-40"
                }`}
                disabled={pickerSelectedId === null}
                onClick={() =>
                  pickerSelectedId !== null && chooseDesign(pickerSelectedId)
                }
              >
                {pickerSelectedId !== null
                  ? `Continue with Design ${variants.findIndex((v) => v.designId === pickerSelectedId) + 1} →`
                  : "Continue →"}
              </button>
            </div>
          </section>
        ) : phase === "calibrating" ? (
          <div className="flex min-h-[600px] flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
            <ViewportFrame
              model={model}
              generating={isLoading}
              fitKey={designId}
              designId={designId}
              guides={guides}
              guideVisible={guideVisible}
              spinnerLabel={spinnerLabel}
              dimmed={modelPending}
            />

            {statusMessage !== "" ? (
              <p className="shrink-0 text-[12px] leading-snug text-red-600">{statusMessage}</p>
            ) : null}
            {buildReport && buildReport.trim() !== "" ? (
              <pre className="shrink-0 max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-left font-mono text-[11px] leading-snug whitespace-pre-wrap text-red-700">
                {buildReport}
              </pre>
            ) : null}
            <CalibrationPanel
              parameters={parameters}
              confirmedValues={confirmedValues}
              settingParam={settingParam ?? (busy ? "busy" : null)}
              onConfirm={(parameter, value) => handleConfirmParam(parameter.name, value)}
              onFinish={() => finishCalibration({ runId })}
              activeParam={activeGuideParam}
              onSelectGuides={setActiveGuideParam}
              guidesAvailable={(name) => guidesByParam.has(name)}
            />

            <RefinementChat
              refinementRunId={refinementRunId}
              refinementInitializing={refinementInitializing}
              refinementError={refinementError}
              intro="Ask to change the model, clarify a measurement, or inspect the current repair design."
            />
          </div>
        ) : (
          <div className="flex min-h-[600px] flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="mb-6 shrink-0">
                <h1 className="text-[30px]">
                  {phase === "ready" ? "Provisional CAD model" : "Generating model..."}
                </h1>
                <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
                  Generated from your repair handoff via Facture Forge.
                </p>
              </div>

              <ViewportFrame
                model={model}
                generating={isLoading}
                fitKey={designId}
                designId={designId}
                guides={guides}
                guideVisible={guideVisible}
                spinnerLabel={spinnerLabel}
                dimmed={modelPending}
              />

              {phase === "ready" && (
                <div className="mt-6 flex shrink-0 gap-3">
                  {designId !== null && (
                    <button
                      type="button"
                      title="Download the loaded model as STL"
                      onClick={handleDownload}
                      className="btn-secondary"
                    >
                      Download STL
                    </button>
                  )}
                  {finalGuidance && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleDownloadFinalGuidance}
                    >
                      Download repair instructions
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {showFinalGuidanceSection && (
          <section
            id="repair-guidance-section"
            className="mt-6 shrink-0 rounded-xl border border-line bg-surface p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-5 max-[800px]:flex-col">
              <div>
                <h2 className="mb-1.5 text-xl">Repair instructions</h2>
                <p className="m-0 text-sm leading-relaxed text-muted-2">
                  Final fabrication, assembly, and installation guidance for this repair.
                </p>
              </div>
              {finalGuidance && (
                <button type="button" className="btn-secondary max-[800px]:w-full" onClick={handleDownloadFinalGuidance}>
                  Download instructions
                </button>
              )}
            </div>

            {finalGuidance ? (
              /*
                Capped with an internal scroll so a long document can never
                push the card past the viewport or clip below the regenerate
                footer.
              */
              <div className="markdown-body max-h-[40vh] overflow-y-auto overscroll-contain rounded-[10px] border border-line bg-white p-5 leading-[1.65]">
                <ReactMarkdown>{finalGuidance}</ReactMarkdown>
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[#cbd0d6] bg-white p-5 leading-relaxed text-[#7a828d]">
                Final repair instructions will appear here when the repair design is complete.
              </div>
            )}
          </section>
        )}

        {phase !== "error" && phase !== "choosing" && (
          <div className="mt-8 flex shrink-0 justify-center border-t border-line-soft pt-5">
            <button
              type="button"
              className="rounded-lg border border-[#d5d9e0] bg-transparent px-3.5 py-1.5 text-sm text-muted hover:border-[#c0392b] hover:bg-transparent hover:text-[#c0392b]"
              onClick={handleRegenerate}
            >
              ↻ Regenerate model
            </button>
          </div>
        )}
      </Card>
    </AppShell>
  );
}

/*
  Shared 3D stage: one <Canvas> instance hosts every phase that shows a
  model, so the camera keeps its orientation while a design moves through
  the phases. The two overlays are shared with the ready view: a spinner
  while Forge is generating (white veil so the old model stays visible)
  and a dim veil while a parameter change is being applied.
*/
function ViewportFrame({
  model,
  generating,
  fitKey,
  designId,
  guides,
  guideVisible,
  spinnerLabel,
  dimmed,
}: {
  model: GlbModel | null;
  generating: boolean;
  fitKey: string | null;
  designId: string | null;
  guides: Guide[];
  guideVisible: (name: string) => boolean;
  spinnerLabel: string;
  dimmed: boolean;
}) {
  return (
    <div className="relative flex min-h-[420px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white max-lg:h-[560px]">
      {model !== null ? (
        <CadCanvas
          generating={generating}
          fitKey={fitKey}
          fitModel={model}
          designId={designId ?? undefined}
          guides={guides}
          guideVisible={guideVisible}
        >
          <Stage adjustCamera={false} center={{ disable: true }}>
            <Model model={model} />
          </Stage>
        </CadCanvas>
      ) : null}

      {generating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 p-6 text-center text-ink-soft">
          <div className="cad-spinner" />
          <p>{spinnerLabel}</p>
          <p className="mt-1.5 text-[13px] text-[#8a93a1]">This can take a minute while Forge works.</p>
        </div>
      )}

      {dimmed && (
        <div className="pointer-events-none absolute inset-0 bg-white/60" title="Applying the change…">
          <p className="sr-only">Applying the change…</p>
        </div>
      )}
    </div>
  );
}

function RefinementChat({
  refinementRunId,
  refinementInitializing,
  refinementError,
  intro,
}: {
  refinementRunId: string | null;
  refinementInitializing: boolean;
  refinementError: string;
  intro: string;
}) {
  /*
    Sits as a third column next to the canvas and the parameter panel on wide
    screens, recording to the row's height; the calibration panel fixes the
    columns' width. When stacked (narrow screens) the aside keeps a fixed
    share of the viewport so the iframe still has a definite height.
  */
  return (
    <aside className="flex h-[75dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white lg:h-auto lg:w-[380px] lg:min-h-[420px] lg:shrink-0 lg:self-stretch">
      <div className="shrink-0 border-b border-line-soft px-5 py-4.5">
        <h2 className="mb-1.5 text-lg">Refine your repair</h2>
        <p className="m-0 text-sm leading-[1.45] text-muted-2">{intro}</p>
      </div>

      {refinementInitializing && (
        <div className="p-4.5 text-sm text-muted-2">Starting refinement assistant—</div>
      )}

      {refinementError && (
        <div className="m-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
          {refinementError}
        </div>
      )}

      {refinementRunId && (
        <div className="min-h-0 flex-1">
          <FlowChatFrame
            runId={refinementRunId}
            title="CAD refinement"
          />
        </div>
      )}
    </aside>
  );
}
