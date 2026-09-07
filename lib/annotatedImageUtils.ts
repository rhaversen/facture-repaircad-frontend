import type { Annotation, AnnotatedCopy, Photo } from "@/lib/types";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not create annotated image."));
        }
      },
      "image/jpeg",
      0.8,
    );
  });
}

/** Render the photo with its annotation boxes + label chips onto a canvas and
 *  export it as a JPEG File plus an object URL for preview. */
export async function createAnnotatedCopy(
  photo: Photo,
  annotations: Annotation[],
): Promise<AnnotatedCopy> {
  const image = await loadImage(photo.previewUrl);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not supported.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const photoAnnotations = annotations.filter(
    (annotation) => annotation.photoId === photo.id,
  );

  const scale = Math.max(canvas.width, canvas.height) / 1200;
  const lineWidth = Math.max(3, 5 * scale);
  const fontSize = Math.max(18, 24 * scale);

  context.font = `600 ${fontSize}px Arial, sans-serif`;
  context.textBaseline = "middle";

  for (const annotation of photoAnnotations) {
    const color = annotation.color || "#2c67d7";

    const x = annotation.box.x * canvas.width;
    const y = annotation.box.y * canvas.height;
    const width = annotation.box.width * canvas.width;
    const height = annotation.box.height * canvas.height;

    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.strokeRect(x, y, width, height);

    let label = annotation.label || "Unnamed";
    if (annotation.sizeReference) {
      const reference = annotation.sizeReference;
      label += ` (${reference.knownDimension} ${reference.unit})`;
    }

    const padding = Math.max(6, 8 * scale);
    const textWidth = context.measureText(label).width;
    const labelHeight = fontSize + padding * 2;
    let labelY = y - labelHeight;
    if (labelY < 0) {
      labelY = y;
    }

    context.fillStyle = color;
    context.fillRect(x, labelY, textWidth + padding * 2, labelHeight);

    context.fillStyle = "#ffffff";
    context.fillText(label, x + padding, labelY + labelHeight / 2);
  }

  const blob = await canvasToBlob(canvas);

  const originalName = photo.file.name.replace(/\.[^/.]+$/, "");
  const annotatedFile = new File([blob], `${originalName}_annotated.jpg`, {
    type: "image/jpeg",
  });

  const url = URL.createObjectURL(annotatedFile);
  return { file: annotatedFile, url };
}
