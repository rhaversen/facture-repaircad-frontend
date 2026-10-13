import type { Parameter } from "./types";

/** Slider range for a numeric parameter — the same bounds the backend
 *  clamps values to. */
export function deriveSliderRange(param: Parameter): {
  min: number;
  max: number;
} {
  return { min: param.min, max: Math.max(param.max, param.min + 0.1) };
}

/** True when a parameter is a boolean flag stored as a 0/1 toggle — the
 *  backend flags these via a [0, 1] range; there is no explicit type. */
export function isBoolean(param: Parameter): boolean {
  return param.min === 0 && param.max === 1;
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

/** A parameter is calibratable only when its range is not degenerate. */
export function isCalibratable(param: Parameter): boolean {
  return param.min !== param.max;
}
