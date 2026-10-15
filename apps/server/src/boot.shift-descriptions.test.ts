import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { rosterVersions, shifts } from "@waitron/workforce";
import { departments } from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import type { StartedServer } from "./boot.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const { beforeServerStarts, startServer } = serverFixture();
for (const enabled of [true, false]) {
  describe(`shift descriptions actual boot staffing=${enabled}`, () => {
    const disabled = new Set(["fiscal-none", ...(enabled ? [] : ["staffing"])]);
    const modules = ALL_MODULES.filter((module) => !disabled.has(module.name));
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((set) => !disabled.has(set.name)),
        null,
      ),
    });
    it("uses enabled contributions on both own-shift routes and serves null descriptions without staffing tables", async () => {
      beforeServerStarts();
      const venue = await createClockVenue(suite.db, () => new Date(), modules);
      const session = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { personId: venue.personId }),
      );
      const shiftId = await withTransaction(suite.db, async (tx) => {
        const [version] = await tx
          .insert(rosterVersions)
          .values({
            locationId: venue.cfg.locationId,
            periodStart: "2026-01-05",
            periodEnd: "2026-01-11",
            status: "published",
            publishedAt: "2026-01-01T00:00:00Z",
          })
          .returning();
        const [shift] = await tx
          .insert(shifts)
          .values({
            locationId: venue.cfg.locationId,
            personId: venue.personId,
            rosterVersionId: version!.id,
            startsAt: "2026-01-05T09:00:00Z",
            startsOffsetMinutes: 60,
            endsAt: "2026-01-05T17:00:00Z",
            endsOffsetMinutes: 60,
          })
          .returning();
        if (enabled) {
          const [department] = await tx
            .insert(departments)
            .values({
              locationId: venue.cfg.locationId,
              name: "Kitchen",
              tradingName: "Customer kitchen",
            })
            .returning();
          const staffRoleId = crypto.randomUUID();
          await tx.execute(
            sql`insert into staff_roles (id, location_id, name, colour, position) values (${staffRoleId}, ${venue.cfg.locationId}, 'Sous chef', 'green', 0)`,
          );
          await tx.execute(
            sql`insert into shift_assignments (shift_id, department_id, staff_role_id) values (${shift!.id}, ${department!.id}, ${staffRoleId})`,
          );
        }
        return shift!.id;
      });
      await stampDeployment(suite.db, "preproduction");
      const scratch = await mkdtemp(join(tmpdir(), "waitron-shift-descriptions-"));
      let server: StartedServer | undefined;
      try {
        await copyMigrationsRoot(join(scratch, "migrations"));
        await writeFile(
          join(scratch, "modules.json"),
          JSON.stringify({
            modules: Object.fromEntries([...disabled].map((name) => [name, false])),
          }),
        );
        const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
        const [port] = await freePorts(1);
        server = await startServer({
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_STATE_DIR: scratch,
          WAITRON_VENUE_DIR: dirname(database),
          WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
          WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
          WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
          WAITRON_ENV: "preproduction",
        });
        await awaitListening(port);
        for (const prefix of ["/api/schedule", "/management-api/me/schedule"]) {
          const response = await fetch(
            `http://127.0.0.1:${port}${prefix}/shifts?from=2026-01-05&to=2026-01-12`,
            {
              headers: {
                cookie: prefix.startsWith("/api/")
                  ? venue.cookie
                  : `${MANAGEMENT_COOKIE}=${session.token}`,
              },
            },
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual([
            expect.objectContaining({
              id: shiftId,

              description: enabled ? "Kitchen · Sous chef" : null,
            }),
          ]);
        }
      } finally {
        await server?.close();
        await rm(scratch, { recursive: true, force: true });
      }
    });
  });
}
