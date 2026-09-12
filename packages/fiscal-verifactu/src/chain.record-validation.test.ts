import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { asAppUser, sales, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
