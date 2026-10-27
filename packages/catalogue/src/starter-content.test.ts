import { describe, expect, it } from "vitest";
import { STARTER_CONTENT_LANGUAGES } from "@waitron/country-packs";
import { FIRST_MENU_NAME, STARTER_UNITS } from "./provisioning.js";
import { STARTER_MENU_NAMES, STARTER_UNIT_NAMES } from "./starter-content.js";

describe("starter-content", () => {
  it("has an entry for every starter unit, and none for anything else", () => {
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

  it("has an entry for the first menu, and none for anything else, with a written, trimmed staff name", () => {
    expect(Object.keys(STARTER_MENU_NAMES)).toEqual([FIRST_MENU_NAME]);
    const word: string = STARTER_MENU_NAMES[FIRST_MENU_NAME].es;
    expect(word).not.toBe("");
    expect(word).toBe(word.trim());
  });
});
