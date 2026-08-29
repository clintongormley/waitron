// Demo menu content for the two-menu Casa Delgado seed (Phase 2, Task 6). This is DEV/DEMO data — it
// stands up a plausible Spanish deli + restaurant for the multi-menu till demo and the sales
// generator, NOT a real venue's catalogue. Plausibility, not fiscal/culinary accuracy, is the bar.
//
// Two catalogues (menus):
//   - CASA_DELGADO — the à-la-carte menu: a deli COUNTER (weight-priced charcuterie, cheeses and
//     conservas, routed to the kitchen "Cocina") plus a RESTAURANT (each-priced tapas, raciones,
//     mains, desserts routed to "Cocina", and drinks routed to the bar "Barra").
//   - MENU_DEL_DIA — the fixed-price lunch menu: a handful of each-priced courses, all kitchen.
//
// Every product carries BOTH locales (`en-GB` + `es-ES`) so `seedCatalogues` can pick either. Spanish
// i18n VALUES are fine here — `apps/*` is out of the english-only guard's scope (CLAUDE.md §3); only
// code IDENTIFIERS stay English. Each `image` is the committed PNG basename Task 9's media step
// creates — this module only names them, and the names are UNIQUE across both catalogues so
// `seedCatalogues`' image→productId map has no collisions.
//
// VAT (Spanish IVA, GROSS/VAT-inclusive `unitPrice`): prepared/deli food is `reduced` (10%), basic
// bread is `super_reduced` (4%), and every drink — alcohol, soft drinks and coffee — is `general`
// (21%) EXCEPT bottled water, which is `reduced` (10%). The spread is deliberate: the demo wants a
// mix of rates in one basket so the desglose (per-rate VAT breakdown) is non-trivial.

import type { PricingUnit, VatClass } from "@waitron/catalogue";

/** The two locales every demo menu string carries. */
export type SeedLocale = "en-GB" | "es-ES";

/** A demo product: both-locale descriptions, its pricing/VAT, and the PNG basename Task 9 supplies. */
export interface SeedProduct {
  descriptions: Record<SeedLocale, string>;
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per item for `each`, per kg for `weight`. A `numeric(12,2)` string. */
  unitPrice: string;
  vatClass: VatClass;
  /** The committed PNG basename (e.g. `"jamon-iberico.png"`), unique across both catalogues. */
  image: string;
}

/** A demo category: both-locale name, its KDS routing target, and its products. `station` is the
 * logical route — `"kitchen"` → the seeded "Cocina" station, `"bar"` → the seeded "Barra" station,
 * `null` → no route (falls back to the location default at fire time). */
export interface SeedCategory {
  name: Record<SeedLocale, string>;
  station: "kitchen" | "bar" | null;
  products: SeedProduct[];
}

/** A demo catalogue (menu): both-locale name and its categories. */
export interface SeedCatalogue {
  name: Record<SeedLocale, string>;
  categories: SeedCategory[];
}

export const CASA_DELGADO: SeedCatalogue = {
  name: { "en-GB": "Casa Delgado", "es-ES": "Casa Delgado" },
  categories: [
    // ── Deli counter (weight-priced, routed to the kitchen) ──────────────────────────────────────
    {
      name: { "en-GB": "Charcuterie", "es-ES": "Charcutería" },
      station: "kitchen",
      products: [
        {
          descriptions: {
            "en-GB": "Sliced Iberian ham (per kg)",
            "es-ES": "Jamón ibérico cortado (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "89.00",
          vatClass: "reduced",
          image: "jamon-iberico.png",
        },
        {
          descriptions: {
            "en-GB": "Iberian chorizo (per kg)",
            "es-ES": "Chorizo ibérico (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "24.50",
          vatClass: "reduced",
          image: "chorizo-iberico.png",
        },
        {
          descriptions: { "en-GB": "Cured pork loin (per kg)", "es-ES": "Lomo embuchado (por kg)" },
          pricingUnit: "weight",
          unitPrice: "32.00",
          vatClass: "reduced",
          image: "lomo-embuchado.png",
        },
        {
          descriptions: { "en-GB": "Salchichón sausage (per kg)", "es-ES": "Salchichón (por kg)" },
          pricingUnit: "weight",
          unitPrice: "19.90",
          vatClass: "reduced",
          image: "salchichon.png",
        },
        {
          descriptions: {
            "en-GB": "Cured beef cecina (per kg)",
            "es-ES": "Cecina de León (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "38.00",
          vatClass: "reduced",
          image: "cecina.png",
        },
        {
          descriptions: { "en-GB": "Mallorcan sobrasada (per kg)", "es-ES": "Sobrasada (por kg)" },
          pricingUnit: "weight",
          unitPrice: "18.00",
          vatClass: "reduced",
          image: "sobrasada.png",
        },
      ],
    },
    {
      name: { "en-GB": "Cheeses", "es-ES": "Quesos" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Cured Manchego (per kg)", "es-ES": "Manchego curado (por kg)" },
          pricingUnit: "weight",
          unitPrice: "21.00",
          vatClass: "reduced",
          image: "manchego-curado.png",
        },
        {
          descriptions: { "en-GB": "Cabrales blue cheese (per kg)", "es-ES": "Cabrales (por kg)" },
          pricingUnit: "weight",
          unitPrice: "28.50",
          vatClass: "reduced",
          image: "cabrales.png",
        },
        {
          descriptions: {
            "en-GB": "Idiazábal smoked cheese (per kg)",
            "es-ES": "Idiazábal (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "26.00",
          vatClass: "reduced",
          image: "idiazabal.png",
        },
        {
          descriptions: {
            "en-GB": "Torta del Casar (per kg)",
            "es-ES": "Torta del Casar (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "34.00",
          vatClass: "reduced",
          image: "torta-del-casar.png",
        },
        {
          descriptions: { "en-GB": "Mahón cheese (per kg)", "es-ES": "Queso de Mahón (por kg)" },
          pricingUnit: "weight",
          unitPrice: "19.50",
          vatClass: "reduced",
          image: "mahon.png",
        },
      ],
    },
    {
      name: { "en-GB": "Conserves", "es-ES": "Conservas" },
      station: "kitchen",
      products: [
        {
          descriptions: {
            "en-GB": "Cantabrian anchovies (per kg)",
            "es-ES": "Anchoas del Cantábrico (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "72.00",
          vatClass: "reduced",
          image: "anchoas.png",
        },
        {
          descriptions: {
            "en-GB": "Marinated olives (per kg)",
            "es-ES": "Aceitunas aliñadas (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "8.50",
          vatClass: "reduced",
          image: "aceitunas.png",
        },
        {
          descriptions: {
            "en-GB": "Octopus in olive oil (per kg)",
            "es-ES": "Pulpo en aceite (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "46.00",
          vatClass: "reduced",
          image: "pulpo-en-aceite.png",
        },
        {
          descriptions: {
            "en-GB": "White tuna belly (per kg)",
            "es-ES": "Ventresca de bonito (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "54.00",
          vatClass: "reduced",
          image: "bonito.png",
        },
      ],
    },
    // ── Restaurant (each-priced) ─────────────────────────────────────────────────────────────────
    {
      name: { "en-GB": "Tapas", "es-ES": "Tapas" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Spicy potatoes", "es-ES": "Patatas bravas" },
          pricingUnit: "each",
          unitPrice: "6.50",
          vatClass: "reduced",
          image: "patatas-bravas.png",
        },
        {
          descriptions: { "en-GB": "Ham croquettes", "es-ES": "Croquetas de jamón" },
          pricingUnit: "each",
          unitPrice: "7.80",
          vatClass: "reduced",
          image: "croquetas.png",
        },
        {
          descriptions: { "en-GB": "Garlic prawns", "es-ES": "Gambas al ajillo" },
          pricingUnit: "each",
          unitPrice: "9.90",
          vatClass: "reduced",
          image: "gambas-al-ajillo.png",
        },
        {
          descriptions: { "en-GB": "Spanish omelette", "es-ES": "Tortilla española" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "tortilla.png",
        },
        {
          descriptions: { "en-GB": "House bread", "es-ES": "Pan de la casa" },
          pricingUnit: "each",
          unitPrice: "2.20",
          vatClass: "super_reduced",
          image: "pan-de-la-casa.png",
        },
        {
          descriptions: { "en-GB": "Bread with tomato", "es-ES": "Pan con tomate" },
          pricingUnit: "each",
          unitPrice: "3.20",
          vatClass: "reduced",
          image: "pan-con-tomate.png",
        },
      ],
    },
    {
      name: { "en-GB": "Sharing plates", "es-ES": "Raciones" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Galician-style octopus", "es-ES": "Pulpo a la gallega" },
          pricingUnit: "each",
          unitPrice: "16.50",
          vatClass: "reduced",
          image: "pulpo-a-la-gallega.png",
        },
        {
          descriptions: { "en-GB": "Padrón peppers", "es-ES": "Pimientos de Padrón" },
          pricingUnit: "each",
          unitPrice: "7.00",
          vatClass: "reduced",
          image: "pimientos-de-padron.png",
        },
        {
          descriptions: { "en-GB": "Fried calamari", "es-ES": "Calamares a la romana" },
          pricingUnit: "each",
          unitPrice: "11.00",
          vatClass: "reduced",
          image: "calamares.png",
        },
        {
          descriptions: { "en-GB": "Cheese board", "es-ES": "Tabla de quesos" },
          pricingUnit: "each",
          unitPrice: "14.50",
          vatClass: "reduced",
          image: "tabla-de-quesos.png",
        },
      ],
    },
    {
      name: { "en-GB": "Mains", "es-ES": "Platos principales" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Seafood paella", "es-ES": "Paella de marisco" },
          pricingUnit: "each",
          unitPrice: "18.90",
          vatClass: "reduced",
          image: "paella.png",
        },
        {
          descriptions: { "en-GB": "Sirloin in whisky sauce", "es-ES": "Solomillo al whisky" },
          pricingUnit: "each",
          unitPrice: "21.50",
          vatClass: "reduced",
          image: "solomillo.png",
        },
        {
          descriptions: { "en-GB": "Cod pil-pil", "es-ES": "Bacalao al pil-pil" },
          pricingUnit: "each",
          unitPrice: "19.00",
          vatClass: "reduced",
          image: "bacalao.png",
        },
        {
          descriptions: { "en-GB": "Grilled hake", "es-ES": "Merluza a la plancha" },
          pricingUnit: "each",
          unitPrice: "17.50",
          vatClass: "reduced",
          image: "merluza.png",
        },
      ],
    },
    {
      name: { "en-GB": "Desserts", "es-ES": "Postres" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Catalan cream", "es-ES": "Crema catalana" },
          pricingUnit: "each",
          unitPrice: "5.00",
          vatClass: "reduced",
          image: "crema-catalana.png",
        },
        {
          descriptions: { "en-GB": "Santiago almond cake", "es-ES": "Tarta de Santiago" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "tarta-de-santiago.png",
        },
        {
          descriptions: { "en-GB": "Home-made flan", "es-ES": "Flan casero" },
          pricingUnit: "each",
          unitPrice: "4.50",
          vatClass: "reduced",
          image: "flan.png",
        },
        {
          descriptions: { "en-GB": "Rice pudding", "es-ES": "Arroz con leche" },
          pricingUnit: "each",
          unitPrice: "4.80",
          vatClass: "reduced",
          image: "arroz-con-leche.png",
        },
      ],
    },
    // ── Drinks (each-priced, routed to the bar) ──────────────────────────────────────────────────
    {
      name: { "en-GB": "Drinks", "es-ES": "Bebidas" },
      station: "bar",
      products: [
        {
          descriptions: { "en-GB": "Glass of house red", "es-ES": "Copa de vino tinto de la casa" },
          pricingUnit: "each",
          unitPrice: "3.50",
          vatClass: "general",
          image: "vino-tinto.png",
        },
        {
          descriptions: { "en-GB": "Draught beer", "es-ES": "Caña de cerveza" },
          pricingUnit: "each",
          unitPrice: "2.80",
          vatClass: "general",
          image: "cana-cerveza.png",
        },
        {
          descriptions: { "en-GB": "Cola soft drink", "es-ES": "Refresco de cola" },
          pricingUnit: "each",
          unitPrice: "2.50",
          vatClass: "general",
          image: "refresco-cola.png",
        },
        {
          descriptions: { "en-GB": "Black coffee", "es-ES": "Café solo" },
          pricingUnit: "each",
          unitPrice: "1.60",
          vatClass: "general",
          image: "cafe-solo.png",
        },
        {
          descriptions: { "en-GB": "Bottled mineral water", "es-ES": "Agua mineral" },
          pricingUnit: "each",
          unitPrice: "1.80",
          vatClass: "reduced",
          image: "agua-mineral.png",
        },
        {
          descriptions: { "en-GB": "Orange juice", "es-ES": "Zumo de naranja" },
          pricingUnit: "each",
          unitPrice: "2.90",
          vatClass: "general",
          image: "zumo-naranja.png",
        },
      ],
    },
  ],
};

export const MENU_DEL_DIA: SeedCatalogue = {
  name: { "en-GB": "Menú del Día", "es-ES": "Menú del Día" },
  categories: [
    {
      name: { "en-GB": "Starters", "es-ES": "Primeros" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Mixed salad", "es-ES": "Ensalada mixta" },
          pricingUnit: "each",
          unitPrice: "6.00",
          vatClass: "reduced",
          image: "ensalada-mixta.png",
        },
        {
          descriptions: { "en-GB": "Andalusian gazpacho", "es-ES": "Gazpacho andaluz" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "gazpacho.png",
        },
        {
          descriptions: { "en-GB": "Stewed lentils", "es-ES": "Lentejas estofadas" },
          pricingUnit: "each",
          unitPrice: "6.50",
          vatClass: "reduced",
          image: "lentejas.png",
        },
      ],
    },
    {
      name: { "en-GB": "Mains", "es-ES": "Segundos" },
      station: "kitchen",
      products: [
        {
          descriptions: { "en-GB": "Roast chicken with chips", "es-ES": "Pollo asado con patatas" },
          pricingUnit: "each",
          unitPrice: "9.50",
          vatClass: "reduced",
          image: "pollo-asado.png",
        },
        {
          descriptions: { "en-GB": "Battered hake", "es-ES": "Merluza rebozada" },
          pricingUnit: "each",
          unitPrice: "10.50",
          vatClass: "reduced",
          image: "merluza-rebozada.png",
        },
      ],
    },
  ],
};
