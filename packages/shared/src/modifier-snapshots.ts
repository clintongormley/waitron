/** Saved selections copy the display data they need (the modifier and choice names) so catalogue
 * edits cannot rewrite an order or receipt.
 *
 * DEAD as written, as of 2026-09-20: no order and no receipt reads this type. The only thing that
 * still IMPORTS it is this package's own barrel re-export (`./index.ts`); nothing else under
 * `packages/` and nothing under `apps/` does. `apps/till` did keep a copy of its own in
 * `apps/till/src/api/client.ts`, which is no longer true as of 2026-09-21: Task 12 rewrote the
 * till's wire types over extras and options and deleted that declaration, so no TypeScript file
 * outside this package names the type at all. It is still NAMED in prose next door —
 * `./option-selection.ts` cites `ModifierSnapshot.name` and `choiceName` as the field shape the
 * replacement matched. An order or sale line's frozen answers are
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
