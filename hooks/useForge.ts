"use client";

import { useCallback, useRef, useState } from "react";

import { isCalibratable } from "@/lib/forgeParams";
import {
  createDesign,
  duplicateDesign,
  stopDesign,
  sendDesignMessage,
  subscribeDesignStream,
  fetchDesignGeometry,
  setParameters as persistParameters,
  ParameterErrors,
  getDesign,
  type GeometryFetch,
} from "@/lib/forgeClient";
import { parseGlbCached } from "@/lib/glb";
import { recoverDesignIdForRun } from "@/lib/recoverDesign";
import type {
  ForgePhase,
  GlbModel,
  GeometrySummary,
  Guide,
  Parameter,
} from "@/lib/types";

import {
  loadStoredDesignState,
  storeDesignState,
  clearStoredDesignState,
} from "@/lib/forgeStore";

/* Re-exported (not just imported) because external readers — not only
   useForge — need them. */
export { loadStoredDesignState, clearStoredDesignState };

/*
  Shared Forge state machine used by the CAD screen:

    idle → initializing → choosing → calibrating → finalizing → ready

  generate() fires one design per handoff document in parallel and parks in
  "choosing" until the user picks a candidate; the pick continues into the
  calibration wizard. refineDesign() refines the current design (duplicate +
  feedback to the copy). reopenDesignPicker() and rehydrate() restore the
  picker / design from the per-run localStorage entries. All operations
  share a single busy lock, an AbortController tree, and the store.
*/
export function useForge() {
  // ── Viewport state ───────────────────────────────────────────────
  const [phase, setPhase] = useState<ForgePhase>("idle");
  const [model, setModel] = useState<GlbModel | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [error, setError] = useState("");
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [confirmedValues, setConfirmedValues] = useState<
    Record<string, number>
  >({});
  const [statusMessage, setStatusMessage] = useState("");
  // The latest failed rebuild's report (why the change didn't show), or
  // null when the last apply succeeded or no apply has run yet.
  const [buildReport, setBuildReport] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  // Index of the current design's handoff within the run's handoff array —
  // the refinement bootstrap seeds the matching variant brief, not the
  // first one; null when unknown (recovery path, pre-pick, refinement
  // copies of unknown origin).
  const [handoffIndex, setHandoffIndex] = useState<number | null>(null);
  const [variants, setVariants] = useState<
    { designId: string; mesh: GlbModel | null; status: "generating" | "ready"; error: string | null }[]
  >([]);
  const [busy, setBusy] = useState(false);
  // Parameter name currently being applied (PATCH + rebuild + model swap in
  // flight), or null when idle — the CAD view greys the model for this window.
  const [settingParam, setSettingParam] = useState<string | null>(null);
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

  // ── Variant tile state ───────────────────────────────────────────
  const patchVariant = useCallback(
    (variantId: string, patch: Partial<{ mesh: GlbModel | null; status: "generating" | "ready"; error: string | null }>) => {
      setVariants((prev) =>
        prev.map((v) => (v.designId === variantId ? { ...v, ...patch } : v)),
      );
    },
    [],
  );
  const removeVariant = useCallback((variantId: string) => {
    setVariants((prev) => prev.filter((v) => v.designId !== variantId));
  }, []);

  // Track the geometry revision the current model was parsed from, so
  // subsequent geometry fetches can 304 against it.
  const revisionRef = useRef<string | null>(null);

  // ── Geometry loading (revision-aware, deduped across callers) ────
  /** Load the geometry for a design, honoring the revision the client
   *  already knows so unchanged models cost a 304. Several callers can
   *  fire for the same rebuild (a streamed `geometry` alarm and the
   *  REST adoption racing); an in-flight fetch for the same
   *  design+revision is shared instead of downloading the GLB twice. */
  const inFlightGeometry = useRef<Map<string, Promise<GeometryFetch>>>(new Map());
  const fetchGeometry = useCallback(async (designId: string, knownRevision?: string) => {
    const key = `${designId}@${knownRevision ?? ""}`;
    const inFlight = inFlightGeometry.current.get(key);
    if (inFlight !== undefined) return inFlight;
    const promise = (async () => {
      try {
        return await fetchDesignGeometry(designId, knownRevision);
      } finally {
        inFlightGeometry.current.delete(key);
      }
    })();
    inFlightGeometry.current.set(key, promise);
    return promise;
  }, []);

  /**
    Fetch, parse and adopt the latest geometry for a design. With
    `apply` (the current design path) the parsed model and the design's
    guides replace the viewport state directly; with `apply: false`
    (variant tile path) nothing global is touched and the parsed model
    is only returned for the caller's tile. Resolves null when the
    design/item disappears from the flow's error contract (thrown
    network errors propagate to the caller).
  */
  const loadGeometry = useCallback(
    async (
      targetDesignId: string,
      opts: { apply?: boolean; signal?: AbortSignal; knownRevision?: string } = {},
    ): Promise<GlbModel | null> => {
      const apply = opts.apply ?? true;
      const summary = await getDesign(targetDesignId);
      if (opts.signal?.aborted) return null;
      if (summary === null) return null;
      const summaryGuides = summary.geometry?.guides ?? [];
      const fetch = await fetchGeometry(
        targetDesignId,
        opts.knownRevision ?? revisionRef.current ?? undefined,
      );
      if (opts.signal?.aborted) return null;
      if (fetch.status === "ok") {
        const parsed = await parseGlbCached(fetch.revision, fetch.blob, targetDesignId);
        if (apply) {
          setModel(parsed);
          setGuides(summaryGuides);
          revisionRef.current = fetch.revision;
        }
        return parsed;
      }
      if (fetch.status === "none") {
        if (apply) {
          setModel(null);
          setGuides([]);
          revisionRef.current = null;
        }
        return null;
      }
      // "unchanged": the revision we already know is still current. The
      // cached parse is only valid when a model genuinely exists — a
      // caller with no model yet must not adopt an empty buffer parse.
      if (!apply) return null;
      const cached = revisionRef.current;
      if (cached === null) return null;
      return parseGlbCached(cached, new ArrayBuffer(0), targetDesignId);
    },
    [fetchGeometry],
  );

  /**
    Adopt the mesh a `geometry` stream frame points at. The frame is only an
    alarm — the GLB itself comes from REST (deduped and 304-safe through the
    same fetch wrapper), so calling it per frame stays cheap: an unchanged
    revision round-trips as a status line and hands back the cached parse.
    Resolves the parsed model, null when none exists, or null on a transport
    failure (logged, never thrown — one bad fetch shouldn't kill the turn).
  */
  const applyGeometry = useCallback(
    async (
      summary: GeometrySummary,
      targetDesignId: string,
    ): Promise<GlbModel | null> => {
      try {
        const summaryGuides = summary.guides ?? [];
        const fetch = await fetchGeometry(
          targetDesignId,
          revisionRef.current ?? undefined,
        );
        if (fetch.status === "ok") {
          const parsed = await parseGlbCached(
            fetch.revision,
            fetch.blob,
            targetDesignId,
          );
          setModel(parsed);
          setGuides(summaryGuides);
          revisionRef.current = fetch.revision;
          return parsed;
        }
        if (fetch.status === "none") {
          setModel(null);
          setGuides([]);
          revisionRef.current = null;
          return null;
        }
        // "unchanged" — same revision the viewport already shows; a null
        // cache (nothing decoded yet) is nothing to re-park.
        return revisionRef.current === null
          ? null
          : await parseGlbCached(
              revisionRef.current,
              new ArrayBuffer(0),
              targetDesignId,
            );
      } catch (err) {
        console.warn("[Forge] live geometry apply failed:", err);
        return null;
      }
    },
    [fetchGeometry, setGuides, setModel],
  );


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

  // ── Start calibrating a chosen design (entry from the pick or
  //    from rehydration) ────────────────────────────────────────────
  const runCalibration = useCallback(
    async ({
      designId: calibrationDesignId,
      calibratable,
      signal,
      runId,
    }: {
      designId: string;
      calibratable: Parameter[];
      signal: AbortSignal;
      runId: string | null;
    }) => {
      setParameters(calibratable);
      setConfirmedValuesTracked(
        Object.fromEntries(
          calibratable
            .filter((p) => p.set)
            .map((p) => [p.name, p.value]),
        ) as Record<string, number>,
      );
      setGuides([]);
      revisionRef.current = null;
      setPhase("calibrating");
      if (runId) {
        storeDesignState(runId, { designId: calibrationDesignId, phase: "calibrating" });
      }

      await loadGeometry(calibrationDesignId, { signal });
      setStatusMessage("");
      // The UI drives the rest: confirmParamValue() per parameter and
      // finishCalibration() once every parameter is confirmed.
    },
    [setConfirmedValuesTracked],
  );

  // ── Generation: one design per handoff, in parallel, then parked in
  //    "choosing" for the user's pick ───────────────────────────────
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
      setModel(null);
      setGuides([]);
      revisionRef.current = null;
      setParameters([]);
      setVariants([]);
      setDesignId(null);
      setHandoffIndex(null);

      try {
        /*
          Phase 1: one fully independent design is generated per supplied
          handoff at once. The picker opens on the first tile;
          later tiles fill in live. Picking resolves the park immediately.
        */
        const startedVariantIds: string[] = [];
        // Resolve order is not handoff order (parallel generation), so the
        // design → handoff pairing is tracked explicitly — the refinement
        // bootstrap must seed the handoff the picked variant came from.
        const variantHandoffs: Record<string, number> = {};
        const noteVariant = (variantIndex: number, variantId: string) => {
          startedVariantIds.push(variantId);
          variantHandoffs[variantId] = variantIndex;
          if (runId) {
            storeDesignState(runId, {
              variantDesignIds: [...startedVariantIds],
              variantHandoffs: { ...variantHandoffs },
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

        // Latest model per variant id, so a mid-stream pick can reuse the tile.
        const variantMeshes = new Map<string, GlbModel>();

        const generateVariant = async (
          handoffMarkdown: string,
          variantIndex: number,
        ) => {
          const child = new AbortController();
          signal.addEventListener("abort", () => child.abort(), { once: true });
          childControllers.push(child);

          let variantId: string | null = null;
          try {
            variantId = await createDesign();
            const tileId = variantId;
            noteVariant(variantIndex, tileId);
            activeVariantIdsRef.current.add(variantId);
            setVariants((prev) => [
              ...prev,
              { designId: variantId!, mesh: null, status: "generating", error: null },
            ]);
            setPhase("choosing");
            setStatusMessage("");

            const variantStream = subscribeDesignStream(variantId, child.signal);
            await sendDesignMessage(variantId, handoffMarkdown);

            let variantMesh: GlbModel | null = null;
            for (;;) {
              const { value: ev, done } = await variantStream.next();
              if (done || ev.type === "end") break;
              if (ev.type === "error") {
                throw new Error(ev.data || "Forge error during initial generation");
              } else if (ev.type === "geometry") {
                // A build just landed; pull it into the tile live so the
                // picker tracks the agent's current draft. Scoped fetch:
                // no global model write (the main viewport belongs to the
                // final load below), dedup collapses repeat frames.
                void loadGeometry(tileId, { apply: false, signal }).then(
                  (parsed) => {
                    if (parsed !== null) {
                      patchVariant(tileId, {
                        mesh: parsed,
                        status: "ready",
                      });
                    }
                  },
                );
              }
            }

            const loaded = await loadGeometry(variantId, { apply: false, signal });
            if (signal.aborted) return;
            if (loaded !== null) {
              variantMesh = loaded;
              variantMeshes.set(variantId, variantMesh);
              patchVariant(variantId, { mesh: variantMesh, status: "ready" });
            } else {
              throw new Error("Forge did not return a renderable model.");
            }
            okCount++;
            activeVariantIdsRef.current.delete(variantId);
            return { designId: variantId, mesh: variantMesh };
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

        handoffs.map((handoffMarkdown, variantIndex) =>
          generateVariant(handoffMarkdown, variantIndex).catch((reason) => {
            console.warn("[Forge] initial variant failed:", reason);
          }),
        );

        // The lock is released while parked: the picker is waiting on the
        // user, not on Forge. Refinement only ever targets an already-picked
        // design, so refineDesign() bails while the picker is open and the
        // lock is just parked here.
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
        const chosenHandoffIndex =
          variantHandoffs[chosenId ?? ""] ?? null;
        setHandoffIndex(chosenHandoffIndex);
        // Reuse the tile's parsed model if it arrived; otherwise the
        // geometry load in the calibration phase provides the first render.
        const reused = variantMeshes.get(chosenId ?? "");
        if (reused !== undefined) {
          setModel(reused);
        }
        if (runId && chosenId) {
          // The picked design keeps the run's candidate list: it is what
          // lets the picker be reopened later with the original tiles.
          storeDesignState(runId, {
            designId: chosenId,
            phase: "calibrating",
            variantDesignIds: [...startedVariantIds],
            variantHandoffs: { ...variantHandoffs },
            handoffIndex:
              chosenHandoffIndex !== null ? chosenHandoffIndex : undefined,
          });
        }
        if (chosenId === null) return;

        const chosenDesign = await getDesign(chosenId);
        if (signal.aborted) return;
        const rawParams = chosenDesign?.parameters ?? [];

        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          setPhase("ready");
          if (runId) {
            storeDesignState(runId, {
              designId: chosenId,
              phase: "ready",
              variantDesignIds: [...startedVariantIds],
              variantHandoffs: { ...variantHandoffs },
              handoffIndex:
                chosenHandoffIndex !== null
                  ? chosenHandoffIndex
                  : undefined,
            });
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

  /*
    Confirming a parameter is immediate: the value is persisted to Forge with
    one merge PATCH (only this key is sent, so concurrent confirmations never
    clobber each other), and the rebuilt GLB is re-fetched against the
    previously known revision — parameters change the revision, so the 304
    misses and the new model loads. A fetch that raced the PATCH carries
    pre-change content; any answer contradicting the PATCH response's stored
    revision triggers an unconditional refetch. Network failures leave the
    optimistic local value in place; OK flushes server state on finish.
  */
  // ── Calibration: apply one confirmed parameter (PATCH + rebuild),
  //    then finish ─────────────────────────────────────────────────
  const confirmParamValue = useCallback(
    (name: string, value: number) => {
      const currentDesignId = designId;
      setConfirmedValuesTracked((prev) => ({ ...prev, [name]: value }));
      // No design locked in yet: nothing to persist or re-render against.
      if (currentDesignId === null) return;
      // From here until the rebuilt model (or the failure message) lands,
      // the CAD view greys the model out.
      setSettingParam(name);

      void (async () => {
        try {
          const result = await persistParameters(currentDesignId, { [name]: value });
          setParameters(result.parameters);
          const fetch = await fetchGeometry(
            currentDesignId,
            revisionRef.current ?? undefined,
          );
          if (
            result.geometry !== null &&
            ((fetch.status === "ok" && fetch.revision !== result.geometry.revision) ||
              (fetch.status === "unchanged" &&
                result.geometry.revision !== revisionRef.current))
          ) {
            const retry = await fetchGeometry(currentDesignId);
            if (retry.status === "ok") {
              setModel(await parseGlbCached(retry.revision, retry.blob, currentDesignId));
              setGuides(result.geometry?.guides ?? []);
              revisionRef.current = retry.revision;
            } else if (retry.status === "none") {
              setModel(null);
              setGuides([]);
              revisionRef.current = null;
            }
          } else if (fetch.status === "ok") {
            setModel(await parseGlbCached(fetch.revision, fetch.blob, currentDesignId));
            setGuides(result.geometry?.guides ?? []);
            revisionRef.current = fetch.revision;
          } else if (fetch.status === "none") {
            setModel(null);
            setGuides([]);
            revisionRef.current = null;
          }
          // A non-stale "unchanged" means the PATCH didn't move the revision
          // (e.g. the value already equals the stored one) — the current
          // model is already correct, keep it.
          setSettingParam(null);
          if (result.build === null) {
            setStatusMessage("Change not applied — the design could not be rebuilt");
            setBuildReport(null);
          } else if (result.build.ok && result.geometry === null) {
            setStatusMessage("Rebuild produced no geometry");
            setBuildReport(null);
          } else if (!result.build.ok && (result.build.errors > 0 || result.build.report)) {
            setStatusMessage(
              result.build.errors === 1
                ? "Rebuild failed with 1 error"
                : `Rebuild failed with ${result.build.errors} errors`,
            );
            setBuildReport(result.build.report || null);
          } else {
            setStatusMessage("");
            setBuildReport(null);
          }
        } catch (err) {
          setSettingParam(null);
          setBuildReport(null);
          if (err instanceof ParameterErrors) {
            setStatusMessage(err.message);
            return;
          }
          if (err instanceof Error && err.message === "canceled") {
            return;
          }
          setStatusMessage(
            err instanceof Error && err.message !== "Unauthorized"
              ? err.message
              : "Could not apply the change — the model keeps its previous state.",
          );
        }
      })();
    },
    [designId],
  );

  const finishCalibration = useCallback(
    async ({ runId }: { runId: string | null } = { runId: null }) => {
      const currentDesignId = designId;
      if (currentDesignId === null) return;
      setPhase("finalizing");
      setStatusMessage("Applying measurements and rendering the final model…");
      try {
        // Each parameter was already persisted eagerly on confirmation.
        // This load only bakes the stored set into the final revision.
        await loadGeometry(currentDesignId);
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
    [designId, loadGeometry],
  );

  /** Resolve the parked generate()/rehydrate() with the picked variant id. */
  // ── Resolve the parked pick (a tile id, or null for abort) ───────
  const chooseDesign = useCallback((pickedDesignId: string | null) => {
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
            let variantMesh = await loadGeometry(variantDesignId, { apply: false, signal });

            if (variantMesh === null && !signal.aborted) {
              // Nothing stored yet — the generation turn may still be live.
              // Reattach the stream and wait for it to finish, then try the
              // stored geometry again.
              const stream = subscribeDesignStream(variantDesignId, signal);
              for (;;) {
                const { value: ev, done } = await stream.next();
                if (done || ev.type === "end" || ev.type === "error") break;
                if (ev.type === "running" && ev.data === false) break;
                // Live alarms fill the tile as each revision lands; the final
                // `loadGeometry` below is the authoritative fill. Scoped fetch
                // so we don't clobber the main viewport's model.
                if (ev.type === "geometry") {
                  const parsed = await loadGeometry(variantDesignId, {
                    apply: false,
                    signal,
                  });
                  if (parsed !== null) {
                    patchVariant(variantDesignId, {
                      mesh: parsed,
                      status: "ready",
                    });
                  }
                }
              }
              if (signal.aborted) return;
              variantMesh = await loadGeometry(variantDesignId, { apply: false, signal });
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
    [patchVariant, removeVariant, loadGeometry],
  );

  /*
    Restore the current design's geometry when the view state lost it
    (e.g. re-entering the CAD workspace from the timeline). Resets the
    calibration view to a clean spinner and re-fetches the model.
  */
  // ── Re-load the current design's geometry (timeline re-entry) ────
  const reloadCurrentDesignGeometry = useCallback(async (): Promise<void> => {
    if (designId === null) return;
    setError("");
    setStatusMessage("Restoring your model…");
    setModel(null);
    setGuides([]);
    revisionRef.current = null;
    try {
      await loadGeometry(designId);
    } catch (err) {
      console.warn("[Forge] model restore failed:", err);
      setStatusMessage("");
      return;
    }
    setStatusMessage("");
  }, [designId, loadGeometry]);

  /*
    Reopen the variant picker from the design page. Refetches/reattaches
    the candidates recorded for the run and parks on the user's choice.
    After the pick, the flow continues exactly like generate()'s phase 2:
    into calibration, or straight to ready if the design has no
    calibratable parameters.
  */
  // ── Re-open the picker with this run's original candidate set ────
  const reopenDesignPicker = useCallback(
    async ({ runId }: { runId: string | null }): Promise<string | null> => {
      const entry = runId ? loadStoredDesignState(runId) : null;
      if (entry === null) {
        console.warn("[Forge] reopenDesignPicker skipped — no stored state");
        return designId;
      }
      const candidateIds = entry.variantDesignIds;
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        console.warn(
          "[Forge] reopenDesignPicker skipped — no stored candidates",
        );
        return designId;
      }

      const lock = {};
      if (!acquireBusy(lock)) {
        console.warn(
          "[Forge] reopenDesignPicker skipped — another operation is in flight",
        );
        return designId;
      }

      const controller = new AbortController();
      chooseResolverRef.current?.(designId);
      chooseResolverRef.current = null;
      abortRef.current?.abort();
      abortRef.current = controller;
      const { signal } = controller;

      // Reset the view back to the picker: model, params, confirmations,
      // plus the variant tiles. The selected designId is kept until a
      // real pick lands, so null keeps the prior fallback.
      stopActiveVariants();
      setPhase("choosing");
      setError("");
      setStatusMessage("Restoring your candidate designs…");
      setModel(null);
      setGuides([]);
      revisionRef.current = null;
      setParameters([]);
      setConfirmedValues({});
      confirmedValuesRef.current = {};
      setVariants([]);

      try {
        setHandoffIndex(null);
        const survivingIds = await rehydrateVariants({
          variantDesignIds: candidateIds,
          signal,
        });
        if (signal.aborted) return designId;
        if (survivingIds === null) {
          // Every candidate is gone — fall back to the prior design.
          setPhase("ready");
          if (runId) {
            storeDesignState(runId, {
              designId: designId ?? undefined,
              phase: "ready",
              variantDesignIds: candidateIds,
            });
          }
          return designId;
        }

        // Release the lock while parked on the user's pick.
        releaseBusy(lock);

        const pickedId = await new Promise<string | null>((resolve) => {
          chooseResolverRef.current = resolve;
        });
        if (signal.aborted) return designId;
        if (!acquireBusy(lock)) return designId;

        setVariants([]);

        // Pick landed — or the picker was closed without a pick, in which
        // case the previous design is restored exactly as if it had been
        // re-picked, so the design page simply comes back.
        const resolvedId = pickedId ?? designId;
        if (resolvedId === null) return designId;
        const priorHandoffIndex =
          designId === null ? null : (entry.handoffIndex ?? null);
        const resolvedHandoffIndex =
          pickedId !== null
            ? (entry.variantHandoffs?.[pickedId] ?? null)
            : priorHandoffIndex;
        setDesignId(resolvedId);
        setHandoffIndex(resolvedHandoffIndex);
        await loadGeometry(resolvedId);
        if (signal.aborted) return designId;
        if (runId) {
          storeDesignState(runId, {
            designId: resolvedId,
            phase: "calibrating",
            variantDesignIds: survivingIds,
            handoffIndex:
              resolvedHandoffIndex !== null
                ? resolvedHandoffIndex
                : undefined,
          });
        }

        const design = await getDesign(resolvedId);
        if (signal.aborted) return designId;
        const rawParams = design?.parameters ?? [];
        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          setPhase("ready");
          setStatusMessage("");
          if (runId) {
            storeDesignState(runId, {
              designId: resolvedId,
              phase: "ready",
              variantDesignIds: survivingIds,
              handoffIndex:
                resolvedHandoffIndex !== null
                  ? resolvedHandoffIndex
                  : undefined,
            });
          }
          return resolvedId;
        }

        await runCalibration({
          designId: resolvedId,
          calibratable,
          signal,
          runId,
        });
        return resolvedId;
      } catch (err) {
        if (signal.aborted) return designId;
        console.error("Forge picker re-open failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Could not reopen the design picker.",
        );
        setPhase("error");
        return designId;
      } finally {
        releaseBusy(lock);
      }
    },
    [designId, getDesign, runCalibration, stopActiveVariants, acquireBusy, releaseBusy, loadGeometry],
  );

  /*
    Restore a previously generated design for this run instead of paying for
    a full regeneration. Returns true when a design/variant set was restored.
  */
  // ── Rehydrate from the stored entry (refresh / run re-entry) ─────
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
      // message. The bootstrap embeds the picked variant's handoff, so the
      // recovery match also recovers that variant's handoff index.
      if (stored === null) {
        const recovered = await recoverDesignIdForRun({ handoffs });
        if (recovered) {
          stored = {
            designId: recovered.designId,
            phase: "ready",
            handoffIndex: recovered.handoffIndex,
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
          Only a "choosing" entry reopens the picker — a refresh mid-pick. A
          picked design lands directly on the design page.
        */
        const pickerIds =
          stored.phase === "choosing" ? stored.variantDesignIds : null;

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

          const pickedId = await new Promise<string | null>((resolve) => {
            chooseResolverRef.current = resolve;
          });
          targetDesignId = pickedId ?? undefined;
          if (signal.aborted) return false;
          if (!acquireBusy(lock)) return false;
          setVariants([]);
          // The restored picker resolves the pick's handoff from the
          // pairing recorded at generation time.
          setHandoffIndex(
            pickedId !== null && targetDesignId
              ? (stored.variantHandoffs?.[pickedId] ?? null)
              : null,
          );
          storeDesignState(runId, {
            designId: targetDesignId ?? undefined,
            phase: "calibrating",
            variantDesignIds: survivingIds,
            handoffIndex:
              targetDesignId !== undefined
                ? (stored.variantHandoffs?.[targetDesignId] ?? undefined)
                : undefined,
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
        setHandoffIndex(stored.handoffIndex ?? null);

        // A picked design is driven by the flow below, which stores its own
        // entries; normalize the entry in place so a legacy one written by
        // an older build drops its pre-refactor keys on first restore.
        if (pickerIds === null && runId) {
          storeDesignState(runId, {
            designId: targetDesignId,
            phase: stored.phase,
            variantDesignIds: stored.variantDesignIds,
            variantHandoffs: stored.variantHandoffs,
            handoffIndex: stored.handoffIndex,
          });
        }

        if (stored.phase === "calibrating") {
          const stream = subscribeDesignStream(targetDesignId, signal);
          if (signal.aborted) return false;
          // Wait only while a turn is actually live. A completed generation
          // replays `running: false` and then goes quiet. Mid-turn geometry
          // alarms adopt the revised mesh in place so the restore lands on
          // the agent's latest build, not the first streamed one.
          for (;;) {
            const { value: ev, done } = await stream.next();
            if (done || ev.type === "end" || ev.type === "error") break;
            if (ev.type === "running" && ev.data === false) break;
            if (ev.type === "geometry") {
              void applyGeometry(ev.data, targetDesignId);
            }
          }
          if (signal.aborted) return false;
        }

        const rawParams = design.parameters ?? [];
        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          const loaded = await loadGeometry(targetDesignId);
          if (signal.aborted) return false;
          if (loaded === null) {
            clearStoredDesignState(runId);
            return false;
          }
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
    [runCalibration, rehydrateVariants, acquireBusy, releaseBusy, applyGeometry],
  );

  /*
    Refinement round: the current design is duplicated once, the feedback is
    sent only to the copy (the source design is never re-sent, it is carried
    forward untouched), and the copy becomes the new current design — a
    linear version history with one entry per round, no picker park in
    between. If the copy has no calibratable parameters it goes straight to
    "ready"; otherwise its calibration wizard starts.
  */
  // ── Single-duplicate refinement round (feedback goes to a copy) ──
  const refineDesign = useCallback(
    async ({ feedback, runId }: { feedback: string; runId: string | null }) => {
      const source = designId;
      if (source === null) {
        console.warn("[Forge] refineDesign skipped — no current design");
        return;
      }

      const lock = {};
      if (!acquireBusy(lock)) {
        console.warn(
          "[Forge] refineDesign skipped — another operation is in flight",
        );
        return;
      }

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      const { signal } = controller;

      setPhase("initializing");
      setError("");
      setModel(null);
      setGuides([]);
      revisionRef.current = null;
      setParameters([]);

      try {
        const copyId = await duplicateDesign(source);
        await sendDesignMessage(copyId, feedback.trim());

        // Follow the copy's turn to its end; the stream replays the turn, so
        // multiple turns fire many running/running-false pairs — leaving on
        // the first boundary used to freeze the load on the first streamed
        // GLB. Each mid-turn geometry alarm adopts the revised mesh in
        // place, mirroring the Forge frontend's applyStreamEvent. Applied
        // outside the read loop so a slow fetch can't starve later frames;
        // concurrent alarms collapse through the deduped fetch.
        const stream = subscribeDesignStream(copyId, signal);
        let seenLiveTurn = false;
        for (;;) {
          const { value: ev, done } = await stream.next();
          if (done || ev.type === "end") break;
          if (ev.type === "running") {
            if (ev.data === true) seenLiveTurn = true;
          } else if (ev.type === "geometry") {
            void applyGeometry(ev.data, copyId);
          } else if (ev.type === "error") {
            throw new Error(ev.data || "Forge error during refinement");
          }
        }
        if (signal.aborted) return;

        // A boom that interrupted a live turn (`end` after running without
        // error: a context overflow, or the stop control mid-turn) means
        // the post-turn REST load below can hit a half-applied build; the
        // final `loadGeometry` decides. A replay-only turn with no live
        // activity can end cleanly when the design simply has no geometry
        // (e.g. a failed-build duplicate), so surface that as a real error
        // too.
        const loaded = await loadGeometry(copyId);
        if (signal.aborted) return;
        if (loaded === null) {
          if (seenLiveTurn) {
            throw new Error("Forge refinement failed; the design has no build.");
          }
          throw new Error("Forge did not return a renderable model.");
        }
        setVariants([]);
        setDesignId(copyId);
        setStatusMessage("");
        if (runId) {
          // The copy is built from the same handoff as its source.
          storeDesignState(runId, {
            designId: copyId,
            phase: "calibrating",
            handoffIndex: handoffIndex !== null ? handoffIndex : undefined,
          });
        }

        setPhase("calibrating");
        const design = await getDesign(copyId);
        if (signal.aborted) return;
        const rawParams = design?.parameters ?? [];
        const calibratable = rawParams.filter(isCalibratable);

        if (calibratable.length === 0) {
          setPhase("ready");
          if (runId) {
            storeDesignState(runId, {
              designId: copyId,
              phase: "ready",
              handoffIndex: handoffIndex !== null ? handoffIndex : undefined,
            });
          }
          return;
        }

        await runCalibration({
          designId: copyId,
          calibratable,
          signal,
          runId,
        });
      } catch (err) {
        if (signal.aborted) return;
        console.error("Forge refinement failed:", err);
        const serverMsg = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error;
        setError(
          serverMsg ??
            (err instanceof Error ? err.message : "Forge refinement failed."),
        );
        setPhase("error");
      } finally {
        releaseBusy(lock);
      }
    },
    [
      designId,
      handoffIndex,
      runCalibration,
      acquireBusy,
      releaseBusy,
      applyGeometry,
    ],
  );

  // ── Reset to idle (abort, stop, clear all shared state) ──────────
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    chooseResolverRef.current = null;
    stopActiveVariants();
    busyOwnerRef.current = null;
    setBusy(false);
    setVariants([]);
    setDesignId(null);
    setHandoffIndex(null);
    setPhase("idle");
    setModel(null);
    setGuides([]);
    revisionRef.current = null;
    setError("");
    setStatusMessage("");
    setParameters([]);
    setConfirmedValues({});
    confirmedValuesRef.current = {};
  }, [stopActiveVariants]);

  return {
    phase,
    model,
    guides,
    error,
    parameters,
    statusMessage,
    buildReport,
    designId,
    handoffIndex,
    variants,
    busy,
    settingParam,
    confirmedValues,
    generate,
    rehydrate,
    reloadCurrentDesignGeometry,
    reopenDesignPicker,
    refineDesign,
    chooseDesign,
    confirmParamValue,
    finishCalibration,
    reset,
  };
}
