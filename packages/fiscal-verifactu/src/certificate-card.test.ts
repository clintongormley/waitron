import { randomBytes } from "node:crypto";
import { credentialRevision, loadKeyRing, putCredential, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { makeAuthority, type Candidate } from "../test/certificate-fixtures.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { lastAcceptedQuery, readCertificateCard } from "./certificate-card.js";
import { recordInstall } from "./certificate-record.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { envios } from "./schema/index.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

const authority = makeAuthority();
const NOW = new Date("2026-10-18T11:00:00Z");
const INSTALLED_AT = "2026-10-01T09:00:00.000Z";
// 75 calendar days after 2026-10-18 in Madrid: inside a sello's 90-day warning, outside its 30.
const certificate = authority.issue({ notAfter: new Date("2027-01-01T00:00:00Z") });

function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

function revision(): Promise<string | null> {
  return withTransaction(suite.db, (tx) => credentialRevision(tx, { purpose: "fiscal.aeat" }));
}

async function sealSetup(nodeId: string, file: Candidate = certificate): Promise<void> {
  await sealAeatSecret(
    { db: suite.db, ring: testRing(), nodeId, now: () => new Date(INSTALLED_AT) },
    { pfxBase64: file.pfx.toString("base64"), passphrase: file.passphrase, certKind: "sello" },
  );
}

function depsFor(
  nodeId: string,
  overrides: Partial<Parameters<typeof readCertificateCard>[0]> = {},
): Parameters<typeof readCertificateCard>[0] {
  return {
    db: suite.db,
    nodeId,
    locationId: TENANT_A.locationId,
    authorize: async () => {},
    nameOf: async () => null,
    ...overrides,
  };
}

const SETUP_INSTALLED = {
  kind: "sello",
  organisation: "WAITRON SL",
  taxId: "89890001K",
  taxIdMatches: true,
  issuer: "Waitron test FNMT (Test FNMT)",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  daysLeft: 75,
  stage: "warning",
  installedAt: INSTALLED_AT,
  source: "setup",
  installedByName: null,
  lastAcceptedAt: null,
} as const;

async function setEnvio(
  registroId: string,
  estado: string,
  confirmadoEn: string | null,
): Promise<void> {
  await suite.db
    .update(envios)
    .set({ estado, confirmadoEn: confirmadoEn === null ? null : new Date(confirmadoEn) })
    .where(eq(envios.registroId, registroId));
}

async function recordDashboardInstall(): Promise<void> {
  const replacement = authority.issue({ notAfter: new Date("2027-01-01T00:00:00Z") });
  await withTransaction(suite.db, (tx) =>
    recordInstall(tx, {
      nodeId: TENANT_A.nodeId,
      installedAt: new Date("2026-10-10T08:00:00.000Z"),
      source: "dashboard",
      personId: "p-1",
      kind: "representante",
      fingerprint: replacement.fingerprint,
      organisation: "WAITRON SL",
      taxId: "89890001K",
      issuer: "Waitron test FNMT (Test FNMT)",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2027-01-01T00:00:00Z"),
      checkedEndpoint: "https://example.test",
      checkedAt: new Date("2026-10-10T08:00:00.000Z"),
    }),
  );
}

describe("readCertificateCard", () => {
  it("answers no revision and nothing installed for an empty vault", async () => {
    await seedTenantTillSif(suite.db);
    await expect(readCertificateCard(depsFor(TENANT_A.nodeId), NOW)).resolves.toEqual({
      revision: null,
      timeZone: "Europe/Madrid",
      installed: null,
    });
  });

  it("answers the vault's revision and nothing installed when the vault has no install row", async () => {
    await seedTenantTillSif(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, testRing(), {
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "x", certKind: "sello" },
      }),
    );
    const card = await readCertificateCard(depsFor(TENANT_A.nodeId), NOW);
    expect(card).toEqual({
      revision: await revision(),
      timeZone: "Europe/Madrid",
      installed: null,
    });
    expect(card.revision).not.toBeNull();
  });

  it("answers every fact of a setup install, and none of the certificate's personal fields", async () => {
    await seedTenantTillSif(suite.db);
    await sealSetup(TENANT_A.nodeId);
    const nameOf = vi.fn(async () => "Never asked");

    const card = await readCertificateCard(depsFor(TENANT_A.nodeId, { nameOf }), NOW);

    expect(card).toEqual({
      revision: await revision(),
      timeZone: "Europe/Madrid",
      installed: SETUP_INSTALLED,
    });
    expect(nameOf).not.toHaveBeenCalled();
    const text = JSON.stringify(card);
    expect(text).not.toContain("ANA GARCIA");
    expect(text).not.toContain("12345678Z");
    expect(text).not.toContain(certificate.passphrase);
  });

  it("names the person who installed a dashboard install, asked inside the read transaction", async () => {
    await seedTenantTillSif(suite.db);
    await sealSetup(TENANT_A.nodeId);
    await recordDashboardInstall();
    let seenTx: Transaction | null = null;
    const authorize = vi.fn(async (tx: Transaction) => {
      seenTx = tx;
    });
    const nameOf = vi.fn(async (tx: Transaction, personId: string) => {
      expect(tx).toBe(seenTx);
      return personId === "p-1" ? "Marta Ruiz" : null;
    });

    const card = await readCertificateCard(depsFor(TENANT_A.nodeId, { authorize, nameOf }), NOW);

    expect(card.installed).toEqual({
      ...SETUP_INSTALLED,
      kind: "representante",
      // A representante's warning starts at 60 days, so 75 days left is no stage yet.
      stage: null,
      installedAt: "2026-10-10T08:00:00.000Z",
      source: "dashboard",
      installedByName: "Marta Ruiz",
    });
    expect(nameOf).toHaveBeenCalledWith(seenTx, "p-1");
  });

  it("says the tax ID does not match when the certificate names another taxpayer", async () => {
    await seedTenantTillSif(suite.db);
    await sealSetup(
      TENANT_A.nodeId,
      authority.issue({
        organizationIdentifier: "VATES-B12345674",
        notAfter: new Date("2027-01-01T00:00:00Z"),
      }),
    );
    const card = await readCertificateCard(depsFor(TENANT_A.nodeId), NOW);
    expect(card.installed).toMatchObject({ taxId: "B12345674", taxIdMatches: false });
  });

  it("answers null for the match when the certificate names no tax ID", async () => {
    await seedTenantTillSif(suite.db);
    await sealSetup(
      TENANT_A.nodeId,
      authority.issue({
        organizationIdentifier: null,
        notAfter: new Date("2027-01-01T00:00:00Z"),
      }),
    );
    const card = await readCertificateCard(depsFor(TENANT_A.nodeId), NOW);
    expect(card.installed).toMatchObject({ taxId: null, taxIdMatches: null });
  });

  it("answers expired, with negative days left, for a certificate past its end", async () => {
    await seedTenantTillSif(suite.db);
    await sealSetup(TENANT_A.nodeId);
    const card = await readCertificateCard(
      depsFor(TENANT_A.nodeId),
      new Date("2027-01-03T12:00:00Z"),
    );
    expect(card.installed).toMatchObject({ daysLeft: -2, stage: "expired" });
  });

  it("answers the latest acceptance at or after the install, either accepted state, on any node", async () => {
    await seedTenantTillSif(suite.db);
    const seeded = await seedPendingEnvios(suite.db, { count: 5 });
    const other = await seedPendingEnvios(suite.db, { count: 1 });
    await sealSetup(seeded.nodeId);
    const [before, atInstall, withErrors, refused, pending] = seeded.registroIds as [
      string,
      string,
      string,
      string,
      string,
    ];
    await setEnvio(before, "aceptado", "2026-09-30T23:00:00.000Z");
    await setEnvio(atInstall, "aceptado", INSTALLED_AT);
    await setEnvio(withErrors, "aceptado_con_errores", "2026-10-05T10:00:00.000Z");
    await setEnvio(refused, "rechazado", "2026-10-06T10:00:00.000Z");
    await setEnvio(pending, "pendiente", null);
    await setEnvio(other.registroIds[0] as string, "aceptado", "2026-10-07T10:00:00.000Z");

    const card = await readCertificateCard(depsFor(seeded.nodeId), NOW);
    expect(card.installed?.lastAcceptedAt).toBe("2026-10-07T10:00:00.000Z");

    await setEnvio(other.registroIds[0] as string, "pendiente", null);
    const ownNode = await readCertificateCard(depsFor(seeded.nodeId), NOW);
    expect(ownNode.installed?.lastAcceptedAt).toBe("2026-10-05T10:00:00.000Z");

    await setEnvio(withErrors, "pendiente", null);
    const atBoundary = await readCertificateCard(depsFor(seeded.nodeId), NOW);
    expect(atBoundary.installed?.lastAcceptedAt).toBe(INSTALLED_AT);
  });

  it("walks the confirmation index newest first for the latest acceptance", async () => {
    const plan = await withTransaction(suite.db, async (tx) => {
      const query = lastAcceptedQuery(tx, new Date(INSTALLED_AT)).toSQL();
      const parts = query.sql.split("?");
      const chunks = parts.flatMap((part, i) =>
        i < query.params.length ? [sql.raw(part), sql`${query.params[i]}`] : [sql.raw(part)],
      );
      return tx.execute<{ detail: string }>(sql`explain query plan ${sql.join(chunks)}`);
    });
    const detail = plan.rows.map((row) => row.detail).join("\n");
    expect(detail).toContain("SEARCH envios USING INDEX envios_confirmado_idx (confirmado_en>?)");
    expect(detail).not.toContain("TEMP B-TREE");
  });

  it("answers no acceptance when every accepted envío predates the install", async () => {
    await seedTenantTillSif(suite.db);
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await sealSetup(seeded.nodeId);
    await setEnvio(seeded.registroIds[0] as string, "aceptado", "2026-09-30T23:00:00.000Z");
    const card = await readCertificateCard(depsFor(seeded.nodeId), NOW);
    expect(card.installed?.lastAcceptedAt).toBeNull();
  });

  it("refuses to match a certificate when there is no taxpayer", async () => {
    await sealSetup(TENANT_A.nodeId);
    await expect(readCertificateCard(depsFor(TENANT_A.nodeId), NOW)).rejects.toThrow(
      "tenants is empty",
    );
  });

  it("runs authorize first, inside the one read transaction, and reads nothing after it refuses", async () => {
    await seedTenantTillSif(suite.db);
    await sealSetup(TENANT_A.nodeId);
    await recordDashboardInstall();
    const refusal = new Error("not permitted");
    const nameOf = vi.fn(async () => "Marta Ruiz");
    const authorize = vi.fn(async (tx: Transaction) => {
      expect(await credentialRevision(tx, { purpose: "fiscal.aeat" })).not.toBeNull();
      throw refusal;
    });
    await expect(
      readCertificateCard(depsFor(TENANT_A.nodeId, { authorize, nameOf }), NOW),
    ).rejects.toBe(refusal);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(nameOf).not.toHaveBeenCalled();
  });
});
