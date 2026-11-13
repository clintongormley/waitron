import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const sets = manifestSets();
const suite = useVenueDb({
  migrations: migrationOptionsFor(
    sets.filter((set) => set.name !== "payments"),
    null,
  ),
});

describe("the running server's alerts with card payments off", () => {
  it("raises no card-reader alert on a box without the payments tables", async () => {
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-payments-off-"));
      const migrationsRoot = join(scratch, "migrations");
      const options = migrationOptionsFor(sets, null);
      for (const [index, set] of sets.entries()) {
        await cp(options[index]!.migrationsFolder, join(migrationsRoot, set.name), {
          recursive: true,
        });
      }
      await writeFile(
        join(scratch, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false, payments: false } }),
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
      server = await startServer(env, env);
      const base = `http://127.0.0.1:${httpPort()}`;
      await vi.waitFor(async () => {
        expect((await fetch(`${base}/health`)).status).toBe(200);
      });

      const response = await fetch(`${base}/management-api/alerts`, {
        headers: { cookie: venue.managerCookie },
      });
      expect(response.status).toBe(200);
      const { alerts } = (await response.json()) as { alerts: Alert[] };
      expect(alerts.filter((alert) => alert.area === "card_reader")).toEqual([]);
    } finally {
      if (server !== undefined) await server.close();
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
