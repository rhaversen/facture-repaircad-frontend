"use client";

import RepairProgress from "@/components/RepairProgress";
import { AppHeader, AppShell, Card } from "@/components/AppShell";
import { useEffect, useState } from "react";
import { createAnnotatedCopy } from "@/lib/annotatedImageUtils";
import type {
  Annotation,
  AnnotatedCopy,
  Photo,
} from "@/lib/types";

interface ReviewIntakeProps {
  description: string;
  photos: Photo[];
  annotations: Annotation[];
  onBack: () => void;
  onSubmit: (annotatedCopies: Record<string, AnnotatedCopy>) => void;
  submitting: boolean;
  submissionError: string;
}

/*
  Review screen. Annotated JPEG copies are generated here (they are what gets
  uploaded), so the submit handler receives them ready to send.
*/
export default function ReviewIntake({
  description,
  photos,
  annotations,
  onBack,
  onSubmit,
  submitting,
  submissionError,
}: ReviewIntakeProps) {
  const [annotatedCopies, setAnnotatedCopies] = useState<
    Record<string, AnnotatedCopy>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function generateCopies() {
      try {
        const generated: Record<string, AnnotatedCopy> = {};
        for (const photo of photos) {
          const result = await createAnnotatedCopy(photo, annotations);
          if (cancelled) {
            URL.revokeObjectURL(result.url);
            return;
          }
          generated[photo.id] = result;
        }
        if (!cancelled) {
          setAnnotatedCopies((previousCopies) => {
            Object.values(previousCopies).forEach((copy) => {
              if (copy?.url) URL.revokeObjectURL(copy.url);
            });
            return generated;
          });
        }
      } catch (error) {
        console.error("Could not generate annotated copies:", error);
      }
    }

    generateCopies();

    return () => {
      cancelled = true;
    };
  }, [photos, annotations]);

  const allCopiesReady = photos.every((photo) => annotatedCopies[photo.id]);

  return (
    <AppShell>
      <Card>
        <AppHeader />

        <RepairProgress currentStep={3} />

        <h1>Review your repair</h1>

        <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
          Check the information below before submitting it to RepairCAD.
        </p>

        <div className="mt-8">
          <h2 className="mb-2.5 text-lg">Repair description</h2>
          <p>{description}</p>
        </div>

        <div className="mt-8">
          <h2 className="mb-2.5 text-lg">Photos</h2>

          {photos.map((photo) => {
            const photoAnnotations = annotations.filter(
              (annotation) => annotation.photoId === photo.id,
            );
            const annotatedCopy = annotatedCopies[photo.id];

            return (
              <div
                className="grid grid-cols-[180px_1fr] gap-4.5 border-b border-line-soft py-4.5 max-[640px]:grid-cols-1"
                key={photo.id}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={annotatedCopy?.url || photo.previewUrl}
                  alt={`Annotated ${photo.file.name}`}
                  className="h-[130px] w-[180px] rounded-lg border border-line-light object-cover max-[640px]:h-auto max-[640px]:w-full"
                />
                <div>
                  <strong>{photo.file.name}</strong>

                  {annotatedCopy && (
                    <div className="mt-1 text-sm text-[#707782]">
                      Annotated copy: {annotatedCopy.file.name}
                    </div>
                  )}

                  {photoAnnotations.length > 0 ? (
                    <div className="mt-3.5">
                      <strong>Annotations</strong>
                      <ul className="mt-2 pl-5">
                        {photoAnnotations.map((annotation) => (
                          <li key={annotation.id}>
                            {annotation.label}
                            {annotation.sizeReference &&
                              ` (size reference: ${annotation.sizeReference.knownDimension} ${annotation.sizeReference.unit})`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-faint">No annotations</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {submissionError && (
          <p className="mt-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
            {submissionError}
          </p>
        )}

        <div className="mt-9 flex justify-between gap-4 max-[640px]:flex-col-reverse max-[640px]:[&>button]:w-full">
          <button type="button" className="btn-secondary" onClick={onBack}>
            ← Back to annotations
          </button>

          <button
            type="button"
            onClick={() => onSubmit(annotatedCopies)}
            disabled={submitting || !allCopiesReady}
          >
            {submitting ? "Submitting..." : "Submit to RepairCAD"}
          </button>
        </div>
      </Card>
    </AppShell>
  );
}
