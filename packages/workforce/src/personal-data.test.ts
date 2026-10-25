import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { describe, expect, it } from "vitest";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WORKFORCE_PERSONAL_DATA } from "./personal-data.js";
import { absences } from "./schema/absences.js";
import { employments } from "./schema/employments.js";
import { seedPerson } from "../test/fixtures.js";

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

  // Inserted out of list order, so the read's ordering is what the test sees.
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
      createdAt: "2024-01-10T08:00:00.000Z",
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
      createdAt: "2026-02-03T07:45:00.000Z",
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
          createdAt: "2024-01-10T08:00:00.000Z",
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
          createdAt: "2026-02-03T07:45:00.000Z",
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
});
