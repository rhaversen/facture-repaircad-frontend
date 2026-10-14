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
  if (screen >= INTAKE_MIN && screen <= INTAKE_MAX && conversationReady) {
    screen = CHAT_SCREEN;
  }
  if (screen === CHAT_SCREEN && handoffReady && !state.handoffDismissed) {
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

/** Refinement-round commit state (see TimelineNavState.roundState). */
export type TimelineRoundState = "none" | "generating" | "sealed";

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
  /** An AfterForge refinement run exists for this round: step 6 needs
      one to calibrate against, and step 7 needs it plus the round
      started. Off-CAD, on first visit the run is created when the CAD
      workspace opens, so it only gates the CAD sub-step; on-CAD this is
      sourced from the live hook. */
  afterCadRunExists: boolean;
  /** The refinement round's commit state: "none" = no round started,
      "generating" = the round is committed — the OK button fired (or a
      resumed/inherited run is live) and the document is still in
      flight, "sealed" = the final document has landed. Step 7 opens the
      moment the round is committed, because step 6 and step 7 share the
      CAD screen — only the guidance box content differs. */
  roundState: TimelineRoundState;
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
const REASON_NO_REFINEMENT =
  "Refine the design first — this round has no refinement run yet.";
const REASON_REFINE_OTHER_DESIGN =
  "Guidance belongs to the other design — refine the selected one first.";
const REASON_NO_GUIDANCE =
  "The repair guidance document arrives once the refinement round is committed and finished.";

/** Timeline markers for the CAD sub-states (all on screen 6). */
export const CAD_SUBSTEP_PICKER = 5;
export const CAD_SUBSTEP_CALIBRATION = 6;
export const CAD_SUBSTEP_GUIDANCE = 7;
/** The conversation occupies marker 4, not screen number 5. */
export const CONVERSATION_STEP = 4;

/**
 * Pure decision for a timeline-marker click. Every step resolves to
 * navigate (jump to the marker, or to a CAD sub-state when the target
 * marker lives on screen 6), noop (nothing to change), or locked (not
 * reachable yet, with a tooltip reason) — no click can ever land in a
 * state that isn't reachable.
 *
 * On-CAD, steps 5/6/7 gate on direction relative to the sub-state shown
 * (`cadStep`): going back to an already-shown sub-state always works;
 * going forward requires the state that sub-state was built on — the
 * picker as-is, calibration a selected design, guidance the final
 * document. Off-CAD the sub-state is unknown to the caller, so the
 * handoff must exist first, then steps 6/7 gate on the same refinement-
 * run state as on-CAD — the CAD view (or its entry check) settles which
 * sub-state to show on landing.
 */
export function stepNav(state: TimelineNavState, step: number): StepNavAction {
  const {
    screen,
    conversationReady,
    handoffReady,
    clarificationActive,
    cadStep,
    cadSelectionMade,
    afterCadRunExists,
    roundState,
  } = state;
  const toScreen = timelineStepToScreen(step);

  if (screen === CAD_SCREEN) {
    if (step < CAD_SUBSTEP_PICKER) {
      /* The conversation marker (4) always goes back to the chat;
         intake markers (1-3) only re-open before the conversation
         started — once it exists they have lifted into it. */
      if (step < CONVERSATION_STEP && conversationReady) {
        return { kind: "locked", reason: REASON_CONVERSATION };
      }
      return { kind: "navigate", target: CHAT_SCREEN };
    }

    /* Markers 5-7 are sub-states of this screen. The picker (5) is
       always re-openable: from calibration or the guidance view it
       goes back to it, and when it's already shown jumping to its own
       marker is a no-op seen above. Calibration (6) and guidance (7)
       need the state that produced them — a selected design, and for
       guidance the final document. */
    if (step === cadStep) {
      return { kind: "noop" };
    }
    if (step === CAD_SUBSTEP_PICKER) {
      return { kind: "navigate", target: CAD_SUBSTEP_PICKER };
    }
    /* Step 6 needs a refinement round to exist for THIS design — the run
       keyed by the run id carries forge_instruction / final_guidance for
       one chosen design, so picking another design restarts the round.
       Step 7 needs the round COMMITTED: it opens the moment calibration
       is finished and the document is in flight, because steps 6 and 7
       share this screen — only the guidance box content differs.
       Together the gates give:
       - first visit, nothing done yet → both lock until a design is
         picked and its run creates itself;
       - a fresh pick after round-1 guidance exists → both lock again,
         because the sealed guidance is about the previous design;
       - round in flight or finished → 6 stays open (re-calibrate) and
         so does 7, while the box shows "generating" until sealed. */
    if (step >= CAD_SUBSTEP_CALIBRATION && !afterCadRunExists) {
      return {
        kind: "locked",
        reason:
          roundState === "sealed"
            ? REASON_REFINE_OTHER_DESIGN
            : !cadSelectionMade
              ? REASON_SELECT_DESIGN
              : REASON_NO_REFINEMENT,
      };
    }
    if (step === CAD_SUBSTEP_GUIDANCE && roundState === "none") {
      return { kind: "locked", reason: REASON_NO_GUIDANCE };
    }
    return { kind: "navigate", target: CAD_SCREEN };
  }

  /* Staying on the current screen is always a no-op, even with a
     pending clarification — the visible step stays live. */
  if (toScreen === screen) return { kind: "noop" };

  /* A pending clarification question has to be answered before any
     navigation. */
  if (clarificationActive)
    return { kind: "locked", reason: REASON_CLARIFICATION };

  /* Inside the intake wizard the Continue button owns forward
     navigation; backward markers stay free. */
  if (screen >= INTAKE_MIN && screen <= INTAKE_MAX) {
    if (step > screen) return { kind: "locked", reason: REASON_IN_INTAKE };
    return { kind: "navigate", target: toScreen };
  }

  /* Intake steps lift into the conversation once it started: not
     revisable. The CAD sub-steps (5-7) are unaffected — they still lead
     into the CAD workspace, where the entry check settles which
     sub-state to show. */
  if (conversationReady && step < CAD_SUBSTEP_PICKER)
    return { kind: "locked", reason: REASON_CONVERSATION };

  /* Steps 5-7 share the CAD screen. Opening it settles which sub-state
     is actually shown (the entry check reopens the picker if no design
     is persisted, otherwise the calibrated/guided design loads), so from
     the conversation the whole CAD arm is reachable behind the handoff;
     steps 6 and 7 then gate on the same run state as the on-CAD side. */
  if (step >= CAD_SUBSTEP_PICKER) {
    if (!handoffReady) return { kind: "locked", reason: REASON_NO_HANDOFF };
    /* Steps 6/7 use the exact same conditions as the on-CAD branch —
       the round's committed state rides along in roundState, so the
       markers off-screen never reach further than the on-screen gates:
       a design pick that starts a fresh round keeps both locked until
       the run exists, and marker 7 opens the moment the round is
       committed instead of when the document lands. */
    if (step >= CAD_SUBSTEP_CALIBRATION && !afterCadRunExists) {
      return {
        kind: "locked",
        reason:
          roundState === "sealed"
            ? REASON_REFINE_OTHER_DESIGN
            : !cadSelectionMade
              ? REASON_SELECT_DESIGN
              : REASON_NO_REFINEMENT,
      };
    }
    if (step === CAD_SUBSTEP_GUIDANCE && roundState === "none") {
      return { kind: "locked", reason: REASON_NO_GUIDANCE };
    }
    return { kind: "navigate", target: toScreen };
  }

  /* Intake again pre-conversation. */
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
  /* Omit the marker highlighted as current: on screens 1-3 the screen
     number is the marker; the conversation renders as step 4 (marker 5 is
     already the first CAD sub-state); on the CAD screen it is the sub-step
     currently visible (5-7). */
  const currentStep =
    visibleScreen === CAD_SCREEN
      ? state.cadStep
      : visibleScreen === CHAT_SCREEN
        ? CONVERSATION_STEP
        : visibleScreen;
  for (let step = 1; step <= RUN_LIST; step++) {
    if (step === currentStep) continue;
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
 * calibration (6) while the design refines; guidance (7) from the moment
 * the round is committed — the document merely waits to fill the box.
 */
export function cadStepFor(
  cadPhase: ForgePhase | null,
  roundState: TimelineRoundState,
): number {
  if (
    cadPhase === "calibrating" ||
    cadPhase === "ready" ||
    cadPhase === "finalizing"
  ) {
    return roundState === "none"
      ? CAD_SUBSTEP_CALIBRATION
      : CAD_SUBSTEP_GUIDANCE;
  }
  return CAD_SUBSTEP_PICKER;
}
