// Demo menu content for the Casa Delgado seed: plausibility, not fiscal or culinary accuracy, is
// the bar. Each `image` basename is unique across the catalogues, because `seedCatalogues` maps
// image to product id. The VAT classes are mixed on purpose, so one basket's per-rate breakdown is
// non-trivial.

import type { DietaryLabel, PricingUnit, VatClass } from "@waitron/catalogue";

export type SeedLocale = "en" | "es";

/** Content is authored under the bare tag; the venue's `invoice_locales` and display locale take
 *  the full tag. */
export const SEED_INVOICE_LOCALE: Record<SeedLocale, string> = {
  en: "en-GB",
  es: "es-ES",
};

/** Where `staffName` is given it DELIBERATELY differs from the customer-facing name, so a screen
 * showing the wrong one of the three names is visible; omitted, `seedCatalogues` falls back to the
 * seeded locale's customer-facing name. */
export interface SeedProduct {
  customerName: Record<SeedLocale, string>;
  staffName?: string;
  description?: Record<SeedLocale, string>;
  kitchenName?: string;
  dietaryDeclarations?: DietaryLabel[];
  unit?: {
    name: Record<SeedLocale, string>;
    precision: number;
    abbreviation: Record<SeedLocale, string>;
  };
  variants?: {
    customerName: Record<SeedLocale, string>;
    staffName?: string;
    kitchenName?: string;
    /** The variant's own price, or null to sell at its parent's. */
    unitPrice: string | null;
    available: boolean;
  }[];
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per item for `each`, per kg for `weight`. A two-place decimal string;
   * `createProduct` converts it to a count of whole cents at the row. */
  unitPrice: string;
  vatClass: VatClass;
  /** The committed PNG basename under `media/`. */
  image: string;
}

export interface SeedCategory {
  name: Record<SeedLocale, string>;
  station: "kitchen" | "bar" | "deli" | null;
  products: SeedProduct[];
}

export interface SeedCatalogue {
  name: Record<SeedLocale, string>;
  categories: SeedCategory[];
}

// Staff `name`, `customerName` and `kitchenName` are DIFFERENT text on every list and label, so a
// surface reading the wrong one of the three shows the wrong words (CLAUDE.md §3).

export interface SeedOptionLabel {
  name: string;
  customerName: Record<SeedLocale, string>;
  kitchenName: string;
  /** Preselected when the list is asked; at most one label of a list carries it. */
  preselected?: boolean;
}

export interface SeedOptionList {
  name: string;
  customerName: Record<SeedLocale, string>;
  kitchenName: string;
  labels: SeedOptionLabel[];
}

export interface SeedProductOptionLists {
  productImage: string;
  lists: SeedOptionList[];
}

export const PRODUCT_OPTION_LISTS: SeedProductOptionLists[] = [
  {
    productImage: "solomillo.png",
    lists: [
      {
        name: "Punto",
        customerName: { en: "How would you like it cooked?", es: "¿Cómo la quiere hecha?" },
        kitchenName: "PUNTO CARNE",
        labels: [
          {
            name: "Poco",
            customerName: { en: "Rare, red in the middle", es: "Poco hecho, rojo por dentro" },
            kitchenName: "POCO HECHO",
          },
          {
            name: "Punto medio",
            customerName: { en: "Medium, pink in the middle", es: "Al punto, rosado por dentro" },
            kitchenName: "AL PUNTO",
            preselected: true,
          },
          {
            name: "Muy",
            customerName: { en: "Well done, cooked through", es: "Muy hecho, sin nada de rosa" },
            kitchenName: "MUY HECHO",
          },
        ],
      },
    ],
  },
];

const COMBINED_CASA_DELGADO: SeedCatalogue = {
  name: { en: "Casa Delgado", es: "Casa Delgado" },
  categories: [
    {
      name: { en: "Charcuterie", es: "Charcutería" },
      station: "kitchen",
      products: [
        {
          customerName: {
            en: "Sliced Iberian ham (per kg)",
            es: "Jamón ibérico cortado (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "89.00",
          vatClass: "reduced",
          image: "jamon-iberico.png",
        },
        {
          customerName: {
            en: "Iberian chorizo (per kg)",
            es: "Chorizo ibérico (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "24.50",
          vatClass: "reduced",
          image: "chorizo-iberico.png",
        },
        {
          customerName: { en: "Cured pork loin (per kg)", es: "Lomo embuchado (por kg)" },
          pricingUnit: "weight",
          unitPrice: "32.00",
          vatClass: "reduced",
          image: "lomo-embuchado.png",
        },
        {
          customerName: { en: "Salchichón sausage (per kg)", es: "Salchichón (por kg)" },
          pricingUnit: "weight",
          unitPrice: "19.90",
          vatClass: "reduced",
          image: "salchichon.png",
        },
        {
          customerName: {
            en: "Cured beef cecina (per kg)",
            es: "Cecina de León (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "38.00",
          vatClass: "reduced",
          image: "cecina.png",
        },
        {
          customerName: { en: "Mallorcan sobrasada (per kg)", es: "Sobrasada (por kg)" },
          pricingUnit: "weight",
          unitPrice: "18.00",
          vatClass: "reduced",
          image: "sobrasada.png",
        },
      ],
    },
    {
      name: { en: "Cheeses", es: "Quesos" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Cured Manchego (per kg)", es: "Manchego curado (por kg)" },
          pricingUnit: "weight",
          unitPrice: "21.00",
          vatClass: "reduced",
          image: "manchego-curado.png",
        },
        {
          customerName: { en: "Cabrales blue cheese (per kg)", es: "Cabrales (por kg)" },
          pricingUnit: "weight",
          unitPrice: "28.50",
          vatClass: "reduced",
          image: "cabrales.png",
        },
        {
          customerName: {
            en: "Idiazábal smoked cheese (per kg)",
            es: "Idiazábal (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "26.00",
          vatClass: "reduced",
          image: "idiazabal.png",
        },
        {
          customerName: {
            en: "Torta del Casar (per kg)",
            es: "Torta del Casar (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "34.00",
          vatClass: "reduced",
          image: "torta-del-casar.png",
        },
        {
          customerName: { en: "Mahón cheese (per kg)", es: "Queso de Mahón (por kg)" },
          pricingUnit: "weight",
          unitPrice: "19.50",
          vatClass: "reduced",
          image: "mahon.png",
        },
      ],
    },
    {
      name: { en: "Conserves", es: "Conservas" },
      station: "kitchen",
      products: [
        {
          customerName: {
            en: "Cantabrian anchovies (per kg)",
            es: "Anchoas del Cantábrico (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "72.00",
          vatClass: "reduced",
          image: "anchoas.png",
        },
        {
          customerName: {
            en: "Marinated olives (per kg)",
            es: "Aceitunas aliñadas (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "8.50",
          vatClass: "reduced",
          image: "aceitunas.png",
        },
        {
          customerName: {
            en: "Octopus in olive oil (per kg)",
            es: "Pulpo en aceite (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "46.00",
          vatClass: "reduced",
          image: "pulpo-en-aceite.png",
        },
        {
          customerName: {
            en: "White tuna belly (per kg)",
            es: "Ventresca de bonito (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "54.00",
          vatClass: "reduced",
          image: "bonito.png",
        },
      ],
    },
    {
      name: { en: "Tapas", es: "Tapas" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Spicy potatoes", es: "Patatas bravas" },
          staffName: "Bravas",
          kitchenName: "BRAVAS",
          pricingUnit: "each",
          unitPrice: "6.50",
          vatClass: "reduced",
          image: "patatas-bravas.png",
        },
        {
          customerName: { en: "Ham croquettes", es: "Croquetas de jamón" },
          staffName: "Croquetas",
          kitchenName: "CROQ JAMON",
          pricingUnit: "each",
          unitPrice: "7.80",
          vatClass: "reduced",
          image: "croquetas.png",
        },
        {
          customerName: { en: "Garlic prawns", es: "Gambas al ajillo" },
          staffName: "Gambas",
          kitchenName: "GAMBAS AJILLO",
          pricingUnit: "each",
          unitPrice: "9.90",
          vatClass: "reduced",
          image: "gambas-al-ajillo.png",
        },
        {
          customerName: { en: "Spanish omelette", es: "Tortilla española" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "tortilla.png",
        },
        {
          customerName: { en: "House bread", es: "Pan de la casa" },
          pricingUnit: "each",
          unitPrice: "2.20",
          vatClass: "super_reduced",
          image: "pan-de-la-casa.png",
        },
        {
          customerName: { en: "Bread with tomato", es: "Pan con tomate" },
          pricingUnit: "each",
          unitPrice: "3.20",
          vatClass: "reduced",
          image: "pan-con-tomate.png",
        },
      ],
    },
    {
      name: { en: "Sharing plates", es: "Raciones" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Galician-style octopus", es: "Pulpo a la gallega" },
          staffName: "Pulpo",
          kitchenName: "PULPO GALLEGA",
          pricingUnit: "each",
          unitPrice: "16.50",
          vatClass: "reduced",
          image: "pulpo-a-la-gallega.png",
        },
        {
          customerName: { en: "Padrón peppers", es: "Pimientos de Padrón" },
          pricingUnit: "each",
          unitPrice: "7.00",
          vatClass: "reduced",
          image: "pimientos-de-padron.png",
        },
        {
          customerName: { en: "Fried calamari", es: "Calamares a la romana" },
          pricingUnit: "each",
          unitPrice: "11.00",
          vatClass: "reduced",
          image: "calamares.png",
        },
        {
          customerName: { en: "Cheese board", es: "Tabla de quesos" },
          pricingUnit: "each",
          unitPrice: "14.50",
          vatClass: "reduced",
          image: "tabla-de-quesos.png",
        },
      ],
    },
    {
      name: { en: "Mains", es: "Platos principales" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Seafood paella", es: "Paella de marisco" },
          staffName: "Paella",
          kitchenName: "PAELLA MARISCO",
          pricingUnit: "each",
          unitPrice: "18.90",
          vatClass: "reduced",
          image: "paella.png",
        },
        {
          customerName: { en: "Sirloin in whisky sauce", es: "Solomillo al whisky" },
          staffName: "Solomillo",
          kitchenName: "SOLOMILLO WHISKY",
          pricingUnit: "each",
          unitPrice: "21.50",
          vatClass: "reduced",
          image: "solomillo.png",
        },
        {
          customerName: { en: "Cod pil-pil", es: "Bacalao al pil-pil" },
          pricingUnit: "each",
          unitPrice: "19.00",
          vatClass: "reduced",
          image: "bacalao.png",
        },
        {
          customerName: { en: "Grilled hake", es: "Merluza a la plancha" },
          pricingUnit: "each",
          unitPrice: "17.50",
          vatClass: "reduced",
          image: "merluza.png",
        },
      ],
    },
    {
      name: { en: "Desserts", es: "Postres" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Catalan cream", es: "Crema catalana" },
          pricingUnit: "each",
          unitPrice: "5.00",
          vatClass: "reduced",
          image: "crema-catalana.png",
        },
        {
          customerName: { en: "Santiago almond cake", es: "Tarta de Santiago" },
          staffName: "Tarta Santiago",
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "tarta-de-santiago.png",
        },
        {
          customerName: { en: "Home-made flan", es: "Flan casero" },
          pricingUnit: "each",
          unitPrice: "4.50",
          vatClass: "reduced",
          image: "flan.png",
        },
        {
          customerName: { en: "Rice pudding", es: "Arroz con leche" },
          pricingUnit: "each",
          unitPrice: "4.80",
          vatClass: "reduced",
          image: "arroz-con-leche.png",
        },
      ],
    },
    {
      name: { en: "Drinks", es: "Bebidas" },
      station: "bar",
      products: [
        {
          customerName: { en: "Negroni", es: "Negroni" },
          pricingUnit: "each",
          unitPrice: "11.00",
          vatClass: "general",
          image: "negroni.png",
        },
        {
          customerName: { en: "Glass of house red", es: "Copa de vino tinto de la casa" },
          staffName: "Tinto casa",
          pricingUnit: "each",
          unitPrice: "3.50",
          vatClass: "general",
          image: "vino-tinto.png",
        },
        {
          customerName: { en: "Draught beer", es: "Caña de cerveza" },
          staffName: "Caña",
          pricingUnit: "each",
          unitPrice: "2.80",
          vatClass: "general",
          image: "cana-cerveza.png",
        },
        {
          customerName: { en: "Cola soft drink", es: "Refresco de cola" },
          pricingUnit: "each",
          unitPrice: "2.50",
          vatClass: "general",
          image: "refresco-cola.png",
        },
        {
          customerName: { en: "Coffee", es: "Café" },
          staffName: "Café",
          description: {
            en: "Freshly ground espresso from the downstairs bar",
            es: "Espresso recién molido de la barra de abajo",
          },
          kitchenName: "COFFEE · DOWNSTAIRS BAR",
          dietaryDeclarations: ["vegetarian", "halal"],
          variants: [
            {
              customerName: { en: "Espresso", es: "Espresso solo" },
              staffName: "Café solo",
              kitchenName: "ESPRESSO",
              unitPrice: "1.40",
              available: true,
            },
            {
              // No kitchen name of its own, so the kitchen ticket falls back to this variant's own
              // staff name, never the parent's.
              customerName: { en: "Double espresso", es: "Espresso doble" },
              staffName: "Café doble",
              unitPrice: "2.10",
              available: true,
            },
          ],
          pricingUnit: "each",
          unitPrice: "1.60",
          vatClass: "general",
          image: "cafe-solo.png",
        },
        {
          customerName: { en: "Bottled mineral water", es: "Agua mineral" },
          pricingUnit: "each",
          unitPrice: "1.80",
          vatClass: "reduced",
          image: "agua-mineral.png",
        },
        {
          customerName: { en: "Orange juice", es: "Zumo de naranja" },
          pricingUnit: "each",
          unitPrice: "2.90",
          vatClass: "general",
          image: "zumo-naranja.png",
        },
      ],
    },
  ],
};

export const CASA_DELGADO: SeedCatalogue = {
  name: { en: "Casa Delgado", es: "Casa Delgado" },
  categories: COMBINED_CASA_DELGADO.categories.slice(3),
};

export const DELI_TAKEAWAY: SeedCatalogue = {
  name: { en: "Deli takeaway", es: "Charcutería para llevar" },
  categories: COMBINED_CASA_DELGADO.categories.slice(0, 3).map((category) => ({
    ...category,
    station: "deli",
  })),
};

export const MENU_DEL_DIA: SeedCatalogue = {
  name: { en: "Menú del Día", es: "Menú del Día" },
  categories: [
    {
      name: { en: "Starters", es: "Primeros" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Mixed salad", es: "Ensalada mixta" },
          description: {
            en: "Tomato, leaves and onion with dressing on the side",
            es: "Tomate, hojas y cebolla con el aliño aparte",
          },
          kitchenName: "MIXED SALAD",
          dietaryDeclarations: ["vegan"],
          unit: {
            name: { en: "serving", es: "ración" },
            precision: 2,
            abbreviation: { en: "srv", es: "rac" },
          },
          pricingUnit: "each",
          unitPrice: "6.00",
          vatClass: "reduced",
          image: "ensalada-mixta.png",
        },
        {
          customerName: { en: "Andalusian gazpacho", es: "Gazpacho andaluz" },
          staffName: "Gazpacho",
          kitchenName: "GAZPACHO",
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "gazpacho.png",
        },
        {
          customerName: { en: "Stewed lentils", es: "Lentejas estofadas" },
          pricingUnit: "each",
          unitPrice: "6.50",
          vatClass: "reduced",
          image: "lentejas.png",
        },
      ],
    },
    {
      name: { en: "Mains", es: "Segundos" },
      station: "kitchen",
      products: [
        {
          customerName: { en: "Roast chicken with chips", es: "Pollo asado con patatas" },
          staffName: "Pollo asado",
          kitchenName: "POLLO + PATATAS",
          pricingUnit: "each",
          unitPrice: "9.50",
          vatClass: "reduced",
          image: "pollo-asado.png",
        },
        {
          customerName: { en: "Battered hake", es: "Merluza rebozada" },
          pricingUnit: "each",
          unitPrice: "10.50",
          vatClass: "reduced",
          image: "merluza-rebozada.png",
        },
      ],
    },
  ],
};
