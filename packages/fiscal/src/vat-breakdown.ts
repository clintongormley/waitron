import type { Decimal } from "@waitron/shared";

/** One VAT rate's totals on a receipt. Declared here, apart from `backend.ts`, so a browser
 * consumer can name the type without its program gaining `backend.ts`'s database imports. */
export interface VatBreakdownLine {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  surchargeRate?: Decimal;
  surcharge?: Decimal;
}
