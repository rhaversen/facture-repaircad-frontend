import type { ForgeParameter } from "./types";

function deriveLowHigh(param: ForgeParameter): { low: number; high: number } {
  const low = param.min != null ? param.min : Math.max(param.value * 0.5, 0.1);
  const high = param.max != null ? param.max : param.value * 1.5;
  return { low, high };
}

/** Slider range for a numeric parameter — the same bounds the sweep uses. */
export function deriveSliderRange(param: ForgeParameter): {
  min: number;
  max: number;
} {
  const { low, high } = deriveLowHigh(param);
  return { min: low, max: Math.max(high, low + 0.1) };
}

/** True when a parameter is a boolean flag stored as a 0/1 toggle. */
export function isBoolean(param: ForgeParameter): boolean {
  return param.min === 0 && param.max === 1 && param.step === 1;
}

/** "wall_thickness" → "Wall Thickness". */
export function formatParamName(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Capitalizes the first letter of a description sentence. */
export function formatParamDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** A parameter is sweepable only when its range is not degenerate. */
export function isCalibratable(param: ForgeParameter): boolean {
  const { low, high } = deriveLowHigh(param);
  return low !== high;
}

export { deriveLowHigh };

/** Calibration previews sit halfway between the default and each bound. */
export function midpoint(defaultValue: number, bound: number): number {
  return defaultValue + (bound - defaultValue) / 2;
}
