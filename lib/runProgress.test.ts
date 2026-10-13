import { describe, expect, it } from "vitest";

import {
  CHAT_SCREEN,
  CAD_SCREEN,
  cadStepFor,
  deriveScreen,
  hasUserTurn,
  runShowsProgress,
  screenForSelectedRun,
  stepNav,
  timelineStepStates,
  timelineStepToScreen,
  type StepNavAction,
  type ScreenState,
  type TimelineNavState,
} from "./runProgress";
import type { FlowMessage, FlowRun } from "./types";

function run(overrides: Partial<FlowRun> = {}): FlowRun {
  return {
    _id: "run-1",
    pipelineId: "pipe-1",
    status: "idle",
    currentNodeId: "node-5",
    runningDoc: {},
    ...overrides,
  };
}

function msg(role: string, content: string = "hi"): FlowMessage {
  return { role, content };
}

function state(overrides: Partial<ScreenState> = {}): ScreenState {
  return {
    run: null,
    messages: [],
    handoffs: [],
    handoffDismissed: false,
    requestedScreen: CHAT_SCREEN,
    ...overrides,
  };
}

describe("hasUserTurn", () => {
  it("greeting-only transcript has no user turn", () => {
    expect(hasUserTurn([msg("assistant")])).toBe(false);
  });

  it("empty transcript has no user turn", () => {
    expect(hasUserTurn([])).toBe(false);
  });

  it("a user reply counts even with content parts", () => {
    expect(
      hasUserTurn([
        msg("assistant"),
        { role: "user", content: [{ type: "text", text: "broke" }] },
      ]),
    ).toBe(true);
  });

  it("tool and assistant turns do not count", () => {
    expect(hasUserTurn([msg("assistant"), msg("tool")])).toBe(false);
  });
});

describe("runShowsProgress", () => {
  it("a runningDoc with entries counts as progress", () => {
    expect(
      runShowsProgress(run({ runningDoc: { repair_plan: "x" } })),
    ).toBe(true);
  });

  it("a running run counts as progress", () => {
    expect(runShowsProgress(run({ status: "running" }))).toBe(true);
  });

  it("a fresh run (greeting only, empty doc) does not count", () => {
    expect(runShowsProgress(run({ runningDoc: {} }))).toBe(false);
  });

  it("null run does not count", () => {
    expect(runShowsProgress(null)).toBe(false);
  });
});

describe("screenForSelectedRun", () => {
  it("opens the chat for a run with a user turn", () => {
    expect(screenForSelectedRun(run(), [msg("assistant"), msg("user")])).toBe(
      CHAT_SCREEN,
    );
  });

  it("opens the chat for a run with progress even if messages came back empty", () => {
    expect(
      screenForSelectedRun(
        run({ runningDoc: { repair_plan: "x" } }),
        [],
      ),
    ).toBe(CHAT_SCREEN);
  });

  it("opens the chat for a running turn even if messages came back empty", () => {
    expect(screenForSelectedRun(run({ status: "running" }), [])).toBe(
      CHAT_SCREEN,
    );
  });

  it("opens intake for a fresh greeting-only run", () => {
    expect(screenForSelectedRun(run(), [msg("assistant")])).toBe(1);
  });
});

describe("deriveScreen", () => {
  it("requested intake lifts to chat once the conversation exists", () => {
    expect(
      deriveScreen(
        state({
          requestedScreen: 1,
          run: run(),
          messages: [msg("assistant"), msg("user")],
        }),
      ),
    ).toBe(CHAT_SCREEN);
  });

  it("requested intake stays without an active run (bootstrap path)", () => {
    expect(
      deriveScreen(
        state({ requestedScreen: 1, run: null, messages: [] }),
      ),
    ).toBe(1);
  });

  it("requested intake stays for a greeting-only run", () => {
    expect(
      deriveScreen(
        state({ requestedScreen: 1, messages: [msg("assistant")] }),
      ),
    ).toBe(1);
  });

  it("chat auto-advances to CAD on a fresh handoff", () => {
    expect(
      deriveScreen(
        state({
          run: run({ runningDoc: { forge_handoff_1: "doc" } }),
          handoffs: ["doc"],
        }),
      ),
    ).toBe(CAD_SCREEN);
  });

  it("chat stays when the handoff was dismissed", () => {
    expect(
      deriveScreen(
        state({
          run: run({ runningDoc: { forge_handoff_1: "doc" } }),
          handoffs: ["doc"],
          handoffDismissed: true,
        }),
      ),
    ).toBe(CHAT_SCREEN);
  });

  it("CAD does not require a handoff (regeneration path)", () => {
    expect(deriveScreen(state({ requestedScreen: CAD_SCREEN }))).toBe(
      CAD_SCREEN,
    );
  });

  it("run list is never rewritten by derivation", () => {
    expect(deriveScreen(state({ requestedScreen: 7 }))).toBe(7);
  });
});

describe("timelineStepToScreen", () => {
  it("maps wizard steps 1-3 to their screens", () => {
    expect(timelineStepToScreen(1)).toBe(1);
    expect(timelineStepToScreen(2)).toBe(2);
    expect(timelineStepToScreen(3)).toBe(3);
  });

  it("maps step 4 to the conversation", () => {
    expect(timelineStepToScreen(4)).toBe(CHAT_SCREEN);
  });

  it("maps steps 5, 6 and 7 to the CAD workspace", () => {
    expect(timelineStepToScreen(5)).toBe(CAD_SCREEN);
    expect(timelineStepToScreen(6)).toBe(CAD_SCREEN);
    expect(timelineStepToScreen(7)).toBe(CAD_SCREEN);
  });

  it("unknown steps fall back to the conversation", () => {
    expect(timelineStepToScreen(0)).toBe(CHAT_SCREEN);
    expect(timelineStepToScreen(8)).toBe(CHAT_SCREEN);
  });
});

function nav(overrides: Partial<TimelineNavState> = {}): TimelineNavState {
  return {
    screen: CHAT_SCREEN,
    conversationReady: true,
    handoffReady: false,
    clarificationActive: false,
    cadStep: CAD_SCREEN,
    cadSelectionMade: false,
    hasFinalGuidance: false,
    ...overrides,
  };
}

const IN_INTAKE =
  "Intake is still in progress — continue through the wizard steps.";
const CONVERSATION =
  "The conversation has started — this intake step is no longer available.";
const CLARIFICATION = "Answer the clarification question before moving on.";
const NO_HANDOFF = "No CAD draft yet — the conversation still needs to run.";
const SELECT_DESIGN = "Select a design first.";
const NO_GUIDANCE = "Repair guidance appears once calibration is finished.";

function expectNav(
  state: TimelineNavState,
  step: number,
  action: StepNavAction,
) {
  expect(stepNav(state, step)).toEqual(action);
}

describe("stepNav — intake screens", () => {
  const onDescribe = nav({ screen: 1, conversationReady: false });
  const onAnnotate = nav({ screen: 2, conversationReady: false });
  const onReview = nav({ screen: 3, conversationReady: false });

  it("locks every forward step with the intake reason", () => {
    expectNav(onDescribe, 2, { kind: "locked", reason: IN_INTAKE });
    expectNav(onDescribe, 3, { kind: "locked", reason: IN_INTAKE });
    expectNav(onDescribe, 4, { kind: "locked", reason: IN_INTAKE });
    expectNav(onDescribe, 5, { kind: "locked", reason: IN_INTAKE });
    expectNav(onDescribe, 7, { kind: "locked", reason: IN_INTAKE });
    expectNav(onAnnotate, 3, { kind: "locked", reason: IN_INTAKE });
    expectNav(onAnnotate, 4, { kind: "locked", reason: IN_INTAKE });
    expectNav(onReview, 4, { kind: "locked", reason: IN_INTAKE });
    expectNav(onReview, 6, { kind: "locked", reason: IN_INTAKE });
  });

  it("is a no-op on its own marker", () => {
    expectNav(onDescribe, 1, { kind: "noop" });
    expectNav(onAnnotate, 2, { kind: "noop" });
    expectNav(onReview, 3, { kind: "noop" });
  });

  it("lets any backward step navigate to that step's screen", () => {
    expectNav(onAnnotate, 1, { kind: "navigate", target: 1 });
    expectNav(onReview, 1, { kind: "navigate", target: 1 });
    expectNav(onReview, 2, { kind: "navigate", target: 2 });
  });
});

describe("stepNav — conversation screen", () => {
  const fresh = nav({ screen: CHAT_SCREEN, conversationReady: false });
  const withConversation = nav();

  it("locks intake steps once the conversation started", () => {
    [1, 2, 3].forEach((step) =>
      expectNav(
        withConversation,
        step,
        { kind: "locked", reason: CONVERSATION },
      ),
    );
  });

  it("lets intake steps back when no conversation started yet", () => {
    expectNav(fresh, 1, { kind: "navigate", target: 1 });
    expectNav(fresh, 3, { kind: "navigate", target: 3 });
  });

  it("is a no-op on its own marker (step 4)", () => {
    expectNav(withConversation, 4, { kind: "noop" });
  });

  it("locks the CAD sub-steps until the first handoff exists", () => {
    [5, 6, 7].forEach((step) =>
      expectNav(
        withConversation,
        step,
        { kind: "locked", reason: NO_HANDOFF },
      ),
    );
  });

  it("navigates to the CAD workspace once the handoff is ready", () => {
    const ready = nav({ handoffReady: true });
    [5, 6, 7].forEach((step) =>
      expectNav(ready, step, { kind: "navigate", target: CAD_SCREEN }),
    );
  });
});

describe("stepNav — pending clarification", () => {
  const waiting = nav({ clarificationActive: true });

  it("locks every step except the conversation itself", () => {
    [1, 2, 3, 5, 6, 7].forEach((step) =>
      expectNav(
        waiting,
        step,
        { kind: "locked", reason: CLARIFICATION },
      ),
    );
  });

  it("the conversation step stays a no-op", () => {
    expectNav(waiting, 4, { kind: "noop" });
  });

  it("beats the conversation-lock (reason is the clarification)", () => {
    expectNav(waiting, 1, { kind: "locked", reason: CLARIFICATION });
  });
});

describe("stepNav — CAD workspace", () => {
  const picker = nav({
    screen: CAD_SCREEN,
    cadStep: 5,
    handoffReady: true,
  });
  const calibration = nav({
    screen: CAD_SCREEN,
    cadStep: 6,
    cadSelectionMade: true,
    handoffReady: true,
  });
  const guidance = nav({
    screen: CAD_SCREEN,
    cadStep: 7,
    cadSelectionMade: true,
    hasFinalGuidance: true,
    handoffReady: true,
  });

  it("steps 1-4 go back to the conversation from any sub-state", () => {
    [1, 2, 3, 4].forEach((step) =>
      expectNav(
        calibration,
        step,
        { kind: "navigate", target: CHAT_SCREEN },
      ),
    );
    expectNav(guidance, 1, { kind: "navigate", target: CHAT_SCREEN });
  });

  it("is a no-op on the visible sub-state marker", () => {
    expectNav(picker, 5, { kind: "noop" });
    expectNav(calibration, 6, { kind: "noop" });
    expectNav(guidance, 7, { kind: "noop" });
  });

  it("step 5 reopens the design picker (target is the picker marker)", () => {
    expectNav(calibration, 5, { kind: "navigate", target: 5 });
    expectNav(guidance, 5, { kind: "navigate", target: 5 });
  });

  it("locks steps 6 and 7 until a design is selected", () => {
    expectNav(picker, 6, { kind: "locked", reason: SELECT_DESIGN });
    expectNav(picker, 7, { kind: "locked", reason: SELECT_DESIGN });
  });

  it("locks step 7 until the final guidance exists", () => {
    expectNav(calibration, 7, { kind: "locked", reason: NO_GUIDANCE });
  });

  it("navigates to the CAD screen for a reachable forward sub-state", () => {
    const picked = nav({
      screen: CAD_SCREEN,
      cadStep: 5,
      cadSelectionMade: true,
      handoffReady: true,
    });
    expectNav(picked, 6, { kind: "navigate", target: CAD_SCREEN });
    expectNav(guidance, 6, { kind: "navigate", target: CAD_SCREEN });
  });
});

describe("timelineStepStates", () => {
  it("omits the visible screen", () => {
    const { states } = timelineStepStates(nav(), CHAT_SCREEN);
    expect(5 in states).toBe(false);
  });

  it("marks a step disabled exactly when stepNav locks it", () => {
    const state = nav();
    const { states, reasons } = timelineStepStates(state, CHAT_SCREEN);
    for (let step = 1; step <= 7; step++) {
      if (step === CHAT_SCREEN) continue;
      const action = stepNav(state, step);
      if (action.kind === "locked") {
        expect(states[step]).toBe("disabled");
        expect(reasons[step]).toBe(action.reason);
      } else {
        expect(states[step]).toBe("enabled");
        expect(step in reasons).toBe(false);
      }
    }
  });

  it("agrees with stepNav on an intake screen too", () => {
    const state = nav({ screen: 1, conversationReady: false });
    const { states } = timelineStepStates(state, 1);
    expect(states[2]).toBe("disabled");
    expect(1 in states).toBe(false);
  });
});

describe("cadStepFor", () => {
  it("shows the picker before calibration starts", () => {
    expect(cadStepFor(null, false)).toBe(5);
    expect(cadStepFor("idle", false)).toBe(5);
    expect(cadStepFor("choosing", false)).toBe(5);
    expect(cadStepFor("error", false)).toBe(5);
  });

  it("shows calibration while the design refines", () => {
    expect(cadStepFor("calibrating", false)).toBe(6);
    expect(cadStepFor("finalizing", false)).toBe(6);
    expect(cadStepFor("ready", false)).toBe(6);
  });

  it("shows guidance once the final document has landed", () => {
    expect(cadStepFor("calibrating", true)).toBe(7);
    expect(cadStepFor("ready", true)).toBe(7);
    expect(cadStepFor("finalizing", true)).toBe(7);
  });
});
