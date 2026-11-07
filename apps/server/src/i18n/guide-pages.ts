import type { GUIDE_PAGES } from "../guide-catalogue.js";
import { BACKUP_RECOVERY_GUIDE_TITLE } from "./backup-recovery-guide.js";
import { BOX_STATUS_GUIDE_TITLE } from "./box-status-guide.js";
import { DATA_PROTECTION_GUIDE_TITLE } from "./data-protection-guide.js";
import { GUIDE_CERTIFICATE_TITLE } from "./guide-certificate.js";
import { PURCHASES_GUIDE_TITLE } from "./guide-purchases.js";
import { KITCHEN_ALLERGY_WORDS } from "./kitchen-allergy.js";
import { STAFF_GUIDE_TITLE } from "./staff.js";
import { TABLE_SERVICE_GUIDE_TITLE } from "./table-service-guide.js";
import { TILL_NOTICES_GUIDE_TITLE } from "./till-notices-guide.js";
import { TIME_ZONE_GUIDE } from "./time-zone-guide.js";

type GuidePage = (typeof GUIDE_PAGES)[number];

interface GuideWords {
  trail: string;
  names: Record<GuidePage, string>;
  notFoundTitle: string;
  notFound: string;
  brokenTitle: string;
  broken: string;
}

/** English is required, so only a translation carries the line saying its page fell back to English. */
export const GUIDE_FRAME_WORDS: { en: GuideWords; es: GuideWords & { missingTwin: string } } = {
  en: {
    trail: "Waitron guide",
    names: {
      products: "Products",
      modifiers: "Modifiers",
      "content-and-images": "Languages and photos",
      "kitchen-service": KITCHEN_ALLERGY_WORDS.en.guideTitle,
      appearance: "Appearance",
      "aeat-certificate": GUIDE_CERTIFICATE_TITLE.en,
      "table-service": TABLE_SERVICE_GUIDE_TITLE.en,
      staff: STAFF_GUIDE_TITLE.en,
      "data-protection": DATA_PROTECTION_GUIDE_TITLE.en,
      purchases: PURCHASES_GUIDE_TITLE.en,
      "till-notices": TILL_NOTICES_GUIDE_TITLE.en,
      "box-status": BOX_STATUS_GUIDE_TITLE.en,
      "backup-recovery": BACKUP_RECOVERY_GUIDE_TITLE.en,
      "time-zone": TIME_ZONE_GUIDE.en.name,
      servers: "Servers",
      printers: "Printers",
      email: "Email",
      "opening-hours": "Public holidays in Opening hours",
    },
    notFoundTitle: "Page not found",
    notFound: "There is no guide page at this address.",
    brokenTitle: "Page unavailable",
    broken: "This guide page could not be shown.",
  },
  es: {
    trail: "Guía de Waitron",
    names: {
      products: "Productos",
      modifiers: "Modificadores",
      "content-and-images": "Idiomas y fotos",
      "kitchen-service": KITCHEN_ALLERGY_WORDS.es.guideTitle,
      appearance: "Apariencia",
      "aeat-certificate": GUIDE_CERTIFICATE_TITLE.es,
      "table-service": TABLE_SERVICE_GUIDE_TITLE.es,
      staff: STAFF_GUIDE_TITLE.es,
      "data-protection": DATA_PROTECTION_GUIDE_TITLE.es,
      purchases: PURCHASES_GUIDE_TITLE.es,
      "till-notices": TILL_NOTICES_GUIDE_TITLE.es,
      "box-status": BOX_STATUS_GUIDE_TITLE.es,
      "backup-recovery": BACKUP_RECOVERY_GUIDE_TITLE.es,
      "time-zone": TIME_ZONE_GUIDE.es.name,
      servers: "Servidores",
      printers: "Impresoras",
      email: "Correo electrónico",
      "opening-hours": "Festivos en Horario de apertura",
    },
    missingTwin: "Esta página aún no está en español. Se muestra en inglés.",
    notFoundTitle: "Página no encontrada",
    notFound: "No hay ninguna página de la guía en esta dirección.",
    brokenTitle: "Página no disponible",
    broken: "No se ha podido mostrar esta página de la guía.",
  },
};
