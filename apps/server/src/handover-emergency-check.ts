import "./errors.js";
import { join } from "node:path";
import { canonicalize } from "@waitron/membership";
import { sha256Hex } from "@waitron/handover";
import { checkHandoverCopy, collectHandoverSummaries, type WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { openBackupQuery, VENUE_FILE, type BackupQuery } from "@waitron/store";
import { checkCopyIntegrity } from "./handover-integrity.js";
import { readSelectedCopy, readStagedCopy, type SelectedCopy } from "./handover-copy-selection.js";

export type EmergencyCopy = ({ source: "mirror-copy" } | SelectedCopy) & {
  identifier: string;
  lastChangeAtMs: number | null;
};

/** The latest sale or order time `query` holds; null when it holds no dated sale or order. */
export async function latestChangeAtMs(query: BackupQuery): Promise<number | null> {
  let latest: number | null = null;
  for await (const { value } of query.rows(`
    select issued_at as value from sales
    union all select opened_at from working_orders
    union all select settled_at from working_orders
    union all select collected_at from working_orders
    union all select sent_at from working_order_lines
    union all select served_at from working_order_lines
  `)) {
    if (value === null) continue;
    const instant = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(instant))
      throw new AppError("handover.copy_check_failed", { module: "core" });
    latest = Math.max(latest ?? instant, instant);
  }
  return latest;
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
