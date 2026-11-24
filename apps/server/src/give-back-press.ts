import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  invoiceCorrections,
  refunds as refundRows,
  tenders as tenderRows,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";
import type { Authorization } from "@waitron/identity";
import { AppError, centsToDecimal, decimal, isUuid, type SaleId } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { parseGiveBackRequest, type GiveBackPart, type GiveBackRequest } from "./give-back-plan.js";
import { reasonOf, type GiveBackDeps, type WaitReason } from "./give-back-read.js";
import { perDatabase } from "./live-in-process.js";
import { readCorrectionLegs } from "./invoice-correction-legs.js";
import {
  openInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
  uuidOf,
  type InvoiceCorrectionDeps,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { moneyCents } from "./tender-refund-reservation.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import "./errors.js";

export type GiveBackWriteDeps = GiveBackDeps & InvoiceCorrectionDeps & { db: Database };

/** The ids the till made for one press, one per part it may write. */
export interface GiveBackSubmissionIds {
  refund: string;
  extra: string;
  correction: string;
  leg: string;
}

export type GiveBackPartState = "completed" | "pending" | "failed" | "not_started";

export interface GiveBackOutcome {
  parts: {
    kind: GiveBackPart["kind"];
    amount: string;
    state: GiveBackPartState;
    refundId?: string;
    correctionId?: string;
  }[];
  /** A later part refused after an earlier one moved money. */
  refusal: { code: string; params: object } | null;
  underWay: InvoiceCorrectionView | null;
  /** What was not sent yet; needs fresh ids. */
  rest: null | GiveBackRequest;
}

/** A part as the preview showed it, in a form two spellings of the same part compare equal in. */
export interface ComparablePart {
  kind: string;
  amount: number;
  way: string;
  cancellationIds: string[] | null;
  lineIds: string[] | null;
}

function sortedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !isUuid(id)))
    throw invalid("expected");
  return value.map((id: string) => id.toLowerCase()).sort();
}

export function comparablePartsOf(value: unknown): ComparablePart[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) throw invalid("expected");
  return value.map((part: unknown) => {
    if (typeof part !== "object" || part === null) throw invalid("expected");
    const { kind, amount, way, cancellationIds, lineIds } = part as Record<string, unknown>;
    if (typeof kind !== "string" || typeof way !== "string") throw invalid("expected");
    return {
      kind,
      amount: moneyCents(amount, "expected"),
      way: way.toLowerCase(),
      cancellationIds: cancellationIds === undefined ? null : sortedIds(cancellationIds),
      lineIds: lineIds === undefined ? null : sortedIds(lineIds),
    };
  });
}

export const partsKey = (parts: readonly ComparablePart[]) => JSON.stringify(parts);

/** The ids of the reader presses running in this process, each until its last part has settled. */
export const readerPresses = perDatabase(() => new Set<string>());
export const pressIds = (ask: GiveBackWrite) => Object.values(ask.ids);
export const pressRunning = (db: Database, ask: GiveBackWrite) =>
  pressIds(ask).some((id) => readerPresses(db).has(id));

export interface GiveBackWrite {
  request: GiveBackRequest;
  reasonId: string;
  note: string | null;
  ids: GiveBackSubmissionIds;
  expected: ComparablePart[];
  /** Staff have already refunded the money on the separate terminal. */
  manualConfirmed: boolean;
}

export function parseGiveBackWrite(body: Record<string, unknown>): GiveBackWrite {
  const request = parseGiveBackRequest(body);
  const reasonId = uuidOf(body.reasonId, "reasonId");
  const note = body.note ?? null;
  if (note !== null && typeof note !== "string") throw invalid("note");
  const raw = body.submissionIds;
  if (typeof raw !== "object" || raw === null) throw invalid("submissionIds");
  const given = raw as Record<string, unknown>;
  const ids = {
    refund: uuidOf(given.refund, "submissionIds"),
    extra: uuidOf(given.extra, "submissionIds"),
    correction: uuidOf(given.correction, "submissionIds"),
    leg: uuidOf(given.leg, "submissionIds"),
  };
  if (new Set(Object.values(ids)).size !== 4) throw invalid("submissionIds");
  if (body.manualConfirmed !== undefined && typeof body.manualConfirmed !== "boolean")
    throw invalid("manualConfirmed");
  return {
    manualConfirmed: body.manualConfirmed === true,
    request,
    reasonId,
    note: note === null || note.trim() === "" ? null : note.trim(),
    ids,
    expected: comparablePartsOf(body.expected),
  };
}

/** The id of the `index`th refund one part writes when it takes money from more than one cash
 * payment: the till's own id first, then ids derived from it, so a resend finds every one. */
export function partSubmissionId(submissionId: string, index: number): string {
  if (index === 0) return submissionId;
  const hex = createHash("sha256").update(`${submissionId}:${index}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type RefundRow = typeof refundRows.$inferSelect;

type Slot = "refund" | "extra";

/** Which of the press's refund ids a part's refunds are written under: an extra given back alone
 * takes the refund id, so its rows show the press was for the extra alone and a press reusing its
 * ids for more is refused. */
export function slotOf(ask: Pick<GiveBackWrite, "request">, kind: string): Slot {
  return kind === "extra" && ask.request.purpose !== "extra" ? "extra" : "refund";
}

export interface StoredGiveBack {
  refund: RefundRow[];
  extra: RefundRow[];
  correction: typeof invoiceCorrections.$inferSelect | undefined;
}

/** The rows the press `ids` wrote on `saleId`; undefined when it wrote none. */
export async function readStoredGiveBack(
  tx: Transaction,
  saleId: SaleId,
  ids: GiveBackSubmissionIds,
): Promise<StoredGiveBack | undefined> {
  const payments = await tx
    .select({ id: tenderRows.id })
    .from(tenderRows)
    .where(eq(tenderRows.saleId, saleId));
  const idsOfPart = (submissionId: string) =>
    payments.map((_, index) => partSubmissionId(submissionId, index));
  const rows = await tx
    .select()
    .from(refundRows)
    .where(
      and(
        eq(refundRows.saleId, saleId),
        inArray(refundRows.submissionId, [...idsOfPart(ids.refund), ...idsOfPart(ids.extra)]),
      ),
    );
  const [correction] = await tx
    .select()
    .from(invoiceCorrections)
    .where(
      and(
        eq(invoiceCorrections.originalSaleId, saleId),
        eq(invoiceCorrections.submissionId, ids.correction),
      ),
    );
  if (rows.length === 0 && correction === undefined) return undefined;
  // In payment order: a part's refunds share one time, and its `index`th refund is on the
  // `index`th payment it took money from.
  const of = (submissionId: string) => {
    const own = idsOfPart(submissionId);
    return rows
      .filter((row) => own.includes(row.submissionId!))
      .sort((a, b) => own.indexOf(a.submissionId!) - own.indexOf(b.submissionId!));
  };
  return { refund: of(ids.refund), extra: of(ids.extra), correction };
}

function refundsState(rows: readonly RefundRow[]): GiveBackPartState {
  if (rows.some((row) => row.state === "failed")) return "failed";
  return rows.every((row) => row.state === "completed") ? "completed" : "pending";
}

/** What `ask` gives back of the parts not started, as a request the till sends with fresh ids. */
function restOf(ask: GiveBackWrite, answer: GiveBackOutcome["parts"]): GiveBackRequest | null {
  const left = ask.expected.filter((_, index) => answer[index]!.state === "not_started");
  if (left.length === 0) return null;
  const sum = (kinds: readonly string[]) =>
    left
      .filter((part) => kinds.includes(part.kind))
      .reduce((total, part) => total + part.amount, 0);
  const amount = sum(["refund", "correction"]);
  const extra = sum(["extra"]);
  const { purpose, lineIds, way } = ask.request;
  if (amount === 0) return { purpose: "extra", amount: centsToDecimal(extra), extra: "0.00", way };
  return {
    purpose,
    ...(lineIds === undefined ? {} : { lineIds }),
    amount: centsToDecimal(amount),
    extra: centsToDecimal(extra),
    way,
  };
}

/** The answer for the press `ask` whose rows are `stored` and whose correction's legs are `legs`,
 * the same on its first send and any resend; `refusal` is what refused a part after an earlier one
 * moved money, which only the first send knows. A card refund that was not made refuses by itself.
 * `running`: the press's first send is still giving parts back in this process. */
export async function outcomeOf(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  stored: StoredGiveBack,
  ask: GiveBackWrite,
  legs: readonly RefundRow[],
  refusal: WaitReason | null = null,
  running = false,
): Promise<GiveBackOutcome> {
  const answer: GiveBackOutcome["parts"] = ask.expected.map((part) => {
    const amount = centsToDecimal(part.amount);
    if (part.kind === "correction") {
      const row = stored.correction;
      if (row === undefined) return { kind: "correction", amount, state: "not_started" };
      return {
        kind: "correction",
        amount,
        state: row.state === "filed" ? "completed" : row.state === "open" ? "pending" : "failed",
        correctionId: row.id,
      };
    }
    const kind = part.kind as "refund" | "extra";
    const rows = stored[slotOf(ask, kind)];
    if (rows.length === 0) return { kind, amount, state: "not_started" };
    return { kind, amount, state: refundsState(rows), refundId: rows[0]!.id };
  });
  const failed = [...stored.refund, ...stored.extra, ...legs].find((row) => row.state === "failed");
  const declined =
    failed === undefined
      ? null
      : reasonOf(
          new AppError("give_back.refund_failed", {
            refundId: failed.id,
            tenderId: failed.tenderId!,
          }),
        );
  const refused = refusal ?? declined;
  return {
    parts: answer,
    refusal: refused === null ? null : { code: refused.code, params: refused.params ?? {} },
    underWay:
      stored.correction?.state === "open"
        ? await readInvoiceCorrection(tx, deps.backend, cfg, stored.correction.id)
        : null,
    // While the press still runs, the parts not started are about to be sent by it.
    rest: running ? null : restOf(ask, answer),
  };
}

/** The refunds the press `ask` wrote as its correction's leg. */
export async function legsOf(
  tx: Transaction,
  stored: StoredGiveBack,
  ask: GiveBackWrite,
): Promise<RefundRow[]> {
  if (stored.correction === undefined) return [];
  const legs = await readCorrectionLegs(tx, stored.correction.id);
  return legs.refunds.filter((_, index) => legs.requestIds[index] === ask.ids.leg);
}

/** Opens the correction `part` of the press `ask`, with the VAT split its preview works out now. */
export async function openCorrectionPart(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  ask: GiveBackWrite,
  part: GiveBackPart,
  actor: { personId: string; authorization: Authorization },
) {
  const lineIds = part.kind === "correction" ? part.lineIds : [];
  const selection = { gross: part.amount, ...(lineIds.length === 0 ? {} : { lineIds }) };
  const split = await previewInvoiceCorrection(tx, deps.backend, cfg, reading, saleId, selection);
  return openInvoiceCorrection(
    tx,
    deps,
    cfg,
    saleId,
    {
      submissionId: ask.ids.correction,
      gross: decimal(part.amount),
      ...(lineIds.length === 0 ? {} : { lineIds }),
      reasonId: ask.reasonId,
      note: ask.note,
      expectedSplit: split.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
    },
    actor,
  );
}

export async function readGiveBackOutcomeOf(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  ask: GiveBackWrite,
  refusal: WaitReason | null = null,
  running = false,
): Promise<GiveBackOutcome> {
  const stored = (await readStoredGiveBack(tx, saleId, ask.ids)) ?? {
    refund: [],
    extra: [],
    correction: undefined,
  };
  return outcomeOf(tx, deps, cfg, stored, ask, await legsOf(tx, stored, ask), refusal, running);
}

/** What the press `body` wrote on `saleId` answers now, as its write answered it. Writes nothing. */
export function readGiveBackOutcome(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  body: object,
): Promise<GiveBackOutcome> {
  return readGiveBackOutcomeOf(
    tx,
    deps,
    cfg,
    saleId,
    parseGiveBackWrite(body as Record<string, unknown>),
  );
}
