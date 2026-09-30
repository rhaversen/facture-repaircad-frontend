/** The thin wasm executor: SolidNode → manifold-3d solids. No geometry
 *  recipes live here — codegen lowered them into the boolean tree — so
 *  this module is the generic interpreter every runtime needs (mirrors
 *  the backend's src/geometry/exec.ts). */

import { Manifold as ManifoldAPI, CrossSection, type Mat4 } from "manifold-3d/manifoldCAD";

import { assertNever, type Poly, type SolidNode } from "./types";

export type Solid = ReturnType<typeof ManifoldAPI.cube>;

/** The instance matrix is a row-major 4×4 over column vectors — the same
 *  layout Manifold's Mat4 consumes. The single runtime check lives here so
 *  a layout change fails loudly instead of corrupting transforms. */
export function toMat4(m: readonly number[]): Mat4 {
	if (m.length !== 16) {
		throw new Error(`matrix must have 16 elements, got ${m.length}`);
	}
	return m as unknown as Mat4;
}

const toVec2 = (poly: Poly): Array<[number, number]> => poly.map((p) => [p[0], p[1]]);

/** Execute one lowered node — the executor's whole contract. */
export function buildSolid(node: SolidNode): Solid {
	switch (node.kind) {
		case "extrude":
			return ManifoldAPI.extrude(CrossSection.ofPolygons([toVec2(node.poly)]), node.h);
		case "revolve":
			return ManifoldAPI.revolve(node.poly.map((p) => [p[0], p[1]] as [number, number]), node.segments);
		case "cylinder":
			return ManifoldAPI.cylinder(node.h, node.r1, node.r2, node.segments);
		case "sphere":
			return ManifoldAPI.sphere(node.r, node.segments);
		case "hull": {
			const at = (p: readonly number[]): Solid =>
				ManifoldAPI.sphere(node.r, node.segments).translate([p[0], p[1], p[2]]);
			const pts = node.points;
			if (pts.length === 1) return at(pts[0]);
			return ManifoldAPI.hull(pts.map(at));
		}
		case "translate":
			return buildSolid(node.node).translate([...node.offset] as [number, number, number]);
		case "rotate":
			return buildSolid(node.node).rotate([...node.rotDeg] as [number, number, number]);
		case "add":
			return buildSolid(node.a).add(buildSolid(node.b));
		case "subtract":
			return buildSolid(node.a).subtract(buildSolid(node.b));
		case "intersect":
			return buildSolid(node.a).intersect(buildSolid(node.b));
		default:
			return assertNever(node);
	}
}
