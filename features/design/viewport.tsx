"use client";

import React, { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Timer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";

import type { Guide } from "@/lib/types";
import { createGuidesOverlay, type GuidesOverlay } from "./guides";

/*
  The one three.js viewport the app uses, for picker tiles and the design
  workspace alike: studio lighting, a three-quarter camera fit per model,
  optional dimension guides with a camera glide onto one, and orbit controls.
  Forge GLBs arrive already rotated into Y-up display space.
*/
/*
  Clock-shaped adapter over THREE.Timer so the R3F render loop stops using the
  deprecated THREE.Clock. R3F only touches getDelta(), elapsedTime, oldTime,
  start() and stop(); Timer additionally freezes deltas while the tab is
  hidden. Created per canvas and installed via onCreated.
*/
function createTimerClock(): THREE.Clock {
  const timer = new Timer();
  let connected = false;
  const ensureConnected = () => {
    if (!connected && typeof document !== "undefined") {
      timer.connect(document);
      connected = true;
    }
  };
  const clock = {
    autoStart: true,
    running: true,
    oldTime: 0,
    elapsedTime: 0,
    start() {
      ensureConnected();
      clock.elapsedTime = 0;
      timer.reset();
    },
    stop() {},
    getDelta() {
      ensureConnected();
      timer.update(performance.now());
      clock.elapsedTime = timer.getElapsed();
      return timer.getDelta();
    },
    getElapsedTime() {
      return clock.elapsedTime;
    },
  };
  return clock as unknown as THREE.Clock;
}

/*
  Studio lighting copied from facture-forge-frontend's createSceneCore: a
  PMREM-baked room environment is the dominant light source, with a warm-cool
  key/rim directional pair for shape definition and a faint hemisphere fill so
  shadowed sides never go fully black.
*/
function ForgeStudio({ model }: { model: THREE.Object3D }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const keyRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const previous = scene.environment;
    // Imperative three.js scene mutation is intentional here.
    /* eslint-disable react-hooks/immutability */
    scene.environment = env;
    scene.environmentIntensity = 0.65;
    return () => {
      scene.environment = previous;
      env.dispose();
    };
    /* eslint-enable react-hooks/immutability */
  }, [gl, scene]);

  /*
    Refit the shadow camera to the mesh bounds on each load so small and
    large models both get crisp contact shadows, and enable casting on the
    mesh parts (decoding leaves shadows off by default).
  */
  useEffect(() => {
    const light = keyRef.current;
    if (!light) return;
    model.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = light.shadow.camera;
    cam.left = -sphere.radius;
    cam.right = sphere.radius;
    cam.top = sphere.radius;
    cam.bottom = -sphere.radius;
    cam.near = 0.1;
    // Orthographic depth along the light direction; pad the far plane so
    // the whole scene fits regardless of light distance.
    cam.far = sphere.radius * 4 + light.position.length();
    cam.updateProjectionMatrix();
    const center = box.getCenter(new THREE.Vector3());
    light.target.position.copy(center);
    light.target.updateMatrixWorld();
    light.shadow.needsUpdate = true;
  }, [model]);

  return (
    <>
      <hemisphereLight args={[0xffffff, 0x334455, 0.2]} />
      <directionalLight
        ref={keyRef}
        color={0xfff4e6}
        position={[120, 180, 100]}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />
      {/* Rim/back light from behind-opposite the key: separates silhouettes
          from the background without adding a shadow pass. */}
      <directionalLight color={0xdfe8ff} position={[-100, 80, -140]} intensity={0.35} />
    </>
  );
}

/*
  R3F canvases can throw during teardown races (a canvas unmounting in the
  same commit another mounts can hit a null event target). Contain the blast
  radius: the affected viewport shows a fallback instead of the app crashing.
*/
class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("CAD viewport crashed:", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-ink-soft">
          <p>Viewport could not start.</p>
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => this.setState({ failed: false })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/*
  Display-space bounds of a decoded Forge mesh. The backend's GLB root node
  pre-applies the Z-up → Y-up rotation, so the parsed scene is already in
  display space and the bounds read straight off it. The radius sets camera
  fit distances; the center is where the model's visual middle sits.
*/
export function meshDisplayBounds(scene: THREE.Object3D) {
  scene.updateWorldMatrix(true, true);
  const sceneInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const localBox = new THREE.Box3();
  let hasGeometry = false;
  scene.traverse((obj: THREE.Object3D) => {
    if (!((obj as THREE.Mesh).isMesh)) return;
    const geometry = (obj as THREE.Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const rel = new THREE.Matrix4().multiplyMatrices(sceneInv, obj.matrixWorld);
    const objBox = geometry.boundingBox!.clone().applyMatrix4(rel);
    if (hasGeometry) {
      localBox.union(objBox);
    } else {
      localBox.copy(objBox);
      hasGeometry = true;
    }
  });
  if (!hasGeometry || localBox.isEmpty()) return null;
  const sphere = localBox.getBoundingSphere(new THREE.Sphere());
  if (!isFinite(sphere.radius) || sphere.radius <= 0) return null;
  return {
    radius: sphere.radius,
    center: localBox.getCenter(new THREE.Vector3()),
  };
}

/*
  Camera framing: aim OrbitControls at the first model's displayed centre and
  pull the camera back to a three-quarter view slightly above it. Later
  revisions (a parameter change, an agent turn) keep the user's view — only
  the far plane grows if the new model reaches past it.
*/
function CameraFit({ model }: { model: THREE.Object3D }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;
  const fittedRef = useRef<THREE.Object3D | null>(null);

  // Imperative three.js camera/controls mutation is intentional here.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!controls || fittedRef.current === model) return;
    const bounds = meshDisplayBounds(model);
    if (bounds === null) return;
    const first = fittedRef.current === null;
    fittedRef.current = model;
    if (!first) {
      const reach = camera.position.distanceTo(bounds.center) + bounds.radius;
      if (reach * 2 > camera.far) {
        camera.far = reach * 2;
        camera.updateProjectionMatrix();
      }
      return;
    }

    // Fit against the narrower side of the frame: on a non-square pane the
    // horizontal fov is smaller than the vertical one, and the bounds radius
    // must clear that tighter angle or the model's edges leave the viewport.
    const vHalf = ((camera.fov / 2) * Math.PI) / 180;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = (bounds.radius / Math.sin(Math.min(vHalf, hHalf))) * 1.6;

    // OrbitControls look at the world origin by default, but a model whose
    // geometry is authored off-origin would sit above/below the viewport.
    // Aim at the model's own bounds centre so it always lands mid-viewport;
    // clone so controls don't alias the bounds object's vector.
    const target = bounds.center.clone();
    const dir = new THREE.Vector3(1, 0.55, 1.3).normalize();

    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = Math.max(0.01, dist / 500);
    camera.far = Math.max(500, dist * 20);
    camera.updateProjectionMatrix();

    controls.target.copy(target);
    controls.update();
  }, [model, camera, controls]);
  /* eslint-enable react-hooks/immutability */

  return null;
}

/** One-shot guide reframe request: display-space frame centre + radius, and
 *  a monotonically increasing nonce so repeat clicks on the same param
 *  re-trigger the camera move (an equal nonce is treated as already
 *  applied). */
export interface GuideFrameRequest {
	center: [number, number, number];
	radius: number;
	/** Look along this (an angle guide's plane normal)… */
	normal?: [number, number, number];
	/** …or from a direction perpendicular to this (a distance guide's line). */
	axis?: [number, number, number];
	nonce: number;
}

/* The direction from the guide to the camera that shows the guide
   square-on, as close to the current view as that allows, so the camera
   turns as little as possible. */
function facingDirection(frame: GuideFrameRequest, current: THREE.Vector3): THREE.Vector3 {
	const center = new THREE.Vector3(...frame.center);
	const outward =
		center.lengthSq() > 1e-12 ? center.normalize() : new THREE.Vector3(1, 0.55, 1.3).normalize();
	const view = current.lengthSq() > 1e-12 ? current.clone().normalize() : outward;
	let u: THREE.Vector3;
	if (frame.normal) {
		const n = new THREE.Vector3(...frame.normal).normalize();
		u = n.dot(view) >= 0 ? n : n.negate();
	} else if (frame.axis) {
		const a = new THREE.Vector3(...frame.axis).normalize();
		const perpendicular = (v: THREE.Vector3) => v.clone().addScaledVector(a, -v.dot(a));
		u = perpendicular(view);
		if (u.lengthSq() < 1e-6) u = perpendicular(outward);
		if (u.lengthSq() < 1e-6) u = perpendicular(new THREE.Vector3(0, 0, 1));
		if (u.lengthSq() < 1e-6) u = perpendicular(new THREE.Vector3(1, 0, 0));
		u.normalize();
	} else {
		u = outward;
	}
	// Straight up or down leaves the orbit's azimuth undefined; tilt a hair.
	if (Math.abs(u.y) > 0.999) u.add(new THREE.Vector3(0, 0, 0.02)).normalize();
	return u;
}

/* Seconds for the eased glide between guide frame positions. */
const GUIDE_FRAME_DURATION_MS = 900;
function easeInOutCubic(t: number) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/*
  Guide framing: camera, guide and world origin sit collinear — the
  camera stays on the far side of the guide, looking through it
  toward the origin. The distance starts at whatever is needed for
  the guide's frame sphere to fit, floored at half the distance that
  fits the whole model (the auto position can never zoom closer than
  that). Every move eases from the camera's current position, so a
  click mid-glide retargets from wherever the camera is; a user drag
  cancels the glide and OrbitControls resumes from the hand-off.
  Runs once per nonce — and only when the makeDefault OrbitControls
  exist, which they may not on the very first tick after a canvas
  mount, hence the deferred guard below.
*/
function GuideReframe({
	frame,
	model,
}: {
	frame: GuideFrameRequest | null;
	model: THREE.Object3D;
}) {
	const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
	const controls = useThree((state) => state.controls) as
		| (THREE.EventDispatcher & {
				target: THREE.Vector3;
				update: () => void;
			})
		| null;
	const appliedNonce = useRef<number | null>(null);
	const glide = useRef<{
		fromPos: THREE.Vector3;
		fromTarget: THREE.Vector3;
		toPos: THREE.Vector3;
		toTarget: THREE.Vector3;
		start: number;
	} | null>(null);

	// Imperative three.js camera/controls mutation is intentional here.
	/* eslint-disable react-hooks/immutability */
	useEffect(() => {
		if (frame === null) {
			appliedNonce.current = null;
			glide.current = null;
			return;
		}
		if (!controls || appliedNonce.current === frame.nonce) return;
		appliedNonce.current = frame.nonce;

		const center = new THREE.Vector3(...frame.center);
		const u = facingDirection(frame, camera.position.clone().sub(controls.target));

		const vHalf = ((camera.fov / 2) * Math.PI) / 180;
		const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
		const half = Math.min(vHalf, hHalf);
		let distance = (frame.radius / Math.sin(half)) * 1.4;
		const bounds = meshDisplayBounds(model);
		if (bounds !== null) {
			// Never glide closer than half the whole-model fit distance.
			const wholeModel = (bounds.radius / Math.sin(half)) * 1.6;
			distance = Math.max(distance, wholeModel / 2);
		}

		const toPos = center.clone().addScaledVector(u, distance);
		const toTarget = center.clone();
		camera.near = Math.max(0.01, distance / 500);
		camera.far = Math.max(500, (distance + center.length()) * 20);
		camera.updateProjectionMatrix();

		// Rebase from the live position so an interrupted glide or a
		// manual orbit never jumps.
		glide.current = {
			fromPos: camera.position.clone(),
			fromTarget: controls.target.clone(),
			toPos,
			toTarget,
			start: performance.now(),
		};
	}, [frame, camera, controls, model]);

	useEffect(() => {
		if (controls === null) return;
		const dispatcher = controls as unknown as {
			addEventListener(type: string, handler: () => void): void;
			removeEventListener(type: string, handler: () => void): void;
		};
		const cancel = () => {
			glide.current = null;
		};
		dispatcher.addEventListener("start", cancel);
		return () => {
			dispatcher.removeEventListener("start", cancel);
		};
	}, [controls]);

	useFrame(() => {
		const active = glide.current;
		if (active === null || controls === null) return;
		const t = Math.min(
			1,
			(performance.now() - active.start) / GUIDE_FRAME_DURATION_MS,
		);
		const k = easeInOutCubic(t);
		// Swing the view direction around the target rather than cutting
		// straight across, which could pass through the model.
		controls.target.lerpVectors(active.fromTarget, active.toTarget, k);
		const fromOffset = active.fromPos.clone().sub(active.fromTarget);
		const toOffset = active.toPos.clone().sub(active.toTarget);
		const turn = new THREE.Quaternion()
			.setFromUnitVectors(fromOffset.clone().normalize(), toOffset.clone().normalize());
		const offset = fromOffset
			.normalize()
			.applyQuaternion(new THREE.Quaternion().slerp(turn, k))
			.multiplyScalar(THREE.MathUtils.lerp(active.fromPos.distanceTo(active.fromTarget), toOffset.length(), k));
		camera.position.copy(controls.target).add(offset);
		controls.update();
		if (t >= 1) glide.current = null;
	});
	/* eslint-enable react-hooks/immutability */

	return null;
}

/** Dimension guides over the model, built by the backend with each revision
 *  so they always match it. Only the active parameter's guides show; a
 *  selection change only flips visibility, never rebuilds. */
function Guides({ guides, active }: { guides: Guide[]; active: string | null }) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const viewportHeight = useThree((state) => state.size.height);
  const overlayRef = useRef<GuidesOverlay | null>(null);

  useEffect(() => {
    if (scene === null) return;
    const overlay = createGuidesOverlay();
    scene.add(overlay.group);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      scene.remove(overlay.group);
      overlayRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    overlayRef.current?.setGuides(guides);
  }, [guides]);

  useEffect(() => {
    overlayRef.current?.refresh({ visible: (param) => param === active });
  }, [guides, active]);

  // Guides are sized in screen pixels — rescale every frame against the
  // live camera so they stay a constant pixel size at any zoom.
  useFrame(() => {
    overlayRef.current?.update(camera, viewportHeight);
  });

  return null;
}

export function CadCanvas({
  model,
  guides = [],
  activeGuide = null,
  guideFrame = null,
  autoRotate = false,
}: {
  model: THREE.Group;
  guides?: Guide[];
  /** The parameter whose guides are shown; null shows none. */
  activeGuide?: string | null;
  guideFrame?: GuideFrameRequest | null;
  /** Slow turntable until the user grabs the model (picker tiles). */
  autoRotate?: boolean;
}) {
  const [spinning, setSpinning] = React.useState(autoRotate);
  return (
    <CanvasErrorBoundary>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [12, 9, 18], fov: 45, near: 0.01, far: 2000 }}
        dpr={[1, 1.5]}
        style={{ width: "100%", height: "100%", background: "#ffffff" }}
        onCreated={(state) => state.set({ clock: createTimerClock() })}
      >
        <ForgeStudio model={model} />
        <primitive object={model} />
        <CameraFit model={model} />
        <GuideReframe frame={guideFrame} model={model} />
        <Guides guides={guides} active={activeGuide} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={0.001}
          maxDistance={Infinity}
          autoRotate={spinning}
          autoRotateSpeed={1.5}
          onStart={() => setSpinning(false)}
        />
      </Canvas>
    </CanvasErrorBoundary>
  );
}
