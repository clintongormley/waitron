import "./errors.js";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { canonicalize } from "@waitron/membership";
import { sha256Hex } from "@waitron/handover";
import { checkHandoverCopy, collectHandoverSummaries, type WaitronModule } from "@waitron/module";
import { quoteIdent } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { openBackupQuery, VENUE_FILE, type BackupQuery } from "@waitron/store";
import { checkCopyIntegrity } from "./handover-integrity.js";
import { readSelectedCopy, readStagedCopy, type SelectedCopy } from "./handover-copy-selection.js";

export type EmergencyCopy = ({ source: "mirror-copy" } | SelectedCopy) & {
  identifier: string;
  lastChangeAtMs: number | null;
};

/** The sale and order times whose latest is a copy's latest change. */
export const LATEST_CHANGE_COLUMNS = [
  sales.issuedAt,
  workingOrders.openedAt,
  workingOrders.settledAt,
  workingOrders.collectedAt,
  workingOrderLines.sentAt,
  workingOrderLines.servedAt,
] as const;

/** One `value` row per column per row, or per column with `max`. */
function latestChangeSql(max: boolean): string {
  return LATEST_CHANGE_COLUMNS.map((column) => {
    const name = quoteIdent(column.name);
    return `select ${max ? `max(${name})` : name} as value from ${quoteIdent(getTableName(column.table))}`;
  }).join(" union all ");
}

async function latestOf(query: BackupQuery, max: boolean): Promise<number | null> {
  let latest: number | null = null;
  for await (const { value } of query.rows(latestChangeSql(max))) {
    if (value === null) continue;
    const instant = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(instant))
      throw new AppError("handover.copy_check_failed", { module: "core" });
    latest = Math.max(latest ?? instant, instant);
  }
  return latest;
}

/** The latest sale or order time `query` holds; null when it holds no dated sale or order. */
export function latestChangeAtMs(query: BackupQuery): Promise<number | null> {
  return latestOf(query, false);
}

/**
 * {@link latestChangeAtMs} from each column's text maximum: one value per column instead of every
 * row. The text maximum is the latest time only while every writer of these columns stores
 * `toISOString()`'s spelling.
 */
export function latestChangeAtMsFromMaxima(query: BackupQuery): Promise<number | null> {
  return latestOf(query, true);
}

/** Reads the live copy, including its WAL, without taking either database's write lock. */
export async function checkEmergencyCopy(deps: {
  venueDir: string;
  stateDir?: string;
  modules: readonly WaitronModule[];
  signal?: AbortSignal;
}): Promise<EmergencyCopy> {
  const selection = deps.stateDir === undefined ? null : await readSelectedCopy(deps.stateDir);
  if (deps.stateDir !== undefined && (await readStagedCopy(deps.stateDir)) !== null)
    throw new AppError("handover.copy_mismatch", {});
  const path = join(deps.venueDir, VENUE_FILE);
  if (!(await checkCopyIntegrity(path, { signal: deps.signal })))
    throw new AppError("handover.copy_damaged", {});
  const copy = await openBackupQuery(path);
  try {
    const checked = await checkHandoverCopy(deps.modules, copy.query);
    if (!checked.ok) throw new AppError("handover.chain_broken", { module: checked.module });
    const summary = await collectHandoverSummaries(deps.modules, copy.query);
    const lastChangeAtMs = await latestChangeAtMs(copy.query);
    return {
      ...(selection ?? { source: "mirror-copy" as const }),
      identifier: sha256Hex(canonicalize(summary)),
      lastChangeAtMs,
    };
  } finally {
    await copy.close();
  }
}
