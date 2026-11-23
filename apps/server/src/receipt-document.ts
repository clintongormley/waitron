import type { CardDetails } from "@waitron/payments";
import { recipientIdentifierLabel, receiptCountryNameFor } from "@waitron/country-packs";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  ibanGroups,
  MONEY_SCALE,
  negateDecimal,
  subtractDecimal,
  type Decimal,
  type ReceiptElement,
  type ReceiptIndent,
  type ReceiptStyle,
} from "@waitron/shared";
import {
  filedRates,
  rateLetters,
  receiptFacts,
  type DatedInvoice,
  type ReceiptDocumentInput,
  type FiledFigureRow,
  type WithVatFigures,
} from "./receipt-facts.js";
import {
  receiptDateTime,
  receiptDateTimeNumeric,
  receiptDay,
  receiptDayNumeric,
} from "./receipt-dates.js";
import { cardName } from "./card-details.js";
import { formatAmount, formatMoney, formatVatRate } from "./receipt-money.js";
import type { ReceiptTable, ReceiptTableRow } from "./receipt-table.js";
import type { TenderBlock } from "./till-sale.js";

export type { ReceiptElement, ReceiptIndent, ReceiptStyle } from "@waitron/shared";
export type { ReceiptDocumentInput, ReceiptIssuer, ReceiptTrim } from "./receipt-facts.js";

/** A part of the trim the dashboard's preview highlights. */
export type ReceiptPart =
  "headerSubtitle" | "footerMessage" | "phone" | "email" | "address" | "logo";

/** Elements `[start, end)` of a receipt document. */
export interface ElementRange {
  start: number;
  end: number;
}

export interface ReceiptDocument {
  elements: readonly ReceiptElement[];
  /**
   * Elements `[start, end)` of each part the document holds; the logo's is always there, since
   * only the drawing knows whether a picture prints.
   */
  parts: Partial<Record<ReceiptPart, ElementRange>>;
  duplicate: boolean;
  practice: boolean;
}

// Accents are not folded: a near-match prints twice rather than dropping the filed address.
function sameAddress(lines: readonly string[], line: string, domicile: string): boolean {
  const fold = (value: string): string =>
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  return [lines.join(", "), line].some((venue) => venue !== "" && fold(venue) === fold(domicile));
}

export function buildReceiptDocument(input: ReceiptDocumentInput): ReceiptDocument {
  const { result, venueAddressLine = "", paperWidth } = input;
  const facts = receiptFacts(input);
  const { labels: label, locale, simplified, practice, testPage, letterhead, band } = facts;
  const itemAmount = (value: string): string =>
    simplified ? formatAmount(value, locale) : formatMoney(value, locale);
  const elements: ReceiptElement[] = [];
  const parts: ReceiptDocument["parts"] = {};
  const part = (name: ReceiptPart, add: () => void): void => {
    const start = elements.length;
    add();
    parts[name] = { start, end: elements.length };
  };
  const text = (text: string, indent: ReceiptIndent = 0, style?: ReceiptStyle): void => {
    elements.push({ kind: "text", text, indent, ...(style ? { style } : {}) });
  };
  const row = (
    caption: string,
    amount: string,
    indent: ReceiptIndent = 0,
    style?: ReceiptStyle,
    gap?: number,
  ): void => {
    elements.push({
      kind: "amount",
      caption,
      amount,
      indent,
      ...(style ? { style } : {}),
      ...(gap === undefined ? {} : { gap }),
    });
  };
  // Ends a section; a section that drew nothing adds no second rule.
  const rule = (): void => {
    if (elements.at(-1)?.kind !== "rule") elements.push({ kind: "rule" });
  };
  const align = (alignment: "left" | "center"): void => {
    elements.push({ kind: "align", alignment });
  };
  const letters = simplified ? rateLetters(result.vatBreakdown) : null;
  const rateLetter = (rate: string): string | undefined =>
    letters === null
      ? undefined
      : [...letters].find(([seen]) => compareDecimal(decimal(seen), decimal(rate)) === 0)?.[1];
  const lettered = (letter: string): string => (letter === "" ? "" : ` ${letter}`);
  const takenOff = (item: string, amount: Decimal, indent: number, letter = ""): void => {
    const included = simplified ? "" : ` (${label.vatIncluded})`;
    const name = `${" ".repeat(indent)}${item}${included}`;
    row(name, `-${itemAmount(negateDecimal(amount))}${lettered(letter)}`, indent);
  };
  const practiceMark = (): void => {
    if (practice === undefined) return;
    text(label.practice);
    if (practice.noRealCharge) text(label.noRealCharge);
  };
  practiceMark();
  if (testPage) text(label.paymentNotice);
  if (practice || testPage) rule();

  if (facts.qr !== undefined) {
    const { text: qr, caption, legend } = facts.qr;
    align("center");
    if (caption !== undefined) text(caption);
    elements.push({ kind: "qr", text: qr });
    if (legend !== undefined) text(legend);
    rule();
    align("left");
  }

  align("center");
  part("logo", () => elements.push({ kind: "logo" }));
  const { tradingName, headerSubtitle, legalName, nif, domicile, phone, email } = letterhead;
  if (tradingName !== undefined) text(tradingName, 0, { bold: true });
  if (headerSubtitle) part("headerSubtitle", () => text(headerSubtitle));
  text(legalName, 0, tradingName !== undefined ? undefined : { bold: true });
  text(`${label.nif}: ${nif}`);
  const venueLines = letterhead.venueAddress;
  if (venueLines.length > 0) part("address", () => venueLines.forEach((line) => text(line)));
  const phoneLine = phone ? `${label.phone} ${phone}` : "";
  if (phoneLine) part("phone", () => text(phoneLine));
  if (email) part("email", () => text(email));
  if (!simplified && domicile) {
    if (venueLines.length === 0) text(domicile);
    else if (!sameAddress(venueLines, venueAddressLine, domicile)) {
      text(`${label.registeredAddress}: ${domicile}`);
    }
  }
  if (band.duplicate) text(label.duplicate);
  rule();
  align("left");

  if (band.orderLabel !== null || band.orderNumber !== 0)
    row(band.orderLabel ?? "", `${label.order} ${band.orderNumber}`, 0, undefined, 2);
  if (band.takeAway) text(label.takeAway, 0, { bold: true });
  const dated = (invoice: DatedInvoice) => {
    const date =
      paperWidth === "58mm"
        ? receiptDateTimeNumeric(invoice.issuedAt, locale, invoice.issuedOffsetMinutes)
        : receiptDateTime(invoice.issuedAt, locale, invoice.issuedOffsetMinutes);
    // Two spaces at least, or the invoice number running into the date reads as one figure.
    row(invoice.invoiceNumber, date, 0, undefined, 2);
  };
  const { corrects, customer } = facts;
  if (corrects) text(label.correctiveInvoice, 0, { bold: true });
  if (simplified) {
    dated(band);
  } else {
    row(label.invoiceHeading, band.invoiceNumber, 0, { bold: true });
    row(label.date, receiptDateTime(band.issuedAt, locale, band.issuedOffsetMinutes));
  }
  if (band.saleDay !== undefined) {
    const day = paperWidth === "58mm" ? receiptDayNumeric : receiptDay;
    row(label.saleDate, day(band.saleDay, locale));
  }
  if (corrects) {
    text(corrects.inFull ? label.replacesInvoiceInFull : label.correctsInvoice);
    dated(corrects);
    // Invoicing regulation art. 15.5: a replacement states the rectification's amount, zero.
    if (corrects.inFull) row(label.rectificationAmount, formatMoney("0.00", locale));
  }
  rule();
  if (customer) {
    text(label.customer);
    text(customer.legalName);
    text(`${recipientIdentifierLabel(customer.identifierType, locale)}: ${customer.taxId}`);
    text(customer.address);
    text(receiptCountryNameFor(customer.countryCode, locale));
    rule();
  }
  const withRate = filedRates(result.lines).length > 1;
  const tableRow = (figure: FiledFigureRow): ReceiptTableRow => {
    const indent = figure.indent > 0 ? { itemIndent: figure.indent } : {};
    if (figure.kind === "answer") {
      return { units: "", item: figure.item, ...indent, price: "", amount: "" };
    }
    const rate = { rate: formatVatRate(figure.rate!, locale) };
    if (figure.kind === "discount") {
      const amount = `-${formatAmount(negateDecimal(figure.amountExVat!), locale)}`;
      return { units: "", item: figure.item, ...indent, price: "", amount, ...rate };
    }
    return {
      units: figure.units,
      item: figure.item,
      ...indent,
      price: figure.unitPrice === undefined ? "" : formatAmount(figure.unitPrice, locale),
      amount: figure.amountExVat === undefined ? "" : formatAmount(figure.amountExVat, locale),
      ...rate,
    };
  };
  const withVatGroup = (group: WithVatFigures): void => {
    const quantity = `${group.quantity}  `;
    const included = simplified ? "" : ` (${label.vatIncluded})`;
    const plus = group.surcharge ? "+" : "";
    row(
      `${quantity}${group.item}${included}`,
      group.amount === undefined
        ? ""
        : `${plus}${itemAmount(group.amount)}${lettered(group.rateLetter)}`,
      { after: quantity },
    );
    if (group.perUnit !== undefined) {
      const price = `${plus}${formatMoney(group.perUnit.price, locale)}`;
      const each =
        group.perUnit.unitName === undefined
          ? label.perUnit.replace("{price}", () => price)
          : `${price} / ${group.perUnit.unitName}`;
      text(`${" ".repeat(quantity.length)}${each}`, quantity.length);
    }
    for (const answer of group.answers) text(`  ${answer}`, 2);
    for (const option of group.options) {
      const caption =
        option.quantity === "" ? `  ${option.item}` : `  ${option.item} ${option.quantity}`;
      row(caption, `${itemAmount(option.amount)}${lettered(option.rateLetter)}`, 2);
    }
    for (const adjustment of group.adjustments) {
      takenOff(adjustment.item, adjustment.amount, 2, adjustment.rateLetter);
    }
  };
  let tables = 0;
  for (const section of facts.sections) {
    if (section.kind === "filed") {
      const table: ReceiptTable = {
        ...(tables === 0
          ? {
              header: {
                units: label.unitsColumn,
                item: label.itemColumn,
                price: label.priceColumn,
                amount: label.amountColumn,
                ...(withRate ? { rate: label.rateColumn } : {}),
              },
            }
          : {}),
        rows: section.rows.map(tableRow),
        withRate,
      };
      elements.push({ kind: "table", table });
      tables += 1;
    } else if (section.kind === "withVat") {
      withVatGroup(section.group);
    } else {
      for (const taken of section.rows) takenOff(taken.item, taken.amount, 0);
    }
  }
  if (tables > 0) text(`    ${label.pricesExcludeVat}`, 4);
  rule();
  const vatRows = (): void => {
    for (const v of facts.vat) {
      row(`${label.taxableBase} ${formatVatRate(v.rate, locale)}`, formatMoney(v.base, locale));
      row(`${label.vat} ${formatVatRate(v.rate, locale)}`, formatMoney(v.tax, locale));
    }
  };
  const total = (): void => {
    row(label.total, formatMoney(facts.total, locale), 0, { double: true });
  };
  if (simplified) {
    total();
    rule();
    if (facts.vat.length > 0)
      elements.push({
        kind: "taxTable",
        header: {
          rate: label.taxRateColumn,
          base: label.taxBaseColumn,
          tax: label.taxAmountColumn,
          total: label.taxTotalColumn,
        },
        rows: facts.vat.map((v) => {
          const rate = formatVatRate(v.rate, locale);
          const found = rateLetter(v.rate);
          return {
            rate: found === undefined ? rate : `${found} ${rate}`,
            base: formatAmount(v.base, locale),
            tax: formatAmount(v.tax, locale),
            total: formatAmount(addDecimal(v.base, v.tax), locale),
          };
        }),
      });
  } else {
    vatRows();
    rule();
    total();
  }
  rule();
  const { payments, owed, deferred } = facts.payment;
  // A deferred sale's own lines, below, take the place of its tender's.
  const t: TenderBlock = deferred === undefined ? facts.payment.tender : { method: "unpaid" };
  const cardRows = (card: CardDetails | undefined, amount: Decimal): void => {
    if (card === undefined) {
      row(label.card, formatMoney(amount, locale));
      return;
    }
    const presented = {
      contactless: ` (${label.paymentContactless})`,
      chip: ` (${label.paymentChip})`,
      swipe: ` (${label.paymentSwipe})`,
      unknown: "",
    }[card.entryMode];
    row(`${cardName(card, label.card)}${presented}`, formatMoney(amount, locale));
    if (card.authCode !== null) text(`${label.paymentAuthorization} ${card.authCode}`);
  };
  if (payments !== undefined && payments.length > 0) {
    for (const payment of payments) {
      if (payment.method === "cash") {
        row(label.cash, formatMoney(payment.tendered, locale));
        if (payment.change !== "0.00") row(label.change, formatMoney(payment.change, locale));
      } else {
        const charged = payment.refunds.reduce(
          (sum, refund) => addDecimal(addDecimal(sum, decimal(refund.amount)), decimal(refund.tip)),
          decimal(payment.amount),
        );
        cardRows(payment.card, charged);
        if (payment.reference !== null) text(`${label.reference} ${payment.reference}`);
      }
      if (payment.tip !== "0.00") row(label.tip, formatMoney(payment.tip, locale));
      for (const refund of payment.refunds) {
        const given = addDecimal(decimal(refund.amount), decimal(refund.tip));
        row(label.refund, formatMoney(subtractDecimal(decimal("0.00"), given), locale));
      }
    }
  } else if (t.method === "cash") {
    row(label.cash, formatMoney(addDecimal(facts.total, decimal(t.change)), locale));
    row(label.change, formatMoney(t.change, locale));
  } else if (t.method === "deferred") {
    text(label.deferredPayment);
  } else if (t.method === "card") {
    if (t.card === undefined) text(label.card);
    else cardRows(t.card, decimal(t.charged));
    if (t.reference !== null) text(`${label.reference} ${t.reference}`);
    if (t.tip !== "0.00") {
      row(label.tip, formatMoney(t.tip, locale));
      row(label.charged, formatMoney(t.charged, locale));
    }
  }
  if (deferred !== undefined) {
    text(label.paymentMethodHeading, 0, { bold: true });
    const { account } = deferred;
    if (account === null) text(`${label.deferredPayment}.`);
    else {
      const instruction = label.transferInstruction.replace("{number}", () => band.invoiceNumber);
      text(`${label.deferredPayment}. ${instruction}`);
      const iban = ibanGroups(account.iban).join(" ");
      if (paperWidth === "58mm") {
        text(`${label.iban}:`);
        text(iban);
      } else text(`${label.iban}: ${iban}`);
      if (account.bankName !== null) text(`${label.bankName}: ${account.bankName}`);
    }
  } else if (owed !== undefined) row(label.owed, formatMoney(owed, locale), 0, { bold: true });
  rule();
  const { guests, footerMessage } = facts;
  if (guests !== undefined) {
    const people = `${guests} ${guests === 1 ? label.guest : label.guests}`;
    const each = divideDecimal(facts.total, decimal(String(guests)), MONEY_SCALE);
    row(`${people} · ${label.perPerson}`, formatMoney(each, locale));
    rule();
  }

  if (footerMessage) {
    align("center");
    part("footerMessage", () => text(footerMessage));
    align("left");
  }
  if (practice || testPage) rule();
  practiceMark();
  if (testPage) {
    text(label.paymentNotice);
    text(testPage.printer);
  }
  if (elements.at(-1)?.kind === "rule") elements.pop();

  return {
    elements,
    parts,
    duplicate: band.duplicate,
    practice: practice !== undefined,
  };
}
