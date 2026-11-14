import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { DetalleDesgloseInput } from "@waitron/verifactu";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain, readChainHead } from "./chain.js";
import { listFilingCases, openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";
import { steadyClock } from "../test/write-path-fixtures.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-20T17:20:35Z");
let node: SeededNode;
let token: string;
let body: Record<string, unknown>;
let instant: Date;
const recipient = { NombreRazon: "Corrected Customer", NIF: "B12345674" };
const breakdown = [
  {
    Impuesto: "01",
    ClaveRegimen: "01",
    CalificacionOperacion: "S1",
    TipoImpositivo: "10.00",
    BaseImponibleOimporteNoSujeto: "200.00",
    CuotaRepercutida: "20.00",
  },
];
const reference = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "PRIOR/1",
  FechaExpedicionFactura: "2026-07-19",
};
/** The reference `targetRefusedOfType`'s R5 corrects and F3 replaces, as a request states it. */
const ownReference = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "PRIOR/0",
  FechaExpedicionFactura: "2026-07-18",
};

beforeEach(async () => {
  instant = NOW;
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  const saleId = await seedSale(suite.db, node, 1);
  await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    token = (await startManagementSession(tx, { personId: person!.id })).token;
    await setFreshManagementSignIn(tx, token);
    const original = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, saleId, 1, 1, "preproduction"),
    );
    await tx
      .insert(envios)
      .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: original.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    body = {
      kind: "record-correction",
      caseId: filingCase.id,
      registroId: original.id,
      actionKey: "correct-facts",
      reason: "Correct the stored record facts",
    };
  });
});

function send(facts: unknown, enabled = true) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    {
      db: suite.db,
      recordGeneration: {
        nodeId: node.nodeId,
        environment: "preproduction",
        clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant }) },
        requireClockConfirmed: () => {},
        requireWritable() {},
      },
    },
    () => {},
    new Set(enabled ? ["record-correction"] : []),
  );
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...body, facts }),
  });
}

async function snapshot() {
  return {
    records: await suite.db.select().from(registrosFacturacion),
    deliveries: await suite.db.select().from(envios),
    cases: await withTransaction(suite.db, listFilingCases),
    sales: await suite.db.select().from(sales),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}

it("corrects stored invoice facts without changing the issued sale, original record or delivery", async () => {
  const before = await snapshot();
  const res = await send({ description: "Corrected restaurant service" });
  expect(res.status).toBe(200);
  const result = (await res.json()) as { registroId: string; eventId: string };
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject({
    id: result.registroId,
    correctsRegistroId: body.registroId,
    idEmisorFactura: "89890001K",
    numSerieFactura: "A/1",
    fechaExpedicionFactura: "2026-07-20",
    nombreRazonEmisor: "Waitron SL",
    tipoFactura: "F2",
    destinatarios: null,
    desglose: before.records[0]!.desglose,
    cuotaTotal: before.records[0]!.cuotaTotal,
    importeTotal: before.records[0]!.importeTotal,
    descripcionOperacion: "Corrected restaurant service",
    subsanacion: "S",
    rechazoPrevio: "X",
    anteriorHuella: before.records[0]!.huella,
  });
  expect(after.deliveries[0]).toEqual(before.deliveries[0]);
  expect(after.deliveries[1]).toMatchObject({ registroId: result.registroId, estado: "pendiente" });
  expect(after.sales).toEqual(before.sales);
  expect(after.cases[0]).toMatchObject({
    status: "resolved",
    events: [{ id: result.eventId, remedyRegistroId: result.registroId }],
  });
  expect(after.head.ultimoRegistroId).toBe(result.registroId);
});

it.each([
  { facts: { breakdown, taxTotal: "20.00", total: "220.00" }, field: "total" },
  { facts: { total: "123.46" }, field: "total" },
  { facts: { taxTotal: "21.44" }, field: "taxTotal" },
  { facts: { breakdown }, field: "breakdown" },
])(
  "refuses a fix that changes the invoice's amounts, without a write: %j",
  async ({ facts, field }) => {
    const before = await snapshot();
    const res = await send({ description: "Corrected restaurant service", ...facts });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "fiscal.remedy_amount_changed",
        params: { registroId: body.registroId, field },
      },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([
  {
    facts: { description: "Corrected restaurant service" },
    row: {
      descripcionOperacion: "Corrected restaurant service",
      nombreRazonEmisor: "Waitron SL",
      tipoFactura: "F2",
    },
  },
])("retains a partial corrected-fact decision %j", async ({ facts, row }) => {
  const before = await snapshot();
  const res = await send(facts);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  const after = await snapshot();
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject(row);
  expect(after.sales).toEqual(before.sales);
});

it("refuses a fix that changes the issuer's name, without a write", async () => {
  const before = await snapshot();
  const res = await send({ issuerName: "Corrected Issuer" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: { code: "fiscal.remedy_issuer_changed", params: { registroId: body.registroId } },
  });
  expect(await snapshot()).toEqual(before);
});

it("accepts the issuer's own name unchanged", async () => {
  const res = await send({ issuerName: "Waitron SL", description: "Corrected restaurant service" });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  expect((await snapshot()).records[1]).toMatchObject({
    nombreRazonEmisor: "Waitron SL",
    descripcionOperacion: "Corrected restaurant service",
  });
});

it.each([
  { facts: { invoiceType: "F1" }, field: "invoiceType" },
  { facts: { recipients: [recipient] }, field: "recipients" },
  {
    facts: {
      invoiceType: "F1",
      recipients: [
        {
          NombreRazon: "Foreign Customer",
          IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
        },
      ],
    },
    field: "invoiceType",
  },
  {
    facts: { recipients: [{ NombreRazon: "Invalid Customer", NIF: "invalid" }] },
    field: "recipients",
  },
  { facts: { invoiceType: "R1", correctionType: "S" }, field: "invoiceType" },
  {
    facts: {
      invoiceType: "R1",
      correctionType: "S",
      correctedInvoices: [reference],
      correctionAmounts: {
        BaseRectificada: "0.00",
        CuotaRectificada: "0.00",
        CuotaRecargoRectificado: "0.00",
      },
      recipients: [recipient],
    },
    field: "invoiceType",
  },
  {
    facts: { invoiceType: "F3", substitutedInvoices: [reference], recipients: [recipient] },
    field: "invoiceType",
  },
  { facts: { correctionType: "S" }, field: "correctionType" },
  { facts: { correctedInvoices: [reference] }, field: "correctedInvoices" },
  { facts: { substitutedInvoices: [reference] }, field: "substitutedInvoices" },
])("refuses a fix that changes a printed fact, without a write: %j", async ({ facts, field }) => {
  const before = await snapshot();
  const res = await send({ description: "Corrected restaurant service", ...facts });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: {
      code: "fiscal.remedy_printed_fact_changed",
      params: { registroId: body.registroId, field },
    },
  });
  expect(await snapshot()).toEqual(before);
});

/** Points `send` at a refused record of its own type: a corrective (R5, as `recordCorrection`
 * writes it) or an exchange invoice (F3, as `recordSubstitution` writes it). */
async function targetRefusedOfType(invoiceType: "R5" | "F3") {
  const saleId = await seedSale(suite.db, node, 2);
  const own = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "PRIOR/0",
    FechaExpedicionFactura: new Date("2026-07-18T00:00:00+02:00"),
  };
  await withTransaction(suite.db, async (tx) => {
    const pending = altaFor(node, saleId, 2, 2, "preproduction");
    const original = await appendToChain(tx, node.nodeId, {
      ...pending,
      input: {
        ...pending.input,
        TipoFactura: invoiceType,
        ...(invoiceType === "R5"
          ? { TipoRectificativa: "I" as const, FacturasRectificadas: [own] }
          : { FacturasSustituidas: [own], Destinatarios: { IDDestinatario: [recipient] } }),
      },
    });
    await tx
      .insert(envios)
      .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: original.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    body = { ...body, caseId: filingCase.id, registroId: original.id };
  });
}

it.each(["R5", "F3"] as const)(
  "corrects %s reference facts while preserving their calendar date across a new generation offset",
  async (invoiceType) => {
    await targetRefusedOfType(invoiceType);
    instant = new Date("2026-12-20T17:20:35Z");
    const own = Object.fromEntries(Object.entries(ownReference).reverse());
    const facts =
      invoiceType === "R5"
        ? { invoiceType, correctionType: "I", correctedInvoices: [own] }
        : { invoiceType, substitutedInvoices: [own], recipients: [recipient] };
    const res = await send(facts);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const { registroId } = (await res.json()) as { registroId: string };
    const [row] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, registroId));
    expect(row).toMatchObject({
      tipoFactura: invoiceType,
      fechaExpedicionFactura: "2026-07-20",
      offsetMinutos: 60,
      tipoRectificativa: invoiceType === "R5" ? "I" : null,
      facturasRectificadas:
        invoiceType === "R5"
          ? { IDFacturaRectificada: [{ ...ownReference, FechaExpedicionFactura: "18-07-2026" }] }
          : null,
      facturasSustituidas:
        invoiceType === "F3"
          ? { IDFacturaSustituida: [{ ...ownReference, FechaExpedicionFactura: "18-07-2026" }] }
          : null,
      importeRectificacion: null,
    });
  },
);

it("accepts the record's own recipients sent back in another key order", async () => {
  await targetRefusedOfType("F3");
  const res = await send({
    recipients: [{ NIF: recipient.NIF, NombreRazon: recipient.NombreRazon }],
    description: "Corrected restaurant service",
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
});

it.each([
  {
    type: "R5",
    facts: {
      correctionType: "S",
      correctionAmounts: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
    },
    field: "correctionType",
  },
  { type: "R5", facts: { correctionType: null }, field: "correctionType" },
  {
    type: "R5",
    facts: { correctedInvoices: [{ ...ownReference, NumSerieFactura: "OTHER/9" }] },
    field: "correctedInvoices",
  },
  { type: "R5", facts: { correctedInvoices: null }, field: "correctedInvoices" },
  { type: "F3", facts: { substitutedInvoices: null }, field: "substitutedInvoices" },
  {
    type: "F3",
    facts: { substitutedInvoices: [{ ...ownReference, FechaExpedicionFactura: "2026-07-19" }] },
    field: "substitutedInvoices",
  },
] as const)(
  "refuses a fix that changes or removes a printed fact the record carries, without a write: %j",
  async ({ type, facts, field }) => {
    await targetRefusedOfType(type);
    const before = await snapshot();
    const res = await send({ description: "Corrected restaurant service", ...facts });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "fiscal.remedy_printed_fact_changed",
        params: { registroId: body.registroId, field },
      },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("accepts null for facts the record does not carry", async () => {
  await targetRefusedOfType("F3");
  const before = await snapshot();
  const original = before.records.find((row) => row.id === body.registroId)!;
  const res = await send({
    correctionType: null,
    correctedInvoices: null,
    correctionAmounts: null,
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  const { registroId } = (await res.json()) as { registroId: string };
  const after = await snapshot();
  expect(after.records.find((row) => row.id === body.registroId)).toEqual(original);
  expect(after.records.find((row) => row.id === registroId)).toMatchObject({
    tipoFactura: "F3",
    facturasSustituidas: original.facturasSustituidas,
    tipoRectificativa: null,
    facturasRectificadas: null,
    importeRectificacion: null,
    destinatarios: original.destinatarios,
  });
  expect(after.sales).toEqual(before.sales);
});

it("replays complete facts in another key order after the clock and delivery change", async () => {
  await targetRefusedOfType("F3");
  const filed = (await snapshot()).records.find((row) => row.id === body.registroId)!
    .desglose as Record<string, string>[];
  const facts = {
    breakdown: filed,
    recipients: [recipient],
    description: "Corrected restaurant service",
  };
  const first = await send(facts);
  expect(first.status).toBe(200);
  const result = await first.json();
  instant = new Date("2026-12-20T17:20:35Z");
  await suite.db
    .update(envios)
    .set({ estado: "aceptado" })
    .where(eq(envios.registroId, body.registroId as string));
  const before = await snapshot();
  const replay = await send({
    description: "Corrected restaurant service",
    breakdown: filed.map((item) => Object.fromEntries(Object.entries(item).reverse())),
    recipients: [{ NIF: recipient.NIF, NombreRazon: recipient.NombreRazon }],
  });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

/** Points `send` at an invoice the agency accepted with errors, under that explicit decision. */
async function targetAcceptedWithErrors() {
  const saleId = await seedSale(suite.db, node, 2);
  await withTransaction(suite.db, async (tx) => {
    const accepted = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, saleId, 2, 2, "preproduction"),
    );
    await tx
      .insert(envios)
      .values({ registroId: accepted.id, estado: "aceptado_con_errores", codigoError: "2000" });
    const filingCase = await openFilingCase(tx, {
      registroId: accepted.id,
      cause: "fiscal.aceptado_con_errores",
      evidence: { codigo: 2000, mensaje: "Synthetic stored-fact error", csv: null },
      now: NOW,
    });
    body = {
      ...body,
      registroId: accepted.id,
      caseId: filingCase.id,
      priorOutcome: "accepted-with-errors",
    };
  });
}

it("applies complete facts under an explicit accepted-with-errors decision while retaining both case histories", async () => {
  await targetAcceptedWithErrors();
  const before = await snapshot();
  const res = await send({ description: "Corrected restaurant service" });
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    tipoFactura: "F2",
    subsanacion: "S",
    rechazoPrevio: "N",
    descripcionOperacion: "Corrected restaurant service",
    destinatarios: null,
  });
  expect(after.cases.find((item) => item.id !== body.caseId)).toEqual(
    before.cases.find((item) => item.id !== body.caseId),
  );
  expect(after.cases.find((item) => item.id === body.caseId)).toMatchObject({ status: "resolved" });
  expect(after.deliveries.slice(0, 2)).toEqual(before.deliveries);
  expect(after.sales).toEqual(before.sales);
});

it("refuses an amount change under an explicit accepted-with-errors decision, without a write", async () => {
  await targetAcceptedWithErrors();
  const before = await snapshot();
  const res = await send({ description: "Corrected restaurant service", total: "123.46" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: {
      code: "fiscal.remedy_amount_changed",
      params: { registroId: body.registroId, field: "total" },
    },
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses a fix that gives an invoice non-zero correction amounts, without a write", async () => {
  const before = await snapshot();
  const res = await send({
    description: "Corrected restaurant service",
    correctionAmounts: { BaseRectificada: "201.00", CuotaRectificada: "20.00" },
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: {
      code: "fiscal.remedy_amount_changed",
      params: { registroId: body.registroId, field: "correctionAmounts" },
    },
  });
  expect(await snapshot()).toEqual(before);
});

it.each(
  [
    { recipients: [{ NombreRazon: "Missing identity" }] },
    {
      recipients: [
        {
          NombreRazon: "Foreign Customer",
          IDOtro: { IDType: "02", ID: "FR12345678901", CodigoPais: 33 },
        },
      ],
    },
    { breakdown: [{ BaseImponibleOimporteNoSujeto: "200.00" }] },
    { breakdown: [{ ...breakdown[0], OperacionExenta: "E1" }] },
    { substitutedInvoices: {} },
    { correctedInvoices: [{ ...reference, FechaExpedicionFactura: "2026-99-99" }] },
  ].map((facts) => ({ facts })),
)("refuses malformed nested choices before complete-record validation: %j", async ({ facts }) => {
  const before = await snapshot();
  const res = await send(facts);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each([
  { description: "Another restaurant service" },
  { invoiceType: "F2" },
  { recipients: null },
])("refuses changed saved facts %j", async (change) => {
  const facts = { description: "Corrected restaurant service" };
  expect((await send(facts)).status).toBe(200);
  const before = await snapshot();
  const res = await send({ ...facts, ...change });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
  expect(await snapshot()).toEqual(before);
});

it.each([
  { change: { taxTotal: "20.01" }, field: "taxTotal" },
  { change: { total: "220.01" }, field: "total" },
  {
    change: { breakdown: [{ ...breakdown[0], BaseImponibleOimporteNoSujeto: "200.01" }] },
    field: "breakdown",
  },
])(
  "refuses an amount change after a saved decision, without a write: %j",
  async ({ change, field }) => {
    const facts = { description: "Corrected restaurant service" };
    expect((await send(facts)).status).toBe(200);
    const before = await snapshot();
    const res = await send({ ...facts, ...change });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "fiscal.remedy_amount_changed",
        params: { registroId: body.registroId, field },
      },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(
  [
    {},
    { total: null },
    { total: 220 },
    { total: [] },
    { description: null },
    { issuerName: "" },
    { invoiceType: ["F1"] },
    { invoiceType: "unknown" },
    { correctionType: "unknown" },
    { recipients: [] },
    { recipients: [null] },
    { recipients: [{ ...recipient, enabledRemedies: ["record-correction"] }] },
    { recipients: [{ ...recipient, IDOtro: { IDType: "02", ID: "other" } }] },
    { recipients: [{ NombreRazon: "Foreign Customer", IDOtro: { IDType: 2, ID: "foreign" } }] },
    { breakdown: [] },
    { breakdown: [{ ...breakdown[0], CuotaRepercutida: 20 }] },
    { breakdown: [{ ...breakdown[0], clientField: "ignored" }] },
    { correctedInvoices: [] },
    { correctedInvoices: [{ ...reference, FechaExpedicionFactura: "2026-02-30" }] },
    { correctedInvoices: [{ ...reference, FechaExpedicionFactura: "2026-7-19" }] },
    { correctedInvoices: [{ ...reference, clientField: "ignored" }] },
    { correctionAmounts: { BaseRectificada: 200, CuotaRectificada: "20.00" } },
    {
      correctionAmounts: {
        BaseRectificada: "200.00",
        CuotaRectificada: "20.00",
        clientField: "ignored",
      },
    },
    { IDEmisorFactura: "B12345674" },
    { NumSerieFactura: "OTHER/1" },
    { FechaExpedicionFactura: "2026-07-19" },
    { Subsanacion: "N" },
    { SistemaInformatico: {} },
    { generatedAt: "2026-07-19" },
  ].map((facts) => ({ facts })),
)("refuses malformed or unowned facts without a write: %j", async ({ facts }) => {
  const before = await snapshot();
  const res = await send(facts);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])(
  "keeps complete-fact corrections disabled by server policy on replay %s",
  async (replay) => {
    const facts = { description: "Corrected restaurant service" };
    if (replay) expect((await send(facts)).status).toBe(200);
    const before = await snapshot();
    const res = await send(facts, false);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(
  [
    { total: "not an amount" },
    { total: "1000000000000.00" },
    { taxTotal: "1e2" },
    { breakdown: [{ ...breakdown[0], BaseImponibleOimporteNoSujeto: "NaN" }] },
    { breakdown: [{ ...breakdown[0], TipoImpositivo: "10%" }] },
    { correctionAmounts: { BaseRectificada: "invalid", CuotaRectificada: "20.00" } },
  ].map((facts) => ({ facts })),
)("refuses a malformed exact amount before calling the record builder: %j", async ({ facts }) => {
  const before = await snapshot();
  const res = await send(facts);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each([{ description: "x".repeat(501) }].map((facts) => ({ facts })))(
  "keeps complete-record fiscal validation after applying structurally valid facts: %j",
  async ({ facts }) => {
    const before = await snapshot();
    const res = await send(facts);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "fiscal.record_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a description holding a control character AEAT's XML cannot carry, at 400", async () => {
  const before = await snapshot();
  const res = await send({ description: "Servicio\u000Bde restauración" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: {
      code: "fiscal.record_invalid",
      params: { fields: ["DescripcionOperacion"], codes: ["CONTROL_CHAR"] },
    },
  });
  expect(await snapshot()).toEqual(before);
});

describe("a fix never changes the invoice's amounts or what a line is", () => {
  const twelveTen = [
    {
      Impuesto: "01",
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "10.00",
      CuotaRepercutida: "2.10",
    },
  ] as const;
  const exemptLine = {
    Impuesto: "01",
    ClaveRegimen: "01",
    OperacionExenta: "E1",
    BaseImponibleOimporteNoSujeto: "5.00",
  } as const;

  /** Points `send` at a refused invoice filed with `lines` (by default €12.10 at 21%: 10.00 + 2.10). */
  async function targetRefusedInvoice(
    lines: readonly DetalleDesgloseInput[] = twelveTen,
    total = "12.10",
  ) {
    const saleId = await seedSale(suite.db, node, 2);
    await withTransaction(suite.db, async (tx) => {
      const pending = altaFor(node, saleId, 2, 2, "preproduction");
      const original = await appendToChain(tx, node.nodeId, {
        ...pending,
        input: {
          ...pending.input,
          Desglose: [...lines],
          CuotaTotal: "2.10",
          ImporteTotal: total,
        },
      });
      await tx
        .insert(envios)
        .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
      const filingCase = await openFilingCase(tx, {
        registroId: original.id,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now: NOW,
      });
      body = { ...body, caseId: filingCase.id, registroId: original.id, actionKey: "twelve-ten" };
    });
  }

  async function storedFix(res: Response) {
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const { registroId } = (await res.json()) as { registroId: string };
    const [row] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, registroId));
    return row;
  }

  it("refuses a €12.10 invoice filed at 21% (10.00 + 2.10) re-filed at 10% (11.00 + 1.10)", async () => {
    await targetRefusedInvoice();
    const before = await snapshot();
    const res = await send({
      breakdown: [
        {
          ...twelveTen[0],
          TipoImpositivo: "10.00",
          BaseImponibleOimporteNoSujeto: "11.00",
          CuotaRepercutida: "1.10",
        },
      ],
      taxTotal: "1.10",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "fiscal.remedy_amount_changed",
        params: { registroId: body.registroId, field: "taxTotal" },
      },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("accepts a fix restating the stored 12.10 total as 12.1", async () => {
    await targetRefusedInvoice();
    const row = await storedFix(
      await send({ total: "12.1", description: "Corrected restaurant service" }),
    );
    expect(row).toMatchObject({
      importeTotal: "12.10",
      descripcionOperacion: "Corrected restaurant service",
    });
  });

  /** Points `send` at a refused corrective invoice whose correction amounts are 200.00 + 20.00. */
  async function targetRefusedCorrective() {
    const saleId = await seedSale(suite.db, node, 3);
    await withTransaction(suite.db, async (tx) => {
      const pending = altaFor(node, saleId, 3, 3, "preproduction");
      const original = await appendToChain(tx, node.nodeId, {
        ...pending,
        input: {
          ...pending.input,
          TipoFactura: "R1",
          TipoRectificativa: "S",
          FacturasRectificadas: [{ ...reference, FechaExpedicionFactura: new Date(NOW) }],
          ImporteRectificacion: { BaseRectificada: "200.00", CuotaRectificada: "20.00" },
          Destinatarios: { IDDestinatario: [recipient] },
        },
      });
      await tx
        .insert(envios)
        .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
      const filingCase = await openFilingCase(tx, {
        registroId: original.id,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now: NOW,
      });
      body = { ...body, caseId: filingCase.id, registroId: original.id, actionKey: "corrective" };
    });
  }

  it.each([
    { BaseRectificada: "999.00", CuotaRectificada: "20.00" },
    { BaseRectificada: "200.00", CuotaRectificada: "21.00" },
    { BaseRectificada: "200.00", CuotaRectificada: "20.00", CuotaRecargoRectificado: "1.00" },
    null,
  ])(
    "refuses a fix of a corrective invoice that changes its correction amounts to %j",
    async (correctionAmounts) => {
      await targetRefusedCorrective();
      const before = await snapshot();
      const res = await send({ correctionAmounts, description: "Corrected restaurant service" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "fiscal.remedy_amount_changed",
          params: { registroId: body.registroId, field: "correctionAmounts" },
        },
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("accepts a fix of a corrective invoice restating its correction amounts as 200, 20.0 and 0", async () => {
    await targetRefusedCorrective();
    const row = await storedFix(
      await send({
        correctionAmounts: {
          BaseRectificada: "200",
          CuotaRectificada: "20.0",
          CuotaRecargoRectificado: "0",
        },
        description: "Corrected restaurant service",
      }),
    );
    expect(row).toMatchObject({ descripcionOperacion: "Corrected restaurant service" });
    expect(row?.importeRectificacion).toEqual({
      BaseRectificada: "200.00",
      CuotaRectificada: "20.00",
      CuotaRecargoRectificado: "0.00",
    });
  });

  it("refuses a correction-amount change after a saved decision, without a write", async () => {
    await targetRefusedCorrective();
    const facts = {
      correctionAmounts: { BaseRectificada: "200.00", CuotaRectificada: "20.00" },
      description: "Corrected restaurant service",
    };
    expect((await send(facts)).status).toBe(200);
    const before = await snapshot();
    const res = await send({
      ...facts,
      correctionAmounts: { BaseRectificada: "200.00", CuotaRectificada: "20.01" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "fiscal.remedy_amount_changed",
        params: { registroId: body.registroId, field: "correctionAmounts" },
      },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("accepts a fix of the same invoice that changes only its description", async () => {
    await targetRefusedInvoice();
    const row = await storedFix(await send({ description: "Corrected restaurant service" }));
    expect(row).toMatchObject({
      descripcionOperacion: "Corrected restaurant service",
      desglose: twelveTen,
      cuotaTotal: "2.10",
      importeTotal: "12.10",
    });
  });

  const taxed = twelveTen[0];
  const notSubjectLine = {
    Impuesto: "01",
    ClaveRegimen: "01",
    CalificacionOperacion: "N1",
    BaseImponibleOimporteNoSujeto: "2.00",
  } as const;
  const filed = [taxed, exemptLine, notSubjectLine];
  it.each([
    {
      lines: [{ ...taxed, Impuesto: "03" }, exemptLine, notSubjectLine],
      field: "taxType",
      line: 0,
    },
    {
      lines: [{ ...taxed, ClaveRegimen: "05" }, exemptLine, notSubjectLine],
      field: "regime",
      line: 0,
    },
    {
      lines: [taxed, exemptLine, { ...notSubjectLine, CalificacionOperacion: "N2" }],
      field: "operationClass",
      line: 2,
    },
    {
      lines: [taxed, { ...exemptLine, OperacionExenta: "E6" }, notSubjectLine],
      field: "exemption",
      line: 1,
    },
    {
      lines: [
        taxed,
        exemptLine,
        { ...notSubjectLine, CalificacionOperacion: undefined, OperacionExenta: "E1" },
      ],
      field: "operationClass",
      line: 2,
    },
    {
      lines: [
        { ...taxed, CalificacionOperacion: undefined, OperacionExenta: "E1" },
        exemptLine,
        notSubjectLine,
      ],
      field: "operationClass",
      line: 0,
    },
  ])(
    "refuses a fix that changes what a line is, amounts equal, without a write: %j",
    async ({ lines, field, line }) => {
      await targetRefusedInvoice(filed, "19.10");
      const before = await snapshot();
      const res = await send({ breakdown: lines, description: "Corrected restaurant service" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "fiscal.remedy_class_changed",
          params: { registroId: body.registroId, field, line },
        },
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("accepts a fix that omits the IVA tax type the invoice filed as 01", async () => {
    await targetRefusedInvoice();
    const row = await storedFix(
      await send({
        breakdown: [{ ...taxed, Impuesto: undefined }],
        description: "Corrected restaurant service",
      }),
    );
    expect(row).toMatchObject({ descripcionOperacion: "Corrected restaurant service" });
    expect(row?.desglose).toEqual([{ ...taxed, Impuesto: undefined }]);
    expect((row?.desglose as Record<string, string>[])[0]).not.toHaveProperty("Impuesto");
  });

  it("accepts a fix that states IVA as 01 on a line filed without a tax type", async () => {
    const filed = (await snapshot()).records[0]!.desglose as Record<string, string>[];
    expect(filed[0]).not.toHaveProperty("Impuesto");
    const row = await storedFix(
      await send({
        breakdown: [{ ...filed[0], Impuesto: "01" }],
        description: "Corrected restaurant service",
      }),
    );
    expect(row).toMatchObject({ descripcionOperacion: "Corrected restaurant service" });
    expect(row?.desglose).toEqual([{ ...filed[0], Impuesto: "01" }]);
  });
});
