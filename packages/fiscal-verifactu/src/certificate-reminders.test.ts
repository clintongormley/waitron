import { sql } from "drizzle-orm";
import { newId, nodes, outgoingMail, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CertKind } from "./aeat-transport.js";
import { seedTaxpayerNodeSif, TAXPAYER_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import {
  claimReminder,
  queueReminders,
  reportReminder,
  wordReminder,
} from "./certificate-reminders.js";
import { recordInstall } from "./certificate-record.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

// 00:59 Madrid on 25 Oct 2026.
const END = new Date("2026-10-24T22:59:00Z");
const WARNING = "2026-08-26T10:00:00Z"; // 60 days left for a representative certificate
const URGENT = "2026-10-11T10:00:00Z"; // 14 days left
const EXPIRED = "2026-10-24T23:00:00Z";

const P1 = "c0000000-0000-4000-8000-000000000001";
const P2 = "c0000000-0000-4000-8000-000000000002";
const ANA = { personId: P1, email: "ana@example.com", language: "en" as const };
const BEA = { personId: P2, email: "bea@example.com", language: "es" as const };

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

function claimAt(
  at: string | Date,
  recipients: readonly (typeof ANA | typeof BEA)[] = [ANA, BEA],
  nodeId: string = TAXPAYER_A.nodeId,
) {
  return withTransaction(suite.db, (tx) => claimReminder(tx, { nodeId }, recipients, new Date(at)));
}

function reportAt(
  id: string,
  outcome: "sent" | "rejected" | "unknown",
  at: string | Date,
  nodeId: string = TAXPAYER_A.nodeId,
) {
  return withTransaction(suite.db, (tx) =>
    reportReminder(tx, { nodeId }, id, outcome, new Date(at)),
  );
}

async function rows(): Promise<Record<string, unknown>[]> {
  return (await suite.db.execute(sql`select * from fiscal_certificate_reminders`)).rows as Record<
    string,
    unknown
  >[];
}

describe("claimReminder", () => {
  it("has nothing to send when the node has no install, or before the first stage", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await expect(claimAt(WARNING)).resolves.toBeNull();
    await install(TAXPAYER_A.nodeId);
    await expect(claimAt("2026-08-25T10:00:00Z")).resolves.toBeNull();
    await expect(rows()).resolves.toEqual([]);
  });

  it("claims each recipient once per stage, lowest person id first, then nothing", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const first = await claimAt(WARNING, [BEA, ANA]);
    expect(first).toEqual({
      id: expect.any(String),
      recipient: "ana@example.com",
      subject: "AEAT certificate expires on 25 Oct 2026",
      text: EN_EXPIRING,
      notice: {
        language: "en",
        timeZone: "Europe/Madrid",
        expiresAt: "2026-08-26T22:00:00.000Z",
        facts: { stage: "due", date: "2026-10-25", daysLeft: 60 },
      },
    });
    const second = await claimAt(WARNING, [BEA, ANA]);
    expect(second?.recipient).toBe("bea@example.com");
    await expect(claimAt(WARNING, [BEA, ANA])).resolves.toBeNull();
    const stored = await rows();
    expect(stored.map((r) => [r.person_id, r.stage, r.status, r.node_id])).toEqual(
      expect.arrayContaining([
        [P1, "warning", "claimed", TAXPAYER_A.nodeId],
        [P2, "warning", "claimed", TAXPAYER_A.nodeId],
      ]),
    );
    expect(stored).toHaveLength(2);
  });

  it("claims again when the certificate moves from warning to urgent", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const warning = await claimAt(WARNING, [ANA]);
    await reportAt(warning!.id, "sent", WARNING);
    await expect(claimAt(WARNING, [ANA])).resolves.toBeNull();
    const urgent = await claimAt(URGENT, [ANA]);
    expect(urgent).toEqual({
      id: expect.any(String),
      recipient: "ana@example.com",
      subject: "AEAT certificate expires on 25 Oct 2026",
      text: EN_EXPIRING.replace("60 day(s)", "14 day(s)"),
      notice: {
        language: "en",
        timeZone: "Europe/Madrid",
        expiresAt: "2026-10-11T22:00:00.000Z",
        facts: { stage: "due", date: "2026-10-25", daysLeft: 14 },
      },
    });
    expect(urgent!.id).not.toBe(warning!.id);
  });

  it("claims a rejected send again only once more than 24 hours have passed since its report", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    const reported = new Date("2026-08-26T10:05:00Z");
    await reportAt(claimed!.id, "rejected", reported);
    const [row] = await rows();
    expect(row).toMatchObject({ status: "failed", reported_at: reported.toISOString() });
    await expect(claimAt(new Date(reported.getTime() + 86_400_000), [ANA])).resolves.toBeNull();
    const again = await claimAt(new Date(reported.getTime() + 86_400_001), [ANA]);
    expect(again).toMatchObject({ id: claimed!.id, recipient: "ana@example.com" });
    const [after] = await rows();
    expect(after).toMatchObject({ status: "claimed", reported_at: null });
    await expect(claimAt(new Date(reported.getTime() + 2 * 86_400_000), [ANA])).resolves.toBeNull();
  });

  it("never claims again a row left claimed or reported unknown", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    await claimAt(WARNING, [ANA]);
    const bea = await claimAt(WARNING, [BEA]);
    await reportAt(bea!.id, "unknown", WARNING);
    await expect(claimAt("2026-09-20T10:00:00Z")).resolves.toBeNull();
    const stored = await rows();
    expect(stored.map((r) => [r.person_id, r.status])).toEqual(
      expect.arrayContaining([
        [P1, "claimed"],
        [P2, "unknown"],
      ]),
    );
  });

  it("records a sent report with its time", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "sent", "2026-08-26T10:01:00Z");
    const [row] = await rows();
    expect(row).toMatchObject({ status: "sent", reported_at: "2026-08-26T10:01:00.000Z" });
  });

  it("leaves a reported row as it is when a second report arrives", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "sent", "2026-08-26T10:01:00Z");
    await reportAt(claimed!.id, "rejected", "2026-08-26T10:02:00Z");
    const [row] = await rows();
    expect(row).toMatchObject({ status: "sent", reported_at: "2026-08-26T10:01:00.000Z" });
    await expect(claimAt("2026-08-27T11:02:00Z", [ANA])).resolves.toBeNull();
  });

  it("leaves a row claimed when the report names another node", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "sent", "2026-08-26T10:01:00Z", TAXPAYER_A.nodeId2);
    const [row] = await rows();
    expect(row).toMatchObject({ status: "claimed", reported_at: null });
  });

  it("never claims again a row that names another node", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "rejected", "2026-08-26T10:01:00Z");
    await suite.db.execute(
      sql`update fiscal_certificate_reminders set node_id = ${TAXPAYER_A.nodeId2}`,
    );
    await expect(claimAt("2026-08-27T11:02:00Z", [ANA])).resolves.toBeNull();
    expect((await rows()).map((row) => row.status)).toEqual(["failed"]);
  });

  it("writes to a Spanish recipient in Spanish", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    await expect(claimAt(WARNING, [BEA])).resolves.toEqual({
      id: expect.any(String),
      recipient: "bea@example.com",
      subject: "El certificado de la AEAT caduca el 25 oct 2026",
      text: ES_EXPIRING,
      notice: {
        language: "es",
        timeZone: "Europe/Madrid",
        expiresAt: "2026-08-26T22:00:00.000Z",
        facts: { stage: "due", date: "2026-10-25", daysLeft: 60 },
      },
    });
  });

  it("ends a due notice at certificate expiry when it comes before midnight", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const reminder = await claimAt("2026-10-24T22:58:00Z", [ANA]);
    expect(reminder?.notice?.expiresAt).toBe("2026-10-24T22:59:00.000Z");
  });

  it("says the certificate expired, in each language, from the instant it ends", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    await expect(claimAt(EXPIRED, [ANA])).resolves.toMatchObject({
      subject: "AEAT certificate expired on 25 Oct 2026",
      text: "The AEAT certificate expired on 25 Oct 2026. Sales continue, but fiscal records wait until you install a new one in Venue settings.",
    });
    await expect(claimAt(EXPIRED, [BEA])).resolves.toMatchObject({
      subject: "El certificado de la AEAT caducó el 25 oct 2026",
      text: "El certificado de la AEAT caducó el 25 oct 2026. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local.",
    });
  });

  it("supplies the expired notice date without a days-left field", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const reminder = await claimAt(EXPIRED, [BEA]);
    expect(reminder?.notice).toEqual({
      language: "es",
      timeZone: "Europe/Madrid",
      expiresAt: "2026-10-25T23:00:00.000Z",
      facts: { stage: "expired", date: "2026-10-25" },
    });
  });

  it("has nothing to send about another node's certificate", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId2);
    await expect(claimAt(WARNING)).resolves.toBeNull();
    await expect(claimAt(WARNING, [ANA], TAXPAYER_A.nodeId2)).resolves.toMatchObject({
      recipient: "ana@example.com",
    });
  });

  it("stores no email address", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    await claimAt(WARNING);
    await claimAt(WARNING);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      for (const value of Object.values(row)) expect(String(value)).not.toContain("@");
    }
  });
});

describe("claimReminder after a handover", () => {
  async function tookOver(): Promise<void> {
    await suite.db.insert(nodes).values({ id: TAXPAYER_A.nodeId2, name: "Node 2" });
    await recordTakeover(suite.db, TAXPAYER_A.nodeId, TAXPAYER_A.nodeId2);
  }

  it("a reminder the old box failed to send is retried here", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    const failed = await claimAt(WARNING, [ANA]);
    const reported = new Date("2026-08-26T10:05:00Z");
    await reportAt(failed!.id, "rejected", reported);
    const sent = await claimAt(WARNING, [BEA]);
    await reportAt(sent!.id, "sent", WARNING);
    await tookOver();

    const later = new Date(reported.getTime() + 86_400_001);
    const again = await claimAt(later, [ANA, BEA], TAXPAYER_A.nodeId2);
    expect(again).toMatchObject({ id: failed!.id, recipient: "ana@example.com" });
    await expect(claimAt(later, [ANA, BEA], TAXPAYER_A.nodeId2)).resolves.toBeNull();
    await reportAt(again!.id, "sent", later, TAXPAYER_A.nodeId2);
    const stored = await rows();
    expect(stored.map((r) => [r.person_id, r.status, r.node_id])).toEqual(
      expect.arrayContaining([
        [P1, "sent", TAXPAYER_A.nodeId],
        [P2, "sent", TAXPAYER_A.nodeId],
      ]),
    );
    expect(stored).toHaveLength(2);
  });

  it("the box that took over sends the next stage of the old box's certificate", async () => {
    await seedTaxpayerNodeSif(suite.db);
    await install(TAXPAYER_A.nodeId);
    await tookOver();

    await expect(claimAt(URGENT, [ANA], TAXPAYER_A.nodeId2)).resolves.toMatchObject({
      recipient: "ana@example.com",
      text: EN_EXPIRING.replace("60 day(s)", "14 day(s)"),
    });
    const [row] = await rows();
    expect(row).toMatchObject({ node_id: TAXPAYER_A.nodeId2, stage: "urgent", status: "claimed" });
  });
});

describe("queueReminders", () => {
  beforeEach(async () => {
    await seedTaxpayerNodeSif(suite.db);
    await seedPersons(suite.db, [
      { id: P1, displayName: "Ana", email: ANA.email },
      { id: P2, displayName: "Bea", email: BEA.email },
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

  it("gives the expired notice its date and a full day to reach Cloud", () => {
    expect(wordAt("expired", "es", EXPIRED).notice).toEqual({
      language: "es",
      timeZone: "Europe/Madrid",
      expiresAt: "2026-10-25T23:00:00.000Z",
      facts: { stage: "expired", date: "2026-10-25" },
    });
  });
});
