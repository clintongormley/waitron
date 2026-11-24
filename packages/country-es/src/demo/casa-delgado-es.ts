import type { CountryDemoData } from "@waitron/country";
import {
  CASA_DELGADO,
  DELI_TAKEAWAY,
  MENU_DEL_DIA,
  DEMO_SET_MENUS,
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
    kitchen: {
      en: "Kitchen",
      es: "Cocina",
      ca: "Cuina",
      "ca-ES-valencia": "Cuina",
      gl: "Cociña",
    },
    downstairsBar: {
      en: "Downstairs bar prep",
      es: "Preparación del bar de abajo",
      ca: "Preparació del bar de baix",
      "ca-ES-valencia": "Preparació del bar de baix",
      gl: "Preparación do bar de abaixo",
    },
    upstairsBar: {
      en: "Upstairs bar prep",
      es: "Preparación del bar de arriba",
      ca: "Preparació del bar de dalt",
      "ca-ES-valencia": "Preparació del bar de dalt",
      gl: "Preparación do bar de arriba",
    },
    deli: {
      en: "Deli prep",
      es: "Preparación de charcutería",
      ca: "Preparació de xarcuteria",
      "ca-ES-valencia": "Preparació de xarcuteria",
      gl: "Preparación de charcutaría",
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
  deliPeriodName: {
    en: "Open",
    es: "Abierto",
    ca: "Obert",
    "ca-ES-valencia": "Obert",
    gl: "Aberto",
  },
  restaurantPeriodNames: {
    bar: { en: "Bar", es: "Bar", ca: "Bar", "ca-ES-valencia": "Bar", gl: "Bar" },
    lunch: { en: "Lunch", es: "Comida", ca: "Dinar", "ca-ES-valencia": "Dinar", gl: "Xantar" },
    dinner: { en: "Dinner", es: "Cena", ca: "Sopar", "ca-ES-valencia": "Sopar", gl: "Cea" },
  },
  menuPriceOverrides: [
    { menu: "drinks", productImage: "cana-cerveza.png", grossPrice: "3.00" },
    { menu: "lunch", productImage: "negroni.png", grossPrice: "9.00" },
  ],
  contentLanguages: CASA_DELGADO_LANGUAGES,
  courses: [
    { key: "sharing", starter: "Sharing plates" },
    { key: "starters", starter: "Starters" },
    { key: "mains", starter: "Mains" },
    { key: "desserts", starter: "Desserts" },
    {
      key: "coffee",
      name: { en: "Coffee", es: "Café", ca: "Cafè", "ca-ES-valencia": "Café", gl: "Café" },
      fireNow: false,
    },
    {
      key: "drinks",
      name: {
        en: "Drinks",
        es: "Bebidas",
        ca: "Begudes",
        "ca-ES-valencia": "Begudes",
        gl: "Bebidas",
      },
      fireNow: true,
    },
    {
      key: "bread",
      name: { en: "Bread", es: "Pan", ca: "Pa", "ca-ES-valencia": "Pa", gl: "Pan" },
      fireNow: true,
    },
  ],
  menus: {
    restaurant: CASA_DELGADO,
    deli: DELI_TAKEAWAY,
    lunch: MENU_DEL_DIA,
    setMenus: DEMO_SET_MENUS,
    setMenuHolderName: {
      en: "Lunch menus",
      es: "Menús de mediodía",
      ca: "Menús de migdia",
      "ca-ES-valencia": "Menús de migdia",
      gl: "Menús do xantar",
    },
    drinksName: {
      en: "Drinks",
      es: "Bebidas",
      ca: "Begudes",
      "ca-ES-valencia": "Begudes",
      gl: "Bebidas",
    },
    drinksImage: "section-drinks.png",
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
