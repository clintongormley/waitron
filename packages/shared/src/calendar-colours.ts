export const CALENDAR_COLOURS = [
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
  "brown",
  "grey",
] as const;
export type CalendarColour = (typeof CALENDAR_COLOURS)[number];
