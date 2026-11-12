import { previewCorrectionAmounts, type CorrectionPreview } from "@waitron/core";
import { type Transaction } from "@waitron/db";
import { type FiscalBackend } from "@waitron/fiscal";
import {
  centsToDecimal,
  decimal,
  decimalToCents,
  isUuid,
  sumDecimals,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { canonicaliseUuid } from "./till-session.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import "./errors.js";

export interface SplitLine {
  rate: string;
  base: string;
  tax: string;
}

export interface InvoiceCorrectionRequest {
  submissionId: string;
  /** The money back, VAT included. */
  gross: string;
  lineIds?: string[];
  reasonId: string;
  note?: string | null;
  /** The split the till showed, positive, as the preview answered it. */
  expectedSplit: SplitLine[];
}

const MONEY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

/** What correcting `selection.gross` off the invoice would file, and the cash still refundable on it. */
export async function previewInvoiceCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: Pick<DeviceRequestConfig, "nodeId">,
  saleId: SaleId,
  selection: { gross: string; lineIds?: readonly string[] },
): Promise<CorrectionPreview & { cashRefundable: Decimal }> {
  const preview = await previewCorrectionAmounts(tx, backend, saleId, cfg.nodeId, {
    gross: moneyOf(selection.gross, "gross"),
    ...(selection.lineIds === undefined ? {} : { lineIds: selection.lineIds }),
  });
  const cash = (await readRefundableTenders(tx, saleId)).filter((row) => row.method === "cash");
  return {
    ...preview,
    cashRefundable: sumDecimals([
      decimal("0.00"),
      ...cash.map((row) => decimal(row.appliedRemaining)),
    ]),
  };
}

/** The line ids a request names, canonical; refused `lineIds` unless absent or a list of ids. */
export function lineIdsOf(lineIds: unknown): string[] | undefined {
  if (lineIds === undefined) return undefined;
  if (!Array.isArray(lineIds) || lineIds.some((id) => typeof id !== "string" || !isUuid(id)))
    throw invalid("lineIds");
  return lineIds.map((id: string) => canonicaliseUuid(id)!);
}

export function parseInvoiceCorrection(request: InvoiceCorrectionRequest) {
  if (typeof request.submissionId !== "string" || !isUuid(request.submissionId))
    throw invalid("submissionId");
  if (typeof request.reasonId !== "string" || !isUuid(request.reasonId)) throw invalid("reasonId");
  const lineIds = lineIdsOf(request.lineIds);
  const note = request.note ?? null;
  if (note !== null && typeof note !== "string") throw invalid("note");
  const split = request.expectedSplit;
  if (
    !Array.isArray(split) ||
    split.some((line) =>
      [line?.rate, line?.base, line?.tax].some(
        (value) => typeof value !== "string" || !MONEY.test(value),
      ),
    )
  )
    throw invalid("expectedSplit");
  return {
    submissionId: canonicaliseUuid(request.submissionId)!,
    gross: moneyOf(request.gross, "gross"),
    ...(lineIds === undefined ? {} : { lineIds }),
    reasonId: canonicaliseUuid(request.reasonId)!,
    note: note === null || note.trim() === "" ? null : note.trim(),
    expectedSplit: split.map(({ rate, base, tax }) => ({
      rate: centsToDecimal(decimalToCents(decimal(rate))),
      base: centsToDecimal(decimalToCents(decimal(base))),
      tax: centsToDecimal(decimalToCents(decimal(tax))),
    })),
  };
}

/** The split compared by value, in rate order, whatever order or spelling the till sent. */
export function splitKey(split: readonly SplitLine[]): string {
  return split
    .map((line) => [line.rate, line.base, line.tax].map((v) => decimalToCents(decimal(v))))
    .sort((a, b) => a[0]! - b[0]!)
    .join(";");
}

function moneyOf(value: unknown, field: string): Decimal {
  if (typeof value !== "string" || !MONEY.test(value)) throw invalid(field);
  return centsToDecimal(decimalToCents(decimal(value)));
}
