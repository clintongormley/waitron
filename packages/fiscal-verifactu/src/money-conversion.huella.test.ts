import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { computeHuella } from "@waitron/verifactu";
import { asAppUser, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";

/**
 * The storage change from a decimal column to whole cents moves the arithmetic that produces a
 * fiscal record's amounts, not the columns that store them — `cuota_total` and `importe_total` are
 * already `text` (`./schema/registros.ts`). So the only way the change can damage a record is a
 * rounding difference, and a rounding difference shows up here and nowhere else.
 *
 * Every expected value below is a LITERAL captured by running this file against the code BEFORE
 * the conversion. Computing them instead would run the very arithmetic under test. A failure here
 * after the conversion is a real rounding difference: fix the code, never these literals.
 */
const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function sell(overrides: Record<string, unknown> = {}) {
  return withTransaction(pg.db, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId, ...overrides }));
  });
}

/** The snake_case row the huella is recomputed from, read raw — the same convention
 * `./write-path.e2e.test.ts` and `./verify.ts` use, and not interchangeable with drizzle's
 * camelCase select shape. */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await pg.db.execute<Record<string, unknown>>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return decodeRegistroRow(row);
}

describe("the money conversion moves no byte of a fiscal record", () => {
  it("produces the same amounts and huella for the shared sale fixture", async () => {
    const { saleId } = await sell();
    const row = await rawRegistro(saleId);

    expect(row.importe_total).toBe("14.41");
    expect(row.cuota_total).toBe("2.31");
    expect(row.desglose).toEqual([
      expect.objectContaining({
        BaseImponibleOimporteNoSujeto: "10.00",
        TipoImpositivo: "21.00",
        CuotaRepercutida: "2.10",
      }),
      expect.objectContaining({
        BaseImponibleOimporteNoSujeto: "2.10",
        TipoImpositivo: "10.00",
        CuotaRepercutida: "0.21",
      }),
    ]);
    expect(row.huella).toBe("A1AF497FA4C00C9AD38004429A5901133312F97335BD76E216C917D0C93D8626");
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  });

  it("produces the same amounts and huella for a sale whose tax lands on a half cent", async () => {
    // The fixture above rounds nothing: every figure in it is already exact at two places, so it
    // would pass even if the rounding rule changed. These two bases are chosen because the tax is
    // exactly half a cent and the rule (half away from zero) decides the answer: 1.50 at 21% is
    // 0.315, and 0.05 at 10% is 0.005. A conversion that truncated, or rounded half to even, would
    // return 0.31 and 0.00 here and be invisible in every other test in this package.
    const { saleId } = await sell({
      total: "1.88",
      lines: [
        {
          lineNo: 1,
          name: "Media ración",
          descriptions: { "es-ES": "Media ración" },
          quantity: "1",
          unitPrice: "1.50",
          vatRate: "21.00",
          lineTotal: "1.50",
        },
        {
          lineNo: 2,
          name: "Caramelo",
          descriptions: { "es-ES": "Caramelo" },
          quantity: "1",
          unitPrice: "0.05",
          vatRate: "10.00",
          lineTotal: "0.05",
        },
      ],
      settlement: {
        kind: "immediate",
        tenders: [
          {
            method: "cash",
            amount: "1.88",
            tipAmount: "0.00",
            settledAt: new Date("2026-03-01T13:05:00+01:00"),
          },
        ],
      },
    });
    const row = await rawRegistro(saleId);

    expect(row.importe_total).toBe("1.88");
    expect(row.cuota_total).toBe("0.33");
    expect(row.desglose).toEqual([
      expect.objectContaining({
        BaseImponibleOimporteNoSujeto: "1.50",
        TipoImpositivo: "21.00",
        CuotaRepercutida: "0.32",
      }),
      expect.objectContaining({
        BaseImponibleOimporteNoSujeto: "0.05",
        TipoImpositivo: "10.00",
        CuotaRepercutida: "0.01",
      }),
    ]);
    expect(row.huella).toBe("649EADFDC7E12F782A58439BD7017C17D30FE65F5036C7A6BC9486107083CAE8");
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  });
});
