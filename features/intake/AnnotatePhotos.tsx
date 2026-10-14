import Page from "@/components/Page";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import type { StepClickStates, StepReasons } from "@/lib/runProgress";
import type { IntakeController } from "@/hooks/useIntake";

/*
  The Annotate photos screen (intake step 2). The intake state itself lives
  in the app orchestrator; this screen only renders the shared
  PhotoAnnotation surface plus the nav footer. Size references are an
  optional detail, not a gate.
*/
export default function AnnotatePhotos({
  intake,
  onBack,
  onContinue,
  onAllRuns,
  onStepClick,
  clickStates,
  reasons,
}: {
  intake: IntakeController;
  onBack: () => void;
  onContinue: () => void;
  onAllRuns: () => void;
  onStepClick?: (step: number) => void;
  clickStates?: StepClickStates;
  reasons?: StepReasons;
}) {
  return (
    <Page
      currentStep={2}
      onAllRuns={onAllRuns}
      onStepClick={onStepClick}
      clickStates={clickStates}
      reasons={reasons}
    >
      <h1 className="mb-3">Annotate your photos</h1>
      <p className="mb-9 text-[17px] leading-relaxed text-muted">
        Mark important parts of the photo and briefly describe what they show
        or why they matter for the repair.
      </p>

      <PhotoAnnotation intake={intake} withSizeReference />

      <div className="mt-9 flex justify-between gap-4 max-[640px]:flex-col-reverse max-[640px]:[&>button]:w-full">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>

        <button type="button" onClick={onContinue}>
          Review →
        </button>
      </div>
    </Page>
  );
}
