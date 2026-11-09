"use client";

import { useState } from "react";

import { Button, Card, ErrorBox, PhotoDrop, textareaClass, Title } from "@/components/ui";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import { useIntake } from "@/hooks/useIntake";
import { annotatedFiles, clarificationMessage } from "@/lib/intake";

/*
  The pipeline sent the case back with a question: answer it with text,
  annotated photos, or both, as one turn on the run.
*/
export default function ClarificationForm({
  question,
  photoLimit,
  onSubmit,
}: {
  question: string;
  /** Photos still allowed on this repair. */
  photoLimit: number;
  onSubmit: (message: string, files: File[]) => Promise<void>;
}) {
  const intake = useIntake(photoLimit);
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
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Title subtitle="A photo is a good answer too.">One question</Title>

      <div className="grid items-start gap-6 min-[721px]:grid-cols-2">
        {question && (
          <Card className="self-stretch">
            <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">{question}</p>
          </Card>
        )}
        <Card className={question ? "" : "min-[721px]:col-span-2"}>
          <label htmlFor="clarification-response" className="text-sm font-medium">
            Your answer
          </label>
          <textarea
            id="clarification-response"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={4}
            placeholder="Optional if the photos answer it"
            className={textareaClass}
          />
        </Card>
      </div>

      <Card
        title="Photos"
        actions={
          <span className="text-xs text-subtle">
            {photoLimit === 0 ? "Photo limit reached" : `${photos.length}/${photoLimit}`}
          </span>
        }
      >
        {photos.length < photoLimit && (
          <PhotoDrop onFiles={intake.addPhotos} compact hint="The views asked for; mark them if it helps" />
        )}
        {photos.length > 0 && <PhotoAnnotation intake={intake} compact removable />}
      </Card>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" disabled={submitting || empty}>
          {submitting ? "Sending…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
