import { describe, expect, it } from "vitest";

import { forgeReferencePhotoIds, handoffsOf, referencePhotoParts, stageOf } from "@/lib/flow";
import type { FlowMessage, FlowRun, RunningDoc } from "@/lib/types";

const S2 = "node-s2";
const run = (patch: Partial<FlowRun>): FlowRun => ({
  _id: "run",
  pipelineId: "main",
  status: "idle",
  currentNodeId: "node-s0",
  runningDoc: {},
  ...patch,
});

const message = (parts: unknown): FlowMessage =>
  ({ role: "user", content: parts }) as FlowMessage;

/* A hydrated photo part as the API's read path emits it: imageId metadata
   stamped onto the file part by the backend. */
const photo = (id: string): unknown =>
  ({ type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,xxx", imageId: id });

/* A photo turn as the transcript renders it: the user's text, then one id-
   tagged photo part per uploaded asset. */
const photoTurn = (ids: string[], text = "description"): FlowMessage =>
  message([
    { type: "text", text },
    ...ids.map(photo),
  ]);

const transcript = (): FlowMessage[] => [
  photoTurn(["aipihhca009as", "dah0a8ef0", "qc8k2mtp05zt1"]),
  message([{ type: "text", text: "hello" }]),
  photoTurn(["v41m1i8k09tzd"], "clarification"),
];

describe("forgeReferencePhotoIds", () => {
  it("reads a JSON array of id strings", () => {
    const doc = { forge_reference_photos: '["dah0a8ef0", "aipihhca009as"]' } as RunningDoc;
    expect(forgeReferencePhotoIds(doc)).toEqual(["dah0a8ef0", "aipihhca009as"]);
  });

  it("dedupes but preserves order in the canonical array", () => {
    const doc = {
      forge_reference_photos: '["qc8k2mtp05zt1", "dah0a8ef0", "qc8k2mtp05zt1"]',
    } as RunningDoc;
    expect(forgeReferencePhotoIds(doc)).toEqual(["qc8k2mtp05zt1", "dah0a8ef0"]);
  });

  it("drops empty strings from the array", () => {
    const doc = { forge_reference_photos: '["", "dah0a8ef0"]' } as RunningDoc;
    expect(forgeReferencePhotoIds(doc)).toEqual(["dah0a8ef0"]);
  });

  it("tolerates malformed docs by matching id-shaped tokens on any line", () => {
    const doc = {
      forge_reference_photos:
        'stored **forge_reference_photos**: ["dah0a8ef0", "aipihhca009as"] photos the agent chose',
    } as RunningDoc;
    expect(forgeReferencePhotoIds(doc)).toEqual(["dah0a8ef0", "aipihhca009as"]);
  });

  it("ignores prose when the field is a proper id array", () => {
    const doc = {
      forge_reference_photos: '["dah0a8ef0"] // photo 1, the crack macro',
    } as RunningDoc;
    expect(forgeReferencePhotoIds(doc)).toEqual(["dah0a8ef0"]);
  });

  it("is empty for a missing, blank, or non-array-of-strings field", () => {
    expect(forgeReferencePhotoIds(undefined)).toEqual([]);
    expect(forgeReferencePhotoIds({} as RunningDoc)).toEqual([]);
    expect(forgeReferencePhotoIds({ forge_reference_photos: "" } as RunningDoc)).toEqual([]);
    expect(forgeReferencePhotoIds({ forge_reference_photos: '{"a":1}' } as RunningDoc)).toEqual([]);
    expect(forgeReferencePhotoIds({ forge_reference_photos: '["ok", 5, null]' } as RunningDoc)).toEqual(["ok"]);
  });
});

describe("referencePhotoParts", () => {
  it("picks transcript photos exactly by the ids their message declared", () => {
    const doc = { forge_reference_photos: '["dah0a8ef0", "aipihhca009as"]' } as RunningDoc;
    const picked = referencePhotoParts(doc, transcript());
    expect(picked).toEqual([photo("dah0a8ef0"), photo("aipihhca009as")]);
  });

  it("skips ids the transcript does not hold", () => {
    const doc = { forge_reference_photos: '["nope1nope1", "dah0a8ef0"]' } as RunningDoc;
    expect(referencePhotoParts(doc, transcript())).toEqual([photo("dah0a8ef0")]);
  });

  it("sends no photos when the document lists none", () => {
    expect(referencePhotoParts(undefined, transcript())).toEqual([]);
    expect(referencePhotoParts({ forge_reference_photos: "" } as RunningDoc, transcript())).toEqual([]);
    expect(referencePhotoParts({ forge_reference_photos: "broken" } as RunningDoc, transcript()))
      .toEqual([]);
  });

  it("caps the photo list, keeping the document's order first", () => {
    const doc = { forge_reference_photos: '["qc8k2mtp05zt1"]' } as RunningDoc;
    expect(referencePhotoParts(doc, transcript(), 1)).toHaveLength(1);
    expect(referencePhotoParts(doc, transcript(), 1)).toEqual([photo("qc8k2mtp05zt1")]);
  });

  it("ignores photo parts without imageId metadata", () => {
    const doc = { forge_reference_photos: '["dah0a8ef0"]' } as RunningDoc;
    expect(
      referencePhotoParts(doc, [
        message([{ type: "text", text: "no ids here" }, { type: "file", data: "data:image/jpeg;base64,xxx" }]),
      ]),
    ).toEqual([]);
  });

  it("treats id-tagged user-image markers and file parts uniformly", () => {
    const doc = { forge_reference_photos: '["marker1", "file1xyz"]' } as RunningDoc;
    const picked = referencePhotoParts(doc, [
      message([
        { type: "text", text: "two" },
        { type: "user-image", imageId: "marker1" },
        photo("file1xyz"),
      ]),
    ]);
    expect(picked).toEqual([
      { type: "user-image", imageId: "marker1" },
      photo("file1xyz"),
    ]);
  });
});

describe("handoffsOf", () => {
  it("keeps the non-empty handoffs in order, trimmed", () => {
    expect(
      handoffsOf({ forge_handoff_1: " a ", forge_handoff_2: "", forge_handoff_3: "c" }),
    ).toEqual(["a", "c"]);
    expect(handoffsOf(undefined)).toEqual([]);
  });
});

describe("stageOf", () => {
  it("is intake for an untouched run with no user turn", () => {
    expect(stageOf(run({}), false, S2)).toBe("intake");
  });

  it("is planning once the intake was sent, even before the pipeline wrote anything", () => {
    expect(stageOf(run({}), true, S2)).toBe("planning");
    expect(stageOf(run({ status: "running" }), false, S2)).toBe("planning");
  });

  it("is clarification while the run waits on the clarification node", () => {
    const parked = run({ currentNodeId: S2, runningDoc: { repair_state: "x" } });
    expect(stageOf(parked, true, S2)).toBe("clarification");
    expect(stageOf({ ...parked, status: "running" }, true, S2)).toBe("planning");
  });

  it("is designs once the handoff node has finished, and stays there", () => {
    const handed = run({ runningDoc: { forge_handoff_1: "brief" } });
    expect(stageOf({ ...handed, status: "running" }, true, S2)).toBe("planning");
    expect(stageOf(handed, true, S2)).toBe("designs");
    expect(stageOf({ ...handed, currentNodeId: S2 }, true, S2)).toBe("designs");
  });
});
