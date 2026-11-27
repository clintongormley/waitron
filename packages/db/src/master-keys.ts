import { desc, max } from "drizzle-orm";
import type { BackupQuery } from "@waitron/store";
import type { Database, Transaction } from "./client.js";
import { masterKeys } from "./schema/master-keys.js";

export type MasterKeyRecord = {
  number: number;
  name: string;
  checkValue: string;
  publicKey: Uint8Array;
  madeAt: Date;
  madeBy: string | null;
};

/** The number {@link insertMasterKey} gives the next key written in this transaction. */
export async function nextMasterKeyNumber(tx: Transaction): Promise<number> {
  const [latest] = await tx.select({ number: max(masterKeys.number) }).from(masterKeys);
  return (latest?.number ?? 0) + 1;
}

/** Writes the next master key and answers its number. */
export async function insertMasterKey(
  tx: Transaction,
  row: Omit<MasterKeyRecord, "number">,
): Promise<number> {
  const number = await nextMasterKeyNumber(tx);
  await tx.insert(masterKeys).values({ ...row, number });
  return number;
}

/** The key in force: the highest-numbered one, or null before the first. */
export async function readCurrentMasterKey(
  db: Database | Transaction,
): Promise<MasterKeyRecord | null> {
  const [row] = await db.select().from(masterKeys).orderBy(desc(masterKeys.number)).limit(1);
  return row ?? null;
}

/** {@link readCurrentMasterKey}'s name and check value, read from a backup copy. */
export async function readCurrentMasterKeyCheck(
  query: BackupQuery,
): Promise<{ name: string; checkValue: string } | null> {
  for await (const row of query.rows(
    "select name, check_value from master_keys order by number desc limit 1",
  ))
    return { name: String(row.name), checkValue: String(row.check_value) };
  return null;
}
