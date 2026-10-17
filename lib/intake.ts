import type { Annotation, Photo, Unit } from "./types";

export const UNITS: Unit[] = ["mm", "cm", "in"];

/* Matches the flow backend's per-upload image cap. */
export const MAX_PHOTOS = 4;

const COLORS = ["#2c67d7", "#d64545", "#2f8f64", "#d9851b", "#6b5bd2", "#d2b01e", "#c2379b", "#1f9aa8"];

export const annotationColor = (index: number) => COLORS[index % COLORS.length];

function annotationLabel(annotation: Annotation): string {
  const reference = annotation.sizeReference;
  return reference
    ? `${annotation.label || "Unnamed"} (${reference.knownDimension} ${reference.unit})`
    : annotation.label || "Unnamed";
}

/** The run's first user turn: the description plus each photo's annotations. */
export function intakeMessage(
  description: string,
  photos: Photo[],
  annotations: Annotation[],
): string {
  const lines = ["REPAIR DESCRIPTION", description.trim()];
  photos.forEach((photo, index) => {
    const own = annotations.filter((a) => a.photoId === photo.id);
    lines.push("", `PHOTO ${index + 1}`, "");
    if (own.length === 0) {
      lines.push("Annotations: none");
      return;
    }
    lines.push("Annotations:");
    for (const annotation of own) {
      const { x, y, width, height } = annotation.box;
      lines.push(
        annotation.sizeReference
          ? `- Size reference: ${annotationLabel(annotation)}`
          : `- ${annotationLabel(annotation)}`,
        `  Box: x=${x.toFixed(3)}, y=${y.toFixed(3)}, width=${width.toFixed(3)}, height=${height.toFixed(3)}`,
      );
    }
  });
  return lines.join("\n");
}

/** A clarification turn: the typed answer plus the photos' annotation names. */
export function clarificationMessage(
  answer: string,
  photos: Photo[],
  annotations: Annotation[],
): string {
  const photoLines = photos.flatMap((photo, index) => {
    const own = annotations.filter((a) => a.photoId === photo.id);
    return own.length === 0
      ? []
      : [`PHOTO ${index + 1} ANNOTATIONS`, ...own.map((a) => `- ${annotationLabel(a)}`)];
  });
  return (
    [answer.trim(), photoLines.join("\n")].filter(Boolean).join("\n\n") ||
    "I have attached the requested clarification photos."
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

/* The photo with its boxes and labels burned in, as the JPEG that is uploaded
   (the model sees the marks, not just the coordinates in the message). */
async function annotatedFile(photo: Photo, annotations: Annotation[]): Promise<File> {
  const image = await loadImage(photo.previewUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not supported.");
  context.drawImage(image, 0, 0);

  const scale = Math.max(canvas.width, canvas.height) / 1200;
  const fontSize = Math.max(18, 24 * scale);
  const padding = Math.max(6, 8 * scale);
  context.lineWidth = Math.max(3, 5 * scale);
  context.font = `600 ${fontSize}px Arial, sans-serif`;
  context.textBaseline = "middle";

  for (const annotation of annotations.filter((a) => a.photoId === photo.id)) {
    const x = annotation.box.x * canvas.width;
    const y = annotation.box.y * canvas.height;
    context.strokeStyle = annotation.color;
    context.strokeRect(x, y, annotation.box.width * canvas.width, annotation.box.height * canvas.height);

    const label = annotationLabel(annotation);
    const labelHeight = fontSize + padding * 2;
    const labelY = y - labelHeight < 0 ? y : y - labelHeight;
    context.fillStyle = annotation.color;
    context.fillRect(x, labelY, context.measureText(label).width + padding * 2, labelHeight);
    context.fillStyle = "#ffffff";
    context.fillText(label, x + padding, labelY + labelHeight / 2);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8),
  );
  if (!blob) throw new Error("Could not create the annotated image.");
  const name = photo.file.name.replace(/\.[^/.]+$/, "");
  return new File([blob], `${name}_annotated.jpg`, { type: "image/jpeg" });
}

export const annotatedFiles = (photos: Photo[], annotations: Annotation[]) =>
  Promise.all(photos.map((photo) => annotatedFile(photo, annotations)));
