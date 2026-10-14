import Page from "@/components/Page";
import ClarificationForm from "@/features/chat/ClarificationForm";
import { FlowChatFrame } from "@/features/chat/FlowChatEmbed";
import { describeMessageContent } from "@/lib/messageContent";
import type { StepClickStates, StepReasons } from "@/lib/runProgress";
import type {
  AnnotatedCopy,
  Annotation,
  FlowMessage,
  Photo,
} from "@/lib/types";

/*
  The "Repair Planning" page — one page, two states, both locked to the
  viewport height (no page scrollbar):

  - While the pipeline sends the case back for clarification there is no
    conversation to follow: the last assistant question and the response
    form flow as plain page content (same shells as the intake screens).
  - Otherwise the whole conversation fills the rest of the viewport.

  The corner All runs button and the timeline (with its forced clarification
  sub-point under step 4) come from the shared page scaffold — same chrome
  as every other screen.
*/
export default function ChatScreen({
  runId,
  messages,
  waitingForCaseClarification,
  clarificationSubmitting,
  clarificationError,
  onAllRuns,
  onStepClick,
  clickStates,
  reasons,
  onClarificationSubmit,
}: {
  runId: string | null;
  messages: FlowMessage[];
  waitingForCaseClarification: boolean;
  clarificationSubmitting: boolean;
  clarificationError: string | null;
  onAllRuns: () => void;
  onStepClick?: (step: number) => void;
  clickStates?: StepClickStates;
  reasons?: StepReasons;
  onClarificationSubmit: (clarification: {
    content: string;
    photos: Photo[];
    annotations: Annotation[];
    annotatedCopies: Record<string, AnnotatedCopy>;
  }) => Promise<void>;
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastQuestion = describeMessageContent(lastAssistant?.content);

  return (
    <Page
      currentStep={4}
      bleed={!waitingForCaseClarification}
      onAllRuns={onAllRuns}
      onStepClick={onStepClick}
      clickStates={clickStates}
      reasons={reasons}
      clarificationActive={waitingForCaseClarification}
    >
      {waitingForCaseClarification ? (
        <ClarificationForm
          question={lastQuestion}
          onSubmit={onClarificationSubmit}
          submitting={clarificationSubmitting}
          error={clarificationError ?? ""}
        />
      ) : (
        <FlowChatFrame runId={runId} title="Repair planning" />
      )}
    </Page>
  );
}
