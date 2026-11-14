import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { recordSale, type RecordCorrectionInput } from "@waitron/core";
import {
  invoiceSeries,
  saleLines,
  saleSettlements,
  sales,
  tenderRefunds,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import {
  AppError,
  deviceOrigin,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { VerifactuBackend } from "./backend.js";
import { readChainHead } from "./chain.js";
import { openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import * as remedies from "./record-remedy.js";
import { applyCorrectedRecordFacts } from "./record-remedy-http.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents, type FilingCaseCause } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedNode, type SeededNode } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-03-01T12:07:00Z");
type Request = {
  caseId: string;
  registroId: string;
  actionKey: string;
  reason: string;
  correction: Omit<RecordCorrectionInput, "nodeId" | "correctsSaleId" | "clock" | "authz">;
};
type Input = {
  managementSessionId: string;
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>;
  enabledRemedies: ReadonlySet<remedies.RemedyKind>;
  backend: VerifactuBackend;
  request: Request;
};
type Result = { saleId: string; registroId: string; eventId: string };
let node: SeededNode;
let personId: string;
let input: Input;
let writable: boolean;
let instant: Date;

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  writable = true;
  instant = NOW;
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "preproduction",
    resolveClient: staticResolver(fakeClient),
  });
  await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    personId = person!.id;
    const token = (await startManagementSession(tx, { personId })).token;
    const original = await recordSale(
      tx,
      backend,
      saleInput({
        nodeId: node.nodeId,
        seriesId: brandSeriesId(node.seriesId),
        origin: deviceOrigin(node.deviceId),
        operationDescription: "Food and drink",
        locale: "en",
        invoiceLocales: ["en"],
        total: "12.10",
        lines: [
          {
            lineNo: 1,
            name: "Coffee",
            descriptions: { en: "Coffee" },
            quantity: "2",
            unitPrice: "5.00",
            vatRate: "21.00",
            lineTotal: "10.00",
          },
        ],
        settlement: {
          kind: "immediate",
          tenders: [
            {
              method: "cash",
              amount: "12.10",
              tipAmount: "0.00",
              settledAt: steadyClock.now().instant,
            },
          ],
        },
      }),
    );
    await tx
      .update(envios)
      .set({ estado: "aceptado_con_errores", codigoError: "2000" })
      .where(eq(envios.registroId, original.fiscal.recordId));
    const filingCase = await openFilingCase(tx, {
      registroId: original.fiscal.recordId,
      cause: "fiscal.aceptado_con_errores",
      evidence: { codigo: 2000, mensaje: null, csv: null },
      now: NOW,
    });
    const [series] = await tx
      .insert(invoiceSeries)
      .values({ nodeId: node.nodeId, code: "R", purpose: "rectificative", nextNumber: 1 })
      .returning();
    input = {
      managementSessionId: token,
      backend,
      enabledRemedies: new Set(["corrective-invoice"]),
      generation: {
        nodeId: node.nodeId,
        environment: "preproduction",
        clock: {
          ...steadyClock,
          now: () => ({ ...steadyClock.now(), instant, offsetMinutes: -300 }),
        },
        requireWritable: () => {
          if (!writable) throw new AppError("node.read_only", {});
        },
      },
      request: {
        caseId: filingCase.id,
        registroId: original.fiscal.recordId,
        actionKey: "corrective-1",
        reason: "Explicit synthetic factual invoice correction",
        correction: {
          origin: deviceOrigin(node.deviceId),
          seriesId: brandSeriesId(series!.id),
          total: "-6.05",
          operationDescription: "Correct one item",
          lines: [
            {
              lineNo: 1,
              name: "Coffee",
              descriptions: { en: "Coffee" },
              quantity: "-1",
              unitPrice: "5.00",
              vatRate: "21.00",
              lineTotal: "-5.00",
            },
          ],
        },
      },
    };
  });
});

async function apply(value = input): Promise<Result> {
  return withTransaction(suite.db, (tx) => remedies.applyCorrectiveInvoice(tx, value));
}
async function snapshot() {
  return {
    records: await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia),
    sales: await suite.db.select().from(sales),
    lines: await suite.db.select().from(saleLines),
    tenders: await suite.db.select().from(tenders),
    refunds: await suite.db.select().from(tenderRefunds),
    settlements: await suite.db.select().from(saleSettlements),
    series: await suite.db.select().from(invoiceSeries),
    events: await suite.db.select().from(filingCaseEvents),
    deliveries: await suite.db.select().from(envios),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}
async function refuses(code: string, value = input) {
  const before = await snapshot();
  await expect(apply(value)).rejects.toMatchObject({ code });
  expect(await snapshot()).toEqual(before);
}

async function anotherInvoice(
  estado = "aceptado_con_errores",
  cause?: FilingCaseCause,
  evidenceCode?: number | null,
) {
  return withTransaction(suite.db, async (tx) => {
    const original = await recordSale(
      tx,
      input.backend,
      saleInput({
        nodeId: node.nodeId,
        seriesId: brandSeriesId(node.seriesId),
        origin: deviceOrigin(node.deviceId),
        operationDescription: "Food and drink",
        locale: "en",
        invoiceLocales: ["en"],
        total: "12.10",
        lines: [
          {
            lineNo: 1,
            name: "Coffee",
            descriptions: { en: "Coffee" },
            quantity: "2",
            unitPrice: "5.00",
            vatRate: "21.00",
            lineTotal: "10.00",
          },
        ],
        settlement: {
          kind: "immediate",
          tenders: [{ method: "cash", amount: "12.10", tipAmount: "0.00", settledAt: NOW }],
        },
        clock: {
          ...steadyClock,
          now: () => ({ ...steadyClock.now(), instant: new Date("2026-03-01T12:06:00Z") }),
        },
      }),
    );
    const codigo = cause === "fiscal.registro_rechazado" ? 1161 : cause === undefined ? 2000 : 3000;
    await tx
      .update(envios)
      .set({ estado, codigoError: String(codigo) })
      .where(eq(envios.registroId, original.fiscal.recordId));
    const filingCase =
      cause === undefined
        ? undefined
        : await openFilingCase(tx, {
            registroId: original.fiscal.recordId,
            cause,
            evidence: {
              codigo: evidenceCode === undefined ? codigo : evidenceCode,
              mensaje: null,
              csv: null,
            },
            now: NOW,
          });
    return { registroId: original.fiscal.recordId, caseId: filingCase?.id };
  });
}

// Removing the core correction write must remove both its invoice and fiscal record.
it("creates an independently numbered corrective invoice and its case event without changing the original or refunding", async () => {
  await anotherInvoice();
  const before = await snapshot();
  const result = await apply();
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records).toHaveLength(3);
  expect(after.records[2]).toMatchObject({
    id: result.registroId,
    saleId: result.saleId,
    nodeId: node.nodeId,
    entorno: "preproduction",
    source: "device",
    deviceId: node.deviceId,
    tipoFactura: "R5",
    tipoRectificativa: "I",
    numSerieFactura: "R/1",
    fechaExpedicionFactura: "2026-03-01",
    correctsRegistroId: null,
    subsanacion: null,
    rechazoPrevio: null,
    importeTotal: "-6.05",
    cuotaTotal: "-1.05",
    secuencia: 3,
    anteriorHuella: before.records[1]!.huella,
    fechaHoraHusoGenRegistro: NOW,
    offsetMinutos: 60,
    facturasRectificadas: {
      IDFacturaRectificada: [
        {
          IDEmisorFactura: before.records[0]!.idEmisorFactura,
          NumSerieFactura: before.records[0]!.numSerieFactura,
          FechaExpedicionFactura: "01-03-2026",
        },
      ],
    },
  });
  expect(after.sales.filter((row) => row.id !== result.saleId)).toEqual(before.sales);
  expect(after.sales.find((row) => row.id === result.saleId)).toMatchObject({
    correctsSaleId: before.sales[0]!.id,
    total: -605,
    invoiceNumber: 1,
    authorizedBy: personId,
    locale: "en",
    invoiceLocales: ["en"],
    issuedOffsetMinutes: 60,
  });
  expect(after.lines.filter((row) => row.saleId !== result.saleId)).toEqual(before.lines);
  expect(after.lines.find((row) => row.saleId === result.saleId)).toMatchObject({
    lineTotal: -500,
    quantity: -1000,
  });
  expect(after.tenders).toEqual(before.tenders);
  expect(after.refunds).toEqual(before.refunds);
  expect(after.settlements).toEqual(before.settlements);
  expect(after.deliveries.filter((row) => row.registroId !== result.registroId)).toEqual(
    before.deliveries,
  );
  expect(after.deliveries.find((row) => row.registroId === result.registroId)).toMatchObject({
    estado: "pendiente",
    intentos: 0,
  });
  expect(after.series.find((row) => row.id === input.request.correction.seriesId)?.nextNumber).toBe(
    2,
  );
  expect(after.head.ultimoRegistroId).toBe(result.registroId);
  expect(after.events).toMatchObject([
    {
      id: result.eventId,
      caseId: input.request.caseId,
      personId,
      kind: "resolved",
      remedyRegistroId: result.registroId,
    },
  ]);
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});

it("replays a reordered decision after the clock and delivery change without a second invoice, number or refund", async () => {
  const first = await apply();
  instant = new Date("2026-03-01T15:00:00Z");
  await suite.db
    .update(envios)
    .set({ estado: "aceptado" })
    .where(eq(envios.registroId, input.request.registroId));
  const before = await snapshot();
  const reordered = JSON.parse(
    JSON.stringify(input.request, (_key, value: unknown) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  ) as Request;
  expect(await apply({ ...input, request: reordered })).toEqual(first);
  expect(await snapshot()).toEqual(before);
});
it("serializes simultaneous retries into one invoice and one resolution", async () => {
  const results = await Promise.all([apply(), apply()]);
  expect(results[0]).toEqual(results[1]);
  const after = await snapshot();
  expect(after.sales).toHaveLength(2);
  expect(after.records).toHaveLength(2);
  expect(after.events).toHaveLength(1);
});
it.each(["reason", "total", "line", "series"])(
  "refuses a changed %s under a saved key",
  async (field) => {
    await apply();
    if (field === "reason") input.request.reason = "Another reason";
    if (field === "total") input.request.correction.total = "-12.10";
    if (field === "line") input.request.correction.lines[0]!.name = "Another item";
    if (field === "series") input.request.correction.seriesId = brandSeriesId(node.seriesId);
    await refuses("filing_case.action_mismatch");
  },
);
it.each(["detenido", "pendiente", "enviando", "retenido", "aceptado"] as const)(
  "refuses ambiguous or nonmatching outcome %s",
  async (estado) => {
    await suite.db
      .update(envios)
      .set({ estado })
      .where(eq(envios.registroId, input.request.registroId));
    await refuses("fiscal.remedy_invalid");
  },
);
it("supports an explicit non-conflicting rejection with matching evidence", async () => {
  const other = await anotherInvoice("rechazado", "fiscal.registro_rechazado");
  input.request.registroId = other.registroId;
  input.request.caseId = other.caseId!;
  const result = await apply();
  expect(result.saleId).toBeTypeOf("string");
});
it.each([
  "fiscal.huella_divergente",
  "fiscal.duplicado_anulado",
  "fiscal.anulacion_retenida",
] as FilingCaseCause[])("refuses conflict or unsuitable case %s", async (cause) => {
  const other = await anotherInvoice("rechazado", cause);
  input.request.registroId = other.registroId;
  input.request.caseId = other.caseId!;
  await refuses("fiscal.remedy_invalid");
});
it("refuses another record's case even with the same totals", async () => {
  const other = await anotherInvoice();
  input.request.registroId = other.registroId;
  await refuses("fiscal.remedy_invalid");
});
it.each([false, true])("keeps the enabled policy effective on replay=%s", async (replay) => {
  if (replay) await apply();
  input.enabledRemedies = new Set(["record-correction"]);
  await refuses("fiscal.remedy_disabled");
});
it.each([false, true])("checks writable host on replay=%s", async (replay) => {
  if (replay) await apply();
  writable = false;
  await refuses("node.read_only");
});
it.each([false, true])("checks environment on replay=%s", async (replay) => {
  if (replay) await apply();
  input.generation.environment = "production";
  await refuses("fiscal.remedy_invalid");
});
it.each([false, true])("checks management permission on replay=%s", async (replay) => {
  if (replay) await apply();
  await setBuiltInRoleForTest(suite.db, personId, "manager");
  await refuses("authorization.not_permitted");
});
it.each([false, true])("requires the live management session on replay=%s", async (replay) => {
  if (replay) await apply();
  input.managementSessionId = "missing-token";
  await refuses("management_session.required");
});
it("rolls back a second decision after an existing resolution, including number allocation", async () => {
  await apply();
  input.request.actionKey = "second-decision";
  await refuses("filing_case.already_resolved");
});
it("retains core below-zero accounting refusal without burning a number", async () => {
  input.request.correction.total = "-18.15";
  input.request.correction.lines[0]!.quantity = "-3";
  input.request.correction.lines[0]!.lineTotal = "-15.00";
  await refuses("sale.correction_exceeds_total");
});

// Removing any admission below must turn a refusal into a write or a different domain refusal.
it.each(["caseId", "registroId", "actionKey", "reason"] as const)(
  "refuses an empty %s",
  async (key) => {
    input.request[key] = " ";
    await refuses("fiscal.remedy_request_invalid");
  },
);
it.each([false, true])("checks node ownership on replay=%s", async (replay) => {
  if (replay) await apply();
  input.generation.nodeId = brandNodeId("00000000-0000-4000-8000-000000000001");
  await refuses("fiscal.remedy_invalid");
});
it("refuses a missing target", async () => {
  input.request.registroId = "missing-record";
  await refuses("fiscal.remedy_invalid");
});
it("refuses a missing case", async () => {
  input.request.caseId = "missing-case";
  await refuses("fiscal.remedy_invalid");
});
it("refuses a missing delivery", async () => {
  await suite.db.delete(envios).where(eq(envios.registroId, input.request.registroId));
  await refuses("fiscal.remedy_invalid");
});
it.each([null, "3000", "different-code"])(
  "refuses missing or conflicting stored error %s",
  async (codigoError) => {
    await suite.db
      .update(envios)
      .set({ codigoError })
      .where(eq(envios.registroId, input.request.registroId));
    await refuses("fiscal.remedy_invalid");
  },
);
it.each([null, 1161])("refuses absent or mismatching case evidence %s", async (code) => {
  const other = await anotherInvoice("aceptado_con_errores", "fiscal.aceptado_con_errores", code);
  input.request.registroId = other.registroId;
  input.request.caseId = other.caseId!;
  await refuses("fiscal.remedy_invalid");
});
it("refuses a superseded version without selecting another record automatically", async () => {
  await withTransaction(suite.db, (tx) =>
    applyCorrectedRecordFacts(
      tx,
      input.generation,
      input.managementSessionId,
      new Set(["record-correction"]),
      {
        kind: "record-correction",
        caseId: input.request.caseId,
        registroId: input.request.registroId,
        actionKey: "record-version",
        reason: "Synthetic record amendment",
        priorOutcome: "accepted-with-errors",
        facts: { description: "Updated invoice facts" },
      },
    ),
  );
  await refuses("fiscal.remedy_invalid");
});
it.each([false, true])(
  "refuses an already generated cancellation as target=%s",
  async (asTarget) => {
    const [original] = await suite.db.select().from(sales);
    const cancellation = await withTransaction(suite.db, (tx) =>
      input.backend.recordVoid(
        tx,
        original!.id as Parameters<VerifactuBackend["recordVoid"]>[1],
        "Synthetic cancellation",
        brandNodeId(original!.nodeId),
      ),
    );
    if (asTarget) input.request.registroId = cancellation.recordId;
    await refuses("fiscal.remedy_invalid");
  },
);
it("refuses a saved note using the same action key", async () => {
  await withTransaction(suite.db, (tx) =>
    recordCaseEvent(tx, {
      caseId: input.request.caseId,
      actionKey: input.request.actionKey,
      kind: "note",
      personId,
      action: "Existing note",
      now: NOW,
    }),
  );
  await refuses("filing_case.action_mismatch");
});
it("refuses a saved resolution without a remedy record", async () => {
  await withTransaction(suite.db, (tx) =>
    recordCaseEvent(tx, {
      caseId: input.request.caseId,
      actionKey: input.request.actionKey,
      kind: "resolved",
      personId,
      action: "Existing resolution",
      now: NOW,
    }),
  );
  await refuses("filing_case.action_mismatch");
});
it("rolls back accounting and numbering when the backend stamps the wrong environment", async () => {
  input.backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "production",
    resolveClient: staticResolver(fakeClient),
  });
  await refuses("fiscal.remedy_invalid");
});

it("refuses a duplicate-conflict code even when the case evidence matches it", async () => {
  const other = await anotherInvoice("rechazado", "fiscal.registro_rechazado", 3000);
  input.request.registroId = other.registroId;
  input.request.caseId = other.caseId!;
  await suite.db
    .update(envios)
    .set({ codigoError: "3000" })
    .where(eq(envios.registroId, other.registroId));
  await refuses("fiscal.remedy_invalid");
});
it("refuses a saved decision replayed by a different administrator", async () => {
  await apply();
  const [person] = await seedPersons(suite.db, {
    displayName: "Another administrator",
    role: "admin",
    pinHash: hashPin("2468"),
  });
  input.managementSessionId = (
    await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId: person!.id }))
  ).token;
  await refuses("filing_case.action_mismatch");
});
it.each([undefined, false])(
  "replays an omitted optional flag as its non-whole value %s",
  async (wholeInvoice) => {
    const first = await apply();
    input.request.correction.wholeInvoice = wholeInvoice;
    const before = await snapshot();
    await expect(apply()).resolves.toEqual(first);
    expect(await snapshot()).toEqual(before);
  },
);

it("replays an omitted optional line value when the caller supplies undefined", async () => {
  const first = await apply();
  input.request.correction.lines[0]!.correctsLineId = undefined;
  const before = await snapshot();
  await expect(apply()).resolves.toEqual(first);
  expect(await snapshot()).toEqual(before);
});

async function takeOverWithCorrectiveSeries(): Promise<SeededNode> {
  const successor = await seedNode(suite.db, "B");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: successor.nodeId, code: "RB", purpose: "rectificative", nextNumber: 1 })
    .returning();
  input.request.correction.seriesId = brandSeriesId(series!.id);
  return successor;
}

it("a refused record of the box this one took over from can be remedied here", async () => {
  const successor = await takeOverWithCorrectiveSeries();
  input.generation.nodeId = successor.nodeId;
  const before = await snapshot();

  const result = await apply();

  const [appended] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, result.registroId));
  expect(appended).toMatchObject({
    nodeId: successor.nodeId,
    sifId: successor.sifId,
    facturasRectificadas: {
      IDFacturaRectificada: [
        {
          IDEmisorFactura: before.records[0]!.idEmisorFactura,
          NumSerieFactura: before.records[0]!.numSerieFactura,
          FechaExpedicionFactura: "01-03-2026",
        },
      ],
    },
  });
  const [correctiveSale] = await suite.db.select().from(sales).where(eq(sales.id, result.saleId));
  expect(correctiveSale).toMatchObject({ correctsSaleId: before.sales[0]!.id });
  expect((await snapshot()).head).toEqual(before.head);
});

it("a record of an unrelated box is still refused", async () => {
  await takeOverWithCorrectiveSeries();
  const unrelated = await seedNode(suite.db, "C");
  input.generation.nodeId = unrelated.nodeId;
  await refuses("fiscal.remedy_invalid");
});
