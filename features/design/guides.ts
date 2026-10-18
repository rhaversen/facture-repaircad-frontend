import * as THREE from "three";
import type { Guide, GuideEnd } from "@/lib/types";

// Blue guides: Forge models are uniformly yellow, so a blue family gives
// the line maximum contrast against the model itself. The active
// parameter's guides brighten (base = brand blue, selected = bright blue)
// — since only one parameter's guides are shown at a time, no two shades
// actually coexist on screen.
const BASE_COLOR = 0x2448b8;
const HOVER_COLOR = 0x5f8bff;

// Blueprint-style proportions in SCREEN pixels: every mesh is built from
// shared unit geometry and scaled per frame by the world length of one
// CSS pixel at its own anchor, so a guide always covers the same number
// of pixels no matter the model size or zoom level.
const SHAFT_DIAMETER_PX = 5;
const ARROW_LENGTH_PX = 22;
const ARROW_WIDTH_PX = 10;
const VERTEX_DIAMETER_PX = 12;
const BUTT_DISK_DIAMETER_PX = 12;
// Disk thickness as a fraction of its diameter — a hairline "tick".
const BUTT_DISK_THICKNESS_RATIO = 0.02;

/** World length of one CSS pixel at a point `distance` from the camera
 *  (perspective: at distance d the frustum height is 2·d·tan(fov/2),
 *  spread over `viewportHeight` CSS pixels). */
function pixelsToWorld(camera: THREE.PerspectiveCamera, distance: number, viewportHeight: number): number {
	return (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
}

/** The rotation the backend bakes into every GLB root: -90° about X turns
 *  the design's Z-up coordinates into the renderer's Y-up display space.
 *  Guide endpoints ship in the Z-up design world, so framing math applies
 *  this same rotation to stay in the space the model is actually drawn in. */
export const DESIGN_TO_DISPLAY = new THREE.Euler(-Math.PI / 2, 0, 0);

/** Framing of one guide, in the same display space the overlay group
 *  renders in. `center` anchors the frame at the guide's most important
 *  point (the span mid-point of a distance guide, the vertex of an angle
 *  guide) and `radius` is the distance from that anchor to the farthest
 *  other endpoint, padded so the line's own markers — arrowheads and butt
 *  disks — clear the viewport edge after the fit. `facing` says how to look
 *  at the guide square-on, so it shows at its full width: along `normal`
 *  (an angle's plane), or from anywhere perpendicular to `axis` (a
 *  distance's line). */
export function guideFrameBox(guide: Guide): {
	center: THREE.Vector3;
	radius: number;
	facing: { normal: THREE.Vector3 } | { axis: THREE.Vector3 };
} {
	// The rotation preserves lengths, so span distances equal the
	// design-space measurements either way.
	const toDisplay = (end: GuideEnd) => new THREE.Vector3(...end.world).applyEuler(DESIGN_TO_DISPLAY);
	const from = toDisplay(guide.from);
	const to = toDisplay(guide.to);
	const anchor = guide.kind === "angle" ? toDisplay(guide.vertex) : from.clone().add(to).multiplyScalar(0.5);
	const radius = Math.max(from.distanceTo(anchor), to.distanceTo(anchor));
	const normal =
		guide.kind === "angle" ? from.clone().sub(anchor).cross(to.clone().sub(anchor)) : null;
	// A degenerate (straight) angle has no plane; face its line instead.
	const facing =
		normal !== null && normal.lengthSq() > 1e-12
			? { normal: normal.normalize() }
			: { axis: to.clone().sub(from).normalize() };
	return { center: anchor, radius: radius * 1.2, facing };
}

export interface GuidesOverlay {
	/** Root object carrying the Z-up → Y-up rotation; added directly to
	 *  the scene (never under the parsed GLB — the GLB cache clones the
	 *  scene graph per visit, so shared children would be disposed). */
	group: THREE.Group;
	/** Replace the rendered guide set (disposes the previous meshes). */
	setGuides(guides: Guide[]): void;
	/** Re-apply visibility and color per the current selection — cheap,
	 *  safe to call on every selection change with no rebuild. */
	refresh(opts: { visible: (param: string) => boolean }): void;
	/** Re-scale all guide meshes for the current camera, keeping every
	 *  guide a constant number of screen pixels regardless of zoom. Call
	 *  once per frame from the render loop. */
	update(camera: THREE.PerspectiveCamera, viewportHeight: number): void;
	dispose(): void;
}

/** Blueprint-style dimension-guide overlay: each guide is a real mesh —
 *  a cylindrical shaft with arrowhead cones and terminal butt disks
 *  defining its ends, plus a dot on an angle's vertex — scaled to the
 *  guide set's overall size. Every guide's meshes share the group for its
 *  so selection-based visibility/brightness is a material swap, no rebuild.
 *  Meshes render through the model (depthTest off, late render order) so
 *  guides stay readable inside solid shells. */
export function createGuidesOverlay(): GuidesOverlay {
	// The backend's guide coordinates are Z-up; this matches the rotation
	// the backend bakes into the GLB root node (-90° about X).
	const group = new THREE.Group();
	group.rotation.x = -Math.PI / 2;
	group.visible = false;
	// Both materials are fully unlit and fully opaque: the guide must read as
	// a crisp blueprint line over the model, so a lit surface (bright key
	// side or shadowed dark side) must never tint it. `transparent` is left
	// on so the overlay stays in the transparent render pass — the same pass
	// ordering guarantee as the reference — while full opacity keeps the
	// shadowed regions of the model from bleeding through the line.
	const baseMat = new THREE.MeshBasicMaterial({
		color: BASE_COLOR,
		depthTest: false,
		transparent: true,
		opacity: 1.0,
	});
	const hoverMat = new THREE.MeshBasicMaterial({
		color: HOVER_COLOR,
		depthTest: false,
		transparent: true,
		opacity: 1.0,
	});

	// One item per mesh: its anchor point in local (Z-up) space decides the
	// per-frame scale, and `apply` re-poses/rescales the mesh for a given
	// world-per-pixel factor `k` (see update()).
	let entries: Array<{ items: Array<{ mesh: THREE.Mesh; anchor: THREE.Vector3; apply: (k: number) => void }>; param: string }> = [];

	// Shared unit geometries — every mesh scales one of these from its own
	// anchor, so one geometry serves all instances of its shape.
	const shaftGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
	// Proportioned so uniform scaling by the arrowhead length yields the
	// blueprint arrowhead width.
	const headGeo = new THREE.ConeGeometry(ARROW_WIDTH_PX / (2 * ARROW_LENGTH_PX), 1, 10);
	// Proportioned so uniform scaling by the disk diameter yields the
	// hairline tick thickness.
	const diskGeo = new THREE.CylinderGeometry(0.5, 0.5, BUTT_DISK_THICKNESS_RATIO, 12);
	const dotGeo = new THREE.SphereGeometry(0.5, 10, 8);

	/** Shaft geometry between two points, plus arrowhead cones at each end
	 *  pointing outward along the axis. Cone and cylinder primitives are
	 *  born along +Y, so each mesh's +Y is rotated onto its own direction;
	 *  orientations are fixed at build time, sizes/positions per frame. */
	const buildSegment = (a: THREE.Vector3, b: THREE.Vector3): Array<{ mesh: THREE.Mesh; anchor: THREE.Vector3; apply: (k: number) => void }> => {
		// Pull the shaft short of both endpoints by the arrowhead length so
		// the cones sit at the exact measured positions.
		const axis = b.clone().sub(a);
		const length = axis.length();
		const direction = axis.clone().normalize();
		const midpoint = a.clone().addScaledVector(direction, length / 2);
		const out: Array<{ mesh: THREE.Mesh; anchor: THREE.Vector3; apply: (k: number) => void }> = [];

		const shaft = new THREE.Mesh(shaftGeo, baseMat);
		shaft.position.copy(midpoint);
		shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
		out.push({
			mesh: shaft,
			anchor: midpoint,
			apply: (k) => {
				const arrowLength = k * ARROW_LENGTH_PX;
				shaft.scale.set(k * SHAFT_DIAMETER_PX, Math.max(length - 2 * arrowLength, length * 0.2), k * SHAFT_DIAMETER_PX);
			},
		});

		for (const [tip, outward] of [
			[b, 1],
			[a, -1],
		] as const) {
			// Cone +Y points from base to tip. Both heads aim outward from
			// the segment (tip direction = direction * outward) with the
			// TIP resting exactly on the endpoint: center = tip - tipDir*h/2
			// puts the base one arrowLength inside, flush against the shaft.
			const tipDir = direction.clone().multiplyScalar(outward);
			const tipPoint = tip.clone();
			const head = new THREE.Mesh(headGeo, baseMat);
			head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipDir);
			out.push({
				mesh: head,
				anchor: tipPoint,
				apply: (k) => {
					const arrowLength = k * ARROW_LENGTH_PX;
					head.scale.setScalar(arrowLength);
					head.position.copy(tipPoint).addScaledVector(tipDir, -arrowLength / 2);
				},
			});
			// Flat disk at the tip marking what the arrow butts up against —
			// the blueprint's terminal "tick" line. Its face is centered on
			// the endpoint, straddling it by half its thickness. Cylinder
			// height is along +Y, same axis as tipDir, so its flat faces
			// sit perpendicular to the guide.
			const disk = new THREE.Mesh(diskGeo, baseMat);
			disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipDir);
			out.push({
				mesh: disk,
				anchor: tipPoint,
				apply: (k) => {
					disk.scale.setScalar(k * BUTT_DISK_DIAMETER_PX);
					disk.position.copy(tipPoint);
				},
			});
		}
		return out;
	};

	const buildGuide = (guide: Guide): { items: Array<{ mesh: THREE.Mesh; anchor: THREE.Vector3; apply: (k: number) => void }>; param: string } => {
		const v = (p: { world: [number, number, number] }) => new THREE.Vector3(...p.world);
		let items = buildSegment(v(guide.from), v(guide.to));
		if (guide.kind === "angle") {
			// An angle guide is a V: vertex→from and vertex→to, plus a dot
			// riding on the vertex anchor so it keeps its screen size while
			// the legs' arrowheads rescale around it.
			const vertex = v(guide.vertex);
			items = [
				...buildSegment(vertex, v(guide.from)),
				...buildSegment(vertex, v(guide.to)),
			];
			const dot = new THREE.Mesh(dotGeo, baseMat);
			dot.position.copy(vertex);
			items.push({
				mesh: dot,
				anchor: vertex,
				apply: (k) => {
					dot.scale.setScalar(k * VERTEX_DIAMETER_PX);
				},
			});
		}
		return { items, param: guide.param };
	};

	const setGuides = (guides: Guide[]) => {
		for (const { items } of entries) {
			group.remove(...items.map(({ mesh }) => mesh));
		}
		entries = [];

		for (const guide of guides) {
			const entry = buildGuide(guide);
			for (const { mesh } of entry.items) {
				mesh.castShadow = false;
				mesh.receiveShadow = false;
				mesh.renderOrder = 10;
				group.add(mesh);
			}
			entries.push(entry);
		}
		group.visible = entries.length > 0;
	};

	// Screen-constant sizing: a mesh whose anchor sits `d` from the camera
	// needs world size = pixels · 2·d·tan(fov/2) / viewportHeight. Each
	// item's apply() receives that world-per-pixel factor for its own
	// anchor, so every guide keeps its pixel size at any zoom — perspective
	// shrink of a distant anchor is exactly offset by the larger frustum
	// there, and model scale never enters the equation.
	const update = (camera: THREE.PerspectiveCamera, viewportHeight: number) => {
		const height = Math.max(viewportHeight, 1);
		// Anchors live in the group's local Z-up frame while camera.position
		// is world-space (Y-up); measure their distance in the local frame.
		group.updateMatrixWorld();
		const camLocal = camera.position.clone().applyMatrix4(group.matrixWorld.clone().invert());
		for (const entry of entries) {
			for (const { anchor, apply } of entry.items) {
				apply(pixelsToWorld(camera, camLocal.distanceTo(anchor), height));
			}
		}
	};

	const refresh = ({ visible }: { visible: (param: string) => boolean }) => {
		for (const entry of entries) {
			const on = visible(entry.param);
			const material = on ? hoverMat : baseMat;
			entry.items.forEach(({ mesh }) => {
				mesh.visible = on;
				mesh.material = material;
			});
		}
	};

	const dispose = () => {
		entries = [];
		shaftGeo.dispose();
		headGeo.dispose();
		diskGeo.dispose();
		dotGeo.dispose();
		baseMat.dispose();
		hoverMat.dispose();
		group.parent?.remove(group);
	};

	return { group, setGuides, refresh, update, dispose };
}
