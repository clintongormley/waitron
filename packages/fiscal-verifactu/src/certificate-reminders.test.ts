import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import type { CertKind } from "./aeat-transport.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { claimReminder, reportReminder } from "./certificate-reminders.js";
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

async function install(nodeId: string, kind: CertKind = "representante"): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordInstall(tx, {
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
      validUntil: END,
      checkedEndpoint: null,
      checkedAt: null,
    }),
  );
}

function claimAt(
  at: string | Date,
  recipients: readonly (typeof ANA | typeof BEA)[] = [ANA, BEA],
  nodeId: string = TENANT_A.nodeId,
) {
  return withTransaction(suite.db, (tx) =>
    claimReminder(tx, { nodeId, locationId: TENANT_A.locationId }, recipients, new Date(at)),
  );
}

function reportAt(
  id: string,
  outcome: "sent" | "rejected" | "unknown",
  at: string | Date,
  nodeId: string = TENANT_A.nodeId,
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
    await seedTenantTillSif(suite.db);
    await expect(claimAt(WARNING)).resolves.toBeNull();
    await install(TENANT_A.nodeId);
    await expect(claimAt("2026-08-25T10:00:00Z")).resolves.toBeNull();
    await expect(rows()).resolves.toEqual([]);
  });

  it("claims each recipient once per stage, lowest person id first, then nothing", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    const first = await claimAt(WARNING, [BEA, ANA]);
    expect(first).toEqual({
      id: expect.any(String),
      recipient: "ana@example.com",
      subject: "AEAT certificate expires on 25 Oct 2026",
      text: EN_EXPIRING,
    });
    const second = await claimAt(WARNING, [BEA, ANA]);
    expect(second?.recipient).toBe("bea@example.com");
    await expect(claimAt(WARNING, [BEA, ANA])).resolves.toBeNull();
    const stored = await rows();
    expect(stored.map((r) => [r.person_id, r.stage, r.status, r.node_id])).toEqual(
      expect.arrayContaining([
        [P1, "warning", "claimed", TENANT_A.nodeId],
        [P2, "warning", "claimed", TENANT_A.nodeId],
      ]),
    );
    expect(stored).toHaveLength(2);
  });

  it("claims again when the certificate moves from warning to urgent", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    const warning = await claimAt(WARNING, [ANA]);
    await reportAt(warning!.id, "sent", WARNING);
    await expect(claimAt(WARNING, [ANA])).resolves.toBeNull();
    const urgent = await claimAt(URGENT, [ANA]);
    expect(urgent).toEqual({
      id: expect.any(String),
      recipient: "ana@example.com",
      subject: "AEAT certificate expires on 25 Oct 2026",
      text: EN_EXPIRING.replace("60 day(s)", "14 day(s)"),
    });
    expect(urgent!.id).not.toBe(warning!.id);
  });

  it("claims a rejected send again only once more than 24 hours have passed since its report", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
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
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
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
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "sent", "2026-08-26T10:01:00Z");
    const [row] = await rows();
    expect(row).toMatchObject({ status: "sent", reported_at: "2026-08-26T10:01:00.000Z" });
  });

  it("leaves a reported row as it is when a second report arrives", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "sent", "2026-08-26T10:01:00Z");
    await reportAt(claimed!.id, "rejected", "2026-08-26T10:02:00Z");
    const [row] = await rows();
    expect(row).toMatchObject({ status: "sent", reported_at: "2026-08-26T10:01:00.000Z" });
    await expect(claimAt("2026-08-27T11:02:00Z", [ANA])).resolves.toBeNull();
  });

  it("leaves a row claimed when the report names another node", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "sent", "2026-08-26T10:01:00Z", TENANT_A.nodeId2);
    const [row] = await rows();
    expect(row).toMatchObject({ status: "claimed", reported_at: null });
  });

  it("never claims again a row that names another node", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    const claimed = await claimAt(WARNING, [ANA]);
    await reportAt(claimed!.id, "rejected", "2026-08-26T10:01:00Z");
    await suite.db.execute(
      sql`update fiscal_certificate_reminders set node_id = ${TENANT_A.nodeId2}`,
    );
    await expect(claimAt("2026-08-27T11:02:00Z", [ANA])).resolves.toBeNull();
    expect((await rows()).map((row) => row.status)).toEqual(["failed"]);
  });

  it("writes to a Spanish recipient in Spanish", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    await expect(claimAt(WARNING, [BEA])).resolves.toEqual({
      id: expect.any(String),
      recipient: "bea@example.com",
      subject: "El certificado de la AEAT caduca el 25 oct 2026",
      text: ES_EXPIRING,
    });
  });

  it("says the certificate expired, in each language, from the instant it ends", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    await expect(claimAt(EXPIRED, [ANA])).resolves.toMatchObject({
      subject: "AEAT certificate expired on 25 Oct 2026",
      text: "The AEAT certificate expired on 25 Oct 2026. Sales continue, but fiscal records wait until you install a new one in Venue settings.",
    });
    await expect(claimAt(EXPIRED, [BEA])).resolves.toMatchObject({
      subject: "El certificado de la AEAT caducó el 25 oct 2026",
      text: "El certificado de la AEAT caducó el 25 oct 2026. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local.",
    });
  });

  it("has nothing to send about another node's certificate", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId2);
    await expect(claimAt(WARNING)).resolves.toBeNull();
    await expect(claimAt(WARNING, [ANA], TENANT_A.nodeId2)).resolves.toMatchObject({
      recipient: "ana@example.com",
    });
  });

  it("stores no email address", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId);
    await claimAt(WARNING);
    await claimAt(WARNING);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      for (const value of Object.values(row)) expect(String(value)).not.toContain("@");
    }
  });
});
