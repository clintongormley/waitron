import type { AllergenMap } from "./allergen-map.js";

export interface KitchenAllergyBlock {
  who: string;
  allergens: AllergenMap;
  note: string | null;
  clashes: AllergenMap;
  labels: Record<"en" | "es", { avoids: string[]; clashes: string[] }>;
}

export interface KitchenNoteChange {
  before: string | null;
  after: string | null;
}
