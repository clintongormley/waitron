import { customerOptionSnapshotLabels } from "@waitron/menu";
import type { CardDetails } from "@waitron/payments";
import type { ReceiptLabels } from "@waitron/country";
import {
  recipientIdentifierLabel,
  receiptCountryNameFor,
  receiptLabelsFor,
} from "@waitron/country-packs";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  isZeroDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  perDishOptionQuantity,
  resolveSnapshotText,
  subtractDecimal,
  type Decimal,
  type ReceiptElement,
  type ReceiptIndent,
  type ReceiptLogoRaster,
  type ReceiptStyle,
  type ReceiptPaperWidth,
  type ReceiptPresentation,
} from "@waitron/shared";
import { formatDecimalInput } from "@waitron/ui-core/decimal-input";
import {
  beforeVatFigures,
  invoiceDiscounts,
  isFiled,
  quantityText,
  type FiguredGroup,
  type FiguredLine,
  type FiledLine,
  type GroupDiscount,
} from "./receipt-figures.js";
import {
  receiptDateTime,
  receiptDateTimeNumeric,
  receiptDay,
  receiptDayNumeric,
} from "./receipt-dates.js";
import { cardName } from "./card-details.js";
import { printsAsFullInvoice } from "./invoice-typing.js";
import { groupByParent, mergeIdenticalGroups, type LineGroup } from "./receipt-lines.js";
import { formatAmount, formatMoney, formatVatRate } from "./receipt-money.js";
import type { ReceiptTable, ReceiptTableRow } from "./receipt-table.js";
import type { ReceiptAdjustment, TillSaleLine, TillSaleResult } from "./till-sale.js";

export interface ReceiptIssuer {
  venueName: string;
  nif: string;
  domicile?: string;
}

export interface ReceiptTrim {
  headerSubtitle?: string;
  phone?: string;
  email?: string;
  footerMessage?: string;
}

export interface ReceiptDocumentInput {
  surface?: "thermal" | "a4";
  /** The roll's width; absent on an A4 page (PDF or image), which prints the date in words. */
  paperWidth?: ReceiptPaperWidth;
  logo?: ReceiptLogoRaster | null;
  result: Omit<
    TillSaleResult,
    keyof ReceiptPresentation | "simulatedCardPayment" | "venueAddressLine"
  >;
  issuer: ReceiptIssuer;
  receiptHeader?: { tradingName: string | null; printTradingName: boolean };
  receipt: ReceiptTrim;
  venueAddress?: readonly string[];
  /** The venue's address joined as a registered address is, so that one naming the province
   *  `venueAddress` leaves out still prints once. */
  venueAddressLine?: string;
  invoiceLocale: string;
  namesLocale?: string;
  /** Marks a practice document, regardless of whether money moved. */
  simulated?: boolean;
  simulatedCardPayment?: boolean;
  duplicate?: boolean;
  guests?: number;
  /**
   * A printer's test page: the no-invoice notice prints at the top and bottom, after the practice
   * mark where there is one, and the printer's own line ends the page.
   */
  testPage?: { printer: string };
}

export type { ReceiptElement, ReceiptIndent, ReceiptStyle } from "@waitron/shared";

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
  /** The element of an A4 full invoice's "address · Tel. … · email" line, wrapped at its " · ". */
  contactLine?: number;
  duplicate: boolean;
  practice: boolean;
}

function lineName(descriptions: Record<string, string>, locale: string): string {
  return resolveSnapshotText(descriptions, locale, locale);
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

function adjustmentLabel(
  adjustment: ReceiptAdjustment,
  locale: string,
  label: ReceiptLabels,
): string {
  const percentBp = adjustment.kind === "comp" ? 10000 : adjustment.percentBp;
  if (percentBp === undefined) return label.discount;
  let formatter = percentFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    percentFormatters.set(locale, formatter);
  }
  return `${label.discount} ${formatter.format(percentBp / 100)}%`;
}

export const CONTACT_SEPARATOR = " · ";

// Accents are not folded: a near-match prints twice rather than dropping the filed address.
function sameAddress(lines: readonly string[], line: string, domicile: string): boolean {
  const fold = (value: string): string =>
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  return [lines.join(", "), line].some((venue) => venue !== "" && fold(venue) === fold(domicile));
}

/** A letter per VAT rate, in `vatBreakdown` order; `null` when the bill has a single rate. */
export function rateLetters(vatBreakdown: readonly { rate: string }[]): Map<string, string> | null {
  const letters = new Map<string, string>();
  for (const { rate } of vatBreakdown) {
    if (![...letters.keys()].some((seen) => compareDecimal(decimal(seen), decimal(rate)) === 0)) {
      letters.set(rate, String.fromCharCode(65 + letters.size));
    }
  }
  return letters.size > 1 ? letters : null;
}

export function buildReceiptDocument({
  result,
  issuer: currentIssuer,
  receiptHeader,
  receipt,
  venueAddress = [],
  venueAddressLine = "",
  surface = "thermal",
  paperWidth,
  invoiceLocale,
  namesLocale = invoiceLocale,
  simulated = false,
  simulatedCardPayment = false,
  duplicate = false,
  guests,
  testPage,
}: ReceiptDocumentInput): ReceiptDocument {
  const issuer = result.issuer ?? currentIssuer;
  const locale = invoiceLocale;
  const label = receiptLabelsFor(locale);
  const simplified = !printsAsFullInvoice(result.invoiceType);
  const itemAmount = (value: string): string =>
    simplified ? formatAmount(value, locale) : formatMoney(value, locale);
  const elements: ReceiptElement[] = [];
  const parts: ReceiptDocument["parts"] = {};
  let contactLine: number | undefined;
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
  const letter = ({ vatRate }: TillSaleLine): string => {
    const found = vatRate === undefined ? undefined : rateLetter(vatRate);
    return found === undefined ? "" : ` ${found}`;
  };
  const sharedLetter = (covered: readonly TillSaleLine[]): string => {
    const [first, ...rest] = covered.map(letter);
    return rest.every((one) => one === first) ? first! : "";
  };
  // The advance is named as read from it, never from the words stored on the line.
  const itemName = (line: TillSaleLine): string => {
    if (line.advance === undefined) return lineName(line.descriptions, namesLocale);
    const { invoiceNumber, issuedOn } = line.advance;
    return label.advanceTakenOff
      .replace("{paymentOnAccount}", () => label.paymentOnAccount)
      .replace("{number}", () => invoiceNumber)
      .replace("{date}", () => receiptDayNumeric(issuedOn, locale));
  };
  const takenOff = (adjustment: ReceiptAdjustment, indent: number, suffix = ""): void => {
    const included = simplified ? "" : ` (${label.vatIncluded})`;
    const name = `${" ".repeat(indent)}${adjustmentLabel(adjustment, locale, label)}${included}`;
    row(name, `-${itemAmount(adjustment.amount)}${suffix}`, indent);
  };
  if (simulated) {
    text(label.practice);
    if (simulatedCardPayment) text(label.noRealCharge);
  }
  if (testPage) text(label.paymentNotice);
  if (simulated || testPage) rule();

  if (result.qr !== "") {
    align("center");
    if (result.qrText) text(result.qrText.caption);
    elements.push({ kind: "qr", text: result.qr });
    if (result.qrText) text(result.qrText.legend);
    rule();
    align("left");
  }

  align("center");
  part("logo", () => elements.push({ kind: "logo" }));
  const tradingName = receiptHeader?.tradingName?.trim();
  const printsTradingName =
    receiptHeader?.printTradingName === true &&
    !!tradingName &&
    tradingName !== issuer.venueName.trim();
  if (printsTradingName) text(tradingName, 0, { bold: true });
  const { headerSubtitle, phone, email, footerMessage } = receipt;
  if (headerSubtitle) part("headerSubtitle", () => text(headerSubtitle));
  text(issuer.venueName, 0, printsTradingName ? undefined : { bold: true });
  text(`${label.nif}: ${issuer.nif}`);
  const venueLines = surface === "thermal" ? venueAddress : [];
  if (venueLines.length > 0) part("address", () => venueLines.forEach((line) => text(line)));
  const phoneLine = phone ? `${label.phone} ${phone}` : "";
  if (surface === "a4" && !simplified) {
    const line = [issuer.domicile, phoneLine, email].filter(Boolean).join(CONTACT_SEPARATOR);
    if (line) {
      contactLine = elements.length;
      text(line);
    }
  } else {
    if (phoneLine) part("phone", () => text(phoneLine));
    if (email) part("email", () => text(email));
  }
  if (surface === "thermal" && !simplified && issuer.domicile) {
    if (venueLines.length === 0) text(issuer.domicile);
    else if (!sameAddress(venueLines, venueAddressLine, issuer.domicile)) {
      text(`${label.registeredAddress}: ${issuer.domicile}`);
    }
  }
  if (duplicate) text(label.duplicate);
  rule();
  align("left");

  if (result.orderLabel !== null || result.orderNumber !== 0)
    row(result.orderLabel ?? "", `${label.order} ${result.orderNumber}`, 0, undefined, 2);
  if (result.takeAway === true) text(label.takeAway, 0, { bold: true });
  const dated = (invoice: {
    invoiceNumber: string;
    issuedAt: string;
    issuedOffsetMinutes?: number;
  }) => {
    const date =
      paperWidth === "58mm"
        ? receiptDateTimeNumeric(invoice.issuedAt, locale, invoice.issuedOffsetMinutes)
        : receiptDateTime(invoice.issuedAt, locale, invoice.issuedOffsetMinutes);
    // Two spaces at least, or the invoice number running into the date reads as one figure.
    row(invoice.invoiceNumber, date, 0, undefined, 2);
  };
  if (result.corrects) text(label.correctiveInvoice, 0, { bold: true });
  if (simplified) {
    dated(result);
  } else {
    row(label.invoiceHeading, result.invoiceNumber, 0, { bold: true });
    row(label.date, receiptDateTime(result.issuedAt, locale, result.issuedOffsetMinutes));
  }
  if (result.saleDay !== undefined) {
    const day = paperWidth === "58mm" ? receiptDayNumeric : receiptDay;
    row(label.saleDate, day(result.saleDay, locale));
  }
  if (result.corrects) {
    text(result.corrects.inFull ? label.replacesInvoiceInFull : label.correctsInvoice);
    dated(result.corrects);
    // Invoicing regulation art. 15.5: a replacement states the rectification's amount, zero.
    if (result.corrects.inFull) row(label.rectificationAmount, formatMoney("0.00", locale));
  }
  rule();
  if (!simplified && result.recipient) {
    text(label.customer);
    text(result.recipient.legalName);
    text(
      `${recipientIdentifierLabel(result.recipient.identifierType, locale)}: ${result.recipient.taxId}`,
    );
    text(result.recipient.address);
    text(receiptCountryNameFor(result.recipient.countryCode, locale));
    rule();
  }
  const filedRates: string[] = [];
  for (const line of result.lines) {
    if (!isFiled(line)) continue;
    const rate = line.net.rate;
    if (!filedRates.some((seen) => compareDecimal(decimal(seen), decimal(rate)) === 0)) {
      filedRates.push(rate);
    }
  }
  const withRate = filedRates.length > 1;
  const anyFiled = !simplified && filedRates.length > 0;
  const billAdjustments = result.billAdjustments ?? [];
  let tableRows: ReceiptTableRow[] = [];
  const printedTables: ReceiptTableRow[][] = [];
  const endTable = (): void => {
    if (tableRows.length === 0) return;
    const table: ReceiptTable = {
      ...(printedTables.length === 0
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
      rows: tableRows,
      withRate,
    };
    elements.push({ kind: "table", table });
    printedTables.push(tableRows);
    tableRows = [];
  };
  const rateCell = (rate: string): { rate: string } => ({ rate: formatVatRate(rate, locale) });
  const answers = (dish: TillSaleLine): string[] =>
    customerOptionSnapshotLabels(dish.optionSnapshots ?? [], namesLocale);
  const figured = (line: FiledLine): FiguredLine => ({ line, figures: beforeVatFigures(line) });
  const filedRow = (
    { line, figures: { price, amount } }: FiguredLine,
    indent: number,
  ): ReceiptTableRow => ({
    units: quantityText(line, namesLocale, locale),
    item: itemName(line),
    ...(indent > 0 ? { itemIndent: indent } : {}),
    price: formatAmount(price, locale),
    amount: formatAmount(amount, locale),
    ...rateCell(line.net.rate),
  });
  const discountRow = (discount: GroupDiscount, indent: number): ReceiptTableRow => ({
    units: "",
    item:
      discount.named !== null
        ? adjustmentLabel(discount.named, locale, label)
        : discount.comp
          ? adjustmentLabel({ kind: "comp", amount: "0" }, locale, label)
          : label.discount,
    ...(indent > 0 ? { itemIndent: indent } : {}),
    price: "",
    amount: `-${formatAmount(discount.amount, locale)}`,
    ...rateCell(discount.rate),
  });
  const groups = groupByParent(result.lines);
  const filedGroups: FiguredGroup[] = [];
  if (!simplified) {
    let nextLine = 0;
    groups.forEach(({ dish, options }, at) => {
      const filedIndex = result.lines.indexOf(dish, nextLine);
      nextLine = filedIndex + 1;
      if (!isFiled(dish) || !options.every(isFiled)) return;
      filedGroups.push({
        at,
        family: dish.dishFamily ?? filedIndex,
        lines: [dish, ...options].map(figured),
      });
    });
  }
  const discounts = invoiceDiscounts(filedGroups, billAdjustments);
  const tableGroup = ({ at, lines }: FiguredGroup): void => {
    const [dishFigured, ...optionsFigured] = lines;
    tableRows.push(filedRow(dishFigured!, 0));
    for (const answer of answers(dishFigured!.line)) {
      tableRows.push({ units: "", item: answer, itemIndent: 2, price: "", amount: "" });
    }
    for (const option of optionsFigured) tableRows.push(filedRow(option, 2));
    for (const discount of discounts.under.get(at) ?? []) {
      tableRows.push(discountRow(discount, 2));
    }
  };
  const withVatGroup = ({ dish, options }: LineGroup): void => {
    // Without its filed figures, a dish priced per pack prints its quantity, not its packs.
    const { quantity: count, unitName, soldInEach } = dish;
    const shown = quantityText({ quantity: count, unitName, soldInEach }, namesLocale, locale);
    const quantity = `${shown}  `;
    const included = simplified ? "" : ` (${label.vatIncluded})`;
    const amount = decimal(dish.listGross ?? dish.gross);
    row(`${quantity}${itemName(dish)}${included}`, `${itemAmount(amount)}${letter(dish)}`, {
      after: quantity,
    });
    const sold = decimal(count);
    const recorded = dish.listGross === undefined ? dish.unitPriceGross : dish.listUnitPriceGross;
    if (
      simplified &&
      !result.corrects &&
      recorded !== undefined &&
      compareDecimal(decimal(dish.priceQuantity ?? "1"), decimal("1")) === 0 &&
      !isZeroDecimal(amount) &&
      compareDecimal(sold, decimal("1")) !== 0
    ) {
      const unit = decimal(recorded);
      // A weighed amount is rounded to the cent, so the price it was sold at may not give it back.
      if (compareDecimal(multiplyDecimal(unit, sold), amount) === 0) {
        const price = formatMoney(unit, locale);
        // Counted exactly when the quantity printed above carries no unit name.
        const each =
          shown === formatDecimalInput(count, locale)
            ? label.perUnit.replace("{price}", () => price)
            : `${price} / ${resolveSnapshotText(unitName!, namesLocale, namesLocale)}`;
        text(`${" ".repeat(quantity.length)}${each}`, quantity.length);
      }
    }
    for (const answer of answers(dish)) text(`  ${answer}`, 2);
    for (const option of options) {
      const name = lineName(option.descriptions, namesLocale);
      let caption: string;
      if (!simplified) {
        const { quantity: count, unitName, soldInEach } = option;
        caption = `  ${name} ${quantityText({ quantity: count, unitName, soldInEach }, namesLocale, locale)}`;
      } else if (option.unitName == null || option.soldInEach === true) {
        const perDish = perDishOptionQuantity(option.quantity, dish.quantity);
        caption = perDish > 1 ? `  ${name} x${perDish}` : `  ${name}`;
      } else {
        caption = `  ${name} ${formatDecimalInput(option.quantity, locale)} ${resolveSnapshotText(option.unitName, namesLocale, namesLocale)}`;
      }
      row(caption, `${itemAmount(option.listGross ?? option.gross)}${letter(option)}`, 2);
    }
    // A dish's adjustment covers its extras too (`planAdjustment`); an extra's covers it alone.
    for (const line of [dish, ...options]) {
      const covered = line === dish ? [dish, ...options] : [line];
      for (const adjustment of line.adjustments ?? [])
        takenOff(adjustment, 2, sharedLetter(covered));
    }
  };
  let nextFiled = 0;
  const printed = simplified
    ? mergeIdenticalGroups(groups, result.vatBreakdown.length <= 1)
    : groups;
  // An advance is taken off what the bill came to, so it prints after the whole-bill discounts.
  const advances: (() => void)[] = [];
  printed.forEach((group, at) => {
    const filed = filedGroups[nextFiled]?.at === at ? filedGroups[nextFiled++]! : undefined;
    const print = (): void => {
      if (filed !== undefined) {
        tableGroup(filed);
      } else {
        endTable();
        withVatGroup(group);
      }
    };
    if (group.dish.advance === undefined) print();
    else advances.push(print);
  });
  const lastRows = tableRows.length > 0 ? tableRows : printedTables.at(-1);
  for (const discount of discounts.atEnd) lastRows?.push(discountRow(discount, 0));
  if (!anyFiled) for (const adjustment of billAdjustments) takenOff(adjustment, 0);
  for (const print of advances) print();
  endTable();
  if (printedTables.length > 0) text(`    ${label.pricesExcludeVat}`, 4);
  rule();
  const vatRows = (): void => {
    for (const v of result.vatBreakdown) {
      row(`${label.taxableBase} ${formatVatRate(v.rate, locale)}`, formatMoney(v.base, locale));
      row(`${label.vat} ${formatVatRate(v.rate, locale)}`, formatMoney(v.tax, locale));
    }
  };
  const total = (): void => {
    row(label.total, formatMoney(result.total, locale), 0, { double: true });
  };
  if (simplified) {
    total();
    rule();
    if (result.vatBreakdown.length > 0)
      elements.push({
        kind: "taxTable",
        header: {
          rate: label.taxRateColumn,
          base: label.taxBaseColumn,
          tax: label.taxAmountColumn,
          total: label.taxTotalColumn,
        },
        rows: result.vatBreakdown.map((v) => {
          const rate = formatVatRate(v.rate, locale);
          const found = rateLetter(v.rate);
          return {
            rate: found === undefined ? rate : `${found} ${rate}`,
            base: formatAmount(v.base, locale),
            tax: formatAmount(v.tax, locale),
            total: formatAmount(addDecimal(decimal(v.base), decimal(v.tax)), locale),
          };
        }),
      });
  } else {
    vatRows();
    rule();
    total();
  }
  rule();
  const t = result.tender;
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
  if (result.payments !== undefined && result.payments.length > 0) {
    for (const payment of result.payments) {
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
    row(label.cash, formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale));
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
  if (result.owed !== undefined)
    row(label.owed, formatMoney(result.owed, locale), 0, { bold: true });
  rule();
  if (guests !== undefined) {
    const people = `${guests} ${guests === 1 ? label.guest : label.guests}`;
    const each = divideDecimal(decimal(result.total), decimal(String(guests)), MONEY_SCALE);
    row(`${people} · ${label.perPerson}`, formatMoney(each, locale));
    rule();
  }

  if (footerMessage) {
    align("center");
    part("footerMessage", () => text(footerMessage));
    align("left");
  }
  if (simulated || testPage) rule();
  if (simulated) {
    text(label.practice);
    if (simulatedCardPayment) text(label.noRealCharge);
  }
  if (testPage) {
    text(label.paymentNotice);
    text(testPage.printer);
  }
  if (elements.at(-1)?.kind === "rule") elements.pop();

  return {
    elements,
    parts,
    ...(contactLine === undefined ? {} : { contactLine }),
    duplicate,
    practice: simulated,
  };
}
