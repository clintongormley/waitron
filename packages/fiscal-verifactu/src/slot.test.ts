import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, getCredential, loadKeyRing } from "@waitron/credentials";
import { hasCode, isAppError } from "@waitron/shared";
import type { TrustedClock } from "@waitron/fiscal";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_SLOT, rejectResolveClient } from "./slot.js";

// `makeBackend` only CONSTRUCTS the backend (no connection is opened until a method runs).
const STUB_DB = {} as Database;
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("slot.test: anchor() is unused");
  },
  currentAnchor: () => null,
};

describe("FISCAL_SLOT", () => {
  it("builds a VerifactuBackend whose id is the slot's id", () => {
    const backend = FISCAL_SLOT.makeBackend({ db: STUB_DB, clock, environment: "preproduction" });
    expect(backend).toBeInstanceOf(VerifactuBackend);
    expect(backend.id).toBe(FISCAL_SLOT.id);
    expect(FISCAL_SLOT.id).toBe("verifactu");
    expect(FISCAL_SLOT.activationReadiness).toBe("accepted-test-submission");
  });

  it("never resolves an AEAT client on the sale path", async () => {
    await expect(rejectResolveClient()).rejects.toThrow(/never be called/);
  });
});

// The runtime submission seat: the host injects the vault ring, deployment identity and cadence, and
// the regime owns the transport it builds inside the pass. A pass with no due work builds no per-tenant
// transport (resolveClient is called lazily, only for tenants with work) and returns the empty result.
describe("FISCAL_SLOT.drain", () => {
  const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });

  it("returns the empty result when nothing is due", async () => {
    const result = await FISCAL_SLOT.drain(
      { db: pg.db, ring, environment: "preproduction", skipRetryMs: 300_000 },
      new Date(),
    );
    expect(result.batchesSent).toBe(0);
    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toBeNull();
  });
});

// The provision-time secret seat the host reaches instead of importing the regime: `required` gates on
// environment, `validate` refuses a malformed blob without writing, `seal` writes it under withTenant.
// (The validator + seal internals have their own exhaustive suite in provisioning-secret.test.ts; here
// we pin the SEAT wiring — that FISCAL_SLOT actually exposes and forwards to them.)
describe("FISCAL_SLOT.provisioningSecret", () => {
  const secret = FISCAL_SLOT.provisioningSecret!;
  const pg = usePgliteDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
    timeoutMs: 120_000,
  });
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const goodCert = {
    pfxBase64: randomBytes(48).toString("base64"),
    passphrase: "p",
    certKind: "sello",
  };

  it("requires the secret in production only (Veri*Factu files to the real AEAT there)", () => {
    expect(secret.required("production")).toBe(true);
    expect(secret.required("preproduction")).toBe(false);
  });

  it("validate throws setup.request_invalid on a malformed blob and writes nothing", () => {
    let error: unknown;
    try {
      secret.validate({ ...goodCert, certKind: "bogus" });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "certKind",
    );
  });

  it("seal writes the cert into the tenant's fiscal.aeat vault", async () => {
    const tenant = await seedTenant(pg.db);
    await secret.seal({ db: pg.db, ring }, tenant, goodCert);
    const readBack = await withTenant(pg.db, tenant, (tx) =>
      getCredential(tx, ring, { tenantId: tenant, purpose: "fiscal.aeat" }),
    );
    expect(readBack.certKind).toBe("sello");
  });
});

// The venue-field seat, pinned the same way and for the same reason as `provisioningSecret` above:
// the rules themselves have their own suite (venue-fields.test.ts), so what is checked here is the
// WIRING — that FISCAL_SLOT exposes the seat at all and forwards to the real validator. Without
// this, deleting the seat from slot.ts would leave every other test green.
describe("FISCAL_SLOT.venueFields", () => {
  it("exposes the seat and forwards to the real validator", () => {
    const seat = FISCAL_SLOT.venueFields;
    expect(seat).toBeDefined();
    const venue = {
      legalName: "Waitron SL",
      seriesCode: "Serie A",
      rectificativeSeriesCode: "FR",
      operationDescription: "Venta en establecimiento",
    };
    let error: unknown;
    try {
      seat!.validate(venue);
    } catch (e) {
      error = e;
    }
    expect(isAppError(error) && hasCode(error, "setup.request_invalid") && error.params.field).toBe(
      "seriesCode",
    );
  });
});
