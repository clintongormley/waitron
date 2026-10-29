# A1089: refusals with a self-service next step

You should be able to resolve an operational refusal without paid Waitron support. Start with the
actual refusal and name an action you can perform. Do not replace a support instruction with a
retry, reset or restore that the affected screen cannot complete.

This is the **audit milestone**, read against `9c896b1aeb3455bd092c45a1be1e594df4e258d0`
on 2026-10-25. It changes no product behavior. The entries below record source inspection,
not reproduced incidents, exercised recovery procedures or an approval to implement fiscal changes.
No row establishes that a product bug is the only possible cause. No bug-only exception is granted.

## Owner correction, 2026-10-25

At 14:02 CET the owner clarified: “Never send the user to talk to somebody else. Explain the
situation, ask for an admin login (if appropriate) and let the user make the choice.”
The [house rule](../developers/conventions-ui.md#refusals-name-a-self-service-next-step) now
requires an explanation of each choice, any needed administrator or owner sign-in at that point,
and a safe Stop before destructive work. A referral to support, an administrator, an installer or
provider staff does not complete a remedy. Only a state established as bug-only at its site can
use the exception, and its message must identify a fault in Waitron.

This correction supersedes the remedy assessments below, including the four dated wording
milestones. Their historical words, source receipts and test scope remain recorded. Reading them
again under this rule establishes follow-up work, not that any recovery procedure now works.
No product behavior changes in this correction.

The referral recheck reads `46bd9213d`: `apps/dashboard/src/i18n/codes.ts:359` and `:1016`,
`apps/server/src/connection-bootstrap-strings.ts:16`, `:19` and `:30`,
`packages/fiscal-verifactu/src/dashboard/strings.ts:81` and `:83`,
`apps/server/src/recovery-surface.ts:211` and `:257`, and
`apps/dashboard/src/i18n/strings.ts:2506` and `:2526`. These are source receipts for the remaining
referrals, not completed recovery experiments.

| Area | Work still required under the clarified rule |
| --- | --- |
| [Sign-in](#sign-in), #2054 | Referral reworked: retry remains available and explicit/autofill refusal views explain password entry and emailed reset. Authenticated account-access recovery when no offered method works remains open below. |
| [Public connection](#tls-repair), #2055 | Referral reworked in #2064: read-only Check again and Stop, applicable HTTPS/device choices, pending actions and no-JavaScript guidance are covered in its dated addendum. Authenticated certificate replacement and linked-layout repair remain open. |
| [Certificate](#certificate), #2056 | Referral reworked: file/type changes, another check with Save and Cancel are explained. Persistent connection/configuration diagnosis and its repair choice remain open below. |
| [Backup key](#backup-key), #2058 | Referral reworked: retain both key records and stop changing keys; the page states its diagnostic limit. Authenticated inspection and correction of effective configuration remain open below. |
| [Setup state](#setup-state) | Offer resume/recovery choices and required authentication. A1042's S7l change is in; the `attempt_invalid` words still name no next step. |
| [Setup environment](#setup-environment) | Establish a fresh-start/reinstall choice applicable to this state, with a safe Stop before data loss. Do not improvise a reset of trading data. |
| [Incomplete join](#setup-reset) | Give the person an authenticated retry/restart choice and its outcome if the half-join remains. |
| [Setup readiness](#setup-readiness) | Explain the missing capability or refused source and offer an applicable source/image/recovery choice. Replace administrator referrals in repeated status failures too. |
| [Archive settings](#backup-settings) | Referral reworked: Backups shows the load error, accepts replacement choices, retains a field refusal and permits leaving without applying. The **What the box recorded** panel shows what the box recorded; repair (key numbers, an old credentials key, rewriting the record) remains open. |
| [Bucket stream](#backup-stream) | Settings refusal explains editing, testing, applying and cancelling below. Host-configuration diagnosis, restart and ownership choices remain open, with authentication and evidence before resuming a primary. |
| [Sealed state](#backup-state) | Expose the safe cause and a correction/retry choice; show whether the key copy was refreshed. |
| [Backup preparation](#backup-preparation) | Offer safe disk/file recovery choices. A request to ask the installer to free space is still a gap. |
| [Restored first start](#restore-start) | Preserve the completion refusal and offer a specific correction when restart fails again. |
| [Fiscal integrity](#fiscal-integrity) | Offer evidence inspection and a supported decision/recovery path without editing immutable records. An administrator referral does not provide that path. |
| [Filing cases](#fiscal-cases) | Build the released filing-case decision path; waiting or finding another person does not resolve a held case. |
| [Fiscal reply](#fiscal-reply) | Describe only exercised retry behavior, then offer evidence inspection and a decision for a persistent malformed reply. |
| [Fiscal environment](#fiscal-environment) | Offer safe host-configuration or evidence/recovery choices; never relabel records or promote test data. |
| [Reconciliation](#fiscal-reconcile) | Establish the caller, then offer evidence and a decision path rather than sending the person to an administrator or adviser. |
| [Payments](#payments) | Preserve confirmed-outcome requirements. Give a way to inspect provider evidence and resolve the held payment without depending on a conversation with provider staff. |
| [Boot recovery](#boot-recovery) | Recheck the recovery page's installer referrals and expose applicable restart, space, backup or reinstall choices. The earlier observation that its instructions were distinct does not qualify them as self-service. |

Take the four reworks in the order above, one small PR per area. Test the refusal and the available
way out before calling it complete. Build a missing small action; record each substantial missing
workflow separately in the backlog and the message's PR. The in-place sign-in requirement does
not authorise public account-enrolment checks, destructive unauthenticated repair, a new charge
for an uncertain payment, or work on a protected fiscal writer.

## Search and limits

The read-only inventory parsed non-test TypeScript under `apps/` and `packages/`, including
module-owned dashboard translations, and searched the guides and server-rendered pages separately.
It found 28 paired EN/ES support instructions, including three `backup_stop` substitutions.
The broad retry scan also includes buttons and ordinary network failures; those matches are not
all defects. The persistent-state findings and temporary-wait controls are distinguished below.

Repeat the literal searches with:

```sh
rg -n -i 'contact.{0,40}(support|soporte)|asistencia técnica|helpdesk' apps packages --glob '!*.test.*'
rg -n -i 'wait a|try again|try .* again|retry|espera|intént|reintént' apps/setup/src/i18n apps/dashboard/src/i18n apps/till/src/i18n apps/server/src/guide
rg -n 'setup.not_ready|setup.attempt_invalid|setup.operation_conflict|backup.effective_mismatch|passkey.verification_failed' apps/server/src packages --glob '!*.test.*'
```

The source paths and line numbers below refer to that dated tree. Follow each message through its
screen mapping and producer again before changing it. Search error registries as well as wording:
`packages/provisioning/src/errors.ts`, `packages/identity/src/errors.ts`,
`packages/fiscal-verifactu/src/errors.ts` and `apps/server/src/errors.ts` declare the codes used here.
They declare shapes, not the conditions that make a retry useful.

Waitron Cloud's product is excluded (D254); Waitron's local Cloud client is in scope.

## Support instructions

Each entry records the current words, the state behind them and the existing or missing route.
The fix group links identify independently reviewable follow-ups, not new campaign queue items.
For the payment alert, `${MORE_EN}` / `${MORE_ES}` denotes the existing suffix saying later checks
do not add to an open alert; it is part of the displayed wording.

### `backup.archive_settings_unusable`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-settings](#backup-settings).

| Language | Current words |
| --- | --- |
| EN | Scheduled backups are off: this box could not use their saved settings. Sales continue. Save the backup settings again on the Backups page; if this message stays, contact support. |
| ES | Las copias de seguridad programadas están desactivadas: este equipo no ha podido usar sus ajustes guardados. Las ventas continúan. Vuelve a guardar los ajustes de copia en la página de Copias; si el mensaje sigue, contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:89` and `apps/dashboard/src/i18n/alert-messages.ts:90`.

State: Saved archive settings failed to load, including invalid or unreadable credentials. This is not established as bug-only. Receipt: `apps/server/src/backup-supervisor.ts:193`; `apps/server/src/alert-sources.ts:163`.

Route: Existing: save the settings again on Backups. Missing: a concrete next action if the settings cannot be read or saved again; retain the underlying refusal.

### `backup.stream_refused`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-stream](#backup-stream).

| Language | Current words |
| --- | --- |
| EN | The bucket copy has stopped because another box is writing this venue's copy to the same bucket. Two boxes must never sell for one venue. Contact support. |
| ES | La copia en el bucket se ha detenido porque otro equipo está escribiendo la copia de este local en el mismo bucket. Nunca deben vender dos equipos para un mismo local. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:101` and `apps/dashboard/src/i18n/alert-messages.ts:102`.

State: The stream reports pointer_changed or pointer_newer_term. A competing or replaced primary is a possible state; a product bug is not required. Receipt: `apps/server/src/alert-sources.ts:81`.

Route: Missing: a guided way to identify the serving primary and resolve the competing writer. Do not suggest resetting a bucket pointer or starting two sellers. The Backups screen alone does not establish which machine may resume.

### `backup.stream_settings_unusable`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-stream](#backup-stream).

| Language | Current words |
| --- | --- |
| EN | The bucket copy has not started because its settings cannot be used safely. Check the bucket settings on the Backups page, and contact support if they look right. |
| ES | La copia en el bucket no se ha iniciado porque sus ajustes no se pueden usar de forma segura. Revisa los ajustes del bucket en la página de Copias y, si parecen correctos, contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:105` and `apps/dashboard/src/i18n/alert-messages.ts:106`.

State: The stream refuses config_unsafe. Configuration can cause this; bug-only is not established. Receipt: `apps/server/src/alert-sources.ts:89`.

Route: Existing: edit and test bucket settings on Backups. Missing: identify the refused setting and give an administrator action when the editor cannot resolve it.

### `backup.stream_stopped`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-stream](#backup-stream).

| Language | Current words |
| --- | --- |
| EN | The bucket copy is not running, so new changes are not reaching your bucket. Sales continue. Contact support. |
| ES | La copia en el bucket no está en marcha, así que los cambios nuevos no llegan a tu bucket. Las ventas continúan. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:113` and `apps/dashboard/src/i18n/alert-messages.ts:114`.

State: The stream is absent, refused, or stopped for a reported reason such as litestream_unavailable or supervisor_failed. Bug-only is not established. Receipt: `apps/server/src/alert-sources.ts:57`; `apps/server/src/alert-sources.ts:73`.

Route: Existing: saving or removing stream settings calls reload. Missing: an explicit supported restart/retry action and reason-specific guidance; changing a healthy setting just to trigger a reload is not a documented recovery procedure. See apps/server/src/stream-api.ts:232 and :260.

### `backup.sealed_state_failed`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-state](#backup-state).

| Language | Current words |
| --- | --- |
| EN | The box could not update the locked copy of its own keys and settings that it keeps with your data. A box rebuilt from your bucket might come back with out-of-date keys and settings, or without them if none were ever saved. Sales continue. Contact support. |
| ES | El equipo no ha podido actualizar la copia cifrada de sus propias claves y ajustes que guarda junto con tus datos. Un equipo reconstruido desde tu bucket podría volver con claves y ajustes desactualizados, o sin ellos si nunca se llegaron a guardar. Las ventas continúan. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:117` and `apps/dashboard/src/i18n/alert-messages.ts:118`.

State: Reading the recovery key, collecting files, sealing, or writing the row threw. Missing files and storage failures are possible without a product bug. Receipt: `apps/server/src/sealed-state.ts:108`; `apps/server/src/alert-sources.ts:230`.

Route: Missing: expose a non-secret cause and an action to retry after fixing it. Do not claim the recovery copy is current until refresh succeeds.

### `restore.first_start_failed`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [restore-start](#restore-start).

| Language | Current words |
| --- | --- |
| EN | This box could not finish setting itself up after the restore. Sales continue, but it will not copy to a storage bucket until it does. Restart the box; if this message stays, contact support. |
| ES | Este equipo no ha podido terminar de configurarse después de la restauración. Las ventas continúan, pero no copiará a ningún bucket de almacenamiento hasta que lo consiga. Reinicia el equipo; si el mensaje sigue, contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:133` and `apps/dashboard/src/i18n/alert-messages.ts:134`.

State: The restored box failed its first-start completion. That completion reads restored membership, reissues a certificate and checks the bucket term; failure is not established as bug-only. Receipt: `apps/server/src/rebuild-first-start.ts:103`; `apps/server/src/alert-sources.ts:254`.

Route: Existing: restart attempts completion again. Missing: tell the administrator what to correct if restart repeats the failure, using the actual completion refusal rather than a support escalation.

### `chain.verification_failed`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-integrity](#fiscal-integrity).

| Language | Current words |
| --- | --- |
| EN | The invoice record chain failed its integrity check on a sale. Contact support. |
| ES | La cadena de registros de facturación no ha superado su comprobación de integridad en una venta. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:137` and `apps/dashboard/src/i18n/alert-messages.ts:138`.

State: A fiscal backend returned stored-chain integrity issues during issuance. This proves an integrity failure was detected, not that a product bug is the only cause. Receipt: `packages/core/src/record-sale.ts:205`; `packages/core/src/record-correction.ts:240`; `packages/core/src/record-void.ts:55`; `packages/core/src/record-substitution.ts:163`.

Route: Missing: preserve evidence and offer an administrator investigation/recovery route. Do not edit stored records, reset invoice numbers or promise a backup repairs the chain.

### `fiscal.registro_rechazado`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-cases](#fiscal-cases).

| Language | Current words |
| --- | --- |
| EN | The tax agency (AEAT) rejected an invoice record: {mensaje} (code {codigo}). Contact support. |
| ES | La AEAT ha rechazado un registro de facturación: {mensaje} (código {codigo}). Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:190` and `apps/dashboard/src/i18n/alert-messages.ts:191`.

State: An AEAT response rejects a record and opens a filing case. An external refusal is not proof of a Waitron bug. Receipt: `packages/fiscal-verifactu/src/drain.ts:1445`.

Route: Missing in the searched server routes: a filing-case decision screen/action. W41s-8 and W41s-9 remain queued; a library function or a planned screen is not a product recovery path.

### `fiscal.respuesta_descuadrada`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-reply](#fiscal-reply).

| Language | Current words |
| --- | --- |
| EN | The tax agency (AEAT) answered a submission with a different number of lines than the invoice records Waitron sent, so Waitron applied none of them and will send each again unless an earlier record on its chain is on hold. Contact support. |
| ES | La AEAT ha respondido a un envío con un número de líneas distinto del de registros de facturación que Waitron envió, así que Waitron no ha aplicado ninguna y volverá a enviar cada uno salvo que esté en espera un registro anterior de su cadena. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:202` and `apps/dashboard/src/i18n/alert-messages.ts:203`.

State: The resolved submission reply reports a line-count mismatch and records an incident. An external malformed reply can cause it. Receipt: `packages/fiscal-verifactu/src/drain.ts:1399`.

Route: Existing: unmatched answers are returned to waiting by the drain. Explain that retry and how to inspect a persistent failure; never call an external response mismatch bug-only without further evidence.

### `fiscal.duplicado_anulado`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-cases](#fiscal-cases).

| Language | Current words |
| --- | --- |
| EN | The tax agency (AEAT) already holds this invoice record as cancelled. Contact support. |
| ES | La AEAT ya tiene este registro de facturación como anulado. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:206` and `apps/dashboard/src/i18n/alert-messages.ts:207`.

State: The duplicate outcome is annulled; the drain rejects the row and opens a filing case. AEAT-held state is external evidence, not a bug-only receipt. Receipt: `packages/fiscal-verifactu/src/drain.ts:1773`.

Route: Missing: a supported filing-case resolution route. Keep the existing stop until a valid decision is made.

### `fiscal.anulacion_retenida`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-cases](#fiscal-cases).

| Language | Current words |
| --- | --- |
| EN | A cancellation was not sent because the tax agency (AEAT) refused the original invoice. Contact support. |
| ES | No se ha enviado una anulación porque la AEAT rechazó la factura original. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:210` and `apps/dashboard/src/i18n/alert-messages.ts:211`.

State: A cancellation whose original record was refused is set aside and gets its own case. It does not become sendable just by waiting. Receipt: `packages/fiscal-verifactu/src/drain.ts:862`.

Route: Missing: a case decision route; do not tell the owner to resend the cancellation unchanged.

### `fiscal.huella_divergente`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-cases](#fiscal-cases).

| Language | Current words |
| --- | --- |
| EN | An invoice record's fingerprint does not match the copy the tax agency (AEAT) holds. Contact support. |
| ES | La huella de un registro de facturación no coincide con la copia de la AEAT. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:214` and `apps/dashboard/src/i18n/alert-messages.ts:215`.

State: A duplicate lookup identifies a different fingerprint and opens a case. External or restored-data disagreement is not proved to be bug-only. Receipt: `packages/fiscal-verifactu/src/drain.ts:1773`.

Route: Missing: a supported evidence/decision route for the conflict. Never rewrite a recorded fingerprint.

### `fiscal.environment_mismatch`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-environment](#fiscal-environment).

| Language | Current words |
| --- | --- |
| EN | An invoice record was made for the tax agency's {recordEnvironment} service, but this box sends to {hostEnvironment}. It has not been sent. Contact support. |
| ES | Un registro de facturación se creó para el servicio de {recordEnvironment} de la AEAT, pero este equipo envía a {hostEnvironment}. No se ha enviado. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:218` and `apps/dashboard/src/i18n/alert-messages.ts:219`.

State: A record names a different environment from the sending host. This is a configuration/data mismatch, not an AEAT availability wait. Receipt: `packages/fiscal-verifactu/src/drain.ts:661`.

Route: Existing at operator level: correct the host environment for this data. Missing: safe administrator wording that preserves separation of test and live data. Do not relabel the record or promote a test database.

### `fiscal.environment_unknown`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-environment](#fiscal-environment).

| Language | Current words |
| --- | --- |
| EN | An invoice record does not say which tax agency service it was made for, so it has not been sent. Contact support. |
| ES | Un registro de facturación no indica para qué servicio de la AEAT se creó, así que no se ha enviado. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:222` and `apps/dashboard/src/i18n/alert-messages.ts:223`.

State: A stored record has null environment metadata. The immutable row cannot be repaired in place. Bug-only provenance is unproved. Receipt: `packages/fiscal-verifactu/src/drain.ts:661`.

Route: Missing: an evidence-preserving recovery/decision procedure. Neither waiting nor editing the stored row is a remedy.

### `fiscal.record_flagged`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-integrity](#fiscal-integrity).

| Language | Current words |
| --- | --- |
| EN | An invoice record has a problem the tax agency (AEAT) accepts, though it may flag it. Contact support. |
| ES | Un registro de facturación tiene un problema que la AEAT acepta, aunque puede señalarlo. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:234` and `apps/dashboard/src/i18n/alert-messages.ts:235`.

State: Local validation returns non-total warnings and records them. Validation warnings alone do not establish a product bug. Receipt: `packages/fiscal-verifactu/src/chain.ts:231`.

Route: Missing: name the relevant fields and a supported review action. Any actual change to the protected append path requires a separate owner ruling; this audit changes no fiscal code.

### `fiscal.reconcile_no_trace`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-reconcile](#fiscal-reconcile).

| Language | Current words |
| --- | --- |
| EN | Invoice {numSerieFactura} was sent, but the tax agency (AEAT) has no record of it. Contact support. |
| ES | La factura {numSerieFactura} se envió, pero la AEAT no tiene constancia de ella. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:238` and `apps/dashboard/src/i18n/alert-messages.ts:239`.

State: A reconciliation lookup still finds no authority copy after one resubmission. A lookup discrepancy is not proof of a Waitron bug. Receipt: `packages/fiscal-verifactu/src/reconcile.ts:166`.

Route: The producer is the library reconciliation function; this audit has not established a user-facing invocation for it. Establish that caller before proposing a recovery screen or promising a periodic check.

### `fiscal.reconcile_drift_anulada`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-reconcile](#fiscal-reconcile).

| Language | Current words |
| --- | --- |
| EN | The tax agency (AEAT) lists invoice {numSerieFactura} as cancelled, but it was not voided here. Contact support. |
| ES | La AEAT indica que la factura {numSerieFactura} está anulada, pero aquí no se anuló. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:246` and `apps/dashboard/src/i18n/alert-messages.ts:247`.

State: Reconciliation sees an authority cancellation not represented locally. The authority state is external; bug-only is not established. Receipt: `packages/fiscal-verifactu/src/reconcile.ts:75`; `packages/fiscal-verifactu/src/reconcile.ts:200`.

Route: Same caller caveat as reconcile_no_trace. Missing: evidence inspection and an administrator/asesor decision path if this alert is surfaced.

### `fiscal.filing_cases_open`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-cases](#fiscal-cases).

| Language | Current words |
| --- | --- |
| EN | {count} fiscal record(s) need someone to decide what to do. Contact support. |
| ES | {count} registro(s) fiscal(es) necesitan que alguien decida qué hacer. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:258` and `apps/dashboard/src/i18n/alert-messages.ts:259`.

State: The query finds open filing cases. They require a decision; elapsed time does not make that decision. Receipt: `packages/fiscal-verifactu/src/submission-alerts.ts:64`.

Route: Missing: the supported filing-case screen/action. Keep W41s-8/W41s-9 and A696 dependencies visible instead of directing the owner to support.

### `fiscal.refusals_repeated`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [fiscal-cases](#fiscal-cases).

| Language | Current words |
| --- | --- |
| EN | AEAT rejected {count} fiscal records in a row with code {codigo}. Waitron retries the first eligible stopped record hourly. An accept or a different refusal can restart sending. Contact support. |
| ES | La AEAT ha rechazado {count} registros fiscales seguidos con el código {codigo}. Waitron reintenta cada hora el primer registro detenido que puede enviar. Una aceptación o un rechazo distinto puede reanudar el envío. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:262` and `apps/dashboard/src/i18n/alert-messages.ts:263`.

State: A chain has a run of same-code refusals and eligible stopped work. A refusal run is not a bug-only state. Receipt: `packages/fiscal-verifactu/src/submission-alerts.ts:143`.

Route: Existing: eligible stopped work has the hourly probe described by the message. Missing: a decision route if that probe cannot resolve the refusal. Do not promise that waiting always recovers.

### `payment.bill_settle_failed`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [payments](#payments).

| Language | Current words |
| --- | --- |
| EN | A card payment of {amount:money} towards a bill was charged, but Waitron could not record it or issue the bill's invoice. The bill cannot be changed or invoiced until it is recorded. Contact support.${MORE_EN} |
| ES | Se cobró con tarjeta un pago de {amount:money} a cuenta de una cuenta, pero Waitron no ha podido registrarlo ni emitir la factura de la cuenta. La cuenta no se puede modificar ni facturar hasta que se registre. Contacta con soporte.${MORE_ES} |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:290` and `apps/dashboard/src/i18n/alert-messages.ts:291`.

State: A pending bill payment was charged but could not be recorded/issued. The incident stores errorCode; storage or clock failures can also prevent settlement. Bug-only is not established. Receipt: `apps/server/src/bill-payments-loop.ts:207`.

Route: Existing: Payments exposes pending bill payments and confirmed-outcome recovery. Trace its ability to finish this particular stored charge before pointing to it; a persistent local issuance failure needs a specific remedy. Never charge again or unlock on an unknown outcome.

### `backup.staging_space_low`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-preparation](#backup-preparation).

| Language | Current words |
| --- | --- |
| EN | The box does not have enough free disk space to prepare it. Contact support. |
| ES | El equipo no tiene espacio libre suficiente en disco para prepararla. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:448` and `apps/dashboard/src/i18n/alert-messages.ts:449`.

State: Free space in the staging filesystem is below the estimated need. A full filesystem does not require a Waitron bug. Receipt: `apps/server/src/backup-sweep.ts:108`.

_2026-10-28, A1167 slice 1: these words are gone. The bell now draws the owner's «Backup not made: it needs {needed} free and the disk has {available}.» (the `spaceLow` variant of `backup.run_stopped`), and a run first deletes its oldest deletable backups on the disk before it is refused; see [conventions-data.md](../developers/conventions-data.md#a-backup-run-makes-room-for-itself-or-is-refused-before-it-copies). The rest of this entry records the earlier tree._

Route: Existing: Box status shows disk use; the boot recovery wording names an installer freeing space or fitting a bigger disk. (2026-10-28, A1127: the full-disk page's action now names nobody; it says what fills the disk, that Waitron cannot free more by itself, and what reinstalling costs. The `storage.disk_full` email in `apps/server/src/i18n/box-emails.ts` still names the installer.) Missing: a supported self-service cleanup path for a person without a terminal. Never delete fiscal data or unrelated shared state.

### `recovery.state_incomplete`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-preparation](#backup-preparation).

| Language | Current words |
| --- | --- |
| EN | Some of the box's own files that every backup must include are missing. Contact support. |
| ES | Faltan algunos archivos propios del equipo que toda copia debe incluir. Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:452` and `apps/dashboard/src/i18n/alert-messages.ts:453`.

State: A required backup state file is absent. A missing file is not proved to be bug-only. Receipt: `apps/server/src/state-secrets.ts:39`.

Route: Missing: identify the safe recovery/reinstall procedure for the missing component. Do not manufacture replacement private keys and describe the resulting backup as equivalent.

### `otherwise`

Screen: Dashboard alerts bell (incident history where applicable). Fix: [backup-preparation](#backup-preparation).

| Language | Current words |
| --- | --- |
| EN | Contact support. |
| ES | Contacta con soporte. |

Wording: `apps/dashboard/src/i18n/alert-messages.ts:456` and `apps/dashboard/src/i18n/alert-messages.ts:456`.

State: Any other backup-run preparation error is reduced to the substitution fallback. Its cause is unknown, so it cannot qualify for a bug-only exception. Receipt: `apps/server/src/alert-sources.ts:186`; `apps/server/src/backup-sweep.ts:318`.

Route: Missing: retain a safe error category and a usable next step. An unknown cause must not become an unconditional support instruction.

### `shell.first_setup.attempt_invalid`

Screen: Setup wizard. Fix: [setup-state](#setup-state).

| Language | Current words |
| --- | --- |
| EN | The saved setup cannot be read. Contact support. |
| ES | No se puede leer la configuración guardada. Contacta con soporte. |

Wording: `apps/setup/src/i18n/strings/shell.ts:8` and `apps/setup/src/i18n/strings/shell.ts:147`.

Added by A1042 (2026-10-26): the setup screen shows the same words in two more places — when the
box's Start again summary does not have the expected shape (`summaryOf`,
`apps/setup/src/first-setup-session.ts`), and when the backup recovery status read on the
missing-database path is not one that page expects (`#readMissingAsk`, called from
`#resumeFirstSetup`, `apps/setup/src/setup-app.ts`).

State: Saved setup/owner data cannot be parsed or checked, or a protected read fails. Corruption and filesystem errors are not proved to be bug-only. Receipt: `packages/provisioning/src/durable-host-json.ts:15`; `packages/provisioning/src/first-setup-owner.ts:131`; `apps/setup/src/setup-app.ts:200`.

Route: Missing: a next step for each place above. A1042 (S7l) lets Start again go ahead past a damaged recovery-key record, after a warning; it does not change these words. A1099 lets it go ahead past a damaged record of the attempt's series names (the kept picks file, the public fiscal record or the fiscal documents), after a warning; a damaged setup record or claim marker (A1158), an unreadable present database (A1159), a damaged start-again note (A1160), the database-present case in A1161 and a recovery's damaged copy of the series-name record (A1162) still refuse.

### `shell.operation_conflict`

Screen: Setup wizard. Fix: [setup-state](#setup-state).

| Language | Current words |
| --- | --- |
| EN | This server has saved setup work for a different request. Resume the original setup or contact support. |
| ES | Este servidor tiene guardada una configuración de otra solicitud. Continúa la configuración original o contacta con soporte. |

Wording: `apps/setup/src/i18n/strings/shell.ts:24` and `apps/setup/src/i18n/strings/shell.ts:165`.

State: A saved setup-operation file is malformed, or kind/requestHash differs. Waiting cannot change a retained malformed file or reconcile a different request. Receipt: `packages/provisioning/src/setup-operation.ts:94`; `packages/provisioning/src/setup-operation.ts:171`; `apps/setup/src/setup-app.ts:1513`.

Route: Existing for a resumable request: resume the original. Missing for an unrecoverable mismatch: a verified discard/recovery choice. Coordinate with A1042; do not delete retained setup data as an improvised remedy.

### `shell.already_stamped`

Screen: Setup wizard. Fix: [setup-environment](#setup-environment).

| Language | Current words |
| --- | --- |
| EN | A previous setup attempt left this server partly set up, for a different environment. Contact support to reset this server, then start setup again. |
| ES | Un intento anterior de configuración dejó este servidor configurado a medias, para otro entorno. Contacta con soporte para restablecer este servidor y vuelve a empezar la configuración. |

Wording: `apps/setup/src/i18n/strings/shell.ts:26` and `apps/setup/src/i18n/strings/shell.ts:167`.

State: A partially prepared database carries a stamp for another environment. Changing elapsed time cannot change the stamp. Receipt: `apps/server/src/adopt.ts:114`; `apps/setup/src/setup-app.ts:1523`.

Route: The authenticated reset route only accepts a half-finished adopt, as setup-api.ts:1067 checks. It is not a general reset for this state. Missing: an applicable self-service fresh-server/reinstall path that does not erase trading data.

### `shell.reset.resetting`

Screen: Setup wizard. Fix: [setup-reset](#setup-reset).

| Language | Current words |
| --- | --- |
| EN | The server is resetting and will restart. Wait a minute, then reload this page to start setup again. If joining again says the previous join stopped partway, the reset did not run: contact support. |
| ES | El servidor se está restableciendo y se reiniciará. Espera un minuto y recarga esta página para volver a empezar la configuración. Si al unirlo de nuevo se indica que la unión anterior se detuvo a medias, el restablecimiento no se ha hecho: contacta con soporte. |

Wording: `apps/setup/src/i18n/strings/shell.ts:67` and `apps/setup/src/i18n/strings/shell.ts:210`.

State: Reset was requested. The warning explicitly covers the case where the supervised restart did not perform it; that is not proved bug-only. Receipt: `apps/setup/src/setup-app.ts:2012`; `apps/server/src/setup-api.ts:1048`.

Route: Existing: reload after restart. Missing if the half-join remains: an authenticated retry/restart procedure and a clear outcome; do not assert success merely because the reset endpoint answered.

### `aeat_certificate.refused.check_failed`

Screen: Venue settings certificate dialog. Fix: [certificate](#certificate).

| Language | Current words |
| --- | --- |
| EN | The check with AEAT failed for an unexpected reason. The current certificate is unchanged. Try again; if it fails again, contact support. |
| ES | La comprobación con la AEAT ha fallado por un motivo inesperado. El certificado actual no cambia. Vuelve a intentarlo; si vuelve a fallar, contacta con soporte. |

Wording: `packages/fiscal-verifactu/src/dashboard/strings.ts:82` and `packages/fiscal-verifactu/src/dashboard/strings.ts:168`.

State: A certificate check throws an unclassified transport or other error; the dialog also uses this wording for an unknown answer.reason. Neither catch proves bug-only. Receipt: `packages/fiscal-verifactu/src/certificate-check.ts:25`; `packages/fiscal-verifactu/src/dashboard/certificate-dialog.ts:60`.

Route: Existing: retry without replacing the current certificate. Missing: distinguish operator-correctable connection/configuration problems from an actual Waitron fault and give the relevant next step.

## Retry messages with persistent or mixed causes

These are additional findings, not claims that every ordinary retry instruction is wrong.
Changing a retry message must preserve authentication privacy, stored-operation ownership and
confirmed payment evidence.

### Setup readiness refusal

Message: `shell.not_ready`. Fix: [setup-readiness](#setup-readiness).

| Language | Current words |
| --- | --- |
| EN | The server isn't ready yet. Wait a moment, then try again. |
| ES | El servidor aún no está listo. Espera un momento e inténtalo de nuevo. |

Wording: `apps/setup/src/i18n/strings/shell.ts:23`, `apps/setup/src/i18n/strings/shell.ts:164`.

State: The setup shell maps setup.not_ready to this message (setup-app.ts:214, :220, :353 and :1528). The code also means a Cloud recovery dependency is absent (first-setup-backup-source.ts:40), a required reset callback is absent (setup-api.ts:1053), or a recovery artifact/directory fails a size/type/count check (first-setup-resolution-inspection.ts:161 and :196). None of those conditions changes merely by waiting. Bug-only: no, persistent dependency/file conditions are explicit.

Route: Missing: distinguish temporary preparation from unsupported/unavailable recovery and retained-file refusal. Offer a supported source or administrator recovery route. A1042 (#2101, landed 2026-10-26) changed some of these paths; recheck them against main.

### Recovery from a backup

Message: `failed`. Fix: [setup-readiness](#setup-readiness).

| Language | Current words |
| --- | --- |
| EN | Recovery could not continue. Check the source and try again. |
| ES | No se pudo continuar. Revisa el origen e inténtalo de nuevo. |

Wording: `apps/setup/src/i18n/backup-repair.ts:36`, `apps/setup/src/i18n/backup-repair.ts:79`.

State: This screen catches unrecognised refusals as backupRepairStrings.failed (first-setup-backup-screen.ts:308). The backend can refuse missing Cloud support or an incompatible module operation (first-setup-backup-recovery.ts:167, :363, :445 and :517). Repeating an unchanged source cannot add the missing implementation. Bug-only: not established.

Route: Existing: archive, bucket and Cloud source choices. Missing: retain a safe refusal category and name an applicable source/image/administrator action. Do not prescribe reinstalling over recorded sales.

### Passkey sign-in

Message: `passkey.verification_failed`. Fix: [sign-in](#sign-in).

| Language | Current words |
| --- | --- |
| EN | Could not verify the passkey, try again |
| ES | No se pudo verificar la passkey, inténtalo de nuevo |

Wording: `apps/dashboard/src/i18n/codes.ts:359`, `apps/dashboard/src/i18n/codes.ts:360`.

State: The login screen displays this code (login-screen.ts:848 and :905). The producer refuses a non-active credential owner with this same code (packages/identity/src/passkey.ts:269), as well as invalid proofs. Waiting or repeating that credential cannot activate the account. Bug-only: no; non-active account status is an explicit branch.

Route: Existing: the login screen offers other sign-in methods. Missing: a neutral next step if retry fails, such as using another offered method or asking the administrator. Preserve the same answer for a suspended/pending account; never reveal its status.

### Backup recovery-key write

Message: `backup.effective_mismatch`. Fix: [backup-key](#backup-key).

| Language | Current words |
| --- | --- |
| EN | The saved key didn't take effect — try again |
| ES | La clave guardada no se aplicó; inténtalo de nuevo |

Wording: `apps/dashboard/src/i18n/codes.ts:1016`, `apps/dashboard/src/i18n/codes.ts:1017`.

State: After writing the key/settings, backup-api.ts:461, :575 and :606 compares the effective key with the submitted one and throws on disagreement. The enable path explicitly checks a partial environment override. Bug-only: not established; effective configuration can disagree with the saved value.

Route: Missing: tell an administrator to inspect the effective backup configuration and which key is actually in use. A blind retry must not suggest that an old key now opens a newly encrypted backup.

### Public connection repair

Message: `failed`. Fix: [tls-repair](#tls-repair).

| Language | Current words |
| --- | --- |
| EN | The connection could not be set up. Try again. |
| ES | No se ha podido configurar la conexión. Inténtalo de nuevo. |

Wording: `apps/server/src/connection-bootstrap-strings.ts:16`, `apps/server/src/connection-bootstrap-strings.ts:48`.

State: The public page shows this text on a refused inspection and any repair-fetch failure (connection-bootstrap-page.ts:141 and :154). box-tls-repair.ts:52, :60 and :65 refuses linked or non-file/oversized layouts; inspectBoxTls catches those as refused at :200. Waiting does not remove that persistent filesystem shape. Bug-only: no, a linked layout is explicitly refused.

Route: Existing: installer-certificate mode already directs the reader to the installer. Missing for a managed-layout refusal: an applicable installer/administrator route, with no private filesystem details on this public page. This is the existing backlog item “Public TLS repair refuses linked layouts”, not a new request to weaken the linked-file checks.

### Certificate HTTP refusal

Message: `aeat_certificate.refused.aeat_http`. Fix: [certificate](#certificate).

| Language | Current words |
| --- | --- |
| EN | AEAT answered with HTTP error {status}. The current certificate is unchanged. Try again later. |
| ES | La AEAT ha respondido con el error HTTP {status}. El certificado actual no cambia. Vuelve a intentarlo más tarde. |

Wording: `packages/fiscal-verifactu/src/dashboard/strings.ts:80`, `packages/fiscal-verifactu/src/dashboard/strings.ts:166`.

State: certificate-check.ts:33 groups every VerifactuTransportError of kind http by status. This branch does not restrict the number to a temporary response. Bug-only: no, the response is external. The specific provider remedy is unverified; do not infer it solely from the number.

Route: Existing: the installed certificate stays unchanged. Missing: distinguish a retryable response from a persistent refusal using verified response evidence, then name the applicable certificate/connection/administrator step.

### Shared payment outcome fallback

Message: `payment.outcome_unknown`. Fix: [payments](#payments).

| Language | Current words |
| --- | --- |
| EN | The card provider could not say what happened to this payment; the order stays locked. Try again in a minute. |
| ES | El proveedor de pagos no pudo confirmar qué pasó con este cobro; el pedido sigue bloqueado. Vuelve a intentarlo en un minuto. |

Wording: `apps/dashboard/src/i18n/codes.ts:1164`, `apps/dashboard/src/i18n/codes.ts:1165`.

State: payments-api.ts:1098 throws this for an unknown provider outcome. payments-screen.ts:63 overrides unreachable and ambiguous reasons: ambiguous directs you to the provider dashboard, and disconnected names reconnection. The shared minute-retry text remains the fallback, so a grep of the shared entry alone overstates the live problem. Bug-only: no, provider uncertainty is explicit.

Route: Keep the existing reason-specific handling. Before a fix, exercise the fallback with a real reachable reason and show the missing next step. Never infer no charge from an unknown outcome.

### Payment check fallback

Message: `payments.stuck.failed`. Fix: [payments](#payments).

| Language | Current words |
| --- | --- |
| EN | Something went wrong while checking this payment. If it is still listed, try again in a minute. |
| ES | Algo salió mal al consultar este cobro. Si sigue en la lista, vuelve a intentarlo en un minuto. |

Wording: `apps/dashboard/src/i18n/strings.ts:2457`, `apps/dashboard/src/i18n/strings.ts:5822`.

State: payments-screen.ts:71 chooses this for server.internal. The fallback contains no information establishing that another minute changes the underlying cause. Bug-only: unproved, since this includes a failed request or unclassified server error.

Route: Missing: a bounded next action after repeated failure, preserving the held order and evidence. Trace the actual internal refusal before claiming a product-only fault or adding a new recovery action.

## Temporary waits and other screened matches

These source reads explain why the named matches are not added as confirmed dead ends. They do
not verify that every provider, device or process eventually recovers.

| Message/code and surface | Source receipt | Disposition |
| --- | --- | --- |
| `printer.probe_busy`, dashboard | `apps/server/src/printer-probes.ts:20` and `:52` prune expired targets and set a 30-second expiry. | Capacity can change with time; retain a wait/retry. |
| `printer.bluetooth_command_busy`, dashboard | `apps/server/src/printer-bluetooth-commands.ts:80` prunes expired pending commands; `:110` checks their count. | Temporary capacity. A printer remaining unavailable is a different refusal. |
| `pin.throttled`, till/dashboard; `password.throttled`, dashboard/setup | `packages/identity/src/pin-throttle.ts:110`; `packages/provisioning/src/password-throttle.ts:139`. Both compare a clock with an unlock time or an in-flight attempt. | Waiting can release the throttle; it does not correct the entered credential. |
| `account_action.rate_limited`, dashboard | `apps/server/src/account-rate-limit.ts:39` resets the request counters after the 60-second window. | Waiting can release this limit. It does not make an expired or invalid action link valid. |
| `backup.reload_in_progress`, dashboard | `apps/server/src/stream-host.ts:213` clears its gate in `finally`; `apps/server/src/backup-supervisor.ts:189` sets a reload gate. | An active operation can finish. This audit did not reproduce a stuck reload. |
| `cloud.busy`, dashboard connection | `apps/server/src/cloud-replacement.ts:77` removes its active marker in `finally`; `apps/server/src/cloud-client.ts:313` waits for an active operation. | Temporary local concurrency on these callers. |
| `alert.source_unavailable`, dashboard bell | `apps/server/src/alerts.ts:130` preserves a failed source as an alert; `apps/dashboard/src/api/query-controller.ts:45` sets a one-minute refresh. | Another read is scheduled in an open dashboard. A persistent underlying failure still needs diagnosis; this is no guarantee of repair. |
| `fiscal_test.uncertain`, setup | `packages/provisioning/src/fiscal-readiness-runner.ts:140` calls the fiscal drain and returns uncertain on a throw or unsettled result; `packages/provisioning/src/fiscal-readiness.ts:106` invokes submit again without accepted evidence. | Retry is an operation, not just waiting. No deterministic permanent cause was established for this message. |
| `payments.stuck.unknown_unreachable`, dashboard | `apps/dashboard/src/screens/payments-screen.ts:67` uses the unreachable reason; `:68` gives an ambiguous answer different guidance. | A network retry can help; preserve the reason distinction. |
| `shell.connection.server_problem`, setup; `connection.timed_out`, dashboard | `apps/setup/src/setup-app.ts:438` groups any answered non-404 HTTP refusal; `packages/dashboard-kit/src/request.ts:35` bounds reads. | Mixed/unknown causes. A timeout can end on retry; repeated setup status refusal needs an administrator next step, not a promise that waiting repairs it. Include this setup fallback in setup-readiness. |
| Generic read/write, SMTP, invoice delivery and printer retry messages | Examples: `apps/setup/src/i18n/strings/venue.ts:29`; `apps/till/src/i18n/strings.ts:1674`; `apps/dashboard/src/i18n/strings.ts:707`. | Included in the broad scan. An unsuccessful request alone does not prove waiting is futile; no universal bug-only or successful-retry claim is made. |
| Unknown code fallback, dashboard and till | `packages/dashboard-kit/src/codes.ts:16`; `packages/dashboard-kit/src/strings.ts:1`; `apps/till/src/i18n/codes.ts:785`. | “Something went wrong, try again” can conceal an unmapped persistent code. Treat each demonstrated mapping as its own fix; this inventory does not establish every possible throw reaching every screen. |

## Server pages and guides

`apps/server/src/recovery-surface.ts` has no literal “contact support”. Its database-ahead/schema
rows name backup/reinstall, its disk-full row names freeing space or a bigger disk (2026-10-28, A1127: the full-disk page's action now names nobody; it says what fills the disk, that Waitron cannot free more by itself, and what reinstalling costs. The `storage.disk_full` email in `apps/server/src/i18n/box-emails.ts` still names the installer), and its unknown
boot row names a retry followed by the installer. Those are already distinct instructions rather
than an endless wait. The page's rendered action is a boot retry (`:563`); a restore or reinstall
is an operator procedure, not a second button. The actual accessibility of each installer procedure
was not exercised by this audit. Do not describe this as qualified end-user recovery.

The public connection guide's retry defect is recorded above. The source search of
`apps/server/src/guide/en/` and `es/` found no literal instruction to contact Waitron support.
The backup guide already says to inspect the failed step and preserve retained files
(`apps/server/src/guide/en/backup-recovery.md:43`). Guide prose, planned recovery screens and
library functions do not by themselves establish a callable self-service remedy.

Provider support references in the Payments page are separate: the page asks for provider-confirmed
transaction evidence (`apps/dashboard/src/i18n/strings.ts:2506` and `:2526`). They are not an
instruction to buy Waitron support and must not be removed in a way that permits an unsupported
money outcome.

## Follow-up fixes

The audit is complete as a source inventory. All product areas below remain open under the
[owner correction](#owner-correction-2026-10-25); the four dated wording milestones are superseded
as completed remedies. Keep each change
within its screen or area, reproduce the affected mapping with a failing test, then change the
smallest applicable message or recovery path. A missing substantial workflow stays a backlog item
for an owner decision; it is not silently replaced by “try again”. Fiscal/setup/sign-in/money
changes take their required review and existing protected-writer approvals.

### setup-state

**Setup state refusals need a usable resume or recovery route.** Read A1042's S7l change first. Handle retained-operation mismatch and damaged setup without directing the owner to support; keep operation ownership and fiscal evidence.

#### A1158: a damaged setup record or claim marker still dead-ends Start again

Left open by A1099. When an abandoned first setup's own record (`state/first-setup.json`) or its
claim marker (`venue/first-setup-claim.json`) is damaged, Start again is refused before any warning
can be shown: `setup.owner_required` at the password step with the venue database missing, and
`setup.attempt_conflict` with it present (A1099 plan, PROBE 2/3, re-run on `b8a06f203`). Wanted: the
same kind of warned way out A1099 gives a damaged record of series names.

#### A1159: a venue database that is present but cannot be read refuses setup.not_ready

Left open by A1099. An unreadable `venue.db` with the file present refuses `setup.not_ready`
(`apps/server/src/first-setup-resolution.ts`, the unreadable-database refusal). It could be treated
as missing, so that the missing-database Start again applies, with its warning.

#### A1160: a damaged start-again note is refused late and blocks every later naming

Left open by A1099. A damaged `state/first-setup-start-again.json` is read only when Start again
raises it, after the summary has been shown and after the confirmation record is written
(`writeStartAgainConfirmation`, then `raiseStartAgainNote`, in
`apps/server/src/first-setup-resolution.ts`); it refuses `setup.attempt_invalid`, and every later
series-name choice on the box refuses with it. Separately, a file time later than the naming range
(`END_MS`, `packages/fiscal-verifactu/src/hour-selection.ts`) would give a floor past every name, and
naming on the box would be refused for good.

#### A1161: with the database present, a public record or documents file still dead-ends Start again

Left open by A1099 (plan difference D-4, owner point 2). With the venue database present and no
stopped recovery beside it, Start again is allowed only for a provably unused attempt, and that proof refuses `setup.not_ready`
whenever a public fiscal record (`state/module-operation-public.json`) or an unexpected
fiscal-documents file exists, damaged or intact (`firstSetupUnusedAssignment` in
`apps/server/src/first-setup-unused-assignment.ts` and `noOtherHistory` in
`apps/server/src/first-setup-resolution.ts`, both from #1752). Beside a stopped recovery, the
summary refuses a damaged public record `setup.attempt_invalid`
(`apps/server/src/first-setup-start-again-backup-discard.test.ts`, "a stopped recovery's summary
past a damaged public record still refuses setup.attempt_invalid"). So a damaged one there gets no
warned way out. Wanted: decide with the owner whether a damaged one can count as "name unknown"
on this path too.

#### A1162: a recovery's damaged copy of the series-name record still dead-ends Start again

Left open by A1099 (plan R-6). A stopped backup recovery whose copy of the series-name record is
damaged, with nothing recorded in its journal, still refuses the summary `setup.not_ready`
(`apps/server/src/first-setup-start-again-backup.test.ts`, "a stopped recovery whose journal %s and
whose copy's picks %s refuses the summary"). With the database present, an abandoned recovery not
yet emptied beside a damaged series-name record still refuses (A1099 Task 9 keeps
`setup.not_ready`); Start again on that path refuses `setup.attempt_invalid`, whose page words send
the person to support. Both readers are outside A1099's approved design.

### setup-environment

**A different-environment partial setup needs an applicable fresh-start route.** Distinguish this from the authenticated half-adopt reset. Establish the safe fresh-server/reinstall action before offering it.

### setup-reset

**An incomplete-join reset needs an outcome after a failed restart.** Retain authenticated reset proof and add a supported way to retry or restart if the half-join remains.

### setup-readiness

**Setup and backup recovery must distinguish waiting from missing capability.** Separate absent callbacks/services and incompatible or refused retained artifacts from temporary work; offer a supported source, image or recovery choice and any required sign-in there.

### sign-in

2026-10-25: the shared passkey refusal now asks your administrator to check your account, in English and Spanish. This wording applies to profile passkey registration too; it makes no claim about account status. See [account access](../../apps/server/src/guide/en/staff.md#account-access).

**2026-10-25 self-service rework:** the shared refusal says the passkey could not be verified and
offers retry. After an explicit passkey sign-in refusal, the screen explains that **Use your password**
opens password entry and the emailed-reset request. An autofill refusal on the email screen explains
the same choices through **Continue**. Browser cases in
`apps/dashboard/src/screens/login-screen.test.ts` exercise retry, password sign-in and reset request
after refusal in both languages, including reset after an autofill refusal; the existing profile suite exercises the shared registration
message. The server reset-route case requests and completes a reset and checks the same
acknowledgement for unknown email addresses. No account-status check was added to the public screen.

**Still open: authenticated account-access recovery when no offered sign-in works.** Password reset
does not reactivate a disabled account, and requesting an email does not repair unavailable email
delivery. Offer any required administrator sign-in at the refusal and explain the access change
before making it. This is a separate workflow; this rework does not claim to implement it.

### backup-settings

**2026-10-25 archive-settings wording rework:** the alert points to Backups to read the load
error and choose settings again. It names **Turn on backups**, which replaces the saved choices,
and leaving without applying, which sends no settings write in the exercised browser cases.
The EN/ES cases show the original load error, a refused folder followed by correction and a
successful apply using the held recovery key, plus leaving a draft without applying. Existing
server route cases exercise replacement of unreadable records, rejection of a missing new secret
and a successful write whose reload still fails. The latter remains a saved write with a load
error; the message does not promise that every apply starts the worker.

**Still open:** correction when a host/key refusal persists after replacement — explaining or
reconciling key numbers, restoring an old credentials key, and rewriting the record. Do not replace
recovery keys or discard backup files just because settings cannot be read.

**2026-10-29, A1089 settings-evidence panel (#2244):** when Backups says the saved settings
can't be used, a **What the box recorded** button opens a panel that reads `GET
/api/backup/settings-evidence`. It lists the times the box could not use its saved backup settings
since it last started, newest first, at most five, each with a sentence about its cause (for example
the key number the record was locked with against the numbers this box holds). It then shows the
saved record now: when it was written and with which key number, the box's key numbers, and, when
the record reads and the environment does not set backups, its folders (with whether each exists)
and buckets (address, region, bucket, access key ID and archive folder, never the secret). It says
whether the box holds a usable recovery key, by fingerprint only. **Read again** reads the facts
again and does not turn backups on; **Stop** closes the panel; a refusal for lack of permission
offers an administrator sign-in. The panel writes nothing and repairs nothing. Failures are kept in
memory, so a restart empties the list (design decision 1):
[design](../superpowers/specs/2026-10-29-a1089-backup-settings-evidence-design.md),
[plan](../superpowers/plans/2026-10-29-a1089-backup-settings-evidence.md).

### backups-admin-sign-in

**Backups offers no administrator sign-in when it refuses for lack of `system.manage`.** It says
"You don't have permission to do that" twice and names no next step, against the refusal rule.
The screen's `admin-sign-in` event is already routed (`apps/dashboard/src/dashboard-app.ts`), so
the fix is to offer the button there. Normally unreachable: the Backups entry is shown to the
manager and admin roles only; it appears when the dashboard's role and the session's permissions
disagree.

### backup-stream

**2026-10-25 settings-refusal wording:** the alert explains **Change bucket**, **Test**,
**Save and turn on** and **Cancel** in both languages. Browser cases exercise a named prefix
refusal, a corrected test without a settings save, applying the correction, and cancelling without
a save or shutdown request. The server route suite exercises real validation and credential writes;
its bucket probe and stream process are test doubles. These checks do not qualify a live bucket
or show that replacing settings repairs every configuration failure.

**Still open: host-configuration diagnosis and correction.** The supervisor's
`config_unsafe` state also covers values the form cannot edit, including the database path
(`packages/stream/src/supervisor.ts`, `#configurationIsSafe`). The message states that diagnostic
limit. Add authenticated diagnosis and the applicable correction separately; do not discard keys
or existing backup files.

**A stopped or refused bucket stream still needs restart or ownership choices.** Distinguish an
unavailable process from a conflicting writer; do not suggest resuming an unauthorised primary.
Offer any required sign-in there and build a missing restart/ownership workflow separately.

### backup-state

**A failed sealed-state refresh needs its cause and a retry route.** Expose a safe cause, offer a correction and any required sign-in there, and recheck that sealing succeeds. Do not promise current recovery keys before success.

### backup-preparation

**2026-10-25 staging-space wording:** `backup.staging_space_low` now points to the existing
**Box status** page and its **Free** action, when available. It explains the deletion categories
and leaving without cleanup. Free's filesystem cases exercise leftovers, log/crash-report age
rules, active-backup exclusion and retained data; the dashboard cases exercise an explicit press
and leaving without one. They do not establish that cleanup frees enough for every backup.

**2026-10-25 Box status footer rework:** the footer explains choosing how many archives to keep
on Backups, that older archives are removed only after a new backup succeeds, and leaving without
changes. It names the database, recovery keys and saved backups to preserve. The installer
referral is removed in both languages; the guides state that moving to a larger disk is not an
action this page provides.

_2026-10-28, A1167 slice 1: the staging-space words above were replaced by the owner's «Backup
not made: …» sentence, and the Box status guide's "older archives are removed only after a new
backup succeeds" sentence by one saying a backup run can delete its oldest backups on the disk to
make room. The Box status page's own footer (`box_status.fillers` in
`apps/dashboard/src/i18n/strings.ts`) now says older archives are removed only after a new backup
succeeds "or before a backup that is short of room", in both languages._

**Still open: space beyond the supported cleanup.** When no reclaimable files remain and a new
backup cannot fit, there is no supported in-app disk-recovery workflow. Add an authenticated
choice with evidence and a safe Stop; do not delete database files, keys or saved backups to
silence the alert. Changing retention is not immediate full-disk recovery.

**Missing files and unknown preparation failures still need remedies.** Preserve the safe error
category and establish the component's recovery route before replacing `recovery.state_incomplete`
and the `backup_stop` fallback. Do not manufacture replacement private keys.

### backup-key

2026-10-25: the Backups refusal now asks the box's administrator to check its backup configuration
before retrying, in English and Spanish. The browser cases exercise both applying settings and
changing the key, retaining the displayed status after refusal and allowing a subsequent successful
submission. The [recovery guide](../../apps/server/src/guide/en/backup-recovery.md#proof) tells you to
keep both key records; the refusal does not establish which key opens a backup. Key persistence,
effective-key checks and status handling are unchanged.

**Reopened after the 14:02 owner correction:** replace the administrator referral with inspection
and correction of the effective backup configuration, offering any needed sign-in there. Keep the
key-use uncertainty explicit and a safe Stop for a change that could lose access to a backup.

Later on 2026-10-25, the [wording rework](#backup-key-self-service-rework-2026-10-25) removes the
referral and qualifies retaining the displayed downloads and leaving without another submission.
The effective-key diagnosis and correction workflow remains open.

### restore-start

**A repeated restored-box first-start failure needs a specific remedy.** Keep the existing restart attempt and identify a persistent completion refusal before suggesting another action.

### fiscal-integrity

**Fiscal integrity and validation alerts need evidence-preserving next steps.** Replace support-only guidance without editing records or treating every warning as a proven Waitron bug. A substantial missing recovery workflow requires an owner decision.

**2026-10-29 integrity/validation recheck**, against `1cd34678b`:

The [proposed evidence inspection](../superpowers/specs/2026-10-29-a1089-fiscal-integrity-recovery-design.md)
awaits an owner scope decision. This milestone changes no alert wording or fiscal behavior.
The inventory above remains a record of its earlier tree.

| Boundary | Source finding and exercised limit |
| --- | --- |
| Stored predecessor check | `packages/fiscal-verifactu/src/verify.ts:50` reads at most the node's last two records. It checks the latest predecessor's hash and its link where applicable, not the entire chain or every column. `verify.test.ts` exercises the empty/first/two-record states, three issue kinds and a continuing append after deliberate fixture corruption. |
| Event association | `packages/core/src/record-sale.ts:203`, `packages/core/src/record-correction.ts:236`, `packages/core/src/record-void.ts:49` and `packages/core/src/record-substitution.ts:147` map the reported issues into an incident. The issue IDs name predecessors; the incident's sale link names the operation that detected them. These reports alone do not refuse the operation. Five focused core cases exercise continuation with a fake fiscal backend. |
| Local validation | `packages/fiscal-verifactu/src/chain.ts:186` validates a newly built record at its generation instant. Errors and malformed fingerprint warnings refuse it; totals warnings are separate. Other warnings produce `fiscal.record_flagged` beside the appended record. The warning fixture injects most extra issues; its missing-IPSI-regime-code case exercises a real local warning. None proves an AEAT acceptance. |
| Retained evidence | `packages/fiscal-verifactu/src/chain.ts:248` keeps field/code arrays paired by position, without field values or an exact fiscal-record ID. `packages/core/src/errors.ts:132` keeps chain issue facts but not the verifier's checked count. The first-open-incident key can suppress later evidence (`packages/db/src/schema/incidents.ts:69`). Do not guess a warning's record or label saved facts as a current or complete audit. |
| Existing actions | Core chain and fiscal claims require `fiscal.view`, without an inspection target. `apps/server/src/alerts-api.ts:129` authorises Mark handled; `packages/core/src/incidents.ts:307` acknowledges the incident. The alert screen offers that action and any supplied target. Acknowledgement does not repair records or establish agency acceptance. |

Unchanged local commands run for this recheck:

- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/verify.test.ts src/chain.validation-warnings.test.ts src/chain.record-validation.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts`: 57 passed, including the 20 protected write-path/immutability cases.
- `pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts src/record-correction.test.ts src/record-void.test.ts src/record-substitution.test.ts -t 'chain verification fails'`: 5 passed, 214 unrelated skipped.
- `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts-api.test.ts`: 56 passed.

Logs are in `/Users/clintongormley/waitron-campaign-e/receipts/a1089-fiscal-integrity-20261029/`.
These local fixtures do not qualify live AEAT, a complete chain audit, persistent repair or a rendered
inspection screen. The proposal separates saved evidence from fresh reads, offers sign-in at the
action and a safe Stop, and grants no write or repair authority. Choose planning inspection first,
leaving persistent repair open, or designing the complete recovery/decision path before a build.
Both options require separate implementation approval; the product referrals remain open.

### fiscal-cases

**Fiscal filing-case alerts need a real decision route.** Use W41s-8/W41s-9 when released, or keep the missing workflow explicit. Rejections, cancellations, duplicate conflicts and repeated refusals cannot be fixed by an invented retry screen.

### fiscal-reply

**A fiscal reply-line mismatch needs accurate retry and evidence choices.** Describe only the drain behavior actually exercised, then offer evidence inspection and a decision path for persistent malformed replies, with any required sign-in there.

**2026-10-28 reply-boundary recheck**, against `f0df802c0`:

The inventory's retry description needs two distinctions: a wrong line count and a line that
names the wrong record are different cases, and a retained incident does not establish the latest reply.
The [proposed inspection scope](../superpowers/specs/2026-10-28-a1089-fiscal-reply-recovery-design.md)
awaits the owner's decision. This milestone changes no filing behavior or alert wording.

| Boundary | Source finding and exercised limit |
| --- | --- |
| Wrong line count | `packages/fiscal-verifactu/src/drain.ts:1276` checks count before matching lines; `:1398` handles unmatched rows and `:1405` records the batch warning. Four existing cases cover fewer, extra, duplicated-extra and zero reply lines: no record is accepted, ordinary rows return to pending with a retry time, no acknowledgement is written, and the warning holds sent ids, CSV and returned line facts. |
| Equal count | `packages/fiscal-verifactu/src/drain.ts:1284` checks position, reference, invoice identity and any stated operation. Existing cases accept a still-matched third line while leaving the swapped first two unknown; only those first two are sent by the fixture's explicit later drain call. This is not an all-or-nothing result for every malformed reply. |
| Retry and holds | `packages/fiscal-verifactu/src/drain.ts:1551` schedules an ordinary row using `backoffMs`; a probe stays held. The later-record fixture sends nothing before the unresolved record's retry, then sends that record with its successor. These fixture calls do not establish that every retry runs at the displayed instant or that a persistent mismatch will clear. |
| Retained evidence | The repeated-mismatch case at `packages/fiscal-verifactu/src/drain.cases.test.ts:1544` first retains an empty reply, then receives two lines at retry and still reads the original empty reply in the open warning. `packages/fiscal-verifactu/src/errors.ts:167` describes this first-open-warning limit. The retained lines must not be presented as the latest response or a complete history. |
| Existing runtime caller | `packages/fiscal-verifactu/src/slot.ts:75` supplies the module drain; `apps/server/src/boot.ts:2840` wraps it with restart reset, then `:2867` passes it through submission policy in the primary's loop. This is a traced source chain, not a scheduler or live AEAT experiment. |
| Existing alert action | `packages/fiscal-verifactu/src/alerts.ts:12` claims fiscal events for `fiscal.view` with no target screen; `apps/dashboard/src/widgets/alert-format.ts:38` needs a supplied target. The list maps incident parameters but the shown alert text is not a structured reply inspector. Mark handled calls `apps/server/src/alerts-api.ts:129`; `packages/core/src/incidents.ts:307` updates acknowledgement fields. It does not repair or resubmit the fiscal record. |

Existing checks run unchanged in an isolated registered worktree:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.cases.test.ts -t 'reply lines are paired'
pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts-api.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

The logs report **23**, **56** and **20** passing cases respectively; the first command skips
45 unrelated cases. These are local fixtures, including fake AEAT and some responses through the
real XML client, not live AEAT, an end-to-end inspection journey or a persistent-repair qualification.
No original assertion, fiscal record, guard or production source changes in this milestone.

**Still open:** decide whether to plan evidence inspection first, with persistent response repair
explicitly open, or design the complete fiscal decision route before a build. Keep the support
wording in scope until an actual action exists. Inspection must distinguish the first retained
warning from freshly read submission state; it cannot reconstruct replies that were never kept.
A malformed reply does not establish a Waitron bug or authorise a reset, altered chain, new invoice
number, reordered batch or manual retry. W41s-8/W41s-9 retain their separate authority and gates.

### fiscal-environment

**Fiscal environment refusals need safe configuration or recovery guidance.** Separate a wrong host environment from missing immutable metadata. Never relabel records, promote test data or reset invoice numbering.

**2026-10-28 environment-boundary recheck**, against `dda0bbff55ec4255e26c1ebc1cdd16487b255a33`:

The earlier operator-level suggestion to correct the host environment is not a complete remedy.
You must compare the record, database and effective process environments before choosing a path.
The proposed [environment inspection and recovery scope](../superpowers/specs/2026-10-28-a1089-fiscal-environment-recovery-design.md)
awaits the owner's scope decision. It changes no runtime behavior.

| Boundary | Source finding and exercised limit |
| --- | --- |
| Filing refusal | `packages/fiscal-verifactu/src/drain.ts:661` distinguishes a missing record stamp from a different environment. The five existing deployment-environment guard cases pass: mismatch and missing metadata submit zero records, a matching fixture is accepted, a refused predecessor holds its successors, and another healthy chain can submit. The matching fixture is a separate case, not a restart of the refused row. |
| Startup refusal | `apps/server/src/deployment-guard.ts:13` compares the database stamp with the host; for an unstamped production database it also asks the fiscal contribution about nonproduction or unknown history. `apps/server/src/boot.ts:973` calls it before normal migrations. The existing startup case refuses the mismatch even with a missing migrations path and checks that the retained record and empty deployment table are unchanged. |
| Effective configuration | `apps/server/src/box-env.ts` merges nonempty process values over saved files; `apps/server/src/trading-config.ts:31` writes the wizard's environment. `deploy/README.md:652` deliberately keeps `WAITRON_ENV` out of the operator `.env` example. These sources do not establish that changing the process value alone reconciles a database or its history. |
| Available alert action | `packages/fiscal-verifactu/src/alerts.ts:12` claims fiscal incidents with `fiscal.view` and no target screen. `apps/dashboard/src/widgets/alert-format.ts:38` supplies a target only when the alert names one. The traced handled action acknowledges an incident; it does not change environment metadata or resubmit a record. |
| Failed-start surface | `apps/server/src/recovery-surface.ts:351` gives the deployment mismatch an installer referral. A dashboard-only inspection would not repair that failed-start path. Its replacement needs its own authenticated recovery entry; lane A's setup/backup redesign is not authorised by this proposal. |
| Restore boundary | `apps/server/src/restore-gate.ts:20` refuses a backup from the other environment. A backup is not evidence that missing record metadata may be filled in, nor that a later fiscal record can be discarded. |

Existing checks run unchanged:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts -t 'deployment-environment guard'
pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts src/restore-gate.test.ts src/alerts.test.ts src/alerts-api.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/server exec vitest run src/box-env.test.ts
```

They report **5**, **73**, **20** and **7** passing cases respectively; the name-filtered drain command
skips 47 unrelated cases. These are local fixtures, not live AEAT, an environment repair, or an
end-to-end recovery qualification. No record, stamp, fiscal guard, production source or original
assertion changes in this milestone.

**Still open:** choose whether to plan running-dashboard evidence inspection first, leaving
failed-start and persistent repair open, or design the complete authenticated configuration and
failed-start remedy before a build. Keep both support messages in scope until a real action exists.
Unknown or contradictory metadata must not be guessed, rewritten, promoted or treated as proof of
a Waitron bug. Acknowledging the alert does not resolve its cause.

### fiscal-reconcile

**Reconciliation alerts need a production caller and an evidence/decision route.** Do not
promise a periodic fiscal check or offer another submission until that caller and its recovery
choices are specified and exercised.

**2026-10-26 caller audit**, against `bc6b9da96639cf055ec8dde15b88d442136b6343`:

| Boundary | Source finding |
| --- | --- |
| Fiscal producer | `packages/fiscal-verifactu/src/reconcile.ts:118` exports the library function. A TypeScript/JavaScript reference search under `apps/`, `packages/`, `scripts/`, `bench/` and `deploy/` found its direct imports in `reconcile.test.ts`, `reconcile.period.test.ts` and `acks.test.ts`, all in that package. No production caller was found in that search. |
| Running server loop | `apps/server/src/boot.ts:1678` constructs `StripeReconciler`; `:2815` schedules that payment duty. The same file's imported `reconcile` comes from `@waitron/module` (`:89`), for module selection. Neither is the fiscal library function. |
| Module boundary | `packages/fiscal-verifactu/src/slot.ts:50` supplies the fiscal contribution, including submission through `drain`; `packages/fiscal-verifactu/src/index.ts` does not re-export the fiscal reconciliation function. The package's `./src/*` export still permits a direct source import, so this is a scoped caller search, not proof that invocation is impossible. |
| Incident visibility | `packages/fiscal-verifactu/src/alerts.ts:12` claims `fiscal.` incidents for `fiscal.view`. `apps/server/src/alerts.ts:115` reads already-recorded incidents, and `apps/server/src/alerts-api.ts:126` exposes that read. This path can present a recorded finding; it does not run the fiscal audit. |
| Available action | The fiscal incident claim has no target screen. `apps/dashboard/src/widgets/alert-format.ts:38` therefore supplies no Go to target. Mark handled calls the incident acknowledgement route (`apps/server/src/alerts-api.ts:129`); it is not a reconciliation or resubmission action. |

Existing library tests exercise the first missing-record reset, the later no-trace incident and
cancellation drift against a fake AEAT service. Existing server tests exercise incident visibility,
permissions and acknowledgement, plus the payment-duty adapter. These are separate checks, not an
end-to-end fiscal reconciliation journey or a live AEAT qualification. The earlier inventory's
screen labels describe where a recorded incident can be displayed; they do not establish a
running fiscal sweep.

**Still open:** specify the fiscal audit's caller, authority and cadence, then provide evidence
inspection and an applicable decision for a persistent mismatch, with any needed sign-in there.
Keep its support wording in scope for that change. Adding a caller would activate existing writes
to submission state and acknowledgements; it needs the fiscal review and landing rules, rather
than being treated as a wording repair. The caller search is source inspection, not a runtime
reachability proof.

**2026-10-29 caller and evidence recheck**, against `9f57a8af1dfe85118e9887747c905efaa8119094`:

The scoped TypeScript/JavaScript search under `apps/`, `packages/`, `scripts/`, `bench/`
and `deploy/` still found direct imports of the fiscal reconciliation function only in its three
library test files. The module-selection function and Stripe payment duty in
`apps/server/src/boot.ts:92`, `:1716` and `:2875` are separate functions.
`packages/fiscal/src/contribution.ts:128` declares the fiscal contribution and its submission
seat, not a reconciliation seat. This source search does not establish runtime unreachability.

`packages/fiscal-verifactu/src/reconcile.ts:140` takes a local period snapshot, then queries
through the client outside the transaction and applies decisions from that snapshot at `:153`.
This is a state-changing operation: `:343` corrects submission state and writes acknowledgements;
`:376` resets a missing accepted row to waiting, clears response metadata, stamps the reset and
`:388` deletes its acknowledgement. The reset stamp is **not evidence that another submission
actually occurred**. The later-missing fixture at
`packages/fiscal-verifactu/src/reconcile.test.ts:284` supplies an accepted state and marker; it does
not exercise a complete reset, send and second-lookup journey. The earlier inventory's “after one
resubmission” description must not be used as proof of that journey.

The query at `reconcile.ts:248` filters by invoice expedition month, not by node or environment.
The result map at `:298` matches references; absent references are skipped. These code observations
leave identity scope, snapshot freshness and concurrent execution to qualify before adding a caller.
The incident payloads at `:413` and `:446` retain a record ID and invoice identity, without the full
query response or local/reported-state snapshots. An alert is a saved classification, not evidence
of the authority's current state. Existing acknowledgement remains separate from recovery.

Unchanged local checks passed: 61 fiscal cases across `reconcile.test.ts`,
`reconcile.period.test.ts`, `acks.test.ts`, `write-path.e2e.test.ts` and `inmutabilidad.test.ts`,
including the 20 protected cases; 64 server cases across alert, alert-API and payment-duty suites.
They exercise fake-authority library behavior and separate alert/payment adapters. They do not
qualify a production fiscal caller, live AEAT, a new inspection screen or persistent repair.

The [concrete inspection and caller-scope proposal](../superpowers/specs/2026-10-29-a1089-fiscal-reconcile-recovery-design.md)
asks whether to plan inspection of already-recorded evidence first, keeping a live fiscal caller
and persistent recovery OPEN, or design an active operator audit and complete decision route first.
Both choices concern planning only. Neither support referral is fixed by this documentation.

### payments

**Charged-but-unsettled and repeated payment-check failures need a recovery route.** Trace the existing pending-payment recovery and reason-specific messages, then offer only confirmed-outcome actions. Never retry a charge or unlock an unknown outcome.

### certificate

2026-10-25: the Venue settings certificate dialog now asks the box's administrator to check
its connection to AEAT before retrying an HTTP or unclassified check failure, in English and
Spanish. It retains the HTTP status and the current-certificate reassurance, and does not assume
a response is temporary from its status alone. The original source audit above records the earlier
wording; certificate checking, installation and refusal classification are unchanged.

**Reopened after the 14:02 owner correction:** replace the administrator referral with applicable
certificate/check/connection choices, offering any needed sign-in there. Keep the current
certificate until a replacement passes its checks; a generic retry does not resolve every cause.

**2026-10-25 self-service rework:** HTTP and unexpected/unknown check refusals now explain the
existing choices in English and Spanish: check the internet connection or choose a different file
or certificate type, Save to check again, or Cancel to stop. The installed certificate is retained
on a check refusal. The dialog already requires `system.manage` for replacement; these choices
introduce no action with additional rights. The guide also explains the unsaved-changes question
when cancelling. Certificate classification, checking and installation are unchanged.

**Still open: persistent AEAT connection/configuration diagnosis.** The dialog has no diagnostic
workflow that distinguishes an operator-correctable connection/configuration failure from a
Waitron fault, or offers its corresponding repair. Build that workflow with any needed sign-in
at the action. Changing the file/type, retrying or cancelling does not establish that every
persistent refusal has a repair. The wording change does not qualify that missing workflow.

#### 2026-10-28 diagnosis audit

The remaining work is a diagnostic workflow, rather than another wording change.
At source revision `1b841a8ff`, the following boundaries were traced:

| Boundary | Observed behavior and receipt |
| --- | --- |
| Check result | `packages/fiscal-verifactu/src/certificate-check.ts:25` reduces transport failures to five refusal reasons. The existing `EPROTO` fixture and a local HTTPS server returning an unparseable HTTP 200 answer both produce `check_failed` (`certificate-check.test.ts:178`, `:203`). Neither result establishes a Waitron bug. |
| HTTP refusal | The local mutual-TLS HTTP 403 case returns `aeat_http` with status 403 (`certificate-check.test.ts:194`). This experiment does not establish the cause of a live AEAT refusal or whether waiting would help. |
| Installation | `packages/fiscal-verifactu/src/certificate-install.ts:207` checks the candidate before its vault write. Its refusal cases compare the saved state before and after (`certificate-install.test.ts:310`, `:335`). This is the replacement flow, not an independent diagnostic action for the installed certificate. |
| Authority | `apps/server/src/fiscal-certificate-api.ts:51` mounts a card read authorised by `fiscal.view`; `:69` mounts replacement authorised by `system.manage`. That route file mounts no separate diagnostic endpoint. |
| Evidence | The refusal log retains reason and optional field (`packages/fiscal-verifactu/src/certificate-install.ts:170`). The HTTP refusal logging test expects the reason alone (`certificate-install.test.ts:619`). Those logged fields do not distinguish the two `check_failed` causes above. |

Executed in the registered `docs/a1089-certificate-diagnosis` worktree:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-check.test.ts src/certificate-install.test.ts src/certificate-install.concurrency.test.ts
# 3 files, 60 tests passed
pnpm --filter @waitron/server exec vitest run src/fiscal-certificate-api.test.ts src/fiscal-certificate-api.verifactu.test.ts
# 2 files, 21 tests passed
```

These existing tests qualify the named local fixtures, installation preservation and route
boundaries. They do not exercise a proposed diagnostic screen, live AEAT, or a host-network
repair. No production code or test assertion changed in this audit.

_2026-10-29 update: the owner approved the read-only build at 08:07. The
certificate-diagnosis branch now includes the module panel, optional route,
isolated child, in-place sign-in and guide twins. Local qualification covers
both material sources and compares database snapshots and write counts after
child exit. Whole-branch review and current-head CI remain pending; persistent
network/configuration and external-refusal repair remain open. The audit and
proposal below retain their original publication state._

The [proposed diagnostic cut](../superpowers/specs/2026-10-28-a1089-aeat-certificate-diagnosis-design.md)
separates observed failures from unproved causes. It awaits the owner's choice between a partial
evidence-first workflow and designing complete recovery first. Persistent repair stays open.

### tls-repair

2026-10-25: the public connection page now names the installer as the next step after a repeated
failure, in English and Spanish, for an initial refusal and a failed repair request. It keeps the
retry action and does not show private server details. The linked-layout checks are unchanged.
Supporting repair of a damaged linked layout remains in **Public TLS repair refuses linked layouts**
in the Box area; the original audit above records the earlier wording.

**Reopened after the 14:02 owner correction:** replace the installer referral with an applicable
connection-repair choice, including the installer-supplied certificate and managed-device
instructions. Keep the linked-layout refusal and public-page privacy; any substantial missing
authenticated repair workflow remains a separate backlog entry.

**2026-10-25 self-service rework:** the public page offers Check again, which reloads its
inspection without running repair, and Stop, which hides the current attempt’s actions without
sending another request. Both wait while a repair is pending. A refused repair explains its limit;
a separately supplied certificate points to the existing HTTPS address and says to stop on a
warning. Device-installation restrictions suggest a venue device that permits installation.
The EN/ES backup-recovery guides follow these choices. Public passwords and private server
error details remain absent in the exercised browser cases.

The substantial [authenticated server-certificate recovery](box.md#authenticated-server-certificate-recovery)
workflow and [linked-layout repair](box.md#public-tls-repair-refuses-linked-layouts) remain OPEN.
This slice does not qualify replacement of an external certificate or repair of a linked layout.

The same rework also removes the older `/setup/trust` page’s installer and administrator
referrals. It offers another venue device if you cannot identify the old certificate or install
its replacement; a separately supplied certificate keeps its HTTPS-address choice and explicit
replacement limit. Linux and Chromebook notes carry the device alternative in both languages.
Without JavaScript, the connection page hides its script-only actions and explains how to enable
them.

### boot-recovery

**Boot recovery must offer choices instead of an installer referral.** Recheck the cause-specific
recovery wording and its actual actions. Give the person applicable restart, space, backup or
reinstall choices, with any required authentication there and a safe Stop before destructive work.
The earlier server-page inventory did not exercise those recovery procedures.

### Backup-key self-service rework, 2026-10-25

The `backup.effective_mismatch` refusal now says the saved key could not be confirmed, asks you
to keep both key records and to stop changing keys, and states that this page cannot diagnose the
conflicting settings or identify which key opens a backup.

The browser cases exercise apply and rotation refusals in both languages. After refusal, the
new key's download remains readable; on rotation, both distinct key downloads remain readable.
Leaving the screen sends no further apply or rotation request in those cases. Existing retry
cases still exercise a later successful submission; that is not evidence that retry corrects a
persistent effective-key conflict.

**Still open:** authenticated inspection and correction of saved versus effective backup-key
configuration, with each choice explained and a safe Stop. Source inspection finds that `statusBody` in
`apps/server/src/backup-api.ts` prefers the saved key's fingerprint; this change does not qualify
a status reload as confirmation of the effective key. No repair of that conflict or opening of
an existing encrypted backup was qualified by this wording change.
