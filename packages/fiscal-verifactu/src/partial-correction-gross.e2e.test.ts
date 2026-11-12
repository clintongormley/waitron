import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { recordCorrection, recordSale, type RecordSaleLine } from "@waitron/core";
import { invoiceSeries, newId, nowIso, saleLines, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import {
  basisPointsToDecimal,
  centsToDecimal,
  decimal,
  deviceOrigin,
  stringToCents,
  seriesId as brandSeriesId,
  type DeviceId,
  type NodeId,
  type SaleId,
  type SeriesId,
} from "@waitron/shared";
import { computeHuella, validate } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";

/**
 * A partial correction "por diferencias" files the VAT split it is handed. The library's
 * `validate` skips the VAT formula for such a record, so the cents are asserted exactly here.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;
let rectSeriesId: SeriesId;
let sessionId: string;

beforeEach(async () => {
  ({ deviceId, nodeId, seriesId } = await seedTenantWithSif(suite.db));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "R", purpose: "rectificative", nextNumber: 1 })
    .returning({ id: invoiceSeries.id });
  rectSeriesId = brandSeriesId(series!.id);
  const rows = await seedPersons(suite.db, {
    id: newId(),
    createdAt: nowIso(),
    displayName: "Supervisor",
    pinHash: hashPin("1234"),
    role: "supervisor",
  });
  sessionId = (
    await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId, personId: rows[0]!.id, pin: "1234" }),
    )
  ).id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

type Line = [vatRate: string, base: string, gross: string];

async function snapshot(saleId: SaleId) {
  const [sale] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
  const lines = await suite.db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  const { rows } = await suite.db.execute<Record<string, unknown>>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  return { sale: sale!, lines, registro: decodeRegistroRow(rows[0]!) };
}

/** Records an original sale, one line per entry, with the per-rate breakdown its lines carry. */
async function seedOriginal(lines: Line[]) {
  const rates = [...new Set(lines.map(([rate]) => rate))];
  const sum = (values: string[]) =>
    values.reduce((cents, value) => cents + stringToCents(value), 0);
  const totalCents = sum(lines.map(([, , gross]) => gross));
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({
        nodeId,
        seriesId,
        total: centsToDecimal(totalCents),
        lines: lines.map(([vatRate, base, gross], index) => ({
          lineNo: index + 1,
          name: `Dish ${index + 1}`,
          descriptions: { "es-ES": `Dish ${index + 1}` },
          quantity: "1",
          unitPrice: base,
          vatRate,
          lineTotal: base,
          lineGross: gross,
        })),
        vatBreakdown: rates.map((rate) => {
          const atRate = lines.filter(([lineRate]) => lineRate === rate);
          const base = sum(atRate.map(([, lineBase]) => lineBase));
          const gross = sum(atRate.map(([, , lineGross]) => lineGross));
          return {
            rate: decimal(rate),
            base: centsToDecimal(base),
            tax: centsToDecimal(gross - base),
          };
        }),
        settlement: {
          kind: "immediate",
          tenders: [
            {
              method: "cash",
              amount: centsToDecimal(totalCents),
              tipAmount: "0",
              settledAt: steadyClock.now().instant,
            },
          ],
        },
      }),
    ),
  );
  return { saleId, before: await snapshot(saleId) };
}

/** Files one correction: `[original line index, base, gross]` per line, and its per-rate split. */
async function correct(
  original: Awaited<ReturnType<typeof seedOriginal>>,
  total: string,
  lines: [index: number, base: string, gross: string][],
  split: [rate: string, base: string, tax: string][],
) {
  const correctionLines: RecordSaleLine[] = lines.map(([index, base, gross], position) => {
    const source = original.before.lines[index]!;
    return {
      lineNo: position + 1,
      name: source.name,
      descriptions: source.descriptions,
      quantity: "-1",
      unitPrice: centsToDecimal(source.unitPrice),
      vatRate: basisPointsToDecimal(source.vatRate),
      lineTotal: base,
      lineGross: gross,
      correctsLineId: source.id,
    };
  });
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: original.saleId,
      total,
      lines: correctionLines,
      partialVatBreakdown: split.map(([rate, base, tax]) => ({
        rate: decimal(rate),
        base: decimal(base),
        tax: decimal(tax),
      })),
      authz: { sessionId },
      clock: steadyClock,
    }),
  );
  const after = await snapshot(saleId);
  const record = fromRegistroRow(after.registro);
  expect(validate(record, { now: steadyClock.now().instant })).toEqual([]);
  expect(computeHuella(record)).toBe(after.registro.huella);
  return {
    total: after.sale.total,
    stored: after.sale.vatBreakdown,
    filedTotal: after.registro.importe_total,
    filedVat: after.registro.cuota_total,
    filed: after.registro.desglose?.map((group) => [
      group.TipoImpositivo,
      group.BaseImponibleOimporteNoSujeto,
      group.CuotaRepercutida,
    ]),
  };
}

it("files €6.05, €6.02 and €0.03 off a €12.10 dish at the split each is given", async () => {
  const original = await seedOriginal([["21.00", "10.00", "12.10"]]);

  const first = await correct(
    original,
    "-6.05",
    [[0, "-5.00", "-6.05"]],
    [["21.00", "-5.00", "-1.05"]],
  );
  const second = await correct(
    original,
    "-6.02",
    [[0, "-4.98", "-6.02"]],
    [["21.00", "-4.98", "-1.04"]],
  );
  const third = await correct(
    original,
    "-0.03",
    [[0, "-0.02", "-0.03"]],
    [["21.00", "-0.02", "-0.01"]],
  );

  expect(first).toEqual({
    total: -605,
    stored: [{ rate: "21.00", base: "-5.00", tax: "-1.05" }],
    filedTotal: "-6.05",
    filedVat: "-1.05",
    filed: [["21.00", "-5.00", "-1.05"]],
  });
  expect(second).toEqual({
    total: -602,
    stored: [{ rate: "21.00", base: "-4.98", tax: "-1.04" }],
    filedTotal: "-6.02",
    filedVat: "-1.04",
    filed: [["21.00", "-4.98", "-1.04"]],
  });
  expect(third).toEqual({
    total: -3,
    stored: [{ rate: "21.00", base: "-0.02", tax: "-0.01" }],
    filedTotal: "-0.03",
    filedVat: "-0.01",
    filed: [["21.00", "-0.02", "-0.01"]],
  });
  expect(await snapshot(original.saleId)).toEqual(original.before);
});

it("files the last two cents of ten €1.20 coffees as VAT alone", async () => {
  const original = await seedOriginal(
    Array.from({ length: 10 }, (): Line => ["21.00", "0.99", "1.20"]),
  );
  expect(original.before.sale.vatBreakdown).toEqual([{ rate: "21.00", base: "9.90", tax: "2.10" }]);

  const most = await correct(
    original,
    "-11.98",
    Array.from({ length: 10 }, (_, index) => [index, "-0.99", index < 8 ? "-1.20" : "-1.19"]),
    [["21.00", "-9.90", "-2.08"]],
  );
  const last = await correct(
    original,
    "-0.02",
    [
      [8, "0.00", "-0.01"],
      [9, "0.00", "-0.01"],
    ],
    [["21.00", "0.00", "-0.02"]],
  );

  expect(most).toEqual({
    total: -1198,
    stored: [{ rate: "21.00", base: "-9.90", tax: "-2.08" }],
    filedTotal: "-11.98",
    filedVat: "-2.08",
    filed: [["21.00", "-9.90", "-2.08"]],
  });
  expect(last).toEqual({
    total: -2,
    stored: [{ rate: "21.00", base: "0.00", tax: "-0.02" }],
    filedTotal: "-0.02",
    filedVat: "-0.02",
    filed: [["21.00", "0.00", "-0.02"]],
  });
  expect(await snapshot(original.saleId)).toEqual(original.before);
});

it("keeps each original rate on a mixed two-euro reduction", async () => {
  const original = await seedOriginal([
    ["10.00", "10.00", "11.00"],
    ["21.00", "10.00", "12.10"],
  ]);

  const result = await correct(
    original,
    "-2.00",
    [
      [0, "-0.86", "-0.95"],
      [1, "-0.87", "-1.05"],
    ],
    [
      ["10.00", "-0.86", "-0.09"],
      ["21.00", "-0.87", "-0.18"],
    ],
  );

  expect(result).toEqual({
    total: -200,
    stored: [
      { rate: "10.00", base: "-0.86", tax: "-0.09" },
      { rate: "21.00", base: "-0.87", tax: "-0.18" },
    ],
    filedTotal: "-2.00",
    filedVat: "-0.27",
    filed: [
      ["10.00", "-0.86", "-0.09"],
      ["21.00", "-0.87", "-0.18"],
    ],
  });
  expect(await snapshot(original.saleId)).toEqual(original.before);
});
