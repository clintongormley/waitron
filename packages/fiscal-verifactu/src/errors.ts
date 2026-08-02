// A bare side-effect import, not a value used anywhere in this file. It is what makes TypeScript
// treat "@waitron/shared" as a real module to augment rather than defining a fresh ambient module
// of the same name — the same idiom packages/db/src/errors.ts and packages/fiscal/src/errors.ts
// already use for their own contributions.
import "@waitron/shared";

/**
 * packages/fiscal-verifactu's own contribution to the shared error registry, added by declaration
 * merging rather than pre-declared in packages/shared itself — see the design note atop
 * packages/shared/src/errors.ts. packages/shared is the leaf every package depends on and must
 * never need to change just because a dependent package adds a code; this file is how
 * packages/fiscal-verifactu adds its own without packages/shared knowing about it in advance.
 *
 * **Deviation from Task 13's brief.** The brief's Step 3 said to append `SIF_NOT_REGISTERED`
 * (SCREAMING_SNAKE_CASE) directly to packages/shared/src/errors.ts's `ErrorCode` union. Both parts
 * of that instruction are wrong under this repo's OWN documented conventions and were overridden
 * per the task's own governing context, not invented here:
 *
 *   - packages/shared/src/errors.ts's design note is explicit that only codes NATIVE to
 *     packages/shared itself (ids.ts, money.ts) belong in that file; every dependent package
 *     (packages/db, packages/fiscal, and now packages/fiscal-verifactu) contributes its own by
 *     `declare module "@waitron/shared"`, exactly as packages/db/src/errors.ts and
 *     packages/fiscal/src/errors.ts already do.
 *   - The naming convention is DOMAIN-CONCEPT, lowercase, dot-namespaced (`series.not_found`,
 *     `clock.degraded`, `fiscal.till_not_registered`) — never SCREAMING_SNAKE_CASE and never the
 *     name of the package whose source throws it.
 *
 * Namespace choice: `sif.*`, not `till.not_registered` and not a reuse of packages/fiscal's own
 * `fiscal.till_not_registered`. Those are DIFFERENT facts. `fiscal.till_not_registered`
 * (packages/fiscal/src/errors.ts) is the regime-neutral `FiscalBackend`'s own bookkeeping — no
 * `registerTill` call on record with the generic backend, whatever the regime. This code is about
 * a narrower and later fact: a till that IS known to some backend but has no *live* Veri*Factu SIF
 * identity — a NIF + IdSIF + NúmeroInstalación triple — registered against the upstream node. A
 * till can only reach `currentSif`/`esPrimerRegistro` after a generic `FiscalBackend.registerTill`
 * already succeeded, so collapsing the two into one code would erase which layer refused. `sif.*`
 * names the concept this package's own vocabulary already uses throughout (`registro_sif`,
 * `esPrimerRegistro`) and reads naturally as a translation key: "no SIF is registered [for this
 * till]".
 *
 * Reachability: this file is a side-effect import of ./registro-sif.ts (`import "./errors.js"`),
 * which is re-exported from ./index.ts, so this augmentation is transitively reachable from the
 * package's own public barrel. See ./errors.reachability.test.ts, which mirrors
 * packages/db/src/errors.reachability.test.ts and packages/fiscal/src/errors.reachability.test.ts's
 * identical mechanical check for the same property.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Thrown by `currentSif` for a till with no LIVE `registro_sif` row — never provisioned, or
     * provisioned once and then revoked by a re-registration that has not yet completed. The
     * concrete encoding of "a till cannot be provisioned offline" (spec's stated limitation): a
     * caller that reaches here gets a structured, translatable refusal rather than a locally
     * invented installation number. See ./registro-sif.ts. */
    "sif.not_registered": { tenantId: string; tillId: string };

    /**
     * Task 14's brief drafted this as `ErrorCode.FISCAL_CHAIN_APPEND_CONTENTION`, appended
     * directly to `packages/shared/src/errors.ts`'s `ErrorCode` — the same SCREAMING_SNAKE_CASE,
     * wrong-file, package-named form Task 13's brief drafted for `SIF_NOT_REGISTERED` and that this
     * file's own design note above already overrides. Overridden here for the identical reasons:
     * `packages/shared` holds only codes native to itself (see its design note), and the naming
     * convention is domain-concept, lowercase, dot-namespaced — never the throwing package's name.
     *
     * Namespace choice: `chain.*`, matching `packages/shared/src/errors.ts`'s own worked example
     * (`chain.verification_failed`, reserved there for Task 15's art. 7.i verification) and this
     * package's established vocabulary (`cadenas`, `secuencia`, `huella`). `append_contention`,
     * not `verification_failed` or a shared `chain.error` — a caller needs to distinguish "the
     * chain could not be extended right now" (retry the sale) from "a stored chain link does not
     * match its own huella" (a tamper/corruption alarm), and collapsing the two into one code
     * would erase which failure a translator or an on-call human is looking at.
     *
     * Thrown by `appendToChain` (./chain.ts) only after `MAX_APPEND_ATTEMPTS` savepoint retries
     * each lost the race on SQLSTATE 23505 — in practice, several tabs/processes racing to create
     * the very first `cadenas` row for a till that has never sold before (the one window
     * `lockChainHead`'s row lock cannot cover, because there is no row yet to lock). A bare
     * `throw new Error(...)` here would reach a till screen as untranslatable prose (Global
     * Constraint, spec §9) for exactly the failure a human most needs explained in their own
     * language.
     */
    "chain.append_contention": { tenantId: string; tillId: string; attempts: number };

    /**
     * Task 9's drainer (`./drain.ts`, `applyOutcome`). AEAT rejected this record outright
     * (`resolveEstadoEfectivo` returned `"rejected"`) — never constructed as a thrown `AppError`
     * (rejection is an ordinary, expected outcome the drainer resolves and moves on from, not a
     * control-flow exception), only built to hand its `.code`/`.params` to `@waitron/core`'s
     * `recordIncident`, exactly as `packages/core/src/errors.ts`'s `chain.verification_failed`
     * is used from `record-sale.ts`/`record-void.ts`. `fiscal.*`, not `verifactu.*` or
     * `envio.*`: this is a fact about the submission LIFECYCLE any regime backend shares (a
     * record it tried to file was refused), matching `fiscal.till_not_registered`'s own
     * regime-neutral `fiscal.*` prefix, even though only this package constructs it today.
     * `registroId` is included because `incidents` carries no FK back to `envios`/
     * `registros_facturacion` at all (`packages/db/src/schema/incidents.ts`) — without it, an
     * incident row could not be traced back to which submission produced it.
     */
    "fiscal.registro_rechazado": {
      registroId: string;
      codigo: number | null;
      mensaje: string | null;
    };

    /**
     * Task 9's drainer. AEAT accepted this record but flagged it (`resolveEstadoEfectivo`
     * returned `"accepted_with_errors"` — `EstadoRegistro="AceptadoConErrores"`, e.g. error 2004,
     * a future-dated `FechaExpedicionFactura`). A warning, not an error: the record is stored and
     * counts as accepted (`DrainResult.recordsAccepted`'s own doc comment), but a human should
     * still see why AEAT flagged it.
     */
    "fiscal.aceptado_con_errores": {
      registroId: string;
      codigo: number | null;
      mensaje: string | null;
    };

    /**
     * Task 10's drainer (`./drain.ts`, `handleDuplicate` — error 3000, Route A). AEAT's own copy
     * of this identity is itself `Anulada` (`resolveEstadoEfectivo` returned `duplicate_annulled`,
     * @waitron/verifactu's own doc comment on the "3000 inverts" rule). Whatever produced that
     * state, this record can never become a confirmed accept from our side under this identity —
     * the invoice number is burned, and retrying changes nothing — so it halts visibly (and halts
     * this chain's successors, exactly like `fiscal.registro_rechazado` above, for the identical
     * reason: neither outcome ends with THIS record confirmed at AEAT, so a successor's
     * `RegistroAnterior` pointer at its huella is not something AEAT has actually confirmed
     * either). No `codigo`/`mensaje` params, unlike `fiscal.registro_rechazado`/
     * `fiscal.aceptado_con_errores` above: error 3000 IS the code carried on the outer
     * `RespuestaLinea` for every duplicate case, so a separate `codigo` param here would only ever
     * repeat the constant `3000` and tell a translator nothing
     * `RegistroDuplicado.EstadoRegistroDuplicado`'s own value (`Anulada`) doesn't already say more
     * precisely.
     */
    "fiscal.duplicado_anulado": { registroId: string };

    /**
     * Task 10's drainer (`./drain.ts`, `handleDuplicate`/`routeB` — error 3000, Route B). AEAT
     * reported a duplicate without saying what it holds (`resolveEstadoEfectivo` returned
     * `duplicate_unknown`); a targeted consulta (`routeB`) compared AEAT's own stored `Huella`
     * against ours and they DIFFERED — a genuine identity collision (the same NIF+series+fecha
     * triple, but not our own record), not a harmless resubmission of a record AEAT already
     * holds. Halts visibly, and halts this chain's successors, for the same reason
     * `fiscal.duplicado_anulado` above does: this record never lands as a confirmed accept under
     * this identity either. No `codigo`/`mensaje` params, for the identical reason given there —
     * error 3000 already IS the code, and the fact that this is the DIFFERING-huella branch (as
     * opposed to `fiscal.duplicado_anulado`'s `Anulada` branch) is exactly what the code name
     * itself already says.
     */
    "fiscal.huella_divergente": { registroId: string };

    /**
     * Plan 3b's reconciliation sweep (`./reconcile.ts`, `raise`). A record this POS believes AEAT
     * ACCEPTED (`envios.estado` = `aceptado`/`aceptado_con_errores`) that AEAT's own period
     * consulta has NO trace of at all (`EstadoRegistroConsulta` came back `null` — the record is
     * absent from every page of the sweep). An error, not a warning: an accepted-but-untraceable
     * record is a genuine divergence between what we told an operator was filed and what the
     * authority holds, exactly the art. 16.4 gap reconciliation exists to surface.
     *
     * Constructed, never thrown: like `fiscal.registro_rechazado` above, reconciliation classifies
     * a disagreement and moves on rather than aborting the sweep — the `AppError` exists only to
     * hand its `.code`/`.params` to `@waitron/core`'s `recordIncident`. `fiscal.*`, not
     * `verifactu.*`/`reconcile.*`: this is a submission-lifecycle fact any regime backend shares (a
     * record we reported as filed is not at the authority), matching `fiscal.registro_rechazado`'s
     * own regime-neutral prefix even though only this package constructs it today.
     *
     * The `IDFactura` triple (`idEmisorFactura`/`numSerieFactura`/`fechaExpedicionFactura`, the last
     * in AEAT's own `DD-MM-YYYY` form) rides HERE, in the incident params, rather than on the
     * `ReconcileMismatch` the sweep returns (`@waitron/fiscal`'s `ReconcileMismatch` is a
     * regime-neutral `{ recordId, localState, reportedState }` and carries no Veri*Factu identity):
     * an operator chasing this incident needs the exact invoice identity to look the record up at
     * AEAT, and `incidents` carries no FK back to `registros_facturacion` (see
     * `fiscal.registro_rechazado` above) to recover it from otherwise. `registroId` is our own
     * `registros_facturacion.id` — the same value the sweep sent as `RefExterna` and keyed AEAT's
     * view by, so it also equals the `ReconcileMismatch.recordId` this incident corresponds to.
     */
    "fiscal.reconcile_no_trace": {
      registroId: string;
      idEmisorFactura: string;
      numSerieFactura: string;
      fechaExpedicionFactura: string;
    };

    /**
     * Plan 3b's reconciliation sweep. A record this POS believes ACCEPTED that AEAT's consulta
     * reports as `AceptadaConErrores` — accepted, but flagged. A WARNING, not an error, mirroring
     * the drainer's own `fiscal.aceptado_con_errores` (above) treatment of the same AEAT state on
     * the submission side: the record IS stored and counts as accepted, but a human should still
     * see that the authority flagged it and ours did not record why.
     *
     * A DISTINCT code from `fiscal.reconcile_drift_anulada` below rather than one shared
     * `fiscal.reconcile_drift` carrying the reported state as a param: an `AceptadaConErrores` drift
     * (warning — still filed) and an `Anulada` drift (error — the authority annulled a record we
     * think is live) need different severities and different operator responses, and collapsing
     * them would erase which one an on-call human is looking at — the same "distinguish the failure
     * a translator/human sees" reasoning `chain.append_contention` and `fiscal.duplicado_anulado`
     * above already apply. See `fiscal.reconcile_no_trace` above for why the `IDFactura` triple
     * rides in these params.
     */
    "fiscal.reconcile_drift_errores": {
      registroId: string;
      idEmisorFactura: string;
      numSerieFactura: string;
      fechaExpedicionFactura: string;
    };

    /**
     * Plan 3b's reconciliation sweep. A record this POS believes ACCEPTED that AEAT's consulta
     * reports as `Anulada` — the authority holds our identity as annulled while our own books still
     * count it live. An error, not a warning (unlike `fiscal.reconcile_drift_errores` above): a
     * record we believe filed being annulled at AEAT is a real books-vs-authority contradiction an
     * operator must resolve, not a benign flag. Same distinct-code and identity-param reasoning as
     * `fiscal.reconcile_drift_errores` above.
     */
    "fiscal.reconcile_drift_anulada": {
      registroId: string;
      idEmisorFactura: string;
      numSerieFactura: string;
      fechaExpedicionFactura: string;
    };

    /**
     * The deployment-environment plan's Task 6: `./drain.ts`'s `claimBatch`. A registro whose OWN
     * `entorno` (stamped at generation time by `VerifactuBackendOptions.deploymentEnvironment`,
     * `./registro-row.ts`'s `RegistroRowContext.entorno`) disagrees with the DRAINING host's own
     * `DrainDeps.environment`. Constructed, never thrown, exactly like `fiscal.registro_rechazado`
     * above — the drainer classifies the row and moves on rather than aborting the whole batch.
     *
     * Never retried with backoff: unlike a transient AEAT failure, a mismatch is a configuration
     * fact that resubmitting cannot fix, so `claimBatch` leaves the row `pendiente` with no
     * `proximo_intento_en` change at all, rather than scheduling `backoffMs`'s exponential wait —
     * correcting `WAITRON_ENV` and restarting is what must release it. Submitting a
     * pre-production record to the real AEAT is unrecoverable (chains cannot be merged or
     * migrated, and invoice numbers are never reused), which is why this refuses rather than
     * assumes.
     *
     * `registroId`, not the brief's own draft `recordId` (M2/M3 of the Task 6 fix-round review):
     * `incidents` carries no FK back to `registros_facturacion` at all (see
     * `fiscal.registro_rechazado`'s own doc comment above), so this param is the ONLY traceback
     * from an incident row to the record it describes — matching this file's other seven codes
     * that carry one, all named `registroId`, not an eighth spelling of the same concept.
     */
    "fiscal.environment_mismatch": {
      registroId: string;
      recordEnvironment: string;
      hostEnvironment: string;
    };

    /**
     * The deployment-environment plan's Task 6: `./drain.ts`'s `claimBatch`. A registro written
     * before the `entorno` column existed (migration 0009) — nothing recorded which deployment it
     * was destined for. A DISTINCT code from `fiscal.environment_mismatch` above, not a shared one
     * defaulting the missing value to "assume production": guessing which deployment an
     * un-stamped row belongs to is exactly what this whole guard exists to avoid, and collapsing
     * the two would erase, for the human resolving the incident, whether AEAT ever saw a
     * disagreeing value or none at all. `registroId`, not `recordId` — same M2/M3 rename and same
     * reasoning as `fiscal.environment_mismatch` above.
     */
    "fiscal.environment_unknown": { registroId: string; hostEnvironment: string };

    /**
     * Thrown by `VerifactuBackend.recordCorrection` (./backend.ts) when the sale it was asked to
     * correct is a `TipoFactura` this version cannot issue a rectificativa for. v1 corrects only a
     * simplified invoice (`F2 → R5`, findings §10.2), the only type the till issues today
     * (`backend.ts`: `counterparty === null ? "F2" : "F1"`, and `packages/core` always passes
     * `counterparty: null`), so an `F1`/`R*`/other original is unreachable through the real write
     * path now and becomes reachable only once B2B `F1` issuance lands — at which point rectifying
     * it is an `R1`, not the `R5` this method assembles. A structured, translatable refusal rather
     * than a silently mis-typed rectificativa: filing an `R5` against an `F1` is unrepairable (§5),
     * so this asserts rather than assumes.
     *
     * `fiscal.*`, matching this file's own regime-neutral-shaped codes (`fiscal.registro_rechazado`,
     * `fiscal.environment_mismatch`, …): a fact about the record being corrected, even though
     * `F2`/`R5` are Veri*Factu vocabulary (this package is exempt from the english-only guard).
     * `recordCorrection` throws it beside `@waitron/fiscal`'s own `fiscal.sale_not_recorded` (the
     * absent-original case), so both share the `saleId` param naming the sale being corrected — the
     * same `correctsSaleId` the caller passed. `tipoFactura` carries the original's own type so the
     * human resolving it sees WHICH invoice type was refused, not merely that one was.
     */
    "fiscal.correction_unsupported": { saleId: string; tipoFactura: string };

    /**
     * Thrown by `VerifactuBackend.recordSubstitution` (./backend.ts) when a sale it was asked to
     * substitute with an F3 canje is a `TipoFactura` this operation cannot exchange. A factura de
     * canje (F3) substitutes SIMPLIFIED tickets only (`F2 → F3`, findings §10.2) — the one type the
     * till issues today (`backend.ts`: `counterparty === null ? "F2" : "F1"`, and `packages/core`
     * always passes `counterparty: null`), so a non-`F2` original is unreachable through the real
     * write path now and becomes reachable only once B2B `F1` issuance lands. Substituting an `F1`
     * (or an `R*`) is not a canje at all, and filing the wrong record is unrepairable (§5), so this
     * asserts rather than silently mis-filing — the direct sibling of `fiscal.correction_unsupported`
     * above, which makes the identical F2-only assertion on the rectificativa path.
     *
     * `fiscal.*`, matching this file's own regime-neutral-shaped codes: a fact about the sale being
     * substituted, even though `F2`/`F3` are Veri*Factu vocabulary (this package is exempt from the
     * english-only guard). `recordSubstitution` throws it beside `@waitron/fiscal`'s own
     * `fiscal.sale_not_recorded` (the absent-original case), so both share a `saleId` param naming the
     * substituted sale — one of the `substitutedSaleIds` the caller passed. `tipoFactura` carries the
     * original's own type so the human resolving it sees WHICH invoice type was refused, not merely
     * that one was.
     */
    "fiscal.substitution_unsupported": { saleId: string; tipoFactura: string };
  }
}
