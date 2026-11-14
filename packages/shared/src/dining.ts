import type { VatClass } from "./menu-document/vat-rates.js";

export const DININGS = ["eat_in", "takeaway"] as const;
export type Dining = (typeof DININGS)[number];

export const DINING_POLICIES = ["eat_in", "takeaway", "till_choice"] as const;
export type DiningPolicy = (typeof DINING_POLICIES)[number];

export function appliedVatClass(
  dining: Dining,
  line: { vatClass: VatClass; takeawayVatClass: VatClass },
): VatClass {
  return dining === "takeaway" ? line.takeawayVatClass : line.vatClass;
}
