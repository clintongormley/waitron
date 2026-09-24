// Side-effect import: makes TypeScript augment the real "@waitron/shared" module rather than
// declare a fresh ambient module of the same name.
import "@waitron/shared";

/** This package's codes, added to the shared registry by declaration merging (see the design note
 * atop packages/shared/src/errors.ts). */
declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * Thrown by ./aeat-transport.ts when a decrypted `fiscal.aeat` payload's `certKind`,
     * `pfxBase64` or `passphrase` is absent or unusable. `apps/server/src/errors.ts` declares it
     * too. Codes are never renamed once shipped, so the `server.*` string stands. The two
     * declarations carry identical params so TypeScript's declaration merging accepts both when
     * `apps/server` compiles them together.
     */
    "server.credential_unusable": { purpose: string; field: string };

    /**
     * Thrown by ./provisioning-secret.ts for a malformed AEAT-cert blob, and by ./venue-fields.ts
     * for operator-typed fiscal text that would build a record AEAT cannot accept. Names the
     * offending field, never its value. Declared with identical params in
     * `apps/server/src/errors.ts`, like `server.credential_unusable` above.
     */
    "setup.request_invalid": { field: string };

    /**
     * A restore or standby reservation rejects a base over `MAX_BASE_CODE_LENGTH`, leaving room
     * within the 60-character `NumSerieFactura` cap for `-<installation number>/<counter>` with
     * ten digits each.
     */
    "series.code_too_long": { code: string };

    /** Thrown by `currentSif` for a node with no LIVE `registro_sif` row — never provisioned, or
     * provisioned once and then revoked by a re-registration that has not yet completed. A node
     * cannot be provisioned offline, so the caller gets a translatable refusal rather than a
     * locally invented installation number. See ./registro-sif.ts. */
    "sif.not_registered": { nodeId: string };

    /** `IdSistemaInformatico` is empty or longer than AEAT's two-character cap. Thrown by
     * `assertUsableIdSistema` (./registro-sif.ts, which says where the bound is applied). */
    "sif.id_sistema_invalid": { value: string; maxLength: number };

    /** A standby's reserved SIF state arrived from the primary malformed (the mirror bundle is wire
     * input). Checked before `writeReservedSif`, so a bad `idSistemaInformatico` in a bundle
     * reports this code rather than `sif.id_sistema_invalid`. `reason` is our own English
     * description, never the payload. */
    "sif.reservation_invalid": { reason: string };

    /**
     * Thrown by `appendToChain` (./chain.ts) once `MAX_APPEND_ATTEMPTS` attempts have each lost a
     * unique-key race. Distinct from `chain.verification_failed`: "the chain could not be extended
     * right now" (retry the sale) is not "a stored link does not match its own huella" (a tamper
     * or corruption alarm).
     */
    "chain.append_contention": { nodeId: string; attempts: number };

    /**
     * `attemptAppend` (./chain.ts) refused a record that `@waitron/verifactu`'s `validate` reports
     * as one AEAT could not accept. Raised BEFORE the insert, so nothing is written and the chain
     * head does not move: `registros_facturacion` is append-only and hash-chained, so refusing a
     * record is the only remedy that leaves the venue repairable.
     *
     * Params carry the offending FIELD NAMES and the validator's ISSUE CODES — never the offending
     * values. The shared error boundary writes params into `waitron.log`, which the
     * unauthenticated recovery page renders to anyone on the venue's LAN
     * (`apps/server/src/recovery-surface.ts`), so an operator's data must never travel here.
     */
    "fiscal.record_invalid": { fields: string[]; codes: string[] };

    /**
     * `attemptAppend` (./chain.ts) wrote a record whose stated totals disagree with its own VAT
     * breakdown. NEVER thrown — AEAT accepts such a record, so refusing the sale would block a
     * record the authority would have taken; built only to hand its `.code`/`.params` to
     * `recordIncident`. Params never carry the amounts (see `fiscal.record_invalid`).
     */
    "fiscal.record_totals_disagree": { fields: string[]; codes: string[] };

    /**
     * `./drain.ts`'s `applyOutcome`: AEAT rejected this record outright. Constructed, never thrown —
     * only built to hand its `.code`/`.params` to `recordIncident`. `registroId` is there because
     * `incidents` has no foreign key back to `registros_facturacion`; it is the only traceback from
     * an incident row to its record, and every code below that carries one uses the same name.
     */
    "fiscal.registro_rechazado": {
      registroId: string;
      codigo: number | null;
      mensaje: string | null;
    };

    /**
     * `./drain.ts`: AEAT accepted this record but flagged it (`EstadoRegistro="AceptadoConErrores"`).
     * A warning: the record counts as accepted, but a human should still see why AEAT flagged it.
     */
    "fiscal.aceptado_con_errores": {
      registroId: string;
      codigo: number | null;
      mensaje: string | null;
    };

    /**
     * `./drain.ts`'s `handleDuplicate` (error 3000): AEAT's own copy of this identity is `Anulada`,
     * so the invoice number is burned and this record can never become a confirmed accept. Halts
     * the record and its chain's successors. No `codigo`/`mensaje` params: they would only ever
     * repeat 3000.
     */
    "fiscal.duplicado_anulado": { registroId: string };

    /**
     * `./drain.ts`'s `routeB` (error 3000): AEAT's stored `Huella` for this identity differs from
     * ours — a genuine identity collision, not a resubmission of our own record. Halts like
     * `fiscal.duplicado_anulado` above, and carries no `codigo`/`mensaje` for the same reason.
     */
    "fiscal.huella_divergente": { registroId: string };

    /**
     * `./reconcile.ts`: a record we believe AEAT accepted that AEAT's period consulta has no trace
     * of. Constructed, never thrown.
     *
     * The `IDFactura` triple (`fechaExpedicionFactura` in AEAT's `DD-MM-YYYY` form) rides in these
     * params because the regime-neutral `ReconcileMismatch` carries no Veri*Factu identity, and an
     * operator needs the exact invoice identity to look the record up at AEAT.
     */
    "fiscal.reconcile_no_trace": {
      registroId: string;
      idEmisorFactura: string;
      numSerieFactura: string;
      fechaExpedicionFactura: string;
    };

    /**
     * `./reconcile.ts`: a record we believe accepted that AEAT reports as `AceptadaConErrores`. A
     * WARNING, and a separate code from `fiscal.reconcile_drift_anulada` rather than one code with
     * the state as a param, because the two need different severities and operator responses.
     */
    "fiscal.reconcile_drift_errores": {
      registroId: string;
      idEmisorFactura: string;
      numSerieFactura: string;
      fechaExpedicionFactura: string;
    };

    /**
     * `./reconcile.ts`: a record we believe accepted that AEAT reports as `Anulada` — the authority
     * holds as annulled a record our books count live. An error an operator must resolve.
     */
    "fiscal.reconcile_drift_anulada": {
      registroId: string;
      idEmisorFactura: string;
      numSerieFactura: string;
      fechaExpedicionFactura: string;
    };

    /**
     * `./drain.ts`'s `claimBatch`: a registro's own stamped `entorno` disagrees with the draining
     * host's `DrainDeps.environment`. Constructed, never thrown. Never retried with backoff —
     * resubmitting cannot fix a configuration fact, and submitting a pre-production record to the
     * real AEAT is unrecoverable, so the row stays `pendiente` until `WAITRON_ENV` is corrected.
     */
    "fiscal.environment_mismatch": {
      registroId: string;
      recordEnvironment: string;
      hostEnvironment: string;
    };

    /**
     * `./drain.ts`'s `claimBatch`: a registro with no `entorno` at all. A separate code rather than
     * defaulting to "assume production": guessing which deployment an unstamped row belongs to is
     * what this guard exists to avoid.
     */
    "fiscal.environment_unknown": { registroId: string; hostEnvironment: string };

    /**
     * Thrown by `VerifactuBackend.recordCorrection` (./backend.ts) when the sale being corrected is
     * not an `F2`. Only `F2 → R5` is supported; rectifying an `F1` is an `R1`, and filing the wrong
     * rectificativa is unrepairable, so this refuses rather than mis-types it. `tipoFactura` is the
     * original's type.
     */
    "fiscal.correction_unsupported": { saleId: string; tipoFactura: string };

    /**
     * Thrown by `VerifactuBackend.recordSubstitution` (./backend.ts) when a substituted sale is not
     * an `F2`: a factura de canje (`F3`) substitutes simplified tickets only. The direct sibling of
     * `fiscal.correction_unsupported` above. `tipoFactura` is the original's type.
     */
    "fiscal.substitution_unsupported": { saleId: string; tipoFactura: string };

    /**
     * Thrown by `buildDestinatarios` (./backend.ts) for a recipient whose country is not `ES`: which
     * `IDOtro` `IDType` AEAT admits for a non-resident is open with the asesor
     * (`docs/compliance/asesor-questions.md`, Q17(a)), and a guessed one could never be unfiled. A
     * PERMANENT refusal — retrying files nothing new.
     *
     * `countryCode` is not operator data, so it may ride in params; the recipient's name and tax
     * identifier never do (see `fiscal.record_invalid`).
     */
    "fiscal.foreign_recipient_unsupported": { countryCode: string };

    /**
     * An ongoing-alert code from ./submission-alerts.ts, never thrown: `count` records are still
     * waiting to reach AEAT and `hours` is the oldest one's age.
     */
    "fiscal.submission_delayed": { count: number; hours: number };

    /**
     * The same ongoing check: `count` records have stopped submitting (`envios.estado = detenido`)
     * and need a human — a halted chain never drains itself. Never thrown.
     */
    "fiscal.submission_stopped": { count: number };

    /**
     * An ongoing-alert code raised by `apps/server/src/alert-sources.ts`, not by this package; it
     * lives here because it names the fiscal concept. No params: a plain on/off fact.
     */
    "fiscal.awaiting_certificate": Record<string, never>;
  }
}
