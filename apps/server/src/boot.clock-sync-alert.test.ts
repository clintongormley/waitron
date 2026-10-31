import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import type { StartedServer } from "./boot.js";
import type { BoxHostClient } from "./box-host-client.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const timeServiceOff: BoxHostClient = {
  clockStatus: async () => ({
    available: true,
    service: "off",
    unit: null,
    synchronised: false,
    lastSyncAt: null,
  }),
  setClock: async () => ({ available: false, reason: "missing" }),
};

describe("the running server's time-service alert", () => {
  it("shows a switched-off time service in the bell, from the box's clock service", async () => {
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-sync-"));
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
        WAITRON_NODE_ID: venue.cfg.nodeId,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      };
      server = await startServer(env, env, { boxHost: timeServiceOff });
      await vi.waitFor(async () => {
        expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
      });
      const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
        headers: { cookie: venue.managerCookie },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { alerts: Alert[] };
      expect(body.alerts.filter((alert) => alert.code === "clock.sync_off")).toEqual([
        {
          key: "clock.sync_off",
          code: "clock.sync_off",
          params: { reason: "off" },
          severity: "warning",
          since: null,
          screen: "box-status",
          kind: "ongoing",
          area: "box",
        },
      ]);
    } finally {
      if (server !== undefined) await server.close();
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
