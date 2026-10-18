import { describe, expect, it } from "vitest";

import { handoffsOf, stageOf } from "@/lib/flow";
import type { FlowRun } from "@/lib/types";

const S2 = "node-s2";
const run = (patch: Partial<FlowRun>): FlowRun => ({
  _id: "run",
  pipelineId: "main",
  status: "idle",
  currentNodeId: "node-s0",
  runningDoc: {},
  ...patch,
});

describe("handoffsOf", () => {
  it("keeps the non-empty handoffs in order, trimmed", () => {
    expect(
      handoffsOf({ forge_handoff_1: " a ", forge_handoff_2: "", forge_handoff_3: "c" }),
    ).toEqual(["a", "c"]);
    expect(handoffsOf(undefined)).toEqual([]);
  });
});

describe("stageOf", () => {
  it("is intake for an untouched run with no user turn", () => {
    expect(stageOf(run({}), false, S2)).toBe("intake");
  });

  it("is planning once the intake was sent, even before the pipeline wrote anything", () => {
    expect(stageOf(run({}), true, S2)).toBe("planning");
    expect(stageOf(run({ status: "running" }), false, S2)).toBe("planning");
  });

  it("is clarification while the run waits on the clarification node", () => {
    const parked = run({ currentNodeId: S2, runningDoc: { repair_state: "x" } });
    expect(stageOf(parked, true, S2)).toBe("clarification");
    expect(stageOf({ ...parked, status: "running" }, true, S2)).toBe("planning");
  });

  it("is designs once the handoff node has finished, and stays there", () => {
    const handed = run({ runningDoc: { forge_handoff_1: "brief" } });
    expect(stageOf({ ...handed, status: "running" }, true, S2)).toBe("planning");
    expect(stageOf(handed, true, S2)).toBe("designs");
    expect(stageOf({ ...handed, currentNodeId: S2 }, true, S2)).toBe("designs");
  });
});
