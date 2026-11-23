import { customerOptionSnapshotLabels } from "@waitron/menu";
import type { ReceiptLabels } from "@waitron/country";
import type { BankAccount } from "@waitron/db";
import { receiptLabelsFor, type RecipientIdentifierType } from "@waitron/country-packs";
import {
  addDecimal,
  compareDecimal,
  decimal,
  isZeroDecimal,
  multiplyDecimal,
  negateDecimal,
  perDishOptionQuantity,
  resolveSnapshotText,
  subtractDecimal,
  sumDecimals,
  type Decimal,
  type ReceiptLogoRaster,
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
import { receiptDayNumeric } from "./receipt-dates.js";
import { printsAsFullInvoice } from "./invoice-typing.js";
import {
  groupByParent,
  isCoveredDish,
  isSurcharge,
  mergeIdenticalGroups,
  printsOnTicket,
  type LineGroup,
} from "./receipt-lines.js";
import type { BillTenderLine } from "./receipt-payments.js";
import type { ReceiptAdjustment, TenderBlock, TillSaleLine, TillSaleResult } from "./till-sale.js";

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
  /** The roll's width; absent on an A4 page (PDF or image). */
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
  /** Set when the sale, or one it replaces, was closed as a deferred payment. */
  deferredPayment?: { account: BankAccount | null };
}

export const CONTACT_SEPARATOR = " · ";

/** A row of a full invoice's table, before VAT. Amounts are what the row adds: a discount's are
 *  negative. A set menu's covered dish has no money figures. */
export interface FiledFigureRow {
  kind: "line" | "option" | "answer" | "discount" | "advance";
  units: string;
  item: string;
  indent: number;
  unitPrice?: Decimal;
  amountExVat?: Decimal;
  rate?: Decimal;
  /** What the row was charged, VAT included; a table's rows add up to its lines' `gross`. */
  chargedWithVat?: Decimal;
}

export interface WithVatOption {
  item: string;
  /** "" when nothing prints after the name. */
  quantity: string;
  amount: Decimal;
  rateLetter: string;
}

export interface WithVatAdjustment {
  item: string;
  /** Negative: what the adjustment took off. */
  amount: Decimal;
  rateLetter: string;
}

/** A dish priced with VAT: every line of a simplified invoice, and an unfiled dish on a full one. */
export interface WithVatFigures {
  quantity: string;
  item: string;
  /** Absent for a set menu's covered dish. */
  amount?: Decimal;
  /** A set-menu surcharge on a simplified invoice: its amount and price each print with a plus. */
  surcharge?: true;
  /** "" when the bill has one rate, or the line none. */
  rateLetter: string;
  /** The price each, with the unit it is per; no `unitName` for a count. */
  perUnit?: { price: Decimal; unitName?: string };
  answers: string[];
  options: WithVatOption[];
  adjustments: WithVatAdjustment[];
}

export type FigureSection =
  | { kind: "filed"; rows: FiledFigureRow[] }
  | { kind: "withVat"; group: WithVatFigures }
  /** Whole-bill adjustments on a receipt with no filed table; amounts negative. */
  | { kind: "takenOff"; rows: { item: string; amount: Decimal }[] };

export interface ReceiptFigures {
  simplified: boolean;
  sections: FigureSection[];
  /** `letter` is the rate's letter on a simplified invoice with more than one rate. */
  vat: { rate: Decimal; base: Decimal; tax: Decimal; letter?: string }[];
  total: Decimal;
}

/** Where an invoice was dated: its number, instant and the offset it was filed at. */
export interface DatedInvoice {
  invoiceNumber: string;
  issuedAt: string;
  issuedOffsetMinutes?: number;
}

/** What a receipt says, as raw values; placement words, formats and lays them out. */
export type ReceiptFacts = ReceiptFigures & {
  labels: ReceiptLabels;
  locale: string;
  practice?: { noRealCharge: boolean };
  testPage?: { printer: string };
  qr?: { text: string; caption?: string; legend?: string };
  letterhead: {
    /** Present only where it prints: asked for, and not the legal name again. */
    tradingName?: string;
    headerSubtitle?: string;
    legalName: string;
    nif: string;
    domicile?: string;
    venueAddress: string[];
    phone?: string;
    email?: string;
  };
  band: DatedInvoice & {
    saleDay?: string;
    orderLabel: string | null;
    orderNumber: number;
    takeAway: boolean;
    duplicate: boolean;
  };
  corrects?: DatedInvoice & { inFull: boolean };
  /** Only on a full invoice. */
  customer?: {
    legalName: string;
    taxId: string;
    identifierType?: RecipientIdentifierType;
    address: string;
    countryCode: string;
  };
  payment: {
    payments?: BillTenderLine[];
    tender: TenderBlock;
    owed?: Decimal;
    deferred?: { account: BankAccount | null };
  };
  guests?: number;
  footerMessage?: string;
};

const ZERO = decimal("0.00");
const ONE = decimal("1");

const percentFormatters = new Map<string, Intl.NumberFormat>();

export function adjustmentLabel(
  adjustment: Pick<ReceiptAdjustment, "kind" | "percentBp">,
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

function sameRate(left: string, right: string): boolean {
  return compareDecimal(decimal(left), decimal(right)) === 0;
}

/** Every filed line's rate, in the order the rates first appear. */
export function filedRates(lines: readonly TillSaleLine[]): string[] {
  const rates: string[] = [];
  for (const line of lines) {
    if (!isFiled(line)) continue;
    if (!rates.some((seen) => sameRate(seen, line.net.rate))) rates.push(line.net.rate);
  }
  return rates;
}

/** A letter per VAT rate, in `vatBreakdown` order; `null` when the bill has a single rate. */
export function rateLetters(vatBreakdown: readonly { rate: string }[]): Map<string, string> | null {
  const letters = new Map<string, string>();
  for (const { rate } of vatBreakdown) {
    if (![...letters.keys()].some((seen) => sameRate(seen, rate))) {
      letters.set(rate, String.fromCharCode(65 + letters.size));
    }
  }
  return letters.size > 1 ? letters : null;
}

/** A filed line's VAT-included amount, consistent with its VAT-exclusive figures: the list price
 *  only where `beforeVatFigures` priced the row from it. */
function chargedFor({ line, figures }: FiguredLine): Decimal {
  if (line.listGross === undefined) return decimal(line.gross);
  if (compareDecimal(figures.amount, decimal(line.net.base)) === 0) return decimal(line.gross);
  return decimal(line.listGross);
}

export function receiptFigures({
  result,
  invoiceLocale: locale,
  namesLocale = locale,
}: ReceiptDocumentInput): ReceiptFigures {
  const label = receiptLabelsFor(locale);
  const simplified = !printsAsFullInvoice(result.invoiceType);
  const letters = simplified ? rateLetters(result.vatBreakdown) : null;
  const rateLetter = (rate: string): string | undefined =>
    letters === null ? undefined : [...letters].find(([seen]) => sameRate(seen, rate))?.[1];
  const letter = ({ vatRate }: TillSaleLine): string =>
    (vatRate === undefined ? undefined : rateLetter(vatRate)) ?? "";
  const sharedLetter = (covered: readonly TillSaleLine[]): string => {
    const [first, ...rest] = covered.map(letter);
    return rest.every((one) => one === first) ? first! : "";
  };
  // The advance is named as read from it, never from the words stored on the line.
  const itemName = (line: TillSaleLine): string => {
    if (line.advance === undefined)
      return resolveSnapshotText(line.descriptions, namesLocale, namesLocale);
    const { invoiceNumber, issuedOn } = line.advance;
    return label.advanceTakenOff
      .replace("{paymentOnAccount}", () => label.paymentOnAccount)
      .replace("{number}", () => invoiceNumber)
      .replace("{date}", () => receiptDayNumeric(issuedOn, locale));
  };
  const answers = (dish: TillSaleLine): string[] =>
    customerOptionSnapshotLabels(dish.optionSnapshots ?? [], namesLocale);

  const anyFiled = !simplified && filedRates(result.lines).length > 0;
  const billAdjustments = result.billAdjustments ?? [];
  const figured = (line: FiledLine): FiguredLine => ({ line, figures: beforeVatFigures(line) });
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
  const withVat = discountsWithVat(filedGroups, discounts.under);

  const filedRow = (
    figuredLine: FiguredLine,
    kind: FiledFigureRow["kind"],
    indent: number,
  ): FiledFigureRow => {
    const { line, figures } = figuredLine;
    const row: FiledFigureRow = {
      kind: line.advance === undefined ? kind : "advance",
      units: quantityText(line, namesLocale, locale),
      item: itemName(line),
      indent,
      rate: decimal(line.net.rate),
    };
    if (isCoveredDish(line)) return row;
    return {
      ...row,
      unitPrice: figures.price,
      amountExVat: figures.amount,
      chargedWithVat: chargedFor(figuredLine),
    };
  };
  const discountRow = (
    discount: GroupDiscount,
    indent: number,
    chargedWithVat: Decimal,
  ): FiledFigureRow => ({
    kind: "discount",
    units: "",
    item:
      discount.named !== null
        ? adjustmentLabel(discount.named, locale, label)
        : discount.comp
          ? adjustmentLabel({ kind: "comp" }, locale, label)
          : label.discount,
    indent,
    amountExVat: negateDecimal(discount.amount),
    rate: decimal(discount.rate),
    chargedWithVat: negateDecimal(chargedWithVat),
  });

  const sections: FigureSection[] = [];
  let tableRows: FiledFigureRow[] = [];
  let lastTable: FiledFigureRow[] | undefined;
  const endTable = (): void => {
    if (tableRows.length === 0) return;
    sections.push({ kind: "filed", rows: tableRows });
    lastTable = tableRows;
    tableRows = [];
  };
  const tableGroup = ({ at, lines }: FiguredGroup): void => {
    const [dishFigured, ...optionsFigured] = lines;
    tableRows.push(filedRow(dishFigured!, "line", 0));
    for (const answer of answers(dishFigured!.line)) {
      tableRows.push({ kind: "answer", units: "", item: answer, indent: 2 });
    }
    for (const option of optionsFigured) tableRows.push(filedRow(option, "option", 2));
    for (const [index, discount] of (discounts.under.get(at) ?? []).entries()) {
      tableRows.push(discountRow(discount, 2, withVat.under.get(at)![index]!));
    }
  };
  const withVatGroup = ({ dish, options }: LineGroup): WithVatFigures => {
    // Without its filed figures, a dish priced per pack prints its quantity, not its packs.
    const { quantity: count, unitName, soldInEach } = dish;
    const shown = quantityText({ quantity: count, unitName, soldInEach }, namesLocale, locale);
    const amount = decimal(dish.listGross ?? dish.gross);
    const group: WithVatFigures = {
      quantity: shown,
      item: itemName(dish),
      ...(isCoveredDish(dish) ? {} : { amount }),
      ...(simplified && isSurcharge(dish, amount) ? { surcharge: true as const } : {}),
      rateLetter: letter(dish),
      answers: answers(dish),
      options: [],
      adjustments: [],
    };
    const sold = decimal(count);
    const recorded = dish.listGross === undefined ? dish.unitPriceGross : dish.listUnitPriceGross;
    if (
      simplified &&
      !result.corrects &&
      recorded !== undefined &&
      compareDecimal(decimal(dish.priceQuantity ?? "1"), ONE) === 0 &&
      !isZeroDecimal(amount) &&
      compareDecimal(sold, ONE) !== 0
    ) {
      const unit = decimal(recorded);
      // A weighed amount is rounded to the cent, so the price it was sold at may not give it back.
      if (compareDecimal(multiplyDecimal(unit, sold), amount) === 0) {
        // Counted exactly when the quantity printed above carries no unit name.
        group.perUnit =
          shown === formatDecimalInput(count, locale)
            ? { price: unit }
            : { price: unit, unitName: resolveSnapshotText(unitName!, namesLocale, namesLocale) };
      }
    }
    for (const option of options) {
      const item = resolveSnapshotText(option.descriptions, namesLocale, namesLocale);
      let quantity: string;
      if (!simplified) {
        const { quantity: count, unitName, soldInEach } = option;
        quantity = quantityText({ quantity: count, unitName, soldInEach }, namesLocale, locale);
      } else if (option.unitName == null || option.soldInEach === true) {
        const perDish = perDishOptionQuantity(option.quantity, dish.quantity);
        quantity = perDish > 1 ? `x${perDish}` : "";
      } else {
        quantity = `${formatDecimalInput(option.quantity, locale)} ${resolveSnapshotText(option.unitName, namesLocale, namesLocale)}`;
      }
      group.options.push({
        item,
        quantity,
        amount: decimal(option.listGross ?? option.gross),
        rateLetter: letter(option),
      });
    }
    // A dish's adjustment covers its extras too (`planAdjustment`); an extra's covers it alone.
    for (const line of [dish, ...options]) {
      const covered = line === dish ? [dish, ...options] : [line];
      for (const adjustment of line.adjustments ?? []) {
        group.adjustments.push({
          item: adjustmentLabel(adjustment, locale, label),
          amount: negateDecimal(decimal(adjustment.amount)),
          rateLetter: sharedLetter(covered),
        });
      }
    }
    // The end rows carry only filed lines' share of the bill, so an unfiled group prints its own.
    if (anyFiled && billAdjustments.length > 0) {
      const shown = sumDecimals([
        group.amount ?? ZERO,
        ...group.options.map((option) => option.amount),
        ...group.adjustments.map((adjustment) => adjustment.amount),
      ]);
      const billShare = subtractDecimal(
        shown,
        sumDecimals([dish, ...options].map((line) => decimal(line.gross))),
      );
      if (compareDecimal(billShare, ZERO) > 0) {
        group.adjustments.push({
          item:
            discounts.billNamed !== null
              ? adjustmentLabel(discounts.billNamed, locale, label)
              : label.discount,
          amount: negateDecimal(billShare),
          rateLetter: sharedLetter([dish, ...options]),
        });
      }
    }
    return group;
  };

  let nextFiled = 0;
  const printed = simplified
    ? mergeIdenticalGroups(groups.filter(printsOnTicket), result.vatBreakdown.length <= 1)
    : groups;
  // An advance is taken off what the bill came to, so it prints after the whole-bill discounts.
  const advances: (() => void)[] = [];
  printed.forEach((group, at) => {
    const filed = filedGroups[nextFiled]?.at === at ? filedGroups[nextFiled++]! : undefined;
    // Left out only after the filed rows are paired by position, so later rows keep their figures.
    if (!printsOnTicket(group) && !discounts.under.has(at)) return;
    const print = (): void => {
      if (filed !== undefined) {
        tableGroup(filed);
      } else {
        endTable();
        sections.push({ kind: "withVat", group: withVatGroup(group) });
      }
    };
    if (group.dish.advance === undefined) print();
    else advances.push(print);
  });
  const lastRows = tableRows.length > 0 ? tableRows : lastTable;
  for (const discount of discounts.atEnd) {
    lastRows?.push(discountRow(discount, 0, withVat.atEnd(discount.rate)));
  }
  if (!anyFiled && billAdjustments.length > 0) {
    sections.push({
      kind: "takenOff",
      rows: billAdjustments.map((adjustment) => ({
        item: adjustmentLabel(adjustment, locale, label),
        amount: negateDecimal(decimal(adjustment.amount)),
      })),
    });
  }
  for (const print of advances) print();
  endTable();

  return {
    simplified,
    sections,
    vat: result.vatBreakdown.map((v) => {
      const letter = rateLetter(v.rate);
      return {
        rate: decimal(v.rate),
        base: decimal(v.base),
        tax: decimal(v.tax),
        ...(letter === undefined ? {} : { letter }),
      };
    }),
    total: decimal(result.total),
  };
}

export function receiptFacts(input: ReceiptDocumentInput): ReceiptFacts {
  const { result, receipt, receiptHeader, invoiceLocale: locale } = input;
  const figures = receiptFigures(input);
  const issuer = result.issuer ?? input.issuer;
  const tradingName = receiptHeader?.tradingName?.trim();
  const { headerSubtitle, phone, email, footerMessage } = receipt;
  const { corrects, recipient } = result;
  return {
    ...figures,
    labels: receiptLabelsFor(locale),
    locale,
    ...(input.simulated === true
      ? { practice: { noRealCharge: input.simulatedCardPayment === true } }
      : {}),
    ...(input.testPage === undefined ? {} : { testPage: input.testPage }),
    ...(result.qr === ""
      ? {}
      : { qr: { text: result.qr, ...(result.qrText === undefined ? {} : result.qrText) } }),
    letterhead: {
      ...(receiptHeader?.printTradingName === true &&
      !!tradingName &&
      tradingName !== issuer.venueName.trim()
        ? { tradingName }
        : {}),
      ...(headerSubtitle ? { headerSubtitle } : {}),
      legalName: issuer.venueName,
      nif: issuer.nif,
      ...(issuer.domicile ? { domicile: issuer.domicile } : {}),
      venueAddress: [...(input.venueAddress ?? [])],
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
    },
    band: {
      invoiceNumber: result.invoiceNumber,
      issuedAt: result.issuedAt,
      ...offset(result),
      ...(result.saleDay === undefined ? {} : { saleDay: result.saleDay }),
      orderLabel: result.orderLabel,
      orderNumber: result.orderNumber,
      takeAway: result.takeAway === true,
      duplicate: input.duplicate === true,
    },
    ...(corrects === undefined
      ? {}
      : {
          corrects: {
            invoiceNumber: corrects.invoiceNumber,
            issuedAt: corrects.issuedAt,
            ...offset(corrects),
            inFull: corrects.inFull === true,
          },
        }),
    ...(figures.simplified || recipient === undefined
      ? {}
      : {
          customer: {
            legalName: recipient.legalName,
            taxId: recipient.taxId,
            ...(recipient.identifierType === undefined
              ? {}
              : { identifierType: recipient.identifierType }),
            address: recipient.address,
            countryCode: recipient.countryCode,
          },
        }),
    payment: {
      ...(result.payments === undefined ? {} : { payments: result.payments }),
      tender: result.tender,
      ...(result.owed === undefined ? {} : { owed: decimal(result.owed) }),
      ...(input.deferredPayment === undefined ? {} : { deferred: input.deferredPayment }),
    },
    ...(input.guests === undefined ? {} : { guests: input.guests }),
    ...(footerMessage ? { footerMessage } : {}),
  };
}

function offset({ issuedOffsetMinutes }: { issuedOffsetMinutes?: number }): {
  issuedOffsetMinutes?: number;
} {
  return issuedOffsetMinutes === undefined ? {} : { issuedOffsetMinutes };
}

/**
 * The VAT-included amount of each discount row, exact by construction: per dish family and rate,
 * the lines' list prices less what they were charged is split between the family's own row (what
 * its own adjustments took, where a bill share also exists) and the bill's end row at that rate.
 */
function discountsWithVat(
  groups: readonly FiguredGroup[],
  under: ReadonlyMap<number, GroupDiscount[]>,
): { under: Map<number, Decimal[]>; atEnd: (rate: string) => Decimal } {
  const familyOf = new Map(groups.map((group) => [group.at, group.family]));
  const families = new Map<number, FiguredLine[]>();
  for (const group of groups) {
    families.set(group.family, [...(families.get(group.family) ?? []), ...group.lines]);
  }
  const ownRows = new Map<number, GroupDiscount[]>();
  for (const [at, rows] of under) {
    const family = familyOf.get(at)!;
    ownRows.set(family, [...(ownRows.get(family) ?? []), ...rows]);
  }
  const ownWithVat = new Map<GroupDiscount, Decimal>();
  const billWithVat: { rate: string; amount: Decimal }[] = [];
  for (const [family, lines] of families) {
    const ownTaken = sumDecimals(
      lines.flatMap(({ line }) => (line.adjustments ?? []).map((own) => decimal(own.amount))),
    );
    const rates: string[] = [];
    for (const { line } of lines) {
      if (!rates.some((rate) => sameRate(rate, line.net.rate))) rates.push(line.net.rate);
    }
    for (const rate of rates) {
      const atRate = lines.filter(({ line }) => sameRate(line.net.rate, rate));
      const offExVat = sumDecimals(atRate.map(({ figures }) => figures.discount));
      const offWithVat = sumDecimals(
        atRate.map((figured) => subtractDecimal(chargedFor(figured), decimal(figured.line.gross))),
      );
      const own = (ownRows.get(family) ?? []).find((row) => sameRate(row.rate, rate));
      const ownExVat = own?.amount ?? ZERO;
      let ownAmount: Decimal;
      if (isZeroDecimal(ownExVat)) ownAmount = ZERO;
      else if (compareDecimal(ownExVat, offExVat) === 0) ownAmount = offWithVat;
      else ownAmount = compareDecimal(ownTaken, offWithVat) > 0 ? offWithVat : ownTaken;
      if (own !== undefined) ownWithVat.set(own, ownAmount);
      const billShare = subtractDecimal(offWithVat, ownAmount);
      const entry = billWithVat.find((candidate) => sameRate(candidate.rate, rate));
      if (entry === undefined) billWithVat.push({ rate, amount: billShare });
      else entry.amount = addDecimal(entry.amount, billShare);
    }
  }
  return {
    under: new Map([...under].map(([at, rows]) => [at, rows.map((row) => ownWithVat.get(row)!)])),
    atEnd: (rate) => billWithVat.find((entry) => sameRate(entry.rate, rate))!.amount,
  };
}
