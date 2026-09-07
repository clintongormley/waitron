import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  getCredential,
  loadKeyRing,
  type KeyRing,
} from "@waitron/credentials";
import { hasCode, isAppError } from "@waitron/shared";
import { sealAeatSecret, validateAeatCert, type AeatCert } from "./provisioning-secret.js";

// PGlite, not real Postgres: this suite exercises the SHAPE validator and the seal ROUND-TRIP (write
// then read back the three fields), never RLS DENIAL as the deployment role — so the lighter target
// applies (CLAUDE.md §4). `seedTenant` inserts the FK target row and `withTenant` sets `app.tenant_id`
// exactly as production does; the same pattern this package's `aeat-transport.test.ts` seals under.
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 120_000,
});

/** A ring built the way a host builds one at boot — one fresh 32-byte key, version 1. */
function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

/** A fresh, valid AEAT cert fixture. `pfxBase64` is opaque bytes; the vault never opens it. */
function aeatCert(overrides: Partial<AeatCert> = {}): AeatCert {
  return {
    pfxBase64: randomBytes(48).toString("base64"),
    passphrase: "cert-pass-9",
    certKind: "sello",
    ...overrides,
  };
}

describe("sealAeatSecret", () => {
  it("seals the cert into fiscal.aeat and reads back the three fields intact", async () => {
    const ring = testRing();
    const tenant = await seedTenant(suite.db);
    const cert = aeatCert({ certKind: "representante" });

    await sealAeatSecret({ db: suite.db, ring }, tenant, cert);

    const readBack = await withTenant(suite.db, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: tenant, purpose: "fiscal.aeat" }),
    );
    expect(readBack).toEqual({
      pfxBase64: cert.pfxBase64,
      passphrase: cert.passphrase,
      certKind: "representante",
    });
  });

  it("refuses a certKind outside {sello, representante} and seals nothing", async () => {
    const ring = testRing();
    const tenant = await seedTenant(suite.db);
    // `bogus` is a non-empty string, so `putCredential`'s own `validatePayload` would ACCEPT it —
    // only this module's certKind guard rejects it (the deletion-proof for that guard).
    const cert = aeatCert({ certKind: "bogus" as AeatCert["certKind"] });

    const error = await sealAeatSecret({ db: suite.db, ring }, tenant, cert).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "certKind",
    );

    // Nothing was written — a read finds no row.
    const missing = await withTenant(suite.db, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: tenant, purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });

  // Every unusable pfxBase64 SHAPE is refused BEFORE the seal, with the field named and no row
  // written. `""` exercises the non-empty check; `"not valid base64!!!"` the alphabet; `"QQ"` the
  // length/padding (valid characters, but not a whole 4-char group — exactly the shape a looser
  // `[A-Za-z0-9+/]+={0,2}` would have waved through). `putCredential`'s own `validatePayload`
  // accepts any non-empty string, so only this module's `BASE64_RE` guard stands between a bogus
  // blob and a clean seal that fails far downstream at drain/AEAT-submit — the deletion-proof for
  // that guard: replace the regex with a length-only `pfxBase64 === ""` check and the
  // non-base64 / malformed-length cases below go RED while the empty case stays GREEN.
  it.each([
    { label: "empty", pfxBase64: "" },
    { label: "non-base64 characters", pfxBase64: "not valid base64!!!" },
    { label: "a malformed base64 length", pfxBase64: "QQ" },
  ])("refuses a pfxBase64 that is $label and seals nothing", async ({ pfxBase64 }) => {
    const ring = testRing();
    const tenant = await seedTenant(suite.db);
    const cert = aeatCert({ pfxBase64 });

    const error = await sealAeatSecret({ db: suite.db, ring }, tenant, cert).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "pfxBase64",
    );

    const missing = await withTenant(suite.db, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: tenant, purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });

  it("accepts a short, canonically-padded base64 pfxBase64 (the tightened regex does not over-reject)", async () => {
    const ring = testRing();
    const tenant = await seedTenant(suite.db);
    // "aGVsbG8=" is `Buffer.from("hello").toString("base64")` — a real 5-byte payload whose base64
    // carries a 3-char padded tail (`bG8=`), the branch a length-only check would never reach. The
    // seal must accept it, proving the length/padding-enforcing regex rejects no genuine encoding.
    const cert = aeatCert({ pfxBase64: "aGVsbG8=" });

    await sealAeatSecret({ db: suite.db, ring }, tenant, cert);

    const readBack = await withTenant(suite.db, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: tenant, purpose: "fiscal.aeat" }),
    );
    expect(readBack.pfxBase64).toBe("aGVsbG8=");
  });

  it("refuses a non-object raw blob naming aeatCert and seals nothing", async () => {
    const ring = testRing();
    const tenant = await seedTenant(suite.db);

    const error = await sealAeatSecret({ db: suite.db, ring }, tenant, "not-an-object").catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "aeatCert",
    );

    const missing = await withTenant(suite.db, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: tenant, purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });
});

// The SHAPE validator both the host's pre-provision guard (`FISCAL_SLOT.provisioningSecret.validate`)
// and `sealAeatSecret` run. Tested directly (not only through the seal) because the empty-passphrase
// branch is unreachable from `parseAeatCert`'s own non-empty `asString` screen, so a direct test is
// what proves it fires — the coverage the host's `setup-api.ts` used to carry before the move.
describe("validateAeatCert — full cert-value validation", () => {
  function goodCert(overrides: Partial<AeatCert> = {}): AeatCert {
    return {
      pfxBase64: randomBytes(48).toString("base64"),
      passphrase: "cert-pass-9",
      certKind: "sello",
      ...overrides,
    };
  }

  it("accepts a well-formed cert (sello + base64 pfx + non-empty passphrase)", () => {
    expect(() => validateAeatCert(goodCert())).not.toThrow();
    expect(() => validateAeatCert(goodCert({ certKind: "representante" }))).not.toThrow();
  });

  it.each<[string, AeatCert, string]>([
    [
      "a certKind outside the set",
      goodCert({ certKind: "bogus" as AeatCert["certKind"] }),
      "certKind",
    ],
    ["an empty pfxBase64", goodCert({ pfxBase64: "" }), "pfxBase64"],
    ["a non-base64 pfxBase64", goodCert({ pfxBase64: "not base64!" }), "pfxBase64"],
    ["a malformed base64 length", goodCert({ pfxBase64: "QQ" }), "pfxBase64"],
    ["an empty passphrase", goodCert({ passphrase: "" }), "passphrase"],
  ])("rejects %s with setup.request_invalid naming the field", (_label, cert, field) => {
    let error: unknown;
    try {
      validateAeatCert(cert);
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      field,
    );
  });
});
