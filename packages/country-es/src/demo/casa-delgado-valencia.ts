import type { CountryDemoData } from "@waitron/country";
import { CASA_DELGADO_ES } from "./casa-delgado-es.js";

const REGIONAL_DISHES = [
  {
    staffName: {
      en: "Eel and potato stew",
      es: "All i pebre",
      "ca-ES-valencia": "All i pebre",
    },
    kitchenName: {
      en: "Eel and potato stew · kitchen",
      es: "All i pebre · cocina",
      "ca-ES-valencia": "All i pebre · cuina",
    },
    customerName: {
      en: "House eel and potato stew",
      es: "All i pebre de la casa",
      "ca-ES-valencia": "All i pebre de la casa",
    },
    image: "valencia-all-pebre.png",
    unitPrice: "14.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Pepper and salt cod salad",
      es: "Esgarraet",
      "ca-ES-valencia": "Esgarraet",
    },
    kitchenName: {
      en: "Pepper and salt cod salad · kitchen",
      es: "Esgarraet · cocina",
      "ca-ES-valencia": "Esgarraet · cuina",
    },
    customerName: {
      en: "House pepper and salt cod salad",
      es: "Esgarraet de la casa",
      "ca-ES-valencia": "Esgarraet de la casa",
    },
    image: "valencia-esgarraet.png",
    unitPrice: "8.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Valencian paella",
      es: "Paella valenciana",
      "ca-ES-valencia": "Paella valenciana",
    },
    kitchenName: {
      en: "Valencian paella · kitchen",
      es: "Paella valenciana · cocina",
      "ca-ES-valencia": "Paella valenciana · cuina",
    },
    customerName: {
      en: "House Valencian paella",
      es: "Paella valenciana de la casa",
      "ca-ES-valencia": "Paella valenciana de la casa",
    },
    image: "valencia-paella.png",
    unitPrice: "16.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Horchata and fartons",
      es: "Horchata con fartons",
      "ca-ES-valencia": "Orxata amb fartons",
    },
    kitchenName: {
      en: "Horchata and fartons · kitchen",
      es: "Horchata con fartons · cocina",
      "ca-ES-valencia": "Orxata amb fartons · cuina",
    },
    customerName: {
      en: "House horchata with fartons",
      es: "Horchata con fartons de la casa",
      "ca-ES-valencia": "Orxata amb fartons de la casa",
    },
    image: "valencia-orxata.png",
    unitPrice: "5.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Baked rice",
      es: "Arroz al horno",
      "ca-ES-valencia": "Arròs al forn",
    },
    kitchenName: {
      en: "Baked rice · kitchen",
      es: "Arroz al horno · cocina",
      "ca-ES-valencia": "Arròs al forn · cuina",
    },
    customerName: {
      en: "House baked rice",
      es: "Arroz al horno de la casa",
      "ca-ES-valencia": "Arròs al forn de la casa",
    },
    image: "valencia-arros-forn.png",
    unitPrice: "13.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Tomato and tuna stew",
      es: "Titaina",
      "ca-ES-valencia": "Titaina",
    },
    kitchenName: {
      en: "Tomato and tuna stew · kitchen",
      es: "Titaina · cocina",
      "ca-ES-valencia": "Titaina · cuina",
    },
    customerName: {
      en: "House tomato and tuna stew",
      es: "Titaina de la casa",
      "ca-ES-valencia": "Titaina de la casa",
    },
    image: "valencia-titaina.png",
    unitPrice: "9.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Pumpkin and almond dessert",
      es: "Arnadí",
      "ca-ES-valencia": "Arnadí",
    },
    kitchenName: {
      en: "Pumpkin and almond dessert · kitchen",
      es: "Arnadí · cocina",
      "ca-ES-valencia": "Arnadí · cuina",
    },
    customerName: {
      en: "House pumpkin and almond dessert",
      es: "Arnadí de la casa",
      "ca-ES-valencia": "Arnadí de la casa",
    },
    image: "valencia-arnadi.png",
    unitPrice: "5.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
] as const;
const WINE = {
  staffName: {
    en: "Requena wine",
    es: "Copa de vino de Requena",
    "ca-ES-valencia": "Copa de vi de Requena",
  },
  kitchenName: {
    en: "Requena wine · bar",
    es: "Copa de vino de Requena · barra",
    "ca-ES-valencia": "Copa de vi de Requena · barra",
  },
  customerName: {
    en: "Glass of Requena wine",
    es: "Copa de vino de Requena de la casa",
    "ca-ES-valencia": "Copa de vi de Requena de la casa",
  },
  image: "valencia-wine.png",
  unitPrice: "4.00",
  vatClass: "general",
  pricingUnit: "each",
} as const;
const REGIONAL_SECTION = {
  name: {
    en: "Orchard specialities",
    es: "Especialidades de la huerta",
    "ca-ES-valencia": "Especialitats de l'Horta",
  },
  color: "#b46b35",
  station: "kitchen",
  products: REGIONAL_DISHES,
} as const;
export const CASA_DELGADO_VALENCIA = {
  ...CASA_DELGADO_ES,
  id: "casa-delgado-valencia",
  mediaDataSet: "casa-delgado-valencia",
  plainNameLanguage: "ca-ES-valencia",
  contentLanguages: ["ca-ES-valencia", "es", "en"],
  menus: {
    ...CASA_DELGADO_ES.menus,
    restaurant: {
      ...CASA_DELGADO_ES.menus.restaurant,
      name: {
        ...CASA_DELGADO_ES.menus.restaurant.name,
        "ca-ES-valencia": "Casa Delgado de l'Horta",
      },
      categories: [
        ...CASA_DELGADO_ES.menus.restaurant.categories.map((category) =>
          category.name.en === "Wine and beer"
            ? { ...category, products: [...category.products, WINE] }
            : category,
        ),
        REGIONAL_SECTION,
      ],
    },
  },
  staff: [
    {
      displayName: "Vicent Ferrer",
      role: "manager",
      email: "manager@demo.waitron.local",
      dashboardLogin: true,
    },
    {
      displayName: "Amparo Soler",
      role: "supervisor",
      email: "amparo@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Neus Martí",
      role: "staff",
      email: "neus@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Pau Sanchis",
      role: "staff",
      email: "pau@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Clara Peris",
      role: "staff",
      email: "clara@demo.waitron.local",
      dashboardLogin: false,
    },
  ],
} as const satisfies CountryDemoData<"ca-ES-valencia" | "es" | "en">;
