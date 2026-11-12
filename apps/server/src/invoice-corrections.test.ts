import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  adjustmentReasons,
  drawerOpens,
  invoiceCorrectionRefunds,
  invoiceCorrections,
  saleLines,
  sales,
  tenderRefunds,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createAdjustmentReason, listAdjustmentReasons } from "@waitron/adjustments";
import { createProduct } from "@waitron/catalogue";
import { previewCorrectionAmounts } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { latestRecord } from "@waitron/fiscal-verifactu/src/clock-behind.js";
import { hashPin, loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  businessDayAt,
  centsToDecimal,
  decimal,
  decimalToCents,
  saleId as brandSaleId,
} from "@waitron/shared";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { parkOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { carryNewTenderRefund } from "./tender-refund-completion.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import {
  closeInvoiceCorrection,
  fileCorrectionIn,
  fileInvoiceCorrectionNow,
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
} from "./invoice-corrections.js";
import { giveCorrectionCash, parseCorrectionCash } from "./invoice-correction-cash.js";
import { mountReportApi, resolveVenueClock } from "./report-api.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { systemClock } from "./till-backend.js";
import { offerProducts } from "./testing/zone-offers.js";

let venue: BillVenue;
let offerOf: (name: string) => string;
let managerId: string;
let managerSessionId: string;
let reasonId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const [category] = db.all<{ id: string }>(
        sql`select id from categories where name = 'Platos'`,
      );
      const [catalogue] = db.all<{ id: string }>(sql`select id from catalogues limit 1`);
      const ids = new Map<string, string>();
      for (const [name, price] of [
        ["Rib steak", "12.10"],
        ["Set menu", "40.00"],
        ["Rice platter", "10.00"],
      ] as const) {
        const product = await createProduct(tx, {
          catalogueId: catalogue!.id,
          categoryId: category!.id,
          name,
          customerName: { [venue.cfg.locale]: `House ${name}` },
          kitchenName: name.toUpperCase(),
          pricingUnit: "each",
          unitPrice: price,
          vatClass: "general",
        });
        ids.set(name, product.id);
      }
      const soup = await createProduct(tx, {
        catalogueId: catalogue!.id,
        categoryId: category!.id,
        name: "Cold soup",
        customerName: { [venue.cfg.locale]: "House Cold soup" },
        kitchenName: "COLD SOUP",
        pricingUnit: "each",
        unitPrice: "5.50",
        vatClass: "reduced",
      });
      ids.set("Cold soup", soup.id);
      const offers = await offerProducts(tx, venue.cfg, { zone: { zoneId: venue.zoneId } });
      offerOf = (name) => offers.offerFor(ids.get(name)!);
      const [manager] = await tx
        .insert(persons)
        .values({ displayName: "Marta", pinHash: hashPin("8888"), role: "manager" })
        .returning({ id: persons.id });
      managerId = manager!.id;
      managerSessionId = (
        await loginWithPin(tx, { deviceId: venue.deviceId, personId: managerId, pin: "8888" })
      ).id;
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
    });
  },
});

/** A counter order of `dish`, paid through the till in `parts` (cash, or a hand-keyed card), each
 * part with `tip` on top; its invoice, issued unpaid when `parts` is empty. */
async function soldForCash(
  dish: string | readonly string[],
  parts: readonly (string | { card: string })[],
  tip = "0.00",
) {
  const id = randomUUID();
  const deps = {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: (typeof dish === "string" ? [dish] : dish).map((name) => ({
      menuItemId: offerOf(name),
      quantity: "1",
    })),
    zoneId: venue.zoneId,
    operatorId: venue.operatorId,
  });
  if (parts.length === 0) await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  await payFor(id, parts, tip);
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
  return brandSaleId(sale!.id);
}

async function payFor(id: string, parts: readonly (string | { card: string })[], tip = "0.00") {
  for (const part of parts) {
    const applied = typeof part === "string" ? part : part.card;
    const tendered = centsToDecimal(
      decimalToCents(decimal(applied)) + decimalToCents(decimal(tip)),
    );
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: applied,
      ...(typeof part === "string"
        ? { method: "cash", tendered }
        : { method: "card", entry: "manual" }),
      applied,
      tip,
      ...(tip === "0.00" ? {} : { addedTip: tip }),
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, id)),
    });
    expect(paid.status).toBe(200);
  }
}

const deps = (clock: TrustedClock = venue.clock) => ({
  backend: venue.backend,
  clock,
  attendance: recordAttendanceFact,
});
const actor = () => ({
  personId: managerId,
  authorization: { authorizedBy: managerId, permission: "sale.rectify", viaOverride: false },
});

async function open(
  saleId: ReturnType<typeof brandSaleId>,
  ask: {
    submissionId: string;
    gross: string;
    note?: string | null;
    reasonId?: string;
    lineIds?: string[];
    split?: { rate: string; base: string; tax: string }[];
    backend?: typeof venue.backend;
    clock?: TrustedClock;
  },
) {
  const scope = ask.lineIds === undefined ? {} : { lineIds: ask.lineIds };
  const split =
    ask.split ??
    (
      await inTx(venue, (tx) =>
        previewCorrectionAmounts(tx, venue.backend, saleId, venue.cfg.nodeId, {
          gross: decimal(ask.gross),
          ...scope,
        }),
      )
    ).vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
  return inTx(venue, (tx) =>
    openInvoiceCorrection(
      tx,
      { ...deps(ask.clock), backend: ask.backend ?? venue.backend },
      venue.cfg,
      saleId,
      parseInvoiceCorrection({
        submissionId: ask.submissionId,
        gross: ask.gross,
        ...scope,
        reasonId: ask.reasonId ?? reasonId,
        note: ask.note === undefined ? "Overcooked" : ask.note,
        expectedSplit: split,
      }),
      actor(),
    ),
  );
}

async function lineIdsOfSale(saleId: string) {
  const rows = await venue.db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));
  return rows.map((row) => row.id);
}

async function original(saleId: string) {
  const [sale] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
  const lines = await venue.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
  const records = venue.db.all(sql`select * from registros_facturacion where sale_id = ${saleId}`);
  return { sale, lines, records };
}

function counts() {
  const [row] = venue.db.all<{
    invoices: number;
    refunds: number;
    drawers: number;
    corrections: number;
  }>(sql`
    select (select count(*) from sales) as invoices,
           (select count(*) from invoice_corrections) as corrections,
           (select count(*) from tender_refunds) as refunds,
           (select count(*) from print_jobs where kind = 'drawer') as drawers`);
  return row!;
}

/** A completed goodwill return of `amount` from the sale's first cash payment; a leg of
 * `correctionId` when named. A repeat of `submissionId` answers the first refund, carrying nothing. */
async function giveBack(
  saleId: string,
  amount: string,
  correctionId?: string,
  {
    submissionId = randomUUID(),
    tipAmount = "0.00",
  }: { submissionId?: string; tipAmount?: string } = {},
) {
  return inTx(venue, async (tx) => {
    const [cash] = await readRefundableTenders(tx, saleId);
    const reading = venue.clock.now();
    const begun = await reserveTenderRefund(
      tx,
      venue.cfg,
      saleId,
      {
        submissionId,
        tenderId: cash!.tenderId,
        appliedAmount: amount,
        tipAmount,
        reason: "Goodwill",
        ...(correctionId === undefined
          ? {}
          : { invoiceCorrection: { id: correctionId, requestId: randomUUID() } }),
      },
      { requestedBy: managerId, authorizedBy: managerId },
      reading.instant.toISOString(),
    );
    if (!begun.replayed)
      await carryNewTenderRefund(tx, deps(), venue.cfg.nodeId, reading, begun.refund);
    return { id: begun.refund.id, replayed: begun.replayed };
  });
}

/** Runs `attempt`, expecting it refused with `error`, and checks it wrote nothing. */
async function refusedWithNothingWritten(attempt: () => Promise<unknown>, error: object) {
  const before = counts();
  await expect(attempt()).rejects.toMatchObject(error);
  expect(counts()).toEqual(before);
}

const STEAK_HALF = [{ rate: "21.00", base: "5.00", tax: "1.05" }];

describe("openInvoiceCorrection", () => {
  it("opens a €6.05 correction of a €12.10 cash steak, filing nothing and moving no money", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const before = await original(saleId);
    expect(
      await inTx(venue, (tx) =>
        previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
          gross: "6.05",
        }),
      ),
    ).toMatchObject({ gross: "6.05", vatBreakdown: STEAK_HALF, moneyRefundable: "12.10" });
    const was = counts();

    const { correction, replayed } = await open(saleId, {
      submissionId: randomUUID(),
      gross: "6.05",
    });

    expect(replayed).toBe(false);
    expect(correction).toEqual({
      id: expect.any(String),
      saleId,
      state: "open",
      gross: "6.05",
      moneyBack: "0.00",
      pending: "0.00",
      left: "6.05",
      reason: expect.stringMatching(/: Overcooked$/),
      openedAt: expect.any(String),
      correctiveSaleId: null,
      legs: [],
      fileNow: null,
    });
    expect(counts()).toEqual({ ...was, corrections: was.corrections + 1 });
    expect(await original(saleId)).toEqual(before);
    expect(
      await venue.db
        .select()
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.id, correction.id)),
    ).toMatchObject([
      {
        originalSaleId: saleId,
        gross: 605,
        lineIds: null,
        requestedBy: managerId,
        authorizedBy: managerId,
        viaOverride: false,
        nodeId: venue.cfg.nodeId,
        endedAt: null,
        endedBy: null,
      },
    ]);
    expect(
      await inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correction.id)),
    ).toEqual(correction);
  });

  it("answers the same request again with the first correction, writing nothing", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const ask = { submissionId: randomUUID(), gross: "6.05" };
    const first = await open(saleId, ask);
    const after = counts();

    const again = await open(saleId, ask);

    expect(counts()).toEqual(after);
    expect(again).toEqual({ ...first, replayed: true });
  });

  it("refuses the same submission id with a different note", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const submissionId = randomUUID();
    await open(saleId, { submissionId, gross: "6.05" });
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId, gross: "6.05", note: "Too salty" }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("accepts the split the till showed in any rate order", async () => {
    const saleId = await soldForCash(["Rib steak", "Cold soup"], ["17.60"]);
    const lineIds = (await lineIdsOfSale(saleId)).sort();
    const preview = await inTx(venue, (tx) =>
      previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
        gross: "17.60",
        lineIds,
      }),
    );
    expect(preview.vatBreakdown).toEqual([
      { rate: "10.00", base: "5.00", tax: "0.50" },
      { rate: "21.00", base: "10.00", tax: "2.10" },
    ]);

    const result = await open(saleId, {
      submissionId: randomUUID(),
      gross: "17.60",
      lineIds,
      split: [...preview.vatBreakdown].reverse(),
    });

    expect(result.correction).toMatchObject({ gross: "17.60" });
  });

  it("answers a repeat whose line ids and split come in another order with the first answer", async () => {
    const saleId = await soldForCash(["Rib steak", "Cold soup"], ["17.60"]);
    const lineIds = (await lineIdsOfSale(saleId)).sort();
    const submissionId = randomUUID();
    const first = await open(saleId, { submissionId, gross: "8.80", lineIds });
    const split = await inTx(venue, (tx) =>
      previewCorrectionAmounts(tx, venue.backend, saleId, venue.cfg.nodeId, {
        gross: decimal("8.80"),
        lineIds,
      }),
    );
    const after = counts();

    const again = await open(saleId, {
      submissionId,
      gross: "8.80",
      lineIds: [...lineIds].reverse(),
      split: [...split.vatBreakdown].reverse(),
    });

    expect(again).toEqual({ ...first, replayed: true });
    expect(counts()).toEqual(after);
  });

  it("refuses a second correction while one is unfinished, naming it", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const first = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    const ask = { submissionId: randomUUID(), gross: "2.00" };
    await refusedWithNothingWritten(() => open(saleId, ask), {
      code: "invoice_correction.already_open",
      params: { saleId, correctionId: first.correction.id },
    });
    await expect(
      inTx(venue, (tx) =>
        previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
          gross: "2.00",
        }),
      ),
    ).rejects.toMatchObject({ code: "invoice_correction.already_open" });

    await venue.db
      .update(invoiceCorrections)
      .set({ state: "discarded", endedAt: new Date().toISOString(), endedBy: managerId })
      .where(eq(invoiceCorrections.id, first.correction.id));

    await expect(open(saleId, ask)).resolves.toMatchObject({
      correction: { state: "open", gross: "2.00" },
    });
  });

  it("the preview refuses an unpaid ticket with the same code as opening", async () => {
    const saleId = await soldForCash("Rib steak", []);
    const refusal = { code: "invoice_correction.not_settled", params: { saleId } };
    await expect(
      inTx(venue, (tx) =>
        previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
          gross: "6.05",
        }),
      ),
    ).rejects.toMatchObject(refusal);
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId: randomUUID(), gross: "6.05", split: STEAK_HALF }),
      refusal,
    );
  });

  it("reads the money back over the correction's refunds", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    const read = () =>
      inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correction.id));

    await giveBack(saleId, "4.00", correction.id);
    expect(await read()).toMatchObject({
      moneyBack: "4.00",
      pending: "0.00",
      left: "2.05",
      legs: [{ state: "completed", appliedAmount: "4.00" }],
      fileNow: { gross: "4.00", vatBreakdown: [{ rate: "21.00", base: "3.31", tax: "0.69" }] },
    });
    expect(
      await venue.db
        .select({ reason: tenderRefunds.reason })
        .from(tenderRefunds)
        .where(eq(tenderRefunds.saleId, saleId)),
    ).toEqual([{ reason: correction.reason }]);
  });

  it("reads a filing refusal as what filing now would answer, and whether Close can end it", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    await giveBack(saleId, "4.00", correction.id);
    const admittingNot = (reason: string) =>
      Object.create(venue.backend, {
        correctionAdmissionFor: { value: async () => ({ eligible: false, reason }) },
      }) as typeof venue.backend;
    const readWith = (backend: typeof venue.backend) =>
      inTx(venue, (tx) => readInvoiceCorrection(tx, backend, venue.cfg, correction.id));

    expect(await readWith(admittingNot("voided"))).toMatchObject({
      moneyBack: "4.00",
      fileNow: { refusal: "sale.correction_not_admitted", closable: true },
    });
    expect(await readWith(admittingNot("filing_refused"))).toMatchObject({
      moneyBack: "4.00",
      fileNow: { refusal: "sale.correction_not_admitted", closable: false },
    });
  });

  it("refuses to read a correction that does not exist", async () => {
    const correctionId = randomUUID();
    await expect(
      inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correctionId)),
    ).rejects.toMatchObject({ code: "invoice_correction.not_found", params: { correctionId } });
  });
});

async function correctionRow(correctionId: string) {
  const [row] = await venue.db
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  return row!;
}

async function fileAll(correctionId: string, backend = venue.backend) {
  return inTx(venue, (tx) =>
    fileCorrectionIn(
      tx,
      { ...deps(), backend },
      venue.cfg,
      correctionId,
      { sessionId: managerSessionId },
      managerId,
    ),
  );
}

describe("fileCorrectionIn", () => {
  it("files a correction's R5 for the money its refunds gave back and marks it filed", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const before = await original(saleId);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "8.00" });
    await giveBack(saleId, "4.00", correction.id);
    await giveBack(saleId, "2.05", correction.id);
    const was = counts();

    const correctiveSaleId = await fileAll(correction.id);

    expect(counts()).toEqual({ ...was, invoices: was.invoices + 1 });
    const [corrective] = await venue.db.select().from(sales).where(eq(sales.id, correctiveSaleId));
    expect(corrective).toMatchObject({
      correctsSaleId: saleId,
      total: -605,
      vatBreakdown: [{ rate: "21.00", base: "-5.00", tax: "-1.05" }],
    });
    expect(await correctionRow(correction.id)).toMatchObject({
      state: "filed",
      correctiveSaleId,
      endedAt: expect.any(String),
      endedBy: managerId,
    });
    expect(await original(saleId)).toEqual(before);
  });

  it("refuses a correction already filed, filing nothing more", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    await giveBack(saleId, "6.05", correction.id);
    await fileAll(correction.id);
    let checks = 0;
    const counting = Object.create(venue.backend, {
      checkIntegrity: {
        value: (...args: Parameters<typeof venue.backend.checkIntegrity>) => {
          checks += 1;
          return venue.backend.checkIntegrity(...args);
        },
      },
    }) as typeof venue.backend;

    await refusedWithNothingWritten(() => fileAll(correction.id, counting), {
      code: "invoice_correction.not_open",
      params: { correctionId: correction.id, state: "filed" },
    });
    expect(checks).toBe(0);
  });

  it("refuses a correction with no money back, and files once some is back", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });

    await refusedWithNothingWritten(() => fileAll(correction.id), {
      code: "invoice_correction.nothing_back",
      params: { correctionId: correction.id },
    });

    await giveBack(saleId, "1.00", correction.id);
    const correctiveSaleId = await fileAll(correction.id);
    const [corrective] = await venue.db.select().from(sales).where(eq(sales.id, correctiveSaleId));
    expect(corrective).toMatchObject({ total: -100 });
  });
});

describe("a correction's legs", () => {
  it("refuses an ordinary refund on a ticket with an unfinished correction, and allows it once the correction ends", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const earlier = { submissionId: randomUUID(), amount: "1.00" };
    const ordinary = (submissionId: string, amount: string) =>
      giveBack(saleId, amount, undefined, { submissionId });
    const first = await ordinary(earlier.submissionId, earlier.amount);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });

    await refusedWithNothingWritten(() => ordinary(randomUUID(), "1.00"), {
      code: "invoice_correction.already_open",
      params: { saleId, correctionId: correction.id },
    });
    await expect(ordinary(earlier.submissionId, earlier.amount)).resolves.toEqual({
      id: first.id,
      replayed: true,
    });

    await giveBack(saleId, "6.05", correction.id);
    await fileAll(correction.id);

    await expect(ordinary(randomUUID(), "1.00")).resolves.toMatchObject({ replayed: false });
  });

  it("refuses a leg on a correction of another ticket, or one already ended", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const other = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(other, { submissionId: randomUUID(), gross: "6.05" });

    await refusedWithNothingWritten(() => giveBack(saleId, "1.00", correction.id), {
      code: "invoice_correction.not_open",
      params: { correctionId: correction.id, state: "open" },
    });

    const smuggled = async () => {
      const [row] = await venue.db
        .select()
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.id, correction.id));
      return inTx(venue, async (tx) => {
        const [cash] = await readRefundableTenders(tx, saleId);
        return reserveTenderRefund(
          tx,
          venue.cfg,
          saleId,
          {
            submissionId: randomUUID(),
            tenderId: cash!.tenderId,
            appliedAmount: "1.00",
            tipAmount: "0.00",
            reason: "Goodwill",
            invoiceCorrection: {
              id: correction.id,
              requestId: randomUUID(),
              read: { correction: { ...row!, originalSaleId: saleId }, left: 1210 },
            } as { id: string; requestId: string },
          },
          { requestedBy: managerId, authorizedBy: managerId },
          venue.clock.now().instant.toISOString(),
        );
      });
    };
    await refusedWithNothingWritten(smuggled, {
      code: "invoice_correction.not_open",
      params: { correctionId: correction.id, state: "open" },
    });

    await giveBack(other, "6.05", correction.id);
    await fileAll(correction.id);
    await refusedWithNothingWritten(() => giveBack(other, "1.00", correction.id), {
      code: "invoice_correction.not_open",
      params: { correctionId: correction.id, state: "filed" },
    });
  });
});

describe("a correction's leg refuses", () => {
  it("more than the correction has left, naming it, and takes what is left", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    await giveBack(saleId, "4.00", correction.id);
    await refusedWithNothingWritten(() => giveBack(saleId, "2.06", correction.id), {
      code: "invoice_correction.leg_too_large",
      params: { correctionId: correction.id, left: "2.05" },
    });
    await giveBack(saleId, "2.05", correction.id);
    expect(
      await inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correction.id)),
    ).toMatchObject({ moneyBack: "6.05", left: "0.00" });
  });

  it("a tip", async () => {
    const saleId = await soldForCash("Rib steak", []);
    const [sale] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
    await payFor(sale!.workingOrderId!, ["12.10"], "1.00");
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "12.10" });
    await refusedWithNothingWritten(
      () => giveBack(saleId, "12.10", correction.id, { tipAmount: "1.00" }),
      { code: "management.request_invalid", params: { field: "tipAmount" } },
    );
  });
});

const MINUTE = 60_000;

async function behindLatestRecord(): Promise<TrustedClock> {
  const latest = await inTx(venue, (tx) => latestRecord(tx));
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(latest!.at.getTime() - 2 * MINUTE) };
  return { ...base, now: () => reading };
}

describe("openInvoiceCorrection refuses", () => {
  it("an invoice not yet paid, and opens once it is paid in cash", async () => {
    const saleId = await soldForCash("Rib steak", []);
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId: randomUUID(), gross: "6.05" }),
      { code: "invoice_correction.not_settled", params: { saleId } },
    );
    const [sale] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
    await payFor(sale!.workingOrderId!, ["12.10"]);
    await expect(
      open(saleId, { submissionId: randomUUID(), gross: "6.05" }),
    ).resolves.toMatchObject({ correction: { state: "open" } });
  });

  it("a reason that is not a Void reason, and opens with a Void reason", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const reasons = await inTx(venue, (tx) => listAdjustmentReasons(tx));
    const comp = reasons.find((reason) => reason.kind === "comp")!;
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId: randomUUID(), gross: "6.05", reasonId: comp.id }),
      { code: "adjustment.action_not_allowed" },
    );
    const voidReason = reasons.find((reason) => reason.kind === "void" && !reason.noteRequired)!;
    await expect(
      open(saleId, { submissionId: randomUUID(), gross: "6.05", reasonId: voidReason.id }),
    ).resolves.toMatchObject({ correction: { state: "open" } });
  });

  it("a reason that asks for a note when none is given, and opens with the note", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const other = (await inTx(venue, (tx) => listAdjustmentReasons(tx))).find(
      (reason) => reason.kind === "void" && reason.noteRequired,
    )!;
    for (const note of [null, "   "])
      await refusedWithNothingWritten(
        () => open(saleId, { submissionId: randomUUID(), gross: "6.05", reasonId: other.id, note }),
        { code: "adjustment.note_required" },
      );
    await expect(
      open(saleId, {
        submissionId: randomUUID(),
        gross: "6.05",
        reasonId: other.id,
        note: "Wrong table",
      }),
    ).resolves.toMatchObject({ correction: { reason: `${other.name}: Wrong table` } });
  });

  it("nothing on a repeat whose reason has since come to ask for a note, answering the first result", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Spilt ${randomUUID()}`,
        names: {},
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
        noteRequired: false,
      }),
    );
    const ask = { submissionId: randomUUID(), gross: "6.05", reasonId: reason.id, note: null };
    const first = await open(saleId, ask);
    await venue.db
      .update(adjustmentReasons)
      .set({ noteRequired: true })
      .where(eq(adjustmentReasons.id, reason.id));
    const after = counts();

    await expect(open(saleId, ask)).resolves.toEqual({ ...first, replayed: true });
    expect(counts()).toEqual(after);
  });

  it.each([[[{ card: "40.00" }]], [["20.00", { card: "20.00" }]]])(
    "an invoice with a payment that is not cash (%j)",
    async (parts) => {
      const saleId = await soldForCash("Set menu", parts);
      await refusedWithNothingWritten(
        () => open(saleId, { submissionId: randomUUID(), gross: "5.00" }),
        { code: "invoice_correction.not_cash", params: { saleId } },
      );
    },
  );

  it("more than the money left, naming €7.00 after €3.00 of €10.00 went back, and opens €7.00", async () => {
    const saleId = await soldForCash("Rice platter", ["10.00"]);
    await giveBack(saleId, "3.00");
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId: randomUUID(), gross: "10.00" }),
      {
        code: "invoice_correction.money_short",
        params: { saleId, moneyLeft: "7.00", gross: "10.00" },
      },
    );
    await expect(
      open(saleId, { submissionId: randomUUID(), gross: "7.00" }),
    ).resolves.toMatchObject({ correction: { gross: "7.00" } });
  });

  it("a split that differs from the one the till showed, answering the fresh one", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    await refusedWithNothingWritten(
      () =>
        open(saleId, {
          submissionId: randomUUID(),
          gross: "6.05",
          split: [{ rate: "21.00", base: "4.99", tax: "1.06" }],
        }),
      {
        code: "invoice_correction.split_changed",
        params: { saleId, gross: "6.05", vatBreakdown: STEAK_HALF, moneyRefundable: "12.10" },
      },
    );
    await expect(
      open(saleId, {
        submissionId: randomUUID(),
        gross: "6.05",
        split: [{ rate: "21", base: "5.0", tax: "1.05" }],
      }),
    ).resolves.toMatchObject({ correction: { gross: "6.05" } });
  });

  it("while the fiscal chain's check reports an issue, and opens once it reports none", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const broken = Object.create(venue.backend, {
      checkIntegrity: {
        value: async () => ({
          ok: false,
          checked: 1,
          issues: [{ code: "predecessor-hash-mismatch", params: {} }],
        }),
      },
    }) as typeof venue.backend;
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId: randomUUID(), gross: "6.05", backend: broken }),
      { code: "invoice_correction.chain_unsound", params: { saleId } },
    );
    await expect(
      open(saleId, { submissionId: randomUUID(), gross: "6.05" }),
    ).resolves.toMatchObject({ correction: { state: "open" } });
  });

  it("while the clock reads more than a minute behind the latest record, and opens on time", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const clock = await behindLatestRecord();
    await refusedWithNothingWritten(
      () => open(saleId, { submissionId: randomUUID(), gross: "6.05", clock }),
      { code: "clock.behind_chain" },
    );
    await expect(
      open(saleId, { submissionId: randomUUID(), gross: "6.05" }),
    ).resolves.toMatchObject({ correction: { state: "open" } });
  });
});

/** `amount` in cash on the correction `correctionId`, given by the manager. */
async function cash(
  correctionId: string,
  amount: string,
  submissionId: string = randomUUID(),
  backend = venue.backend,
  clock: TrustedClock = venue.clock,
) {
  return inTx(venue, (tx) =>
    giveCorrectionCash(
      tx,
      { ...deps(clock), backend },
      venue.cfg,
      correctionId,
      parseCorrectionCash({ submissionId, amount }),
      {
        personId: managerId,
        authz: { sessionId: managerSessionId },
        authorization: { authorizedBy: managerId, permission: "sale.refund", viaOverride: false },
      },
    ),
  );
}

async function drawerOpensFor(refundIds: readonly string[]) {
  return venue.db.select().from(drawerOpens).where(inArray(drawerOpens.tenderRefundId, refundIds));
}

describe("a correction's cash", () => {
  it("gives €15 of a €25 correction in cash, files nothing and leaves €10 to go back", async () => {
    const saleId = await soldForCash("Set menu", ["40.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });
    const was = counts();

    const given = await cash(correction.id, "15.00");

    expect(given.replayed).toBe(false);
    expect(given.refunds).toMatchObject([{ state: "completed", appliedAmount: "15.00" }]);
    expect(given.correction).toMatchObject({
      state: "open",
      moneyBack: "15.00",
      left: "10.00",
      correctiveSaleId: null,
    });
    expect(counts()).toEqual({ ...was, refunds: was.refunds + 1, drawers: was.drawers + 1 });
  });

  it("files −5.00 base and −1.05 VAT off a €12.10 cash steak once its €6.05 is back, opening the drawer once", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const before = await original(saleId);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    const was = counts();

    const given = await cash(correction.id, "6.05");

    expect(given.correction).toMatchObject({ state: "filed", moneyBack: "6.05", left: "0.00" });
    const correctiveSaleId = given.correction.correctiveSaleId!;
    const [corrective] = await venue.db.select().from(sales).where(eq(sales.id, correctiveSaleId));
    expect(corrective).toMatchObject({
      correctsSaleId: saleId,
      total: -605,
      vatBreakdown: [{ rate: "21.00", base: "-5.00", tax: "-1.05" }],
    });
    expect(
      await venue.db.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, saleId)),
    ).toMatchObject([{ method: "cash", state: "completed", appliedAmount: 605, tipAmount: 0 }]);
    expect(await drawerOpensFor(given.refunds.map((refund) => refund.id))).toHaveLength(1);
    expect(counts()).toEqual({
      ...was,
      invoices: was.invoices + 1,
      refunds: was.refunds + 1,
      drawers: was.drawers + 1,
    });
    expect(await correctionRow(correction.id)).toMatchObject({
      state: "filed",
      correctiveSaleId,
      endedBy: managerId,
    });
    expect(await original(saleId)).toEqual(before);
  });

  it("gives €25 back over two €20 cash payments, oldest first, as €20 and €5 with one drawer job", async () => {
    const saleId = await soldForCash("Set menu", ["20.00", "20.00"]);
    const before = await original(saleId);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });
    const paidInOrder = await inTx(venue, (tx) => readRefundableTenders(tx, saleId));
    const was = counts();

    const given = await cash(correction.id, "25.00");

    expect(
      given.refunds.map(({ tenderId, appliedAmount }) => ({ tenderId, appliedAmount })),
    ).toEqual([
      { tenderId: paidInOrder[0]!.tenderId, appliedAmount: "20.00" },
      { tenderId: paidInOrder[1]!.tenderId, appliedAmount: "5.00" },
    ]);
    expect(await drawerOpensFor(given.refunds.map((refund) => refund.id))).toMatchObject([
      { tenderRefundId: given.refunds[0]!.id },
    ]);
    expect(counts().drawers).toBe(was.drawers + 1);
    expect(given.correction).toMatchObject({ state: "filed", moneyBack: "25.00" });
    expect(await original(saleId)).toEqual(before);
  });

  it("links each leg at the request's clock reading and reads the legs back oldest payment first", async () => {
    const saleId = await soldForCash("Set menu", ["8.00", "8.00", "8.00", "8.00", "8.00"]);
    const paidInOrder = await inTx(venue, (tx) => readRefundableTenders(tx, saleId));
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "40.00" });
    const base = systemClock();
    const reading = { ...base.now(), instant: new Date(Date.now() + 30 * MINUTE) };

    await cash(correction.id, "36.00", randomUUID(), venue.backend, {
      ...base,
      now: () => reading,
    });

    const links = await venue.db
      .select({ createdAt: invoiceCorrectionRefunds.createdAt })
      .from(invoiceCorrectionRefunds)
      .where(eq(invoiceCorrectionRefunds.invoiceCorrectionId, correction.id));
    expect(links.map((link) => link.createdAt)).toEqual(
      Array(5).fill(reading.instant.toISOString()),
    );
    const read = await inTx(venue, (tx) =>
      readInvoiceCorrection(tx, venue.backend, venue.cfg, correction.id),
    );
    expect(read.legs.map(({ tenderId, appliedAmount }) => ({ tenderId, appliedAmount }))).toEqual(
      paidInOrder.map(({ tenderId }, index) => ({
        tenderId,
        appliedAmount: index === 4 ? "4.00" : "8.00",
      })),
    );
  });

  it("counts the −€6.05 once in the day's sales and once in its cash", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const cookie = `${MANAGEMENT_COOKIE}=${
      (await inTx(venue, (tx) => startManagementSession(tx, { personId: managerId }))).token
    }`;
    const reports = new Hono();
    mountReportApi(
      reports,
      { db: venue.db, cfg: { nodeId: venue.cfg.nodeId }, venueLocale: "es-ES" },
      () => {},
    );
    const [sold] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
    const day = businessDayAt(
      await inTx(venue, (tx) => resolveVenueClock(tx, venue.cfg.nodeId)),
      new Date(sold!.issuedAt),
    );
    const close = async () => {
      const response = await reports.request(
        `/management-api/reports/daily-close?businessDay=${day}`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        vat: { grossTotal: string };
        cash: { tenderTotal: string };
      };
      const cents = (value: string) => Math.round(Number(value) * 100);
      return { gross: cents(body.vat.grossTotal), cash: cents(body.cash.tenderTotal) };
    };
    const before = await close();

    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    await cash(correction.id, "6.05");

    const after = await close();
    expect({ gross: after.gross - before.gross, cash: after.cash - before.cash }).toEqual({
      gross: -605,
      cash: -605,
    });
  });

  it("answers a repeated cash request with its first legs, and refuses its id with another amount", async () => {
    const saleId = await soldForCash("Set menu", ["20.00", "20.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "30.00" });
    const firstId = randomUUID();
    const first = await cash(correction.id, "25.00", firstId);
    const after = counts();

    const again = await cash(correction.id, "25.00", firstId);

    expect(again).toEqual({ ...first, replayed: true });
    expect(counts()).toEqual(after);
    await refusedWithNothingWritten(() => cash(correction.id, "24.00", firstId), {
      code: "submission.id_reused",
      params: { submissionId: firstId },
    });

    const lastId = randomUUID();
    const last = await cash(correction.id, "5.00", lastId);
    expect(last.correction.state).toBe("filed");
    const filed = counts();
    const lastAgain = await cash(correction.id, "5.00", lastId);
    expect(lastAgain).toMatchObject({ replayed: true, refunds: last.refunds });
    expect(counts()).toEqual(filed);
  });

  it("refuses a second cash request once the corrective is filed", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    await cash(correction.id, "6.05");

    await refusedWithNothingWritten(() => cash(correction.id, "1.00"), {
      code: "invoice_correction.not_open",
      params: { correctionId: correction.id, state: "filed" },
    });
  });

  it("refuses more cash than the correction has left, and more than the cash payments hold", async () => {
    const saleId = await soldForCash("Set menu", ["5.00", "35.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "10.00" });

    await refusedWithNothingWritten(() => cash(correction.id, "15.00"), {
      code: "invoice_correction.leg_too_large",
      params: { correctionId: correction.id, left: "10.00" },
    });
    await refusedWithNothingWritten(() => cash(correction.id, "40.01"), {
      code: "invoice_correction.cash_short",
      params: { correctionId: correction.id, cashLeft: "40.00", amount: "40.01" },
    });
    await expect(cash(correction.id, "7.00")).resolves.toMatchObject({
      refunds: [{ appliedAmount: "5.00" }, { appliedAmount: "2.00" }],
      correction: { left: "3.00" },
    });
    await refusedWithNothingWritten(() => cash(correction.id, "3.01"), {
      code: "invoice_correction.leg_too_large",
      params: { correctionId: correction.id, left: "3.00" },
    });
    await expect(cash(correction.id, "3.00")).resolves.toMatchObject({
      correction: { state: "filed" },
    });
  });

  it("gives the next €10 from the second payment once the first holds only its €1 tip, counting no tip as cash left", async () => {
    const saleId = await soldForCash("Set menu", ["20.00", "20.00"], "1.00");
    const paidInOrder = await inTx(venue, (tx) => readRefundableTenders(tx, saleId));
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "30.00" });
    await refusedWithNothingWritten(() => cash(correction.id, "40.01"), {
      code: "invoice_correction.cash_short",
      params: { correctionId: correction.id, cashLeft: "40.00", amount: "40.01" },
    });
    await cash(correction.id, "20.00");
    await refusedWithNothingWritten(() => cash(correction.id, "20.01"), {
      code: "invoice_correction.cash_short",
      params: { correctionId: correction.id, cashLeft: "20.00", amount: "20.01" },
    });

    const given = await cash(correction.id, "10.00");

    expect(
      given.refunds.map(({ tenderId, appliedAmount, tipAmount }) => ({
        tenderId,
        appliedAmount,
        tipAmount,
      })),
    ).toEqual([{ tenderId: paidInOrder[1]!.tenderId, appliedAmount: "10.00", tipAmount: "0.00" }]);
    expect(given.correction).toMatchObject({ state: "filed", moneyBack: "30.00" });
  });

  it("gives €1.05 from the later payment of a €12.10 steak once €5 has emptied the first, leaving its tip", async () => {
    const saleId = await soldForCash("Rib steak", []);
    const [sale] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
    await payFor(sale!.workingOrderId!, ["5.00"], "1.00");
    await payFor(sale!.workingOrderId!, ["7.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    await cash(correction.id, "5.00");

    await expect(cash(correction.id, "1.05")).resolves.toMatchObject({
      refunds: [{ appliedAmount: "1.05" }],
      correction: { state: "filed", moneyBack: "6.05" },
    });
  });

  it("refuses a malformed submission id or amount, writing nothing", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    for (const [field, submissionId, amount] of [
      ["submissionId", "not-an-id", "1.00"],
      ["amount", randomUUID(), "0.00"],
      ["amount", randomUUID(), "01.00"],
      ["amount", randomUUID(), "1.001"],
    ] as const)
      await refusedWithNothingWritten(() => cash(correction.id, amount, submissionId), {
        code: "management.request_invalid",
        params: { field },
      });
  });

  it("an R5 refused at the last cash leg undoes the leg and its drawer job, and gives it once the chain checks out", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    const broken = Object.create(venue.backend, {
      checkIntegrity: {
        value: async () => ({
          ok: false,
          checked: 1,
          issues: [{ code: "predecessor-hash-mismatch", params: {} }],
        }),
      },
    }) as typeof venue.backend;

    await refusedWithNothingWritten(() => cash(correction.id, "6.05", randomUUID(), broken), {
      code: "invoice_correction.chain_unsound",
      params: { saleId },
    });
    expect(await correctionRow(correction.id)).toMatchObject({ state: "open" });

    await expect(cash(correction.id, "6.05")).resolves.toMatchObject({
      correction: { state: "filed", moneyBack: "6.05" },
    });
  });
});

/** File now for the correction `correctionId`, asked by `personId` with the split the till showed. */
async function fileNow(
  correctionId: string,
  expectedSplit: { rate: string; base: string; tax: string }[],
  { backend = venue.backend, personId = managerId } = {},
) {
  return inTx(venue, (tx) =>
    fileInvoiceCorrectionNow(
      tx,
      { ...deps(), backend },
      venue.cfg,
      correctionId,
      { expectedSplit },
      { personId, authz: { sessionId: managerSessionId } },
    ),
  );
}

async function close(correctionId: string, { backend = venue.backend, personId = managerId } = {}) {
  return inTx(venue, (tx) =>
    closeInvoiceCorrection(tx, { ...deps(), backend }, venue.cfg, correctionId, { personId }),
  );
}

const MENU_FIFTEEN = [{ rate: "21.00", base: "12.40", tax: "2.60" }];

describe("File now and Close", () => {
  it("finishes a €25 correction for the €15 of cash that went back", async () => {
    const saleId = await soldForCash("Set menu", ["40.00"]);
    const before = await original(saleId);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });
    const given = await cash(correction.id, "15.00");
    expect(given.correction.fileNow).toEqual({ gross: "15.00", vatBreakdown: MENU_FIFTEEN });
    const was = counts();

    const filed = await fileNow(correction.id, MENU_FIFTEEN, { personId: venue.operatorId });

    expect(filed).toMatchObject({
      state: "filed",
      gross: "25.00",
      moneyBack: "15.00",
      left: "10.00",
      fileNow: null,
    });
    const [corrective] = await venue.db
      .select()
      .from(sales)
      .where(eq(sales.id, filed.correctiveSaleId!));
    expect(corrective).toMatchObject({
      correctsSaleId: saleId,
      total: -1500,
      vatBreakdown: [{ rate: "21.00", base: "-12.40", tax: "-2.60" }],
    });
    expect(counts()).toEqual({ ...was, invoices: was.invoices + 1 });
    expect(await correctionRow(correction.id)).toMatchObject({
      state: "filed",
      correctiveSaleId: filed.correctiveSaleId,
      endedAt: expect.any(String),
      endedBy: venue.operatorId,
    });
    expect(await original(saleId)).toEqual(before);
  });

  it("refuses to file with nothing back", async () => {
    const saleId = await soldForCash("Set menu", ["40.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });

    await refusedWithNothingWritten(() => fileNow(correction.id, MENU_FIFTEEN), {
      code: "invoice_correction.nothing_back",
      params: { correctionId: correction.id },
    });
    expect(await correctionRow(correction.id)).toMatchObject({ state: "open" });
  });

  it("refuses to file a split other than the one shown, answering the fresh one, and files the fresh one", async () => {
    const saleId = await soldForCash("Set menu", ["40.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });
    await cash(correction.id, "15.00");

    await refusedWithNothingWritten(() => fileNow(correction.id, STEAK_HALF), {
      code: "invoice_correction.split_changed",
      params: {
        saleId,
        gross: "15.00",
        vatBreakdown: MENU_FIFTEEN,
        moneyRefundable: "25.00",
      },
    });
    await expect(fileNow(correction.id, MENU_FIFTEEN)).resolves.toMatchObject({ state: "filed" });
  });

  it("discards a correction with nothing back", async () => {
    const saleId = await soldForCash("Set menu", ["40.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });
    const was = counts();

    const ended = await close(correction.id, { personId: venue.operatorId });

    expect(ended).toMatchObject({
      state: "discarded",
      moneyBack: "0.00",
      correctiveSaleId: null,
      legs: [],
      fileNow: null,
    });
    expect(counts()).toEqual(was);
    expect(await correctionRow(correction.id)).toMatchObject({
      state: "discarded",
      endedAt: expect.any(String),
      endedBy: venue.operatorId,
    });
    await refusedWithNothingWritten(() => close(correction.id), {
      code: "invoice_correction.not_open",
      params: { correctionId: correction.id, state: "discarded" },
    });
    await expect(
      open(saleId, { submissionId: randomUUID(), gross: "25.00" }),
    ).resolves.toMatchObject({ correction: { state: "open" } });
  });

  it("closes keeping the refunds when another box has taken over, and refuses while the ticket's filing is only stopped", async () => {
    const saleId = await soldForCash("Set menu", ["40.00"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "25.00" });
    const { refunds } = await cash(correction.id, "15.00");
    const [record] = (await original(saleId)).records as { id: string }[];
    const filingState = (to: string) =>
      venue.db.run(sql`update envios set estado = ${to} where registro_id = ${record!.id}`);
    const [{ state }] = venue.db.all<{ state: string }>(
      sql`select estado as state from envios where registro_id = ${record!.id}`,
    ) as [{ state: string }];
    filingState("detenido");
    try {
      await refusedWithNothingWritten(() => close(correction.id), {
        code: "invoice_correction.still_correctable",
        params: { correctionId: correction.id },
      });
    } finally {
      filingState(state);
    }

    const takenOver = Object.create(venue.backend, {
      correctionAdmissionFor: {
        value: async () => ({ eligible: false, reason: "wrong_node" }),
      },
    }) as typeof venue.backend;
    await refusedWithNothingWritten(() => cash(correction.id, "10.00", randomUUID(), takenOver), {
      code: "sale.correction_not_admitted",
      params: { reason: "wrong_node" },
    });
    await refusedWithNothingWritten(
      () => fileNow(correction.id, MENU_FIFTEEN, { backend: takenOver }),
      { code: "sale.correction_not_admitted", params: { reason: "wrong_node" } },
    );
    expect(
      await inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correction.id)),
    ).toMatchObject({ state: "open", moneyBack: "15.00", legs: [{ id: refunds[0]!.id }] });
    const was = counts();

    const ended = await close(correction.id, { backend: takenOver });

    expect(ended).toMatchObject({
      state: "closed",
      moneyBack: "15.00",
      correctiveSaleId: null,
      legs: [{ id: refunds[0]!.id, state: "completed", appliedAmount: "15.00" }],
    });
    expect(counts()).toEqual(was);
    expect(await correctionRow(correction.id)).toMatchObject({
      state: "closed",
      endedBy: managerId,
    });
  });
});
