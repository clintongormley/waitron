import { beforeEach, describe, expect, it, vi } from "vitest";
import { locations } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import {
  fiscalCertificateInstalls,
  fiscalCertificateReminders,
} from "@waitron/fiscal-verifactu/src/schema/index.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandedLocationId } from "@waitron/shared";
import type { CertificateReminderSender } from "./certificate-reminder-email.js";
import {
  runCertificateReminderLoop,
  runCertificateReminderPass,
} from "./certificate-reminder-worker.js";
import type { EmailDelivery } from "./email-delivery.js";
import { realSleep } from "./loop.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const seat = FISCAL_SLOT.certificate!;
// 00:59 Madrid on 25 Oct 2026; 60 days before is the warning (amber) stage.
const END = new Date("2026-10-24T22:59:00Z");
const AMBER = new Date("2026-08-26T10:00:00Z");
const smtp = { url: "smtp://127.0.0.1:1025", from: "venue@example.test" };

let nodeId: string, locationId: string, primary: boolean, now: Date, controller: AbortController;
let send: ReturnType<typeof vi.fn<CertificateReminderSender>>;

const deps = () => ({
  db: suite.db,
  seat,
  nodeId,
  locationId,
  venueLanguage: "en" as "en" | "es",
  now: () => now,
  isPrimary: () => primary,
  signal: controller.signal,
  resolveDelivery: async (): Promise<EmailDelivery> => ({ mode: "smtp", smtp }),
  send,
});
const pass = (overrides: Partial<ReturnType<typeof deps>> = {}) =>
  runCertificateReminderPass({ ...deps(), ...overrides });
const reminders = () => suite.db.select().from(fiscalCertificateReminders);
const recipients = () => send.mock.calls.map(([message]) => message.recipient).sort();

async function person(
  displayName: string,
  values: Partial<typeof persons.$inferInsert>,
): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName, ...values })
    .returning({ id: persons.id });
  return row!.id;
}

beforeEach(async () => {
  primary = true;
  now = AMBER;
  controller = new AbortController();
  send = vi.fn<CertificateReminderSender>(async () => "sent");
  await seedTenant(suite.db);
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning();
  locationId = place!.id;
  nodeId = await seedNode(suite.db, brandedLocationId(locationId));
  await suite.db.insert(fiscalCertificateInstalls).values({
    nodeId,
    installedAt: new Date("2026-01-02T09:00:00Z"),
    source: "setup",
    kind: "representante",
    fingerprint: "fp-reminder",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: END,
  });
  await person("Manager", { role: "manager", email: "manager@example.test", locale: "en-GB" });
  await person("Admin", { role: "admin", email: " admin@example.test ", locale: "es-ES" });
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
  it("emails each active manager and admin once at amber, in their language, and none on the next pass", async () => {
    while ((await pass()).processed);
    expect(recipients()).toEqual(["admin@example.test", "manager@example.test"]);
    const byRecipient = new Map(send.mock.calls.map(([m]) => [m.recipient, m]));
    expect(byRecipient.get("admin@example.test")).toEqual({
      smtp,
      recipient: "admin@example.test",
      subject: "El certificado de la AEAT caduca el 25 oct 2026",
      text: expect.stringContaining("dentro de 60 día(s)"),
    });
    expect(byRecipient.get("manager@example.test")?.subject).toBe(
      "AEAT certificate expires on 25 Oct 2026",
    );
    expect((await reminders()).map((row) => row.status)).toEqual(["sent", "sent"]);
    send.mockClear();
    expect(await pass()).toEqual({ processed: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("writes to a person with no language in the venue's", async () => {
    await suite.db.delete(persons);
    await person("Plain", { role: "manager", email: "plain@example.test" });
    await pass({ venueLanguage: "es" });
    expect(send.mock.calls[0]![0].subject).toBe("El certificado de la AEAT caduca el 25 oct 2026");
  });

  it("writes to an en-GB person in English in a Spanish venue", async () => {
    await pass({ venueLanguage: "es" });
    const manager = send.mock.calls.find(([m]) => m.recipient === "manager@example.test");
    expect(manager![0].subject).toBe("AEAT certificate expires on 25 Oct 2026");
  });

  it("claims nothing when the node stops being primary just before the claim", async () => {
    let checks = 0;
    // The pass checks at its start, before each claim, and again inside the claim's transaction.
    primary = true;
    expect(await pass({ isPrimary: () => ++checks < 3 })).toEqual({ processed: false });
    expect(checks).toBe(3);
    expect(send).not.toHaveBeenCalled();
    expect(await reminders()).toEqual([]);
  });

  it("claims and sends nothing without SMTP", async () => {
    const resolveDelivery = async (): Promise<EmailDelivery> => ({ mode: "unconfigured" });
    expect(await pass({ resolveDelivery })).toEqual({ processed: false });
    expect(send).not.toHaveBeenCalled();
    expect(await reminders()).toEqual([]);
  });

  it("does nothing on a node that is not the primary", async () => {
    primary = false;
    const resolveDelivery = vi.fn(deps().resolveDelivery);
    expect(await pass({ resolveDelivery })).toEqual({ processed: false });
    expect(resolveDelivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await reminders()).toEqual([]);
  });

  it("does nothing once the signal is aborted", async () => {
    controller.abort();
    expect(await pass()).toEqual({ processed: false });
    expect(send).not.toHaveBeenCalled();
    expect(await reminders()).toEqual([]);
  });

  it("stops between recipients when the signal aborts during a send, still reporting that send", async () => {
    send.mockImplementation(async () => {
      controller.abort();
      return "sent";
    });
    while ((await pass()).processed);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await reminders()).map((row) => row.status)).toEqual(["sent"]);
  });

  it("reports each rejected send as failed", async () => {
    send.mockResolvedValue("rejected");
    await pass();
    expect((await reminders()).map((row) => row.status)).toEqual(["failed", "failed"]);
  });

  it("reports each send whose sender throws as unknown", async () => {
    send.mockRejectedValue(new Error("socket hung up"));
    await pass();
    expect((await reminders()).map((row) => row.status)).toEqual(["unknown", "unknown"]);
  });
});

describe("certificate reminder loop", () => {
  const throwing = (error: unknown) => {
    throw error;
  };

  it("sleeps 500 ms after work and an hour when idle", async () => {
    const sleeps: number[] = [];
    await runCertificateReminderLoop({
      ...deps(),
      onError: throwing,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (ms === 3_600_000) controller.abort();
      },
    });
    expect(sleeps).toEqual([500, 3_600_000]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports a failed pass and a failed sleep, and carries on", async () => {
    const failure = new Error("credential lookup refused");
    const sleepFailure = new Error("sleep failed");
    const errors: unknown[] = [];
    const resolveDelivery = vi.fn(deps().resolveDelivery).mockRejectedValueOnce(failure);
    let sleeps = 0;
    await runCertificateReminderLoop({
      ...deps(),
      resolveDelivery,
      onError: (error) => errors.push(error),
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 1) throw sleepFailure;
        controller.abort();
      },
    });
    expect(errors).toEqual([failure, sleepFailure]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("the loop returns promptly when aborted during its hourly sleep", async () => {
    await suite.db.delete(persons);
    let entered!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finished = false;
    const work = runCertificateReminderLoop({
      ...deps(),
      onError: throwing,
      sleep: async (ms, signal) => {
        expect(ms).toBe(3_600_000);
        entered();
        await realSleep(ms, signal);
      },
    }).then(() => {
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
    const errors: unknown[] = [];
    const sleeps: number[] = [];
    let entered!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const work = runCertificateReminderLoop({
      ...deps(),
      resolveDelivery: async () => {
        throw failure;
      },
      onError: (error) => errors.push(error),
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        entered();
        await realSleep(ms, signal);
      },
    });
    await sleeping;
    const started = Date.now();
    controller.abort();
    await work;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(errors).toEqual([failure]);
    expect(sleeps).toEqual([3_600_000]);
  });

  it("uses no database, configuration or sender once aborted", async () => {
    controller.abort();
    const resolveDelivery = vi.fn(deps().resolveDelivery);
    await runCertificateReminderLoop({ ...deps(), resolveDelivery, onError: throwing });
    expect(resolveDelivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
