import type { Transaction } from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";
import { holds, type PersonAuthority } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToCents,
  isUuid,
  type SaleId,
} from "@waitron/shared";
import { refusePlainRefundOfAdvance } from "./advance-taken-off.js";
import { invalid } from "./bill-allocation.js";
import { assertTakesTender, type DeviceBinding } from "./device-session.js";
import {
  readFacts,
  tenderKind,
  type Availability,
  type GiveBackDeps,
  type GiveBackLine,
  type GiveBackPurpose,
  type GiveBackWay,
  type WaitReason,
} from "./give-back-read.js";
import {
  allocateToCancels,
  cancelsStillOwedBy,
  isPartPayment,
  moneyCents,
} from "./tender-refund-reservation.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import "./errors.js";

export interface GiveBackRequest {
  purpose: GiveBackPurpose;
  /** The ticked lines, for `dishes`. */
  lineIds?: string[];
  /** The money to give back; for `extra`, the extra itself. */
  amount: string;
  /** The extra given back beside dishes or goodwill; "0.00" for `extra`. */
  extra: string;
  /** `"cash"` or a card's tender id, as the read's `ways` name them. */
  way: string;
  /** The cancels the window filled in after Cancel and refund or Finish table was opened with. */
  fromCancel?: string[];
}

export type GiveBackPart =
  | { kind: "refund"; amount: string; way: string; cancellationIds?: string[] }
  | { kind: "extra"; amount: string; way: string }
  | { kind: "correction"; amount: string; way: string; lineIds: string[] };

export type GiveBackRight = "sale.refund" | "sale.rectify";

export interface GiveBackPlan {
  parts: GiveBackPart[];
  /** What the chosen way cannot hold of the correction, left on it for the other payments. */
  leftUnderWay: string;
  /** The rights the parts need that this person lacks. */
  needs: GiveBackRight[];
  manual: boolean;
}

const PURPOSES: readonly string[] = ["dishes", "goodwill", "extra"] satisfies GiveBackPurpose[];

function idsOf(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 100 ||
    value.some((id) => typeof id !== "string" || !isUuid(id))
  )
    throw invalid(field);
  const ids = value.map((id: string) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw invalid(field);
  return ids;
}

/** `body` as a {@link GiveBackRequest}, refusing the first field that is not one. */
export function parseGiveBackRequest(body: Record<string, unknown>): GiveBackRequest {
  if (typeof body.purpose !== "string" || !PURPOSES.includes(body.purpose))
    throw invalid("purpose");
  const purpose = body.purpose as GiveBackPurpose;
  if (moneyCents(body.amount, "amount") === 0) throw invalid("amount");
  const extra = moneyCents(body.extra, "extra");
  if (purpose === "extra" && extra !== 0) throw invalid("extra");
  if (typeof body.way !== "string" || body.way === "") throw invalid("way");
  if (purpose === "dishes" ? body.lineIds === undefined : body.lineIds !== undefined)
    throw invalid("lineIds");
  return {
    purpose,
    amount: body.amount as string,
    extra: body.extra as string,
    way: body.way.toLowerCase(),
    ...(body.lineIds === undefined ? {} : { lineIds: idsOf(body.lineIds, "lineIds") }),
    ...(body.fromCancel === undefined ? {} : { fromCancel: idsOf(body.fromCancel, "fromCancel") }),
  };
}

function refusal(reason: WaitReason): AppError {
  return new AppError(reason.code as never, (reason.params ?? {}) as never);
}

function refuseUnless(availability: Availability, field: string): void {
  if (availability.available) return;
  throw availability.reason === null ? invalid(field) : refusal(availability.reason);
}

export const cents = (value: string) => decimalToCents(decimal(value));
const sumCents = (values: readonly string[]) =>
  values.reduce((total, value) => total + cents(value), 0);
const owedOf = (line: Pick<GiveBackLine, "cancelled">) => cents(line.cancelled?.owed ?? "0.00");
export const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Whether the cancels' approval covers a refund of `refund` cents naming `cancellationIds`, as
 * the refund write decides it (D9): only from the window filled in after the cancel, with no extra,
 * never on a hand-keyed card. */
async function coveredByCancel(
  tx: Transaction,
  saleId: SaleId,
  request: GiveBackRequest,
  cancellationIds: readonly string[] | undefined,
  refund: number,
  way: GiveBackWay,
): Promise<boolean> {
  if (
    request.fromCancel === undefined ||
    cancellationIds === undefined ||
    !sameIds(request.fromCancel, cancellationIds) ||
    cents(request.extra) > 0 ||
    way.manual
  )
    return false;
  const allocation = await allocateToCancels(tx, saleId, cancellationIds, refund);
  return allocation.cancelledBy !== undefined && refund <= allocation.canStillTake;
}

/**
 * What giving back `request` on the receipt `saleId` would do (5.2), writing nothing: the plain
 * refunds of what cancels still owe, the extra, then one correction of the rest, each from the
 * chosen way; a refusal the write would answer is thrown. Every choice the read shows unavailable
 * answers the read's reason.
 */
export async function planGiveBack(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  who: { device: DeviceBinding | null; authority: PersonAuthority },
  body: object,
): Promise<GiveBackPlan> {
  const { plan, rights } = await planWithRights(tx, deps, cfg, reading, saleId, who.device, body);
  return { ...plan, needs: rights.filter((right) => !holds(who.authority, right)) };
}

/** The rights a give-back's parts need, whoever holds them (5.4, D9): `sale.refund` for a plain
 * refund the cancel's approval does not cover, for an extra and for a correction's leg on this way;
 * `sale.rectify` for a correction. */
export function rightsFor(parts: {
  refund: boolean;
  refundCovered: boolean;
  extra: boolean;
  correction: boolean;
  leg: boolean;
}): GiveBackRight[] {
  const refund = (parts.refund && !parts.refundCovered) || parts.extra || parts.leg;
  return [
    ...(refund ? ["sale.refund" as const] : []),
    ...(parts.correction ? ["sale.rectify" as const] : []),
  ];
}

export async function planWithRights(
  tx: Transaction,
  deps: GiveBackDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  device: DeviceBinding | null,
  body: object,
): Promise<{ plan: Omit<GiveBackPlan, "needs">; rights: GiveBackRight[] }> {
  const request = parseGiveBackRequest(body as Record<string, unknown>);
  const facts = await readFacts(tx, deps, cfg, reading, saleId, device);
  const { view, waits } = facts;
  refuseUnless(view.choices[request.purpose], "amount");
  const ticked = (request.lineIds ?? []).map((id) => {
    const line = view.lines.find((row) => row.id === id);
    if (line === undefined || line.partOf !== null) throw invalid("lineIds");
    if (line.reason !== null) throw refusal(line.reason);
    return line;
  });
  const way = view.ways.find((row) => row.way === request.way);
  if (way === undefined) throw invalid("way");
  if (way.reason !== null) throw refusal(way.reason);
  const tenders = facts.tenders.filter((row) =>
    way.way === "cash" ? row.method === "cash" : row.tenderId === way.way,
  );
  assertTakesTender(device, tenderKind(tenders[0]!));
  const amount = cents(request.amount);
  const extra = request.purpose === "extra" ? amount : cents(request.extra);
  const wayMoney = cents(way.moneyLeft);

  let owed = 0;
  let cancellationIds: string[] | undefined;
  if (request.purpose === "dishes") {
    owed = ticked.reduce((total, line) => total + owedOf(line), 0);
    const ids = new Set(
      ticked
        .filter((line) => owedOf(line) > 0)
        .flatMap((line) => facts.cancelIds.get(line.id) ?? []),
    );
    if (ids.size > 0) cancellationIds = [...ids];
  } else if (request.purpose === "goodwill") {
    const owedIds = await cancelsStillOwedBy(tx, saleId);
    owed =
      owedIds.length === 0 ? 0 : (await allocateToCancels(tx, saleId, owedIds, 0)).canStillTake;
  }
  let refund = request.purpose === "extra" ? 0 : Math.min(amount, owed);
  let rest = request.purpose === "extra" ? 0 : amount - refund;
  if (extra > cents(way.extraLeft))
    throw new AppError("tender.refund_exceeds_payment", {
      tenderId: tenders[0]!.tenderId,
      applied: way.moneyLeft,
      tip: way.extraLeft,
    });

  let correction: GiveBackPart | undefined;
  let leftUnderWay = 0;
  if (rest > 0) {
    if (waits.correction !== null) throw refusal(waits.correction);
    const correctable =
      facts.correctable > 0 && !(await facts.recordsUnchecked()) ? facts.correctable : 0;
    if (correctable === 0) {
      refund += rest;
      rest = 0;
    } else {
      const usable = view.ways.filter((row) => row.reason === null);
      if (rest > sumCents(usable.map((row) => row.moneyLeft)) - refund) throw invalid("amount");
      const named = ticked.filter((line) => cents(line.left) - owedOf(line) > 0);
      const linesHold =
        named.reduce((total, line) => total + cents(line.left) - owedOf(line), 0) >= rest;
      correction = {
        kind: "correction",
        amount: centsToDecimal(rest),
        way: way.way,
        lineIds: linesHold ? named.flatMap((line) => facts.namedFor(line.id)) : [],
      };
      leftUnderWay = Math.max(0, rest - (wayMoney - refund));
    }
  }
  if (refund > wayMoney) throw invalid("amount");
  if (refund > 0 && (await isPartPayment(tx, saleId)))
    await refusePlainRefundOfAdvance(tx, saleId, { tenderId: tenders[0]!.tenderId });

  const parts: GiveBackPart[] = [];
  if (refund > 0)
    parts.push({
      kind: "refund",
      amount: centsToDecimal(refund),
      way: way.way,
      ...(cancellationIds === undefined ? {} : { cancellationIds }),
    });
  if (extra > 0) parts.push({ kind: "extra", amount: centsToDecimal(extra), way: way.way });
  if (correction !== undefined) parts.push(correction);

  const rights = rightsFor({
    refund: refund > 0,
    refundCovered:
      refund > 0 && (await coveredByCancel(tx, saleId, request, cancellationIds, refund, way)),
    extra: extra > 0,
    correction: correction !== undefined,
    leg: correction !== undefined && rest - leftUnderWay > 0,
  });
  return {
    plan: { parts, leftUnderWay: centsToDecimal(leftUnderWay), manual: way.manual },
    rights,
  };
}
