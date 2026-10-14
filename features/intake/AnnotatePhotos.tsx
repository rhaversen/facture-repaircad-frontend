import Page from "@/components/Page";
import PhotoAnnotation from "@/features/intake/PhotoAnnotation";
import type { StepClickStates, StepReasons } from "@/lib/runProgress";
import type { IntakeController } from "@/hooks/useIntake";

/*
  The Annotate photos screen (intake step 2). The intake state itself lives
  in the app orchestrator; this screen only renders the shared
  PhotoAnnotation surface plus the nav footer and the size-reference
  requirement note.
*/
export default function AnnotatePhotos({
  intake,
  onBack,
  onContinue,
  onNewRun,
  onStepClick,
  clickStates,
  reasons,
}: {
  intake: IntakeController;
  onBack: () => void;
  onContinue: () => void;
  onNewRun: () => void;
  onStepClick?: (step: number) => void;
  clickStates?: StepClickStates;
  reasons?: StepReasons;
}) {
  return (
    <Page
      wide
      currentStep={2}
      onNewRun={onNewRun}
      onStepClick={onStepClick}
      clickStates={clickStates}
      reasons={reasons}
      title="Annotate your photos"
      subtitle={
        <>
          Mark important parts of the photo and briefly describe what they show
          or why they matter for the repair.
        </>
      }
    >
      <PhotoAnnotation intake={intake} withSizeReference />

      {intake.photos.length > 0 && !intake.hasMeasurementReference && (
        <p className="mt-6 -mb-3 text-right text-sm text-[#a05a00]">
          Mark at least one annotation as a size reference (with its known
          dimension) to continue.
        </p>
      )}

      <div className="mt-9 flex justify-between gap-4 max-[640px]:flex-col-reverse max-[640px]:[&>button]:w-full">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>

        <button
          type="button"
          disabled={!intake.hasMeasurementReference}
          onClick={onContinue}
        >
          Review →
        </button>
      </div>
    </Page>
  );
}
