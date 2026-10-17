"use client";

import { useState } from "react";

import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import { useIntake } from "@/hooks/useIntake";
import { annotatedFiles, clarificationMessage } from "@/lib/intake";

/*
  The pipeline sent the case back with a question: answer it with text,
  annotated photos, or both, as one turn on the run.
*/
export default function ClarificationForm({
  question,
  onSubmit,
}: {
  question: string;
  onSubmit: (message: string, files: File[]) => Promise<void>;
}) {
  const intake = useIntake();
  const { photos, annotations } = intake;
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const empty = !answer.trim() && photos.length === 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (empty) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(
        clarificationMessage(answer, photos, annotations),
        await annotatedFiles(photos, annotations),
      );
    } catch (err) {
      console.error("Clarification failed:", err);
      setError("The clarification could not be sent. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Repair clarification</h1>
      <p className="intro">Answer the question below. A photo is a perfectly good answer too.</p>

      <div className="mb-6 grid items-start gap-4 min-[721px]:grid-cols-2">
        {question && (
          <div className="self-stretch rounded-lg bg-surface p-4 whitespace-pre-wrap text-ink-soft wrap-break-word">
            {question}
          </div>
        )}
        <div className={question ? "" : "min-[721px]:col-span-2"}>
          <label htmlFor="clarification-response" className="mt-0">
            Your response
            <span className="font-normal text-[#7a828d]"> — optional if the photos answer the question</span>
          </label>
          <textarea
            id="clarification-response"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={4}
            placeholder="Add any information that would help understand the repair."
          />
        </div>
      </div>

      <h2>Add clarification photos</h2>
      <p className="mt-2.5 text-sm text-[#6a717b]">
        Upload the additional views requested. You can optionally mark important parts of each photo.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
        <label className="btn-outline my-0">
          Attach photos
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
        <button type="submit" disabled={submitting || empty}>
          {submitting ? "Sending…" : "Continue"}
        </button>
      </div>

      {photos.length > 0 && (
        <div className="mt-5">
          <PhotoAnnotation intake={intake} compact removable />
        </div>
      )}

      {error && <p className="error-box">{error}</p>}
    </form>
  );
}
