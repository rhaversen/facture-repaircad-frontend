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
import { getDesignGeometry } from "@/lib/forgeClient";
import { formatParamName } from "@/lib/forgeParams";
import { MESH_QUALITY } from "@/lib/geometryBridge";
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
  handoffs,
  runId,
  shouldAutoGenerate = false,
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
    selectedHandoff,
    busy,
    paramSweeps,
    confirmedValues,
    generate,
    rehydrate,
    refineDesign,
    chooseDesign,
    confirmParamValue,
    finishCalibration,
    reset,
    iterations,
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
    const bootstrapHandoff = selectedHandoff ?? handoffs[0] ?? "";
    if (!bootstrapHandoff.trim()) return;
    if (designId === null) return;
    initializeRefinement({
      handoffMarkdown: bootstrapHandoff,
      designId,
    }).catch((err) => {
      console.error("Could not start refinement conversation:", err);
    });
  }, [selectedHandoff, handoffs, designId, initializeRefinement]);

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
    generate({ handoffs, runId });
  }

  const finalGuidance = refinementRunningDoc?.final_guidance?.trim() ?? "";

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

  async function handleDownloadMesh() {
    if (designId === null) return;
    try {
      // Geometry download = the wasm-ready solid nodes the client meshes from.
      const geometry = await getDesignGeometry(designId, { quality: MESH_QUALITY });
      if (geometry === null) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(geometry)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `design-${designId}.geometry.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Mesh download failed:", err);
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
              iterations={iterations}
              onSelect={(selectedDesignId) => {
                // Instant commit: the selected candidate continues into
                // calibration right away; unused candidates are stopped.
                chooseDesign(selectedDesignId);
              }}
            />
          </section>
        ) : phase === "calibrating" ? (
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
                    <button type="button" className="btn-secondary" onClick={handleDownloadMesh}>
                      Download mesh
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
