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
  /** Trimmed provisional_cad_handoff document. */
  handoffMarkdown: string;
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

export function handoffReadyFor(run: FlowRun | null, handoffMarkdown: string): boolean {
  return run?.status === "idle" && handoffMarkdown !== "";
}

/** The screen actually rendered, derived from run state on top of the
 *  user's choice — no jump effects. Intake screens lift to the chat once
 *  the conversation exists (or the run shows progress); the chat
 *  auto-advances to CAD on a fresh handoff unless the user dismissed it. */
export function deriveScreen(state: ScreenState): number {
  const handoffReady = handoffReadyFor(state.run, state.handoffMarkdown);
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
