import type { CountryDemoData, CountryDemoProduct } from "@waitron/country";
import { DEMO_DATA_SETS } from "@waitron/country-packs/demo";
import type { StrictCountryDemoData, SeedProduct } from "./data-set.js";

export const strictRegistry: Readonly<Record<string, StrictCountryDemoData>> = DEMO_DATA_SETS;
const base = DEMO_DATA_SETS["casa-delgado-es"];
const product = base.menus.restaurant.categories[0].products[0];
const vat = { ...product, vatClass: "unregistered-tax" } as const satisfies CountryDemoProduct;
// @ts-expect-error The server owns the accepted VAT classes.
export const invalidVat: SeedProduct = vat;
const pricing = {
  ...product,
  pricingUnit: "unregistered-unit",
} as const satisfies CountryDemoProduct;
// @ts-expect-error The server owns the accepted pricing units.
export const invalidPricing: SeedProduct = pricing;
const dietary = {
  ...product,
  dietaryDeclarations: ["unregistered-label"],
} as const satisfies CountryDemoProduct;
// @ts-expect-error The server owns the accepted dietary labels.
export const invalidDietary: SeedProduct = dietary;
const staff = {
  ...base,
  staff: [{ ...base.staff[0], role: "unregistered-role" }],
} as const satisfies CountryDemoData;
// @ts-expect-error The server owns staff roles.
export const invalidStaff: StrictCountryDemoData = staff;
const reasonAction = {
  ...base,
  adjustmentReasons: [{ ...base.adjustmentReasons[0], actions: ["unregistered-action"] }],
} as const satisfies CountryDemoData;
// @ts-expect-error The server owns adjustment actions.
export const invalidAction: StrictCountryDemoData = reasonAction;
const reasonRole = {
  ...base,
  adjustmentReasons: [{ ...base.adjustmentReasons[0], applyRoles: ["unregistered-role"] }],
} as const satisfies CountryDemoData;
// @ts-expect-error The server owns adjustment permission roles.
export const invalidReasonRole: StrictCountryDemoData = reasonRole;
const floor = {
  ...base,
  floor: { ...base.floor, tables: [{ ...base.floor.tables[0], shape: "triangle" }] },
} as const satisfies CountryDemoData;
// @ts-expect-error The server owns floor shapes.
export const invalidFloor: StrictCountryDemoData = floor;
// @ts-expect-error Every dataset text must provide English and Spanish.
export const missingText: CountryDemoProduct = { ...product, customerName: { en: "Bread" } };
const malformedExtra = {
  ...base,
  productExtraLists: [
    {
      productImage: "bread.png",
      lists: [
        {
          ...base.productExtraLists[0].lists[0],
          items: [{ productImage: "bread.png", price: "1.00", portion: "1", maxQuantity: "one" }],
        },
      ],
    },
  ],
} as const;
// @ts-expect-error Extras quantities are numeric.
export const invalidExtra: CountryDemoData = malformedExtra;
