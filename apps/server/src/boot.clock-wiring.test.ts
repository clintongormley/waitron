import { existsSync } from "node:fs";
import { cp, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { incidents } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult, type FiscalDutyDeps } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { BACKUP_ROOM_START_DELETED_FILE } from "@waitron/provisioning";
import type { Alert } from "@waitron/module";
import type {
  TranslationCell,
  TranslationItemPage,
} from "@waitron/catalogue/src/content-translation-types.js";
import { AppError, jobOrigin } from "@waitron/shared";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { type BackupSupervisorDeps } from "./backup-supervisor.js";
import { createBackupRoomHooks } from "./backup-deletion-alert.js";
import { startFreeSpaceWatch } from "./free-space-watch.js";
import { recordStartDeletions } from "./start-backup-room-record.js";
import { lowSpaceBackupDeletion, runningLocalBackends } from "./low-space-backups.js";
import { createCloudSnapshotWorker } from "./cloud-snapshot-worker.js";
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
import { mountContentSuggestionsApi } from "./content-suggestions-api.js";
import { withCapturedStdout, waitForEvent } from "./testing/boot-harness.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const clocks = vi.hoisted(() => ({
  archive: undefined as BackupSupervisorDeps | undefined,
  supervisor: undefined as
    { current(): { retention?: { count: number; days: number } } } | undefined,
  order: [] as string[],
}));
vi.mock("./backup-supervisor.js", async (original) => {
  const actual = await original<typeof import("./backup-supervisor.js")>();
  return {
    ...actual,
    BackupSupervisor: class extends actual.BackupSupervisor {
      constructor(deps: BackupSupervisorDeps) {
        super(deps);
        clocks.archive = deps;
        clocks.supervisor = this;
      }
      override async reload() {
        clocks.order.push("reload");
        return super.reload();
      }
    },
  };
});
vi.mock("./backup-deletion-alert.js", async (original) => {
  const actual = await original<typeof import("./backup-deletion-alert.js")>();
  return { ...actual, createBackupRoomHooks: vi.fn(actual.createBackupRoomHooks) };
});
vi.mock("./start-backup-room-record.js", async (original) => {
  const actual = await original<typeof import("./start-backup-room-record.js")>();
  return {
    ...actual,
    recordStartDeletions: vi.fn((...args: Parameters<typeof actual.recordStartDeletions>) => {
      clocks.order.push("record");
      return actual.recordStartDeletions(...args);
    }),
  };
});
vi.mock("./low-space-backups.js", async (original) => {
  const actual = await original<typeof import("./low-space-backups.js")>();
  return {
    ...actual,
    lowSpaceBackupDeletion: vi.fn(actual.lowSpaceBackupDeletion),
    runningLocalBackends: vi.fn(actual.runningLocalBackends),
  };
});
vi.mock("./free-space-watch.js", async (original) => {
  const actual = await original<typeof import("./free-space-watch.js")>();
  return { ...actual, startFreeSpaceWatch: vi.fn(actual.startFreeSpaceWatch) };
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

const drain = vi.hoisted(() => ({ calls: [] as FiscalDutyDeps[], slots: [] as unknown[] }));

// Boot hands filing the authority-clock observer only through the drain's deps, so a fake drain stands in for filing.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      const enabled = {
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
      drain.slots.push(enabled);
      return enabled;
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

describe("boot's authority clock wiring", () => {
  it("raises the drift alert from a sample the fiscal drain observes, and runs the Translate all loop until close", async () => {
    beforeServerStarts();
    const venue = await setupVenue(suite.db);
    // A step the box made to its clock, already handled, so it raises no alert or email here.
    await suite.db.insert(incidents).values({
      source: jobOrigin("dashboard").source,
      code: "clock.corrected",
      params: { after: "2026-10-12T08:00:00.000Z", stepMs: -90_000 },
      severity: "warning",
      detectedAt: "2026-10-12T08:00:00.000Z",
      acknowledgedAt: "2026-10-12T09:00:00.000Z",
    });
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
      // What a start that deleted old backups before this boot left for it.
      const venueDb = await lstat(database, { bigint: true });
      await writeFile(
        join(scratch, BACKUP_ROOM_START_DELETED_FILE),
        JSON.stringify({
          version: 1,
          at: "2026-10-13T23:00:00.000Z",
          venueDb: {
            dev: venueDb.dev.toString(),
            ino: venueDb.ino.toString(),
            birthtimeNs: venueDb.birthtimeNs.toString(),
          },
          deleted: [
            {
              destination: "usb",
              dir: "/media/usb",
              key: "k",
              bytes: 1,
              takenAt: "2026-10-02T12:00:00.000Z",
            },
          ],
        }),
      );
      const env = {
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_STATE_DIR: scratch,
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_NODE_ID: venue.cfg.nodeId,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
        WAITRON_CLOUD_ORIGIN: "https://cloud.example",
        WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
      };
      server = await startServer(env, env);
      await vi.waitFor(async () => {
        expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
      });
      const alerts = async () => {
        const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
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
      // Every backup run gets the room hooks, built over the ENABLED fiscal seat, not every
      // available fiscal module.
      expect(createBackupRoomHooks).toHaveBeenCalledOnce();
      const [hookDeps] = vi.mocked(createBackupRoomHooks).mock.calls[0]!;
      expect(drain.slots).toContain(hookDeps.fiscal);
      expect(hookDeps.nodeId).toBe(venue.cfg.nodeId);
      const hooks = vi.mocked(createBackupRoomHooks).mock.results[0]!.value as ReturnType<
        typeof createBackupRoomHooks
      >;
      expect(clocks.archive!.readInstallationStart).toBe(hooks.readInstallationStart);
      expect(clocks.archive!.recordArchivesDeleted).toBe(hooks.recordArchivesDeleted);
      expect(clocks.archive!.statfs).toBeUndefined();
      await expect(clocks.archive!.latestClockStep!()).resolves.toEqual({
        confirmedAt: "2026-10-12T08:00:00.000Z",
        stepMs: -90_000,
      });
      // Before the first backup run, which could raise the same alert for its own deletions.
      expect(recordStartDeletions).toHaveBeenCalledOnce();
      expect(vi.mocked(recordStartDeletions).mock.calls[0]![0]).toMatchObject({
        stateDir: scratch,
        venueDir: dirname(database),
        record: hooks.recordArchivesDeleted,
      });
      expect(clocks.order.slice(0, 2)).toEqual(["record", "reload"]);
      expect(
        await suite.db
          .select({ params: incidents.params, detectedAt: incidents.detectedAt })
          .from(incidents)
          .where(eq(incidents.code, "backup.archives_deleted")),
      ).toEqual([
        {
          params: { count: 1, date: "2026-10-02", lastDate: "2026-10-02", severalDays: false },
          detectedAt: "2026-10-13T23:00:00.000Z",
        },
      ]);
      expect(existsSync(join(scratch, BACKUP_ROOM_START_DELETED_FILE))).toBe(false);
      // The free-space watch's first step deletes old backups with the same hooks and staging turn
      // as every run, on the disk the watch reads.
      expect(lowSpaceBackupDeletion).toHaveBeenCalledOnce();
      const [stepDeps] = vi.mocked(lowSpaceBackupDeletion).mock.calls[0]!;
      const [watchDeps] = vi.mocked(startFreeSpaceWatch).mock.calls[0]!;
      expect(stepDeps.dir).toBe(watchDeps.dir);
      expect(stepDeps.staging).toBe(clocks.archive!.stagingTurn);
      expect(stepDeps.installationStartedAt).toBe(hooks.readInstallationStart);
      expect(stepDeps.onArchivesDeleted).toBe(hooks.recordArchivesDeleted);
      expect(stepDeps.statfs).toBe(watchDeps.statfs);
      // The same step read as every run, so making room holds what the run's pruning keeps; the
      // age cap is the running duty's, none here.
      expect(stepDeps.latestClockStep).toBe(clocks.archive!.latestClockStep);
      expect(stepDeps.retainDays!()).toBeUndefined();
      const running = clocks.supervisor!.current();
      const current = vi
        .spyOn(clocks.supervisor!, "current")
        .mockReturnValue({ ...running, retention: { count: 3, days: 12 } });
      expect(stepDeps.retainDays!()).toBe(12);
      current.mockRestore();
      // The step's folders are the running duty's, read from the supervisor's live status: this
      // primary has no backups set up, so there are none.
      expect(stepDeps.backends()).toEqual([]);
      expect(runningLocalBackends).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false, isPrimary: true, destinations: [] }),
      );
      expect(watchDeps.freeOldBackups).toBe(
        vi.mocked(lowSpaceBackupDeletion).mock.results[0]!.value,
      );
      const live = suite.db.all<{ at: string }>(
        sql`select registrado_en as at from registro_sif where node_id = ${venue.cfg.nodeId} and revocado_en is null`,
      );
      expect(live).toHaveLength(1);
      expect((await hooks.readInstallationStart())?.toISOString()).toBe(
        new Date(live[0]!.at).toISOString(),
      );
      const changed = await fetch(
        `http://127.0.0.1:${httpPort()}/management-api/venue-details/business-day-start`,
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

      const listed = await fetch(
        `http://127.0.0.1:${httpPort()}/management-api/content-suggestions`,
        {
          headers: { cookie: venue.managerCookie },
        },
      );
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        service: "not_connected",
        cloudOrigin: "https://cloud.example",
        run: null,
      });
      const translationUrl = `http://127.0.0.1:${httpPort()}/management-api/content-translations`;
      const readTranslations = async () => {
        const response = await fetch(
          `${translationUrl}?language=en&target=product:${venue.cafeId}`,
          { headers: { cookie: venue.managerCookie } },
        );
        expect(response.status).toBe(200);
        return response.json() as Promise<TranslationItemPage>;
      };
      const originalCell = (await readTranslations()).rows[0]!.cells[0]!;
      const saveTranslation = (origin: string, expected: string, text: string) =>
        fetch(translationUrl, {
          method: "PUT",
          headers: {
            cookie: venue.managerCookie,
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            edits: [
              { kind: "product", id: venue.cafeId, language: "en", field: "name", expected, text },
            ],
          }),
        });
      const refused = await saveTranslation(
        "https://untrusted.example",
        originalCell.expected,
        "Wrong origin",
      );
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({
        error: { code: "authorization.not_permitted", params: {} },
      });
      expect((await readTranslations()).rows[0]!.cells[0]!).toEqual(originalCell);
      const translated = await saveTranslation(
        "https://dashboard.example",
        originalCell.expected,
        "Customer coffee",
      );
      expect(translated.status).toBe(200);
      const translatedBody = (await translated.json()) as { saved: TranslationCell[] };
      expect(
        translatedBody.saved.map(({ kind, id, language, field, text }) => ({
          kind,
          id,
          language,
          field,
          text,
        })),
      ).toEqual([
        {
          kind: "product",
          id: venue.cafeId,
          language: "en",
          field: "name",
          text: "Customer coffee",
        },
      ]);
      expect((await readTranslations()).rows[0]!.cells[0]!.text).toBe("Customer coffee");

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
      drain.slots = [];
      clocks.archive = undefined;
      clocks.order = [];
      vi.mocked(createBackupRoomHooks).mockClear();
      vi.mocked(recordStartDeletions).mockClear();
      vi.mocked(createCloudSnapshotWorker).mockClear();
      vi.mocked(createContentSuggestionRunner).mockClear();
      vi.mocked(mountContentSuggestionsApi).mockClear();
      loop.ended = false;
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
