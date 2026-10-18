import { makeT, registerCatalogue } from "@waitron/dashboard-kit";

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
};

export const AEAT_CERTIFICATE_STRINGS = { en, es };

registerCatalogue(AEAT_CERTIFICATE_STRINGS);

const translate = makeT<AeatCertificateKey>();

/** Translates `key` and fills each `{name}` slot from `values`. */
export function t(key: AeatCertificateKey, values: Record<string, string | number> = {}): string {
  return translate(key).replace(/\{(\w+)\}/g, (_slot, name: string) => String(values[name]));
}
