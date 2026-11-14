import "./errors.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { canonicalize } from "@waitron/membership";
import { sha256Hex } from "@waitron/handover";
import { checkHandoverCopy, collectHandoverSummaries, type WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { openBackupQuery, PAIR_COPY_DIR, VENUE_FILE } from "@waitron/store";
import { isCopyIntact } from "./handover-integrity.js";
import { readSelectedCopy, type SelectedCopy } from "./handover-copy-selection.js";

export type EmergencyCopy = ({ source: "mirror-copy" } | SelectedCopy) & {
  identifier: string;
  lastChangeAtMs: number | null;
};

/** Reads the live copy, including its WAL, without taking either database's write lock. */
export async function checkEmergencyCopy(deps: {
  venueDir: string;
  stateDir?: string;
  modules: readonly WaitronModule[];
}): Promise<EmergencyCopy> {
  const selection = deps.stateDir === undefined ? null : await readSelectedCopy(deps.stateDir);
  if (selection !== null && existsSync(join(deps.stateDir!, PAIR_COPY_DIR, VENUE_FILE)))
    throw new AppError("handover.copy_mismatch", {});
  const path = join(deps.venueDir, VENUE_FILE);
  if (!(await isCopyIntact(path))) throw new AppError("handover.copy_damaged", {});
  const copy = await openBackupQuery(path);
  try {
    const checked = await checkHandoverCopy(deps.modules, copy.query);
    if (!checked.ok) throw new AppError("handover.chain_broken", { module: checked.module });
    const summary = await collectHandoverSummaries(deps.modules, copy.query);
    let lastChangeAtMs: number | null = null;
    for await (const { value } of copy.query.rows(`
      select issued_at as value from sales
      union all select opened_at from working_orders
      union all select settled_at from working_orders
      union all select collected_at from working_orders
      union all select payment_attempt_at from working_orders
      union all select sent_at from working_order_lines
      union all select served_at from working_order_lines
    `)) {
      if (value === null) continue;
      const instant = typeof value === "string" ? Date.parse(value) : NaN;
      if (!Number.isFinite(instant))
        throw new AppError("handover.copy_check_failed", { module: "core" });
      lastChangeAtMs = Math.max(lastChangeAtMs ?? instant, instant);
    }
    return {
      ...(selection ?? { source: "mirror-copy" as const }),
      identifier: sha256Hex(canonicalize(summary)),
      lastChangeAtMs,
    };
  } finally {
    await copy.close();
  }
}
