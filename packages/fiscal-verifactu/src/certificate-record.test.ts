import { randomBytes } from "node:crypto";
import { loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import * as database from "@waitron/db";
import { nodes, withTransaction } from "@waitron/db";
import { nodeId as brandNodeId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { seedTenantNodeSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
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

const NODE_3 = brandNodeId("a0000000-0000-4000-8000-00000000000a");

async function seedBoxes(): Promise<void> {
  await seedTenantNodeSif(suite.db);
  await suite.db.insert(nodes).values([
    { id: TENANT_A.nodeId2, name: "Node 2" },
    { id: NODE_3, name: "Node 3" },
  ]);
}

function installOn(nodeId: string, installedAt: string, fingerprint: string) {
  return withTransaction(suite.db, (tx) =>
    recordInstall(tx, {
      nodeId,
      installedAt: new Date(installedAt),
      source: "setup",
      kind: "sello",
      fingerprint,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2030-01-01T00:00:00Z"),
    }),
  );
}

function latestOn(nodeId: string) {
  return withTransaction(suite.db, (tx) => latestInstall(tx, nodeId));
}

function installRows() {
  return suite.db.select().from(fiscalCertificateInstalls);
}

describe("sealAeatSecret's install record", () => {
  it("setup's seal writes the vault entry and one install row when the file opens", async () => {
    await seedTenantNodeSif(suite.db);
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
    await seedTenantNodeSif(suite.db);
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
    await seedTenantNodeSif(suite.db);
    const ring = testRing();
    const deps = { db: suite.db, ring, nodeId: TENANT_A.nodeId };

    await sealAeatSecret({ ...deps, now: at("2026-10-18T10:00:00.000Z") }, certOf(candidate));
    await sealAeatSecret({ ...deps, now: at("2026-10-18T11:00:00.000Z") }, certOf(candidate));

    expect(await installRows()).toHaveLength(1);
  });

  it("a different file writes a second row", async () => {
    await seedTenantNodeSif(suite.db);
    const ring = testRing();
    const deps = { db: suite.db, ring, nodeId: TENANT_A.nodeId };

    await sealAeatSecret({ ...deps, now: at("2026-10-18T10:00:00.000Z") }, certOf(candidate));
    await sealAeatSecret({ ...deps, now: at("2026-10-18T11:00:00.000Z") }, certOf(other));

    expect(await installRows()).toHaveLength(2);
    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest?.fingerprint).toBe(other.fingerprint);
  });

  it("a different file sealed under a clock stepped back is still the latest install", async () => {
    await seedTenantNodeSif(suite.db);
    const ring = testRing();
    const deps = { db: suite.db, ring, nodeId: TENANT_A.nodeId };

    await sealAeatSecret({ ...deps, now: at("2026-10-18T10:00:00.000Z") }, certOf(candidate));
    await sealAeatSecret({ ...deps, now: at("2026-10-18T09:59:00.000Z") }, certOf(other));

    const vault = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(vault).toEqual(certOf(other));
    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest?.fingerprint).toBe(other.fingerprint);
    expect(latest?.installedAt).toEqual(new Date("2026-10-18T10:00:00.001Z"));
  });

  it("a seal reads the takeover history once", async () => {
    await seedTenantNodeSif(suite.db);
    const reads = vi.spyOn(database, "readHistoryNodes");
    try {
      await sealAeatSecret(
        {
          db: suite.db,
          ring: testRing(),
          nodeId: TENANT_A.nodeId,
          now: at("2026-10-18T10:00:00.000Z"),
        },
        certOf(candidate),
      );
      expect(reads).toHaveBeenCalledTimes(1);
    } finally {
      reads.mockRestore();
    }
    expect(await installRows()).toHaveLength(1);
  });

  it("a file that does not open is sealed with no install row", async () => {
    await seedTenantNodeSif(suite.db);
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
    await seedTenantNodeSif(suite.db);
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
    await seedTenantNodeSif(suite.db);
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

describe("latestInstall after a handover", () => {
  it("the newest install of the box this one took over from is found", async () => {
    await seedBoxes();
    await installOn(TENANT_A.nodeId, "2026-10-18T10:00:00.000Z", "m1-first");
    await installOn(TENANT_A.nodeId, "2026-10-18T11:00:00.000Z", "m1-second");
    await recordTakeover(suite.db, TENANT_A.nodeId, TENANT_A.nodeId2);

    const latest = await latestOn(TENANT_A.nodeId2);
    expect(latest).toMatchObject({ nodeId: TENANT_A.nodeId, fingerprint: "m1-second" });
    expect(await latestOn(TENANT_A.nodeId)).toMatchObject({ fingerprint: "m1-second" });
  });

  it("this box's own newer install wins", async () => {
    await seedBoxes();
    const ring = testRing();
    await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: at("2026-10-18T10:00:00.000Z") },
      certOf(candidate),
    );
    await recordTakeover(suite.db, TENANT_A.nodeId, TENANT_A.nodeId2);
    // The box that took over runs a minute behind the one it took over from.
    await sealAeatSecret(
      { db: suite.db, ring, nodeId: TENANT_A.nodeId2, now: at("2026-10-18T09:59:00.000Z") },
      certOf(other),
    );

    const latest = await latestOn(TENANT_A.nodeId2);
    expect(latest).toMatchObject({ nodeId: TENANT_A.nodeId2, fingerprint: other.fingerprint });
    expect(latest?.installedAt).toEqual(new Date("2026-10-18T10:00:00.001Z"));
  });

  it("a box two handovers on finds the first box's install when neither later box has one", async () => {
    await seedBoxes();
    await installOn(TENANT_A.nodeId, "2026-10-18T10:00:00.000Z", "m1-only");
    await recordTakeover(suite.db, TENANT_A.nodeId, TENANT_A.nodeId2);
    await recordTakeover(suite.db, TENANT_A.nodeId2, NODE_3);

    expect(await latestOn(NODE_3)).toMatchObject({
      nodeId: TENANT_A.nodeId,
      fingerprint: "m1-only",
    });
  });

  it("an install written behind the newest install of the box this one took over from is stamped after it", async () => {
    await seedBoxes();
    await installOn(TENANT_A.nodeId, "2026-10-18T10:00:00.000Z", "m1-only");
    await recordTakeover(suite.db, TENANT_A.nodeId, TENANT_A.nodeId2);
    await installOn(TENANT_A.nodeId2, "2026-10-18T09:59:00.000Z", "m2-behind");

    const latest = await latestOn(TENANT_A.nodeId2);
    expect(latest).toMatchObject({ nodeId: TENANT_A.nodeId2, fingerprint: "m2-behind" });
    expect(latest?.installedAt).toEqual(new Date("2026-10-18T10:00:00.001Z"));
  });

  it("the box that handed over does not find the install of the box that took over", async () => {
    await seedBoxes();
    await recordTakeover(suite.db, TENANT_A.nodeId, TENANT_A.nodeId2);
    await installOn(TENANT_A.nodeId2, "2026-10-18T10:00:00.000Z", "m2-only");

    expect(await latestOn(TENANT_A.nodeId)).toBeNull();
  });
});
