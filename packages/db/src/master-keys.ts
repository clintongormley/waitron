import { desc, max } from "drizzle-orm";
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

/** Writes the next master key and answers its number. */
export async function insertMasterKey(
  tx: Transaction,
  row: Omit<MasterKeyRecord, "number">,
): Promise<number> {
  const [latest] = await tx.select({ number: max(masterKeys.number) }).from(masterKeys);
  const number = (latest?.number ?? 0) + 1;
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
