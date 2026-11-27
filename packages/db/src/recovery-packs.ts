import { and, desc, eq, isNull, max } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";
import { recoveryPacks } from "./schema/recovery-packs.js";

/**
 * What one part of a pack held, and the checks that tell when it is out of date. An `emergency`
 * entry `included` means the pack printed the Cloud QR code; a `master-key` one, that it showed the
 * current master key.
 */
export type RecoveryPackPartRecord = {
  part: "bucket" | "archives" | "emergency" | "master-key";
  state: "included" | "absent" | "failed" | "not-set-up";
  keyChangedAt?: string;
  /** `keyChangedAt` is the pack's own time: nothing had changed the backup key yet. */
  keyNeverChanged?: boolean;
  settingsRevision?: string;
  destination?: "bucket" | "folder";
  /**
   * A `master-key` entry's: the row number in `master_keys` of the key the pack showed, and that
   * key's name. Both are needed: a setup retry shows a new key that takes the row number an earlier
   * attempt's pack recorded for a key it never saved.
   */
  masterKeyNumber?: number;
  masterKeyName?: string;
};

export type RecoveryPackRecord = {
  nodeId: string;
  number: number;
  madeAt: Date;
  madeBy: string | null;
  receivedAt: Date | null;
  parts: RecoveryPackPartRecord[];
};

const PARTS = new Set(["bucket", "archives", "emergency", "master-key"]);
const STATES = new Set(["included", "absent", "failed", "not-set-up"]);
const TEXT_FIELDS = new Set(["keyChangedAt", "settingsRevision"]);
// The printed name's shape, so the master key itself can never be stored as its name.
const MASTER_KEY_NAME = /^\d{4}-\d\d-\d\d · [2-9A-HJKMNP-Z]{4}$/;

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
    } else if (key === "keyNeverChanged") {
      if (typeof value !== "boolean") refuse();
    } else if (key === "masterKeyNumber") {
      if (record.part !== "master-key" || !Number.isSafeInteger(value) || (value as number) < 1)
        refuse();
    } else if (key === "masterKeyName") {
      if (record.part !== "master-key" || typeof value !== "string" || !MASTER_KEY_NAME.test(value))
        refuse();
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

export async function readRecoveryPack(
  db: Database | Transaction,
  nodeId: string,
  number: number,
): Promise<RecoveryPackRecord | null> {
  const [row] = await db
    .select()
    .from(recoveryPacks)
    .where(and(eq(recoveryPacks.nodeId, nodeId), eq(recoveryPacks.number, number)));
  return row ?? null;
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
