import { beforeEach, describe, expect, it } from "vitest";

import { loadActiveRun, loadDesigns, storeActiveRun, storeDesigns } from "@/lib/store";

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

  it("treats malformed storage as empty", () => {
    localStorage.setItem("repaircad.designs", "{not json");
    expect(loadDesigns("run-1")).toEqual([]);
    localStorage.setItem("repaircad.designs", JSON.stringify({ "run-1": [1, 2] }));
    expect(loadDesigns("run-1")).toEqual([]);
  });
});
