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
| [Public connection](#tls-repair), #2055 | Replace the installer referral with a connection-repair choice the reader can complete. Include installer-supplied certificates and managed-device installation restrictions, which also refer to another person. Retain the separate linked-layout recovery gap and public-page privacy. |
| [Certificate](#certificate), #2056 | Replace the administrator referral with certificate/check/connection choices, preserving the installed certificate. Add sign-in at the action if extra rights are needed. |
| [Backup key](#backup-key), #2058 | Replace the administrator referral with a way to inspect and correct effective configuration. Explain what each key choice does and keep both key records until their use is established. |
| [Setup state](#setup-state) | Offer resume/recovery choices and required authentication. Recheck lane A's A1042 S7l after landing; this lane does not change it. |
| [Setup environment](#setup-environment) | Establish a fresh-start/reinstall choice applicable to this state, with a safe Stop before data loss. Do not improvise a reset of trading data. |
| [Incomplete join](#setup-reset) | Give the person an authenticated retry/restart choice and its outcome if the half-join remains. |
| [Setup readiness](#setup-readiness) | Explain the missing capability or refused source and offer an applicable source/image/recovery choice. Replace administrator referrals in repeated status failures too. |
| [Archive settings](#backup-settings) | Preserve the cause after a failed Save and give the person a setting to correct or a recovery choice. |
| [Bucket stream](#backup-stream) | Give reason-specific settings, restart or ownership choices, with authentication and evidence before resuming a primary. |
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

A1042 S7l's damaged retained recovery note belongs to lane A. Its implementation is excluded.
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

Route: Existing: Box status shows disk use; the boot recovery wording names an installer freeing space or fitting a bigger disk. Missing: a supported self-service cleanup path for a person without a terminal. Never delete fiscal data or unrelated shared state.

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

State: Saved setup/owner data cannot be parsed or checked, or a protected read fails. Corruption and filesystem errors are not proved to be bug-only. Receipt: `packages/provisioning/src/durable-host-json.ts:15`; `packages/provisioning/src/first-setup-owner.ts:131`; `apps/setup/src/setup-app.ts:200`.

Route: A1042 S7l is reserved to lane A. Track its released behavior before changing this wording or offering Start again. This audit leaves that implementation untouched.

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

Route: Missing: distinguish temporary preparation from unsupported/unavailable recovery and retained-file refusal. Offer a supported source or administrator recovery route. The A1042 branch changes some of these paths; recheck it after landing.

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
| `cloud.busy`, dashboard connection | `apps/server/src/cloud-replacement.ts:77` removes its active marker in `finally`; `apps/server/src/cloud-client.ts:313` waits for an active operation. | Temporary local concurrency on these callers. The durable lock in `cloud-fiscal-allocation.ts:197` has no caller established by this audit; do not turn that isolated function into a user-visible defect by assumption. |
| `alert.source_unavailable`, dashboard bell | `apps/server/src/alerts.ts:130` preserves a failed source as an alert; `apps/dashboard/src/api/query-controller.ts:45` sets a one-minute refresh. | Another read is scheduled in an open dashboard. A persistent underlying failure still needs diagnosis; this is no guarantee of repair. |
| `fiscal_test.uncertain`, setup | `packages/provisioning/src/fiscal-readiness-runner.ts:140` calls the fiscal drain and returns uncertain on a throw or unsettled result; `packages/provisioning/src/fiscal-readiness.ts:106` invokes submit again without accepted evidence. | Retry is an operation, not just waiting. No deterministic permanent cause was established for this message. |
| `payments.stuck.unknown_unreachable`, dashboard | `apps/dashboard/src/screens/payments-screen.ts:67` uses the unreachable reason; `:68` gives an ambiguous answer different guidance. | A network retry can help; preserve the reason distinction. |
| `shell.connection.server_problem`, setup; `connection.timed_out`, dashboard | `apps/setup/src/setup-app.ts:438` groups any answered non-404 HTTP refusal; `packages/dashboard-kit/src/request.ts:35` bounds reads. | Mixed/unknown causes. A timeout can end on retry; repeated setup status refusal needs an administrator next step, not a promise that waiting repairs it. Include this setup fallback in setup-readiness. |
| Generic read/write, SMTP, invoice delivery and printer retry messages | Examples: `apps/setup/src/i18n/strings/venue.ts:29`; `apps/till/src/i18n/strings.ts:1674`; `apps/dashboard/src/i18n/strings.ts:707`. | Included in the broad scan. An unsuccessful request alone does not prove waiting is futile; no universal bug-only or successful-retry claim is made. |
| Unknown code fallback, dashboard and till | `packages/dashboard-kit/src/codes.ts:16`; `packages/dashboard-kit/src/strings.ts:1`; `apps/till/src/i18n/codes.ts:785`. | “Something went wrong, try again” can conceal an unmapped persistent code. Treat each demonstrated mapping as its own fix; this inventory does not establish every possible throw reaching every screen. |

## Server pages and guides

`apps/server/src/recovery-surface.ts` has no literal “contact support”. Its database-ahead/schema
rows name backup/reinstall, its disk-full row names freeing space or a bigger disk, and its unknown
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

**Setup state refusals need a usable resume or recovery route.** Recheck A1042 S7l on main first. Handle retained-operation mismatch and damaged setup without directing the owner to support; keep operation ownership and fiscal evidence.

### setup-environment

**A different-environment partial setup needs an applicable fresh-start route.** Distinguish this from the authenticated half-adopt reset. Establish the safe fresh-server/reinstall action before offering it.

### setup-reset

**An incomplete-join reset needs an outcome after a failed restart.** Retain authenticated reset proof and add a supported way to retry or restart if the half-join remains.

### setup-readiness

**Setup and backup recovery must distinguish waiting from missing capability.** Separate absent callbacks/services and incompatible or refused retained artifacts from temporary work; offer a supported source, image or recovery choice and any required sign-in there.

### sign-in

2026-10-25: the shared passkey refusal now asks your administrator to check your account, in English and Spanish. The login browser cases exercise the refusal followed by password sign-in in both languages. This wording applies to profile passkey registration too; it makes no claim about account status. The original audit above records the earlier wording. See [account access](../../apps/server/src/guide/en/staff.md#account-access).

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

**Unusable archive settings need a next step after resaving fails.** Keep the existing Save route and preserve the underlying non-secret refusal instead of escalating every repeat to support.

### backup-stream

**A stopped or refused bucket stream needs safe settings, restart or ownership choices.** Distinguish bad settings, unavailable process and conflicting writer; do not suggest resuming an unauthorised primary. Offer any required sign-in there and build a missing restart/ownership workflow separately.

### backup-state

**A failed sealed-state refresh needs its cause and a retry route.** Expose a safe cause, offer a correction and any required sign-in there, and recheck that sealing succeeds. Do not promise current recovery keys before success.

### backup-preparation

**Backup preparation refusals need disk and missing-file remedies.** Replace both named backup_stop support substitutions and its generic fallback. Establish safe cleanup/recovery for each cause; no blanket deletion or replacement private keys.

### backup-key

2026-10-25: the Backups refusal now asks the box's administrator to check its backup configuration
before retrying, in English and Spanish. The browser cases exercise both applying settings and
changing the key, retaining the displayed status after refusal and allowing a subsequent successful
submission. The [recovery guide](../../apps/server/src/guide/en/backup-recovery.md#proof) tells you to
keep both key records; the refusal does not establish which key opens a backup. Key persistence,
effective-key checks and status handling are unchanged. The original source audit above records
the earlier wording.

**Reopened after the 14:02 owner correction:** replace the administrator referral with inspection
and correction of the effective backup configuration, offering any needed sign-in there. Keep the
key-use uncertainty explicit and a safe Stop for a change that could lose access to a backup.

### restore-start

**A repeated restored-box first-start failure needs a specific remedy.** Keep the existing restart attempt and identify a persistent completion refusal before suggesting another action.

### fiscal-integrity

**Fiscal integrity and validation alerts need evidence-preserving next steps.** Replace support-only guidance without editing records or treating every warning as a proven Waitron bug. A substantial missing recovery workflow requires an owner decision.

### fiscal-cases

**Fiscal filing-case alerts need a real decision route.** Use W41s-8/W41s-9 when released, or keep the missing workflow explicit. Rejections, cancellations, duplicate conflicts and repeated refusals cannot be fixed by an invented retry screen.

### fiscal-reply

**A fiscal reply-line mismatch needs accurate retry and evidence choices.** Describe only the drain behavior actually exercised, then offer evidence inspection and a decision path for persistent malformed replies, with any required sign-in there.

### fiscal-environment

**Fiscal environment refusals need safe configuration or recovery guidance.** Separate a wrong host environment from missing immutable metadata. Never relabel records, promote test data or reset invoice numbering.

### fiscal-reconcile

**Reconciliation support wording needs a verified caller and remedy.** First establish where the reconciliation alerts can reach an owner; then give an evidence/decision route without promising an unimplemented periodic sweep.

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
The earlier audit and milestone above retain their historical wording.

The same rework also removes the older `/setup/trust` page’s installer and administrator
referrals. It offers another venue device if you cannot identify the old certificate or install
its replacement; a separately supplied certificate keeps its HTTPS-address choice and explicit
replacement limit. Linux and Chromebook notes carry the device alternative in both languages.
Without JavaScript, the connection page hides its script-only actions and explains how to enable
them. Tests cover a changed inspection after Check again and both pending repair and Reconnect.

### boot-recovery

**Boot recovery must offer choices instead of an installer referral.** Recheck the cause-specific
recovery wording and its actual actions. Give the person applicable restart, space, backup or
reinstall choices, with any required authentication there and a safe Stop before destructive work.
The earlier server-page inventory did not exercise those recovery procedures.
