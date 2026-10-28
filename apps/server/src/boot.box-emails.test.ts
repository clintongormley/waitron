import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { incidents, locations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import { createBackupRoomHooks } from "./backup-deletion-alert.js";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { boxEmailMessage, type startBoxEmailDuty } from "./box-alert-email.js";
import type { DiskFullState } from "./disk-full-state.js";
import type { TextEmailSender } from "./text-email.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { readVenueLocale } from "./venue-locale.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const holder = vi.hoisted(() => ({
  deps: undefined as Parameters<typeof startBoxEmailDuty>[0] | undefined,
  armed: [] as (() => void)[],
  sent: [] as Parameters<TextEmailSender>[0][],
  outcomes: undefined as BackupOutcomeHolder | undefined,
}));

// The backup run's memory of its last stop, the one boot hands both the bell and the email duty.
vi.mock("./alert-sources.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alert-sources.js")>();
  return {
    ...actual,
    backupAlertSource: (deps: Parameters<typeof actual.backupAlertSource>[0]) => {
      holder.outcomes = deps.outcomes;
      return actual.backupAlertSource(deps);
    },
  };
});

// Boot has no email seam; keep the real duty and every dep boot hands it, and replace only the
// timer, the sender and the delivery settings.
vi.mock("./box-alert-email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./box-alert-email.js")>();
  return {
    ...actual,
    startBoxEmailDuty: (deps: Parameters<typeof actual.startBoxEmailDuty>[0]) => {
      holder.deps = deps;
      return actual.startBoxEmailDuty({
        ...deps,
        context: async () => ({
          ...(await deps.context()),
          delivery: {
            mode: "smtp",
            smtp: { url: "smtp://127.0.0.1:1", from: "box@example.test" },
          },
        }),
        send: async (message) => {
          holder.sent.push(message);
          return "sent";
        },
        timer: (_ms, fn) => {
          holder.armed.push(fn);
          return { cancel: () => {} };
        },
      });
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

async function tick(): Promise<void> {
  const n = holder.armed.length;
  holder.armed.at(-1)!();
  await vi.waitFor(() => expect(holder.armed.length).toBe(n + 1));
}

interface Booted {
  server?: StartedServer;
  scratch?: string;
}

/** Boots the server over the suite's venue in `booted`, so the caller's `finally` can stop it. */
async function bootServer(
  booted: Booted,
  venue: Awaited<ReturnType<typeof setupVenue>>,
): Promise<void> {
  const [port] = await freePorts(1);
  booted.scratch = await mkdtemp(join(tmpdir(), "waitron-boot-box-emails-"));
  const migrationsRoot = join(booted.scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(
    join(booted.scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: booted.scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
    WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
  };
  booted.server = await startServer(env, env);
  await vi.waitFor(async () => {
    expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
  });
}

async function shutDown(booted: Booted): Promise<void> {
  if (booted.server !== undefined) await booted.server.close();
  holder.deps = undefined;
  holder.outcomes = undefined;
  holder.armed.length = 0;
  holder.sent.length = 0;
  if (booted.scratch !== undefined) await rm(booted.scratch, { recursive: true, force: true });
}

async function venueName(venue: Awaited<ReturnType<typeof setupVenue>>): Promise<string> {
  const [location] = await suite.db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, venue.cfg.locationId));
  return location!.name;
}

describe("the running server's managers' email check", () => {
  it("boot emails the managers when the disk is full, once", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    try {
      const [admin] = await suite.db
        .select({ locale: persons.locale })
        .from(persons)
        .where(eq(persons.email, "owner@example.test"));
      const [location] = await suite.db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, venue.cfg.locationId));
      const venueLocale = await readVenueLocale(suite.db, { locationId: venue.cfg.locationId });
      // The admin has no language of their own, so the email takes the venue's.
      expect(admin!.locale).toBeNull();
      expect(venueLocale).toBe("es-ES");

      await bootServer(booted, venue);
      const boxAlerts = async () => {
        const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
          headers: { cookie: venue.managerCookie },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { alerts: Alert[] };
        return body.alerts.filter((alert) => alert.area === "box");
      };
      // A noted stop is cleared by any write that finds room, so every request that may write
      // (the session's last-seen stamp) goes before the stop is noted.
      expect(await boxAlerts()).toEqual([]);

      const disk = holder.deps!.disk as DiskFullState;
      disk.noteRefused();
      expect((await boxAlerts()).map((alert) => alert.code)).toEqual(["storage.disk_full"]);
      expect(disk.noted()).toBe(true);

      await tick();
      expect(holder.sent).toHaveLength(1);
      expect(holder.sent[0]).toMatchObject({
        recipient: "owner@example.test",
        subject: boxEmailMessage("storage.disk_full", "es", location!.name).subject,
      });

      await tick();
      expect(holder.sent).toHaveLength(1);
    } finally {
      await shutDown(booted);
    }
  });

  it("boot emails a backup refused for room and an open old-backups-deleted alert", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    try {
      const name = await venueName(venue);
      // Before the server starts, so the test writes only while it is down.
      await createBackupRoomHooks({
        db: suite.db,
        nodeId: venue.cfg.nodeId,
        fiscal: null,
      }).recordArchivesDeleted(
        [
          { destination: "local", dir: "/b", key: "a1", bytes: 1, takenAt: new Date(0) },
          { destination: "local", dir: "/b", key: "a2", bytes: 1, takenAt: new Date(0) },
        ],
        new Date(),
      );
      const [deleted] = await suite.db
        .select({ params: incidents.params })
        .from(incidents)
        .where(eq(incidents.code, "backup.archives_deleted"));

      await bootServer(booted, venue);
      const sizes = { neededBytes: 3 * 1024 ** 3, availableBytes: 1024 ** 3 };
      holder.outcomes!.runStopped = {
        code: "backup.staging_space_low",
        at: new Date().toISOString(),
        sizes,
      };

      const refusal = boxEmailMessage("backup.run_stopped", "es", name, sizes);
      const deletion = boxEmailMessage("backup.archives_deleted", "es", name, deleted!.params);
      await tick();
      expect(holder.sent.map((message) => message.subject).sort()).toEqual(
        [refusal.subject, deletion.subject].sort(),
      );
      expect(holder.sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ recipient: "owner@example.test", ...refusal }),
          expect.objectContaining({ recipient: "owner@example.test", ...deletion }),
        ]),
      );
    } finally {
      await shutDown(booted);
    }
  });
});
