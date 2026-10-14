import type { ReactNode } from "react";

import RepairProgress from "./RepairProgress";
import type { StepClickStates, StepReasons } from "@/lib/runProgress";

/*
  The one page scaffold every screen of the app uses: a fixed viewport
  frame with no card. A chrome row at the top holds the timeline (when the
  page is bound to a run step) and a compact "All runs" button (the button
  drops the current run and goes to the runs overview); the children own
  the content area,
  which is a scrollable flex column with breathing space at the bottom,
  so the last element of a page (usually the Continue button) never hugs
  the   viewport edge. Pages stretch into it: viewport-filling screens fill
  it via flex-1 (chat, CAD workspace), others flow as normal content.
  The content column always spans the full screen width.

  The run id is never part of the chrome — it is data, not layout.
*/

export default function Page({
  currentStep,
  onAllRuns,
  onStepClick,
  clickStates,
  reasons,
  clarificationActive,
  bleed = false,
  children,
  className = "",
}: {
  /** Which run step this page is on, shown in the timeline. Omit it on
    screens that are not tied to a run's progress (the runs overview). */
  currentStep?: number;
  onAllRuns?: () => void;
  onStepClick?: (step: number) => void;
  clickStates?: StepClickStates;
  reasons?: StepReasons;
  clarificationActive?: boolean;
  /** The content fills the content area edge-to-edge: no horizontal or
    bottom padding, no page scroll. For viewport-filling screens (chat). */
  bleed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  /* The chrome row only exists when there is something to chrome: a
     timeline and/or the All runs button. Screens without both (the runs
     overview) go straight to their content. */
  const hasChrome =
    onAllRuns !== undefined || currentStep !== undefined;
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {hasChrome && (
        <div className="relative shrink-0 border-b border-line bg-white px-6 pr-24 pb-4 pt-4 max-[640px]:px-5 max-[640px]:pr-[96px]">
          {onAllRuns !== undefined && (
            <button
              type="button"
              title="Show all repair runs"
              className="btn-utility absolute right-6 top-4 max-[640px]:right-5"
              onClick={onAllRuns}
            >
              All runs
            </button>
          )}
          {currentStep !== undefined && (
            <RepairProgress
              currentStep={currentStep}
              onStepClick={onStepClick}
              clickStates={clickStates}
              reasons={reasons}
              clarificationActive={clarificationActive}
            />
          )}
        </div>
      )}
      <main
        className={
          bleed
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : `flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 max-[640px]:px-5 max-[640px]:pb-8 ${className}`.trim()
        }
      >
        {children}
      </main>
    </div>
  );
}
