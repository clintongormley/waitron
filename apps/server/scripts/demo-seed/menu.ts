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
// Content is authored under the BARE language tag (`en`/`es`) — the "author bare, file full-tag"
// model of feature B. Every product carries BOTH bare locales (`en` + `es`) so `seedCatalogues` can
// pick either; the fiscal/display config locale (the venue's `invoice_locales`, `WAITRON_TILL_LOCALE`)
// is the FULL tag its bare content files under — see `SEED_INVOICE_LOCALE`. Spanish
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

/** The two BARE content locales every demo menu string carries (feature B "author bare"). */
export type SeedLocale = "en" | "es";

/**
 * The FULL BCP-47 tag each bare content locale files under — the venue's fiscal `invoice_locales`
 * and the till/dashboard display locale (a `SUPPORTED_LOCALES` code). Content is authored bare (`es`)
 * and filed/displayed full-tag (`es-ES`); this map bridges the two for the seed's config, exactly as
 * `toInvoiceLineDescriptions` bridges them on the live sale path.
 */
export const SEED_INVOICE_LOCALE: Record<SeedLocale, string> = {
  en: "en-GB",
  es: "es-ES",
};

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
  name: { en: "Casa Delgado", es: "Casa Delgado" },
  categories: [
    // ── Deli counter (weight-priced, routed to the kitchen) ──────────────────────────────────────
    {
      name: { en: "Charcuterie", es: "Charcutería" },
      station: "kitchen",
      products: [
        {
          descriptions: {
            en: "Sliced Iberian ham (per kg)",
            es: "Jamón ibérico cortado (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "89.00",
          vatClass: "reduced",
          image: "jamon-iberico.png",
        },
        {
          descriptions: {
            en: "Iberian chorizo (per kg)",
            es: "Chorizo ibérico (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "24.50",
          vatClass: "reduced",
          image: "chorizo-iberico.png",
        },
        {
          descriptions: { en: "Cured pork loin (per kg)", es: "Lomo embuchado (por kg)" },
          pricingUnit: "weight",
          unitPrice: "32.00",
          vatClass: "reduced",
          image: "lomo-embuchado.png",
        },
        {
          descriptions: { en: "Salchichón sausage (per kg)", es: "Salchichón (por kg)" },
          pricingUnit: "weight",
          unitPrice: "19.90",
          vatClass: "reduced",
          image: "salchichon.png",
        },
        {
          descriptions: {
            en: "Cured beef cecina (per kg)",
            es: "Cecina de León (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "38.00",
          vatClass: "reduced",
          image: "cecina.png",
        },
        {
          descriptions: { en: "Mallorcan sobrasada (per kg)", es: "Sobrasada (por kg)" },
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
          descriptions: { en: "Cured Manchego (per kg)", es: "Manchego curado (por kg)" },
          pricingUnit: "weight",
          unitPrice: "21.00",
          vatClass: "reduced",
          image: "manchego-curado.png",
        },
        {
          descriptions: { en: "Cabrales blue cheese (per kg)", es: "Cabrales (por kg)" },
          pricingUnit: "weight",
          unitPrice: "28.50",
          vatClass: "reduced",
          image: "cabrales.png",
        },
        {
          descriptions: {
            en: "Idiazábal smoked cheese (per kg)",
            es: "Idiazábal (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "26.00",
          vatClass: "reduced",
          image: "idiazabal.png",
        },
        {
          descriptions: {
            en: "Torta del Casar (per kg)",
            es: "Torta del Casar (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "34.00",
          vatClass: "reduced",
          image: "torta-del-casar.png",
        },
        {
          descriptions: { en: "Mahón cheese (per kg)", es: "Queso de Mahón (por kg)" },
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
          descriptions: {
            en: "Cantabrian anchovies (per kg)",
            es: "Anchoas del Cantábrico (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "72.00",
          vatClass: "reduced",
          image: "anchoas.png",
        },
        {
          descriptions: {
            en: "Marinated olives (per kg)",
            es: "Aceitunas aliñadas (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "8.50",
          vatClass: "reduced",
          image: "aceitunas.png",
        },
        {
          descriptions: {
            en: "Octopus in olive oil (per kg)",
            es: "Pulpo en aceite (por kg)",
          },
          pricingUnit: "weight",
          unitPrice: "46.00",
          vatClass: "reduced",
          image: "pulpo-en-aceite.png",
        },
        {
          descriptions: {
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
    // ── Restaurant (each-priced) ─────────────────────────────────────────────────────────────────
    {
      name: { en: "Tapas", es: "Tapas" },
      station: "kitchen",
      products: [
        {
          descriptions: { en: "Spicy potatoes", es: "Patatas bravas" },
          pricingUnit: "each",
          unitPrice: "6.50",
          vatClass: "reduced",
          image: "patatas-bravas.png",
        },
        {
          descriptions: { en: "Ham croquettes", es: "Croquetas de jamón" },
          pricingUnit: "each",
          unitPrice: "7.80",
          vatClass: "reduced",
          image: "croquetas.png",
        },
        {
          descriptions: { en: "Garlic prawns", es: "Gambas al ajillo" },
          pricingUnit: "each",
          unitPrice: "9.90",
          vatClass: "reduced",
          image: "gambas-al-ajillo.png",
        },
        {
          descriptions: { en: "Spanish omelette", es: "Tortilla española" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "tortilla.png",
        },
        {
          descriptions: { en: "House bread", es: "Pan de la casa" },
          pricingUnit: "each",
          unitPrice: "2.20",
          vatClass: "super_reduced",
          image: "pan-de-la-casa.png",
        },
        {
          descriptions: { en: "Bread with tomato", es: "Pan con tomate" },
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
          descriptions: { en: "Galician-style octopus", es: "Pulpo a la gallega" },
          pricingUnit: "each",
          unitPrice: "16.50",
          vatClass: "reduced",
          image: "pulpo-a-la-gallega.png",
        },
        {
          descriptions: { en: "Padrón peppers", es: "Pimientos de Padrón" },
          pricingUnit: "each",
          unitPrice: "7.00",
          vatClass: "reduced",
          image: "pimientos-de-padron.png",
        },
        {
          descriptions: { en: "Fried calamari", es: "Calamares a la romana" },
          pricingUnit: "each",
          unitPrice: "11.00",
          vatClass: "reduced",
          image: "calamares.png",
        },
        {
          descriptions: { en: "Cheese board", es: "Tabla de quesos" },
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
          descriptions: { en: "Seafood paella", es: "Paella de marisco" },
          pricingUnit: "each",
          unitPrice: "18.90",
          vatClass: "reduced",
          image: "paella.png",
        },
        {
          descriptions: { en: "Sirloin in whisky sauce", es: "Solomillo al whisky" },
          pricingUnit: "each",
          unitPrice: "21.50",
          vatClass: "reduced",
          image: "solomillo.png",
        },
        {
          descriptions: { en: "Cod pil-pil", es: "Bacalao al pil-pil" },
          pricingUnit: "each",
          unitPrice: "19.00",
          vatClass: "reduced",
          image: "bacalao.png",
        },
        {
          descriptions: { en: "Grilled hake", es: "Merluza a la plancha" },
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
          descriptions: { en: "Catalan cream", es: "Crema catalana" },
          pricingUnit: "each",
          unitPrice: "5.00",
          vatClass: "reduced",
          image: "crema-catalana.png",
        },
        {
          descriptions: { en: "Santiago almond cake", es: "Tarta de Santiago" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "tarta-de-santiago.png",
        },
        {
          descriptions: { en: "Home-made flan", es: "Flan casero" },
          pricingUnit: "each",
          unitPrice: "4.50",
          vatClass: "reduced",
          image: "flan.png",
        },
        {
          descriptions: { en: "Rice pudding", es: "Arroz con leche" },
          pricingUnit: "each",
          unitPrice: "4.80",
          vatClass: "reduced",
          image: "arroz-con-leche.png",
        },
      ],
    },
    // ── Drinks (each-priced, routed to the bar) ──────────────────────────────────────────────────
    {
      name: { en: "Drinks", es: "Bebidas" },
      station: "bar",
      products: [
        {
          descriptions: { en: "Glass of house red", es: "Copa de vino tinto de la casa" },
          pricingUnit: "each",
          unitPrice: "3.50",
          vatClass: "general",
          image: "vino-tinto.png",
        },
        {
          descriptions: { en: "Draught beer", es: "Caña de cerveza" },
          pricingUnit: "each",
          unitPrice: "2.80",
          vatClass: "general",
          image: "cana-cerveza.png",
        },
        {
          descriptions: { en: "Cola soft drink", es: "Refresco de cola" },
          pricingUnit: "each",
          unitPrice: "2.50",
          vatClass: "general",
          image: "refresco-cola.png",
        },
        {
          descriptions: { en: "Black coffee", es: "Café solo" },
          pricingUnit: "each",
          unitPrice: "1.60",
          vatClass: "general",
          image: "cafe-solo.png",
        },
        {
          descriptions: { en: "Bottled mineral water", es: "Agua mineral" },
          pricingUnit: "each",
          unitPrice: "1.80",
          vatClass: "reduced",
          image: "agua-mineral.png",
        },
        {
          descriptions: { en: "Orange juice", es: "Zumo de naranja" },
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
  name: { en: "Menú del Día", es: "Menú del Día" },
  categories: [
    {
      name: { en: "Starters", es: "Primeros" },
      station: "kitchen",
      products: [
        {
          descriptions: { en: "Mixed salad", es: "Ensalada mixta" },
          pricingUnit: "each",
          unitPrice: "6.00",
          vatClass: "reduced",
          image: "ensalada-mixta.png",
        },
        {
          descriptions: { en: "Andalusian gazpacho", es: "Gazpacho andaluz" },
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "gazpacho.png",
        },
        {
          descriptions: { en: "Stewed lentils", es: "Lentejas estofadas" },
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
          descriptions: { en: "Roast chicken with chips", es: "Pollo asado con patatas" },
          pricingUnit: "each",
          unitPrice: "9.50",
          vatClass: "reduced",
          image: "pollo-asado.png",
        },
        {
          descriptions: { en: "Battered hake", es: "Merluza rebozada" },
          pricingUnit: "each",
          unitPrice: "10.50",
          vatClass: "reduced",
          image: "merluza-rebozada.png",
        },
      ],
    },
  ],
};
