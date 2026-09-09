"use client";

import ReactMarkdown from "react-markdown";
import { Stage } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";

import RepairProgress from "@/components/RepairProgress";
import { AppHeader, AppShell, Card } from "@/components/AppShell";
import { FlowChatFrame } from "@/features/chat/FlowChatEmbed";
import { useRefinementRun } from "@/hooks/useRefinementRun";
import { useForge } from "@/hooks/useForge";
import { useDesignExists } from "@/hooks/useDesignExists";
import { getDesign3mfBytes } from "@/lib/forgeClient";
import { formatParamName } from "@/lib/forgeParams";
import {
  CadCanvas,
  DesignPicker,
  Model,
  SweepPlayer,
  type Playhead,
} from "./viewport";
import CalibrationPanel, {
  useActiveSweep,
  useSweepReadout,
} from "./CalibrationPanel";

interface CadModelViewProps {
  handoffMarkdown: string;
  runId: string | null;
  onBack: () => void;
  onNewRun: () => void;
  onViewRuns: () => void;
  onLogout: () => void;
}

/*
  Screen 6 — the Forge workspace. Renders the provisional CAD model produced
  from the RepairCAD handoff document, the variant picker while candidates
  stream in, the calibration wizard with per-parameter sweep previews, the
  refinement chat (a second Flow run), and the final repair instructions.
  The same <Canvas> instance hosts every phase, so the camera keeps its
  orientation throughout.
*/
export default function CadModelView({
  handoffMarkdown,
  runId,
  onBack,
  onNewRun,
  onViewRuns,
  onLogout,
}: CadModelViewProps) {
  const forge = useForge();
  const {
    phase,
    mesh,
    error,
    parameters,
    statusMessage,
    variants,
    designId,
    busy,
    paramSweeps,
    confirmedValues,
    generate,
    rehydrate,
    refineExistingDesign,
    duplicateAndRefine,
    chooseDesign,
    confirmParamValue,
    finishCalibration,
    reset,
  } = forge;

  /*
    Entry check: render a persisted design/variant set immediately (no LLM
    call) and never start a generation automatically — when nothing exists
    the user must press Generate.
  */
  const { checking: entryChecking, missing: entryMissing } = useDesignExists({
    phase,
    rehydrate,
    reset,
    runId,
    handoffMarkdown,
  });

  /*
    Second Flow conversation used for iterative CAD refinement. It is
    separate from the initial RepairCAD reasoning run. Once Forge has created
    or rehydrated a design, the refinement run receives both the provisional
    requirements document and this Forge design's ID. It must also be
    reachable during the "choosing" phase — the chat is the single place the
    user talks to the assistant while picking between candidates; designId
    stays null while choosing, so the picker's source design is passed.
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
    if (!handoffMarkdown?.trim()) return;
    const effectiveDesignId = designId ?? variants[0]?.designId ?? null;
    if (!effectiveDesignId) return;
    initializeRefinement({
      handoffMarkdown,
      designId: effectiveDesignId,
    }).catch((err) => {
      console.error("Could not start refinement conversation:", err);
    });
  }, [handoffMarkdown, designId, variants, initializeRefinement]);

  // Keep the refinement run synchronized so forge_instruction / final_guidance
  // produced by R3 becomes visible to this component.
  useEffect(() => {
    if (!refinementRunId) return;
    reconcileRefinement();
    const interval = setInterval(() => reconcileRefinement(), 2000);
    return () => clearInterval(interval);
  }, [refinementRunId, reconcileRefinement]);

  const lastProcessedForgeInstructionRef = useRef<string | null>(null);

  // Candidate the user last highlighted in the picker; chat-driven feedback
  // rounds target it.
  const lastSelectedDesignIdRef = useRef<string | null>(null);
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(null);
  const [iteratingFeedback, setIteratingFeedback] = useState(false);

  /*
    When R3 produces a new Forge instruction, apply it to the Forge design.
    While calibrating/ready this regenerates the existing design via
    refineExistingDesign(); during "choosing" the instruction is applied as a
    feedback round on the currently selected candidate instead.
  */
  useEffect(() => {
    const instruction = refinementRunningDoc?.forge_instruction?.trim();
    if (!instruction || busy || iteratingFeedback) return;
    if (phase !== "ready" && !(phase === "choosing" && variants.length > 0)) {
      return;
    }
    // Do not send the same R3 output to Forge more than once. Mark it before
    // starting the async request so polling cannot start the same turn again
    // while the first request is in flight.
    if (lastProcessedForgeInstructionRef.current === instruction) return;
    lastProcessedForgeInstructionRef.current = instruction;

    if (phase === "choosing") {
      // A feedback instruction always iterates the highlighted design — even
      // while other candidates are still streaming; the new round unparks and
      // replaces them all.
      const sourceDesignId =
        pickerSelectedId ?? lastSelectedDesignIdRef.current ?? variants[0]?.designId ?? null;
      if (sourceDesignId === null) {
        lastProcessedForgeInstructionRef.current = null;
        return;
      }
      setIteratingFeedback(true);
      // The new round replaces the candidates — nothing stays selected.
      lastSelectedDesignIdRef.current = null;
      setPickerSelectedId(null);
      duplicateAndRefine({
        feedback: instruction,
        sourceDesignId,
        runId,
      }).finally(() => {
        setIteratingFeedback(false);
      });
      return;
    }

    refineExistingDesign({ instruction, runId }).then((success) => {
      if (!success) {
        // Allow the same instruction to be retried if Forge failed.
        lastProcessedForgeInstructionRef.current = null;
      }
    });
  }, [
    refinementRunningDoc,
    phase,
    variants,
    iteratingFeedback,
    busy,
    runId,
    pickerSelectedId,
    duplicateAndRefine,
    refineExistingDesign,
  ]);

  // Calibration input is awaiting the user exactly during the calibrating phase.
  const awaitingInput = phase === "calibrating";
  const isLoading = phase === "initializing" || phase === "finalizing";

  let spinnerLabel = statusMessage;
  if (phase === "initializing" && spinnerLabel === "") {
    spinnerLabel = "Generating initial model...";
  } else if (phase === "finalizing" && spinnerLabel === "") {
    spinnerLabel = "Finalising model with your measurements...";
  }

  /*
    Sweep playback: the name of the parameter whose rendered sweep is playing
    in the viewport (null = default model). Each row's "Preview sweep" button
    selects it; the flipbook loops until another parameter is chosen, a value
    is set, or the row's button is toggled off.
  */
  const [sweepingParam, setSweepingParam] = useState<string | null>(null);
  const { frameValues, frameMeshes } = useActiveSweep(sweepingParam, paramSweeps);

  const playheadRef = useRef<Playhead>({ pos: 0, index: 0 });
  const sweepValueRef = useSweepReadout(sweepingParam, frameValues, playheadRef);

  function handlePreviewSweep(paramName: string) {
    setSweepingParam((prev) => (prev === paramName ? null : paramName));
  }

  function handleRegenerate() {
    if (busy) return;
    const ok = window.confirm(
      "Regenerate the model from scratch?\n\nAny measurements you have already entered will be reset and the current design will be discarded. This cannot be undone.",
    );
    if (!ok) return;
    reset();
    generate({ handoffMarkdown, runId });
  }

  const finalGuidance = refinementRunningDoc?.final_guidance?.trim() ?? "";

  function handleDownloadFinalGuidance() {
    if (!finalGuidance) return;
    const blob = new Blob([finalGuidance], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "repaircad-final-instructions.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDownload3mf() {
    if (designId === null) return;
    try {
      const bytes = await getDesign3mfBytes(designId);
      if (bytes === null) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: "model/3mf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `repaircad-${designId}.3mf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("3MF download failed:", err);
    }
  }

  const pickerKey = useMemo(
    () => variants.map((v) => v.designId).join(","),
    [variants],
  );

  const showFinalGuidanceSection = phase === "ready";

  return (
    <AppShell fill>
      <Card fill className="!max-w-[1500px]">
        <AppHeader
          utilities={
            <>
              <button type="button" className="btn-utility" onClick={onNewRun}>
                New run
              </button>
              <button type="button" className="btn-utility" onClick={onViewRuns}>
                All runs
              </button>
              <button type="button" className="btn-ghost" onClick={onLogout}>
                Sign out
              </button>
            </>
          }
        />

        <div className="mb-6 shrink-0">
          <button type="button" className="btn-secondary" onClick={onBack}>
            ← Back to chat
          </button>
          <RepairProgress currentStep={finalGuidance ? 6 : 5} />
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
                onClick={() => generate({ handoffMarkdown, runId })}
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
                  generate({ handoffMarkdown, runId });
                }}
              >
                Try again
              </button>
            </div>
          </div>
        ) : phase === "choosing" ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
              <section className="min-h-0 min-w-0 flex-1">
                <div className="mb-6">
                  <h1 className="text-[30px]">Choose a rough shape for the design</h1>
                  <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
                    Several candidates were generated from your repair handoff.
                    Pick the one to continue with. This step is only about getting
                    the right <strong>shape</strong> — the next step will ask you
                    for accurate measurements, so no need to judge the exact
                    dimensions here.
                  </p>
                </div>
                <DesignPicker
                  key={pickerKey}
                  variants={variants}
                  onSelect={(selectedDesignId) => {
                    lastSelectedDesignIdRef.current = selectedDesignId;
                    setPickerSelectedId(selectedDesignId);
                  }}
                />
              </section>

              <RefinementChat
                refinementRunId={refinementRunId}
                refinementInitializing={refinementInitializing}
                refinementError={refinementError}
                disabled={pickerSelectedId === null}
                disabledMessage="Select a design first…"
                intro="Ask RepairCAD to change the model, clarify a measurement, or pick apart a candidate. Messages here steer the Forge design. This step is about the right shape only — accurate measurements come in the next step."
              />
            </div>

            <div className="flex w-full shrink-0 flex-col items-start gap-2.5 rounded-xl border border-line-soft bg-surface p-5">
              {(() => {
                const chosenVariant = variants.find(
                  (v) => v.designId === pickerSelectedId,
                );
                const chosenUnfinished =
                  chosenVariant !== undefined &&
                  (chosenVariant.mesh === null || chosenVariant.status !== "ready");
                return (
                  <button
                    type="button"
                    className="w-full bg-brand px-5 py-3 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(29,58,153,0.25)] hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[#b9bec7]"
                    disabled={pickerSelectedId === null || chosenUnfinished}
                    onClick={() => chooseDesign(pickerSelectedId)}
                  >
                    {pickerSelectedId === null
                      ? "Select a design above to continue"
                      : chosenUnfinished
                        ? "Design is still generating…"
                        : `I'm happy with Design ${variants.findIndex((v) => v.designId === pickerSelectedId) + 1}`}
                  </button>
                );
              })()}
              <p className="mt-0 text-[13px] text-[#8a93a1]">
                Continues to calibration on the design you pick; the other
                candidates are discarded.
              </p>
            </div>
          </div>
        ) : awaitingInput ? (
          <div className="flex min-h-[600px] flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
            <div className="relative flex min-h-[420px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white max-lg:h-[560px]">
              <CadCanvas generating={isLoading} fitKey={designId} fitMesh={mesh}>
                {sweepingParam !== null && frameMeshes.length > 0 ? (
                  <Stage adjustCamera={false}>
                    <SweepPlayer frames={frameMeshes} paused={false} playheadRef={playheadRef} />
                  </Stage>
                ) : mesh !== null ? (
                  <Stage adjustCamera={false}>
                    <Model mesh={mesh} />
                  </Stage>
                ) : null}
              </CadCanvas>

              {sweepingParam !== null && frameMeshes.length > 0 && (
                <div className="pointer-events-none absolute bottom-3.5 left-3.5 flex items-baseline gap-2.5 rounded-lg border border-line-soft bg-white/85 px-3.5 py-2 text-ink-soft">
                  <span className="text-[13px] text-muted">
                    {formatParamName(sweepingParam)}
                  </span>
                  <span ref={sweepValueRef} className="text-base font-bold text-[#9db4ff] tabular-nums" />
                </div>
              )}

              {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 p-6 text-center text-ink-soft">
                  <div className="cad-spinner" />
                  <p>{spinnerLabel}</p>
                  <p className="mt-1.5 text-[13px] text-[#8a93a1]">This can take a minute while Forge works.</p>
                </div>
              )}
            </div>

            <CalibrationPanel
              parameters={parameters}
              paramSweeps={paramSweeps}
              confirmedValues={confirmedValues}
              settingParam={null}
              sweepingParam={sweepingParam}
              onConfirm={confirmParamValue}
              onPreviewSweep={handlePreviewSweep}
              onFinish={() => finishCalibration({ runId })}
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

              <div className="relative flex min-h-[420px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-white max-lg:h-[560px]">
                <CadCanvas generating={isLoading} fitKey={designId} fitMesh={mesh}>
                  {mesh !== null ? (
                    <Stage adjustCamera={false}>
                      <Model mesh={mesh} />
                    </Stage>
                  ) : null}
                </CadCanvas>

                {isLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 p-6 text-center text-ink-soft">
                    <div className="cad-spinner" />
                    <p>{spinnerLabel}</p>
                    <p className="mt-1.5 text-[13px] text-[#8a93a1]">This can take a minute while Forge works.</p>
                  </div>
                )}
              </div>

              {phase === "ready" && (
                <div className="mt-6 flex shrink-0 gap-3">
                  {designId !== null && (
                    <button type="button" className="btn-secondary" onClick={handleDownload3mf}>
                      Download 3MF
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

            <RefinementChat
              refinementRunId={refinementRunId}
              refinementInitializing={refinementInitializing}
              refinementError={refinementError}
              intro="Ask RepairCAD to change the model, clarify a measurement, or inspect the current repair design."
            />
          </div>
        )}

        {showFinalGuidanceSection && (
          <section className="mt-6 shrink-0 rounded-xl border border-line bg-surface p-6">
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

function RefinementChat({
  refinementRunId,
  refinementInitializing,
  refinementError,
  intro,
  disabled = false,
  disabledMessage,
}: {
  refinementRunId: string | null;
  refinementInitializing: boolean;
  refinementError: string;
  intro: string;
  disabled?: boolean;
  disabledMessage?: string;
}) {
  /*
    On desktop the aside takes an even half of the phase row, stretching to
    the row's height (the row itself has a min-height floor, so the
    transcript always keeps a usable area); the model column flexes to the
    other half. When the row is stacked (narrow screens) the aside keeps a
    fixed share of the viewport so the iframe still has a definite height.
  */
  return (
    <aside className="flex h-[75dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white lg:h-auto lg:w-1/2 lg:min-h-[420px] lg:shrink-0 lg:self-stretch">
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
            title="RepairCAD CAD refinement"
            disabled={disabled}
            disabledMessage={disabledMessage}
          />
        </div>
      )}
    </aside>
  );
}
