import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";

/**
 * **Only `registros_facturacion` is `appendOnly`, and the other five `ledger` tables are not** —
 * being `ledger` does not make a table immutable. `cadenas` holds the chain HEAD, which every new
 * record moves (./chain.ts); `registro_sif` carries the SIF's own mutable row (./registro-sif.ts);
 * and `envios`/`envio_flujo`/`acks` are the submission outbox, whose rows record a delivery
 * attempt's progress. `registros_facturacion` is the one CLAUDE.md §5 calls unrepairable.
 *
 * `contadores_instalacion` is the shared per-NIF installation counter: `state` a standby copies
 * but must NEVER drain back, because draining a stale counter would re-mint an installation number
 * and fork the chain (§5).
 */
export const FISCAL_CLASSIFICATION: readonly ClassifiedTable[] = [
  // Only the first refuses an update and a delete; see the note above.
  appendOnly("registros_facturacion", "ledger", LEDGER),
  classify("cadenas", "ledger", LEDGER),
  classify("registro_sif", "ledger", LEDGER),
  classify("envios", "ledger", LEDGER),
  classify("envio_flujo", "ledger", LEDGER),
  classify("acks", "ledger", LEDGER),

  classify(
    "contadores_instalacion",
    "state",
    "shared per-NIF installation counter; copied to a standby, never drained back (a stale counter would re-mint an installation number and fork the chain)",
  ),
];
