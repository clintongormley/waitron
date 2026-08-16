import type { AllergenCode } from "@waitron/catalogue";
import { pickLocale } from "./t.js";

// Canonical display names for the 14 EU allergens (Regulation (EU) No 1169/2011, Annex II).
//
// This lives in `apps/till`, NOT in `@waitron/catalogue`, on purpose: the Spanish
// display strings below are user-facing translation, and `apps/*` is exempt from the
// english-only guard (packages/db/src/english-only.ts). The catalogue package only owns
// the codes (`ALLERGEN_CODES`) and their validation — never their localised prose.
//
// The `es` column is the load-bearing display text and was checked verbatim against the
// official Spanish text of Annex II — Diario Oficial de la Unión Europea, L 304/43-44,
// 22.11.2011 (BOE reprint of Reg. (UE) 1169/2011). Thirteen entries are the Annex's exact
// noun phrases: "Crustáceos", "Huevos", "Pescado", "Cacahuetes", "Soja", "Leche",
// "Frutos de cáscara", "Apio", "Mostaza", "Granos de sésamo",
// "Dióxido de azufre y sulfitos", "Altramuces", "Moluscos". `gluten` uses the standard
// short label "Cereales con gluten"; the Annex's full noun phrase is
// "Cereales que contengan gluten", abbreviated here for a compact allergen chip.
//
// Keys MUST stay in step with `@waitron/catalogue`'s `ALLERGEN_CODES` (Task 1). The `AllergenCode`
// key type makes a missing, extra or misspelled code a COMPILE error here (the runtime test pins the
// same set). The import is `import type`, fully erased at build, so it adds NO runtime dependency and
// keeps the catalogue barrel out of the browser bundle — the deliberate decoupling this file relies on.
export const ALLERGEN_NAMES: Record<AllergenCode, { en: string; es: string }> = {
  gluten: { en: "Cereals containing gluten", es: "Cereales con gluten" },
  crustaceans: { en: "Crustaceans", es: "Crustáceos" },
  eggs: { en: "Eggs", es: "Huevos" },
  fish: { en: "Fish", es: "Pescado" },
  peanuts: { en: "Peanuts", es: "Cacahuetes" },
  soybeans: { en: "Soybeans", es: "Soja" },
  milk: { en: "Milk", es: "Leche" },
  nuts: { en: "Nuts", es: "Frutos de cáscara" },
  celery: { en: "Celery", es: "Apio" },
  mustard: { en: "Mustard", es: "Mostaza" },
  sesame: { en: "Sesame seeds", es: "Granos de sésamo" },
  sulphites: { en: "Sulphur dioxide and sulphites", es: "Dióxido de azufre y sulfitos" },
  lupin: { en: "Lupin", es: "Altramuces" },
  molluscs: { en: "Molluscs", es: "Moluscos" },
};

/**
 * Resolve an allergen code to its display name for `locale`.
 *
 * `locale` may be a full BCP-47 tag ("es-ES"): the region subtag is stripped before the lookup, so
 * "es-ES" resolves to the "es" name — matching how `t()`/the catalogues alias map already treat a
 * region tag as its language. Resolution: the language's name if present, else the English name,
 * else — for a code that isn't one of the EU-14 at all — the raw code, so an unknown value renders
 * as itself rather than as an empty string or a throw.
 */
export function allergenName(code: string, locale: string): string {
  const entry = (ALLERGEN_NAMES as Record<string, { en: string; es: string }>)[code];
  if (!entry) return code;
  return pickLocale(entry, locale);
}
