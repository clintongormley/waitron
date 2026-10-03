import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordCorrection, recordSale } from "@waitron/core";
import type { RecordCorrectionInput } from "@waitron/core";
import { computeHuella } from "@waitron/verifactu";
import { invoiceSeries, newId, nowIso, saleLines, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { centsToDecimal, seriesId as brandSeriesId, deviceOrigin } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId, DeviceId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";

/**
 * A corrective invoice is filed at the cent amounts its `sales` and `sale_lines` rows store; of
 * those, the total and the tax total are hashed. `@waitron/verifactu` formats every filed amount to
 * two places itself, so the cases that change a filed amount are those derived from the lines: a
 * tax computed from a sub-cent base, and a base summed from several sub-cent lines.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let tillId: TillId;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;
let rectSeriesId: SeriesId;
let rectifySessionId: string;

beforeEach(async () => {
  // A pinned NIF: it is a huella input, and the control below pins a huella literal.
  ({ tillId, deviceId, nodeId, seriesId } = await seedTenantWithSif(suite.db, {
    nif: "20009999E",
  }));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "R", purpose: "rectificative", nextNumber: 1 })
    .returning({ id: invoiceSeries.id });
  rectSeriesId = brandSeriesId(series!.id);
  // A supervisor holds `sale.rectify`.
  const { rows } = await suite.db.execute<{ id: string }>(
    sql`insert into persons (id, created_at, display_name, pin_hash, role)
        values (${newId()}, ${nowIso()}, 'P', ${hashPin("1234")}, 'supervisor') returning id`,
  );
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId: rows[0]!.id, pin: "1234" }),
  );
  rectifySessionId = session.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function sell(): Promise<SaleId> {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId })),
  );
  return saleId;
}

/** A credit against the €14.41 fixture sale, one line per entry of `lineTotals`, all at `vatRate`. */
async function correct(
  correctsSaleId: SaleId,
  total: string,
  lineTotals: string[],
  vatRate = "21.00",
): Promise<SaleId> {
  const input: RecordCorrectionInput = {
    tillId,
    origin: deviceOrigin(deviceId),
    nodeId,
    seriesId: rectSeriesId,
    correctsSaleId,
    total,
    lines: lineTotals.map((lineTotal, index) => ({
      lineNo: index + 1,
      name: "Descuento",
      descriptions: { "es-ES": "Descuento" },
      quantity: "-1",
      unitPrice: lineTotal.replace("-", ""),
      vatRate,
      lineTotal,
    })),
    authz: { sessionId: rectifySessionId },
    clock: steadyClock,
  };
  const { saleId } = await withTransaction(suite.db, (tx) => recordCorrection(tx, backend, input));
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
  const lines = await suite.db
    .select({ lineTotal: saleLines.lineTotal })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));
  const row = await rawRegistro(saleId);
  return {
    storedTotalCents: sale!.total,
    storedLineTotalCents: lines.map((l) => l.lineTotal),
    storedVatBreakdown: sale!.vatBreakdown,
    importeTotal: row.importe_total,
    cuotaTotal: row.cuota_total,
    desglose: row.desglose,
    huella: row.huella,
    huellaRecomputes: computeHuella(fromRegistroRow(row)) === row.huella,
  };
}

type Observed = Awaited<ReturnType<typeof observe>>;

/** Every filed amount is the one the rows store; each case here has one VAT rate. */
function expectFiledAsStored(s: Observed): void {
  const storedBase = centsToDecimal(s.storedLineTotalCents.reduce((sum, cents) => sum + cents, 0));
  expect(s.importeTotal).toBe(centsToDecimal(s.storedTotalCents));
  expect(s.desglose?.map((d) => d.BaseImponibleOimporteNoSujeto)).toEqual([storedBase]);
  expect(s.storedVatBreakdown.map((g) => [g.base, g.tax])).toEqual(
    s.desglose?.map((d) => [d.BaseImponibleOimporteNoSujeto, d.CuotaRepercutida]),
  );
  expect(s.cuotaTotal).toBe(s.desglose?.[0]?.CuotaRepercutida);
  expect(s.huellaRecomputes).toBe(true);
}

describe("a correction is filed at the cent amounts its rows store", () => {
  it("files a total typed with a third decimal place as the cent total the sale row stores", async () => {
    const s = await observe(await correct(await sell(), "-1.005", ["-0.83"]));

    expect(s.storedTotalCents).toBe(-101);
    expect(s.importeTotal).toBe("-1.01");
    expectFiledAsStored(s);
  });

  it("derives the filed tax from the cent base the line row stores", async () => {
    // -0.045 is stored as -0.05. 10% of -0.05 is -0.005, which rounds to -0.01; 10% of the
    // unrounded -0.045 is -0.0045, which rounds to nothing.
    const s = await observe(await correct(await sell(), "-0.06", ["-0.045"], "10.00"));

    expect(s.storedLineTotalCents).toEqual([-5]);
    expect(s.cuotaTotal).toBe("-0.01");
    expectFiledAsStored(s);
  });

  it("files the sum of the cent line amounts the rows store, not the rounded sum of what was typed", async () => {
    // Each -0.005 is stored as -0.01, so the rows hold -0.02; the typed lines sum to -0.010.
    const s = await observe(await correct(await sell(), "-0.02", ["-0.005", "-0.005"]));

    expect(s.storedLineTotalCents).toEqual([-1, -1]);
    expect(s.desglose?.map((d) => d.BaseImponibleOimporteNoSujeto)).toEqual(["-0.02"]);
    expectFiledAsStored(s);
  });

  it("files a two-decimal correction with its pinned amounts and huella", async () => {
    const s = await observe(await correct(await sell(), "-1.00", ["-0.83"]));

    expect(s.importeTotal).toBe("-1.00");
    expect(s.cuotaTotal).toBe("-0.17");
    expect(s.desglose?.map((d) => d.BaseImponibleOimporteNoSujeto)).toEqual(["-0.83"]);
    // `expectFiledAsStored` checks the huella only against the record's own fields; only a pinned
    // literal catches a two-decimal correction filing different amounts.
    expect(s.huella).toBe("76247AD40A37467C3228CB701C0E7200F681134C217B628328E2441FAEEE19F2");
    expectFiledAsStored(s);
  });
});
