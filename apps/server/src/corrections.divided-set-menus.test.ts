import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adjustments, listAdjustmentReasons } from "@waitron/adjustments";
import { recordReplacement } from "@waitron/core";
import {
  departments,
  printers,
  printJobs,
  products,
  readHistoryNodes,
  readLiveSeriesIdTx,
  saleLines,
  sales,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { createPinThrottle } from "@waitron/identity";
import { menuItems } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { computeCategorySales, currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import {
  decimal,
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  subtractDecimal,
  type SaleId,
} from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillFiling, refundValueIn } from "./cancellation-refund-value.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { listFreeItems } from "./free-items.js";
import { readReceiptEmailDocument } from "./invoice-document.js";
import { enqueueReceiptCopy } from "./receipt-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { giveCorrectionCash, parseCorrectionCash } from "./invoice-correction-cash.js";
import {
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
} from "./invoice-corrections.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readOrderRevision } from "./working-order-context.js";
import {
  COMP_BILL_REASON,
  GIVE_AWAY_REASON,
  reasonIdOf,
  refundableCancel,
} from "./testing/cancel-line.js";
import { inTx, cashContribution, type PartyVenue } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  addSpecLunch,
  lunchBill,
  printSpecBill,
  serveSpecBill,
  setupSetMenuSpecVenue,
  specDeps,
  specRows,
  specSaleLines,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

// VAT rates piece B, S10 and S12: correctives, refunds and the Given free sheet of a takeaway set
// menu whose price was divided between dishes at 10% and 21% (the plan's worked example) reuse the
// filed parts and never divide again.
let spec: SpecVenue;
let venue: PartyVenue;
let lunch: SpecLunch;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

beforeAll(async () => {
  lunch = await addSpecLunch(spec);
  await inTx(venue, async (tx) => {
    for (const [dish, price] of [
      ["Soup", 550],
      ["Hake", 1250],
    ] as const)
      await tx
        .update(products)
        .set({ unitPrice: price })
        .where(eq(products.id, spec.productIds[dish]));
  });
});

/** Hake costs `cents` more in the Lunch menu; answers the published copy's id. */
function hakeSupplement(cents: number | null) {
  return inTx(venue, async (tx) => {
    await tx.update(menuItems).set({ grossPrice: cents }).where(eq(menuItems.id, lunch.items.Hake));
    return publishWorkingMenu(tx, venue.tables.menuId);
  });
}

/** A Lunch bill, paid 14.00 (16.00 with a Hake supplement) in cash: answers its sale. */
async function paidLunch(versionId = lunch.versionId, amount = "14.00") {
  const bill = await lunchBill(spec, lunch, versionId);
  await cashContribution(venue, bill.tabId, amount);
  const lines = await specSaleLines(spec, bill.tabId);
  return { ...bill, saleId: brandSaleId(lines[0]!.saleId), lines };
}

function rowsOf(saleId: string) {
  return venue.db
    .select({
      name: saleLines.name,
      lineGross: saleLines.lineGross,
      setMenuPart: saleLines.setMenuPart,
      vatRate: saleLines.vatRate,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
}

async function figuresOf(saleId: string) {
  const [sale] = await venue.db
    .select({ total: sales.total, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.id, saleId));
  return sale!;
}

async function correctivesOf(saleId: string) {
  return venue.db.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, saleId));
}

/** The 80 mm receipt of `saleId`, reprinted: its item lines, total and VAT rows, spaces collapsed. */
async function printedItems(saleId: string): Promise<string[]> {
  const ticket = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
  );
  const [{ id: printerId }] = await venue.db.select({ id: printers.id }).from(printers);
  const queued = await inTx(venue, (tx) =>
    enqueueReceiptCopy(tx, venue.cfg, ticket, saleId, {
      id: printerId!,
      paperWidth: "80mm",
      resolution: "203dpi",
    }),
  );
  const [job] = await venue.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.id, queued!.jobId));
  const lines = decodeTicket(job!.payload)
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim());
  const first = lines.findIndex((line) => /^-?\d+ /u.test(line));
  const total = lines.findIndex((line, at) => at > first && /^TOTAL/u.test(line));
  return [
    ...lines.slice(first, total + 1).filter((line) => line !== "" && !/^-+$/u.test(line)),
    ...lines.slice(total + 1).filter((line) => /^\d+ ?% /u.test(line)),
  ];
}

const DIVIDED_ROWS = [
  { name: "Lunch menu", lineGross: 0, setMenuPart: -1400, vatRate: 1000 },
  { name: "Soup", lineGross: 358, setMenuPart: 358, vatRate: 1000 },
  { name: "Hake", lineGross: 814, setMenuPart: 814, vatRate: 1000 },
  { name: "Lemonade", lineGross: 228, setMenuPart: 228, vatRate: 2100 },
];

describe("a whole credit", () => {
  it("of a split after print negates the filed rows, their parts and the VAT rows", async () => {
    const bill = await lunchBill(spec, lunch);
    await serveSpecBill(spec, bill.partyId, bill.tabId);
    const { saleId } = await printSpecBill(spec, bill.partyId, bill.tabId);
    expect(await rowsOf(saleId!)).toEqual(DIVIDED_ROWS);

    await splitAfterPrint(specDeps(spec), venue.cfg, bill.tabId, {
      ...venue.operator,
      attempts: { throttle: createPinThrottle(), slot: "split" },
    });
    const [credit] = await correctivesOf(saleId!);
    expect(await rowsOf(credit!.id)).toEqual(
      DIVIDED_ROWS.map((row) => ({
        ...row,
        lineGross: -row.lineGross || 0,
        setMenuPart: -row.setMenuPart,
      })),
    );
    expect(await figuresOf(credit!.id)).toEqual({
      total: -1400,
      vatBreakdown: [
        { rate: "10.00", base: "-10.65", tax: "-1.07" },
        { rate: "21.00", base: "-1.88", tax: "-0.40" },
      ],
    });
  });
});

describe("a goodwill amount", () => {
  const actor = () => ({
    personId: venue.operator.personId,
    authz: { sessionId: venue.operator.sessionId },
    authorization: {
      authorizedBy: venue.operator.personId,
      permission: "sale.rectify",
      viaOverride: false,
    },
  });

  function preview(saleId: SaleId, gross: string, lineIds?: string[]) {
    return inTx(venue, (tx) =>
      previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
        gross,
        ...(lineIds === undefined ? {} : { lineIds }),
      }),
    );
  }

  /** Gives `gross` back in cash off the sale's lines `lineIds`; answers the corrective's id. */
  async function giveBack(saleId: SaleId, gross: string, lineIds: string[]) {
    const { vatBreakdown } = await preview(saleId, gross, lineIds);
    const deps = { backend: venue.backend, clock: venue.clock, attendance: recordAttendanceFact };
    const given = await inTx(venue, async (tx) => {
      const { correction } = await openInvoiceCorrection(
        tx,
        deps,
        venue.cfg,
        saleId,
        parseInvoiceCorrection({
          submissionId: crypto.randomUUID(),
          gross,
          lineIds,
          reasonId: (await listAdjustmentReasons(tx))[0]!.id,
          note: "Goodwill",
          expectedSplit: vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
        }),
        actor(),
      );
      return giveCorrectionCash(
        tx,
        deps,
        venue.cfg,
        correction.id,
        parseCorrectionCash({ submissionId: crypto.randomUUID(), amount: gross }),
        { ...actor(), authorization: { ...actor().authorization, permission: "sale.refund" } },
      );
    });
    return given.correction.correctiveSaleId!;
  }

  it("on the lemonade row comes off at 21%, off its part", async () => {
    const { saleId, lines } = await paidLunch();
    const lemonade = lines.find(({ name }) => name === "Lemonade")!;
    const correctiveId = await giveBack(saleId, "2.00", [lemonade.id]);
    expect(await figuresOf(correctiveId)).toEqual({
      total: -200,
      vatBreakdown: [{ rate: "21.00", base: "-1.65", tax: "-0.35" }],
    });
    expect(await rowsOf(correctiveId)).toEqual([
      { name: "Lemonade", lineGross: -200, setMenuPart: -200, vatRate: 2100 },
    ]);
    // Its set menu's own row is not on the corrective, so the line prints its amount.
    expect(await printedItems(correctiveId)).toEqual([
      "-1 Lemonade -2,00",
      "TOTAL -2,00 €",
      "21% -1,65 -0,35 -2,00",
    ]);
    const emailed = await inTx(venue, (tx) =>
      readReceiptEmailDocument(venue.backend, tx, venue.cfg, correctiveId),
    );
    expect(emailed.result.lines).toMatchObject([{ gross: "-2.00", setMenuRole: "dish" }]);
    expect(emailed.result.lines[0]).not.toHaveProperty("setMenuPart");
  });

  /** Category sales' gross by group, around today. */
  function categoryGross() {
    return inTx(venue, async (tx) => {
      const nodeId = brandNodeId(venue.cfg.nodeId);
      const clock = await resolveVenueClock(tx, nodeId);
      const day = currentBusinessDay(clock);
      const { tree } = await computeCategorySales(tx, {
        nodeIds: await readHistoryNodes(tx, nodeId),
        fromBusinessDay: day,
        toBusinessDay: day,
        timeZone: clock.timeZone,
        dayCutover: clock.dayCutover,
        cutoverChanges: clock.cutoverChanges,
        mode: "at_time_of_sale",
      });
      return new Map(
        tree.map((node) => [node.kind === "category" ? node.name : node.kind, node.gross]),
      );
    });
  }

  async function withHakeSupplement(run: (versionId: string) => Promise<void>) {
    const [before] = await venue.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, lunch.items.Hake));
    try {
      await run(await hakeSupplement(200));
    } finally {
      lunch.versionId = await hakeSupplement(before!.grossPrice);
    }
  }

  it("on a hake row with a supplement takes its part once, then the supplement", async () => {
    await withHakeSupplement(async (versionId) => {
      const { saleId, lines } = await paidLunch(versionId, "16.00");
      const hake = lines.find(({ name }) => name === "Hake")!;
      expect(hake).toMatchObject({ lineGross: 1014, setMenuPart: 814 });
      const first = await giveBack(saleId, "8.14", [hake.id]);
      expect(await rowsOf(first)).toEqual([
        { name: "Hake", lineGross: -814, setMenuPart: -814, vatRate: 1000 },
      ]);
      const start = await categoryGross();
      const second = await giveBack(saleId, "1.00", [hake.id]);
      expect(await rowsOf(second)).toEqual([
        { name: "Hake", lineGross: -100, setMenuPart: null, vatRate: 1000 },
      ]);
      const after = await categoryGross();
      expect(after.get("set_menus")).toBe(start.get("set_menus"));
      expect(
        String(
          subtractDecimal(
            decimal(after.get("Set menu dishes")!),
            decimal(start.get("Set menu dishes")!),
          ),
        ),
      ).toBe("-1.00");
    });
  });

  it("on a hake row with a supplement takes what is left of its part second time", async () => {
    await withHakeSupplement(async (versionId) => {
      const { saleId, lines } = await paidLunch(versionId, "16.00");
      const hake = lines.find(({ name }) => name === "Hake")!;
      const partOf = async (correctiveId: string) => (await rowsOf(correctiveId))[0]!.setMenuPart;
      expect(await partOf(await giveBack(saleId, "5.00", [hake.id]))).toBe(-500);
      expect(await partOf(await giveBack(saleId, "5.00", [hake.id]))).toBe(-314);
    });
  });

  it("naming an empty list of lines is refused", async () => {
    const { saleId } = await paidLunch();
    await expect(preview(saleId, "2.00", [])).rejects.toMatchObject({
      code: "sale.correction_scope_invalid",
      params: { reason: "empty" },
    });
  });

  // A divided row stores no list price, so it weighs what it filed: 3.58, 8.14 and 2.28.
  it("naming no lines is shared over the filed rows by what each filed", async () => {
    const { saleId, lines } = await paidLunch();
    const idOf = (name: string) => lines.find((line) => line.name === name)!.id;
    const shown = await preview(saleId, "2.00");
    expect(shown.vatBreakdown).toEqual([
      { rate: "10.00", base: "1.52", tax: "0.15" },
      { rate: "21.00", base: "0.27", tax: "0.06" },
    ]);
    expect(shown.allocations.map(({ saleLineId, gross }) => [saleLineId, gross])).toEqual([
      [idOf("Soup"), "0.51"],
      [idOf("Hake"), "1.16"],
      [idOf("Lemonade"), "0.33"],
    ]);
  });
});

describe("a covered dish cancelled with a refund after payment", () => {
  async function refundOf(billId: string, name: string) {
    const lineNo = (await specRows(spec, billId)).find((row) => row.name === name)!.lineNo;
    const adjustmentId = await refundableCancel(venue.db, venue.cfg, billId, lineNo);
    const [cancel] = await venue.db
      .select({ refundValue: adjustments.refundValue })
      .from(adjustments)
      .where(eq(adjustments.id, adjustmentId));
    return cancel!.refundValue;
  }

  it("refunds nothing for the lemonade, and files no corrective", async () => {
    const { tabId, saleId } = await paidLunch();
    expect(await refundOf(tabId, "Lemonade")).toBe(0);
    expect(await correctivesOf(saleId)).toEqual([]);
  });

  // The till's rows are paired with the filed rows by portion; a bill whose lines carry no
  // portions is paired by position, and values a divided dish the same way.
  it("values the lemonade at nothing when its rows are paired by position", async () => {
    const { tabId, saleId } = await paidLunch();
    const lemonade = (await specRows(spec, tabId)).find(({ name }) => name === "Lemonade")!;
    const value = await inTx(venue, async (tx) => {
      const filing = await readBillFiling(tx, tabId, saleId);
      expect(filing.bindings.size).toBeGreaterThan(0);
      return refundValueIn({ ...filing, bindings: new Map(), links: [] }, lemonade.id);
    });
    expect(value).toEqual({ quantity: "1.000", gross: "0.00" });
  });

  it("refunds the hake's 2.00 supplement, from its row at 10%", async () => {
    const [before] = await venue.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, lunch.items.Hake));
    const versionId = await hakeSupplement(200);
    try {
      const { tabId, saleId, lines } = await paidLunch(versionId, "16.00");
      expect(lines.find(({ name }) => name === "Hake")).toMatchObject({
        lineGross: 1014,
        setMenuPart: 814,
        vatRate: 1000,
      });
      expect(await refundOf(tabId, "Hake")).toBe(200);
      expect(await correctivesOf(saleId)).toEqual([]);
    } finally {
      lunch.versionId = await hakeSupplement(before!.grossPrice);
    }
  });
});

it("a replacement after an AEAT refusal repeats the divided rows and their parts", async () => {
  const { saleId } = await paidLunch();
  const replacementId = await inTx(venue, async (tx) => {
    await refusedByAeat(tx, saleId);
    const { saleId: id } = await recordReplacement(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "corrective")),
      correctsSaleId: saleId,
      authz: { sessionId: venue.operator.sessionId },
      clock: venue.clock,
    });
    return id;
  });
  expect(await rowsOf(replacementId)).toEqual(DIVIDED_ROWS);
  expect(await figuresOf(replacementId)).toEqual(await figuresOf(saleId));
});

/** Comps the bill's row named `name`, or takes 100% off the whole bill for null; answers the adjustment's ids. */
async function compRow(tabId: string, name: string | null) {
  const row =
    name === null ? null : (await specRows(spec, tabId)).find((line) => line.name === name)!;
  const { adjustmentIds } = await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: tabId,
        expectedEdit: await readBillEditState(tx, tabId),
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, tabId),
        reasonId: await reasonIdOf(tx, row === null ? COMP_BILL_REASON : GIVE_AWAY_REASON),
        ...(row === null
          ? { lineId: null, action: "discount_percent" as const, percentBp: 10000 }
          : { lineId: row.id, action: "comp" as const }),
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
  return adjustmentIds;
}

/** This month's Given free sheet, with the bill's department at a 30% margin. */
async function givenFreeAt30Percent(tabId: string) {
  const [{ departmentId }] = await venue.db
    .select({ departmentId: workingOrders.departmentId })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  expect(departmentId).not.toBeNull();
  await venue.db
    .update(departments)
    .set({ estimatedMarginBp: 3000 })
    .where(eq(departments.id, departmentId!));
  try {
    return await inTx(venue, async (tx) => {
      const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
      const day = currentBusinessDay(clock);
      return listFreeItems(tx, clock, {
        year: Number(day.slice(0, 4)),
        period: { kind: "month", month: Number(day.slice(5, 7)) },
      });
    });
  } finally {
    await venue.db
      .update(departments)
      .set({ estimatedMarginBp: null })
      .where(eq(departments.id, departmentId!));
  }
}

describe("the Given free sheet", () => {
  it("values a comped takeaway set menu at the highest rate its copy holds", async () => {
    const bill = await lunchBill(spec, lunch);
    const comped = await compRow(bill.tabId, "Lunch menu");
    const listed = await givenFreeAt30Percent(bill.tabId);
    expect(listed.filter(({ adjustmentId }) => comped.includes(adjustmentId))).toMatchObject([
      {
        item: "Lunch menu",
        menuPrice: "14.00",
        amountTakenOff: "14.00",
        // 14.00 ÷ 1.21 × 0.70 = 8.10; at 10% it would be 8.91.
        estimatedCost: "8.10",
      },
    ]);
  });

  it("keeps the set menu's rate when a bill with a dish's supplement is given free", async () => {
    const [before] = await venue.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, lunch.items.Hake));
    const versionId = await hakeSupplement(200);
    try {
      const bill = await lunchBill(spec, lunch, versionId);
      const comped = await compRow(bill.tabId, null);
      const listed = await givenFreeAt30Percent(bill.tabId);
      expect(listed.filter(({ adjustmentId }) => comped.includes(adjustmentId))).toMatchObject([
        {
          item: null,
          kind: "discount",
          menuPrice: "16.00",
          amountTakenOff: "16.00",
          // (14.00 ÷ 1.21 + 2.00 ÷ 1.10) × 0.70 = 9.37; with the menu at 10% it would be 10.18.
          estimatedCost: "9.37",
        },
      ]);
    } finally {
      lunch.versionId = await hakeSupplement(before!.grossPrice);
    }
  });

  it("keeps the set menu's rate when a dish's supplement on the bill is comped too", async () => {
    const [before] = await venue.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, lunch.items.Hake));
    const versionId = await hakeSupplement(200);
    try {
      const bill = await lunchBill(spec, lunch, versionId);
      const menuComp = await compRow(bill.tabId, "Lunch menu");
      const hakeComp = await compRow(bill.tabId, "Hake");
      const listed = await givenFreeAt30Percent(bill.tabId);
      expect(
        listed.filter(({ adjustmentId }) => [...menuComp, ...hakeComp].includes(adjustmentId)),
      ).toMatchObject([
        {
          item: "Lunch menu",
          menuPrice: "14.00",
          amountTakenOff: "14.00",
          estimatedCost: "8.10",
        },
        {
          item: "Hake",
          menuPrice: "2.00",
          amountTakenOff: "2.00",
          // 2.00 ÷ 1.10 × 0.70 = 1.27.
          estimatedCost: "1.27",
        },
      ]);
    } finally {
      lunch.versionId = await hakeSupplement(before!.grossPrice);
    }
  });
});
