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
  "relative z-[1] m-0 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border-2 p-0 text-[13px] font-semibold transition-shadow";
const MARKER_STATE_CURRENT =
  "border-[#2c67d7] bg-white text-[#2c67d7] shadow-[0_0_0_4px_rgba(44,103,215,0.12)]";
const MARKER_STATE_COMPLETE = "border-[#2c67d7] bg-[#2c67d7] text-white";
const MARKER_STATE_DEFAULT = "border-[#c7ccd6] bg-white text-[#747b87]";
const MARKER_STATE_LOCKED =
  "cursor-not-allowed border-[#dcdfe5] bg-[#f1f3f6] text-[#747b87]";
const MARKER_HOVER =
  "cursor-pointer hover:shadow-[0_0_0_5px_rgba(44,103,215,0.22)]";

const LABEL_BASE = "mt-1.5 w-full px-1 text-[11px] leading-[1.2] break-words text-[#747b87]";

export default function RepairProgress({
  currentStep,
  onStepClick,
  clickStates,
  reasons,
  clarificationActive = false,
}: {
  currentStep: number;
  /* Navigate to a step when the timeline is used as navigation. Absent,
     the markers stay plain labels. */
  onStepClick?: (step: number) => void;
  /* Per-step clickability, from the navigation decision function. Absent
     entries default to enabled (except the current step). */
  clickStates?: StepClickStates;
  /* Tooltip reason for each locked step. */
  reasons?: StepReasons;
  /* The run is parked on step 4's clarification conversation: step 4
     becomes the highlighted/current step (replacing its check), stays
     unlocked, and a "Clarification" chip appears next to its label, in
     the same single line — no extra height. */
  clarificationActive?: boolean;
}) {
  const locked = (step: number): boolean => {
    /* A pending clarification parks the run on step 4's conversation —
       that step stays live (clickable, highlighted) even though
       clickStates disables it while currentStep has moved on. */
    if (step === 4 && clarificationActive) return false;
    return step !== currentStep && clickStates?.[step] === "disabled";
  };
  return (
    <div className="w-full min-w-0 shrink-0">
      <div className="flex w-full min-w-0 items-start">
        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          /* A pending clarification parks the run on the conversation,
             so step 4 counts as current while it is shown (marker stays
             highlight, connector to 5 stays colored). */
          const effectiveCurrent =
            stepNumber === 4 && clarificationActive ? 4 : currentStep;
          const complete = stepNumber < effectiveCurrent;
          const current = stepNumber === effectiveCurrent;
          const stepLocked = locked(stepNumber);
          /* Pick a single state class: stacking two (e.g. complete +
             locked) lets stylesheet order decide the winner of each
             conflicting property instead of the intended precedence. */
          const stateClass = stepLocked
            ? MARKER_STATE_LOCKED
            : current
              ? MARKER_STATE_CURRENT
              : complete
                ? MARKER_STATE_COMPLETE
                : MARKER_STATE_DEFAULT;
          return (
            <div
              className={`relative flex min-w-0 flex-1 flex-col items-center text-center ${
                index < STEPS.length - 1
                  ? "after:absolute after:top-[13px] after:left-[calc(50%_+_14px)] after:z-0 after:h-0.5 after:w-[calc(100%_-_28px)] after:bg-[#d9dde5]"
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
                className={`${MARKER_BASE} ${stateClass} ${
                  onStepClick && !stepLocked ? MARKER_HOVER : ""
                }`}
              >
                {complete && !stepLocked ? "✓" : stepNumber}
              </button>
              {/* The label; while parked on the clarification question a
                  chip joins step 4's label on the right. items-start keeps
                  the chip on the label's first line when the label wraps
                  to two lines — no extra height either way. */}
              <div
                className={`${LABEL_BASE} flex items-start justify-center gap-1 ${
                  complete && !stepLocked ? "text-[#4c5563]" : ""
                } ${stepLocked ? "text-[#747b87]" : ""} ${current ? "font-bold text-[#1f2937]" : ""}`}
              >
                <span className="min-w-0">{step}</span>
                {stepNumber === 4 && clarificationActive && (
                  <span className="shrink-0 rounded bg-[#eef2fb] px-1.5 text-[10px] leading-[13px] font-medium whitespace-nowrap text-[#2c67d7]">
                    Clarification
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
