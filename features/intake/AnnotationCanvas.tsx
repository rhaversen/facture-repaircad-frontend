"use client";

import type { Annotation, NormalizedBox } from "@/lib/types";

const boxStyle = (box: NormalizedBox) => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`,
});

/*
  A photo with its annotation boxes drawn over it in normalized (0–1)
  coordinates. With pointer handlers it is the drawing surface; without, a
  read-only preview.
*/
export default function AnnotationCanvas({
  imageUrl,
  alt,
  annotations,
  draftBox = null,
  canvasRef,
  pointerHandlers,
  className = "max-h-[calc(100vh-320px)]",
}: {
  imageUrl: string;
  alt: string;
  annotations: Annotation[];
  draftBox?: NormalizedBox | null;
  canvasRef?: React.RefObject<HTMLDivElement | null>;
  pointerHandlers?: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
  };
  /** Image height limit. */
  className?: string;
}) {
  return (
    <div
      ref={canvasRef}
      {...pointerHandlers}
      className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-line-light bg-[#f2f3f5] select-none ${
        pointerHandlers ? "cursor-crosshair touch-none" : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        draggable="false"
        className={`pointer-events-none block h-auto w-auto max-w-full ${className}`}
      />
      {annotations.map((annotation) => (
        <div
          key={annotation.id}
          className="pointer-events-none absolute border-[3px]"
          style={{ borderColor: annotation.color, ...boxStyle(annotation.box) }}
        >
          <span
            className="absolute top-0 left-0 -translate-y-full px-1.5 py-0.5 text-xs whitespace-nowrap text-white"
            style={{ background: annotation.color }}
          >
            {annotation.label || "Unnamed"}
          </span>
        </div>
      ))}
      {draftBox && (
        <div
          className="pointer-events-none absolute border-[3px] border-dashed border-[#555] bg-white/15"
          style={boxStyle(draftBox)}
        />
      )}
    </div>
  );
}
