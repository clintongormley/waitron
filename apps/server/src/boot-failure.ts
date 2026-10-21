import { MAX_CAUSE_DEPTH, diskFullIn, isAppError, sqliteFailureOf } from "@waitron/shared";
import "./errors.js";
import type { Statfs } from "./free-bytes.js";
import { lowestFreeBytes } from "./start-space.js";

/**
 * Result codes meaning the engine cannot open the venue file at all (SQLITE_CANTOPEN): a list, so
 * adding a code is a named decision rather than a widened pattern.
 *
 * Deliberately NOT here: SQLITE_NOTADB (26), `file is not a database`. Naming another code is a
 * product decision needing a registry entry and English and Spanish operator wording, so a corrupted
 * venue file reaches the page as `unknown`.
 */
export const UNREACHABLE_RESULT_CODES: readonly number[] = [14];

/**
 * Matched on the MESSAGE because a missing table or column and an ordinary query mistake share
 * errcode 1, and this code's operator action is "restore from a backup, or reinstall". A release
 * that rewords the message leaves this reading `unknown`, silently.
 */
const SCHEMA_MISSING = /^no such (table|column): /;

const UNREACHABLE = new Set(UNREACHABLE_RESULT_CODES);

/**
 * The code recorded for a boot failure. The unauthenticated recovery page's title and action are
 * fixed text chosen by this code; what else the page shows is at `OPERATOR_TEXT`
 * (`recovery-surface.ts`). A socket failure is not classified: the database is a file, so it cannot
 * come from the database.
 */
export function classifyBootFailure(error: unknown): string {
  if (diskFullIn(error)) return "storage.disk_full";
  if (isAppError(error)) return error.code;
  const failure = sqliteFailureOf(error);
  if (failure !== null) {
    if (UNREACHABLE.has(failure.errcode)) return "provisioning.database_unreachable";
    if (SCHEMA_MISSING.test(failure.message)) return "provisioning.schema_mismatch";
  }
  return "unknown";
}

/**
 * Below this, an engine "cannot open" or I/O failure, or ENOSPC, is taken for a full disk. Measured
 * on 2026-10-21: every full-disk failure on HFS+, tmpfs and ext4 happened with at most 48 KiB free,
 * and APFS reported about 1.2 MB free while full.
 */
export const FULL_DISK_BYTES = 16 * 1024 * 1024;

/** The engine's "cannot open" (14) and I/O (10) families, which a full disk also raises. */
export const FULL_DISK_PRIMARY_CODES: readonly number[] = [10, 14];

const FULL_DISK_PRIMARY = new Set(FULL_DISK_PRIMARY_CODES);

function enospcIn(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const layer = current as { code?: unknown; cause?: unknown };
    if (layer.code === "ENOSPC") return true;
    if (layer.cause === current) return false;
    current = layer.cause;
  }
  return false;
}

/**
 * Whether a failure was a full disk. Beyond the engine's own full-disk code, the "cannot open" and
 * I/O families and ENOSPC count only below {@link FULL_DISK_BYTES}, because a missing folder raises
 * the same "cannot open" code on a disk with room.
 */
export function fullDiskFailure(error: unknown, freeBytes: number | null): boolean {
  if (diskFullIn(error)) return true;
  if (freeBytes === null || freeBytes >= FULL_DISK_BYTES) return false;
  const failure = sqliteFailureOf(error);
  if (failure !== null && FULL_DISK_PRIMARY.has(failure.errcode & 0xff)) return true;
  return enospcIn(error);
}

/** {@link classifyBootFailure}, except that an unreachable or unknown failure on a full disk is named one. */
export function classifyStartFailure(error: unknown, freeBytes: number | null): string {
  const code = classifyBootFailure(error);
  if (
    (code === "provisioning.database_unreachable" || code === "unknown") &&
    fullDiskFailure(error, freeBytes)
  ) {
    return "storage.disk_full";
  }
  return code;
}

/** `classifyStartFailure` with free space read now from `dirs`; for callers that have only the error. */
export async function startFailureCode(
  error: unknown,
  dirs: readonly string[],
  statfs?: Statfs,
): Promise<string> {
  return classifyStartFailure(error, await lowestFreeBytes(dirs, statfs));
}
