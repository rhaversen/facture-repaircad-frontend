"use client";

import { useState } from "react";

import { BackIcon, CloseIcon, NextIcon } from "@/components/icons";
import Page from "@/components/Page";
import { Button, Card, ErrorBox, Muted, PhotoDrop, textareaClass, Title } from "@/components/ui";
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
        <>
          <Title>What needs repairing?</Title>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <Card className="min-w-0 flex-1">
              <label htmlFor="description" className="text-sm font-medium">
                What broke, and what is missing?
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="The cabinet handle broke off and the broken piece is missing."
                rows={10}
                className={textareaClass}
              />
            </Card>

            <Card
              className="w-full shrink-0 lg:w-[400px]"
              title="Photos"
              actions={
                <span className="text-xs text-subtle">
                  {photos.length}/{MAX_PHOTOS}
                </span>
              }
            >
              {photos.length < MAX_PHOTOS && (
                <PhotoDrop
                  onFiles={intake.addPhotos}
                  compact={photos.length > 0}
                  hint="Optional: the object and the broken area"
                />
              )}

              {photos.length > 0 && (
                <ul className="grid grid-cols-2 gap-3">
                  {photos.map((photo) => (
                    <li key={photo.id} className="group relative overflow-hidden rounded-xl bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.previewUrl}
                        alt={photo.file.name}
                        title={photo.file.name}
                        className="block h-[130px] w-full object-cover"
                      />
                      <button
                        type="button"
                        title="Remove"
                        aria-label={`Remove ${photo.file.name}`}
                        className="absolute top-2 right-2 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-danger"
                        onClick={() => intake.removePhoto(photo.id)}
                      >
                        <CloseIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="lg"
              onClick={() => setStep(hasPhotos ? 2 : 3)}
              disabled={!description.trim()}
            >
              Continue
              <NextIcon size={16} />
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <Title subtitle="Drag a box over what matters, then name it.">Mark your photos</Title>
          <PhotoAnnotation intake={intake} sizeReference />
          <div className="flex justify-between gap-3">
            <Button onClick={() => setStep(1)}>
              <BackIcon size={16} />
              Back
            </Button>
            <Button variant="primary" onClick={() => setStep(3)}>
              Review
              <NextIcon size={16} />
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <Title>Review</Title>

          <Card title="Description">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{description}</p>
          </Card>

          <Card title="Photos">
            {!hasPhotos && <Muted>No photos</Muted>}
            <div className="flex flex-col divide-y divide-border/70">
              {photos.map((photo) => {
                const own = annotations.filter((a) => a.photoId === photo.id);
                return (
                  <div
                    key={photo.id}
                    className="grid grid-cols-[240px_1fr] gap-4 py-4 first:pt-0 last:pb-0 max-[640px]:grid-cols-1"
                  >
                    <AnnotationCanvas
                      imageUrl={photo.previewUrl}
                      alt={photo.file.name}
                      annotations={own}
                      className="max-h-[180px]"
                    />
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium">{photo.file.name}</p>
                      {own.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1 text-muted">
                          {own.map((a) => (
                            <li key={a.id} className="flex items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
                              {a.label || "Unnamed"}
                              {a.sizeReference &&
                                ` (size reference: ${a.sizeReference.knownDimension} ${a.sizeReference.unit})`}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-subtle">No marks</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {error && <ErrorBox>{error}</ErrorBox>}

          <div className="flex justify-between gap-3">
            <Button onClick={() => setStep(hasPhotos ? 2 : 1)}>
              <BackIcon size={16} />
              Back
            </Button>
            <Button variant="primary" size="lg" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}
