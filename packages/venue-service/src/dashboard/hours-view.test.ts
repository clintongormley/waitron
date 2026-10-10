import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

it("fills each placeholder from its value", () => {
  expect(format("prep.station_reordered", { name: "Bar", index: "2", total: "3" })).toBe(
    "Bar is now 2 of 3.",
  );
});

it("inserts a value containing $& as written", () => {
  expect(format("prep.station_reordered", { name: "Bar $&", index: "2 $'", total: "3" })).toBe(
    "Bar $& is now 2 $' of 3.",
  );
});

it("does not fill a placeholder that arrived inside another value", () => {
  expect(format("prep.station_reordered", { name: "Bar {index}", index: "2", total: "3" })).toBe(
    "Bar {index} is now 2 of 3.",
  );
});

it("leaves a placeholder with no value as it is", () => {
  expect(format("prep.station_reordered", { name: "Bar" })).toBe("Bar is now {index} of {total}.");
});
