import { Hono } from "hono";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { venueFiscalSelection } from "@waitron/provisioning";
import {
  attendanceDayWork,
  attendanceOperationFacts,
  rosterVersions,
  shifts,
} from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { beginAttendanceDiscovery, discoverAttendanceDays } from "./attendance-discovery.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { ALL_MODULES } from "./modules.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
it("an admitted future cutover change does not block activity on its already discovered preceding day", async () => {
  const venue = await setupVenue(suite.db);
  const locationId = venue.cfg.locationId;
  await suite.db
    .update(locations)
    .set({ dayCutover: "04:00:00", timeZone: "Europe/Madrid" })
    .where(eq(locations.id, locationId));
  const [worker] = await suite.db.select().from(persons).where(eq(persons.role, "staff"));
  const [version] = await suite.db
    .insert(rosterVersions)
    .values({
      locationId,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status: "published",
      publishedAt: "2026-01-04T12:00:00Z",
    })
    .returning();
  await suite.db
    .insert(shifts)
    .values({
      locationId,
      personId: worker!.id,
      rosterVersionId: version!.id,
      startsAt: "2026-01-07T09:00:00.000Z",
      endsAt: "2026-01-07T17:00:00.000Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
    });
  const now = new Date("2026-01-05T12:00:00Z");
  await withTransaction(suite.db, (tx) =>
    beginAttendanceDiscovery(tx, { locationId, generation: "before-settings" }),
  );
  for (let n = 0; n < 20; n++) {
    const { more } = await withTransaction(suite.db, (tx) =>
      discoverAttendanceDays(tx, { locationId, now, batchSize: 100 }),
    );
    if (!more) break;
    if (n === 19) throw new Error("future rota discovery did not settle");
  }
  const [before] = await suite.db.select().from(attendanceDayWork);
  expect(before).toMatchObject({
    businessDay: "2026-01-07",
    endAt: "2026-01-08T03:00:00.000Z",
    evaluatedRevision: 0,
  });
  const app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => now,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
  const changed = await app.request("/management-api/venue-details/business-day-start", {
    method: "PUT",
    headers: { cookie: venue.managerCookie, "content-type": "application/json" },
    body: JSON.stringify({
      effectiveBusinessDay: "2026-01-08",
      dayCutover: "06:00",
      expectedClockRevision: 0,
    }),
  });
  expect(changed.status).toBe(200);
  await expect(
    withTransaction(suite.db, (tx) =>
      recordAttendanceFact(tx, {
        source: "order",
        key: "first-after-reopen",
        personId: worker!.id,
        locationId,
        kind: "order",
        at: "2026-01-07T16:40:00.000Z",
        offsetMinutes: 60,
        outcome: "qualified",
      }),
    ),
  ).resolves.toBeUndefined();
  expect(await suite.db.select().from(attendanceDayWork)).toEqual([
    { ...before, dirtyRevision: before!.dirtyRevision + 1 },
  ]);
  expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([
    expect.objectContaining({
      key: "first-after-reopen",
      businessDay: "2026-01-07",
      at: "2026-01-07T16:40:00.000Z",
      outcome: "qualifying",
    }),
  ]);
});
