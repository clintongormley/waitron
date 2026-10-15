import { AppError } from "@waitron/shared";
import "./errors.js"; // load the code registry for the throws below

export const ALLERGEN_CODES = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type AllergenCode = (typeof ALLERGEN_CODES)[number];
export const CEREAL_KINDS = ["wheat", "rye", "barley", "oats", "spelt", "kamut"] as const;
export const NUT_KINDS = [
  "almonds",
  "hazelnuts",
  "walnuts",
  "cashews",
  "pecans",
  "brazil_nuts",
  "pistachios",
  "macadamia",
] as const;
export type Kind = (typeof CEREAL_KINDS)[number] | (typeof NUT_KINDS)[number];
export interface AllergenDeclaration {
  kinds?: Kind[];
}
// Keep the record string-keyed to match the database JSON type; validateAllergens checks codes.
export type ProductAllergens = Record<string, AllergenDeclaration>;

const CODES = new Set<string>(ALLERGEN_CODES);

export function allergenKinds(code: string): readonly string[] {
  if (code === "gluten") return CEREAL_KINDS;
  if (code === "nuts") return NUT_KINDS;
  return [];
}

export function validateAllergens(value: unknown): ProductAllergens {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("allergen.invalid_code", { code: String(value) });
  }
  for (const [code, decl] of Object.entries(value as Record<string, unknown>)) {
    if (!CODES.has(code)) throw new AppError("allergen.invalid_code", { code });
    if (typeof decl !== "object" || decl === null || Array.isArray(decl)) {
      throw new AppError("allergen.invalid_kind", { code });
    }
    if (Object.keys(decl).some((key) => key !== "kinds")) {
      throw new AppError("allergen.invalid_kind", { code });
    }
    const kinds = (decl as { kinds?: unknown }).kinds;
    const allowed = allergenKinds(code);
    if (
      allowed.length > 0 &&
      (!Object.hasOwn(decl, "kinds") ||
        kinds === undefined ||
        (Array.isArray(kinds) && kinds.length === 0))
    ) {
      throw new AppError("allergen.kinds_required", { code });
    }
    if (
      Object.hasOwn(decl, "kinds") &&
      (!Array.isArray(kinds) ||
        allowed.length === 0 ||
        Array.from(kinds).some(
          (kind: unknown) => typeof kind !== "string" || !allowed.includes(kind),
        ))
    ) {
      throw new AppError("allergen.invalid_kind", { code });
    }
  }
  return value as ProductAllergens;
}
