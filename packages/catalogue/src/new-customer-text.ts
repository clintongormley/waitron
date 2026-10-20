import type { ContentLanguages } from "@waitron/shared";
import { resolveMenuText } from "./customer-menu-presentation.js";
import type { ProductPresentation } from "./product-presentation.js";

export function newCustomerText(
  map: Readonly<Record<string, string>> | null,
  staff: string,
  requested: string,
  config: ContentLanguages,
): string {
  return resolveMenuText(map, staff, { kind: "customer", language: requested }, config).text;
}

export function newCustomerPresentation(
  presentation: ProductPresentation,
  requested: string,
  config: ContentLanguages,
): string {
  const parent = newCustomerText(presentation.customerName, presentation.name, requested, config);
  if (presentation.variantName === null) return parent;
  const variant = newCustomerText(
    presentation.variantCustomerName,
    presentation.variantName,
    requested,
    config,
  );
  return variant ? (parent ? `${parent} (${variant})` : variant) : parent;
}
