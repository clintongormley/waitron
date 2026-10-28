import type { CountryDemoData } from "@waitron/country";
import {
  CASA_DELGADO,
  DELI_TAKEAWAY,
  MENU_DEL_DIA,
  PRODUCT_OPTION_LISTS,
  PRODUCT_EXTRA_LISTS,
} from "./menu.js";
import { DEMO_TABLES, DEMO_ZONES } from "./floor.js";
import { DEMO_STAFF } from "./staff.js";
import { DEMO_ADJUSTMENT_REASONS } from "./reasons.js";

export const CASA_DELGADO_LANGUAGES = ["es", "en", "ca", "ca-ES-valencia", "gl"] as const;
export type CasaDelgadoLanguage = (typeof CASA_DELGADO_LANGUAGES)[number];

export const CASA_DELGADO_ES = {
  id: "casa-delgado-es",
  mediaDataSet: "casa-delgado-es",
  stations: {
    kitchen: { en: "Kitchen", es: "Cocina", ca: "Cuina", "ca-ES-valencia": "Cuina", gl: "Cociña" },
    downstairsBar: {
      en: "Downstairs bar",
      es: "Bar de abajo",
      ca: "Bar de baix",
      "ca-ES-valencia": "Bar de baix",
      gl: "Bar de abaixo",
    },
    upstairsBar: {
      en: "Upstairs bar",
      es: "Bar de arriba",
      ca: "Bar de dalt",
      "ca-ES-valencia": "Bar de dalt",
      gl: "Bar de arriba",
    },
    deli: {
      en: "Deli counter",
      es: "Mostrador de charcutería",
      ca: "Taulell de xarcuteria",
      "ca-ES-valencia": "Taulell de xarcuteria",
      gl: "Mostrador de charcutaría",
    },
  },
  printerName: {
    en: "Demo printer",
    es: "Impresora de demostración",
    ca: "Impressora de demostració",
    "ca-ES-valencia": "Impressora de demostració",
    gl: "Impresora de demostración",
  },
  specialDayName: {
    en: "Christmas Day",
    es: "Navidad",
    ca: "Nadal",
    "ca-ES-valencia": "Nadal",
    gl: "Nadal",
  },
  menuPeriodName: {
    en: "Open",
    es: "Abierto",
    ca: "Obert",
    "ca-ES-valencia": "Obert",
    gl: "Aberto",
  },
  menuPriceOverrides: [
    { menu: "drinks", productImage: "cana-cerveza.png", grossPrice: "3.00" },
    { menu: "lunch", productImage: "negroni.png", grossPrice: "9.00" },
  ],
  contentLanguages: CASA_DELGADO_LANGUAGES,
  menus: {
    restaurant: CASA_DELGADO,
    deli: DELI_TAKEAWAY,
    lunch: MENU_DEL_DIA,
    drinksName: {
      en: "Drinks",
      es: "Bebidas",
      ca: "Begudes",
      "ca-ES-valencia": "Begudes",
      gl: "Bebidas",
    },
    drinksCustomerName: {
      en: "Drinks menu",
      es: "Carta de bebidas",
      ca: "Carta de begudes",
      "ca-ES-valencia": "Carta de begudes",
      gl: "Carta de bebidas",
    },
  },
  productOptionLists: PRODUCT_OPTION_LISTS,
  productExtraLists: PRODUCT_EXTRA_LISTS,
  floor: {
    setName: {
      en: "Standard",
      es: "Estándar",
      ca: "Estàndard",
      "ca-ES-valencia": "Estàndard",
      gl: "Estándar",
    },
    zones: DEMO_ZONES,
    tables: DEMO_TABLES,
    departmentNames: {
      restaurant: {
        en: "Restaurant and bar",
        es: "Restaurante y bar",
        ca: "Restaurant i bar",
        "ca-ES-valencia": "Restaurant i bar",
        gl: "Restaurante e bar",
      },
      deli: {
        en: "Deli",
        es: "Charcutería",
        ca: "Xarcuteria",
        "ca-ES-valencia": "Xarcuteria",
        gl: "Charcutaría",
      },
    },
    upstairsBarZone: {
      en: "Upstairs bar",
      es: "Bar de arriba",
      ca: "Bar de dalt",
      "ca-ES-valencia": "Bar de dalt",
      gl: "Bar de arriba",
    },
    deliCounterZone: {
      en: "Deli counter",
      es: "Mostrador de charcutería",
      ca: "Taulell de xarcuteria",
      "ca-ES-valencia": "Taulell de xarcuteria",
      gl: "Mostrador de charcutaría",
    },
  },
  staff: DEMO_STAFF,
  adjustmentReasons: DEMO_ADJUSTMENT_REASONS,
} as const satisfies CountryDemoData<CasaDelgadoLanguage>;
