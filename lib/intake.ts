import type { Annotation, FlowMessage, MessageContentPart, Photo, Unit } from "./types";

export const UNITS: Unit[] = ["mm", "cm", "in"];

/* Photos per repair, across the intake and every clarification. It is also
   the flow backend's per-message cap, so any one turn always fits. */
export const MAX_PHOTOS = 10;

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

/** How many photos the user has already sent on the run. GET /messages
    hydrates each stored image into a `file` part; a raw `user-image` marker
    counts too. */
export function photosSent(messages: FlowMessage[]): number {
  return messages
    .filter((m) => m.role === "user" && Array.isArray(m.content))
    .flatMap((m) => m.content as MessageContentPart[])
    .filter((part) => part?.type === "file" || part?.type === "user-image").length;
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

/* Greedy word wrap to `width`; a word wider than the line gets a line of
   its own and is broken by character. */
function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width) {
      line = next;
      return;
    }
    if (line) lines.push(line);
    line = "";
    if (context.measureText(word).width <= width) {
      line = word;
      return;
    }
    let part = "";
    for (const char of word) {
      if (part && context.measureText(part + char).width > width) {
        lines.push(part);
        part = "";
      }
      part += char;
    }
    line = part;
  };
  for (const word of text.split(/\s+/).filter(Boolean)) push(word);
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
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
    const right = x + annotation.box.width * canvas.width;
    context.strokeStyle = annotation.color;
    context.strokeRect(x, y, right - x, annotation.box.height * canvas.height);

    // The label wraps upward from the box's top edge, on the side of the box
    // with more room, as the on-screen preview draws it.
    const anchorLeft = canvas.width - x >= right;
    const room = (anchorLeft ? canvas.width - x : right) - padding * 2;
    const lines = wrapText(context, annotationLabel(annotation), room);
    const lineHeight = fontSize * 1.2;
    const width = Math.max(...lines.map((line) => context.measureText(line).width)) + padding * 2;
    const height = lines.length * lineHeight + padding * 2;
    const left = anchorLeft ? x : right - width;
    const top = Math.max(0, y - height);
    context.fillStyle = annotation.color;
    context.fillRect(left, top, width, height);
    context.fillStyle = "#ffffff";
    lines.forEach((line, index) => {
      context.fillText(line, left + padding, top + padding + lineHeight * (index + 0.5));
    });
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
