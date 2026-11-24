import { liveBackupQuery, type Database } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { emergencyCopyFrom } from "./handover-intervals.js";
import type { Logger } from "./logger.js";

type Holdings = Readonly<Record<string, CanonicalValue>>;

/** The main box's summary from its latest verified reset-order answer, and when it arrived. */
export interface HeardHoldings {
  readonly holdings: Holdings;
  readonly heardAt: Date;
}

/** The copy's latest sale or order time, as the main box last sent it after an emergency switch. */
export interface HeardCopy {
  readonly lastChangeAtMs: number | null;
}

/** This box's own summary, per module that fills the `holdings` seat; reads only. */
export async function readHoldings(
  db: Database,
  modules: readonly WaitronModule[],
): Promise<Record<string, CanonicalValue>> {
  const holdings: Record<string, CanonicalValue> = {};
  for (const module of modules) {
    const seat = module.handover?.holdings;
    if (seat) holdings[module.name] = await seat(liveBackupQuery(db));
  }
  return holdings;
}

/** This box's summary for the answer; left out when it cannot be read, so an order still goes. */
export async function ownHoldings(
  deps: { db: Database; modules: readonly WaitronModule[] },
  log: Logger,
  source: string,
): Promise<{ holdings?: Record<string, CanonicalValue> }> {
  try {
    return { holdings: await readHoldings(deps.db, deps.modules) };
  } catch (error) {
    log("warn", "reset-order.holdings_unread", { nodeId: source, errorCode: codeOf(error) });
    return {};
  }
}

/** The copy's latest change for the answer; left out when it cannot be read, so an order still goes. */
export async function copyTime(
  deps: { db: Database },
  log: Logger,
  source: string,
): Promise<{ lastChangeAtMs?: number | null }> {
  try {
    const copy = await emergencyCopyFrom(deps.db, source);
    return copy === null ? {} : { lastChangeAtMs: copy.lastChangeAtMs };
  } catch (error) {
    log("warn", "reset-order.copy_unread", { nodeId: source, errorCode: codeOf(error) });
    return {};
  }
}
