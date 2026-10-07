"use client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook, waitFor } from "@testing-library/react";

import { useDesignExists } from "./useDesignExists";
import type { ForgePhase } from "@/lib/types";

/* The hook touches localStorage for persisted design state; keep every test
   at a known-clean slate. */
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

function hookProps(overrides: {
  phase?: ForgePhase;
  autoGenerate?: boolean;
} = {}) {
  const generate = vi.fn(async () => {});
  return {
    props: {
      phase: overrides.phase ?? ("idle" as ForgePhase),
      rehydrate: vi.fn(async () => false),
      reset: vi.fn(),
      runId: "run-1" as string | null,
      handoffs: ["handoff.md"],
      ...(overrides.autoGenerate !== undefined
        ? { autoGenerate: overrides.autoGenerate }
        : {}),
      generate,
    },
    generate,
  };
}

describe("useDesignExists", () => {
  it("reports missing and resets when nothing is stored and no autoGenerate", async () => {
    const { props, generate } = hookProps({ autoGenerate: false });
    const { result } = renderHook(() => useDesignExists(props));

    expect(result.current.checking).toBe(true);

    await waitFor(() =>
      expect(result.current).toEqual({
        checking: false,
        exists: false,
        missing: true,
      }),
    );
    expect(props.rehydrate).toHaveBeenCalledTimes(1);
    expect(props.reset).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("auto-generates when armed and nothing is stored, staying in checking", async () => {
    const { props, generate } = hookProps({ autoGenerate: true });
    const { result } = renderHook(() => useDesignExists(props));

    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith({
      handoffs: ["handoff.md"],
      runId: "run-1",
    });
    expect(props.reset).not.toHaveBeenCalled();
    expect(result.current.missing).toBe(false);
  });

  it("does not re-fire or re-arm on a mid-session autoGenerate flip", async () => {
    /* The check runs once per mount. A flip false→true within the same
       mount keeps the already-settled "missing" state — re-arming happens
       on the next mount (every CAD-screen entry remounts the check). */
    const { props, generate } = hookProps({ autoGenerate: false });
    const { result, rerender } = renderHook((p) => useDesignExists(p), {
      initialProps: props,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        checking: false,
        exists: false,
        missing: true,
      }),
    );

    rerender({ ...props, autoGenerate: true });

    await waitFor(() => expect(props.reset).toHaveBeenCalledTimes(1));
    expect(result.current.missing).toBe(true);
    expect(result.current.checking).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(props.rehydrate).toHaveBeenCalledTimes(1);
  });

  it("does not auto-generate when a design is restored", async () => {
    const { props, generate } = hookProps({ autoGenerate: true });
    props.rehydrate = vi.fn(async () => true);
    const { result } = renderHook(() => useDesignExists(props));

    await waitFor(() =>
      expect(result.current).toEqual({
        checking: false,
        exists: true,
        missing: false,
      }),
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
