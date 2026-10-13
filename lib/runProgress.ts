import type { FlowMessage, FlowRun } from "./types";

export const RUN_LIST = 7;
export const CAD_SCREEN = 6;
export const CHAT_SCREEN = 5;
export const INTAKE_MIN = 1;
export const INTAKE_MAX = 4;

export interface ScreenState {
  /** Run the user picked; null on the run list / a fresh app. */
  run: FlowRun | null;
  /** Transcript of the active run. */
  messages: FlowMessage[];
  /** Handoff documents the pipeline produced, in variant order. */
  handoffs: string[];
  /** Whether the user backed out of the CAD workspace onto the chat. */
  handoffDismissed: boolean;
  /** The screen the user last navigated to. */
  requestedScreen: number;
}

/*
  Fresh runs are seeded with one assistant greeting, so a greeting-only
  transcript means no user turn yet. But a transcript alone cannot decide
  this: turns persist after the conversation, so a run whose messages fetch
  came back empty or partial (legacy docs, fetch hiccups) still shows
  progress through runningDoc/currentNodeId. Opening such a run must land
  in the conversation, never reset the wizard — hence the run-shape
  fallback alongside hasUserTurn.
*/
export function hasUserTurn(messages: FlowMessage[]): boolean {
  return messages.some((message) => message.role === "user");
}

export function runShowsProgress(run: FlowRun | null): boolean {
  if (run === null) return false;
  if (run.status === "running") return true;
  return Object.keys(run.runningDoc ?? {}).length > 0;
}

export function handoffReadyFor(
  run: FlowRun | null,
  handoffs: string[],
): boolean {
  return run?.status === "idle" && handoffs.length > 0;
}

/** The screen actually rendered, derived from run state on top of the
 *  user's choice — no jump effects. Intake screens lift to the chat once
 *  the conversation exists (or the run shows progress); the chat
 *  auto-advances to CAD on a fresh handoff unless the user dismissed it. */
export function deriveScreen(state: ScreenState): number {
  const handoffReady = handoffReadyFor(state.run, state.handoffs);
  const conversationReady =
    handoffReady ||
    (state.run !== null &&
      (hasUserTurn(state.messages) || runShowsProgress(state.run)));
  let screen = state.requestedScreen;
  if (
    screen >= INTAKE_MIN &&
    screen <= INTAKE_MAX &&
    conversationReady
  ) {
    screen = CHAT_SCREEN;
  }
  if (
    screen === CHAT_SCREEN &&
    handoffReady &&
    !state.handoffDismissed
  ) {
    screen = CAD_SCREEN;
  }
  return screen;
}

/** Which screen to open when the user picks a run from the list. */
export function screenForSelectedRun(
  run: FlowRun,
  messages: FlowMessage[],
): number {
  return hasUserTurn(messages) || runShowsProgress(run)
    ? CHAT_SCREEN
    : INTAKE_MIN;
}

/*
  The timeline's six steps are not one-per-screen: step 4 is the
  conversation; steps 5, 6 and 7 share the CAD workspace — selecting the
  initial rough design, refining/calibrating it, and the final repair
  guidance. Step numbers therefore can't be used as screen numbers.
*/
export function timelineStepToScreen(step: number): number {
  const map: Record<number, number> = {
    1: INTAKE_MIN, // "Describe & Photos"
    2: 2, // "Annotate"
    3: 3, // "Review"
    4: CHAT_SCREEN, // "Repair Planning" (conversation)
    5: CAD_SCREEN, // "Select Initial Design"
    6: CAD_SCREEN, // "Refine & Calibrate" (same CAD workspace)
    7: CAD_SCREEN, // "Repair Guidance" (same CAD workspace)
  };
  return map[step] ?? CHAT_SCREEN;
}

/*
  Whether `currentScreen` may jump to timeline `step`. Past intake the
  timeline navigates freely; within intake only backward moves are allowed
  so the forward "Continue" guards (e.g. a size reference is required before
  Review) can't be bypassed by clicking ahead.
*/
export function canNavigateToStep(
  currentScreen: number,
  step: number,
): boolean {
  if (currentScreen >= CHAT_SCREEN) return true;
  const target = timelineStepToScreen(step);
  return (
    target >= INTAKE_MIN && target <= INTAKE_MAX && target < currentScreen
  );
}

