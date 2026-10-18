"use client";

import { useEffect, useState } from "react";

import Page from "@/components/Page";
import DesignStage from "@/features/design/DesignStage";
import Intake from "@/features/intake/Intake";
import Planning from "@/features/planning/Planning";
import RunList from "@/features/runs/RunList";
import { useFlowRun } from "@/hooks/useFlowRun";
import { authUrl, getMe, logout } from "@/lib/auth";
import { createRun, resolvePipelines, sendMessage, stageOf, type Pipelines } from "@/lib/flow";
import { forgetRun, loadActiveRun, storeActiveRun } from "@/lib/store";

/*
  The app is one open repair run (or none), and everything shown is derived
  from that run's server state: intake until it has a user turn, planning
  until the pipeline hands off, then the designs. The open run id is the only
  navigation state kept across a refresh.

  "new" is the intake for a run that does not exist yet: the run is created
  on submit, so abandoned drafts never leave empty runs behind.
*/
export default function RepairCADApp() {
  const [ready, setReady] = useState(false);
  const [pipelines, setPipelines] = useState<Pipelines | null>(null);
  const [failed, setFailed] = useState("");
  const [open, setOpen] = useState<string | "new" | null>(null);

  useEffect(() => {
    (async () => {
      // The shared Facture session cookie is the only sign-in.
      if ((await getMe()) === null) {
        window.location.assign(authUrl());
        return;
      }
      setPipelines(await resolvePipelines());
      setOpen(loadActiveRun());
      setReady(true);
    })().catch((err) => {
      console.error("Startup failed:", err);
      setFailed("RepairCAD could not reach the Facture services. Please reload the page.");
    });
  }, []);

  function openRun(runId: string | "new" | null) {
    storeActiveRun(runId === "new" ? null : runId);
    setOpen(runId);
  }

  if (failed) {
    return (
      <Page>
        <p className="error-box">{failed}</p>
      </Page>
    );
  }
  if (!ready || pipelines === null) return null;

  if (open === null) {
    return (
      <RunList
        onOpen={openRun}
        onNew={() => openRun("new")}
        onLogout={async () => {
          await logout();
          window.location.assign(authUrl());
        }}
      />
    );
  }

  if (open === "new") {
    return (
      <Intake
        onAllRuns={() => openRun(null)}
        onSubmit={async (message, files) => {
          const run = await createRun(pipelines.main);
          await sendMessage(run._id, message, files);
          openRun(run._id);
        }}
      />
    );
  }

  return <OpenRun key={open} runId={open} pipelines={pipelines} onAllRuns={() => openRun(null)} />;
}

function OpenRun({
  runId,
  pipelines,
  onAllRuns,
}: {
  runId: string;
  pipelines: Pipelines;
  onAllRuns: () => void;
}) {
  const { run, missing, hasUserTurn, error, refresh } = useFlowRun(runId);

  // A remembered run that was deleted meanwhile: forget it, back to the list.
  useEffect(() => {
    if (!missing) return;
    forgetRun(runId);
    onAllRuns();
  }, [missing, runId, onAllRuns]);

  if (run === null) {
    return (
      <Page onAllRuns={onAllRuns}>
        <p className={error ? "error-box" : "text-faint"}>{error || "Loading your repair…"}</p>
      </Page>
    );
  }

  const turn = async (message: string, files: File[]) => {
    await sendMessage(runId, message, files);
    await refresh();
  };

  const stage = stageOf(run, hasUserTurn, pipelines.clarificationNode);
  if (stage === "intake") return <Intake onSubmit={turn} onAllRuns={onAllRuns} />;
  if (stage === "designs") return <DesignStage run={run} onAllRuns={onAllRuns} />;
  return (
    <Planning
      runId={runId}
      clarification={stage === "clarification"}
      onSubmit={turn}
      onAllRuns={onAllRuns}
    />
  );
}
