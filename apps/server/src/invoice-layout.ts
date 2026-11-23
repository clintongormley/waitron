import { recipientIdentifierLabel, receiptCountryNameFor } from "@waitron/country-packs";
import type { ReceiptLogoRaster } from "@waitron/shared";
import {
  INVOICE_PAGE_WIDTH,
  invoiceTextWidth,
  wrapInvoiceParts,
  wrapInvoiceText,
  type InvoicePageElement,
  type InvoiceTextWeight,
} from "./invoice-page.js";
import { qrModules } from "./qr-matrix.js";
import { receiptDateTime, receiptDay } from "./receipt-dates.js";
import { CONTACT_SEPARATOR } from "./receipt-document.js";
import type { DatedInvoice, ReceiptFacts } from "./receipt-facts.js";
import { formatMoney } from "./receipt-money.js";

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
    ...(facts.practice === undefined ? [] : [labels.practice]),
    ...(facts.practice?.noRealCharge === true ? [labels.noRealCharge] : []),
    ...(facts.testPage === undefined ? [] : [labels.paymentNotice]),
  ];
  if (notices.length > 0) {
    const inner = TEXT_WIDTH - 2 * BOX_PADDING;
    const lines = notices.flatMap((notice) => wrapInvoiceText(notice, inner, BODY_SIZE));
    const height = 2 * BOX_PADDING + lines.length * lineHeight(BODY_SIZE);
    rule(MARGIN, y, TEXT_WIDTH, LIGHT_RULE);
    rule(MARGIN, y + height - LIGHT_RULE, TEXT_WIDTH, LIGHT_RULE);
    rule(MARGIN, y, LIGHT_RULE, height);
    rule(RIGHT - LIGHT_RULE, y, LIGHT_RULE, height);
    lines.forEach((line, at) =>
      text(line, MARGIN + BOX_PADDING, y + BOX_PADDING + at * lineHeight(BODY_SIZE), BODY_SIZE),
    );
    y += height + GAP;
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

  const title = `${corrects === undefined ? labels.invoiceHeading : labels.correctiveInvoice} ${band.invoiceNumber}`;
  const titleLines = wrapInvoiceText(title, TEXT_WIDTH, TITLE_SIZE, "bold");
  const titleWidth = Math.max(
    ...titleLines.map((line) => invoiceTextWidth(line, TITLE_SIZE, "bold")),
  );
  titleLines.forEach((line, index) =>
    text(line, MARGIN, y + index * lineHeight(TITLE_SIZE), TITLE_SIZE, "bold"),
  );
  const titleBottom = y + titleLines.length * lineHeight(TITLE_SIZE);

  const pairs: { label?: string; value: string }[] = [
    { label: labels.date, value: receiptDateTime(band.issuedAt, locale, band.issuedOffsetMinutes) },
    ...(band.saleDay === undefined
      ? []
      : [{ label: labels.saleDate, value: receiptDay(band.saleDay, locale) }]),
    ...(band.orderLabel ? [{ value: band.orderLabel }] : []),
    ...(band.orderLabel !== null || band.orderNumber !== 0
      ? [{ label: labels.order, value: String(band.orderNumber) }]
      : []),
    ...(band.takeAway ? [{ value: labels.takeAway }] : []),
    ...(band.duplicate ? [{ value: labels.duplicate }] : []),
  ];
  const pairHeight = lineHeight(LABEL_SIZE) + lineHeight(VALUE_SIZE);
  const besideTitle = MARGIN + titleWidth + PAIR_GAP;
  const pairsLeft = besideTitle <= MARGIN + TEXT_WIDTH / 2 ? MARGIN + TEXT_WIDTH * 0.4 : MARGIN;
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
