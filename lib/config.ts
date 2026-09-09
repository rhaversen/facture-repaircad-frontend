export const BUILD_LABEL = "v2.0 -- Next.js port";

const isDev = process.env.NODE_ENV === "development";

/*
  Chat models, one per backend per environment, selected in this single table.
  The flow model must be vision-capable (the intake uploads photos as
  multimodal file parts) AND tool-capable (the pipeline agent is tool-driven).
  The CAVI gateway is probed empirically: natai/glm is text-only and most
  other natai models describe images wrongly — natai/glm-flash reads a test
  image correctly and emits native tool_calls, so it serves both backends in
  dev. Production routes through OpenRouter instead.
*/
const CHAT_MODELS = isDev
  ? { flow: "natai/glm-flash", forge: "natai/glm-flash" }
  : { flow: "google/gemini-3.8-flash", forge: "google/gemini-3.8-flash" };

export const FLOW_MODEL = CHAT_MODELS.flow;
export const FORGE_MODEL = CHAT_MODELS.forge;

// Reasoning effort pinned on Forge chat requests. kimi-k3 advertises
// max/high/low — medium would be silently dropped by Forge's effort validator.
export const FORGE_REASONING_EFFORT = "low";

// Calibration sweep tuning. SWEEP_RENDER_STEPS renders are fired in parallel
// per parameter; the viewport plays them as a ping-pong loop at SWEEP_FPS.
export const SWEEP_RENDER_STEPS = 15;
export const SWEEP_FPS = 24;

// Parallel independent Forge designs per candidate round.
export const DESIGN_VARIANTS = 3;
