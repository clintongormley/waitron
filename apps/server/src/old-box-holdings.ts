import { liveBackupQuery, type Database } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import { MalformedHoldingsError, type WaitronModule } from "@waitron/module";

type Holdings = Readonly<Record<string, CanonicalValue>>;

/** Each old main box's latest verified chain summary, by its node id, held in memory only. */
export interface OldBoxHoldings {
  record(nodeId: string, holdings: Holdings): void;
  latest(nodeId: string): Holdings | undefined;
}

export function createOldBoxHoldings(): OldBoxHoldings {
  const latest = new Map<string, Holdings>();
  return {
    record: (nodeId, holdings) => void latest.set(nodeId, holdings),
    latest: (nodeId) => latest.get(nodeId),
  };
}

/** What the Servers list compares an old box's summary with. */
export interface OldBoxComparison {
  readonly holdings: OldBoxHoldings;
  readonly modules: readonly WaitronModule[];
}

/**
 * Whether `holdings` names a chain this box does not hold through its last record, by each
 * module's `lacking` seat. A summary a seat cannot read counts as holding more: nothing shows it
 * holds nothing this box lacks.
 */
export async function holdsMore(
  db: Database,
  modules: readonly WaitronModule[],
  holdings: Holdings,
): Promise<boolean> {
  for (const [name, held] of Object.entries(holdings)) {
    const seat = modules.find((m) => m.name === name)?.handover?.lacking;
    if (seat === undefined) continue;
    try {
      if ((await seat(liveBackupQuery(db), held)).length > 0) return true;
    } catch (error) {
      if (error instanceof MalformedHoldingsError) return true;
      throw error;
    }
  }
  return false;
}
