# Credit product price changes in menu Preview

The watcher queued A1373 in Lane D on 22 November at 23:36. The problem is recorded in
[the menu backlog](../../backlog/menu.md). Codex Lane D wrote this plan.

When you change Lemonade’s own price and a menu reaches Lemonade through Drinks, Preview offers
**Edit product** if both prices came from the product. When Drinks sets or clears its price override,
Preview’s **Edit Drinks** action opens **Price overrides**. A menu’s own override keeps its existing
attribution. An included override two menus down keeps the existing link to the outer include.

- In `packages/shared/src/menu-document/menu-document-types.ts` and
  `packages/menu/src/menu-document.ts`, add an optional map to the published document keyed by dish
  and variant product IDs. Store the resolved origin from `CombinedOffer` as the product, this menu,
  or the first included menu’s ID and name. Follow `ValueSource.from` to distinguish an override
  from a product price carried through an include. A variant that takes the dish price takes its
  origin. A clashing draft has no resolved origin for that price.
- Compare the frozen and proposed origins in `diffEntries` and `productFields`. Keep the existing
  menu’s own setting and Undo rules. Prefer the proposed included override when one exists and
  use the previously published one when it was cleared. If either origin is missing, use the
  existing attribution. Keep format 4 with this optional field. Existing published copies keep
  serving, and their next publication records the origins. Adding origins can mark a menu ready
  to publish even when its prices match. The change list still compares the amounts and settings.
- In `packages/menu/src/menu-patch.ts`, mark an actual live dish or variant price correction as a
  price set on this menu. Keep the existing behavior for other fields, unchanged prices and extras.
  Scheduling already stores the same built document. Set-menu surcharges have their own settings.
- Cloud reads the same published menu through `readGuestMenuPages` in `apps/server/src/guest-menu-api.ts`.
  It receives the existing JSON of rendered pages by language. `publicGuestMenu` projects customer
  fields and amounts, so no price origin goes into the HTML. Republishing can change the displayed
  publication time as usual. Keep the existing Dashboard actions and Cloud delivery path.
- Start red in `packages/menu/src/menu-publication.test.ts`. Change the pinned Dinner/Lunch case
  to expect the shared product while keeping Lunch out of **Also on**. Keep the clearing-override
  cases and check the nested product and inherited variant paths. Read a published copy to check
  its origin. In `packages/menu/src/menu-patch.test.ts` extend the existing price case to assert the
  corrected origin and preserve its no-op behavior. Run those files and `menu-schedule.test.ts`.
  Run the Dashboard `menu-preview.edit-links.test.ts` for both destinations, server
  `guest-menu-api.test.ts` for the rendered pages, and `guide-content.test.ts` for the guide twins.
- Clarify the Preview instructions in `apps/server/src/guide/{en,es}/products.md` and the Preview
  contract in `docs/developers/design-system.md`. Remove A1373 from both backlog files and add a
  dated pointer to the A353 plan. Estimate +75–120 production lines, +45–85 test lines and +10–20
  documentation lines beyond this plan.
