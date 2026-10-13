"use client";

import { useEffect, useRef, useState } from "react";
import type { Parameter } from "@/lib/types";
import { formatParamName } from "@/lib/forgeParams";

/** One parameter row: description line with the guide control and a reset
 *  control, then a slider across the allowed range with a numeric companion
 *  input and the unit. The slider previews while dragging and commits only on
 *  release; the number input stages the typed text and an OK button (or
 *  Enter / blur) applies it. Hovering or clicking anywhere in the row selects
 *  that parameter's guides, deselecting all others (rows without guides do
 *  the deselecting too — one selection at a time, selection-only). */
function ParameterRow({
	parameter,
	disabled,
	detail,
	onConfirm,
	active,
	hasGuides,
	onSelect,
}: {
	parameter: Parameter;
	disabled: boolean;
	detail: string | null;
	onConfirm: (value: number) => void;
	active: boolean;
	hasGuides: boolean;
	onSelect: (name: string | null) => void;
}) {
	const { min, max, unit, kind } = parameter;
	const boundedMax = Math.max(max, min + 0.1);
	// Integers step whole units; lengths/angles/scalars allow the backend's
	// full precision, so the slider stays fine.
	const step = kind === "integer" ? 1 : (boundedMax - min) / 1000;
	// draft: live slider drag or in-progress number typing; pending: a
	// released value awaiting the PATCH response.
	const [draft, setDraft] = useState<number | null>(null);
	const [text, setText] = useState<string | null>(null);
	const [pending, setPending] = useState<number | null>(null);
	const shown = draft ?? pending ?? parameter.value;
	const railRef = useRef<HTMLInputElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	// The confirmed value is the truth: once it moves, drop the local
	// overlay. Reset during render per react.dev's "adjusting state when a
	// prop changes" pattern.
	const [prevServerValue, setPrevServerValue] = useState(parameter.value);
	if (prevServerValue !== parameter.value) {
		setPrevServerValue(parameter.value);
		setDraft(null);
		setText(null);
		setPending(null);
	}
	const fill = ((shown - min) / (boundedMax - min)) * 100;

	const commit = (value: number) => {
		setDraft(null);
		setText(null);
		setPending(value);
		onConfirm(value);
	};

	// Native 'change' fires once per gesture with the final dragged value.
	// React's onChange fires per input tick and can end before the release,
	// so the commit must come from the browser event, not a React handler.
	// No deps array: every render re-subscribes with fresh state.
	useEffect(() => {
		const rail = railRef.current;
		if (rail === null) return;
		const onCommitted = () => {
			const v = Number(rail.value);
			if (Number.isFinite(v) && v !== parameter.value) commit(v);
		};
		rail.addEventListener("change", onCommitted);
		return () => rail.removeEventListener("change", onCommitted);
	});

	const commitText = () => {
		if (text === null) return;
		const parsed = Number(text.replace(",", "."));
		if (!Number.isFinite(parsed)) {
			setText(null);
			return;
		}
		const bounded = Math.min(boundedMax, Math.max(min, parsed));
		const value = kind === "integer" ? Math.round(bounded) : bounded;
		if (value !== parameter.value) {
			commit(value);
		} else {
			setText(null);
		}
	};

	const shownText =
		text !== null
			? text
			: Number.isInteger(pending ?? parameter.value)
				? String(pending ?? parameter.value)
				: (pending ?? parameter.value).toFixed(2);

	return (
		<div
			// Row-wide selection: hovering or clicking anywhere picks this
			// parameter's guides and deselects every other parameter's.
			className="flex cursor-pointer flex-col gap-1 rounded-lg border border-[#e4e7eb] bg-white px-3 py-2.5 hover:border-[#2448b8]"
			onMouseEnter={() => onSelect(parameter.name)}
			onClick={() => onSelect(parameter.name)}
		>
			{/* Reset appears/disappears per value; the guide control only for
			    rows that actually have guides — the right slot absorbs both so
			    rows keep a stable label line. */}
			<div className="flex items-center justify-between gap-2">
				<span className="min-w-0 truncate text-[13px] leading-snug text-[#30343a]" title={parameter.description}>
					{formatParamName(parameter.name)}
				</span>
				<span className="flex shrink-0 items-center justify-end gap-2">
					{parameter.set ? (
						<button
							type="button"
							onClick={() => {
								setDraft(null);
								setPending(parameter.default);
								onConfirm(parameter.default);
							}}
							disabled={disabled}
							className="rounded bg-transparent px-1 text-[11px] text-[#616975] transition-colors hover:bg-[#eef2fb] hover:text-[#20242a] disabled:opacity-40"
						>
							reset
						</button>
					) : null}
					{hasGuides ? (
						<button
							type="button"
							// Selection-only control: it never toggles off. The one
							// active set is replaced by hovering/clicking any other
							// row, so there is no separate hide action to name.
							onClick={() => onSelect(parameter.name)}
							title="Show guides"
							className={active
								? "rounded bg-transparent px-1 text-[11px] font-medium text-[#1d3a99] hover:bg-[#eef2fb]"
								: "rounded bg-transparent px-1 text-[11px] text-[#616975] hover:bg-[#eef2fb] hover:text-[#1d3a99]"}
							disabled={disabled}
						>
							show guide
						</button>
					) : null}
				</span>
			</div>
			<div className="flex items-center gap-1.5">
				<input
					ref={railRef}
					type="range"
					className="forge-slider min-w-0 flex-1"
					min={min}
					max={boundedMax}
					step={step}
					value={shown}
					// Change-drag preview only — the commit listener above
					// sends the PATCH when the gesture completes.
					style={{ "--fill": `${fill}%` } as React.CSSProperties}
					disabled={disabled}
					onChange={(e) => setDraft(Number(e.target.value))}
				/>
				<input
					ref={inputRef}
					type="number"
					className="forge-number w-14 shrink-0 rounded border border-[#cbd0d6] bg-transparent px-1.5 py-0.5 text-right text-xs text-[#20242a] focus:border-transparent focus:outline-2 focus:outline-[#4d72df]"
					min={min}
					max={boundedMax}
					step={step}
					value={shownText}
					disabled={disabled}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commitText();
							inputRef.current?.blur();
						} else if (e.key === "Escape") {
							setText(null);
							inputRef.current?.blur();
						}
					}}
				/>
				{/* The OK button applies the typed text; without typed text it
				    stays inert. Always rendered so the row width is stable. */}
				<button
					type="button"
					title="Apply the typed value"
					onClick={commitText}
					disabled={disabled || text === null || text.trim() === ""}
					className="shrink-0 rounded-md bg-transparent px-2 py-0.5 text-[11px] font-semibold text-[#30343a] ring-1 ring-[#cbd0d6] transition-colors hover:bg-[#eef2fb] hover:text-[#1d3a99] disabled:cursor-not-allowed disabled:opacity-40"
				>
					OK
				</button>
				{/* "w-6" is "deg"'s measured width at this 12px face — every
				    row reserves it so all sliders stay the same length. */}
				<span className="w-6 shrink-0 text-right text-[12px] text-[#616975]">
					{unit.trim()}
				</span>
			</div>
			{detail !== null ? (
				<p className="text-[11px] text-red-500">{detail}</p>
			) : null}
		</div>
	);
}

interface CalibrationPanelProps {
	parameters: Parameter[];
	confirmedValues: Record<string, number>;
	settingParam: string | null;
	onConfirm: (parameter: Parameter, value: number) => void;
	onFinish: () => void;
	/** The parameter whose guides are currently shown (null = none). */
	activeParam: string | null;
	/** Selects a parameter's guides (deselecting all others) or, with
	 *  null, deselects everything. */
	onSelectGuides: (name: string | null) => void;
	guidesAvailable: (name: string) => boolean;
}

/** The calibrate panel: every declared parameter in one scrollable list,
 *  with per-value commit semantics (slider on release, typed value via
 *  OK/Enter/blur), unit display, per-value reset and a row-level
 *  show-guide control on the label line. The footer button renders the
 *  final model. */
export default function CalibrationPanel({
	parameters,
	confirmedValues,
	settingParam,
	onConfirm,
	onFinish,
	activeParam,
	onSelectGuides,
	guidesAvailable,
}: CalibrationPanelProps) {
	return (
		<div className="flex w-[21rem] flex-col gap-2.5 rounded-xl border border-[#e1e4e8] bg-[#f7f8fa] p-3 shadow-sm">
			<div>
				<h2 className="mb-1 text-[15px] font-semibold">
					Calibrate the model
				</h2>
				<p className="text-[12px] leading-[1.45] text-[#616975]">
					Set how the parts fit together
				</p>
			</div>
			<div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
				{parameters.map((parameter) => (
					<ParameterRow
						key={parameter.name}
						parameter={parameter}
						disabled={settingParam !== null}
						detail={null}
						onConfirm={(value) => onConfirm(parameter, value)}
						active={activeParam === parameter.name}
						hasGuides={guidesAvailable(parameter.name)}
						onSelect={onSelectGuides}
					/>
				))}
			</div>
			<div className="flex items-center justify-between gap-2 pt-0.5">
				<span className="text-[12px] text-[#616975]">
					{
						parameters.filter(
							(parameter) => confirmedValues[parameter.name] !== undefined,
						).length
					}{" "}
					of {parameters.length} set
				</span>
				<button type="button" onClick={onFinish}>
					OK — render final model
				</button>
			</div>
		</div>
	);
}