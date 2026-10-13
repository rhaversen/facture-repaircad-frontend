"use client";

import { useMemo, useState } from "react";

import { formatParamName, formatParamDescription, isBoolean } from "@/lib/forgeParams";
import type { Guide, Parameter } from "@/lib/types";

interface CalibrationPanelProps {
  parameters: Parameter[];
  confirmedValues: Record<string, number>;
  settingParam: string | null;
  onConfirm: (name: string, value: number) => void;
  onFinish: () => void;
  /**
   * The guide count across all parameters — nonzero means the header's
   * All/None radio group renders and the rows get eye toggles.
   */
  guides: Guide[];
  /** Tri-state of the whole guide set: every shown, every hidden, or mixed. */
  guidesState: "shown" | "hidden" | "mixed";
  /** Header radio group — shown/hidden applied to every parameter's guides. */
  onSetAllGuides?: (shown: boolean) => void;
  /** True when the parameter has guides attached in the current geometry. */
  guidesAvailable?: (name: string) => boolean;
  /** Whether the parameter's guides currently render in the viewport. */
  guideShown?: (name: string) => boolean;
  onToggleGuides?: (name: string) => void;
  /** Hover notifications — null when the pointer leaves all rows. */
  onHoverGuides?: (name: string | null) => void;
}

export default function CalibrationPanel({
  parameters,
  confirmedValues,
  settingParam,
  onConfirm,
  onFinish,
  guides,
  guidesState,
  onSetAllGuides,
  guidesAvailable,
  guideShown,
  onToggleGuides,
  onHoverGuides,
}: CalibrationPanelProps) {
  /*
    Values stay local only while editing — a typed number commits on blur or
    Enter, so partial input never lands in the state mid-editing. The commit
    itself is immediate: the value is PATCHed to Forge and the model
    re-renders right away, and OK just bakes the final render.
  */
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  /*
    Seed each input from the authoritative value: the confirmed value if the
    user already set it (survives re-entry and refreshes), otherwise the
    spec default — inputs never reset to anything else. Derived during
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

  function commitParam(param: Parameter, raw: string | undefined) {
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
    // Keep the input exactly where the user set it.
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
      <div className="flex items-baseline justify-between gap-2 lg:shrink-0">
        <h2 className="mb-1.5 text-lg">Calibrate the model</h2>
        {guides.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1 pb-1.5">
            <span className="text-[11px] text-muted">Guides</span>
            <div
              className="flex gap-0.5 rounded-lg border border-line-soft bg-white p-0.5"
              role="radiogroup"
              aria-label="Guide visibility"
            >
              {[
                { id: "shown", label: "All", title: "Show every guide in the viewport" },
                { id: "hidden", label: "None", title: "Hide every guide in the viewport" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={guidesState === s.id}
                  title={s.title}
                  onClick={() => onSetAllGuides?.(s.id === "shown")}
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors ${
                    guidesState === s.id
                      ? "bg-yellow-500 text-black"
                      : guidesState === "mixed"
                        ? "text-ink-soft hover:bg-[#f3f5f8]"
                        : "text-muted hover:bg-[#f3f5f8]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
        {parameters.map((param) => {
          const confirmed = confirmedValues[param.name];
          const bool = isBoolean(param);
          const draft = seeded[param.name] ?? "";
          const setNow = confirmed !== undefined;
          const hasGuides = guidesAvailable?.(param.name) ?? false;

          return (
            <div
              key={param.name}
              className={`flex flex-col gap-2 rounded-[10px] border p-3 px-3.5 ${
                setNow ? "border-[#bfe3c4] bg-[#f4fbf6]" : "border-line-soft"
              }`}
              onMouseEnter={() => onHoverGuides?.(param.name)}
              onMouseLeave={() => onHoverGuides?.(null)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-bold text-ink">{formatParamName(param.name)}</span>
                {hasGuides ? (
                  <button
                    type="button"
                    className="shrink-0 text-base leading-none text-yellow-500 transition-colors hover:text-yellow-400"
                    onClick={() => onToggleGuides?.(param.name)}
                    title={
                      guideShown?.(param.name) === false
                        ? `Show guides for ${formatParamName(param.name)}`
                        : `Hide guides for ${formatParamName(param.name)}`
                    }
                    aria-pressed={guideShown?.(param.name) !== false}
                    aria-label={
                      guideShown?.(param.name) === false
                        ? `Show guides for ${formatParamName(param.name)}`
                        : `Hide guides for ${formatParamName(param.name)}`
                    }
                  >
                    {guideShown?.(param.name) === false ? "○" : "●"}
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
                  <span className="text-xs text-[#8a93a1]">Tap OK when the value looks right</span>
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
                    type="number"
                    className="min-w-0 flex-1 rounded-lg border border-[#cbd0d6] bg-white px-2.5 py-1.5 text-sm"
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
