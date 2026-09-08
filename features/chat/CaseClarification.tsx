"use client";

import { useRef, useState } from "react";

import { AppHeader, AppShell, Card } from "@/components/AppShell";
import AnnotationCanvas from "@/features/intake/AnnotationCanvas";
import { createAnnotatedCopy } from "@/lib/annotatedImageUtils";
import { nextAnnotationColor } from "@/lib/intakeMessageUtils";
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
*/
export default function CaseClarification({
  question = "",
  embedded = false,
  onSubmit,
  submitting,
  error,
}: CaseClarificationProps) {
  const [response, setResponse] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draftBox, setDraftBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [annotationLabel, setAnnotationLabel] = useState("");

  const imageWrapperRef = useRef<HTMLDivElement | null>(null);

  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const activeAnnotations = annotations.filter(
    (annotation) => annotation.photoId === activePhotoId,
  );

  function handlePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const newPhotos = Array.from(event.target.files ?? []).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      type: "close_up" as const,
    }));
    setPhotos((current) => [...current, ...newPhotos]);
    if (!activePhotoId && newPhotos.length > 0) {
      setActivePhotoId(newPhotos[0].id);
    }
    event.target.value = "";
  }

  function removePhoto(photoId: string) {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === photoId);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      const remaining = current.filter((item) => item.id !== photoId);
      if (activePhotoId === photoId) {
        setActivePhotoId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
    setAnnotations((current) =>
      current.filter((annotation) => annotation.photoId !== photoId),
    );
    setDraftBox(null);
    setIsDrawing(false);
  }

  function getPointerPosition(event: React.PointerEvent) {
    const wrapper = imageWrapperRef.current;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!activePhoto) return;
    const start = getPointerPosition(event);
    if (!start) return;
    setIsDrawing(true);
    setDraftBox({ startX: start.x, startY: start.y, endX: start.x, endY: start.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!isDrawing || !draftBox) return;
    const current = getPointerPosition(event);
    if (!current) return;
    setDraftBox((box) => (box ? { ...box, endX: current.x, endY: current.y } : box));
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!isDrawing || !draftBox) return;
    const current = getPointerPosition(event);
    if (current) {
      setDraftBox((box) => (box ? { ...box, endX: current.x, endY: current.y } : box));
    }
    setIsDrawing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  function saveAnnotation() {
    if (!draftBox || !activePhotoId || !annotationLabel.trim()) return;
    const box = {
      x: Math.min(draftBox.startX, draftBox.endX),
      y: Math.min(draftBox.startY, draftBox.endY),
      width: Math.abs(draftBox.endX - draftBox.startX),
      height: Math.abs(draftBox.endY - draftBox.startY),
    };
    if (box.width < 0.01 || box.height < 0.01) return;

    setAnnotations((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        photoId: activePhotoId,
        label: annotationLabel.trim(),
        color: nextAnnotationColor(current.length),
        box,
        sizeReference: null,
      },
    ]);
    setDraftBox(null);
    setAnnotationLabel("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!response.trim() && photos.length === 0) return;

    const annotatedCopies: Record<string, AnnotatedCopy> = {};
    for (const photo of photos) {
      annotatedCopies[photo.id] = await createAnnotatedCopy(photo, annotations);
    }

    await onSubmit({ content: response, photos, annotations, annotatedCopies });
  }

  return (
    <AppShell embedded={embedded}>
      <Card className={`!max-w-none !p-7 ${embedded ? "!pt-7" : ""}`}>
        {!embedded && <AppHeader />}

        <h1 className={embedded ? "mt-0 text-xl" : ""}>Repair clarification</h1>

        {question && <div className="mb-6 rounded-lg bg-surface p-4 text-ink-soft">{question}</div>}

        <label htmlFor="clarification-response">
          Your response
          <span className="font-normal text-[#7a828d]"> — optional if the photos answer the question</span>
        </label>

        <textarea
          id="clarification-response"
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          rows={4}
          placeholder="Add any information that would help RepairCAD understand the repair."
        />

        <div className="mt-7">
          <h2>Add clarification photos</h2>

          <p className="mt-2.5 text-sm text-[#6a717b]">
            Upload the additional views RepairCAD requested. You can optionally
            mark important parts of each photo.
          </p>

          <label className="mt-2 mb-7 inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-brand bg-white px-4.5 py-3 font-semibold text-brand hover:bg-[#f6f8ff]">
            Choose photos
            <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
          </label>
        </div>

        {photos.length > 0 && (
          <div className="grid grid-cols-[200px_minmax(0,1fr)_300px] items-start gap-7 max-[900px]:grid-cols-1">
            <div className="min-w-0 max-[900px]:flex max-[900px]:gap-2.5 max-[900px]:overflow-x-auto">
              <h2 className="mb-3.5 text-base max-[900px]:hidden">Photos</h2>

              {photos.map((photo) => (
                <div key={photo.id} className="mb-2 max-[900px]:min-w-[140px]">
                  <button
                    type="button"
                    className={`mb-3 block w-full rounded-[10px] border bg-white p-2 text-left text-ink transition-colors hover:border-[#9db2e8] ${
                      activePhotoId === photo.id
                        ? "border-2 border-brand shadow-[0_0_0_3px_rgba(36,72,184,0.12)]"
                        : "border-line-light"
                    }`}
                    onClick={() => {
                      setActivePhotoId(photo.id);
                      setDraftBox(null);
                      setIsDrawing(false);
                      setAnnotationLabel("");
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.previewUrl} alt="" className="mb-[7px] block h-[90px] w-full rounded-md object-cover" />
                    <span className="block text-xs break-anywhere">{photo.file.name}</span>
                  </button>

                  <button
                    type="button"
                    className="w-full bg-transparent px-0 py-2 text-[#a22c2c] font-medium hover:bg-transparent hover:underline"
                    onClick={() => removePhoto(photo.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="min-w-0">
              {activePhoto && (
                <>
                  <AnnotationCanvas
                    imageUrl={activePhoto.previewUrl}
                    imageAlt=""
                    compact={embedded}
                    annotations={activeAnnotations.map((annotation) => ({
                      ...annotation,
                      label: annotation.label,
                    }))}
                    draftBox={draftBox}
                    imageWrapperRef={imageWrapperRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                  />
                  <p className="mt-2.5 text-sm text-[#6a717b]">
                    Draw a box around a part or feature only when it would help
                    RepairCAD interpret the clarification.
                  </p>
                </>
              )}
            </div>

            <div className="min-w-0 rounded-xl border border-[#e5e8ec] bg-surface p-5 max-[900px]:p-4">
              <h2>Annotation</h2>

              <label htmlFor="clarification-annotation-label">Short label</label>

              <input
                id="clarification-annotation-label"
                className="text-input"
                type="text"
                value={annotationLabel}
                onChange={(event) => setAnnotationLabel(event.target.value)}
                placeholder="e.g. bent mounting tab"
              />

              <button
                type="button"
                className="mt-4.5 w-full"
                disabled={!draftBox || !annotationLabel.trim()}
                onClick={saveAnnotation}
              >
                Save annotation
              </button>

              {draftBox && (
                <button
                  type="button"
                  className="mt-2 w-full bg-transparent px-0 py-2 text-[#a22c2c] font-medium hover:bg-transparent hover:underline"
                  onClick={() => {
                    setDraftBox(null);
                    setIsDrawing(false);
                  }}
                >
                  Cancel box
                </button>
              )}

              {activeAnnotations.length > 0 && (
                <div className="mt-6 border-t border-line-soft pt-5">
                  <h2 className="text-[15px]">Saved annotations</h2>

                  {activeAnnotations.map((annotation) => (
                    <div
                      key={annotation.id}
                      className="flex items-start justify-between gap-2.5 border-b border-[#eceef1] py-2.5"
                    >
                      <div>
                        <strong>{annotation.label}</strong>
                      </div>

                      <button
                        type="button"
                        className="rounded-lg bg-transparent px-2.5 py-1.5 text-xs font-semibold text-[#a22c2c] hover:bg-[#fdeeee]"
                        onClick={() =>
                          setAnnotations((current) =>
                            current.filter((item) => item.id !== annotation.id),
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
      </Card>
    </AppShell>
  );
}
