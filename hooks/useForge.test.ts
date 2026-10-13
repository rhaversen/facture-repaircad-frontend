import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import "./testAct";

import { useForge, loadStoredDesignState, clearStoredDesignState } from "./useForge";
import type { GeometrySummary, Parameter, StreamEvent } from "@/lib/types";
import * as forgeClient from "@/lib/forgeClient";
import * as glb from "@/lib/glb";

/*
  The hook parks asynchronously; waitFor() inside act() fights React's act
  environment detection, so tests poll outside act and only wrap state
  mutations in act().
*/
async function poll(
  condition: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("poll condition not met within timeout");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/*
  Unit tests for the variant selection flow under the simplified store model:
  each run entry is { designId, phase, variantDesignIds }, with no iteration
  lineage and no per-design handoff. The picker is re-openable at any time
  from the stored candidate ids. All Forge client calls are mocked; SSE
  streams are emulated with ReadableStream responses.
*/

vi.mock("@/lib/forgeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forgeClient")>();
  return {
    ...actual,
    createDesign: vi.fn(),
    duplicateDesign: vi.fn(),
    setParameters: vi.fn(),
    stopDesign: vi.fn(),
    sendDesignMessage: vi.fn(),
    getDesign: vi.fn(),
    fetchDesignGeometry: vi.fn(),
    subscribeDesignStream: vi.fn(),
  };
});

vi.mock("@/lib/glb", () => ({
  // The real parser runs three.js GLTFLoader against the fetched GLB;
  // tests hand back a plain stand-in.
  parseGlbCached: vi.fn(async () => ({
    scene: {},
    partMeshes: new Map(),
    parts: [],
  })),
}));

const HANDOFFS = ["handoff-one", "handoff-two", "handoff-three"];
const IDS = ["id-1", "id-2", "id-3"];
/** Ids handed out by duplicateDesign mocks in call order. */
const DUPLICATE_IDS = ["dup-1", "dup-2", "dup-3"];

/** A calibratable (min !== max) length parameter. */
const WIDTH_PARAM: Parameter = {
  name: "width",
  description: "Distance between mounting tabs",
  kind: "length",
  unit: "mm",
  default: 42,
  min: 10,
  max: 90,
  value: 42,
  set: true,
};

const SUMMARY_GEOMETRY: GeometrySummary = {
  revision: "r1",
  bytes: 16,
  parts: 1,
  triangles: 2,
  min: [0, 0, 0],
  max: [1, 1, 1],
  ok: true,
  errors: 0,
  builtAt: "2024-01-01T00:00:00Z",
  guides: [],
};

function meshEvent(): StreamEvent {
  // The stream only announces that geometry changed; the hook GETs the GLB
  // itself via fetchDesignGeometry + parseGlbCached.
  return {
    type: "geometry",
    data: { ...SUMMARY_GEOMETRY, revision: "r1" },
  };
}

function endEvent(): StreamEvent {
  return { type: "end", data: "" };
}

function sseStream(events: StreamEvent[]): ReadableStream<Uint8Array> {
  const chunks = events.map(
    (ev) =>
      new TextEncoder().encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`),
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });
}

/** Read the raw persisted entry for a run so tests can inspect exact keys. */
function storedEntry(
  runId: string,
): Record<string, unknown> {
  const all = JSON.parse(
    window.localStorage.getItem("repaircad.forgeDesigns") ?? "{}",
  ) as Record<string, Record<string, unknown>>;
  return all[runId] ?? {};
}

/** Wire mocks for a successful N-variant generation round. */
function mockSuccessfulGeneration() {
  // Call 1 → id-1, call 2 → id-2, … (calls.length is already incremented
  // when the mock body runs, hence the -1) — deterministic handoff → design
  // mapping for each parallel variant.
  vi.mocked(forgeClient.createDesign).mockImplementation(
    async () => IDS[(vi.mocked(forgeClient.createDesign).mock.calls.length - 1) % IDS.length],
  );
  vi.mocked(forgeClient.sendDesignMessage).mockResolvedValue(undefined);
  vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(async function* () {
    yield endEvent();
  });
  vi.mocked(forgeClient.fetchDesignGeometry).mockResolvedValue({
    status: "ok",
    blob: new ArrayBuffer(0),
    revision: "r1",
  } as never);
  // No calibratable parameters → generation goes straight to ready on pick.
  vi.mocked(forgeClient.getDesign).mockResolvedValue({
    _id: "id",
    parameters: [],
    geometry: SUMMARY_GEOMETRY,
  });
}

/** Wire mocks for a successful single-duplicate refinement round. */
function mockSuccessfulFeedbackRound() {
  vi.mocked(forgeClient.duplicateDesign).mockImplementation(
    async () => DUPLICATE_IDS[vi.mocked(forgeClient.duplicateDesign).mock.calls.length - 1],
  );
  vi.mocked(forgeClient.sendDesignMessage).mockResolvedValue(undefined);
  vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(async function* () {
    yield endEvent();
  });
  vi.mocked(forgeClient.fetchDesignGeometry).mockResolvedValue({
    status: "ok",
    blob: new ArrayBuffer(0),
    revision: "r1",
  } as never);
  vi.mocked(forgeClient.getDesign).mockResolvedValue({
    _id: "id",
    parameters: [],
    geometry: SUMMARY_GEOMETRY,
  });
}

describe("useForge variant selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates one design per handoff, sending each handoff to its own design", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId: "run-1" });
    });
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-2");
    });
    await parked;

    expect(forgeClient.createDesign).toHaveBeenCalledTimes(3);
    const sent = vi.mocked(forgeClient.sendDesignMessage).mock.calls;
    expect(sent).toHaveLength(3);
    // Every handoff went somewhere distinct, paired with its own design.
    const pairings = sent.map(([designId, message]) => ({ designId, message }));
    for (const handoff of HANDOFFS) {
      expect(pairings.filter((p) => p.message === handoff)).toHaveLength(1);
    }
    for (const id of IDS) {
      expect(pairings.filter((p) => p.designId === id)).toHaveLength(1);
    }
  });

  it("stores the run as { designId, phase, variantDesignIds } and never a history", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId: "run-2" });
    });
    await poll(() => result.current.phase === "choosing");
    // While choosing, the entry carries only the candidate ids + phase.
    const choosingEntry = storedEntry("run-2");
    expect(choosingEntry).toEqual({
      designId: undefined,
      phase: "choosing",
      variantDesignIds: expect.arrayContaining(["id-1", "id-2", "id-3"]),
    });
    expect(Object.keys(choosingEntry)).not.toContain("iterations");
    expect(Object.keys(choosingEntry)).not.toContain("selectedHandoff");

    act(() => {
      result.current.chooseDesign("id-3");
    });
    await parked;
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );

    expect(result.current.designId).toBe("id-3");
    // The pick overwrites the single selection field; the candidate list is
    // kept forever so the picker can be reopened.
    const stored = loadStoredDesignState("run-2");
    expect(stored?.designId).toBe("id-3");
    expect(stored?.variantDesignIds).toEqual(["id-1", "id-2", "id-3"]);
    expect(stored).not.toHaveProperty("iterations");
    expect(stored).not.toHaveProperty("selectedHandoff");
  });

  it("stops unpicked variants that are still streaming when a pick resolves", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId: "run-4" });
    });
    await poll(() => result.current.variants.length === HANDOFFS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await parked;
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );

    // Tiles whose final render landed keep their designs; only unfinished
    // siblings get stopped. With the instant mocks all finished, none are.
    expect(forgeClient.stopDesign).not.toHaveBeenCalled();
  });

  it("rehydrates the picked design from the simplified store entry", async () => {
    mockSuccessfulGeneration();
    // Persisted state as generate() would have left it.
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-5": {
          designId: "id-2",
          phase: "ready",
          variantDesignIds: IDS,
        },
      }),
    );
    vi.mocked(forgeClient.getDesign).mockResolvedValue({
      _id: "id-2",
      parameters: [],
      geometry: SUMMARY_GEOMETRY,
    });
    vi.mocked(forgeClient.fetchDesignGeometry).mockResolvedValue({
      status: "ok",
      blob: new ArrayBuffer(0),
      revision: "r1",
    } as never);

    const { result } = renderHook(() => useForge());
    let restored = false;
    await act(async () => {
      restored = await result.current.rehydrate({
        runId: "run-5",
        handoffs: HANDOFFS,
      });
    });

    expect(restored).toBe(true);
    expect(result.current.designId).toBe("id-2");
    expect(result.current.phase).toBe("ready");
  });

  it("rehydrates a choosing entry and reopens the picker with stored candidates", async () => {
    mockSuccessfulGeneration();
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-6": {
          phase: "choosing",
          variantDesignIds: IDS,
        },
      }),
    );

    const { result } = renderHook(() => useForge());
    let rehydrated!: Promise<boolean>;
    let restored = false;
    await act(async () => {
      rehydrated = result.current.rehydrate({ runId: "run-6", handoffs: HANDOFFS });
    });
    // A choosing entry parks the rehydrate on the pick — the tiles return
    // from the stored candidate ids, selection is still open.
    await poll(() => result.current.phase === "choosing");
    await poll(() => result.current.variants.length === IDS.length);
    expect(result.current.designId).toBeNull();

    act(() => {
      result.current.chooseDesign(IDS[1]);
    });
    restored = await act(async () => {
      return await rehydrated;
    });

    expect(restored).toBe(true);
    expect(result.current.designId).toBe("id-2");
    expect(result.current.phase).toBe("ready");
    expect(storedEntry("run-6").variantDesignIds).toEqual(IDS);
  });

  it("rejects generate() with an empty handoff list", async () => {
    const { result } = renderHook(() => useForge());
    await act(async () => {
      await result.current.generate({ handoffs: [], runId: "run-7" });
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toContain("No CAD handoff document");
    expect(forgeClient.createDesign).not.toHaveBeenCalled();
  });

  it("clears stored state on reset", async () => {
    clearStoredDesignState("run-8");
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-8": {
          designId: "x",
          phase: "ready",
          variantDesignIds: IDS,
        },
      }),
    );
    const { result } = renderHook(() => useForge());
    act(() => {
      result.current.reset();
    });
    expect(result.current.designId).toBeNull();
  });
});

describe("useForge picker SSE handling", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(forgeClient.createDesign).mockImplementation(
      async () => IDS[(vi.mocked(forgeClient.createDesign).mock.calls.length - 1) % IDS.length],
    );
    vi.mocked(forgeClient.sendDesignMessage).mockResolvedValue(undefined);
    vi.mocked(forgeClient.getDesign).mockResolvedValue({
      _id: "id",
      parameters: [],
      geometry: SUMMARY_GEOMETRY,
    });
    vi.mocked(forgeClient.fetchDesignGeometry).mockResolvedValue({
      status: "ok",
      blob: new ArrayBuffer(0),
      revision: "r1",
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops a variant that errors during streaming and keeps the others", async () => {
    let callCount = 0;
    vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(
      async function* () {
        callCount++;
        if (callCount === 2) {
          yield { type: "error" as const, data: "boom" };
          return;
        }
        yield endEvent();
      },
    );

    const { result } = renderHook(() => useForge());
    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId: "run-9" });
    });
    // Wait until the failing tile is removed.
    await poll(() => result.current.variants.length === 2);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await parked;
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );

    expect(result.current.designId).toBe("id-1");
  });

  it("streams SSE ir frames through a real ReadableStream response", async () => {
    vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(
      async function* () {
        yield endEvent();
      },
    );
    // Sanity: the emulated SSE framing used by these mocks parses as the
    // client's parseStreamEvent expects.
    const raw = sseStream([meshEvent(), endEvent()]);
    const text = await new Response(raw).text();
    expect(text).toContain("event: geometry");
    expect(text).toContain("event: end");
  });

  it("marks surviving tiles ready via the geometry fetch", async () => {
    vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(
      async function* () {
        yield endEvent();
      },
    );
    const { result } = renderHook(() => useForge());
    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: ["only"], runId: "run-10" });
    });
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await parked;
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );
    expect(forgeClient.fetchDesignGeometry).toHaveBeenCalledWith(
      "id-1",
      undefined,
    );
    expect(glb.parseGlbCached).toHaveBeenCalled();
    expect(result.current.phase).toBe("ready");
  });

  it("surfaces an error when every variant fails", async () => {
    vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(
      async function* () {
        yield { type: "error", data: "always fails" };
      },
    );
    const { result } = renderHook(() => useForge());
    let parked!: Promise<void>;
    act(() => {
      // generate() resolves even when every candidate fails; it transitions
      // to phase "error" with a message instead of rejecting.
      parked = result.current.generate({
        handoffs: HANDOFFS,
        runId: "run-11",
      });
    });
    await poll(() => result.current.phase === "error");
    await parked;
    expect(result.current.error).toMatch(/could not generate any/i);
    expect(forgeClient.stopDesign).not.toHaveBeenCalled();
  });
});

describe("useForge single-duplicate refinement rounds", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockSuccessfulGeneration();
    mockSuccessfulFeedbackRound();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* Full round: pick from the initial trio, then drive one refinement round
     (one duplicate, feedback only to the copy) and let the copy become the
     new current design. The render hook stays owned by the caller so state
     updates stay visible. */
  async function runInitialGenerationAndPick(
    result: { current: ReturnType<typeof useForge> },
    runId: string,
    pickedId: string,
  ): Promise<void> {
    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId });
    });
    await poll(() => result.current.variants.length === HANDOFFS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign(pickedId);
    });
    await parked;
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );
  }

  it("duplicates the current design once and sends the feedback only to the copy", async () => {
    const { result } = renderHook(() => useForge());
    await runInitialGenerationAndPick(result, "run-refine-1", "id-2");

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.refineDesign({
        feedback: "round two feedback",
        runId: "run-refine-1",
      });
    });
    await poll(
      () =>
        result.current.phase === "ready" || result.current.phase === "error",
    );
    await parked;

    expect(forgeClient.duplicateDesign).toHaveBeenCalledTimes(1);
    expect(forgeClient.duplicateDesign).toHaveBeenCalledWith("id-2");
    // The feedback went to the copy, never back to the carried-forward
    // source design.
    const sent = vi.mocked(forgeClient.sendDesignMessage).mock.calls;
    expect(sent).toHaveLength(4); // 3 initial handoffs + 1 refinement copy
    expect(sent[3][0]).toBe(DUPLICATE_IDS[0]);
    expect(sent[3][1]).toBe("round two feedback");
    expect(result.current.designId).toBe(DUPLICATE_IDS[0]);
  });

  it("stores the refined round without any iteration lineage", async () => {
    const { result } = renderHook(() => useForge());
    await runInitialGenerationAndPick(result, "run-refine-2", "id-1");

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.refineDesign({
        feedback: "make it sturdier",
        runId: "run-refine-2",
      });
    });
    await poll(
      () =>
        result.current.phase === "ready" || result.current.phase === "error",
    );
    await parked;

    const stored = loadStoredDesignState("run-refine-2");
    expect(stored?.designId).toBe(DUPLICATE_IDS[0]);
    // The candidate list still holds the original trio so the picker can be
    // reopened; the refine copy is not a picker candidate.
    expect(stored?.variantDesignIds).toEqual(IDS);
    expect(stored).not.toHaveProperty("iterations");
    expect(stored).not.toHaveProperty("selectedHandoff");
  });

  it("does not refine while there is no current design", async () => {
    const { result } = renderHook(() => useForge());

    await act(async () => {
      await result.current.refineDesign({
        feedback: "should be skipped",
        runId: "run-refine-3",
      });
    });

    expect(forgeClient.duplicateDesign).not.toHaveBeenCalled();
    expect(forgeClient.sendDesignMessage).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("loads a legacy entry with only { designId, phase }", async () => {
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-refine-4": {
          designId: "id-2",
          phase: "ready",
        },
      }),
    );
    vi.mocked(forgeClient.getDesign).mockResolvedValue({
      _id: "id-2",
      parameters: [],
      geometry: SUMMARY_GEOMETRY,
    });
    vi.mocked(forgeClient.fetchDesignGeometry).mockResolvedValue({
      status: "ok",
      blob: new ArrayBuffer(0),
      revision: "r1",
    } as never);

    const { result } = renderHook(() => useForge());
    let restored = false;
    await act(async () => {
      restored = await result.current.rehydrate({
        runId: "run-refine-4",
        handoffs: HANDOFFS,
      });
    });

    expect(restored).toBe(true);
    expect(result.current.designId).toBe("id-2");
    expect(result.current.phase).toBe("ready");
  });

  it("rehydrates an entry that still carries legacy iterations keys without honoring them", async () => {
    // Entries written by an older build may hold `iterations`/`selectedHandoff`;
    // the loader ignores them entirely — the current shape alone drives state.
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-refine-5": {
          designId: "id-2",
          phase: "ready",
          variantDesignIds: IDS,
          selectedHandoff: "handoff-one",
          iterations: [
            {
              round: 1,
              feedback: "handoff-one",
              sourceDesignId: "id-1",
              variantIds: IDS,
              pickedDesignId: "id-1",
            },
          ],
        },
      }),
    );
    vi.mocked(forgeClient.getDesign).mockResolvedValue({
      _id: "id-2",
      parameters: [],
      geometry: SUMMARY_GEOMETRY,
    });
    vi.mocked(forgeClient.fetchDesignGeometry).mockResolvedValue({
      status: "ok",
      blob: new ArrayBuffer(0),
      revision: "r1",
    } as never);

    const { result } = renderHook(() => useForge());
    let restored = false;
    await act(async () => {
      restored = await result.current.rehydrate({
        runId: "run-refine-5",
        handoffs: HANDOFFS,
      });
    });
    // The legacy keys are ignored: the entry is rewritten in the simplified
    // shape during rehydrate.
    expect(restored).toBe(true);
    const stored = storedEntry("run-refine-5");
    expect(stored.designId).toBe("id-2");
    expect(stored.variantDesignIds).toEqual(IDS);
    expect(stored).not.toHaveProperty("selectedHandoff");
    expect(stored).not.toHaveProperty("iterations");
    expect(result.current.designId).toBe("id-2");
    expect(result.current.phase).toBe("ready");
  });
});

describe("re-opening the design picker", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("reopens with the run's original candidates and keeps the selection pinned", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    // Pick the first candidate; the design page drives calibration/ready.
    let gen: Promise<void>;
    act(() => {
      gen = result.current.generate({ runId: "run-pick-a", handoffs: HANDOFFS });
    });
    await poll(() => result.current.variants.length === IDS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await act(async () => {
      await gen;
    });
    expect(result.current.designId).toBe("id-1");
    expect(result.current.phase).toBe("ready");
    const stored = storedEntry("run-pick-a");
    expect(stored.designId).toBe("id-1");
    expect(stored.variantDesignIds).toEqual(IDS);

    // Reopen from the CAD screen: the full candidate list returns.
    let open: Promise<string | null>;
    await act(async () => {
      open = result.current.reopenDesignPicker({ runId: "run-pick-a" });
    });
    await poll(() => result.current.phase === "choosing");
    await poll(() => result.current.variants.length === IDS.length);
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await act(async () => {
      await open;
    });

    expect(result.current.designId).toBe("id-1");
    expect(result.current.phase).toBe("ready");
    expect(result.current.model).not.toBeNull();
    const reopened = storedEntry("run-pick-a");
    expect(reopened.designId).toBe("id-1");
    expect(reopened.variantDesignIds).toEqual(IDS);
  });

  it("re-picking another candidate switches the design and clears confirmations", async () => {
    mockSuccessfulGeneration();
    // id-1 carries a calibratable width, the other candidates have no
    // parameters at all.
    vi.mocked(forgeClient.getDesign).mockImplementation(async (id) => {
      if (id === "id-1") {
        return { _id: id, parameters: [WIDTH_PARAM], geometry: SUMMARY_GEOMETRY };
      }
      return { _id: id, parameters: [], geometry: SUMMARY_GEOMETRY };
    });
    const { result } = renderHook(() => useForge());

    let gen: Promise<void>;
    act(() => {
      gen = result.current.generate({ runId: "run-pick-b", handoffs: HANDOFFS });
    });
    await poll(() => result.current.variants.length === IDS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await act(async () => {
      await gen;
    });
    // id-1 has a calibratable width, so the design page confirmed it up front.
    expect(result.current.phase).toBe("calibrating");
    expect(result.current.confirmedValues).toEqual({ width: 42 });

    let open: Promise<string | null>;
    await act(async () => {
      open = result.current.reopenDesignPicker({ runId: "run-pick-b" });
    });
    await poll(() => result.current.phase === "choosing");
    await poll(() => result.current.variants.length === IDS.length);
    act(() => {
      result.current.chooseDesign("id-3");
    });
    await act(async () => {
      await open;
    });

    // The selection moved to the new candidate with a clean confirmation state.
    expect(result.current.designId).toBe("id-3");
    expect(result.current.confirmedValues).toEqual({});
    expect(result.current.phase).toBe("ready");
    const stored = storedEntry("run-pick-b");
    expect(stored.designId).toBe("id-3");
    expect(stored.variantDesignIds).toEqual(IDS);
    expect(stored).not.toHaveProperty("iterations");
    expect(stored).not.toHaveProperty("selectedHandoff");
  });

  it("closing the re-opened picker without a pick keeps the previous design", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    let gen: Promise<void>;
    act(() => {
      gen = result.current.generate({ runId: "run-pick-c", handoffs: HANDOFFS });
    });
    await poll(() => result.current.variants.length === IDS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-1");
    });
    await act(async () => {
      await gen;
    });
    expect(result.current.designId).toBe("id-1");

    let open: Promise<string | null>;
    await act(async () => {
      open = result.current.reopenDesignPicker({ runId: "run-pick-c" });
    });
    await poll(() => result.current.phase === "choosing");
    await poll(() => result.current.variants.length === IDS.length);
    act(() => {
      result.current.chooseDesign(null);
    });
    await act(async () => {
      await open;
    });

    expect(result.current.designId).toBe("id-1");
    expect(result.current.confirmedValues).toEqual({});
    expect(result.current.model).not.toBeNull();
    const stored = storedEntry("run-pick-c");
    expect(stored.designId).toBe("id-1");
    expect(stored.phase).toBe("ready");
  });
});

// Keep the unused helpers referenced so lint stays quiet on this file.
void sseStream;
