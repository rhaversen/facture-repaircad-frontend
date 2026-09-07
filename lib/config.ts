export const BUILD_LABEL = "v2.0 -- Next.js port";

const isDev = process.env.NODE_ENV === "development";

export const REPAIRCAD_MODEL = isDev ? "natai/glm" : "google/gemini-3.8-flash";

export const FORGE_MODEL = isDev ? "natai/glm" : "moonshotai/kimi-k3";

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
