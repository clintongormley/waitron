export const CALENDAR_COLOURS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
  "grey",
] as const;
export type CalendarColour = (typeof CALENDAR_COLOURS)[number];
