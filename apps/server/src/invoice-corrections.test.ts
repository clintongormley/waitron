import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  adjustmentReasons,
  invoiceCorrectionRefunds,
  invoiceCorrections,
  saleLines,
  sales,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createAdjustmentReason, listAdjustmentReasons } from "@waitron/adjustments";
import { createProduct } from "@waitron/catalogue";
import { previewCorrectionAmounts } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { latestRecord } from "@waitron/fiscal-verifactu/src/clock-behind.js";
import { hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, saleId as brandSaleId } from "@waitron/shared";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { parkOrder } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { carryNewTenderRefund } from "./tender-refund-completion.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import {
  openInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
} from "./invoice-corrections.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { systemClock } from "./till-backend.js";
import { offerProducts } from "./testing/zone-offers.js";

let venue: BillVenue;
let offerOf: (name: string) => string;
let managerId: string;
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
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
    });
  },
});

/** A counter order of `dish`, paid through the till in `parts` (cash, or a hand-keyed card); its
 * invoice, issued unpaid when `parts` is empty. */
async function soldForCash(
  dish: string | readonly string[],
  parts: readonly (string | { card: string })[],
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
  await payFor(id, parts);
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
  return brandSaleId(sale!.id);
}

async function payFor(id: string, parts: readonly (string | { card: string })[]) {
  for (const part of parts) {
    const amount = typeof part === "string" ? part : part.card;
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      ...(typeof part === "string"
        ? { method: "cash", tendered: amount }
        : { method: "card", entry: "manual" }),
      applied: amount,
      tip: "0.00",
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
      {
        submissionId: ask.submissionId,
        gross: ask.gross,
        ...scope,
        reasonId: ask.reasonId ?? reasonId,
        note: ask.note === undefined ? "Overcooked" : ask.note,
        expectedSplit: split,
      },
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

/** A goodwill return of `amount` from the sale's first cash payment, left pending unless `complete`. */
async function giveBack(saleId: string, amount: string, complete = true) {
  return inTx(venue, async (tx) => {
    const [cash] = await readRefundableTenders(tx, saleId);
    const reading = venue.clock.now();
    const { refund } = await reserveTenderRefund(
      tx,
      venue.cfg,
      saleId,
      {
        submissionId: randomUUID(),
        tenderId: cash!.tenderId,
        appliedAmount: amount,
        tipAmount: "0.00",
        reason: "Goodwill",
      },
      { requestedBy: managerId, authorizedBy: managerId },
      reading.instant.toISOString(),
    );
    if (complete) await carryNewTenderRefund(tx, deps(), venue.cfg.nodeId, reading, refund);
    return refund.id;
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

  it("reads the money back and pending over the correction's refunds", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const { correction } = await open(saleId, { submissionId: randomUUID(), gross: "6.05" });
    const link = async (refundId: string) =>
      venue.db.insert(invoiceCorrectionRefunds).values({
        invoiceCorrectionId: correction.id,
        tenderRefundId: refundId,
        requestId: randomUUID(),
      });
    const read = () =>
      inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correction.id));

    await link(await giveBack(saleId, "4.00"));
    expect(await read()).toMatchObject({
      moneyBack: "4.00",
      pending: "0.00",
      left: "2.05",
      legs: [{ state: "completed", appliedAmount: "4.00" }],
      fileNow: { gross: "4.00", vatBreakdown: [{ rate: "21.00", base: "3.31", tax: "0.69" }] },
    });

    const pendingId = await giveBack(saleId, "1.00", false);
    await link(pendingId);
    expect(await read()).toMatchObject({
      moneyBack: "4.00",
      pending: "1.00",
      left: "1.05",
      fileNow: null,
    });
    expect((await read()).legs).toHaveLength(2);
  });

  it("refuses to read a correction that does not exist", async () => {
    const correctionId = randomUUID();
    await expect(
      inTx(venue, (tx) => readInvoiceCorrection(tx, venue.backend, venue.cfg, correctionId)),
    ).rejects.toMatchObject({ code: "invoice_correction.not_found", params: { correctionId } });
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
