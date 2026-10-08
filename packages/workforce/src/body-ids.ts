import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";

export async function assertPersonExists(
  tx: Transaction,
  personId: string,
  field: string,
): Promise<void> {
  const { rows } = await tx.execute(sql`select 1 from persons where id = ${personId} limit 1`);
  if (rows.length === 0) throw new AppError("management.request_invalid", { field });
}

export async function assertLocationExists(tx: Transaction, locationId: string): Promise<void> {
  const { rows } = await tx.execute(sql`select 1 from locations where id = ${locationId} limit 1`);
  if (rows.length === 0) throw new AppError("management.request_invalid", { field: "locationId" });
}
