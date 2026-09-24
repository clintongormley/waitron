import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { captureError, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleForFiscalRecord, TrustedClock } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
import {
  MONEY_SCALE,
  decimal,
  divideDecimal,
  multiplyDecimal,
  nodeId as brandNodeId,
  saleId as brandSaleId,
} from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

let backend: VerifactuBackend;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function sell() {
  return withTransaction(pg.db, async (tx) => {
    return recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId }));
  });
}

describe("id", () => {
  it("identifies itself as the verifactu backend", () => {
    expect(backend.id).toBe("verifactu");
  });
});

describe("zero-rate sales", () => {
  it("files the existing zero-rate product treatment as S1 with a zero cuota", async () => {
    const { saleId } = await withTransaction(pg.db, async (tx) => {
      return recordSale(
        tx,
        backend,
        saleInput({
          tillId,
          nodeId,
          seriesId,
          total: "5.00",
          lines: [
            {
              lineNo: 1,
              name: "Producto sin impuestos",
              descriptions: { "es-ES": "Producto sin impuestos" },
              quantity: "1",
              unitPrice: "5.00",
              vatRate: "0.00",
              lineTotal: "5.00",
            },
          ],
          settlement: {
            kind: "immediate",
            tenders: [
              {
                method: "cash",
                amount: "5.00",
                tipAmount: "0.00",
                settledAt: new Date("2026-03-01T12:05:00.000Z"),
              },
            ],
          },
        }),
      );
    });

    const [row] = await pg.db
      .select({
        desglose: registrosFacturacion.desglose,
        cuotaTotal: registrosFacturacion.cuotaTotal,
      })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    expect(row).toEqual({
      cuotaTotal: "0.00",
      desglose: [
        expect.objectContaining({
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: "5.00",
          TipoImpositivo: "0.00",
          CuotaRepercutida: "0.00",
        }),
      ],
    });
  });
});

describe("registerNode", () => {
  it("reports the node's live SIF registration", async () => {
    const registration = await withTransaction(pg.db, (tx) => backend.registerNode(tx, nodeId));
    expect(registration.backend).toBe("verifactu");
    expect(registration.nodeId).toBe(nodeId);
    expect(registration.registrationId).toContain("WT");
  });

  it("throws the structured sif.not_registered error for a node with no live SIF", async () => {
    const neverProvisioned = brandNodeId("00000000-0000-4000-8000-000000000000");
    await expect(
      withTransaction(pg.db, (tx) => backend.registerNode(tx, neverProvisioned)),
    ).rejects.toMatchObject({ code: "sif.not_registered" });
  });
});

describe("the taxpayer every record is filed as", () => {
  it("refuses to file when the tenants table is empty, loudly and without a domain code", async () => {
    // Filing under a blank or guessed issuer name is unrepairable, so it must fail — as a plain
    // `Error`, since nothing an operator does at a till can fix it.
    await pg.db.execute(sql`delete from tenants`);
    const error = await captureError(() =>
      withTransaction(pg.db, async (tx) => {
        return recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId }));
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toContain("tenants is empty");
  });
});

describe("recordVoid", () => {
  it("throws fiscal.sale_not_recorded for a sale with no prior alta", async () => {
    await expect(
      withTransaction(pg.db, (tx) =>
        backend.recordVoid(tx, "00000000-0000-4000-8000-000000000000" as never, "staff error"),
      ),
    ).rejects.toMatchObject({ code: "fiscal.sale_not_recorded" });
  });

  it("appends an anulación referencing the original alta's own identity", async () => {
    const { saleId } = await sell();
    const ref = await withTransaction(pg.db, (tx) => backend.recordVoid(tx, saleId, "staff error"));
    expect(ref.backend).toBe("verifactu");
    expect(ref.state).toBe("pending");

    const rows = await pg.db.select().from(registrosFacturacion);
    const alta = rows.find((row) => row.tipoRegistro === "alta");
    const anulacion = rows.find((row) => row.tipoRegistro === "anulacion");
    expect(anulacion?.idEmisorFactura).toBe(alta?.idEmisorFactura);
    expect(anulacion?.numSerieFactura).toBe("A/1");
    expect(anulacion?.secuencia).toBe(2);
    // A `RegistroAnulacion` has no amounts, so the row carries NULL, never "0.00".
    expect(anulacion?.cuotaTotal).toBeNull();
    expect(anulacion?.importeTotal).toBeNull();

    const [sidecar] = await pg.db.select().from(envios).where(eq(envios.registroId, anulacion!.id));
    expect(sidecar?.estado).toBe("pendiente");
  });
});

/**
 * `FechaExpedicionFacturaAnulada` must come back as the stored calendar day for any offset. Both
 * offsets below cross midnight from a noon-UTC anchor, the case a noon anchor got wrong, which a
 * moderate offset such as +120 would not exercise. The sale is recorded at the fixture's +01:00 and
 * only the void reads the extreme offset, as when a sale is voided hours later.
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
    await withTransaction(pg.db, (tx) => voidBackend.recordVoid(tx, saleId, "staff error"));

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
    await withTransaction(pg.db, (tx) => voidBackend.recordVoid(tx, saleId, "staff error"));

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
  // Both cases assert a REFUSAL that happens before `appendToChain` runs at all — the
  // original-registro lookup and the F2 gate — so neither exercises the chain append. That path,
  // and the five-callers-started-together case, are `correction-path.e2e.test.ts`'s.

  /** A minimal corrective `SaleForFiscalRecord`. Its own fields are never read on the refusal
   * paths below (both throw before assembling anything from `sale`), but a well-formed value keeps
   * the call type-correct. */
  function correctiveSale(): SaleForFiscalRecord {
    return {
      tillId,
      nodeId,
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
      withTransaction(pg.db, (tx) =>
        backend.recordCorrection(tx, correctiveSale(), { correctsSaleId: neverRecorded }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: neverRecorded },
    });
  });

  it("refuses to correct a non-simplified invoice, since only F2 → R5 is supported (R1 deferred)", async () => {
    // A real F1 alta, built directly: core only ever issues F2.
    const original = brandSaleId("44444444-4444-4444-8444-444444444444");
    await withTransaction(pg.db, async (tx) => {
      await tx.insert(sales).values({
        id: original,
        tillId,
        nodeId,
        seriesId,
        invoiceNumber: 500,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: 0,
        // `[]`: this suite asserts against the registro, not the sales row's breakdown.
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tillId,
        nodeId,
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
      withTransaction(pg.db, (tx) =>
        backend.recordCorrection(tx, correctiveSale(), { correctsSaleId: original }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.correction_unsupported",
      params: { saleId: original, tipoFactura: "F1" },
    });
  });
});

describe("recordSubstitution — refusals", () => {
  // Every case asserts a REFUSAL that happens before `appendToChain` runs at all — the empty-list
  // and recipient guards, the substituted-alta lookup, and the F2 gate — so none exercises the
  // chain append. That path, and the five-callers-started-together case, are
  // `substitution-path.e2e.test.ts`'s.

  /** A minimal F3 `SaleForFiscalRecord` — POSITIVE total, and a NON-null counterparty, since a
   * full invoice must always name its recipient. */
  function substitutionSale(overrides: Partial<SaleForFiscalRecord> = {}): SaleForFiscalRecord {
    return {
      tillId,
      nodeId,
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
      withTransaction(pg.db, (tx) =>
        backend.recordSubstitution(tx, substitutionSale(), { substitutedSaleIds: [neverRecorded] }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: neverRecorded },
    });
  });

  it("refuses to substitute a non-simplified invoice, since only an F2 ticket may be exchanged", async () => {
    // A real F1 alta, built directly: core only ever issues F2. A distinct sale id from the
    // correction case above, since `sales` is keyed by `id` alone.
    const original = brandSaleId("66666666-6666-4666-8666-666666666666");
    await withTransaction(pg.db, async (tx) => {
      await tx.insert(sales).values({
        id: original,
        tillId,
        nodeId,
        seriesId,
        invoiceNumber: 600,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: 0,
        // The filed per-rate desglose; `[]` — see the invoiceNumber 500 insert above.
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tillId,
        nodeId,
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
      withTransaction(pg.db, (tx) =>
        backend.recordSubstitution(tx, substitutionSale(), { substitutedSaleIds: [original] }),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.substitution_unsupported",
      params: { saleId: original, tipoFactura: "F1" },
    });
  });

  it("refuses an empty substitutedSaleIds list, which would substitute nothing", async () => {
    await expect(
      withTransaction(pg.db, (tx) =>
        backend.recordSubstitution(tx, substitutionSale(), { substitutedSaleIds: [] }),
      ),
    ).rejects.toThrow(/empty/i);
  });

  it("refuses a substitution with no recipient, which a full invoice must always name", async () => {
    await expect(
      withTransaction(pg.db, (tx) =>
        backend.recordSubstitution(tx, substitutionSale({ counterparty: null }), {
          substitutedSaleIds: [someTicket],
        }),
      ),
    ).rejects.toThrow(/recipient/i);
  });

  it("refuses a non-Spanish recipient until the foreign-recipient shape is confirmed", async () => {
    await expect(
      withTransaction(pg.db, (tx) =>
        backend.recordSubstitution(
          tx,
          substitutionSale({
            counterparty: { taxId: "FR12345678901", legalName: "Client SARL", countryCode: "FR" },
          }),
          { substitutedSaleIds: [someTicket] },
        ),
      ),
    ).rejects.toMatchObject({
      code: "fiscal.foreign_recipient_unsupported",
      params: { countryCode: "FR" },
    });
  });
});

describe("recordSale — invoice type selection", () => {
  it("uses F1 (factura completa) once a real counterparty is supplied", async () => {
    // Called on the backend directly: `packages/core`'s `recordSale` always passes
    // `counterparty: null`.
    const freshSaleId = brandSaleId("22222222-2222-4222-8222-222222222222");
    await withTransaction(pg.db, async (tx) => {
      // The sales row's own total is irrelevant here: only the registro's is asserted.
      await tx.insert(sales).values({
        id: freshSaleId,
        tillId,
        nodeId,
        seriesId,
        invoiceNumber: 999,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: 0,
        // The filed per-rate desglose; `[]` — see the invoiceNumber 500 insert above.
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tillId,
        nodeId,
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

  /** Records one recipient-identified sale directly through the backend: core always passes
   * `counterparty: null`. */
  async function sellWithRecipient(
    saleId: string,
    invoiceNumber: number,
    counterparty: { taxId: string; legalName: string; countryCode: string },
  ): Promise<void> {
    await withTransaction(pg.db, async (tx) => {
      await tx.insert(sales).values({
        id: saleId,
        tillId,
        nodeId,
        seriesId,
        invoiceNumber,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: 0,
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tillId,
        nodeId,
        saleId: brandSaleId(saleId),
        seriesId,
        seriesCode: "A",
        invoiceNumber,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty,
      });
    });
  }

  it("names a Spanish recipient on the stored F1 record", async () => {
    await sellWithRecipient("88888888-8888-4888-8888-888888888888", 998, {
      taxId: "B12345678",
      legalName: "Cliente SL",
      countryCode: "ES",
    });

    const [row] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.numSerieFactura, "A/998"));
    expect(row?.destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B12345678" }],
    });
  });

  /**
   * Pins a DECISION: a foreign recipient is refused rather than guessed at, because a guessed AEAT
   * identifier type would be filed into an append-only table and could never be unfiled. The F3
   * canje path gets the SAME refusal. A future B2B task that builds the `IDOtro` shape replaces
   * this test.
   */
  it("refuses a non-Spanish recipient rather than guessing an identifier type", async () => {
    await expect(
      sellWithRecipient("99999999-9999-4999-8999-999999999999", 997, {
        taxId: "FR12345678901",
        legalName: "Client SARL",
        countryCode: "FR",
      }),
    ).rejects.toMatchObject({
      code: "fiscal.foreign_recipient_unsupported",
      params: { countryCode: "FR" },
    });

    const rows = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.numSerieFactura, "A/997"));
    expect(rows).toEqual([]);
  });
});

describe("checkIntegrity", () => {
  it("reports nothing checked on a node that has never sold", async () => {
    const report = await withTransaction(pg.db, (tx) => backend.checkIntegrity(tx, nodeId));
    expect(report).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("verifies against the chain the same node actually has after a sale", async () => {
    await sell();
    const report = await withTransaction(pg.db, (tx) => backend.checkIntegrity(tx, nodeId));
    expect(report.ok).toBe(true);
  });
});

describe("pendingCount", () => {
  it("counts the pending envios row a sale just created", async () => {
    await sell();
    expect(await backend.pendingCount(nodeId)).toBe(1);
  });

  it("does not count another node's pending records", async () => {
    await sell();
    const other = await seedTenantWithSif(pg.db);
    expect(await backend.pendingCount(other.nodeId)).toBe(0);
  });

  it("drops once the sidecar row is no longer pendiente", async () => {
    await sell();
    await pg.db.execute(sql`update envios set estado = 'aceptado'`);
    expect(await backend.pendingCount(nodeId)).toBe(0);
  });
});

/**
 * Idempotent replay returns the filed desglose and derives its QR from the stored record. The
 * server's working-order.pay-and-dispatch.test.ts and till-api.fiscal-sale-paths.test.ts suites
 * exercise replay through the backend.
 */
describe("filedReceiptFor", () => {
  it("returns the filed issuer after the taxpayer's own identity changes", async () => {
    // The assertion concerns persisted values: the issuer as FILED, not the taxpayer's current one.
    const { saleId } = await sell();
    const original = await pg.db.execute<{ legal_name: string; tax_id: string }>(
      sql`select legal_name, tax_id from tenants limit 1`,
    );
    const issuer = { legalName: original.rows[0]!.legal_name, taxId: original.rows[0]!.tax_id };
    await pg.db.execute(
      sql`update tenants set legal_name = 'New venue identity', tax_id = 'changed-tax-id'`,
    );
    const filed = await withTransaction(pg.db, (tx) => backend.filedReceiptFor(tx, saleId));
    expect(filed).toHaveProperty("issuer", issuer);
    const current = await pg.db.execute<{ legal_name: string; tax_id: string }>(
      sql`select legal_name, tax_id from tenants limit 1`,
    );
    expect(current.rows[0]).toEqual({
      legal_name: "New venue identity",
      tax_id: "changed-tax-id",
    });
  });

  it("returns the exact filed difference-method desglose, not a recompute", async () => {
    // A basket whose FILED figures are the difference method (tax = gross − base) and DIVERGE from a
    // naive base×rate recompute — the whole reason a replay must READ the filed record. For the 21%
    // group, gross 100.00 → base round(100×100/121) = 82.64, filed tax 100.00 − 82.64 = 17.36; the
    // normal method round(82.64 × 0.21) = 17.35 (asserted as the control below). A recomputing
    // implementation would return 17.35; `filedReceiptFor` returns the stored 17.36.
    const freshSaleId = brandSaleId("77777777-7777-4777-8777-777777777777");
    const vatBreakdown = [
      { rate: decimal("21.00"), base: decimal("82.64"), tax: decimal("17.36") },
      { rate: decimal("10.00"), base: decimal("9.09"), tax: decimal("0.91") },
    ];
    // The sale row must exist first (`registros_facturacion.sale_id` references it).
    const ref = await withTransaction(pg.db, async (tx) => {
      await tx.insert(sales).values({
        id: freshSaleId,
        tillId,
        nodeId,
        seriesId,
        invoiceNumber: 700,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: 11000,
        // The filed per-rate desglose; `[]` — see the invoiceNumber 500 insert above.
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      return backend.recordSale(tx, {
        tillId,
        nodeId,
        saleId: freshSaleId,
        seriesId,
        seriesCode: "A",
        invoiceNumber: 700,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("110.00"),
        vatBreakdown,
        counterparty: null,
      });
    });
    expect(ref.verificationUrl).toBeTruthy();

    const filed = await withTransaction(pg.db, (tx) => backend.filedReceiptFor(tx, freshSaleId));
    expect(filed).toBeDefined();
    // The QR re-derived from the stored record equals the one `recordSale` returned at filing time.
    expect(filed!.verificationUrl).toBe(ref.verificationUrl);
    // The EXACT filed difference-method figures round-trip, element for element and in order.
    expect(filed!.vatBreakdown).toEqual([
      { rate: "21.00", base: "82.64", tax: "17.36" },
      { rate: "10.00", base: "9.09", tax: "0.91" },
    ]);
    // Control: the normal method gives 17.35 for the 21% group, so a recomputing implementation
    // fails the assertion above.
    const normalTax = divideDecimal(
      multiplyDecimal(decimal("82.64"), decimal("21.00")),
      decimal("100"),
      MONEY_SCALE,
    );
    expect(normalTax).toBe("17.35");
    expect(filed!.vatBreakdown[0]!.tax).toBe("17.36");
  });

  it("returns undefined for a sale with no filed alta", async () => {
    const neverFiled = brandSaleId("00000000-0000-4000-8000-000000000000");
    const filed = await withTransaction(pg.db, (tx) => backend.filedReceiptFor(tx, neverFiled));
    expect(filed).toBeUndefined();
  });
});
