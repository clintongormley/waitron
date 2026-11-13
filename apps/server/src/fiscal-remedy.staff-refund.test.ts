import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordSale, recordVoid } from "@waitron/core";
import {
  drawerOpens,
  invoiceSeries,
  printJobs,
  saleLines,
  saleSettlements,
  sales,
  saleVoids,
  tenderRefunds,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions, sessions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { FISCAL_PERMISSIONS } from "@waitron/fiscal-verifactu/src/permissions.js";
import { readChainHead } from "@waitron/fiscal-verifactu/src/chain.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "@waitron/fiscal-verifactu/src/drain.js";
import { listFilingCases, openFilingCase } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import { mountRecordRemedies } from "@waitron/fiscal-verifactu/src/record-remedy-routes.js";
import { REMEDY_KINDS, type RemedyKind } from "@waitron/fiscal-verifactu/src/record-remedy.js";
import { envios } from "@waitron/fiscal-verifactu/src/schema/envios.js";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { currentSif } from "@waitron/fiscal-verifactu/src/registro-sif.js";
import { verifyChain } from "@waitron/fiscal-verifactu/src/verify.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { inTx, send } from "./testing/bill-venue.js";
import { provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const NOW = new Date("2026-11-02T12:00:00Z");
let venue: OrderVenue;
let saleId: string;
let originalId: string;
let tenderId: string;

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  venue = await provisionOrderVenue(store.db);
  const sold = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: venue.seriesId,
      locale: "en",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant service",
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
      clock: venue.clock,
      operatorId: venue.operatorId,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "12.10", tipAmount: "0.00", settledAt: NOW }],
      },
    }),
  );
  saleId = sold.saleId;
  originalId = sold.fiscal.recordId;
  const [tender] = await store.db.select().from(tenders).where(eq(tenders.saleId, saleId));
  tenderId = tender!.id;
  await inTx(venue, (tx) => setFreshManagementSignIn(tx, venue.adminDashboard));
});

afterEach(() => vi.useRealTimers());

function remedy(
  body: Record<string, unknown>,
  enabled?: RemedyKind[],
  environment: "production" | "preproduction" = "preproduction",
) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    {
      db: store.db,
      recordGeneration: {
        nodeId: venue.cfg.nodeId,
        environment,
        clock: venue.clock,
        requireClockConfirmed: () => {},
        requireWritable: () => {},
      },
    },
    () => {},
    enabled === undefined ? undefined : new Set(enabled),
  );
  return send(app, venue.adminDashboard, "POST", "/management-api/fiscal-records/remedy", body);
}

function refund(body: Record<string, unknown>) {
  return send(venue.app, venue.supervisorTill, "POST", `/api/transactions/${saleId}/refunds`, body);
}

async function accounting() {
  return inTx(venue, async (tx) => ({
    sales: await tx.select().from(sales).orderBy(sales.id),
    lines: await tx.select().from(saleLines).orderBy(saleLines.id),
    tenders: await tx.select().from(tenders).orderBy(tenders.id),
    settlements: await tx.select().from(saleSettlements).orderBy(saleSettlements.id),
    voids: await tx.select().from(saleVoids).orderBy(saleVoids.id),
    refunds: await tx.select().from(tenderRefunds).orderBy(tenderRefunds.id),
    drawers: await tx.select().from(drawerOpens).orderBy(drawerOpens.id),
    prints: await tx.select().from(printJobs).orderBy(printJobs.id),
    series: await tx.select().from(invoiceSeries).orderBy(invoiceSeries.id),
  }));
}

async function cancelAndRefund() {
  const [session] = await store.db
    .select()
    .from(sessions)
    .where(eq(sessions.personId, venue.supervisorId));
  const refundBody = {
    submissionId: randomUUID(),
    tenderId,
    appliedAmount: "12.10",
    tipAmount: "0.00",
    reason: "Returned order",
  };
  const refunded = await refund(refundBody);
  expect(refunded).toMatchObject({
    status: 200,
    json: { state: "completed", appliedAmount: "12.10", tipAmount: "0.00" },
  });
  const cancelled = await inTx(venue, (tx) =>
    recordVoid(
      tx,
      venue.backend,
      brandSaleId(saleId),
      "Returned order",
      { sessionId: session!.id },
      venue.cfg.nodeId,
    ),
  );
  const facts = await accounting();
  expect(facts.voids).toMatchObject([
    { saleId, reason: "Returned order", voidedBy: venue.supervisorId },
  ]);
  expect(facts.refunds).toMatchObject([
    {
      saleId,
      tenderId,
      state: "completed",
      appliedAmount: 1210,
      tipAmount: 0,
      requestedBy: venue.supervisorId,
      authorizedBy: venue.supervisorId,
    },
  ]);
  expect(facts.drawers).toHaveLength(1);
  expect(facts.prints.filter((row) => row.kind === "drawer")).toHaveLength(1);
  return { cancellationId: cancelled.fiscal.recordId, refundBody, refunded, facts };
}

async function rejectOriginal(code = 1161) {
  await store.db
    .update(envios)
    .set({ estado: "rechazado", codigoError: String(code) })
    .where(eq(envios.registroId, originalId));
  return withTransaction(store.db, (tx) =>
    openFilingCase(tx, {
      registroId: originalId,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: code, mensaje: null, csv: null },
      now: NOW,
    }),
  );
}

async function fiscalFacts() {
  return withTransaction(store.db, async (tx) => ({
    records: await tx.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia),
    deliveries: await tx.select().from(envios).orderBy(envios.registroId),
    cases: await listFilingCases(tx),
    head: await readChainHead(tx, venue.cfg.nodeId),
  }));
}

it("resolves a real staff void and cash refund by filing the same held cancellation without returning money twice", async () => {
  const originalCase = await rejectOriginal();
  const issued = await accounting();
  const { cancellationId, refundBody, refunded, facts } = await cancelAndRefund();
  expect(facts.sales).toEqual(issued.sales);
  expect(facts.lines).toEqual(issued.lines);
  expect(facts.tenders).toEqual(issued.tenders);
  expect(facts.settlements).toEqual(issued.settlements);
  const aeat = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
  const client = aeat.client();
  const submissions = vi.spyOn(client, "submit");
  const deps = {
    db: store.db,
    environment: "preproduction" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: () => Promise.resolve(client),
  };
  expect((await drain(deps, NOW)).recordsAccepted).toBe(0);
  expect(aeat.stored()).toEqual([]);
  expect(submissions).not.toHaveBeenCalled();
  const [held] = await store.db.select().from(envios).where(eq(envios.registroId, cancellationId));
  expect(held).toMatchObject({ estado: "retenido", intentos: 1, enviadoEn: NOW });
  const cases = await withTransaction(store.db, (tx) => listFilingCases(tx));
  const heldCase = cases.find((row) => row.registroId === cancellationId)!;
  expect(heldCase).toMatchObject({ cause: "fiscal.anulacion_retenida", status: "open" });
  const corrected = await remedy(
    {
      kind: "record-correction",
      registroId: originalId,
      caseId: originalCase.id,
      actionKey: "correct-rejected-staff-sale",
      reason: "Synthetic correction before held cancellation",
      facts: { description: "Corrected restaurant service" },
    },
    ["record-correction"],
  );
  expect(corrected).toMatchObject({ status: 200 });
  expect((await drain(deps, NOW)).recordsAccepted).toBe(1);
  const immutable = await store.db
    .select()
    .from(registrosFacturacion)
    .orderBy(registrosFacturacion.secuencia);
  const head = await withTransaction(store.db, (tx) => readChainHead(tx, venue.cfg.nodeId));
  const request = {
    kind: "release-held-cancellation",
    registroId: cancellationId,
    caseId: heldCase.id,
    acceptedRegistroId: corrected.json.registroId,
    actionKey: "release-staff-cancellation",
    reason: "Accepted current original",
  };
  const [released, concurrent] = await Promise.all([
    remedy(request, ["release-held-cancellation"]),
    remedy(request, ["release-held-cancellation"]),
  ]);
  expect(concurrent).toEqual(released);
  expect(released).toMatchObject({ status: 200 });
  expect((await drain(deps, new Date(NOW.getTime() + 60_000))).recordsAccepted).toBe(1);
  expect(aeat.stored()).toMatchObject([{ tipo: "anulacion", estado: "Anulado" }]);
  expect(
    await remedy(Object.fromEntries(Object.entries(request).reverse()), [
      "release-held-cancellation",
    ]),
  ).toEqual(released);
  expect(await refund(refundBody)).toEqual(refunded);
  expect(await accounting()).toEqual(facts);
  expect(
    await store.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia),
  ).toEqual(immutable);
  expect(await withTransaction(store.db, (tx) => readChainHead(tx, venue.cfg.nodeId))).toEqual(
    head,
  );
  const resolved = await withTransaction(store.db, (tx) => listFilingCases(tx));
  expect(resolved.find((row) => row.id === heldCase.id)).toMatchObject({
    status: "resolved",
    events: [{ kind: "resolved", remedyRegistroId: null }],
  });
  expect(
    (await withTransaction(store.db, (tx) => verifyChain(tx, venue.cfg.nodeId))).issues,
  ).toEqual([]);
});

it("preserves an unsuitable existing ordinary cancellation instead of generating an absent-original replacement or another refund", async () => {
  const originalCase = await rejectOriginal();
  const { cancellationId, refundBody, refunded, facts } = await cancelAndRefund();
  const aeat = createFakeAeat({ serverNow: NOW });
  await drain(
    {
      db: store.db,
      environment: "preproduction",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: () => Promise.resolve(aeat.client()),
    },
    NOW,
  );
  const before = await fiscalFacts();
  expect(before.deliveries.find((row) => row.registroId === cancellationId)).toMatchObject({
    estado: "retenido",
  });
  const refused = await remedy(
    {
      kind: "absent-original-cancellation",
      caseId: originalCase.id,
      registroId: originalId,
      actionKey: "unsuitable-existing-cancellation",
      reason: "Must not rewrite the held ordinary record",
    },
    ["absent-original-cancellation"],
  );
  expect(refused).toMatchObject({
    status: 400,
    json: { code: "fiscal.remedy_invalid" },
  });
  expect(await fiscalFacts()).toEqual(before);
  expect(await refund(refundBody)).toEqual(refunded);
  expect(await accounting()).toEqual(facts);
});

it.each(["pendiente", "enviando", "detenido"])(
  "keeps an existing staff refund and cancellation unchanged while the original outcome is unknown (%s)",
  async (estado) => {
    const originalCase = await rejectOriginal();
    const { cancellationId, refundBody, refunded, facts } = await cancelAndRefund();
    await store.db.update(envios).set({ estado }).where(eq(envios.registroId, originalId));
    const before = await fiscalFacts();
    for (const kind of ["record-correction", "absent-original-cancellation"] as const) {
      const refused = await remedy(
        {
          kind,
          caseId: originalCase.id,
          registroId: originalId,
          actionKey: `unknown-${kind}`,
          reason: "No known original outcome",
          ...(kind === "record-correction"
            ? { facts: { description: "Unproven correction" } }
            : {}),
        },
        [kind],
      );
      expect(refused).toMatchObject({
        status: 400,
        json: { code: "fiscal.remedy_invalid" },
      });
    }
    expect(before.records.find((row) => row.id === cancellationId)).toMatchObject({
      tipoRegistro: "anulacion",
    });
    expect(await fiscalFacts()).toEqual(before);
    expect(await refund(refundBody)).toEqual(refunded);
    expect(await accounting()).toEqual(facts);
  },
);

it.each(["fiscal.huella_divergente", "fiscal.duplicado_anulado"] as const)(
  "does not reinterpret %s as a known rejected invoice after staff already refunded and cancelled it",
  async (cause) => {
    const { refundBody, refunded, facts } = await cancelAndRefund();
    await store.db
      .update(envios)
      .set({ estado: "detenido", codigoError: "3000" })
      .where(eq(envios.registroId, originalId));
    const filingCase = await withTransaction(store.db, (tx) =>
      openFilingCase(tx, {
        registroId: originalId,
        cause,
        evidence: { codigo: 3000, mensaje: null, csv: null },
        now: NOW,
      }),
    );
    const before = await fiscalFacts();
    for (const kind of ["record-correction", "absent-original-cancellation"] as const) {
      const refused = await remedy(
        {
          kind,
          caseId: filingCase.id,
          registroId: originalId,
          actionKey: `conflict-${kind}`,
          reason: "Ambiguous original identity",
          ...(kind === "record-correction" ? { facts: { description: "Unproven same sale" } } : {}),
        },
        [kind],
      );
      expect(refused).toMatchObject({
        status: 400,
        json: { code: "fiscal.remedy_invalid" },
      });
    }
    expect(await fiscalFacts()).toEqual(before);
    expect(await refund(refundBody)).toEqual(refunded);
    expect(await accounting()).toEqual(facts);
  },
);

it("releases the old chain's cancellation once a correction issued on another chain is accepted", async () => {
  const originalCase = await rejectOriginal();
  const { cancellationId, refundBody, refunded, facts } = await cancelAndRefund();
  const aeat = createFakeAeat({ serverNow: NOW });
  const deps = {
    db: store.db,
    environment: "preproduction" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: () => Promise.resolve(aeat.client()),
  };
  await drain(deps, NOW);
  const heldCase = (await fiscalFacts()).cases.find((row) => row.registroId === cancellationId)!;
  await withTransaction(store.db, async (tx) => {
    const prior = await currentSif(tx, venue.cfg.nodeId);
    await seedFixtureSif(tx, {
      nodeId: venue.cfg.nodeId,
      nif: prior.nif,
      idSistemaInformatico: prior.idSistemaInformatico,
    });
  });
  const corrected = await remedy(
    {
      kind: "record-correction",
      caseId: originalCase.id,
      registroId: originalId,
      actionKey: "other-chain-correction",
      reason: "Synthetic new issuing chain",
      facts: { description: "Corrected restaurant service" },
    },
    ["record-correction"],
  );
  expect(corrected).toMatchObject({ status: 200 });
  expect((await drain(deps, NOW)).recordsAccepted).toBe(1);
  const before = await fiscalFacts();
  const held = before.records.find((row) => row.id === cancellationId)!;
  const correction = before.records.find((row) => row.id === corrected.json.registroId)!;
  expect(correction.sifId).not.toBe(held.sifId);
  expect(correction.saleId).toBe(held.saleId);
  expect(correction.numSerieFactura).toBe(held.numSerieFactura);
  expect(before.deliveries.find((row) => row.registroId === correction.id)).toMatchObject({
    estado: "aceptado",
  });
  const released = await remedy(
    {
      kind: "release-held-cancellation",
      caseId: heldCase.id,
      registroId: cancellationId,
      acceptedRegistroId: correction.id,
      actionKey: "other-chain-release",
      reason: "Correction accepted on the new issuing chain",
    },
    ["release-held-cancellation"],
  );
  expect(released).toMatchObject({ status: 200 });
  expect((await drain(deps, new Date(NOW.getTime() + 60_000))).recordsAccepted).toBe(1);
  expect(aeat.stored()).toMatchObject([{ tipo: "anulacion", estado: "Anulado" }]);
  const after = await fiscalFacts();
  expect(after.records).toEqual(before.records);
  expect(after.head).toEqual(before.head);
  expect(after.deliveries.find((row) => row.registroId === cancellationId)).toMatchObject({
    estado: "aceptado",
  });
  expect(after.cases.find((row) => row.id === heldCase.id)).toMatchObject({
    status: "resolved",
    events: [{ kind: "resolved", remedyRegistroId: null }],
  });
  expect(await refund(refundBody)).toEqual(refunded);
  expect(await accounting()).toEqual(facts);
});

it.each(["pendiente", "enviando", "aceptado", "aceptado_con_errores", "rechazado", "detenido"])(
  "refuses a record correction while its existing ordinary cancellation is %s",
  async (estado) => {
    const originalCase = await rejectOriginal();
    const { cancellationId, facts } = await cancelAndRefund();
    await store.db.update(envios).set({ estado }).where(eq(envios.registroId, cancellationId));
    const before = await fiscalFacts();
    const response = await remedy(
      {
        kind: "record-correction",
        caseId: originalCase.id,
        registroId: originalId,
        actionKey: "cancellation-not-held",
        reason: "Do not create a filing dependency cycle",
        facts: { description: "Corrected restaurant service" },
      },
      ["record-correction"],
    );
    expect(response).toMatchObject({ status: 400, json: { code: "fiscal.remedy_invalid" } });
    expect(await fiscalFacts()).toEqual(before);
    expect(await accounting()).toEqual(facts);
  },
);

it("allows the same correction decision after the filing queue has actually held the waiting cancellation", async () => {
  const originalCase = await rejectOriginal();
  const { cancellationId, facts } = await cancelAndRefund();
  const request = {
    kind: "record-correction",
    caseId: originalCase.id,
    registroId: originalId,
    actionKey: "wait-for-real-hold",
    reason: "Explicit correction of the rejected invoice",
    facts: { description: "Corrected restaurant service" },
  };
  const refused = await remedy(request, ["record-correction"]);
  expect(refused).toMatchObject({ status: 400, json: { code: "fiscal.remedy_invalid" } });
  const aeat = createFakeAeat({ serverNow: NOW });
  const deps = {
    db: store.db,
    environment: "preproduction" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: () => Promise.resolve(aeat.client()),
  };
  expect((await drain(deps, NOW)).recordsAccepted).toBe(0);
  const heldCase = (await fiscalFacts()).cases.find((row) => row.registroId === cancellationId)!;
  expect(heldCase).toMatchObject({ cause: "fiscal.anulacion_retenida", status: "open" });
  const accepted = await remedy(request, ["record-correction"]);
  expect(accepted).toMatchObject({ status: 200 });
  expect((await drain(deps, NOW)).recordsAccepted).toBe(1);
  expect(
    await remedy(
      {
        kind: "release-held-cancellation",
        registroId: cancellationId,
        caseId: heldCase.id,
        acceptedRegistroId: accepted.json.registroId,
        actionKey: "release-after-real-hold",
        reason: "Accepted current original",
      },
      ["release-held-cancellation"],
    ),
  ).toMatchObject({ status: 200 });
  expect((await drain(deps, new Date(NOW.getTime() + 60_000))).recordsAccepted).toBe(1);
  expect(await accounting()).toEqual(facts);
});

it.each([3000, 1100, null])(
  "refuses synthetic duplicate or mismatched correction evidence %s",
  async (code) => {
    const originalCase = await rejectOriginal(code === 3000 ? 3000 : 1161);
    await store.db
      .update(envios)
      .set({ codigoError: code === null ? null : String(code) })
      .where(eq(envios.registroId, originalId));
    const before = await fiscalFacts();
    const response = await remedy(
      {
        kind: "record-correction",
        caseId: originalCase.id,
        registroId: originalId,
        actionKey: "unproven-rejection",
        reason: "Do not infer an absent original from a duplicate or stale case",
        facts: { description: "Unproven correction" },
      },
      ["record-correction"],
    );
    expect(response).toMatchObject({ status: 400, json: { code: "fiscal.remedy_invalid" } });
    expect(await fiscalFacts()).toEqual(before);
  },
);

it.each(["production", "preproduction"] as const)(
  "enables only record-correction by default, and refuses a request's claimed enablement, with a complete %s host context",
  async (environment) => {
    const before = await fiscalFacts();
    for (const kind of REMEDY_KINDS) {
      const response = await remedy(
        {
          kind,
          registroId: originalId,
          caseId: "unneeded",
          actionKey: "closed-policy",
          reason: "A request cannot grant authority",
          enabledRemedies: [kind],
        },
        undefined,
        environment,
      );
      expect(response).toMatchObject(
        kind === "record-correction"
          ? { status: 400, json: { code: "fiscal.remedy_request_invalid", params: {} } }
          : { status: 409, json: { code: "fiscal.remedy_disabled", params: { kind } } },
      );
    }
    expect(await fiscalFacts()).toEqual(before);
  },
);
