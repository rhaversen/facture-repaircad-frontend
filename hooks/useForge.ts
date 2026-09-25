"use client";

import { useCallback, useRef, useState } from "react";

import {
  SWEEP_RENDER_STEPS,
} from "@/lib/config";
import { deriveLowHigh, midpoint, isCalibratable } from "@/lib/forgeParams";
import {
  createDesign,
  duplicateDesign,
  stopDesign,
  sendDesignMessage,
  subscribeDesignStream,
  renderDesignWithParams,
  patchParameters,
  getDesign,
  getDesignMesh,
  parseMeshBase64,
} from "@/lib/forgeClient";
import { recoverDesignIdForRun } from "@/lib/recoverDesign";
import type {
  ForgeParameter,
  ForgePhase,
  ParamSweep,
  THREE_Group,
} from "@/lib/types";

/*
  Run → design persistence. A finished (or in-progress) calibration can be
  rehydrated from the persisted Forge design — GET /designs/:id/mesh re-renders
  the stored model, and parameter state lives server-side in paramValues —
  so a page refresh or run re-entry never pays for a new LLM generation.
  A "choosing" entry instead stores the parallel initial variant ids, so a
  refresh while the picker is open re-renders them (no LLM call) and reopens
  the picker. Entries survive navigation and refresh in the same browser;
  anything that fails to rehydrate (deleted design, other user's token) is
  dropped and the flow falls back to full generation.
*/
const DESIGN_STORE_KEY = "repaircad.forgeDesigns";

interface StoredDesignState {
  designId?: string;
  phase: string;
  variantDesignIds?: string[];
  /** Handoff document that produced the picked design. */
  selectedHandoff?: string;
}

function readDesignStore(): Record<string, StoredDesignState> {
  try {
    const raw = window.localStorage.getItem(DESIGN_STORE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDesignStore(store: Record<string, StoredDesignState>) {
  try {
    window.localStorage.setItem(DESIGN_STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota/private-mode failures only cost rehydration, never correctness.
  }
}

export function loadStoredDesignState(runId: string | null): StoredDesignState | null {
  if (!runId) return null;
  const entry = readDesignStore()[runId];
  if (entry === undefined || typeof entry.phase !== "string") {
    return null;
  }
  if (entry.phase === "choosing") {
    if (
      !Array.isArray(entry.variantDesignIds) ||
      entry.variantDesignIds.length === 0 ||
      !entry.variantDesignIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    return entry;
  }
  if (typeof entry.designId !== "string") {
    return null;
  }
  if (
    entry.selectedHandoff !== undefined &&
    typeof entry.selectedHandoff !== "string"
  ) {
    return null;
  }
  // A picked design can carry the ids of the variants it was chosen from, so
  // the picker can be reopened later instead of resuming calibration.
  if (
    entry.variantDesignIds !== undefined &&
    (!Array.isArray(entry.variantDesignIds) ||
      !entry.variantDesignIds.every((id) => typeof id === "string"))
  ) {
    return null;
  }
  return entry;
}

function storeDesignState(runId: string | null, entry: StoredDesignState) {
  if (!runId) return;
  const store = readDesignStore();
  // Once a run has variant ids they persist across later entries so leaving
  // and returning can always reopen the picker. Same for the selected
  // handoff: later phase writes must not drop it.
  if (entry.variantDesignIds === undefined && store[runId]?.variantDesignIds) {
    entry = { ...entry, variantDesignIds: store[runId].variantDesignIds };
  }
  if (entry.selectedHandoff === undefined && store[runId]?.selectedHandoff) {
    entry = { ...entry, selectedHandoff: store[runId].selectedHandoff };
  }
  store[runId] = entry;
  writeDesignStore(store);
}

export function clearStoredDesignState(runId: string | null) {
  if (!runId) return;
  const store = readDesignStore();
  delete store[runId];
  writeDesignStore(store);
}

/*
  Shared Forge state machine used by the CAD screen:

    idle → initializing → choosing → (pick) → calibrating → finalizing → ready

  generate() fires one independent design per supplied handoff document in
  parallel and parks
  in "choosing" until the user picks one (or a chat-driven feedback round
  replaces the candidates). The picked design continues into a calibration
  wizard that renders a sweep of preview frames per parameter. Chat-driven
  refineExistingDesign() / duplicateAndRefine() reuse the same machine on an
  existing design. All operations share a single busy lock, an AbortController
  tree, and localStorage persistence keyed by run id.
*/
export function useForge() {
  const [phase, setPhase] = useState<ForgePhase>("idle");
  const [mesh, setMesh] = useState<THREE_Group | null>(null);
  const [error, setError] = useState("");
  const [parameters, setParameters] = useState<ForgeParameter[]>([]);
  const [paramSweeps, setParamSweeps] = useState<Record<string, ParamSweep>>({});
  const [confirmedValues, setConfirmedValues] = useState<
    Record<string, number>
  >({});
  const [statusMessage, setStatusMessage] = useState("");
  const [designId, setDesignId] = useState<string | null>(null);
  // The handoff document that produced the picked design — refinement
  // receives this exact handoff, not a generic one.
  const [selectedHandoff, setSelectedHandoff] = useState<string | null>(null);
  const [variants, setVariants] = useState<
    { designId: string; mesh: THREE_Group | null; status: "generating" | "preview" | "ready"; error: string | null }[]
  >([]);
  const [busy, setBusy] = useState(false);

  // Mirror of confirmedValues for async code that must not re-run on every
  // confirmation (finishCalibration batches the final patch).
  const confirmedValuesRef = useRef<Record<string, number>>({});
  const setConfirmedValuesTracked = useCallback(
    (
      updater:
        | Record<string, number>
        | ((prev: Record<string, number>) => Record<string, number>),
    ) => {
      setConfirmedValues((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : updater;
        confirmedValuesRef.current = next;
        return next;
      });
    },
    [],
  );

  const patchVariant = useCallback(
    (variantId: string, patch: Partial<{ mesh: THREE_Group | null; status: "generating" | "preview" | "ready"; error: string | null }>) => {
      setVariants((prev) =>
        prev.map((v) => (v.designId === variantId ? { ...v, ...patch } : v)),
      );
    },
    [],
  );
  const removeVariant = useCallback((variantId: string) => {
    setVariants((prev) => prev.filter((v) => v.designId !== variantId));
  }, []);

  // Rejects the generate() picker park when every variant fails before a pick.
  const allFailedRejectRef = useRef<((reason: Error) => void) | null>(null);

  /*
    Single in-flight lock for every Forge operation. They all mutate the same
    shared state and park the same resolvers, so two overlapping operations
    would corrupt the flow. Entry points bail instead of racing when the lock
    is held.
  */
  const busyOwnerRef = useRef<object | null>(null);
  const acquireBusy = useCallback((owner: object) => {
    if (busyOwnerRef.current !== null) return false;
    busyOwnerRef.current = owner;
    setBusy(true);
    return true;
  }, []);
  const releaseBusy = useCallback((owner: object) => {
    if (busyOwnerRef.current !== owner) return;
    busyOwnerRef.current = null;
    setBusy(false);
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const chooseResolverRef = useRef<((id: string | null) => void) | null>(null);
  // Source design of the current "choosing" round (feedback rounds chain).
  const chooseResolverSourceRef = useRef<string | null>(null);

  /*
    Design ids of every variant still alive in the current picker round. The
    abort signal only kills local SSE readers — Forge keeps generating
    server-side — so a round being replaced must POST /stop for these ids
    before they are overwritten, or those turns burn tokens forever.
  */
  const activeVariantIdsRef = useRef<Set<string>>(new Set());

  const stopActiveVariants = useCallback(() => {
    const ids = [...activeVariantIdsRef.current];
    activeVariantIdsRef.current = new Set();
    ids.forEach((variantId) => {
      stopDesign(variantId).catch((err) => {
        console.warn(`[Forge] stop failed for variant ${variantId}:`, err);
      });
    });
  }, []);

  const runCalibration = useCallback(
    async ({
      designId: calibrationDesignId,
      calibratable,
      signal,
      runId,
    }: {
      designId: string;
      calibratable: ForgeParameter[];
      signal: AbortSignal;
      runId: string | null;
    }) => {
      const pending = calibratable.filter((p) => !p.modified);
      setParameters(calibratable);
      setConfirmedValuesTracked(
        Object.fromEntries(
          calibratable
            .filter((p) => p.modified)
            .map((p) => [p.name, p.value]),
        ) as Record<string, number>,
      );
      setParamSweeps({});
      setPhase("calibrating");
      if (runId) {
        storeDesignState(runId, { designId: calibrationDesignId, phase: "calibrating" });
      }

      const baseMesh = await getDesignMesh(calibrationDesignId);
      if (signal.aborted) return;
      if (baseMesh !== null) setMesh(baseMesh);

      setStatusMessage("Rendering parameter previews…");

      // One parameter at a time (its frames still render in parallel). Each
      // sweep is published as soon as it completes so the UI can show it
      // while the remaining parameters render in the background.
      for (const [index, param] of pending.entries()) {
        if (signal.aborted) return;
        const { low, high } = deriveLowHigh(param);
        const lowMid = midpoint(param.value, low);
        const highMid = midpoint(param.value, high);
        const values: number[] = [];
        for (let s = 0; s < SWEEP_RENDER_STEPS; s++) {
          values.push(
            lowMid + ((highMid - lowMid) * s) / (SWEEP_RENDER_STEPS - 1),
          );
        }
        setStatusMessage(
          `Rendering previews for ${param.name} (${index + 1}/${pending.length})…`,
        );
        const frames = await Promise.all(
          values.map((value) =>
            renderDesignWithParams(calibrationDesignId, { [param.name]: value }),
          ),
        );
        if (signal.aborted) return;
        const sweep: ParamSweep = {
          values,
          frames,
        };
        setParamSweeps((prev) => ({ ...prev, [param.name]: sweep }));
      }

      setStatusMessage("");
      // The UI drives the rest: confirmParamValue() per parameter and
      // finishCalibration() once every parameter is confirmed.
    },
    [setConfirmedValuesTracked],
  );

  const generate = useCallback(
    async ({
      handoffs,
      runId,
    }: {
      handoffs: string[];
      runId: string | null;
    }) => {
      if (handoffs.length === 0) {
        setError("No CAD handoff document was produced by the pipeline.");
        setPhase("error");
        return;
      }
      const lock = {};
      if (!acquireBusy(lock)) {
        console.warn("[Forge] generate skipped — another operation is in flight");
        return;
      }

      chooseResolverRef.current?.(null);
      chooseResolverRef.current = null;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      stopActiveVariants();

      setPhase("initializing");
      setError("");
      setStatusMessage("");
      setMesh(null);
      setParameters([]);
      setVariants([]);
      chooseResolverSourceRef.current = null;
      setDesignId(null);
      setSelectedHandoff(null);

      try {
        /*
          Phase 1: one fully independent design is generated per supplied
          handoff at once. The picker opens on the first tile;
          later tiles fill in live. Picking resolves the park immediately.
        */
        const startedVariantIds: string[] = [];
        const noteVariant = (variantId: string) => {
          startedVariantIds.push(variantId);
          if (runId) {
            storeDesignState(runId, {
              variantDesignIds: [...startedVariantIds],
              phase: "choosing",
            });
          }
        };

        let pickResolved = false;
        const chosenPromise = new Promise<string | null>((resolve, reject) => {
          chooseResolverRef.current = (id) => {
            pickResolved = true;
            resolve(id);
          };
          allFailedRejectRef.current = reject;
        });

        const childControllers: AbortController[] = [];
        let settledCount = 0;
        let okCount = 0;

        const rejectChosenPromise = () => {
          const reject = allFailedRejectRef.current;
          allFailedRejectRef.current = null;
          reject?.(
            new Error("Forge could not generate any of the candidate designs."),
          );
        };

        const checkAllSettled = () => {
          if (pickResolved || settledCount < handoffs.length) return;
          if (okCount === 0) {
            // Every variant failed: no candidate can ever be picked, so
            // reject the park instead of leaving it waiting on the user.
            chooseResolverRef.current = null;
            rejectChosenPromise();
          }
          // With successful candidates the resolver must stay installed —
          // the round is still parked on the user's pick.
        };

        // Latest mesh per variant id, so a mid-stream pick can reuse the tile.
        const variantMeshes = new Map<string, THREE_Group>();
        // Which handoff produced which variant, so the picked design keeps
        // its own handoff for refinement instead of a generic one.
        const variantHandoffs = new Map<string, string>();

        const generateVariant = async (handoffMarkdown: string) => {
          const child = new AbortController();
          signal.addEventListener("abort", () => child.abort(), { once: true });
          childControllers.push(child);

          let variantId: string | null = null;
          try {
            variantId = await createDesign();
            noteVariant(variantId);
            variantHandoffs.set(variantId, handoffMarkdown);
            activeVariantIdsRef.current.add(variantId);
            setVariants((prev) => [
              ...prev,
              { designId: variantId!, mesh: null, status: "generating", error: null },
            ]);
            setPhase("choosing");
            setStatusMessage("");

            const variantStream = subscribeDesignStream(variantId, child.signal);
            await sendDesignMessage(variantId, handoffMarkdown);

            let variantMesh: THREE_Group | null = null;
            for (;;) {
              const { value: ev, done } = await variantStream.next();
              if (done || ev.type === "end") break;
              if (ev.type === "mesh") {
                try {
                  variantMesh = parseMeshBase64(ev.data);
                  variantMeshes.set(variantId, variantMesh);
                  // Streaming preview: rendered grayed out until the final
                  // render unlocks the tile.
                  patchVariant(variantId, { mesh: variantMesh, status: "preview" });
                } catch {
                  // skip unparseable frame
                }
              } else if (ev.type === "error") {
                throw new Error(ev.data || "Forge error during initial generation");
              }
            }

            const finalVariantMesh = await getDesignMesh(variantId);
            if (signal.aborted) return;
            if (finalVariantMesh !== null) {
              variantMeshes.set(variantId, finalVariantMesh);
              patchVariant(variantId, { mesh: finalVariantMesh, status: "ready" });
            }
            if (finalVariantMesh === null) {
              throw new Error("Forge did not return a renderable model.");
            }
            okCount++;
            activeVariantIdsRef.current.delete(variantId);
            return { designId: variantId, mesh: finalVariantMesh };
          } catch (err) {
            if (variantId !== null) {
              activeVariantIdsRef.current.delete(variantId);
              removeVariant(variantId);
            }
            throw err;
          } finally {
            settledCount++;
            checkAllSettled();
          }
        };

        handoffs.map((handoffMarkdown) =>
          generateVariant(handoffMarkdown).catch((reason) => {
            console.warn("[Forge] initial variant failed:", reason);
          }),
        );

        // The lock is released while parked: the picker is waiting on the
        // user, not on Forge, and chat-driven feedback must be able to start
        // a duplicateAndRefine round from here.
        releaseBusy(lock);

        const chosenId = await chosenPromise;
        if (signal.aborted) return;

        if (!acquireBusy(lock)) return;

        // A pick during generation: stop the siblings that are still running.
        // Aborting the local SSE readers releases the streams; the server-side
        // stop flag ends Forge's agent loop so no tokens keep burning.
        childControllers.forEach((child) => child.abort());
        await Promise.allSettled(
          startedVariantIds
            .filter(
              (variantId) =>
                variantId !== chosenId && !variantMeshes.has(variantId),
            )
            .map((variantId) => stopDesign(variantId)),
        );
        chooseResolverRef.current = null;
        allFailedRejectRef.current = null;

        // Phase 2: chosen design continues into calibration.
        setVariants([]);
        setDesignId(chosenId);
        setSelectedHandoff(
          chosenId !== null ? (variantHandoffs.get(chosenId) ?? null) : null,
        );
        // Reuse the tile's streamed mesh if it arrived; otherwise the mesh
        // fetch in the calibration phase provides the first render.
        setMesh(variantMeshes.get(chosenId ?? "") ?? null);
        if (runId && chosenId) {
          // Keep the variant ids so leaving and returning reopens the picker
          // rather than locking the user into the picked design.
          storeDesignState(runId, {
            designId: chosenId,
            phase: "calibrating",
            variantDesignIds: [...startedVariantIds],
            selectedHandoff: variantHandoffs.get(chosenId),
          });
        }
        if (chosenId === null) return;

        const chosenDesign = await getDesign(chosenId);
        if (signal.aborted) return;
        const rawParams = chosenDesign?.overview?.parameters ?? [];

        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          setPhase("ready");
          if (runId) {
            storeDesignState(runId, { designId: chosenId, phase: "ready" });
          }
          return;
        }

        await runCalibration({
          designId: chosenId,
          calibratable,
          signal,
          runId,
        });
      } catch (err) {
        if (signal.aborted) return;
        console.error("Forge generation failed:", err);
        const serverMsg = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error;
        const msg =
          serverMsg ??
          (err instanceof Error ? err.message : "Forge generation failed.");
        setError(
          msg === "Unauthorized"
            ? "Forge rejected your session (Unauthorized). Please sign in again."
            : msg,
        );
        setPhase("error");
      } finally {
        releaseBusy(lock);
      }
    },
    [runCalibration, patchVariant, removeVariant, stopActiveVariants, acquireBusy, releaseBusy],
  );

  // Local-only confirmation: nothing is sent to Forge here. Values live in
  // component state until finishCalibration batches them into one patch.
  const confirmParamValue = useCallback(
    (name: string, value: number) => {
      setConfirmedValuesTracked((prev) => ({ ...prev, [name]: value }));
    },
    [setConfirmedValuesTracked],
  );

  const finishCalibration = useCallback(
    async ({ runId }: { runId: string | null } = { runId: null }) => {
      const currentDesignId = designId;
      if (currentDesignId === null) return;
      setPhase("finalizing");
      setStatusMessage("Applying measurements and rendering the final model…");
      try {
        // Every confirmed value is persisted here in a single merge patch —
        // nothing was sent during calibration.
        const values = confirmedValuesRef.current;
        if (Object.keys(values).length > 0) {
          await patchParameters(currentDesignId, values);
        }
        const updatedMesh = await getDesignMesh(currentDesignId);
        if (updatedMesh !== null) setMesh(updatedMesh);
        setPhase("ready");
        if (runId) {
          storeDesignState(runId, { designId: currentDesignId, phase: "ready" });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Final render failed.");
        setPhase("calibrating");
      }
      setStatusMessage("");
    },
    [designId],
  );

  /** Resolve the parked generate()/duplicateAndRefine() with the picked
   *  variant id. */
  const chooseDesign = useCallback((pickedDesignId: string | null) => {
    if (chooseResolverRef.current !== null) {
      // Feedback rounds keep the picked design as the next round's source.
      chooseResolverSourceRef.current = pickedDesignId;
    }
    chooseResolverRef.current?.(pickedDesignId);
    chooseResolverRef.current = null;
  }, []);

  /*
    Rehydrate the variant picker after a refresh. Every stored design id gets
    a tile immediately, then each tile is resolved independently: a stored
    render fills it in, and a design whose turn is still streaming reattaches
    its SSE stream so the mesh arrives when Forge finishes. Designs that
    produce no mesh at all are dropped.
  */
  const rehydrateVariants = useCallback(
    async ({
      variantDesignIds,
      signal,
    }: {
      variantDesignIds: string[];
      signal: AbortSignal;
    }): Promise<string[] | null> => {
      setStatusMessage("Restoring your candidate designs…");
      variantDesignIds.forEach((variantDesignId) => {
        setVariants((prev) =>
          prev.some((v) => v.designId === variantDesignId)
            ? prev
            : [
                ...prev,
                {
                  designId: variantDesignId,
                  mesh: null,
                  status: "generating" as const,
                  error: null,
                },
              ],
        );
      });
      setPhase("choosing");

      const survivors = new Set(variantDesignIds);

      await Promise.allSettled(
        variantDesignIds.map(async (variantDesignId) => {
          try {
            let variantMesh = await getDesignMesh(variantDesignId);

            if (variantMesh === null && !signal.aborted) {
              // Nothing stored yet — the generation turn may still be live.
              // Reattach the stream and wait for it to finish, then try the
              // stored render again.
              const stream = subscribeDesignStream(variantDesignId, signal);
              for (;;) {
                const { value: ev, done } = await stream.next();
                if (done || ev.type === "end" || ev.type === "error") break;
                if (ev.type === "running" && ev.data === false) break;
                if (ev.type === "mesh") {
                  try {
                    const restoredMesh = parseMeshBase64(ev.data);
                    patchVariant(variantDesignId, {
                      mesh: restoredMesh,
                      status: "preview",
                    });
                  } catch {
                    // skip unparseable frame
                  }
                }
              }
              variantMesh = signal.aborted ? null : await getDesignMesh(variantDesignId);
            }

            if (signal.aborted) return;
            if (variantMesh !== null) {
              patchVariant(variantDesignId, {
                mesh: variantMesh,
                status: "ready",
              });
            } else {
              survivors.delete(variantDesignId);
              removeVariant(variantDesignId);
            }
          } catch (err) {
            console.warn("[Forge] variant rehydrate failed:", err);
            survivors.delete(variantDesignId);
            removeVariant(variantDesignId);
          }
        }),
      );
      setStatusMessage("");
      return survivors.size > 0 ? [...survivors] : null;
    },
    [patchVariant, removeVariant],
  );

  /*
    Restore a previously generated design for this run instead of paying for
    a full regeneration. Returns true when a design/variant set was restored.
  */
  const rehydrate = useCallback(
    async ({
      runId,
      handoffs,
    }: {
      runId: string | null;
      handoffs: string[];
    }): Promise<boolean> => {
      let stored = loadStoredDesignState(runId);

      // Nothing in localStorage (cleared, new browser) — try to rebuild the
      // run → design mapping from the refinement run's persisted bootstrap
      // message.
      const recoveryHandoff = handoffs[0] ?? "";
      if (stored === null && recoveryHandoff) {
        const recoveredId = await recoverDesignIdForRun({
          handoffMarkdown: recoveryHandoff,
        });
        if (recoveredId) {
          stored = {
            designId: recoveredId,
            phase: "ready",
            selectedHandoff: recoveryHandoff,
          };
          storeDesignState(runId, stored);
        }
      }

      if (stored === null) return false;
      const lock = {};
      if (!acquireBusy(lock)) {
        console.warn("[Forge] rehydrate skipped — another operation is in flight");
        return false;
      }

      const controller = new AbortController();
      chooseResolverRef.current?.(stored.designId ?? null);
      chooseResolverRef.current = null;
      abortRef.current?.abort();
      abortRef.current = controller;
      const { signal } = controller;

      setPhase("initializing");
      setStatusMessage("Restoring your model…");
      setError("");

      try {
        let targetDesignId: string | undefined = stored.designId;

        /*
          A "choosing" entry, or a picked design that kept its variant ids,
          reopens the picker: the user can go back to chat, return, and still
          see every candidate instead of being locked into the previous pick.
        */
        const pickerIds =
          stored.phase === "choosing"
            ? stored.variantDesignIds
            : Array.isArray(stored.variantDesignIds) &&
                stored.variantDesignIds.length > 0
              ? stored.variantDesignIds
              : null;

        if (pickerIds != null) {
          const survivingIds = await rehydrateVariants({
            variantDesignIds: pickerIds,
            signal,
          });
          if (signal.aborted) return false;
          if (survivingIds === null) {
            clearStoredDesignState(runId);
            return false;
          }
          setStatusMessage("");

          // Release the lock while parked on the user's pick.
          releaseBusy(lock);

          targetDesignId =
            (await new Promise<string | null>((resolve) => {
              chooseResolverRef.current = resolve;
            })) ?? undefined;
          if (signal.aborted) return false;
          if (!acquireBusy(lock)) return false;
          setVariants([]);
          storeDesignState(runId, {
            designId: targetDesignId ?? undefined,
            phase: "calibrating",
            variantDesignIds: survivingIds,
            // The pick cannot tell us which handoff produced the design here,
            // so the recovery needle stays the first handoff.
            selectedHandoff: stored.selectedHandoff ?? (recoveryHandoff || undefined),
          });
        }

        if (!targetDesignId) {
          clearStoredDesignState(runId);
          return false;
        }

        const design = await getDesign(targetDesignId);
        if (signal.aborted) return false;
        if (design === null) {
          clearStoredDesignState(runId);
          return false;
        }
        setDesignId(targetDesignId);
        setSelectedHandoff(stored.selectedHandoff ?? (recoveryHandoff || null));

        if (stored.phase === "calibrating") {
          const stream = subscribeDesignStream(targetDesignId, signal);
          if (signal.aborted) return false;
          // Wait only while a turn is actually live. A completed generation
          // replays `running: false` and then goes quiet.
          for (;;) {
            const { value: ev, done } = await stream.next();
            if (done || ev.type === "end" || ev.type === "error") break;
            if (ev.type === "running" && ev.data === false) break;
          }
          if (signal.aborted) return false;
        }

        const rawParams = design.overview?.parameters ?? [];
        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          const readyMesh = await getDesignMesh(targetDesignId);
          if (signal.aborted) return false;
          if (readyMesh === null) {
            clearStoredDesignState(runId);
            return false;
          }
          setMesh(readyMesh);
          setStatusMessage("");
          setPhase("ready");
          return true;
        }

        await runCalibration({
          designId: targetDesignId,
          calibratable,
          signal,
          runId,
        });
        return true;
      } catch (err) {
        if (signal.aborted) return false;
        // Design gone (deleted, other user, expired) — regenerate from scratch.
        console.warn("Rehydrate failed, regenerating:", err);
        clearStoredDesignState(runId);
        return false;
      } finally {
        releaseBusy(lock);
      }
    },
    [runCalibration, rehydrateVariants, acquireBusy, releaseBusy],
  );

  const refineExistingDesign = useCallback(
    async ({
      instruction,
      runId,
    }: {
      instruction: string;
      runId: string | null;
    }): Promise<boolean> => {
      if (!designId) {
        setError("No existing Forge design is available to refine.");
        return false;
      }
      if (!instruction?.trim()) {
        return false;
      }

      const lock = {};
      if (!acquireBusy(lock)) {
        console.warn("[Forge] refine skipped — another operation is in flight");
        return false;
      }

      // Unpark any previous parked operation and cancel it before beginning
      // the refinement turn. The existing design itself is preserved.
      chooseResolverRef.current?.(null);
      chooseResolverRef.current = null;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      setError("");
      setStatusMessage("Updating the model from your feedback…");
      setPhase("initializing");
      setParameters([]);

      try {
        // Subscribe before sending the message so we do not miss the
        // beginning of Forge's regeneration stream.
        const stream = subscribeDesignStream(designId, signal);
        await sendDesignMessage(designId, instruction.trim());
        if (signal.aborted) return false;

        let updatedMesh: THREE_Group | null = null;
        let turnStarted = false;

        // The Forge stream may stay open for future turns, so "running:
        // false" after we have observed the turn is the completion signal.
        for (;;) {
          if (signal.aborted) return false;
          const { value: ev, done } = await stream.next();
          if (done) break;
          if (ev.type === "running") {
            if (ev.data === true) {
              turnStarted = true;
            } else if (turnStarted) {
              break;
            }
          } else if (ev.type === "mesh") {
            try {
              updatedMesh = parseMeshBase64(ev.data);
            } catch {
              // Ignore an unparseable intermediate mesh.
            }
          } else if (ev.type === "error") {
            throw new Error(ev.data || "Forge error during refinement");
          } else if (ev.type === "end") {
            break;
          }
        }

        if (signal.aborted) return false;

        const updatedDesign = await getDesign(designId);
        if (signal.aborted) return false;
        if (!updatedDesign) {
          throw new Error("Forge could not return the updated design.");
        }

        // Fetch the final stored mesh even if an intermediate mesh arrived
        // through SSE — it represents Forge's latest stored design.
        const updatedFromServer = await getDesignMesh(designId);
        if (signal.aborted) return false;
        if (updatedFromServer !== null) {
          updatedMesh = updatedFromServer;
        }
        if (updatedMesh !== null) {
          setMesh(updatedMesh);
        }

        const rawParams = updatedDesign.overview?.parameters ?? [];
        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          setStatusMessage("");
          setPhase("ready");
          if (runId) {
            storeDesignState(runId, { designId, phase: "ready" });
          }
          return true;
        }

        await runCalibration({
          designId,
          calibratable,
          signal,
          runId,
        });
        return true;
      } catch (err) {
        if (signal.aborted) return false;
        console.error("Forge refinement failed:", err);
        const serverMsg = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error;
        setError(
          serverMsg ??
            (err instanceof Error ? err.message : "Forge refinement failed."),
        );
        setStatusMessage("");
        setPhase("error");
        return false;
      } finally {
        releaseBusy(lock);
      }
    },
    [designId, runCalibration, acquireBusy, releaseBusy],
  );

  /*
    Feedback iteration round: the chosen design is duplicated N - 1 times
    (N = the number of handoff documents the pipeline supplied, matching the
    initial variant count), the feedback message is sent to every copy
    plus the original, and the SAME picker view fills in exactly as during
    the initial generation. The round parks on the user's pick with the lock
    released, so the next chat instruction starts round N+1 — indefinitely.
  */
  const duplicateAndRefine = useCallback(
    async ({
      feedback,
      sourceDesignId,
      runId,
      variantCount,
    }: {
      feedback: string;
      sourceDesignId: string | null;
      runId: string | null;
      variantCount?: number;
    }) => {
      const source = sourceDesignId ?? chooseResolverSourceRef.current ?? designId;
      if (source === null) {
        setError("No design is available to iterate on.");
        setPhase("error");
        return;
      }

      const lock = {};
      if (!acquireBusy(lock)) {
        console.warn(
          "[Forge] duplicateAndRefine skipped — another operation is in flight",
        );
        return;
      }

      // Unpark the previous operation (a parked generate/rehydrate/feedback
      // round resolves its pick, then sees the abort and unwinds).
      chooseResolverRef.current?.(source);
      chooseResolverRef.current = null;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      // The previous round's turns keep running server-side after the local
      // abort — stop them before their ids are lost. The source survives.
      const previousIds = [...activeVariantIdsRef.current];
      activeVariantIdsRef.current = new Set();
      previousIds
        .filter((variantId) => variantId !== source)
        .forEach((variantId) => {
          stopDesign(variantId).catch((err) => {
            console.warn(`[Forge] stop failed for variant ${variantId}:`, err);
          });
        });

      setPhase("initializing");
      setError("");
      setMesh(null);
      setParameters([]);
      chooseResolverSourceRef.current = source;
      setVariants([]);

      try {
        // The source tile exists immediately (spinner), the duplicate tiles
        // appear as their copy requests resolve.
        const startedVariantIds = [source];
        activeVariantIdsRef.current.add(source);
        const noteVariant = (variantId: string) => {
          startedVariantIds.push(variantId);
          activeVariantIdsRef.current.add(variantId);
          if (runId) {
            storeDesignState(runId, {
              variantDesignIds: [...startedVariantIds],
              phase: "choosing",
            });
          }
        };
        setVariants([
          { designId: source, mesh: null, status: "generating", error: null },
        ]);
        setPhase("choosing");
        setStatusMessage("");

        const childControllers: AbortController[] = [];
        let settledCount = 0;
        let okCount = 0;
        let roundFailed = false;

        const checkAllSettled = () => {
          if (
            chooseResolverRef.current === null ||
            settledCount < startedVariantIds.length
          ) {
            return;
          }
          if (okCount === 0) {
            roundFailed = true;
            // No pick is coming — resolve the park so the catch surfaces the
            // error.
            chooseResolverRef.current?.(null);
            chooseResolverRef.current = null;
          }
        };

        // One candidate's turn — identical per-tile flow to generate().
        const runCandidate = async (candidateId: string, isSource: boolean) => {
          let runningId = candidateId;
          const child = new AbortController();
          signal.addEventListener("abort", () => child.abort(), { once: true });
          childControllers.push(child);

          try {
            if (!isSource) {
              runningId = await duplicateDesign(source);
              noteVariant(runningId);
              activeVariantIdsRef.current.add(runningId);
              setVariants((prev) =>
                prev.some((v) => v.designId === runningId)
                  ? prev
                  : [
                      ...prev,
                      {
                        designId: runningId,
                        mesh: null,
                        status: "generating" as const,
                        error: null,
                      },
                    ],
              );
            }

            const stream = subscribeDesignStream(runningId, child.signal);
            await sendDesignMessage(runningId, feedback.trim());

            let candidateMesh: THREE_Group | null = null;
            let turnStarted = false;
            for (;;) {
              const { value: ev, done } = await stream.next();
              if (done || ev.type === "end") break;
              if (ev.type === "running") {
                if (ev.data === true) turnStarted = true;
                else if (turnStarted) break;
              } else if (ev.type === "mesh") {
                try {
                  candidateMesh = parseMeshBase64(ev.data);
                  patchVariant(runningId, {
                    mesh: candidateMesh,
                    status: "preview",
                  });
                } catch {
                  // skip unparseable frame
                }
              } else if (ev.type === "error") {
                throw new Error(
                  ev.data || "Forge error during feedback iteration",
                );
              }
            }

            const finalMesh = await getDesignMesh(runningId);
            if (finalMesh !== null) {
              candidateMesh = finalMesh;
              patchVariant(runningId, { mesh: candidateMesh, status: "ready" });
            }
            if (candidateMesh === null) {
              throw new Error("Forge did not return a renderable model.");
            }
            okCount++;
            activeVariantIdsRef.current.delete(runningId);
          } catch (err) {
            activeVariantIdsRef.current.delete(runningId);
            if (!signal.aborted) {
              console.warn(
                `[Forge] feedback candidate ${isSource ? "(source)" : ""} failed:`,
                err,
              );
              removeVariant(runningId);
            }
          } finally {
            settledCount++;
            checkAllSettled();
          }
        };

        // Fire all candidates at once. The lock is released while parked so
        // the next chat instruction can start round N+1 from here.
        runCandidate(source, true);
        Array.from(
          { length: Math.max((variantCount ?? 1) - 1, 0) },
          () => runCandidate(source, false),
        );

        releaseBusy(lock);
        const chosenId = await new Promise<string | null>((resolve) => {
          chooseResolverRef.current = resolve;
        });
        if (roundFailed) {
          throw new Error("Forge could not apply the feedback to any design.");
        }
        if (signal.aborted) return;

        if (!acquireBusy(lock)) return;

        // A pick during the round: stop the candidates still running.
        childControllers.forEach((child) => child.abort());
        activeVariantIdsRef.current.clear();
        await Promise.allSettled(
          startedVariantIds
            .filter((variantId) => variantId !== chosenId)
            .map((variantId) => stopDesign(variantId)),
        );
        chooseResolverRef.current = null;

        // The picked design continues into calibration, mirroring the tail
        // of generate().
        setVariants([]);
        setDesignId(chosenId);
        if (chosenId === null) return;
        const chosenMesh = await getDesignMesh(chosenId);
        if (signal.aborted) return;
        if (chosenMesh !== null) setMesh(chosenMesh);
        if (runId) {
          storeDesignState(runId, {
            designId: chosenId,
            phase: "calibrating",
            variantDesignIds: [...startedVariantIds],
          });
        }

        const chosenDesign = await getDesign(chosenId);
        if (signal.aborted) return;
        const rawParams = chosenDesign?.overview?.parameters ?? [];
        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          setPhase("ready");
          if (runId) {
            storeDesignState(runId, { designId: chosenId, phase: "ready" });
          }
          return;
        }

        await runCalibration({
          designId: chosenId,
          calibratable,
          signal,
          runId,
        });
      } catch (err) {
        if (signal.aborted) return;
        console.error("Forge feedback iteration failed:", err);
        const serverMsg = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error;
        setError(
          serverMsg ??
            (err instanceof Error
              ? err.message
              : "Forge feedback iteration failed."),
        );
        setPhase("error");
      } finally {
        releaseBusy(lock);
      }
    },
    [designId, runCalibration, patchVariant, removeVariant, acquireBusy, releaseBusy],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    chooseResolverRef.current = null;
    chooseResolverSourceRef.current = null;
    stopActiveVariants();
    busyOwnerRef.current = null;
    setBusy(false);
    setVariants([]);
    setDesignId(null);
    setSelectedHandoff(null);
    setPhase("idle");
    setMesh(null);
    setError("");
    setStatusMessage("");
    setParameters([]);
    setParamSweeps({});
    setConfirmedValues({});
    confirmedValuesRef.current = {};
  }, [stopActiveVariants]);

  return {
    phase,
    mesh,
    error,
    parameters,
    statusMessage,
    designId,
    selectedHandoff,
    variants,
    busy,
    paramSweeps,
    confirmedValues,
    generate,
    rehydrate,
    refineExistingDesign,
    duplicateAndRefine,
    chooseDesign,
    confirmParamValue,
    finishCalibration,
    reset,
  };
}
