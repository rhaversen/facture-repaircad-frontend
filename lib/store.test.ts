import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetRun,
  loadActiveRun,
  loadDesigns,
  loadRefinement,
  storeActiveRun,
  storeDesigns,
  storeRefinement,
} from "@/lib/store";

describe("store", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the open run until it is cleared", () => {
    expect(loadActiveRun()).toBeNull();
    storeActiveRun("run-1");
    expect(loadActiveRun()).toBe("run-1");
    storeActiveRun(null);
    expect(loadActiveRun()).toBeNull();
  });

  it("keeps design ids per run", () => {
    storeDesigns("run-1", ["a", "b"]);
    storeDesigns("run-2", ["c"]);
    expect(loadDesigns("run-1")).toEqual(["a", "b"]);
    expect(loadDesigns("run-2")).toEqual(["c"]);
    expect(loadDesigns("run-3")).toEqual([]);
  });

  it("forgets a run that no longer exists, leaving the others", () => {
    storeActiveRun("gone");
    storeDesigns("gone", ["a"]);
    storeDesigns("kept", ["b"]);
    forgetRun("gone");
    expect(loadActiveRun()).toBeNull();
    expect(loadDesigns("gone")).toEqual([]);
    expect(loadDesigns("kept")).toEqual(["b"]);
  });

  it("keeps one refinement run per design until it is forgotten", () => {
    storeRefinement("a", "after-a");
    storeRefinement("b", "after-b");
    expect(loadRefinement("a")).toBe("after-a");
    storeRefinement("a", null);
    expect(loadRefinement("a")).toBeNull();
    expect(loadRefinement("b")).toBe("after-b");
  });

  it("forgets the refinement runs of a forgotten run's designs", () => {
    storeDesigns("gone", ["a"]);
    storeDesigns("kept", ["b"]);
    storeRefinement("a", "after-a");
    storeRefinement("b", "after-b");
    forgetRun("gone");
    expect(loadRefinement("a")).toBeNull();
    expect(loadRefinement("b")).toBe("after-b");
  });

  it("treats malformed storage as empty", () => {
    localStorage.setItem("repaircad.designs", "{not json");
    expect(loadDesigns("run-1")).toEqual([]);
    localStorage.setItem("repaircad.designs", JSON.stringify({ "run-1": [1, 2] }));
    expect(loadDesigns("run-1")).toEqual([]);
  });
});
