"use client";

import { useState } from "react";

import { AppHeader, AppShell, Card } from "@/components/AppShell";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import { useIntake } from "@/hooks/useIntake";
import { createAnnotatedCopy } from "@/lib/annotatedImageUtils";
import type { Annotation, AnnotatedCopy, Photo } from "@/lib/types";

interface CaseClarificationProps {
  question?: string;
  embedded?: boolean;
  onSubmit: (clarification: {
    content: string;
    photos: Photo[];
    annotations: Annotation[];
    annotatedCopies: Record<string, AnnotatedCopy>;
  }) => Promise<void>;
  submitting: boolean;
  error: string;
}

/*
  Sidebar mini-intake shown when the pipeline's S2 node asks the case back for
  clarification: a text response + optional annotated photos, submitted as one
  turn on the active run.

  Standalone (non-embedded) use keeps the page shell; when embedded in the
  chat screen's sidebar the host already provides the card, border and scroll
  container, so only the bare form content is rendered.
*/
function ClarificationForm({
  question,
  onSubmit,
  submitting,
  error,
}: {
  question: string;
  onSubmit: CaseClarificationProps["onSubmit"];
  submitting: boolean;
  error: string;
}) {
  const [response, setResponse] = useState("");

  /*
    Same photo + annotation engine as the intake wizard with its default
    auto-commit behavior: releasing a drag saves the box immediately, then the
    annotation is named inline in the panel, exactly like the intake step.
  */
  const intake = useIntake();
  const { photos, addPhotos } = intake;
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!response.trim() && photos.length === 0) return;

    const annotatedCopies: Record<string, AnnotatedCopy> = {};
    for (const photo of photos) {
      annotatedCopies[photo.id] = await createAnnotatedCopy(photo, intake.annotations);
    }

    await onSubmit({
      content: response,
      photos,
      annotations: intake.annotations,
      annotatedCopies,
    });
  }

  return (
    <>
      <div className="mb-6 grid items-start gap-4 max-[720px]:grid-cols-1 min-[721px]:grid-cols-2">
        {question && (
          <div className="wrap-break-word self-stretch rounded-lg bg-surface p-4 text-ink-soft">{question}</div>
        )}

        <div className={question ? "" : "min-[721px]:col-span-2"}>
          <label htmlFor="clarification-response">
            Your response
            <span className="font-normal text-[#7a828d]"> — optional if the photos answer the question</span>
          </label>

          <textarea
            id="clarification-response"
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            rows={4}
            placeholder="Add any information that would help understand the repair."
          />
        </div>
      </div>

      <div className="mt-7">
        <h2>Add clarification photos</h2>

        <p className="mt-2.5 text-sm text-[#6a717b]">
          Upload the additional views requested. You can optionally
          mark important parts of each photo.
        </p>

        <label className="mt-2 mb-7 inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-brand bg-white px-4.5 py-3 font-semibold text-brand hover:bg-[#f6f8ff]">
          Choose photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) =>
              addPhotos(Array.from(event.target.files ?? []))
            }
          />
        </label>
      </div>

      {photos.length > 0 && (
        <PhotoAnnotation
          intake={intake}
          compact
          withRemovePhoto
          panelHint="Drag on the photo to add an annotation, then name it below."
        />
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mt-8 flex justify-end">
          <button
            type="submit"
            disabled={submitting || (!response.trim() && photos.length === 0)}
          >
            {submitting ? "Sending…" : "Continue"}
          </button>
        </div>
      </form>
    </>
  );
}

export default function CaseClarification({
  question = "",
  embedded = false,
  onSubmit,
  submitting,
  error,
}: CaseClarificationProps) {
  if (embedded) {
    return (
      <ClarificationForm
        question={question}
        onSubmit={onSubmit}
        submitting={submitting}
        error={error}
      />
    );
  }

  return (
    <AppShell>
      <Card>
        <AppHeader />
        <h1>Repair clarification</h1>
        <ClarificationForm
          question={question}
          onSubmit={onSubmit}
          submitting={submitting}
          error={error}
        />
      </Card>
    </AppShell>
  );
}

