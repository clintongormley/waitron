/** Saved selections copy the display data they need (the modifier and choice names) so catalogue
 * edits cannot rewrite an order or receipt; a yes/no keeps only its boolean answer. */
export type ModifierSnapshot = {
  modifierId: string;
  name: Record<string, string>;
} & (
  | { type: "text"; text: string }
  | { type: "options"; choiceId: string; choiceName: Record<string, string> }
  | { type: "yes-no"; value: boolean }
  | {
      type: "extras";
      choices: { choiceId: string; name: Record<string, string>; quantity: number }[];
    }
);
