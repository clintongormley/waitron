import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { allocateInvoiceNumber, sales, saleSubstitutions, type Transaction } from "@waitron/db";
import { receiptLabelsFor } from "@waitron/country-packs";
import { readBankAccount, saveBankAccount } from "@waitron/provisioning";
import { ibanGroups } from "@waitron/shared";
import { cashPayment, inTx } from "./testing/bill-venue.js";
import { deferredCloseVenue, type DeferredCloseKit } from "./testing/deferred-close-fixture.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { FULL_INVOICE_FIXTURE } from "./testing/full-invoice-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";
import { readDeferredPayment } from "./receipt-deferred-payment.js";
import { readReceiptEmailDocument } from "./invoice-document.js";
import { layoutInvoicePages } from "./invoice-page.js";
import { layOutSaleReceipt } from "./receipt-print.js";
import { formatReceipt } from "./receipt-ticket.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { tillReceiptPreview } from "./till-receipt-preview.js";
import "./errors.js";

const IBAN = "ES9121000418450200051332";
const BANK = "OPENBANK";
const labels = receiptLabelsFor("es-ES");
let t: DeferredCloseKit;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
  },
});

async function setAccount(iban: string, bankName: string): Promise<void> {
  await inTx(t.venue, async (tx) => {
    const before = await readBankAccount(tx);
    if ((before?.iban ?? "") === iban && (before?.bankName ?? "") === bankName) return;
    await saveBankAccount(tx, {
      expected: { iban: before?.iban ?? "", bankName: before?.bankName ?? "" },
      iban,
      bankName,
      personId: t.venue.operatorId,
    });
  });
}

async function saleOf(billId: string): Promise<typeof sales.$inferSelect> {
  const [sale] = await inTx(t.venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return sale!;
}

async function deferredSale(): Promise<typeof sales.$inferSelect> {
  const billId = await t.counterOrder("placed", true);
  await t.close(await t.requestFor(billId, "18.00", null));
  return saleOf(billId);
}

/** A full invoice standing in for `substituted`, as the substitution flow records it. */
async function substitute(tx: Transaction, substituted: typeof sales.$inferSelect) {
  const [row] = await tx
    .insert(sales)
    .values({
      ...substituted,
      id: randomUUID(),
      workingOrderId: null,
      invoiceNumber: await allocateInvoiceNumber(tx, substituted.seriesId),
    })
    .returning({ id: sales.id });
  await tx
    .insert(saleSubstitutions)
    .values({ substitutionSaleId: row!.id, substitutedSaleId: substituted.id });
  return row!.id;
}

const instruction = (number: string): string =>
  `${labels.deferredPayment}. ${labels.transferInstruction.replace("{number}", number)}`;
const flat = (lines: readonly string[]): string => lines.join(" ").replace(/\s+/g, " ");
const grouped = ibanGroups(IBAN).join(" ");

describe("readDeferredPayment", () => {
  it("answers a bill closed as a deferred payment with the venue's account", async () => {
    await setAccount(IBAN, BANK);
    const sale = await deferredSale();
    expect(await inTx(t.venue, (tx) => readDeferredPayment(tx, sale.id))).toEqual({
      account: { iban: IBAN, bankName: BANK },
    });
  });

  it("follows a replacement and a substitution back to the deferred sale", async () => {
    const sale = await deferredSale();
    const replacement = await inTx(t.venue, (tx) =>
      insertCorrective(tx, sale.id, { replaces: true }),
    );
    const again = await inTx(t.venue, (tx) =>
      insertCorrective(tx, replacement, { replaces: true }),
    );
    const other = await deferredSale();
    const substitution = await inTx(t.venue, (tx) => substitute(tx, other));
    for (const id of [replacement, again, substitution]) {
      expect(await inTx(t.venue, (tx) => readDeferredPayment(tx, id))).toBeDefined();
    }
  });

  it("does not follow a correction by differences, nor answer a cash or unpaid sale", async () => {
    const sale = await deferredSale();
    const correction = await inTx(t.venue, (tx) =>
      insertCorrective(tx, sale.id, { total: "-2.00" }),
    );
    const cashBill = await t.counterOrder("placed", true);
    const paid = await cashPayment(t.venue, t.venue.cookie, cashBill, "20.00");
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const unpaid = await saleOf(await t.counterOrder("placed", true));
    for (const id of [correction, (await saleOf(cashBill)).id, unpaid.id]) {
      expect(await inTx(t.venue, (tx) => readDeferredPayment(tx, id))).toBeUndefined();
    }
  });

  it("ends on substitutions that point at each other", async () => {
    // With no deferred tender anywhere, the query need never walk the substitutions.
    await deferredSale();
    const first = await saleOf(await t.counterOrder("placed", true));
    const second = await inTx(t.venue, (tx) => substitute(tx, first));
    await inTx(t.venue, (tx) =>
      tx
        .insert(saleSubstitutions)
        .values({ substitutionSaleId: first.id, substitutedSaleId: second }),
    );
    expect(await inTx(t.venue, (tx) => readDeferredPayment(tx, first.id))).toBeUndefined();
  });

  it("answers no account once the setting is cleared", async () => {
    const sale = await deferredSale();
    await setAccount("", "");
    expect(await inTx(t.venue, (tx) => readDeferredPayment(tx, sale.id))).toEqual({
      account: null,
    });
    await setAccount(IBAN, BANK);
  });
});

describe("deferred-payment instructions on the documents", () => {
  const printer = (paperWidth: "58mm" | "80mm") => ({ paperWidth, resolution: "180dpi" as const });
  const receiptLines = (saleId: string, paperWidth: "58mm" | "80mm") =>
    inTx(t.venue, async (tx) =>
      printedLines(
        await layOutSaleReceipt(
          t.venue.backend,
          tx,
          t.venue.cfg,
          saleId,
          false,
          printer(paperWidth),
          null,
        ),
      ).map((line) => line.trimEnd()),
    );
  const numberOf = async (saleId: string): Promise<string> =>
    (await inTx(t.venue, (tx) => readTransactionReceipt(t.venue.backend, tx, t.venue.cfg, saleId)))
      .invoiceNumber;

  it("prints the heading, the instruction and the account on a 58 mm roll", async () => {
    await setAccount(IBAN, BANK);
    const sale = await deferredSale();
    const lines = await receiptLines(sale.id, "58mm");
    const heading = lines.indexOf(labels.paymentMethodHeading);
    expect(heading).toBeGreaterThan(-1);
    const iban = lines.indexOf(`${labels.iban}:`);
    expect(flat(lines.slice(heading + 1, iban))).toBe(instruction(await numberOf(sale.id)));
    expect(lines.slice(iban, iban + 3)).toEqual([
      `${labels.iban}:`,
      grouped,
      `${labels.bankName}: ${BANK}`,
    ]);
    expect(flat(lines)).not.toContain(labels.owed);
  });

  it("prints the IBAN on one line on an 80 mm roll, and no bank line without a bank name", async () => {
    await setAccount(IBAN, "");
    const sale = await deferredSale();
    const lines = await receiptLines(sale.id, "80mm");
    const heading = lines.indexOf(labels.paymentMethodHeading);
    const iban = lines.indexOf(`${labels.iban}: ${grouped}`);
    expect(heading).toBeGreaterThan(-1);
    expect(flat(lines.slice(heading + 1, iban))).toBe(instruction(await numberOf(sale.id)));
    expect(flat(lines)).not.toContain(`${labels.bankName}:`);
    await setAccount(IBAN, BANK);
  });

  it("reprints a deferred receipt with the deferred payment alone once the account is cleared", async () => {
    await setAccount(IBAN, BANK);
    const sale = await deferredSale();
    await setAccount("", "");
    const lines = await receiptLines(sale.id, "80mm");
    expect(lines).toContain(`${labels.deferredPayment}.`);
    expect(flat(lines)).not.toContain(labels.iban);
    expect(flat(lines)).not.toContain(labels.transferInstruction.split("{number}")[0]!.trim());
    await setAccount(IBAN, BANK);
  });

  it("gives a deferred bill's replacement the instructions on A4 and on the roll, never paid or owed", async () => {
    await setAccount(IBAN, BANK);
    const sale = await deferredSale();
    const replacement = await inTx(t.venue, (tx) =>
      insertCorrective(tx, sale.id, { replaces: true }),
    );
    const document = await inTx(t.venue, (tx) =>
      readReceiptEmailDocument(t.venue.backend, tx, t.venue.cfg, replacement),
    );
    expect(document.deferredPayment).toEqual({ account: { iban: IBAN, bankName: BANK } });
    const page = flat(
      layoutInvoicePages(document).flatMap((one) =>
        one.elements.flatMap((element) => (element.kind === "text" ? [element.text] : [])),
      ),
    );
    const number = document.result.invoiceNumber;
    expect(page).toContain(instruction(number));
    expect(page).toContain(grouped);
    expect(page).not.toContain(labels.paid);
    expect(page).not.toContain(labels.owed);
    const roll = flat(await receiptLines(replacement, "80mm"));
    expect(roll).toContain(instruction(number));
    expect(roll).toContain(`${labels.iban}: ${grouped}`);
    expect(roll).not.toContain(labels.paid);
    expect(roll).not.toContain(labels.owed);
  });

  it("shows the same lines in the till's on-screen receipt", async () => {
    await setAccount(IBAN, BANK);
    const sale = await deferredSale();
    const preview = await inTx(t.venue, async (tx) =>
      tillReceiptPreview(
        tx,
        sale.id,
        await readTransactionReceipt(t.venue.backend, tx, t.venue.cfg, sale.id),
        false,
      ),
    );
    const texts = (preview.receiptPreview ?? []).flatMap((element) =>
      element.kind === "text" ? [element.text] : [],
    );
    expect(texts).toEqual(
      expect.arrayContaining([
        labels.paymentMethodHeading,
        instruction(preview.invoiceNumber),
        `${labels.iban}: ${grouped}`,
        `${labels.bankName}: ${BANK}`,
      ]),
    );
  });

  it("leaves a receipt that was not deferred as it was", async () => {
    for (const paperWidth of ["58mm", "80mm"] as const) {
      const text = flat(
        printedLines(formatReceipt({ ...FULL_INVOICE_FIXTURE, printer: printer(paperWidth) })),
      );
      expect(text).not.toContain(labels.paymentMethodHeading);
      expect(text).not.toContain(labels.iban);
    }
    const cashBill = await t.counterOrder("placed", true);
    await cashPayment(t.venue, t.venue.cookie, cashBill, "20.00");
    const lines = await receiptLines((await saleOf(cashBill)).id, "80mm");
    expect(lines).not.toContain(labels.paymentMethodHeading);
  });

  it("prints the instructions in place of an owed amount on a deferred document", () => {
    const text = flat(
      printedLines(
        formatReceipt({
          ...FULL_INVOICE_FIXTURE,
          printer: printer("80mm"),
          result: { ...FULL_INVOICE_FIXTURE.result, tender: { method: "unpaid" }, owed: "19.69" },
          deferredPayment: { account: { iban: IBAN, bankName: null } },
        }),
      ),
    );
    expect(text).toContain(instruction("FF/1"));
    expect(text).not.toContain(labels.owed);
    expect(text).not.toContain(`${labels.bankName}:`);
  });
});
