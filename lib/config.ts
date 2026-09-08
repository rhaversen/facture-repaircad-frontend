export const BUILD_LABEL = "v2.0 -- Next.js port";

const isDev = process.env.NODE_ENV === "development";

// Dev points at the CAVI gateway; the model must be vision-capable (the
// intake uploads photos as multimodal file parts) AND tool-capable (the
// pipeline agent is tool-driven). natai/glm is text-only; most other natai
// models describe images wrongly — probed: natai/glm-flash reads a red test
// image correctly and emits native tool_calls. Production uses OpenRouter.
export const REPAIRCAD_MODEL = isDev ? "natai/glm-flash" : "google/gemini-3.8-flash";

// Dev points at the CAVI gateway; production uses OpenRouter's kimi-k3 via
// the deployed Forge service.
export const FORGE_MODEL = isDev ? "natai/glm-flash" : "moonshotai/kimi-k3";

// Reasoning effort pinned on Forge chat requests. kimi-k3 advertises
// max/high/low — medium would be silently dropped by Forge's effort validator.
export const FORGE_REASONING_EFFORT = "low";

// Calibration sweep tuning. SWEEP_RENDER_STEPS renders are fired in parallel
// per parameter; the viewport plays them as a ping-pong loop at SWEEP_FPS.
export const SWEEP_RENDER_STEPS = 15;
export const SWEEP_FPS = 24;

// Parallel independent Forge designs per candidate round.
export const DESIGN_VARIANTS = 3;

export const FLOW_MODEL = process.env.NEXT_PUBLIC_FLOW_MODEL || REPAIRCAD_MODEL;
