import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { clockChangeConflictText } from "./clock-change-conflict.js";
import { VENUE_SERVICE_STRINGS } from "./strings.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

const conflict = (
  reason: string,
  names: Record<string, string> = { periodName: "Dinner" },
  timeZone = "Europe/Madrid",
) => ({
  code: "hours.clock_change_conflict",
  params: {
    dayCutover: "03:00",
    startsAt: "2026-10-21T01:00:00.000Z",
    timeZone,
    conflicts: [
      { departmentId: "d1", ...names, startsAt: "21:00", endsAt: "02:45", rangeIndex: 0, reason },
    ],
    conflictCount: 1,
  },
});

it("names the clashing range, the new start, when it takes effect and why", () => {
  expect(clockChangeConflictText(conflict("transition_strip"))).toBe(
    "Dinner 21:00–02:45 clashes with the new business-day start, 03:00 from Wed 21 Oct, 03:00: Hours overlap the changed start.",
  );
});

it("says it in Spanish", () => {
  setLocale("es");
  expect(clockChangeConflictText(conflict("transition_strip"))).toBe(
    "Dinner 21:00–02:45 choca con el nuevo inicio del día de trabajo, 03:00 desde mié 21 oct, 03:00: El horario coincide con el cambio de inicio.",
  );
});

it.each([
  ["range", "Crosses the new start"],
  ["overlap", "Invalid or overlapping range"],
  ["endpoint_day", "Moves to another day"],
  ["all_day", "All-day range needs new hours"],
])("words the %s reason", (reason, label) => {
  expect(clockChangeConflictText(conflict(reason))).toBe(
    `Dinner 21:00–02:45 clashes with the new business-day start, 03:00 from Wed 21 Oct, 03:00: ${label}.`,
  );
});

it("has no last-orders reason to word", () => {
  expect(Object.keys(VENUE_SERVICE_STRINGS.en)).not.toContain("hours.conflict.sending_cutoff");
  expect(Object.keys(VENUE_SERVICE_STRINGS.es)).not.toContain("hours.conflict.sending_cutoff");
});

it("falls back from the period to the zone, then the department", () => {
  expect(
    clockChangeConflictText(conflict("range", { zoneName: "Terrace", departmentName: "Bar" })),
  ).toMatch(/^Terrace 21:00–02:45 clashes/);
  expect(clockChangeConflictText(conflict("range", { departmentName: "Bar" }))).toMatch(
    /^Bar 21:00–02:45 clashes/,
  );
});

it("reads the moment in the time zone the refusal carries", () => {
  expect(
    clockChangeConflictText(conflict("range", { periodName: "Dinner" }, "Europe/London")),
  ).toContain("from Wed 21 Oct, 02:00:");
});

it("words no other refusal", () => {
  expect(clockChangeConflictText({ code: "hours.clock_changed" })).toBeUndefined();
});
