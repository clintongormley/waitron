import { expect, it } from "vitest";
import type { SpecialDateInput } from "./hours-types.js";
import { parseSpecialDateInput } from "./hours-rules.js";

it("accepts the named-day editor's input without station cells", () => {
  const input: SpecialDateInput = {
    date: "2026-12-25",
    name: "Christmas",
    kind: "holiday",
    repeats: true,
    ownHours: false,
    closeWholeVenue: true,
  };
  expect(parseSpecialDateInput(input)).toEqual({
    date: "2026-12-25",
    name: "Christmas",
    kind: "holiday",
    repeats: true,
    ownHours: false,
    closeWholeVenue: true,
  });
});
