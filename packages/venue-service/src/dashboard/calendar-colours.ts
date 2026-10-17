import type { ColourChoice } from "@waitron/ui";
import { CALENDAR_COLOURS, type CalendarColour } from "../hours-types.js";
import { PERIOD_COLOUR_TOKENS } from "./period-colour-styles.js";

export interface ColourUser {
  name: string;
  colour: string;
}

/** Every calendar colour as a chooser choice, in palette order, naming the users that have it. */
export function calendarColourChoices(
  label: (colour: CalendarColour) => string,
  users: readonly ColourUser[] = [],
): ColourChoice[] {
  return CALENDAR_COLOURS.map((colour) => ({
    value: colour,
    label: label(colour),
    fill: PERIOD_COLOUR_TOKENS[colour].fill,
    usedBy: users.filter((user) => user.colour === colour).map((user) => user.name),
  }));
}

/** The first calendar colour no entry of `used` is; the first colour when every one is. */
export function firstUnusedCalendarColour(used: readonly string[]): CalendarColour {
  return CALENDAR_COLOURS.find((colour) => !used.includes(colour)) ?? CALENDAR_COLOURS[0];
}
