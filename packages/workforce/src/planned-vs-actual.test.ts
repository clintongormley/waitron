import { describe, expect, it } from "vitest";
import type { WorkSession } from "./projection.js";
import { comparePlannedVsActual, type PlannedShift } from "./planned-vs-actual.js";

let seq = 0;

function shift(
  personId: string,
  startsAt: string,
  endsAt: string,
  opts: { startsOffsetMinutes?: number; endsOffsetMinutes?: number } = {},
): PlannedShift {
  seq += 1;
  return {
    shiftId: `s${seq}`,
    personId,
    startsAt,
    startsOffsetMinutes: opts.startsOffsetMinutes ?? 0,
    endsAt,
    endsOffsetMinutes: opts.endsOffsetMinutes ?? 0,
  };
}

/** A projected `WorkSession` — only the fields the read model reads carry meaning; `endedAt`/
 * `breakMinutes`/`locationId` and the wall offsets are set to inert values. */
function session(
  personId: string,
  workDate: string,
  startedAt: string,
  workedMinutes: number,
): WorkSession {
  return {
    personId,
    locationId: "loc-1",
    workDate,
    startedAt,
    startOffsetMinutes: 0,
    endedAt: startedAt,
    endOffsetMinutes: 0,
    breakMinutes: 0,
    workedMinutes,
  };
}

describe("comparePlannedVsActual", () => {
  it("matches a planned shift to the session worked the same local day (on time, in full)", () => {
    const rows = comparePlannedVsActual(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z")], // planned 480
      [session("p1", "2026-01-05", "2026-01-05T09:00:00Z", 480)], // worked 480, on time
    );
    expect(rows).toEqual([
      {
        personId: "p1",
        workDate: "2026-01-05",
        plannedMinutes: 480,
        workedMinutes: 480,
        lateMinutes: 0,
        noShow: false,
        unplanned: false,
      },
    ]);
  });

  it("reports lateness as the actual start later than the planned start", () => {
    const [row] = comparePlannedVsActual(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z")],
      [session("p1", "2026-01-05", "2026-01-05T09:15:00Z", 465)], // 15 min late
    );
    expect(row).toMatchObject({ lateMinutes: 15, noShow: false, unplanned: false });
  });

  it("does not report negative lateness when the worker starts early", () => {
    const [row] = comparePlannedVsActual(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z")],
      [session("p1", "2026-01-05", "2026-01-05T08:45:00Z", 495)], // 15 min early
    );
    expect(row!.lateMinutes).toBe(0);
  });

  it("flags a no-show: a planned shift with no session that day", () => {
    const [row] = comparePlannedVsActual(
      [shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z")],
      [],
    );
    expect(row).toMatchObject({
      workDate: "2026-01-05",
      plannedMinutes: 480,
      workedMinutes: 0,
      lateMinutes: 0,
      noShow: true,
      unplanned: false,
    });
  });

  it("flags unplanned work: a session with no planned shift that day", () => {
    const [row] = comparePlannedVsActual(
      [],
      [session("p1", "2026-01-05", "2026-01-05T09:00:00Z", 480)],
    );
    expect(row).toMatchObject({
      plannedMinutes: 0,
      workedMinutes: 480,
      lateMinutes: 0,
      noShow: false,
      unplanned: true,
    });
  });

  it("joins by LOCAL date via the shift's wall offset, not its UTC instant", () => {
    // Planned starts 2026-01-05T23:30Z +120 → local 2026-01-06; the session's workDate is 2026-01-06,
    // so they join. Against the raw UTC date (01-05) the shift would be a no-show and the session
    // unplanned — two spurious rows instead of one matched row.
    const rows = comparePlannedVsActual(
      [
        shift("p1", "2026-01-05T23:30:00Z", "2026-01-06T03:30:00Z", {
          startsOffsetMinutes: 120,
          endsOffsetMinutes: 120,
        }), // 240 min, local day 01-06 (23:30Z +120 = local 01:30)
      ],
      // startedAt is the ABSOLUTE instant; local 01:35 (5 min after the planned 01:30 start) is 23:35Z,
      // whose local date is still 01-06 — so it joins the shift and is 5 minutes late.
      [session("p1", "2026-01-06", "2026-01-05T23:35:00Z", 235)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workDate: "2026-01-06",
      plannedMinutes: 240,
      workedMinutes: 235,
      lateMinutes: 5,
      noShow: false,
      unplanned: false,
    });
  });

  it("sums the shifts of a split shift and takes the EARLIEST planned start for lateness", () => {
    const [row] = comparePlannedVsActual(
      [
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z"), // 240
        shift("p1", "2026-01-05T17:00:00Z", "2026-01-05T21:00:00Z"), // 240 → 480 planned
      ],
      [session("p1", "2026-01-05", "2026-01-05T09:10:00Z", 470)], // 10 min after the 09:00 first start
    );
    expect(row).toMatchObject({ plannedMinutes: 480, workedMinutes: 470, lateMinutes: 10 });
  });

  it("takes the earliest planned start for lateness even when shifts arrive out of order", () => {
    // The later-starting shift is listed FIRST, so the fold must lower `earliestStart` when the
    // second, earlier shift arrives — otherwise lateness would be measured from 17:00, not 09:00.
    const [row] = comparePlannedVsActual(
      [
        shift("p1", "2026-01-05T17:00:00Z", "2026-01-05T21:00:00Z"), // later half, listed first
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z"), // earlier half, listed second
      ],
      [session("p1", "2026-01-05", "2026-01-05T09:10:00Z", 470)], // 10 min after the 09:00 start
    );
    expect(row).toMatchObject({ plannedMinutes: 480, lateMinutes: 10 });
  });

  it("returns one row per (person, day), ordered by person then date", () => {
    const rows = comparePlannedVsActual(
      [
        shift("p2", "2026-01-06T09:00:00Z", "2026-01-06T17:00:00Z"),
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
      ],
      [
        session("p1", "2026-01-05", "2026-01-05T09:00:00Z", 480),
        session("p2", "2026-01-06", "2026-01-06T09:00:00Z", 480),
      ],
    );
    expect(rows.map((r) => `${r.personId}/${r.workDate}`)).toEqual([
      "p1/2026-01-05",
      "p2/2026-01-06",
    ]);
  });

  it("orders one person's several days by date (the date tiebreak within a person)", () => {
    const rows = comparePlannedVsActual(
      [
        shift("p1", "2026-01-07T09:00:00Z", "2026-01-07T17:00:00Z"),
        shift("p1", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
        shift("p1", "2026-01-06T09:00:00Z", "2026-01-06T17:00:00Z"),
      ],
      [],
    );
    expect(rows.map((r) => r.workDate)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
  });
});
