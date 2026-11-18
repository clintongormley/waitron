# A1515 set-menu VAT terms

A set-menu draft can save its own eat-in rate and an optional takeaway rate, be duplicated and
exported with both, and hold products or kept variants at different VAT rates. Managers get these
controls when Tasks 7 and 8b land. The watcher cleared the split at 19:32 and this plan at 19:48 on
18 November. The owner's decision is in
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
   with null and treats a takeaway-only patch as a terms edit. An invalid class names
   `setTakeawayVatClass` in `set_menu.invalid`. The draft detail read returns the stored override
   as `takeawayVatClass: VatClass | null`. `menu-copy.ts` preserves it. Keep the ordinary menu
   summary unchanged. In `set-menus.test.ts`, prove distinct rates, duplication, clearing,
   a takeaway-only patch advancing `updated_at`, invalid takeaway class refusal naming the
   field, and refusal of that patch on an ordinary menu.
3. In `set-menus.ts` and `operations.ts`, remove the VAT comparisons from adding, copying
   and replacing dishes, editing kept variants and saving terms. Remove the corresponding
   publishing problem, obsolete error registry entry and unused draft dish and variant VAT fields.
   Drop the retired error's entries from `scripts/personal-log-params.test.ts`. Retain measured-dish,
   amount, membership and course rules. In `set-menus.refusals.test.ts`, prove a mixed-rate dish
   and variant and a changed menu rate all save. Run the existing non-VAT refusals.
4. The existing import writes the menus table through its schema checks for both VAT fields.
   Extend the set-menu case in `apps/server/src/configuration-transfer.test.ts` to round-trip
   distinct rates. Bump the bundle format in `packages/provisioning/src/configuration-transfer.ts`
   and update its fixtures and old-format refusal case, following #3763. Update the schema
   inventory and Madrid fixture. Rebuild core with
   `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Run the touched menu,
   transfer, log and schema tests and the schema, trigger and migration checks in CLAUDE.md.
5. Correct the dashboard plan's decision 11, problem and error lists, refusal tests, Preview
   and live corrections. Task 7's create and update routes accept `setTakeawayVatClass`, with
   null clearing it. Remove the retired VAT refusal from the 409 list. Task 8b and the guides
   follow the product's rate choices. Correct the set-menu design and record the supplement
   answer on the adviser sheet.
   Supplements use the set menu's applicable rate. The watcher routes changes to ordering,
   demo and bill plans to their lanes.
6. Keep #3775 open until the foundation lands. Rebase Task 5a, resolve the published terms'
   takeaway rate once as `takeawayVatClass ?? vatClass`, and remove the old VAT refusal in
   immediate and scheduled publishing. Exercise a published surcharge on a dish at a different
   rate, a null override resolving to the menu's rate, and a takeaway-only edit moving the hash
   and timestamp. Supplement charging consumes the two published term rates. Expect #3775
   to stay around 1,000 changed lines against its 1,140-line stop after replacing the old
   refusal and its tests with the rate cases.

Run the behavioural cases first, observe the failures and run them again after the changes.
The first line of the PR says **Resets test venues**. Expected size is 120–200 production lines
and 180–320 test lines touched, plus the regenerated core baseline and plan edits.
