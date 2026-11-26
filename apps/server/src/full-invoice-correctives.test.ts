import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { recordReplacement } from "@waitron/core";
import { loadKeyRing } from "@waitron/credentials";
import {
  incidents,
  invoiceCorrections,
  readLiveSeriesIdTx,
  sales,
  taxpayer,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { loginWithPin, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { DEVICE_COOKIE } from "./device-session.js";
import type { GiveBackPlan, GiveBackRequest } from "./give-back-plan.js";
import { sweepInvoiceCorrections } from "./invoice-correction-alerts.js";
import { mountPaymentsApi } from "./payments-api.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { SESSION_COOKIE } from "./till-session.js";

// Section 2 of docs/superpowers/plans/2026-11-25-correct-full-invoice.md: every path that could
// file against a full invoice once Give money back opens a correction on one.

let venue: BillVenue;
let reasonId: string;
/** The administrator, holding every right, signed in on the first till. */
let adminCookie: string;
let managerCookie: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
      const session = await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: venue.adminId,
        pin: "1234",
      });
      const proof = venue.cookie.split("; ").find((part) => part.startsWith(`${DEVICE_COOKIE}=`));
      adminCookie = `${SESSION_COOKIE}=${session.token}; ${proof}`;
      const management = await startManagementSession(tx, {
        method: "password",
        personId: venue.adminId,
      });
      managerCookie = `${MANAGEMENT_COOKIE}=${management.token}`;
    });
  },
});

afterEach(() => {
  venue.card.scriptLookups(null);
});

const supervisor = () => ({ personId: venue.adminId, pin: "1234" });

type Part = { cash: string } | { card: string } | { reader: string };

/** A full invoice naming Harbour Foods for a Steak (€25.00) and a House salad (€12.00), paid in
 * `parts`; its sale. */
async function fullInvoice(...parts: Part[]): Promise<string> {
  const billId = await tabWith(venue, "Steak", "House salad");
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  const chosen = await send(
    venue.app,
    venue.cookie,
    "PUT",
    `/api/working-orders/${billId}/invoice-choice`,
    {
      revision: order!.revision,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Harbour Foods",
        address: "2 Main Street, 28013 Madrid, Madrid",
        countryCode: "ES",
      },
    },
  );
  expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
  for (const part of parts) {
    const amount = "cash" in part ? part.cash : "card" in part ? part.card : part.reader;
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount,
        ...("cash" in part
          ? { method: "cash", tendered: amount }
          : { method: "card", entry: "card" in part ? "manual" : "reader" }),
        applied: amount,
        tip: "0.00",
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  }
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, billId));
  return sale!.id;
}

function tenderOf(saleId: string, method: "cash" | "card"): string {
  return venue.db.all<{ id: string }>(
    sql`select id from tenders where sale_id = ${saleId} and method = ${method}`,
  )[0]!.id;
}

const goodwill = (amount: string, way = "cash"): GiveBackRequest => ({
  purpose: "goodwill",
  amount,
  extra: "0.00",
  way,
});

/** Previews `request` on the till and presses Give back with what it planned. */
async function giveBack(saleId: string, request: GiveBackRequest) {
  const path = `/api/transactions/${saleId}/give-back`;
  const previewed = await send(venue.app, adminCookie, "POST", `${path}/preview`, request);
  expect(previewed.status, JSON.stringify(previewed.json)).toBe(200);
  const answer = await send(venue.app, adminCookie, "POST", path, {
    ...request,
    reasonId,
    note: "Cold",
    submissionIds: {
      refund: randomUUID(),
      extra: randomUUID(),
      correction: randomUUID(),
      leg: randomUUID(),
    },
    expected: (previewed.json as unknown as GiveBackPlan).parts,
    ...(request.way === "cash" ? {} : { manualConfirmed: true, override: supervisor() }),
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  const parts = (answer.json as { parts: { correctionId?: string }[] }).parts;
  return { correctionId: parts.find((each) => each.correctionId !== undefined)!.correctionId! };
}

/** Every invoice filed against `saleId`: its record's type, series, customer and total in cents. */
function correctivesOf(saleId: string) {
  return venue.db.all<{
    tipoFactura: string;
    tipoRectificativa: string;
    purpose: string;
    customer: string | null;
    total: number;
  }>(sql`
    select r.tipo_factura as tipoFactura, r.tipo_rectificativa as tipoRectificativa,
           ser.purpose as purpose, s.counterparty_tax_id as customer, s.total as total
    from sales s
    join invoice_series ser on ser.id = s.series_id
    join verifactu_records r on r.sale_id = s.id
    where s.corrects_sale_id = ${saleId}
    order by s.invoice_number`);
}

const r1 = (total: number, tipoRectificativa = "I") => ({
  tipoFactura: "R1",
  tipoRectificativa,
  purpose: "full_corrective",
  customer: "B12345674",
  total,
});

async function correctionOf(correctionId: string) {
  const [row] = await venue.db
    .select({ state: invoiceCorrections.state, corrective: invoiceCorrections.correctiveSaleId })
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  return row!;
}

function refundStates(saleId: string) {
  return venue.db.all<{ applied: number; state: string }>(
    sql`select applied_amount as applied, state from refunds where sale_id = ${saleId}
        order by applied_amount`,
  );
}

const refundDeps = (backend = venue.backend) => ({
  db: venue.db,
  backend,
  clock: venue.clock,
  admission: testTradingAdmission(),
  cfg: venue.cfg,
  refundProviderFor: refundProvidersOf({ pool: venue.pool }),
});

const sweep = () => sweepInvoiceCorrections(refundDeps(), venue.clock.now().instant);

/** The card provider's next lookup of any refund finds it made. */
function providerMadeIt(refundId: string) {
  venue.card.scriptLookups({
    kind: "match",
    providerRefundRef: `confirmed-${refundId}`,
    outcome: "completed",
    providerStatus: "succeeded",
  });
}

/** A €10.00 goodwill correction on a reader-paid full invoice, its card leg sent and unanswered. */
async function readerLegUnanswered() {
  const saleId = await fullInvoice({ reader: "37.00" });
  venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
  const opened = await giveBack(saleId, goodwill("10.00", tenderOf(saleId, "card")));
  expect(refundStates(saleId)).toEqual([{ applied: 1000, state: "pending" }]);
  expect(correctivesOf(saleId)).toEqual([]);
  const [leg] = venue.db.all<{ id: string }>(sql`select id from refunds where sale_id = ${saleId}`);
  return { saleId, correctionId: opened.correctionId, refundId: leg!.id };
}

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

function dashboard(): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      isPrimary: () => true,
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
      ring: RING,
      environment: "preproduction",
      pool: venue.pool,
      providers: [],
    },
    () => {},
  );
  return app;
}

describe("a corrective full invoice is filed by whatever finishes the money", () => {
  it("files one R1 when a late card answer completes the leg (row 3)", async () => {
    const { saleId, correctionId, refundId } = await readerLegUnanswered();
    providerMadeIt(refundId);
    await recoverTenderRefunds(refundDeps());
    expect(refundStates(saleId)).toEqual([{ applied: 1000, state: "completed" }]);
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
  });

  it("files one R1 on the sweep at start for a leg whose own filing failed (row 3)", async () => {
    const saleId = await fullInvoice({ cash: "20.00" }, { card: "17.00" });
    const { correctionId } = await giveBack(saleId, goodwill("25.00"));
    const broken = Object.create(venue.backend, {
      checkIntegrity: {
        value: () =>
          Promise.resolve({
            ok: false,
            checked: 1,
            issues: [{ code: "predecessor-hash-mismatch", params: {} }],
          }),
      },
    }) as typeof venue.backend;
    const leg = await send(
      venue.appWith({ backend: broken }),
      adminCookie,
      "POST",
      `/api/transactions/${saleId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId: tenderOf(saleId, "card"),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Goodwill",
        manualConfirmed: true,
        invoiceCorrectionId: correctionId,
        override: supervisor(),
      },
    );
    expect(leg.status, JSON.stringify(leg.json)).toBe(200);
    expect(correctivesOf(saleId)).toEqual([]);

    await sweep();
    expect(correctivesOf(saleId)).toEqual([r1(-2500)]);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
  });

  it("settles the leg on the till's Check again, filing nothing; the sweep files one R1 (row 4)", async () => {
    const { saleId, refundId } = await readerLegUnanswered();
    providerMadeIt(refundId);
    const retried = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/tender-refunds/${refundId}/retry`,
      {},
    );
    expect(retried.json).toMatchObject({ state: "completed" });
    expect(correctivesOf(saleId)).toEqual([]);
    await sweep();
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
  });

  it("settles the leg on the dashboard's resolve, filing nothing; the sweep files one R1 (row 5)", async () => {
    const { saleId, refundId } = await readerLegUnanswered();
    providerMadeIt(refundId);
    const resolved = await send(
      dashboard(),
      managerCookie,
      "POST",
      `/management-api/payments/tender-refunds/${refundId}/resolve`,
      {},
    );
    expect(resolved).toEqual({ status: 200, json: { outcome: "completed" } });
    expect(correctivesOf(saleId)).toEqual([]);
    await sweep();
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
  });

  it("files an R1 against a full invoice's replacement (an R4 by replacement) (row 1)", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    const replacementId = await inTx(venue, async (tx) => {
      await refusedByAeat(tx, saleId);
      const session = await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: venue.adminId,
        pin: "1234",
      });
      const replaced = await recordReplacement(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "full_corrective")),
        correctsSaleId: brandSaleId(saleId),
        authz: { sessionId: session.id },
        clock: venue.clock,
      });
      return replaced.saleId as string;
    });
    expect(correctivesOf(saleId)).toEqual([
      { ...r1(3700, "S"), tipoFactura: "R4", purpose: "full_corrective" },
    ]);

    await giveBack(saleId, goodwill("10.00"));
    expect(correctivesOf(replacementId)).toEqual([r1(-1000)]);
    expect(correctivesOf(saleId)).toEqual([
      { ...r1(3700, "S"), tipoFactura: "R4", purpose: "full_corrective" },
    ]);
  });
});

describe("a correction that can no longer be filed ends unrecorded", () => {
  it("on an invoice another box issued, Finish ends it with its refunds kept and no corrective (row 6)", async () => {
    const saleId = await fullInvoice({ cash: "20.00" }, { card: "17.00" });
    const { correctionId } = await giveBack(saleId, goodwill("25.00"));
    expect(refundStates(saleId)).toEqual([{ applied: 2000, state: "completed" }]);
    const admission = vi
      .spyOn(venue.backend, "correctionAdmissionFor")
      .mockResolvedValue({ eligible: false, reason: "wrong_node", fullInvoice: true });
    onTestFinished(() => admission.mockRestore());

    const finished = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/close`,
      {},
    );
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
    expect(finished.json).toMatchObject({
      state: "closed",
      moneyBack: "20.00",
      correctiveSaleId: null,
    });
    expect(correctivesOf(saleId)).toEqual([]);
    expect(refundStates(saleId)).toEqual([{ applied: 2000, state: "completed" }]);
  });

  it("opened while queued, a leg pending when AEAT refuses the invoice (1112): nothing filed, one alert, Finish ends it", async () => {
    const { saleId, correctionId, refundId } = await readerLegUnanswered();
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    providerMadeIt(refundId);
    await recoverTenderRefunds(refundDeps());
    await sweep();

    expect(refundStates(saleId)).toEqual([{ applied: 1000, state: "completed" }]);
    expect(correctivesOf(saleId)).toEqual([]);
    expect(
      await venue.db
        .select({ code: incidents.code, params: incidents.params })
        .from(incidents)
        .where(eq(incidents.saleId, saleId)),
    ).toEqual([
      {
        code: "invoice_correction.filing_refused",
        params: {
          correctionId,
          saleId,
          moneyBack: "10.00",
          refusal: "sale.correction_not_admitted",
        },
      },
    ]);

    const finished = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/close`,
      {},
    );
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
    expect(finished.json).toMatchObject({ state: "closed", correctiveSaleId: null });
    expect(correctivesOf(saleId)).toEqual([]);
    expect(refundStates(saleId)).toEqual([{ applied: 1000, state: "completed" }]);
  });
});
