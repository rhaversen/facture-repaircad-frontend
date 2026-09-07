"use client";

import RepairProgress from "@/components/RepairProgress";
import { AppHeader, AppShell, Card } from "@/components/AppShell";
import AnnotationCanvas from "./AnnotationCanvas";
import { UNIT_OPTIONS } from "@/lib/intakeMessageUtils";
import type { IntakeController } from "@/hooks/useIntake";

interface PhotoAnnotationProps {
  intake: IntakeController;
  onBack: () => void;
  onReview: () => void;
}

export default function PhotoAnnotation({ intake, onBack, onReview }: PhotoAnnotationProps) {
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
    hasMeasurementReference,
  } = intake;

  return (
    <AppShell>
      <Card className="!max-w-[1600px] !px-10">
        <AppHeader />

        <RepairProgress currentStep={2} />

        <h1>Annotate your photos</h1>

        <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
          Mark important parts of the photo and briefly describe what they show
          or why they matter for the repair.
        </p>

        <div className="grid grid-cols-[200px_minmax(0,1fr)_300px] items-start gap-7 max-[900px]:grid-cols-1">
          <aside className="min-w-0 max-[900px]:flex max-[900px]:gap-2.5 max-[900px]:overflow-x-auto">
            <h2 className="mb-3.5 text-base max-[900px]:hidden">Photos</h2>

            {photos.map((photo) => (
              <button
                type="button"
                key={photo.id}
                className={`mb-3 block w-full rounded-[10px] border bg-white p-2 text-left text-ink transition-colors hover:border-[#9db2e8] max-[900px]:min-w-[140px] ${
                  photo.id === activePhotoId
                    ? "border-2 border-brand shadow-[0_0_0_3px_rgba(36,72,184,0.12)]"
                    : "border-line-light"
                }`}
                onClick={() => changeActivePhoto(photo.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.previewUrl} alt={photo.file.name} className="mb-[7px] block h-[90px] w-full rounded-md object-cover" />
                <span className="block text-xs break-anywhere">{photo.file.name}</span>
              </button>
            ))}
          </aside>

          <section className="min-w-0">
            {activePhoto && (
              <>
                <AnnotationCanvas
                  imageUrl={activePhoto.previewUrl}
                  imageAlt={activePhoto.file.name}
                  annotations={activeAnnotations}
                  draftBox={draftBox}
                  imageWrapperRef={imageWrapperRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />
                <p className="mt-2.5 text-sm text-[#6a717b]">
                  Click and drag over an area, then release to finish the box.
                </p>
              </>
            )}
          </section>

          <aside className="min-w-0 rounded-xl border border-[#e5e8ec] bg-surface p-5 max-[900px]:p-4">
            <h2>Add annotation</h2>

            <p className="mt-2.5 text-sm text-[#6a717b]">
              Drag on the photo to add an annotation, then name it and set its
              size below.
            </p>

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

        {!hasMeasurementReference && (
          <p className="mt-6 -mb-3 text-right text-sm text-[#a05a00]">
            Mark at least one annotation as a size reference (with its known
            dimension) to continue.
          </p>
        )}

        <div className="mt-9 flex justify-between gap-4 max-[640px]:flex-col-reverse max-[640px]:[&>button]:w-full">
          <button type="button" className="btn-secondary" onClick={onBack}>
            ← Back
          </button>

          <button type="button" disabled={!hasMeasurementReference} onClick={onReview}>
            Review →
          </button>
        </div>
      </Card>
    </AppShell>
  );
}
