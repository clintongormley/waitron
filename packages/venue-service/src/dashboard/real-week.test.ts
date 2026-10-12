import { expect, it } from "vitest";
import { seasonIdOn } from "./real-week.js";

const seasons = [
  { id: "winter", name: "Winter", startsOn: "12-01" },
  { id: "autumn", name: "Autumn", startsOn: "09-01" },
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
