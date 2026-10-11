import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { appendOnlyTriggerFaults } from "@waitron/store";
import "./errors.js";

/** Throws `append_only.triggers_changed` when any of `tables`' append-only triggers is missing or altered. */
export function assertAppendOnlyIntact(db: Database, tables: readonly string[]): void {
  const { missing, altered } = appendOnlyTriggerFaults(db, tables);
  if (missing.length > 0 || altered.length > 0) {
    throw new AppError("append_only.triggers_changed", { missing, altered });
  }
}
