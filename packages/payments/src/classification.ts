import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Payments' tables, classified for native replication (swap spec §2.1). A captured payment and a
 * refund are append-only money movements keyed by the writing node, so they drain back from a
 * returned box; the payment policy is manager configuration a standby holds but never sends back.
 * Completeness against payments' migrations is guarded by `classification.test.ts`.
 */
export const PAYMENTS_CLASSIFICATION: readonly ClassifiedTable[] = [
  // ledger (2) — append-only money movements; drained back from a returned box.
  classify("payments", "ledger", LEDGER),
  classify("payment_refunds", "ledger", LEDGER),

  // state (1) — manager-configured payment policy; copied to a standby, never drained back.
  classify("payment_policy", "state", STATE),
];
