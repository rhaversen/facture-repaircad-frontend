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
    conversation to follow: the last assistant question is shown as a
    focused card next to the response form instead of the full transcript.
  - Otherwise the whole conversation fills the rest of the viewport.

  The corner New run button and the timeline (with its forced clarification
  sub-point under step 4) come from the shared page scaffold — same chrome
  as every other screen.
*/
export default function ChatScreen({
  runId,
  messages,
  waitingForCaseClarification,
  clarificationSubmitting,
  clarificationError,
  onNewRun,
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
  onNewRun: () => void;
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
      flush
      currentStep={4}
      onNewRun={onNewRun}
      onStepClick={onStepClick}
      clickStates={clickStates}
      reasons={reasons}
      clarificationActive={waitingForCaseClarification}
    >
      {waitingForCaseClarification ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-y-auto overscroll-contain px-6 pb-4 max-[640px]:px-4">
          <div className="max-h-full w-full max-w-[860px]">
            <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)] max-[640px]:p-4">
              <div className="mb-4 text-lg font-bold">Repair clarification</div>

              <ClarificationForm
                question={lastQuestion}
                onSubmit={onClarificationSubmit}
                submitting={clarificationSubmitting}
                error={clarificationError ?? ""}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-[1240px] flex-1 px-6 pb-4 max-[640px]:px-4">
          <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-line bg-white">
            <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <span className="inline-block h-1 w-1 rounded-full bg-brand"></span>
              <span className="text-xs font-medium text-muted-2">Repair planning</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <FlowChatFrame runId={runId} title="Repair planning" />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
