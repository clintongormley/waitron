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
export type AllergenPresence = "contains" | "may_contain";
export interface AllergenDeclaration {
  presence: AllergenPresence;
  /** Optional free-text specific substance ("wheat", "almonds"), for Annex II specificity. */
  source?: string;
}
// A plain string-keyed record, NOT `Partial<Record<AllergenCode, …>>`: it must be byte-identical to
// the db column's `$type` and `TillProduct.allergens` so allergens flow db↔catalogue↔till with no
// cast. A `Partial<Record<AllergenCode, …>>` makes every key `X | undefined`, which the db's
// `Record<string, …>` index signature rejects on insert. Keys are `AllergenCode`s, enforced at
// runtime by `validateAllergens` rather than at compile time.
export type ProductAllergens = Record<string, AllergenDeclaration>;

const CODES = new Set<string>(ALLERGEN_CODES);
const PRESENCES = new Set<AllergenPresence>(["contains", "may_contain"]);

/** Validate a caller/JSON-supplied allergen map. Returns it narrowed; throws AppError on any fault. */
export function validateAllergens(value: unknown): ProductAllergens {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("allergen.invalid_code", { code: String(value) });
  }
  for (const [code, decl] of Object.entries(value as Record<string, unknown>)) {
    if (!CODES.has(code)) throw new AppError("allergen.invalid_code", { code });
    const presence = (decl as { presence?: unknown })?.presence;
    if (typeof presence !== "string" || !PRESENCES.has(presence as AllergenPresence)) {
      throw new AppError("allergen.invalid_presence", { code, presence: String(presence) });
    }
    const source = (decl as { source?: unknown })?.source;
    if (source !== undefined && typeof source !== "string") {
      throw new AppError("allergen.invalid_source", { code });
    }
  }
  return value as ProductAllergens;
}

/** Validate a caller/JSON-supplied remove-list. Returns it narrowed; throws on any fault. */
export function validateRemoveAllergens(value: unknown): AllergenCode[] {
  if (!Array.isArray(value)) throw new AppError("allergen.invalid_code", { code: String(value) });
  const out: AllergenCode[] = [];
  for (const code of value) {
    if (typeof code !== "string" || !CODES.has(code)) {
      throw new AppError("allergen.invalid_code", { code: String(code) });
    }
    out.push(code as AllergenCode);
  }
  return out;
}

/** Reject an overlay that both adds and removes the same code (design §3). No-op if either side is
 * absent. Defence-in-depth at the core — never trust the caller (CLAUDE.md §3). */
export function assertAllergenOverlayDisjoint(
  add: ProductAllergens | null,
  remove: readonly string[] | null,
): void {
  if (!add || !remove) return;
  for (const code of remove) {
    if (Object.prototype.hasOwnProperty.call(add, code)) {
      throw new AppError("allergen.add_remove_conflict", { code });
    }
  }
}
