// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";

/** @waitron/catalogue's contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A key in a product's allergen declaration is not one of the EU-14 codes. */
    "allergen.invalid_code": { code: string };
    /** An allergen's presence is not "contains" | "may_contain". */
    "allergen.invalid_presence": { code: string; presence: string };
    /** An allergen's optional `source` is present but is not a string. */
    "allergen.invalid_source": { code: string };
    /** An image upload carried no file part in the multipart body. Thrown by the server route. */
    "media.missing": Record<string, never>;
    /**
     * The uploaded bytes are not an accepted image type (JPEG/PNG/WEBP). `detected` names the type
     * when it is recognisable (e.g. `"gif"`); it carries a fact about the bytes, never the bytes.
     */
    "media.unsupported_type": { detected?: string };
    /** The uploaded image exceeds `maxUploadBytes`. Thrown by the server route. Facts, not bytes. */
    "media.too_large": { size: number; limit: number };
  }
}
