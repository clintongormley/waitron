import type { AllergenCode } from "@waitron/catalogue/src/allergens.js";
import { pickLocale } from "./t.js";

// Display names for the 14 EU allergens (Regulation (EU) No 1169/2011, Annex II). They live in
// `apps/till`, not `@waitron/catalogue`, because the Spanish names are user-facing translation and
// `apps/*` is outside the english-only guard.
//
// The `es` names are the opening words of each item in the Annex's official Spanish text (Diario
// Oficial de la Unión Europea, L 304/43, 22.11.2011), except `gluten`, which shortens "Cereales
// que contengan gluten" for a compact allergen chip.
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

/** `locale` may be a full BCP-47 tag ("es-ES"). A code outside the EU-14 renders as itself. */
export function allergenName(code: string, locale: string): string {
  const entry = (ALLERGEN_NAMES as Record<string, { en: string; es: string }>)[code];
  if (!entry) return code;
  return pickLocale(entry, locale);
}
