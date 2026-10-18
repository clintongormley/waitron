import { randomBytes } from "node:crypto";
import { loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { latestInstall, recordInstall } from "./certificate-record.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { fiscalCertificateInstalls } from "./schema/index.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

const authority = makeAuthority();
const candidate = authority.issue();
const other = authority.issue();

function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

function certOf(file: { pfx: Buffer; passphrase: string }) {
  return {
    pfxBase64: file.pfx.toString("base64"),
    passphrase: file.passphrase,
    certKind: "sello",
  };
}

const at = (iso: string) => () => new Date(iso);

function installRows() {
  return suite.db.select().from(fiscalCertificateInstalls);
}

describe("sealAeatSecret's install record", () => {
  it("setup's seal writes the vault entry and one install row when the file opens", async () => {
    await seedTenantTillSif(suite.db);
    const ring = testRing();

    await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: at("2026-10-18T10:00:00.000Z") },
      certOf(candidate),
    );

    const vault = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(vault).toEqual(certOf(candidate));
    const rows = await installRows();
    expect(rows).toEqual([
      {
        id: expect.any(String),
        nodeId: TENANT_A.nodeId,
        installedAt: new Date("2026-10-18T10:00:00.000Z"),
        source: "setup",
        personId: null,
        kind: "sello",
        fingerprint: candidate.fingerprint,
        organisation: "WAITRON SL",
        taxId: "89890001K",
        issuer: "Waitron test FNMT (Test FNMT)",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2030-01-01T00:00:00Z"),
        checkedEndpoint: null,
        checkedAt: null,
      },
    ]);
  });

  it("a seal with no clock stamps the row with the current time", async () => {
    await seedTenantTillSif(suite.db);
    const before = new Date();

    await sealAeatSecret(
      { db: suite.db, ring: testRing(), nodeId: TENANT_A.nodeId },
      certOf(candidate),
    );

    const after = new Date();
    const [row] = await installRows();
    expect(row!.installedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.installedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("a resumed setup sealing the same file writes no second row", async () => {
    await seedTenantTillSif(suite.db);
    const ring = testRing();
    const deps = { db: suite.db, ring, nodeId: TENANT_A.nodeId };

    await sealAeatSecret({ ...deps, now: at("2026-10-18T10:00:00.000Z") }, certOf(candidate));
    await sealAeatSecret({ ...deps, now: at("2026-10-18T11:00:00.000Z") }, certOf(candidate));

    expect(await installRows()).toHaveLength(1);
  });

  it("a different file writes a second row", async () => {
    await seedTenantTillSif(suite.db);
    const ring = testRing();
    const deps = { db: suite.db, ring, nodeId: TENANT_A.nodeId };

    await sealAeatSecret({ ...deps, now: at("2026-10-18T10:00:00.000Z") }, certOf(candidate));
    await sealAeatSecret({ ...deps, now: at("2026-10-18T11:00:00.000Z") }, certOf(other));

    expect(await installRows()).toHaveLength(2);
    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest?.fingerprint).toBe(other.fingerprint);
  });

  it("a file that does not open is sealed with no install row", async () => {
    await seedTenantTillSif(suite.db);
    const ring = testRing();
    const cert = {
      pfxBase64: randomBytes(48).toString("base64"),
      passphrase: "cert-pass-9",
      certKind: "sello",
    };

    await sealAeatSecret({ db: suite.db, ring, nodeId: TENANT_A.nodeId }, cert);

    const vault = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(vault).toEqual(cert);
    expect(await installRows()).toHaveLength(0);
  });

  it("latestInstall reads only the asking node's rows", async () => {
    await seedTenantTillSif(suite.db);
    await withTransaction(suite.db, (tx) =>
      recordInstall(tx, {
        nodeId: TENANT_A.nodeId2,
        installedAt: new Date("2026-10-18T10:00:00.000Z"),
        source: "setup",
        kind: "sello",
        fingerprint: candidate.fingerprint,
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2030-01-01T00:00:00Z"),
      }),
    );

    const mine = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    const theirs = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId2));
    expect(mine).toBeNull();
    expect(theirs?.nodeId).toBe(TENANT_A.nodeId2);
  });

  it("the install row and the vault entry commit together", async () => {
    await seedTenantTillSif(suite.db);
    const ring = testRing();

    const error = await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: () => new Date(Number.NaN) },
      certOf(candidate),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RangeError);
    const vault = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(vault).toBeNull();
    expect(await installRows()).toHaveLength(0);
  });
});
