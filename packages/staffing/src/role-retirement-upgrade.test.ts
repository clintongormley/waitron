import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts, shiftSwaps, shiftTemplates } from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { staffRoles, shiftAssignments } from "./schema/staffing.js";

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

it("keeps assignments, both swap legs and templates across the free-text role drop", async () => {
  const { cfg, ana, marc, departmentId } = await seedVenue(suite.db);
  // Reconstruct the two retired columns around today's otherwise migrated schema.
  await suite.db.execute(sql`alter table shifts add column role text`);
  await suite.db.execute(sql`alter table shift_templates add column role text`);
  const [first, second] = await suite.db
    .insert(shifts)
    .values(
      [ana, marc].map((personId) => ({
        personId,
        locationId: cfg.locationId,
        startsAt: "2026-01-05T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-01-05T17:00:00Z",
        endsOffsetMinutes: 0,
      })),
    )
    .returning();
  const [staffRole] = await suite.db
    .insert(staffRoles)
    .values({ locationId: cfg.locationId, name: "Waiter", colour: "green" })
    .returning();
  await suite.db
    .insert(shiftAssignments)
    .values({ shiftId: first!.id, departmentId, staffRoleId: staffRole!.id });
  await suite.db.insert(shiftSwaps).values({
    requestedByPersonId: ana,
    fromShiftId: first!.id,
    toPersonId: marc,
    toShiftId: second!.id,
  });
  await suite.db.insert(shiftTemplates).values({
    locationId: cfg.locationId,
    label: "Morning",
    weekday: 1,
    startsMinute: 540,
    endsMinute: 1020,
  });
  await suite.db.execute(sql`update shifts set role = 'Legacy kitchen'`);
  await suite.db.execute(sql`update shift_templates set role = 'Legacy bar'`);
  const before = {
    shifts: await suite.db.select().from(shifts),
    assignments: await suite.db.select().from(shiftAssignments),
    swaps: await suite.db.select().from(shiftSwaps),
    templates: await suite.db.select().from(shiftTemplates),
  };
  expect(
    (await suite.db.execute<{ foreign_keys: number }>(sql`pragma foreign_keys`)).rows[0]!
      .foreign_keys,
  ).toBe(1);
  const migration = readFileSync(
    join(WORKFORCE_MIGRATIONS.migrationsFolder, "0009_real_lockheed.sql"),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint"))
    await suite.db.execute(sql.raw(statement));
  expect({
    shifts: await suite.db.select().from(shifts),
    assignments: await suite.db.select().from(shiftAssignments),
    swaps: await suite.db.select().from(shiftSwaps),
    templates: await suite.db.select().from(shiftTemplates),
  }).toEqual(before);
  expect((await suite.db.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);
  expect(
    (await suite.db.execute<{ name: string }>(sql`pragma table_info(shifts)`)).rows.map(
      (r) => r.name,
    ),
  ).not.toContain("role");
  expect(
    (await suite.db.execute<{ name: string }>(sql`pragma table_info(shift_templates)`)).rows.map(
      (r) => r.name,
    ),
  ).not.toContain("role");
});
