import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * `time_entries` is `appendOnly` and `workforce_chains` is not: the chain table holds the head row
 * that every append updates (`appendToChain`, chain.ts), so a refusal on it would stop every clock-in.
 */
export const WORKFORCE_CLASSIFICATION: readonly ClassifiedTable[] = [
  appendOnly("time_entries", "ledger", LEDGER),
  classify(
    "workforce_chains",
    "ledger",
    "per-node working-time hash chain; drained back from a returned box",
  ),

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
