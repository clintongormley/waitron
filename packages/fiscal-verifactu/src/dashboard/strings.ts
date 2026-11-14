import { makeT, registerCatalogue, registerCodeMessages } from "@waitron/dashboard-kit";

const en = {
  "aeat_certificate.diagnosis.title": "Diagnose connection",
  "aeat_certificate.diagnosis.source": "Certificate to inspect",
  "aeat_certificate.diagnosis.installed": "Installed certificate",
  "aeat_certificate.diagnosis.candidate": "Selected replacement, not installed",
  "aeat_certificate.diagnosis.confirm": "Confirm selected source",
  "aeat_certificate.diagnosis.inspect": "Read again",
  "aeat_certificate.diagnosis.check": "Run check",
  "aeat_certificate.diagnosis.again": "Check again",
  "aeat_certificate.diagnosis.stop": "Stop",
  "aeat_certificate.diagnosis.revision_changed":
    "The installed certificate changed. Stop and reload the saved card, then reopen diagnosis and confirm the source. Nothing was changed by this check.",
  "aeat_certificate.diagnosis.reload_card": "Stop and reload saved card",
  "aeat_certificate.diagnosis.edit": "Edit selected file or type",
  "aeat_certificate.diagnosis.sign_in": "Sign in with permission to manage the system",
  "aeat_certificate.diagnosis.authority":
    "Sign in to inspect this certificate. Sign-in can change the dashboard account. You will need to choose the file and enter its passphrase again.",
  "aeat_certificate.diagnosis.missing_authority": "This account cannot inspect certificates.",
  "aeat_certificate.diagnosis.unread": "Not yet read",
  "aeat_certificate.diagnosis.environment": "Configured environment",
  "aeat_certificate.diagnosis.destination": "Configured destination",
  "aeat_certificate.diagnosis.kind": "Current material type",
  "aeat_certificate.diagnosis.saved": "Saved installation record",
  "aeat_certificate.diagnosis.unverified":
    "This saved record has not been verified against the current material.",
  "aeat_certificate.diagnosis.verified":
    "The current material matches the saved installation record.",
  "aeat_certificate.diagnosis.no_saved": "No saved installation record.",
  "aeat_certificate.diagnosis.observed": "Observed",
  "aeat_certificate.diagnosis.cause": "Cause",
  "aeat_certificate.diagnosis.choices": "Available choices",
  "aeat_certificate.diagnosis.cause_unknown": "The cause is not established. Nothing was changed.",
  "aeat_certificate.diagnosis.http":
    "The check received HTTP {status}. The cause is not established. Nothing was changed.",
  "aeat_certificate.diagnosis.query":
    "This query completed at {time} using the selected material. Nothing was installed. This does not establish whether a future filing will succeed.",
  "aeat_certificate.diagnosis.repair": "Repair is not available in this panel.",
  "aeat_certificate.diagnosis.intro":
    "Opening this panel sends no query. Read again inspects the selected material locally. Run check sends one read-only query; it files no invoice and installs nothing.",
  "aeat_certificate.diagnosis.busy": "Inspecting selected material…",
  "aeat_certificate.diagnosis.unavailable":
    "The result is unavailable. No remote cause has been established. Choose Read again for a new inspection.",
  "aeat_certificate.diagnosis.copy": "Copy evidence",
  "aeat_certificate.diagnosis.copied": "Evidence copied.",
  "aeat_certificate.diagnosis.copy_failed": "The browser could not copy the evidence.",
  "aeat_certificate.diagnosis.preproduction": "Preproduction",
  "aeat_certificate.diagnosis.production": "Production",
  "aeat_certificate.diagnosis.no_candidate":
    "Choose the replacement file and enter its passphrase. Installed material is never substituted.",
  "aeat_certificate.diagnosis.local-ready":
    "The selected material passed the local checks. No network query was sent.",
  "aeat_certificate.diagnosis.local-finding":
    "The local checks found a problem with the selected material.",
  "aeat_certificate.diagnosis.name-lookup-failed": "The destination name could not be resolved.",
  "aeat_certificate.diagnosis.connection-refused": "The connection was refused.",
  "aeat_certificate.diagnosis.deadline-elapsed": "The check reached its time limit.",
  "aeat_certificate.diagnosis.connection-closed":
    "The connection closed before the check completed.",
  "aeat_certificate.diagnosis.tls-protocol-failed": "The secure connection failed.",
  "aeat_certificate.diagnosis.http-response": "An HTTP response was received.",
  "aeat_certificate.diagnosis.soap-fault": "A structured SOAP refusal was received.",
  "aeat_certificate.diagnosis.reply-unparseable": "The reply could not be read.",
  "aeat_certificate.diagnosis.reply-too-large": "The reply exceeded the size limit.",
  "aeat_certificate.diagnosis.cancelled": "The check was cancelled.",
  "aeat_certificate.diagnosis.unknown": "The check did not establish an observation.",

  "aeat_certificate.title": "AEAT certificate",
  "aeat_certificate.issued_to": "Issued to",
  "aeat_certificate.tax_id": "Tax ID",
  "aeat_certificate.type": "Type",
  "aeat_certificate.issued_by": "Issued by",
  "aeat_certificate.valid_from": "Valid from",
  "aeat_certificate.valid_until": "Valid until",
  "aeat_certificate.installed": "Installed",
  "aeat_certificate.last_accepted": "Last accepted filing",
  "aeat_certificate.matches": "matches the business",
  "aeat_certificate.does_not_match": "does not match the business",
  "aeat_certificate.no_tax_id": "not shown on the certificate",
  "aeat_certificate.days_left": "{days} days left",
  "aeat_certificate.expires_tomorrow": "Expires tomorrow, {time}",
  "aeat_certificate.expires_today": "Expires today, {time}",
  "aeat_certificate.expired_on": "Expired on {date}",
  "aeat_certificate.during_setup": "during setup",
  "aeat_certificate.not_recorded": "not recorded",
  "aeat_certificate.none_since_installed": "None since it was installed",
  "aeat_certificate.replace": "Replace certificate",
  "aeat_certificate.install": "Install certificate",
  "aeat_certificate.none_installed": "No certificate installed. Fiscal records wait until one is.",
  "aeat_certificate.not_filing":
    "This box does not send records to AEAT, so it needs no certificate.",
  "aeat_certificate.warning_sello":
    "This certificate expires on {date}. Ask FNMT for the new one now: a new seal can take weeks.",
  "aeat_certificate.warning_representante":
    "This certificate expires on {date}. Get the new one from FNMT before then.",
  "aeat_certificate.urgent":
    "This certificate expires in {days} days. After that, fiscal records wait until a new one is installed. Sales are not affected.",
  "aeat_certificate.urgent_tomorrow":
    "This certificate expires tomorrow at {time}. After that, fiscal records wait until a new one is installed. Sales are not affected.",
  "aeat_certificate.urgent_today":
    "This certificate expires today at {time}. After that, fiscal records wait until a new one is installed. Sales are not affected.",
  "aeat_certificate.expired":
    "This certificate expired on {date}. Sales continue, but fiscal records wait until you install a new one.",
  "aeat_certificate.installed_line":
    "Installed. AEAT answered a check with this certificate at {time}. The next filing will use it.",
  "aeat_certificate.kind.sello": "Company seal (sello)",
  "aeat_certificate.kind.representante": "Representative (representante)",
  "aeat_certificate.dialog.title": "Replace AEAT certificate",
  "aeat_certificate.dialog.intro":
    "Waitron checks the new certificate with AEAT before it replaces the current one. Sales are not affected.",
  "aeat_certificate.dialog.file_label": "Certificate file (.pfx or .p12)",
  "aeat_certificate.dialog.file_drop": "Drop the certificate file here",
  "aeat_certificate.dialog.file_choose": "Choose file",
  "aeat_certificate.dialog.file_replace": "Choose another file",
  "aeat_certificate.dialog.file_preview": "Certificate file",
  "aeat_certificate.dialog.passphrase_label": "Certificate passphrase",
  "aeat_certificate.dialog.passphrase_required": "Enter the certificate passphrase.",
  "aeat_certificate.dialog.show_passphrase": "Show certificate passphrase",
  "aeat_certificate.dialog.hide_passphrase": "Hide certificate passphrase",
  "aeat_certificate.dialog.kind_label": "Certificate type",
  "aeat_certificate.dialog.fix_fields": "Correct the highlighted fields to continue.",
  "aeat_certificate.dialog.cancel": "Cancel",
  "aeat_certificate.dialog.save": "Save",
  "aeat_certificate.dialog.busy": "Checking with AEAT…",
  "aeat_certificate.refused.too_large": "This file is too large to be a certificate.",
  "aeat_certificate.refused.unreadable":
    "Waitron cannot read this file. Choose the .pfx or .p12 file.",
  "aeat_certificate.refused.old_encryption":
    "This file uses an old encryption. Export it again with current encryption (AES).",
  "aeat_certificate.refused.no_private_key":
    "This file has no private key. Export it again with the private key.",
  "aeat_certificate.refused.passphrase_wrong": "This passphrase does not open the file.",
  "aeat_certificate.refused.expired": "This certificate expired on {date}.",
  "aeat_certificate.refused.not_yet_valid": "This certificate is valid only from {date}.",
  "aeat_certificate.refused.same": "This certificate is already installed.",
  "aeat_certificate.refused.other_taxpayer":
    "This certificate is for tax ID {nif}, not {taxpayerNif}.",
  "aeat_certificate.refused.unreachable":
    "Waitron could not reach AEAT. The current certificate is unchanged. Check the internet connection, then try again.",
  "aeat_certificate.refused.closed":
    "AEAT closed the connection, so it may have refused this certificate. The current certificate is unchanged. Check the certificate type, then try again.",
  "aeat_certificate.refused.aeat_fault":
    "AEAT answered with an error: {faultCode} {faultReason}. The current certificate is unchanged.",
  "aeat_certificate.refused.aeat_http":
    "AEAT answered with HTTP error {status}. The current certificate is unchanged. Check the internet connection or choose another file or certificate type. Select Save to check again, or Cancel to stop.",
  "aeat_certificate.refused.check_failed":
    "The check with AEAT failed for an unexpected reason. The current certificate is unchanged. Check the internet connection or choose another file or certificate type. Select Save to check again, or Cancel to stop.",
  "nav.fiscal_filing": "Fiscal filing",
  "fiscal_filing.title": "Fiscal filing",
  "fiscal_filing.intro":
    "How this box's invoice records are being sent to AEAT, and which ones need a decision.",
  "fiscal_filing.read_at": "Read at {time}",
  "fiscal_filing.refresh": "Refresh",
  "fiscal_filing.export": "Export these cases for your tax adviser",
  "fiscal_filing.not_filing": "This box does not send invoice records to AEAT.",
  "fiscal_filing.awaiting_certificate":
    "Nothing can be sent until the tax agency's certificate is installed.",
  "fiscal_filing.conflict.stopped":
    "This box has stopped issuing invoices because of an identity conflict. Recovering needs the server key.",
  "fiscal_filing.conflict.open": "Open conflict recovery",
  "fiscal_filing.conflict.reply.fiscal.huella_divergente":
    "AEAT already holds a different record for invoice {number}, so it refused this box's record.",
  "fiscal_filing.conflict.reply.fiscal.duplicado_anulado":
    "AEAT holds invoice {number} as cancelled, so it refused this box's record.",
  "fiscal_filing.conflict.lookup":
    "AEAT holds invoice {number} as {state}, and its details do not match this box's record.",
  "fiscal_filing.conflict.lookup_unknown":
    "AEAT holds invoice {number}, and its details do not match this box's record.",
  "fiscal_filing.conflict.state.Correcto": "accepted",
  "fiscal_filing.conflict.state.AceptadoConErrores": "accepted with errors",
  "fiscal_filing.conflict.state.Anulado": "cancelled",
  "fiscal_filing.conflict.status": "AEAT's status",
  "fiscal_filing.conflict.reply_words": "AEAT's reply",
  "fiscal_filing.conflict.fingerprint": "AEAT's fingerprint",
  "fiscal_filing.conflict.series": "AEAT holds invoice {number}; this box did not issue it.",
  "fiscal_filing.conflict.cancelled": "Invoice {number}: AEAT lists it as cancelled.",
  "fiscal_filing.conflict.no_evidence": "Invoice {number}: AEAT's answer was not kept.",
  "fiscal_filing.conflict.seen": "Found {time}",
  "fiscal_filing.progress": "Sending progress",
  "fiscal_filing.state.pendiente": "Waiting",
  "fiscal_filing.state.enviando": "Sending",
  "fiscal_filing.state.aceptado": "Accepted",
  "fiscal_filing.state.aceptado_con_errores": "Accepted with errors",
  "fiscal_filing.state.rechazado": "Refused",
  "fiscal_filing.state.detenido": "Held",
  "fiscal_filing.state.retenido": "Set aside",
  "fiscal_filing.oldest_waiting": "Oldest waiting",
  "fiscal_filing.last_accepted": "Last accepted",
  "fiscal_filing.none": "None",
  "fiscal_filing.cases": "Filing cases",
  "fiscal_filing.held_without_case": "Held with no case: {count}",
  "fiscal_filing.warnings": "Warnings",
  "fiscal_filing.warnings.none": "No open warnings.",
  "fiscal_filing.warnings.bounded":
    "Showing the newest {shown} of {total}. Export them to see every one.",
  "fiscal_filing.warnings.reply": "AEAT answers that did not match what was sent",
  "fiscal_filing.warnings.reply.line":
    "AEAT's answer to {sent} records sent together had a different number of lines ({lines}), so Waitron applied none of them.",
  "fiscal_filing.warnings.reply.seen": "Seen {time}",
  "fiscal_filing.warnings.reply.now":
    "When this answer arrived, Waitron applied none of AEAT's lines and put each record back to be sent again, except any already on hold, which stayed on hold. Each record's state now is under Technical details.",
  "fiscal_filing.warnings.reply.csv": "Submission code (CSV)",
  "fiscal_filing.warnings.reply.sent": "Records sent",
  "fiscal_filing.warnings.reply.lines": "AEAT's lines",
  "fiscal_filing.warnings.reply.first":
    "These are the lines AEAT gave the first time while this warning is open; a later answer may differ.",
  "fiscal_filing.warnings.record": "Invoices with a warning from Waitron's own check",
  "fiscal_filing.warnings.record.totals":
    "The totals of invoice {number} ({date}) do not match its tax lines. AEAT accepts it; check that sale's prices.",
  "fiscal_filing.warnings.record.flagged":
    "Invoice {number} ({date}) has something AEAT accepts but may point out.",
  "fiscal_filing.warnings.record.totals_unknown":
    "An invoice recorded at {time} has totals that do not match its tax lines. AEAT accepts it; check that sale's prices.",
  "fiscal_filing.warnings.record.flagged_unknown":
    "An invoice recorded at {time} has something AEAT accepts but may point out.",
  "fiscal_filing.warnings.record.fields": "Fields and check codes",
  "fiscal_filing.history": "Possibly missing history",
  "fiscal_filing.history.not_issued": "Invoices AEAT holds that this box did not issue",
  "fiscal_filing.history.not_issued.line":
    "AEAT holds invoice {number} ({date}); this box did not issue it.",
  "fiscal_filing.history.not_issued.series": "Series {series}",
  "fiscal_filing.history.not_issued.system": "Invoicing system (as AEAT holds it)",
  "fiscal_filing.history.not_issued.none": "None found.",
  "fiscal_filing.history.identity": "Identity changes without a handover",
  "fiscal_filing.history.identity.line":
    "The fiscal identity changed from {earlier} to {new} without a handover. The last invoice this box holds under {earlier} is {number}. Invoices under {earlier} that this box does not hold may exist.",
  "fiscal_filing.history.identity.line_none_held":
    "The fiscal identity changed from {earlier} to {new} without a handover. This box holds no invoice under {earlier}. Invoices under {earlier} that this box does not hold may exist.",
  "fiscal_filing.history.identity.invoice": "{number} ({date})",
  "fiscal_filing.history.identity.changed": "Changed {time}",
  "fiscal_filing.history.identity.none": "The fiscal identity has not changed without a handover.",
  "fiscal_filing.cases.none": "No case needs a decision.",
  "fiscal_filing.cases.bounded": "The newest {shown} of {total}",
  "fiscal_filing.cases.open_to_put_right": "Open a case to see whether Waitron can put it right.",
  "fiscal_filing.cases.range": "{from}–{to} of {total}",
  "fiscal_filing.cases.previous": "Previous page",
  "fiscal_filing.cases.next": "Next page",
  "fiscal_filing.column.opened": "Opened",
  "fiscal_filing.column.invoice": "Invoice",
  "fiscal_filing.column.reason": "Reason",
  "fiscal_filing.column.code": "AEAT code",
  "fiscal_filing.column.held": "Held behind it",
  "fiscal_filing.column.actions": "Actions",
  "fiscal_filing.view": "View",
  "fiscal_filing.close": "Close",
  "fiscal_filing.put_right.heading": "Correct the description",
  "fiscal_filing.put_right.intro":
    "AEAT refused this record's operation description. Write it again and send a correction record: the invoice keeps its number and amounts.",
  "fiscal_filing.put_right.aeat": "AEAT said",
  "fiscal_filing.put_right.description": "Operation description",
  "fiscal_filing.put_right.description_required": "Write the operation description.",
  "fiscal_filing.put_right.description_too_long": "Keep the description to 500 characters.",
  "fiscal_filing.put_right.description_control":
    "Remove the invisible character AEAT does not accept; it may have come with pasted text.",
  "fiscal_filing.put_right.fix_fields": "Correct the field marked above.",
  "fiscal_filing.put_right.send": "Send the correction",
  "fiscal_filing.put_right.sending": "Sending…",
  "fiscal_filing.put_right.stop": "Stop",
  "fiscal_filing.put_right.sign_in": "Sign in as an administrator to put this right",
  "fiscal_filing.put_right.none.not-yet":
    "Waitron cannot put this one right yet. The case stays open.",
  "fiscal_filing.put_right.none.full-invoice":
    "Waitron cannot put this one right yet: a full invoice needs a corrective invoice Waitron cannot issue yet.",
  "fiscal_filing.refused.signed_out": "You are signed out. Sign in again, then send again.",
  "fiscal_filing.refused.admin":
    "Only an administrator can put this right. Sign in as one with the button below.",
  "fiscal_filing.refused.fresh_sign_in":
    "Waitron needs you to sign in again before sending this. Send again to be asked.",
  "fiscal_filing.refused.clock_unconfirmed":
    "The server is waiting for its time to be confirmed. Confirm it on a till or on the Box status page, then send again.",
  "fiscal_filing.refused.clock_behind":
    "The server's clock reads earlier than its newest invoice, so nothing was sent. Confirm the time on the Box status page, then send again.",
  "fiscal_filing.refused.clock_unusable":
    "The server's clock is wrong, so nothing was sent. With the internet the server puts it right by itself; otherwise set it on the Box status page, then send again.",
  "fiscal_filing.refused.time_zone":
    "The venue's time zone is not ready, so nothing was sent. Check it in Venue settings, then send again.",
  "fiscal_filing.refused.not_main":
    "This server no longer files the venue's invoices. Open this page on the server that does.",
  "fiscal_filing.refused.changed":
    "This case was already put right, or it changed; nothing more was sent.",
  "fiscal_filing.refused.not_sent":
    "Waitron could not send this correction, so nothing was sent. This is a fault in Waitron; the case stays open.",
  "fiscal_filing.refused.disk_full":
    "The server's disk is full, so nothing was sent. Follow the disk alert, then send again.",
  "fiscal_filing.refused.record_invalid":
    "The correction record failed Waitron's own check, so nothing was sent. This is a fault in Waitron; the case stays open.",
  "fiscal_filing.refused.fingerprint":
    "The fingerprint check of the server's invoice records failed, so nothing was sent. This is a fault in Waitron; the case stays open.",
  "fiscal_filing.refused.try_again":
    "The server could not add the correction to its invoice records this time, so nothing was sent. Send again.",
  "fiscal_filing.refused.setup":
    "The server found a problem with its own invoicing setup, so nothing was sent. This is a fault in Waitron; the case stays open.",
  "fiscal_filing.cause.fiscal.registro_rechazado": "Refused",
  "fiscal_filing.cause.fiscal.aceptado_con_errores": "Accepted with errors",
  "fiscal_filing.cause.fiscal.anulacion_retenida": "Cancellation set aside",
  "fiscal_filing.cause.fiscal.huella_divergente": "AEAT holds a different record",
  "fiscal_filing.cause.fiscal.duplicado_anulado": "Cancelled at AEAT",
  "fiscal_filing.now.fiscal.registro_rechazado":
    "Later records are still sent. After three refusals in a row with the same code, the records after them are held and the first is tried again every hour.",
  "fiscal_filing.now.fiscal.aceptado_con_errores":
    "AEAT stored this record and counts it as accepted, with the error above.",
  "fiscal_filing.now.fiscal.anulacion_retenida":
    "This cancellation is not sent, because AEAT refused the invoice it cancels. It holds nothing behind it.",
  "fiscal_filing.now.fiscal.huella_divergente": "This record is refused and is not sent again.",
  "fiscal_filing.now.fiscal.duplicado_anulado":
    "AEAT holds this invoice as cancelled, so this record is refused and is not sent again.",
  "fiscal_filing.now.lookup":
    "Found by looking the invoice up at AEAT. Looking it up does not change how this record is sent.",
  "fiscal_filing.now.stopped": "While the conflict is active, this box issues no invoices.",
  "fiscal_filing.detail.invoice": "Invoice",
  "fiscal_filing.detail.issuer": "Issuer tax number",
  "fiscal_filing.detail.kind": "What it is",
  "fiscal_filing.kind.F1": "A full invoice that names the customer.",
  "fiscal_filing.kind.F2": "A simplified invoice: a till receipt that names no customer.",
  "fiscal_filing.kind.F3": "A full invoice that replaces earlier simplified invoices.",
  "fiscal_filing.kind.corrective": "An invoice that corrects an earlier one.",
  "fiscal_filing.kind.anulacion": "A cancellation of an earlier invoice.",
  "fiscal_filing.kind.other": "An invoice record.",
  "fiscal_filing.detail.state": "Where it stands",
  "fiscal_filing.record_state.pendiente": "Waiting to be sent to AEAT.",
  "fiscal_filing.record_state.enviando": "Being sent to AEAT now.",
  "fiscal_filing.record_state.aceptado": "AEAT accepted it.",
  "fiscal_filing.record_state.aceptado_con_errores": "AEAT accepted it and pointed out an error.",
  "fiscal_filing.record_state.rechazado": "AEAT refused it.",
  "fiscal_filing.record_state.detenido": "Held back: not sent for now.",
  "fiscal_filing.record_state.retenido": "Set aside: not sent.",
  "fiscal_filing.detail.recorded": "Recorded",
  "fiscal_filing.technical": "Technical details",
  "fiscal_filing.detail.record_code": "Record type (AEAT code)",
  "fiscal_filing.detail.invoice_code": "Invoice type (AEAT code)",
  "fiscal_filing.detail.then_code": "AEAT's code when the case opened",
  "fiscal_filing.detail.latest_code": "AEAT's latest code",
  "fiscal_filing.detail.total": "Total",
  "fiscal_filing.detail.total_value": "{total}, including {tax} VAT",
  "fiscal_filing.detail.generated": "Generated",
  "fiscal_filing.detail.installation": "Installation",
  "fiscal_filing.detail.fingerprint": "Fingerprint",
  "fiscal_filing.detail.previous": "Previous fingerprint",
  "fiscal_filing.detail.then": "AEAT's reply when the case opened",
  "fiscal_filing.detail.latest": "AEAT's latest reply",
  "fiscal_filing.detail.sent": "sent {time}",
  "fiscal_filing.detail.observations": "What AEAT said about this invoice",
  "fiscal_filing.detail.observation": "Attempt {attempt}, {time}: {state} {code} {description}",
  "fiscal_filing.detail.lookup": "Lookup, {time}: AEAT holds it as {state}",
  "fiscal_filing.detail.theirs": "AEAT's fingerprint: {fingerprint}",
  "fiscal_filing.detail.ours": "This box's fingerprint: {fingerprint}",
  "fiscal_filing.detail.now": "What happens now",
} as const;

export type AeatCertificateKey = keyof typeof en;

const es: Record<AeatCertificateKey, string> = {
  "aeat_certificate.diagnosis.title": "Diagnosticar conexión",
  "aeat_certificate.diagnosis.source": "Certificado que se va a inspeccionar",
  "aeat_certificate.diagnosis.installed": "Certificado instalado",
  "aeat_certificate.diagnosis.candidate": "Sustitución elegida, sin instalar",
  "aeat_certificate.diagnosis.confirm": "Confirmar el certificado elegido",
  "aeat_certificate.diagnosis.inspect": "Volver a leer",
  "aeat_certificate.diagnosis.check": "Comprobar",
  "aeat_certificate.diagnosis.again": "Comprobar de nuevo",
  "aeat_certificate.diagnosis.stop": "Parar",
  "aeat_certificate.diagnosis.revision_changed":
    "El certificado instalado ha cambiado. Para y recarga la ficha guardada; después, abre el diagnóstico y confirma el origen. Esta comprobación no ha cambiado nada.",
  "aeat_certificate.diagnosis.reload_card": "Parar y recargar la ficha guardada",
  "aeat_certificate.diagnosis.edit": "Cambiar archivo o tipo",
  "aeat_certificate.diagnosis.sign_in": "Iniciar sesión con permiso para gestionar el sistema",
  "aeat_certificate.diagnosis.authority":
    "Inicia sesión para inspeccionar este certificado. Esto puede cambiar la cuenta del panel. Tendrás que elegir de nuevo el archivo e introducir su contraseña.",
  "aeat_certificate.diagnosis.missing_authority": "Esta cuenta no puede inspeccionar certificados.",
  "aeat_certificate.diagnosis.unread": "Aún no se ha leído",
  "aeat_certificate.diagnosis.environment": "Entorno configurado",
  "aeat_certificate.diagnosis.destination": "Destino configurado",
  "aeat_certificate.diagnosis.kind": "Tipo del certificado actual",
  "aeat_certificate.diagnosis.saved": "Registro de instalación guardado",
  "aeat_certificate.diagnosis.unverified":
    "Este registro guardado no se ha verificado con el certificado actual.",
  "aeat_certificate.diagnosis.verified":
    "El certificado actual coincide con el registro de instalación guardado.",
  "aeat_certificate.diagnosis.no_saved": "No hay un registro de instalación guardado.",
  "aeat_certificate.diagnosis.observed": "Observado",
  "aeat_certificate.diagnosis.cause": "Causa",
  "aeat_certificate.diagnosis.choices": "Opciones",
  "aeat_certificate.diagnosis.cause_unknown":
    "No se ha determinado la causa. No se ha cambiado nada.",
  "aeat_certificate.diagnosis.http":
    "La comprobación recibió HTTP {status}. No se ha determinado la causa. No se ha cambiado nada.",
  "aeat_certificate.diagnosis.query":
    "Esta consulta terminó a las {time} con el certificado elegido. No se ha instalado nada. Esto no determina si un envío futuro tendrá éxito.",
  "aeat_certificate.diagnosis.repair": "La reparación no está disponible en este panel.",
  "aeat_certificate.diagnosis.intro":
    "Abrir este panel no envía ninguna consulta. Volver a leer inspecciona el certificado localmente. Comprobar envía una consulta de solo lectura; no registra facturas ni instala nada.",
  "aeat_certificate.diagnosis.busy": "Inspeccionando el certificado elegido…",
  "aeat_certificate.diagnosis.unavailable":
    "El resultado no está disponible. No se ha determinado ninguna causa remota. Elige Volver a leer para iniciar otra inspección.",
  "aeat_certificate.diagnosis.copy": "Copiar datos observados",
  "aeat_certificate.diagnosis.copied": "Datos copiados.",
  "aeat_certificate.diagnosis.copy_failed": "El navegador no ha podido copiar los datos.",
  "aeat_certificate.diagnosis.preproduction": "Preproducción",
  "aeat_certificate.diagnosis.production": "Producción",
  "aeat_certificate.diagnosis.no_candidate":
    "Elige el archivo de sustitución e introduce su contraseña. Nunca se sustituye por el certificado instalado.",
  "aeat_certificate.diagnosis.local-ready":
    "El certificado elegido ha pasado las comprobaciones locales. No se ha enviado ninguna consulta de red.",
  "aeat_certificate.diagnosis.local-finding":
    "Las comprobaciones locales han encontrado un problema con el certificado elegido.",
  "aeat_certificate.diagnosis.name-lookup-failed":
    "No se ha podido resolver el nombre del destino.",
  "aeat_certificate.diagnosis.connection-refused": "Se ha rechazado la conexión.",
  "aeat_certificate.diagnosis.deadline-elapsed":
    "La comprobación ha alcanzado su límite de tiempo.",
  "aeat_certificate.diagnosis.connection-closed":
    "La conexión se ha cerrado antes de terminar la comprobación.",
  "aeat_certificate.diagnosis.tls-protocol-failed": "Ha fallado la conexión segura.",
  "aeat_certificate.diagnosis.http-response": "Se ha recibido una respuesta HTTP.",
  "aeat_certificate.diagnosis.soap-fault": "Se ha recibido un rechazo SOAP estructurado.",
  "aeat_certificate.diagnosis.reply-unparseable": "No se ha podido leer la respuesta.",
  "aeat_certificate.diagnosis.reply-too-large": "La respuesta superó el límite de tamaño.",
  "aeat_certificate.diagnosis.cancelled": "Se ha cancelado la comprobación.",
  "aeat_certificate.diagnosis.unknown": "La comprobación no ha establecido ninguna observación.",

  "aeat_certificate.title": "Certificado de la AEAT",
  "aeat_certificate.issued_to": "Emitido a",
  "aeat_certificate.tax_id": "NIF",
  "aeat_certificate.type": "Tipo",
  "aeat_certificate.issued_by": "Emitido por",
  "aeat_certificate.valid_from": "Válido desde",
  "aeat_certificate.valid_until": "Válido hasta",
  "aeat_certificate.installed": "Instalado",
  "aeat_certificate.last_accepted": "Último envío aceptado",
  "aeat_certificate.matches": "coincide con el negocio",
  "aeat_certificate.does_not_match": "no coincide con el negocio",
  "aeat_certificate.no_tax_id": "no figura en el certificado",
  "aeat_certificate.days_left": "quedan {days} días",
  "aeat_certificate.expires_tomorrow": "Caduca mañana a las {time}",
  "aeat_certificate.expires_today": "Caduca hoy a las {time}",
  "aeat_certificate.expired_on": "Caducó el {date}",
  "aeat_certificate.during_setup": "durante la configuración",
  "aeat_certificate.not_recorded": "sin registrar",
  "aeat_certificate.none_since_installed": "Ninguno desde que se instaló",
  "aeat_certificate.replace": "Sustituir certificado",
  "aeat_certificate.install": "Instalar certificado",
  "aeat_certificate.none_installed":
    "No hay ningún certificado instalado. Los registros fiscales esperan hasta que lo haya.",
  "aeat_certificate.not_filing":
    "Este servidor no envía registros a la AEAT, así que no necesita certificado.",
  "aeat_certificate.warning_sello":
    "Este certificado caduca el {date}. Pide ya el nuevo a la FNMT: un sello electrónico nuevo puede tardar semanas.",
  "aeat_certificate.warning_representante":
    "Este certificado caduca el {date}. Consigue el nuevo de la FNMT antes de esa fecha.",
  "aeat_certificate.urgent":
    "Este certificado caduca dentro de {days} días. Después, los registros fiscales esperan hasta que se instale uno nuevo. Las ventas no se ven afectadas.",
  "aeat_certificate.urgent_tomorrow":
    "Este certificado caduca mañana a las {time}. Después, los registros fiscales esperan hasta que se instale uno nuevo. Las ventas no se ven afectadas.",
  "aeat_certificate.urgent_today":
    "Este certificado caduca hoy a las {time}. Después, los registros fiscales esperan hasta que se instale uno nuevo. Las ventas no se ven afectadas.",
  "aeat_certificate.expired":
    "Este certificado caducó el {date}. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo.",
  "aeat_certificate.installed_line":
    "Instalado. La AEAT ha respondido a una comprobación con este certificado a las {time}. El próximo envío lo usará.",
  "aeat_certificate.kind.sello": "Sello electrónico",
  "aeat_certificate.kind.representante": "Representante",
  "aeat_certificate.dialog.title": "Sustituir el certificado de la AEAT",
  "aeat_certificate.dialog.intro":
    "Waitron comprueba el nuevo certificado con la AEAT antes de sustituir el actual. Las ventas no se ven afectadas.",
  "aeat_certificate.dialog.file_label": "Archivo del certificado (.pfx o .p12)",
  "aeat_certificate.dialog.file_drop": "Suelta aquí el archivo del certificado",
  "aeat_certificate.dialog.file_choose": "Elegir archivo",
  "aeat_certificate.dialog.file_replace": "Elegir otro archivo",
  "aeat_certificate.dialog.file_preview": "Archivo del certificado",
  "aeat_certificate.dialog.passphrase_label": "Contraseña del certificado",
  "aeat_certificate.dialog.passphrase_required": "Introduce la contraseña del certificado.",
  "aeat_certificate.dialog.show_passphrase": "Mostrar la contraseña del certificado",
  "aeat_certificate.dialog.hide_passphrase": "Ocultar la contraseña del certificado",
  "aeat_certificate.dialog.kind_label": "Tipo de certificado",
  "aeat_certificate.dialog.fix_fields": "Corrige los campos marcados para continuar.",
  "aeat_certificate.dialog.cancel": "Cancelar",
  "aeat_certificate.dialog.save": "Guardar",
  "aeat_certificate.dialog.busy": "Comprobando con la AEAT…",
  "aeat_certificate.refused.too_large": "Este archivo es demasiado grande para ser un certificado.",
  "aeat_certificate.refused.unreadable":
    "Waitron no puede leer este archivo. Elige el archivo .pfx o .p12.",
  "aeat_certificate.refused.old_encryption":
    "Este archivo usa un cifrado antiguo. Vuelve a exportarlo con cifrado actual (AES).",
  "aeat_certificate.refused.no_private_key":
    "Este archivo no tiene la clave privada. Vuelve a exportarlo con la clave privada.",
  "aeat_certificate.refused.passphrase_wrong": "Esta contraseña no abre el archivo.",
  "aeat_certificate.refused.expired": "Este certificado caducó el {date}.",
  "aeat_certificate.refused.not_yet_valid": "Este certificado solo es válido desde el {date}.",
  "aeat_certificate.refused.same": "Este certificado ya está instalado.",
  "aeat_certificate.refused.other_taxpayer":
    "Este certificado es del NIF {nif}, no del {taxpayerNif}.",
  "aeat_certificate.refused.unreachable":
    "Waitron no ha podido contactar con la AEAT. El certificado actual no cambia. Comprueba la conexión a internet y vuelve a intentarlo.",
  "aeat_certificate.refused.closed":
    "La AEAT ha cerrado la conexión, así que puede haber rechazado este certificado. El certificado actual no cambia. Comprueba el tipo de certificado y vuelve a intentarlo.",
  "aeat_certificate.refused.aeat_fault":
    "La AEAT ha respondido con un error: {faultCode} {faultReason}. El certificado actual no cambia.",
  "aeat_certificate.refused.aeat_http":
    "La AEAT ha respondido con el error HTTP {status}. El certificado actual no cambia. Comprueba la conexión a internet o elige otro archivo o tipo de certificado. Pulsa Guardar para repetir la comprobación o Cancelar para parar.",
  "aeat_certificate.refused.check_failed":
    "La comprobación con la AEAT ha fallado por un motivo inesperado. El certificado actual no cambia. Comprueba la conexión a internet o elige otro archivo o tipo de certificado. Pulsa Guardar para repetir la comprobación o Cancelar para parar.",
  "nav.fiscal_filing": "Remisión a la AEAT",
  "fiscal_filing.title": "Remisión a la AEAT",
  "fiscal_filing.intro":
    "Cómo se envían a la AEAT los registros de facturación de este servidor y cuáles necesitan una decisión.",
  "fiscal_filing.read_at": "Leído: {time}",
  "fiscal_filing.refresh": "Actualizar",
  "fiscal_filing.export": "Exportar estos casos para tu asesor fiscal",
  "fiscal_filing.not_filing": "Este servidor no envía registros de facturación a la AEAT.",
  "fiscal_filing.awaiting_certificate":
    "No se puede enviar nada hasta que se instale el certificado de la AEAT.",
  "fiscal_filing.conflict.stopped":
    "Este servidor ha dejado de emitir facturas por un conflicto de identidad. Para recuperarlo hace falta la clave del servidor.",
  "fiscal_filing.conflict.open": "Abrir la recuperación del conflicto",
  "fiscal_filing.conflict.reply.fiscal.huella_divergente":
    "La AEAT ya tiene otro registro para la factura {number}, así que rechazó el de este servidor.",
  "fiscal_filing.conflict.reply.fiscal.duplicado_anulado":
    "La AEAT tiene la factura {number} como anulada, así que rechazó el registro de este servidor.",
  "fiscal_filing.conflict.lookup":
    "La AEAT tiene la factura {number} como {state}, y sus datos no coinciden con el registro de este servidor.",
  "fiscal_filing.conflict.lookup_unknown":
    "La AEAT tiene la factura {number}, y sus datos no coinciden con el registro de este servidor.",
  "fiscal_filing.conflict.state.Correcto": "aceptada",
  "fiscal_filing.conflict.state.AceptadoConErrores": "aceptada con errores",
  "fiscal_filing.conflict.state.Anulado": "anulada",
  "fiscal_filing.conflict.status": "Estado en la AEAT",
  "fiscal_filing.conflict.reply_words": "Respuesta de la AEAT",
  "fiscal_filing.conflict.fingerprint": "Huella de la AEAT",
  "fiscal_filing.conflict.series": "La AEAT tiene la factura {number}; este servidor no la emitió.",
  "fiscal_filing.conflict.cancelled": "Factura {number}: la AEAT la tiene como anulada.",
  "fiscal_filing.conflict.no_evidence": "Factura {number}: no se guardó la respuesta de la AEAT.",
  "fiscal_filing.conflict.seen": "Detectado: {time}",
  "fiscal_filing.progress": "Estado de los envíos",
  "fiscal_filing.state.pendiente": "Pendientes",
  "fiscal_filing.state.enviando": "Enviándose",
  "fiscal_filing.state.aceptado": "Aceptados",
  "fiscal_filing.state.aceptado_con_errores": "Aceptados con errores",
  "fiscal_filing.state.rechazado": "Rechazados",
  "fiscal_filing.state.detenido": "Detenidos",
  "fiscal_filing.state.retenido": "Apartados",
  "fiscal_filing.oldest_waiting": "Pendiente más antiguo",
  "fiscal_filing.last_accepted": "Última aceptación",
  "fiscal_filing.none": "Ninguno",
  "fiscal_filing.cases": "Casos de remisión",
  "fiscal_filing.held_without_case": "Detenidos sin caso: {count}",
  "fiscal_filing.warnings": "Advertencias",
  "fiscal_filing.warnings.none": "No hay advertencias abiertas.",
  "fiscal_filing.warnings.bounded":
    "Se muestran las {shown} más recientes de {total}. Expórtalas para verlas todas.",
  "fiscal_filing.warnings.reply": "Respuestas de la AEAT que no cuadran con lo enviado",
  "fiscal_filing.warnings.reply.line":
    "La respuesta de la AEAT a {sent} registros enviados juntos tenía otro número de líneas ({lines}), así que Waitron no aplicó ninguna.",
  "fiscal_filing.warnings.reply.seen": "Visto: {time}",
  "fiscal_filing.warnings.reply.now":
    "Cuando llegó esta respuesta, Waitron no aplicó ninguna línea de la AEAT y volvió a dejar cada registro pendiente de enviar, salvo los que ya estaban detenidos, que siguieron detenidos. El estado actual de cada uno está en Detalles técnicos.",
  "fiscal_filing.warnings.reply.csv": "Código de la remisión (CSV)",
  "fiscal_filing.warnings.reply.sent": "Registros enviados",
  "fiscal_filing.warnings.reply.lines": "Líneas de la AEAT",
  "fiscal_filing.warnings.reply.first":
    "Son las líneas que dio la AEAT la primera vez mientras este aviso está abierto; una respuesta posterior puede ser distinta.",
  "fiscal_filing.warnings.record": "Facturas con un aviso de la comprobación de Waitron",
  "fiscal_filing.warnings.record.totals":
    "Los totales de la factura {number} ({date}) no cuadran con sus líneas de impuestos. La AEAT la acepta; revisa los precios de esa venta.",
  "fiscal_filing.warnings.record.flagged":
    "La factura {number} ({date}) tiene algo que la AEAT acepta pero puede señalar.",
  "fiscal_filing.warnings.record.totals_unknown":
    "Una factura registrada el {time} tiene totales que no cuadran con sus líneas de impuestos. La AEAT la acepta; revisa los precios de esa venta.",
  "fiscal_filing.warnings.record.flagged_unknown":
    "Una factura registrada el {time} tiene algo que la AEAT acepta pero puede señalar.",
  "fiscal_filing.warnings.record.fields": "Campos y códigos de la comprobación",
  "fiscal_filing.history": "Historial que puede faltar",
  "fiscal_filing.history.not_issued": "Facturas que la AEAT tiene y este servidor no emitió",
  "fiscal_filing.history.not_issued.line":
    "La AEAT tiene la factura {number} ({date}); este servidor no la emitió.",
  "fiscal_filing.history.not_issued.series": "Serie {series}",
  "fiscal_filing.history.not_issued.system": "Sistema informático según la AEAT",
  "fiscal_filing.history.not_issued.none": "No se ha encontrado ninguna.",
  "fiscal_filing.history.identity": "Cambios de identidad sin traspaso",
  "fiscal_filing.history.identity.line":
    "La identidad fiscal cambió de {earlier} a {new} sin un traspaso. La última factura que este servidor tiene bajo {earlier} es la {number}. Puede haber facturas bajo {earlier} que este servidor no tiene.",
  "fiscal_filing.history.identity.line_none_held":
    "La identidad fiscal cambió de {earlier} a {new} sin un traspaso. Este servidor no tiene ninguna factura bajo {earlier}. Puede haber facturas bajo {earlier} que este servidor no tiene.",
  "fiscal_filing.history.identity.invoice": "{number} ({date})",
  "fiscal_filing.history.identity.changed": "Cambio: {time}",
  "fiscal_filing.history.identity.none": "La identidad fiscal no ha cambiado sin un traspaso.",
  "fiscal_filing.cases.none": "Ningún caso necesita una decisión.",
  "fiscal_filing.cases.bounded": "Los {shown} más recientes de {total}",
  "fiscal_filing.cases.open_to_put_right": "Abre un caso para ver si Waitron puede corregirlo.",
  "fiscal_filing.cases.range": "{from}–{to} de {total}",
  "fiscal_filing.cases.previous": "Página anterior",
  "fiscal_filing.cases.next": "Página siguiente",
  "fiscal_filing.column.opened": "Abierto",
  "fiscal_filing.column.invoice": "Factura",
  "fiscal_filing.column.reason": "Motivo",
  "fiscal_filing.column.code": "Código de la AEAT",
  "fiscal_filing.column.held": "Detenidos detrás",
  "fiscal_filing.column.actions": "Acciones",
  "fiscal_filing.view": "Ver",
  "fiscal_filing.close": "Cerrar",
  "fiscal_filing.put_right.heading": "Corregir la descripción",
  "fiscal_filing.put_right.intro":
    "La AEAT rechazó la descripción de la operación de este registro. Escríbela de nuevo y envía un registro de subsanación: la factura conserva su número y sus importes.",
  "fiscal_filing.put_right.aeat": "La AEAT dijo",
  "fiscal_filing.put_right.description": "Descripción de la operación",
  "fiscal_filing.put_right.description_required": "Escribe la descripción de la operación.",
  "fiscal_filing.put_right.description_too_long":
    "La descripción no puede pasar de 500 caracteres.",
  "fiscal_filing.put_right.description_control":
    "Quita el carácter invisible que la AEAT no acepta; puede haber venido con un texto pegado.",
  "fiscal_filing.put_right.fix_fields": "Corrige el campo marcado arriba.",
  "fiscal_filing.put_right.send": "Enviar la subsanación",
  "fiscal_filing.put_right.sending": "Enviando…",
  "fiscal_filing.put_right.stop": "Parar",
  "fiscal_filing.put_right.sign_in": "Inicia sesión como administrador para corregirlo",
  "fiscal_filing.put_right.none.not-yet":
    "Waitron todavía no puede corregir este caso. El caso sigue abierto.",
  "fiscal_filing.put_right.none.full-invoice":
    "Waitron todavía no puede corregir este caso: una factura completa necesita una factura rectificativa que Waitron todavía no puede emitir.",
  "fiscal_filing.refused.signed_out":
    "Se ha cerrado tu sesión. Vuelve a iniciarla y envía de nuevo.",
  "fiscal_filing.refused.admin":
    "Solo un administrador puede corregirlo. Inicia sesión como administrador con el botón de abajo.",
  "fiscal_filing.refused.fresh_sign_in":
    "Waitron necesita que vuelvas a iniciar sesión antes de enviarlo. Envía de nuevo para que te lo pida.",
  "fiscal_filing.refused.clock_unconfirmed":
    "El servidor está esperando a que se confirme su hora. Confírmala en una caja o en Estado del servidor y envía de nuevo.",
  "fiscal_filing.refused.clock_behind":
    "La hora del servidor es anterior a su última factura, así que no se ha enviado nada. Confirma la hora en Estado del servidor y envía de nuevo.",
  "fiscal_filing.refused.clock_unusable":
    "La hora del servidor es incorrecta, así que no se ha enviado nada. Con internet, el servidor la corrige solo; si no, ponla en hora en Estado del servidor y envía de nuevo.",
  "fiscal_filing.refused.time_zone":
    "La zona horaria del local no está lista, así que no se ha enviado nada. Revísala en Ajustes del local y envía de nuevo.",
  "fiscal_filing.refused.not_main":
    "Este servidor ya no presenta las facturas del local. Abre esta página en el servidor que las presenta.",
  "fiscal_filing.refused.changed":
    "Este caso ya se había corregido o ha cambiado; no se ha enviado nada más.",
  "fiscal_filing.refused.not_sent":
    "Waitron no ha podido enviar esta subsanación, así que no se ha enviado nada. Es un fallo de Waitron; el caso sigue abierto.",
  "fiscal_filing.refused.disk_full":
    "El disco del servidor está lleno, así que no se ha enviado nada. Sigue el aviso del disco y envía de nuevo.",
  "fiscal_filing.refused.record_invalid":
    "El registro de subsanación no ha pasado la comprobación de Waitron, así que no se ha enviado nada. Es un fallo de Waitron; el caso sigue abierto.",
  "fiscal_filing.refused.fingerprint":
    "Ha fallado la comprobación de la huella de los registros de facturación del servidor, así que no se ha enviado nada. Es un fallo de Waitron; el caso sigue abierto.",
  "fiscal_filing.refused.try_again":
    "El servidor no ha podido añadir la subsanación a sus registros de facturación esta vez, así que no se ha enviado nada. Envía de nuevo.",
  "fiscal_filing.refused.setup":
    "El servidor ha encontrado un problema en su propia configuración de facturación, así que no se ha enviado nada. Es un fallo de Waitron; el caso sigue abierto.",
  "fiscal_filing.cause.fiscal.registro_rechazado": "Rechazado",
  "fiscal_filing.cause.fiscal.aceptado_con_errores": "Aceptado con errores",
  "fiscal_filing.cause.fiscal.anulacion_retenida": "Anulación apartada",
  "fiscal_filing.cause.fiscal.huella_divergente": "La AEAT tiene otro registro",
  "fiscal_filing.cause.fiscal.duplicado_anulado": "Anulada en la AEAT",
  "fiscal_filing.now.fiscal.registro_rechazado":
    "Los registros posteriores se siguen enviando. Tras tres rechazos seguidos con el mismo código, los registros siguientes se detienen y el primero se vuelve a intentar cada hora.",
  "fiscal_filing.now.fiscal.aceptado_con_errores":
    "La AEAT guardó este registro y lo cuenta como aceptado, con el error indicado.",
  "fiscal_filing.now.fiscal.anulacion_retenida":
    "Esta anulación no se envía porque la AEAT rechazó la factura que anula. No detiene nada detrás.",
  "fiscal_filing.now.fiscal.huella_divergente":
    "Este registro está rechazado y no se vuelve a enviar.",
  "fiscal_filing.now.fiscal.duplicado_anulado":
    "La AEAT tiene esta factura como anulada, así que este registro está rechazado y no se vuelve a enviar.",
  "fiscal_filing.now.lookup":
    "Se detectó al consultar la factura en la AEAT. La consulta no cambia cómo se envía este registro.",
  "fiscal_filing.now.stopped":
    "Mientras el conflicto siga activo, este servidor no emite facturas.",
  "fiscal_filing.detail.invoice": "Factura",
  "fiscal_filing.detail.issuer": "NIF del emisor",
  "fiscal_filing.detail.kind": "Qué es",
  "fiscal_filing.kind.F1": "Una factura completa que identifica al cliente.",
  "fiscal_filing.kind.F2": "Una factura simplificada: un tique que no identifica al cliente.",
  "fiscal_filing.kind.F3": "Una factura completa que sustituye facturas simplificadas anteriores.",
  "fiscal_filing.kind.corrective": "Una factura que corrige otra anterior.",
  "fiscal_filing.kind.anulacion": "La anulación de una factura anterior.",
  "fiscal_filing.kind.other": "Un registro de factura.",
  "fiscal_filing.detail.state": "En qué punto está",
  "fiscal_filing.record_state.pendiente": "Pendiente de enviar a la AEAT.",
  "fiscal_filing.record_state.enviando": "Enviándose ahora a la AEAT.",
  "fiscal_filing.record_state.aceptado": "La AEAT lo aceptó.",
  "fiscal_filing.record_state.aceptado_con_errores": "La AEAT lo aceptó y señaló un error.",
  "fiscal_filing.record_state.rechazado": "La AEAT lo rechazó.",
  "fiscal_filing.record_state.detenido": "Detenido: por ahora no se envía.",
  "fiscal_filing.record_state.retenido": "Apartado: no se envía.",
  "fiscal_filing.detail.recorded": "Registrado",
  "fiscal_filing.technical": "Detalles técnicos",
  "fiscal_filing.detail.record_code": "Tipo de registro (código de la AEAT)",
  "fiscal_filing.detail.invoice_code": "Tipo de factura (código de la AEAT)",
  "fiscal_filing.detail.then_code": "Código de la AEAT al abrir el caso",
  "fiscal_filing.detail.latest_code": "Último código de la AEAT",
  "fiscal_filing.detail.total": "Importe total",
  "fiscal_filing.detail.total_value": "{total}, IVA de {tax} incluido",
  "fiscal_filing.detail.generated": "Generado",
  "fiscal_filing.detail.installation": "Instalación",
  "fiscal_filing.detail.fingerprint": "Huella",
  "fiscal_filing.detail.previous": "Huella anterior",
  "fiscal_filing.detail.then": "Respuesta de la AEAT al abrir el caso",
  "fiscal_filing.detail.latest": "Última respuesta de la AEAT",
  "fiscal_filing.detail.sent": "enviado: {time}",
  "fiscal_filing.detail.observations": "Lo que dijo la AEAT sobre esta factura",
  "fiscal_filing.detail.observation": "Intento {attempt}, {time}: {state} {code} {description}",
  "fiscal_filing.detail.lookup": "Consulta, {time}: la AEAT la tiene como {state}",
  "fiscal_filing.detail.theirs": "Huella de la AEAT: {fingerprint}",
  "fiscal_filing.detail.ours": "Huella de este servidor: {fingerprint}",
  "fiscal_filing.detail.now": "Qué pasa ahora",
};

export const AEAT_CERTIFICATE_STRINGS = { en, es };

registerCatalogue(AEAT_CERTIFICATE_STRINGS);

export const AEAT_CERTIFICATE_CODE_MESSAGES = {
  "fiscal.certificate_changed": {
    en: "Someone else installed a certificate meanwhile. Close this window to see it.",
    es: "Otra persona ha instalado un certificado mientras tanto. Cierra esta ventana para verlo.",
  },
  "fiscal.certificate_too_large": {
    en: en["aeat_certificate.refused.too_large"],
    es: es["aeat_certificate.refused.too_large"],
  },
  "fiscal.certificate_not_used": {
    en: en["aeat_certificate.not_filing"],
    es: es["aeat_certificate.not_filing"],
  },
  "fiscal.certificate_request_invalid": {
    en: "Waitron could not read this request. Choose the file again and try again.",
    es: "Waitron no ha podido leer esta solicitud. Vuelve a elegir el archivo e inténtalo de nuevo.",
  },
};

registerCodeMessages(AEAT_CERTIFICATE_CODE_MESSAGES);

const translate = makeT<AeatCertificateKey>();

/** Translates `key` and fills each `{name}` slot from `values`. */
export function t(key: AeatCertificateKey, values: Record<string, string | number> = {}): string {
  return translate(key).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
