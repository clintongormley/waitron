import { newId, nodes, outgoingMail, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CertKind } from "./aeat-transport.js";
import { seedTaxpayerNodeSif, TAXPAYER_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { queueReminders, wordReminder } from "./certificate-reminders.js";
import { recordInstall } from "./certificate-record.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

// 00:59 Madrid on 25 Oct 2026.
const END = new Date("2026-10-24T22:59:00Z");
const WARNING = "2026-08-26T10:00:00Z"; // 60 days left for a representative certificate
const URGENT = "2026-10-11T10:00:00Z"; // 14 days left
const EXPIRED = "2026-10-24T23:00:00Z";

const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";

const EN_EXPIRING =
  "The AEAT certificate expires on 25 Oct 2026, in 60 day(s). Install the new one in Venue settings before then, or fiscal records will wait.";
const ES_EXPIRING =
  "El certificado de la AEAT caduca el 25 oct 2026, dentro de 60 día(s). Instala el nuevo en Ajustes del local antes de esa fecha o los registros fiscales quedarán en espera.";

async function install(
  nodeId: string,
  kind: CertKind = "representante",
  validUntil = END,
): Promise<string> {
  const id = newId();
  await withTransaction(suite.db, (tx) =>
    recordInstall(tx, {
      id,
      nodeId,
      installedAt: new Date("2026-01-02T09:00:00.000Z"),
      source: "setup",
      personId: null,
      kind,
      fingerprint: `fp-${nodeId}-${kind}`,
      organisation: "WAITRON SL",
      taxId: "89890001K",
      issuer: "Waitron test FNMT (Test FNMT)",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil,
      checkedEndpoint: null,
      checkedAt: null,
    }),
  );
  return id;
}

describe("queueReminders", () => {
  beforeEach(async () => {
    await seedTaxpayerNodeSif(suite.db);
    await seedPersons(suite.db, [
      { id: P1, displayName: "Ana", email: "ana@example.com" },
      { id: P2, displayName: "Bea", email: "bea@example.com" },
    ]);
  });

  const queueAt = (at: string, personIds = [P1, P2], nodeId: string = TAXPAYER_A.nodeId) =>
    withTransaction(suite.db, (tx) => queueReminders(tx, { nodeId }, personIds, new Date(at)));
  const mails = () => suite.db.select().from(outgoingMail).orderBy(outgoingMail.seq);

  it("queues nothing with no install, before warning, or for an unrelated box's certificate", async () => {
    await expect(queueAt(WARNING)).resolves.toBe(0);
    await install(TAXPAYER_A.nodeId2);
    await expect(queueAt(WARNING)).resolves.toBe(0);
    await install(TAXPAYER_A.nodeId);
    await expect(queueAt("2026-08-25T10:00:00Z")).resolves.toBe(0);
    await expect(mails()).resolves.toEqual([]);
  });

  it("queues the first warning once for each person and stores no address", async () => {
    const id = await install(TAXPAYER_A.nodeId);
    await expect(queueAt(WARNING, [P2, P1])).resolves.toBe(2);
    const first = await mails();
    expect(first).toMatchObject(
      [P1, P2].map((personId) => ({
        kind: "certificate_reminder",
        dedupeKey: `certificate:${id}:warning:w0:${personId}`,
        subjectId: id,
        personId,
        params: {
          stage: "warning",
          validUntil: "2026-10-24T22:59:00.000Z",
          timeZone: "Europe/Madrid",
        },
        queuedAt: "2026-08-26T10:00:00.000Z",
        nextAttemptAt: "2026-08-26T10:00:00.000Z",
        notAfter: "2026-09-01T22:00:00.000Z",
        recipient: null,
        status: "pending",
      })),
    );
    expect(JSON.stringify(first)).not.toContain("@");
    await expect(queueAt("2026-08-29T10:00:00Z")).resolves.toBe(0);
    await expect(mails()).resolves.toEqual(first);
  });

  it.each([
    ["warning week", WARNING, "warning:w0", "2026-09-02T10:00:00Z", "warning:w1"],
    ["urgent day", URGENT, "urgent:2026-10-11", "2026-10-12T10:00:00Z", "urgent:2026-10-12"],
    ["expired day", EXPIRED, "expired:2026-10-25", "2026-10-26T10:00:00Z", "expired:2026-10-26"],
  ])("queues again on the next %s", async (_, firstAt, firstPeriod, nextAt, nextPeriod) => {
    const id = await install(TAXPAYER_A.nodeId);
    await expect(queueAt(firstAt, [P1])).resolves.toBe(1);
    await expect(queueAt(nextAt, [P1])).resolves.toBe(1);
    expect((await mails()).map(({ dedupeKey }) => dedupeKey)).toEqual([
      `certificate:${id}:${firstPeriod}:${P1}`,
      `certificate:${id}:${nextPeriod}:${P1}`,
    ]);
  });

  it("keeps a warning week open until the next local week after the autumn clock change", async () => {
    const id = await install(TAXPAYER_A.nodeId, "representante", new Date("2026-12-15T12:00:00Z"));
    await expect(queueAt("2026-10-22T22:00:00Z", [P1])).resolves.toBe(1);
    expect(await mails()).toMatchObject([
      {
        dedupeKey: `certificate:${id}:warning:w1:${P1}`,
        notAfter: "2026-10-29T23:00:00.000Z",
      },
    ]);
  });

  it("queues no further reminders for a certificate after a later install replaces it", async () => {
    await install(TAXPAYER_A.nodeId);
    await expect(queueAt(WARNING, [P1])).resolves.toBe(1);
    const first = await mails();
    await install(TAXPAYER_A.nodeId, "representante", new Date("2027-03-01T10:00:00Z"));
    await expect(queueAt(URGENT, [P1])).resolves.toBe(0);
    await expect(mails()).resolves.toEqual(first);
  });

  it("deduplicates a queued reminder after takeover and queues the next period for the same install", async () => {
    const id = await install(TAXPAYER_A.nodeId);
    await expect(queueAt(WARNING, [P1])).resolves.toBe(1);
    const first = await mails();
    await suite.db.insert(nodes).values({ id: TAXPAYER_A.nodeId2, name: "Node 2" });
    await recordTakeover(suite.db, TAXPAYER_A.nodeId, TAXPAYER_A.nodeId2);

    await expect(queueAt(WARNING, [P1], TAXPAYER_A.nodeId2)).resolves.toBe(0);
    await expect(mails()).resolves.toEqual(first);
    await expect(queueAt(URGENT, [P1], TAXPAYER_A.nodeId2)).resolves.toBe(1);
    expect((await mails())[1]).toMatchObject({
      subjectId: id,
      dedupeKey: `certificate:${id}:urgent:2026-10-11:${P1}`,
    });
  });
});

describe("wordReminder", () => {
  const wordAt = (stage: "warning" | "urgent" | "expired", language: "en" | "es", now: string) =>
    wordReminder({
      params: { stage, validUntil: END.toISOString(), timeZone: "Europe/Madrid" },
      language,
      now: new Date(now),
    });

  it("words a waiting warning using the day it is sent and keeps its Cloud notice deadline", () => {
    expect(wordAt("warning", "es", "2026-08-27T10:00:00Z")).toEqual({
      subject: "El certificado de la AEAT caduca el 25 oct 2026",
      text: ES_EXPIRING.replace("60 día(s)", "59 día(s)"),
      notice: {
        language: "es",
        timeZone: "Europe/Madrid",
        expiresAt: "2026-08-27T22:00:00.000Z",
        facts: { stage: "due", date: "2026-10-25", daysLeft: 59 },
      },
    });
  });

  it("ends a due notice at certificate expiry when it comes before midnight", () => {
    expect(wordAt("urgent", "en", "2026-10-24T22:58:00Z").notice.expiresAt).toBe(END.toISOString());
  });

  it("keeps the English urgent subject and day count", () => {
    expect(wordAt("urgent", "en", URGENT)).toMatchObject({
      subject: "AEAT certificate expires on 25 Oct 2026",
      text: EN_EXPIRING.replace("60 day(s)", "14 day(s)"),
    });
  });

  it.each([
    [
      "en",
      "AEAT certificate expired on 25 Oct 2026",
      "The AEAT certificate expired on 25 Oct 2026. Sales continue, but fiscal records wait until you install a new one in Venue settings.",
    ],
    [
      "es",
      "El certificado de la AEAT caducó el 25 oct 2026",
      "El certificado de la AEAT caducó el 25 oct 2026. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local.",
    ],
  ] as const)("words the expired certificate in %s", (language, subject, text) => {
    expect(wordAt("expired", language, EXPIRED)).toMatchObject({ subject, text });
  });

  it("gives the expired notice its date and a full day to reach Cloud", () => {
    expect(wordAt("expired", "es", EXPIRED).notice).toEqual({
      language: "es",
      timeZone: "Europe/Madrid",
      expiresAt: "2026-10-25T23:00:00.000Z",
      facts: { stage: "expired", date: "2026-10-25" },
    });
  });
});
