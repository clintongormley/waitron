import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { printers, printJobs, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { enqueueReceiptCopy, readOriginalReceiptPrint } from "./receipt-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readSettledTicket, type TillSaleLine } from "./till-sale.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readOrderRevision } from "./working-order.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { COMP_BILL_REASON, GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import {
  printSpecBill,
  sendSpecDishes,
  setSpecCount,
  setupSetMenuSpecVenue,
  specBill,
  specDeps,
  specRows,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

type Result = ReceiptDocumentInput["result"];

/** The item section's printed rows, between the heading's rule and the total's. */
function items(result: Result, invoiceLocale = "es-ES"): [string, string][] {
  const { elements } = buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    invoiceLocale,
    namesLocale: invoiceLocale,
    result,
  });
  const rules = elements.flatMap((element, at) => (element.kind === "rule" ? [at] : []));
  return elements
    .slice(rules[2]! + 1, rules[3])
    .flatMap((element): [string, string][] =>
      element.kind === "amount" ? [[element.caption, element.amount]] : [],
    );
}

const line = (name: string, gross: string, extra: Partial<TillSaleLine> = {}): TillSaleLine => ({
  descriptions: { "es-ES": name, "en-GB": name },
  quantity: "1",
  gross,
  parentLineNo: null,
  ...extra,
});

function simplified(lines: TillSaleLine[], total: string): Result {
  return {
    ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
    invoiceType: "F2",
    total,
    vatBreakdown: [{ rate: "10", base: total, tax: "0.00" }],
    lines,
  };
}

async function payWhole(billId: string, amount: string) {
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    billId,
    {
      submissionId: crypto.randomUUID(),
      kind: "share",
      shareOf: 1,
      applied: amount,
      tip: "0.00",
      method: "cash",
      tendered: amount,
    },
    venue.operator,
  );
}

const settled = (billId: string) =>
  inTx(venue, (tx) => readSettledTicket(venue.backend, tx, venue.cfg, billId));

it("a simplified ticket lists the set menus and surcharges and no covered dish", async () => {
  const { tabId } = await specBill(spec, "fire");
  await payWhole(tabId, "73.00");
  const ticket = await settled(tabId);
  expect(ticket.invoiceType).toBe("F2");
  expect(items(ticket)).toEqual([
    ["2  Daily menu", "28,00"],
    ["2  Special menu", "40,00"],
    ["1  Sirloin", "+5,00"],
  ]);
  const printed = JSON.stringify(
    buildReceiptDocument({ ...FULL_INVOICE_DOCUMENT_FIXTURE, result: ticket }),
  );
  for (const covered of ["Soup", "Hake", "Sea bass"]) expect(printed).not.toContain(covered);
  expect(printed.match(/Sirloin/g)).toHaveLength(1);
});

it("a covered soup with bread prints the soup with no amount and the bread under it", async () => {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, spec.daily, 2);
  await sendSpecDishes(
    spec,
    bill,
    [
      { dish: "Hake", from: spec.daily },
      { dish: "Soup", from: spec.daily, extras: [spec.bread] },
    ],
    "fire",
  );
  await payWhole(bill.tabId, "29.50");
  const ticket = await settled(bill.tabId);
  expect(ticket.lines.map(({ setMenuRole, gross }) => [setMenuRole, gross])).toEqual([
    ["set_menu", "14.00"],
    ["set_menu", "14.00"],
    ["dish", "0.00"],
    ["dish", "0.00"],
    [undefined, "1.50"],
  ]);
  expect(items(ticket)).toEqual([
    ["2  Daily menu", "28,00"],
    ["1  Soup", ""],
    ["  Bread", "1,50"],
  ]);
});

it("a comped bread under a covered soup still prints", () => {
  const result = simplified(
    [
      line("Daily menu", "14.00", { setMenuRole: "set_menu", unitPriceGross: "14.00" }),
      line("Soup", "0.00", { setMenuRole: "dish" }),
      line("Bread", "0.00", {
        parentLineNo: 2,
        listGross: "1.50",
        listUnitPriceGross: "1.50",
        adjustments: [{ kind: "comp", amount: "1.50" }],
      }),
    ],
    "14.00",
  );
  expect(items(result)).toEqual([
    ["1  Daily menu", "14,00"],
    ["1  Soup", ""],
    ["  Bread", "1,50"],
    [expect.stringMatching(/^ {2}\S/u), "-1,50"],
  ]);
});

it("a comped set menu prints its comp", () => {
  const result = simplified(
    [
      line("Daily menu", "0.00", {
        setMenuRole: "set_menu",
        listGross: "14.00",
        listUnitPriceGross: "14.00",
        adjustments: [{ kind: "comp", amount: "14.00" }],
      }),
      line("Soup", "0.00", { setMenuRole: "dish" }),
    ],
    "0.00",
  );
  expect(items(result)).toEqual([
    ["1  Daily menu", "14,00"],
    [expect.stringMatching(/^ {2}\S/u), "-14,00"],
  ]);
});

it.each([
  ["en-GB", "+5.00", "14.00"],
  ["es-ES", "+5,00", "14,00"],
])(
  "a surcharge prints its dish's name and the amount with a plus (%s)",
  (locale, surcharge, menu) => {
    const result = simplified(
      [
        line("Daily menu", "14.00", { setMenuRole: "set_menu" }),
        line("Sirloin", "5.00", { setMenuRole: "dish" }),
      ],
      "19.00",
    );
    expect(items(result, locale)).toEqual([
      ["1  Daily menu", menu],
      ["1  Sirloin", surcharge],
    ]);
  },
);

it("a surcharge does not merge with the same dish ordered on its own", () => {
  const result = simplified(
    [
      line("Daily menu", "14.00", { setMenuRole: "set_menu" }),
      line("Sirloin", "5.00", { setMenuRole: "dish" }),
      line("Sirloin", "5.00"),
    ],
    "24.00",
  );
  expect(items(result)).toEqual([
    ["1  Daily menu", "14,00"],
    ["1  Sirloin", "+5,00"],
    ["1  Sirloin", "5,00"],
  ]);
});

it("a corrected dish with an amount prints, alone and below zero", () => {
  const result: Result = {
    ...simplified(
      [line("Sirloin", "-5.00", { setMenuRole: "dish", quantity: "-1", unitPriceGross: "5.00" })],
      "-5.00",
    ),
    invoiceType: "R5",
    invoiceNumber: "R/7",
    corrects: {
      invoiceNumber: "FF/1",
      issuedAt: "2026-08-17T22:34:00.000Z",
      issuedOffsetMinutes: 120,
    },
  };
  expect(items(result)).toEqual([["-1  Sirloin", "-5,00"]]);
});

it.each([
  ["en-GB", "+10.00", "+€5.00 each"],
  ["es-ES", "+10,00", "+5,00 € por unidad"],
])("merged surcharges print each one's price with a plus (%s)", (locale, total, each) => {
  const result = simplified(
    [
      line("Daily menu", "14.00", { setMenuRole: "set_menu" }),
      line("Daily menu", "14.00", { setMenuRole: "set_menu" }),
      line("Sirloin", "5.00", { setMenuRole: "dish", unitPriceGross: "5.00" }),
      line("Sirloin", "5.00", { setMenuRole: "dish", unitPriceGross: "5.00" }),
    ],
    "38.00",
  );
  const { elements } = buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    invoiceLocale: locale,
    namesLocale: locale,
    result,
  });
  const at = elements.findIndex(
    (element) => element.kind === "amount" && element.caption === "2  Sirloin",
  );
  expect(elements[at]).toMatchObject({ amount: total });
  expect(elements[at + 1]).toMatchObject({ kind: "text", text: `${" ".repeat(3)}${each}` });
});

/** The item rows of `bill`'s first ticket as printed, and as reprinted through each receipt read. */
async function printedItemRows(bill: { tabId: string }) {
  const [sale] = await venue.db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, bill.tabId));
  const [{ id: printerId }] = await venue.db.select({ id: printers.id }).from(printers);
  const printer = { id: printerId!, paperWidth: "80mm" as const, resolution: "203dpi" as const };
  const itemLines = (text: string) =>
    text
      .split("\n")
      .filter((row) => /Daily menu|Special menu|Sirloin|Soup|Hake|Sea bass/u.test(row));
  const print = async (read: "settled" | "by sale id") => {
    const queued = await inTx(venue, async (tx) =>
      enqueueReceiptCopy(
        tx,
        venue.cfg,
        read === "settled"
          ? await readSettledTicket(venue.backend, tx, venue.cfg, bill.tabId)
          : await readTransactionReceipt(venue.backend, tx, venue.cfg, sale!.id),
        sale!.id,
        printer,
      ),
    );
    const [job] = await venue.db.select().from(printJobs).where(eq(printJobs.id, queued!.jobId));
    return itemLines(decodeTicket(job!.payload));
  };
  const queued = await inTx(venue, (tx) => readOriginalReceiptPrint(tx, sale!.id));
  if (queued.status === "not_queued") throw new Error("Print the bill queued no receipt");
  const [first] = await venue.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.id, queued.jobId));
  return {
    saleId: sale!.id,
    original: itemLines(decodeTicket(first!.payload)),
    settled: await print("settled"),
    bySaleId: await print("by sale id"),
  };
}

it("a reprint prints what the first print did", async () => {
  const bill = await specBill(spec, "fire");
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const { original, settled, bySaleId } = await printedItemRows(bill);
  expect(original).toHaveLength(3);
  expect(original.join("\n")).not.toMatch(/Soup|Hake|Sea bass/u);
  expect(settled).toEqual(original);
  expect(bySaleId).toEqual(original);
});

/** Comps the bill's line `lineId` whole, under the give-away reason, or takes `percentBp` off it. */
function compLine(billId: string, lineId: string, percentBp?: number) {
  return inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        note: null,
        ...(percentBp === undefined
          ? { reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON), action: "comp" as const }
          : {
              reasonId: await reasonIdOf(tx, COMP_BILL_REASON),
              action: "discount_percent" as const,
              percentBp,
            }),
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
}

/** The spec bill eaten in, with its Sirloin surcharge comped. */
async function compedSurchargeBill() {
  const bill = await specBill(spec, "fire");
  const sirloin = (await specRows(spec, bill.tabId)).find(
    ({ name, setMenuRole, lineTotal }) =>
      name === "Sirloin" && setMenuRole === "dish" && lineTotal > 0,
  )!;
  await compLine(bill.tabId, sirloin.id);
  return bill;
}

it("a comped surcharge keeps its row on both receipt reads", async () => {
  const bill = await compedSurchargeBill();
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const { saleId, original, settled, bySaleId } = await printedItemRows(bill);
  expect(original.filter((row) => row.includes("Sirloin"))).toHaveLength(1);
  expect(settled).toEqual(original);
  expect(bySaleId).toEqual(original);
  const receipt = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
  );
  expect(receipt.lines.filter((line) => line.adjustments !== undefined)).toEqual([
    expect.objectContaining({
      setMenuRole: "dish",
      gross: "0.00",
      listGross: "5.00",
      adjustments: [{ kind: "comp", amount: "5.00" }],
    }),
  ]);
});

it("a credit of a comped surcharge keeps its row, at 0.00, with no comp", async () => {
  const bill = await compedSurchargeBill();
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const creditId = await inTx(venue, async (tx) =>
    creditWholeInvoice(tx, specDeps(spec), venue.cfg, (await readOrderInvoice(tx, bill.tabId))!, {
      sessionId: venue.operator.sessionId,
    }),
  );
  const credit = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, creditId),
  );
  const rows = items(credit);
  expect(rows).toContainEqual(["-1  Sirloin", "0,00"]);
  expect(rows.filter(([, amount]) => amount.startsWith("--"))).toEqual([]);
  expect(credit.lines.filter((line) => line.adjustments !== undefined)).toEqual([]);
});

it("after a set menu leaves the bill, a reprint by sale id prints each discount under its own row", async () => {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, spec.daily, 3);
  const [firstSpecial] = (await setSpecCount(spec, bill.tabId, spec.special, 2)).setMenus.slice(3);
  await setSpecCount(spec, bill.tabId, spec.daily, 2);
  const numbers = (await specRows(spec, bill.tabId)).map(({ lineNo }) => lineNo);
  expect(numbers).not.toEqual(numbers.map((_, i) => i + 1));
  await compLine(bill.tabId, firstSpecial!.lineId, 1000);
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const [sale] = await venue.db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, bill.tabId));
  const settledTicket = await settled(bill.tabId);
  const settledRows = items(settledTicket);
  expect(settledRows.slice(1, 3)).toEqual([
    ["1  Special menu", "20,00"],
    [expect.stringMatching(/^ {2}\S/u), "-2,00"],
  ]);
  const bySaleId = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, sale!.id),
  );
  expect(items(bySaleId)).toEqual(settledRows);
  const adjustmentsOf = (result: Result) => result.lines.map((line) => line.adjustments ?? null);
  expect(adjustmentsOf(settledTicket)).toContainEqual([
    { kind: "discount", percentBp: 1000, amount: "2.00" },
  ]);
  expect(adjustmentsOf(bySaleId)).toEqual(adjustmentsOf(settledTicket));
});
