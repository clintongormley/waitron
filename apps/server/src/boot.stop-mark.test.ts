import { incidents } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { eq } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  ephemeralServerFixture,
  withTradingBootServer,
} from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const heartbeatAt = "2026-10-22T09:31:00.000Z";

it.each([
  { restart: false, heartbeatAt },
  { restart: true, heartbeatAt },
  { restart: false, heartbeatAt: null },
])("records only the unexpected primary stop (%j)", async (previousStop) => {
  const venue = await setupVenue(suite.db);
  await withTradingBootServer(
    {
      db: suite.db,
      nodeId: venue.cfg.nodeId,
      scratchPrefix: "waitron-boot-stop-",
      start: (env) => startServer(env, env, { previousStop, boxHost: synchronisedBoxHost() }),
      httpPort,
    },
    async () => {
      const rows = await suite.db
        .select({ params: incidents.params, severity: incidents.severity })
        .from(incidents)
        .where(eq(incidents.code, "start.unplanned_stop"));
      expect(rows).toEqual(
        previousStop.restart || previousStop.heartbeatAt === null
          ? []
          : [
              {
                severity: "warning",
                params: { lastRunningAt: heartbeatAt, lastRunningOffsetMinutes: 120 },
              },
            ],
      );
    },
  );
});

it.each([false, true])(
  "only the signal handler's restart operation writes a mark (signal %s)",
  async (signal) => {
    const venue = await setupVenue(suite.db);
    let markFile: string;
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: venue.cfg.nodeId,
        scratchPrefix: "waitron-boot-mark-",
        start: async (env) => {
          markFile = join(env.WAITRON_STATE_DIR!, "stop-mark.json");
          const server = await startServer(env, env, { boxHost: synchronisedBoxHost() });
          return {
            ...server,
            close: async () => {
              try {
                if (signal) {
                  await server.markRestart?.();
                  expect(await readFile(markFile, "utf8")).toBe('{"version":1,"mark":"restart"}');
                }
              } finally {
                await server.close();
              }
              if (!signal) await expect(stat(markFile)).rejects.toMatchObject({ code: "ENOENT" });
            },
          };
        },
        httpPort,
      },
      async () => {},
    );
  },
);
