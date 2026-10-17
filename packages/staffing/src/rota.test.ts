import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  kitchenStations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  departmentDayRanges,
  departmentDays,
  departments,
  menuPeriods,
  seasons,
  specialDayDates,
  specialDays,
} from "@waitron/venue-service";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  absences,
  employments,
  shifts,
  shiftSwaps,
  listShiftsForPerson,
} from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import * as staffing from "./index.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { saveSeasonStaffing } from "./paint.js";
import { staffRoles, personStaffRoles, shiftAssignments } from "./schema/staffing.js";
import type { AreaRef } from "./slots.js";
import type { RotaWeek } from "./staffing-types.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
    STAFFING_MIGRATIONS,
  ],
});
const tx = <T>(fn: (t: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const backend = new WorkforceBackend();
type Cfg = { locationId: string };
type ShiftInput = {
  week: string;
  personId: string;
  businessDay: string;
  area: AreaRef;
  staffRoleId: string;
  startsAt: string;
  endsAt: string;
};
const api = staffing as unknown as {
  changeRotaWeek(
    t: Transaction,
    c: Cfg,
    week: string,
  ): Promise<{ versionId: string; openSwaps: { swapId: string; fromShiftId: string }[] }>;
  readRotaWeek(t: Transaction, c: Cfg, week: string): Promise<RotaWeek>;
  addRotaShift(t: Transaction, c: Cfg, input: ShiftInput): Promise<string>;
  updateRotaShift(
    t: Transaction,
    c: Cfg,
    id: string,
    patch: Partial<Omit<ShiftInput, "week" | "businessDay">>,
  ): Promise<void>;
  removeRotaShift(t: Transaction, c: Cfg, id: string): Promise<void>;
};
async function venue() {
  const v = await seedVenue(suite.db);
  const area: AreaRef = { kind: "department", id: v.departmentId };
  const staffRoleId = await tx(async (t) => {
    const [r] = await t
      .insert(staffRoles)
      .values({ locationId: v.cfg.locationId, name: "Waiter" })
      .returning();
    await t.insert(personStaffRoles).values({ personId: v.ana, staffRoleId: r!.id });
    await t.insert(employments).values({
      personId: v.ana,
      contractedMinutesPerWeek: 2400,
      contractType: "permanent",
      startDate: "2026-01-01",
      payRate: 0,
    });
    await saveSeasonStaffing(t, v.cfg, v.seasonId, [
      {
        area,
        weekday: 0,
        blocks: [{ staffRoleId: r!.id, headcount: 1, startsAt: "01:00", endsAt: "03:00" }],
      },
    ]);
    return r!.id;
  });
  return { ...v, area, staffRoleId };
}
function read(v: { cfg: Cfg }, week = "2026-11-30") {
  expect(api.readRotaWeek).toBeTypeOf("function");
  return tx((t) => api.readRotaWeek(t, v.cfg, week));
}
function add(v: Awaited<ReturnType<typeof venue>>, patch: Partial<ShiftInput> = {}) {
  expect(api.addRotaShift).toBeTypeOf("function");
  return tx((t) =>
    api.addRotaShift(t, v.cfg, {
      week: "2026-11-30",
      businessDay: "2026-12-06",
      personId: v.ana,
      area: v.area,
      staffRoleId: v.staffRoleId,
      startsAt: "01:00",
      endsAt: "03:00",
      ...patch,
    }),
  );
}
async function rawShift(
  v: Awaited<ReturnType<typeof venue>>,
  versionId: string | null,
  startsAt: string,
  endsAt: string,
) {
  return tx(async (t) => {
    const [s] = await t
      .insert(shifts)
      .values({
        locationId: v.cfg.locationId,
        personId: v.ana,
        startsAt,
        endsAt,
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
        rosterVersionId: versionId,
      })
      .returning();
    return s!.id;
  });
}

async function servicePeriod(departmentId: string) {
  return tx(async (t) => {
    const menuId = randomUUID();
    await t.insert(catalogues).values({ id: menuId, name: `Menu ${menuId}` });
    const [period] = await t
      .insert(menuPeriods)
      .values({ departmentId, menuId, name: "Service" })
      .returning({ id: menuPeriods.id });
    return period!.id;
  });
}
async function seasonHours(
  v: { departmentId: string; seasonId: string },
  periodId: string,
  weekday: number,
) {
  await tx(async (t) => {
    const [day] = await t
      .insert(departmentDays)
      .values({ departmentId: v.departmentId, seasonId: v.seasonId, weekday })
      .returning({ id: departmentDays.id });
    await t.insert(departmentDayRanges).values({
      dayId: day!.id,
      departmentId: v.departmentId,
      periodId,
      startsAt: "19:00:00",
      endsAt: "23:00:00",
    });
  });
}
async function specialDay(cfg: Cfg, name: string, date: string, closedAllDay = false) {
  return tx(async (t) => {
    const [special] = await t
      .insert(specialDays)
      .values({ locationId: cfg.locationId, name })
      .returning({ id: specialDays.id });
    const [row] = await t
      .insert(specialDayDates)
      .values({ specialDayId: special!.id, locationId: cfg.locationId, date, closedAllDay })
      .returning({ id: specialDayDates.id });
    return { id: special!.id, dateId: row!.id };
  });
}
async function addSeason(cfg: Cfg, name: string, startsOn: string) {
  return tx(async (t) => {
    const [row] = await t
      .insert(seasons)
      .values({ locationId: cfg.locationId, name, startsOn })
      .returning({ id: seasons.id });
    return row!.id;
  });
}
const hours = (r: RotaWeek) => r.days.map((d) => [d.businessDay, d.hasHours]);

describe("the rota week", () => {
  it("includes its location and clock zone for passive warning reads and candidate previews", async () => {
    const v = await venue();
    expect(await read(v)).toMatchObject({
      locationId: v.cfg.locationId,
      timeZone: "Europe/Madrid",
    });
  });
  it("places a version's next-Monday shift on Sunday, keeps the previous Sunday's overflow visible and includes only local-date unattached shifts", async () => {
    const v = await venue();
    const version = await tx((t) =>
      backend.createRosterVersion(t, { ...v.cfg, period: "2026-11-30" }),
    );
    const sunday = await rawShift(v, version, "2026-12-07T00:00:00Z", "2026-12-07T02:00:00Z");
    const outside = await rawShift(v, version, "2026-11-29T23:30:00Z", "2026-11-30T01:00:00Z");
    const local = await rawShift(v, null, "2026-11-29T23:45:00Z", "2026-11-30T02:00:00Z");
    await rawShift(v, null, "2026-12-06T23:30:00Z", "2026-12-07T02:00:00Z");
    await tx((t) =>
      t
        .insert(shiftAssignments)
        .values({ shiftId: sunday, departmentId: v.departmentId, staffRoleId: v.staffRoleId }),
    );
    const r = await read(v);
    expect(r.shifts.map((s) => s.shiftId).sort()).toEqual([sunday, outside, local].sort());
    expect(r.days).toHaveLength(7);
    expect(r.days[6]!.areas[0]!.match.slots[0]!.status).toEqual({
      kind: "filled",
      shiftId: sunday,
      outsideRole: false,
    });
    expect(r.days[0]!.notInSlot).toEqual(
      expect.arrayContaining([
        { shiftId: outside, outsideWeek: true },
        { shiftId: local, outsideWeek: true },
      ]),
    );
    expect(r.people.find((p) => p.personId === v.ana)).toMatchObject({
      plannedMinutes: 345,
      contractedMinutes: 2400,
      staffRoleIds: [v.staffRoleId],
    });
  });
  it("lists approved absences touching the week, excludes pending leave, and prefers a draft beside a published week", async () => {
    const v = await venue();
    const published = await tx((t) =>
      backend.createRosterVersion(t, { ...v.cfg, period: "2026-11-30" }),
    );
    await tx(async (t) => {
      await backend.publishRoster(t, { versionId: published });
      await t.insert(absences).values([
        {
          personId: v.ana,
          kind: "holiday",
          startsOn: "2026-11-29",
          endsOn: "2026-11-30",
          status: "approved",
        },
        { personId: v.marc, kind: "holiday", startsOn: "2026-12-01", endsOn: "2026-12-02" },
      ]);
    });
    const draft = await tx((t) =>
      backend.createRosterVersion(t, { ...v.cfg, period: "2026-11-30" }),
    );
    const r = await read(v);
    expect(r.version).toEqual({ id: draft, status: "draft", changedSincePublished: true });
    expect(r.absences).toEqual([{ personId: v.ana, startsOn: "2026-11-29", endsOn: "2026-11-30" }]);
  });
  it("names each day's season and special day, and the seasons the week touches", async () => {
    const v = await venue();
    const fiesta = await specialDay(v.cfg, "Fiesta", "2026-12-02");
    const r = await read(v);
    expect(r.days[0]!.seasonId).toBe(v.seasonId);
    expect(r.days[2]!.specialDay).toEqual({ id: fiesta.id, name: "Fiesta" });
    expect(r.days.filter((_, i) => i !== 2).map((d) => d.specialDay)).toEqual(Array(6).fill(null));
    expect(r.seasons).toEqual([{ id: v.seasonId, name: "Summer" }]);
  });
  it("lists the seasons in the order the week first touches them when one starts mid-week", async () => {
    const v = await venue();
    const winter = await addSeason(v.cfg, "Winter", "12-03");
    const r = await read(v);
    expect(r.days.map((d) => d.seasonId)).toEqual([
      ...Array(3).fill(v.seasonId),
      ...Array(4).fill(winter),
    ]);
    expect(r.seasons).toEqual([
      { id: v.seasonId, name: "Summer" },
      { id: winter, name: "Winter" },
    ]);
  });
  it("lists a season that starts earlier in the year after the one the week begins in", async () => {
    const v = await venue();
    const winter = await addSeason(v.cfg, "Winter", "01-01");
    const r = await read(v, "2026-12-28");
    expect(r.days.map((d) => d.seasonId)).toEqual([
      ...Array(4).fill(v.seasonId),
      ...Array(3).fill(winter),
    ]);
    expect(r.seasons).toEqual([
      { id: v.seasonId, name: "Summer" },
      { id: winter, name: "Winter" },
    ]);
  });
  it("says which days have opening hours: a season weekday with a range, not one without, and not a special day closed all day", async () => {
    const v = await venue();
    const period = await servicePeriod(v.departmentId);
    await seasonHours(v, period, 2);
    await seasonHours(v, period, 4);
    await specialDay(v.cfg, "Closed", "2026-12-03", true);
    expect(hours(await read(v))).toEqual([
      ["2026-11-30", false],
      ["2026-12-01", true],
      ["2026-12-02", false],
      ["2026-12-03", false],
      ["2026-12-04", false],
      ["2026-12-05", false],
      ["2026-12-06", false],
    ]);
  });
  it.each([
    ["with", true],
    ["without", false],
  ] as const)(
    "a special day %s a range of its own on a weekday the season has none has hours %s",
    async (_, painted) => {
      const v = await venue();
      const period = await servicePeriod(v.departmentId);
      const fiesta = await specialDay(v.cfg, "Fiesta", "2026-12-02");
      if (painted)
        await tx(async (t) => {
          const [day] = await t
            .insert(departmentDays)
            .values({ departmentId: v.departmentId, specialDayDateId: fiesta.dateId })
            .returning({ id: departmentDays.id });
          await t.insert(departmentDayRanges).values({
            dayId: day!.id,
            departmentId: v.departmentId,
            periodId: period,
            startsAt: "13:00:00",
            endsAt: "16:00:00",
          });
        });
      expect(hours(await read(v))).toEqual(
        [
          "2026-11-30",
          "2026-12-01",
          "2026-12-02",
          "2026-12-03",
          "2026-12-04",
          "2026-12-05",
          "2026-12-06",
        ].map((d) => [d, d === "2026-12-02" && painted]),
      );
    },
  );
  it("an inactive department's hours do not count", async () => {
    const v = await venue();
    await seasonHours(v, await servicePeriod(v.departmentId), 2);
    expect((await read(v)).days[1]!.hasHours).toBe(true);
    await tx((t) =>
      t.update(departments).set({ active: false }).where(eq(departments.id, v.departmentId)),
    );
    expect((await read(v)).days.map((d) => d.hasHours)).toEqual(Array(7).fill(false));
  });
  it("a location with no season names none", async () => {
    const v = await seedVenue(suite.db);
    await tx((t) => t.delete(seasons).where(eq(seasons.id, v.seasonId)));
    const r = await read(v);
    expect(r.days.map((d) => d.seasonId)).toEqual(Array(7).fill(null));
    expect(r.days.map((d) => d.hasHours)).toEqual(Array(7).fill(false));
    expect(r.seasons).toEqual([]);
  });
  it.each(["department", "station"] as const)(
    "moves a switched-off %s's shifts into Not in a slot and hides its paint",
    async (kind) => {
      const v = await venue();
      const id = await add(v, {
        area: { kind, id: kind === "department" ? v.departmentId : v.stationId },
      });
      await tx((t) =>
        kind === "department"
          ? t.update(departments).set({ active: false }).where(eq(departments.id, v.departmentId))
          : t
              .update(kitchenStations)
              .set({ active: false })
              .where(eq(kitchenStations.id, v.stationId)),
      );
      const r = await read(v);
      expect(r.days[6]!.notInSlot).toEqual([{ shiftId: id, outsideWeek: false }]);
      expect(r.days[6]!.areas.some((a) => a.area.kind === kind)).toBe(false);
    },
  );
});

describe("the rota writes", () => {
  it("creates and attaches a draft shift, filling a business-day slot with zone offsets", async () => {
    const v = await venue();
    const id = await add(v);
    const r = await read(v);
    expect(r.version?.status).toBe("draft");
    expect(r.shifts[0]).toMatchObject({
      shiftId: id,
      startsAt: "2026-12-07T00:00:00Z",
      endsAt: "2026-12-07T02:00:00Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
      businessDay: "2026-12-06",
    });
    expect(r.days[6]!.areas[0]!.match.slots[0]!.status).toEqual({
      kind: "filled",
      shiftId: id,
      outsideRole: false,
    });
  });
  it("keeps both managers' fills and shows the second shift as over", async () => {
    const v = await venue();
    const ids = await Promise.all([add(v), add(v, { personId: v.marc })]);
    const r = await read(v);
    expect(r.shifts.map((s) => s.shiftId).sort()).toEqual(ids.sort());
    expect(r.days[6]!.areas[0]!.match.over).toHaveLength(1);
  });
  it("refuses a nonexistent spring time and takes the earlier autumn occurrence", async () => {
    const v = await venue();
    await expect(
      add(v, { week: "2027-03-22", businessDay: "2027-03-27", startsAt: "02:00", endsAt: "04:00" }),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "startsAt" } });
    expect((await read(v, "2027-03-22")).version).toBeNull();
    const id = await add(v, {
      week: "2026-10-19",
      businessDay: "2026-10-24",
      startsAt: "02:30",
      endsAt: "04:00",
    });
    const r = await read(v, "2026-10-19");
    expect(r.shifts.find((s) => s.shiftId === id)).toMatchObject({
      startsAt: "2026-10-25T00:30:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2026-10-25T03:00:00Z",
      endsOffsetMinutes: 60,
    });
  });
  it("refuses published writes, including assignment-only edits, leaving assignments unchanged", async () => {
    const v = await venue();
    const id = await add(v);
    const r = await read(v);
    await tx((t) => backend.publishRoster(t, { versionId: r.version!.id }));
    await expect(add(v)).rejects.toMatchObject({ code: "roster.not_draft" });
    await expect(
      tx((t) => api.updateRotaShift(t, v.cfg, id, { area: { kind: "station", id: v.stationId } })),
    ).rejects.toMatchObject({ code: "roster.not_draft" });
    await expect(tx((t) => api.removeRotaShift(t, v.cfg, id))).rejects.toMatchObject({
      code: "roster.not_draft",
    });
    const [assignment] = await tx((t) =>
      t.select().from(shiftAssignments).where(eq(shiftAssignments.shiftId, id)),
    );
    expect(assignment!.departmentId).toBe(v.departmentId);
  });
  it("assigns an unlinked shift, edits its person and time and removes only the scoped draft shift", async () => {
    const v = await venue();
    const id = await rawShift(v, null, "2026-12-01T08:00:00Z", "2026-12-01T12:00:00Z");
    expect(api.updateRotaShift).toBeTypeOf("function");
    await tx((t) =>
      api.updateRotaShift(t, v.cfg, id, {
        area: v.area,
        staffRoleId: v.staffRoleId,
        personId: v.marc,
        startsAt: "10:00",
        endsAt: "14:00",
      }),
    );
    const r = await read(v);
    expect(r.version?.status).toBe("draft");
    const [attached] = await tx((t) => t.select().from(shifts).where(eq(shifts.id, id)));
    expect(attached!.rosterVersionId).toBe(r.version!.id);
    expect(r.shifts.find((s) => s.shiftId === id)).toMatchObject({
      area: v.area,
      staffRoleId: v.staffRoleId,
      personId: v.marc,
      startsAt: "2026-12-01T09:00:00Z",
      endsAt: "2026-12-01T13:00:00Z",
    });
    const other = await venue();
    await expect(tx((t) => api.removeRotaShift(t, other.cfg, id))).rejects.toMatchObject({
      code: "shift.not_found",
    });
    await tx((t) => api.removeRotaShift(t, v.cfg, id));
    expect((await read(v)).shifts).toEqual([]);
    expect(
      await tx((t) => t.select().from(shiftAssignments).where(eq(shiftAssignments.shiftId, id))),
    ).toEqual([]);
  });
  it("refuses foreign and inactive areas and roles without leaving a draft", async () => {
    const v = await venue();
    const other = await venue();
    await expect(add(v, { area: other.area })).rejects.toMatchObject({
      code: "staffing_area.not_found",
    });
    await expect(add(v, { staffRoleId: other.staffRoleId })).rejects.toMatchObject({
      code: "staff_role.not_found",
    });
    await expect(add(v, { staffRoleId: randomUUID() })).rejects.toMatchObject({
      code: "staff_role.not_found",
    });
    await tx((t) =>
      t.update(departments).set({ active: false }).where(eq(departments.id, v.departmentId)),
    );
    await expect(add(v)).rejects.toMatchObject({ code: "staffing_area.not_found" });
    expect((await read(v)).version).toBeNull();
  });
  it.each([
    { week: "2026-12-01" },
    { businessDay: "2026-12-07" },
    { startsAt: "25:00" },
    { endsAt: "bad" },
    { startsAt: "10:07" },
    { startsAt: "14:00", endsAt: "10:00" },
  ])("refuses malformed rota input %j", async (patch) => {
    const v = await venue();
    await expect(add(v, patch)).rejects.toMatchObject({ code: "staffing.invalid" });
    expect((await read(v)).version).toBeNull();
  });
});

describe("reviewed Rota boundaries", () => {
  it("refuses both an edit and deletion of an unattached shift in a published week", async () => {
    const v = await venue();
    const version = await tx((t) =>
      backend.createRosterVersion(t, { ...v.cfg, period: "2026-11-30" }),
    );
    await tx((t) => backend.publishRoster(t, { versionId: version }));
    const id = await rawShift(v, null, "2026-12-01T08:00:00Z", "2026-12-01T12:00:00Z");
    expect((await read(v)).shifts.map((s) => s.shiftId)).toContain(id);
    await expect(
      tx((t) => api.updateRotaShift(t, v.cfg, id, { area: v.area, staffRoleId: v.staffRoleId })),
    ).rejects.toMatchObject({ code: "roster.not_draft", params: { rosterVersionId: version } });
    await expect(tx((t) => api.removeRotaShift(t, v.cfg, id))).rejects.toMatchObject({
      code: "roster.not_draft",
      params: { rosterVersionId: version },
    });
    expect((await read(v)).shifts.map((s) => s.shiftId)).toContain(id);
  });
  it("leaves an empty patch unchanged without creating a roster version", async () => {
    const v = await venue();
    const id = await rawShift(v, null, "2026-12-01T08:00:00Z", "2026-12-01T12:00:00Z");
    const before = await tx((t) => t.select().from(shifts).where(eq(shifts.id, id)));
    await tx((t) => api.updateRotaShift(t, v.cfg, id, {}));
    expect((await read(v)).version).toBeNull();
    expect(await tx((t) => t.select().from(shifts).where(eq(shifts.id, id)))).toEqual(before);
    await tx((t) => api.removeRotaShift(t, v.cfg, id));
    expect((await read(v)).shifts).toEqual([]);
  });
  it("marks a person outside the staff role, distinguishes a first draft and omits an ended contract", async () => {
    const v = await venue();
    const id = await add(v, { personId: v.marc });
    await tx((t) =>
      t.insert(employments).values({
        personId: v.marc,
        contractedMinutesPerWeek: 1200,
        contractType: "temporary",
        startDate: "2026-01-01",
        endDate: "2026-11-29",
        payRate: 0,
      }),
    );
    const r = await read(v);
    expect(r.days[6]!.areas[0]!.match.slots[0]!.status).toEqual({
      kind: "filled",
      shiftId: id,
      outsideRole: true,
    });
    expect(r.version).toMatchObject({ status: "draft", changedSincePublished: false });
    expect(r.people.find((p) => p.personId === v.marc)!.contractedMinutes).toBeNull();
  });
});

describe("the approved calendar-week limit", () => {
  it("keeps an edited unattached early-Monday shift visible as previous-week overflow in its calendar week", async () => {
    const v = await venue();
    const id = await rawShift(v, null, "2026-12-06T23:30:00Z", "2026-12-07T02:00:00Z");
    await tx((t) =>
      api.updateRotaShift(t, v.cfg, id, { area: v.area, staffRoleId: v.staffRoleId }),
    );
    const previous = await read(v);
    expect(previous.shifts).toEqual([]);
    expect(previous.days[6]!.areas[0]!.match.slots[0]!.status).toEqual({ kind: "unfilled" });
    const next = await read(v, "2026-12-07");
    expect(next.days[0]!.notInSlot).toEqual([{ shiftId: id, outsideWeek: true }]);
    expect(next.shifts[0]!.businessDay).toBe("2026-12-06");
  });
});

describe("changing a published rota week", () => {
  it("copies assignments with the shifts and pending swaps, preserving staff's published shifts until publication", async () => {
    const v = await venue();
    const shiftId = await add(v, { businessDay: "2026-12-01", startsAt: "09:00", endsAt: "15:00" });
    const original = (await read(v)).version!.id;
    await tx((t) => backend.publishRoster(t, { versionId: original }));
    const swapId = randomUUID(),
      decided = randomUUID();
    await tx(async (t) => {
      await t.insert(shiftSwaps).values([
        { id: swapId, requestedByPersonId: v.ana, fromShiftId: shiftId, toPersonId: v.marc },
        {
          id: decided,
          requestedByPersonId: v.ana,
          fromShiftId: shiftId,
          toPersonId: v.marc,
          status: "rejected",
        },
      ]);
    });
    expect(api.changeRotaWeek).toBeTypeOf("function");
    const result = await tx((t) => api.changeRotaWeek(t, v.cfg, "2026-11-30"));
    const copied = await read(v),
      copyId = copied.shifts[0]!.shiftId;
    expect(copyId).not.toBe(shiftId);
    expect(copied.version).toEqual({
      id: result.versionId,
      status: "draft",
      changedSincePublished: true,
    });
    expect(copied.shifts[0]).toMatchObject({
      personId: v.ana,
      area: v.area,
      staffRoleId: v.staffRoleId,
      startsAt: "2026-12-01T08:00:00Z",
      endsAt: "2026-12-01T14:00:00Z",
    });
    expect(result.openSwaps).toEqual([{ swapId, fromShiftId: copyId }]);
    expect(copied.openSwaps).toEqual([{ swapId, fromShiftId: copyId, toShiftId: null }]);
    expect(
      await tx((t) =>
        t
          .select({ from: shiftSwaps.fromShiftId })
          .from(shiftSwaps)
          .where(eq(shiftSwaps.id, decided)),
      ),
    ).toEqual([{ from: shiftId }]);
    const own = () =>
      tx((t) => listShiftsForPerson(t, { personId: v.ana, from: "2026-11-30", to: "2026-12-07" }));
    expect((await own()).map((s) => s.id)).toEqual([shiftId]);
    await tx((t) => api.updateRotaShift(t, v.cfg, copyId, { endsAt: "16:00" }));
    expect((await own()).map((s) => s.id)).toEqual([shiftId]);
    await tx((t) => backend.publishRoster(t, { versionId: result.versionId }));
    expect((await own()).map((s) => s.id)).toEqual([copyId]);
  });
  it("does not create a draft for an invalid week, a missing published week or an existing draft", async () => {
    const v = await venue();
    expect(api.changeRotaWeek).toBeTypeOf("function");
    await expect(tx((t) => api.changeRotaWeek(t, v.cfg, "2026-12-01"))).rejects.toMatchObject({
      code: "staffing.invalid",
      params: { field: "week" },
    });
    await expect(tx((t) => api.changeRotaWeek(t, v.cfg, "2026-11-30"))).rejects.toMatchObject({
      code: "staffing.invalid",
      params: { field: "week" },
    });
    await add(v);
    await expect(tx((t) => api.changeRotaWeek(t, v.cfg, "2026-11-30"))).rejects.toMatchObject({
      code: "roster.draft_exists",
    });
  });
});

describe("copying an unassigned shift", () => {
  it("keeps a copied unassigned shift under Not in a slot without inventing an assignment", async () => {
    const v = await venue();
    const versionId = await tx((t) =>
      backend.createRosterVersion(t, { ...v.cfg, period: "2026-11-30" }),
    );
    const original = await rawShift(v, versionId, "2026-12-01T08:00:00Z", "2026-12-01T12:00:00Z");
    await tx((t) => backend.publishRoster(t, { versionId }));
    await tx((t) => api.changeRotaWeek(t, v.cfg, "2026-11-30"));
    const copied = await read(v);
    expect(copied.shifts).toHaveLength(1);
    expect(copied.shifts[0]!.shiftId).not.toBe(original);
    expect(copied.shifts[0]).toMatchObject({ area: null, staffRoleId: null });
    expect(copied.days[1]!.notInSlot).toEqual([
      { shiftId: copied.shifts[0]!.shiftId, outsideWeek: false },
    ]);
  });
});
