import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Workforce's tables, classified for native replication (swap spec §2.1). The working-time record
 * and its hash chain are history keyed by the writing node (per-node rekey, #268), so they drain
 * back from a returned box; everything else is manager-configured scheduling that a standby holds
 * but never sends back. Completeness against workforce's migrations is guarded by
 * `classification.test.ts`.
 *
 * `time_entries` is `appendOnly` and `workforce_chains` is not: the chain table holds the HEAD row
 * that each new entry moves (`chain.ts:222`), so a refusal on it would stop every clock-in. That
 * split is the one PostgreSQL's `reject_mutation()` triggers made in this set.
 */
export const WORKFORCE_CLASSIFICATION: readonly ClassifiedTable[] = [
  // ledger (2) — clock-in history and its per-node hash chain; drained back. Only the first
  // refuses an update and a delete; see the note above.
  appendOnly("time_entries", "ledger", LEDGER),
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
