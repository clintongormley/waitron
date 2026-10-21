import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { seasonRefusalField, seasonRefusalText } from "./season-refusal.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

it("names no field for a path it does not know, or one that is not a string", () => {
  for (const field of ["save.x.name", "save.0.weeks", "delete", 3, undefined])
    expect(seasonRefusalField({ code: "season.invalid", params: { field } }), String(field)).toBe(
      undefined,
    );
  expect(seasonRefusalField({ code: "season.invalid" })).toBe(undefined);
  expect(
    seasonRefusalField({ code: "season.invalid", params: { field: "save.12.startsOn" } }),
  ).toEqual({
    index: 12,
    field: "startsOn",
    message: "Choose a day and a month.",
  });
});

it("says the change could not be saved for a season refusal it cannot word", () => {
  expect(seasonRefusalText({ code: "season.invalid", params: { field: "delete" } })).toBe(
    "The change could not be saved.",
  );
});

it("is empty for a refusal that names a field", () => {
  expect(
    seasonRefusalText({
      code: "season.invalid",
      params: { field: "save.0.name", reason: "taken" },
    }),
  ).toBe("");
});

it("words a refusal in Spanish", () => {
  setLocale("es");
  expect(
    seasonRefusalText({ code: "season.invalid", params: { field: "delete", reason: "last" } }),
  ).toBe("Un local conserva al menos una temporada.");
  expect(
    seasonRefusalField({ code: "season.invalid", params: { field: "save.0.colour" } })!.message,
  ).toBe("Elige un color.");
});
