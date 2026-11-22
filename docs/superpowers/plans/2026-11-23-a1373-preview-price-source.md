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
  origin. A clash has no resolved origin. Equal candidates keep the existing first source.
- Compare origins only for changed prices. A change to this menu’s own setting keeps its current
  attribution and inherited-price reporting. With both origins known, take the proposed included override if
  present, else the published included override if present, else use the product attribution.
  If either origin is missing, keep the current attribution. Existing editions will therefore
  still offer the old link until a changed menu is published. Keep format 4 and leave the origin
  map out of `menuDocumentHash` so adding it alone leaves a published menu current. The same hash
  verifies content in backups. Scheduled editions record the map when they are built.
- In `packages/menu/src/menu-patch.ts`, record a live dish or variant correction’s origin as
  this menu when its price changes. This keeps a later comparison from crediting the included
  menu for a price the local correction replaced. Keep current Preview attribution for a live-only
  correction and leave extras, same-price corrections and set-menu surcharges out of this change.
- Cloud reads the same published menu through `readGuestMenuPages` in `apps/server/src/guest-menu-api.ts`.
  It receives the existing JSON of rendered pages by language. `publicGuestMenu` projects customer
  fields and amounts, so no price origin goes into the HTML. Republishing can change the displayed
  publication time as usual. Keep the existing Dashboard actions and Cloud delivery path.
- Start red in `packages/menu/src/menu-publication.test.ts`. Change the pinned Dinner/Lunch case
  to expect the shared product while keeping Lunch out of **Also on**. Keep the clearing-override
  cases and check the nested product and inherited variant paths. Read back the origin from a
  published copy. Check that a copy without origins stays current and uses the old attribution.
  Extend existing live price patch cases to check the origin and preserve the no-op assertion.
  In `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, compare the same historical menu
  content by omitting only the new field. Run these files and `menu-schedule.test.ts`.
  Run the Dashboard `menu-preview.edit-links.test.ts` for both destinations, server
  `guest-menu-api.test.ts` for the rendered pages, and `guide-content.test.ts` for the guide twins.
- Clarify the Preview instructions in `apps/server/src/guide/{en,es}/products.md` and the Edit link
  paragraph under Menus in `docs/developers/design-system.md`. Remove A1373 from both backlog files
  and add a dated pointer to the A353 plan. Estimate +75–120 production lines, +55–95 test lines
  and +10–20 documentation lines beyond this plan.
