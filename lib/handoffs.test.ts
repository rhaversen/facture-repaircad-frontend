import { describe, expect, it } from "vitest";

import { collectHandoffs, handoffsReady } from "./handoffs";

describe("collectHandoffs", () => {
  it("returns handoffs in variant order", () => {
    expect(
      collectHandoffs({
        forge_handoff_1: "one",
        forge_handoff_2: "two",
        forge_handoff_3: "three",
      }),
    ).toEqual(["one", "two", "three"]);
  });

  it("skips empty and whitespace-only fields", () => {
    expect(
      collectHandoffs({
        forge_handoff_1: "one",
        forge_handoff_2: "   ",
        forge_handoff_3: "three",
      }),
    ).toEqual(["one", "three"]);
  });

  it("supports a single handoff", () => {
    expect(collectHandoffs({ forge_handoff_1: "only" })).toEqual(["only"]);
  });

  it("trims handoff text", () => {
    expect(collectHandoffs({ forge_handoff_1: "  doc\n  " })).toEqual(["doc"]);
  });

  it("ignores non-string values", () => {
    expect(
      collectHandoffs({
        forge_handoff_1: 42,
        forge_handoff_2: "two",
      } as unknown as Record<string, string>),
    ).toEqual(["two"]);
  });

  it("returns empty for missing doc, empty doc, and unrelated fields", () => {
    expect(collectHandoffs(null)).toEqual([]);
    expect(collectHandoffs(undefined)).toEqual([]);
    expect(collectHandoffs({})).toEqual([]);
    expect(collectHandoffs({ repair_plan: "x" })).toEqual([]);
  });
});

describe("handoffsReady", () => {
  it("is true when at least one handoff exists", () => {
    expect(handoffsReady({ forge_handoff_2: "doc" })).toBe(true);
  });

  it("is false when all fields are empty", () => {
    expect(handoffsReady({ forge_handoff_1: "" })).toBe(false);
    expect(handoffsReady({})).toBe(false);
    expect(handoffsReady(null)).toBe(false);
  });
});
