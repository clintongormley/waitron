import type { CountryDemoData } from "@waitron/country";
import { CASA_DELGADO_ES } from "./casa-delgado-es.js";

const REGIONAL_DISHES = [
  {
    staffName: { en: "Galician savoury pie", es: "Empanada gallega", gl: "Empanada galega" },
    kitchenName: {
      en: "Galician savoury pie · kitchen",
      es: "Empanada gallega · cocina",
      gl: "Empanada galega · cociña",
    },
    customerName: {
      en: "House Galician savoury pie",
      es: "Empanada gallega de la casa",
      gl: "Empanada galega da casa",
    },
    image: "galicia-empanada.png",
    unitPrice: "8.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Galician broth", es: "Caldo gallego", gl: "Caldo galego" },
    kitchenName: {
      en: "Galician broth · kitchen",
      es: "Caldo gallego · cocina",
      gl: "Caldo galego · cociña",
    },
    customerName: {
      en: "House Galician broth",
      es: "Caldo gallego de la casa",
      gl: "Caldo galego da casa",
    },
    image: "galicia-caldo.png",
    unitPrice: "6.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Pork shoulder with turnip greens",
      es: "Lacón con grelos",
      gl: "Lacón con grelos",
    },
    kitchenName: {
      en: "Pork shoulder with turnip greens · kitchen",
      es: "Lacón con grelos · cocina",
      gl: "Lacón con grelos · cociña",
    },
    customerName: {
      en: "House pork shoulder with turnip greens",
      es: "Lacón con grelos de la casa",
      gl: "Lacón con grelos da casa",
    },
    image: "galicia-lacon.png",
    unitPrice: "14.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Galician pancakes", es: "Filloas", gl: "Filloas" },
    kitchenName: {
      en: "Galician pancakes · kitchen",
      es: "Filloas · cocina",
      gl: "Filloas · cociña",
    },
    customerName: {
      en: "House Galician pancakes",
      es: "Filloas de la casa",
      gl: "Filloas da casa",
    },
    image: "galicia-filloas.png",
    unitPrice: "5.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: {
      en: "Fried small sardines",
      es: "Sardinas pequeñas fritas",
      gl: "Xoubas fritidas",
    },
    kitchenName: {
      en: "Fried small sardines · kitchen",
      es: "Sardinas pequeñas fritas · cocina",
      gl: "Xoubas fritidas · cociña",
    },
    customerName: {
      en: "House fried small sardines",
      es: "Sardinas pequeñas fritas de la casa",
      gl: "Xoubas fritidas da casa",
    },
    image: "galicia-xoubas.png",
    unitPrice: "9.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Steamed mussels", es: "Mejillones al vapor", gl: "Mexillóns ao vapor" },
    kitchenName: {
      en: "Steamed mussels · kitchen",
      es: "Mejillones al vapor · cocina",
      gl: "Mexillóns ao vapor · cociña",
    },
    customerName: {
      en: "House steamed mussels",
      es: "Mejillones al vapor de la casa",
      gl: "Mexillóns ao vapor da casa",
    },
    image: "galicia-mexillons.png",
    unitPrice: "10.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
  {
    staffName: { en: "Galician sponge cake", es: "Bica", gl: "Bica" },
    kitchenName: { en: "Galician sponge cake · kitchen", es: "Bica · cocina", gl: "Bica · cociña" },
    customerName: { en: "House Galician sponge cake", es: "Bica de la casa", gl: "Bica da casa" },
    image: "galicia-bica.png",
    unitPrice: "5.50",
    vatClass: "reduced",
    pricingUnit: "each",
  },
] as const;
const WINE = {
  staffName: { en: "Albariño wine", es: "Copa de Albariño", gl: "Copa de Albariño" },
  kitchenName: {
    en: "Albariño wine · bar",
    es: "Copa de Albariño · barra",
    gl: "Copa de Albariño · barra",
  },
  customerName: {
    en: "Glass of Albariño",
    es: "Copa de Albariño de la casa",
    gl: "Copa de Albariño da casa",
  },
  image: "galicia-albarino.png",
  unitPrice: "4.50",
  vatClass: "general",
  pricingUnit: "each",
} as const;
const REGIONAL_SECTION = {
  name: {
    en: "House specialities",
    es: "Especialidades de la casa",
    gl: "Especialidades da casa",
  },
  color: "#3b7892",
  station: "kitchen",
  products: REGIONAL_DISHES,
} as const;
export const CASA_DELGADO_GL = {
  ...CASA_DELGADO_ES,
  id: "casa-delgado-gl",
  mediaDataSet: "casa-delgado-gl",
  plainNameLanguage: "gl",
  contentLanguages: ["gl", "es", "en"],
  menus: {
    ...CASA_DELGADO_ES.menus,
    restaurant: {
      ...CASA_DELGADO_ES.menus.restaurant,
      name: {
        ...CASA_DELGADO_ES.menus.restaurant.name,
        gl: "A Casa Delgado",
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
      displayName: "Xoán Varela",
      role: "manager",
      email: "manager@demo.waitron.local",
      dashboardLogin: true,
    },
    {
      displayName: "Uxía Castro",
      role: "supervisor",
      email: "uxia@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Brais López",
      role: "staff",
      email: "brais@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Iria Fernández",
      role: "staff",
      email: "iria@demo.waitron.local",
      dashboardLogin: false,
    },
    {
      displayName: "Antón Souto",
      role: "staff",
      email: "anton@demo.waitron.local",
      dashboardLogin: false,
    },
  ],
} as const satisfies CountryDemoData<"gl" | "es" | "en">;
