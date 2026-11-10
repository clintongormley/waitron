import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { previewCorrectionAmounts, recordCorrection, recordSale } from "@waitron/core";
import {
  managementSessions,
  captureError,
  invoiceSeries,
  newId,
  nowIso,
  saleLines,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashSessionToken,
  hashPin,
  loginWithPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  decimal,
  deviceOrigin,
  negateDecimal,
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
import { openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";

/** What is stored feeds the calculator, whose lines and split the writer files and the regime validates. */
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

/** Records a paid €12.10 sale of one 21% line, base €10.00; a null gross stores none on it. */
async function sell(lineGross: string | null) {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({
        nodeId,
        seriesId,
        total: "12.10",
        lines: [{ ...saleInput({ nodeId, seriesId }).lines[0]!, lineGross }],
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        settlement: {
          kind: "immediate",
          tenders: [
            {
              method: "cash",
              amount: "12.10",
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

function preview(saleId: SaleId, gross: string) {
  return withTransaction(suite.db, (tx) =>
    previewCorrectionAmounts(tx, backend, saleId, nodeId, { gross: decimal(gross) }),
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
  // The filing, the stored split, the lines' [base, gross] in cents, the filed total and split.
  return [
    found.filing,
    after.sale.vatBreakdown.map(({ rate, base, tax }) => [rate, base, tax]),
    after.lines.map((line) => [line.lineTotal, line.lineGross]),
    after.registro.importe_total,
    after.registro.desglose?.map((group) => [
      group.BaseImponibleOimporteNoSujeto,
      group.CuotaRepercutida,
    ]),
  ];
}

it("files €6.05, €6.02 and €0.03 off a €12.10 dish from its history, then refuses a cent", async () => {
  const { saleId, before } = await sell("12.10");

  const rounds = [
    await correct(saleId, "6.05"),
    await correct(saleId, "6.02"),
    await correct(saleId, "0.03"),
  ];

  expect(rounds).toEqual([
    ["queued", [["21.00", "-5.00", "-1.05"]], [[-500, -605]], "-6.05", [["-5.00", "-1.05"]]],
    ["queued", [["21.00", "-4.98", "-1.04"]], [[-498, -602]], "-6.02", [["-4.98", "-1.04"]]],
    ["queued", [["21.00", "-0.02", "-0.01"]], [[-2, -3]], "-0.03", [["-0.02", "-0.01"]]],
  ]);
  expect(await captureError(() => preview(saleId, "0.01"))).toMatchObject({
    code: "sale.correction_amount_invalid",
  });
  expect(await snapshot(saleId)).toEqual(before);
});

it("refuses an invoice the agency refused, then, once its fix files it at 10%, as moved", async () => {
  // No line gross, so the history read would refuse: each refusal must come before it.
  const { saleId, before } = await sell(null);
  await suite.db
    .update(envios)
    .set({ estado: "rechazado", codigoError: "1161" })
    .where(eq(envios.registroId, before.registro.id));
  const refused = await captureError(() => preview(saleId, "1.00"));

  vi.stubEnv("WAITRON_PRODUCER_NAME", "PRODUCER PERSON");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "00000000T");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "1 Example Street, 00000 Nowhere (Province), Spain");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  registerModulePermissions(FISCAL_PERMISSIONS);
  const [admin] = await suite.db
    .insert(persons)
    .values({ displayName: "Administrator", role: "admin", pinHash: hashPin("2468") })
    .returning();
  const { token, caseId } = await withTransaction(suite.db, async (tx) => ({
    token: (await startManagementSession(tx, { personId: admin!.id })).token,
    caseId: (
      await openFilingCase(tx, {
        registroId: before.registro.id,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now: steadyClock.now().instant,
      })
    ).id,
  }));
  const app = new Hono();
  await suite.db
    .update(managementSessions)
    .set({ provedAt: new Date().toISOString() })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  mountRecordRemedies(
    app,
    {
      db: suite.db,
      recordGeneration: {
        nodeId,
        environment: "production",
        clock: steadyClock,
        requireWritable: () => {},
      },
    },
    () => {},
    new Set(["record-correction"]),
  );
  const fixed = await app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "record-correction",
      caseId,
      registroId: before.registro.id,
      actionKey: "fix-at-10",
      reason: "Filed at the wrong VAT rate",
      facts: {
        breakdown: [
          {
            ClaveRegimen: "01",
            CalificacionOperacion: "S1",
            TipoImpositivo: "10.00",
            BaseImponibleOimporteNoSujeto: "11.00",
            CuotaRepercutida: "1.10",
          },
        ],
        taxTotal: "1.10",
        total: "12.10",
      },
    }),
  });
  expect(fixed.status).toBe(200);

  expect(refused).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "filing_refused" },
  });
  expect(await captureError(() => preview(saleId, "1.00"))).toMatchObject({
    code: "sale.correction_not_admitted",
    params: { reason: "filed_figures_changed" },
  });
  expect((await snapshot(saleId)).sale).toEqual(before.sale);
});
