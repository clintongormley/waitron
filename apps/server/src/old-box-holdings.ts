import { liveBackupQuery, type Database } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";

type Holdings = Readonly<Record<string, CanonicalValue>>;

/** The main box's summary from its latest verified reset-order answer, and when it arrived. */
export interface HeardHoldings {
  readonly holdings: Holdings;
  readonly heardAt: Date;
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
