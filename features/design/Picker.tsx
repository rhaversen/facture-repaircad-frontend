"use client";

import { useState } from "react";

import { CadCanvas } from "./viewport";
import { CheckIcon, NextIcon } from "@/components/icons";
import { Button, cn, Title } from "@/components/ui";
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
          <Title subtitle="Pick the closest shape. Sizes come next.">Pick a design</Title>
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
      </div>
      <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-sm text-muted">{number > 0 ? `Design ${number}` : "Pick one to continue"}</span>
          <Button variant="primary" disabled={selected === null} onClick={() => onContinue(selected!)}>
            Continue
            <NextIcon size={16} />
          </Button>
        </div>
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
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-surface p-3 transition-colors",
        selected ? "border-accent ring-2 ring-accent-soft" : "border-border/70 hover:border-border-strong",
      )}
    >
      <div className="relative h-[360px] overflow-hidden rounded-xl bg-viewport max-[900px]:h-[300px]">
        {model && <CadCanvas model={model} autoRotate />}
        {overlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
            {!missing && !failed && <div className="cad-spinner" />}
            <p>{overlay}</p>
            {failed && <Button onClick={() => void send(handoff)}>Try again</Button>}
          </div>
        )}
        {model && running && (
          <span className="absolute top-2 left-2 rounded-full bg-surface/90 px-2.5 py-1 text-xs text-muted">
            Still working…
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2.5 pl-1">
        <span className="text-sm font-medium">Design {number}</span>
        <Button
          size="sm"
          variant={selected ? "primary" : "secondary"}
          className={selected ? "disabled:opacity-100" : undefined}
          disabled={!ready || selected}
          onClick={onSelect}
        >
          {selected && <CheckIcon size={14} />}
          {selected ? "Selected" : ready ? "Select" : missing || failed ? "Unavailable" : "Generating…"}
        </Button>
      </div>
    </div>
  );
}
