import type { FlowMessage, MessageContentPart } from "@/lib/types";

/*
  Turn a Flow message's content (plain string or content-parts array) into the
  text to display: string content as-is, arrays joined from their text parts
  (image parts carry no text and are skipped — the clarification card only
  shows the question's wording). On a user_input node the agent's only
  user-visible output is an ask_user tool call whose question lives in
  part.input.question (the flow frontend renders bubbles the same way), so
  tool-call parts resolve to that question while plain text — the agent's
  internal reasoning — stays hidden.
*/
export function describeMessageContent(
  content: FlowMessage["content"] | undefined,
): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = content.filter(
    (part): part is MessageContentPart => part !== null && typeof part === "object",
  );

  const questions = parts
    .filter((part) => part.type === "tool-call" && part.toolName === "ask_user")
    .map((part) => part.input)
    .filter(
      (input): input is { question: string } =>
        typeof input === "object" &&
        input !== null &&
        typeof (input as { question?: unknown }).question === "string",
    )
    .map((input) => input.question);
  if (questions.length > 0) return questions.join("\n\n").trim();

  return parts
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
