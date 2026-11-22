# Menus and the menu — detail

The open entries are listed in [the backlog](../backlog.md), under "Menus and the menu". This file holds
their full text.

## `MAX_MODIFIER_INTEGER` and the extras contract's `whole` bound have no stated reason on this engine

**`MAX_MODIFIER_INTEGER` and the extras contract's `whole` bound have no stated reason on this
engine — OPEN (found by #603).** Read only, not run: `MAX_MODIFIER_INTEGER`
(`packages/menu/src/modifier-limits.ts`, 2147483647) and the extras contract's `whole` bound
were PostgreSQL's integer maximum; the test names "refuses a pick bound above what the column can
hold" and "refuses a maxQuantity above what the column can hold" (`src/extra-contract.test.ts`)
assume a column limit.

## The media library still reads every matching image for search and name sorting, inside the venue write lock

**The media library still reads every matching image for search and name sorting, inside the venue
write lock — OPEN (found 2026-09-23, task F1's review wave).** The unsearched date sort counts,
orders and pages in SQL, reading only the page's metadata. Search still scores and pages in
JavaScript, and name sorting still uses `Intl.Collator` for accented names.
`listImageTranslationGaps` still reads all rows of its selected columns. The route
(`GET /management-api/images`) uses `withTransaction`, the venue's exclusive write lock, so these
remaining scans share the sale write queue.

**Measured limit, 2026-11-16:** a shared Mac running Node 26.13.0, with 2,000 synthetic
multilingual image metadata rows, ran the mounted image route while a real fiscal sale queued
behind its write turn. No image bytes were decoded and no deliberate wait was added. After one
warm-up, five samples per mode gave these times in milliseconds (median / maximum):

| Mode | Sale queue wait | Sale from enqueue to commit |
| --- | ---: | ---: |
| Sale alone | 0.03 / 0.05 | 3.36 / 4.22 |
| Broad relevance search | 6.89 / 9.96 | 10.24 / 13.02 |
| Name sort | 9.02 / 11.81 | 11.66 / 14.95 |

These are Mac measurements, not box timings. The watcher chose no route split for these measured
delays on 2026-11-16. Further optimisation waits for a measured sale delay that warrants it;
the full scans and translation-gap read remain.

## Two price rules disagree about a value that is not negative

**Two price rules disagree about a value that is not negative — OPEN (found 2026-09-21, task N4).**
`isProductPrice` (`packages/menu/src/modifier-limits.ts:12`) allows at most two decimal places
and ten whole digits; `stringToCents` (the `decimal()` + `decimalToCents` pair) that the
screened menu writes use allows any number of decimals and twelve whole digits, and ROUNDS the
excess. So `POST /management-api/products` with `unitPrice: "1.999"` stores `2.00` without saying
so, while the product-editor route refuses the same value with `product.invalid`; an eleven-digit
price splits the same way, and `-0.00` is accepted by one and refused by the other. Widening the
four routes to `isProductPrice` would start refusing values that save today. **Next action:** decide
whether one rule should govern every menu price, and if so which — and check each dashboard
form against it before changing the server, since a server stricter than its own form is the
failure #485 met.

## Sold-out tile appearance (A292, #1310): owner review

- A292's look is the owner's to judge (#1310's "Looks for the owner to judge"; screenshots in lane
  C's `a292-shots/`): in the dark theme an available plain tile is only about 1.10:1 lighter than a
  sold-out one, and in the light theme a pale stripe shows mostly through the dark line beside it.

## Each menu has one Device Home Page (W93, #1287): left open

Left open:

- **A291 DONE (2026-10-06):** removed format-2 preview/republication and silent omission from till
  reads. Unsupported live documents refuse with `menu.reset_required`, localized in dashboard and
  till; the Menus list, selected menu, Preview and Home display the reset instruction. Menu and real management/till route
  tests cover the refusal; configuration export/import still leaves publications behind. Reset the
  venue instead of republishing old menus. Historical W93 Decision 5 has a dated superseding note.

- The dashboard's Home page preview (`apps/dashboard/src/widgets/device-home-preview.ts`) still
  copies the till's tile/breadcrumb markup, thumbnail/paint helpers and CSS
  (`apps/till/src/widgets/menu-browser.ts`). Grid sizing, arrangement, trails and indexing already
  use shared rules. The preview also copies table ordering's width switch, flex share, gap and
  inset. A shared presentation boundary would need adapters for the till's ordering state and
  the dashboard's shortcut controls. Even a partial extraction (sharing only the CSS, thumbnails and
  paint helpers) was deferred: it would add a cross-package interface while leaving both renderers
  (watcher, 2026-11-14 08:56, MENU-HOME-TAB).

## An included menu can show its sections directly (A322, #1372): left open

Left open:

- A folder's fixed photo shows on the till only in Thumbnails mode, as a section's photo does.
- A home shortcut to a menu that is included in two lists of one menu opens the top-level copy,
  else the copy indexed last.
- A fixed value that happens to equal the included menu's value when the dialog opens is saved
  back as "follow" the next time the dialog is saved: the dialog compares with the included
  menu's value and cannot tell the two apart.


## Products table scrolling (W80, #1187)

_2026-11-09, A653: the shared dashboard cap replaces Products' opt-in fill chain. The phone-space
slice landed in #2667. With 40 products in Preparation, the final English screenshots at 375×667
and 390×844 show 3/5 whole Products data rows plus the root. Structure shows 1/4 initially and 3/6
after moving the page heading away; selection shows 1/4 plus the root after that move. Native touch
cases record the row and content-column offsets separately. The cap, held headings and isolation
contract are in [design-system.md](../developers/design-system.md)._

## Products at phone width: a long name runs under the pinned Actions column (W85b, W85c, W85e): left open

**Products at phone width: a long name runs under the pinned Actions column, cut with no ellipsis —
DONE (W85b, #1243; W85c, #1245; W85e, #1275); left open:**

- The owner answered W85b's open point (a name got about 46 px at 390 px) "maybe (b) and (c)" (b:
  drop the product photo at phone width; c: narrow the tree's leading slots), and **W85e** (#1275,
  2026-10-06) did (b) and narrowed the arrow slot of (c). Categories kept their folder icon, so at
  phone width a product's name started one folder slot before a sibling category's. _(2026-10-06:
  A294 removed the folder icon, but its slot stays and holds the category's colour square, so at
  phone width a product's name still starts one slot before a sibling category's.)_ The grip and the
  8 px indent step were left as they were.
  Left for the owner (the owner's answer was a "maybe"): keep, or undo, either half; hide the
  folder icon too at phone width so product and category names line up again (since A294 that
  slot holds the category's colour square, so this now means moving or hiding the square); narrow the indent
  step. Before/after screenshots: `~/waitron-campaign/w85e-shots/pair-*.png` (local).

## Menu: no two categories with one parent, and no two Active products, share a name (W72 to W72h): left open

The guard W72d added (`scripts/id-columns-are-references.test.ts`) knows an id column only by its
name, so a reference named otherwise is still unseen.

On 2026-10-05 A261-3 also observed "ResizeObserver loop completed with undelivered
notifications" while running `src/widgets/folder-made-at.test.ts` and
`src/widgets/catalogue-browser.test.ts`. Its cause on that path has not been established.

_2026-11-14, A1308 mn1: that browser suite now lives at `src/widgets/product-browser.test.ts`._

A349's Preview, price-table and navigation suites also logged the message.
That comparison does not establish which observer causes it or its effect on the rendered screen.
A487a also saw it in `src/components/wt-tabs` runs. Which test logs it was not looked for.

## Product folders, menus that include menus, and prep station routing: partly built (design approved 2026-09-30)

The
[design](../superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in slices. Slices
1, 2, 3a, 3b ([#1024](https://github.com/clintongormley/waitron/pull/1024)), 3c-1, 3c-2 (PF6,
[#1046](https://github.com/clintongormley/waitron/pull/1046)) and 3c-3 (PF7,
[#1068](https://github.com/clintongormley/waitron/pull/1068)) have landed. **Owner decision
(2026-10-01):** deleting only empty folders
stays immediate, including any routing rules attached to them; a confirmation is shown when the
selected folders contain products or subfolders. **Reversed 2026-10-06 (owner, A279):** a folder
holding only routing rules gets the confirmation, saying how many rules go with it; a folder with
nothing at all is still deleted at once. Each dev venue needs `wa-wt reset demo
<worktree-name>` (Claude's own copy: `wa-wt reset own demo <worktree-name>`) after slices 1 and 2, and after slice 2 the owner's box needs a reset too: library
sections and their placements disappear and per-menu extras are retired. Reload tills running the
older build before using the new published document. Status and remaining work:

- **Dragging products without a folder still moves them on drop.** Add the changed-products
  preview to that drag path before extending it during service.
- **A future rebuild of `categories` can empty its routing rules.** `routing_cells_category_fk`
  uses `ON DELETE CASCADE`
  (`packages/db/src/schema/venue-service/routing.ts`); follow CLAUDE.md §3's rebuild rule and add
  a populated-upgrade check before another categories rebuild.
- **The Spanish menu preview's selected Preview tab showed clipped at 390 px** after programmatic
  selection, in a render on 2026-10-01; clicking it scrolled it into view. A base-build render was
  not run, so when it began is not established (geometry and screenshot:
  `~/waitron-campaign-e/receipts/finish-render-20261001/render-report.md`). Check restored selection
  visibility before changing the shared tab component.

## Sales classification and the menus plan — what they left open

Both plans are complete (the
[menus design](../superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) (§11 wins
over §10, which wins over §1–§9; "category" in §1–§7 means SECTION) and
[plan](../superpowers/plans/2026-09-25-menus-categories-home-layouts.md); the
[classification design](https://github.com/clintongormley/waitron/blob/eca67e9dcd4b89ccc3aecb0bdb946eda5f8a4aba/docs/superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md)
and [plan](https://github.com/clintongormley/waitron/blob/eca67e9dcd4b89ccc3aecb0bdb946eda5f8a4aba/docs/superpowers/plans/2026-09-25-sales-classification.md)). Several entries are overtaken by
the 2026-09-30 folders design; what remains:

- **Classification.** `Product.categoryId` and `primaryCategoryId` always hold the same value. A
  line's classification is recorded when it is added (M7v), so `sale_classification.invalid`
  refuses adding a line; whether the till's message for that refusal on the add paths is right is
  not checked. The demo seed
  (`apps/server/scripts/demo-seed/seed-sales.ts`) and `apps/server/src/fiscal-readiness-runner.ts`
  file sales without the issuance pass, so seeded demo lines carry no product id, classification or
  gross, and the Sales screen's category report shows every seeded line under Not recorded.
- **The category sales report (#738).** `wt-button` disables only its inner `<button>`, so a
  scripted click on the host still reaches a click handler; the Sales screen's print handler checks
  for itself, other screens relying on `?disabled` alone have not been checked. The owner's
  decision (menus design §10.6) asks for the category analysis to be printable with the daily
  close, but no daily-close print exists.
- **Photo-holding tables are named by hand in several places in `packages/media`** (the triggers,
  `listImageUsages`, `countUsages`, the live-query dependencies, the `before` lists in
  `module.ts`, the `ImageUsage` unions), and only a comment keeps `countUsages` and
  `listImageUsages` in step; one list those derive from, checked against the triggers, would make
  the next such table one edit.
- **`sections_owner_menu_fk` has no delete rule**, so deleting a menu that owns a section will be
  refused until one is chosen; nothing deletes a menu today. Media's triggers name `sections`, so a
  later rebuild of that table meets the trap `docs/developers/conventions-data.md` records.
- **A product reached through a section offers no extras list** (noted at #659, and already so
  before it, checked at `002b79f69`).
- **The Menus screen (#664).** Which section is being edited is not in the address, only the menu
  and the tab. A refused change's message sits
  under the menu's heading, above the tabs, so on a phone the tree sits between it and the list it
  names; if someone else exactly undoes a move while it is saving, the move's answer is shown over
  their change until the menu is next read; and no accessibility test covers that message.
- **The Price overrides tab (named Prices until W89; #670, #680).** The owner decided 2026-09-26
  that removing a product's last placement needs no warning before it clears the menu price and
  variant settings. Open: the product editor's help lines are paragraphs beside their inputs, not linked to them (a
  `hint` shows only as the placeholder since C104, so moving them there would hide them whenever
  the field holds a value); and,
  from reading only, a Columns panel wider than a very narrow screen would not shrink to fit, and is
  not re-placed on resize.
- **Publishing (#677).** After a publish the editor's heading shows the browser's clock until the
  next read; the status
  and preview reads build every menu's frozen copy inside `withTransaction`, the venue's write lock
  — about 21 ms median for 4 menus and 300 dishes on a dev laptop, not measured on the box; at
  phone width the list keeps a fixed room for the row menu, and a status sort falls back to a name
  sort. The configuration import (`apps/server/src/configuration-transfer.ts`, inside
  provisioning's `beforeCommit`) deletes every `menus` row, so a provisioning or demo-seed
  path that publishes a menu BEFORE the import runs fails the import's commit on the append-only
  `menu_versions` → `menus` key. `apps/dashboard/src/widgets/variant-form.test.ts` failed once
  in a local dashboard coverage run; which of its tests failed was not recorded. The one
  intermittent failure in that file whose cause is known, the Escape test, is fixed (A220f, #1075; see the
  flaky-test entry); whether it was this one is not known.
- **Home page shortcuts (Task 8, #722; rewritten 2026-10-06 for W93, which replaced named layouts
  and the profile's choice with one Device Home Page per menu).** The add-shortcut picker offers
  active products only, so a shortcut to a product switched off since, once removed, cannot be
  added again until the product is switched back on. Archiving a product turns its shortcut into
  a Missing one (`takeOffMenus`, `packages/menu/src/menu-removal.ts`); how the Home page tab's
  preview draws a shortcut to a product switched off any other way was not checked.

## Extras and Options — deliberate limits, and what is left open

[integration contract](../developers/modifiers.md).

- **A stored empty options default is still possible** through configuration transfer, which
  copies rows without re-parsing them (the spec's D8).
- **The two list forms still share about a hundred lines of per-form plumbing**
  (`#primaryLanguage`, `#mapFieldErrors`, `#edit`, `#emit`, `#cancel`, the `willUpdate` reseed
  guard, the Escape-while-busy handler and the footer). **Next action:** decide whether a shared
  base or a controller is the right vehicle before a third list form is written; the row editors
  genuinely differ and should NOT be merged.
- **`optionListDependants` and `listOptionLists`' usage count each select the carrying
  `product_modifiers` rows with their own condition on `option_list_id`.** Whoever writes a refusal
  that uses the same condition shares it then.
- **A list switched on with no pickable label is refused only by the parser.**
  `parseOptionListInput` is the only door today; a path that writes `option_labels.available`
  directly, or flips `option_lists.active` with a plain update, could leave a list nobody can answer.

## A353 — Preview's changes: an "Undo" link that puts one change back to the live version

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version (owner,
  2026-10-07: "would it be possible to have an 'Undo' link as well?").** Planned in five pull
  requests ([plan](../superpowers/plans/2026-11-06-a353-preview-undo.md)). Left for later: PR 4,
  includes added and removed, own sections moved, and a new own section
  that is empty; PR 5, one-move order changes and one-write shortcut changes, after which this
  entry is deleted and the changes left without Undo (the plan's section 2) become their own entry.

## A1377 — A353's Undo: two wordings for the owner

- **A1377 — A353's Undo: two wordings for the owner** (from #2510). (1) If a menu is deleted while
  its Preview is open, a price Undo is refused `menu_item.not_found` and reads "{name} is no longer
  on this menu." rather than "This menu has been deleted, so there is nothing to undo.". (2) The
  success line can carry two colons ("Undone: Tapas and small plates: name, colour."). Both are
  in `apps/dashboard/src/api/menu-undo.ts` and `apps/dashboard/src/i18n/strings.ts`; ask the owner
  whether either should change.

## A1373 — The Preview credits a product's own price change seen through an include to the included menu

- **A1373 — The Preview credits a product's own price change seen through an include to the
  included menu (found in A353's review, 2026-11-06).** When a product's own price changes and a
  menu reaches it only through an included menu, with no menu along the way setting a price of its
  own, the Preview's change list credits the change to the included menu rather than to the shared
  product, so its action opens that menu's Price overrides tab instead of the product. Telling that
  apart from an included menu clearing its own price needs the published (frozen) menu document to
  record where each live price came from, which is a change to the published document's format.
  The case "leaves a menu out of also-on when its own matching change is its own setting" in
  `packages/menu/src/menu-publication.test.ts` pins today's answer.

## What #1151 left open (2026-10-03)

- **A very long number is cut off in the narrower box.** The request check accepts up to
  2147483647, which needs about 82px against the 66px between the buttons (measured by #1151's
  review); three digits need about 26px. Left alone because widening the box would undo the size
  the owner approved. OPEN, unqueued.

## Allergens and dietary preferences are edited in place (A213): what #1079 left open

Settled by [A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md) (owner, 2026-10-14); kept so older links resolve.

## From #541's review, not blocking

From **Variants as products (#511–#556) — what is left open.** How the model works is in
[products.md](../developers/products.md), under _Variants_.

- **From #541's review, not blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call.

## Smaller things #379 surfaced and did not take

From **The product editor and menu (#345, #379, #387) — what is left open.**
[Operator guide](../../apps/server/src/guide/en/products.md); [developer guide](../developers/products.md).

- **Smaller things #379 surfaced and did not take.** `modifier-limits.ts` holds a product rule as
  well as modifier rules.

## "May contain" survives in the data with no way to see or set it

Settled by [A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md) (owner, 2026-10-14); kept so older links resolve.

## The product editor summarises the same values twice

Settled by [A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md) (owner, 2026-10-14); kept so older links resolve.


## Translate all: shared collect-page test vectors

- The fake Cloud's paging
  (`apps/server/test/translation-cloud-fixture.ts`) follows Cloud's
  `packages/translation/src/collect-page.ts`, but nothing in either repository compares them; the
  shared translation vector (`apps/server/test/cloud-translation-vector.json`) covers submit
  signing only. Vectors Cloud generates from fixed items, outcomes and
  a byte budget, checked by both Cloud's `collectPage` and Waitron's fake, would catch drift in CI
  on both sides. One drift they would catch: the fake reads a signed body's job id with a stricter
  key-order check (`jobIdIn`) than Cloud, which sorts the keys (Cloud's
  `packages/translation/src/machine.ts`). A contract change for Cloud's side (plan
  `docs/superpowers/plans/2026-10-19-translate-all-collect-pages.md`, "2b and what can be
  automated").

## Translate all: a job the box ends itself is marked released without a call to Cloud, and Cloud can still hold it

After the box ends a Translate all job, Cloud can still have it queued or running and refuse the
venue's next submit with `translation_job_running`. If Cloud accepted the submit and the reply was
lost, the box has the original operation id but never received Cloud's job id. Repeating submit
can create a job if the first request never arrived.
[Runner tests](../../apps/server/src/content-suggestion-runner.test.ts).
[Cloud submit](https://github.com/waitron-io/waitron-cloud/blob/2af67c8495aa03c2c1f3134b6c102ddf49977fe4/packages/translation/src/machine.ts#L71-L101).

Cloud's contract says “Release tells Cloud the box has durably stored every page.” Cloud refuses
release for a queued or running job with `translation_not_ready`. The box integration waits for a
Cloud action that abandons an existing job by operation id, even while it is queued or running,
and creates no job when that id is absent. Lane G owns the Cloud action (TRANSLATION-ABANDON).
[Cloud release contract](https://github.com/waitron-io/waitron-cloud/blob/2af67c8495aa03c2c1f3134b6c102ddf49977fe4/docs/waitron-integration-contract.md#L1439-L1445).

## Translate all: open points from the review of A689's second PR

- **Translate all: open points from the review of A689's second PR.** (3) A variant whose
  product's staff name is over 500 characters is sent with no product as
  context, because that product is left out of the job (plan Decisions 9 and 10).

## A dish in a measure unit is still rung up one unit per tap

Left open by A821f. A 250 ml line is 1 ml per tap with ±1 steps, the split control turns it into
250 lines, a course group counts it as 250 items (`itemCount`, `apps/till/src/state/draft-groups.ts`),
and the basket-refresh dialog prices it "each". Whether a measure should ask its quantity as a
decimal unit does — which would change the other readers of the till's `soldByTheUnit`
(`apps/till/src/widgets/product-name.ts`) — is the owner's call. Its readers: `splitLine`
(`apps/till/src/state/working-order.ts`), `countsWholeUnits` and the last-added steps and split
control (`apps/till/src/screens/till-table-order-screen.ts`), and the price label
(`apps/till/src/widgets/basket-refresh-dialog.ts`). Read, not run.

## Modifiers' Spanish "Opciones" tab is cut at a 310 px screen on CI's Linux fonts

**Modifiers' Spanish "Opciones" tab is cut at a 310 px screen on CI's Linux fonts.** First seen
in A424 (#1452). Reproduced on 2026-11-14 by #3155's CI run 43560080952 (job `test-dashboard (4)`),
with the Modifiers width test made strict for that run: the selected tab is 104.44 px wide in an
88 px strip. English at 310 px, and both languages at 390 px, fit. 88 px is `wt-tabs`'s floor for
the strip (twice `--wt-tap-min`), so the "Añadir lista de opciones" button beside it already has all
the room the component allows. On the Mac the tab is 95.67 px in a 106.42 px strip. The owner has
not ruled on Modifiers; the watcher (2026-11-14 06:27) left this for their review of that screen.
Choices, all in `wt-tabs`, the screen otherwise unchanged:

- (a) the strip never narrower than the selected tab; the button's area gives way and scrolls
  inside itself (about 16 px of the button's end cut at 310 px on Linux) — recommended;
- (b) the button moves to its own line under the tabs when they cannot share the row, reversing
  A424's rule that a tab's action stays on the tab row's line at every width;
- (c) keep today's behaviour (the tab shows its start under the fade, and scrolls) and record it as
  accepted;
- (d) leave it until the owner reviews the Modifiers screen.

## A670 — guest-menu sharing and fixed A4 presets

The manager’s guest preview reads the published menu, with guest/default/internal name fallback,
separately priced sizes/extras and declarations. Local opt-in sharing exposes only the active default publication on the serving box. Bistro and Lunch-and-wine A4 presets print the captured publication through the browser, with box-local scalar appearance and per-preview logo/order/breaks. A mobile-data guest link remains unavailable.

Remaining work follows the watcher-cleared [build plan](../superpowers/plans/2026-11-13-a670-guest-menu-build.md):
public mobile-data qualification of Cloud’s hosted copy. The box delivers publications and
reports delivery confirmation under lane G’s A670-CLOUD contract. When Cloud requires an active
trial or paid plan, the preview explains why the hosted copy is hidden and links to Cloud Billing.
Public readiness remains unverified; ordering is separate. Choosing a guest menu independently of the default menu is a later feature.

The owner’s 13 November 22:31 answers, relayed by the watcher in Lane D `questions.md`, choose
forwarding to the box with a hosted published read-only copy when unreachable, fixed presets
before blocks/uploads, and name fallback through guest language, venue default, then internal
name, never kitchen. The watcher’s 23:28 clearance chooses default-menu-only sharing, box-local
non-transferring preferences, browser printing and a written key with inline words as an alternative.
The watcher’s 14 November 00:22 amendment narrows read-only Cloud work to the hosted copy,
with live forwarding reserved for ordering (A509); slices 1, 2 and 4 stay unchanged.
These are watcher-cleared plan decisions, not owner approval of the plan. The
[online](../superpowers/specs/2026-11-13-a670-online-go-live-study.md) and
[paper](../superpowers/specs/2026-11-13-a670-printed-template-study.md) studies retain their dated proposals.

## A case the content-language decisions leave open, built with the plan's default unless the owner says otherwise

**A case the content-language decisions leave open, built with the plan's default unless the owner
says otherwise** (plan, "Open points"): receipts outside Catalonia stay free, Spanish by default.
Left by W109 (#1320, #1322); the decisions are in
[products.md](../developers/products.md#content-languages-per-region). The other open case, a
Spanish venue with no known province, is settled (owner, 2026-10-17: Spanish stays enabled
everywhere; entered customer text is optional).

## Translate all: an Edit translations dialog left open anywhere clears the "Translations ready" notice

The dialog's live reload reads the suggestions, and that read marks the run opened
(`apps/server/src/content-suggestions-api.ts`), so a dialog forgotten on another device means
nobody sees the notice. Seen in the Santet run (A689-21). Working as built; the owner decides
whether it should change.

## Category authoring serialises across the whole database, and nobody has measured what that costs

`withTransaction` admits one write transaction per venue file
(`packages/menu/src/categories.ts`, above `listCategories`). **Next action:** measure it
before anyone widens category authoring to more concurrent editors. Left open by product
categories (#340, [API and integration guide](../developers/product-categories.md)).

## The combined end-to-end journey has not been walked

**The combined end-to-end journey has not been walked**: creating a unit, a category and the
extras and options a product carries from inside a dirty product draft, through the actual routes
against a real database, and taking the result through the till. **Next action:** walk it once
at the real box with the owner present, alongside **The displays and the printers walked at
the real box** (_What to work on next_), after the owner is back on 2 November (owner,
2026-10-17).

## Loose ends left by A343 (a menu's Price overrides tab tidied, #1368)

- The Price overrides tab's save message comes after the whole table in tab order, so a keyboard
  user cannot reach Undo from a field within its 5 seconds (decided as built, not tested with a
  user). Options: a keyboard shortcut for Undo, or a message that waits while focus stays in the
  field it saved.

## Bundle: Dishes sold by measure and their extras

1 entry, needs the owner.

- **A dish in a measure unit is still rung up one unit per tap** (A821f). A 250 ml line is 1 ml per
  tap, splits into 250 lines and counts as 250 items. Whether a measure should ask its quantity as
  a decimal unit does is the owner's call.
  [Detail](menu.md#a-dish-in-a-measure-unit-is-still-rung-up-one-unit-per-tap)

## Bundle: Product names on phones and sold-out tiles

2 entries, size M, needs the owner.

- **Products at phone width: what W85e left for the owner**
  [Detail](menu.md#products-at-phone-width-a-long-name-runs-under-the-pinned-actions-column-w85b-w85c-w85e-left-open)
- **Sold-out tile appearance (A292, #1310).**
  [Detail](menu.md#sold-out-tile-appearance-a292-1310-owner-review)

## Bundle: Translate all followups

- **Translate all: an Edit translations dialog left open anywhere clears the "Translations ready"
  notice.**
  [Detail](menu.md#translate-all-an-edit-translations-dialog-left-open-anywhere-clears-the-translations-ready-notice)
- **Translate all: the box needs Cloud to abandon an active job by operation id.**
  [Detail](menu.md#translate-all-a-job-the-box-ends-itself-is-marked-released-without-a-call-to-cloud-and-cloud-can-still-hold-it)
- **Translate all: open points from the review of A689's second PR.**
  [Detail](menu.md#translate-all-open-points-from-the-review-of-a689s-second-pr)

## Bundle: Extras list forms

The remaining storage, input-validation and shared-form limits.

- **Extras and Options — deliberate limits, and what is left open.**
  [integration contract](../developers/modifiers.md).
  [Detail](menu.md#extras-and-options--deliberate-limits-and-what-is-left-open)

## Menu home preview rendering

- **The dashboard's Home page preview still copies the till's presentation.** Tile and breadcrumb
  markup, thumbnail/paint helpers, CSS and the table layout values remain separate; grid sizing,
  arrangement, trails and indexing are shared. Extracting presentation needs adapters for till
  ordering and dashboard shortcut editing.
  [Detail](menu.md#each-menu-has-one-device-home-page-w93-1287-left-open)

## Bundle: Tabs selected visible

1 entry, size S. The other entry, a selected tab that grows, was fixed by #3155.

- **Modifiers' Spanish "Opciones" tab is cut at a 310 px screen on CI's Linux fonts** (104.44 px
  tab in an 88 px strip). Needs the owner's choice; recommended: the strip never narrower than the
  selected tab.
  [Detail](menu.md#modifiers-spanish-opciones-tab-is-cut-at-a-310-px-screen-on-cis-linux-fonts)


## Bundle: Each unit literal

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).
The other entry, the copied pricing-unit fallback and the till's own copy of the Each id, was
fixed by #3502.

- **`EACH_UNIT` keeps Spanish, Catalan, Galician and Basque words in general code (left open by
  A918 slice 4, #2141).** `packages/menu/src/units.ts:26-34` is never written into a venue, but the
  receipt reads its abbreviations to decide whether a line prints a unit
  (`apps/server/src/receipt-figures.ts:205-212`), so moving its words can change printed text: its
  own pull request waits for the owner.

## A1517. Allergen points to revisit before go-live

The remaining guest-menu work is qualification of the guest link over mobile data, tracked
under [A670](#a670--guest-menu-sharing-and-fixed-a4-presets).

The [11 November proposal](../superpowers/specs/2026-11-11-a1517-allergen-proposal.md) records the
original checks and their limits. The owner accepted its recommendations at 22:01; the
[recorded decisions](../superpowers/specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11)
retain the earlier scope and the six follow-ups.

## Decisions and deliberate limits

### Filters keeps a fixed breakpoint

For W83 (#1193), the watcher kept the 768 px table-width breakpoint on 21 November 2026.
The side panel and its gap use the shared sizing tokens, while the breakpoint stays fixed.
The [Chromium case](../../packages/ui/src/components/wt-data-table.test.ts#L8260) checks that
Filters opens full screen at 767 px and that the rows beside it retain their wide layout at
768 px. The row assertion catches a sizing change that makes the rows switch to their narrow
layout at 768 px. Smaller changes can still leave enough room for the wide layout.

- **Sales by category is its own report** (owner, 2026-09-25,
  [menus design](../superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md)
  §10.6). In Sales, choose a receipt printer to print the category report or a finished drawer
  close. On 22 November 2026, A1325 retired the saved day report and its chain.
  [Retirement slice](../superpowers/plans/2026-11-21-a1325-close-a-drawer-6-retire-daily.md)

- **"Patch live menu" is an emergency tool and stays plain** (owner, 2026-10-27, A1151). It
  corrects only the live version of one menu and puts the patch live at once: no scheduling, no
  correcting a version still waiting for its date (that is fixed the normal way: change the
  products, cancel it and queue it again), and nothing flows back into the products, queued
  versions or other menus. Open orders keep their price and VAT. Unit is not patchable, and
  allergens and diet labels are always read from the live product.

- **WT-TABLE-NARROW, 2026-11-17:** Products' root count uses BODY as its positioning ancestor,
  but long-name probes at 390/600/700 px in English and Spanish kept the page within its viewport.
  At 390 px its right-edge x coordinate was 195 px in English and 250 px in Spanish. The watcher
  cleared leaving its positioning alone. The real dashboard's Filters transition was measured
  at 1099 px (full screen) and 1100 px (side panel), both languages; a 1024 px window's collapsed
  sidebar also left room for the side panel. See [Filters keeps a fixed breakpoint](#filters-keeps-a-fixed-breakpoint)
  for the sizing decision.

- **Folded customer names** (owner, 2026-10-04, W77/#1197): show every language's name, with inherited ones in italic. The Product editor's Descriptors section has a Name row saying “None specified” for a blank language by A211's decision; left as it is (asked of the owner, 2026-10-04).


- **Structure branch changes (watcher, 2026-11-16).** Keep the current-path redraw check: no production code needs a new expansion event, and the controller remains for fitting, focus and paint.

- Two active products of one parent may not share a staff name, checked in code by folding each
  name (`foldName`); no unique index holds it, because the fold is Unicode-aware and this engine's
  `lower()` folds ASCII only (`packages/menu/src/product-names.ts`).


- **Prep stations at phone width (watcher, 2026-11-13 23:51).** Use the existing whole-table wrapping; no per-column heading API. Remaining Spanish horizontal scrolling is accepted. The 390 px read-outs cases in `station-table.test.ts` check that headings wrap, names and read-outs stay within their cells, and Actions stays reachable; they do not pin a width or promise no scrolling for arbitrary names.

- **Live declarations (A1150, owner 2026-10-27).** Allergens and diet labels take their source
  from the live product without publishing the menu. Sent till/history declarations follow A1517
  decision 6 below. [Design](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/specs/2026-11-15-a1150-live-product-declarations-design.md).

- **Sent declarations (A1517 decision 6, owner 2026-11-11, “As recommended”).** Sent till dishes and
  Orders history detail use declarations captured at the first send, including each extra's own
  declaration. Held dishes stay live until released. Kitchen screens, paper and guest-clash checks
  retain their live source. This is the sent-order/history exception to A1150; see the
  [recorded owner decision](../superpowers/specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11).

- **Till sold-out choices (A1516, owner 2026-11-11, “All four as recommended”).** Anyone signed in
  on a take-orders device can stop and restore availability, with no new permission. Restoration
  is manual, never a next-day reset. A running-down quantity (“only 5 left”) stays parked.
  [Delivery 2](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a1516-modifier-availability.md) keeps stored defaults
  and the till setter's last-choice refusal, including disabled lists still published; older published
  versions may contain fewer choices.
  A save naming the effective fallback retains the stored preference, so making that fallback the
  new preference requires separate saves.

- **Allergen choices (A1517, owner 2026-11-11, “As recommended”).** Hide unchecked dishes while
  excluding allergens, then extend filtering to extras/options; print live declarations on every
  kitchen ticket; bring forward A670's basic guest-menu design; label extras before selection; keep
  sent-order/history declarations as sent while kitchen and guest-clash checks stay current.
  Option-list labels carry no allergen declarations and remain unfiltered; new-dish filtering covers
  sizes and extra products, while saved dishes keep their choices.
  [Decision record](../superpowers/specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11).

- **Menu copies (A1172, owner 2026-10-28).** Copy… asks for an empty, required new name before
  saving the copy, matching floor plan sets. Cancel saves nothing. The browser and server refuse
  a name another menu holds; the source keeps its working state. Create and Rename apply the same
  rule. Case, surrounding whitespace and Unicode composition do not distinguish names; accents
  and interior spacing do. Existing duplicates remain until renamed, and do not block presentation
  edits (owner, 2026-10-28).

- Changing the menu that opens first keeps the previous default sellable as a member.
  Which menus you sell and which opens first are independent choices. The default-change
  case in `packages/menu/src/operations.test.ts` checks both menus and their default flags.

- **Sold-out tiles (A292, #1310, 2026-10-06).** A sold-out painted tile's stripe is
  `--wt-space-1` (4px) with a one-pixel `--wt-color-text` line beside it, so in both themes every
  palette colour's stripe either reaches 3:1 against the tile or is edged by a line that does; the
  dark theme's sold-out tile sits at the page's own level (`--wt-color-surface-sunken`); and the
  labels are centred (products.md, _Colour_).

- **Translate all's joint fault proof is recorded on pinned candidates (D85, 2026-10-20).**
  Cloud [PR #247](https://github.com/waitron-io/waitron-cloud/pull/247), commit
  `99b041744c0c7ea787a42053cc4c847c8e766771`, recorded five passing cases against Waitron
  `a3be14ba4e59bc8104087624171ddabec4978de2`: a lost page reply, restart between pages
  through SIGTERM and SIGKILL separately, a lost release reply and expiry between pages.
  The [pinned Cloud proof script](https://github.com/waitron-io/waitron-cloud/blob/99b041744c0c7ea787a42053cc4c847c8e766771/scripts/test-waitron-translation.mjs)
  drives those cases. This closes the requested
  joint proof for those pins, not qualification of later versions or a deployment.
  Cloud must support `servicesVersion` 2 before a box requesting it connects; see
  [Cloud connection](../developers/cloud-connection.md).

- **Translate all's initial allowance (owner, 2026-10-14).** It is free for connected venues
  for now, with the proposed $5 per venue per month cap and submit allowance of four jobs
  in flight, one per address. Paid subscriber service remains future work.

- **Translate all is always shown (owner, 2026-10-14).** A box not connected to Waitron Cloud
  still shows it, as an advertisement: it explains the service and links to connecting.

- **Products list columns (A655, owner 2026-10-14, 2026-10-16 and 2026-10-20).** Availability stays
  as it is, and the table may stay wider than its box at desktop width. Made at is deleted with its
  filter: where dishes are made is shown on Prep stations → Routes, the red asterisk after a
  category's name stays, and a routing read that fails shows one line above the list. Allergens and
  Dietary info start hidden. The ordering column is headed Standalone (Spanish «Por separado»), and
  the editor field and the filter are "Standalone ordering by" (Spanish «Pedir por separado»). A
  Course column and a Course filter join the list, and "Default course" is "Course". (2026-11-15: a
  read refused because the person may not see routing shows no line.)

- **Optional customer text and unit staff identity (A682, owner, 2026-10-17).** Every customer
  translation is optional, including the default. Units have a required staff name and abbreviation;
  neither is copied into translation maps. Report every missing enabled-language value. Default
  changes do not require complete text. Review all languages, Translate all and Use fix in the
  same editor. [Design and decisions](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-17-a682-translations-design.md),
  [implementation plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a682-translations.md). Existing populated
  venue folders require reset/reseed for the required unit staff columns; the owner approved
  declaring this reset, not executing one or squashing migrations under A760.

### A651 — drop photos to upload them, and tidy the image library and its picker

Historical design observations and owner decisions, 2026-10-14. The field and tile contract is
now in [the design system](../developers/design-system.md#primitives).

Owner, 2026-10-14, from screenshots of the library, the picker and the upload window. The library is
`packages/media/src/dashboard/image-library.ts`; the picker
(`packages/media/src/dashboard/image-picker.ts`) places that same component inside the window
`apps/dashboard/src/widgets/image-upload.ts` opens, with its `picker` flag set.

1. **Drop several photos on the library page** (boards 2, 3). The whole page accepts the drop and
   says "Drop 3 photos to upload them" while photos are dragged over it. Each photo uploads straight
   away, with no window, its default-language name taken from its file name (`patatas-bravas.jpg`
   becomes "Patatas bravas": extension dropped, dashes and underscores to spaces, first letter
   capital). While they upload, a bar reads "2 of 3 photos uploaded." and each new photo shows a
   New badge; no message says the names came from the file names (owner). The person renames one
   later with Edit. A photo the server reports as already in the library (`created: false`) is
   reused, as one uploaded through the window is today (`image.duplicate_reused`). The page also says "Drop photos anywhere on this
   page to upload them, or choose files", and choose files takes several files too.
2. **The upload window's Photo field becomes a drop area** (board 6): "Drop a photo here, or choose
   a file · JPEG, PNG or WebP, up to 20 MB". Once a photo is chosen it shows the photo, its file
   name and size, and "Choose another". This is a shared field primitive in `packages/ui`, under
   the rule that a screen does not draw its own form field (CLAUDE.md §3), with the tests a new
   `wt-*` primitive needs. Dropping one photo here fills the field and does not upload until Save.
   Its default-language name is filled in from the file name, as on a drop on the page (owner,
   2026-10-14), and can be changed before Save.
3. **The Photo field's required mark is red**, as the Name field's already is (today it is black).
4. **Library page** (board 1): the Upload photo button reads "Upload photos" and is drawn blue
   (`variant="primary"`; today it is drawn like every other button). The "Preview" label over each photo goes; clicking the photo still
   opens it. Edit and Delete leave the tile for a ⋮ menu beside the photo's name.
5. **Picker** (board 4): only the window's "Choose image" title shows; the library's own "Image
   library" heading goes. Each photo keeps the same ⋮ menu (Edit, Delete) and a full-width
   Use image drawn white (owner: not blue, so a page of photos is not a page of blue buttons). The
   big Edit and Delete buttons and the Preview label go. Upload photos stays (owner), so a photo
   can be added and used without leaving the product.
6. **The picker's full-size photo** (board 5) gains Use image, drawn blue, beside Back. Today it
   opens with no way to choose the photo from it.


### A652 — frame a photo for its thumbnails

Owner, 2026-10-14: Edit photo opens Adjust framing as a separate window. Drag and Zoom share
one focal point and zoom for the square Lists preview and the 4:3 Till buttons preview. Reset
returns to the centre at 100%; Done returns to the unsaved photo draft. Only the outer Save
persists names, accepted framing and a replacement file. Replacing resets framing while retaining
names, photo identity and every use. The full-photo viewer shows the complete current source.

Implementation, 2026-10-17: original hash filenames remain stable references and still serve
immutable original bytes. Replacement blobs and sparse framing/revision overrides travel in the
venue database and configuration transfer. Published/queued menu documents and their hashes do
not change; their presentation resolves the current photo. Already returned receipt presentations
and queued print payloads retain their earlier picture. A photo save refreshes all currently
matching department receipt rasters in the same transaction, including retained departments.

The grid uses square renditions bounded to 480 pixels; till tiles use 480×360, without enlarging
tiny inputs. These are bounded in-memory cached responses generated from durable source bytes.
Recipe URLs include source, framing and algorithm version. A removed recipe version returns 404;
raw content-hash URLs keep their byte identity. The [implementation plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a652-photo-framing.md)
records the limits, collision policy, measured large-input byte reduction and tiny-seed counterexample.
The old “about 4 MB per page” estimate was not a measurement. Current upload dedup preserves the
matched photo's names/framing; an occupied retired-original alias is refused when no current source
matches, rather than silently returning a different picture.

The visible-page resolver remembers up to 256 recent presentations across remounts and refreshes them in the background. Newly arriving thumbnails do not cancel a lookup already serving mounted rows. Public rendition requests have their own bounded queue; photo saves prepare the display crop outside that queue and outside the write transaction.

### A647 — tidy the product editor

Owner, 2026-10-14, decided over a run of screenshots and mock-ups. Boards: 1 the thumbnail, 2 the sections,
3 the Variants section and the unit link, 4 the whole editor as it opens (the target), 5 the
Selling options (A chosen; B, two loose lines under the name, rejected). Where a board and this
text differ, this text wins. The editor is `apps/dashboard/src/widgets/product-editor.ts`.

1. **The thumbnail is the one control for image and colour.** The Colour heading, the
   "Use category colour" chip, the swatches and Custom leave the form. The square beside the name
   shows the image, or the colour when there is no image, carries a small pencil badge, and opens
   one panel holding Choose image, then Use category colour, the swatches and Custom. A colour
   picked there shows in the square at once, before saving (today the square shows the saved value
   only). Keyboard focus returns to the square when the panel closes.
2. **Every section has one style.** Title in bold, its arrow beside it as now, a light line under
   the title running the full width; a closed section's summary sits close under the line at normal
   line spacing (today Descriptors' two summary lines touch). The gap between sections is the same
   everywhere: today the gap after Kitchen is larger than the others and Pricing's label sits
   directly under Nutritional info with no gap.
3. **Pricing, Variants and Modifiers become sections like the others** (today PRICING and
   MODIFIERS are grey all-capitals labels that never close, and Pricing becomes a section only once
   a variant exists). Variants is its own section after Pricing. With no variants, the open Variants
   section shows only Add variant under its title; closed, its summary reads "None". Pricing's
   closed summary keeps today's "Base price: €11.00 each · VAT: Reduced (10%)" form.
4. **A Selling section, placed first,** holds the Available switch and, below it, "Ordered on its
   own by" with a three-way toggle: Anyone / Staff only / Nobody (today "Public / Staff only / Not
   sold separately", `product.ordering_*` in `apps/dashboard/src/i18n/strings.ts`), with the
   chosen choice's existing explanation underneath (`product.ordering_*_hint`). Closed, its summary
   reads "Available · Ordered on its own by: Anyone", with "Unavailable" in the warning colour
   (`--wt-color-warning`) when the switch is off. The new names apply wherever the old ones are
   shown, including the products list's ordering filter and its tests; the Spanish strings change
   with them and need the owner's wording. On a variant's page, which has no ordering choice, the
   section holds only the switch.
5. **Which sections start open:** Kitchen and Pricing; Modifiers when the product has any; for a
   product with variants, Variants open and Pricing closed. Selling, Descriptors and Nutritional
   info start closed.
6. **The variants table's unit choice becomes a link** in the Price column title,
   "Price · Each ▾", in place of the bordered button; it opens the same unit dialog. The base
   price field's own unit button stays as it is.

7. **Added 2026-10-15 (owner): the Pricing unit dialog's units read in the dashboard's language,
   sorted.** Today they read in the venue's first content language (`locales[0]`,
   `apps/dashboard/src/widgets/product-editor.ts`), which is Catalan for a Catalan venue even with
   the dashboard in English, while "Each" comes from the dashboard's own strings
   (`editor.unit_each`); and after Each they come in the order of their random ids
   (`packages/menu/src/units.ts`). Show each unit's name in the dashboard's language (falling
   back as other content does when a unit has none), Each first, the rest alphabetical. Read, not
   run, 2026-10-15.

**The three-way toggle is a new shared primitive** (`packages/ui`; nothing like it exists — only
`wt-switch` and `wt-combobox`), so it needs the two tests a new `wt-*` primitive needs (CLAUDE.md
§3): a token-painting test and an axe test for each state in both themes. It is a single-choice
group: one button per choice, the chosen one filled `primary`.

Related open entries on the same screen: [the editor summarises the same values
twice](#the-product-editor-summarises-the-same-values-twice) (Nutritional info's summary), and
the Descriptors fold at 390px in `docs/backlog.md`. Every change here is to an editor that saves,
so its draft scope and `*.unsaved.test.ts` must keep passing with sections closed.


2026-10-15: implemented by the [A647 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a647-product-editor.md).
The numbered decision above records the approved design and describes the earlier editor where
it says “today”. The owner supplied Spanish wording the same day: Venta; Pedir por separado;
Cualquiera / Solo el personal / Nadie.

**Table toolbars and closure (A462, owner 2026-10-10).** Customise follows search and stays last
at every width. Header and row checkboxes share their leading alignment. Products and Structure
start with their root open, have no Expand all button, and open only the chosen branch's own level.
Closing a branch closes its descendants, including hidden paths. Preview keeps Expand all.
Structure uses one Select mode for checkboxes and drag handles. Search openings and their parents
survive clearing unless deliberately closed; after clearing, a closed current Structure path
returns editing to its nearest open parent. Products remembers deliberate closures across reloads.
[Implementation plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-10-a462-table-toolbars.md).

**Product search (A461, owner 2026-10-10).** Products and Menu Structure show flat own matches
with inline paths. Each new query starts branches collapsed. Opening one shows its contents
and keeps matching descendants as flat results too; openings and their parents persist after
clearing. Products shows its one category placement; Menu Structure shows every member path.
Repeated views of one list/member share one tick, while distinct memberships remain separate.
Table-sort ties remain the A454 rule, confirmed by the owner. Search and filters retain eligible
ticks; Select all changes visible ticks only. Dragging carries visible ticks on both dashboards
and keeps hidden ticks; Move/Remove take the full selection. Removed or no-longer-owned rows
are trimmed. The till mixes products and displayed sections by closeness with traversal-order
ties, disables diet-empty sections, and opens a section without changing the basket.
[Implementation plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-10-a461-product-search.md).

- **Courses and stations use permanent Delete (A435 step 5, owner, 2026-10-10).**
  Neither kind offers Disable, Enable or a Status filter/column. You may reuse a deleted name
  with a new id. Deleting a course clears product defaults, including archived products;
  recorded draft and order choices keep the original course. Courses and stations left as
  history are excluded from configuration exports; archived products still travel.

**Products: the tree's Name column lines up, and the Main category column goes — DONE (W84, #1199, owner
2026-10-04).** Seven existing test assertions that pinned the column changed, for the owner to
review (listed in the PR). A product whose category the dashboard's category list does not hold
lists under All products with no "missing" marker; the database refuses a stored product naming a
category that does not exist (`packages/db/src/schema/menus.ts:51`, a foreign key; not tried),
so this is expected only while the dashboard's category list is behind.

**Products: the Move dialog's destination categories (W82, #1210).** Two sibling categories with the same name are left as they are (owner: "leave it"): they still show as two identical entries, in the tree and in a search.

**Products: a category's Made at (W86, #1203).** The "some items made elsewhere" note does not look at whether the categories involved hold any products, so it can claim items that do not exist yet; the owner chose to keep these words (2026-10-05). (2026-10-20, A655: the Made at column and this note were deleted.)

**Products: Show archived replaces the Status filter, and the Status column becomes Availability (A463, owner
2026-10-10).** Show archived starts off; on, archived products and variants are listed too, with View in place of Edit and Archive.
Availability is blank for an ordinary product, Unavailable when sold out, and Archived when archived,
also when it is sold out; the owner chose this column over badges beside the name. The Allergens filter
offers the column's three states (Pending / None / Declared) rather than one "nutritional info" filter,
so a product never checked stays apart from one checked and allergen-free. A668-3 (2026-10-16) renames the displayed Pending label to Not reviewed and applies each variant's effective state to its cell and filter; inherited badges are italic. Dietary info's "Has" means a
Vegan, Vegetarian, Halal or Kosher override (owner); the list also counts a
ticked dietary declaration. Made at offers only the stations the column names for some product, not
every kitchen station, and matches the station the column shows, including a switched-off station a
product has no replacement for; the backlog entry marked that matching "assumed, not asked".
**2026-10-10 update:** A435 step 5 removes deleted stations from current routing settings and
choices. The switched-off-station example above records A463's earlier decision; Task 9's
integrated Made at check follows the surviving rule after deletion. (2026-10-20, A655: the Made at
column and filter were deleted.)

- **Task 13 (#903, standalone ordering).** A product's `ordering` is Public, Staff only or Not
  sold separately; Staff only behaves exactly as Public until guest ordering exists.

From "Extras and Options — deliberate limits, and what is left open"
([integration contract](../developers/modifiers.md)):

- **An options list is always required.** It asks for exactly one pick, with the default
  preselected; an unanswered ACTIVE list refuses the order with `options.label_required`. An
  optional options list is a possible future change, not built.
- **A variant offers its parent's lists and cannot override them**; a per-variant attachment row
  is a possible later addition.
- **A menu offer carries all its product's extras and options lists; there is no per-menu extras
  editing (owner, 2026-10-01; #993).** The per-menu tables were dropped, and
  `packages/db/src/schema/menu/migrations.test.ts`'s "has no per-menu extras tables" checks they
  stay gone.
- **Extras only on a dish sold by the unit (owner, 2026-10-15; A663 Part 2d).** A dish whose unit
  has a scale or allows decimal places takes no extras, so 1 l of sangría cannot carry one; to sell
  it with extras, sell it in a unit with no scale, no decimals and the measure switch off (a jug).
  Owner, 2026-10-19 (A821): a unit can be marked a measure ("Mide una cantidad (ml, g…) — sin
  extras"), and a dish in a measure takes no extras either. On a newly set-up venue the seeded ml,
  l, g, kg and mg start with it on; a new unit starts with it off. The switch is frozen into the
  published menu with the dish's unit, so a change reaches the till and the server at the next
  publish.

From A344 (#1375, a menu's Price overrides tab shows its clashes):

- Decided as built: a filter choice the person made earlier in the browser tab (the table keeps
  one for every menu) wins over starting on Clashes; the red line still gives the count. Under
  Clashes a product that clashes itself stays folded until opened, as the table folds any row
  that matches a filter in its own right. Once a load has had no clash, a clash that comes back
  (Undo, a live re-read) does not switch the filter back to Clashes.

From A345 (#1383, a menu with clashes cannot be published, from anywhere):

- Decided as built: a product with both a variant that follows its clashing price and a variant
  whose own price clashes is marked on its own price first, because a price typed there settles
  one of them; once typed, the mark moves to the variants.

From A294 (#1300, the Products and Structure trees show drag grips only in a mode):

- The Structure tree's section rows were deliberately not top-aligned: section names do not wrap
  there, and `apps/dashboard/src/widgets/menu-structure-table.test.ts` deliberately centres the
  included-menu name and note.

From the product editor tidy-up (A209 to A219, owner 2026-10-02):

- A209 (#1090) — No migration clears the categories variants already store, and none will be written (owner
  decision, 2026-10-03: no data-migration code before go-live, CLAUDE.md §3, and the dev venue is
  reset before then). The effective category (`effectiveProductColumns.categoryId`) and the
  editor's read ignore a stored one, and the next save of the variant's own page, or that
  category's deletion, clears it.
- A216 (#1057) — **Decided (owner, 2026-10-02):** "Each" with no unit, "per <unit>" with one.
- A217 (#1065) — The wording is "inactive", to match the rest of the dashboard (owner).
- A219 (#1065) — **Decided (owner, 2026-10-02):** the price comes before VAT, everywhere.

From A332 (#1430, "All products" holds a venue default colour):

- (3) the All products swatch sits one tree level left of the categories' swatches, by the table's
  indent rule. Owner ruling 2026-10-08 (A415): keep each square at its own row's indent, never one
  column, and every level has one.

From A204's W99 (#1358, queued menu publication), left open after W99:

- **Left as it is (owner 2026-10-07): a narrow window, and menus are not fiscal records.** A due
  version is served as live before anything records it (publication plan Decision 5), so if
  the box's clock is stepped backwards past its time before the activation duty records it, reads
  serve the previous version again until the clock catches up. A Codex review reproduced it against
  the real migrations. Closing it means reads recording what they serve, or a never-decreasing
  clock in the process.

From A222 (#1101, a variant always has its product's unit):

- No migration clears the unit rows variants already store: the owner chose this on 2026-10-03,
  as for A209's categories (no data-migration code before go-live, CLAUDE.md §3). The product, menu and unit
  reads ignore such a row, and the next save of the variant's own page, or its unit's deletion,
  removes it.

From variants as products (#511–#556):

- **A menu offer created with no price field at all is refused** (`management.request_invalid`);
  only an explicit `null` means "blank, charge the product's own price" — **decided 2026-09-23 by
  the owner:** _"we don't want to confuse 0.00 with `""`"_.

From units and the old `pricing_unit` (#342, #375, #382):

- **Only kilograms, grams and milligrams can ever come from a scale** — a fixed list enforced by a
  database check, separate from the editable name. A unit you invent, and the volume units, are
  typed, never weighed. Intended, not an oversight.

From A335 (#1457, the menu editor's heading):

- **When the venue needs a reset, the menu editor shows the "reset the venue" sentence inside the
  brackets beside the menu's name**, where the live version normally sits, in muted text. A review
  suggested a line of its own; kept in the brackets by decision. (A335, #1457.)

From the owner's answers to A774's keep/drop list (owner, 2026-10-17):

- **Spanish stays enabled everywhere** (owner, 2026-10-17, Spanish A closure): in a Spanish
  venue, keep Spanish enabled whatever the province, including an unknown province. Entered
  customer text remains optional and missing text is reported. Whether receipts outside Catalonia
  stay free to choose was not answered and stays open.
- **Clearing the Extras editor's Minimum choices box saves 0, and that is right** (owner,
  2026-10-17): an empty box means no minimum, so a cleared minimum is not refused.
- **A product literally named `Gin (Double)` and `Gin`'s `Double` variant may show the same label**
  (owner, 2026-10-17): no naming rule is added; distinct saved names are the answer. (A357, #1381.)
- **The Pricing fold does not name an empty base price or VAT** (owner, 2026-10-17): a new product
  already starts with the venue's default VAT, and a variant's empty VAT shows its parent's as its
  hint.
- **Accepted as built: Save turns active only for a refusal an option's window holds when it opens**
  (owner, 2026-10-17). One handed to it while it is already open leaves Save as it was, and it
  stays active for the whole time that window is open, even once the refused field is edited back.
  (A410, #1434.)

- **Past sales of a variant that had a category of its own now show under its product's
  category** — left open by A209 (#1090): in the category sales report's "Current categories"
  mode (`current`, `packages/reporting/src/category-sales.ts`), which classifies each line by the
  menu as it is today; "Categories at time of sale" still reads what each line recorded.

### A1515. Set menus

The old set-lunch build has been removed. The owner replaced it on 17 November 2026 with
[set menus](../superpowers/specs/2026-11-17-set-menus-design.md): ordinary dishes are ordered,
the waiter adds set menus by type, and each dish is placed in a set menu on the bill that lists
it and stays there (revised 18 November 2026). A set-menu draft has storage for its terms,
lines and dish choices. Service periods and the venue default take ordinary menus.
A full menu's structure can hold a set-menu reference and keeps its ordinary offers separate.
Set-menu drafts can store dish and variant surcharges, leave variants out, copy dishes and
add a line for each new course. Drafts can store an eat-in and an optional takeaway VAT class.
Dishes and variants can have different rates from the set menu. Draft writes still enforce
portion-only units and the surcharge limit. A dish can have its own course in the draft.
Publishing or scheduling a full menu freezes each set menu it holds and refuses drafts with
problems. Published copies protect their dishes and photos. Preview reports set-menu placements
and edits. Its existing allergen review and extras-portion warnings include set-menu offers.
The live correction dialog starts from the full menu's own dishes and modifiers. Wording, VAT and
modifier corrections also reach matching dishes and modifiers in the copies. A dish offered only
by a set menu can be corrected through the API. Extras usage and routing include set-menu dishes.
The till's zone offers now include published set-menu copies. They identify the newest copy on sale,
and the server can read a bill's recorded copy after its full menu is republished.
Shared ordering code calculates where a dish fits, what it costs there and which moves make room.
Bill storage now holds set menus and their recorded copies, dish places and draft reservations.
The server reads the recorded copies and dish places, and refuses new payments, comps,
discounts and ticket issuance for these bills until set-menu billing is ready.
Kitchen tickets, station queues and service reads show the dishes from a set menu. The menu
itself adds no kitchen work and does not count as a dish. The server keeps set-menu dishes
separate in drafts and saves their places and prices together on Send. A table can still order
from its recorded copy after the menu period ends. The server can move placed dishes to another
set menu on the same bill and save the new surcharge. An edit keeps the first dish's place,
and additional dishes each need their own place. Cancelling a dish without charging for it opens
its place. The server can move a menu with its dishes between bills, keeping their prices. A
dish moved on its own needs a place on the destination bill and takes that place's surcharge.
Splitting a draft keeps the dish's menu offer and clears its place reservation on the old bill.
The till API can save counts, cancel an empty set menu, and return the bill's saved copies
after a full menu is republished. It refuses to remove or move a set menu when a saved draft
dish on its original bill would lose its only place. The till restores saved set-menu dishes
from the bill's copy, follows sold-out changes and explains refusals in English and Spanish.
At a seated table the till can set counts, order from the bill's folders, handle a dish
with no place, and move a set menu with its dishes. At the Counter, staff can start a
takeaway with a set menu, park it and retrieve the recorded menu and its prices.
The dashboard's management API can now create and edit drafts and place them in full menus.
Full-menu Preview and publication status refresh when set-menu settings change.
The dashboard can open an existing set-menu draft, edit its name, price, VAT rates and inclusion
lines, and show what to fix before publishing. A full menu’s Preview links to its set menus with changes or publication problems.
Managers can add and copy dishes in a set-menu draft, give a dish a course for that set menu, and
edit surcharges and variant choices. The editor shows the inclusion lines added or removed by a
dish change. The dashboard piece lets managers create a set menu, place it in a full menu
and publish its current version to the tills. The products guide covers setup in both languages.
Selecting copy-only dishes in the live correction dialog remains open. Set-menu payments, bill documents and the demo remain. Release set menus to venues only once
all five pieces are in. This rollout has no feature switch (watcher, 2026-11-19).
_2026-11-18: adviser question
[T17](../compliance/2026-11-06-adviser-questions.md#the-questions-that-need-judgement) has the owner's answer
(owner, 2026-11-18, question 4 of the [19 November sheet](../compliance/2026-11-19-adviser-meeting.md);
the adviser is still to confirm the details): a set menu
takes the VAT rate of its main item, so food with a drink takes the food's rate, eaten in or
taken away, and its price is not split between its items' rates; items ordered separately to take
away keep their own rates. Covered dishes may be left off the ticket, and a full invoice lists
the menu and its supplements the same way (owner, 2026-11-18). Owner's decision, 2026-11-18: a set menu carries its own two VAT rates, eaten in
and taken away, set by the manager like any product's (normally the food's, 10%); any dish may be
included and takes the menu's rate, and set menus are allowed on takeaway orders. The spec's
refusal of set menus on takeaway and delivery orders, and the plans' refusal of a dish at another
rate, go._
