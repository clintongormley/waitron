import {
  customerPresentationText,
  staffPresentationName,
} from "@waitron/catalogue/src/product-presentation.js";
import type { ProductPresentation } from "@waitron/catalogue/src/product-presentation.js";
import { currentContentLanguages } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import type { TillProduct } from "../api/client.js";

/** The till carries the six name fields OPTIONALLY; the shared resolvers take them present-and-nullable. */
export function toPresentation(product: TillProduct): ProductPresentation {
  return {
    name: product.name,
    customerName: product.customerName ?? null,
    kitchenName: product.kitchenName ?? null,
    variantName: product.variantName ?? null,
    variantCustomerName: product.variantCustomerName ?? null,
    variantKitchenName: product.variantKitchenName ?? null,
  };
}

/**
 * The product's STAFF name, plain text. The operator reads the name the venue uses internally, never a
 * customer translation — so unlike every other text on a till screen this one takes no locale.
 */
export function productName(product: TillProduct): string {
  return product.name;
}

/**
 * The staff name AS CHOSEN onto a line: the selected variant's own name, else the product's. Deep-imported
 * because `product-presentation.ts` depends only on `@waitron/shared`, so no catalogue barrel reaches the
 * browser bundle.
 */
export function lineProductName(product: TillProduct): string {
  return staffPresentationName({ name: product.name, variantName: product.variantName ?? null });
}

/** For a document a diner reads (the printed allergen sheet), never for an operator lookup. */
export function customerProductName(product: TillProduct, locale: string): string {
  const { product: text } = customerPresentationText(
    toPresentation(product),
    currentContentLanguages().defaultLanguage,
  );
  return descriptionFor(text, product.name, locale);
}

export function unitName(product: TillProduct, locale: string = currentLocale()): string {
  const unit = productUnit(product);
  return descriptionFor(unit.abbreviation, unit.id, locale);
}

export function productUnit(product: TillProduct): NonNullable<TillProduct["unit"]> {
  return (
    product.unit ??
    (product.pricingUnit === "weight"
      ? {
          id: "00000000-0000-0000-0000-000000000002",
          name: { en: "kg" },
          abbreviation: { en: "kg" },
          precision: 3,
          hardwareUnit: "kg" as const,
        }
      : {
          id: "00000000-0000-0000-0000-000000000001",
          name: { en: "each" },
          abbreviation: { en: "ea" },
          precision: 0,
          hardwareUnit: null,
        })
  );
}
