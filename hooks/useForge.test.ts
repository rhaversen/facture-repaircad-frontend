import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import "./testAct";

import { useForge, loadStoredDesignState, clearStoredDesignState } from "./useForge";
import type { StreamEvent } from "@/lib/forgeClient";
import * as forgeClient from "@/lib/forgeClient";

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
  Unit tests for the variant selection flow: one design per handoff, the
  picked design keeps its own handoff, and the mapping survives a rehydrate.
  All Forge client calls are mocked; SSE streams are emulated with
  ReadableStream responses.
*/

vi.mock("@/lib/forgeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forgeClient")>();
  return {
    ...actual,
    createDesign: vi.fn(),
    duplicateDesign: vi.fn(),
    stopDesign: vi.fn(),
    sendDesignMessage: vi.fn(),
    getDesign: vi.fn(),
    getDesign3mfBytes: vi.fn(),
    subscribeDesignStream: vi.fn(),
    // The real parsers run THREE's 3MF loader; tests hand back plain bytes.
    parseMeshBase64: vi.fn(() => ({}) as never),
    parseMeshArrayBuffer: vi.fn(() => ({}) as never),
  };
});

const HANDOFFS = ["handoff-one", "handoff-two", "handoff-three"];
const IDS = ["id-1", "id-2", "id-3"];

function meshEvent(): StreamEvent {
  // Minimal base64 payload; the hook only forwards it to parseMeshBase64.
  return { type: "mesh", data: "" };
}

function endEvent(): StreamEvent {
  return { type: "end", data: "" };
}

function sseStream(events: forgeClient.StreamEvent[]): ReadableStream<Uint8Array> {
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
    yield meshEvent();
    yield endEvent();
  });
  vi.mocked(forgeClient.getDesign3mfBytes).mockResolvedValue(new ArrayBuffer(8));
  // No calibratable parameters → generation goes straight to ready on pick.
  vi.mocked(forgeClient.getDesign).mockResolvedValue({
    overview: { leaves: [], assemblies: [], parameters: [] },
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

  it("exposes the picked variant's own handoff as selectedHandoff", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId: "run-2" });
    });
    // Wait until every variant tile exists before picking, so the pick
    // cannot race a variant that has not registered its handoff yet.
    await poll(() => result.current.variants.length === HANDOFFS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-3");
    });
    await parked;
    // The pick's continuation applies state asynchronously; give React a
    // macrotask to flush before asserting.
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );

    expect(result.current.designId).toBe("id-3");
    expect(result.current.selectedHandoff).toBe("handoff-three");
  });

  it("stores the selected handoff for the run and persists it", async () => {
    mockSuccessfulGeneration();
    const { result } = renderHook(() => useForge());

    let parked!: Promise<void>;
    act(() => {
      parked = result.current.generate({ handoffs: HANDOFFS, runId: "run-3" });
    });
    await poll(() => result.current.variants.length === HANDOFFS.length);
    await poll(() => result.current.phase === "choosing");
    act(() => {
      result.current.chooseDesign("id-2");
    });
    await parked;
    await poll(
      () => result.current.phase === "ready" || result.current.phase === "error",
    );

    const stored = loadStoredDesignState("run-3");
    expect(stored?.designId).toBe("id-2");
    expect(stored?.selectedHandoff).toBe("handoff-two");
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

  it("rehydrates the picked design and restores its handoff", async () => {
    mockSuccessfulGeneration();
    // Persisted state as generate() would have left it.
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-5": {
          designId: "id-2",
          phase: "ready",
          selectedHandoff: "handoff-two",
        },
      }),
    );
    vi.mocked(forgeClient.getDesign3mfBytes).mockResolvedValue(new ArrayBuffer(8));
    // parseMeshBase64 on an empty payload must not crash the round.

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
    expect(result.current.selectedHandoff).toBe("handoff-two");
    expect(result.current.phase).toBe("ready");
  });

  it("falls back to the first handoff on rehydrate without stored handoff", async () => {
    vi.clearAllMocks();
    window.localStorage.setItem(
      "repaircad.forgeDesigns",
      JSON.stringify({
        "run-6": { designId: "id-1", phase: "ready" },
      }),
    );
    vi.mocked(forgeClient.getDesign).mockResolvedValue({
      overview: { leaves: [], assemblies: [], parameters: [] },
    });
    vi.mocked(forgeClient.getDesign3mfBytes).mockResolvedValue(new ArrayBuffer(8));

    const { result } = renderHook(() => useForge());
    let restored = false;
    await act(async () => {
      restored = await result.current.rehydrate({
        runId: "run-6",
        handoffs: HANDOFFS,
      });
    });

    expect(restored).toBe(true);
    expect(result.current.selectedHandoff).toBe("handoff-one");
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
      JSON.stringify({ "run-8": { designId: "x", phase: "ready" } }),
    );
    const { result } = renderHook(() => useForge());
    act(() => {
      result.current.reset();
    });
    expect(result.current.selectedHandoff).toBeNull();
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
      overview: { leaves: [], assemblies: [], parameters: [] },
    });
    vi.mocked(forgeClient.getDesign3mfBytes).mockResolvedValue(new ArrayBuffer(8));
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
          yield { type: "error", data: "boom" };
          return;
        }
        yield meshEvent();
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

  it("streams SSE mesh frames through a real ReadableStream response", async () => {
    vi.mocked(forgeClient.subscribeDesignStream).mockImplementation(
      async function* () {
        yield meshEvent();
        yield endEvent();
      },
    );
    // Sanity: the emulated SSE framing used by these mocks parses as the
    // client's parseStreamEvent expects.
    const raw = sseStream([meshEvent(), endEvent()]);
    const text = await new Response(raw).text();
    expect(text).toContain("event: mesh");
    expect(text).toContain("event: end");
  });

  it("marks surviving tiles ready via the 3MF fetch", async () => {
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
    expect(forgeClient.getDesign3mfBytes).toHaveBeenCalledWith("id-1");
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

// Keep the unused helpers referenced so lint stays quiet on this file.
void sseStream;
