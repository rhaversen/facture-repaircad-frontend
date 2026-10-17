const STEPS = [
  "Describe & Photos",
  "Annotate",
  "Review",
  "Repair Planning",
  "Select Initial Design",
  "Refine & Calibrate",
  "Repair Guidance",
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
  forward moves belong to the page's own buttons.
*/
export default function RepairProgress({
  step,
  backTo = [],
  onStep,
  clarification = false,
}: ProgressProps) {
  return (
    <ol className="m-0 flex w-full min-w-0 list-none items-start p-0">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const done = n < step;
        const current = n === step;
        const clickable = onStep !== undefined && backTo.includes(n);
        return (
          <li
            key={label}
            className={`relative flex min-w-0 flex-1 flex-col items-center text-center ${
              n < STEPS.length
                ? `after:absolute after:top-[13px] after:left-[calc(50%+14px)] after:h-0.5 after:w-[calc(100%-28px)] ${
                    done ? "after:bg-[#2c67d7]" : "after:bg-[#d9dde5]"
                  }`
                : ""
            }`}
          >
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              disabled={!clickable}
              title={clickable ? `Back to ${label}` : undefined}
              onClick={() => onStep?.(n)}
              className={`relative z-[1] m-0 flex h-7 w-7 items-center justify-center rounded-full border-2 p-0 text-[13px] font-semibold disabled:cursor-default ${
                current
                  ? "border-[#2c67d7] bg-white text-[#2c67d7] shadow-[0_0_0_4px_rgba(44,103,215,0.12)] disabled:bg-white"
                  : done
                    ? "border-[#2c67d7] bg-[#2c67d7] text-white disabled:bg-[#2c67d7]"
                    : "border-[#c7ccd6] bg-white text-[#747b87] disabled:bg-white"
              } ${clickable ? "hover:shadow-[0_0_0_5px_rgba(44,103,215,0.22)]" : ""}`}
            >
              {done ? "✓" : n}
            </button>
            <div
              className={`mt-1.5 flex w-full items-start justify-center gap-1 px-1 text-[11px] leading-[1.2] break-words ${
                current ? "font-bold text-[#1f2937]" : done ? "text-[#4c5563]" : "text-[#747b87]"
              }`}
            >
              <span className="min-w-0">{label}</span>
              {n === 4 && current && clarification && (
                <span className="shrink-0 rounded bg-brand-tint px-1.5 text-[10px] leading-[13px] font-medium whitespace-nowrap text-[#2c67d7]">
                  Clarification
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
