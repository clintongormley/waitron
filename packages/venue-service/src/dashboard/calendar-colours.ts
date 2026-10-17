import { currentLocale } from "@waitron/dashboard-kit";
import type { ColourChoice } from "@waitron/ui";
import { CALENDAR_COLOURS, type CalendarColour } from "../hours-types.js";
import { PERIOD_COLOUR_TOKENS } from "./period-colour-styles.js";

export interface ColourUser {
  name: string;
  colour: string;
}

export const NO_COLOUR_USERS: readonly ColourUser[] = [];

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

/**
 * `calendarColourChoices` that hands back the same array while neither the users array nor the
 * language changes, so a redraw does not give the chooser new choices.
 */
export function rememberedColourChoices(
  label: (colour: CalendarColour) => string,
): (users: readonly ColourUser[]) => ColourChoice[] {
  let last: { users: readonly ColourUser[]; locale: string; choices: ColourChoice[] } | undefined;
  return (users) => {
    const locale = currentLocale();
    if (last?.users !== users || last.locale !== locale)
      last = { users, locale, choices: calendarColourChoices(label, users) };
    return last.choices;
  };
}

/** The first calendar colour no user has; the first colour when every one is taken. */
export function firstUnusedCalendarColour(users: readonly { colour: string }[]): CalendarColour {
  return (
    CALENDAR_COLOURS.find((colour) => !users.some((user) => user.colour === colour)) ??
    CALENDAR_COLOURS[0]
  );
}
