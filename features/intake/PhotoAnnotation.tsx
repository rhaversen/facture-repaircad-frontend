"use client";

import AnnotationCanvas from "./AnnotationCanvas";
import { CloseIcon } from "@/components/icons";
import { Button, cn, inputClass } from "@/components/ui";
import type { Intake } from "@/hooks/useIntake";
import { UNITS } from "@/lib/intake";
import type { Unit } from "@/lib/types";

/*
  Photo strip, drawing canvas and annotation list, shared by the intake
  wizard (with size references) and the clarification form (compact, with
  removable photos).
*/
export default function PhotoAnnotation({
  intake,
  compact = false,
  sizeReference = false,
  removable = false,
}: {
  intake: Intake;
  compact?: boolean;
  sizeReference?: boolean;
  removable?: boolean;
}) {
  const { photos, annotations, activePhoto } = intake;
  if (activePhoto === null) return null;
  const own = annotations.filter((a) => a.photoId === activePhoto.id);
  // Below the breakpoint the photo list becomes a horizontal strip; the
  // compact layout (inside a form) collapses at a narrower width.
  const strip = compact
    ? { list: "max-[640px]:flex-row max-[640px]:overflow-x-auto max-[640px]:p-1", card: "max-[640px]:min-w-[120px]" }
    : { list: "max-[1000px]:flex-row max-[1000px]:overflow-x-auto max-[1000px]:p-1", card: "max-[1000px]:min-w-[120px]" };

  return (
    <div
      className={
        compact
          ? "grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-4 max-[640px]:grid-cols-1"
          : "grid grid-cols-[180px_minmax(0,1fr)_340px] items-start gap-6 max-[1000px]:grid-cols-1"
      }
    >
      <aside className={`flex min-w-0 flex-col gap-3 ${strip.list}`}>
        {photos.map((photo) => (
          <div key={photo.id} className={`flex flex-col gap-1 ${strip.card}`}>
            <button
              type="button"
              title={photo.file.name}
              className={cn(
                "block w-full cursor-pointer overflow-hidden rounded-xl bg-surface-2 transition-shadow",
                photo.id === activePhoto.id ? "ring-2 ring-accent" : "opacity-70 hover:opacity-100",
              )}
              onClick={() => intake.setActivePhoto(photo.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={photo.file.name} className="block h-[90px] w-full object-cover" />
            </button>
            {removable && (
              <Button variant="ghost" size="sm" onClick={() => intake.removePhoto(photo.id)}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </aside>

      <section className="min-w-0">
        <AnnotationCanvas
          imageUrl={activePhoto.previewUrl}
          alt={activePhoto.file.name}
          annotations={own}
          draftBox={intake.draftBox}
          canvasRef={intake.canvasRef}
          pointerHandlers={intake.pointerHandlers}
          className={compact ? "max-h-[34vh]" : undefined}
        />
      </section>

      <aside className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-4">
        <h2 className="text-sm font-medium text-muted">Marks</h2>
        {own.length === 0 && <p className="text-sm text-subtle">Drag on the photo to add one.</p>}

        {own.map((annotation) => (
          <div
            key={annotation.id}
            className="flex items-start gap-2 rounded-xl bg-surface-2 p-2.5"
            style={{ boxShadow: `inset 3px 0 0 ${annotation.color}` }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2 pl-1">
              <input
                className={cn(inputClass, "h-9 bg-surface font-medium")}
                style={{ color: annotation.color }}
                value={annotation.label}
                onChange={(event) => intake.updateAnnotation(annotation.id, { label: event.target.value })}
                placeholder="Name this mark"
              />

              {sizeReference && (
                <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={annotation.sizeReference !== null}
                    onChange={(event) =>
                      intake.updateAnnotation(annotation.id, {
                        sizeReference: event.target.checked ? { knownDimension: 0, unit: "mm" } : null,
                      })
                    }
                  />
                  Size reference
                </label>
              )}

              {sizeReference && annotation.sizeReference && (
                <div className="grid grid-cols-[1fr_80px] items-end gap-2">
                  <input
                    className={cn(inputClass, "h-9 bg-surface")}
                    type="number"
                    min="0"
                    step="any"
                    value={annotation.sizeReference.knownDimension || ""}
                    onChange={(event) =>
                      intake.updateAnnotation(annotation.id, {
                        sizeReference: {
                          unit: annotation.sizeReference!.unit,
                          knownDimension: Number(event.target.value) || 0,
                        },
                      })
                    }
                    placeholder="e.g. 24.26"
                  />
                  <select
                    className={cn(inputClass, "h-9 bg-surface px-2")}
                    value={annotation.sizeReference.unit}
                    onChange={(event) =>
                      intake.updateAnnotation(annotation.id, {
                        sizeReference: {
                          knownDimension: annotation.sizeReference!.knownDimension,
                          unit: event.target.value as Unit,
                        },
                      })
                    }
                  >
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <button
              type="button"
              title="Delete"
              aria-label="Delete this mark"
              className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
              onClick={() => intake.deleteAnnotation(annotation.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </aside>
    </div>
  );
}
