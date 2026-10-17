import { expect, it } from "vitest";
import type { Season } from "../season-rules.js";
import { seasonIdOn } from "./season-week-view.js";

const seasons: Season[] = [
  { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
  { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" },
];
it.each([
  ["2030-11-30", "autumn"],
  ["2030-12-01", "winter"],
  ["2031-02-28", "winter"],
  ["2031-09-01", "autumn"],
])("holds %s in its own season", (date, seasonId) => {
  expect(seasonIdOn(seasons, date)).toBe(seasonId);
});
it("holds no date in a venue with no seasons", () => {
  expect(seasonIdOn([], "2030-12-01")).toBe("");
});
