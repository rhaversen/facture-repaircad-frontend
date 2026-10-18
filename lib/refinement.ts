import { loadImage } from "./intake";
import type { StepContext } from "./forge";
import type { Parameter } from "./types";

const formatParameters = (parameters: Parameter[]) =>
  parameters.map((p) => `- ${p.name}: ${p.value}${p.unit ? ` ${p.unit}` : ""} (${p.description})`).join("\n");

/*
  The AfterForge run's first turn: the setup stage records it as the round's
  state (the design it edits, the brief that design was generated from, the
  upstream fabrication intent, the model's current parameters, and Forge's
  own step context for the design as it stands, whose views ride along as
  the attached image). It is machine context, not a user request, and says so.
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
        ? ` The attached image shows its rendered views (${stepContext.images.map((i) => i.view).join(", ")}), each labelled.`
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

const SHEET_COLUMNS = 3;

/* The step context's views tiled into one labelled JPEG: Forge renders six,
   and a Flow message carries at most four images. */
export async function viewSheet(images: StepContext["images"]): Promise<File | null> {
  if (images.length === 0) return null;
  const tiles = await Promise.all(images.map((image) => loadImage(image.jpeg)));
  const size = Math.max(...tiles.map((tile) => Math.max(tile.naturalWidth, tile.naturalHeight)));
  const columns = Math.min(SHEET_COLUMNS, tiles.length);
  const canvas = document.createElement("canvas");
  canvas.width = columns * size;
  canvas.height = Math.ceil(tiles.length / columns) * size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not supported.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const fontSize = Math.max(16, size / 14);
  context.font = `600 ${fontSize}px Arial, sans-serif`;
  context.textBaseline = "top";
  tiles.forEach((tile, index) => {
    const x = (index % columns) * size;
    const y = Math.floor(index / columns) * size;
    context.drawImage(tile, x, y);
    context.strokeStyle = "#c9ced4";
    context.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    context.fillStyle = "#1d2228";
    context.fillText(images[index].view.toUpperCase(), x + fontSize / 2, y + fontSize / 2);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not create the view sheet.");
  return new File([blob], "forge-views.jpg", { type: "image/jpeg" });
}
