import { describe, expect, it } from "vitest";
import { modifierSnapshotLabels } from "./modifier-snapshot-labels.js";

describe("modifierSnapshotLabels", () => {
  it("prints text and options selections and leaves priced extras to their child lines", () => {
    expect(
      modifierSnapshotLabels(
        [
          { modifierId: "text", name: { fr: "Message" }, type: "text", text: "Happy birthday" },
          { modifierId: "options", name: {}, type: "options", choiceId: "one", choiceName: {} },
          {
            modifierId: "extras",
            name: { en: "Extras" },
            type: "extras",
            choices: [{ choiceId: "cream", name: { en: "Cream" }, quantity: 2 }],
          },
        ],
        "en",
      ),
    ).toEqual(["Message: Happy birthday", ": "]);
  });
});
