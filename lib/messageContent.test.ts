import { describe, expect, it } from "vitest";

import { describeMessageContent } from "@/lib/messageContent";
import type { FlowMessage } from "@/lib/types";

function part(overrides: { type: string } & Record<string, unknown>) {
  return overrides as unknown as FlowMessage["content"] extends unknown[]
    ? FlowMessage["content"][number]
    : never;
}

describe("describeMessageContent", () => {
  it("returns string content verbatim", () => {
    expect(describeMessageContent("Hello")).toBe("Hello");
  });

  it("joins text parts", () => {
    const content = [part({ type: "text", text: "a" }), part({ type: "text", text: "b" })];
    expect(describeMessageContent(content)).toBe("a\n\nb");
  });

  it("extracts the question from an ask_user tool-call part", () => {
    const content = [
      part({ type: "text", text: "internal reasoning" }),
      part({
        type: "tool-call",
        toolCallId: "call1",
        toolName: "ask_user",
        input: { question: "Can you attach a close-up of the crack?" },
      }),
    ];
    expect(describeMessageContent(content)).toBe(
      "Can you attach a close-up of the crack?",
    );
  });

  it("falls back to text parts when there is no ask_user call", () => {
    const content = [
      part({ type: "text", text: "thinking" }),
      part({
        type: "tool-call",
        toolCallId: "call1",
        toolName: "advance_step",
        input: { toNodeId: "abc" },
      }),
    ];
    expect(describeMessageContent(content)).toBe("thinking");
  });

  it("ignores null and primitive parts", () => {
    const content = [null, "str", 42, part({ type: "text", text: "ok" })] as never;
    expect(describeMessageContent(content)).toBe("ok");
  });

  it("returns empty for undefined content", () => {
    expect(describeMessageContent(undefined)).toBe("");
  });
});
