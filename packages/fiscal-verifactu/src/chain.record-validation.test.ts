import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { asAppUser, sales, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal, saleId as brandSaleId } from "@waitron/shared";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { VerifactuBackend } from "./backend.js";
import { registrosFacturacion } from "./schema/registros.js";
import { anulacionFor } from "./testing/seed.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// PGlite, deliberately (CLAUDE.md §4): every case here asserts a refusal decided in application
// code before the insert. Nothing tested depends on grants being enforced or on two writers
// racing, which are the two properties PGlite cannot show.
let backend: VerifactuBackend;
let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** Point the seeded series at a code AEAT's character set forbids. A space is the shape an
 * operator actually types ("Serie A"), and it is what reached `registros_facturacion` before this
 * guard existed. */
async function useSeriesCode(code: string): Promise<void> {
  await pg.db.execute(sql`update invoice_series set code = ${code} where id = ${seriesId}`);
}

function sell() {
  return withTenant(pg.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, nodeId, seriesId }));
  });
}

describe("a record AEAT could not accept never enters the chain", () => {
  it("refuses a sale whose invoice number uses a forbidden character", async () => {
    await useSeriesCode("Serie A");
    await expect(sell()).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: ["NumSerieFactura"], codes: ["NUMSERIE_CHARSET"] },
    });
  });

  it("writes nothing at all when it refuses", async () => {
    await useSeriesCode("Serie A");
    await expect(sell()).rejects.toMatchObject({ code: "fiscal.record_invalid" });

    const registros = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registros).toEqual([]);

    // The sale itself must be gone too — `recordSale` writes the sale and the fiscal record in ONE
    // transaction, so a refusal that left a sale behind would be a sale with no fiscal record.
    const soldRows = await pg.db.select().from(sales).where(eq(sales.tenantId, tenantId));
    expect(soldRows).toEqual([]);

    // And the chain head must not have advanced: a refused record leaves the node exactly where it
    // was, so the next legitimate sale is still the chain's first record.
    const heads = await pg.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where tenant_id = ${tenantId} and node_id = ${nodeId}`,
    );
    expect(heads.rows[0]?.secuencia ?? 0).toBe(0);
  });

  it("accepts the same sale once the series code is legal", async () => {
    await useSeriesCode("FS");
    const { saleId } = await sell();
    expect(saleId).toBeDefined();

    const [registro] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registro?.numSerieFactura).toBe("FS/1");
  });

  // The anulación arm reaches `validate` through the SAME `const record =` line as every alta, but
  // "the same line" is an argument, not evidence, so it gets its own case. It cannot be provoked
  // through `recordVoid`: that rebuilds its identity from the original alta's stored columns
  // (backend.ts), and for a record written AFTER this guard exists those columns are valid. (A
  // database already holding a bad record written before the guard is the exception, and it is a
  // one-way door: such a record can no longer be annulled at all.) So the record is appended
  // directly, which is also the only way to reach the anulación branch with a bad value.
  it("refuses an anulación whose voided invoice number is illegal", async () => {
    const bad = anulacionFor(tillId, brandSaleId("00000000-0000-4000-8000-000000000001"), 1, 1);
    const registro = {
      ...bad,
      input: { ...bad.input, NumSerieFacturaAnulada: "Serie A/1" },
    };

    await expect(
      withTenant(pg.db, tenantId, (tx) => appendToChain(tx, tenantId, nodeId, registro)),
    ).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: ["NumSerieFacturaAnulada"] },
    });
  });
});

describe("a record whose totals disagree with themselves is written, filed and flagged", () => {
  /** A sale whose stated total is far from its own VAT lines, breaching the 10.00 tolerance
   * without breaking any FORMAT rule — the only way to reach a warning without also reaching an
   * error, which Task 1's guard would refuse.
   *
   * `settlement: "deferred"` matters and is not incidental: `saleInput`'s default is an IMMEDIATE
   * settlement whose tender matches its original total, and `settleSale` throws
   * `sale.tender_shortfall` when the tendered sum disagrees with the due amount — so an immediate
   * fixture would abort in settlement, before the fiscal record is ever built, and this suite
   * would be testing nothing. A deferred sale still writes the sale and the fiscal record.
   *
   * It also depends on `saleInput` supplying NO `vatBreakdown`: `recordSale` cross-checks a
   * SUPPLIED breakdown against the stated total and throws `sale.total_mismatch`
   * (`packages/core/src/record-sale.ts`) before the fiscal record is built, so a fixture that
   * passed one would abort there and this suite would again be testing nothing. The breakdown this
   * case needs is the DERIVED one, which cannot disagree with itself. */
  function mismatchedSale() {
    return {
      ...saleInput({ tenantId, tillId, nodeId, seriesId }),
      total: decimal("9999.00"),
      settlement: { kind: "deferred" } as const,
    };
  }

  it("records the sale rather than refusing it", async () => {
    await useSeriesCode("FS");
    const { saleId } = await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, mismatchedSale());
    });
    expect(saleId).toBeDefined();

    const registros = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registros).toHaveLength(1);
  });

  it("raises a warning incident against that sale", async () => {
    await useSeriesCode("FS");
    const { saleId } = await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, mismatchedSale());
    });

    const rows = await pg.db.execute<{ code: string; severity: string; sale_id: string }>(
      sql`select code, severity, sale_id from incidents where tenant_id = ${tenantId}`,
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        code: "fiscal.record_totals_disagree",
        severity: "warning",
        sale_id: saleId,
      }),
    ]);
  });

  it("leaves a well-formed sale with no incident at all", async () => {
    await useSeriesCode("FS");
    await sell();

    const rows = await pg.db.execute(sql`select 1 from incidents where tenant_id = ${tenantId}`);
    expect(rows.rows).toEqual([]);
  });
});

describe("a recipient's name is checked as closely as the issuer's", () => {
  /** The run-it review's own reproduction, at the seam it got past. A Spanish business customer's
   * name is typed or pasted at the till, so U+0007 reaches the record exactly the way it reached
   * the reviewer's: the F1 path this branch opened is the first thing that ever wrote a recipient
   * on a sale, and `validate` scanned the ISSUER's name but not the recipient's. `registros_facturacion`
   * is append-only, so a bell character stored there could never be taken out again.
   *
   * `packages/core`'s `recordSale` hardcodes `counterparty: null`, so the F1 branch is reached by
   * calling the backend directly — the same bypass `backend.test.ts`'s own F1 cases use. The sale
   * row is inserted on the SAME `withTenant` transaction, which is what makes the "nothing was
   * written" assertions below meaningful: a refusal rolls back both or neither. */
  // `sales_pkey` is global while the tenant is fresh each `beforeEach`, so each case mints its own
  // id and invoice number — a shared literal would make a case that EXPECTS the write to succeed
  // depend on its siblings having rolled theirs back.
  let sequence = 0;

  function sellToNamedRecipient(legalName: string) {
    sequence += 1;
    const saleId = `77777777-7777-4777-8777-7777777770${String(sequence).padStart(2, "0")}`;
    const invoiceNumber = 900 + sequence;
    return withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(sales).values({
        id: saleId,
        tenantId,
        tillId,
        nodeId,
        seriesId,
        invoiceNumber,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: "0.00",
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tenantId,
        tillId,
        nodeId,
        saleId: brandSaleId(saleId),
        seriesId,
        seriesCode: "FS",
        invoiceNumber,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty: { taxId: "B12345678", legalName, countryCode: "ES" },
      });
    });
  }

  it("refuses an F1 whose recipient name carries a control character", async () => {
    await useSeriesCode("FS");
    await expect(sellToNamedRecipient("Cliente\u0007SL")).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: {
        fields: ["Destinatarios.IDDestinatario[0].NombreRazon"],
        codes: ["CONTROL_CHAR"],
      },
    });
  });

  it("writes nothing at all when it refuses", async () => {
    await useSeriesCode("FS");
    await expect(sellToNamedRecipient("Cliente\u0007SL")).rejects.toMatchObject({
      code: "fiscal.record_invalid",
    });

    const registros = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registros).toEqual([]);

    const soldRows = await pg.db.select().from(sales).where(eq(sales.tenantId, tenantId));
    expect(soldRows).toEqual([]);

    const heads = await pg.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where tenant_id = ${tenantId} and node_id = ${nodeId}`,
    );
    expect(heads.rows[0]?.secuencia ?? 0).toBe(0);
  });

  it("records the same sale once the recipient's name is ordinary text", async () => {
    await useSeriesCode("FS");
    await sellToNamedRecipient("Cliente SL");

    const [registro] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registro?.destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B12345678" }],
    });
  });
});
