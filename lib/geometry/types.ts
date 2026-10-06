/**
 * The lowered geometry document shape the backend emits (mirrors the
 * backend's src/compiler/codegen/plan.ts). Kept as a structural type here
 * so the two codebases stay decoupled.
 */

export type Vec3 = readonly [number, number, number];

/** Exhaustiveness helper for the SolidNode switch. */
export function assertNever(value: never): never {
	throw new Error(`unreachable: ${String(value)}`);
}

/** One polygon ring — an XZ or XY silhouette, consumed by 2D-of-polygons
 *  on the executor side. Points are [x, y] pairs in the profile plane. */
export type Poly = ReadonlyArray<readonly [number, number]>;

/** The wasm-ready boolean tree the codegen lowering emits (see the
 *  backend's plan.ts): profile extrusions, revolves, tapered cylinders,
 *  spheres, capsule hull-chains, and rigid rotate/translate nodes over a
 *  boolean assembly. All curved-surface resolution (`segments`) is baked
 *  per node — this union is the ONLY geometry concept the frontend
 *  interprets. */
export type SolidNode =
	| { kind: "extrude"; poly: Poly; h: number }
	| { kind: "revolve"; poly: Poly; segments: number }
	| { kind: "cylinder"; r1: number; r2: number; h: number; segments: number }
	| { kind: "sphere"; r: number; segments: number }
	| { kind: "hull"; points: readonly Vec3[]; r: number; segments: number }
	| { kind: "translate"; offset: Vec3; node: SolidNode }
	| { kind: "rotate"; rotDeg: readonly [number, number, number]; node: SolidNode }
	| { kind: "add" | "subtract" | "intersect"; a: SolidNode; b: SolidNode };

export type SolidOp = "union" | "subtract";

/** One placed copy of one part: the lowered solid baked with a rigid 4×4
 *  transform and a color. */
export interface SolidInstance {
	partId: string;
	shapeId: string;
	op: SolidOp;
	/** Ancestry of composed enclosing ids — carries §15 Phase 7's cutting
	 *  scope into the executor. */
	ancestry?: readonly string[];
	color?: string;
	solid: SolidNode;
	/** Row-major 4×4 transform, column-vector convention. */
	matrix: readonly number[];
}

export interface SolidDocument {
	units: string;
	instances: readonly SolidInstance[];
	framing: { size: Vec3 | null; center: Vec3; maxDim: number };
}
