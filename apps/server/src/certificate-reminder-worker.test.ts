import { seedPersons, type PersonSeed } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { outgoingMail, withTransaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import { verifactuCertificates } from "@waitron/fiscal-verifactu/src/schema/index.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  certificateReminderJob,
  runCertificateReminderPass,
} from "./certificate-reminder-worker.js";
import type { CloudEmailGrant } from "./cloud-email.js";
import { resolveEmailDelivery, type EmailDelivery } from "./email-delivery.js";
import { realSleep } from "./loop.js";
import { runTestJob } from "./testing/run-job.js";
import { saveSmtpForTest } from "./testing/saved-smtp.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const seat = FISCAL_SLOT.certificate!;
// 00:59 Madrid on 25 Oct 2026; 60 days before is the warning (amber) stage.
const END = new Date("2026-10-24T22:59:00Z");
const AMBER = new Date("2026-08-26T10:00:00Z");
const smtp = { url: "smtp://127.0.0.1:1025", from: "venue@example.test" };

let managerIds: string[];
let nodeId: string, primary: boolean, now: Date, controller: AbortController;

const grant: CloudEmailGrant = {
  id: "d6e27600-db31-47de-b92d-710ff70daff2",
  revision: 1,
  expiresAt: "2026-12-01T00:00:00.000Z",
  enabled: true,
};
const unconfigured = async (): Promise<EmailDelivery> => ({ mode: "unconfigured" });
const cloudDelivery = {
  resolveGrant: async () => grant,
  enabled: async () => true,
};

const deps = () => ({
  db: suite.db,
  seat,
  nodeId,
  venueLanguage: "en" as "en" | "es",
  now: () => now,
  isPrimary: () => primary,
  signal: controller.signal,
  resolveDelivery: async (): Promise<EmailDelivery> => ({ mode: "smtp", smtp }),
});
const pass = (overrides: Partial<ReturnType<typeof deps>> = {}) =>
  runCertificateReminderPass({ ...deps(), ...overrides });
const reminders = () => suite.db.select().from(outgoingMail);

async function person(displayName: string, values: Partial<PersonSeed>): Promise<string> {
  const [row] = await seedPersons(suite.db, { displayName, ...values });
  return row!.id;
}

beforeEach(async () => {
  primary = true;
  now = AMBER;
  controller = new AbortController();
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    invoiceLocales: ["es"],
  });
  nodeId = await seedNode(suite.db);
  await suite.db.insert(verifactuCertificates).values({
    nodeId,
    installedAt: new Date("2026-01-02T09:00:00Z"),
    source: "setup",
    kind: "representante",
    fingerprint: "fp-reminder",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: END,
  });
  managerIds = [
    await person("Manager", { role: "manager", email: "manager@example.test", locale: "en-GB" }),
    await person("Admin", { role: "admin", email: " admin@example.test ", locale: "es-ES" }),
  ];
  await person("Supervisor", { role: "supervisor", email: "supervisor@example.test" });
  await person("Staff", { role: "staff", email: "staff@example.test" });
  await person("Gone", {
    role: "manager",
    status: "suspended",
    email: "gone@example.test",
  });
  await person("Blank", { role: "admin", email: "   " });
  await person("Nobody", { role: "admin" });
});

describe("certificate reminder pass", () => {
  it("queues only active managers and admins with email addresses", async () => {
    expect(await pass()).toEqual({ processed: true });
    const queued = await reminders();
    expect(queued.map(({ personId }) => personId).sort()).toEqual(managerIds.sort());
    expect(queued.map(({ status }) => status)).toEqual(["pending", "pending"]);
    expect(await pass()).toEqual({ processed: false });
    expect(await reminders()).toEqual(queued);
  });

  it("queues nothing after the box steps down during delivery resolution", async () => {
    const resolveDelivery = async (): Promise<EmailDelivery> => {
      primary = false;
      return { mode: "smtp", smtp };
    };
    expect(await pass({ resolveDelivery })).toEqual({ processed: false });
    expect(await reminders()).toEqual([]);
  });

  it("queues nothing without SMTP or Cloud delivery", async () => {
    const resolveDelivery = async (): Promise<EmailDelivery> => ({ mode: "unconfigured" });
    expect(await pass({ resolveDelivery })).toEqual({ processed: false });
    expect(await reminders()).toEqual([]);
  });

  it("does nothing on a node that is not the primary", async () => {
    primary = false;
    const resolveDelivery = vi.fn(deps().resolveDelivery);
    expect(await pass({ resolveDelivery })).toEqual({ processed: false });
    expect(resolveDelivery).not.toHaveBeenCalled();
    expect(await reminders()).toEqual([]);
  });

  it("does nothing once the signal is aborted", async () => {
    controller.abort();
    expect(await pass()).toEqual({ processed: false });
    expect(await reminders()).toEqual([]);
  });
});

describe("certificate reminder job", () => {
  it.each([true, false])("queues nothing without a Cloud grant (opt-in %s)", async (enabled) => {
    const resolveGrant = vi.fn(async () => {
      throw new Error("Cloud unavailable");
    });
    await runCertificateReminderPass({
      ...deps(),
      resolveDelivery: unconfigured,
      cloud: { enabled: async () => enabled, resolveGrant },
    });
    expect(resolveGrant).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(await reminders()).toEqual([]);
  });

  it.each(["before lookup", "during lookup"] as const)(
    "preserves mail-server priority for a server saved %s",
    async (timing) => {
      const ring = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      const save = () =>
        withTransaction(suite.db, (tx) =>
          saveSmtpForTest(tx, ring, {
            url: smtp.url,
            from: "venue@example.test, other@example.test",
          }),
        );
      if (timing === "before lookup") await save();
      const resolveGrant = vi.fn(async () => {
        if (timing === "during lookup") await save();
        return grant;
      });
      await runCertificateReminderPass({
        ...deps(),
        resolveDelivery: () => resolveEmailDelivery(suite.db, ring, false),
        cloud: { ...cloudDelivery, resolveGrant },
      });
      expect(resolveGrant).toHaveBeenCalledTimes(timing === "before lookup" ? 0 : 1);
      expect(await reminders()).toEqual([]);
    },
  );

  it("sleeps 500 ms after work and an hour when idle", async () => {
    const sleeps: number[] = [];
    await runTestJob(certificateReminderJob(deps()), controller.signal, {
      sleep: async (ms) => {
        sleeps.push(ms);
        if (ms === 3_600_000) controller.abort();
      },
    }).done;
    expect(sleeps).toEqual([500, 3_600_000]);
    expect((await reminders()).map(({ status }) => status)).toEqual(["pending", "pending"]);
  });

  it("reports a failed pass and carries on after the idle hour", async () => {
    const failure = new Error("credential lookup refused");
    const log = vi.fn();
    const resolveDelivery = vi.fn(deps().resolveDelivery).mockRejectedValueOnce(failure);
    let sleeps = 0;
    await runTestJob(certificateReminderJob({ ...deps(), resolveDelivery }), controller.signal, {
      log,
      sleep: async () => {
        if (++sleeps === 2) controller.abort();
      },
    }).done;
    expect(log).toHaveBeenCalledExactlyOnceWith("error", "job.failed", {
      job: "fiscal.certificate_reminders",
      errorCode: "unknown",
      consecutiveFailures: 1,
    });
    expect((await reminders()).map(({ status }) => status)).toEqual(["pending", "pending"]);
  });

  it("returns promptly when aborted during its hourly sleep", async () => {
    await suite.db.delete(persons);
    let entered!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finished = false;
    const work = runTestJob(certificateReminderJob(deps()), controller.signal, {
      sleep: async (ms, signal) => {
        expect(ms).toBe(3_600_000);
        entered();
        await realSleep(ms, signal);
      },
    }).done.then(() => {
      finished = true;
    });
    await sleeping;
    expect(finished).toBe(false);
    const started = Date.now();
    controller.abort();
    await work;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("waits the idle hour after a pass that throws, and abort still ends that wait", async () => {
    const failure = new Error("smtp credential unreadable");
    const log = vi.fn();
    const sleeps: number[] = [];
    let entered!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const work = runTestJob(
      certificateReminderJob({
        ...deps(),
        resolveDelivery: async () => {
          throw failure;
        },
      }),
      controller.signal,
      {
        log,
        sleep: async (ms, signal) => {
          sleeps.push(ms);
          entered();
          await realSleep(ms, signal);
        },
      },
    ).done;
    await sleeping;
    const started = Date.now();
    controller.abort();
    await work;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(log).toHaveBeenCalledExactlyOnceWith("error", "job.failed", {
      job: "fiscal.certificate_reminders",
      errorCode: "unknown",
      consecutiveFailures: 1,
    });
    expect(sleeps).toEqual([3_600_000]);
  });

  it("checks no delivery configuration once aborted", async () => {
    controller.abort();
    const resolveDelivery = vi.fn(deps().resolveDelivery);
    await runTestJob(certificateReminderJob({ ...deps(), resolveDelivery }), controller.signal)
      .done;
    expect(resolveDelivery).not.toHaveBeenCalled();
  });
});
