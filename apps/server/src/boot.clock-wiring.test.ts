import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult, type FiscalDutyDeps } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import { startServer, type StartedServer } from "./boot.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

const drain = vi.hoisted(() => ({ calls: [] as FiscalDutyDeps[] }));

// The filing path's only clock input is the drain's deps, so a fake drain stands in for filing.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      return {
        ...real,
        drain: async (deps: FiscalDutyDeps) => {
          drain.calls.push(deps);
          deps.observeAuthorityTime?.({
            authorityTimestamp: "2026-10-05T12:00:00Z",
            sentAt: new Date("2026-10-05T12:02:00Z"),
            receivedAt: new Date("2026-10-05T12:02:02Z"),
          });
          return emptyDrainResult();
        },
      };
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

describe("boot's authority clock wiring", () => {
  it("raises the drift alert from a sample the fiscal drain observes", async () => {
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-wiring-"));
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
        WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
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
      await vi.waitFor(() => expect(drain.calls.length).toBeGreaterThan(0), { timeout: 10_000 });
      await vi.waitFor(
        async () => {
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
        },
        { timeout: 10_000 },
      );
      expect(drain.calls.at(-1)?.observeAuthorityTime).toBeTypeOf("function");
    } finally {
      if (server !== undefined) await server.close();
      drain.calls = [];
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
