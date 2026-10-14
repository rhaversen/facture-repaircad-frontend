"use client";

import ReactMarkdown from "react-markdown";
import { Stage } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Page from "@/components/Page";
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
  type TimelineRoundState,
} from "@/lib/runProgress";
import {
  CadCanvas,
  DesignPicker,
  Model,
  type GuideFrameRequest,
} from "./viewport";
import CalibrationPanel from "./CalibrationPanel";
import { guideFrameBox } from "./guides";

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
  onAllRuns: () => void;
  /** Back to the conversation (repair planning) from the CAD timeline. */
  onBackToChat?: () => void;
  /** Reports the design-selection state to the app shell so its
      timeline markers 6/7 enable from the conversation once a design
      is selected (6: a refinement run exists for the pick, 7: that
      round is committed — the document is in flight or landed). */
  onCadStateChange?: (state: {
    cadSelectionMade: boolean;
    hasAfterCadRun: boolean;
    roundState: TimelineRoundState;
  }) => void;
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
  onAllRuns,
  onBackToChat,
  onCadStateChange,
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
    sendMessage: sendMessageRefinement,
  } = useRefinementRun();

  /*
    The refinement run is persisted against the main repair run's id:
    re-entering the CAD workspace resumes the same conversation while
    this round has final guidance, and creates a fresh run once guidance
    exists. The designId guard makes the run create with the chosen
    design on first entry.
  */
  // Depend on the handoff text, not the `handoffs` array: the app shell
  // rebuilds that array (via collectHandoffs) on every poll re-render, and a
  // fresh array reference re-runs this effect, re-invoking the bootstrap.
  const bootstrapHandoff = handoffs[0] ?? "";
  useEffect(() => {
    if (!bootstrapHandoff.trim()) return;
    if (designId === null || !runId) return;
    initializeRefinement(bootstrapHandoff, designId, runId).catch((err) => {
      console.error("Could not start refinement conversation:", err);
    });
  }, [bootstrapHandoff, designId, runId, initializeRefinement]);

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
    on row hover or click. Reset with the design switch and when the
    refinement round is committed (the model is done being calibrated).
  */
  const [activeGuideParam, setActiveGuideParam] = useState<string | null>(null);
  const guideVisible = useCallback(
    (name: string) => name === activeGuideParam,
    [activeGuideParam],
  );

  /*
    Guide camera reframe (Option B): the orbit pivot moves to the world
    origin and the camera backs up along the origin -> guide axis until
    the guide fits, so the model stays centred and the user looks from
    the guide's side straight through it. Computed only when the panel's
    "show guide" button is clicked — row hover/click stays selection-only
    — and one nonce per click lets repeat clicks re-run the frame.
  */
  const [guideFrame, setGuideFrame] = useState<GuideFrameRequest | null>(null);
  const showGuideCamera = useCallback(
    (paramName: string) => {
      const guide = guides.find((g) => g.param === paramName);
      if (!guide) return;
      const frame = guideFrameBox(guide);
      setGuideFrame((prev) => ({
        center: [frame.center.x, frame.center.y, frame.center.z],
        radius: frame.radius,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [guides],
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

  // A design switch invalidates the active guide selection and any pending
  // guide reframe (the guide endpoints changed with the geometry).
  const [prevDesignId, setPrevDesignId] = useState(designId);
  if (prevDesignId !== designId) {
    setPrevDesignId(designId);
    setActiveGuideParam(null);
    setGuideFrame(null);
  }

  function handleConfirmParam(paramName: string, value: number) {
    confirmParamValue(paramName, value);
  }

  const finalGuidance = refinementRunningDoc?.final_guidance?.trim() ?? "";

  /* Refinement round state for marker 7 and the CAD sub-step: "sealed"
     once the document is on file, "generating" from the moment the
     guidance request was sent (the OK click), otherwise "none". The
     commit flag records this view's own action against *this* run —
     when the run id switches the flag no longer describes a committed
     round, so the render-phase adjustment below resets it and step 7
     re-locks. */
  const [roundCommitted, setRoundCommitted] = useState(false);
  const [prevRefinementRunId, setPrevRefinementRunId] =
    useState(refinementRunId);
  if (prevRefinementRunId !== refinementRunId) {
    setPrevRefinementRunId(refinementRunId);
    if (roundCommitted) setRoundCommitted(false);
  }
  const roundState: TimelineRoundState =
    finalGuidance !== "" ? "sealed" : roundCommitted ? "generating" : "none";

  /* Committing the round moves the timeline to step 7: the active guide
     selection and any pending camera reframe belong to the calibrated
     model — clear them the moment the state changes, in either
     direction. */
  const [prevRoundState, setPrevRoundState] = useState(roundState);
  if (prevRoundState !== roundState) {
    setPrevRoundState(roundState);
    setActiveGuideParam(null);
    setGuideFrame(null);
  }

  /*
    The CAD workspace owns three timeline sub-steps: 5 while the
    rough-design picker is open (or a model is still being generated),
    6 while refining/calibrating, 7 once the repair guidance has landed.
  */
  const currentCADStep = cadStepFor(phase, roundState);

  /* The app shell renders timeline markers 6/7 while the conversation
     screen is up, where this view's own CAD sub-state fields don't
     apply — report the real selection state to it instead. */
  const onCadStateChangeRef = useRef(onCadStateChange);
  onCadStateChangeRef.current = onCadStateChange;
  useEffect(() => {
    onCadStateChangeRef.current?.({
      cadSelectionMade: designId !== null,
      hasAfterCadRun: refinementRunId !== null,
      roundState,
    });
  }, [designId, refinementRunId, roundState]);

  function handleDownloadFinalGuidance() {
    if (!finalGuidance) return;
    const blob = new Blob([finalGuidance], {
      type: "text/markdown;charset=utf-8",
    });
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

  // Requests the repair-guidance document from the refinement run. Sent once
  // per design/calibration round — the dedupe ref keeps repeated clicks from
  // re-asking while the agent is still producing it.
  const guidanceRequestedRef = useRef<string | null>(null);
  const [guidanceError, setGuidanceError] = useState("");

  async function handleFinishCalibration() {
    setGuidanceError("");
    try {
      await finishCalibration({ runId });
    } catch (err) {
      console.error("Could not render the final model:", err);
      return;
    }
    if (guidanceRequestedRef.current === designId) {
      return;
    }
    const measurements = parameters
      .filter((parameter) => confirmedValues[parameter.name] !== undefined)
      .map((parameter) => {
        const value = confirmedValues[parameter.name];
        return `- ${parameter.name}: ${value}${parameter.unit ? ` ${parameter.unit}` : ""}`;
      })
      .join("\n");
    const body = [
      "Calibration is complete and the final model has been rendered.",
      "Produce the final repair guidance document now.",
      measurements
        ? `Confirmed measurements:\n${measurements}`
        : "No parameters were adjusted during calibration.",
    ].join("\n");
    guidanceRequestedRef.current = designId;
    setRoundCommitted(true);
    try {
      await sendMessageRefinement(body);
    } catch (err) {
      console.error("Could not request final guidance:", err);
      guidanceRequestedRef.current = null;
      /* Reverts the round to its pre-commit shape so marker 7 re-locks;
         the render-phase sync below then holds it if the run switched. */
      setRoundCommitted(false);
      setGuidanceError(
        refinementError || "Could not request the final repair guidance.",
      );
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
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(null);

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
    afterCadRunExists: refinementRunId !== null,
    roundState,
  };
  const { states: stepStates, reasons: stepReasons } = timelineStepStates(
    cadNav,
    CAD_SCREEN,
  );

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
    <Page
      currentStep={currentCADStep}
      bleed={phase === "choosing"}
      onAllRuns={onAllRuns}
      onStepClick={handleTimelineStep}
      clickStates={stepStates}
      reasons={stepReasons}
    >
      {entryChecking ? (
        <div className="flex min-h-[480px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white">
          <div className="flex flex-col items-center justify-center p-6 text-center text-ink-soft">
            <div className="cad-spinner" />
            <p>Checking for an existing design…</p>
          </div>
        </div>
      ) : entryMissing ? (
        <div className="flex min-h-[480px] w-full flex-1 items-center justify-center overflow-hidden">
          <div className="flex max-w-[520px] flex-col items-center px-6 text-center text-ink-soft">
            <strong>Your repair design is ready for generation.</strong>
            <button
              type="button"
              className="mt-4.5 bg-brand px-5 py-3 font-semibold text-white shadow-[0_1px_2px_rgba(29,58,153,0.25)] hover:bg-brand-dark"
              onClick={() => generate({ handoffs, runId })}
            >
              Continue
            </button>
          </div>
        </div>
      ) : phase === "error" ? (
        <div className="relative flex min-h-[480px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white">
          <div className="max-w-[420px] p-6 text-center text-[#ffb4b4]">
            <strong className="mb-2 block text-lg">
              Forge could not generate the model.
            </strong>
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
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/*
              Bleed mode: Page's <main> doesn't scroll, the tile region
              here does. The bar below is a regular pinned flex row —
              the bar sits flush against the bottom edge just like
              the top row with the pinned progress.
            */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 max-[640px]:px-5">
            <div className="shrink-0">
              <h1 className="pt-6 text-[30px]">
                Choose a rough shape for the design
              </h1>
              <p className="mb-4 text-[17px] leading-relaxed text-muted">
                Several candidates were generated from your repair handoff.
                Select the one you want — the other candidates are kept while
                you decide. This step is only about getting the right{" "}
                <strong>shape</strong> — the next step will ask you for accurate
                measurements, so no need to judge the exact dimensions here.
              </p>
            </div>
            <div className="mb-4">
              <DesignPicker
                key={pickerKey}
                variants={variants}
                selectedId={pickerSelectedId}
                onSelected={setPickerSelectedId}
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-6 py-4 max-[640px]:px-5">
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
        <div className="flex min-h-[600px] flex-1 flex-col gap-6 pt-6 lg:flex-row lg:items-stretch">
          <ViewportFrame
            className="min-w-0 flex-1"
            model={model}
            generating={isLoading}
            fitKey={designId}
            designId={designId}
            guides={guides}
            guideVisible={guideVisible}
            guideFrame={guideFrame}
            spinnerLabel={spinnerLabel}
            dimmed={modelPending}
          />

          {statusMessage !== "" ? (
            <p className="shrink-0 text-[12px] leading-snug text-red-600">
              {statusMessage}
            </p>
          ) : null}
          {buildReport && buildReport.trim() !== "" ? (
            <pre className="shrink-0 max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-left font-mono text-[11px] leading-snug whitespace-pre-wrap text-red-700">
              {buildReport}
            </pre>
          ) : null}
          <CalibrationPanel
            className="w-full lg:min-w-0 lg:flex-1"
            parameters={parameters}
            confirmedValues={confirmedValues}
            settingParam={settingParam ?? (busy ? "busy" : null)}
            onConfirm={(parameter, value) =>
              handleConfirmParam(parameter.name, value)
            }
            onFinish={handleFinishCalibration}
            activeParam={activeGuideParam}
            onSelectGuides={setActiveGuideParam}
            onShowGuideCamera={showGuideCamera}
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
                {phase === "ready"
                  ? "Provisional CAD model"
                  : "Generating model..."}
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
                Final fabrication, assembly, and installation guidance for this
                repair.
              </p>
            </div>
            {finalGuidance && (
              <button
                type="button"
                className="btn-secondary max-[800px]:w-full"
                onClick={handleDownloadFinalGuidance}
              >
                Download instructions
              </button>
            )}
          </div>

          {finalGuidance ? (
            <div className="markdown-body max-h-[40vh] overflow-y-auto overscroll-contain rounded-[10px] border border-line bg-white p-5 leading-[1.65]">
              <ReactMarkdown>{finalGuidance}</ReactMarkdown>
            </div>
          ) : (
            <div
              className={
                guidanceError
                  ? "rounded-[10px] border border-dashed border-red-300 bg-white p-5 leading-relaxed text-red-700"
                  : "rounded-[10px] border border-dashed border-[#cbd0d6] bg-white p-5 leading-relaxed text-[#7a828d]"
              }
            >
              {guidanceError ||
                (refinementRunId
                  ? "The repair guidance document is being generated and will appear here the moment it arrives."
                  : "Final repair instructions will appear here when the repair design is complete.")}
            </div>
          )}
        </section>
      )}
    </Page>
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
  guideFrame = null,
  spinnerLabel,
  dimmed,
  className,
}: {
  model: GlbModel | null;
  generating: boolean;
  fitKey: string | null;
  designId: string | null;
  guides: Guide[];
  guideVisible: (name: string) => boolean;
  /** Only the calibrating row wires this — the guide reframe. */
  guideFrame?: GuideFrameRequest | null;
  spinnerLabel: string;
  dimmed: boolean;
  /** Extra sizing classes for the frame (e.g. the 1/3 column share on
   *  wide screens). */
  className?: string;
}) {
  return (
    <div
      className={`relative flex min-h-[420px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white max-lg:h-[560px] ${className ?? ""}`}
    >
      {model !== null ? (
        <CadCanvas
          generating={generating}
          fitKey={fitKey}
          fitModel={model}
          designId={designId ?? undefined}
          guides={guides}
          guideVisible={guideVisible}
          guideFrame={guideFrame}
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
          <p className="mt-1.5 text-[13px] text-[#8a93a1]">
            This can take a minute while Forge works.
          </p>
        </div>
      )}

      {dimmed && (
        <div
          className="pointer-events-none absolute inset-0 bg-white/60"
          title="Applying the change…"
        >
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
    screens, stretched to the row's height; all three columns share the row
    equally (basis-0 flex-1). When stacked (narrow screens) the aside keeps a
    fixed share of the viewport so the iframe still has a definite height.
  */
  return (
    <aside className="flex h-[75dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white lg:h-auto lg:min-h-[420px] lg:flex-1 lg:self-stretch">
      <div className="shrink-0 border-b border-line-soft px-5 py-4.5">
        <h2 className="mb-1.5 text-lg">Refine your repair</h2>
        <p className="m-0 text-sm leading-[1.45] text-muted-2">{intro}</p>
      </div>

      {refinementInitializing && (
        <div className="p-4.5 text-sm text-muted-2">
          Starting refinement assistant—
        </div>
      )}

      {refinementError && (
        <div className="m-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
          {refinementError}
        </div>
      )}

      {refinementRunId && (
        <div className="min-h-0 flex-1">
          <FlowChatFrame runId={refinementRunId} title="CAD refinement" />
        </div>
      )}
    </aside>
  );
}
