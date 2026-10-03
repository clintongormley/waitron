import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale, recordSubstitution } from "@waitron/core";
import type { RecordSaleLine } from "@waitron/core";
import type { VatBreakdownLine } from "@waitron/fiscal";
import { computeHuella } from "@waitron/verifactu";
import { saleLines, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { centsToDecimal, decimal } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";

/**
 * An ordinary sale and a substitution are filed at the cent amounts their `sales` and `sale_lines`
 * rows store, as a correction is (`correction-amount.huella.test.ts`). `@waitron/verifactu` formats
 * every filed amount to two places itself, so the cases that change a filed amount are those derived
 * from the lines: a tax computed from a sub-cent base, and a base summed from sub-cent lines.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  // A pinned NIF: it is a huella input, and the controls below pin huella literals.
  ({ tillId, nodeId, seriesId } = await seedTenantWithSif(suite.db, { nif: "20009999E" }));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** One line per entry of `lineTotals`, all at `vatRate`. */
function lines(lineTotals: string[], vatRate: string): RecordSaleLine[] {
  return lineTotals.map((lineTotal, index) => ({
    lineNo: index + 1,
    name: "Café solo",
    descriptions: { "es-ES": "Café solo" },
    quantity: "1",
    unitPrice: lineTotal,
    vatRate,
    lineTotal,
  }));
}

/** A sale on a deferred bill, so no tender has to cover its total. */
async function sell(
  total: string,
  lineTotals: string[],
  vatRate = "21.00",
  vatBreakdown?: VatBreakdownLine[],
): Promise<SaleId> {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({
        tillId,
        nodeId,
        seriesId,
        total,
        lines: lines(lineTotals, vatRate),
        ...(vatBreakdown === undefined ? {} : { vatBreakdown }),
        settlement: { kind: "deferred" },
      }),
    ),
  );
  return saleId;
}

/** A full invoice replacing one €14.41 simplified ticket. */
async function substitute(total: string, lineTotals: string[], vatRate = "21.00") {
  const { saleId: ticket } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId })),
  );
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSubstitution(tx, backend, {
      tillId,
      nodeId,
      seriesId,
      substitutedSaleIds: [ticket],
      counterparty: { taxId: "B12345674", legalName: "Acme Corp SL", countryCode: "ES" },
      total,
      lines: lines(lineTotals, vatRate),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      clock: steadyClock,
    }),
  );
  return saleId;
}

async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await suite.db.execute<Record<string, unknown>>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return decodeRegistroRow(row);
}

async function observe(saleId: SaleId) {
  const [sale] = await suite.db
    .select({ total: sales.total, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.id, saleId));
  const stored = await suite.db
    .select({ lineTotal: saleLines.lineTotal })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));
  const row = await rawRegistro(saleId);
  return {
    storedTotalCents: sale!.total,
    storedLineTotalCents: stored.map((l) => l.lineTotal),
    storedVatBreakdown: sale!.vatBreakdown,
    importeTotal: row.importe_total,
    cuotaTotal: row.cuota_total,
    desglose: row.desglose,
    huella: row.huella,
    huellaRecomputes: computeHuella(fromRegistroRow(row)) === row.huella,
  };
}

type Observed = Awaited<ReturnType<typeof observe>>;

/**
 * Every filed amount is the one the rows store; each case here has one VAT rate. A derived
 * breakdown's base is also the sum of the stored line totals; a supplied one is rounded on its own,
 * never summed from the lines, so its cases pass `derived: false`.
 */
function expectFiledAsStored(s: Observed, { derived = true } = {}): void {
  expect(s.importeTotal).toBe(centsToDecimal(s.storedTotalCents));
  if (derived) {
    const storedBase = centsToDecimal(
      s.storedLineTotalCents.reduce((sum, cents) => sum + cents, 0),
    );
    expect(s.desglose?.map((d) => d.BaseImponibleOimporteNoSujeto)).toEqual([storedBase]);
  }
  expect(s.storedVatBreakdown.map((g) => [g.base, g.tax])).toEqual(
    s.desglose?.map((d) => [d.BaseImponibleOimporteNoSujeto, d.CuotaRepercutida]),
  );
  expect(s.cuotaTotal).toBe(s.desglose?.[0]?.CuotaRepercutida);
  expect(s.huellaRecomputes).toBe(true);
}

describe("an ordinary sale is filed at the cent amounts its rows store", () => {
  it("derives the filed tax from the cent base the line row stores", async () => {
    // 0.045 is stored as 0.05. 10% of 0.05 is 0.005, which rounds to 0.01; 10% of the unrounded
    // 0.045 is 0.0045, which rounds to nothing.
    const s = await observe(await sell("0.06", ["0.045"], "10.00"));

    expect(s.storedLineTotalCents).toEqual([5]);
    expect(s.cuotaTotal).toBe("0.01");
    expectFiledAsStored(s);
  });

  it("files the sum of the cent line amounts the rows store, not the rounded sum of what was typed", async () => {
    // Each 0.005 is stored as 0.01, so the rows hold 0.02; the typed lines sum to 0.010.
    const s = await observe(await sell("0.02", ["0.005", "0.005"]));

    expect(s.storedLineTotalCents).toEqual([1, 1]);
    expect(s.desglose?.map((d) => d.BaseImponibleOimporteNoSujeto)).toEqual(["0.02"]);
    expectFiledAsStored(s);
  });

  it("files a supplied breakdown at the cent amounts the sale row stores", async () => {
    // 1.004 + 0.1004 = 1.1044; at the cent, 1.00 + 0.10 = 1.10.
    const s = await observe(
      await sell("1.1044", ["1.004"], "10.00", [
        { rate: decimal("10.00"), base: decimal("1.004"), tax: decimal("0.1004") },
      ]),
    );

    expect(s.storedTotalCents).toBe(110);
    expect(s.storedVatBreakdown).toEqual([{ rate: "10.00", base: "1.00", tax: "0.10" }]);
    expectFiledAsStored(s, { derived: false });
  });

  it("files a two-decimal sale with its pinned amounts and huella", async () => {
    const s = await observe(await sell("1.21", ["1.00"]));

    expect(s.importeTotal).toBe("1.21");
    expect(s.cuotaTotal).toBe("0.21");
    // `expectFiledAsStored` checks the huella only against the record's own fields; only a pinned
    // literal catches a two-decimal sale filing different amounts.
    expect(s.huella).toBe("01FA0378A1F5C69449F98990DDA088954D38B699D46CB7CAB31D1F344374D9F5");
    expectFiledAsStored(s);
  });
});

describe("a substitution is filed at the cent amounts its rows store", () => {
  it("derives the filed tax from the cent base the line row stores", async () => {
    // As for a sale: 0.045 is stored as 0.05, whose 10% is 0.005, which rounds to 0.01.
    const s = await observe(await substitute("0.06", ["0.045"], "10.00"));

    expect(s.storedLineTotalCents).toEqual([5]);
    expect(s.cuotaTotal).toBe("0.01");
    expectFiledAsStored(s);
  });

  it("files a total typed with a third decimal place as the cent total the sale row stores", async () => {
    const s = await observe(await substitute("1.005", ["0.83"]));

    expect(s.storedTotalCents).toBe(101);
    expect(s.importeTotal).toBe("1.01");
    expectFiledAsStored(s);
  });

  it("files a two-decimal substitution with its pinned amounts and huella", async () => {
    const s = await observe(await substitute("1.21", ["1.00"]));

    expect(s.importeTotal).toBe("1.21");
    expect(s.cuotaTotal).toBe("0.21");
    expect(s.huella).toBe("9543ABD48DF033B023EB35B38D85D83B8064E453317418683A19D6B17C323C90");
    expectFiledAsStored(s);
  });
});
