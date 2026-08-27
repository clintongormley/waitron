import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { withTenant, type Database } from "@waitron/db";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
} from "@waitron/db/testing/lifecycle.js";
import type { RealPostgres } from "@waitron/db/testing/postgres.js";
import type { SharedContainerHandle } from "@waitron/db/testing/shared-container.js";
import { getCredential, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import type { VenueRequest } from "@waitron/provisioning";
import { hasCode, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import { provisionVenue } from "./provision.js";
import { sealAeatCredential, type AeatCert } from "./aeat-credential.js";

// Real Postgres, not PGlite: `tenant_credentials` is FORCE-RLS, so `putCredential` must run under
// `withTenant`, and the seal FKs to a `tenants` row `provisionVenue` mints under the OWNER
// connection — neither of which PGlite (every connection a superuser) faithfully represents
// (CLAUDE.md §4). The shared-container clone's default connection is the container superuser, which
// OWNS the manifest tables and so is the owner connection `provisionVenue`/`applyVenue` documents.

// Each provisioned venue needs its own NIF (`tenants_country_tax_id_key` is unique); a fresh clone
// per test still draws from one generator, the same nextNif shape `provision.test.ts` uses.
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

let handle: SharedContainerHandle;
beforeAll(() => {
  handle = resolveSharedHandle(undefined);
});

// A FRESH manifest clone per test: `provisionVenue` stamps the GLOBAL `deployment` singleton and
// mints a tenant, so a shared clone would leak one test's tenant/stamp into the next. A clone per
// test keeps the scenarios order-independent (CLAUDE.md §4).
let pg: RealPostgres | undefined;
let db: Database | undefined;

beforeEach(async () => {
  pg = await cloneTemplate(handle.uri, pickTemplate(handle, "manifest"), nextCloneName());
  db = await pg.connect();
});

afterEach(async () => {
  const connection = db;
  const started = pg;
  db = undefined;
  pg = undefined;
  if (connection !== undefined) await connection.close();
  if (started !== undefined) await started.stop();
});

/** The clone's owner connection, or a throw if read before `beforeEach` ran. */
function ownerDb(): Database {
  if (db === undefined) throw new Error("aeat-credential.test: clone not started");
  return db;
}

/** Provision a fresh venue and return its tenant id — the FK/RLS target the seal needs. */
async function provisionTenant(target: Database): Promise<string> {
  const result = await provisionVenue(
    { ownerDb: target },
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

  it("refuses an empty pfxBase64 and seals nothing", async () => {
    const target = ownerDb();
    const ring = testRing();
    const tenant = await provisionTenant(target);
    const cert = aeatCert({ pfxBase64: "" });

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
});
