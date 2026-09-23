import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";

/**
 * Fiscal-Verifactu's tables, classified for native replication (swap spec §2.1). The six chain
 * tables are the fiscal record and its per-node SIF chain (server-as-SIF, keyed by the submitting
 * node), ledger that drains back from a returned box.
 *
 * **Only `registros_facturacion` is `appendOnly`, and the other five are not** — being `ledger`
 * does not make a table immutable. `cadenas` holds the chain HEAD, which every new record moves
 * (`chain.ts:224`); `registro_sif` carries the SIF's own mutable row (`registro-sif.ts:223`); and
 * `envios`/`envio_flujo`/`acks` are the submission outbox, whose rows record a delivery attempt's
 * progress. `registros_facturacion` is the one CLAUDE.md §5 calls unrepairable, and it is the one
 * PostgreSQL's `reject_mutation()` triggers protected in this set.
 *
 * `contadores_instalacion` is the opposite case: it is the shared per-NIF installation counter, so
 * it is `state` a standby copies but must NEVER drain back — draining a stale counter would re-mint an
 * installation number and fork the chain (§5). Completeness against this module's migrations is
 * guarded by `classification.test.ts`.
 */
export const FISCAL_CLASSIFICATION: readonly ClassifiedTable[] = [
  // ledger (6) — the fiscal record and per-node SIF chain; drained back from a returned box.
  // Only the first refuses an update and a delete; see the note above.
  appendOnly("registros_facturacion", "ledger", LEDGER),
  classify("cadenas", "ledger", LEDGER),
  classify("registro_sif", "ledger", LEDGER),
  classify("envios", "ledger", LEDGER),
  classify("envio_flujo", "ledger", LEDGER),
  classify("acks", "ledger", LEDGER),

  // state (1) — the shared per-NIF installation counter; copied to a standby, NEVER drained back
  // (a stale counter drained back would re-mint an installation number and fork the chain, §5).
  classify(
    "contadores_instalacion",
    "state",
    "shared per-NIF installation counter; copied to a standby, never drained back (a stale counter would re-mint an installation number and fork the chain)",
  ),
];
