import { withTransaction, type Transaction } from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";
import { readPersonAuthority, type Authorization, type PersonAuthority } from "@waitron/identity";
import { codeOf } from "@waitron/server-kit";
import { AppError, type SaleId } from "@waitron/shared";
import type { GiveBackPart } from "./give-back-plan.js";
import {
  openCorrectionPart,
  pressIds,
  pressRunning,
  readerPresses,
  readGiveBackOutcomeOf,
  type GiveBackOutcome,
  type GiveBackWrite,
} from "./give-back-press.js";
import { reasonOf, type WaitReason } from "./give-back-read.js";
import { closeInvoiceCorrection } from "./invoice-corrections.js";
import { carryNewTenderRefund, refuseUntilRefundable } from "./tender-refund-completion.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import { refuseUnlessProviderRefunds, type TenderRefundDeps } from "./tender-refunds.js";
import { claimTenderRefund, resolveClaimedTenderRefund } from "./tender-refund-sends.js";
import { fileCorrectionAutomatically } from "./invoice-correction-alerts.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { requireEconomicWrite } from "./trading-admission.js";

/** One reader part's refund: what it asks for, and who asks and authorizes it. */
type ReaderRefund = {
  request: TenderRefundRequest;
  actor: Parameters<typeof reserveTenderRefund>[4];
};

/** The rights one reader part was granted in its own transaction, and the person's roles then. */
export type PartAuthority = {
  refund?: Authorization;
  rectify?: Authorization;
  authority: PersonAuthority;
};

interface ReaderSequence {
  /** Who gives back; a correction whose leg fails is discarded under their name. */
  personId: string;
  authorize: (
    tx: Transaction,
    part: GiveBackPart,
  ) => Promise<{ refund?: Authorization; rectify?: Authorization }>;
  /** In order; a correction's `refund` takes the correction's id, and is null when its leg holds
   * nothing on this card. */
  parts: {
    part: GiveBackPart;
    refund: ((correctionId: string, fresh: PartAuthority) => ReaderRefund) | null;
  }[];
  open: (
    tx: Transaction,
    reading: TrustedReading,
    part: GiveBackPart,
    rectify: Authorization,
  ) => ReturnType<typeof openCorrectionPart>;
}

/**
 * Gives the press `ask` back on a card reader (5.3), each part in its own transaction followed by
 * the card company's answer. Splitting the press across transactions is a deliberate decision
 * (CLAUDE.md §3): the card company is asked between parts, and no transaction stays open across its
 * answer. A correction opens in the same transaction as its leg's reservation and is discarded if
 * that leg fails, so a refused card refund never leaves a correction open. A part left pending
 * stops the press, the answer's `rest` naming what was not sent. A part refused after an earlier
 * one moved money answers `refusal` and undoes nothing: that money is already back on the card.
 * A part another send of the same ids already wrote is never carried again (I1).
 */
export async function giveBackOnReader(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  ask: GiveBackWrite,
  sequence: ReaderSequence,
): Promise<GiveBackOutcome> {
  const running = readerPresses(deps.db);
  if (pressRunning(deps.db, ask))
    return withTransaction(deps.db, (tx) =>
      readGiveBackOutcomeOf(tx, deps, cfg, saleId, ask, null, true),
    );
  for (const id of pressIds(ask)) running.add(id);
  try {
    return await runReaderParts(deps, cfg, saleId, ask, sequence);
  } finally {
    for (const id of pressIds(ask)) running.delete(id);
  }
}

async function runReaderParts(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  ask: GiveBackWrite,
  sequence: ReaderSequence,
): Promise<GiveBackOutcome> {
  let refusal: WaitReason | null = null;
  for (const [index, step] of sequence.parts.entries()) {
    let settled: { id: string; state: string; correctionId?: string } | null;
    try {
      settled = await readerPart(deps, cfg, saleId, sequence, step);
    } catch (error) {
      if (index === 0 || !(error instanceof AppError)) throw error;
      refusal = reasonOf(error);
      break;
    }
    if (settled === null) break;
    if (settled.correctionId !== undefined && settled.state === "completed")
      await fileCorrectionAutomatically(deps, settled.correctionId).catch((error: unknown) => {
        deps.log?.("error", "invoice_correction.automatic_filing_failed", {
          correctionId: settled.correctionId,
          refundId: settled.id,
          errorCode: codeOf(error),
        });
      });
    if (settled.correctionId !== undefined && settled.state === "failed") {
      const correctionId = settled.correctionId;
      // Refused (a stepdown, say), the correction stays open and the answer shows it under way.
      await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, cfg, deps.admission);
        await closeInvoiceCorrection(tx, deps, cfg, correctionId, {
          personId: sequence.personId,
        });
      }).catch((error: unknown) => {
        if (!(error instanceof AppError)) throw error;
        deps.log?.("error", "give_back.discard_failed", {
          correctionId,
          refundId: settled.id,
          errorCode: error.code,
        });
      });
    }
    if (settled.state !== "completed") break;
  }
  return withTransaction(deps.db, (tx) =>
    readGiveBackOutcomeOf(tx, deps, cfg, saleId, ask, refusal),
  );
}

/** Writes one reader part in its own transaction, then waits for the card company's answer as
 * Refund a payment does; null when nothing was sent: another send of these ids wrote the part, or
 * the correction's leg holds nothing on this card. */
async function readerPart(
  deps: TenderRefundDeps,
  cfg: DeviceRequestConfig,
  saleId: SaleId,
  sequence: ReaderSequence,
  step: ReaderSequence["parts"][number],
): Promise<{ id: string; state: string; correctionId?: string } | null> {
  let release: (() => void) | undefined;
  try {
    const reserved = await withTransaction(deps.db, async (tx) => {
      await requireEconomicWrite(tx, cfg, deps.admission);
      const reading = deps.clock.now();
      await refuseUntilRefundable(tx, deps.backend, cfg.nodeId, reading);
      const fresh: PartAuthority = {
        ...(await sequence.authorize(tx, step.part)),
        authority: await readPersonAuthority(tx, sequence.personId),
      };
      let correctionId: string | undefined;
      if (step.part.kind === "correction") {
        const opened = await sequence.open(tx, reading, step.part, fresh.rectify!);
        if (opened.replayed) return null;
        correctionId = opened.correction.id;
      }
      if (step.refund === null) return null;
      const { request, actor } = step.refund(correctionId ?? "", fresh);
      const begun = await reserveTenderRefund(
        tx,
        cfg,
        saleId,
        request,
        actor,
        reading.instant.toISOString(),
        { backend: deps.backend, reading },
      );
      if (begun.replayed) return null;
      const carried = await carryNewTenderRefund(tx, deps, cfg.nodeId, reading, begun.refund, {
        beforeCompletion: (refund) => refuseUnlessProviderRefunds(tx, deps, refund),
      });
      release = claimTenderRefund(deps.db, carried.id);
      return { id: carried.id, correctionId };
    });
    if (reserved === null) return null;
    const held = release!;
    release = undefined;
    const settled = await resolveClaimedTenderRefund(deps, reserved.id, "retry", held);
    return {
      id: settled.id,
      state: settled.state,
      ...(reserved.correctionId === undefined ? {} : { correctionId: reserved.correctionId }),
    };
  } catch (error) {
    release?.();
    throw error;
  }
}
