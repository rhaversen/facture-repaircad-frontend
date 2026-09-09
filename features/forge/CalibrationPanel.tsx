"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatParamName, formatParamDescription, deriveSliderRange, isBoolean } from "@/lib/forgeParams";
import type { ForgeParameter, ParamSweep } from "@/lib/types";

interface CalibrationPanelProps {
  parameters: ForgeParameter[];
  paramSweeps: Record<string, ParamSweep>;
  confirmedValues: Record<string, number>;
  settingParam: string | null;
  sweepingParam: string | null;
  onConfirm: (name: string, value: number) => void;
  onPreviewSweep: (name: string) => void;
  onFinish: () => void;
}

export default function CalibrationPanel({
  parameters,
  paramSweeps,
  confirmedValues,
  settingParam,
  sweepingParam,
  onConfirm,
  onPreviewSweep,
  onFinish,
}: CalibrationPanelProps) {
  /*
    Values stay local while editing — a slider commit fires when the drag
    ends, a typed number commits on blur or Enter, so partial input never
    lands in the state mid-editing. Nothing reaches Forge until the OK button
    batches every confirmed value into one patch.
  */
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  /*
    Seed each slider draft from the authoritative value: the confirmed value
    if the user already set it (survives re-entry and refreshes), otherwise
    the spec default — sliders never reset to range midpoints. Derived during
    render so newly arriving parameters show a value immediately.
  */
  const seeded = useMemo(() => {
    const next: Record<string, string> = {};
    for (const param of parameters) {
      const effective = confirmedValues[param.name] ?? param.value;
      next[param.name] =
        draftValues[param.name] ?? (effective != null ? String(effective) : "");
    }
    return next;
  }, [parameters, confirmedValues, draftValues]);

  function commitParam(param: ForgeParameter, raw: string | undefined) {
    if (settingParam !== null) return;
    const value =
      raw === undefined || raw === ""
        ? param.value
        : isBoolean(param)
          ? raw === "1"
            ? 1
            : 0
          : parseFloat(raw);
    if (!isBoolean(param) && (!isFinite(value) || value <= 0)) return;
    onConfirm(param.name, value);
    // Keep the slider exactly where the user set it.
    setDraftValues((prev) => ({ ...prev, [param.name]: String(value) }));
  }

  const setCount = Object.keys(confirmedValues).length;

  /*
    On wide screens the panel is capped to its row height; the parameter list
    is the only scroller with the heading above and the OK footer pinned, so
    finishing never requires scrolling the page. When stacked it grows with
    content and the page scrolls normally.
  */
  return (
    <div className="flex min-h-0 flex-col gap-4 rounded-xl border border-line p-4.5 pr-5 lg:w-[380px] lg:shrink-0">
      <div className="lg:shrink-0">
        <h2 className="mb-1.5 text-lg">Calibrate the model</h2>
        <p className="mt-2.5 text-[13px] text-[#8a93a1]">
          Previews render one parameter at a time — a parameter is sweepable as
          soon as its preview is ready. Use the “▶” preview button to sweep it
          in the viewport, measure your real object, then set the value. Values
          apply automatically when you release the slider, or press Enter/leave
          the field after typing. Setting one only re-renders that parameter;
          the rest keep the defaults.
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
        {parameters.map((param) => {
          const sweep = paramSweeps[param.name] ?? null;
          const confirmed = confirmedValues[param.name];
          const bool = isBoolean(param);
          const range = bool ? { min: 0, max: 1 } : deriveSliderRange(param);
          const draft = seeded[param.name] ?? "";
          const setNow = confirmed !== undefined;
          const playing = sweepingParam === param.name;

          return (
            <div
              key={param.name}
              className={`flex flex-col gap-2 rounded-[10px] border p-3 px-3.5 ${
                playing ? "border-brand" : setNow ? "border-[#bfe3c4] bg-[#f4fbf6]" : "border-line-soft"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-bold text-ink">{formatParamName(param.name)}</span>
                {sweep !== null ? (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#c8d0dc] bg-white p-0 text-xs leading-none text-brand hover:border-brand hover:bg-brand-tint disabled:cursor-default disabled:opacity-50"
                    onClick={() => onPreviewSweep(param.name)}
                    disabled={settingParam !== null}
                    aria-label={
                      playing
                        ? `Stop sweep for ${formatParamName(param.name)}`
                        : `Preview sweep for ${formatParamName(param.name)}`
                    }
                  >
                    {playing ? "■" : "▶"}
                  </button>
                ) : setNow ? (
                  <span className="text-[13px] font-bold whitespace-nowrap text-[#1d7a34] tabular-nums">
                    {bool
                      ? confirmed === 1
                        ? "Enabled"
                        : "Disabled"
                      : `${Number(confirmed).toFixed(1)} mm`}
                  </span>
                ) : (
                  <span className="text-xs text-[#8a93a1]">Rendering previews…</span>
                )}
              </div>

              {param.description && (
                <p className="m-0 text-[15px] leading-relaxed text-muted">
                  {formatParamDescription(param.description)}
                </p>
              )}

              {bool ? (
                <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
                  <input
                    type="checkbox"
                    checked={draft === "1"}
                    onChange={(e) => {
                      const next = e.target.checked ? "1" : "0";
                      setDraftValues((prev) => ({ ...prev, [param.name]: next }));
                      commitParam(param, next);
                    }}
                  />
                  Enabled
                </label>
              ) : (
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    className="h-5 w-full min-w-0 flex-1 cursor-pointer accent-brand"
                    value={
                      draft === ""
                        ? (range.min + (range.max - range.min) / 2).toFixed(1)
                        : draft
                    }
                    onChange={(e) =>
                      setDraftValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                    }
                    onPointerUp={() => commitParam(param, seeded[param.name])}
                    onKeyUp={(e) => {
                      if (
                        [
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                          "PageUp",
                          "PageDown",
                        ].includes(e.key)
                      ) {
                        commitParam(param, seeded[param.name]);
                      }
                    }}
                    min={range.min}
                    max={range.max}
                    step="0.1"
                    aria-label={`${formatParamName(param.name)} in millimetres`}
                  />
                  <input
                    type="number"
                    className="w-[110px] min-w-0 shrink-0 rounded-lg border border-[#cbd0d6] bg-white px-2.5 py-1.5 text-sm"
                    value={draft}
                    onChange={(e) =>
                      setDraftValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                    }
                    onBlur={() => commitParam(param, seeded[param.name])}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitParam(param, seeded[param.name]);
                      }
                    }}
                    placeholder={param.value != null ? String(param.value) : "e.g. 12.5"}
                    min="0.001"
                    step="any"
                    aria-label={`${formatParamName(param.name)} measurement in millimetres`}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-[10px] bg-[#e7e9ed] px-2.5 py-1 text-sm text-ink-soft hover:bg-[#d8dce2]"
                    onClick={() => {
                      setDraftValues((prev) => ({
                        ...prev,
                        [param.name]: param.value != null ? String(param.value) : "",
                      }));
                      if (confirmedValues[param.name] !== undefined) {
                        onConfirm(param.name, param.value);
                      }
                    }}
                    disabled={
                      settingParam !== null ||
                      (confirmedValues[param.name] === undefined &&
                        draft === (param.value != null ? String(param.value) : ""))
                    }
                    title={`Reset to default (${param.value != null ? param.value : "—"})`}
                    aria-label={`Reset ${formatParamName(param.name)} to its default value`}
                  >
                    ↺
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 lg:shrink-0">
        <button
          type="button"
          className="bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(29,58,153,0.25)] hover:bg-brand-dark"
          onClick={onFinish}
          disabled={settingParam !== null}
        >
          OK — render final model
        </button>
        <span className="text-[13px] text-[#8a93a1]">
          {setCount} of {parameters.length} set
        </span>
      </div>
    </div>
  );
}

/*
  Pairs the active sweep's frames with their values, dropping failed renders
  so frame indices stay aligned with what the flipbook shows.
*/
export function useActiveSweep(
  sweepingParam: string | null,
  paramSweeps: Record<string, ParamSweep>,
) {
  const activeSweep =
    sweepingParam !== null ? (paramSweeps[sweepingParam] ?? null) : null;

  const paired = useMemo(() => {
    if (activeSweep === null) return [];
    return activeSweep.frames
      .map((frame, i) => ({ frame, value: activeSweep.values[i] ?? null }))
      .filter((f) => f.frame !== null);
  }, [activeSweep]);

  const frameValues = useMemo(() => paired.map((f) => f.value), [paired]);
  const frameMeshes = useMemo(
    () => paired.map((f) => f.frame as NonNullable<(typeof paired)[number]["frame"]>),
    [paired],
  );

  return { frameValues, frameMeshes };
}

/** Mirror the sweep playhead into the value readout DOM node at display rate. */
export function useSweepReadout(
  sweepingParam: string | null,
  frameValues: number[],
  playheadRef: React.MutableRefObject<{ pos: number; index: number }>,
) {
  const valueRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (sweepingParam === null) return undefined;
    let lastIndex = -1;
    const apply = () => {
      const n = frameValues.length;
      const { index } = playheadRef.current;
      if (index !== lastIndex && valueRef.current) {
        lastIndex = index;
        const shown = n > 0 ? frameValues[Math.min(Math.max(index, 0), n - 1)] : null;
        if (shown != null) {
          valueRef.current.textContent = `${shown.toFixed(1)} mm`;
        }
      }
    };
    apply();
    let raf = requestAnimationFrame(function loop() {
      apply();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [sweepingParam, frameValues, playheadRef]);

  return valueRef;
}
