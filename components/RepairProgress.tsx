import { cn } from "./ui";

const STEPS = [
  "Describe",
  "Annotate",
  "Review",
  "Planning",
  "Pick a design",
  "Refine",
  "Guidance",
];

export interface ProgressProps {
  /** The step shown, 1-based. */
  step: number;
  /** Steps the user may go back to; every other marker is inert. */
  backTo?: number[];
  onStep?: (step: number) => void;
  /** The planning step is waiting on the user's clarification. */
  clarification?: boolean;
}

/*
  The seven-step timeline. It only ever navigates backwards within the current
  section (intake, or designs): earlier sections are done for good, and
  forward moves belong to the page's own buttons. On narrow screens only the
  current step keeps its label.
*/
export default function RepairProgress({
  step,
  backTo = [],
  onStep,
  clarification = false,
}: ProgressProps) {
  return (
    <ol className="flex w-full min-w-0 items-start">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const done = n < step;
        const current = n === step;
        const clickable = onStep !== undefined && backTo.includes(n);
        return (
          <li
            key={label}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center text-center",
              n < STEPS.length &&
                "after:absolute after:top-[11px] after:left-[calc(50%+16px)] after:h-px after:w-[calc(100%-32px)]",
              n < STEPS.length && (done ? "after:bg-accent" : "after:bg-border-strong"),
            )}
          >
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              disabled={!clickable}
              title={clickable ? `Back to ${label}` : label}
              onClick={() => onStep?.(n)}
              className={cn(
                "relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-shadow",
                current
                  ? "bg-accent text-accent-contrast ring-4 ring-accent-soft"
                  : done
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-2 text-subtle",
                clickable ? "cursor-pointer hover:ring-4 hover:ring-accent-soft" : "cursor-default",
              )}
            >
              {done ? "✓" : n}
            </button>
            <div
              className={cn(
                "mt-1.5 flex w-full items-start justify-center gap-1 px-1 text-[11px] leading-tight break-words",
                current ? "font-medium text-foreground" : "text-subtle max-sm:invisible",
              )}
            >
              <span className="min-w-0">{label}</span>
              {n === 4 && current && clarification && (
                <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium whitespace-nowrap text-warning">
                  Question
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
