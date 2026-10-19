import { makeT, registerCatalogue, registerCodeMessages } from "@waitron/dashboard-kit";

const en = {
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
    "AEAT answered with HTTP error {status}. The current certificate is unchanged. Try again later.",
  "aeat_certificate.refused.check_failed":
    "The check with AEAT failed for an unexpected reason. The current certificate is unchanged. Try again; if it fails again, contact support.",
} as const;

export type AeatCertificateKey = keyof typeof en;

const es: Record<AeatCertificateKey, string> = {
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
    "La AEAT ha respondido con el error HTTP {status}. El certificado actual no cambia. Vuelve a intentarlo más tarde.",
  "aeat_certificate.refused.check_failed":
    "La comprobación con la AEAT ha fallado por un motivo inesperado. El certificado actual no cambia. Vuelve a intentarlo; si vuelve a fallar, contacta con soporte.",
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
