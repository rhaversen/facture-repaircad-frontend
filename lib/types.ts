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

/*
  One feedback round. Each round duplicates the carried-forward design into
  three copies, sends the user's feedback only to those copies, and the copy
  the user picks is carried forward into the next round. The variants a round
  produced stay referenced so the timeline can list every iteration.
*/
export interface ForgeIteration {
  round: number;
  /** User feedback for this round; null for the initial generation. */
  feedback: string | null;
  /** Carried-forward design this round duplicated. */
  sourceDesignId: string;
  /** Designs this round produced (the 3 copies). */
  variantIds: string[];
  /** Design picked out of this round — carried to the next round. */
  pickedDesignId?: string;
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
