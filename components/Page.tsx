import type { ReactNode } from "react";

import RepairProgress, { type ProgressProps } from "./RepairProgress";

/*
  The scaffold every screen uses: a viewport-high frame with a top bar (the
  progress timeline and the All runs button) over a scrolling content column.
  `bleed` hands the whole content area to a viewport-filling child (the chat,
  the picker) with no padding and no page scroll.
*/
export default function Page({
  progress,
  onAllRuns,
  bleed = false,
  children,
}: {
  progress?: ProgressProps;
  onAllRuns?: () => void;
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {(progress || onAllRuns) && (
        <div className="relative shrink-0 border-b border-line bg-white px-6 py-4 pr-24 max-[640px]:px-5 max-[640px]:pr-24">
          {onAllRuns && (
            <button
              type="button"
              title="Show all repair runs"
              className="btn-utility absolute top-4 right-6 max-[640px]:right-5"
              onClick={onAllRuns}
            >
              All runs
            </button>
          )}
          {progress && <RepairProgress {...progress} />}
        </div>
      )}
      <main
        className={
          bleed
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 pb-10 max-[640px]:px-5 max-[640px]:pb-8"
        }
      >
        {children}
      </main>
    </div>
  );
}
