import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { CORE_MIGRATIONS, asAppUser, sales, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { SaleForFiscalRecord, TrustedClock } from "@waitron/fiscal";
import type { SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import { decimal, saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

/**
 * `registerTill`/`recordVoid`/`checkIntegrity`/`pendingCount` complete the `FiscalBackend`
 * interface — TypeScript requires every one of them on a class declared `implements
 * FiscalBackend` — but are secondary to this task's own graded deliverable (`recordSale`,
 * proven end to end by `./write-path.e2e.test.ts`). These tests exist so the coverage gate does
 * not merely tolerate untested code, and so each method's own documented limitation (see
 * `backend.ts`'s doc comments) is backed by at least one real assertion rather than an
 * unexercised claim.
 */

let backend: VerifactuBackend;
let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenantWithSif(pg.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function sell() {
  return withTenant(pg.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, seriesId, workingOrderId }));
  });
}

describe("registerTill", () => {
  it("reports the till's live SIF registration", async () => {
    const registration = await withTenant(pg.db, tenantId, (tx) =>
      backend.registerTill(tx, tillId, { tenantId }),
    );
    expect(registration.backend).toBe("verifactu");
    expect(registration.tillId).toBe(tillId);
    expect(registration.registrationId).toContain("WT");
  });

  it("throws the structured sif.not_registered error for a till with no live SIF", async () => {
    // A well-formed UUID that `seedTenantWithSif` never provisioned — `currentSif` (and
    // therefore `registerTill`) treats "no matching row" identically whether the till simply
    // does not exist or once had a SIF that was later revoked.
    const neverProvisioned = brandTillId("00000000-0000-4000-8000-000000000000");
    await expect(
      withTenant(pg.db, tenantId, (tx) => backend.registerTill(tx, neverProvisioned, { tenantId })),
    ).rejects.toMatchObject({ code: "sif.not_registered" });
  });
});

describe("recordVoid", () => {
  it("throws fiscal.sale_not_recorded for a sale with no prior alta", async () => {
    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordVoid(tx, "00000000-0000-4000-8000-000000000000" as never, "staff error"),
      ),
    ).rejects.toMatchObject({ code: "fiscal.sale_not_recorded" });
  });

  it("appends an anulación referencing the original alta's own identity", async () => {
    const { saleId } = await sell();
    const ref = await withTenant(pg.db, tenantId, (tx) =>
      backend.recordVoid(tx, saleId, "staff error"),
    );
    expect(ref.backend).toBe("verifactu");
    expect(ref.state).toBe("pending");

    const rows = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    const alta = rows.find((row) => row.tipoRegistro === "alta");
    const anulacion = rows.find((row) => row.tipoRegistro === "anulacion");
    expect(anulacion?.idEmisorFactura).toBe(alta?.idEmisorFactura);
    expect(anulacion?.numSerieFactura).toBe("A/1");
    expect(anulacion?.secuencia).toBe(2);
    // `buildCadenaAnulacion` (`packages/verifactu/src/huella.ts`) hashes exactly 5 fields, none of
    // them an amount — so the stored row must carry NULL here, not "0.00": a `RegistroAnulacion`
    // has no `CuotaTotal`/`ImporteTotal` to begin with, and a schema or row-mapping regression that
    // started writing a zero-string amount would silently misrepresent the anulación as having a
    // value it structurally cannot have.
    expect(anulacion?.cuotaTotal).toBeNull();
    expect(anulacion?.importeTotal).toBeNull();

    const [sidecar] = await pg.db.select().from(envios).where(eq(envios.registroId, anulacion!.id));
    expect(sidecar?.estado).toBe("pendiente");
  });
});

/**
 * Task 16 review, Minor: `recordVoid` reconstructed `FechaExpedicionFacturaAnulada` from the
 * stored `fecha_expedicion_factura` (a plain `date`, no offset) via a NOON-UTC anchor reformatted
 * with the VOID's own `offsetMinutes` — safe only within roughly ±12h, and exercised only at the
 * fixture's own +60. Task 17 replaces that anchor with an exact algebraic cancellation (see
 * `backend.ts`'s own comment on the fix) and these two tests are what actually distinguish the two:
 * both offsets below are chosen so that noon ± the offset crosses midnight — the exact case the
 * OLD anchor could not survive — which a moderate offset like +120 would not exercise at all
 * (noon + 2h is still the same UTC day, and the old code already handled that case). Constructs its
 * OWN `VerifactuBackend`, sharing `pg.db` with the suite's own `backend`, so the SALE can be recorded
 * under the fixture's ordinary +01:00 (`steadyClock`) while only the VOID step reads an extreme
 * offset — reproducing "the alta and its anulación are generated under different offsets", which is
 * the ordinary case (a sale voided hours or days later) rather than a contrived one.
 */
describe("recordVoid — date reconstruction", () => {
  function clockAt(offsetMinutes: number): TrustedClock {
    return {
      now: () => ({
        instant: new Date("2026-03-01T13:05:00Z"),
        offsetMinutes,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
      anchor: () => {
        throw new Error("clockAt: anchor() is not used by recordVoid");
      },
      currentAnchor: () => null,
    };
  }

  it("reconstructs the annulled invoice's calendar day exactly at +13:00", async () => {
    const { saleId } = await sell();
    const voidBackend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: clockAt(780),
      db: pg.db,
      resolveClient: staticResolver(fakeClient),
    });
    await withTenant(pg.db, tenantId, (tx) => voidBackend.recordVoid(tx, saleId, "staff error"));

    const rows = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const alta = rows.find((row) => row.tipoRegistro === "alta");
    const anulacion = rows.find((row) => row.tipoRegistro === "anulacion");
    expect(anulacion?.fechaExpedicionFactura).toBe(alta?.fechaExpedicionFactura);
  });

  it("reconstructs the annulled invoice's calendar day exactly at -13:00", async () => {
    const { saleId } = await sell();
    const voidBackend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: clockAt(-780),
      db: pg.db,
      resolveClient: staticResolver(fakeClient),
    });
    await withTenant(pg.db, tenantId, (tx) => voidBackend.recordVoid(tx, saleId, "staff error"));

    const rows = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const alta = rows.find((row) => row.tipoRegistro === "alta");
    const anulacion = rows.find((row) => row.tipoRegistro === "anulacion");
    expect(anulacion?.fechaExpedicionFactura).toBe(alta?.fechaExpedicionFactura);
  });
});

describe("recordCorrection — refusals", () => {
  // PGlite, deliberately (CLAUDE.md §4): both cases assert a REFUSAL that happens before
  // `appendToChain` runs at all — the original-registro lookup and the F2 gate — so neither
  // exercises the chain append under the deployment role or under contention. The chain-append
  // path and the concurrency property are `correction-path.e2e.test.ts`'s real-PG job.

  /** A minimal corrective `SaleForFiscalRecord`. Its own fields are never read on the refusal
   * paths below (both throw before assembling anything from `sale`), but a well-formed value keeps
   * the call type-correct. */
  function correctiveSale(): SaleForFiscalRecord {
    return {
      tenantId,
      tillId,
      saleId: brandSaleId("33333333-3333-4333-8333-333333333333"),
      seriesId,
      seriesCode: "R",
      invoiceNumber: 1,
      issuedAt: new Date("2026-03-02T12:05:00.000Z"),
      offsetMinutes: 60,
      descriptionOfOperation: "Rectificacion por diferencias",
      total: decimal("-12.10"),
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("-10.00"), tax: decimal("-2.10") }],
      counterparty: null,
    };
  }

  it("throws fiscal.sale_not_recorded when the sale being corrected has no prior alta", async () => {
    const neverRecorded = brandSaleId("00000000-0000-4000-8000-000000000000");
    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordCorrection(tx, correctiveSale(), { correctsSaleId: neverRecorded }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: neverRecorded },
    });
  });

  it("refuses to correct a non-simplified invoice, since only F2 → R5 is supported (R1 deferred)", async () => {
    // The R-type derivation asserts rather than assumes: rectifying an F1 is an R1, not the R5 this
    // method assembles, and filing the wrong TipoFactura is unrepairable (§5). Build a real F1 alta
    // directly (bypassing core, which only ever issues F2), then try to correct it.
    const original = brandSaleId("44444444-4444-4444-8444-444444444444");
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(sales).values({
        id: original,
        tenantId,
        tillId,
        seriesId,
        invoiceNumber: 500,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: "0.00",
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tenantId,
        tillId,
        saleId: original,
        seriesId,
        seriesCode: "A",
        invoiceNumber: 500,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty: { taxId: "B12345678", legalName: "Cliente SL", countryCode: "ES" },
      });
    });

    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordCorrection(tx, correctiveSale(), { correctsSaleId: original }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.correction_unsupported",
      params: { saleId: original, tipoFactura: "F1" },
    });
  });
});

describe("recordSubstitution — refusals", () => {
  // PGlite, deliberately (CLAUDE.md §4): every case asserts a REFUSAL that happens before
  // `appendToChain` runs at all — the empty-list and recipient guards, the substituted-alta lookup,
  // and the F2 gate — so none exercises the chain append under the deployment role or under
  // contention. The chain-append path and the concurrency property are
  // `substitution-path.e2e.test.ts`'s real-PG job.

  /** A minimal F3 `SaleForFiscalRecord` — POSITIVE total, and (unlike every other method's fixture)
   * a NON-null counterparty, because a full invoice must always name its recipient. Its own fields
   * are never read on the refusal paths that throw before assembling anything from `sale`, but a
   * well-formed value keeps the call type-correct. */
  function substitutionSale(overrides: Partial<SaleForFiscalRecord> = {}): SaleForFiscalRecord {
    return {
      tenantId,
      tillId,
      saleId: brandSaleId("55555555-5555-4555-8555-555555555555"),
      seriesId,
      seriesCode: "F3",
      invoiceNumber: 1,
      issuedAt: new Date("2026-03-02T12:05:00.000Z"),
      offsetMinutes: 60,
      descriptionOfOperation: "Canje de tiques simplificados",
      total: decimal("123.45"),
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("102.02"), tax: decimal("21.43") }],
      counterparty: { taxId: "B12345678", legalName: "Cliente Empresarial SL", countryCode: "ES" },
      ...overrides,
    };
  }

  const someTicket = brandSaleId("11111111-1111-4111-8111-111111111111");

  it("throws fiscal.sale_not_recorded when a substituted sale has no prior alta", async () => {
    const neverRecorded = brandSaleId("00000000-0000-4000-8000-000000000000");
    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordSubstitution(tx, substitutionSale(), { substitutedSaleIds: [neverRecorded] }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: neverRecorded },
    });
  });

  it("refuses to substitute a non-simplified invoice, since only an F2 ticket may be exchanged", async () => {
    // An F3 canje exchanges SIMPLIFIED tickets (F2 → F3, findings §10.2); substituting a full
    // invoice (F1) is not a canje, and mis-filing an F3 is unrepairable (§5), so this asserts rather
    // than assumes. Build a real F1 alta directly (core only ever issues F2), then try to substitute
    // it — the same setup `recordCorrection`'s own F1 refusal uses.
    // A distinct id from the `recordCorrection` F1 refusal test above: this PGlite db is shared
    // across the file and the tenant is fresh each `beforeEach`, but `sales_pkey` is global, so a
    // reused literal id would collide with that sibling test's row.
    const original = brandSaleId("66666666-6666-4666-8666-666666666666");
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(sales).values({
        id: original,
        tenantId,
        tillId,
        seriesId,
        invoiceNumber: 600,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: "0.00",
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tenantId,
        tillId,
        saleId: original,
        seriesId,
        seriesCode: "A",
        invoiceNumber: 600,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty: { taxId: "B12345678", legalName: "Cliente SL", countryCode: "ES" },
      });
    });

    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordSubstitution(tx, substitutionSale(), { substitutedSaleIds: [original] }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.substitution_unsupported",
      params: { saleId: original, tipoFactura: "F1" },
    });
  });

  it("refuses an empty substitutedSaleIds list, which would substitute nothing", async () => {
    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordSubstitution(tx, substitutionSale(), { substitutedSaleIds: [] }),
      ),
    ).rejects.toThrow(/empty/i);
  });

  it("refuses a substitution with no recipient, which a full invoice must always name", async () => {
    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordSubstitution(tx, substitutionSale({ counterparty: null }), {
          substitutedSaleIds: [someTicket],
        }),
      ),
    ).rejects.toThrow(/recipient/i);
  });

  it("refuses a non-Spanish recipient until the foreign-recipient shape is confirmed", async () => {
    await expect(
      withTenant(pg.db, tenantId, (tx) =>
        backend.recordSubstitution(
          tx,
          substitutionSale({
            counterparty: { taxId: "FR12345678901", legalName: "Client SARL", countryCode: "FR" },
          }),
          { substitutedSaleIds: [someTicket] },
        ),
      ),
    ).rejects.toThrow(/non-Spanish/i);
  });
});

describe("recordSale — invoice type selection", () => {
  it("uses F1 (factura completa) once a real counterparty is supplied", async () => {
    // Unreachable through `packages/core`'s own `recordSale`, which always passes
    // `counterparty: null` today (no task yet wires up a recipient-identified sale) — this
    // calls `VerifactuBackend.recordSale` directly, bypassing core entirely, to prove the
    // branch itself rather than leave it an untested assumption about code nothing exercises.
    const freshSaleId = brandSaleId("22222222-2222-4222-8222-222222222222");
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      // total is "0.00" with no tender and no settlement — the simplest possible sale row now that
      // migration 0012 dropped `tip_amount`/`amount_charged` and retired the commit-time
      // coverage trigger (a bare, unsettled sale is a legitimate steady state, design §3) — the same
      // convention `test/fixtures.ts`'s `seedTenantTillSif` and `src/testing/seed.ts`'s `seedSale`
      // already use. Nothing ties this column to `registros_facturacion.importe_total` at the
      // database level (Task 12's own design: the two are allowed to disagree in representation,
      // since only one is hashed), so this sale's own total is irrelevant to the assertion below.
      await tx.insert(sales).values({
        id: freshSaleId,
        tenantId,
        tillId,
        seriesId,
        invoiceNumber: 999,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: "0.00",
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tenantId,
        tillId,
        saleId: freshSaleId,
        seriesId,
        seriesCode: "A",
        invoiceNumber: 999,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty: { taxId: "B12345678", legalName: "Cliente SL", countryCode: "ES" },
      });
    });
    const [row] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.numSerieFactura, "A/999"));
    expect(row?.tipoFactura).toBe("F1");
  });
});

describe("checkIntegrity", () => {
  it("reports nothing checked on a till that has never sold", async () => {
    const report = await withTenant(pg.db, tenantId, (tx) =>
      backend.checkIntegrity(tx, tenantId, tillId),
    );
    expect(report).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("verifies against the chain the same till actually has after a sale", async () => {
    await sell();
    const report = await withTenant(pg.db, tenantId, (tx) =>
      backend.checkIntegrity(tx, tenantId, tillId),
    );
    expect(report.ok).toBe(true);
  });
});

describe("pendingCount", () => {
  it("counts the pending envios row a sale just created", async () => {
    await sell();
    expect(await backend.pendingCount(tenantId, tillId)).toBe(1);
  });

  it("does not count another till's pending records", async () => {
    await sell();
    const other = await seedTenantWithSif(pg.db);
    expect(await backend.pendingCount(other.tenantId, other.tillId)).toBe(0);
  });

  it("drops once the sidecar row is no longer pendiente", async () => {
    await sell();
    await pg.db.execute(sql`update envios set estado = 'aceptado' where tenant_id = ${tenantId}`);
    expect(await backend.pendingCount(tenantId, tillId)).toBe(0);
  });
});
