import { expect, it } from "vitest";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { en, es, type StringKey } from "./strings.js";

// The Business-day dialog and the Opening hours screens name the same clash reasons.
const SAME_REASON: readonly (readonly [StringKey, string])[] = [
  ["business_day.conflict_range", "hours.conflict.range"],
  ["business_day.conflict_overlap", "hours.conflict.overlap"],
  ["business_day.conflict_endpoint", "hours.conflict.endpoint_day"],
  ["business_day.conflict_all_day", "hours.conflict.all_day"],
  ["business_day.conflict_strip", "hours.conflict.transition_strip"],
];

const hours = DASHBOARD_MODULES.find((module) => module.module === "venue-service")!.strings;

it.each([
  ["English", en, hours.en],
  ["Spanish", es, hours.es],
] as const)("the Business-day clash labels say what Opening hours says, in %s", (_, app, own) => {
  const theirs = SAME_REASON.map(([, key]) => own[key]);
  expect(theirs.every((label) => typeof label === "string" && label !== "")).toBe(true);
  expect(SAME_REASON.map(([key]) => app[key])).toEqual(theirs);
});

it("names no last-orders clash in either language", () => {
  for (const strings of [en, es, hours.en, hours.es])
    expect(Object.keys(strings).filter((key) => /conflict(_|\.)sending/.test(key))).toEqual([]);
});
