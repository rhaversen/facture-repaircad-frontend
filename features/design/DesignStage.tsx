"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Page from "@/components/Page";
import Picker from "./Picker";
import Workspace from "./Workspace";
import { createDesign, errorText, sendDesignMessage, uploadImages } from "@/lib/forge";
import { fetchMessages, handoffsOf, photoFilesOf, referencePhotoParts } from "@/lib/flow";
import { loadDesigns, storeDesigns } from "@/lib/store";
import type { FlowRun } from "@/lib/types";

/* One design per handoff. The ids are stored only once every brief was sent,
   so a stored design always has its generation turn behind it.
   The run's reference photos (exactly the ones the document's
   forge_reference_photos names, none if it names none) are uploaded to Forge once and
   attached to every generation turn, so the Forge agent starts from the
   actual repair photos. */
async function generateDesigns(run: FlowRun, handoffs: string[]): Promise<string[]> {
  const messages = await fetchMessages(run._id);
  const photoFiles = await photoFilesOf(referencePhotoParts(run.runningDoc, messages));
  const imageIds = await uploadImages(photoFiles);
  const ids = await Promise.all(handoffs.map(() => createDesign()));
  await Promise.all(ids.map((id, i) => sendDesignMessage(id, handoffs[i], imageIds)));
  return ids;
}

/*
  Steps 5–7. The designs are the only state worth keeping (their ids are in
  localStorage, their content on Forge); which one is open, and whether the
  final view is showing, are plain view state that a refresh drops back to
  the picker.

  The workspace is keyed by design, so switching designs swaps the whole
  workspace; each design brings back its own AfterForge conversation.
*/
export default function DesignStage({ run, onAllRuns }: { run: FlowRun; onAllRuns: () => void }) {
  const handoffs = useMemo(() => handoffsOf(run.runningDoc), [run.runningDoc]);
  const [designIds, setDesignIds] = useState(() => loadDesigns(run._id));
  const [error, setError] = useState("");
  const [designId, setDesignId] = useState<string | null>(null);
  const [view, setView] = useState<"pick" | "edit" | "final">("pick");
  const generating = useRef(false);

  const generate = useCallback(() => {
    if (generating.current) return;
    generating.current = true;
    generateDesigns(run, handoffs)
      .then((ids) => {
        storeDesigns(run._id, ids);
        setDesignIds(ids);
      })
      .catch((err) => setError(errorText(err, "Forge could not start the designs.")))
      .finally(() => {
        generating.current = false;
      });
  }, [run, handoffs]);

  useEffect(() => {
    if (designIds.length === 0) generate();
  }, [designIds.length, generate]);

  const edit = (id: string) => {
    setDesignId(id);
    setView("edit");
  };

  const step = view === "pick" ? 5 : view === "edit" ? 6 : 7;
  const progress = {
    step,
    backTo: view === "final" ? [5, 6] : view === "edit" ? [5] : [],
    onStep: (n: number) => (n === 5 ? setView("pick") : edit(designId!)),
  };

  if (view !== "pick" && designId !== null) {
    const index = Math.max(0, designIds.indexOf(designId));
    return (
      <Page progress={progress} onAllRuns={onAllRuns}>
        <Workspace
          key={designId}
          designId={designId}
          handoff={handoffs[index] ?? handoffs[0]}
          handoffVariant={`forge_handoff_${index + 1}`}
          designIntent={run.runningDoc?.fabrication_design_intent ?? ""}
          final={view === "final"}
          onFinal={() => setView("final")}
        />
      </Page>
    );
  }

  return (
    <Page progress={progress} onAllRuns={onAllRuns} bleed>
      {designIds.length > 0 ? (
        <Picker
          designIds={designIds}
          handoffs={handoffs}
          initial={designId}
          onContinue={edit}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-ink-soft">
          {error ? (
            <>
              <strong className="mb-2 text-lg">Forge could not start the designs.</strong>
              <p className="text-muted">{error}</p>
              <button
                type="button"
                className="mt-4"
                onClick={() => {
                  setError("");
                  generate();
                }}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <div className="cad-spinner" />
              <p>Starting the designs…</p>
            </>
          )}
        </div>
      )}
    </Page>
  );
}
