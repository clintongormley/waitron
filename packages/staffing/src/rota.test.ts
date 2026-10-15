import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { VENUE_SERVICE_MIGRATIONS, departments } from "@waitron/venue-service";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  absences,
  employments,
  shifts,
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

describe("the rota week", () => {
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
