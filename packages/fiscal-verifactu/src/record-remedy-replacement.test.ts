import { seriesWithNextNumber } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { recordCorrection, recordSale } from "@waitron/core";
import { invoiceSeries, sales, taxpayer, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  AppError,
  decimal,
  deviceOrigin,
  jobOrigin,
  saleId as brandSaleId,
  seriesId,
} from "@waitron/shared";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { readChainHead } from "./chain.js";
import { openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { FULL_INVOICE_REPLACEMENT, type RemedyPolicy } from "./record-remedy.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { filingCaseEvents } from "./schema/filing-cases.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { seedNode, type SeededNode } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
// 13:07 in Madrid on 1 March 2026: "today" for the replacement.
const TODAY = new Date("2026-03-01T12:07:00Z");
let token: string;
let personId: string;
let node: SeededNode;
let generation: NonNullable<ModuleRouteContext["recordGeneration"]>;
let instant: Date;
let confirmed: boolean;
let correctiveId: string;
let fullCorrectiveId: string;
let body: Record<string, unknown>;
let enabledRemedies: RemedyPolicy | undefined;
const FULL_INVOICES_ON: RemedyPolicy = new Set([
  "record-correction",
  "replacement-invoice",
  FULL_INVOICE_REPLACEMENT,
]);
const CUSTOMER = { taxId: "B12345674", legalName: "Cliente SL", countryCode: "ES" };

const backend = () =>
  new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
  });

/** A simplified invoice (or, naming `customer`, a full one) AEAT refused with `codigo`, and its open case. */
async function refusedOriginal(
  at = new Date("2026-03-01T12:05:00Z"),
  {
    codigo = "1112",
    estado = "rechazado" as "rechazado" | "aceptado_con_errores",
    customer = null as typeof CUSTOMER | null,
    operationDescription = "Food and drink",
  } = {},
) {
  return withTransaction(suite.db, async (tx) => {
    let series = node.seriesId;
    if (customer !== null) {
      const [full] = await tx
        .insert(invoiceSeries)
        .values({ nodeId: node.nodeId, code: "F", purpose: "full" })
        .returning({ id: invoiceSeries.id });
      series = full!.id;
      await tx.update(taxpayer).set({ taxpayerDomicile: "8 Tax Street, 28001 Madrid" });
    }
    const original = await recordSale(
      tx,
      backend(),
      saleInput({
        nodeId: node.nodeId,
        seriesId: seriesId(series),
        ...(customer !== null && {
          counterparty: customer,
          recipientAddress: "2 Main Street, 28013 Madrid, Spain",
        }),
        origin: deviceOrigin(node.deviceId),
        operationDescription,
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
          tenders: [{ method: "cash", amount: "12.10", tipAmount: "0.00", settledAt: at }],
        },
        clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant: at }) },
      }),
    );
    await tx
      .update(verifactuSubmissions)
      .set({ estado, codigoError: codigo })
      .where(eq(verifactuSubmissions.registroId, original.fiscal.recordId));
    const filingCase = await openFilingCase(tx, {
      registroId: original.fiscal.recordId,
      cause: estado === "rechazado" ? "fiscal.registro_rechazado" : "fiscal.aceptado_con_errores",
      evidence: { codigo: Number(codigo), mensaje: null, csv: null },
      now: at,
    });
    return { saleId: original.saleId, registroId: original.fiscal.recordId, caseId: filingCase.id };
  });
}

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  instant = TODAY;
  confirmed = true;
  enabledRemedies = undefined;
  generation = {
    nodeId: node.nodeId,
    environment: "preproduction",
    clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant }) },
    requireClockConfirmed: () => {
      if (!confirmed) throw new AppError("clock.unconfirmed" as never, {} as never);
    },
    requireWritable() {},
  };
  await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    personId = person!.id;
    token = (await startManagementSession(tx, { method: "password", personId })).token;
    await setFreshManagementSignIn(tx, token);
    const [series] = await tx
      .insert(invoiceSeries)
      .values({ nodeId: node.nodeId, code: "R", purpose: "corrective" })
      .returning();
    correctiveId = series!.id;
    const [fullSeries] = await tx
      .insert(invoiceSeries)
      .values({ nodeId: node.nodeId, code: "RF", purpose: "full_corrective", nextNumber: 1 })
      .returning();
    fullCorrectiveId = fullSeries!.id;
  });
  const original = await refusedOriginal();
  body = {
    kind: "replacement-invoice",
    caseId: original.caseId,
    registroId: original.registroId,
    actionKey: "replace-1",
    reason: "AEAT refused the invoice for a future date",
    operationDate: "2026-02-28",
  };
});

function send(value: unknown = body) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    { db: suite.db, recordGeneration: generation },
    () => {},
    enabledRemedies,
  );
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
async function snapshot() {
  return {
    records: await suite.db.select().from(verifactuRecords).orderBy(verifactuRecords.secuencia),
    sales: await suite.db.select().from(sales),
    series: await suite.db.select(seriesWithNextNumber).from(invoiceSeries),
    events: await suite.db.select().from(filingCaseEvents),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}
async function refuses(value: unknown, code: string, status = 400) {
  const before = await snapshot();
  const res = await send(value);
  expect(await res.json()).toMatchObject({ error: { code } });
  expect(res.status).toBe(status);
  expect(await snapshot()).toEqual(before);
}

it("issues one R5 'S' naming the refused invoice, with the day the sale really happened, and resolves the case", async () => {
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(200);
  const result = (await res.json()) as { saleId: string; registroId: string; eventId: string };
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject({
    id: result.registroId,
    saleId: result.saleId,
    nodeId: node.nodeId,
    entorno: "preproduction",
    tipoFactura: "R5",
    tipoRectificativa: "S",
    numSerieFactura: "R/1",
    fechaExpedicionFactura: "2026-03-01",
    fechaOperacion: "2026-02-28",
    importeTotal: "12.10",
    importeRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
    descripcionOperacion: "Food and drink",
    anteriorHuella: before.records[0]!.huella,
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
  expect(after.sales.find((row) => row.id === result.saleId)).toMatchObject({
    correctsSaleId: before.sales[0]!.id,
    replacesOriginal: true,
    supplyDay: "2026-02-28",
    authorizedBy: personId,
    total: 1210,
  });
  expect(after.events).toMatchObject([
    {
      id: result.eventId,
      personId,
      caseId: body.caseId,
      kind: "resolved",
      remedyRegistroId: result.registroId,
    },
  ]);
  expect(after.head.ultimoRegistroId).toBe(result.registroId);
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});

it("copies the target's operation description byte for byte into the replacement", async () => {
  const original = await refusedOriginal(new Date("2026-03-01T12:05:00Z"), {
    operationDescription: "  Meals\tand drinks\n ",
  });
  const response = await send({
    ...body,
    caseId: original.caseId,
    registroId: original.registroId,
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { registroId: string };
  const [replacement] = await suite.db
    .select({ description: verifactuRecords.descripcionOperacion })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, result.registroId));
  expect(replacement).toEqual({ description: "  Meals\tand drinks\n " });
});

it("sends no operation date when the day given is the replacement's own day", async () => {
  const original = await refusedOriginal(new Date("2026-03-01T20:00:00Z"));
  const res = await send({
    ...body,
    caseId: original.caseId,
    registroId: original.registroId,
    operationDate: "2026-03-01",
  });
  expect(res.status).toBe(200);
  const { registroId } = (await res.json()) as { registroId: string };
  const [record] = await suite.db
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, registroId));
  expect(record).toMatchObject({ tipoRectificativa: "S", fechaOperacion: null });
});

it("names the case by its record when the body sends no caseId", async () => {
  const { caseId, ...withoutCase } = body;
  const res = await send(withoutCase);
  expect(res.status).toBe(200);
  const { eventId } = (await res.json()) as { eventId: string };
  expect(await suite.db.select().from(filingCaseEvents)).toMatchObject([{ id: eventId, caseId }]);
});

it("answers a repeat with the same action key from the saved decision", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  instant = new Date("2026-03-01T15:00:00Z");
  const before = await snapshot();
  const replay = await send();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("refuses a repeat with the same action key and a different day", async () => {
  expect((await send()).status).toBe(200);
  await refuses({ ...body, operationDate: "2026-02-27" }, "filing_case.action_mismatch", 409);
});

it.each([
  ["correction", { total: "12.10" }],
  ["total", "12.10"],
  ["lines", []],
  ["seriesId", "anything"],
])("refuses a body carrying %s", async (key, value) => {
  await refuses({ ...body, [key]: value }, "fiscal.remedy_request_invalid");
});

it.each(["registroId", "actionKey", "reason"])("requires a nonblank %s", async (key) => {
  await refuses({ ...body, [key]: " " }, "fiscal.remedy_request_invalid");
});

it("refuses a case AEAT refused with another code", async () => {
  const original = await refusedOriginal(undefined, { codigo: "1100" });
  await refuses(
    { ...body, caseId: original.caseId, registroId: original.registroId },
    "fiscal.remedy_invalid",
  );
});

it("refuses a case whose code changed since it opened", async () => {
  await suite.db
    .update(verifactuSubmissions)
    .set({ codigoError: "1100" })
    .where(eq(verifactuSubmissions.registroId, body.registroId as string));
  await refuses(body, "fiscal.remedy_invalid");
});

it("refuses a case AEAT accepted with errors", async () => {
  const original = await refusedOriginal(undefined, {
    codigo: "1112",
    estado: "aceptado_con_errores",
  });
  await refuses(
    { ...body, caseId: original.caseId, registroId: original.registroId },
    "fiscal.remedy_invalid",
  );
});

it("refuses a full invoice while full-invoice replacement is switched off, as it is by default", async () => {
  const original = await refusedOriginal(undefined, { customer: CUSTOMER });
  await refuses(
    { ...body, caseId: original.caseId, registroId: original.registroId },
    "fiscal.remedy_invalid",
  );
});

it("replaces a full invoice with an R4 'S' naming the same customer, and resolves the case", async () => {
  enabledRemedies = FULL_INVOICES_ON;
  const original = await refusedOriginal(undefined, { customer: CUSTOMER });
  const before = await snapshot();
  const res = await send({ ...body, caseId: original.caseId, registroId: original.registroId });
  expect(res.status).toBe(200);
  const result = (await res.json()) as { saleId: string; registroId: string; eventId: string };
  const after = await snapshot();
  const refused = before.records.find((row) => row.id === original.registroId)!;
  expect(refused.tipoFactura).toBe("F1");
  expect(refused.destinatarios).not.toBeNull();
  expect(after.records).toHaveLength(before.records.length + 1);
  expect(after.records.at(-1)).toMatchObject({
    id: result.registroId,
    saleId: result.saleId,
    tipoFactura: "R4",
    tipoRectificativa: "S",
    numSerieFactura: "RF/1",
    fechaExpedicionFactura: "2026-03-01",
    fechaOperacion: "2026-02-28",
    importeRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
    destinatarios: refused.destinatarios,
    anteriorHuella: before.records.at(-1)!.huella,
    facturasRectificadas: {
      IDFacturaRectificada: [
        {
          IDEmisorFactura: refused.idEmisorFactura,
          NumSerieFactura: refused.numSerieFactura,
          FechaExpedicionFactura: "01-03-2026",
        },
      ],
    },
  });
  const nextNumber = (rows: typeof before.series, id: string) =>
    rows.find((row) => row.id === id)!.nextNumber;
  expect(nextNumber(after.series, fullCorrectiveId)).toBe(
    nextNumber(before.series, fullCorrectiveId) + 1,
  );
  expect(nextNumber(after.series, correctiveId)).toBe(nextNumber(before.series, correctiveId));
  expect(after.sales.find((row) => row.id === result.saleId)).toMatchObject({
    correctsSaleId: original.saleId,
    replacesOriginal: true,
    supplyDay: "2026-02-28",
    counterpartyTaxId: CUSTOMER.taxId,
  });
  expect(after.events).toMatchObject([
    {
      id: result.eventId,
      caseId: original.caseId,
      kind: "resolved",
      remedyRegistroId: result.registroId,
    },
  ]);
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});

it("refuses a full invoice when the business has no registered address, using no number", async () => {
  enabledRemedies = FULL_INVOICES_ON;
  const original = await refusedOriginal(undefined, { customer: CUSTOMER });
  await suite.db.update(taxpayer).set({ taxpayerDomicile: " " });
  await refuses(
    { ...body, caseId: original.caseId, registroId: original.registroId },
    "fiscal.taxpayer_domicile_missing",
    409,
  );
});

it("refuses an exchanged ticket (F3) with full-invoice replacement switched on", async () => {
  enabledRemedies = FULL_INVOICES_ON;
  const ticket = await refusedOriginal(undefined, { codigo: "1100" });
  const id = brandSaleId(crypto.randomUUID());
  const exchanged = await withTransaction(suite.db, async (tx) => {
    await tx.insert(sales).values({
      id,
      source: "device",
      deviceId: node.deviceId,
      nodeId: node.nodeId,
      seriesId: node.seriesId,
      invoiceNumber: 501,
      issuedAt: "2026-03-01T12:06:00.000Z",
      issuedOffsetMinutes: 60,
      total: 1210,
      vatBreakdown: [],
      locale: "en",
      invoiceLocales: ["en"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    });
    const recorded = await backend().recordSubstitution(
      tx,
      {
        origin: deviceOrigin(node.deviceId),
        nodeId: node.nodeId,
        saleId: id,
        seriesId: seriesId(node.seriesId),
        seriesCode: "GA",
        invoiceNumber: 501,
        issuedAt: new Date("2026-03-01T12:06:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Food and drink",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty: CUSTOMER,
      },
      { substitutedSaleIds: [ticket.saleId] },
    );
    await tx
      .update(verifactuSubmissions)
      .set({ estado: "rechazado", codigoError: "1112" })
      .where(eq(verifactuSubmissions.registroId, recorded.recordId));
    const filingCase = await openFilingCase(tx, {
      registroId: recorded.recordId,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1112, mensaje: null, csv: null },
      now: TODAY,
    });
    return { registroId: recorded.recordId, caseId: filingCase.id };
  });
  const [record] = await suite.db
    .select({ tipoFactura: verifactuRecords.tipoFactura })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, exchanged.registroId));
  expect(record).toEqual({ tipoFactura: "F3" });
  await refuses({ ...body, ...exchanged }, "fiscal.remedy_invalid");
});

it("refuses while the start's time check holds", async () => {
  confirmed = false;
  await refuses(body, "clock.unconfirmed", 409);
});

it("refuses an original that already has a partial refund, using no number", async () => {
  await withTransaction(suite.db, async (tx) => {
    const [original] = await tx
      .select({ saleId: verifactuRecords.saleId })
      .from(verifactuRecords)
      .where(eq(verifactuRecords.id, body.registroId as string));
    await recordCorrection(tx, backend(), {
      origin: jobOrigin("operator_script"),
      nodeId: node.nodeId,
      seriesId: seriesId(correctiveId),
      correctsSaleId: brandSaleId(original!.saleId),
      total: "-6.05",
      operationDescription: "Refund one coffee",
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
      authz: { managementSessionId: token },
      clock: generation.clock,
    });
  });
  await refuses(body, "sale.replacement_not_first");
});

it("refuses when this node has no live corrective series", async () => {
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: TODAY })
    .where(eq(invoiceSeries.id, correctiveId));
  await refuses(body, "series.no_corrective_for_node", 409);
});

it("refuses a full invoice when this node has no live full-invoice corrective series", async () => {
  enabledRemedies = FULL_INVOICES_ON;
  const original = await refusedOriginal(undefined, { customer: CUSTOMER });
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: TODAY })
    .where(eq(invoiceSeries.id, fullCorrectiveId));
  await refuses(
    { ...body, caseId: original.caseId, registroId: original.registroId },
    "series.no_full_corrective_for_node",
    409,
  );
});

it.each([
  ["missing", undefined],
  ["not a string", 20260228],
  ["blank", ""],
  ["in another format", "28-02-2026"],
  ["with a time", "2026-02-28T00:00:00Z"],
  ["not a calendar day", "2026-02-30"],
  ["after today", "2026-03-02"],
  ["many years back", "1999-01-01"],
  ["one day more than twenty years before today", "2006-02-28"],
])("refuses an operation date %s, using no number", async (_label, operationDate) => {
  const before = await snapshot();
  const res = await send({ ...body, operationDate });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: { code: "fiscal.operation_date_invalid", params: { field: "operationDate" } },
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses an operation date after the refused invoice's own date, though not after today", async () => {
  instant = new Date("2026-03-03T12:00:00Z");
  await refuses({ ...body, operationDate: "2026-03-02" }, "fiscal.operation_date_invalid");
  // Control: the refused invoice's own date is accepted.
  const res = await send({ ...body, operationDate: "2026-03-01" });
  expect(res.status).toBe(200);
});

it("accepts an operation date exactly twenty years before today", async () => {
  const res = await send({ ...body, operationDate: "2006-03-01" });
  expect(res.status).toBe(200);
  const { registroId } = (await res.json()) as { registroId: string };
  const [record] = await suite.db
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, registroId));
  expect(record).toMatchObject({ fechaOperacion: "2006-03-01" });
});

it("measures today in the venue's zone, from the clock reading that dates the replacement", async () => {
  // 23:30 UTC on 28 February is 00:30 on 1 March in Madrid.
  instant = new Date("2026-02-28T23:30:00Z");
  const original = await refusedOriginal(new Date("2026-02-28T23:20:00Z"));
  const res = await send({
    ...body,
    caseId: original.caseId,
    registroId: original.registroId,
    operationDate: "2026-03-01",
  });
  expect(res.status).toBe(200);
});

it("chains the replacement after a refused original stamped tomorrow, the newest record in the chain", async () => {
  const tomorrow = await refusedOriginal(new Date("2026-03-02T09:00:00Z"));
  const before = await snapshot();
  expect(before.head.ultimoRegistroId).toBe(tomorrow.registroId);
  // The refused invoice's own day, which is after today.
  await refuses(
    {
      ...body,
      caseId: tomorrow.caseId,
      registroId: tomorrow.registroId,
      actionKey: "replace-tomorrow",
      operationDate: "2026-03-02",
    },
    "fiscal.operation_date_invalid",
  );
  const res = await send({
    ...body,
    caseId: tomorrow.caseId,
    registroId: tomorrow.registroId,
    actionKey: "replace-tomorrow",
  });
  expect(res.status).toBe(200);
  const { registroId } = (await res.json()) as { registroId: string };
  const after = await snapshot();
  expect(after.records).toHaveLength(before.records.length + 1);
  expect(after.records.at(-1)).toMatchObject({
    id: registroId,
    tipoFactura: "R5",
    tipoRectificativa: "S",
    fechaExpedicionFactura: "2026-03-01",
    fechaOperacion: "2026-02-28",
    anteriorHuella: before.records.at(-1)!.huella,
    facturasRectificadas: {
      IDFacturaRectificada: [expect.objectContaining({ FechaExpedicionFactura: "02-03-2026" })],
    },
  });
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});
