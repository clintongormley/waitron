// Demo menu content for the Casa Delgado seed: plausibility, not fiscal or culinary accuracy, is
// the bar. Each `image` basename is unique across the catalogues, because `seedCatalogues` maps
// image to product id. The VAT classes are mixed on purpose, so one basket's per-rate breakdown is
// non-trivial.

import type { SeedCatalogue, SeedCategory, SeedProductOptionLists } from "./data-set.js";
import type { CasaDelgadoLanguage } from "./data-sets/casa-delgado-es.js";

type Catalogue = SeedCatalogue<CasaDelgadoLanguage>;

export type SeedLocale = "en" | "es";

/** Content is authored under the bare tag; the venue's `invoice_locales` and display locale take
 *  the full tag. */
export const SEED_INVOICE_LOCALE: Record<SeedLocale, string> = {
  en: "en-GB",
  es: "es-ES",
};

// This list's staff names are Spanish because a staff name is one plain string, never translated
// at read time.
export const PRODUCT_OPTION_LISTS: SeedProductOptionLists<CasaDelgadoLanguage>[] = [
  {
    productImage: "solomillo.png",
    lists: [
      {
        name: "Punto",
        customerName: {
          en: "How would you like it cooked?",
          es: "¿Cómo la quiere hecha?",
          ca: "Com la vol feta?",
          gl: "Como a quere feita?",
        },
        kitchenName: "PUNTO CARNE",
        labels: [
          {
            name: "Poco",
            customerName: {
              en: "Rare, red in the middle",
              es: "Poco hecho, rojo por dentro",
              ca: "Poc feta, vermella per dins",
              gl: "Pouco feita, vermella por dentro",
            },
            kitchenName: "POCO HECHO",
          },
          {
            name: "Punto medio",
            customerName: {
              en: "Medium, pink in the middle",
              es: "Al punto, rosado por dentro",
              ca: "Al punt, rosada per dins",
              gl: "Ao punto, rosada por dentro",
            },
            kitchenName: "AL PUNTO",
            preselected: true,
          },
          {
            name: "Muy",
            customerName: {
              en: "Well done, cooked through",
              es: "Muy hecho, sin nada de rosa",
              ca: "Molt feta, gens rosada",
              gl: "Moi feita, nada rosada",
            },
            kitchenName: "MUY HECHO",
          },
        ],
      },
    ],
  },
];

const COMBINED_CASA_DELGADO_CATEGORIES: SeedCategory<CasaDelgadoLanguage>[] = [
  {
    name: { en: "Charcuterie", es: "Charcutería", ca: "Xarcuteria", gl: "Charcutaría" },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Sliced Iberian ham (per kg)",
          es: "Jamón ibérico cortado (por kg)",
          ca: "Pernil ibèric tallat (per kg)",
          gl: "Xamón ibérico cortado (por kg)",
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
          ca: "Xoriço ibèric (per kg)",
          gl: "Chourizo ibérico (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "24.50",
        vatClass: "reduced",
        image: "chorizo-iberico.png",
      },
      {
        customerName: {
          en: "Cured pork loin (per kg)",
          es: "Lomo embuchado (por kg)",
          ca: "Llom embotit (per kg)",
          gl: "Lombo embuchado (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "32.00",
        vatClass: "reduced",
        image: "lomo-embuchado.png",
      },
      {
        customerName: {
          en: "Salchichón sausage (per kg)",
          es: "Salchichón (por kg)",
          ca: "Salsitxó (per kg)",
          gl: "Salchichón (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "19.90",
        vatClass: "reduced",
        image: "salchichon.png",
      },
      {
        customerName: {
          en: "Cured beef cecina (per kg)",
          es: "Cecina de León (por kg)",
          ca: "Cecina de Lleó (per kg)",
          gl: "Cecina de León (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "38.00",
        vatClass: "reduced",
        image: "cecina.png",
      },
      {
        customerName: {
          en: "Mallorcan sobrasada (per kg)",
          es: "Sobrasada (por kg)",
          ca: "Sobrassada (per kg)",
          gl: "Sobrasada (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "18.00",
        vatClass: "reduced",
        image: "sobrasada.png",
      },
    ],
  },
  {
    name: { en: "Cheeses", es: "Quesos", ca: "Formatges", gl: "Queixos" },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Cured Manchego (per kg)",
          es: "Manchego curado (por kg)",
          ca: "Formatge manxec curat (per kg)",
          gl: "Queixo manchego curado (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "21.00",
        vatClass: "reduced",
        image: "manchego-curado.png",
      },
      {
        customerName: {
          en: "Cabrales blue cheese (per kg)",
          es: "Cabrales (por kg)",
          ca: "Cabrales (per kg)",
          gl: "Queixo de Cabrales (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "28.50",
        vatClass: "reduced",
        image: "cabrales.png",
      },
      {
        customerName: {
          en: "Idiazábal smoked cheese (per kg)",
          es: "Idiazábal (por kg)",
          ca: "Idiazábal (per kg)",
          gl: "Queixo Idiazábal (por kg)",
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
          ca: "Torta del Casar (per kg)",
          gl: "Torta del Casar (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "34.00",
        vatClass: "reduced",
        image: "torta-del-casar.png",
      },
      {
        customerName: {
          en: "Mahón cheese (per kg)",
          es: "Queso de Mahón (por kg)",
          ca: "Formatge de Maó (per kg)",
          gl: "Queixo de Mahón (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "19.50",
        vatClass: "reduced",
        image: "mahon.png",
      },
    ],
  },
  {
    name: { en: "Conserves", es: "Conservas", ca: "Conserves", gl: "Conservas" },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Cantabrian anchovies (per kg)",
          es: "Anchoas del Cantábrico (por kg)",
          ca: "Anxoves del Cantàbric (per kg)",
          gl: "Anchoas do Cantábrico (por kg)",
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
          ca: "Olives adobades (per kg)",
          gl: "Olivas aliñadas (por kg)",
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
          ca: "Pop en oli (per kg)",
          gl: "Polbo en aceite (por kg)",
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
          ca: "Ventresca de bonítol (per kg)",
          gl: "Ventrecha de bonito (por kg)",
        },
        pricingUnit: "weight",
        unitPrice: "54.00",
        vatClass: "reduced",
        image: "bonito.png",
      },
    ],
  },
  {
    name: { en: "Tapas", es: "Tapas", ca: "Tapes", gl: "Tapas" },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Spicy potatoes",
          es: "Patatas bravas",
          ca: "Patates braves",
          gl: "Patacas bravas",
        },
        staffName: "Bravas",
        kitchenName: "BRAVAS",
        pricingUnit: "each",
        unitPrice: "6.50",
        vatClass: "reduced",
        image: "patatas-bravas.png",
      },
      {
        customerName: {
          en: "Ham croquettes",
          es: "Croquetas de jamón",
          ca: "Croquetes de pernil",
          gl: "Croquetas de xamón",
        },
        staffName: "Croquetas",
        kitchenName: "CROQ JAMON",
        pricingUnit: "each",
        unitPrice: "7.80",
        vatClass: "reduced",
        image: "croquetas.png",
      },
      {
        customerName: {
          en: "Garlic prawns",
          es: "Gambas al ajillo",
          ca: "Gambes a l'all",
          gl: "Gambas ao allo",
        },
        staffName: "Gambas",
        kitchenName: "GAMBAS AJILLO",
        pricingUnit: "each",
        unitPrice: "9.90",
        vatClass: "reduced",
        image: "gambas-al-ajillo.png",
      },
      {
        customerName: {
          en: "Spanish omelette",
          es: "Tortilla española",
          ca: "Truita de patates",
          gl: "Tortilla de patacas",
        },
        pricingUnit: "each",
        unitPrice: "5.50",
        vatClass: "reduced",
        image: "tortilla.png",
      },
      {
        customerName: {
          en: "House bread",
          es: "Pan de la casa",
          ca: "Pa de la casa",
          gl: "Pan da casa",
        },
        pricingUnit: "each",
        unitPrice: "2.20",
        vatClass: "super_reduced",
        image: "pan-de-la-casa.png",
      },
      {
        customerName: {
          en: "Bread with tomato",
          es: "Pan con tomate",
          ca: "Pa amb tomàquet",
          gl: "Pan con tomate",
        },
        pricingUnit: "each",
        unitPrice: "3.20",
        vatClass: "reduced",
        image: "pan-con-tomate.png",
      },
    ],
  },
  {
    name: { en: "Sharing plates", es: "Raciones", ca: "Racions", gl: "Racións" },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Galician-style octopus",
          es: "Pulpo a la gallega",
          ca: "Pop a la gallega",
          gl: "Polbo á feira",
        },
        staffName: "Pulpo",
        kitchenName: "PULPO GALLEGA",
        pricingUnit: "each",
        unitPrice: "16.50",
        vatClass: "reduced",
        image: "pulpo-a-la-gallega.png",
      },
      {
        customerName: {
          en: "Padrón peppers",
          es: "Pimientos de Padrón",
          ca: "Pebrots de Padrón",
          gl: "Pementos de Padrón",
        },
        pricingUnit: "each",
        unitPrice: "7.00",
        vatClass: "reduced",
        image: "pimientos-de-padron.png",
      },
      {
        customerName: {
          en: "Fried calamari",
          es: "Calamares a la romana",
          ca: "Calamars a la romana",
          gl: "Luras á romana",
        },
        pricingUnit: "each",
        unitPrice: "11.00",
        vatClass: "reduced",
        image: "calamares.png",
      },
      {
        customerName: {
          en: "Cheese board",
          es: "Tabla de quesos",
          ca: "Taula de formatges",
          gl: "Táboa de queixos",
        },
        pricingUnit: "each",
        unitPrice: "14.50",
        vatClass: "reduced",
        image: "tabla-de-quesos.png",
      },
    ],
  },
  {
    name: {
      en: "Mains",
      es: "Platos principales",
      ca: "Plats principals",
      gl: "Pratos principais",
    },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Seafood paella",
          es: "Paella de marisco",
          ca: "Paella de marisc",
          gl: "Paella de marisco",
        },
        staffName: "Paella",
        kitchenName: "PAELLA MARISCO",
        pricingUnit: "each",
        unitPrice: "18.90",
        vatClass: "reduced",
        image: "paella.png",
      },
      {
        customerName: {
          en: "Sirloin in whisky sauce",
          es: "Solomillo al whisky",
          ca: "Filet al whisky",
          gl: "Solombo ao whisky",
        },
        staffName: "Solomillo",
        kitchenName: "SOLOMILLO WHISKY",
        pricingUnit: "each",
        unitPrice: "21.50",
        vatClass: "reduced",
        image: "solomillo.png",
      },
      {
        customerName: {
          en: "Cod pil-pil",
          es: "Bacalao al pil-pil",
          ca: "Bacallà al pil-pil",
          gl: "Bacallau ao pil-pil",
        },
        pricingUnit: "each",
        unitPrice: "19.00",
        vatClass: "reduced",
        image: "bacalao.png",
      },
      {
        customerName: {
          en: "Grilled hake",
          es: "Merluza a la plancha",
          ca: "Lluç a la planxa",
          gl: "Pescada á prancha",
        },
        pricingUnit: "each",
        unitPrice: "17.50",
        vatClass: "reduced",
        image: "merluza.png",
      },
    ],
  },
  {
    name: { en: "Desserts", es: "Postres", ca: "Postres", gl: "Sobremesas" },
    station: "kitchen",
    products: [
      {
        customerName: {
          en: "Catalan cream",
          es: "Crema catalana",
          ca: "Crema catalana",
          gl: "Crema catalá",
        },
        pricingUnit: "each",
        unitPrice: "5.00",
        vatClass: "reduced",
        image: "crema-catalana.png",
      },
      {
        customerName: {
          en: "Santiago almond cake",
          es: "Tarta de Santiago",
          ca: "Pastís de Santiago",
          gl: "Torta de Santiago",
        },
        staffName: "Tarta Santiago",
        pricingUnit: "each",
        unitPrice: "5.50",
        vatClass: "reduced",
        image: "tarta-de-santiago.png",
      },
      {
        customerName: {
          en: "Home-made flan",
          es: "Flan casero",
          ca: "Flam casolà",
          gl: "Flan caseiro",
        },
        pricingUnit: "each",
        unitPrice: "4.50",
        vatClass: "reduced",
        image: "flan.png",
      },
      {
        customerName: {
          en: "Rice pudding",
          es: "Arroz con leche",
          ca: "Arròs amb llet",
          gl: "Arroz con leite",
        },
        pricingUnit: "each",
        unitPrice: "4.80",
        vatClass: "reduced",
        image: "arroz-con-leche.png",
      },
    ],
  },
  {
    name: { en: "Drinks", es: "Bebidas", ca: "Begudes", gl: "Bebidas" },
    station: "bar",
    products: [
      {
        customerName: { en: "Negroni", es: "Negroni", ca: "Negroni", gl: "Negroni" },
        pricingUnit: "each",
        unitPrice: "11.00",
        vatClass: "general",
        image: "negroni.png",
      },
      {
        customerName: {
          en: "Glass of house red",
          es: "Copa de vino tinto de la casa",
          ca: "Copa de vi negre de la casa",
          gl: "Copa de viño tinto da casa",
        },
        staffName: "Tinto casa",
        pricingUnit: "each",
        unitPrice: "3.50",
        vatClass: "general",
        image: "vino-tinto.png",
      },
      {
        customerName: {
          en: "Draught beer",
          es: "Caña de cerveza",
          ca: "Canya de cervesa",
          gl: "Caña de cervexa",
        },
        staffName: "Caña",
        pricingUnit: "each",
        unitPrice: "2.80",
        vatClass: "general",
        image: "cana-cerveza.png",
      },
      {
        customerName: {
          en: "Cola soft drink",
          es: "Refresco de cola",
          ca: "Refresc de cola",
          gl: "Refresco de cola",
        },
        pricingUnit: "each",
        unitPrice: "2.50",
        vatClass: "general",
        image: "refresco-cola.png",
      },
      {
        customerName: { en: "Coffee", es: "Café", ca: "Cafè", gl: "Café" },
        staffName: "Café",
        description: {
          en: "Freshly ground espresso from the downstairs bar",
          es: "Espresso recién molido de la barra de abajo",
          ca: "Cafè exprés acabat de moldre de la barra de baix",
          gl: "Café expreso acabado de moer na barra de abaixo",
        },
        kitchenName: "COFFEE · DOWNSTAIRS BAR",
        dietaryDeclarations: ["vegetarian", "halal"],
        variants: [
          {
            customerName: { en: "Espresso", es: "Espresso solo", ca: "Cafè sol", gl: "Café só" },
            staffName: "Café solo",
            kitchenName: "ESPRESSO",
            unitPrice: "1.40",
            available: true,
          },
          {
            // No kitchen name of its own, so the kitchen ticket falls back to this variant's own
            // staff name, never the parent's.
            customerName: {
              en: "Double espresso",
              es: "Espresso doble",
              ca: "Cafè sol doble",
              gl: "Café só dobre",
            },
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
        customerName: {
          en: "Bottled mineral water",
          es: "Agua mineral",
          ca: "Aigua mineral",
          gl: "Auga mineral",
        },
        pricingUnit: "each",
        unitPrice: "1.80",
        vatClass: "reduced",
        image: "agua-mineral.png",
      },
      {
        customerName: {
          en: "Orange juice",
          es: "Zumo de naranja",
          ca: "Suc de taronja",
          gl: "Zume de laranxa",
        },
        pricingUnit: "each",
        unitPrice: "2.90",
        vatClass: "general",
        image: "zumo-naranja.png",
      },
    ],
  },
];

export const CASA_DELGADO: Catalogue = {
  name: { en: "Casa Delgado", es: "Casa Delgado" },
  customerName: {
    en: "Our menu",
    es: "Nuestra carta",
    ca: "La nostra carta",
    gl: "A nosa carta",
  },
  categories: COMBINED_CASA_DELGADO_CATEGORIES.slice(3),
};

export const DELI_TAKEAWAY: Catalogue = {
  name: { en: "Deli takeaway", es: "Charcutería para llevar" },
  customerName: {
    en: "Cured meats and cheese to take away",
    es: "Embutidos y quesos para llevar",
    ca: "Embotits i formatges per emportar",
    gl: "Embutidos e queixos para levar",
  },
  categories: COMBINED_CASA_DELGADO_CATEGORIES.slice(0, 3).map((category) => ({
    ...category,
    station: "deli",
  })),
};

export const MENU_DEL_DIA: Catalogue = {
  name: { en: "Menú del Día", es: "Menú del Día" },
  customerName: {
    en: "Lunch menu",
    es: "Menú del mediodía",
    ca: "Menú de migdia",
    gl: "Menú do xantar",
  },
  categories: [
    {
      name: { en: "Starters", es: "Primeros", ca: "Primers", gl: "Primeiros" },
      station: "kitchen",
      products: [
        {
          customerName: {
            en: "Mixed salad",
            es: "Ensalada mixta",
            ca: "Amanida variada",
            gl: "Ensalada mixta",
          },
          description: {
            en: "Tomato, leaves and onion with dressing on the side",
            es: "Tomate, hojas y cebolla con el aliño aparte",
            ca: "Tomàquet, fulles i ceba amb l'amaniment a part",
            gl: "Tomate, follas e cebola co aliño á parte",
          },
          kitchenName: "MIXED SALAD",
          dietaryDeclarations: ["vegan"],
          unit: {
            name: { en: "serving", es: "ración", ca: "ració", gl: "ración" },
            precision: 2,
            abbreviation: { en: "srv", es: "rac", ca: "rac", gl: "rac" },
          },
          pricingUnit: "each",
          unitPrice: "6.00",
          vatClass: "reduced",
          image: "ensalada-mixta.png",
        },
        {
          customerName: {
            en: "Andalusian gazpacho",
            es: "Gazpacho andaluz",
            ca: "Gaspatxo andalús",
            gl: "Gazpacho andaluz",
          },
          staffName: "Gazpacho",
          kitchenName: "GAZPACHO",
          pricingUnit: "each",
          unitPrice: "5.50",
          vatClass: "reduced",
          image: "gazpacho.png",
        },
        {
          customerName: {
            en: "Stewed lentils",
            es: "Lentejas estofadas",
            ca: "Llenties estofades",
            gl: "Lentellas estofadas",
          },
          pricingUnit: "each",
          unitPrice: "6.50",
          vatClass: "reduced",
          image: "lentejas.png",
        },
      ],
    },
    {
      name: { en: "Mains", es: "Segundos", ca: "Segons", gl: "Segundos" },
      categoryName: "Lunch mains",
      station: "kitchen",
      products: [
        {
          customerName: {
            en: "Roast chicken with chips",
            es: "Pollo asado con patatas",
            ca: "Pollastre rostit amb patates",
            gl: "Polo asado con patacas",
          },
          staffName: "Pollo asado",
          kitchenName: "POLLO + PATATAS",
          pricingUnit: "each",
          unitPrice: "9.50",
          vatClass: "reduced",
          image: "pollo-asado.png",
        },
        {
          customerName: {
            en: "Battered hake",
            es: "Merluza rebozada",
            ca: "Lluç arrebossat",
            gl: "Pescada rebozada",
          },
          pricingUnit: "each",
          unitPrice: "10.50",
          vatClass: "reduced",
          image: "merluza-rebozada.png",
        },
      ],
    },
  ],
};
