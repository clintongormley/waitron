import { expect, it } from "vitest";
import { CALENDAR_COLOURS } from "../hours-types.js";
import { calendarColourChoices, firstUnusedCalendarColour } from "./calendar-colours.js";
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
    amber: [],
    grey: [],
    blue: ["Dinner"],
    green: [],
    purple: [],
  });
});

it("a user whose colour is not in the palette marks nothing", () => {
  const choices = calendarColourChoices((colour) => colour, [{ name: "Odd", colour: "pink" }]);
  expect(choices.every((choice) => (choice.usedBy ?? []).length === 0)).toBe(true);
});

it("the first unused colour is the first in palette order no entry takes, and red when all are taken", () => {
  expect(firstUnusedCalendarColour([])).toBe("red");
  expect(firstUnusedCalendarColour(["red", "amber"])).toBe("grey");
  expect(firstUnusedCalendarColour([...CALENDAR_COLOURS])).toBe("red");
});
