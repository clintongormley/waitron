import type { DemoDataSet } from "../data-set.js";
import {
  CASA_DELGADO,
  DELI_TAKEAWAY,
  MENU_DEL_DIA,
  PRODUCT_OPTION_LISTS,
  PRODUCT_EXTRA_LISTS,
} from "../menu.js";
import { DEMO_STATUSES, DEMO_TABLES, DEMO_ZONES } from "../floor.js";
import { DEMO_STAFF } from "../staff.js";
import { DEMO_ADJUSTMENT_REASONS } from "../seed-adjustments.js";

export const CASA_DELGADO_LANGUAGES = ["es", "en", "ca", "gl"] as const;
export type CasaDelgadoLanguage = (typeof CASA_DELGADO_LANGUAGES)[number];

export const CASA_DELGADO_ES: DemoDataSet<CasaDelgadoLanguage> = {
  id: "casa-delgado-es",
  contentLanguages: CASA_DELGADO_LANGUAGES,
  menus: {
    restaurant: CASA_DELGADO,
    deli: DELI_TAKEAWAY,
    lunch: MENU_DEL_DIA,
    drinksName: { en: "Drinks", es: "Bebidas" },
    drinksCustomerName: {
      en: "Drinks menu",
      es: "Carta de bebidas",
      ca: "Carta de begudes",
      gl: "Carta de bebidas",
    },
  },
  productOptionLists: PRODUCT_OPTION_LISTS,
  productExtraLists: PRODUCT_EXTRA_LISTS,
  floor: {
    zones: DEMO_ZONES,
    tables: DEMO_TABLES,
    statuses: DEMO_STATUSES,
    departmentNames: {
      restaurant: { en: "Restaurant and bar", es: "Restaurante y bar" },
      deli: { en: "Deli", es: "Charcutería" },
    },
    upstairsBarZone: { en: "Upstairs bar", es: "Bar de arriba" },
    deliCounterZone: { en: "Deli counter", es: "Mostrador de charcutería" },
  },
  watcherName: { en: "Pass", es: "Pase" },
  staff: DEMO_STAFF,
  adjustmentReasons: DEMO_ADJUSTMENT_REASONS,
};
