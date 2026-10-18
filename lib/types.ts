export interface FlowRun {
  _id: string;
  pipelineId: string;
  status: "running" | "idle" | "failed" | string;
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
  role: "user" | "assistant" | string;
  content: string | MessageContentPart[];
}

export type Unit = "mm" | "cm" | "in";

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
}

export interface Annotation {
  id: string;
  photoId: string;
  label: string;
  color: string;
  box: NormalizedBox;
  sizeReference: { knownDimension: number; unit: Unit } | null;
}

/* One calibration handle on a Forge design. min/max are always concrete. */
export interface Parameter {
  name: string;
  description: string;
  kind: "length" | "angle" | "scalar" | "integer";
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

/* Dimension guides per parameter, in millimeters in the design's Z-up world. */
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

export interface GeometrySummary {
  revision: string;
  guides?: Guide[];
  ok: boolean;
  errors: number;
}

/** GET /designs/:id */
export interface Design {
  _id: string;
  parameters: Parameter[];
  /** Null until a build has produced geometry. */
  geometry: GeometrySummary | null;
}
