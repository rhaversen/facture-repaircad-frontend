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

/* Hard cap on photos per message — matches POST /api/uploads's per-request
   cap on the flow backend (the forge pattern: attachments upload as assets
   first, then ride on the message as ids). */
export const MAX_PHOTOS = 4;

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
/*
  Same photo + annotation + labelled-box engine for both intake screens
  (the wizard and the clarification sidebar). Runs in auto-commit mode:
  releasing a drag saves the box straight to the annotation list — no
  confirmation step, the label is filled in later.
*/
export function useIntake(
  options: { autoCommitToAnnotationList: boolean } = {
    autoCommitToAnnotationList: true,
  },
) {
  const autoCommit = options.autoCommitToAnnotationList;
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  /* Confirmation-mode extra: pending custom label typed for the draft box. */
  const [draftLabel, setDraftLabel] = useState("");

  const imageWrapperRef = useRef<HTMLDivElement | null>(null);

  /* The selection is derived instead of enforced with an effect: when the
     stored id is stale or unset, the first photo takes over, so the canvas is
     populated without an extra click and removing the active photo never
     leaves the canvas empty. Wizard and clarification sidebar share this. */
  const effectiveActivePhotoId =
    photos.find((photo) => photo.id === activePhotoId)?.id ??
    (photos.length > 0 ? photos[0].id : null);

  const addPhotos = useCallback((files: File[]) => {
    /* Updaters run later (during render), so cap the selection against the
       photos count as it stands now — nothing else mutates photos in between —
       and slice before handing the result to the updater. */
    let accepted: Photo[] = [];
    const currentIds = files.map(() => crypto.randomUUID());
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length;
      if (room <= 0) return current;
      accepted = files
        .slice(0, room)
        .map((file, index) => ({
          id: currentIds[index] ?? crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          type: "close_up" as const,
        }));
      return [...current, ...accepted];
    });

    if (files.length > 0) {
      /* Ids are generated up-front so the same ids are baked into the photos
         and seeded into activePhotoId, even when the updater runs more than
         once under Strict Mode. */
      setActivePhotoId((current) => current ?? currentIds[0]);
    }
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
      setDraftLabel("");
    },
    [],
  );

  const openAnnotationScreen = useCallback(() => {
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
    Commit path: pointer-up either commits the drawn box straight to the
    annotation list (intake wizard, no confirmation step), or leaves it as a
    draft pending a name + "Save annotation" (clarification flow). Tiny
    accidental drags are discarded silently in both modes.
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
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (!effectiveActivePhotoId) return;
      if (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE) {
        setDraftBox(null);
        if (!autoCommit) setDraftLabel("");
        return;
      }

      if (autoCommit) {
        setDraftBox(null);
        setAnnotations((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            photoId: effectiveActivePhotoId,
            label: "",
            color: nextAnnotationColor(current.length),
            box,
            sizeReference: null,
          },
        ]);
      } else {
        /* Re-encode as a planar, min-corner box so the canvas can keep
           rendering it as a stable draft while the user names it. */
        setDraftBox({
          startX: box.x,
          startY: box.y,
          endX: box.x + box.width,
          endY: box.y + box.height,
        });
      }
    },
    [isDrawing, draftBox, effectiveActivePhotoId, autoCommit],
  );

  const commitDraftAnnotation = useCallback(() => {
    if (!draftBox || !effectiveActivePhotoId) return;
    const box = normalizedRect(
      { x: draftBox.startX, y: draftBox.startY },
      { x: draftBox.endX, y: draftBox.endY },
    );
    if (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE) return;

    setAnnotations((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        photoId: effectiveActivePhotoId,
        label: draftLabel.trim(),
        color: nextAnnotationColor(current.length),
        box,
        sizeReference: null,
      },
    ]);
    /* Clearing draftBox also drops the preview from the canvas. */
    setDraftBox(null);
    setDraftLabel("");
  }, [draftBox, effectiveActivePhotoId, draftLabel]);

  const cancelDraftAnnotation = useCallback(() => {
    setDraftBox(null);
    setDraftLabel("");
  }, []);

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
    setDraftLabel("");
  }, []);

  const activePhoto = useMemo(
    () => photos.find((photo) => photo.id === effectiveActivePhotoId) ?? null,
    [photos, effectiveActivePhotoId],
  );

  const activeAnnotations = useMemo(
    () =>
      annotations.filter(
        (annotation) => annotation.photoId === effectiveActivePhotoId,
      ),
    [annotations, effectiveActivePhotoId],
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
    setDraftLabel("");
  }, [photos]);

  return {
    description,
    setDescription,
    photos,
    addPhotos,
    removePhoto,
    openAnnotationScreen,
    activePhotoId: effectiveActivePhotoId,
    activePhoto,
    activeAnnotations,
    changeActivePhoto,
    annotations,
    draftBox,
    isDrawing,
    draftLabel,
    setDraftLabel,
    commitDraftAnnotation,
    cancelDraftAnnotation,
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
