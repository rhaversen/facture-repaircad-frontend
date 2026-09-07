"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { nextAnnotationColor } from "@/lib/intakeMessageUtils";
import type {
  Annotation,
  NormalizedBox,
  Photo,
  Unit,
} from "@/lib/types";

const MIN_BOX_SIZE = 0.01;

/* Hard cap on intake photos — more dilutes the agent's attention. */
export const MAX_PHOTOS = 8;

function normalizedRect(start: { x: number; y: number }, end: { x: number; y: number }): NormalizedBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

interface DraftBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/*
  All photo + annotation state for the intake wizard, replacing the sprawling
  per-screen state that used to live in App.jsx. Exposes the same pointer
  handlers the annotation canvas binds directly.
*/
export function useIntake() {
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const imageWrapperRef = useRef<HTMLDivElement | null>(null);

  const addPhotos = useCallback((files: File[]) => {
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length;
      if (room <= 0) return current;
      const accepted = files.slice(0, room).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        type: "close_up" as const,
      }));
      return [...current, ...accepted];
    });
  }, []);

  const removePhoto = useCallback(
    (photoId: string) => {
      setPhotos((currentPhotos) => {
        const photoToRemove = currentPhotos.find((photo) => photo.id === photoId);
        if (photoToRemove) {
          URL.revokeObjectURL(photoToRemove.previewUrl);
        }
        return currentPhotos.filter((photo) => photo.id !== photoId);
      });

      setAnnotations((currentAnnotations) =>
        currentAnnotations.filter((annotation) => annotation.photoId !== photoId),
      );

      setActivePhotoId((current) => (current === photoId ? null : current));
    },
    [],
  );

  const openAnnotationScreen = useCallback(() => {
    setPhotos((current) => {
      if (current.length > 0) {
        setActivePhotoId((prev) => prev ?? current[0].id);
      }
      return current;
    });
    setDraftBox(null);
    setIsDrawing(false);
  }, []);

  function getPointerPosition(event: React.PointerEvent): { x: number; y: number } | null {
    const wrapper = imageWrapperRef.current;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!imageWrapperRef.current) return;
      if (draftBox && !isDrawing) return;

      const start = getPointerPosition(event);
      if (!start) return;

      setIsDrawing(true);
      setDraftBox({
        startX: start.x,
        startY: start.y,
        endX: start.x,
        endY: start.y,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [draftBox, isDrawing],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isDrawing || !draftBox) return;
      const current = getPointerPosition(event);
      if (!current) return;
      setDraftBox((box) => (box ? { ...box, endX: current.x, endY: current.y } : box));
    },
    [isDrawing, draftBox],
  );

  /*
    Pointer-up commits the drawn box straight to the annotation list — no
    confirmation step. Tiny accidental drags are discarded silently.
  */
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!isDrawing || !draftBox) return;
      const current = getPointerPosition(event);
      const end = current ?? { x: draftBox.endX, y: draftBox.endY };
      const box = normalizedRect(
        { x: draftBox.startX, y: draftBox.startY },
        end,
      );
      setIsDrawing(false);
      setDraftBox(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (!activePhotoId) return;
      if (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE) return;

      setAnnotations((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          photoId: activePhotoId,
          label: "",
          color: nextAnnotationColor(current.length),
          box,
          sizeReference: null,
        },
      ]);
    },
    [isDrawing, draftBox, activePhotoId],
  );

  const updateAnnotation = useCallback(
    (annotationId: string, patch: Partial<Annotation>) => {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === annotationId ? { ...annotation, ...patch } : annotation,
        ),
      );
    },
    [],
  );

  const updateAnnotationSizeReference = useCallback(
    (
      annotationId: string,
      isReference: boolean,
      dimension: string | number,
      unit: Unit,
    ) => {
      updateAnnotation(annotationId, {
        sizeReference: isReference
          ? { knownDimension: Number(dimension) || 0, unit }
          : null,
      });
    },
    [updateAnnotation],
  );

  const deleteAnnotation = useCallback((annotationId: string) => {
    setAnnotations((current) =>
      current.filter((annotation) => annotation.id !== annotationId),
    );
  }, []);

  const changeActivePhoto = useCallback((photoId: string) => {
    setActivePhotoId(photoId);
    setDraftBox(null);
    setIsDrawing(false);
  }, []);

  const activePhoto = useMemo(
    () => photos.find((photo) => photo.id === activePhotoId) ?? null,
    [photos, activePhotoId],
  );

  const activeAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.photoId === activePhotoId),
    [annotations, activePhotoId],
  );

  const hasMeasurementReference = useMemo(
    () =>
      annotations.some(
        (annotation) => (annotation.sizeReference?.knownDimension ?? 0) > 0,
      ),
    [annotations],
  );

  const resetIntake = useCallback(() => {
    setDescription("");
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
    setActivePhotoId(null);
    setAnnotations([]);
    setDraftBox(null);
    setIsDrawing(false);
  }, [photos]);

  return {
    description,
    setDescription,
    photos,
    addPhotos,
    removePhoto,
    openAnnotationScreen,
    activePhotoId,
    activePhoto,
    activeAnnotations,
    changeActivePhoto,
    annotations,
    draftBox,
    isDrawing,
    imageWrapperRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    updateAnnotation,
    updateAnnotationSizeReference,
    deleteAnnotation,
    hasMeasurementReference,
    resetIntake,
  };
}

export type IntakeController = ReturnType<typeof useIntake>;
