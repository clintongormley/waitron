import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

it("fills each placeholder from its value", () => {
  expect(format("prep.test_extra_made", { name: "Cheese", station: "Grill" })).toBe(
    "Cheese: made separately at Grill",
  );
});

it("inserts a value containing $& as written", () => {
  expect(format("prep.test_extra_made", { name: "Cheese $&", station: "Grill $'" })).toBe(
    "Cheese $&: made separately at Grill $'",
  );
});

it("does not fill a placeholder that arrived inside another value", () => {
  expect(format("prep.test_extra_made", { name: "Cheese {station}", station: "Grill" })).toBe(
    "Cheese {station}: made separately at Grill",
  );
});

it("leaves a placeholder with no value as it is", () => {
  expect(format("prep.test_extra_made", { name: "Cheese" })).toBe(
    "Cheese: made separately at {station}",
  );
});
