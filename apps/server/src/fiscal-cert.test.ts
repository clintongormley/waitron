// Real PostgreSQL, not PGlite (CLAUDE.md §4): the vault reads and writes run as the non-superuser
// deployment role (`server_pass_probe`, an `app_user` member created cluster-wide by apps/server's
// globalSetup), so the credentials grants (`GRANT SELECT, INSERT, UPDATE, DELETE ON
// tenant_credentials TO app_user`) are actually exercised rather than bypassed by a superuser. The
// tenant row is seeded on the owner connection (`app_user` holds no INSERT on `tenants`); a fresh
// tenant per test keeps the shared clone's `tenant_credentials` rows isolated (every function scopes
// by tenant id).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { loadKeyRing } from "@waitron/credentials";
import {
  deleteDormantCert,
  readCertStatus,
  sealLiveCertTx,
  storeDormantCert,
  unwrapDormantCert,
} from "./fiscal-cert.js";

const CERT = { pfxBase64: "QQ==", passphrase: "pw", certKind: "sello" };
const BG = "break-glass-secret-32-chars-abcd"; // ≥ MIN_PASSPHRASE_LENGTH (12)
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useTemplateDb({ template: "manifest" });

let probe: Database;
beforeAll(async () => {
  probe = await suite.pg.connectAs("server_pass_probe", "probe");
});
afterAll(async () => {
  if (probe !== undefined) await probe.close();
});

describe("fiscal-cert core (real PG)", () => {
  it("stores a dormant copy and reads status dormant", async () => {
    const tenantId = await seedTenant(suite.admin);
    await withTenant(probe, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    expect(await withTenant(probe, tenantId, (tx) => readCertStatus(tx, ring, tenantId))).toBe(
      "dormant",
    );
  });

  it("unwraps the dormant copy with the right secret", async () => {
    const tenantId = await seedTenant(suite.admin);
    await withTenant(probe, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    const out = await withTenant(probe, tenantId, (tx) =>
      unwrapDormantCert(tx, ring, tenantId, BG),
    );
    expect(out).toEqual(CERT);
  });

  it("reports corrupt for the wrong break-glass secret", async () => {
    const tenantId = await seedTenant(suite.admin);
    await withTenant(probe, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    expect(
      await withTenant(probe, tenantId, (tx) =>
        unwrapDormantCert(tx, ring, tenantId, "another-long-secret"),
      ),
    ).toBe("corrupt");
  });

  it("reports absent when there is no dormant row", async () => {
    const tenantId = await seedTenant(suite.admin);
    expect(
      await withTenant(probe, tenantId, (tx) => unwrapDormantCert(tx, ring, tenantId, BG)),
    ).toBe("absent");
  });

  it("seal live then status live; delete dormant leaves status live", async () => {
    const tenantId = await seedTenant(suite.admin);
    await withTenant(probe, tenantId, (tx) => storeDormantCert(tx, ring, tenantId, CERT, BG));
    await withTenant(probe, tenantId, (tx) => sealLiveCertTx(tx, ring, tenantId, CERT));
    await withTenant(probe, tenantId, (tx) => deleteDormantCert(tx, tenantId));
    expect(await withTenant(probe, tenantId, (tx) => readCertStatus(tx, ring, tenantId))).toBe(
      "live",
    );
  });
});
