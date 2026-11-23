import { sql } from "drizzle-orm";
import type { BackupQuery, BackupRow } from "@waitron/store";
import type { Database, Transaction } from "./client.js";

/**
 * A module seat's `BackupQuery` over the live database or a transaction on it, its whole numbers
 * read as bigints as `openBackupQuery` reads a backup copy's integers. Unlike that reader, a REAL
 * holding a whole number also comes back as a bigint, and an integer outside JavaScript's safe
 * range throws.
 */
export function liveBackupQuery(db: Database | Transaction): BackupQuery {
  return {
    async *rows(statement, values = []) {
      const parts = statement.split("?");
      const query = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) query.append(sql`${values[i - 1]}`);
        query.append(sql.raw(parts[i]!));
      }
      for (const row of db.all<BackupRow>(query))
        yield Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value,
          ]),
        );
    },
  };
}
