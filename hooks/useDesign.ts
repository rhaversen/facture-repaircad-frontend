"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Group } from "three";

import {
  designStream,
  errorText,
  fetchGeometry,
  getDesign,
  sendDesignMessage,
  setParameters,
} from "@/lib/forge";
import { loadGlb } from "@/lib/glb";
import type { Design, GeometrySummary, Guide, Parameter } from "@/lib/types";

const RECONNECT_MS = 3000;

/*
  One Forge design, live. The design's stream is the single source of change:
  agent turns and parameter rebuilds both arrive on it, so this hook only ever
  reacts to it (plus one GET on connect). The model follows the stored
  geometry revision.
*/
export function useDesign(designId: string) {
  const [design, setDesign] = useState<Design | null>(null);
  const [missing, setMissing] = useState(false);
  // Null until the stream has said whether a turn is live.
  const [running, setRunning] = useState<boolean | null>(null);
  const [model, setModel] = useState<Group | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const shownRevision = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function showGeometry(geometry: GeometrySummary | null) {
      if (geometry === null || geometry.revision === shownRevision.current) return;
      shownRevision.current = geometry.revision;
      try {
        const scene = await loadGlb(designId, geometry.revision, async () => {
          const glb = await fetchGeometry(designId);
          if (glb === null) throw new Error("The design has no stored model.");
          return glb;
        });
        // A newer revision may have started loading meanwhile; it wins.
        if (!signal.aborted && shownRevision.current === geometry.revision) setModel(scene);
      } catch (err) {
        // Let the next sync retry this revision.
        if (shownRevision.current === geometry.revision) shownRevision.current = null;
        throw err;
      }
    }

    async function sync() {
      const next = await getDesign(designId);
      if (signal.aborted) return;
      if (next === null) {
        setMissing(true);
        controller.abort();
        return;
      }
      setDesign(next);
      await showGeometry(next.geometry);
    }

    // Stays connected for the hook's life, reconnecting after drops; each
    // (re)connect re-reads the design so nothing missed while away is lost.
    async function follow() {
      while (!signal.aborted) {
        try {
          const stream = designStream(designId, signal);
          void sync().catch((err) => console.warn("Design sync failed:", err));
          for await (const event of stream) {
            if (event.type === "running") setRunning(event.running);
            if (event.type === "parameters") {
              setDesign((d) => (d ? { ...d, parameters: event.parameters } : d));
            }
            if (event.type === "geometry") {
              setDesign((d) => (d ? { ...d, geometry: event.geometry } : d));
              void showGeometry(event.geometry).catch((err) =>
                console.warn("Model load failed:", err),
              );
            }
            if (event.type === "end") {
              setRunning(false);
              void sync().catch((err) => console.warn("Design sync failed:", err));
            }
          }
        } catch (err) {
          if (signal.aborted) return;
          console.warn("Design stream dropped:", err);
        }
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
      }
    }

    void follow();
    return () => controller.abort();
  }, [designId]);

  /* The rebuild's model and parameters also come in on the stream; the reply
     only tells whether the values were accepted. */
  const setParameter = useCallback(async (name: string, value: number | null) => {
    setApplying(true);
    setError("");
    try {
      const result = await setParameters(designId, { [name]: value });
      setDesign((d) => (d ? { ...d, parameters: result.parameters, geometry: result.geometry } : d));
      if (result.build !== null && !result.build.ok) {
        setError("The model could not be fully rebuilt with this value.");
      }
    } catch (err) {
      setError(errorText(err, "Could not apply the change."));
    } finally {
      setApplying(false);
    }
  }, [designId]);

  const send = useCallback(async (message: string) => {
    setError("");
    setRunning(true);
    try {
      await sendDesignMessage(designId, message);
    } catch (err) {
      setRunning(false);
      setError(errorText(err, "Could not send the change to Forge."));
    }
  }, [designId]);

  const guides: Guide[] = design?.geometry?.guides ?? [];
  const parameters: Parameter[] = (design?.parameters ?? []).filter((p) => p.min !== p.max);
  return { design, missing, running, model, guides, parameters, applying, error, setParameter, send };
}
