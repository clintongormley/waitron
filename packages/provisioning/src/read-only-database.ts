import { WAL_SUFFIX, SHM_SUFFIX } from "@waitron/store";
import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Database } from "@waitron/db";

export type ImmutableOpen =
  | { readonly kind: "open"; readonly connection: DatabaseSync }
  | { readonly kind: "wal" }
  | { readonly kind: "failed"; readonly stage: "wal" | "open"; readonly error: unknown };

/**
 * Opens the database at `path` read-only and immutable, which leaves no side file behind, unless
 * its `-wal` holds pages (`wal`): an immutable open reads the main file only and would read past
 * them. Never throws.
 */
export async function openImmutableWhenWalEmpty(path: string): Promise<ImmutableOpen> {
  try {
    if ((await lstat(`${path}${WAL_SUFFIX}`)).size !== 0) return { kind: "wal" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return { kind: "failed", stage: "wal", error };
  }
  try {
    return { kind: "open", connection: openImmutable(path) };
  } catch (error) {
    return { kind: "failed", stage: "open", error };
  }
}

/**
 * Opens the database at `path` read-only and immutable: it ignores a `-wal` and writes nothing
 * beside it.
 */
export function openImmutable(path: string): DatabaseSync {
  const url = pathToFileURL(path);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url, { readOnly: true });
}

export type InPlaceOpen =
  | { readonly kind: "open"; readonly connection: DatabaseSync }
  | { readonly kind: "missing" }
  | { readonly kind: "not-a-file" }
  | { readonly kind: "short" }
  | { readonly kind: "no-shm" }
  | { readonly kind: "wal-header" };

const SQLITE_HEADER_BYTES = 100;

/**
 * Opens the WAL database at `path` read-only where it is, so committed pages that sit only in its
 * `-wal` are read, with `readonly_shm`: measured with no other connection holding the files, it
 * reads them whatever the `-shm` holds and writes or deletes no file, even for a `-wal` it reads
 * as empty, which the no-locking file layer (`vfs=unix-none`) deletes on close. Not opened: with
 * no `-shm` (`no-shm`, the open would fail); for a main file shorter than SQLite's 100-byte header
 * (`short`, opening a 0- or 1-byte one was measured to delete the `-wal`); for a `-wal` header
 * SQLite rejects (`wal-header`, the open retries for several seconds (14 to 20 measured), then
 * fails with errcode 15; read from a copy, SQLite ignores that `-wal`). A `-journal` is not rolled
 * back: a caller must not use this beside one. The connection refuses writes.
 */
export async function openWalInPlace(path: string): Promise<InPlaceOpen> {
  const main = await plainFile(path);
  if (main === "missing" || main === "not-a-file") return { kind: main };
  if (main.size < SQLITE_HEADER_BYTES) return { kind: "short" };
  const wal = await plainFile(`${path}${WAL_SUFFIX}`);
  if (wal === "not-a-file") return { kind: wal };
  const shm = await plainFile(`${path}${SHM_SUFFIX}`);
  if (shm === "not-a-file") return { kind: shm };
  if (shm === "missing") return { kind: "no-shm" };
  if (wal !== "missing" && !(await walHeaderAccepted(`${path}${WAL_SUFFIX}`, wal.size)))
    return { kind: "wal-header" };
  const url = pathToFileURL(path);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("readonly_shm", "1");
  return { kind: "open", connection: new DatabaseSync(url, { readOnly: true }) };
}

/** False for the headers measured to stall a read in place: too short, a wrong magic, a page size SQLite refuses. */
async function walHeaderAccepted(path: string, size: number): Promise<boolean> {
  if (size <= 32) return false;
  const header = Buffer.alloc(12);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    await handle.read(header, 0, 12, 0);
  } finally {
    await handle.close();
  }
  const pageSize = header.readUInt32BE(8);
  return (
    (header.readUInt32BE(0) & 0xfffffffe) >>> 0 === 0x377f0682 &&
    (pageSize & (pageSize - 1)) === 0 &&
    pageSize >= 512 &&
    pageSize <= 65536
  );
}

async function plainFile(path: string): Promise<Stats | "missing" | "not-a-file"> {
  try {
    const stats = await lstat(path);
    return stats.isFile() ? stats : "not-a-file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** A plain `execute` target over `connection`, for module seats that read with plain statements. */
export function executeTarget(connection: DatabaseSync): Pick<Database, "execute"> {
  const dialect = new SQLiteSyncDialect();
  return {
    execute<Row extends Record<string, unknown>>(query: SQLWrapper | string) {
      const compiled =
        typeof query === "string" ? { sql: query, params: [] } : dialect.sqlToQuery(query.getSQL());
      return {
        rows: connection
          .prepare(compiled.sql)
          .all(...(compiled.params as SQLInputValue[])) as Row[],
      };
    },
  };
}
