import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { recordReplacement } from "@waitron/core";
import { loadKeyRing } from "@waitron/credentials";
import { incidents, invoiceCorrections, readLiveSeriesIdTx, taxpayer } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  correctiveRecordsOf,
  filedInvoiceOf,
  onOpenChainOf,
} from "@waitron/fiscal-verifactu/test/invoice-records.js";
import {
  acceptedByAeat,
  refusedByAeat,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { loginWithPin, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { refundProvidersOf } from "./bill-refunds.js";
import type { GiveBackRequest } from "./give-back-plan.js";
import { sweepInvoiceCorrections } from "./invoice-correction-alerts.js";
import { mountPaymentsApi } from "./payments-api.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask, r1, type Part } from "./testing/full-invoice-give-back.js";
import { takeOver } from "./testing/taken-over.js";
import { clockAt } from "./testing/deferred-close-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

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
      adminCookie = await fixture.adminTillCookie(tx, venue);
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

const fullInvoice = async (...parts: Part[]) => (await fixture.fullInvoice(venue, ...parts)).saleId;
const tenderOf = (saleId: string, method: "cash" | "card") =>
  fixture.tenderOf(venue, saleId, method);
const goodwill = (amount: string, way = "cash") => ask("goodwill", amount, { way });

/** Previews `request` on the till and presses Give back with what it planned; the correction. */
async function giveBack(saleId: string, request: GiveBackRequest, app = venue.app) {
  const answer = await send(app, adminCookie, "POST", `/api/transactions/${saleId}/give-back`, {
    ...(await fixture.giveBackBody(venue, adminCookie, saleId, request, reasonId, app)),
    ...(request.way === "cash" ? {} : { manualConfirmed: true, override: supervisor() }),
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  const parts = (answer.json as { parts: { correctionId?: string }[] }).parts;
  return { correctionId: parts.find((each) => each.correctionId !== undefined)!.correctionId! };
}

const correctivesOf = (saleId: string) => correctiveRecordsOf(venue.db, saleId);

/** The R4 replacing a full invoice, as `correctiveRecordsOf` reads it. */
const r4 = (total: number) => ({ ...r1(total), type: "R4", by: "replacement" });

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
  it("files one R1 when a late card answer completes the leg", async () => {
    const { saleId, correctionId, refundId } = await readerLegUnanswered();
    providerMadeIt(refundId);
    await recoverTenderRefunds(refundDeps());
    expect(refundStates(saleId)).toEqual([{ applied: 1000, state: "completed" }]);
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
  });

  it("files one R1 on the sweep at start for a leg whose own filing failed", async () => {
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

  it("settles the leg on the till's Check again, filing nothing; the sweep files one R1", async () => {
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

  it("settles the leg on the dashboard's resolve, filing nothing; the sweep files one R1", async () => {
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

  it("files an R1 against a full invoice's replacement (an R4 by replacement)", async () => {
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
    expect(correctivesOf(saleId)).toEqual([r4(3700)]);

    await giveBack(saleId, goodwill("10.00"));
    expect(correctivesOf(replacementId)).toEqual([r1(-1000)]);
    expect(correctivesOf(saleId)).toEqual([r4(3700)]);
  });
});

/** Expects the correction's corrective on `box`'s open chain, naming `saleId`'s issuer, number
 * and issue day; answers the corrective's own issue day. */
async function filedOnChainOf(correctionId: string, box: string, saleId: string) {
  const { corrective } = await correctionOf(correctionId);
  expect(onOpenChainOf(venue.db, corrective!, box)).toBe(true);
  const original = filedInvoiceOf(venue.db, saleId);
  const filed = filedInvoiceOf(venue.db, corrective!);
  expect(filed.corrects).toEqual([
    { issuerTaxId: original.issuerTaxId, number: original.number, issuedOn: original.issuedOn },
  ]);
  return { issuedOn: filed.issuedOn, originalIssuedOn: original.issuedOn };
}

describe("a full invoice another box issued", () => {
  it("once AEAT accepted it, Give back files one R1 on this box's chain naming it", async () => {
    const saleId = await fullInvoice({ cash: "37.00" });
    await acceptedByAeat(venue.db, saleId);
    const box = await takeOver(venue);

    const later = venue.appWith({ clock: clockAt(Date.now() + 3 * 86_400_000) });
    const { correctionId } = await giveBack(saleId, goodwill("10.00"), later);

    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
    const days = await filedOnChainOf(correctionId, box, saleId);
    expect(days.issuedOn).not.toBe(days.originalIssuedOn);
  });

  it("while AEAT has not answered it, the leg completing files nothing and raises no alert; the sweep files one R1 once AEAT accepts it", async () => {
    const { saleId, correctionId, refundId } = await readerLegUnanswered();
    const box = await takeOver(venue);
    providerMadeIt(refundId);
    await recoverTenderRefunds(refundDeps());
    await sweep();

    expect(refundStates(saleId)).toEqual([{ applied: 1000, state: "completed" }]);
    expect(correctivesOf(saleId)).toEqual([]);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "open" });
    expect(
      await venue.db
        .select({ code: incidents.code })
        .from(incidents)
        .where(eq(incidents.saleId, saleId)),
    ).toEqual([]);

    await acceptedByAeat(venue.db, saleId);
    await sweep();

    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
    await filedOnChainOf(correctionId, box, saleId);
  });
});

describe("a correction that can no longer be filed ends unrecorded", () => {
  // `refusedByAeat` opens no filing case, so no fix is on offer whatever FULL_INVOICE_REPLACEMENT_ON
  // says: the refusal is one with no fix (`refused_no_fix`).
  it("opened while queued, a leg pending when AEAT refuses the invoice (1112) with no fix on offer: nothing filed, one alert, Finish ends it", async () => {
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
          fullInvoice: true,
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

describe("the payment check's alerts on a full invoice", () => {
  it("marks the unfinished alert of an open give-back on a full invoice as a full invoice's", async () => {
    const saleId = await fullInvoice({ cash: "20.00" }, { card: "17.00" });
    const { correctionId } = await giveBack(saleId, goodwill("25.00"));
    const later = new Date(venue.clock.now().instant.getTime() + 2 * 3_600_000);
    await sweepInvoiceCorrections(refundDeps(), later);

    expect(
      await venue.db
        .select({ code: incidents.code, params: incidents.params })
        .from(incidents)
        .where(eq(incidents.saleId, saleId)),
    ).toEqual([
      {
        code: "invoice_correction.unfinished",
        params: {
          correctionId,
          saleId,
          moneyBack: "20.00",
          completedSince: expect.any(String),
          fullInvoice: true,
        },
      },
    ]);
  });
});
