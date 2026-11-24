import { inArray } from "drizzle-orm";
import {
  adjustmentRefunds,
  findAdjustmentReason,
  listAdjustmentReasons,
} from "@waitron/adjustments";
import type { Transaction } from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";
import {
  authorize,
  holds,
  type Authorization,
  type Override,
  type PersonAuthority,
  type PinAttempts,
  type SecretCheck,
} from "@waitron/identity";
import { AppError, centsToDecimal, type SaleId } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import type { DeviceBinding } from "./device-session.js";
import {
  cents,
  planWithRights,
  rightsFor,
  sameIds,
  type GiveBackPart,
  type GiveBackRight,
} from "./give-back-plan.js";
import {
  comparablePartsOf,
  legsOf,
  openCorrectionPart,
  outcomeOf,
  parseGiveBackWrite,
  partsKey,
  partSubmissionId,
  pressRunning,
  readGiveBackOutcomeOf,
  readStoredGiveBack,
  slotOf,
  type GiveBackOutcome,
  type GiveBackWrite,
  type GiveBackWriteDeps,
  type RefundRow,
  type StoredGiveBack,
} from "./give-back-press.js";
import { giveBackOnReader, type PartAuthority } from "./give-back-reader.js";
import { giveCorrectionCash } from "./invoice-correction-cash.js";
import { enqueueRefundDrawer } from "./receipt-print.js";
import { confirmManualRefundAuthority } from "./tender-refund-authorization.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { carryNewTenderRefund } from "./tender-refund-completion.js";
import { authorizeStoredTenderRefund, reserveTenderRefund } from "./tender-refund-reservation.js";
import type { RefundableTender } from "./tender-refund-types.js";
import { captureFor, type TenderRefundDeps } from "./tender-refunds.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { requireEconomicWrite } from "./trading-admission.js";
import "./errors.js";

const reasonText = (name: string, note: string | null) =>
  (note === null ? name : `${name}: ${note}`).slice(0, 500);

async function reasonTextOf(tx: Transaction, ask: GiveBackWrite): Promise<string> {
  const reason = await findAdjustmentReason(tx, ask.reasonId);
  if (reason.noteRequired && ask.note === null) throw new AppError("adjustment.note_required", {});
  return reasonText(reason.name, ask.note);
}

/**
 * The reason text the press's rows were stored under, once `ask`'s reason and note are found to
 * have written it; otherwise refuses `reused`. The rows hold only the text, so a reason renamed
 * since is matched by the text alone: the note must be the one the text ends with and no reason
 * may still bear the name before it, and then which reason it was is not checked. A name or a
 * note holding ": " cannot be split from the text, so such a press is matched only while its
 * reason keeps its name.
 */
async function storedReasonOf(
  tx: Transaction,
  ask: GiveBackWrite,
  rows: readonly { reason: string }[],
  reused: () => AppError,
): Promise<string> {
  const texts = new Set(rows.map((row) => row.reason));
  if (texts.size !== 1) throw reused();
  const [text] = [...texts] as [string];
  const reasons = await listAdjustmentReasons(tx);
  const writer = reasons.find((reason) => reasonText(reason.name, ask.note) === text);
  if (writer !== undefined) {
    if (writer.id !== ask.reasonId) throw reused();
    return text;
  }
  const suffix = ask.note === null ? "" : `: ${ask.note}`;
  const name = text.slice(0, text.length - suffix.length);
  if (
    text.length >= 500 ||
    !text.endsWith(suffix) ||
    name.includes(": ") ||
    reasons.some((reason) => reason.name === name)
  )
    throw reused();
  return text;
}

/** Whether any of `rows` is a reader card's refund, whose press writes its parts one at a time. */
const onReader = (rows: readonly RefundRow[]) =>
  rows.some((row) => row.method === "card" && !row.manual);

/**
 * Checks a resend of the press `ask` against the rows its first send wrote, as each write's own
 * replay checks them: every part it names was written with the same money, reason and cancels,
 * and nothing it does not name was. Writes nothing.
 */
async function checkResend(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  reading: TrustedReading,
  saleId: SaleId,
  ask: GiveBackWrite,
  stored: StoredGiveBack,
  legs: readonly RefundRow[],
  personId: string,
): Promise<void> {
  const reused = () => new AppError("submission.id_reused", { submissionId: ask.ids.refund });
  const amountOf = (kind: string) =>
    ask.expected.filter((part) => part.kind === kind).reduce((sum, part) => sum + part.amount, 0);
  const asked = cents(ask.request.amount);
  if (
    ask.request.purpose === "extra"
      ? amountOf("extra") !== asked || ask.expected.some((part) => part.kind !== "extra")
      : amountOf("refund") + amountOf("correction") !== asked ||
        amountOf("extra") !== cents(ask.request.extra)
  )
    throw reused();
  const reason = await storedReasonOf(
    tx,
    ask,
    [...stored.refund, ...stored.extra, ...legs, ...(stored.correction ? [stored.correction] : [])],
    reused,
  );
  const kinds = new Set(ask.expected.map((part) => part.kind));
  if (
    (stored.refund.length > 0 &&
      !ask.expected.some(
        (part) => part.kind !== "correction" && slotOf(ask, part.kind) === "refund",
      )) ||
    (stored.extra.length > 0 &&
      !ask.expected.some(
        (part) => part.kind !== "correction" && slotOf(ask, part.kind) === "extra",
      )) ||
    (stored.correction !== undefined && !kinds.has("correction"))
  )
    throw reused();
  const present = ask.expected.map((part) =>
    part.kind === "correction"
      ? stored.correction !== undefined
      : stored[slotOf(ask, part.kind)].length > 0,
  );
  // Only a reader's press stops between parts, and only ever before all the later ones.
  const missing = present.indexOf(false);
  if (
    missing !== -1 &&
    (!onReader([...stored.refund, ...stored.extra, ...legs]) ||
      present.slice(missing).some(Boolean))
  )
    throw reused();
  const { way, fromCancel } = ask.request;
  if (
    ask.expected.some((part) => part.way !== way.toLowerCase()) ||
    [...stored.refund, ...stored.extra, ...legs].some((row) =>
      way === "cash" ? row.method !== "cash" : row.tenderId !== way.toLowerCase(),
    )
  )
    throw reused();
  if (fromCancel !== undefined && stored.refund.length > 0) {
    const links = await tx
      .select({ adjustmentId: adjustmentRefunds.adjustmentId })
      .from(adjustmentRefunds)
      .where(
        inArray(
          adjustmentRefunds.refundId,
          stored.refund.map((row) => row.id),
        ),
      );
    const linked = new Set(links.map((link) => link.adjustmentId));
    if (fromCancel.some((id) => !linked.has(id))) throw reused();
  }
  for (const [index, part] of ask.expected.entries()) {
    if (!present[index]) continue;
    if (part.kind === "correction") {
      const row = stored.correction!;
      if (
        row.gross !== part.amount ||
        JSON.stringify([...(row.lineIds ?? [])].sort()) !== JSON.stringify(part.lineIds ?? [])
      )
        throw new AppError("submission.id_reused", { submissionId: ask.ids.correction });
      continue;
    }
    const rows = stored[slotOf(ask, part.kind)];
    const field = part.kind === "extra" ? "tipAmount" : "appliedAmount";
    if (rows.reduce((sum, row) => sum + row[field], 0) !== part.amount) throw reused();
    for (const row of rows)
      await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        {
          submissionId: row.submissionId!,
          tenderId: row.tenderId!,
          appliedAmount: centsToDecimal(row.appliedAmount),
          tipAmount: centsToDecimal(row.tipAmount),
          reason,
          ...(row.manual ? { manualConfirmed: true } : {}),
          ...(part.cancellationIds === null ? {} : { cancellationIds: part.cancellationIds }),
        },
        { requestedBy: personId, authorizedBy: row.authorizedBy },
        reading.instant.toISOString(),
        { backend: deps.backend, reading },
      );
  }
}

/** Fills `amount` cents from `payments` in order, each up to what `left` says it holds. */
function fromPayments(
  amount: number,
  payments: readonly RefundableTender[],
  left: (payment: RefundableTender) => number,
): { tenderId: string; cents: number }[] {
  const legs: { tenderId: string; cents: number }[] = [];
  let rest = amount;
  for (const payment of payments) {
    if (rest === 0) break;
    const share = Math.min(rest, left(payment));
    if (share > 0) legs.push({ tenderId: payment.tenderId, cents: share });
    rest -= share;
  }
  if (rest > 0) throw invalid("amount");
  return legs;
}

/** Who gives back, and the supervisor's PIN when one was typed, checked ahead of the transaction. */
export interface GiveBackActor {
  device: DeviceBinding | null;
  authority: PersonAuthority;
  personId: string;
  sessionId: string;
  override?: Override & { checked?: SecretCheck };
  attempts: PinAttempts;
}

/** What the write answers, and the correction the route files once it has committed: a separate
 * terminal's money is already gone, so a refused filing must not undo its record. On a card
 * reader, once the caller's transaction has committed, `onReader` gives every part back and
 * answers. */
export type GiveBackResult =
  | { outcome: GiveBackOutcome; fileAfter: string | null }
  | { onReader: (deps: TenderRefundDeps) => Promise<GiveBackOutcome> };

/** Each of `rights` granted to the signed-in person or the supervisor whose PIN `who` carries,
 * refusing the first neither holds. On a separate terminal the refund also needs a fresh PIN
 * (`confirmManualRefundAuthority`). */
async function authorizeRights(
  tx: Transaction,
  who: GiveBackActor,
  rights: readonly GiveBackRight[],
  manual: { tenderId: string } | null,
): Promise<{ refund?: Authorization; rectify?: Authorization }> {
  const granted: { refund?: Authorization; rectify?: Authorization } = {};
  for (const right of rights) {
    const authorization = await authorize(
      tx,
      { sessionId: who.sessionId, permission: right, override: who.override },
      who.attempts,
    );
    if (right === "sale.rectify") granted.rectify = authorization;
    else
      granted.refund =
        manual === null
          ? authorization
          : await confirmManualRefundAuthority(
              tx,
              authorization,
              who.override,
              who.attempts,
              () =>
                new AppError("tender.manual_refund_pin_required", { tenderId: manual.tenderId }),
            );
  }
  return granted;
}

/** The authority a plain refund the cancel's approval covers is recorded under, as Refund a payment
 * records it: the person, when they hold `sale.refund`, else the cancel's approver. */
function coveredRefundActor(who: GiveBackActor) {
  return async (cancelledBy?: string): Promise<Authorization> => {
    if (holds(who.authority, "sale.refund"))
      return { authorizedBy: who.personId, permission: "sale.refund", viaOverride: false };
    if (cancelledBy === undefined)
      throw new AppError("authorization.not_permitted", { permission: "sale.refund" });
    return {
      authorizedBy: cancelledBy,
      permission: "sale.refund",
      viaOverride: cancelledBy !== who.personId,
    };
  };
}

/** The rights a resend of `ask` needs, worked out from the same body and the rows its first send
 * wrote. Judged from the stored rows, as Refund a payment judges a resend, it can refuse what the
 * first send allowed: a covered refund stored under a person holding `sale.refund` is not covered. */
async function resendRights(
  tx: Transaction,
  ask: GiveBackWrite,
  stored: StoredGiveBack,
  legs: readonly RefundRow[],
  manual: boolean,
): Promise<GiveBackRight[]> {
  const refund = ask.expected.find((part) => part.kind === "refund");
  let refundCovered =
    refund !== undefined &&
    ask.request.fromCancel !== undefined &&
    refund.cancellationIds !== null &&
    sameIds(ask.request.fromCancel, refund.cancellationIds) &&
    cents(ask.request.extra) === 0 &&
    !manual;
  for (const row of refundCovered ? stored.refund : [])
    await authorizeStoredTenderRefund(tx, row, async (cancelledBy) => {
      if (cancelledBy === undefined) refundCovered = false;
      return { authorizedBy: row.authorizedBy, permission: "sale.refund", viaOverride: false };
    });
  return rightsFor({
    refund: refund !== undefined,
    refundCovered,
    extra: ask.expected.some((part) => part.kind === "extra"),
    correction: stored.correction !== undefined,
    leg: legs.length > 0,
  });
}

/**
 * Gives `body` back on the receipt `saleId` (5.3), in the caller's one transaction: the plain
 * refunds of what cancels still owe, the extra, then one correction of the rest with its leg. In
 * cash the correction is filed here once all its money is back, and a refused filing undoes every
 * part; the drawer opens once, on the last cash write. On a separate terminal every refund is
 * recorded completed and the correction is left for the caller to file after commit. The rights
 * asked are the ones the preview works out (5.4, D9). A resend of the same ids answers its first
 * result and writes nothing; parts other than `body.expected` refuse `give_back.changed`.
 */
export async function giveBack(
  tx: Transaction,
  deps: GiveBackWriteDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  who: GiveBackActor,
  body: object,
): Promise<GiveBackResult> {
  const ask = parseGiveBackWrite(body as Record<string, unknown>);
  const reading = deps.clock.now();
  await requireEconomicWrite(tx, cfg, deps.admission);
  const manualFor = (manual: boolean) => {
    if (!manual) return null;
    if (!ask.manualConfirmed) throw invalid("manualConfirmed");
    return { tenderId: ask.request.way };
  };
  const earlier = await readStoredGiveBack(tx, saleId, ask.ids);
  if (earlier !== undefined) {
    const legs = await legsOf(tx, earlier, ask);
    const manual = [...earlier.refund, ...earlier.extra, ...legs].some((row) => row.manual);
    const rights = await resendRights(tx, ask, earlier, legs, manual);
    await authorizeRights(tx, who, rights, manualFor(manual));
    await checkResend(tx, deps, cfg, reading, saleId, ask, earlier, legs, who.personId);
    return {
      outcome: await outcomeOf(tx, deps, cfg, earlier, ask, legs, null, pressRunning(deps.db, ask)),
      fileAfter: manual && earlier.correction?.state === "open" ? earlier.correction.id : null,
    };
  }

  const { plan, rights } = await planWithRights(
    tx,
    deps,
    cfg,
    reading,
    saleId,
    who.device,
    ask.request,
  );
  if (partsKey(comparablePartsOf(plan.parts)) !== partsKey(ask.expected))
    throw new AppError("give_back.changed", { saleId });
  const manual = manualFor(plan.manual);
  const reason = await reasonTextOf(tx, ask);
  const granted = await authorizeRights(tx, who, rights, manual);
  const correction = plan.parts.find((part) => part.kind === "correction");
  const leg = correction === undefined ? 0 : cents(correction.amount) - cents(plan.leftUnderWay);

  const payments = (await readRefundableTenders(tx, saleId)).filter((row) =>
    ask.request.way === "cash" ? row.method === "cash" : row.tenderId === ask.request.way,
  );
  const writes = plan.parts.flatMap((part) => {
    if (part.kind === "correction") return [];
    const isExtra = part.kind === "extra";
    const submissionId = ask.ids[slotOf(ask, part.kind)];
    return fromPayments(cents(part.amount), payments, (payment) =>
      cents(isExtra ? payment.tipRemaining : payment.appliedRemaining),
    ).map((share, index) => ({
      kind: part.kind,
      request: {
        submissionId: partSubmissionId(submissionId, index),
        tenderId: share.tenderId,
        appliedAmount: centsToDecimal(isExtra ? 0 : share.cents),
        tipAmount: centsToDecimal(isExtra ? share.cents : 0),
        reason,
        ...(manual === null ? {} : { manualConfirmed: true }),
        ...(part.kind === "refund" && part.cancellationIds !== undefined
          ? { cancellationIds: part.cancellationIds }
          : {}),
      } satisfies TenderRefundRequest,
    }));
  });
  const refundActor =
    granted.refund === undefined
      ? { requestedBy: who.personId, authorize: coveredRefundActor(who) }
      : { requestedBy: who.personId, authorizedBy: granted.refund.authorizedBy };
  const legRequest = (correctionId: string): TenderRefundRequest => ({
    submissionId: ask.ids.leg,
    tenderId: ask.request.way,
    appliedAmount: centsToDecimal(leg),
    tipAmount: "0.00",
    reason,
    ...(manual === null ? {} : { manualConfirmed: true }),
    invoiceCorrection: { id: correctionId, requestId: ask.ids.leg },
  });
  const open = (
    into: Transaction,
    reading: TrustedReading,
    part: GiveBackPart,
    rectify: Authorization,
  ) =>
    openCorrectionPart(into, deps, cfg, reading, saleId, ask, part, {
      personId: who.personId,
      authorization: rectify,
    });

  if (!plan.manual && ask.request.way !== "cash")
    return {
      onReader: (refundDeps) =>
        giveBackOnReader(refundDeps, cfg, saleId, ask, {
          personId: who.personId,
          // Each part's transaction asks the rights again, from the person's roles and session as
          // they are then; the supervisor's PIN checked ahead is not asked again.
          authorize: async (into, part) => {
            const fresh: { refund?: Authorization; rectify?: Authorization } = {};
            const needs: GiveBackRight[] =
              part.kind === "correction"
                ? ["sale.rectify", ...(leg > 0 ? (["sale.refund"] as const) : [])]
                : part.kind === "extra" || granted.refund !== undefined
                  ? ["sale.refund"]
                  : [];
            for (const right of needs) {
              const authorization = await authorize(into, {
                sessionId: who.sessionId,
                permission: right,
                override: who.override,
              });
              if (right === "sale.rectify") fresh.rectify = authorization;
              else fresh.refund = authorization;
            }
            return fresh;
          },
          parts: plan.parts.map((part) => ({
            part,
            refund:
              part.kind === "correction"
                ? leg > 0
                  ? (correctionId: string, fresh: PartAuthority) => ({
                      request: legRequest(correctionId),
                      actor: {
                        requestedBy: who.personId,
                        authorizedBy: fresh.refund!.authorizedBy,
                      },
                    })
                  : null
                : (_: string, fresh: PartAuthority) => ({
                    request: writes.find((write) => write.kind === part.kind)!.request,
                    actor:
                      fresh.refund === undefined
                        ? {
                            requestedBy: who.personId,
                            authorize: coveredRefundActor({
                              ...who,
                              authority: fresh.authority,
                            }),
                          }
                        : { requestedBy: who.personId, authorizedBy: fresh.refund.authorizedBy },
                  }),
          })),
          open,
        }),
    };

  const createdAt = reading.instant.toISOString();
  const manualPaymentRef = async (reserved: RefundRow) =>
    (await captureFor(tx, reserved))!.paymentRef;
  const carry = (reserved: RefundRow, opensDrawer: boolean) =>
    carryNewTenderRefund(
      tx,
      deps,
      cfg.nodeId,
      reading,
      reserved,
      manual !== null
        ? { manualPaymentRef }
        : opensDrawer
          ? {
              openDrawer: (done, printers) =>
                enqueueRefundDrawer(
                  tx,
                  cfg,
                  done.id,
                  who.personId,
                  {
                    authorizedBy: done.authorizedBy,
                    viaOverride: done.authorizedBy !== who.personId,
                  },
                  printers,
                ),
            }
          : {},
    );
  for (const [index, write] of writes.entries()) {
    const { refund: reserved } = await reserveTenderRefund(
      tx,
      cfg,
      saleId,
      write.request,
      refundActor,
      createdAt,
      { backend: deps.backend, reading },
    );
    await carry(reserved, leg === 0 && index === writes.length - 1);
  }
  let fileAfter: string | null = null;
  if (correction !== undefined) {
    const opened = await open(tx, reading, correction, granted.rectify!);
    if (leg > 0 && manual === null)
      await giveCorrectionCash(
        tx,
        deps,
        cfg,
        opened.correction.id,
        { submissionId: ask.ids.leg, amount: centsToDecimal(leg) },
        {
          personId: who.personId,
          authz: { sessionId: who.sessionId, override: who.override },
          authorization: granted.refund!,
        },
      );
    if (leg > 0 && manual !== null) {
      const { refund: reserved } = await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        legRequest(opened.correction.id),
        { requestedBy: who.personId, authorizedBy: granted.refund!.authorizedBy },
        createdAt,
        { backend: deps.backend, reading },
      );
      await carry(reserved, false);
      fileAfter = opened.correction.id;
    }
  }
  return {
    outcome: await readGiveBackOutcomeOf(tx, deps, cfg, saleId, ask),
    fileAfter,
  };
}
