import { describe, expect, it } from "vitest";

import { photosSent } from "@/lib/intake";

describe("photosSent", () => {
  it("counts the image parts of user turns only", () => {
    expect(
      photosSent([
        { role: "assistant", content: "Hello" },
        {
          role: "user",
          content: [
            { type: "text", text: "intake" },
            { type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,AA" },
            { type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,AB" },
          ],
        },
        { role: "assistant", content: [{ type: "user-image", imageId: "x" }] },
        { role: "user", content: "a text-only answer" },
        { role: "user", content: [{ type: "user-image", imageId: "c" }] },
      ]),
    ).toBe(3);
  });
});
