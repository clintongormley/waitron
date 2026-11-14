import { seedModuleSettings } from "../test/module-settings.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import type { createAuthorityClockStatus } from "./time-health.js";
import { StreamHost } from "./stream-host.js";
import { startSpareFollow } from "./spare-follow.js";
import type { Alert } from "@waitron/module";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

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

vi.mock("./spare-follow.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spare-follow.js")>();
  return { ...actual, startSpareFollow: vi.fn(actual.startSpareFollow) };
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
      await seedModuleSettings(suite.db, { "fiscal-none": false });
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
      await vi.waitFor(async () => {
        expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
      });
      const alerts = async (code = "fiscal.clock_drift") => {
        const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
          headers: { cookie: venue.managerCookie },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { visible: boolean; alerts: Alert[] };
        expect(body.visible).toBe(true);
        return body.alerts.filter((alert) => alert.code === code);
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
      const followed = vi.mocked(startSpareFollow).mock.results.at(-1)!.value;
      const facts = vi.spyOn(followed, "facts").mockResolvedValue({
        lagMs: 70000,
        phase: "apply",
        clock: { boxAt: "2026-11-14T12:00:00.000Z", peerAt: "2026-11-14T12:00:20.000Z" },
      });
      const stream = vi.spyOn(StreamHost.prototype, "status").mockReturnValue({
        state: "streaming",
        reason: null,
        stateSince: "2026-11-14T12:00:00.000Z",
        generation: "gen-1-main-20261114T120000Z",
        bucketProblem: null,
        lagMs: 0,
        lastConfirmedUploadAt: null,
        toSpare: true,
      });
      try {
        expect(await alerts("backup.stream_behind")).toEqual([
          expect.objectContaining({ params: { seconds: 70, phase: "apply", toSpare: true } }),
        ]);
        expect(await alerts("clock.peer_disagrees")).toEqual([
          expect.objectContaining({
            params: expect.objectContaining({ differenceMs: 20000, peer: true }),
          }),
        ]);
        facts.mockResolvedValue({ lagMs: 0, phase: "apply", clock: null });
        expect(await alerts("backup.stream_behind")).toEqual([]);
        expect(await alerts("clock.peer_disagrees")).toEqual([]);
      } finally {
        facts.mockRestore();
        stream.mockRestore();
      }
    } finally {
      if (server !== undefined) await server.close();
      clock.monitor = undefined;
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
