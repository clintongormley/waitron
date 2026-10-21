import { constants, DatabaseSync } from "node:sqlite";

export type BackupValue = null | string | number | bigint | Uint8Array;
export type BackupRow = Readonly<Record<string, BackupValue>>;

export interface BackupQuery {
  rows(sql: string, values?: readonly BackupValue[]): AsyncIterable<BackupRow>;
}
const PURE_FUNCTIONS = new Set(["count", "max", "min", "length", "hex", "coalesce", "json_valid"]);
export async function openBackupQuery(databasePath: string): Promise<{
  query: BackupQuery;
  close(): Promise<void>;
}> {
  const database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
  const close = async () => {
    if (database.isOpen) database.close();
  };
  try {
    database.exec("pragma query_only = on");
    database.prepare("select name from sqlite_schema limit 0").get();
    database.setAuthorizer((action, _first, second) => {
      if (
        action === constants.SQLITE_SELECT ||
        action === constants.SQLITE_READ ||
        action === constants.SQLITE_RECURSIVE
      )
        return constants.SQLITE_OK;
      if (
        action === constants.SQLITE_FUNCTION &&
        second !== null &&
        PURE_FUNCTIONS.has(second.toLowerCase())
      )
        return constants.SQLITE_OK;
      return constants.SQLITE_DENY;
    });
    const query: BackupQuery = Object.freeze({
      async *rows(sql: string, values: readonly BackupValue[] = []) {
        try {
          const statement = database.prepare(sql);
          statement.setReadBigInts(true);
          for (const row of statement.iterate(...values)) yield Object.freeze(row);
        } catch (error) {
          await close();
          throw error;
        }
      },
    });
    return Object.freeze({ query, close });
  } catch (error) {
    await close();
    throw error;
  }
}
