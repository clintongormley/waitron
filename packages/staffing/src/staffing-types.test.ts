import { describe, expect, expectTypeOf, it } from "vitest";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import type { CalendarColour } from "./staffing-types.js";

// Every member, keyed by the type: a member missing here, or one the type lacks, fails to compile.
const EVERY_COLOUR: Record<CalendarColour, true> = {
  red: true,
  amber: true,
  grey: true,
  blue: true,
  green: true,
  purple: true,
};

describe("CalendarColour", () => {
  it("has the same members as venue-service's CALENDAR_COLOURS", () => {
    expectTypeOf<CalendarColour>().toEqualTypeOf<(typeof CALENDAR_COLOURS)[number]>();
    expect(Object.keys(EVERY_COLOUR).sort()).toEqual([...CALENDAR_COLOURS].sort());
  });
});
