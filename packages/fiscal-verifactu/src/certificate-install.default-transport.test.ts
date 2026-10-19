import { randomBytes } from "node:crypto";
import { credentialRevision, loadKeyRing, tryGetCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { SOAP_ENDPOINTS_SELLO } from "@waitron/verifactu";
import { expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { mtlsFetch } from "./aeat-transport.js";
import { installCertificate } from "./certificate-install.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { fiscalCertificateInstalls } from "./schema/index.js";

// Never the real mtlsFetch: no test may open a connection to AEAT.
const refusedFetch = vi.fn<typeof globalThis.fetch>(async () => {
  throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
});
vi.mock("./aeat-transport.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aeat-transport.js")>();
  return {
    ...actual,
    mtlsFetch: vi.fn(() => ({ fetch: refusedFetch, close: async () => {} })),
  };
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });
const authority = makeAuthority();
const installed = authority.issue();
const candidate = authority.issue();
const NOW = new Date("2026-10-18T11:00:00Z");

it("with no transport given, checks with AEAT's endpoint for the environment through mtlsFetch, and a refused connection leaves the vault unchanged", async () => {
  await seedTenantTillSif(suite.db);
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  await sealAeatSecret(
    { db: suite.db, ring, nodeId: TENANT_A.nodeId, now: () => new Date("2026-10-18T10:00:00Z") },
    {
      pfxBase64: installed.pfx.toString("base64"),
      passphrase: installed.passphrase,
      certKind: "sello",
    },
  );
  const revision = () =>
    withTransaction(suite.db, (tx) => credentialRevision(tx, { purpose: "fiscal.aeat" }));
  const before = {
    revision: await revision(),
    rows: await suite.db.select().from(fiscalCertificateInstalls),
  };

  const answer = await installCertificate(
    {
      db: suite.db,
      ring,
      nodeId: TENANT_A.nodeId,
      locationId: TENANT_A.locationId,
      environment: "preproduction",
      authorize: async () => ({ personId: "p-1" }),
    },
    {
      pfxBase64: candidate.pfx.toString("base64"),
      passphrase: candidate.passphrase,
      certKind: "sello",
      expectedRevision: before.revision,
    },
    NOW,
  );

  expect(answer).toEqual({ outcome: "refused", reason: "unreachable" });
  expect(vi.mocked(mtlsFetch)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(mtlsFetch).mock.calls[0]).toEqual([
    { pfx: candidate.pfx, passphrase: candidate.passphrase, certKind: "sello" },
  ]);
  expect(refusedFetch).toHaveBeenCalledTimes(1);
  expect(String(refusedFetch.mock.calls[0]![0])).toBe(SOAP_ENDPOINTS_SELLO.preproduction);
  expect({
    revision: await revision(),
    rows: await suite.db.select().from(fiscalCertificateInstalls),
  }).toEqual(before);
  const stored = await withTransaction(suite.db, (tx) =>
    tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
  );
  expect(stored).toMatchObject({ pfxBase64: installed.pfx.toString("base64") });
});
