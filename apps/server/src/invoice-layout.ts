import { recipientIdentifierLabel, receiptCountryNameFor } from "@waitron/country-packs";
import type { CardDetails } from "@waitron/payments";
import {
  addDecimal,
  decimal,
  divideDecimal,
  ibanGroups,
  isZeroDecimal,
  MONEY_SCALE,
  negateDecimal,
  type Decimal,
  type ReceiptLogoRaster,
} from "@waitron/shared";
import {
  INVOICE_PAGE_HEIGHT,
  INVOICE_PAGE_WIDTH,
  invoiceTextWidth,
  wrapInvoiceParts,
  wrapInvoiceText,
  type InvoicePage,
  type InvoicePageElement,
  type InvoiceTextWeight,
} from "./invoice-page.js";
import { cardName } from "./card-details.js";
import { qrModules } from "./qr-matrix.js";
import { receiptDateTime, receiptDay } from "./receipt-dates.js";
import { CONTACT_SEPARATOR, type ReceiptDocumentInput } from "./receipt-document.js";
import {
  rateLetters,
  receiptFacts,
  type DatedInvoice,
  type FigureSection,
  type ReceiptFacts,
} from "./receipt-facts.js";
import { formatMoney, formatVatRate } from "./receipt-money.js";

const MARGIN = 36;
const RIGHT = INVOICE_PAGE_WIDTH - MARGIN;
const TEXT_WIDTH = RIGHT - MARGIN;
const BODY_SIZE = 9;
const NAME_SIZE = 18;
const TITLE_SIZE = 17;
const LABEL_SIZE = 8;
const VALUE_SIZE = 10;
const LINE_SPACING = 1.4;
const QR_SIZE = (35 * 72) / 25.4;
const QUIET_MODULES = 4;
/** Wider than the quiet zone of the smallest QR (21 modules: 4 × 99.2 / 21 ≈ 18.9 pt). */
const QR_GAP = 24;
/** Between the QR's words and its quiet zone, so a rounding error never puts them inside it. */
const WORDS_GAP = 2;
const HEAVY_RULE = 1.5;
const LIGHT_RULE = 0.75;
const GAP = 8;
const PAIR_GAP = 18;
const PANEL_PADDING = 8;
const BOX_PADDING = 6;
export const CUSTOMER_PANEL_FRACTION = 0.6;
const LOGO_PITCH = 72 / 203;

const lineHeight = (size: number): number => size * LINE_SPACING;

function practiceNotices({ practice, labels }: ReceiptFacts): string[] {
  if (practice === undefined) return [];
  return [labels.practice, ...(practice.noRealCharge ? [labels.noRealCharge] : [])];
}

/** A full-width bordered box of notices, one wrapped paragraph each, from `top`. */
function layoutNoticeBox(
  notices: readonly string[],
  top: number,
): { elements: InvoicePageElement[]; bottom: number } {
  const inner = TEXT_WIDTH - 2 * BOX_PADDING;
  const lines = notices.flatMap((notice) => wrapInvoiceText(notice, inner, BODY_SIZE));
  const height = 2 * BOX_PADDING + lines.length * lineHeight(BODY_SIZE);
  const rule = (x: number, y: number, width: number, thickness: number): InvoicePageElement => ({
    kind: "rule",
    x,
    y,
    width,
    thickness,
  });
  return {
    elements: [
      rule(MARGIN, top, TEXT_WIDTH, LIGHT_RULE),
      rule(MARGIN, top + height - LIGHT_RULE, TEXT_WIDTH, LIGHT_RULE),
      rule(MARGIN, top, LIGHT_RULE, height),
      rule(RIGHT - LIGHT_RULE, top, LIGHT_RULE, height),
      ...lines.map((line, at): InvoicePageElement => ({
        kind: "text",
        text: line,
        x: MARGIN + BOX_PADDING,
        y: top + BOX_PADDING + at * lineHeight(BODY_SIZE),
        size: BODY_SIZE,
        weight: "regular",
        tone: "ink",
      })),
    ],
    bottom: top + height,
  };
}

function invoiceTitle({ labels, corrects, simplified, band }: ReceiptFacts): string {
  const heading =
    corrects !== undefined
      ? labels.correctiveInvoice
      : simplified
        ? labels.simplifiedInvoice
        : labels.invoiceHeading;
  return `${heading} ${band.invoiceNumber}`;
}

/** Page 1's practice box, QR, letterhead, band, corrective lines and customer panel; `bottom` is
 *  where the next part may start. */
export function layoutInvoiceHeader(
  facts: ReceiptFacts,
  logo: ReceiptLogoRaster | null | undefined,
): { elements: InvoicePageElement[]; bottom: number } {
  const { labels, locale, letterhead, band, corrects, customer } = facts;
  const elements: InvoicePageElement[] = [];
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    weight: InvoiceTextWeight = "regular",
    tone: "ink" | "muted" = "ink",
  ): void => {
    elements.push({ kind: "text", text: value, x, y, size, weight, tone });
  };
  const rule = (x: number, y: number, width: number, thickness: number): void => {
    elements.push({ kind: "rule", x, y, width, thickness });
  };
  let y = MARGIN;

  const notices = [
    ...practiceNotices(facts),
    ...(facts.testPage === undefined ? [] : [labels.paymentNotice]),
  ];
  if (notices.length > 0) {
    const box = layoutNoticeBox(notices, y);
    elements.push(...box.elements);
    y = box.bottom + GAP;
  }

  const top = y;
  let qrBottom = top;
  let letterheadLeft = MARGIN;
  if (facts.qr !== undefined) {
    const { caption, legend } = facts.qr;
    const modules = qrModules(facts.qr.text);
    const moduleSize = QR_SIZE / modules.length;
    const quiet = QUIET_MODULES * moduleSize;
    let at = top;
    if (caption !== undefined) {
      text(caption, MARGIN, at, BODY_SIZE);
      at += lineHeight(BODY_SIZE);
    }
    at += WORDS_GAP + quiet;
    elements.push({ kind: "qr", modules, x: MARGIN, y: at, moduleSize });
    at += QR_SIZE + quiet + WORDS_GAP;
    if (legend !== undefined) {
      text(legend, MARGIN, at, BODY_SIZE);
      at += lineHeight(BODY_SIZE);
    }
    qrBottom = at;
    letterheadLeft = MARGIN + QR_SIZE + QR_GAP;
  }

  const available = RIGHT - letterheadLeft;
  let at = top;
  const rightAligned = (
    lines: readonly string[],
    size: number,
    weight: InvoiceTextWeight = "regular",
  ): void => {
    for (const line of lines) {
      text(line, RIGHT - invoiceTextWidth(line, size, weight), at, size, weight);
      at += lineHeight(size);
    }
  };
  if (logo) {
    const scale = Math.min(1, available / (logo.widthDots * LOGO_PITCH));
    const width = logo.widthDots * LOGO_PITCH * scale;
    const height = logo.heightDots * LOGO_PITCH * scale;
    elements.push({ kind: "logo", raster: logo, x: RIGHT - width, y: at, width, height });
    at += height + GAP / 2;
  }
  const { tradingName, headerSubtitle, legalName, nif, domicile, phone, email } = letterhead;
  rightAligned(
    wrapInvoiceText(tradingName ?? legalName, available, NAME_SIZE, "bold"),
    NAME_SIZE,
    "bold",
  );
  if (headerSubtitle)
    rightAligned(wrapInvoiceText(headerSubtitle, available, BODY_SIZE), BODY_SIZE);
  const nifPart = `${labels.nif} ${nif}`;
  const identity =
    tradingName === undefined ? nifPart : `${legalName}${CONTACT_SEPARATOR}${nifPart}`;
  rightAligned(wrapInvoiceParts(identity, available, BODY_SIZE, "regular"), BODY_SIZE);
  if (!facts.simplified && domicile) {
    rightAligned(wrapInvoiceText(domicile, available, BODY_SIZE), BODY_SIZE);
  }
  const contact = [phone ? `${labels.phone} ${phone}` : "", email ?? ""]
    .filter(Boolean)
    .join(CONTACT_SEPARATOR);
  if (contact) rightAligned(wrapInvoiceParts(contact, available, BODY_SIZE, "regular"), BODY_SIZE);

  y = Math.max(qrBottom, at) + GAP;
  rule(MARGIN, y, TEXT_WIDTH, HEAVY_RULE);
  y += HEAVY_RULE + GAP;

  const title = invoiceTitle(facts);
  const titleLines = wrapInvoiceText(title, TEXT_WIDTH, TITLE_SIZE, "bold");
  const titleWidth = Math.max(
    ...titleLines.map((line) => invoiceTextWidth(line, TITLE_SIZE, "bold")),
  );
  titleLines.forEach((line, index) =>
    text(line, MARGIN, y + index * lineHeight(TITLE_SIZE), TITLE_SIZE, "bold"),
  );
  const titleBottom = y + titleLines.length * lineHeight(TITLE_SIZE);

  const pairs: { label?: string; value: string }[] = [
    ...(band.duplicate ? [{ value: labels.duplicate }] : []),
    { label: labels.date, value: receiptDateTime(band.issuedAt, locale, band.issuedOffsetMinutes) },
    ...(band.saleDay === undefined
      ? []
      : [{ label: labels.saleDate, value: receiptDay(band.saleDay, locale) }]),
    ...(band.orderLabel ? [{ value: band.orderLabel }] : []),
    ...(band.orderLabel !== null || band.orderNumber !== 0
      ? [{ label: labels.order, value: String(band.orderNumber) }]
      : []),
    ...(band.takeAway ? [{ value: labels.takeAway }] : []),
  ];
  const pairHeight = lineHeight(LABEL_SIZE) + lineHeight(VALUE_SIZE);
  const besideTitle = MARGIN + titleWidth + PAIR_GAP;
  const pairsLeft =
    besideTitle <= MARGIN + TEXT_WIDTH / 2
      ? Math.max(MARGIN + TEXT_WIDTH * 0.4, besideTitle)
      : MARGIN;
  let pairsTop = pairsLeft === MARGIN ? titleBottom : y;
  let x = pairsLeft;
  let rowHeight = pairHeight;
  for (const pair of pairs) {
    const valueLines = wrapInvoiceText(pair.value, RIGHT - pairsLeft, VALUE_SIZE);
    const width = Math.max(
      pair.label === undefined ? 0 : invoiceTextWidth(pair.label, LABEL_SIZE),
      ...valueLines.map((line) => invoiceTextWidth(line, VALUE_SIZE)),
    );
    if (x > pairsLeft && x + width > RIGHT) {
      x = pairsLeft;
      pairsTop += rowHeight;
      rowHeight = pairHeight;
    }
    if (pair.label !== undefined) text(pair.label, x, pairsTop, LABEL_SIZE, "regular", "muted");
    valueLines.forEach((line, index) =>
      text(line, x, pairsTop + lineHeight(LABEL_SIZE) + index * lineHeight(VALUE_SIZE), VALUE_SIZE),
    );
    rowHeight = Math.max(rowHeight, pairHeight + (valueLines.length - 1) * lineHeight(VALUE_SIZE));
    x += width + PAIR_GAP;
  }
  y = Math.max(titleBottom, pairsTop + rowHeight) + GAP / 2;
  rule(MARGIN, y, TEXT_WIDTH, LIGHT_RULE);
  y += LIGHT_RULE + GAP;

  const bodyLines = (lines: readonly string[], left: number): void => {
    for (const line of lines) {
      text(line, left, y, BODY_SIZE);
      y += lineHeight(BODY_SIZE);
    }
  };
  if (corrects !== undefined) {
    const dated = ({ invoiceNumber, issuedAt, issuedOffsetMinutes }: DatedInvoice): string =>
      `${invoiceNumber}${CONTACT_SEPARATOR}${receiptDateTime(issuedAt, locale, issuedOffsetMinutes)}`;
    const heading = corrects.inFull ? labels.replacesInvoiceInFull : labels.correctsInvoice;
    bodyLines(wrapInvoiceText(`${heading} ${dated(corrects)}`, TEXT_WIDTH, BODY_SIZE), MARGIN);
    // Invoicing regulation art. 15.5: a replacement states the rectification's amount, zero.
    if (corrects.inFull) {
      const amount = `${labels.rectificationAmount}: ${formatMoney("0.00", locale)}`;
      bodyLines(wrapInvoiceText(amount, TEXT_WIDTH, BODY_SIZE), MARGIN);
    }
    y += GAP;
  }

  if (customer !== undefined) {
    const width = TEXT_WIDTH * CUSTOMER_PANEL_FRACTION;
    const inner = width - 2 * PANEL_PADDING;
    const left = MARGIN + PANEL_PADDING;
    const panel: InvoicePageElement = {
      kind: "box",
      x: MARGIN,
      y,
      width,
      height: 0,
      fill: "panel",
    };
    elements.push(panel);
    const panelTop = y;
    y += PANEL_PADDING;
    text(labels.customer, left, y, LABEL_SIZE, "regular", "muted");
    y += lineHeight(LABEL_SIZE);
    for (const line of wrapInvoiceText(customer.legalName, inner, BODY_SIZE, "bold")) {
      text(line, left, y, BODY_SIZE, "bold");
      y += lineHeight(BODY_SIZE);
    }
    const identifier = `${recipientIdentifierLabel(customer.identifierType, locale)}: ${customer.taxId}`;
    bodyLines(wrapInvoiceText(identifier, inner, BODY_SIZE), left);
    const place = [customer.address, receiptCountryNameFor(customer.countryCode, locale)]
      .filter(Boolean)
      .join(CONTACT_SEPARATOR);
    bodyLines(wrapInvoiceParts(place, inner, BODY_SIZE, "regular"), left);
    y += PANEL_PADDING;
    panel.height = y - panelTop;
    y += GAP;
  }

  return { elements, bottom: y };
}

const PAGE_FOOT = INVOICE_PAGE_HEIGHT - MARGIN;
const TOTAL_SIZE = 18;
const CELL_PADDING = 4;
const ROW_PADDING = 3;
const ROW_RULE = 0.5;
const INDENT_UNIT = 6;

interface TableColumn {
  heading: string;
  width: number;
  align: "left" | "right";
}

interface TableRow {
  cells: string[];
  indent: number;
  muted: boolean;
}

type Line = { text: string; bold?: boolean };

const QUANTITY_WIDTH = 40;
/** Holds "99999 mg" on one line; a unit may be thousands of characters, so a longer one wraps. */
const QUANTITY_MAX_WIDTH = 72;

function tableColumns({ labels, simplified }: ReceiptFacts, rows: TableRow[]): TableColumn[] {
  // A weighed quantity ("0,350 kg") wraps in the narrow column, so the column grows to its widest
  // quantity and Description gives up the room.
  const quantity = Math.min(
    QUANTITY_MAX_WIDTH,
    Math.max(
      QUANTITY_WIDTH,
      ...rows.map(
        (row) => invoiceTextWidth(row.cells[1]!, BODY_SIZE, "regular") + 2 * CELL_PADDING,
      ),
    ),
  );
  const right = (heading: string, width: number): TableColumn => ({
    heading,
    width,
    align: "right",
  });
  const figures = simplified
    ? [
        right(labels.quantityColumn, quantity),
        right(labels.priceColumn, 80),
        right(labels.amountColumn, 80),
      ]
    : [
        right(labels.quantityColumn, quantity),
        right(labels.unitPriceExVatColumn, 72),
        right(labels.totalExVatColumn, 72),
        right(labels.vatColumn, 44),
        right(labels.totalWithVatColumn, 72),
      ];
  const used = figures.reduce((sum, column) => sum + column.width, 0);
  return [
    { heading: labels.descriptionColumn, width: TEXT_WIDTH - used, align: "left" },
    ...figures,
  ];
}

function tableRows(facts: ReceiptFacts): TableRow[] {
  const { locale, simplified } = facts;
  const money = (value: Decimal): string => formatMoney(value, locale);
  const lettered = (amount: Decimal, letter: string): string =>
    letter === "" ? money(amount) : `${money(amount)} ${letter}`;
  // A VAT-included row fills the price and the last column, whichever table it sits in.
  const withVat = (
    item: string,
    quantity: string,
    price: string,
    amount: string,
    indent: number,
  ): TableRow => ({
    cells: simplified ? [item, quantity, price, amount] : [item, quantity, "", "", "", amount],
    indent,
    muted: indent > 0,
  });
  const rows: TableRow[] = [];
  const add = (section: FigureSection): void => {
    if (section.kind === "filed") {
      for (const row of section.rows) {
        rows.push({
          cells: [
            row.item,
            row.units,
            row.unitPrice === undefined ? "" : money(row.unitPrice),
            row.amountExVat === undefined ? "" : money(row.amountExVat),
            row.rate === undefined ? "" : formatVatRate(row.rate, locale),
            row.chargedWithVat === undefined ? "" : money(row.chargedWithVat),
          ],
          indent: row.indent,
          muted: row.kind === "option" || row.kind === "answer" || row.kind === "discount",
        });
      }
    } else if (section.kind === "withVat") {
      const { group } = section;
      const plus = group.surcharge ? "+" : "";
      const price =
        group.perUnit === undefined
          ? ""
          : `${plus}${money(group.perUnit.price)}${group.perUnit.unitName === undefined ? "" : `/${group.perUnit.unitName}`}`;
      const amount =
        group.amount === undefined ? "" : `${plus}${lettered(group.amount, group.rateLetter)}`;
      rows.push(withVat(group.item, group.quantity, price, amount, 0));
      for (const answer of group.answers) rows.push(withVat(answer, "", "", "", 2));
      for (const option of group.options) {
        rows.push(
          withVat(option.item, option.quantity, "", lettered(option.amount, option.rateLetter), 2),
        );
      }
      for (const adjustment of group.adjustments) {
        rows.push(
          withVat(adjustment.item, "", "", lettered(adjustment.amount, adjustment.rateLetter), 2),
        );
      }
    } else {
      for (const row of section.rows) {
        rows.push({ ...withVat(row.item, "", "", money(row.amount), 0), muted: true });
      }
    }
  };
  facts.sections.forEach(add);
  return rows;
}

function paymentLines(facts: ReceiptFacts): Line[] {
  const { labels, locale, total, band } = facts;
  const { payments = [], tender, owed } = facts.payment;
  const money = (value: Decimal | string): string => formatMoney(value, locale);
  const deferred =
    facts.payment.deferred ?? (tender.method === "deferred" ? { account: null } : undefined);
  if (deferred !== undefined) {
    const { account } = deferred;
    if (account === null) return [{ text: `${labels.deferredPayment}.` }];
    const instruction = labels.transferInstruction.replace("{number}", () => band.invoiceNumber);
    const iban = `${labels.iban}: ${ibanGroups(account.iban).join(" ")}`;
    return [
      { text: `${labels.deferredPayment}. ${instruction}` },
      {
        text:
          account.bankName === null ? iban : `${iban}   ${labels.bankName}: ${account.bankName}`,
      },
    ];
  }

  const cardParts = (card: CardDetails | undefined, amount: Decimal): string[] => {
    if (card === undefined) return [`${labels.card} ${money(amount)}`];
    const presented = {
      contactless: ` (${labels.paymentContactless})`,
      chip: ` (${labels.paymentChip})`,
      swipe: ` (${labels.paymentSwipe})`,
      unknown: "",
    }[card.entryMode];
    return [
      `${cardName(card, labels.card)}${presented} ${money(amount)}`,
      ...(card.authCode === null ? [] : [`${labels.paymentAuthorization} ${card.authCode}`]),
    ];
  };
  const amountPart = (word: string, value: string): string[] =>
    isZeroDecimal(decimal(value)) ? [] : [`${word} ${money(value)}`];
  const refunds: string[] = [];
  const paid: string[][] = [];
  for (const payment of payments) {
    const given = payment.refunds.map((refund) =>
      addDecimal(decimal(refund.amount), decimal(refund.tip)),
    );
    if (payment.method === "cash") {
      paid.push([
        `${labels.cash} ${money(payment.tendered)}`,
        ...amountPart(labels.change, payment.change),
        ...amountPart(labels.tip, payment.tip),
      ]);
    } else {
      const charged = given.reduce(addDecimal, decimal(payment.amount));
      paid.push([
        ...cardParts(payment.card, charged),
        ...(payment.reference === null ? [] : [`${labels.reference} ${payment.reference}`]),
        ...amountPart(labels.tip, payment.tip),
      ]);
    }
    for (const amount of given) refunds.push(`${labels.refund} ${money(negateDecimal(amount))}`);
  }
  if (payments.length === 0 && tender.method === "cash") {
    paid.push([
      `${labels.cash} ${money(addDecimal(total, decimal(tender.change)))}`,
      ...amountPart(labels.change, tender.change),
    ]);
  } else if (payments.length === 0 && tender.method === "card") {
    paid.push([
      ...(tender.card === undefined
        ? [labels.card]
        : cardParts(tender.card, decimal(tender.charged))),
      ...(tender.reference === null ? [] : [`${labels.reference} ${tender.reference}`]),
      ...(isZeroDecimal(decimal(tender.tip))
        ? []
        : [`${labels.tip} ${money(tender.tip)}`, `${labels.charged} ${money(tender.charged)}`]),
    ]);
  }
  const listed = [
    ...paid.map((parts) => ({ text: parts.join(CONTACT_SEPARATOR) })),
    ...refunds.map((text) => ({ text })),
  ];
  if (owed !== undefined) {
    return [...listed, { text: `${labels.owed} ${money(owed)}`, bold: true }];
  }
  if (paid.length === 0) return [];
  const [first, ...rest] = listed;
  return [{ text: `${labels.paid}${CONTACT_SEPARATOR}${first!.text}` }, ...rest];
}

/** The VAT summary, TOTAL, guests and payment footer, laid out from y = 0. */
function layoutClosing(facts: ReceiptFacts): { elements: InvoicePageElement[]; height: number } {
  const { labels, locale, total, simplified } = facts;
  const elements: InvoicePageElement[] = [];
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    weight: InvoiceTextWeight = "regular",
    tone: "ink" | "muted" = "ink",
  ): void => {
    elements.push({ kind: "text", text: value, x, y, size, weight, tone });
  };
  const rightAt = (
    value: string,
    right: number,
    y: number,
    size: number,
    weight: InvoiceTextWeight = "regular",
    tone: "ink" | "muted" = "ink",
  ): void => text(value, right - invoiceTextWidth(value, size, weight), y, size, weight, tone);
  const money = (value: Decimal): string => formatMoney(value, locale);

  const left = MARGIN + TEXT_WIDTH / 2;
  const width = TEXT_WIDTH / 2;
  const headings = [
    labels.taxRateColumn,
    labels.vatSummaryBaseColumn,
    labels.vatSummaryAmountColumn,
    labels.taxTotalColumn,
  ];
  const letters = simplified ? rateLetters(facts.vat) : null;
  const rows = facts.vat.map(({ rate, base, tax }) => {
    const shown = formatVatRate(rate, locale);
    const letter = letters?.get(rate);
    return [
      letter === undefined ? shown : `${letter} ${shown}`,
      money(base),
      money(tax),
      money(addDecimal(base, tax)),
    ];
  });
  // Each column takes what its widest word needs and the room left is shared out, so a heading
  // wraps only when the four cannot fit side by side at all.
  const needs = headings.map(
    (heading, index) =>
      Math.max(
        invoiceTextWidth(heading, LABEL_SIZE, "regular"),
        ...rows.map((row) => invoiceTextWidth(row[index]!, BODY_SIZE, "regular")),
      ) +
      2 * CELL_PADDING,
  );
  const spare = width - needs.reduce((sum, need) => sum + need, 0);
  const columns = spare >= 0 ? needs.map((need) => need + spare / 4) : needs.map(() => width / 4);
  const cellRight = (index: number): number =>
    left + columns.slice(0, index + 1).reduce((sum, column) => sum + column, 0) - CELL_PADDING;
  let y = 0;
  const cells = (values: string[], size: number, tone: "ink" | "muted"): void => {
    const wrapped = values.map((value, index) =>
      wrapInvoiceText(value, columns[index]! - 2 * CELL_PADDING, size),
    );
    wrapped.forEach((lines, index) =>
      lines.forEach((line, at) =>
        rightAt(line, cellRight(index), y + at * lineHeight(size), size, "regular", tone),
      ),
    );
    y += Math.max(...wrapped.map((lines) => lines.length)) * lineHeight(size);
  };
  cells(headings, LABEL_SIZE, "muted");
  for (const row of rows) cells(row, BODY_SIZE, "ink");
  y += GAP / 2;
  elements.push({ kind: "rule", x: left, y, width, thickness: HEAVY_RULE });
  y += HEAVY_RULE + GAP / 2;
  text(labels.total, left, y, TOTAL_SIZE, "bold");
  rightAt(money(total), RIGHT, y, TOTAL_SIZE, "bold");
  y += lineHeight(TOTAL_SIZE);
  if (facts.guests !== undefined) {
    const { guests } = facts;
    const people = `${guests} ${guests === 1 ? labels.guest : labels.guests}`;
    const each = divideDecimal(total, decimal(String(guests)), MONEY_SCALE);
    rightAt(`${people}${CONTACT_SEPARATOR}${labels.perPerson} ${money(each)}`, RIGHT, y, BODY_SIZE);
    y += lineHeight(BODY_SIZE);
  }

  const lines = paymentLines(facts);
  if (lines.length > 0) {
    y += GAP;
    elements.push({ kind: "rule", x: MARGIN, y, width: TEXT_WIDTH, thickness: LIGHT_RULE });
    y += LIGHT_RULE + GAP;
    text(labels.paymentMethodHeading, MARGIN, y, BODY_SIZE, "bold");
    y += lineHeight(BODY_SIZE);
    for (const line of lines) {
      const weight = line.bold === true ? "bold" : "regular";
      for (const part of wrapInvoiceParts(line.text, TEXT_WIDTH, BODY_SIZE, weight)) {
        text(part, MARGIN, y, BODY_SIZE, weight);
        y += lineHeight(BODY_SIZE);
      }
    }
  }
  const notices = [
    ...practiceNotices(facts),
    ...(facts.testPage === undefined ? [] : [labels.paymentNotice, facts.testPage.printer]),
  ];
  if (notices.length > 0) {
    const box = layoutNoticeBox(notices, y + GAP);
    elements.push(...box.elements);
    y = box.bottom;
  }
  return { elements, height: y };
}

/** A whole A4 invoice: page 1's header, the item table over as many pages as it takes, then the
 *  closing block, kept whole on one page, and the footer message at the foot of the last page. */
export function layoutA4Invoice(input: ReceiptDocumentInput): InvoicePage[] {
  const facts = receiptFacts(input);
  const header = layoutInvoiceHeader(facts, input.logo);
  const pages: InvoicePageElement[][] = [header.elements];
  let page = header.elements;
  let y = header.bottom;
  const continuedTop = MARGIN + lineHeight(LABEL_SIZE) + GAP;
  const newPage = (): void => {
    page = [];
    pages.push(page);
    y = continuedTop;
  };
  const text = (
    value: string,
    x: number,
    top: number,
    size: number,
    weight: InvoiceTextWeight,
    tone: "ink" | "muted",
  ): void => {
    page.push({ kind: "text", text: value, x, y: top, size, weight, tone });
  };

  const rows = tableRows(facts);
  const columns = tableColumns(facts, rows);
  const lefts = columns.map((_, index) =>
    columns.slice(0, index).reduce((sum, column) => sum + column.width, MARGIN),
  );
  const wrapCells = (
    cells: readonly string[],
    size: number,
    weight: InvoiceTextWeight,
    indent: number,
  ): string[][] =>
    cells.map((cell, index) =>
      cell === ""
        ? []
        : wrapInvoiceText(
            cell,
            columns[index]!.width - 2 * CELL_PADDING - (index === 0 ? indent : 0),
            size,
            weight,
          ),
    );
  const cellsHeight = (lines: readonly string[][], size: number): number =>
    Math.max(1, ...lines.map((cell) => cell.length)) * lineHeight(size) + 2 * ROW_PADDING;
  const drawCells = (
    lines: readonly string[][],
    size: number,
    weight: InvoiceTextWeight,
    tone: "ink" | "muted",
    indent: number,
  ): void => {
    lines.forEach((cell, index) => {
      const column = columns[index]!;
      cell.forEach((line, at) => {
        const x =
          column.align === "left"
            ? lefts[index]! + CELL_PADDING + indent
            : lefts[index]! + column.width - CELL_PADDING - invoiceTextWidth(line, size, weight);
        text(line, x, y + ROW_PADDING + at * lineHeight(size), size, weight, tone);
      });
    });
  };
  const headingLines = wrapCells(
    columns.map((column) => column.heading),
    LABEL_SIZE,
    "bold",
    0,
  );
  const headingHeight = cellsHeight(headingLines, LABEL_SIZE);
  let headed = false;
  for (const row of rows) {
    const indent = row.indent * INDENT_UNIT;
    const lines = wrapCells(row.cells, BODY_SIZE, "regular", indent);
    const height = cellsHeight(lines, BODY_SIZE) + ROW_RULE;
    if (y + height + (headed ? 0 : headingHeight) > PAGE_FOOT) {
      newPage();
      headed = false;
    }
    if (!headed) {
      page.push({
        kind: "box",
        x: MARGIN,
        y,
        width: TEXT_WIDTH,
        height: headingHeight,
        fill: "heading",
      });
      drawCells(headingLines, LABEL_SIZE, "bold", "ink", 0);
      y += headingHeight;
      headed = true;
    }
    drawCells(lines, BODY_SIZE, "regular", row.muted ? "muted" : "ink", indent);
    y += height - ROW_RULE;
    page.push({ kind: "rule", x: MARGIN, y, width: TEXT_WIDTH, thickness: ROW_RULE });
    y += ROW_RULE;
  }

  const message =
    facts.footerMessage === undefined
      ? []
      : wrapInvoiceText(facts.footerMessage, TEXT_WIDTH, LABEL_SIZE);
  const messageHeight = message.length * lineHeight(LABEL_SIZE);
  const closing = layoutClosing(facts);
  y += 2 * GAP;
  if (y + closing.height > PAGE_FOOT - messageHeight - (message.length > 0 ? GAP : 0)) newPage();
  const offset = y;
  page.push(...closing.elements.map((element) => ({ ...element, y: element.y + offset })));
  message.forEach((line, at) => {
    const top = PAGE_FOOT - (message.length - at) * lineHeight(LABEL_SIZE);
    const x = MARGIN + (TEXT_WIDTH - invoiceTextWidth(line, LABEL_SIZE)) / 2;
    text(line, x, top, LABEL_SIZE, "regular", "muted");
  });

  const title = invoiceTitle(facts);
  pages.forEach((elements, index) => {
    if (index === 0) return;
    const line = facts.labels.continuedPage
      .replace("{title}", () => title)
      .replace("{page}", String(index + 1))
      .replace("{pages}", String(pages.length));
    elements.unshift({
      kind: "text",
      text: line,
      x: MARGIN,
      y: MARGIN,
      size: LABEL_SIZE,
      weight: "regular",
      tone: "muted",
    });
  });
  return pages.map((elements) => ({ elements }));
}
