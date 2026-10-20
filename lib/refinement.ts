import type { StepContext } from "./forge";
import { describeMessageContent } from "./messageContent";
import type { FlowMessage, Parameter } from "./types";

// The first line of every machine-sent context message, so the chat can hide
// everything up to the latest one.
const SETUP_HEADING = "# Setup — initialization payload, not user text";
const UPDATE_HEADING = "# Model update — regenerated model, not user text";

const formatParameters = (parameters: Parameter[]) =>
  parameters.map((p) => `- ${p.name}: ${p.value}${p.unit ? ` ${p.unit}` : ""} (${p.description})`).join("\n");

/*
  The AfterForge run's first turn, sent once when a design is first opened:
  the setup stage records it as the refinement state the run keeps for good.
  Each section is headed by the state field it fills (the design it edits,
  the brief that design was generated from, the planning run's fabrication
  intent, and the model as Forge has it now: parameters and step context,
  with the step context's views riding along as the attached images). It is
  machine context, not a user request, and says so.
*/
export function bootstrapMessage({
  designId,
  handoff,
  handoffVariant,
  designIntent,
  parameters,
  stepContext,
}: {
  designId: string;
  handoff: string;
  handoffVariant: string;
  designIntent: string;
  parameters: Parameter[];
  stepContext: StepContext;
}): string {
  return [
    SETUP_HEADING,
    "",
    "This is a machine-sent bootstrap payload, not a user refinement request. Record each " +
      "section below into the state field it is headed by, and do not reply to it: no " +
      "acknowledgement, clarification question, Forge instruction, or fabrication/assembly " +
      "guidance in response.",
    "",
    "# design_id",
    "",
    designId,
    "",
    "# handoff_variant",
    "",
    handoffVariant,
    "",
    "# fabrication_design_intent",
    "",
    designIntent.trim() || "Not provided by the planning run.",
    "",
    "# selected_forge_handoff",
    "",
    handoff.trim(),
    "",
    ...modelSections(parameters, stepContext),
    "",
    "# Later refinement messages",
    "",
    "Subsequent user messages are refinement feedback, except machine-sent messages headed " +
      '"# Model update", which carry the regenerated model. Do not treat this bootstrap as ' +
      "user refinement and do not narrate the sections above when later user turns arrive.",
  ].join("\n");
}

/*
  Sent after every finished Forge turn: the model as Forge has it now, in the
  same sections the bootstrap used, for the waiting stage to replace its
  model context with.
*/
export function modelUpdateMessage({
  parameters,
  stepContext,
}: {
  parameters: Parameter[];
  stepContext: StepContext;
}): string {
  return [
    UPDATE_HEADING,
    "",
    "Forge has regenerated the design. This machine-sent message is not refinement feedback: " +
      "replace current_model_context (and current_model_visual_context, when given) with the " +
      "sections below, then ask the user to look at the model again.",
    "",
    ...modelSections(parameters, stepContext),
  ].join("\n");
}

function modelSections(parameters: Parameter[], stepContext: StepContext): string[] {
  const views = stepContext.images.map((i) => i.view);
  return [
    "# current_model_context",
    "",
    parameters.length > 0
      ? `Current parameters of the Forge model:\n${formatParameters(parameters)}`
      : "The Forge model has no adjustable parameters.",
    "",
    "What the Forge design agent sees for this design right now:",
    "",
    stepContext.text.trim(),
    ...(views.length > 0
      ? [
          "",
          "# current_model_visual_context",
          "",
          `The attached images are Forge's rendered views of the current model, in this order: ${views.join(", ")}.`,
        ]
      : []),
  ];
}

/* How many leading messages the chat hides: everything up to and including
   the latest context message, so each one reads as a fresh conversation
   while the assistant keeps the whole history. */
export function hiddenMessageCount(messages: FlowMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = describeMessageContent(message.content);
    if (text.startsWith(SETUP_HEADING) || text.startsWith(UPDATE_HEADING)) return i + 1;
  }
  return 0;
}

/** The user accepted the model: ask the run for the final guidance. */
export function guidanceRequest(parameters: Parameter[]): string {
  return [
    "I accept the current model. Calibration is complete and the final model has been rendered.",
    "Produce the final repair guidance document now.",
    parameters.length > 0
      ? `Final parameter values:\n${formatParameters(parameters)}`
      : "The model has no adjustable parameters.",
  ].join("\n");
}

/* The step context's views as uploadable JPEGs, in the order the bootstrap
   names them. */
export async function viewFiles(images: StepContext["images"]): Promise<File[]> {
  return Promise.all(
    images.map(async ({ view, jpeg }) => {
      const blob = await (await fetch(jpeg)).blob();
      return new File([blob], `forge-${view}.jpg`, { type: blob.type || "image/jpeg" });
    }),
  );
}
