import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, getCredential, loadKeyRing } from "@waitron/credentials";
import { hasCode, isAppError } from "@waitron/shared";
import type { TrustedClock } from "@waitron/fiscal";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
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

describe("FISCAL_SLOT.drain", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });

  it("returns the empty result when nothing is due", async () => {
    const result = await FISCAL_SLOT.drain(
      { db: suite.db, ring, environment: "preproduction", skipRetryMs: 300_000 },
      new Date(),
    );
    expect(result.batchesSent).toBe(0);
    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toBeNull();
  });
});

describe("FISCAL_SLOT.resetInFlight", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

  it("returns a fresh enviando claim to pendiente", async () => {
    const now = new Date("2026-07-21T00:01:00Z");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [registroId] = seeded.registroIds;
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date(now.getTime() - 1_000).toISOString()}
        where registro_id = ${registroId}
      `),
    );

    await FISCAL_SLOT.resetInFlight({ db: suite.db }, now);

    const rows = await suite.db.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${registroId}`,
    );
    expect(rows.rows).toEqual([{ estado: "pendiente" }]);
  });
});

// The seat WIRING only; the validator and seal have their own suite in provisioning-secret.test.ts.
describe("FISCAL_SLOT.provisioningSecret", () => {
  const secret = FISCAL_SLOT.provisioningSecret!;
  const suite = useVenueDb({
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

  it("seal writes the cert into the venue's fiscal.aeat vault", async () => {
    await seedTenant(suite.db);
    await secret.seal({ db: suite.db, ring }, goodCert);
    const readBack = await withTransaction(suite.db, (tx) =>
      getCredential(tx, ring, { purpose: "fiscal.aeat" }),
    );
    expect(readBack.certKind).toBe("sello");
  });
});

// The seat WIRING only; the rules have their own suite in venue-fields.test.ts.
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

it("supplies the Spanish default for the operation described on invoices", () => {
  expect(FISCAL_SLOT.venueFields?.defaults).toEqual({
    operationDescription: "Venta en establecimiento",
  });
});

it("validates a changed operation description through its own seat", () => {
  expect(() => FISCAL_SLOT.venueFields!.validateOperationDescription("x".repeat(501))).toThrow(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "location.operationDescription" },
    }),
  );
  expect(() =>
    FISCAL_SLOT.venueFields!.validateOperationDescription("Venta en establecimiento"),
  ).not.toThrow();
});

describe("the fiscal deployment history probe", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

  it("reports an empty fiscal history as compatible", async () => {
    await expect(FISCAL_SLOT.hasNonproductionRecords!(suite.db)).resolves.toBe(false);
  });

  it.each([
    { entorno: "preproduction" as const, want: true },
    { entorno: null, want: true },
    { entorno: "production" as const, want: false },
  ])("reports $entorno history as incompatible: $want", async ({ entorno, want }) => {
    await seedPendingEnvios(suite.db, { count: 1, entorno });
    await expect(FISCAL_SLOT.hasNonproductionRecords!(suite.db)).resolves.toBe(want);
  });
});

describe("the fiscal deployment probe before fiscal migrations", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("keeps an empty initial setup compatible", async () => {
    await expect(FISCAL_SLOT.hasNonproductionRecords!(suite.db)).resolves.toBe(false);
  });
});

describe("the fiscal readiness rejection reader", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

  it("returns saved rejection details without changing fiscal records or other outcomes", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [rejected, halted, pending] = seeded.registroIds;
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update envios set estado = 'rechazado', codigo_error = '1161', mensaje_error = 'Importe total incorrecto' where registro_id = ${rejected}`,
      );
      await tx.execute(sql`update envios set estado = 'detenido' where registro_id = ${halted}`);
      await tx.execute(
        sql`update envios set codigo_error = '999', mensaje_error = 'Retry later' where registro_id = ${pending}`,
      );
    });
    const before = await suite.db.execute(sql`select * from registros_facturacion order by id`);
    expect(await FISCAL_SLOT.readinessRejections?.(suite.db)).toEqual([
      { code: "1161", message: "Importe total incorrecto" },
    ]);
    expect(await suite.db.execute(sql`select * from registros_facturacion order by id`)).toEqual(
      before,
    );
  });

  it("does not manufacture details when no rejection was saved", async () => {
    await seedPendingEnvios(suite.db, { count: 1 });
    expect(await FISCAL_SLOT.readinessRejections?.(suite.db)).toEqual([]);
  });
});
