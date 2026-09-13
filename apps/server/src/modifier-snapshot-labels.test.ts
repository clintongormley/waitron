import { describe, expect, it } from "vitest";
import { modifierSnapshotLabels } from "./modifier-snapshot-labels.js";

describe("modifierSnapshotLabels", () => {
  it("uses saved labels, keeps an explicit no, and leaves priced extras to their child lines", () => {
    expect(
      modifierSnapshotLabels(
        [
          { modifierId: "text", name: { fr: "Message" }, type: "text", text: "Happy birthday" },
          { modifierId: "options", name: {}, type: "options", choiceId: "one", choiceName: {} },
          {
            modifierId: "yes",
            name: { en: "Ice" },
            type: "yes-no",
            value: true,
            label: { en: "With ice" },
          },
          {
            modifierId: "no",
            name: { en: "Ice" },
            type: "yes-no",
            value: false,
            label: { en: "Without ice" },
          },
          {
            modifierId: "extras",
            name: { en: "Extras" },
            type: "extras",
            choices: [{ choiceId: "cream", name: { en: "Cream" }, quantity: 2 }],
          },
        ],
        "en",
      ),
    ).toEqual(["Message: Happy birthday", ": ", "Ice: With ice", "Ice: Without ice"]);
  });
});
