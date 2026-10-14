import type { ReactNode } from "react";

import { AppShell, Card } from "./AppShell";
import RepairProgress from "./RepairProgress";
import type { StepClickStates, StepReasons } from "@/lib/runProgress";

/*
  Every screen of the app uses the same page scaffold:

  - Intake-style pages ("scroll"): the white card owns the scroll and the
    card caps its own width (wide extends it for photo-heavy content).
  - The CAD workspace ("fill"): the card fills the viewport height and its
    inner content fills the card, so the 3D view and the pinned picker bar
    can lay out against a definite height.
  - The chat page ("flush"): no card at all — the content fills the
    viewport, the component owns its own inner layout.

  The chrome row is identical everywhere: the timeline, and a compact
  "＋ New run" utility button in its top-right corner. Pages that need
  their own header instead of the plain title (the runs list) can instead
  pass `title`/`subtitle` = undefined plus their `children` content.

  The run id is never part of the chrome — it is data, not layout.
*/

function NewRunButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Start a new run"
      className="btn-utility absolute -top-2 right-0"
      onClick={onClick}
    >
      ＋ New run
    </button>
  );
}

export default function Page({
  fill = false,
  wide = false,
  flush = false,
  currentStep,
  onNewRun,
  onStepClick,
  clickStates,
  reasons,
  clarificationActive,
  title,
  subtitle,
  children,
  className = "",
}: {
  /* Layout mode:
     neither flag = a scrolling card (intake pages),
     fill = a card that fills the viewport height (CAD),
     flush = no card; the children own the viewport layout (chat). */
  fill?: boolean;
  wide?: boolean;
  flush?: boolean;
  currentStep: number;
  onNewRun?: () => void;
  onStepClick?: (step: number) => void;
  clickStates?: StepClickStates;
  reasons?: StepReasons;
  clarificationActive?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (flush) {
    /* Full-viewport page: flat horizontal padding, the timeline row fixes
       its own top gap (New run corner button included), then the content
       fills the remaining height. */
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="relative shrink-0 px-6 pb-4 pt-4 max-[640px]:px-5">
          {onNewRun !== undefined && (
            <button
              type="button"
              title="Start a new run"
              className="btn-utility absolute right-6 top-4 max-[640px]:right-5"
              onClick={onNewRun}
            >
              ＋ New run
            </button>
          )}
          <RepairProgress
            currentStep={currentStep}
            flush
            onStepClick={onStepClick}
            clickStates={clickStates}
            reasons={reasons}
            clarificationActive={clarificationActive}
          />
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}>{children}</div>
      </div>
    );
  }

  const cardClass =
    `${fill ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto" : ""} ` +
    `${wide ? "!max-w-[1600px] !px-10" : ""} ` +
    `${className}`;

  return (
    <AppShell fill={fill}>
      <Card fill={fill} className={cardClass.trim()}>
        <div className="relative mb-6 shrink-0">
          {onNewRun !== undefined && <NewRunButton onClick={onNewRun} />}
          <RepairProgress
            currentStep={currentStep}
            onStepClick={onStepClick}
            clickStates={clickStates}
            reasons={reasons}
            clarificationActive={clarificationActive}
          />
        </div>

        {title !== undefined && <h1>{title}</h1>}
        {subtitle !== undefined && (
          <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
            {subtitle}
          </p>
        )}

        {children}
      </Card>
    </AppShell>
  );
}
