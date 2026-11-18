# A1515 set-menu VAT terms

A set-menu draft can save its own eat-in rate and an optional takeaway rate, be duplicated and
exported with both, and hold products or kept variants at different VAT rates. This is the
foundation the watcher cleared at 19:32 on 18 November. The owner's decision is in
[the adviser meeting notes](../../compliance/2026-11-19-adviser-meeting.md) under “The owner's
decisions on the answers, 18 November”. The watcher also recorded the owner's “no” when asked
whether a drink supplement keeps the drink's own rate. Supplements take the set menu's rate.

## One foundation PR

1. In `packages/db/src/schema/menus.ts`, add the nullable `setTakeawayVatClass` column
   (`set_takeaway_vat_class`). Reuse the product's takeaway convention. Null follows the menu's
   required eat-in `setVatClass`. An explicit value uses the existing VAT class vocabulary.
   Ordinary menus cannot store the override. Before changing the schema, use
   `packages/db/src/schema/menu/set-menus.test.ts` to prove these three storage cases.
2. Reuse the terms writes in `packages/menu/src/operations.ts` and the detail read in
   `set-menus.ts`. `createMenu` and `updateMenuDetails` accept
   `setTakeawayVatClass?: VatClass | null`. The update distinguishes omission from clearing
   with null. An invalid class names `setTakeawayVatClass` in `set_menu.invalid`. The draft
   detail read returns the stored override as `takeawayVatClass: VatClass | null` for the future
   editor. `menu-copy.ts` preserves it. Keep the ordinary menu summary unchanged.
   In `set-menus.test.ts`, prove distinct rates, duplication and clearing the takeaway override.
3. In `set-menus.ts` and `operations.ts`, remove the VAT comparisons from adding, copying
   and replacing dishes, editing kept variants and saving terms. Remove the corresponding
   publishing problem, shared problem kind and obsolete error registry entry. Retain measured-dish,
   amount, membership and course rules. Use `set-menus.refusals.test.ts` to prove a mixed-rate dish
   and variant and a changed menu rate all save; run the existing non-VAT refusal cases.
4. Validate the new column in `packages/menu/src/configuration-transfer.ts`. A valid override on
   a set menu imports, while a malformed value or a non-null override on an ordinary menu refuses
   with `menus.set_takeaway_vat_class`. Extend the existing set-menu case in
   `apps/server/src/configuration-transfer.test.ts` to round-trip distinct rates. Update the
   schema check inventory and Madrid baseline fixture and rebuild core with
   `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Run the touched menu,
   transfer and schema tests plus the schema, trigger and starting-migration checks in CLAUDE.md.
5. Update the dashboard plan's VAT decisions, acceptance cases and later terms controls in this
   PR. The editor uses the product's VAT choices and offers no supplement rate. Task 5a stays in
   #3775 until this foundation lands. When it is rebased, take the two effective rates in
   `SetMenuTerms` and replace the mixed-rate publication refusal with a successful publish case.
   The existing editor, till and billing checkpoints own their use of the two rates.

Run the behavioural cases first, observe the failures and run them again after the changes.
The first line of the PR says **Resets test venues**. Expected size is 180–300 production lines
and 200–350 test lines touched, plus the regenerated core baseline and plan edits.
