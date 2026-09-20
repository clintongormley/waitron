/** Saved selections copy the display data they need (the modifier and choice names) so catalogue
 * edits cannot rewrite an order or receipt.
 *
 * DEAD as written, as of 2026-09-20: no order and no receipt reads this type. The only thing that
 * still names it is this package's own barrel re-export (`./index.ts`); nothing else under
 * `packages/` and nothing in `apps/server` imports it, and `apps/till` uses a local copy of its own
 * (`apps/till/src/api/client.ts`) rather than this one. An order or sale line's frozen answers are
 * `OptionSnapshot`s (`./option-selection.ts`), and an extras pick is its own line. Deleted with the
 * rest of the old modifier model by Task 13 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`, which names this file. */
export type ModifierSnapshot = {
  modifierId: string;
  name: Record<string, string>;
} & (
  | { type: "text"; text: string }
  | { type: "options"; choiceId: string; choiceName: Record<string, string> }
  | {
      type: "extras";
      choices: { choiceId: string; name: Record<string, string>; quantity: number }[];
    }
);
