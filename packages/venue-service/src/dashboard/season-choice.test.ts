import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { chosenSeasonId, seasonWeek } from "./season-choice.js";

const seasons = [
  { id: "winter", name: "Winter", startsOn: "12-01" },
  { id: "spring", name: "Spring", startsOn: "03-01" },
  { id: "summer", name: "Summer", startsOn: "06-01" },
];
beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

it("chooses the requested season when the venue has it", () => {
  expect(chosenSeasonId(seasons, "spring", "summer")).toBe("summer");
});
it("falls back to the current season when the requested one is unknown or absent", () => {
  expect(chosenSeasonId(seasons, "spring", "autumn")).toBe("spring");
  expect(chosenSeasonId(seasons, "spring", "")).toBe("spring");
});
it("falls back to the first season when there is no current season", () => {
  expect(chosenSeasonId(seasons, null, "autumn")).toBe("winter");
});
it("chooses no season for a venue with none", () => {
  expect(chosenSeasonId([], null, "winter")).toBe("");
});
it("reads the named season's week, and no week for an unknown season", () => {
  const weeks = [
    { seasonId: "winter", week: [{ weekday: 1 }] },
    { seasonId: "spring", week: [{ weekday: 2 }] },
  ];
  expect(seasonWeek(weeks, "spring")).toEqual([{ weekday: 2 }]);
  expect(seasonWeek(weeks, "autumn")).toEqual([]);
});
