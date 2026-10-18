"use client";

import AnnotationCanvas from "./AnnotationCanvas";
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
    ? { list: "max-[640px]:flex max-[640px]:gap-2.5 max-[640px]:overflow-x-auto", heading: "max-[640px]:hidden", card: "max-[640px]:min-w-[140px]" }
    : { list: "max-[1000px]:flex max-[1000px]:gap-2.5 max-[1000px]:overflow-x-auto", heading: "max-[1000px]:hidden", card: "max-[1000px]:min-w-[140px]" };

  return (
    <div
      className={
        compact
          ? "grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-4 max-[640px]:grid-cols-1"
          : "grid grid-cols-[200px_minmax(0,1fr)_380px] items-start gap-7 max-[1000px]:grid-cols-1"
      }
    >
      <aside className={`min-w-0 ${strip.list}`}>
        <h2 className={`mb-3.5 text-base ${strip.heading}`}>Photos</h2>
        {photos.map((photo) => (
          <div key={photo.id} className={`mb-3 ${strip.card}`}>
            <button
              type="button"
              className={`block w-full rounded-[10px] border bg-white p-2 text-left text-ink hover:border-[#9db2e8] hover:bg-white ${
                photo.id === activePhoto.id
                  ? "border-2 border-brand shadow-[0_0_0_3px_rgba(36,72,184,0.12)]"
                  : "border-line-light"
              }`}
              onClick={() => intake.setActivePhoto(photo.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt={photo.file.name}
                className="mb-[7px] block h-[90px] w-full rounded-md object-cover"
              />
              <span className="block text-xs font-normal wrap-break-word">{photo.file.name}</span>
            </button>
            {removable && (
              <button
                type="button"
                className="btn-link w-full py-2"
                onClick={() => intake.removePhoto(photo.id)}
              >
                Remove
              </button>
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
        <p className="mt-2.5 text-sm text-[#6a717b]">
          Click and drag over an area, then release to finish the box.
        </p>
      </section>

      <aside className="min-w-0 rounded-xl border border-[#e5e8ec] bg-surface p-5 max-[1000px]:p-4">
        <h2>Annotations</h2>
        <p className="mt-2.5 text-sm text-[#6a717b]">
          Drag on the photo to add an annotation, then name it
          {sizeReference ? " and set its size" : ""} below.
        </p>

        {own.map((annotation) => (
          <div
            key={annotation.id}
            className="mt-2.5 flex items-start justify-between gap-2.5 border-b border-[#eceef1] py-2.5 pl-2.5"
            style={{ borderLeft: `4px solid ${annotation.color}` }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                className="w-full rounded-lg border-2 bg-white px-2 py-1.5 font-semibold"
                style={{ color: annotation.color, borderColor: annotation.color }}
                value={annotation.label}
                onChange={(event) => intake.updateAnnotation(annotation.id, { label: event.target.value })}
                placeholder="Name this annotation"
              />

              {sizeReference && (
                <label className="my-0 flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
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
                <div className="grid grid-cols-[1fr_90px] items-end gap-2.5">
                  <input
                    className="text-input"
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
                    className="mt-0"
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
              className="btn-link px-2.5 py-1.5 text-xs"
              onClick={() => intake.deleteAnnotation(annotation.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </aside>
    </div>
  );
}
