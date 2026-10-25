import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend } from "./clocking.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WORKFORCE_PERSONAL_DATA } from "./personal-data.js";
import { absences } from "./schema/absences.js";
import { availability } from "./schema/availability.js";
import { employments } from "./schema/employments.js";
import { rosterVersions } from "./schema/roster-versions.js";
import { shiftSwaps } from "./schema/shift-swaps.js";
import { shifts } from "./schema/shifts.js";
import { insertRosterVersion, insertShiftSwap, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
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
    WORKFORCE_PERSONAL_DATA.prepare(tx, subject(personId)),
  );
  const files = await build();
  return files.map((f) => {
    if (typeof f.content !== "string") throw new Error(`${f.name} is not text`);
    return { name: f.name, text: f.content };
  });
}

async function seedManager(db: Database): Promise<{ id: string; email: string }> {
  const email = "luis.manager@example.test";
  const [row] = await db
    .insert(persons)
    .values({ displayName: "Luis Manager", email })
    .returning({ id: persons.id });
  return { id: row!.id, email };
}

/** Marta, a colleague and a manager, each value distinct to its owner. */
async function seedAll(db: Database) {
  const manager = await seedManager(db);
  const marta = await seedPerson(db, "Marta Lopez");
  const colleague = await seedPerson(db, "Colleague Ruiz");

  // Inserted out of list order, and one row in each list recorded after a row that starts later,
  // so dropping either sort key reorders the expected lists.
  await db.insert(employments).values([
    {
      personId: marta,
      contractedMinutesPerWeek: 1200,
      contractType: "part_time",
      startDate: "2025-03-01",
      endDate: null,
      payRate: 1234,
      createdAt: "2025-02-20T09:15:00.000Z",
    },
    {
      personId: marta,
      contractedMinutesPerWeek: 2400,
      contractType: "fixed_term",
      startDate: "2024-01-15",
      endDate: "2025-02-28",
      payRate: 1100,
      createdAt: "2025-04-01T08:00:00.000Z",
    },
    {
      personId: colleague,
      contractedMinutesPerWeek: 1800,
      contractType: "seasonal",
      startDate: "2023-06-01",
      endDate: null,
      payRate: 1999,
      createdAt: "2023-05-25T07:30:00.000Z",
    },
  ]);

  await db.insert(absences).values([
    {
      personId: marta,
      kind: "unpaid",
      startsOn: "2026-08-10",
      endsOn: "2026-08-12",
      status: "requested",
      note: null,
      createdAt: "2026-07-01T10:00:00.000Z",
    },
    {
      personId: marta,
      kind: "sick_leave",
      startsOn: "2026-02-03",
      endsOn: "2026-02-05",
      status: "requested",
      note: "Flu, doctor's note given",
      createdAt: "2026-04-10T07:45:00.000Z",
    },
    {
      personId: marta,
      kind: "holiday",
      startsOn: "2026-05-18",
      endsOn: "2026-05-22",
      status: "approved",
      note: "Family wedding",
      decidedByPersonId: manager.id,
      decidedAt: "2026-04-02T16:20:00.000Z",
      createdAt: "2026-04-01T11:05:00.000Z",
    },
    {
      personId: colleague,
      kind: "leave",
      startsOn: "2025-11-11",
      endsOn: "2025-11-13",
      status: "rejected",
      note: "Colleague moving house",
      decidedByPersonId: manager.id,
      decidedAt: "2025-10-30T12:00:00.000Z",
      createdAt: "2025-10-29T13:40:00.000Z",
    },
  ]);

  return { manager, marta, colleague };
}

/**
 * Marta's three shifts, two availability windows and three swaps, beside a colleague's own.
 * Shift times are stored in the writer's whole-second `Z` spelling (`shiftInterval`, clocking.ts).
 */
async function seedRota(db: Database, people: Awaited<ReturnType<typeof seedAll>>) {
  const { manager, marta, colleague } = people;
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Harbour Terrace",
      invoiceLocales: ["en"],
      operationDescription: "Sale on premises",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const publishedVersion = await insertRosterVersion(db, { locationId });
  await db
    .update(rosterVersions)
    .set({ status: "published", publishedAt: "2026-06-20T10:00:00.000Z" })
    .where(eq(rosterVersions.id, publishedVersion));
  const draftVersion = await insertRosterVersion(db, {
    locationId,
    periodStart: "2026-02-09",
    periodEnd: "2026-02-15",
  });

  const shift = async (
    personId: string,
    values: {
      startsAt: string;
      startsOffsetMinutes: number;
      endsAt: string;
      endsOffsetMinutes: number;
      rosterVersionId: string | null;
      createdAt: string;
    },
  ) => {
    const [row] = await db
      .insert(shifts)
      .values({ personId, locationId, ...values })
      .returning({ id: shifts.id });
    return row!.id;
  };

  // Inserted, and recorded (created_at), in the opposite order to their starts.
  const summer = await shift(marta, {
    startsAt: "2026-07-10T16:00:00Z",
    startsOffsetMinutes: 120,
    endsAt: "2026-07-10T22:00:00Z",
    endsOffsetMinutes: 120,
    rosterVersionId: publishedVersion,
    createdAt: "2025-12-01T08:10:00.000Z",
  });
  const draft = await shift(marta, {
    startsAt: "2026-02-14T03:41:00Z",
    startsOffsetMinutes: 60,
    endsAt: "2026-02-14T11:41:00Z",
    endsOffsetMinutes: 60,
    rosterVersionId: draftVersion,
    createdAt: "2025-12-15T08:20:00.000Z",
  });
  await shift(marta, {
    startsAt: "2026-01-02T00:30:00Z",
    startsOffsetMinutes: -120,
    endsAt: "2026-01-02T08:30:00Z",
    endsOffsetMinutes: -120,
    rosterVersionId: null,
    createdAt: "2026-01-01T08:40:00.000Z",
  });

  const colleagueEarly = await shift(colleague, {
    startsAt: "2026-03-05T02:17:00Z",
    startsOffsetMinutes: 60,
    endsAt: "2026-03-05T09:17:00Z",
    endsOffsetMinutes: 60,
    rosterVersionId: null,
    createdAt: "2026-02-20T06:59:00.000Z",
  });
  const colleagueLate = await shift(colleague, {
    startsAt: "2026-04-11T21:53:00Z",
    startsOffsetMinutes: 120,
    endsAt: "2026-04-12T05:53:00Z",
    endsOffsetMinutes: 120,
    rosterVersionId: null,
    createdAt: "2026-03-21T06:58:00.000Z",
  });
  const colleagueGiveAway = await shift(colleague, {
    startsAt: "2026-05-16T15:23:00Z",
    startsOffsetMinutes: 120,
    endsAt: "2026-05-16T23:23:00Z",
    endsOffsetMinutes: 120,
    rosterVersionId: publishedVersion,
    createdAt: "2026-04-22T06:57:00.000Z",
  });

  // Recorded, and starting in the day, in the opposite order to their weekdays.
  await db.insert(availability).values([
    {
      personId: marta,
      weekday: 5,
      availableFromMinute: 555,
      availableToMinute: 1440,
      effectiveFrom: "2025-11-01",
      effectiveTo: null,
      createdAt: "2025-10-20T09:05:00.000Z",
    },
    {
      personId: marta,
      weekday: 2,
      availableFromMinute: 1050,
      availableToMinute: 1305,
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-06-30",
      createdAt: "2026-01-25T09:35:00.000Z",
    },
    {
      personId: colleague,
      weekday: 3,
      availableFromMinute: 370,
      availableToMinute: 710,
      effectiveFrom: "2026-03-03",
      effectiveTo: "2026-09-09",
      createdAt: "2026-02-27T06:56:00.000Z",
    },
  ]);

  const giveAway = await insertShiftSwap(db, {
    requestedByPersonId: colleague,
    fromShiftId: colleagueGiveAway,
    toPersonId: marta,
    status: "approved",
    createdAt: "2026-05-01T09:00:00.000Z",
  });
  await db
    .update(shiftSwaps)
    .set({ decidedByPersonId: manager.id, decidedAt: "2026-05-02T14:00:00.000Z" })
    .where(eq(shiftSwaps.id, giveAway));
  await insertShiftSwap(db, {
    requestedByPersonId: marta,
    fromShiftId: draft,
    toPersonId: colleague,
    toShiftId: colleagueLate,
    status: "accepted",
    createdAt: "2026-02-01T10:00:00.000Z",
  });
  await insertShiftSwap(db, {
    requestedByPersonId: colleague,
    fromShiftId: colleagueEarly,
    toPersonId: marta,
    toShiftId: summer,
    status: "requested",
    createdAt: "2026-03-01T08:00:00.000Z",
  });

  return { draft };
}

const MARTA_ROTA = {
  shifts: [
    {
      location: "Harbour Terrace",
      startsAt: "2026-01-01T22:30:00-02:00",
      endsAt: "2026-01-02T06:30:00-02:00",
      rota: null,
      createdAt: "2026-01-01T08:40:00.000Z",
    },
    {
      location: "Harbour Terrace",
      startsAt: "2026-02-14T04:41:00+01:00",
      endsAt: "2026-02-14T12:41:00+01:00",
      rota: "draft",
      createdAt: "2025-12-15T08:20:00.000Z",
    },
    {
      location: "Harbour Terrace",
      startsAt: "2026-07-10T18:00:00+02:00",
      endsAt: "2026-07-11T00:00:00+02:00",
      rota: "published",
      createdAt: "2025-12-01T08:10:00.000Z",
    },
  ],
  availability: [
    {
      weekday: 2,
      from: "17:30",
      to: "21:45",
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-06-30",
      createdAt: "2026-01-25T09:35:00.000Z",
    },
    {
      weekday: 5,
      from: "09:15",
      to: "24:00",
      effectiveFrom: "2025-11-01",
      effectiveTo: null,
      createdAt: "2025-10-20T09:05:00.000Z",
    },
  ],
  swaps: [
    {
      direction: "requested_by_me",
      otherPerson: "Colleague Ruiz",
      status: "accepted",
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-02-01T10:00:00.000Z",
    },
    {
      direction: "offered_to_me",
      otherPerson: "Colleague Ruiz",
      status: "requested",
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-03-01T08:00:00.000Z",
    },
    {
      direction: "offered_to_me",
      otherPerson: "Colleague Ruiz",
      status: "approved",
      decidedBy: "Luis Manager",
      decidedAt: "2026-05-02T14:00:00.000Z",
      createdAt: "2026-05-01T09:00:00.000Z",
    },
  ],
};

/** The colleague's shift and availability values as their own rota writes them. */
const COLLEAGUE_ROTA_VALUES = [
  "2026-03-05T03:17",
  "2026-03-05T10:17",
  "2026-04-11T23:53",
  "2026-04-12T07:53",
  "2026-05-16T17:23",
  "2026-05-17T01:23",
  "2026-02-20T06:59",
  "2026-03-21T06:58",
  "2026-04-22T06:57",
  "06:10",
  "11:50",
  "2026-03-03",
  "2026-09-09",
  "2026-02-27T06:56",
];

/** The same shifts' stored UTC times, which no rota writes. */
const COLLEAGUE_SHIFT_UTC = ["02:17", "09:17", "21:53", "05:53", "15:23", "23:23"];

/** Marta's draft shift, moved to a fourth person in one case, in every form a leak could take. */
const DRAFT_SHIFT_VALUES = ["2026-02-14", "04:41", "03:41", "12:41", "11:41", "2025-12-15T08:20"];

const rotaOf = (files: { name: string; text: string }[]) => {
  const rota = files.find((f) => f.name === "rota.json");
  if (rota === undefined) throw new Error("no rota.json");
  return rota.text;
};

const COLLEAGUE_VALUES = [
  "seasonal",
  "2023-06-01",
  "19.99",
  "2023-05-25T07:30:00.000Z",
  "Colleague moving house",
  "2025-11-11",
  "2025-11-13",
  "rejected",
  "2025-10-30T12:00:00.000Z",
  "2025-10-29T13:40:00.000Z",
];

describe("WORKFORCE_PERSONAL_DATA", () => {
  it("declares its four files", () => {
    expect(WORKFORCE_PERSONAL_DATA.files).toEqual([
      "employment.json",
      "rota.json",
      "absences.json",
      "attendance.json",
    ]);
  });

  it("builds exactly her employment and absences files", async () => {
    const { marta } = await seedAll(suite.db);
    const files = await download(marta);
    expect(files.map((f) => f.name)).toEqual(["employment.json", "absences.json"]);
    for (const f of files) expect(f.text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(files[0]!.text)).toEqual({
      employments: [
        {
          contractType: "fixed_term",
          contractedMinutesPerWeek: 2400,
          startDate: "2024-01-15",
          endDate: "2025-02-28",
          payRate: "11.00",
          createdAt: "2025-04-01T08:00:00.000Z",
        },
        {
          contractType: "part_time",
          contractedMinutesPerWeek: 1200,
          startDate: "2025-03-01",
          endDate: null,
          payRate: "12.34",
          createdAt: "2025-02-20T09:15:00.000Z",
        },
      ],
    });
    expect(JSON.parse(files[1]!.text)).toEqual({
      absences: [
        {
          kind: "sick_leave",
          startsOn: "2026-02-03",
          endsOn: "2026-02-05",
          status: "requested",
          note: "Flu, doctor's note given",
          decidedBy: null,
          decidedAt: null,
          createdAt: "2026-04-10T07:45:00.000Z",
        },
        {
          kind: "holiday",
          startsOn: "2026-05-18",
          endsOn: "2026-05-22",
          status: "approved",
          note: "Family wedding",
          decidedBy: "Luis Manager",
          decidedAt: "2026-04-02T16:20:00.000Z",
          createdAt: "2026-04-01T11:05:00.000Z",
        },
        {
          kind: "unpaid",
          startsOn: "2026-08-10",
          endsOn: "2026-08-12",
          status: "requested",
          note: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });
  });

  it("holds none of a colleague's values", async () => {
    const { marta, colleague } = await seedAll(suite.db);
    const text = (await download(marta)).map((f) => f.text).join("\n");
    for (const value of COLLEAGUE_VALUES) expect(text).not.toContain(value);
    // Positive control: the colleague's own download carries every one of them.
    const theirs = (await download(colleague)).map((f) => f.text).join("\n");
    for (const value of COLLEAGUE_VALUES) expect(theirs).toContain(value);
  });

  it("names the decider by display name only", async () => {
    const { marta, manager } = await seedAll(suite.db);
    const files = await download(marta);
    const all = files.map((f) => f.text).join("\n");
    expect(all).not.toContain(manager.id);
    expect(all).not.toContain(manager.email);
    expect(files.find((f) => f.name === "employment.json")!.text).not.toContain("Luis Manager");
    const absencesText = files.find((f) => f.name === "absences.json")!.text;
    expect(absencesText.split("Luis Manager").length - 1).toBe(1);
    expect(absencesText).toContain('"decidedBy": "Luis Manager"');
  });

  it("builds no file for a person with no employment and no absence", async () => {
    await seedAll(suite.db);
    const nobody = await seedPerson(suite.db, "New Starter");
    expect(await download(nobody)).toEqual([]);
  });

  it("builds only absences.json for a person with an absence and no employment", async () => {
    await seedAll(suite.db);
    const person = await seedPerson(suite.db, "Absent Only");
    await suite.db.insert(absences).values({
      personId: person,
      kind: "holiday",
      startsOn: "2026-09-01",
      endsOn: "2026-09-02",
      createdAt: "2026-08-01T09:00:00.000Z",
    });
    const files = await download(person);
    expect(files.map((f) => f.name)).toEqual(["absences.json"]);
  });

  it("builds exactly her rota file, times local from each stored offset", async () => {
    const people = await seedAll(suite.db);
    await seedRota(suite.db, people);
    const files = await download(people.marta);
    expect(files.map((f) => f.name)).toEqual(["employment.json", "rota.json", "absences.json"]);
    const text = rotaOf(files);
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(MARTA_ROTA);
  });

  it("holds none of the colleague's rota and names others only where decided", async () => {
    const people = await seedAll(suite.db);
    await seedRota(suite.db, people);
    const text = rotaOf(await download(people.marta));
    for (const value of [...COLLEAGUE_ROTA_VALUES, ...COLLEAGUE_SHIFT_UTC]) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toContain(people.colleague);
    expect(text).not.toContain(people.manager.id);
    expect(text.split("Colleague Ruiz").length - 1).toBe(3);
    expect(text.split('"otherPerson": "Colleague Ruiz"').length - 1).toBe(3);
    expect(text.split("Luis Manager").length - 1).toBe(1);
    expect(text).toContain('"decidedBy": "Luis Manager"');
    // Positive control: the colleague's own rota carries every one of them.
    const theirs = rotaOf(await download(people.colleague));
    for (const value of COLLEAGUE_ROTA_VALUES) expect(theirs).toContain(value);
  });

  it("keeps a shift moved to someone else after her swap out of her rota", async () => {
    const people = await seedAll(suite.db);
    const { draft } = await seedRota(suite.db, people);
    const fourth = await seedPerson(suite.db, "Fourth Waiter");
    await withTransaction(suite.db, (tx) =>
      new WorkforceBackend().updateShift(tx, { shiftId: draft, personId: fourth }),
    );
    const rota = JSON.parse(rotaOf(await download(people.marta)));
    const text = JSON.stringify(rota);
    for (const value of DRAFT_SHIFT_VALUES) expect(text).not.toContain(value);
    expect(rota.shifts).toEqual([MARTA_ROTA.shifts[0], MARTA_ROTA.shifts[2]]);
    expect(rota.swaps).toEqual(MARTA_ROTA.swaps);
    // Positive control: the fourth person's rota now holds the moved shift.
    const theirs = rotaOf(await download(fourth));
    expect(theirs).toContain("2026-02-14T04:41:00+01:00");
  });

  it("builds rota.json for availability alone, with the other two lists empty", async () => {
    const person = await seedPerson(suite.db, "Available Only");
    await suite.db.insert(availability).values({
      personId: person,
      weekday: 0,
      availableFromMinute: 0,
      availableToMinute: 600,
      effectiveFrom: "2026-09-01",
      createdAt: "2026-08-20T09:00:00.000Z",
    });
    const files = await download(person);
    expect(files.map((f) => f.name)).toEqual(["rota.json"]);
    expect(JSON.parse(files[0]!.text)).toEqual({
      shifts: [],
      availability: [
        {
          weekday: 0,
          from: "00:00",
          to: "10:00",
          effectiveFrom: "2026-09-01",
          effectiveTo: null,
          createdAt: "2026-08-20T09:00:00.000Z",
        },
      ],
      swaps: [],
    });
  });

  it("builds no rota.json for a person with no shift, availability or swap", async () => {
    const people = await seedAll(suite.db);
    await seedRota(suite.db, people);
    const nobody = await seedPerson(suite.db, "No Rota");
    await suite.db.insert(employments).values({
      personId: nobody,
      contractedMinutesPerWeek: 600,
      contractType: "part_time",
      startDate: "2026-09-01",
      payRate: 1000,
    });
    const files = await download(nobody);
    expect(files.map((f) => f.name)).toEqual(["employment.json"]);
  });
});
