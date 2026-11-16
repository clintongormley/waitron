import { expect, it } from "vitest";
import { addMonths } from "./calendar-grid.js";

it("steps across years and preserves the month just beyond either calendar bound", () => {
  expect(addMonths("2026-12", 1)).toBe("2027-01");
  expect(addMonths("0100-02", -1)).toBe("0100-01");
  expect(addMonths("9998-12", 1)).toBe("9999-01");
});
