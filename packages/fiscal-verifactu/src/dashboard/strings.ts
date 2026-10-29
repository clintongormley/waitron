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
    "Este equipo no envía registros a la AEAT, así que no necesita certificado.",
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
