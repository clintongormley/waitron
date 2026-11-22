import { expect, it } from "vitest";
import { addMonths } from "./calendar-grid.js";

it("steps across years and preserves the month just beyond either calendar bound", () => {
  expect(addMonths("2026-12", 1)).toBe("2027-01");
  expect(addMonths("0100-02", -1)).toBe("0100-01");
  expect(addMonths("9998-12", 1)).toBe("9999-01");
});

it("steps across and within years 0 to 99 without reading them as 1900 to 1999", () => {
  expect(addMonths("0099-12", 1)).toBe("0100-01");
  expect(addMonths("0100-01", -1)).toBe("0099-12");
  expect(addMonths("0050-06", 7)).toBe("0051-01");
  expect(addMonths("0001-01", -1)).toBe("0000-12");
});
