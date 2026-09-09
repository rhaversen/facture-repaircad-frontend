"use client";

import React, {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Timer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";

import { SWEEP_FPS } from "@/lib/config";
import type { DesignVariant, THREE_Group } from "@/lib/types";

/*
  Shared three.js viewport building blocks for the CAD screen: model display
  (3MF is Z-up), the sweep flipbook player, per-design camera fitting, the
  main canvas, and the synchronized multi-tile design picker.
*/

export function Model({ mesh }: { mesh: THREE_Group }) {
  // 3MF is Z-up; nod up so the model stands upright without manual rotation.
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={mesh} />
    </group>
  );
}

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
function ForgeStudio({
  fitKey,
  fitMesh,
}: {
  fitKey?: string | null;
  fitMesh?: THREE_Group | null;
} = {}) {
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
    3MF meshes (loaders leave it off by default).
  */
  useEffect(() => {
    const light = keyRef.current;
    if (!light || !fitMesh) return;
    fitMesh.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(fitMesh);
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
    light.shadow.needsUpdate = true;
  }, [fitKey, fitMesh]);

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
  radius: the affected tile shows a fallback instead of the app crashing.
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

function LoadingSpinner() {
  return (
    <mesh>
      <sphereGeometry args={[0.2, 24, 24]} />
      <meshStandardMaterial color="#6b7280" wireframe opacity={0.6} transparent />
    </mesh>
  );
}

export interface Playhead {
  pos: number;
  index: number;
}

/*
  Plays the rendered sweep as a ping-pong animation, stepping one frame every
  1 / SWEEP_FPS seconds and reversing at both ends. All frame meshes stay
  mounted; stepping is just a visibility flip. The playhead is written to
  playheadRef on every render-loop tick so the UI can mirror it without React
  re-renders.
*/
export function SweepPlayer({
  frames,
  paused,
  playheadRef,
}: {
  frames: THREE_Group[];
  paused: boolean;
  playheadRef: React.MutableRefObject<Playhead>;
}) {
  const groupsRef = useRef<(THREE.Group | null)[]>([]);
  const frameIndexRef = useRef(0);
  const directionRef = useRef(1);
  const stepTimerRef = useRef(0);

  useLayoutEffect(() => {
    frameIndexRef.current = 0;
    directionRef.current = 1;
    stepTimerRef.current = 0;
    groupsRef.current.forEach((group, i) => {
      if (group) group.visible = i === 0;
    });
    playheadRef.current = { pos: 0, index: 0 };
  }, [frames, playheadRef]);

  useFrame((_, delta) => {
    if (paused) return;
    const n = frames.length;
    if (n < 2) return;

    // Clamp the frame delta and cap the accumulator at one step: after a page
    // load or tab switch the first delta can span seconds.
    const step = 1 / SWEEP_FPS;
    stepTimerRef.current = Math.min(
      stepTimerRef.current + Math.min(delta, 0.25),
      step,
    );
    if (stepTimerRef.current >= step) {
      stepTimerRef.current -= step;

      const next = frameIndexRef.current + directionRef.current;
      if (next >= n || next < 0) {
        directionRef.current = -directionRef.current;
        frameIndexRef.current += directionRef.current;
      } else {
        frameIndexRef.current = next;
      }

      for (let i = 0; i < n; i++) {
        const group = groupsRef.current[i];
        if (group) group.visible = i === frameIndexRef.current;
      }
    }

    // Interpolate from the previous displayed frame to the current one across
    // the step so the playhead glides between sweep values.
    const fraction = Math.min(stepTimerRef.current / step, 1);
    const raw = frameIndexRef.current - directionRef.current * (1 - fraction);
    playheadRef.current = {
      pos: Math.min(Math.max(raw, 0), n - 1),
      index: frameIndexRef.current,
    };
  });

  return (
    <>
      {frames.map((frame, i) => (
        <group
          key={i}
          ref={(el) => {
            groupsRef.current[i] = el;
          }}
          visible={i === 0}
        >
          <Model mesh={frame} />
        </group>
      ))}
    </>
  );
}

/*
  Display-space bounds of a parsed 3MF mesh, with the Z-up correction applied.
  The radius sets camera fit distances; the center is where the model's visual
  middle sits.
*/
export function meshDisplayBounds(mesh: THREE_Group) {
  mesh.updateWorldMatrix(true, true);
  const meshInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const localBox = new THREE.Box3();
  let hasGeometry = false;
  mesh.traverse((obj) => {
    if (!((obj as THREE.Mesh).isMesh)) return;
    const geometry = (obj as THREE.Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const rel = new THREE.Matrix4().multiplyMatrices(meshInv, obj.matrixWorld);
    const objBox = geometry.boundingBox!.clone().applyMatrix4(rel);
    if (hasGeometry) {
      localBox.union(objBox);
    } else {
      localBox.copy(objBox);
      hasGeometry = true;
    }
  });
  if (!hasGeometry || localBox.isEmpty()) return null;
  localBox.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const sphere = localBox.getBoundingSphere(new THREE.Sphere());
  if (!isFinite(sphere.radius) || sphere.radius <= 0) return null;
  return {
    radius: sphere.radius,
    center: localBox.getCenter(new THREE.Vector3()),
  };
}

/*
  One-shot camera framing per design: when the model first appears, aim
  OrbitControls at the model's displayed centre and pull the camera back to a
  comfortable three-quarter view slightly above it. Runs once per fitKey.
*/
function CameraFit({
  fitKey,
  mesh,
}: {
  fitKey: string | null;
  mesh: THREE_Group | null;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;
  const fittedKeyRef = useRef<string | null>(null);

  // Imperative three.js camera/controls mutation is intentional here.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!mesh || fitKey === null || fittedKeyRef.current === fitKey) return;
    if (!controls) return;
    const bounds = meshDisplayBounds(mesh);
    if (bounds === null) return;
    fittedKeyRef.current = fitKey;

    const dist = (bounds.radius / Math.sin((((camera as THREE.PerspectiveCamera).fov / 2) * Math.PI) / 180)) * 1.6;

    const target = new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3(1, 0.55, 1.3).normalize();

    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = Math.max(0.01, dist / 500);
    camera.far = Math.max(500, dist * 20);
    camera.updateProjectionMatrix();

    controls.target.copy(target);
    controls.update();
  }, [fitKey, mesh, camera, controls]);
  /* eslint-enable react-hooks/immutability */

  return null;
}

export function CadCanvas({
  children,
  generating,
  fitKey,
  fitMesh,
}: {
  children: React.ReactNode;
  generating: boolean;
  fitKey: string | null;
  fitMesh: THREE_Group | null;
}) {
  return (
    <CanvasErrorBoundary>
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        camera={{ position: [12, 9, 18], fov: 45, near: 0.01, far: 2000 }}
        style={{ width: "100%", height: "100%", background: "#ffffff" }}
        onCreated={(state) => state.set({ clock: createTimerClock() })}
      >
        <ForgeStudio fitKey={fitKey} fitMesh={fitMesh} />
        <Suspense fallback={generating ? <LoadingSpinner /> : null}>{children}</Suspense>
        <CameraFit fitKey={fitKey} mesh={fitMesh} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} minDistance={0.001} maxDistance={Infinity} />
      </Canvas>
    </CanvasErrorBoundary>
  );
}

/* Picker viewport tuning. */
const PICKER_PAGE_SIZE = 4;
/* Slight auto-orbit: one full turn in ~40 seconds. */
const ORBIT_SPEED = (2 * Math.PI) / 40;
/* Camera elevation above the horizontal plane, in radians. */
const PICKER_ELEVATION = 0.45;
/* Seconds after the last drag ends before the shared orbit resumes. */
const ORBIT_RESUME_DELAY = 1.5;

interface OrbitState {
  angle: number;
  baseAngle: number;
  baseTime: number | null;
  paused: boolean;
  dragging: boolean;
  resumeAt: number;
  leaderId: string | null;
  camTheta: number;
  camPhi: number;
  camRadius: number;
  camTarget: THREE.Vector3;
  autoOrbit: boolean;
}

/*
  The picker's model: re-centred on its bounding-box middle and rotated by the
  shared orbit angle every frame. The tile being interacted with publishes its
  camera pose; all other tiles copy it every frame — live during the drag.
*/
function PickerModel({
  mesh,
  center,
  orbit,
  tileId,
}: {
  mesh: THREE_Group;
  center: THREE.Vector3;
  orbit: OrbitState;
  tileId: string;
}) {
  const spinRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;

  // Shared mutable state reads/writes are intentional here.
  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    if (spinRef.current === null || controls === null) return;
    const now = performance.now() / 1000;
    if (orbit.baseTime === null) orbit.baseTime = now;

    const interactive =
      orbit.leaderId !== null && (orbit.dragging || now < orbit.resumeAt);
    if (interactive && orbit.leaderId === tileId) {
      const spherical = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      if (spherical.radius > 0 && isFinite(spherical.theta) && isFinite(spherical.phi)) {
        orbit.camTheta = spherical.theta;
        orbit.camPhi = spherical.phi;
        orbit.camRadius = spherical.radius;
        orbit.camTarget.copy(controls.target);
      }
      orbit.paused = true;
      return;
    }

    if (orbit.camRadius > 0) {
      camera.position
        .setFromSphericalCoords(orbit.camRadius, orbit.camPhi, orbit.camTheta)
        .add(orbit.camTarget);
      controls.target.copy(orbit.camTarget);
      controls.update();
    }

    if (interactive) return;

    if (orbit.autoOrbit) {
      if (orbit.paused && !(orbit.dragging || now < orbit.resumeAt)) {
        // Resume the turntable from the frozen angle.
        orbit.baseAngle = orbit.angle;
        orbit.baseTime = now;
        orbit.paused = false;
        orbit.leaderId = null;
      }
      orbit.angle = orbit.baseAngle + (now - orbit.baseTime) * ORBIT_SPEED;
      spinRef.current.rotation.y = orbit.angle;
    }
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group ref={spinRef}>
      <group position={[-center.x, -center.y, -center.z]}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <primitive object={mesh} />
        </group>
      </group>
    </group>
  );
}

export function DesignPicker({
  variants,
  onSelect,
}: {
  variants: DesignVariant[];
  onSelect?: (designId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(variants.length / PICKER_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleIds = useMemo(
    () =>
      new Set(
        variants
          .slice(safePage * PICKER_PAGE_SIZE, (safePage + 1) * PICKER_PAGE_SIZE)
          .map((variant) => variant.designId),
      ),
    [variants, safePage],
  );

  // Display-space bounds per variant, computed once. Every tile stays mounted
  // across page flips (hidden ones stop their render loop), so WebGL contexts
  // are never recreated.
  const variantBounds = useMemo(
    () =>
      variants.map((variant) =>
        variant.mesh !== null ? meshDisplayBounds(variant.mesh) : null,
      ),
    [variants],
  );

  // One shared fit: the largest variant radius, so every model sits at the
  // same distance in the same synchronized camera.
  const fitRadius = useMemo(() => {
    let radius = 0;
    for (const bounds of variantBounds) {
      if (bounds !== null) radius = Math.max(radius, bounds.radius);
    }
    return radius > 0 ? radius : 10;
  }, [variantBounds]);

  const distance = (fitRadius / Math.sin((45 / 2) * (Math.PI / 180))) * 1.25;
  const near = Math.max(0.01, distance / 500);
  const far = Math.max(500, distance * 20);

  // Wall-clock driven shared orbit state so every tile shows the same angle.
  const orbit = useMemo<OrbitState>(
    () => ({
      angle: 0,
      baseAngle: 0,
      baseTime: null,
      paused: false,
      dragging: false,
      resumeAt: 0,
      leaderId: null,
      camTheta: 0,
      camPhi: PICKER_ELEVATION,
      camRadius: 0,
      camTarget: new THREE.Vector3(),
      autoOrbit: true,
    }),
    [],
  );

  // Any interaction ends the turntable for this round; only a fresh picker
  // (new design round) re-enables it.
  /* eslint-disable react-hooks/immutability */
  const pauseOrbit = (tileId: string) => () => {
    orbit.paused = true;
    orbit.autoOrbit = false;
    orbit.dragging = true;
    orbit.leaderId = tileId;
  };
  const scheduleOrbitResume = () => {
    orbit.dragging = false;
    orbit.resumeAt = performance.now() / 1000 + ORBIT_RESUME_DELAY;
  };
  /* eslint-enable react-hooks/immutability */

  const cameraConfig = useMemo(
    () => ({
      position: [
        distance * Math.cos(PICKER_ELEVATION),
        distance * Math.sin(PICKER_ELEVATION),
        0,
      ] as [number, number, number],
      fov: 45,
      near,
      far,
    }),
    [distance, near, far],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 max-[900px]:grid-cols-1">
        {variants.map((variant, index) => {
          const visible = visibleIds.has(variant.designId);
          const selected = selectedId === variant.designId;
          const bounds = variantBounds[index];
          return (
            <div
              key={variant.designId}
              className={`flex flex-col gap-2.5 rounded-xl border-2 bg-white p-2.5 ${
                selected
                  ? "border-brand shadow-[0_0_0_3px_rgba(36,72,184,0.15)]"
                  : "border-line-soft hover:border-[#b9c2d0]"
              }`}
              style={visible ? undefined : { display: "none" }}
            >
              <div
                className={`relative h-[380px] overflow-hidden rounded-lg border border-line-soft bg-white max-[900px]:h-[320px] ${
                  variant.status === "preview" ? "opacity-35 grayscale-[0.8]" : ""
                }`}
              >
                {bounds !== null ? (
                  <CanvasErrorBoundary>
                    <Canvas
                      frameloop={visible ? "always" : "never"}
                      camera={cameraConfig}
                      dpr={[1, 1.5]}
                      shadows={{ type: THREE.PCFSoftShadowMap }}
                      style={{ width: "100%", height: "100%", background: "#ffffff" }}
                      onCreated={(state) => state.set({ clock: createTimerClock() })}
                    >
                      <ForgeStudio fitKey={variant.designId} fitMesh={variant.mesh} />
                      <Suspense fallback={null}>
                        <PickerModel
                          mesh={variant.mesh!}
                          center={bounds.center}
                          orbit={orbit}
                          tileId={variant.designId}
                        />
                      </Suspense>
                      <OrbitControls
                        makeDefault
                        enableDamping
                        dampingFactor={0.1}
                        minDistance={0.001}
                        maxDistance={Infinity}
                        onStart={pauseOrbit(variant.designId)}
                        onEnd={scheduleOrbitResume}
                      />
                    </Canvas>
                  </CanvasErrorBoundary>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-soft">
                    <div className="cad-spinner" />
                    <p>Generating…</p>
                  </div>
                )}
                {variant.status !== "ready" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-soft">
                    <div className="cad-spinner" />
                    <p>Generating…</p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-sm font-semibold text-ink-soft">Design {index + 1}</span>
                <button
                  type="button"
                  className={`rounded-lg border px-3 py-1 text-[13px] ${
                    selected
                      ? "border-brand bg-brand text-white"
                      : "border-[#d5d9e0] bg-white text-muted hover:border-brand hover:text-brand"
                  }`}
                  disabled={variant.mesh === null || variant.status !== "ready"}
                  onClick={() => {
                    setSelectedId(variant.designId);
                    onSelect?.(variant.designId);
                  }}
                >
                  {variant.status !== "ready"
                    ? "Generating…"
                    : selected
                      ? "✓ Selected"
                      : "Select"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            className="btn-secondary"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            ← Previous
          </button>
          <span className="min-w-[110px] text-center text-sm text-muted">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={safePage === pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
