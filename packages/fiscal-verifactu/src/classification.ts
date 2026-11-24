import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node";

export const FISCAL_CLASSIFICATION: readonly ClassifiedTable[] = [
  appendOnly("verifactu_records", "ledger", LEDGER),
  appendOnly(
    "returned_invoice_records",
    "ledger",
    "first receipt of an original returned from another box, retained with that original",
  ),
  appendOnly("verifactu_series_conflicts", "ledger", LEDGER),
  appendOnly("verifactu_history", "ledger", LEDGER),
  appendOnly(
    "declaraciones_responsables",
    "state",
    "the declaraciones responsables this venue has run; one row per release version, the same on every box",
  ),
  classify("verifactu_identities", "ledger", LEDGER),
  classify("verifactu_submissions", "ledger", LEDGER),
  classify("verifactu_sending_state", "ledger", LEDGER),
  appendOnly(
    "verifactu_certificates",
    "local",
    "the certificates installed on a node, keyed by its node id; read by that node and every node that took over from it (`readHistoryNodes`)",
  ),
];
