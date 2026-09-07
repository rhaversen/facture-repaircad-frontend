import type { Annotation, Photo, Unit } from "@/lib/types";

/** Build the plaintext intake message sent as the run's first user turn. */
export function buildIntakeMessage({
  description,
  photos,
  annotations,
}: {
  description: string;
  photos: Photo[];
  annotations: Annotation[];
}): string {
  const lines: string[] = [];

  lines.push("REPAIR DESCRIPTION");
  lines.push(description.trim());

  photos.forEach((photo, index) => {
    const photoAnnotations = annotations.filter(
      (annotation) => annotation.photoId === photo.id,
    );

    lines.push("");
    lines.push(`PHOTO ${index + 1}`);
    lines.push(`Type: ${photo.type}`);

    if (photoAnnotations.length === 0) {
      lines.push("");
      lines.push("Annotations: none");
      return;
    }

    lines.push("");
    lines.push("Annotations:");

    for (const annotation of photoAnnotations) {
      const box = annotation.box;
      const boxText =
        `Box: x=${box.x.toFixed(3)}, ` +
        `y=${box.y.toFixed(3)}, ` +
        `width=${box.width.toFixed(3)}, ` +
        `height=${box.height.toFixed(3)}`;

      if (annotation.sizeReference) {
        const reference = annotation.sizeReference;
        lines.push(
          `- Size reference: ${annotation.label}: ` +
            `${reference.knownDimension} ${reference.unit}`,
        );
      } else {
        lines.push(`- ${annotation.label}`);
      }
      lines.push(`  ${boxText}`);
    }
  });

  return lines.join("\n");
}

/** Measurement summary lines appended to clarification photo uploads. */
export function buildClarificationAnnotations(
  photos: Photo[],
  annotations: Annotation[],
): string[] {
  return photos.flatMap((photo, index) => {
    const photoAnnotations = annotations.filter(
      (annotation) => annotation.photoId === photo.id,
    );
    if (photoAnnotations.length === 0) {
      return [];
    }
    return [
      `PHOTO ${index + 1} ANNOTATIONS`,
      ...photoAnnotations.map((annotation) => `- ${annotation.label}`),
      "",
    ];
  });
}

export const UNIT_OPTIONS: Unit[] = ["mm", "cm", "in"];

export const ANNOTATION_COLORS = [
  "#2c67d7",
  "#d64545",
  "#2f8f64",
  "#d9851b",
  "#6b5bd2",
  "#d2b01e",
  "#c2379b",
  "#1f9aa8",
];

export function nextAnnotationColor(existingCount: number): string {
  return ANNOTATION_COLORS[existingCount % ANNOTATION_COLORS.length];
}
