import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import type { createAuthorityClockStatus } from "./time-health.js";
import type { Alert } from "@waitron/module";

const clock = vi.hoisted(() => ({
  monitor: undefined as ReturnType<typeof createAuthorityClockStatus> | undefined,
}));

// Boot has no authority-sample seam; retain its real monitor and expose only its sample input.
vi.mock("./time-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./time-health.js")>();
  return {
    ...actual,
    createAuthorityClockStatus: () => {
      clock.monitor = actual.createAuthorityClockStatus();
      return clock.monitor;
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

describe("the running server's authority clock alert", () => {
  it("reports measured drift through the alerts API and clears it for a correct clock", async () => {
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-alert-"));
      const migrationsRoot = join(scratch, "migrations");
      for (const [index, set] of manifestSets().entries()) {
        await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
          recursive: true,
        });
      }
      await writeFile(
        join(scratch, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false } }),
      );
      const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
      const env = {
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_STATE_DIR: scratch,
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
        WAITRON_TILL_SERIES_ID: venue.cfg.seriesId,
        WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      };
      server = await startServer(env, env);
      await vi.waitFor(async () => {
        expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      });
      const alerts = async () => {
        const response = await fetch(`http://127.0.0.1:${port}/management-api/alerts`, {
          headers: { cookie: venue.managerCookie },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { visible: boolean; alerts: Alert[] };
        expect(body.visible).toBe(true);
        return body.alerts.filter((alert) => alert.code === "fiscal.clock_drift");
      };
      expect(clock.monitor).toBeDefined();
      expect(await alerts()).toEqual([]);
      clock.monitor!.observe({
        authorityTimestamp: "2026-10-05T12:00:00Z",
        sentAt: new Date("2026-10-05T12:02:00Z"),
        receivedAt: new Date("2026-10-05T12:02:02Z"),
      });
      expect(await alerts()).toEqual([
        {
          key: "fiscal.clock_drift",
          code: "fiscal.clock_drift",
          params: { seconds: 121 },
          severity: "warning",
          since: "2026-10-05T12:02:02.000Z",
          kind: "ongoing",
          area: "fiscal",
        },
      ]);
      clock.monitor!.observe({
        authorityTimestamp: "2026-10-05T12:00:00Z",
        sentAt: new Date("2026-10-05T12:00:00Z"),
        receivedAt: new Date("2026-10-05T12:00:02Z"),
      });
      expect(await alerts()).toEqual([]);
    } finally {
      if (server !== undefined) await server.close();
      clock.monitor = undefined;
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
