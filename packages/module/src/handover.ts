import type { Transaction } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import { AppError, type ErrorCode, type ErrorParams } from "@waitron/shared";
import type { BackupQuery } from "@waitron/store";
import type { WaitronModule } from "./module.js";
import "./errors.js";

export interface ReturnDiscrepancy {
  saleId: string;
  fingerprint: string;
  outstanding: CanonicalValue;
  eligible: boolean;
  original: CanonicalValue;
  incoming: CanonicalValue;
  held: CanonicalValue;
}

/** A record this box holds, on any of its chains, that the main box's holdings do not cover. */
export interface UnreturnedRecord {
  saleId: string;
  /** The record's position in its chain. */
  number: number;
  type: "issue" | "cancellation";
  createdAt: string;
  /** The module's own filing state; null when the record was never queued for filing. */
  filingState: string | null;
}

export interface UnreturnedChain {
  ids: Readonly<Record<string, string>>;
  /**
   * True when the main box's summary does not show it holds this box's part of the chain (it lacks
   * the chain, disagrees with it, or is ahead of this box on it, which this box cannot check), so
   * every record is listed.
   */
  whole: boolean;
  records: UnreturnedRecord[];
}

/** Thrown by a module's `lacking` seat when another box's `holdings` are not in its shape. */
export class MalformedHoldingsError extends Error {}

/** A refusal a return seat answers rather than throws, so the rows it stored before it stay. */
export interface ReturnRefusal<C extends ErrorCode = ErrorCode> {
  refusal: C;
  params?: ErrorParams[C];
}

/**
 * What a module vouches for and checks in a copy handed to another box, and the records an old
 * main box returns to the new one.
 */
export interface ModuleHandoverContribution {
  summarise?(query: BackupQuery): Promise<CanonicalValue>;
  returnRecords?: {
    read(tx: Transaction, sourceNodeId: string): Promise<CanonicalValue[]>;
    /**
     * Batches of the records of boxes other than the two named that the main box's holdings do not
     * cover; `null` when this box holds such a record and no holdings were given.
     */
    readOthers?(
      tx: Transaction,
      sourceNodeId: string,
      destinationNodeId: string,
      mainHoldings: CanonicalValue | undefined,
    ): Promise<CanonicalValue[] | null>;
    acceptPermission?: string;
    inspect?(
      tx: Transaction,
      sourceNodeId: string,
      batch: CanonicalValue,
    ): Promise<ReturnDiscrepancy[]>;
    receive(
      tx: Transaction,
      sourceNodeId: string,
      batch: CanonicalValue,
      now: Date,
      accepted?: readonly string[],
      others?: { destinationNodeId: string },
    ): Promise<boolean | ReturnRefusal>;
  };
  checkCopy?(query: BackupQuery): Promise<"ok" | "broken">;
  /** What this box holds of every box's records, as plain JSON, for another box to compare. */
  holdings?(query: BackupQuery): Promise<CanonicalValue>;
  /**
   * Which of another box's `holdings` this database does not hold; empty when it holds them all.
   * Holdings not in the module's shape throw `MalformedHoldingsError`.
   */
  lacking?(query: BackupQuery, holdings: CanonicalValue): Promise<CanonicalValue[]>;
  /**
   * The records in this database that the main box's `holdings` do not cover, by chain; a chain is
   * left out only when those holdings show the main box holds this box's part of it. With no
   * holdings (`undefined`, the main box was not asked), every chain is listed whole. Holdings not in
   * the module's shape throw `MalformedHoldingsError`.
   */
  unreturned?(
    query: BackupQuery,
    mainHoldings: CanonicalValue | undefined,
  ): Promise<UnreturnedChain[]>;
}

function byName(modules: readonly WaitronModule[]): WaitronModule[] {
  return [...modules].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Callers pass the enabled modules. */
export async function collectHandoverSummaries(
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<Record<string, CanonicalValue>> {
  const summaries: Record<string, CanonicalValue> = {};
  for (const m of byName(modules)) {
    const handover = m.handover;
    if (handover?.summarise === undefined) continue;
    try {
      summaries[m.name] = await handover.summarise(query);
    } catch (e) {
      throw new AppError(
        "handover.summary_failed",
        { module: m.name },
        { reason: e instanceof Error ? e.message : String(e) },
      );
    }
  }
  return summaries;
}

export async function checkHandoverCopy(
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<{ ok: true } | { ok: false; module: string }> {
  for (const m of byName(modules)) {
    const handover = m.handover;
    if (handover?.checkCopy === undefined) continue;
    let answer: "ok" | "broken";
    try {
      answer = await handover.checkCopy(query);
    } catch (e) {
      throw new AppError(
        "handover.copy_check_failed",
        { module: m.name },
        { reason: e instanceof Error ? e.message : String(e) },
      );
    }
    if (answer === "broken") return { ok: false, module: m.name };
  }
  return { ok: true };
}
