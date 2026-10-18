import { randomBytes } from "node:crypto";
import {
  credentialRevision,
  loadKeyRing,
  tryGetCredential,
  type KeyRing,
} from "@waitron/credentials";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  makeAuthority,
  SIN_DATOS_BODY,
  SOAP_FAULT_BODY,
  startAnsweringServer,
  type AnsweringServer,
  type Candidate,
} from "../test/certificate-fixtures.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { RC2_CANDIDATE } from "../test/openssl-certificates.js";
import { mtlsFetch } from "./aeat-transport.js";
import type { CheckTransport } from "./certificate-check.js";
import {
  installCertificate,
  venueTimeZone,
  type InstallAnswer,
  type InstallDeps,
} from "./certificate-install.js";
import { latestInstall } from "./certificate-record.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { fiscalCertificateInstalls } from "./schema/index.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

const authority = makeAuthority();
const installed = authority.issue();
const candidate = authority.issue();
const NOW = new Date("2026-10-18T11:00:00Z");

// `@waitron/identity` declares this code; this package does not depend on it.
function notPermitted(): AppError {
  return new AppError(
    "authorization.not_permitted" as never,
    { permission: "system.manage" } as never,
  );
}

const servers: AnsweringServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(
  answer: Parameters<typeof startAnsweringServer>[1] = { status: 200, body: SIN_DATOS_BODY },
): Promise<AnsweringServer> {
  const server = await startAnsweringServer(authority, answer);
  servers.push(server);
  return server;
}

function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

function transportTo(server: AnsweringServer): CheckTransport {
  return {
    endpointFor: () => server.origin,
    fetchFor: (material) => mtlsFetch(material, authority.caPem),
  };
}

function fileOf(file: { pfx: Buffer; passphrase: string }) {
  return { pfxBase64: file.pfx.toString("base64"), passphrase: file.passphrase };
}

interface Venue {
  ring: KeyRing;
  revision: string | null;
}

/** The taxpayer, and `installed` sealed by setup at `installedAt`. */
async function venue(installedAt = "2026-10-18T10:00:00.000Z"): Promise<Venue> {
  await seedTenantTillSif(suite.db);
  const ring = testRing();
  await sealAeatSecret(
    { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: () => new Date(installedAt) },
    { ...fileOf(installed), certKind: "sello" },
  );
  return { ring, revision: await revision() };
}

function revision(): Promise<string | null> {
  return withTransaction(suite.db, (tx) => credentialRevision(tx, { purpose: "fiscal.aeat" }));
}

function installRows() {
  return suite.db.select().from(fiscalCertificateInstalls);
}

async function state() {
  return { revision: await revision(), rows: await installRows() };
}

function depsFor(
  v: Venue,
  server: AnsweringServer,
  overrides: Partial<InstallDeps> = {},
): InstallDeps {
  return {
    db: suite.db,
    ring: v.ring,
    nodeId: TENANT_A.nodeId,
    locationId: TENANT_A.locationId,
    environment: "preproduction",
    authorize: async () => ({ personId: "p-1" }),
    transport: transportTo(server),
    ...overrides,
  };
}

function bodyFor(v: Venue, file: { pfx: Buffer; passphrase: string }, extra: object = {}) {
  return { ...fileOf(file), certKind: "sello", expectedRevision: v.revision, ...extra };
}

describe("installCertificate's local refusals", () => {
  const cases: [string, () => { pfx: Buffer; passphrase: string }, InstallAnswer][] = [
    [
      "too_large",
      () => ({ pfx: randomBytes(101 * 1024), passphrase: "cert-pass-9" }),
      { outcome: "refused", reason: "too_large", field: "file" },
    ],
    [
      "unreadable",
      () => ({ pfx: Buffer.from("not a certificate"), passphrase: "cert-pass-9" }),
      { outcome: "refused", reason: "unreadable", field: "file" },
    ],
    [
      "old_encryption",
      () => ({
        pfx: Buffer.from(RC2_CANDIDATE.pfxBase64, "base64"),
        passphrase: RC2_CANDIDATE.passphrase,
      }),
      { outcome: "refused", reason: "old_encryption", field: "file" },
    ],
    [
      "no_private_key",
      () => authority.issue({ withKey: false }),
      { outcome: "refused", reason: "no_private_key", field: "file" },
    ],
    [
      "passphrase_wrong",
      () => ({ pfx: candidate.pfx, passphrase: "not-the-pass" }),
      { outcome: "refused", reason: "passphrase_wrong", field: "passphrase" },
    ],
    [
      "expired",
      () => authority.issue({ notAfter: new Date("2026-10-01T10:00:00Z") }),
      { outcome: "refused", reason: "expired", field: "file", details: { date: "2026-10-01" } },
    ],
    [
      "not_yet_valid",
      () => authority.issue({ notBefore: new Date("2027-01-01T00:00:00Z") }),
      {
        outcome: "refused",
        reason: "not_yet_valid",
        field: "file",
        details: { date: "2027-01-01" },
      },
    ],
    ["same", () => installed, { outcome: "refused", reason: "same", field: "file" }],
    [
      "other_taxpayer",
      () => authority.issue({ organizationIdentifier: "VATES-B87654321" }),
      {
        outcome: "refused",
        reason: "other_taxpayer",
        field: "file",
        details: { nif: "B87654321", taxpayerNif: "89890001K" },
      },
    ],
  ];

  for (const [name, file, answer] of cases) {
    it(`refuses ${name}, changes nothing and never reaches AEAT`, async () => {
      const v = await venue();
      const server = await serve();
      const before = await state();

      await expect(
        installCertificate(depsFor(v, server), bodyFor(v, file()), NOW),
      ).resolves.toEqual(answer);

      expect(await state()).toEqual(before);
      expect(server.requests()).toBe(0);
    });
  }

  it("refuses as expired at the exact end instant", async () => {
    const v = await venue();
    const server = await serve();
    const file = authority.issue({ notAfter: NOW });
    await expect(installCertificate(depsFor(v, server), bodyFor(v, file), NOW)).resolves.toEqual({
      outcome: "refused",
      reason: "expired",
      field: "file",
      details: { date: "2026-10-18" },
    });
  });

  it("answers the first failure: an expired file of another taxpayer is expired", async () => {
    const v = await venue();
    const server = await serve();
    const file = authority.issue({
      notAfter: new Date("2026-10-01T10:00:00Z"),
      organizationIdentifier: "VATES-B87654321",
    });
    await expect(installCertificate(depsFor(v, server), bodyFor(v, file), NOW)).resolves.toEqual({
      outcome: "refused",
      reason: "expired",
      field: "file",
      details: { date: "2026-10-01" },
    });
  });

  it("an unauthorised caller never reaches AEAT", async () => {
    const v = await venue();
    const server = await serve();
    const before = await state();
    const authorize = async () => {
      throw notPermitted();
    };

    const error = await captureError(() =>
      installCertificate(depsFor(v, server, { authorize }), bodyFor(v, candidate), NOW),
    );

    expect(error).toMatchObject({ code: "authorization.not_permitted" });
    expect(server.requests()).toBe(0);
    expect(await state()).toEqual(before);
  });

  it("fails loudly on a database with no taxpayer", async () => {
    const server = await serve();
    const v = { ring: testRing(), revision: null };
    const error = await captureError(() =>
      installCertificate(depsFor(v, server), bodyFor(v, candidate), NOW),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/tenants is empty/);
    expect(server.requests()).toBe(0);
  });
});

describe("installCertificate's live check", () => {
  it("a certificate with no tax ID goes on to the live check and installs", async () => {
    const v = await venue();
    const server = await serve();
    const file = authority.issue({ organizationIdentifier: null, organisation: null });

    const answer = await installCertificate(depsFor(v, server), bodyFor(v, file), NOW);

    expect(answer).toEqual({
      outcome: "installed",
      reason: "installed",
      details: { checkedAt: NOW.toISOString() },
    });
    expect(server.requests()).toBe(1);
    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest).toMatchObject({
      fingerprint: file.fingerprint,
      taxId: null,
      organisation: null,
    });
  });

  it("passes a closed connection through with no field", async () => {
    const v = await venue();
    const server = await serve();
    const before = await state();
    const stranger = authority.issue({ signedBy: "stranger" });
    await expect(
      installCertificate(depsFor(v, server), bodyFor(v, stranger), NOW),
    ).resolves.toEqual({ outcome: "refused", reason: "closed" });
    expect(await state()).toEqual(before);
  });

  it("passes AEAT's fault through with its details", async () => {
    const v = await venue();
    const server = await serve({ status: 500, body: SOAP_FAULT_BODY });
    const before = await state();
    await expect(
      installCertificate(depsFor(v, server), bodyFor(v, candidate), NOW),
    ).resolves.toEqual({
      outcome: "refused",
      reason: "aeat_fault",
      details: { faultCode: "env:Client", faultReason: "Test fault" },
    });
    expect(await state()).toEqual(before);
  });

  it("passes AEAT's HTTP refusal through with its status", async () => {
    const v = await venue();
    const server = await serve({ status: 403, body: "<html>forbidden</html>" });
    const before = await state();
    await expect(
      installCertificate(depsFor(v, server), bodyFor(v, candidate), NOW),
    ).resolves.toEqual({ outcome: "refused", reason: "aeat_http", details: { status: 403 } });
    expect(await state()).toEqual(before);
  });
});

describe("installCertificate's write", () => {
  it("installs: writes the vault entry and one dashboard row, answers installed with checkedAt", async () => {
    const v = await venue();
    const server = await serve();

    const answer = await installCertificate(
      depsFor(v, server),
      bodyFor(v, candidate, { certKind: "representante" }),
      NOW,
    );

    expect(answer).toEqual({
      outcome: "installed",
      reason: "installed",
      details: { checkedAt: NOW.toISOString() },
    });
    const vault = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, v.ring, { purpose: "fiscal.aeat" }),
    );
    expect(vault).toEqual({ ...fileOf(candidate), certKind: "representante" });
    const rows = await installRows();
    expect(rows).toHaveLength(2);
    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest).toEqual({
      id: expect.any(String),
      nodeId: TENANT_A.nodeId,
      installedAt: NOW,
      source: "dashboard",
      personId: "p-1",
      kind: "representante",
      fingerprint: candidate.fingerprint,
      organisation: "WAITRON SL",
      taxId: "89890001K",
      issuer: "Waitron test FNMT (Test FNMT)",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2030-01-01T00:00:00Z"),
      checkedEndpoint: server.origin,
      checkedAt: NOW,
    });
  });

  it("installs on a box with no vault entry yet when the card read none", async () => {
    await seedTenantTillSif(suite.db);
    const v = { ring: testRing(), revision: null };
    const server = await serve();
    const answer = await installCertificate(depsFor(v, server), bodyFor(v, candidate), NOW);
    expect(answer.outcome).toBe("installed");
    expect(await installRows()).toHaveLength(1);
  });

  it("stamps the new row after the latest one when the clock has stepped back", async () => {
    const v = await venue("2026-10-18T12:00:00.000Z");
    const server = await serve();

    await installCertificate(depsFor(v, server), bodyFor(v, candidate), NOW);

    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest).toMatchObject({
      fingerprint: candidate.fingerprint,
      installedAt: new Date("2026-10-18T12:00:00.001Z"),
      checkedAt: NOW,
    });
  });

  it("refuses fiscal.certificate_changed when the vault changed after the card was read", async () => {
    const v = await venue();
    const server = await serve();
    const before = await state();

    const error = await captureError(() =>
      installCertificate(
        depsFor(v, server),
        bodyFor(v, candidate, { expectedRevision: "0000000000000000" }),
        NOW,
      ),
    );

    expect(error).toMatchObject({ code: "fiscal.certificate_changed" });
    expect(await state()).toEqual(before);
  });

  it("refuses fiscal.certificate_changed when the card read no entry and one now exists", async () => {
    const v = await venue();
    const server = await serve();
    const error = await captureError(() =>
      installCertificate(
        depsFor(v, server),
        bodyFor(v, candidate, { expectedRevision: null }),
        NOW,
      ),
    );
    expect(error).toMatchObject({ code: "fiscal.certificate_changed" });
  });

  it("re-authorises inside the final write", async () => {
    const v = await venue();
    const server = await serve();
    const before = await state();
    const seen: Transaction[] = [];
    let calls = 0;
    const authorize = async (tx: Transaction) => {
      seen.push(tx);
      calls += 1;
      if (calls === 1) return { personId: "p-1" };
      throw notPermitted();
    };

    const error = await captureError(() =>
      installCertificate(depsFor(v, server, { authorize }), bodyFor(v, candidate), NOW),
    );

    expect(error).toMatchObject({ code: "authorization.not_permitted" });
    expect(calls).toBe(2);
    expect(server.requests()).toBe(1);
    expect(await state()).toEqual(before);
  });

  it("records the person the final write's authorisation names", async () => {
    const v = await venue();
    const server = await serve();
    let calls = 0;
    const authorize = async () => ({ personId: (calls += 1) === 1 ? "p-1" : "p-2" });
    await installCertificate(depsFor(v, server, { authorize }), bodyFor(v, candidate), NOW);
    const latest = await withTransaction(suite.db, (tx) => latestInstall(tx, TENANT_A.nodeId));
    expect(latest?.personId).toBe("p-2");
  });
});

describe("installCertificate's request", () => {
  const good = {
    pfxBase64: candidate.pfx.toString("base64"),
    passphrase: "cert-pass-9",
    certKind: "sello",
    expectedRevision: null,
  };
  const cases: [string, unknown][] = [
    ["body", "not an object"],
    ["body", null],
    ["body", [good]],
    ["pfxBase64", { ...good, pfxBase64: "abc" }],
    ["pfxBase64", { ...good, pfxBase64: 7 }],
    ["passphrase", { ...good, passphrase: "" }],
    ["passphrase", { ...good, passphrase: undefined }],
    ["certKind", { ...good, certKind: "bogus" }],
    ["certKind", { ...good, certKind: 1 }],
    ["expectedRevision", { ...good, expectedRevision: 5 }],
    ["expectedRevision", { ...good, expectedRevision: undefined }],
  ];

  for (const [field, body] of cases) {
    it(`refuses ${JSON.stringify(body)?.slice(0, 40)} as fiscal.certificate_request_invalid naming ${field}`, async () => {
      const v = await venue();
      const server = await serve();
      let authorized = false;
      const authorize = async () => {
        authorized = true;
        return { personId: "p-1" };
      };

      const error = await captureError(() =>
        installCertificate(depsFor(v, server, { authorize }), body, NOW),
      );

      expect(error).toMatchObject({
        code: "fiscal.certificate_request_invalid",
        params: { field },
      });
      expect(authorized).toBe(false);
      expect(server.requests()).toBe(0);
    });
  }
});

describe("installCertificate's log", () => {
  function capture() {
    const lines: [string, string, Record<string, unknown> | undefined][] = [];
    return {
      lines,
      log: (level: string, event: string, fields?: Record<string, unknown>) => {
        lines.push([level, event, fields]);
      },
    };
  }

  function assertNoSecrets(
    lines: unknown[],
    file: Candidate | { pfx: Buffer; passphrase: string },
  ) {
    const text = JSON.stringify(lines);
    expect(text).not.toContain(file.passphrase);
    expect(text).not.toContain(file.pfx.toString("base64"));
    expect(text).not.toContain("ANA GARCIA");
    expect(text).not.toContain("12345678Z");
  }

  it("logs the install with fingerprint and dates, and a refusal with only reason and field", async () => {
    const v = await venue();
    const server = await serve();
    const { lines, log } = capture();

    await installCertificate(
      depsFor(v, server, { log }),
      bodyFor(v, { pfx: candidate.pfx, passphrase: "not-the-pass" }),
      NOW,
    );
    await installCertificate(depsFor(v, server, { log }), bodyFor(v, candidate), NOW);

    expect(lines).toEqual([
      ["info", "fiscal.certificate_refused", { reason: "passphrase_wrong", field: "passphrase" }],
      [
        "info",
        "fiscal.certificate_installed",
        {
          fingerprint: candidate.fingerprint,
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2030-01-01T00:00:00.000Z",
          endpoint: server.origin,
        },
      ],
    ]);
    assertNoSecrets(lines, candidate);
    assertNoSecrets(lines, { pfx: candidate.pfx, passphrase: "not-the-pass" });
  });

  it("logs a live-check refusal with its reason alone", async () => {
    const v = await venue();
    const server = await serve({ status: 403, body: "<html>forbidden</html>" });
    const { lines, log } = capture();
    await installCertificate(depsFor(v, server, { log }), bodyFor(v, candidate), NOW);
    expect(lines).toEqual([["info", "fiscal.certificate_refused", { reason: "aeat_http" }]]);
    assertNoSecrets(lines, candidate);
  });
});

describe("venueTimeZone", () => {
  it("reads the location's zone, and UTC for a missing location or an unknown zone", async () => {
    await seedTenantTillSif(suite.db);
    const read = (id: string) => withTransaction(suite.db, (tx) => venueTimeZone(tx, id));
    expect(await read(TENANT_A.locationId)).toBe("Europe/Madrid");
    expect(await read("a0000000-0000-4000-8000-0000000000ff")).toBe("UTC");
    await suite.db.execute(sql`update locations set time_zone = 'Mars/Olympus'`);
    expect(await read(TENANT_A.locationId)).toBe("UTC");
  });
});
