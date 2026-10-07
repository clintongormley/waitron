import type { SpecialDateParticipant } from "./hours.js";
import { MENU_TIMETABLE_CALENDAR_PARTICIPANT } from "./menu-timetable.js";

/** The participants the routes hand to special-date duplication, moves and deletion. */
export const VENUE_SERVICE_CALENDAR_PARTICIPANTS: readonly SpecialDateParticipant[] = [
  MENU_TIMETABLE_CALENDAR_PARTICIPANT,
];
