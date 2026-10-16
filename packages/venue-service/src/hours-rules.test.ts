import { expect, it } from "vitest";
import { addDays, rangeDates, weekdayOf } from "./hours-rules.js";

it("steps and names days in years below 100 without reading them as 1900s", () => {
  expect(addDays("0100-01-01", -4)).toBe("0099-12-28");
  expect(addDays("0099-12-28", 1)).toBe("0099-12-29");
  expect(addDays("0099-12-31", 1)).toBe("0100-01-01");
  expect(weekdayOf("0099-12-28")).toBe(1);
  expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
});

it("lists a run that ends on 9999-12-31", () => {
  expect(rangeDates("9999-12-30", "9999-12-31")).toEqual(["9999-12-30", "9999-12-31"]);
});
