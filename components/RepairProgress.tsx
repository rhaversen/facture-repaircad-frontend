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
const MARKER_HOVER =
  "cursor-pointer hover:shadow-[0_0_0_5px_rgba(44,103,215,0.22)]";

const LABEL_BASE = "mt-2 w-full px-1 text-[11px] leading-[1.25] break-words text-[#747b87]";

export default function RepairProgress({
  currentStep,
  flush = false,
  onStepClick,
}: {
  currentStep: number;
  /* flush drops the vertical margins for hosts that control their own page padding. */
  flush?: boolean;
  /* Navigate to a step when the timeline is used as navigation. Absent,
     the markers stay plain labels. */
  onStepClick?: (step: number) => void;
}) {
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
                title={onStepClick ? `Go to ${step}` : undefined}
                onClick={
                  onStepClick
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
                } ${onStepClick ? MARKER_HOVER : ""}`}
              >
                {complete ? "✓" : stepNumber}
              </button>
              <div
                className={`${LABEL_BASE} ${complete ? "text-[#4c5563]" : ""} ${current ? "font-bold text-[#1f2937]" : ""}`}
              >
                {step}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compact bar on narrow screens */}
      <div className="hidden max-[1050px]:block">
        <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
          <span className="text-[#6b7280]">
            Step {currentStep} of {STEPS.length}
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
