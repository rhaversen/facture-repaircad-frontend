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
import { createRun, resolvePipelines, sendMessage } from "@/lib/flow";
import { errorText, fetchStepContext } from "@/lib/forge";
import { bootstrapMessage, guidanceRequest, viewFiles } from "@/lib/refinement";

/*
  Steps 6 and 7 for one picked design. The AfterForge assistant is started
  fresh, with Forge's current step context for the design, on entry and again
  after every Forge turn finishes, so it always talks about the design as it
  now is. Each forge_instruction it produces is sent straight to this design;
  while Forge works, the chat and the parameters are locked. The final view
  asks the current assistant for the repair guidance.
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

  // ── The AfterForge assistant, one per settled design state ──
  const [assistant, setAssistant] = useState<{ runId: string; forTurn: number } | null>(null);
  const [refinementError, setRefinementError] = useState("");
  const startedFor = useRef(-1);
  const loaded = design.design !== null;
  useEffect(() => {
    if (!loaded || busy || startedFor.current === turnsDone) return;
    startedFor.current = turnsDone;
    (async () => {
      const stepContext = await fetchStepContext(designId);
      const views = await viewFiles(stepContext.images);
      const run = await createRun((await resolvePipelines()).refinement);
      await sendMessage(
        run._id,
        bootstrapMessage({ designId, handoff, handoffVariant, designIntent, parameters, stepContext }),
        views,
      );
      // A Forge turn that finished meanwhile already asked for a newer one.
      if (startedFor.current !== turnsDone) return;
      setAssistant({ runId: run._id, forTurn: turnsDone });
      setRefinementError("");
    })().catch((err) => {
      console.error("Could not start the refinement assistant:", err);
      setRefinementError(errorText(err, "Could not start the refinement assistant."));
    });
  }, [loaded, busy, turnsDone, designId, handoff, handoffVariant, designIntent, parameters]);

  function restartAssistant() {
    startedFor.current = -1;
    setRefinementError("");
  }

  const refinementId = assistant?.forTurn === turnsDone ? assistant.runId : null;
  const refinement = useFlowRun(refinementId);
  const doc = refinement.run?.runningDoc;
  const refinementIdle = refinement.run !== null && refinement.run.status !== "running";

  // Each new instruction goes to the design once.
  const instruction = doc?.forge_instruction?.trim() ?? "";
  const applied = useRef("");
  useEffect(() => {
    if (instruction === "" || instruction === applied.current || busy) return;
    applied.current = instruction;
    void send(instruction);
  }, [instruction, busy, send]);

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
  const canFinish = model !== null && !busy && refinementIdle && !requesting;

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
        onChange={(name, value) => void design.setParameter(name, value)}
        activeGuide={activeGuide}
        onSelectGuide={setActiveGuide}
        onShowGuide={showGuide}
        hasGuides={(name) => design.guides.some((g) => g.param === name)}
        footer={
          <div className="flex flex-col items-end gap-1">
            <button type="button" disabled={!canFinish} onClick={getFinal}>
              {requesting ? "Requesting…" : "Get final model →"}
            </button>
            {finalError && <span className="text-[12px] text-red-600">{finalError}</span>}
          </div>
        }
      />

      <aside className="flex h-[75dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white lg:h-auto lg:flex-1">
        <div className="shrink-0 border-b border-line-soft px-5 py-4.5">
          <h2 className="mb-1.5 text-lg">Refine your repair</h2>
          <p className="m-0 text-sm leading-[1.45] text-muted-2">
            Ask to change the model, clarify a measurement, or inspect the current repair design.
          </p>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {refinementId && <FlowChat runId={refinementId} title="CAD refinement" />}
          {refinementError ? (
            <div className="m-4">
              <p className="error-box">{refinementError}</p>
              <button type="button" className="btn-secondary mt-3" onClick={restartAssistant}>
                Try again
              </button>
            </div>
          ) : (
            (busy || !refinementId) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/90 p-6 text-center text-sm text-muted-2">
                {(running || !refinementId) && <div className="cad-spinner" />}
                <p className="m-0">
                  {running
                    ? "Forge is updating the design. The assistant restarts with the new model when it is done."
                    : applying
                      ? "Applying your change…"
                      : model === null
                        ? "Loading the model…"
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
