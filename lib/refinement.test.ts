import { describe, expect, it } from "vitest";

import { bootstrapMessage, hiddenMessageCount, modelUpdateMessage } from "@/lib/refinement";
import type { FlowMessage } from "@/lib/types";

const stepContext = { text: "Build OK", revision: "r1", images: [{ view: "front", jpeg: "" }] };
const bootstrap = bootstrapMessage({
  designId: "d1",
  handoff: "Brief",
  handoffVariant: "forge_handoff_1",
  designIntent: "PLA print",
  parameters: [],
  stepContext,
});
const update = modelUpdateMessage({ parameters: [], stepContext });

describe("refinement messages", () => {
  it("heads the model sections by their state fields in both messages", () => {
    for (const message of [bootstrap, update]) {
      expect(message).toContain("# current_model_context\n");
      expect(message).toContain("# current_model_visual_context\n");
    }
    expect(bootstrap).toContain("# fabrication_design_intent\n\nPLA print");
    expect(update.startsWith("# Model update")).toBe(true);
  });

  it("hides everything up to the latest context message", () => {
    const messages: FlowMessage[] = [
      { role: "assistant", content: "Processing starting..." },
      { role: "user", content: [{ type: "text", text: bootstrap }, { type: "file" }] },
      { role: "assistant", content: "Take a look at the model." },
      { role: "user", content: "Make it wider" },
      { role: "assistant", content: "Take a look at the model." },
    ];
    expect(hiddenMessageCount(messages)).toBe(2);
    messages.push({ role: "user", content: update }, { role: "assistant", content: "Take a look." });
    expect(hiddenMessageCount(messages)).toBe(6);
  });

  it("hides nothing before the bootstrap is in", () => {
    expect(hiddenMessageCount([{ role: "assistant", content: "Processing starting..." }])).toBe(0);
  });
});
