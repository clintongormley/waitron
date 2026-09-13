/** Saved selections carry their labels so catalogue edits cannot rewrite an order or receipt. */
export type ModifierSnapshot = {
  modifierId: string;
  name: Record<string, string>;
} & (
  | { type: "text"; text: string }
  | { type: "options"; choiceId: string; choiceName: Record<string, string> }
  | { type: "yes-no"; value: boolean; label: Record<string, string> }
  | {
      type: "extras";
      choices: { choiceId: string; name: Record<string, string>; quantity: number }[];
    }
);
