"use client";

import { useRef, useState } from "react";
import type { Parameter } from "@/lib/types";

/** "wall_thickness" → "Wall Thickness". */
const formatName = (name: string) =>
	name
		.split(/[_\s]+/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");

/** A staged edit: a new value, or null to return the parameter to its default. */
type Staged = Record<string, number | null>;

const without = <T,>(record: Record<string, T>, key: string) =>
	Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/** Whether a staged edit would change the parameter as the server has it. */
const differs = (parameter: Parameter, edit: number | null) =>
	edit === null ? parameter.set : !same(edit, parameter.value);

/** Decimals worth showing for a slider step: 0.04 → 2, 1 → 0. */
const decimalsFor = (step: number) => Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));

const formatValue = (value: number, decimals: number) => String(Number(value.toFixed(decimals)));

/** The slider's whole track as one gradient. In range, the part left of the
 *  thumb is filled. Out of range the thumb pins to the near end and the
 *  track spans the viable range plus the overshoot: the viable part stays
 *  filled and the overshoot shows in red, sized by how far past it is. */
function trackStyle(value: number, min: number, max: number): React.CSSProperties {
	const fill = "var(--track-fill)";
	const rest = "var(--track-rest)";
	const over = "var(--track-over)";
	let track: string;
	if (value > max) {
		const at = ((max - min) / (value - min)) * 100;
		track = `linear-gradient(to right, ${fill} ${at}%, ${over} ${at}%)`;
	} else if (value < min) {
		const at = ((min - value) / (max - value)) * 100;
		track = `linear-gradient(to right, ${over} ${at}%, ${fill} ${at}%)`;
	} else {
		const at = ((value - min) / (max - min)) * 100;
		track = `linear-gradient(to right, ${fill} ${at}%, ${rest} ${at}%)`;
	}
	return { "--track": track } as React.CSSProperties;
}

/** One parameter row: the name with a changed marker, reset and guide
 *  controls, then a slider over the viable range with a numeric companion
 *  input and the unit. Both controls only stage the value — nothing is sent
 *  until the panel's Apply. The number input takes any value, including one
 *  outside the viable range; the slider then pins to that end and its track
 *  shows the overshoot in red. Hovering or clicking anywhere in the row
 *  selects that parameter's guides, deselecting all others (rows without
 *  guides do the deselecting too — one selection at a time, selection-only). */
function ParameterRow({
	parameter,
	edit,
	misfit,
	disabled,
	onStage,
	active,
	hasGuides,
	onSelect,
	onShowGuideCamera,
}: {
	parameter: Parameter;
	/** The staged edit, if any (null: back to the default). */
	edit: number | null | undefined;
	/** Why Forge rejected this value on the last Apply. */
	misfit: string | undefined;
	disabled: boolean;
	/** Stages a value (null: the default); staging the server's own state
	 *  drops the edit. */
	onStage: (edit: number | null) => void;
	active: boolean;
	hasGuides: boolean;
	onSelect: (name: string | null) => void;
	/** Reframes the viewport on this parameter's guide (button click only —
	 *  row hover/click stays selection-only). */
	onShowGuideCamera?: (name: string) => void;
}) {
	const { min, max, unit, kind } = parameter;
	const boundedMax = Math.max(max, min + 0.1);
	// Integers step whole units; lengths/angles/scalars allow the backend's
	// full precision, so the slider stays fine.
	const step = kind === "integer" ? 1 : (boundedMax - min) / 1000;
	const decimals = decimalsFor(step);
	const value = edit === undefined ? parameter.value : edit === null ? parameter.default : edit;
	const changed = edit !== undefined;
	const below = value < min;
	const above = value > boundedMax;
	// The raw text while the number field is being edited, so an empty or
	// half-typed entry survives every render.
	const [text, setText] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const stage = (next: number) => {
		const v = kind === "integer" ? Math.round(next) : next;
		onStage(v);
	};

	const note = misfit
		? misfit
		: below
			? `Below the viable range (min ${formatValue(min, decimals)} ${unit.trim()})`
			: above
				? `Above the viable range (max ${formatValue(max, decimals)} ${unit.trim()})`
				: null;

	return (
		<div
			// Row-wide selection: hovering or clicking anywhere picks this
			// parameter's guides and deselects every other parameter's.
			className={`flex cursor-pointer flex-col gap-0.5 rounded-md border px-2 py-1.5 transition-colors ${
				active ? "border-brand bg-[#f6f8fd]" : "border-transparent hover:bg-[#f6f8fd]"
			}`}
			onMouseEnter={() => onSelect(parameter.name)}
			onClick={() => onSelect(parameter.name)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="flex min-w-0 items-center gap-1.5">
					{/* The changed marker: a staged value waiting for Apply. */}
					{changed ? (
						<span
							className="size-1.5 shrink-0 rounded-full bg-[#d97706]"
							title="Changed — click Apply to rebuild the model"
						/>
					) : null}
					<span
						className={`min-w-0 truncate text-[13px] leading-snug ${changed ? "font-medium text-ink" : "text-ink-soft"}`}
						title={parameter.description}
					>
						{formatName(parameter.name)}
					</span>
				</span>
				<span className="flex shrink-0 items-center justify-end gap-1">
					{!same(value, parameter.default) ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setText(null);
								onStage(null);
							}}
							disabled={disabled}
							title={`Back to the default (${formatValue(parameter.default, decimals)} ${unit.trim()})`}
							className="rounded bg-transparent px-1 text-[11px] text-muted transition-colors hover:bg-brand-tint hover:text-ink disabled:opacity-40"
						>
							reset
						</button>
					) : null}
					{hasGuides ? (
						<button
							type="button"
							// Stop the row's click from double-selecting this
							// parameter, then select it and reframe the camera
							// on the guide (hover already selected it — the
							// camera move is the button's job).
							onClick={(e) => {
								e.stopPropagation();
								onSelect(parameter.name);
								onShowGuideCamera?.(parameter.name);
							}}
							title="Show guides and frame them in the viewport"
							className={active
								? "rounded bg-transparent px-1 text-[11px] font-medium text-brand-dark hover:bg-brand-tint"
								: "rounded bg-transparent px-1 text-[11px] text-muted hover:bg-brand-tint hover:text-brand-dark"}
							disabled={disabled}
						>
							guide
						</button>
					) : null}
				</span>
			</div>
			<div className="flex items-center gap-1.5">
				<input
					type="range"
					className="forge-slider min-w-0 flex-1"
					min={min}
					max={boundedMax}
					step={step}
					// Out of range, the thumb pins to the near end.
					value={Math.min(boundedMax, Math.max(min, value))}
					data-out={below || above ? "" : undefined}
					style={trackStyle(value, min, boundedMax)}
					disabled={disabled}
					onChange={(e) => {
						setText(null);
						stage(Number(Number(e.target.value).toFixed(decimals)));
					}}
				/>
				{/* A text input (inputMode decimal) instead of type=number: the
				    field must accept an empty or half-typed entry while editing.
				    Every parseable keystroke stages, unclamped. */}
				<input
					ref={inputRef}
					type="text"
					inputMode="decimal"
					className={`forge-number w-16 shrink-0 rounded border bg-transparent px-1.5 py-0.5 text-right text-xs text-ink focus:border-transparent focus:outline-2 focus:outline-[#4d72df] ${
						below || above || misfit ? "border-[#d64545]" : "border-[#cbd0d6]"
					}`}
					value={text ?? formatValue(value, decimals)}
					disabled={disabled}
					onChange={(e) => {
						setText(e.target.value);
						const parsed = Number(e.target.value.replace(",", "."));
						if (e.target.value.trim() !== "" && Number.isFinite(parsed)) stage(parsed);
					}}
					onBlur={() => setText(null)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === "Escape") {
							e.preventDefault();
							inputRef.current?.blur();
						}
					}}
				/>
				{/* "w-6" is "deg"'s measured width at this 12px face — every
				    row reserves it so all sliders stay the same length. */}
				<span className="w-6 shrink-0 text-right text-[12px] text-muted">
					{unit.trim()}
				</span>
			</div>
			{note ? <p className="m-0 text-[11px] leading-snug text-[#a22c2c]">{note}</p> : null}
		</div>
	);
}

/** Every calibratable parameter in one scrollable list. Sliders and typed
 *  values only stage changes — each changed row is marked and can be reset
 *  to its default — and one Apply sends them all in a single rebuild. A
 *  rejected or failed Apply keeps the staged values for another try.
 *  Hovering a row shows its guides; "guide" also frames them. */
export default function CalibrationPanel({
	parameters,
	disabled,
	onApply,
	activeGuide,
	onSelectGuide,
	onShowGuide,
	hasGuides,
	footer,
}: {
	parameters: Parameter[];
	disabled: boolean;
	/** Sends every staged value (null: back to the default); resolves to the
	 *  per-parameter reasons when Forge rejects them, else null. */
	onApply: (values: Staged) => Promise<Record<string, string> | null>;
	activeGuide: string | null;
	onSelectGuide: (name: string | null) => void;
	onShowGuide: (name: string) => void;
	hasGuides: (name: string) => boolean;
	/** Renders under the panel; told whether staged edits await Apply. */
	footer: (unapplied: boolean) => React.ReactNode;
}) {
	const [staged, setStaged] = useState<Staged>({});
	const [misfits, setMisfits] = useState<Record<string, string>>({});
	// Once the server's values move (an accepted Apply, or a Forge turn),
	// drop every edit they now match. A rejected Apply moves nothing, so its
	// edits stay. Reset during render per react.dev's "adjusting state when a
	// prop changes" pattern; the signature is stable across re-renders.
	const signature = parameters.map((p) => `${p.name}=${p.value}${p.set ? "" : "~"}`).join(",");
	const [prevSignature, setPrevSignature] = useState(signature);
	if (prevSignature !== signature) {
		setPrevSignature(signature);
		setStaged((s) =>
			Object.fromEntries(
				Object.entries(s).filter(([name, edit]) => {
					const p = parameters.find((q) => q.name === name);
					return p !== undefined && differs(p, edit);
				}),
			),
		);
	}

	const stage = (parameter: Parameter, edit: number | null) => {
		setMisfits((m) => without(m, parameter.name));
		setStaged((s) =>
			differs(parameter, edit) ? { ...s, [parameter.name]: edit } : without(s, parameter.name),
		);
	};

	const count = Object.keys(staged).length;
	const apply = async () => {
		setMisfits({});
		setMisfits((await onApply(staged)) ?? {});
	};

	return (
		<div className="flex w-full min-w-0 flex-col gap-2 self-stretch rounded-xl bg-surface p-3 lg:flex-1">
			<div>
				<h2 className="mb-0.5 text-[15px]">Calibrate the model</h2>
				<p className="text-[12px] leading-[1.45] text-muted">Set how the parts fit together, then apply</p>
			</div>
			<div className="flex flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
				{parameters.length === 0 && (
					<p className="text-[13px] text-muted">This design has no adjustable parameters.</p>
				)}
				{parameters.map((parameter) => (
					<ParameterRow
						key={parameter.name}
						parameter={parameter}
						edit={staged[parameter.name]}
						misfit={misfits[parameter.name]}
						disabled={disabled}
						onStage={(edit) => stage(parameter, edit)}
						active={activeGuide === parameter.name}
						hasGuides={hasGuides(parameter.name)}
						onSelect={onSelectGuide}
						onShowGuideCamera={onShowGuide}
					/>
				))}
			</div>
			{parameters.length > 0 && (
				<div className="flex flex-col gap-1.5 border-t border-line-soft pt-2">
					<div className="flex items-center justify-between text-[12px] text-muted">
						<span>
							{count === 0 ? "No unapplied changes" : `${count} unapplied change${count === 1 ? "" : "s"}`}
						</span>
						{count > 0 && (
							<button
								type="button"
								onClick={() => {
									setStaged({});
									setMisfits({});
								}}
								disabled={disabled}
								className="rounded bg-transparent px-1 text-[11px] text-muted hover:bg-brand-tint hover:text-ink disabled:opacity-40"
							>
								discard
							</button>
						)}
					</div>
					<button
						type="button"
						className="w-full"
						disabled={disabled || count === 0}
						onClick={() => void apply()}
					>
						Apply
					</button>
				</div>
			)}
			<div className="flex items-center justify-between gap-2 pt-0.5">
				<span className="text-[12px] text-muted">
					{parameters.filter((p) => p.set).length} of {parameters.length} set
				</span>
				{footer(count > 0)}
			</div>
		</div>
	);
}
