import { constants, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export type BackupValue = null | string | number | bigint | Uint8Array;
export type BackupRow = Readonly<Record<string, BackupValue>>;

export interface BackupQuery {
  rows(sql: string, values?: readonly BackupValue[]): AsyncIterable<BackupRow>;
}

/**
 * The address that opens the file at `path` read-only and immutable: SQLite reads the main file
 * alone and writes nothing beside it. Only for a caller that has already refused a `-wal` or a
 * `-journal` there, or that means to read past them.
 */
export function immutableFileUrl(path: string): URL {
  const url = pathToFileURL(path);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return url;
}

const PURE_FUNCTIONS = new Set(["count", "max", "min", "length", "hex", "coalesce", "json_valid"]);
/** `immutable` opens a file through {@link immutableFileUrl}; bytes ignore it. */
export async function openBackupQuery(
  databasePath: string | Uint8Array,
  options: { immutable?: boolean } = {},
): Promise<{
  query: BackupQuery;
  close(): Promise<void>;
}> {
  const fromBytes = databasePath instanceof Uint8Array;
  let target: string | URL = ":memory:";
  if (!fromBytes)
    target = options.immutable === true ? immutableFileUrl(databasePath) : databasePath;
  const database = new DatabaseSync(target, { readOnly: !fromBytes, allowExtension: false });
  const close = async () => {
    if (database.isOpen) database.close();
  };
  try {
    if (fromBytes) database.deserialize(databasePath);
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
