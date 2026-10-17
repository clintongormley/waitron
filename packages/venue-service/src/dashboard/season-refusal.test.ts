import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { seasonRefusalField, seasonRefusalText } from "./season-refusal.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

const seasons = [{ id: "autumn", name: "Autumn" }];

it("names no field for a path it does not know, or one that is not a string", () => {
  for (const field of ["save.x.name", "save.0.weeks", "delete", 3, undefined])
    expect(seasonRefusalField({ code: "season.invalid", params: { field } }), String(field)).toBe(
      undefined,
    );
  expect(seasonRefusalField({ code: "season.invalid" })).toBe(undefined);
  expect(
    seasonRefusalField({
      code: "season.invalid",
      params: { field: "save.0.name", reason: "end_offset" },
    }),
  ).toBe(undefined);
  expect(
    seasonRefusalField({ code: "season.invalid", params: { field: "save.12.startsOn" } }),
  ).toEqual({
    index: 12,
    field: "startsOn",
    message: "Choose a day and a month.",
  });
});

it("says the change could not be saved for a season refusal it cannot word", () => {
  for (const params of [
    { field: "delete" },
    { field: "seasons", reason: "end_offset", seasonId: "gone", weekday: 2 },
    { field: "seasons", reason: "end_offset", seasonId: "autumn", weekday: 7 },
    { field: "seasons", reason: "end_offset", seasonId: "autumn", weekday: 1.5 },
    { field: "seasons", reason: "end_offset", seasonId: "autumn" },
  ])
    expect(
      seasonRefusalText({ code: "season.invalid", params }, seasons, []),
      JSON.stringify(params),
    ).toBe("The change could not be saved.");
  expect(
    seasonRefusalText(
      {
        code: "season.invalid",
        params: { field: "seasons", reason: "end_offset", seasonId: "autumn", weekday: 0 },
      },
      seasons,
      [],
    ),
  ).toBe("A period’s end offset would run into Autumn on Sunday.");
});

it("is empty for a refusal that names a field", () => {
  expect(
    seasonRefusalText(
      { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } },
      seasons,
      [],
    ),
  ).toBe("");
});

it("words a refusal in Spanish", () => {
  setLocale("es");
  expect(
    seasonRefusalText(
      { code: "season.invalid", params: { field: "delete", reason: "last" } },
      seasons,
      [],
    ),
  ).toBe("Un local conserva al menos una temporada.");
  expect(
    seasonRefusalField({ code: "season.invalid", params: { field: "save.0.colour" } })!.message,
  ).toBe("Elige un color.");
});
