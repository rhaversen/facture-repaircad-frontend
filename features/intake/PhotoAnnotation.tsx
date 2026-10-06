"use client";

import AnnotationCanvas from "./AnnotationCanvas";
import { Fragment } from "react";
import { UNIT_OPTIONS } from "@/lib/intakeMessageUtils";
import type { IntakeController } from "@/hooks/useIntake";

interface PhotoAnnotationProps {
  intake: IntakeController;
  /* Sidebar variant: narrower responsive breakpoints for the embedded chat panel. */
  compact?: boolean;
  /* Size-reference controls (intake wizard only). */
  withSizeReference?: boolean;
  /* Per-photo Remove button (clarification only). */
  withRemovePhoto?: boolean;
  /* Alt text for the canvas image; defaults to the photo's file name. */
  imageAlt?: string;
  canvasHint?: string;
  panelHint?: string;
}

/*
  Shared photo-list + annotation-canvas + annotation-panel layout used by both
  the intake wizard's annotation screen and the clarification sidebar. Only
  the surrounding chrome (headers, progress, navigation) lives in the
  consumers.
*/
export default function PhotoAnnotation({
  intake,
  compact = false,
  withSizeReference = false,
  withRemovePhoto = false,
  imageAlt,
  canvasHint = "Click and drag over an area, then release to finish the box.",
  panelHint = "Drag on the photo to add an annotation, then name it and set its size below.",
}: PhotoAnnotationProps) {
  const {
    photos,
    activePhotoId,
    activePhoto,
    activeAnnotations,
    changeActivePhoto,
    draftBox,
    imageWrapperRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    updateAnnotation,
    updateAnnotationSizeReference,
    deleteAnnotation,
    removePhoto,
  } = intake;

  const gridClassName = compact
    ? "grid grid-cols-[minmax(0,1fr)] max-[330px]:grid-cols-[minmax(0,1fr)] min-[331px]:max-[640px]:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)] min-[641px]:grid-cols-[minmax(0,0.75fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
    : "grid grid-cols-[200px_minmax(0,1fr)_300px] items-start gap-7 max-[900px]:grid-cols-1";
  const asideWrapClassName = compact
    ? "min-w-0 max-[640px]:flex max-[640px]:gap-2.5 max-[640px]:overflow-x-auto"
    : "min-w-0 max-[900px]:flex max-[900px]:gap-2.5 max-[900px]:overflow-x-auto";
  const photosHeadingClassName = compact
    ? "mb-3.5 text-base max-[640px]:hidden"
    : "mb-3.5 text-base max-[900px]:hidden";
  const photoCardWidthClassName = compact
    ? "max-[640px]:min-w-[140px]"
    : "max-[900px]:min-w-[140px]";
  const panelClassName = compact
    ? "min-w-0 rounded-xl border border-[#e5e8ec] bg-surface p-5 max-[640px]:p-4"
    : "min-w-0 rounded-xl border border-[#e5e8ec] bg-surface p-5 max-[900px]:p-4";

  if (photos.length === 0) return null;

  return (
    <div className={gridClassName}>
      <aside className={asideWrapClassName}>
        <h2 className={photosHeadingClassName}>Photos</h2>

        {photos.map((photo) => {
          const card = (
            <button
              type="button"
              className={`mb-3 block w-full rounded-[10px] border bg-white p-2 text-left text-ink transition-colors hover:border-[#9db2e8] ${photoCardWidthClassName} ${
                photo.id === activePhotoId
                  ? "border-2 border-brand shadow-[0_0_0_3px_rgba(36,72,184,0.12)]"
                  : "border-line-light"
              }`}
              onClick={() => changeActivePhoto(photo.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={photo.file.name} className="mb-[7px] block h-[90px] w-full rounded-md object-cover" />
              <span className="block text-xs wrap-break-word">{photo.file.name}</span>
            </button>
          );

          return withRemovePhoto ? (
            <div className="mb-3" key={photo.id}>
              {card}

              <button
                type="button"
                className="w-full bg-transparent px-0 py-2 text-[#a22c2c] font-medium hover:bg-transparent hover:underline"
                onClick={() => removePhoto(photo.id)}
              >
                Remove
              </button>
            </div>
          ) : (
            <Fragment key={photo.id}>{card}</Fragment>
          );
        })}
      </aside>

      <section className="min-w-0 max-[330px]:mb-5">
        {activePhoto && (
          <>
            <AnnotationCanvas
              imageUrl={activePhoto.previewUrl}
              imageAlt={imageAlt ?? activePhoto.file.name}
              annotations={activeAnnotations}
              draftBox={draftBox}
              imageWrapperRef={imageWrapperRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
            <p className="mt-2.5 text-sm text-[#6a717b]">{canvasHint}</p>
          </>
        )}
      </section>

      <aside className={panelClassName}>
        <h2>Add annotation</h2>

        <p className="mt-2.5 text-sm text-[#6a717b]">{panelHint}</p>

        {activeAnnotations.length > 0 && (
          <div className="mt-6 border-t border-line-soft pt-5">
            <h2 className="text-[15px]">Annotations</h2>

            {activeAnnotations.map((annotation) => (
              <div
                className="flex items-start justify-between gap-2.5 border-b border-[#eceef1] py-2.5"
                key={annotation.id}
                style={{
                  borderLeft: `4px solid ${annotation.color}`,
                  paddingLeft: 10,
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <input
                    className="w-full rounded-lg bg-white px-2 py-1.5 font-semibold"
                    style={{
                      color: annotation.color,
                      borderColor: annotation.color,
                      borderWidth: 2,
                    }}
                    value={annotation.label}
                    onChange={(event) =>
                      updateAnnotation(annotation.id, {
                        label: event.target.value,
                      })
                    }
                    placeholder="Name this annotation"
                  />

                  {withSizeReference && (
                    <>
                      <label className="mt-0 flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(annotation.sizeReference)}
                          onChange={(event) =>
                            updateAnnotationSizeReference(
                              annotation.id,
                              event.target.checked,
                              "",
                              "mm",
                            )
                          }
                        />{" "}
                        Size reference
                      </label>

                      {annotation.sizeReference && (
                        <div className="grid grid-cols-[1fr_90px] items-end gap-2.5">
                          <input
                            className="text-input"
                            type="number"
                            min="0"
                            step="any"
                            value={annotation.sizeReference.knownDimension || ""}
                            onChange={(event) =>
                              updateAnnotationSizeReference(
                                annotation.id,
                                true,
                                event.target.value,
                                annotation.sizeReference?.unit ?? "mm",
                              )
                            }
                            placeholder="e.g. 24.26"
                          />

                          <select
                            className="mt-0"
                            value={annotation.sizeReference.unit}
                            onChange={(event) =>
                              updateAnnotationSizeReference(
                                annotation.id,
                                true,
                                annotation.sizeReference?.knownDimension ?? "",
                                event.target.value as (typeof UNIT_OPTIONS)[number],
                              )
                            }
                          >
                            {UNIT_OPTIONS.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <button
                  type="button"
                  className="rounded-lg bg-transparent px-2.5 py-1.5 text-xs font-semibold text-[#a22c2c] hover:bg-[#fdeeee]"
                  onClick={() => deleteAnnotation(annotation.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
