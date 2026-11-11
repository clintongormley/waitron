import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordSale } from "@waitron/core";
import {
  invoiceSeries,
  saleLines,
  sales,
  saleSettlements,
  tenders,
  tenderRefunds,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError, deviceOrigin, seriesId } from "@waitron/shared";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { readChainHead } from "./chain.js";
import { openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedNode, type SeededNode } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-03-01T12:07:00Z");
let token: string;
let personId: string;
let node: SeededNode;
let generation: NonNullable<ModuleRouteContext["recordGeneration"]>;
let instant: Date;
let writable: boolean;
let trading: boolean;
let correction: {
  seriesId: string;
  total: string;
  operationDescription: string;
  wholeInvoice?: boolean;
  lines: {
    lineNo: number;
    name: string;
    descriptions: Record<string, string>;
    quantity: string;
    unitPrice: string;
    vatRate: string;
    lineTotal: string;
    lineGross?: string | null;
    productId?: string | null;
    correctsLineId?: string | null;
  }[];
};
let body: Record<string, unknown>;

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  instant = NOW;
  writable = true;
  trading = true;
  generation = {
    nodeId: node.nodeId,
    environment: "preproduction",
    clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant, offsetMinutes: -300 }) },
    requireWritable() {
      if (!writable) throw new AppError("node.read_only", {});
      if (!trading) throw new AppError("venue.time_zone_not_ready", { reason: "restart_required" });
    },
  };
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
    resolveClient: () => {
      throw new Error("A local correction must not contact AEAT");
    },
  });
  await withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Administrator",
        role: "admin",
        pinHash: hashPin("2468"),
      })
      .returning();
    personId = person!.id;
    token = (await startManagementSession(tx, { personId })).token;
    await setFreshManagementSignIn(tx, token);
    const original = await recordSale(
      tx,
      backend,
      saleInput({
        nodeId: node.nodeId,
        seriesId: seriesId(node.seriesId),
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
    correction = {
      seriesId: series!.id,
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
    };
    body = {
      kind: "corrective-invoice",
      caseId: filingCase.id,
      registroId: original.fiscal.recordId,
      actionKey: "http-corrective-1",
      reason: "Explicit synthetic factual correction",
      correction,
    };
  });
});

function send(value: unknown = body, enabled = true, runtime = true) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    { db: suite.db, recordGeneration: runtime ? generation : undefined },
    () => {},
    new Set(enabled ? ["corrective-invoice"] : []),
  );
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
async function snapshot() {
  return {
    records: await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia),
    sales: await suite.db.select().from(sales),
    lines: await suite.db.select().from(saleLines),
    series: await suite.db.select().from(invoiceSeries),
    events: await suite.db.select().from(filingCaseEvents),
    deliveries: await suite.db.select().from(envios),
    tenders: await suite.db.select().from(tenders),
    refunds: await suite.db.select().from(tenderRefunds),
    settlements: await suite.db.select().from(saleSettlements),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}
async function refuses(value: unknown, code = "fiscal.remedy_request_invalid", status = 400) {
  const before = await snapshot();
  const res = await send(value);
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ error: { code } });
  expect(await snapshot()).toEqual(before);
}

it("creates one R5 through HTTP with host generation and operator origin, keeping the original accounting and payments", async () => {
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const result = (await res.json()) as { saleId: string; registroId: string; eventId: string };
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject({
    id: result.registroId,
    saleId: result.saleId,
    source: "operator_script",
    deviceId: null,
    nodeId: node.nodeId,
    entorno: "preproduction",
    tipoFactura: "R5",
    tipoRectificativa: "I",
    numSerieFactura: "R/1",
    importeTotal: "-6.05",
    cuotaTotal: "-1.05",
    descripcionOperacion: "Correct one item",
    fechaHoraHusoGenRegistro: NOW,
    offsetMinutos: 60,
    anteriorHuella: before.records[0]!.huella,
    correctsRegistroId: null,
    facturasRectificadas: {
      IDFacturaRectificada: [
        {
          IDEmisorFactura: before.records[0]!.idEmisorFactura,
          NumSerieFactura: "GA/1",
          FechaExpedicionFactura: "01-03-2026",
        },
      ],
    },
  });
  expect(after.sales.filter((row) => row.id !== result.saleId)).toEqual(before.sales);
  expect(after.sales.find((row) => row.id === result.saleId)).toMatchObject({
    correctsSaleId: before.sales[0]!.id,
    total: -605,
    authorizedBy: personId,
    source: "operator_script",
    deviceId: null,
    issuedAt: "2026-03-01T12:07:00.000Z",
    issuedOffsetMinutes: 60,
    locale: "en",
    invoiceLocales: ["en"],
    invoiceNumber: 1,
  });
  expect(after.lines.filter((row) => row.saleId !== result.saleId)).toEqual(before.lines);
  expect(after.lines.find((row) => row.saleId === result.saleId)).toMatchObject({
    quantity: -1000,
    lineTotal: -500,
    vatRate: 2100,
    descriptions: { en: "Coffee" },
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
  expect(after.deliveries.filter((row) => row.registroId !== result.registroId)).toEqual(
    before.deliveries,
  );
  expect(after.deliveries.find((row) => row.registroId === result.registroId)).toMatchObject({
    estado: "pendiente",
  });
  expect(after.tenders).toEqual(before.tenders);
  expect(after.refunds).toEqual(before.refunds);
  expect(after.settlements).toEqual(before.settlements);
  expect(after.series.find((row) => row.id === correction.seriesId)?.nextNumber).toBe(2);
  expect(after.head.ultimoRegistroId).toBe(result.registroId);
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});

it("replays the saved HTTP decision after clock, outcome and JSON key order change", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  instant = new Date("2026-03-01T15:00:00Z");
  await suite.db
    .update(envios)
    .set({ estado: "aceptado" })
    .where(eq(envios.registroId, body.registroId as string));
  const reordered = JSON.parse(
    JSON.stringify(body, (_key, value: unknown) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  ) as unknown;
  const before = await snapshot();
  const replay = await send(reordered);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});
it("serializes simultaneous HTTP retries into one invoice and case decision", async () => {
  const replies = await Promise.all([send(), send()]);
  expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
  expect(await replies[0]!.json()).toEqual(await replies[1]!.json());
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.sales).toHaveLength(2);
  expect(after.events).toHaveLength(1);
  expect(after.refunds).toEqual([]);
});
it("refuses changed facts under a saved action key without another invoice", async () => {
  expect((await send()).status).toBe(200);
  correction.operationDescription = "Another correction";
  await refuses(body, "filing_case.action_mismatch", 409);
});
it("credits the whole original using its stored line and exact VAT", async () => {
  const [line] = await suite.db.select().from(saleLines);
  correction.wholeInvoice = true;
  correction.total = "-12.10";
  correction.lines[0] = {
    ...correction.lines[0]!,
    correctsLineId: line!.id,
    productId: null,
    quantity: "-2",
    lineTotal: "-10.00",
    lineGross: "-12.10",
  };
  const res = await send();
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records[1]).toMatchObject({ importeTotal: "-12.10", cuotaTotal: "-2.10" });
  expect(after.lines[1]).toMatchObject({
    correctsLineId: line!.id,
    productId: null,
    quantity: -2000,
    lineTotal: -1000,
    lineGross: -1210,
  });
});
it("preserves a fractional delta and a second-language line snapshot", async () => {
  correction.total = "-6.05";
  correction.lines[0] = {
    ...correction.lines[0]!,
    quantity: "-0.5",
    unitPrice: "10.00",
    descriptions: { en: "Coffee", es: "Coffee translated" },
    productId: "coffee-product",
    correctsLineId: null,
    lineGross: null,
  };
  const res = await send();
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.lines[1]).toMatchObject({
    quantity: -500,
    unitPrice: 1000,
    lineGross: null,
    descriptions: { en: "Coffee", es: "Coffee translated" },
    productId: "coffee-product",
  });
});
it("keeps the core total guard for a base past the cent and rolls every attempted write back", async () => {
  correction.total = "-5.00";
  correction.lines[0]!.lineTotal = "-5.001";
  await refuses(body, "sale.total_mismatch");
});
it("keeps the core original-line guard", async () => {
  correction.lines[0]!.correctsLineId = "another-invoice-line";
  await refuses(body, "sale.correction_line_not_on_invoice");
});
it("keeps the core whole-invoice reversal guard", async () => {
  correction.wholeInvoice = true;
  await refuses(body, "sale.correction_not_whole");
});
it("keeps the core series-purpose guard", async () => {
  correction.seriesId = node.seriesId;
  await refuses(body, "sale.series_wrong_purpose");
});
it.each([false, true])("rechecks live authority and policy on replay=%s", async (replay) => {
  if (replay) expect((await send()).status).toBe(200);
  const before = await snapshot();
  const disabled = await send(body, false);
  expect(disabled.status).toBe(409);
  expect(await disabled.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
  writable = false;
  await refuses(body, "node.read_only", 409);
  writable = true;
  trading = false;
  await refuses(body, "venue.time_zone_not_ready", 409);
  trading = true;
  await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, personId));
  await refuses(body, "authorization.not_permitted", 403);
  expect(await snapshot()).toEqual(before);
});
it("requires trusted runtime even with an explicitly enabled synthetic policy", async () => {
  const before = await snapshot();
  const res = await send(body, true, false);
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
  expect(await snapshot()).toEqual(before);
});
it("keeps the default production policy closed with a complete runtime and request", async () => {
  const before = await snapshot();
  const app = new Hono();
  mountRecordRemedies(app, { db: suite.db, recordGeneration: generation }, () => {});
  const res = await app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: { code: "fiscal.remedy_disabled", params: { kind: "corrective-invoice" } },
  });
  expect(await snapshot()).toEqual(before);
});
it("refuses a new corrective record when the host clock is behind the chain", async () => {
  instant = new Date("2026-03-01T12:00:00Z");
  await refuses(body, "clock.behind_chain", 409);
});
it.each(["nodeId", "environment", "clock", "origin", "operatorId", "enabledRemedies", "pending"])(
  "refuses client-owned %s at the request boundary",
  async (key) => {
    await refuses({ ...body, [key]: "claimed" });
  },
);
it.each(["nodeId", "correctsSaleId", "clock", "authz", "origin", "unknown"])(
  "refuses client-owned correction field %s",
  async (key) => {
    await refuses({ ...body, correction: { ...correction, [key]: "claimed" } });
  },
);
it.each(["caseId", "registroId", "actionKey", "reason"])("requires nonblank %s", async (key) => {
  await refuses({ ...body, [key]: " " });
});
it.each([null, [], "correction", {}])("refuses malformed correction %j", async (value) => {
  await refuses({ ...body, correction: value });
});
it.each([null, "", "- 1", "NaN", "1e2", 12.1])("refuses malformed total %j", async (value) => {
  await refuses({ ...body, correction: { ...correction, total: value } });
});
it.each([null, "true", 1])("refuses nonboolean wholeInvoice %j", async (wholeInvoice) => {
  await refuses({ ...body, correction: { ...correction, wholeInvoice } });
});
it.each([null, [], {}, [null]])("refuses malformed or empty lines %j", async (lines) => {
  await refuses({ ...body, correction: { ...correction, lines } });
});
it.each([
  { lineNo: 0 },
  { lineNo: 1.5 },
  { lineNo: "1" },
  { lineNo: 9007199254740992 },
  { name: " " },
  { descriptions: null },
  { descriptions: [] },
  { descriptions: { en: 7 } },
  { descriptions: { " ": "Coffee" } },
  { quantity: null },
  { quantity: "NaN" },
  { unitPrice: 5 },
  { vatRate: [] },
  { lineTotal: "no" },
  { lineGross: 1 },
  { productId: [] },
  { correctsLineId: 1 },
  { unsupported: true },
])("refuses malformed line fields %j", async (patch) => {
  await refuses({
    ...body,
    correction: { ...correction, lines: [{ ...correction.lines[0], ...patch }] },
  });
});

it("refuses duplicate line numbers with a domain error before writing", async () => {
  correction.lines.push({ ...correction.lines[0]! });
  await refuses(body);
});
it("accepts distinct line numbers while preserving both line snapshots", async () => {
  correction.lines = [1, 2].map((lineNo) => ({
    ...correction.lines[0]!,
    lineNo,
    quantity: "-0.5",
    lineTotal: "-2.50",
  }));
  const res = await send();
  expect(res.status).toBe(200);
  const result = (await res.json()) as { saleId: string };
  expect((await snapshot()).lines.filter((row) => row.saleId === result.saleId)).toMatchObject([
    { lineNo: 1, quantity: -500, lineTotal: -250 },
    { lineNo: 2, quantity: -500, lineTotal: -250 },
  ]);
});
it("replays omitted wholeInvoice as false without another number", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  const before = await snapshot();
  correction.wholeInvoice = false;
  const replay = await send();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});
it.each(["seriesId", "operationDescription"])("requires a nonblank correction %s", async (key) => {
  await refuses({ ...body, correction: { ...correction, [key]: " " } });
});
async function productionOriginal() {
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    environment: "production",
    deploymentEnvironment: "production",
    resolveClient: () => {
      throw new Error("This test must not contact AEAT");
    },
  });
  await withTransaction(suite.db, async (tx) => {
    const original = await recordSale(
      tx,
      backend,
      saleInput({
        nodeId: node.nodeId,
        seriesId: seriesId(node.seriesId),
        origin: deviceOrigin(node.deviceId),
        operationDescription: "Another invoice",
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
        settlement: { kind: "deferred" },
      }),
    );
    await tx
      .update(envios)
      .set({ estado: "rechazado", codigoError: "1161" })
      .where(eq(envios.registroId, original.fiscal.recordId));
    const filingCase = await openFilingCase(tx, {
      registroId: original.fiscal.recordId,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    body.registroId = original.fiscal.recordId;
    body.caseId = filingCase.id;
  });
}

it("binds a production-host synthetic correction to production records", async () => {
  vi.stubEnv("WAITRON_PRODUCER_NAME", "PRODUCER PERSON");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "00000000T");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "1 Example Street, 00000 Nowhere (Province), Spain");
  await productionOriginal();
  generation.environment = "production";
  const res = await send();
  expect(res.status).toBe(200);
  const result = (await res.json()) as { saleId: string; registroId: string };
  const after = await snapshot();
  expect(after.records.find((row) => row.id === result.registroId)).toMatchObject({
    entorno: "production",
  });
  expect(after.sales.find((row) => row.id === result.saleId)).toMatchObject({
    fiscalBackend: "verifactu",
    total: -605,
    correctsSaleId: after.records[1]!.saleId,
  });
});

it("names the producer from the settings in the corrective invoice's software block, keeping the taxpayer as issuer", async () => {
  vi.stubEnv("WAITRON_PRODUCER_NAME", "PRODUCER PERSON");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "00000000T");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "1 Example Street, 00000 Nowhere (Province), Spain");
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records[1]!.sistemaInformatico).toMatchObject({
    NombreRazon: "PRODUCER PERSON",
    NIF: "00000000T",
  });
  expect(after.records[1]!.nombreRazonEmisor).toBe(before.records[0]!.nombreRazonEmisor);
  expect(after.records[1]!.idEmisorFactura).toBe(before.records[0]!.idEmisorFactura);
});

it("refuses a production corrective invoice while no producer is set, writing nothing", async () => {
  vi.stubEnv("WAITRON_PRODUCER_NAME", "");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "");
  await productionOriginal();
  generation.environment = "production";
  const before = await snapshot();
  const res = await send();
  expect(await res.json()).toMatchObject({ error: { code: "sif.producer_unset" } });
  expect(await snapshot()).toEqual(before);
});
