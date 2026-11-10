import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { previewCorrectionAmounts, recordCorrection, recordSale } from "@waitron/core";
import {
  captureError,
  invoiceSeries,
  newId,
  nowIso,
  saleLines,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import {
  centsToDecimal,
  decimal,
  deviceOrigin,
  negateDecimal,
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
import { envios } from "./schema/envios.js";

/** Slices 1–3 together: what is stored feeds the calculator, whose lines and split the writer files. */
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
  const { rows } = await suite.db.execute<{ id: string }>(
    sql`insert into persons (id, created_at, display_name, pin_hash, role)
        values (${newId()}, ${nowIso()}, 'Supervisor', ${hashPin("1234")}, 'supervisor') returning id`,
  );
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

/** Records a paid sale at 21%, one line per `[base, gross]`; a null gross stores none. */
async function sell(lines: [base: string, gross: string | null][], split: [string, string]) {
  const total = centsToDecimal(stringToCents(split[0]) + stringToCents(split[1]));
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({
        nodeId,
        seriesId,
        total,
        lines: lines.map(([base, gross], index) => ({
          lineNo: index + 1,
          name: `Dish ${index + 1}`,
          descriptions: { "es-ES": `Dish ${index + 1}` },
          quantity: "1",
          unitPrice: base,
          vatRate: "21.00",
          lineTotal: base,
          lineGross: gross,
        })),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal(split[0]), tax: decimal(split[1]) }],
        settlement: {
          kind: "immediate",
          tenders: [
            { method: "cash", amount: total, tipAmount: "0", settledAt: steadyClock.now().instant },
          ],
        },
      }),
    ),
  );
  return { saleId, before: await snapshot(saleId) };
}

function preview(saleId: SaleId, gross: string) {
  return withTransaction(suite.db, (tx) =>
    previewCorrectionAmounts(tx, backend, { saleId, nodeId }, { gross: decimal(gross) }),
  );
}

/** Previews `gross` off the sale, then files exactly the preview's lines and split. */
async function correct(saleId: SaleId, gross: string) {
  const found = await preview(saleId, gross);
  const { saleId: correctionId } = await withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: saleId,
      total: negateDecimal(found.gross),
      lines: found.lines,
      partialVatBreakdown: found.vatBreakdown.map(({ rate, base, tax }) => ({
        rate,
        base: negateDecimal(base),
        tax: negateDecimal(tax),
      })),
      authz: { sessionId },
      clock: steadyClock,
    }),
  );
  const after = await snapshot(correctionId);
  const record = fromRegistroRow(after.registro);
  expect(validate(record, { now: steadyClock.now().instant })).toEqual([]);
  expect(computeHuella(record)).toBe(after.registro.huella);
  return {
    filing: found.filing,
    stored: after.sale.vatBreakdown,
    lines: after.lines.map((line) => [line.lineTotal, line.lineGross]),
    filedTotal: after.registro.importe_total,
    filed: after.registro.desglose?.map((group) => [
      group.BaseImponibleOimporteNoSujeto,
      group.CuotaRepercutida,
    ]),
  };
}

it("files €6.05, €6.02 and €0.03 off a €12.10 dish from its history, then refuses a cent", async () => {
  const { saleId, before } = await sell([["10.00", "12.10"]], ["10.00", "2.10"]);

  const rounds = [
    await correct(saleId, "6.05"),
    await correct(saleId, "6.02"),
    await correct(saleId, "0.03"),
  ];

  expect(rounds).toEqual([
    {
      filing: "queued",
      stored: [{ rate: "21.00", base: "-5.00", tax: "-1.05" }],
      lines: [[-500, -605]],
      filedTotal: "-6.05",
      filed: [["-5.00", "-1.05"]],
    },
    {
      filing: "queued",
      stored: [{ rate: "21.00", base: "-4.98", tax: "-1.04" }],
      lines: [[-498, -602]],
      filedTotal: "-6.02",
      filed: [["-4.98", "-1.04"]],
    },
    {
      filing: "queued",
      stored: [{ rate: "21.00", base: "-0.02", tax: "-0.01" }],
      lines: [[-2, -3]],
      filedTotal: "-0.03",
      filed: [["-0.02", "-0.01"]],
    },
  ]);
  expect(await captureError(() => preview(saleId, "0.01"))).toMatchObject({
    code: "sale.correction_amount_invalid",
  });
  expect(await snapshot(saleId)).toEqual(before);
});

it("files the last two cents of ten €1.20 coffees as VAT alone", async () => {
  const { saleId, before } = await sell(
    Array.from({ length: 10 }, () => ["0.99", "1.20"]),
    ["9.90", "2.10"],
  );

  const most = await correct(saleId, "11.98");
  const last = await correct(saleId, "0.02");

  expect([most.stored, most.filed]).toEqual([
    [{ rate: "21.00", base: "-9.90", tax: "-2.08" }],
    [["-9.90", "-2.08"]],
  ]);
  expect(last).toMatchObject({
    stored: [{ rate: "21.00", base: "0.00", tax: "-0.02" }],
    filedTotal: "-0.02",
    filed: [["0.00", "-0.02"]],
  });
  expect(await snapshot(saleId)).toEqual(before);
});

it("refuses a refused original before reading its history", async () => {
  const { saleId, before } = await sell([["10.00", null]], ["10.00", "2.10"]);
  const setFiling = (estado: "rechazado" | "aceptado") =>
    suite.db.update(envios).set({ estado }).where(eq(envios.registroId, before.registro.id));

  await setFiling("rechazado");
  const refused = await captureError(() => preview(saleId, "1.00"));
  await setFiling("aceptado");
  const unreadable = await captureError(() => preview(saleId, "1.00"));

  expect(refused).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "filing_refused" },
  });
  expect(unreadable).toMatchObject({ code: "sale.correction_history_unusable" });
  expect(await snapshot(saleId)).toEqual(before);
});
