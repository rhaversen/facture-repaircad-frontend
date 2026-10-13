import { describe, expect, it } from "vitest";

import {
  CHAT_SCREEN,
  CAD_SCREEN,
  canNavigateToStep,
  deriveScreen,
  hasUserTurn,
  runShowsProgress,
  screenForSelectedRun,
  timelineStepToScreen,
  type ScreenState,
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

describe("canNavigateToStep", () => {
  it("never allows a no-op self navigation", () => {
    expect(canNavigateToStep(1, 1)).toBe(false);
    expect(canNavigateToStep(2, 2)).toBe(false);
    expect(canNavigateToStep(3, 3)).toBe(false);
  });

  it("allows backward moves within intake only", () => {
    expect(canNavigateToStep(3, 1)).toBe(true);
    expect(canNavigateToStep(3, 2)).toBe(true);
    expect(canNavigateToStep(2, 1)).toBe(true);
  });

  it("blocks forward moves within intake", () => {
    expect(canNavigateToStep(1, 2)).toBe(false);
    expect(canNavigateToStep(1, 3)).toBe(false);
    expect(canNavigateToStep(2, 3)).toBe(false);
  });

  it("lets the chat jump to any step", () => {
    expect(canNavigateToStep(CHAT_SCREEN, 1)).toBe(true);
    expect(canNavigateToStep(CHAT_SCREEN, 7)).toBe(true);
  });

  it("lets the CAD workspace jump to any step", () => {
    expect(canNavigateToStep(CAD_SCREEN, 1)).toBe(true);
    expect(canNavigateToStep(CAD_SCREEN, 2)).toBe(true);
    expect(canNavigateToStep(CAD_SCREEN, 3)).toBe(true);
    expect(canNavigateToStep(CAD_SCREEN, 4)).toBe(true);
    expect(canNavigateToStep(CAD_SCREEN, 7)).toBe(true);
  });
});
