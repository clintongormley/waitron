import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { saleLines, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId } from "@waitron/shared";
import { recordAttendanceFact } from "./attendance-capture.js";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { readReceiptEmailDocument } from "./invoice-document.js";
import { giveCorrectionCash, parseCorrectionCash } from "./invoice-correction-cash.js";
import {
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
} from "./invoice-corrections.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readSettledTicket } from "./till-sale.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { billRow, inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import {
  printSpecBill,
  sendSpecDishes,
  setSpecCount,
  setupSetMenuSpecVenue,
  specBill,
  specDeps,
  specRows,
  specSaleLines,
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

async function saleTotal(billId: string) {
  const [sale] = await venue.db
    .select({ total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, billId));
  return sale!.total;
}

/** The spec bill's filed rows: its four set menus at their prices, and its dishes at 0.00 but the
 * Daily menu's sirloin at 5.00, each with the role its stored line holds; total 73.00. */
async function expectSpecBillFiled(billId: string) {
  const stored = (await specRows(spec, billId)).map(
    ({ name, quantity, lineTotal, setMenuRole }) => [name, quantity, lineTotal, setMenuRole],
  );
  const filed = await specSaleLines(spec, billId);
  expect(
    filed.map(({ name, quantity, lineGross, setMenuRole }) => [
      name,
      quantity,
      lineGross,
      setMenuRole,
    ]),
  ).toEqual(stored);
  expect(
    filed
      .filter(({ setMenuRole }) => setMenuRole === "set_menu")
      .map(({ name, lineGross }) => [name, lineGross]),
  ).toEqual([
    ["Daily menu", 1400],
    ["Daily menu", 1400],
    ["Special menu", 2000],
    ["Special menu", 2000],
  ]);
  const dishes = filed.filter(({ setMenuRole }) => setMenuRole === "dish");
  expect(dishes).toHaveLength(8);
  expect(
    dishes
      .filter(({ lineGross }) => lineGross !== 0)
      .map(({ name, lineGross }) => [name, lineGross]),
  ).toEqual([["Sirloin", 500]]);
  expect(await saleTotal(billId)).toBe(7300);
}

it("a full payment files the set menus and their dishes", async () => {
  const { tabId } = await specBill(spec, "fire");
  await payWhole(tabId, "73.00");
  await expectSpecBillFiled(tabId);
  const ticket = await inTx(venue, (tx) => readSettledTicket(venue.backend, tx, venue.cfg, tabId));
  expect(ticket.lines.map(({ setMenuRole }) => setMenuRole)).toEqual(
    (await specSaleLines(spec, tabId)).map(({ setMenuRole }) => setMenuRole ?? undefined),
  );
});

it("Print the bill files the same rows", async () => {
  const { partyId, tabId } = await specBill(spec, "fire");
  await printSpecBill(spec, partyId, tabId);
  expect((await billRow(venue, tabId)).status).toBe("placed");
  await expectSpecBillFiled(tabId);
});

it("a set menu with open places is charged in full", async () => {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, spec.daily, 2);
  await sendSpecDishes(spec, bill, [{ dish: "Soup", from: spec.daily }], "fire");
  await printSpecBill(spec, bill.partyId, bill.tabId);
  await payWhole(bill.tabId, "28.00");

  expect(
    (await specSaleLines(spec, bill.tabId)).map(({ name, lineGross, setMenuRole }) => [
      name,
      lineGross,
      setMenuRole,
    ]),
  ).toEqual([
    ["Daily menu", 1400, "set_menu"],
    ["Daily menu", 1400, "set_menu"],
    ["Soup", 0, "dish"],
  ]);
  expect(await saleTotal(bill.tabId)).toBe(2800);
});

async function paidSpecSale() {
  const { tabId } = await specBill(spec, "fire");
  await payWhole(tabId, "73.00");
  const lines = await specSaleLines(spec, tabId);
  return { saleId: brandSaleId(lines[0]!.saleId), lines };
}

function previewCorrection(saleId: ReturnType<typeof brandSaleId>, gross: string, lineId: string) {
  return inTx(venue, (tx) =>
    previewInvoiceCorrection(tx, venue.backend, venue.cfg, venue.clock.now(), saleId, {
      gross,
      lineIds: [lineId],
    }),
  );
}

// Regression case: a set menu's own line is a priced line, which a partial correction may name.
it("a correction of one set menu's ticket is usable", async () => {
  const { saleId, lines } = await paidSpecSale();
  const daily = lines.find(({ name }) => name === "Daily menu")!;
  expect(await previewCorrection(saleId, "14.00", daily.id)).toMatchObject({ gross: "14.00" });
});

// Regression case: a covered dish is a 0.00 line, which no partial correction may name alone.
it("a covered dish cannot be corrected on its own", async () => {
  const { saleId, lines } = await paidSpecSale();
  const soup = lines.find(({ name }) => name === "Soup")!;
  await expect(previewCorrection(saleId, "1.00", soup.id)).rejects.toMatchObject({
    code: "sale.correction_amount_invalid",
  });
});

function rolesOf(saleId: string) {
  return venue.db
    .select({ name: saleLines.name, setMenuRole: saleLines.setMenuRole })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
}

/** Each line's role on the receipt read by sale id, and on the emailed document. */
async function receiptRoles(saleId: string) {
  const [receipt, emailed] = await inTx(venue, async (tx) => [
    await readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
    (await readReceiptEmailDocument(venue.backend, tx, venue.cfg, saleId)).result,
  ]);
  const roles = receipt.lines.map(({ setMenuRole }) => setMenuRole ?? null);
  expect(emailed.lines.map(({ setMenuRole }) => setMenuRole ?? null)).toEqual(roles);
  return roles;
}

/** The spec bill printed, its invoice issued unpaid, then credited whole; answers both sales. */
async function creditedSpecSale() {
  const { partyId, tabId } = await specBill(spec, "fire");
  await printSpecBill(spec, partyId, tabId);
  const lines = await specSaleLines(spec, tabId);
  const creditId = await inTx(venue, async (tx) =>
    creditWholeInvoice(tx, specDeps(spec), venue.cfg, (await readOrderInvoice(tx, tabId))!, {
      sessionId: venue.operator.sessionId,
    }),
  );
  return { creditId, lines };
}

it("a reprint by sale id, an emailed invoice and a correction receipt carry each line's role", async () => {
  const { saleId, lines } = await paidSpecSale();
  const filed = lines.map(({ setMenuRole }) => setMenuRole);
  expect(filed).toContain("set_menu");
  expect(await receiptRoles(saleId)).toEqual(filed);
  const credited = await creditedSpecSale();
  expect(await receiptRoles(credited.creditId)).toEqual(
    credited.lines.map(({ setMenuRole }) => setMenuRole),
  );
});

it("a whole-invoice credit carries each line's role", async () => {
  const { creditId, lines } = await creditedSpecSale();
  expect(lines.map(({ setMenuRole }) => setMenuRole)).toContain("dish");
  expect(await rolesOf(creditId)).toEqual(
    lines.map(({ name, setMenuRole }) => ({ name, setMenuRole })),
  );
});

it("a partial correction of a set menu keeps its role", async () => {
  const { saleId, lines } = await paidSpecSale();
  const daily = lines.find(({ name }) => name === "Daily menu")!;
  const [split] = (await previewCorrection(saleId, "14.00", daily.id)).vatBreakdown;
  const actor = {
    personId: venue.operator.personId,
    authz: { sessionId: venue.operator.sessionId },
    authorization: {
      authorizedBy: venue.operator.personId,
      permission: "sale.rectify",
      viaOverride: false,
    },
  };
  const deps = { backend: venue.backend, clock: venue.clock, attendance: recordAttendanceFact };
  const corrected = await inTx(venue, async (tx) => {
    const { correction } = await openInvoiceCorrection(
      tx,
      deps,
      venue.cfg,
      saleId,
      parseInvoiceCorrection({
        submissionId: crypto.randomUUID(),
        gross: "14.00",
        lineIds: [daily.id],
        reasonId: (await listAdjustmentReasons(tx))[0]!.id,
        note: "Overcooked",
        expectedSplit: [{ rate: split!.rate, base: split!.base, tax: split!.tax }],
      }),
      actor,
    );
    return giveCorrectionCash(
      tx,
      deps,
      venue.cfg,
      correction.id,
      parseCorrectionCash({ submissionId: crypto.randomUUID(), amount: "14.00" }),
      { ...actor, authorization: { ...actor.authorization, permission: "sale.refund" } },
    );
  });
  const [corrective] = await venue.db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.correctsSaleId, saleId));
  expect(corrected.correction.state).toBe("filed");
  expect(await rolesOf(corrective!.id)).toEqual([{ name: "Daily menu", setMenuRole: "set_menu" }]);
});
