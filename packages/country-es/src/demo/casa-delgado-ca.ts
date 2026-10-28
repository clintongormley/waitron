import type { CountryDemoData } from "@waitron/country";
import { CASA_DELGADO_ES } from "./casa-delgado-es.js";

const REGIONAL_DISHES = [
  {
    staffName: { en: "Escalivada", es: "Escalivada", ca: "Escalivada" },
    kitchenName: {
      en: "Roasted vegetables · kitchen",
      es: "Verduras asadas · cocina",
      ca: "Escalivada · cuina",
    },
    customerName: {
      en: "Roasted peppers and aubergine",
      es: "Escalivada de la casa",
      ca: "Escalivada de la casa",
    },
    image: "catalonia-escalivada.png",
    unitPrice: "8.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Salt cod salad", es: "Esqueixada", ca: "Esqueixada de bacallà" },
    kitchenName: {
      en: "Salt cod · kitchen",
      es: "Bacalao · cocina",
      ca: "Esqueixada de bacallà · cuina",
    },
    customerName: {
      en: "House salt cod salad",
      es: "Esqueixada de bacalao de la casa",
      ca: "Esqueixada de bacallà de la casa",
    },
    image: "catalonia-esqueixada.png",
    unitPrice: "11.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Catalan sausage", es: "Butifarra con judías", ca: "Botifarra amb mongetes" },
    kitchenName: {
      en: "Sausage and beans · kitchen",
      es: "Butifarra y judías · cocina",
      ca: "Botifarra amb mongetes · cuina",
    },
    customerName: {
      en: "House Catalan sausage with white beans",
      es: "Butifarra con judías de la casa",
      ca: "Botifarra amb mongetes de la casa",
    },
    image: "catalonia-botifarra.png",
    unitPrice: "13.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Seafood noodles", es: "Fideuá", ca: "Fideuà" },
    kitchenName: { en: "Noodles · kitchen", es: "Fideos · cocina", ca: "Fideuà · cuina" },
    customerName: { en: "House seafood noodles", es: "Fideuá de la casa", ca: "Fideuà de la casa" },
    image: "catalonia-fideua.png",
    unitPrice: "15.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Cheese and honey", es: "Mel i mató", ca: "Mel i mató" },
    kitchenName: {
      en: "Fresh cheese · kitchen",
      es: "Requesón · cocina",
      ca: "Mel i mató · cuina",
    },
    customerName: {
      en: "Fresh cheese with honey",
      es: "Requesón con miel de la casa",
      ca: "Mel i mató de la casa",
    },
    image: "catalonia-mel-mato.png",
    unitPrice: "5.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Roast cannelloni", es: "Canelones de asado", ca: "Canelons de rostit" },
    kitchenName: {
      en: "Cannelloni · kitchen",
      es: "Canelones · cocina",
      ca: "Canelons de rostit · cuina",
    },
    customerName: {
      en: "House roast cannelloni",
      es: "Canelones de asado de la casa",
      ca: "Canelons de rostit de la casa",
    },
    image: "catalonia-canelons.png",
    unitPrice: "12.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Fish stew", es: "Suquet de pescado", ca: "Suquet de peix" },
    kitchenName: {
      en: "Fish stew · kitchen",
      es: "Guiso de pescado · cocina",
      ca: "Suquet de peix · cuina",
    },
    customerName: {
      en: "House Catalan fish stew",
      es: "Suquet de pescado de la casa",
      ca: "Suquet de peix de la casa",
    },
    image: "catalonia-suquet.png",
    unitPrice: "17.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
] as const;
const CAVA = {
  staffName: { en: "Cava", es: "Copa de cava", ca: "Copa de cava" },
  kitchenName: { en: "Cava · bar", es: "Cava · barra", ca: "Copa de cava · barra" },
  customerName: {
    en: "Glass of cava",
    es: "Copa de cava de la casa",
    ca: "Copa de cava de la casa",
  },
  image: "catalonia-cava.png",
  unitPrice: "4.50",
  vatClass: "general",
  pricingUnit: "each",
} as const;
const REGIONAL_SECTION = {
  name: {
    en: "House specialities",
    es: "Especialidades de la casa",
    ca: "Especialitats de la casa",
  },
  color: "#8d5678",
  station: "kitchen",
  products: REGIONAL_DISHES,
} as const;
export const CASA_DELGADO_CA = {
  ...CASA_DELGADO_ES,
  id: "casa-delgado-ca",
  mediaDataSet: "casa-delgado-ca",
  plainNameLanguage: "ca",
  contentLanguages: ["ca", "es", "en"],
  menus: {
    ...CASA_DELGADO_ES.menus,
    restaurant: {
      ...CASA_DELGADO_ES.menus.restaurant,
      categories: [
        ...CASA_DELGADO_ES.menus.restaurant.categories.map((category) =>
          category.name.en === "Wine and beer"
            ? { ...category, products: [...category.products, CAVA] }
            : category,
        ),
        REGIONAL_SECTION,
      ],
    },
  },
  staff: [
    {
      displayName: "Jordi Puig",
      role: "manager",
      email: "manager@demo.waitron.local",
      dashboardLogin: true,
    },
    {
      displayName: "Montse Vila",
      role: "supervisor",
      email: "montse@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Núria Soler",
      role: "staff",
      email: "nuria@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Pau Ferrer",
      role: "staff",
      email: "pau@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Laia Roca",
      role: "staff",
      email: "laia@demo.waitron.local",
      dashboardLogin: false,
    },
  ],
} as const satisfies CountryDemoData<"ca" | "es" | "en">;
