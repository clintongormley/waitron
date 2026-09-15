export type LocalizedText = Record<string, string>;
export interface ModifierEffects {
  addAllergens?: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  /** The POSITIVE dietary suitability the choice declares — a subset of `vegan, vegetarian, halal,
   * kosher` (validated against those four on the contract). Replaces the retired negative
   * `dietaryEffect = { invalidates }`; each item shows its own list, never a fold. */
  suitableFor?: string[] | null;
}
export interface ModifierChoice extends ModifierEffects {
  id: string;
  name: LocalizedText;
  available: boolean;
}
export interface ExtraChoice extends ModifierChoice {
  priceDelta: string;
  maxQuantity: number;
  preselected: boolean;
  vatClass?: "general" | "reduced" | "super_reduced" | "zero" | null;
}
type Common = { name: LocalizedText; available: boolean };
export type ModifierInput = Common &
  (
    | { type: "text" }
    | { type: "extras"; required: boolean; maxTotalQuantity: number | null; choices: ExtraChoice[] }
    | { type: "options"; choices: ModifierChoice[]; defaultChoiceId: string | null }
  );
export type Modifier = ModifierInput & { id: string };
export type ModifierSelection =
  | { modifierId: string; type: "text"; text: string }
  | { modifierId: string; type: "extras"; choices: { choiceId: string; quantity: number }[] }
  | { modifierId: string; type: "options"; choiceId: string };
