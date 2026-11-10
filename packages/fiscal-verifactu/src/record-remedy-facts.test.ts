import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
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

beforeEach(async () => {
  instant = NOW;
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  const saleId = await seedSale(suite.db, node, 1);
  await withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Administrator", role: "admin", pinHash: hashPin("2468") })
      .returning();
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
  const res = await send({
    issuerName: "Corrected Issuer",
    invoiceType: "F1",
    recipients: [recipient],
    breakdown,
    taxTotal: "20.00",
    total: "220.00",
  });
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
    nombreRazonEmisor: "Corrected Issuer",
    tipoFactura: "F1",
    destinatarios: { IDDestinatario: [recipient] },
    desglose: breakdown,
    cuotaTotal: "20.00",
    importeTotal: "220.00",
    descripcionOperacion: before.records[0]!.descripcionOperacion,
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
  { facts: { issuerName: "Corrected Issuer" }, row: { nombreRazonEmisor: "Corrected Issuer" } },
  { facts: { total: "123.46" }, row: { importeTotal: "123.46" } },
  { facts: { taxTotal: "21.44" }, row: { cuotaTotal: "21.44" } },
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
    row: {
      destinatarios: {
        IDDestinatario: [
          {
            NombreRazon: "Foreign Customer",
            IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
          },
        ],
      },
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

it.each(["R1", "F3"])(
  "corrects %s reference facts while preserving their calendar date across a new generation offset",
  async (invoiceType) => {
    instant = new Date("2026-12-20T17:20:35Z");
    const facts =
      invoiceType === "R1"
        ? {
            invoiceType,
            correctionType: "S",
            correctedInvoices: [reference],
            correctionAmounts: {
              BaseRectificada: "200.00",
              CuotaRectificada: "20.00",
              CuotaRecargoRectificado: "0.00",
            },
            recipients: [recipient],
          }
        : { invoiceType, substitutedInvoices: [reference], recipients: [recipient] };
    const res = await send(facts);
    expect(res.status).toBe(200);
    const after = await snapshot();
    expect(after.records[1]).toMatchObject({
      tipoFactura: invoiceType,
      fechaExpedicionFactura: "2026-07-20",
      offsetMinutos: 60,
      tipoRectificativa: invoiceType === "R1" ? "S" : null,
      facturasRectificadas:
        invoiceType === "R1"
          ? { IDFacturaRectificada: [{ ...reference, FechaExpedicionFactura: "19-07-2026" }] }
          : null,
      facturasSustituidas:
        invoiceType === "F3"
          ? { IDFacturaSustituida: [{ ...reference, FechaExpedicionFactura: "19-07-2026" }] }
          : null,
      importeRectificacion:
        invoiceType === "R1"
          ? {
              BaseRectificada: "200.00",
              CuotaRectificada: "20.00",
              CuotaRecargoRectificado: "0.00",
            }
          : null,
    });
  },
);

it("can explicitly remove optional facts from the next version without removing them from the rejected one", async () => {
  expect(
    (
      await send({
        invoiceType: "R1",
        correctionType: "S",
        correctedInvoices: [reference],
        correctionAmounts: { BaseRectificada: "200.00", CuotaRectificada: "20.00" },
        recipients: [recipient],
      })
    ).status,
  ).toBe(200);
  const first = (await snapshot()).records[1]!;
  await withTransaction(suite.db, async (tx) => {
    await tx
      .update(envios)
      .set({ estado: "rechazado", codigoError: "1161" })
      .where(eq(envios.registroId, first.id));
    const filingCase = await openFilingCase(tx, {
      registroId: first.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    body = {
      ...body,
      caseId: filingCase.id,
      registroId: first.id,
      actionKey: "remove-optional-facts",
    };
  });
  const before = await snapshot();
  const res = await send({
    invoiceType: "F2",
    correctionType: null,
    correctedInvoices: null,
    substitutedInvoices: null,
    correctionAmounts: null,
    recipients: null,
  });
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    tipoFactura: "F2",
    tipoRectificativa: null,
    facturasRectificadas: null,
    facturasSustituidas: null,
    importeRectificacion: null,
    destinatarios: null,
  });
  expect(after.sales).toEqual(before.sales);
});

it("replays complete facts in another key order after the clock and delivery change", async () => {
  const facts = {
    invoiceType: "F1",
    recipients: [recipient],
    breakdown,
    taxTotal: "20.00",
    total: "220.00",
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
    total: "220.00",
    taxTotal: "20.00",
    breakdown: breakdown.map((item) => Object.fromEntries(Object.entries(item).reverse())),
    recipients: [{ NIF: "B12345674", NombreRazon: "Corrected Customer" }],
    invoiceType: "F1",
  });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("applies complete facts under an explicit accepted-with-errors decision while retaining both case histories", async () => {
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
  const before = await snapshot();
  const res = await send({
    invoiceType: "F1",
    recipients: [recipient],
    breakdown,
    taxTotal: "20.00",
    total: "220.00",
  });
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    tipoFactura: "F1",
    subsanacion: "S",
    rechazoPrevio: "N",
    cuotaTotal: "20.00",
    importeTotal: "220.00",
    destinatarios: { IDDestinatario: [recipient] },
  });
  expect(after.cases.find((item) => item.id !== body.caseId)).toEqual(
    before.cases.find((item) => item.id !== body.caseId),
  );
  expect(after.cases.find((item) => item.id === body.caseId)).toMatchObject({ status: "resolved" });
  expect(after.deliveries.slice(0, 2)).toEqual(before.deliveries);
  expect(after.sales).toEqual(before.sales);
});

it.each([
  { correctionType: "I", correctionAmounts: null },
  { correctedInvoices: [{ ...reference, NumSerieFactura: "PRIOR/2" }] },
  { correctionAmounts: { BaseRectificada: "201.00", CuotaRectificada: "20.00" } },
])(
  "refuses changed corrective-reference decisions under a saved action key: %j",
  async (change) => {
    const facts = {
      invoiceType: "R1",
      correctionType: "S",
      correctedInvoices: [reference],
      correctionAmounts: { BaseRectificada: "200.00", CuotaRectificada: "20.00" },
      recipients: [recipient],
    };
    expect((await send(facts)).status).toBe(200);
    const before = await snapshot();
    const res = await send({ ...facts, ...change });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
    expect(await snapshot()).toEqual(before);
  },
);

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
  { issuerName: "Another Issuer" },
  { invoiceType: "F2" },
  { recipients: null },
  { taxTotal: "20.01" },
  { total: "220.01" },
  { breakdown: [{ ...breakdown[0], BaseImponibleOimporteNoSujeto: "200.01" }] },
])("refuses changed saved facts %j", async (change) => {
  const facts = {
    issuerName: "Corrected Issuer",
    invoiceType: "F1",
    recipients: [recipient],
    breakdown,
    taxTotal: "20.00",
    total: "220.00",
  };
  expect((await send(facts)).status).toBe(200);
  const before = await snapshot();
  const res = await send({ ...facts, ...change });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
  expect(await snapshot()).toEqual(before);
});

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
    const facts = {
      invoiceType: "F1",
      recipients: [recipient],
      breakdown,
      taxTotal: "20.00",
      total: "220.00",
    };
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

it.each(
  [
    { invoiceType: "F1" },
    { invoiceType: "R1", correctionType: "S" },
    { recipients: [{ NombreRazon: "Invalid Customer", NIF: "invalid" }] },
  ].map((facts) => ({ facts })),
)(
  "keeps complete-record fiscal validation after applying structurally valid facts: %j",
  async ({ facts }) => {
    const before = await snapshot();
    const res = await send(facts);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "fiscal.record_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);
