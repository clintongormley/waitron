import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Workforce's tables, classified for native replication (swap spec §2.1). The working-time record
 * and its hash chain are append-only history keyed by the writing node (per-node rekey, #268), so
 * they drain back from a returned box; everything else is manager-configured scheduling that a
 * standby holds but never sends back. Completeness against workforce's migrations is guarded by
 * `classification.test.ts`.
 */
export const WORKFORCE_CLASSIFICATION: readonly ClassifiedTable[] = [
  // ledger (2) — append-only clock-in history and its per-node hash chain; drained back.
  classify("time_entries", "ledger", LEDGER),
  classify(
    "workforce_chains",
    "ledger",
    "per-node working-time hash chain; drained back from a returned box",
  ),

  // state (7) — scheduling configuration and rosters; copied to a standby, never drained back.
  classify("employments", "state", STATE),
  classify("shifts", "state", STATE),
  classify("shift_templates", "state", STATE),
  classify("shift_swaps", "state", STATE),
  classify("absences", "state", STATE),
  classify("availability", "state", STATE),
  classify("roster_versions", "state", STATE),
];

export const WORKFORCE_CHANGE_SOURCES: readonly ChangeSource[] = WORKFORCE_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
