import { describe, expect, it } from "vitest";

import {
  CHAT_SCREEN,
  CAD_SCREEN,
  deriveScreen,
  hasUserTurn,
  runShowsProgress,
  screenForSelectedRun,
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
    handoffMarkdown: "",
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
          run: run({ runningDoc: { provisional_cad_handoff: "doc" } }),
          handoffMarkdown: "doc",
        }),
      ),
    ).toBe(CAD_SCREEN);
  });

  it("chat stays when the handoff was dismissed", () => {
    expect(
      deriveScreen(
        state({
          run: run({ runningDoc: { provisional_cad_handoff: "doc" } }),
          handoffMarkdown: "doc",
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
