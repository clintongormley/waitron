import { describe, expect, it } from "vitest";
import { STARTER_CONTENT_LANGUAGES } from "@waitron/country-packs";
import { STARTER_UNITS } from "./provisioning.js";
import { STARTER_UNIT_NAMES } from "./starter-content.js";

describe("starter content", () => {
  it("has an entry for every starter unit and no other", () => {
    expect(Object.keys(STARTER_UNIT_NAMES)).toEqual(STARTER_UNITS.map((unit) => unit.staffName));
  });

  it.each(STARTER_CONTENT_LANGUAGES)(
    "gives every starter unit a written, trimmed name in %s",
    (language) => {
      for (const words of Object.values(STARTER_UNIT_NAMES)) {
        const word: string = words[language];
        expect(word).not.toBe("");
        expect(word).toBe(word.trim());
      }
    },
  );
});
