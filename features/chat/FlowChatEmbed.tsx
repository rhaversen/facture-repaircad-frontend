"use client";

import { useState } from "react";

import { AUTH_BASE, FLOW_EMBED_BASE } from "@/lib/env";
import { FLOW_MODEL } from "@/lib/config";
import { saveAccessToken } from "@/lib/tokenStorage";

/*
  Reusable Flow conversation frame — a bare iframe for embedding inside other
  screens (the CAD refinement workspace). The iframe owns streaming, markdown
  and photos; this app only supplies the URL parameters, including the user's
  Facture access token (the embed's only auth).
*/
export function FlowChatFrame({
  runId,
  accessToken,
  title = "RepairCAD conversation",
  disabled = false,
  disabledMessage,
}: {
  runId: string;
  accessToken: string;
  title?: string;
  disabled?: boolean;
  disabledMessage?: string;
}) {
  if (!runId || !accessToken) {
    return null;
  }

  const params = new URLSearchParams({
    run: runId,
    model: FLOW_MODEL,
    token: accessToken,
    showTitle: "0",
    showIntro: "0",
    hideMessages: "2",
    disableChat: disabled ? "1" : "0",
  });
  if (disabledMessage) {
    params.set("disabledMessage", disabledMessage);
  }

  return (
    <iframe
      title={title}
      src={`${FLOW_EMBED_BASE}?${params.toString()}`}
      className="h-full min-h-[420px] w-full rounded-xl border border-line bg-black"
      allow="clipboard-write"
    />
  );
}

export default function FlowChatEmbed({
  runId,
  accessToken,
  onChangeToken,
  onLogout,
  onNewRun,
  onViewRuns,
  onOpenCad,
  cadReady = false,
}: {
  runId: string | null;
  accessToken: string;
  onChangeToken: () => void;
  onLogout: () => void;
  onNewRun: () => void;
  onViewRuns: () => void;
  onOpenCad: () => void;
  cadReady?: boolean;
}) {
  const params = new URLSearchParams({
    run: runId ?? "",
    model: FLOW_MODEL,
    token: accessToken,
    showTitle: "0",
    showIntro: "0",
    hideMessages: "2",
  });

  /*
    Fills whatever container mounts it; the host decides the height (viewport
    app layout on desktop, fixed share of the viewport on small screens) so
    the page itself never scrolls while the conversation is up.
  */
  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-6">
      <main className="relative mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col gap-4 rounded-2xl border border-line bg-white px-6 pb-6 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="text-lg font-bold">RepairCAD</div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-utility"
              onClick={onOpenCad}
              disabled={!cadReady}
              title={
                cadReady
                  ? "Open the CAD & refinement workspace"
                  : "Available once RepairCAD has produced a CAD handoff"
              }
            >
              CAD workspace →
            </button>
            <button type="button" className="btn-utility" onClick={onNewRun}>
              New run
            </button>
            <button type="button" className="btn-utility" onClick={onViewRuns}>
              All runs
            </button>
            <button type="button" className="btn-utility" onClick={onChangeToken}>
              Change token
            </button>
            <button type="button" className="btn-ghost" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </div>

        <iframe
          title="RepairCAD conversation"
          src={`${FLOW_EMBED_BASE}?${params.toString()}`}
          className="min-h-0 w-full flex-1 rounded-xl border border-line bg-black"
          allow="clipboard-write"
        />
      </main>
    </div>
  );
}

/*
  Access-token screen: RepairCAD is a third-party flow client, so it cannot
  rely on the flow session cookie. The user pastes a personal access token
  from the auth dashboard; it is kept in localStorage so reloads skip this
  screen (clear via "Change token" or Sign out).
*/
export function AccessTokenGate({
  onSaved,
  onLogout,
}: {
  onSaved: (token: string) => void;
  onLogout: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!token) {
      setError("Paste an access token to continue.");
      return;
    }
    saveAccessToken(token);
    onSaved(token);
  }

  return (
    <div className="min-h-screen px-5 py-12 max-[640px]:px-3">
      <main className="relative mx-auto w-full max-w-[760px] rounded-2xl border border-line bg-white px-12 pb-12 pt-24 max-[640px]:px-5 max-[640px]:pb-7">
        <div className="mb-12 text-lg font-bold">RepairCAD</div>

        <h1>Connect to Flow</h1>

        <p className="mt-0 mb-9 text-[17px] leading-relaxed text-muted">
          Paste a Facture access token to use the repair assistant. Create one
          in the auth dashboard under API tokens.
        </p>

        <p className="-mt-6 text-[15px] text-muted">
          Open the{" "}
          <a href={AUTH_BASE} target="_blank" rel="noreferrer" className="font-semibold text-brand">
            Facture auth page
          </a>{" "}
          to sign in and create a token.
        </p>

        <form onSubmit={handleSave}>
          <label htmlFor="flowToken">Access token</label>

          <input
            id="flowToken"
            className="text-input"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="fat_…"
            autoFocus
            required
          />

          {error && (
            <p className="mt-4 rounded-lg bg-[#fff0f0] px-3.5 py-3 text-sm text-[#a22c2c]">
              {error}
            </p>
          )}

          <div className="mt-8 flex justify-end">
            <button type="submit" disabled={!value.trim()}>
              Continue
            </button>
          </div>
        </form>

        <button
          type="button"
          className="mt-4 bg-transparent px-2.5 py-1.5 text-[13px] text-muted hover:bg-[#f1f2f4]"
          onClick={onLogout}
        >
          Sign out
        </button>
      </main>
    </div>
  );
}
