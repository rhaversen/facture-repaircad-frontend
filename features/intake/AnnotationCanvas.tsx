"use client";

import type { Annotation, NormalizedBox } from "@/lib/types";

type AnyBox = Partial<NormalizedBox> & {
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
};

/** Percentage-positioned style for either a saved or a draft annotation box. */
export function boxStyle(box: AnyBox) {
  const left = Math.min(
    box.startX ?? box.x ?? 0,
    box.endX ?? (box.x ?? 0) + (box.width ?? 0),
  );
  const top = Math.min(
    box.startY ?? box.y ?? 0,
    box.endY ?? (box.y ?? 0) + (box.height ?? 0),
  );
  const width = box.width ?? Math.abs((box.endX ?? 0) - (box.startX ?? 0));
  const height = box.height ?? Math.abs((box.endY ?? 0) - (box.startY ?? 0));
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}

interface AnnotationCanvasProps {
  imageUrl: string;
  imageAlt: string;
  annotations: Annotation[];
  draftBox: AnyBox | null;
  imageWrapperRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  /* Compact height budget for use inside a bounded sidebar pane. */
  compact?: boolean;
}

/*
  Image + normalized (0–1) annotation boxes + live draft box. The pointer
  handlers are supplied by the owning screen's intake controller so both the
  main intake and clarification flows share one implementation.
*/
export default function AnnotationCanvas({
  imageUrl,
  imageAlt,
  annotations,
  draftBox,
  imageWrapperRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  compact = false,
}: AnnotationCanvasProps) {
  return (
    <div className="flex items-start justify-center">
      <div
        ref={imageWrapperRef}
        className="relative w-fit max-w-full cursor-crosshair overflow-hidden rounded-lg border border-line-light bg-[#f2f3f5] text-[0] [touch-action:none] select-none [-webkit-user-select:none]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={imageAlt}
          draggable="false"
          className={`mx-auto block h-auto w-auto max-w-full pointer-events-none ${
            compact ? "max-h-[40vh]" : "max-h-[calc(100vh_-_320px)]"
          }`}
        />

        {annotations.map((annotation) => (
          <div
            key={annotation.id}
            className="absolute border-[3px] border-solid pointer-events-none"
            style={{
              borderColor: annotation.color,
              ...boxStyle(annotation.box),
            }}
          >
            <span
              className="absolute top-0 left-0 -translate-y-full bg-ink px-1.5 py-0.5 text-xs whitespace-nowrap text-white"
              style={{ background: annotation.color }}
            >
              {annotation.label || "Unnamed"}
            </span>
          </div>
        ))}

        {draftBox && (
          <div
            className="absolute border-[3px] border-dashed border-[#555] bg-white/15 pointer-events-none"
            style={boxStyle(draftBox)}
          />
        )}
      </div>
    </div>
  );
}
