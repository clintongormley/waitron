import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * `payments` is `ledger` but not `appendOnly`: `store.ts` updates a payment's row as it moves
 * through its states, so a trigger refusing updates would refuse a card capture.
 */
export const PAYMENTS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("payments", "ledger", LEDGER),
  classify("payment_refunds", "ledger", LEDGER),
  appendOnly("payment_resolutions", "ledger", LEDGER),

  classify("payment_policy", "state", STATE),
  classify("card_readers", "state", STATE),
  classify("device_card_readers", "state", STATE),
];

export const PAYMENTS_CHANGE_SOURCES: readonly ChangeSource[] = PAYMENTS_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);
