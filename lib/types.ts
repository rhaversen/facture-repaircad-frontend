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
  provisional_cad_handoff?: string;
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

export interface ForgeParameter {
  name: string;
  value: number;
  min: number | null;
  max: number | null;
  step: number | null;
  modified: boolean;
  description?: string;
}

export interface ForgeOverview {
  leaves: unknown[];
  assemblies: unknown[];
  parameters: ForgeParameter[];
}

export interface ForgeDesign {
  conversation?: unknown;
  overview?: ForgeOverview;
  usage?: unknown;
}

export interface DesignVariant {
  designId: string;
  mesh: THREE_Group | null;
  status: "generating" | "preview" | "ready";
  error: string | null;
}

// Kept as a type alias so hooks do not need to import three at module scope.
export type THREE_Group = import("three").Group;

export interface ParamSweep {
  values: number[];
  frames: (THREE_Group | null)[];
}

export type ForgePhase =
  | "idle"
  | "initializing"
  | "choosing"
  | "calibrating"
  | "finalizing"
  | "ready"
  | "error";
