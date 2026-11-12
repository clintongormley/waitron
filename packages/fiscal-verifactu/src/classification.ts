import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";

export const FISCAL_CLASSIFICATION: readonly ClassifiedTable[] = [
  appendOnly("registros_facturacion", "ledger", LEDGER),
  appendOnly("returned_invoice_records", "ledger", LEDGER),
  appendOnly("filing_cases", "ledger", LEDGER),
  appendOnly("filing_case_events", "ledger", LEDGER),
  appendOnly("fiscal_conflict_evidence", "ledger", LEDGER),
  appendOnly("fiscal_lookup_conflicts", "ledger", LEDGER),
  appendOnly("fiscal_series_conflicts", "ledger", LEDGER),
  appendOnly("fiscal_allocations", "ledger", LEDGER),
  appendOnly("fiscal_reservations", "ledger", LEDGER),
  appendOnly("clock_stop_restarts", "ledger", LEDGER),
  appendOnly("clock_checks", "ledger", LEDGER),
  appendOnly("clock_confirmations", "ledger", LEDGER),
  appendOnly(
    "declaraciones_responsables",
    "state",
    "the declaraciones responsables this venue has run; one row per release version, the same on every box",
  ),
  classify("cadenas", "ledger", LEDGER),
  classify("registro_sif", "ledger", LEDGER),
  classify("envios", "ledger", LEDGER),
  classify("envio_flujo", "ledger", LEDGER),
  classify("acks", "ledger", LEDGER),
  appendOnly(
    "fiscal_certificate_installs",
    "local",
    "the certificates installed on a node, keyed by its node id; read by that node and every node that took over from it (`readHistoryNodes`)",
  ),
  classify(
    "fiscal_certificate_reminders",
    "local",
    "the expiry emails about a node's certificate, keyed by the node that first wrote the row; read and updated by that node and every node that took over from it (`readHistoryNodes`)",
  ),
];
