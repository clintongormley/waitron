import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import type { BoxHostClient } from "./box-host-client.js";
import type { ClockAnchor } from "./clock-correction.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const seen = vi.hoisted(() => ({
  corrections: [] as { inTurn: unknown }[],
  anchors: [] as unknown[][],
  watchCorrections: [] as unknown[],
  watches: [] as unknown[],
}));

vi.mock("./clock-correction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-correction.js")>();
  return {
    ...actual,
    clockCorrection: (...args: Parameters<typeof actual.clockCorrection>) => {
      const correction = actual.clockCorrection(...args);
      const anchors: ClockAnchor[] = [];
      seen.corrections.push(correction);
      seen.anchors.push(anchors);
      return {
        ...correction,
        addAnchor: (anchor: ClockAnchor) => {
          anchors.push(anchor);
          correction.addAnchor(anchor);
        },
      };
    },
  };
});

vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    startClockWatch: (...args: Parameters<typeof actual.startClockWatch>) => {
      seen.watchCorrections.push(args[0].correction);
      const watch = actual.startClockWatch(...args);
      seen.watches.push(watch);
      return watch;
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

describe("the running server's clock correction", () => {
  it("is handed to the watch, has it as an anchor, and a set clears the clock-service caches", async () => {
    let statusReads = 0;
    const host: BoxHostClient = {
      clockStatus: async () => {
        statusReads++;
        return {
          available: true,
          service: "on",
          unit: "chrony.service",
          synchronised: false,
          lastSyncAt: null,
        };
      },
      setClock: async () => ({ available: false, reason: "missing" }),
    };
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-correction-"));
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
      server = await startServer(env, env, { boxHost: host });
      expect(seen.corrections).toHaveLength(1);
      expect(seen.watches).toHaveLength(1);
      expect(seen.watchCorrections).toHaveLength(1);
      for (const method of ["inTurn", "set", "steps", "writePending"] as const) {
        expect((seen.watchCorrections[0] as Record<string, unknown>)[method]).toBe(
          (seen.corrections[0] as Record<string, unknown>)[method],
        );
      }
      expect(seen.anchors[0]).toContain(seen.watches[0]);

      await vi.waitFor(async () => {
        expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
      });
      const alerts = () =>
        fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
          headers: { cookie: venue.managerCookie },
        });
      expect((await alerts()).status).toBe(200);
      const cached = statusReads;
      expect(cached).toBeGreaterThan(0);
      expect((await alerts()).status).toBe(200);
      expect(statusReads).toBe(cached);

      const boxStatus = () =>
        fetch(`http://127.0.0.1:${httpPort()}/api/box/status`, {
          headers: { cookie: venue.managerCookie },
        });
      expect((await boxStatus()).status).toBe(200);
      expect(statusReads).toBe(cached);

      const reanchor = async () => {
        for (const anchor of seen.anchors[0] as ClockAnchor[]) await anchor.reanchor();
      };
      // Box status reads time health, which reads the time service: both caches must be cleared.
      await reanchor();
      expect((await boxStatus()).status).toBe(200);
      expect(statusReads).toBe(cached + 1);
      await reanchor();
      expect((await alerts()).status).toBe(200);
      expect(statusReads).toBe(cached + 2);
    } finally {
      if (server !== undefined) await server.close();
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
