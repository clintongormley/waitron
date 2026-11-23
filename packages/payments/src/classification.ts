import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const LEDGER = "what happened, keyed by the writing node";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * `payments` is `ledger` but not `appendOnly`: `store.ts` updates a payment's row as it moves
 * through its states, so a trigger refusing updates would refuse a card capture.
 */
export const PAYMENTS_OWN_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("payments", "ledger", LEDGER),
  appendOnly("payment_refunds", "ledger", LEDGER),

  classify("card_readers", "state", STATE),
];

/** Every table in payments' set: payments' own and the reconciliation schedule's. */
export const PAYMENTS_CLASSIFICATION: readonly ClassifiedTable[] = [
  ...PAYMENTS_OWN_CLASSIFICATION,
  classify(
    "reconciliation_runs",
    "state",
    "the venue's record of which duty ran for which period; a node that takes over continues it",
  ),
];

export const PAYMENTS_CHANGE_SOURCES: readonly ChangeSource[] = PAYMENTS_OWN_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
