import type { StepClickStates, StepReasons } from "@/lib/runProgress";

const STEPS = [
  "Describe & Photos",
  "Annotate",
  "Review",
  "Repair Planning",
  "Select Initial Design",
  "Refine & Calibrate",
  "Repair Guidance",
];

/* Markers are real <button>s, so every global button default (margin,
   padding, bg, radius, font) is pinned here exactly once per state. */
const MARKER_BASE =
  "relative z-[1] m-0 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-2 p-0 text-[14px] font-semibold transition-shadow";
const MARKER_STATE_CURRENT =
  "border-[#2c67d7] bg-white text-[#2c67d7] shadow-[0_0_0_4px_rgba(44,103,215,0.12)]";
const MARKER_STATE_COMPLETE = "border-[#2c67d7] bg-[#2c67d7] text-white";
const MARKER_STATE_DEFAULT = "border-[#c7ccd6] bg-white text-[#747b87]";
const MARKER_STATE_LOCKED = "cursor-not-allowed border-[#dcdfe5] bg-[#f1f3f6] text-[#b3b9c4]";
const MARKER_HOVER =
  "cursor-pointer hover:shadow-[0_0_0_5px_rgba(44,103,215,0.22)]";

const LABEL_BASE = "mt-2 w-full px-1 text-[11px] leading-[1.25] break-words text-[#747b87]";

export default function RepairProgress({
  currentStep,
  flush = false,
  onStepClick,
  clickStates,
  reasons,
  clarificationActive = false,
}: {
  currentStep: number;
  /* flush drops the vertical margins for hosts that control their own page padding. */
  flush?: boolean;
  /* Navigate to a step when the timeline is used as navigation. Absent,
     the markers stay plain labels. */
  onStepClick?: (step: number) => void;
  /* Per-step clickability, from the navigation decision function. Absent
     entries default to enabled (except the current step). */
  clickStates?: StepClickStates;
  /* Tooltip reason for each locked step. */
  reasons?: StepReasons;
  /* A forced sub-point under step 4: the system is waiting on the
     clarification question, so 4 is the active state even though it looks
     "complete". Only shown while the system forces the user there. */
  clarificationActive?: boolean;
}) {
  const locked = (step: number): boolean =>
    step !== currentStep && clickStates?.[step] === "disabled";
  return (
    <div
      className={`w-full min-w-0 shrink-0 ${
        flush ? "" : "my-7 max-[1050px]:my-3.5 max-[1050px]:mb-6"
      }`}
    >
      {/* Full stepper on wide screens */}
      <div className="flex w-full min-w-0 items-start max-[1050px]:hidden">
        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const complete = stepNumber < currentStep;
          const current = stepNumber === currentStep;
          const stepLocked = locked(stepNumber);
          return (
            <div
              className={`relative flex min-w-0 flex-1 flex-col items-center text-center ${
                index < STEPS.length - 1
                  ? "after:absolute after:top-[17px] after:left-[calc(50%_+_20px)] after:z-0 after:h-0.5 after:w-[calc(100%_-_40px)] after:bg-[#d9dde5]"
                  : ""
              } ${complete && index < STEPS.length - 1 ? "after:bg-[#2c67d7]" : ""}`}
              key={step}
            >
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                aria-disabled={stepLocked || undefined}
                title={
                  stepLocked
                    ? reasons?.[stepNumber] ?? `Step ${stepNumber} not available yet`
                    : onStepClick
                      ? `Go to ${stepNumber}`
                      : undefined
                }
                onClick={
                  onStepClick && !stepLocked
                    ? () => {
                        onStepClick(stepNumber);
                      }
                    : undefined
                }
                className={`${MARKER_BASE} ${
                  current
                    ? MARKER_STATE_CURRENT
                    : complete
                      ? MARKER_STATE_COMPLETE
                      : MARKER_STATE_DEFAULT
                } ${stepLocked ? MARKER_STATE_LOCKED : ""} ${
                  onStepClick && !stepLocked ? MARKER_HOVER : ""
                }`}
              >
                {complete && !stepLocked ? "✓" : stepNumber}
              </button>
              <div
                className={`${LABEL_BASE} ${complete && !stepLocked ? "text-[#4c5563]" : ""} ${
                  stepLocked ? "text-[#9aa1ab]" : ""
                } ${current ? "font-bold text-[#1f2937]" : ""}`}
              >
                {step}
              </div>
              {/* Forced sub-point: the system is parked at the clarification
                  question (step 4), which doesn't fit the 7-step flow. Shown
                  only while the system forces the user to be there. */}
              {stepNumber === 4 && clarificationActive && (
                <div className="mt-1 w-full px-1">
                  <div className="rounded bg-[#eef2fb] px-1.5 py-0.5 text-[10px] font-medium text-[#2c67d7]">
                    Clarification
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Compact bar on narrow screens */}
      <div className="hidden max-[1050px]:block">
        <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
          <span className="text-[#6b7280]">
            Step {currentStep} of {STEPS.length}
            {clarificationActive ? " · Clarification" : ""}
          </span>
          <strong className="text-right text-[#1f2937]">{STEPS[currentStep - 1]}</strong>
        </div>
        <div className="h-[7px] w-full overflow-hidden rounded-full bg-[#e4e7ec]">
          <div
            className="h-full rounded-full bg-[#2c67d7] transition-[width] duration-200"
            style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
