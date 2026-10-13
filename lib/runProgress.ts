import type { ForgePhase, FlowMessage, FlowRun } from "./types";

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
 * Timeline navigation decisions.
 *
 * Every timeline click resolves to exactly one of: "navigate" (jump to the
 * target step's screen), "noop" (already there), or "locked" (not revisable
 * yet, with a human-readable reason for the tooltip). The 7-step timeline
 * uses one screen per step except that steps 5–7 share the CAD workspace:
 * 5 "Select Initial Design" is the design picker, 6 "Refine & Calibrate"
 * shows the selected model being calibrated against the guides, 7 "Repair
 * Guidance" shows the final guidance document. The 5/6/7 distinction inside
 * the CAD screen lives on `TimelineNavState.cadStep`; `stepNav` stays a
 * pure function over that state.
 */

export type StepClickState = "enabled" | "disabled";
export type StepClickStates = Partial<Record<number, StepClickState>>;

/** Per-step tooltip reason, shown on locked markers. */
export type StepReasons = Partial<Record<number, string>>;

export interface TimelineNavState {
  /** The screen actually rendered (per deriveScreen): 1-4 intake,
      5 chat, 6 CAD workspace. Steps 5/6/7 of the timeline all live on
      screen 6; `cadStep` says which sub-state is visible there. */
  screen: number;
  /** The conversation has started (a user turn exists or the run shows
      pipeline progress): steps 1-3 then lift into it and are not
      revisable. */
  conversationReady: boolean;
  /** The pipeline has produced at least one CAD draft (idle run with
      handoffs): the CAD sub-steps become reachable. */
  handoffReady: boolean;
  /** A forced clarification question is pending inside the conversation:
      every step except the conversation itself is locked until it is
      answered. */
  clarificationActive: boolean;
  /** The CAD sub-state currently visible while screen === CAD_SCREEN:
      5 picker, 6 calibration, 7 guidance (see cadStepFor). Ignored on
      other screens. */
  cadStep: number;
  /** A design is selected in the CAD workspace: steps 6 and 7 need one.
      Ignored on other screens; the CAD view supplies it. */
  cadSelectionMade: boolean;
  /** The final repair guidance exists: step 7 becomes unlocked. */
  hasFinalGuidance: boolean;
}

export type StepNavAction =
  | { kind: "navigate"; target: number }
  | { kind: "noop" }
  | { kind: "locked"; reason: string };

const REASON_IN_INTAKE =
  "Intake is still in progress — continue through the wizard steps.";
const REASON_CONVERSATION =
  "The conversation has started — this intake step is no longer available.";
const REASON_CLARIFICATION =
  "Answer the clarification question before moving on.";
const REASON_NO_HANDOFF =
  "No CAD draft yet — the conversation still needs to run.";
const REASON_SELECT_DESIGN = "Select a design first.";
const REASON_NO_GUIDANCE =
  "Repair guidance appears once calibration is finished.";

/** Timeline markers for the CAD sub-states (all on screen 6). */
const CAD_SUBSTEP_PICKER = 5;
const CAD_SUBSTEP_CALIBRATION = 6;
const CAD_SUBSTEP_GUIDANCE = 7;

/**
 * Pure decision for a timeline-marker click. Every step resolves to
 * navigate (jump to the marker's screen, or to a CAD sub-state when the
 * target marker lives on the visible CAD screen), noop (already there),
 * or locked (not revisable, with a tooltip reason) — so no click can ever
 * land in a state that is not reachable.
 */
export function stepNav(state: TimelineNavState, step: number): StepNavAction {
  const {
    screen,
    conversationReady,
    handoffReady,
    clarificationActive,
    cadStep,
    cadSelectionMade,
    hasFinalGuidance,
  } = state;
  const toScreen = timelineStepToScreen(step);

  /*
   * The CAD workspace renders the timeline's steps 5-7 as sub-states.
   * Steps 1-4 mean "back to the conversation" (target CHAT_SCREEN);
   * the 5/6/7 markers open the CAD sub-states — the picker is carried
   * as target 5, calibration/guidance as the CAD screen itself, so the
   * CAD view can tell which sub-state to reveal.
   */
  if (screen === CAD_SCREEN) {
    if (step < CAD_SUBSTEP_PICKER) {
      return { kind: "navigate", target: CHAT_SCREEN };
    }
    if (step === cadStep) return { kind: "noop" };
    if (step === CAD_SUBSTEP_PICKER) {
      return { kind: "navigate", target: CAD_SUBSTEP_PICKER };
    }
    if (!cadSelectionMade) {
      return { kind: "locked", reason: REASON_SELECT_DESIGN };
    }
    if (step === CAD_SUBSTEP_GUIDANCE && !hasFinalGuidance) {
      return { kind: "locked", reason: REASON_NO_GUIDANCE };
    }
    return { kind: "navigate", target: CAD_SCREEN };
  }

  /* Already on the marker's screen. */
  if (toScreen === screen) return { kind: "noop" };

  /* A pending clarification question locks every step except the
     conversation itself (that marker already resolved to noop above) —
     the question has to be answered before moving on. */
  if (clarificationActive && screen >= CHAT_SCREEN) {
    return { kind: "locked", reason: REASON_CLARIFICATION };
  }

  /* Inside the intake wizard the Continue button owns forward
     navigation (it guards the size-reference measurement, review, and
     submission); forward markers stay locked, backward stays free. */
  if (screen >= INTAKE_MIN && screen <= INTAKE_MAX) {
    if (step > screen) return { kind: "locked", reason: REASON_IN_INTAKE };
    return { kind: "navigate", target: toScreen };
  }

  /* Steps 1-3 lift into the conversation once it started: not
     revisable. */
  if (conversationReady && step >= INTAKE_MIN && step <= INTAKE_MAX) {
    return { kind: "locked", reason: REASON_CONVERSATION };
  }

  /* Steps 5-7 need at least one CAD draft before the sub-states can
     exist. */
  if (step >= CAD_SUBSTEP_PICKER && !handoffReady) {
    return { kind: "locked", reason: REASON_NO_HANDOFF };
  }

  /* Everything left is reachable: the conversation (or CAD). */
  return { kind: "navigate", target: toScreen };
}

/**
 * Per-step click state for the timeline, plus locked-step reasons. A step
 * is disabled when it is the current step (no-op) or when stepNav returns
 * "locked". Navigation targets are always enabled.
 */
export function timelineStepStates(
  state: TimelineNavState,
  visibleScreen: number,
): { states: StepClickStates; reasons: StepReasons } {
  const states: StepClickStates = {};
  const reasons: StepReasons = {};
  for (let step = 1; step <= RUN_LIST; step++) {
    if (step === visibleScreen) continue;
    const action = stepNav(state, step);
    if (action.kind === "locked") {
      states[step] = "disabled";
      reasons[step] = action.reason;
    } else {
      states[step] = "enabled";
    }
  }
  return { states, reasons };
}

/**
 * The CAD sub-state step shown by the timeline while on the CAD screen.
 * The picker (5) is shown until the model is being calibrated or ready;
 * calibration (6) while the design refines; guidance (7) once the final
 * document has landed.
 */
export function cadStepFor(
  cadPhase: ForgePhase | null,
  hasFinalGuidance: boolean,
): number {
  if (
    cadPhase === "calibrating" ||
    cadPhase === "ready" ||
    cadPhase === "finalizing"
  ) {
    return hasFinalGuidance ? CAD_SUBSTEP_GUIDANCE : CAD_SUBSTEP_CALIBRATION;
  }
  return CAD_SUBSTEP_PICKER;
}

