import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { VENUE_SERVICE_MIGRATIONS, departments } from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts } from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { STAFFING_PERSONAL_DATA } from "./personal-data.js";
import { personStaffRoles, shiftAssignments, staffRoles } from "./schema/staffing.js";
import * as staffing from "./index.js";

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

const subject = (personId: string) => ({
  personId,
  language: "en" as const,
  at: new Date("2026-10-24T10:00:00.000Z"),
  timeZone: "UTC",
  locationId: null,
});

async function download(personId: string): Promise<{ name: string; text: string }[]> {
  const build = await withTransaction(suite.db, (tx) =>
    STAFFING_PERSONAL_DATA.prepare(tx, subject(personId)),
  );
  return (await build()).map((f) => {
    if (typeof f.content !== "string") throw new Error(`${f.name} is not text`);
    return { name: f.name, text: f.content };
  });
}

const asFile = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

// Explicit ids, each list's id order the reverse of its expected order, so dropping a list's
// primary sort reorders it on every run.
const WAITER = "00000000-0000-4000-8000-000000000001";
const BARTENDER = "00000000-0000-4000-8000-000000000002";
const SOMMELIER = "00000000-0000-4000-8000-000000000003";
const NIGHT_SHIFT = "00000000-0000-4000-8000-0000000000a1";
const EVENING_SHIFT = "00000000-0000-4000-8000-0000000000a2";

/** Marta (`ana`) and a colleague (`marc`), each with distinct roles, areas and shifts. */
async function seedAll() {
  const venue = await seedVenue(suite.db);
  const locationId = venue.cfg.locationId;
  const marta = venue.ana;
  const colleague = venue.marc;
  await withTransaction(suite.db, async (tx) => {
    const [terrace] = await tx
      .insert(departments)
      .values({ locationId, name: "Terrace", tradingName: "Terrace" })
      .returning({ id: departments.id });
    await tx.insert(staffRoles).values([
      { id: WAITER, locationId, name: "Waiter" },
      { id: BARTENDER, locationId, name: "Bartender" },
      { id: SOMMELIER, locationId, name: "Sommelier" },
    ]);
    await tx.insert(personStaffRoles).values([
      { personId: marta, staffRoleId: WAITER },
      { personId: marta, staffRoleId: BARTENDER },
      { personId: colleague, staffRoleId: SOMMELIER },
    ]);
    // The night shift starts later but has the lower id and is inserted first; its local date
    // (+01:00) is the day after its UTC date. The evening shift's start and end are stored with
    // different offsets.
    await tx.insert(shifts).values([
      {
        id: NIGHT_SHIFT,
        personId: marta,
        locationId,
        startsAt: "2026-03-14T23:30:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-03-15T05:00:00Z",
        endsOffsetMinutes: 60,
      },
      {
        id: EVENING_SHIFT,
        personId: marta,
        locationId,
        startsAt: "2026-03-10T18:00:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-03-10T22:45:00Z",
        endsOffsetMinutes: 120,
      },
    ]);
    await tx.insert(shifts).values({
      personId: marta,
      locationId,
      startsAt: "2026-03-12T10:00:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-03-12T14:00:00Z",
      endsOffsetMinutes: 60,
    });
    const [colleagueShift] = await tx
      .insert(shifts)
      .values({
        personId: colleague,
        locationId,
        startsAt: "2026-03-11T16:00:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-03-11T23:00:00Z",
        endsOffsetMinutes: 60,
      })
      .returning({ id: shifts.id });
    await tx.insert(shiftAssignments).values([
      { shiftId: NIGHT_SHIFT, staffRoleId: WAITER, departmentId: venue.departmentId },
      { shiftId: EVENING_SHIFT, staffRoleId: BARTENDER, stationId: venue.stationId },
      { shiftId: colleagueShift!.id, staffRoleId: SOMMELIER, departmentId: terrace!.id },
    ]);
  });
  return { venue, marta, colleague };
}

const MARTA_STAFF_ROLES = {
  staffRoles: [{ name: "Bartender" }, { name: "Waiter" }],
  shiftRoles: [
    {
      startsAt: "2026-03-10T19:00:00+01:00",
      endsAt: "2026-03-11T00:45:00+02:00",
      area: "Grill",
      staffRole: "Bartender",
    },
    {
      startsAt: "2026-03-15T00:30:00+01:00",
      endsAt: "2026-03-15T06:00:00+01:00",
      area: "Dining room",
      staffRole: "Waiter",
    },
  ],
};

describe("STAFFING_PERSONAL_DATA", () => {
  it("declares staff-roles.json and is exported from the package", () => {
    expect(STAFFING_PERSONAL_DATA.files).toEqual(["staff-roles.json"]);
    expect(staffing.STAFFING_PERSONAL_DATA).toBe(STAFFING_PERSONAL_DATA);
  });

  it("writes her roles by name and her assigned shifts by start, in local time", async () => {
    const { marta } = await seedAll();
    const files = await download(marta);
    expect(files.map((f) => f.name)).toEqual(["staff-roles.json"]);
    expect(files[0]!.text).toBe(asFile(MARTA_STAFF_ROLES));
  });

  it("orders shifts that start together by shift id", async () => {
    const venue = await seedVenue(suite.db);
    const locationId = venue.cfg.locationId;
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(staffRoles).values({ id: WAITER, locationId, name: "Waiter" });
      // The higher id is inserted first, so storage order is the reverse of id order.
      for (const id of [EVENING_SHIFT, NIGHT_SHIFT])
        await tx.insert(shifts).values({
          id,
          personId: venue.marc,
          locationId,
          startsAt: "2026-03-10T18:00:00Z",
          startsOffsetMinutes: 60,
          endsAt: "2026-03-10T22:00:00Z",
          endsOffsetMinutes: 60,
        });
      await tx.insert(shiftAssignments).values([
        { shiftId: EVENING_SHIFT, staffRoleId: WAITER, stationId: venue.stationId },
        { shiftId: NIGHT_SHIFT, staffRoleId: WAITER, departmentId: venue.departmentId },
      ]);
    });
    const [file] = await download(venue.marc);
    const together = { startsAt: "2026-03-10T19:00:00+01:00", endsAt: "2026-03-10T23:00:00+01:00" };
    expect(file!.text).toBe(
      asFile({
        staffRoles: [],
        shiftRoles: [
          { ...together, area: "Dining room", staffRole: "Waiter" },
          { ...together, area: "Grill", staffRole: "Waiter" },
        ],
      }),
    );
  });

  it("holds only her rows: the colleague's role and area appear nowhere", async () => {
    const { marta, colleague } = await seedAll();
    const [file] = await download(marta);
    expect(file!.text).not.toContain("Sommelier");
    expect(file!.text).not.toContain("Terrace");
    const [own] = await download(colleague);
    expect(own!.text).toContain("Sommelier");
    expect(own!.text).toContain("Terrace");
  });

  it("builds no file for a person with no role and no assigned shift", async () => {
    const venue = await seedVenue(suite.db);
    await suite.db.insert(shifts).values({
      personId: venue.marc,
      locationId: venue.cfg.locationId,
      startsAt: "2026-03-12T10:00:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-03-12T14:00:00Z",
      endsOffsetMinutes: 60,
    });
    expect(await download(venue.marc)).toEqual([]);
  });

  it("builds the file for a held role even with no assigned shift", async () => {
    const venue = await seedVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(staffRoles)
        .values({ id: WAITER, locationId: venue.cfg.locationId, name: "Waiter" });
      await tx.insert(personStaffRoles).values({ personId: venue.marc, staffRoleId: WAITER });
    });
    const files = await download(venue.marc);
    expect(files.map((f) => f.name)).toEqual(["staff-roles.json"]);
    expect(files[0]!.text).toBe(asFile({ staffRoles: [{ name: "Waiter" }], shiftRoles: [] }));
  });

  it("builds the file for an assigned shift even when no role is held", async () => {
    const venue = await seedVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(staffRoles)
        .values({ id: WAITER, locationId: venue.cfg.locationId, name: "Waiter" });
      await tx.insert(shifts).values({
        id: NIGHT_SHIFT,
        personId: venue.marc,
        locationId: venue.cfg.locationId,
        startsAt: "2026-03-14T23:30:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-03-15T05:00:00Z",
        endsOffsetMinutes: 60,
      });
      await tx
        .insert(shiftAssignments)
        .values({ shiftId: NIGHT_SHIFT, staffRoleId: WAITER, departmentId: venue.departmentId });
    });
    const files = await download(venue.marc);
    expect(files.map((f) => f.name)).toEqual(["staff-roles.json"]);
    expect(files[0]!.text).toBe(
      asFile({ staffRoles: [], shiftRoles: [MARTA_STAFF_ROLES.shiftRoles[1]] }),
    );
  });
});
