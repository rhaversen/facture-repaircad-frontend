"use client";

import { useState } from "react";

import Page from "@/components/Page";
import AnnotationCanvas from "./AnnotationCanvas";
import PhotoAnnotation from "./PhotoAnnotation";
import { useIntake } from "@/hooks/useIntake";
import { annotatedFiles, intakeMessage, MAX_PHOTOS } from "@/lib/intake";

/*
  Steps 1–3: describe, annotate, review. Everything here is a local draft
  until Submit, which hands the message and the annotated photos to the app.
*/
export default function Intake({
  onSubmit,
  onAllRuns,
}: {
  onSubmit: (message: string, files: File[]) => Promise<void>;
  onAllRuns: () => void;
}) {
  const intake = useIntake();
  const { photos, annotations } = intake;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(
        intakeMessage(description, photos, annotations),
        await annotatedFiles(photos, annotations),
      );
    } catch (err) {
      console.error("Intake submission failed:", err);
      setError("The repair could not be submitted. Please try again.");
      setSubmitting(false);
    }
  }

  const hasPhotos = photos.length > 0;
  const progress = {
    step,
    // Annotating needs photos; without any, the wizard goes 1 → 3.
    backTo: (hasPhotos ? [1, 2] : [1]).filter((n) => n < step),
    onStep: (n: number) => setStep(n as 1 | 2),
  };

  return (
    <Page progress={progress} onAllRuns={onAllRuns}>
      {step === 1 && (
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
          <section className="flex min-w-0 flex-1 flex-col">
            <h1>Describe your repair</h1>
            <p className="intro">
              Tell us what happened. You can add photos to show the object and the repair area.
            </p>
            <label htmlFor="description">What happened and what is broken or missing?</label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="For example: The cabinet handle broke off and the broken piece is missing."
              rows={10}
            />
          </section>

          <aside className="flex w-full shrink-0 flex-col lg:w-[400px]">
            <div className="flex items-baseline justify-between gap-3">
              <h2>Add photos (optional)</h2>
              <span className="text-sm text-[#7a828d]">
                {photos.length}/{MAX_PHOTOS}
              </span>
            </div>
            <p className="mt-1 text-sm">Add photos that show the object and the repair area.</p>

            {photos.length < MAX_PHOTOS && (
              <label className="btn-outline mt-3 mb-0 w-full">
                + Add photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    intake.addPhotos(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </label>
            )}

            {photos.length > 0 && (
              <ul className="mt-4 grid list-none grid-cols-2 gap-3 p-0">
                {photos.map((photo) => (
                  <li key={photo.id} className="overflow-hidden rounded-xl border border-line-light bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.previewUrl}
                      alt={photo.file.name}
                      className="block h-[150px] w-full bg-[#eceff2] object-cover"
                    />
                    <div className="p-2.5">
                      <div className="text-sm break-all text-[#59616d]">{photo.file.name}</div>
                      <button
                        type="button"
                        className="btn-link mt-2 w-full py-1.5 text-sm"
                        onClick={() => intake.removePhoto(photo.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              className="mt-6 w-full"
              onClick={() => setStep(hasPhotos ? 2 : 3)}
              disabled={!description.trim()}
            >
              Continue →
            </button>
          </aside>
        </div>
      )}

      {step === 2 && (
        <>
          <h1>Annotate your photos</h1>
          <p className="intro">
            Mark important parts of the photo and briefly describe what they show or why they
            matter for the repair.
          </p>
          <PhotoAnnotation intake={intake} sizeReference />
          <div className="nav-row">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button type="button" onClick={() => setStep(3)}>
              Review →
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h1>Review your repair</h1>
          <p className="intro">Check the information below before submitting.</p>

          <h2 className="mb-2.5 text-lg">Repair description</h2>
          <p className="whitespace-pre-wrap">{description}</p>

          <h2 className="mt-8 mb-2.5 text-lg">Photos</h2>
          {!hasPhotos && <p className="text-sm text-faint">No photos added</p>}
          {photos.map((photo) => {
            const own = annotations.filter((a) => a.photoId === photo.id);
            return (
              <div
                key={photo.id}
                className="grid grid-cols-[240px_1fr] gap-4.5 border-b border-line-soft py-4.5 max-[640px]:grid-cols-1"
              >
                <AnnotationCanvas
                  imageUrl={photo.previewUrl}
                  alt={photo.file.name}
                  annotations={own}
                  className="max-h-[180px]"
                />
                <div>
                  <strong>{photo.file.name}</strong>
                  {own.length > 0 ? (
                    <ul className="mt-2 pl-5">
                      {own.map((a) => (
                        <li key={a.id}>
                          {a.label || "Unnamed"}
                          {a.sizeReference &&
                            ` (size reference: ${a.sizeReference.knownDimension} ${a.sizeReference.unit})`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-faint">No annotations</p>
                  )}
                </div>
              </div>
            );
          })}

          {error && <p className="error-box">{error}</p>}

          <div className="nav-row">
            <button type="button" className="btn-secondary" onClick={() => setStep(hasPhotos ? 2 : 1)}>
              {hasPhotos ? "← Back to annotations" : "← Back"}
            </button>
            <button type="button" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
