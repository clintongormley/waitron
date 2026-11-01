import {
  CLOCK_WITNESS_MARGIN_MS,
  type ClockConfirmationSource,
  type MisdatedDetail,
} from "@waitron/fiscal";
import { decimal, toScale, type Decimal } from "@waitron/shared";
import { csvCell } from "./attendance-export-csv.js";
import { CLOCK_CONFIRMED_BY_WORDS, CLOCK_MISDATED_EMAIL_WORDS } from "./i18n/box-emails.js";
import { MISDATED_SALES_WORDS } from "./i18n/misdated-sales.js";
import { invoiceNumberParts } from "./invoice-number-parts.js";
import { receiptDateTimeNumeric } from "./receipt-dates.js";

type Language = "en" | "es";

export interface MisdatedSalesInput {
  venue: string;
  language: Language;
  /** The display name of the administrator or staff member who confirmed the closing. */
  confirmedByName: string | null;
  episode: { from: string; fromOffsetMinutes: number; to: string; toOffsetMinutes: number };
  detail: Extract<MisdatedDetail, { known: true }>;
}

const MINUTE_MS = 60_000;

const SOURCE_WORD = {
  authority: "authority",
  devices: "devices",
  admin: "admin",
  staff: "staff",
  elapsed: "otherwise",
} as const satisfies Record<ClockConfirmationSource, keyof (typeof CLOCK_CONFIRMED_BY_WORDS)["en"]>;

/** The calendar date (`YYYY-MM-DD`) of an instant at a stored offset. */
function dateAt(instantMs: number, offsetMinutes: number): string {
  return new Date(instantMs + offsetMinutes * MINUTE_MS).toISOString().slice(0, 10);
}

function time(iso: string, offsetMinutes: number): string {
  return receiptDateTimeNumeric(iso, "en-GB", offsetMinutes);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key]!);
}

/** Written without the shared cell's formula guard, so a negative amount stays a number in a
 * spreadsheet; the text is digits, a sign and a decimal mark, so it needs no escaping. */
function amountCell(value: Decimal, language: Language): string {
  const text = toScale(value, 2);
  return `"${language === "es" ? text.replace(".", ",") : text}"`;
}

function header(input: MisdatedSalesInput, boundMs: number, offsetMinutes: number): string {
  const { closing, records } = input.detail;
  const words = MISDATED_SALES_WORDS[input.language];
  const by = CLOCK_CONFIRMED_BY_WORDS[input.language];
  const name = input.confirmedByName;
  const confirmedBy =
    name === null
      ? by[SOURCE_WORD[closing.source]]
      : closing.source === "admin"
        ? `${by.admin} (${name})`
        : closing.source === "staff"
          ? by.staffNamed.replaceAll("{person}", () => name)
          : by[SOURCE_WORD[closing.source]];
  // "Made before" stays true at minute precision only when a bound with seconds is rounded up.
  const roundedBound = Math.ceil(boundMs / MINUTE_MS) * MINUTE_MS;
  const sentence = fill(records.length === 1 ? words.header.one : words.header.text, {
    venue: input.venue,
    count: String(records.length),
    from: time(input.episode.from, input.episode.fromOffsetMinutes),
    to: time(input.episode.to, input.episode.toOffsetMinutes),
    bound: time(new Date(roundedBound).toISOString(), offsetMinutes),
    confirmedBy,
    confirmedAt: time(closing.confirmedAt, offsetMinutes),
  });
  return closing.partial
    ? `${sentence} ${CLOCK_MISDATED_EMAIL_WORDS[input.language].partial}`
    : sentence;
}

export function renderMisdatedSalesCsv(input: MisdatedSalesInput): Uint8Array {
  const { closing, records } = input.detail;
  const words = MISDATED_SALES_WORDS[input.language];
  const boundMs = Date.parse(closing.correctedStart) + CLOCK_WITNESS_MARGIN_MS;
  const headerOffset = closing.startOffsetMinutes ?? input.episode.fromOffsetMinutes;
  const c = words.columns;
  const lines = [
    csvCell(header(input, boundMs, headerOffset)),
    [c.series, c.number, c.invoiceDate, c.timeRecorded, c.realTime, c.amount, c.differentDay]
      .map(csvCell)
      .join(","),
  ];
  for (const record of records) {
    const { series, number } = invoiceNumberParts(record.invoiceNumber);
    const [year, month, day] = record.issueDate.split("-");
    const cancellation = record.kind === "cancellation";
    // A later stored date than the bound's own date at the record's offset means the sale was made
    // on an earlier day than its record says; the same date or earlier cannot be told either way.
    const dayMark = cancellation
      ? words.differentDay.notApplicable
      : record.issueDate > dateAt(boundMs, record.offsetMinutes)
        ? words.differentDay.yes
        : words.differentDay.cannotTell;
    lines.push(
      [
        csvCell(series),
        csvCell(number === null ? "" : number),
        csvCell(`${day}/${month}/${year}`),
        csvCell(time(record.generatedAt, record.offsetMinutes)),
        csvCell(words.unknown),
        cancellation
          ? csvCell(words.cancellation)
          : amountCell(decimal(record.amount!), input.language),
        csvCell(dayMark),
      ].join(","),
    );
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

/** English whatever the venue's language: the episode's start date at its stored offset. */
export function misdatedSalesFileName(episode: {
  from: string;
  fromOffsetMinutes: number;
}): string {
  return `misdated-sales-${dateAt(Date.parse(episode.from), episode.fromOffsetMinutes)}.csv`;
}
