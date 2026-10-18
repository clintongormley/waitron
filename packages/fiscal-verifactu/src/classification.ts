import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";

export const FISCAL_CLASSIFICATION: readonly ClassifiedTable[] = [
  appendOnly("registros_facturacion", "ledger", LEDGER),
  appendOnly("filing_cases", "ledger", LEDGER),
  appendOnly("filing_case_events", "ledger", LEDGER),
  appendOnly("fiscal_allocations", "ledger", LEDGER),
  appendOnly("fiscal_reservations", "ledger", LEDGER),
  classify("cadenas", "ledger", LEDGER),
  classify("registro_sif", "ledger", LEDGER),
  classify("envios", "ledger", LEDGER),
  classify("envio_flujo", "ledger", LEDGER),
  classify("acks", "ledger", LEDGER),
  appendOnly(
    "fiscal_certificate_installs",
    "local",
    "the certificates installed on one node, keyed by its node id; the certificate is sealed under that node's key",
  ),
  classify(
    "fiscal_certificate_reminders",
    "local",
    "the expiry emails one node sent about its own certificate, keyed by its node id",
  ),
];
