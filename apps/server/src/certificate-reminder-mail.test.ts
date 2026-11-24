import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { outgoingMail, withFoldedPersonChanges } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import { verifactuCertificates } from "@waitron/fiscal-verifactu/src/schema/index.js";
import { persons } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { certificateReminderMail } from "./certificate-reminder-mail.js";
import { runCertificateReminderPass } from "./certificate-reminder-worker.js";
import type { CloudEmailGrant } from "./cloud-email.js";
import { runMailPass, type MailSenderDeps, type MailTransport } from "./mail-sender.js";
import { smtpRig } from "./testing/smtp-settings-fixture.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const seat = FISCAL_SLOT.certificate!;
const warning = "2026-08-26T10:00:00Z";
const smtp = { url: "smtp://127.0.0.1:1025", from: "venue@example.test" };
const grant: CloudEmailGrant = {
  id: "d6e27600-db31-47de-b92d-710ff70daff2",
  revision: 1,
  expiresAt: "2026-12-01T00:00:00.000Z",
  enabled: true,
};

let nodeId: string, personId: string, now: Date, signal: AbortSignal;
let send: ReturnType<typeof vi.fn<MailTransport>>;

async function install(installedAt: string, validUntil: string) {
  await suite.db.insert(verifactuCertificates).values({
    nodeId,
    installedAt: new Date(installedAt),
    source: "setup",
    kind: "representante",
    fingerprint: "test-certificate",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: new Date(validUntil),
  });
}

beforeEach(async () => {
  now = new Date(warning);
  signal = new AbortController().signal;
  send = vi.fn<MailTransport>(async () => ({ status: "sent" }));
  await seedVenue(suite.db, { name: "Madrid", timeZone: "Europe/Madrid" });
  nodeId = await seedNode(suite.db);
  await install("2026-01-02T09:00:00Z", "2026-10-24T22:59:00Z");
  const [admin] = await seedPersons(suite.db, {
    displayName: "Admin",
    role: "admin",
    locale: "es-ES",
    email: "admin@example.test",
  });
  personId = admin!.id;
});

const resolveDelivery = async () => ({ mode: "smtp" as const, smtp });
const clock = () => now;
const isPrimary = () => true;
const unconfigured = async () => ({ mode: "unconfigured" as const });
const noticeAllowed = async () => true;
const resolveGrant = async () => grant;
const queue = (useCloud = false) =>
  runCertificateReminderPass({
    db: suite.db,
    seat,
    nodeId,
    now: clock,
    isPrimary,
    signal,
    venueLanguage: "en",
    resolveDelivery: useCloud ? unconfigured : resolveDelivery,
    ...(useCloud && { cloud: { enabled: noticeAllowed, resolveGrant } }),
  });
const pass = (overrides: Partial<MailSenderDeps> = {}) =>
  runMailPass({
    db: suite.db,
    owners: [certificateReminderMail({ seat, nodeId, venueLanguage: "es" })],
    now: clock,
    isPrimary,
    signal,
    resolveDelivery,
    send,
    log: vi.fn(),
    ...overrides,
  });
const row = async () => (await suite.db.select().from(outgoingMail))[0];

it.each([
  ["es-ES", "El certificado de la AEAT caduca el 25 oct 2026", "dentro de 59 día(s)"],
  [null, "El certificado de la AEAT caduca el 25 oct 2026", "dentro de 59 día(s)"],
  ["en-GB", "AEAT certificate expires on 25 Oct 2026", "in 59 day(s)"],
] as const)(
  "words the queued reminder at send time for locale %s",
  async (locale, subject, text) => {
    await queue();
    now = new Date("2026-08-27T10:00:00Z");
    await suite.db
      .update(persons)
      .set(withFoldedPersonChanges({ locale, email: "new@example.test" }))
      .where(eq(persons.id, personId));
    await pass();
    expect(send).toHaveBeenCalledExactlyOnceWith(smtp, {
      to: "new@example.test",
      subject,
      text: expect.stringContaining(text),
    });
    expect(await row()).toMatchObject({ status: "sent", attempts: 1 });
  },
);

it.each(["person", "certificate"] as const)(
  "cancels when the %s changes before claim",
  async (changed) => {
    await queue();
    if (changed === "person")
      await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
    else await install("2026-08-26T11:00:00Z", "2027-01-24T22:59:00Z");
    await pass();
    expect(await row()).toMatchObject({ status: "cancelled", attempts: 0 });
    expect(send).not.toHaveBeenCalled();
  },
);

it("retries a refused weekly reminder after one day", async () => {
  send.mockResolvedValueOnce({
    status: "rejected",
    reason: "email.test_refused",
    serverRefused: true,
  });
  await queue();
  await pass();
  expect(await row()).toMatchObject({
    status: "rejected",
    nextAttemptAt: "2026-08-27T10:00:00.000Z",
    finishedAt: null,
  });
  now = new Date("2026-08-27T09:59:59.999Z");
  expect(await pass()).toEqual({ processed: false });
  now = new Date("2026-08-27T10:00:00Z");
  await pass();
  expect(send).toHaveBeenCalledTimes(2);
  expect(await row()).toMatchObject({ status: "sent", attempts: 2 });
});

it("never repeats a send with an unknown outcome", async () => {
  send.mockRejectedValueOnce(new Error("socket hung up"));
  await queue();
  await pass();
  now = new Date("2026-08-27T10:00:00Z");
  expect(await pass()).toEqual({ processed: false });
  expect(send).toHaveBeenCalledOnce();
  expect(await row()).toMatchObject({ status: "unknown", attempts: 1 });
});

it("expires a refused urgent reminder at the end of its local day", async () => {
  now = new Date("2026-10-11T10:00:00Z");
  send.mockResolvedValueOnce({
    status: "rejected",
    reason: "email.test_refused",
    serverRefused: true,
  });
  await queue();
  await pass();
  now = new Date("2026-10-11T22:00:00Z");
  await pass();
  expect(await row()).toMatchObject({ status: "expired", attempts: 1 });
  expect(send).toHaveBeenCalledOnce();
});

it.each([
  [warning, "2026-08-26T22:00:00.000Z", { stage: "due", date: "2026-10-25", daysLeft: 60 }],
  ["2026-10-24T23:00:00Z", "2026-10-25T23:00:00.000Z", { stage: "expired", date: "2026-10-25" }],
])("sends the certificate facts through Cloud at %s", async (at, expiresAt, facts) => {
  now = new Date(at);
  expect(await queue(true)).toEqual({ processed: true });
  const sendCloudEmail = vi.fn<NonNullable<MailSenderDeps["sendCloudEmail"]>>(async () => ({
    status: "sent",
  }));
  await pass({
    resolveDelivery: unconfigured,
    noticeRelayAllowed: noticeAllowed,
    resolveAccountRelay: resolveGrant,
    sendCloudEmail,
  });
  expect(sendCloudEmail).toHaveBeenCalledExactlyOnceWith(
    grant,
    expect.any(String),
    {
      class: "certificate_reminder",
      displayName: "Madrid",
      locale: "es-ES",
      timeZone: "Europe/Madrid",
      recipient: "admin@example.test",
      expiresAt,
      facts,
    },
    signal,
  );
  expect(await row()).toMatchObject({ status: "sent", attempts: 1 });
  expect(send).not.toHaveBeenCalled();
});

it("holds a future-stamped reminder until its queue time after a clock correction", async () => {
  now = new Date("2026-11-05T10:00:00Z");
  send.mockResolvedValueOnce({
    status: "rejected",
    reason: "email.test_refused",
    serverRefused: true,
  });
  await queue();
  await pass();
  expect(await row()).toMatchObject({ status: "rejected", attempts: 1 });

  now = new Date("2026-06-01T10:00:00Z");
  await pass();
  expect(send).toHaveBeenCalledOnce();
  expect(await row()).toMatchObject({ status: "rejected", attempts: 1 });

  now = new Date("2026-11-05T10:00:00Z");
  expect(await queue()).toEqual({ processed: false });
  await pass();
  expect(send).toHaveBeenCalledTimes(2);
  expect(await row()).toMatchObject({ status: "sent", attempts: 2 });
});

it.each(["venue@example.test", { name: "Harbour Kitchen", address: "venue@example.test" }])(
  "sends a plain reminder using saved SMTP sender %j",
  async (from) => {
    await suite.db.update(persons).set({ locale: "en-GB" }).where(eq(persons.id, personId));
    await queue();
    const rig = await smtpRig("accepted");
    try {
      await pass({
        send: undefined,
        resolveDelivery: async () => ({ mode: "smtp", smtp: { ...rig.config, from } }),
      });
      expect(await row()).toMatchObject({ status: "sent", attempts: 1 });
      expect(rig.messages).toHaveLength(1);
      const raw = rig.messages[0]!;
      expect(raw).toContain(
        typeof from === "string"
          ? "From: venue@example.test"
          : "From: Harbour Kitchen <venue@example.test>",
      );
      expect(raw).toContain("To: admin@example.test");
      expect(raw).toContain("Subject: AEAT certificate expires on 25 Oct 2026");
      expect(raw).toContain("Content-Type: text/plain");
      expect(raw.replace(/=\r?\n/g, "")).toContain(
        "The AEAT certificate expires on 25 Oct 2026, in 60 day(s).",
      );
    } finally {
      await rig.close();
    }
  },
);
