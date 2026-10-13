export interface FlowUser {
  _id: string;
  email?: string;
  [key: string]: unknown;
}

export type RunStatus = "running" | "idle" | "failed";

export interface FlowRun {
  _id: string;
  pipelineId: string;
  status: RunStatus | string;
  currentNodeId?: string | null;
  runningDoc?: RunningDoc;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunningDoc {
  forge_handoff_1?: string;
  forge_handoff_2?: string;
  forge_handoff_3?: string;
  fabrication_design_intent?: string;
  forge_instruction?: string;
  final_guidance?: string;
  [key: string]: unknown;
}

export type MessageContentPart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export interface FlowMessage {
  _id?: string;
  role: "user" | "assistant" | string;
  content: string | MessageContentPart[];
}

export interface PipelineSummary {
  _id: string;
  name: string;
  nodes: { _id: string; label?: string }[];
}

export type Unit = "mm" | "cm" | "in";

export interface SizeReference {
  knownDimension: number;
  unit: Unit;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
  type: "overview" | "close_up";
}

export interface Annotation {
  id: string;
  photoId: string;
  label: string;
  color: string;
  box: NormalizedBox;
  sizeReference: SizeReference | null;
}

export interface AnnotatedCopy {
  file: File;
  url: string;
}

export type ParameterKind = "length" | "angle" | "scalar" | "integer";

/*
  The backend's projected parameter: one calibration handle created by the
  agent. min/max are always concrete numbers (the spec clamps them), so
  slider ranges derive directly from them.
*/
export interface Parameter {
  name: string;
  description: string;
  kind: ParameterKind;
  /** "mm" for lengths, "deg" for angles, "" for unitless scalars. */
  unit: string;
  default: number;
  min: number;
  max: number;
  value: number;
  set: boolean;
}

/** One end of a guide, tied to the part it seats against. */
export interface GuideEnd {
  world: [number, number, number];
  part: string | null;
}

/*
  Blueprint dimension guides the backend computes per parameter — either a
  straight measurement between two ends, or an arc's radius through a
  vertex. Coordinates are millimeters in the design's Z-up world.
*/
export type Guide =
  | { kind: "distance"; param: string; from: GuideEnd; to: GuideEnd; measured: number }
  | {
      kind: "angle";
      param: string;
      from: GuideEnd;
      vertex: GuideEnd;
      to: GuideEnd;
      measured: number;
    };

/** Rows of the geometry REST response, used for revision-keyed caching. */
export interface GeometrySummary {
  revision: string;
  bytes: number;
  parts: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
  guides?: Guide[];
  ok: boolean;
  errors: number;
  builtAt: string;
}

/*
  A parsed GLB: the scene root for mounting, the meshes indexed by part
  name for picking, and the flat part list for selection UIs.
*/
export interface GlbModel {
  scene: THREE_Group;
  partMeshes: Map<string, import("three").Mesh[]>;
  parts: string[];
}

/** Row of GET /designs/:id — the design's user-facing projection. */
export interface DesignFrontend {
  _id: string;
  parameters: Parameter[];
  /** Null until a build has produced geometry. */
  geometry: GeometrySummary | null;
}

export interface DesignVariant {
  designId: string;
  mesh: GlbModel | null;
  status: "generating" | "preview" | "ready";
  error: string | null;
}

/*
  One feedback round. The initial generation round records the candidate
  ids and the picked design. Every refinement round duplicates the current
  design once, sends the feedback to that copy, and the copy becomes the
  next round's current design — a linear version history.
*/
export interface ForgeIteration {
  round: number;
  /** User feedback for this round; null for the initial generation. */
  feedback: string | null;
  /** Design this round duplicated (the previous current design). */
  sourceDesignId: string;
  /** Designs this round produced: the refinement copy, or the initial candidates. */
  variantIds: string[];
  /** Design carried forward out of this round. */
  pickedDesignId?: string;
}

/*
  The SSE stream's event vocabulary (forge parity): the stream only
  ALARMS that geometry changed — the client GETs the GLB itself — and
  parameter/usage frames carry their projections inline.
*/
export type StreamEvent =
  | { type: "running"; data: boolean }
  | { type: "geometry"; data: GeometrySummary }
  | { type: "parameters"; data: Parameter[] }
  | { type: "stop"; data: boolean }
  | { type: "usage"; data: { inputTokens?: number; outputTokens?: number; turns?: number } }
  | { type: "error"; data: string }
  | { type: "end"; data: string };

// Kept as a type alias so hooks do not need to import three at module scope.
export type THREE_Group = import("three").Group;

export type ForgePhase =
  | "idle"
  | "initializing"
  | "choosing"
  | "calibrating"
  | "finalizing"
  | "ready"
  | "error";
