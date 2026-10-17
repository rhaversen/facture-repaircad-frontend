"use client";

import { useRef, useState } from "react";

import { annotationColor, MAX_PHOTOS } from "@/lib/intake";
import type { Annotation, NormalizedBox, Photo } from "@/lib/types";

type Point = { x: number; y: number };

const boxBetween = (a: Point, b: Point): NormalizedBox => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

/*
  Photos plus box annotations, shared by the intake wizard and the
  clarification form. Releasing a drag saves the box at once; it is named
  afterwards in the annotation list.
*/
export function useIntake() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // A stale or unset selection falls back to the first photo.
  const activePhoto = photos.find((p) => p.id === activeId) ?? photos[0] ?? null;

  function addPhotos(files: File[]) {
    const added = files.slice(0, MAX_PHOTOS - photos.length).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPhotos([...photos, ...added]);
  }

  function removePhoto(photoId: string) {
    const photo = photos.find((p) => p.id === photoId);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhotos(photos.filter((p) => p.id !== photoId));
    setAnnotations(annotations.filter((a) => a.photoId !== photoId));
  }

  function pointer(event: React.PointerEvent): Point | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  const pointerHandlers = {
    onPointerDown(event: React.PointerEvent) {
      const start = pointer(event);
      if (!start) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ start, end: start });
    },
    onPointerMove(event: React.PointerEvent) {
      const end = pointer(event);
      if (drag && end) setDrag({ ...drag, end });
    },
    onPointerUp(event: React.PointerEvent) {
      if (!drag || !activePhoto) return;
      const box = boxBetween(drag.start, pointer(event) ?? drag.end);
      setDrag(null);
      // Tiny accidental drags are dropped.
      if (box.width < 0.01 || box.height < 0.01) return;
      setAnnotations([
        ...annotations,
        {
          id: crypto.randomUUID(),
          photoId: activePhoto.id,
          label: "",
          color: annotationColor(annotations.length),
          box,
          sizeReference: null,
        },
      ]);
    },
  };

  function updateAnnotation(id: string, patch: Partial<Annotation>) {
    setAnnotations(annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function deleteAnnotation(id: string) {
    setAnnotations(annotations.filter((a) => a.id !== id));
  }

  return {
    photos,
    annotations,
    activePhoto,
    setActivePhoto: setActiveId,
    draftBox: drag ? boxBetween(drag.start, drag.end) : null,
    canvasRef,
    pointerHandlers,
    addPhotos,
    removePhoto,
    updateAnnotation,
    deleteAnnotation,
  };
}

export type Intake = ReturnType<typeof useIntake>;
