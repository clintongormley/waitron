export type LocalizedText = Record<string, string>;
export interface ModifierEffects {
  addAllergens?: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  removeAllergens?: string[] | null;
  addOrigins?: string[] | null;
  removeOrigins?: string[] | null;
}
export interface ModifierChoice extends ModifierEffects {
  id: string;
  name: LocalizedText;
  available: boolean;
}
export interface ExtraChoice extends ModifierChoice {
  priceDelta: string;
  maxQuantity: number;
  defaultQuantity: number;
  vatClass?: "general" | "reduced" | "super_reduced" | "zero" | null;
}
type Common = { name: LocalizedText; available: boolean };
export type ModifierInput = Common &
  (
    | { type: "text" }
    | { type: "extras"; required: boolean; maxTotalQuantity: number | null; choices: ExtraChoice[] }
    | { type: "options"; choices: ModifierChoice[]; defaultChoiceId: string | null }
    | { type: "yes-no"; yesLabel: LocalizedText; noLabel: LocalizedText; defaultValue: boolean }
  );
export type Modifier = ModifierInput & { id: string };
export type ModifierSelection =
  | { modifierId: string; type: "text"; text: string }
  | { modifierId: string; type: "extras"; choices: { choiceId: string; quantity: number }[] }
  | { modifierId: string; type: "options"; choiceId: string }
  | { modifierId: string; type: "yes-no"; value: boolean };
