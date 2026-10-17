"use client";

import { useEffect, useState } from "react";

import Page from "@/components/Page";
import ClarificationForm from "./ClarificationForm";
import FlowChat from "./FlowChat";
import { fetchMessages } from "@/lib/flow";
import { describeMessageContent } from "@/lib/messageContent";

/*
  Step 4: the pipeline works the case in the embedded conversation, except
  when it parks on the case clarification, which gets its own photo form.
*/
export default function Planning({
  runId,
  clarification,
  onSubmit,
  onAllRuns,
}: {
  runId: string;
  clarification: boolean;
  onSubmit: (message: string, files: File[]) => Promise<void>;
  onAllRuns: () => void;
}) {
  return (
    <Page progress={{ step: 4, clarification }} onAllRuns={onAllRuns} bleed={!clarification}>
      {clarification ? (
        <Clarification runId={runId} onSubmit={onSubmit} />
      ) : (
        <FlowChat runId={runId} title="Repair planning" />
      )}
    </Page>
  );
}

function Clarification({
  runId,
  onSubmit,
}: {
  runId: string;
  onSubmit: (message: string, files: File[]) => Promise<void>;
}) {
  const [question, setQuestion] = useState<string | null>(null);

  // The question is the pipeline's latest assistant turn.
  useEffect(() => {
    let cancelled = false;
    fetchMessages(runId)
      .then((messages) => {
        const last = messages.findLast((m) => m.role === "assistant");
        if (!cancelled) setQuestion(describeMessageContent(last?.content));
      })
      .catch(() => !cancelled && setQuestion(""));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (question === null) return <p className="text-faint">Loading the question…</p>;
  return <ClarificationForm question={question} onSubmit={onSubmit} />;
}
