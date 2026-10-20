import type { AllergenCode } from "@waitron/catalogue";

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

export const ALLERGEN_KIND_NAMES: Record<string, { en: string; es: string }> = {
  wheat: { en: "Wheat", es: "Trigo" },
  rye: { en: "Rye", es: "Centeno" },
  barley: { en: "Barley", es: "Cebada" },
  oats: { en: "Oats", es: "Avena" },
  spelt: { en: "Spelt", es: "Espelta" },
  kamut: { en: "Khorasan wheat", es: "Trigo khorasan" },
  almonds: { en: "Almonds", es: "Almendras" },
  hazelnuts: { en: "Hazelnuts", es: "Avellanas" },
  walnuts: { en: "Walnuts", es: "Nueces" },
  cashews: { en: "Cashews", es: "Anacardos" },
  pecans: { en: "Pecans", es: "Pacanas" },
  brazil_nuts: { en: "Brazil nuts", es: "Nueces de Brasil" },
  pistachios: { en: "Pistachios", es: "Pistachos" },
  macadamia: { en: "Macadamia or Queensland nuts", es: "Nueces macadamia o nueces de Australia" },
};

export function kitchenAllergenLabel(
  code: string,
  entry: { kinds?: readonly string[] },
  language: "en" | "es",
): string {
  const name = Object.hasOwn(ALLERGEN_NAMES, code)
    ? ALLERGEN_NAMES[code as AllergenCode][language]
    : code;
  return entry.kinds?.length
    ? `${name} (${entry.kinds.map((kind) => (Object.hasOwn(ALLERGEN_KIND_NAMES, kind) ? ALLERGEN_KIND_NAMES[kind]![language] : kind)).join(", ")})`
    : name;
}
