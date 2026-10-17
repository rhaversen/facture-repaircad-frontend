"use client";

import { useState } from "react";

import { CadCanvas } from "./viewport";
import { useDesign } from "@/hooks/useDesign";

/*
  Step 5: the generated designs side by side, each live (a tile keeps
  following its design while Forge works on it). Designs keep every change
  made to them, so coming back here shows them as they are now.
*/
export default function Picker({
  designIds,
  handoffs,
  initial,
  onContinue,
}: {
  designIds: string[];
  handoffs: string[];
  initial: string | null;
  onContinue: (designId: string) => void;
}) {
  const [selected, setSelected] = useState(initial);
  const number = selected === null ? 0 : designIds.indexOf(selected) + 1;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 max-[640px]:px-5">
        <h1 className="pt-6 text-[30px]">Choose a rough shape for the design</h1>
        <p className="intro mb-4">
          Several candidates were generated from your repair plan. Select the one you want. This
          step is only about getting the right <strong>shape</strong>: the next step asks for
          accurate measurements, so no need to judge the exact dimensions here.
        </p>
        <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          {designIds.map((id, index) => (
            <Tile
              key={id}
              designId={id}
              handoff={handoffs[index] ?? handoffs[0]}
              number={index + 1}
              selected={id === selected}
              onSelect={() => setSelected(id)}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-6 py-4 max-[640px]:px-5">
        <span className="text-[14px] text-muted">
          {number > 0
            ? `Design ${number} is selected. Pick another tile to switch.`
            : "Select a design to continue."}
        </span>
        <button type="button" disabled={selected === null} onClick={() => onContinue(selected!)}>
          {number > 0 ? `Continue with Design ${number} →` : "Continue →"}
        </button>
      </div>
    </section>
  );
}

function Tile({
  designId,
  handoff,
  number,
  selected,
  onSelect,
}: {
  designId: string;
  handoff: string;
  number: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { design, missing, running, model, send } = useDesign(designId);
  const failed = running === false && design !== null && model === null && design.geometry === null;
  const ready = model !== null && running === false;

  let overlay: string | null = null;
  if (missing) overlay = "This design no longer exists.";
  else if (failed) overlay = "Forge could not generate this design.";
  else if (model === null) overlay = running ? "Generating…" : "Loading…";

  return (
    <div
      className={`flex flex-col gap-2.5 rounded-xl border-2 bg-white p-2.5 ${
        selected
          ? "border-brand shadow-[0_0_0_3px_rgba(36,72,184,0.15)]"
          : "border-line-soft hover:border-[#b9c2d0]"
      }`}
    >
      <div className="relative h-[380px] overflow-hidden rounded-lg border border-line-soft bg-white max-[900px]:h-[320px]">
        {model && <CadCanvas model={model} autoRotate />}
        {overlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-ink-soft">
            {!missing && !failed && <div className="cad-spinner" />}
            <p>{overlay}</p>
            {failed && (
              <button type="button" className="btn-secondary mt-3" onClick={() => void send(handoff)}>
                Try again
              </button>
            )}
          </div>
        )}
        {model && running && (
          <span className="absolute top-2 left-2 rounded bg-white/90 px-2 py-1 text-xs text-muted">
            Forge is still working…
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-sm font-semibold text-ink-soft">Design {number}</span>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-[13px] font-normal ${
            selected
              ? "border-brand disabled:bg-brand disabled:text-white"
              : "border-[#d5d9e0] bg-white text-muted hover:border-brand hover:bg-white hover:text-brand disabled:bg-white disabled:opacity-50"
          }`}
          disabled={!ready || selected}
          onClick={onSelect}
        >
          {selected ? "✓ Selected" : ready ? "Select" : missing || failed ? "Unavailable" : "Generating…"}
        </button>
      </div>
    </div>
  );
}
