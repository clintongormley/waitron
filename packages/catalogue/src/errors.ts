// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A key in a product's allergen declaration is not one of the EU-14 codes. */
    "allergen.invalid_code": { code: string };
    /** An allergen's presence is not "contains" | "may_contain". */
    "allergen.invalid_presence": { code: string; presence: string };
  }
}
