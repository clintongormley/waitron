import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { readVenue } from "@waitron/db";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { SETUP_CLOCK_STEP_FILE } from "@waitron/store";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  enqueueMail,
  incidents,
  outgoingMail,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import type { Transaction } from "@waitron/db";
import type { EmailDelivery } from "./email-delivery.js";
type AccountMode = (tx: Transaction) => Promise<EmailDelivery["mode"]>;
import { runMailLoop, runMailPass } from "./mail-sender.js";
import { AppError } from "@waitron/shared";
import type { startMailSender } from "./mail-sender.js";
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
import { useTestProducer } from "./testing/test-producer.js";
import { readVenueLocale } from "./venue-locale.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";

useTestProducer();

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const holder = vi.hoisted(() => ({
  pauseMail: false,
  deps: undefined as Parameters<typeof startBoxEmailDuty>[0] | undefined,
  armed: [] as (() => void)[],
  sent: [] as Parameters<TextEmailSender>[0][],
  outcomes: undefined as BackupOutcomeHolder | undefined,
  managementMode: undefined as AccountMode | undefined,
  profileMode: undefined as AccountMode | undefined,
  mail: undefined as Parameters<typeof startMailSender>[0] | undefined,
  smtp: [] as Parameters<typeof import("./smtp-send.js").sendSmtpMessage>[0][],
}));

vi.mock("./management-api.js", async (load) => {
  const actual = await load<typeof import("./management-api.js")>();
  return {
    ...actual,
    mountManagementApi: (...args: Parameters<typeof actual.mountManagementApi>) => {
      holder.managementMode = args[1].accountMailMode;
      return actual.mountManagementApi(...args);
    },
  };
});
vi.mock("./me-api.js", async (load) => {
  const actual = await load<typeof import("./me-api.js")>();
  return {
    ...actual,
    mountMeApi: (...args: Parameters<typeof actual.mountMeApi>) => {
      holder.profileMode = args[1].accountMailMode;
      return actual.mountMeApi(...args);
    },
  };
});
vi.mock("./mail-sender.js", async (load) => {
  const actual = await load<typeof import("./mail-sender.js")>();
  return {
    ...actual,
    startMailSender: (deps: Parameters<typeof actual.startMailSender>[0]) => {
      holder.mail = deps;
      return holder.pauseMail ? Promise.resolve() : actual.startMailSender(deps);
    },
  };
});
vi.mock("./smtp-send.js", async (load) => {
  const actual = await load<typeof import("./smtp-send.js")>();
  return {
    ...actual,
    sendSmtpMessage: async (
      smtp: Parameters<typeof actual.sendSmtpMessage>[0],
      message: Parameters<typeof actual.sendSmtpMessage>[1],
    ) => {
      holder.sent.push({
        smtp,
        recipient: String(message.to),
        subject: String(message.subject),
        text: String(message.text),
      });
      holder.smtp.push(smtp);
      return { status: "sent" as const };
    },
  };
});

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
  email?: { intent: "demo" | "prepare" | "live"; development: boolean },
  setupNote?: unknown[],
): Promise<void> {
  const [port] = await freePorts(1);
  booted.scratch = await mkdtemp(join(tmpdir(), "waitron-boot-box-emails-"));
  if (setupNote !== undefined)
    await writeFile(join(booted.scratch, SETUP_CLOCK_STEP_FILE), JSON.stringify(setupNote));
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
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV:
      email?.development === true
        ? "dev"
        : email?.intent === "live"
          ? "production"
          : "preproduction",
    WAITRON_MANAGEMENT_RP_ID: "localhost",
    WAITRON_MANAGEMENT_ORIGIN: "http://localhost:5191",
    ...(email === undefined ? {} : { WAITRON_ONBOARDING_INTENT: email.intent }),
  };
  if (email?.intent === "live") await stampDeployment(suite.db, "production");
  booted.server = await startServer(env, env);
  await vi.waitFor(async () => {
    expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
  });
}

async function shutDown(booted: Booted): Promise<void> {
  if (booted.server !== undefined) await booted.server.close();
  holder.deps = undefined;
  holder.outcomes = undefined;
  holder.managementMode = undefined;
  holder.profileMode = undefined;
  holder.mail = undefined;
  holder.pauseMail = false;
  holder.armed.length = 0;
  holder.sent.length = 0;
  holder.smtp.length = 0;
  if (booted.scratch !== undefined) await rm(booted.scratch, { recursive: true, force: true });
}

async function venueName(): Promise<string> {
  return (await readVenue(suite.db)).name;
}

describe("the running server's managers' email check", () => {
  it.each([
    ["demo", false, false, "local_capture"],
    ["demo", false, true, "local_capture"],
    ["demo", true, true, "smtp"],
    ["prepare", false, false, "unconfigured"],
    ["prepare", false, true, "smtp"],
    ["prepare", true, false, "local_capture"],
    ["prepare", true, true, "smtp"],
  ] as const)(
    "resolves box mail for %s development=%s configured=%s as %s",
    async (intent, development, configured, mode) => {
      const venue = await setupVenue(suite.db);
      const booted: Booted = {};
      if (configured) {
        await withTransaction(suite.db, (tx) =>
          putCredential(
            tx,
            loadKeyRing({
              WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
              WAITRON_CREDENTIALS_KEY_VERSION: "1",
            }),
            {
              purpose: "email.smtp",
              value: { url: "smtp://smtp.example.test:2525", from: "venue@example.test" },
            },
          ),
        );
      }
      try {
        await bootServer(booted, venue, { intent, development });
        expect((await holder.deps!.context()).delivery).toEqual(
          mode === "unconfigured"
            ? { mode }
            : {
                mode,
                smtp:
                  mode === "smtp"
                    ? {
                        url: "smtp://smtp.example.test:2525",
                        from: { name: await venueName(), address: "venue@example.test" },
                      }
                    : {
                        url: "smtp://127.0.0.1:1025",
                        from: "Waitron <no-reply@waitron.test>",
                      },
              },
        );
      } finally {
        await shutDown(booted);
      }
    },
  );

  it.each([false, true])(
    "Prepare account senders require SMTP during zone repair=%s",
    async (repair) => {
      const venue = await setupVenue(suite.db);
      if (repair)
        await suite.db.run(
          sql`update settings set doc = json_set(doc, '$.timeZone', ${"Invalid/Zone"}) where module = 'business_day'`,
        );
      const booted: Booted = {};
      try {
        await bootServer(booted, venue, { intent: "prepare", development: false });
        expect(holder.managementMode).toBeTypeOf("function");
        expect(holder.profileMode).toBeTypeOf("function");
        await expect(withTransaction(suite.db, holder.managementMode!)).resolves.toBe(
          "unconfigured",
        );
        await expect(withTransaction(suite.db, holder.profileMode!)).resolves.toBe("unconfigured");
        if (!repair) {
          const inbox = await fetch(`http://127.0.0.1:${httpPort()}/management-api/email`, {
            headers: { cookie: venue.managerCookie },
          });
          expect(inbox.status).toBe(200);
          expect(await inbox.json()).toEqual({ mode: "unconfigured", count: 0, messages: [] });
          expect(holder.mail!.owners).toContainEqual(
            expect.objectContaining({ kind: "attendance_question", deliveryRule: "notice" }),
          );
          expect(
            await withTransaction(suite.db, (tx) => holder.mail!.resolveDelivery(tx, "notice")),
          ).toEqual({ mode: "unconfigured" });
        }
      } finally {
        await shutDown(booted);
      }
    },
  );
  it.each([false, true])(
    "reports capture at both account boundaries in Demo (development %s)",
    async (development) => {
      const venue = await setupVenue(suite.db);
      const booted: Booted = {};
      try {
        await bootServer(booted, venue, { intent: "demo", development });
        await expect(withTransaction(suite.db, holder.managementMode!)).resolves.toBe(
          "local_capture",
        );
        await expect(withTransaction(suite.db, holder.profileMode!)).resolves.toBe("local_capture");
      } finally {
        await shutDown(booted);
      }
    },
  );

  it("Prepare sends through the saved relay at both account boundaries", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(
        tx,
        loadKeyRing({
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
        }),
        {
          purpose: "email.smtp",
          value: { url: "smtp://smtp.example.test:2525", from: "venue@example.test" },
        },
      ),
    );
    const booted: Booted = {};
    try {
      await bootServer(booted, venue, { intent: "prepare", development: false });
      await expect(withTransaction(suite.db, holder.managementMode!)).resolves.toBe("smtp");
      await expect(withTransaction(suite.db, holder.profileMode!)).resolves.toBe("smtp");
      expect(
        (await withTransaction(suite.db, (tx) => holder.mail!.resolveDelivery(tx, "notice"))).mode,
      ).toBe("smtp");
    } finally {
      await shutDown(booted);
    }
  });

  it.each([
    ["demo", false, false, "venue@example.test", "captured"],
    ["demo", false, true, "venue@example.test", "captured"],
    ["demo", false, false, "broken\r\nFrom", "captured"],
    ["demo", true, false, "venue@example.test", "sent"],
    ["live", false, false, "venue@example.test", "sent"],
  ] as const)(
    "%s development=%s repair=%s uses %s and reports %s for account mail",
    async (intent, development, repair, from, outcome) => {
      const venue = await setupVenue(suite.db);
      await withTransaction(suite.db, (tx) =>
        putCredential(
          tx,
          loadKeyRing({
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          }),
          { purpose: "email.smtp", value: { url: "smtp://smtp.example.test:2525", from } },
        ),
      );
      if (repair)
        await suite.db.run(
          sql`update settings set doc = json_set(doc, '$.timeZone', ${"Invalid/Zone"}) where module = 'business_day'`,
        );
      const booted: Booted = {};
      await seedPersons(
        suite.db,
        [1, 2].map((n) => ({
          displayName: `Queued mail ${n}`,
          email: `queued-${n}@example.test`,
        })),
      );
      try {
        await bootServer(booted, venue, { intent, development });
        for (const n of [1, 2]) {
          const response = await fetch(
            `http://127.0.0.1:${httpPort()}/management-api/password-reset`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email: `queued-${n}@example.test` }),
            },
          );
          expect(response.status).toBe(202);
          await response.body?.cancel();
        }
        await expect.poll(() => holder.smtp.length, { timeout: 10000 }).toBe(2);
        await expect(withTransaction(suite.db, holder.managementMode!)).resolves.toBe(
          outcome === "captured" ? "local_capture" : "smtp",
        );
        await expect(withTransaction(suite.db, holder.profileMode!)).resolves.toBe(
          outcome === "captured" ? "local_capture" : "smtp",
        );
        const delivery =
          outcome === "captured"
            ? {
                mode: "local_capture",
                smtp: { url: "smtp://127.0.0.1:1025", from: "Waitron <no-reply@waitron.test>" },
              }
            : {
                mode: "smtp",
                smtp: {
                  url: "smtp://smtp.example.test:2525",
                  from: { name: await venueName(), address: "venue@example.test" },
                },
              };
        expect(holder.smtp.slice(-2).map(({ url, from }) => ({ url, from }))).toEqual([
          delivery.smtp,
          delivery.smtp,
        ]);
        if (!repair) {
          expect(
            await withTransaction(suite.db, (tx) => holder.mail!.resolveDelivery(tx, "notice")),
          ).toEqual(delivery);
          expect((await holder.deps!.context()).delivery).toEqual(delivery);
          if (outcome === "captured") {
            const inbox = await fetch(`http://127.0.0.1:${httpPort()}/management-api/email`, {
              headers: { cookie: venue.managerCookie },
            });
            expect(inbox.status).toBe(200);
            expect(await inbox.json()).toEqual({ mode: "local_capture", count: 0, messages: [] });
          }
        }
      } finally {
        await shutDown(booted);
      }
    },
  );

  it("boot emails the managers when the disk is full, once", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    try {
      const [admin] = await suite.db
        .select({ locale: persons.locale })
        .from(persons)
        .where(eq(persons.email, "owner@example.test"));
      const location = await readVenue(suite.db);
      const venueLocale = await readVenueLocale(suite.db);
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

  it("cancels a prior process's notice before the first duty check", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    holder.pauseMail = true;
    const [admin] = await suite.db
      .select()
      .from(persons)
      .where(eq(persons.email, "owner@example.test"));
    const queued = await withTransaction(suite.db, (tx) =>
      enqueueMail(tx, {
        kind: "box_alert",
        dedupeKey: "old-low-space",
        personId: admin!.id,
        params: { code: "storage.space_low", wording: null },
        notAfter: new Date(Date.now() + 86400000),
      }),
    );
    try {
      await bootServer(booted, venue);
      const send = vi.fn(async () => ({ status: "sent" as const }));
      await runMailPass({
        ...holder.mail!,
        send,
        resolveDelivery: async () => ({
          mode: "smtp",
          smtp: { url: "smtp://127.0.0.1:1", from: "box@example.test" },
        }),
      });
      expect(holder.armed).toHaveLength(1);
      expect(
        (
          await holder.mail!.db.select().from(outgoingMail).where(eq(outgoingMail.id, queued.id))
        )[0]!.status,
      ).toBe("cancelled");
      expect(send).not.toHaveBeenCalled();
    } finally {
      await shutDown(booted);
    }
  });

  it("holds due mail without claim errors while the full-disk stop is noted, then sends it", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    holder.pauseMail = true;
    const [admin] = await suite.db
      .select()
      .from(persons)
      .where(eq(persons.email, "owner@example.test"));
    const [incident] = await suite.db
      .insert(incidents)
      .values({
        source: "backup",
        code: "backup.archives_deleted",
        params: { count: 1, date: "2026-11-09", lastDate: "2026-11-09", severalDays: false },
        severity: "warning",
        detectedAt: new Date().toISOString(),
      })
      .returning();
    const queued = await withTransaction(suite.db, (tx) =>
      enqueueMail(tx, {
        kind: "box_alert",
        dedupeKey: "full-disk-pause",
        personId: admin!.id,
        subjectId: incident!.id,
        params: { code: "backup.archives_deleted", wording: null },
        notAfter: new Date(Date.now() + 86400000),
      }),
    );
    try {
      await bootServer(booted, venue);
      const disk = holder.deps!.disk as DiskFullState;
      disk.noteRefused();
      const log = vi.fn();
      const send = vi.fn(async () => ({ status: "sent" as const }));
      const deps = {
        ...holder.mail!,
        log,
        send,
        resolveDelivery: async () => ({
          mode: "smtp" as const,
          smtp: { url: "smtp://127.0.0.1:1", from: "box@example.test" },
        }),
      };
      const lock = vi
        .spyOn(deps.db, "withWriteLock")
        .mockRejectedValue(new AppError("storage.disk_full", {}));
      const controller = new AbortController();
      let sleeps = 0;
      try {
        await runMailLoop({
          ...deps,
          signal: controller.signal,
          sleep: async () => {
            if (++sleeps === 3) controller.abort();
          },
        });
        expect(log.mock.calls.filter(([, event]) => event === "mail.pass.threw")).toEqual([]);
        expect(lock).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(
          (await deps.db.select().from(outgoingMail).where(eq(outgoingMail.id, queued.id)))[0]!
            .status,
        ).toBe("pending");
      } finally {
        lock.mockRestore();
      }
      expect(await disk.full()).toBe(false);
      await runMailPass(deps);
      expect(send).toHaveBeenCalledOnce();
      expect(
        (await deps.db.select().from(outgoingMail).where(eq(outgoingMail.id, queued.id)))[0]!
          .status,
      ).toBe("sent");
    } finally {
      await shutDown(booted);
    }
  });

  it("boot raises and emails each clock step the setup page noted, then deletes the note", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    const step = (id: string, person: string | null, stepMs: number) => ({
      id,
      detectedAt: new Date(Date.parse("2026-10-18T21:40:00.000Z") + stepMs).toISOString(),
      params: {
        confirmationId: null,
        source: "setup",
        person,
        deviceId: null,
        device: null,
        before: "2026-10-18T21:40:00.000Z",
        beforeOffsetMinutes: 120,
        after: new Date(Date.parse("2026-10-18T21:40:00.000Z") + stepMs).toISOString(),
        afterOffsetMinutes: 120,
        stepMs,
        direction: stepMs < 0 ? "back" : "forward",
        verified: true,
        unverified: false,
        byAdmin: false,
        byStaff: false,
        ...(person === null ? { bySetup: true } : { bySetupPerson: true }),
      },
    });
    const steps = [
      step("5b0c7f4e-1d2a-4c3b-9e8f-7a6b5c4d3e2f", "Ben", 3_600_000),
      step("6c1d8a5f-2e3b-4d4c-8f9a-8b7c6d5e4f3a", null, -60_000),
    ];
    try {
      await withTransaction(suite.db, (tx) =>
        putCredential(
          tx,
          loadKeyRing({
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          }),
          {
            purpose: "email.smtp",
            value: { url: "smtp://smtp.example.test:2525", from: "venue@example.test" },
          },
        ),
      );
      await bootServer(booted, venue, undefined, steps);
      const rows = await suite.db
        .select({ id: incidents.id, handled: incidents.acknowledgedAt })
        .from(incidents)
        .where(eq(incidents.code, "clock.corrected"));
      expect(rows.map((row) => row.id).sort()).toEqual(steps.map((s) => s.id).sort());
      expect(rows.filter((row) => row.handled === null).map((row) => row.id)).toEqual([
        steps[1]!.id,
      ]);
      await expect(readFile(join(booted.scratch!, SETUP_CLOCK_STEP_FILE))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const name = await venueName();
      await tick();
      await vi.waitFor(
        () =>
          expect(holder.sent.map((message) => message.text).sort()).toEqual(
            steps.map((s) => boxEmailMessage("clock.corrected", "es", name, s.params).text).sort(),
          ),
        { timeout: 5_000 },
      );
    } finally {
      await shutDown(booted);
    }
  });

  it("boot emails a backup refused for room and an open old-backups-deleted alert", async () => {
    const venue = await setupVenue(suite.db);
    const booted: Booted = {};
    try {
      const name = await venueName();
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

      await withTransaction(suite.db, (tx) =>
        putCredential(
          tx,
          loadKeyRing({
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          }),
          {
            purpose: "email.smtp",
            value: { url: "smtp://smtp.example.test:2525", from: "venue@example.test" },
          },
        ),
      );
      await bootServer(booted, venue);
      expect(holder.mail!.owners.some((owner) => owner.kind === "box_alert")).toBe(true);
      const sizes = { neededBytes: 3 * 1024 ** 3, availableBytes: 1024 ** 3 };
      const stoppedAt = new Date().toISOString();
      holder.outcomes!.runStopped = {
        code: "backup.staging_space_low",
        at: stoppedAt,
        since: stoppedAt,
        sizes,
      };

      const refusal = boxEmailMessage("backup.run_stopped", "es", name, sizes);
      const deletion = boxEmailMessage("backup.archives_deleted", "es", name, deleted!.params);
      await tick();
      await vi.waitFor(
        () =>
          expect(holder.sent.map((message) => message.subject).sort()).toEqual(
            [refusal.subject, deletion.subject].sort(),
          ),
        { timeout: 5_000 },
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
