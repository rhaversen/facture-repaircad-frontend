import type { StepContext } from "./forge";
import type { Parameter } from "./types";

const formatParameters = (parameters: Parameter[]) =>
  parameters.map((p) => `- ${p.name}: ${p.value}${p.unit ? ` ${p.unit}` : ""} (${p.description})`).join("\n");

/*
  The AfterForge run's first turn: the setup stage records it as the round's
  state (the design it edits, the brief that design was generated from, the
  upstream fabrication intent, the model's current parameters, and Forge's
  own step context for the design as it stands, whose views ride along as
  the attached images). It is machine context, not a user request, and says so.
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
    "# Setup — initialization payload, not user text",
    "",
    "This is a machine-sent bootstrap payload, not a user refinement request. Record it into " +
      "your persistent state and do not reply to it: no acknowledgement, clarification question, " +
      "Forge instruction, or fabrication/assembly guidance in response.",
    "",
    `CURRENT FORGE DESIGN ID: ${designId}`,
    `HANDOFF VARIANT: ${handoffVariant}`,
    ...(designIntent.trim() ? ["", "# Fabrication design intent", "", designIntent.trim()] : []),
    "",
    "# Selected Forge handoff",
    "",
    handoff.trim(),
    "",
    "# Current model context",
    "",
    parameters.length > 0
      ? `Current parameters of the Forge model:\n${formatParameters(parameters)}`
      : "The Forge model has no adjustable parameters.",
    "",
    "# Forge step context",
    "",
    "What the Forge design agent sees for this design right now, built fresh for this message." +
      (stepContext.images.length > 0
        ? ` The attached images are its rendered views, in this order: ${stepContext.images.map((i) => i.view).join(", ")}.`
        : ""),
    "",
    stepContext.text.trim(),
    "",
    "# Later refinement messages",
    "",
    "Subsequent user messages are refinement feedback. Do not treat this bootstrap as user " +
      "refinement and do not narrate the sections above when later user turns arrive.",
  ].join("\n");
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
