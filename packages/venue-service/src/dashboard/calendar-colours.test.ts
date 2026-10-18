import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { CALENDAR_COLOURS } from "../hours-types.js";
import {
  calendarColourChoices,
  firstUnusedCalendarColour,
  rememberedColourChoices,
} from "./calendar-colours.js";
import { PERIOD_COLOUR_TOKENS } from "./period-colour-styles.js";

it("offers every calendar colour in order, painted from its period fill and named by the label function", () => {
  const choices = calendarColourChoices((colour) => `name of ${colour}`);
  expect(choices.map((choice) => choice.value)).toEqual([...CALENDAR_COLOURS]);
  expect(choices.map((choice) => choice.fill)).toEqual(
    CALENDAR_COLOURS.map((colour) => PERIOD_COLOUR_TOKENS[colour].fill),
  );
  expect(choices.map((choice) => choice.label)).toEqual(
    CALENDAR_COLOURS.map((colour) => `name of ${colour}`),
  );
  expect(choices.every((choice) => (choice.usedBy ?? []).length === 0)).toBe(true);
});

it("names on each colour the users that have it, in the order given", () => {
  const choices = calendarColourChoices(
    (colour) => colour,
    [
      { name: "Lunch", colour: "red" },
      { name: "Dinner", colour: "blue" },
      { name: "Brunch", colour: "red" },
    ],
  );
  const usedBy = Object.fromEntries(choices.map((choice) => [choice.value, choice.usedBy ?? []]));
  expect(usedBy).toEqual({
    red: ["Lunch", "Brunch"],
    orange: [],
    amber: [],
    lime: [],
    green: [],
    teal: [],
    cyan: [],
    blue: ["Dinner"],
    indigo: [],
    purple: [],
    pink: [],
    brown: [],
    grey: [],
  });
});

it("a user whose colour is not in the palette marks nothing", () => {
  const choices = calendarColourChoices((colour) => colour, [{ name: "Odd", colour: "beige" }]);
  expect(choices.every((choice) => (choice.usedBy ?? []).length === 0)).toBe(true);
});

it("the first unused colour is the first in palette order no entry takes, and red when all are taken", () => {
  expect(firstUnusedCalendarColour([])).toBe("red");
  expect(firstUnusedCalendarColour([{ colour: "red" }, { colour: "orange" }])).toBe("amber");
  expect(firstUnusedCalendarColour(CALENDAR_COLOURS.map((colour) => ({ colour })))).toBe("red");
});

const startingLocale = currentLocale();
afterEach(() => setLocale(startingLocale));

it("remembered choices are the same array for the same users in the same language", () => {
  const choicesFor = rememberedColourChoices((colour) => colour);
  const users = [{ name: "Lunch", colour: "red" }];
  const first = choicesFor(users);
  expect(choicesFor(users)).toBe(first);
  expect(first.find((choice) => choice.value === "red")?.usedBy).toEqual(["Lunch"]);
});

it("remembered choices are built again for a new users array", () => {
  const choicesFor = rememberedColourChoices((colour) => colour);
  const first = choicesFor([{ name: "Lunch", colour: "red" }]);
  const next = choicesFor([{ name: "Dinner", colour: "blue" }]);
  expect(next).not.toBe(first);
  expect(next.find((choice) => choice.value === "blue")?.usedBy).toEqual(["Dinner"]);
  expect(next.find((choice) => choice.value === "red")?.usedBy).toEqual([]);
});

it("remembered choices are built again, with new labels, when the language changes", () => {
  setLocale("en");
  const choicesFor = rememberedColourChoices((colour) => `${currentLocale()} ${colour}`);
  const users = [{ name: "Lunch", colour: "red" }];
  const english = choicesFor(users);
  setLocale("es");
  const spanish = choicesFor(users);
  expect(spanish).not.toBe(english);
  expect(spanish[0]!.label).toBe("es red");
  expect(english[0]!.label).toBe("en red");
});
