import { and, desc, eq, isNull, max } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";
import { recoveryPacks } from "./schema/recovery-packs.js";

/** What one part of a pack held, and the checks that tell when it is out of date. */
export type RecoveryPackPartRecord = {
  part: "bucket" | "archives" | "server-key";
  state: "included" | "absent" | "failed" | "not-set-up";
  keyChangedAt?: string;
  settingsRevision?: string;
  destination?: "bucket" | "folder";
  keyName?: string;
  carriedKey?: boolean;
};

export type RecoveryPackRecord = {
  nodeId: string;
  number: number;
  madeAt: Date;
  madeBy: string | null;
  receivedAt: Date | null;
  parts: RecoveryPackPartRecord[];
};

const PARTS = new Set(["bucket", "archives", "server-key"]);
const STATES = new Set(["included", "absent", "failed", "not-set-up"]);
const TEXT_FIELDS = new Set(["keyChangedAt", "settingsRevision", "keyName"]);

// An allow-list, so nothing secret can reach a backup through this table: the row travels in
// every copy of venue.db.
function checkedPart(entry: unknown): RecoveryPackPartRecord {
  const refuse = (): never => {
    throw new Error("recovery pack part record refused");
  };
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return refuse();
  const record = entry as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "part") {
      if (!PARTS.has(value as string)) refuse();
    } else if (key === "state") {
      if (!STATES.has(value as string)) refuse();
    } else if (key === "destination") {
      if (value !== "bucket" && value !== "folder") refuse();
    } else if (key === "carriedKey") {
      if (typeof value !== "boolean") refuse();
    } else if (!TEXT_FIELDS.has(key) || typeof value !== "string") refuse();
  }
  if (!("part" in record) || !("state" in record)) refuse();
  return record as RecoveryPackPartRecord;
}

export async function nextRecoveryPackNumber(tx: Transaction, nodeId: string): Promise<number> {
  const [row] = await tx
    .select({ latest: max(recoveryPacks.number) })
    .from(recoveryPacks)
    .where(eq(recoveryPacks.nodeId, nodeId));
  return (row?.latest ?? 0) + 1;
}

export async function insertRecoveryPack(
  tx: Transaction,
  row: Omit<RecoveryPackRecord, "receivedAt">,
): Promise<void> {
  const parts = row.parts.map(checkedPart);
  await tx.insert(recoveryPacks).values({ ...row, parts, receivedAt: null });
}

/** Sets `received_at` the first time only. */
export async function markRecoveryPackReceived(
  tx: Transaction,
  nodeId: string,
  number: number,
  at: Date,
): Promise<void> {
  await tx
    .update(recoveryPacks)
    .set({ receivedAt: at })
    .where(
      and(
        eq(recoveryPacks.nodeId, nodeId),
        eq(recoveryPacks.number, number),
        isNull(recoveryPacks.receivedAt),
      ),
    );
}

/** This node's packs, newest first. */
export async function readRecoveryPacks(
  db: Database | Transaction,
  nodeId: string,
): Promise<RecoveryPackRecord[]> {
  return db
    .select()
    .from(recoveryPacks)
    .where(eq(recoveryPacks.nodeId, nodeId))
    .orderBy(desc(recoveryPacks.number));
}
