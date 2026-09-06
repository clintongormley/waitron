import { clearProvisionFixture } from "./testing/clear-provision-fixture.js";
import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { withTenant, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { getCredential, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import type { VenueRequest } from "@waitron/provisioning";
import { hasCode, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import { parseModuleConfig } from "@waitron/module";
import { provisionVenue } from "./provision.js";
import { ALL_MODULES } from "./modules.js";
import { sealAeatCredential, type AeatCert } from "./aeat-credential.js";

// All modules enabled — the seal fixture provisions a real venue, so its provision must not be
// refused by the SP-1b fiscal gate (that gate is exercised in provision.test.ts).
const ALL_ENABLED = parseModuleConfig({}, ALL_MODULES);

// Each provisioned venue needs its own NIF (`tenants_country_tax_id_key` is unique); the shared database
// draws from one generator, the same nextNif shape `provision.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** A valid ES-common venue with already-hashed admin secrets, mirroring `provision.test.ts`. */
function venueRequest(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Deli Test SL",
    location: {
      name: "Sala principal",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Administradora",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("dashPass123"),
    },
  };
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

/** A ring built the way a host builds one at boot — one fresh 32-byte key, version 1. */
function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

afterEach(() => clearProvisionFixture(suite.db));

function ownerDb(): Database {
  return suite.db;
}

/** Provision a fresh venue and return its tenant id — the FK target the seal needs. */
async function provisionTenant(target: Database): Promise<string> {
  const result = await provisionVenue(
    { ownerDb: target, moduleConfig: ALL_ENABLED, database: "waitron" },
    { environment: "preproduction", venue: venueRequest(nextNif()) },
  );
  return result.tenantId;
}

describe("sealAeatCredential", () => {
  it("seals the cert into fiscal.aeat and reads back the three fields intact", async () => {
    const target = ownerDb();
    const ring = testRing();
    const tenant = await provisionTenant(target);
    const cert = aeatCert({ certKind: "representante" });

    await sealAeatCredential(target, ring, tenant, cert);

    const readBack = await withTenant(target, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: brandTenantId(tenant), purpose: "fiscal.aeat" }),
    );
    expect(readBack).toEqual({
      pfxBase64: cert.pfxBase64,
      passphrase: cert.passphrase,
      certKind: "representante",
    });
  });

  it("refuses a certKind outside {sello, representante} and seals nothing", async () => {
    const target = ownerDb();
    const ring = testRing();
    const tenant = await provisionTenant(target);
    // `bogus` is a non-empty string, so `putCredential`'s own `validatePayload` would ACCEPT it —
    // only this module's certKind guard rejects it (the deletion-proof for that guard).
    const cert = aeatCert({ certKind: "bogus" as AeatCert["certKind"] });

    const error = await sealAeatCredential(target, ring, tenant, cert).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "certKind",
    );

    // Nothing was written — a read finds no row.
    const missing = await withTenant(target, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: brandTenantId(tenant), purpose: "fiscal.aeat" }),
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
    const target = ownerDb();
    const ring = testRing();
    const tenant = await provisionTenant(target);
    const cert = aeatCert({ pfxBase64 });

    const error = await sealAeatCredential(target, ring, tenant, cert).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "pfxBase64",
    );

    const missing = await withTenant(target, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: brandTenantId(tenant), purpose: "fiscal.aeat" }),
    ).catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code).toBe("credentials.missing");
  });

  it("accepts a short, canonically-padded base64 pfxBase64 (the tightened regex does not over-reject)", async () => {
    const target = ownerDb();
    const ring = testRing();
    const tenant = await provisionTenant(target);
    // "aGVsbG8=" is `Buffer.from("hello").toString("base64")` — a real 5-byte payload whose base64
    // carries a 3-char padded tail (`bG8=`), the branch a length-only check would never reach. The
    // seal must accept it, proving the length/padding-enforcing regex rejects no genuine encoding.
    const cert = aeatCert({ pfxBase64: "aGVsbG8=" });

    await sealAeatCredential(target, ring, tenant, cert);

    const readBack = await withTenant(target, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: brandTenantId(tenant), purpose: "fiscal.aeat" }),
    );
    expect(readBack.pfxBase64).toBe("aGVsbG8=");
  });
});
