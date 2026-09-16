import {
  customerPresentationText,
  staffPresentationName,
} from "@waitron/catalogue/src/product-presentation.js";
import type { ProductPresentation } from "@waitron/catalogue/src/product-presentation.js";
import { currentContentLanguages } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import type { TillProduct } from "../api/client.js";

/**
 * A till product in the shape the shared name resolvers take. The till carries each of the six name
 * fields OPTIONALLY (a fixture or an endpoint that has no variant simply omits them); the resolvers
 * take them as present-and-nullable, so this is the one place that coercion happens.
 */
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
 * The name the till's own surfaces render: the product's STAFF name, plain text. The operator reads
 * the name the venue uses internally, never a customer translation — so unlike every other text on a
 * till screen this one takes no locale and needs no content-language fallback.
 */
export function productName(product: TillProduct): string {
  return product.name;
}

/**
 * The staff name for a product AS CHOSEN onto a line — the product's name with the selected variant
 * joined onto it, or the product's name alone when no variant was chosen. The join itself is
 * `staffPresentationName`'s, reached by the same deep import the basket's pricer uses
 * (`product-presentation.ts` depends only on `@waitron/shared`, so no catalogue barrel reaches the
 * browser bundle).
 */
export function lineProductName(product: TillProduct): string {
  return staffPresentationName({ name: product.name, variantName: product.variantName ?? null });
}

/**
 * The CUSTOMER-facing name for a product, in `locale` — for the one till surface that produces a
 * document a diner reads (the printed allergen sheet), never for an operator lookup. The
 * blank-falls-back-to-the-staff-name rule is `customerPresentationText`'s; resolving the resulting
 * map against the venue's enabled content languages is `descriptionFor`'s, the same resolver every
 * other piece of live catalogue text on a till screen goes through.
 */
export function customerProductName(product: TillProduct, locale: string): string {
  const { product: text } = customerPresentationText(
    toPresentation(product),
    currentContentLanguages().defaultLanguage,
  );
  return descriptionFor(text, product.name, locale);
}

/** Resolve the selected unit's short label through the same content-language fallback as product text. */
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
