import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { asAppUser, sales, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
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
  // (backend.ts), and after this guard exists the original is always valid. So the record is
  // appended directly, which is also the only way to reach the anulación branch with a bad value.
  it("refuses an anulación whose voided invoice number is illegal", async () => {
    const bad = anulacionFor(tillId, "00000000-0000-4000-8000-000000000001", 1, 1);
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
   * would be testing nothing. A deferred sale still writes the sale and the fiscal record. */
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
