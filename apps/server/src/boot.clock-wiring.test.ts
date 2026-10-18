import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult, type FiscalDutyDeps } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { StartedServer } from "./boot.js";
import { serverFixture } from "./testing/server-fixture.js";
import { type BackupSupervisorDeps } from "./backup-supervisor.js";
import { createCloudSnapshotWorker } from "./cloud-snapshot-worker.js";
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
import { mountContentSuggestionsApi } from "./content-suggestions-api.js";
import { withCapturedStdout, waitForEvent } from "./testing/boot-harness.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

const { beforeServerStarts, startServer } = serverFixture();

const clocks = vi.hoisted(() => ({ archive: undefined as BackupSupervisorDeps | undefined }));
vi.mock("./backup-supervisor.js", async (original) => {
  const actual = await original<typeof import("./backup-supervisor.js")>();
  return {
    ...actual,
    BackupSupervisor: class extends actual.BackupSupervisor {
      constructor(deps: BackupSupervisorDeps) {
        super(deps);
        clocks.archive = deps;
      }
    },
  };
});
vi.mock("./cloud-snapshot-worker.js", async (original) => {
  const actual = await original<typeof import("./cloud-snapshot-worker.js")>();
  return { ...actual, createCloudSnapshotWorker: vi.fn(actual.createCloudSnapshotWorker) };
});

// The loop lingers after its abort, so a close() that did not await it would resolve first.
const loop = vi.hoisted(() => ({ lingerMs: 500, ended: false }));
vi.mock("./content-suggestion-runner.js", async (original) => {
  const actual = await original<typeof import("./content-suggestion-runner.js")>();
  return {
    ...actual,
    createContentSuggestionRunner: vi.fn(
      (...args: Parameters<typeof actual.createContentSuggestionRunner>) => {
        const runner = actual.createContentSuggestionRunner(...args);
        return {
          ...runner,
          run: vi.fn(async (...run: Parameters<typeof runner.run>) => {
            await runner.run(...run);
            await new Promise((resolve) => setTimeout(resolve, loop.lingerMs));
            loop.ended = true;
          }),
          wake: vi.fn(runner.wake),
        };
      },
    ),
  };
});
vi.mock("./content-suggestions-api.js", async (original) => {
  const actual = await original<typeof import("./content-suggestions-api.js")>();
  return { ...actual, mountContentSuggestionsApi: vi.fn(actual.mountContentSuggestionsApi) };
});

const drain = vi.hoisted(() => ({ calls: [] as FiscalDutyDeps[] }));

// Boot hands filing the authority-clock observer only through the drain's deps, so a fake drain stands in for filing.
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
  it("raises the drift alert from a sample the fiscal drain observes, and runs the Translate all loop until close", async () => {
    beforeServerStarts();
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
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
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_STATE_DIR: scratch,
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_TILL_NODE_ID: venue.cfg.nodeId,

        WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
        WAITRON_CLOUD_ORIGIN: "https://cloud.example",
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
      const archiveClock = clocks.archive!.readClock;
      const cloudClock = vi.mocked(createCloudSnapshotWorker).mock.calls.at(-1)![0].readClock;
      for (const read of [archiveClock, cloudClock])
        expect(await read()).toEqual({
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          cutoverChanges: [],
        });
      const changed = await fetch(
        `http://127.0.0.1:${port}/management-api/venue-details/business-day-start`,
        {
          method: "PUT",
          headers: {
            cookie: venue.managerCookie,
            origin: "https://dashboard.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            effectiveBusinessDay: "2026-10-14",
            dayCutover: "07:00",
            expectedClockRevision: 0,
          }),
        },
      );
      expect(changed.status).toBe(200);
      for (const read of [archiveClock, cloudClock])
        expect(await read()).toEqual({
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          cutoverChanges: [{ effectiveBusinessDay: "2026-10-14", dayCutover: "07:00" }],
        });

      const listed = await fetch(`http://127.0.0.1:${port}/management-api/content-suggestions`, {
        headers: { cookie: venue.managerCookie },
      });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        service: "not_connected",
        cloudOrigin: "https://cloud.example",
        run: null,
      });
      expect(createContentSuggestionRunner).toHaveBeenCalledOnce();
      const runner = vi.mocked(createContentSuggestionRunner).mock.results[0]!.value as ReturnType<
        typeof createContentSuggestionRunner
      >;
      expect(runner.run).toHaveBeenCalledOnce();
      const [signal, options] = vi.mocked(runner.run).mock.calls[0]!;
      expect(signal.aborted).toBe(false);
      const deps = vi.mocked(mountContentSuggestionsApi).mock.calls[0]![1];
      expect(runner.wake).not.toHaveBeenCalled();
      deps.wake();
      expect(runner.wake).toHaveBeenCalledOnce();
      const logged = await withCapturedStdout(async (lines) => {
        options!.onError!(new AppError("cloud.unavailable", {}));
        return waitForEvent(lines, "content.suggestion_runner_failed");
      });
      expect(logged).toMatchObject({ errorCode: "cloud.unavailable" });

      await server.close();
      server = undefined;
      expect(signal.aborted).toBe(true);
      expect(loop.ended).toBe(true);
    } finally {
      try {
        if (server !== undefined) await server.close();
      } finally {
        vi.useRealTimers();
      }
      drain.calls = [];
      clocks.archive = undefined;
      vi.mocked(createCloudSnapshotWorker).mockClear();
      vi.mocked(createContentSuggestionRunner).mockClear();
      vi.mocked(mountContentSuggestionsApi).mockClear();
      loop.ended = false;
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
