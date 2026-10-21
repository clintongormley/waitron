import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { validateBackupVerificationContribution } from "@waitron/module";
import { BOOKINGS_MIGRATIONS } from "./migrations.js";
import { bookings } from "./schema/bookings.js";
import * as api from "./index.js";

const original = useVenueDb({ migrations: [CORE_MIGRATIONS, BOOKINGS_MIGRATIONS] });
const restored = useVenueDb({ migrations: [CORE_MIGRATIONS, BOOKINGS_MIGRATIONS] });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const passed = { status: "passed", checks: [{ code: "data", status: "passed" }] };
const invalid = { status: "invalid", checks: [{ code: "data", status: "invalid" }] };
beforeEach(async () => {
  for (const suite of [original, restored]) {
    await suite.db.insert(locations).values({
      id: "location",
      name: "Venue",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    });
    await suite.db.insert(bookings).values({
      id: "record",
      locationId: "location",
      bookingDate: "2026-10-25",
      bookingTime: "19:30:00",
      partySize: 4,
      contactName: "Recorded guest",
      contactPhone: "0123456789",
      notes: "Archived note",
      tableLabel: "Retired table",
      status: "cancelled",
      createdBy: "recorded-person",
      createdAt: "2026-10-20T07:59:00.000Z",
    });
  }
});
async function run(
  options: { absentBefore?: boolean; emptyAfter?: boolean; sourceSchema?: number | null } = {},
) {
  expect(api.BOOKINGS_BACKUP_VERIFICATION).toBeDefined();
  const path = (db: Database) =>
    db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
  const before = await openBackupQuery(path(options.absentBefore ? absent.db : original.db));
  try {
    const after = await openBackupQuery(path(options.emptyAfter ? absent.db : restored.db));
    try {
      return await api.BOOKINGS_BACKUP_VERIFICATION.verifyRestoredData({
        before: before.query,
        after: after.query,
        entries: {
          async read() {
            throw new Error("No private entries declared");
          },
        },
        source: {
          nodeId: "source",
          locationId: "location",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema: options.sourceSchema === undefined ? 1 : options.sourceSchema,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
it("preserves all captured values without running any duty or action", async () => {
  const before = original.db.all(sql`select * from bookings`);
  const after = restored.db.all(sql`select * from bookings`);
  expect(await run()).toEqual(passed);
  expect(original.db.all(sql`select * from bookings`)).toEqual(before);
  expect(restored.db.all(sql`select * from bookings`)).toEqual(after);
});
it("declares exactly its real table and no private inputs or restore effects", () => {
  const owner = validateBackupVerificationContribution(api.BOOKINGS_BACKUP_VERIFICATION);
  expect(owner.data).toEqual({
    kind: "custom",
    tables: ["bookings"],
    immutableTables: [],
    checks: ["data"],
  });
  expect([
    owner.secrets,
    owner.entries,
    owner.effects,
    owner.publicEvidenceDigest,
    owner.zeroSchema,
    owner.targetOnly,
  ]).toEqual([[], [], [], null, "absent_tables_and_entries", "empty_after_migration"]);
});
it.each([
  "update bookings set party_size = 5",
  "update bookings set contact_name = 'Changed guest'",
  "update bookings set contact_phone = null",
  "update bookings set notes = null",
  "update bookings set table_label = null",
  "update bookings set booking_date = '2026-10-26'",
  "update bookings set booking_time = '20:00:00'",
  "update bookings set status = 'booked'",
  "update bookings set created_by = 'different-person'",
  "update bookings set created_at = '2026-10-20T08:00:00.000Z'",
  "update bookings set id = 'replacement'",
])("detects a retained value replaced: %s", async (change) => {
  expect(await run()).toEqual(passed);
  restored.db.run(sql.raw(change));
  expect(await run()).toEqual(invalid);
});
it("detects a deleted captured row", async () => {
  restored.db.run(sql`delete from bookings`);
  expect(await run()).toEqual(invalid);
});
it("detects a new restored-only row", async () => {
  original.db.run(sql`delete from bookings`);
  expect(await run()).toEqual(invalid);
});
it("refuses a missing restored table", async () => {
  expect(await run({ emptyAfter: true })).toEqual(invalid);
});
it.each([0, null])(
  "refuses declared absence over captured owned state (schema %s)",
  async (sourceSchema) => {
    expect(await run({ sourceSchema })).toEqual(invalid);
  },
);
it.each([0, null])(
  "admits absent source and newly empty target (schema %s)",
  async (sourceSchema) => {
    restored.db.run(sql`delete from bookings`);
    expect(await run({ absentBefore: true, sourceSchema })).toEqual(passed);
  },
);
it.each([0, null])(
  "refuses target rows when the source was absent (schema %s)",
  async (sourceSchema) => {
    expect(await run({ absentBefore: true, sourceSchema })).toEqual(invalid);
  },
);

it("refuses an applied source schema whose owned table is absent", async () => {
  restored.db.run(sql`delete from bookings`);
  expect(await run({ absentBefore: true })).toEqual(invalid);
});
