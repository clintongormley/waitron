import type { VatClass } from "@waitron/shared";

export interface MenuDefaults {
  defaultProductVatClass: VatClass;
  /** The rate a new product's takeaway VAT starts at: the saved one, else the area's default. */
  defaultTakeawayVatRate: string;
  defaultColor: string | null;
}
