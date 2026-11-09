import type { ReactNode } from "react";

import Navbar from "./Navbar";
import RepairProgress, { type ProgressProps } from "./RepairProgress";
import { cn } from "./ui";

/*
  The scaffold every screen uses: a viewport-high frame with the menu bar,
  the progress timeline under it when the screen is part of a repair, and a
  scrolling content column. `bleed` hands the whole content area to a
  viewport-filling child (the chat, the picker) with no padding and no page
  scroll. `home` marks the run list, `narrow` a calm centred column.
*/
export default function Page({
  progress,
  onAllRuns,
  home = false,
  bleed = false,
  narrow = false,
  children,
}: {
  progress?: ProgressProps;
  onAllRuns?: () => void;
  home?: boolean;
  bleed?: boolean;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Navbar home={home} onAllRuns={onAllRuns} />
      {progress && (
        <div className="shrink-0 border-b border-border/60">
          <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
            <RepairProgress {...progress} />
          </div>
        </div>
      )}
      {bleed ? (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div
            className={cn(
              "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-8 sm:px-6",
              narrow ? "max-w-3xl" : "max-w-6xl",
            )}
          >
            {children}
          </div>
        </main>
      )}
    </div>
  );
}
