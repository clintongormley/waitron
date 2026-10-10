# A453 — The menu Structure tab gets a root row; long windows keep their buttons in view

Queue item A453 (lane B), owner 2026-10-09 ~22:00. Two parts:

1. **Root row.** The Structure tab (`apps/dashboard/src/widgets/menu-structure-table.ts`, hosted by
   `apps/dashboard/src/screens/menus-screen.ts`) gets a first row standing for the menu itself,
   built like the Products tree's "All products" row (`apps/dashboard/src/widgets/product-list.ts`):
   the menu's name in bold with its counts, and a ⋮ holding the three top-level adds. The toolbar's
   "+" (`data-test="toolbar-adds"`) goes. The empty menu keeps its box with the three add buttons.
2. **Buttons stay in view.** The Add products window (`dashboard-section-add-products`,
   `apps/dashboard/src/widgets/section-add-products.ts`) keeps Cancel / Add products visible at
   every height and on a phone, with the list scrolling inside the window. Every other window that
   holds a long list is checked and given the same result.

Owner's words: "i didn't even see the + and products doesn't have it. let's do the root row
instead" and, for the window, "Pin them". The owner's 2026-10-07 complaint about the OLD
"Menu: …" row that A337 removed (no swatch, inset barely less than the sections so the hierarchy
read wrongly, no expand arrow) must not come back.

A454 (search everywhere, #1491) has landed on main (`fe5d1ba24`); this branch starts from
`9037f77a9`, which includes it.

## Decisions this plan makes that the item does not (defaults build; the owner may override)

1. **The root row's key is `"root"`, and every member key stays as it is.** Member rows keep their
   keys (member ids from the top level down, joined with `/`; `menu-structure-table.ts:81-95`), so
   `drag-<key>`, `actions-<key>`, `select-<key>`, the host's current-path keys and every existing
   test key are unchanged. Only the top-level rows' `parentKey` changes, from `null` to `"root"`;
   the root row's `parentKey` is `null`. The root row is NOT put in the widget's `#rowByKey` map:
   every sibling, drag and keyboard-move helper reads that map (`#siblingRows` `:364-366`,
   `#targetFor` `:506-527`, `#moveOut` `:630-640`, `shownSelectableKeys` `:698-706`), so they keep
   seeing members only. The table gets `[rootRow, ...memberRows]`.
   - Why not `""` (which would make `focusRowMenu("")` trivially the root): `wt-data-table` uses
     `""` as its own bucket for top-level rows (`packages/ui/src/components/wt-data-table.ts:1845`,
     walked from `walk("", 0)` at `:1868`) and stops its ancestor walk on a falsy key (`:1795`), so a
     row keyed `""` would be drawn as its own child and never counted as an ancestor of a match.
   - The same key as Products' root (`product-list.ts:60`) and the Preview tree's root
     (`menu-document-tree.ts:155`).
   - Residual, stated rather than guarded: a member whose id is literally `root` would collide.
     Minted member ids are UUIDs (`section_members.id` defaults to `newId`,
     `packages/catalogue/src/schema/sections.ts:57`, `packages/db/src/schema/columns.ts:178`). A
     configuration import carries the file's ids; I found no UUID check on them (`grep isUuid`
     matches no configuration-transfer file), so a hand-written import could in principle carry
     `root`. Say so in the PR; no guard is added.
2. **Counts: the whole menu as a guest sees it, each thing once.** Like Products' root, which counts
   the whole catalogue (`#count`, `product-list.ts:882-896`; `#contents` `:898-903`):
   - **sections**: the distinct section ids of every section node in the tree that is not an
     include, including sections inside included menus; a section shown in two places counts once.
     An included menu itself is not counted (its row reads "Menu: …", not a section).
   - **products**: the distinct product ids of every product node in the tree, including inside
     included menus; a product listed twice counts once.
   - Wording follows `#contents` exactly: the sections part only when there is at least one section;
     the products part when there is at least one product, or when there are no sections.
     EN "12 sections, 140 products", "1 section, 1 product", "3 products", "2 sections",
     "0 products" (a menu holding only includes of empty menus). ES "12 secciones, 140 productos",
     "1 sección, 1 producto".
   - Strings: new `menus.section_count` "{count} sections" / `menus.section_count_one` "1 section";
     ES "{count} secciones" / "1 sección". Products reuse `folders.product_count` and
     `folders.product_count_one` (`apps/dashboard/src/i18n/strings.ts:130-131`, ES `:2650-2651`),
     the same words the Products root uses. `menu_prices.section_count` (`strings.ts:2145`) is not
     reused: it has no singular form.
   - Like Products (`product-list.ts:250-253`), the count is visually hidden on a narrow table and
     still read out.
3. **Swatch: the menu's own colour, only when it has one; never a button.** A menu has a colour: it
   is its root section's (`MenuStructure.root: SectionDetails`, `apps/dashboard/src/api/client.ts:222-228`;
   `color` at `packages/catalogue/src/section-types.ts:23`), edited in the menu's settings form
   (`dashboard-section-details-form`'s colour field, `section-details-form.ts:304-313`, mounted by
   `#renderMenuForm`, `menus-screen.ts:2216-2238`). The table gets a new property `menuColor`
   (`string | null`), which the host passes as `structure.root?.color ?? null`. With a colour, the
   root row's leading frame holds that colour's chip in a non-interactive `swatch-box`
   (`data-test="color-root"`, the same shape an unowned section draws, `menu-structure-table.ts:888-891`);
   without one, the frame stays empty so the name still lines up. Not a button: editing the menu's
   colour belongs to the menu's settings, which this item does not move (decision 7). Say in the PR
   that Products' root chip is a button because it edits the catalogue's default colour, which has
   no other home, while the menu's colour has one.
   How it reads as the root, matching "All products": name in bold (`<strong>`, as
   `product-list.ts:1272-1274`), counts after it in the muted small style, no expand arrow because
   it cannot close (`rowCollapsible` false, as `product-list.ts:1520`), and every member one full
   indent step further in (aria-level 1 for the root, 2 for top-level members). The old A337-era
   row's "Menu: <name>" wording (`menus.menu_prefix`) is NOT used.
4. **Drag and drop: the root row is not a drop target, and has no grip.** A release over it does
   nothing and no gap or "into" mark is drawn on it. Every place in the top level is already reached
   by dropping beside a top-level row (`#targetFor`'s "beside", `:524-526`), and a drop on a row
   that sits above the whole list has no obvious place (start or end). This follows from decision 1
   (`#targetFor` returns nothing for a key not in `#rowByKey`, `:508-509`) and needs no new branch.
   In Reorder mode the root row draws the invisible grip space (`gripSpace`, `:49-51`) so its name
   lines up. ArrowLeft on a top-level row's grip does nothing: `#moveOut` finds no section row for
   `"root"` (`:631`) and returns. Products' root takes drops because a product has one category to
   file into; a menu's top level is an ordered list.
5. **Selection, search and filter.** The root row never takes a box; Select all ticks members only;
   `shownSelectableKeys()` never lists it. It answers no search (`searchValue` `""`, as Products,
   `product-list.ts:1374`) and no Available filter option (filter value `[]`, as a section,
   `menu-structure-table.ts:1055-1060`), so the table keeps it only as the ancestor of a row that
   matches (`#treeVisible`, `wt-data-table.ts:1780`). When nothing matches, no row is drawn and
   the table's no-matches box shows (`renderedCount === 0`, `:2542`). This differs on purpose from
   Products, whose root passes every filter option (`product-list.ts:1388`) and so stays drawn alone
   when a filter matches nothing; say so in the PR. Expand all / Collapse all never count or close
   the root: the table already leaves a non-collapsible row out of its branches (`:2185`) and never
   seeds one closed (`:1087`).
6. **Focus.** `focusRowMenu("")`, and the fallback when no drawn row on the path has a ⋮, focus the
   root row's ⋮ (`tr[data-row-key="root"] wt-row-actions`, `data-test="actions-root"`); in an empty
   menu, the empty box's first add (unchanged). The host needs no change for "focus returns to the
   root's ⋮ after an add started there closes": `#openAdd` already records the path `[]`
   (`menus-screen.ts:1569-1571`) and `#returnFocus` hands `""` to `focusRowMenu`
   (`menus-screen.ts:1599-1606`). Known edge, stated not fixed: while a search or filter hides every
   row there is no root ⋮ to focus, and focus stays where the closing window's own return put it
   (`wt-dialog`'s `refocus`).
7. **The root ⋮ holds exactly the three adds**, in today's order (`ADDS`, `menu-structure-table.ts:102-106`):
   Add section, Include a menu, Add products. No Edit, Delete or divider: the menu's own settings
   and deletion live on the menu list and the page heading. Its label is "Actions: <menu name>"
   (`members.actions`, as every row). The items keep their `-top` test ids (`new-section-top`,
   `include-menu-top`, `open-add-products-top`) so the host's events and most checks keep their
   names; they now live in the table's shadow root, not the widget's own.
8. **Where the "buttons in view" fix belongs.**
   - **The modal primitive already does it.** `wt-modal` scrolls its body and keeps its `footer`
     slot outside it (`packages/ui/src/components/wt-modal.ts:42-58`), guarded by "scrolls long
     content while both footer actions stay visible and stationary"
     (`packages/ui/src/components/wt-modal.test.ts:455`). The house rule is to put
     `wt-form-actions` in that slot (`docs/developers/design-system.md:1289-1297`).
   - **The Add products window breaks it** because the widget draws its own `wt-form-actions` at the
     end of its list, inside the modal's scrolling body (`section-add-products.ts:353-362`; the host's
     modal, `menus-screen.ts:3398-3448`). A shadow-root element cannot be slotted into the host's
     footer. **Default: the widget lays itself out as a column that fills the window's body** —
     filters at the top, the "Select all listed" row under them, the product list as the only part
     that scrolls, and the count, its "none chosen" message, the host's refusal message and the
     buttons fixed at the bottom with a divider above them (`--wt-color-border`, as the modal
     footer's). The host's refusal paragraph (`data-test="add-products-error"`, `menus-screen.ts:3416-3422`)
     moves INTO the widget through a new `message` slot, so it no longer pushes the column down;
     it stays in the host's tree, so its styling and every `inModal(…, '[data-test="add-products-error"]')`
     lookup keep working. The column takes `height: 100%` of the modal body, which the standard
     modal holds at full window height whatever its content (`wt-modal.ts:21-22`;
     design-system.md:1281-1282). If the browser test shows the percentage does not resolve,
     fall back to `position: sticky; bottom: 0` on the bottom block, and say which was built.
     Rejected: the widget drawing its own `wt-modal` the way `dashboard-add-to-menus` does
     (`add-to-menus.ts:356-393`) — the right shape, but it moves the window's close, Escape and
     unsaved-changes wiring (`#beforeProductsClose`, `menus-screen.ts:1706-1716`) and about a hundred
     `add-products` lookups in `menus-screen.test.ts`; worth it only if the column look is refused.
   - **Other `wt-modal` windows holding a list already pin their buttons** — no change, each named
     with its receipt: Add to menus (`add-to-menus.ts:370-371`, footer slot), the Structure tab's
     Move to section… (`menus-screen.ts`, `wt-modal data-test="move-selected"` with
     `wt-form-actions slot="footer"`), Products' Move / Delete (`catalogue-browser.ts:757`). The
     Home page tab's add-shortcut window (`home-shortcut-picker.ts:147-158`) draws its buttons in
     the body, but its body is one field (a multiple-choice combobox whose list is a popover) in a
     compact modal: **default no change**, with a browser check that proves its Add stays in view at
     390×700 with 200 options and 50 chosen (Task 5). If that check fails, it gets the same footer
     move as below.
   - **`wt-dialog` does NOT keep its footer in view.** Measured 2026-10-10 in this worktree with a
     throwaway test in `packages/ui` (Vitest browser mode, Playwright Chromium, viewport 390×700):
     a `wt-dialog` with a 1800px-tall body and a two-button `wt-form-actions` in its `footer` slot
     drew Save's bottom edge at 1857px, below the 700px window (the failing case I had stated
     beforehand; the probe file was deleted). Its CSS gives the native dialog no column layout
     (`wt-dialog.ts:53-97`), so the whole dialog scrolls, footer included. Dashboard `wt-dialog`s
     that hold a list a venue or the code can make long: the order detail's lines
     (`order-detail-dialog.ts:110-187`, Reprint in the footer), the allergen picker
     (`allergen-picker.ts:227-266`), and every table's Customise columns (`wt-data-table.ts:2420-2521`,
     Restore and Done in the footer). **Default: the shared fix goes into `wt-dialog`** (Task 6):
     an open dialog is a column bounded by the window, its body scrolls when content is taller,
     and its footer stays in view; short dialogs look exactly as today. `wt-modal`'s copies of those
     rules fold into it. This changes a `packages/ui` primitive used by about sixty dialogs, the
     till's included, so **the branch takes the FULL review path**. The runner may instead split
     Task 6 into its own queue item; then this branch is LIGHT.

## Global constraints

- Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-service-menu-root-row`, branch
  `feat/service-menu-root-row`. Commit with `git commit -s`. Never `--no-verify`.
- Test first: write or change the test, run it, watch it fail for the stated reason, then the code.
- A test check that changes because this item changes what it checks is allowed (owner
  2026-10-05). Every task reports each changed or deleted check with its reason; the list below
  ("Changed test checks") is the expected set — report any extra one.
- No server, database or fiscal change. No new route, error code or live subscription.
- Concise text (owner rule). Every new string in EN and ES (`apps/dashboard/src/i18n/strings.ts`).
- No form is created or rewritten, so the save rule (`draftScopeFor` / `saveActionState`) is
  unchanged; the Add products window keeps its existing save state.
- House rules: `/Users/clintongormley/workspace/repos/waitron/CLAUDE.md` (claims need receipts;
  browser tests run in real headless Chromium; `wt-*` tokens only in `packages/ui`).
- Focused commands, from the worktree (these packages run in real headless Chromium; check free
  memory first with `memory_pressure | grep free`):
  - `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-structure-table.test.ts`
    (and the other file paths named per task; add `-t "<name>"` to narrow while iterating, then run
    the whole file).
  - `pnpm --filter @waitron/ui exec vitest run src/components/wt-dialog.test.ts` and the like.
  - `pnpm --filter @waitron/dashboard typecheck` and `pnpm --filter @waitron/ui typecheck`.
  - `pnpm format:check` and `pnpm --filter <pkg> lint` before each commit.
- Each implementer finishes in well under ~100 tool calls; one that passes ~150 stops at a passing
  or cleanly failing point, commits, and hands over (done, left, files, each check's state).

## Changed test checks (expected; each task reports its own)

`apps/dashboard/src/widgets/menu-structure-table.test.ts`
- `shown()` helper (`:166-169`): returns member rows only (drops `"root"`); a new case pins that
  the root row is drawn first. Without this, 58 `shown(el)` lists would each gain `"root"`.
- "draws the menu's members as the top-level rows, in menu order, with no row for the menu
  itself" (`:208-234`): rewritten — the root row comes first at aria-level 1 with the menu's name,
  members at aria-level 2; it still asserts that no "Menu: Lunch Menu" text is drawn (the old row's
  wording) and that every top-level row's swatch sits in one column.
- aria-level pins at `:211`, `:254`, `:2540`: one level deeper.
- "names a new section's add Add section, in English and Spanish" (`:301-311`): reads
  `new-section-top` in the root's ⋮ (table shadow root) instead of the toolbar.
- "offers the top-level adds in the toolbar's Add ⋮ and on each place an owned section is shown"
  (`:313-348`): the root row's ⋮ holds exactly the three adds; its `actions-root` check (`:347`)
  flips from absent to present; the toolbar-slot, `icon="plus"` and `menus.add_to_menu` checks go.
- "keeps a button the host puts in the toolbar's end after the Add ⋮" (`:350-362`): replaced by
  "draws no plus in the toolbar; the host's toolbar-end content is all that is there".
- "draws the Add ⋮ with the border and fill of the toolbar's icon buttons" (`:364-400`): deleted
  (the button is gone).
- "shows an empty menu as the table's empty box…" (`:689-729`): its last check (`:727`,
  `toolbar-adds` present once rows arrive) becomes `actions-root` present.
- "disables the toolbar's adds while busy…" (`:731-740`): the root ⋮'s adds.
- "focuses a row's menu, or its nearest drawn ancestor's, or the toolbar's Add ⋮…" (`:742-762`):
  `:755` and `:759` expect the root's ⋮.
- "keeps every row's menu on a phone's screen" (`:777-800`): the row-menu count includes the
  root's ⋮ (trim the fixture if nine rows do not fit 844px); the toolbar block goes.
- "names only the members, with no name drawn for the menu itself" (`:810-818`): `root-name` is
  drawn once, with the menu's name; member names unchanged.
- `:1425` (`tbody tr[data-row-key]` count equals `DEEP_ROWS.length`): plus one for the root.
- "starts every name one even step further in per level…" (`:868` onwards): extended so the root
  is level 1 and the same step separates it from the top-level rows (this is the A337 complaint's
  check); member levels shift by one.
- "draws the menu's members as the top-level rows, even when a home is handed to it"
  (`:2534-2542`): level 2, root row present.

`apps/dashboard/src/widgets/menu-structure-table.a11y.test.ts`
- state "toolbar add menu open" (`:68`, `:118-126`) becomes "root menu open" (`actions-root`
  opened in the table). The "no match" case (`:166-171`, keys `[]`) stays as is and now also proves
  decision 5.

`apps/dashboard/src/screens/menus-screen.test.ts`
- `toolbarAdds()` helper (`:833-836`) becomes `rootAdds()`: the table's `[data-test="actions-root"]`.
- `rowAction(el, "", …)` (`:838-861`): opens the root's ⋮ and picks `<action>-top` in the table.
- `topLevelKeys()` (`:873-876`) and the inline `order()` in the keyboard-reorder case (`:2397`):
  `aria-level="2"`.
- `childKeys(el, "")` (`:878-886`): leaves out `"root"`.
- "keeps the current list's Add actions in its own row's ⋮ and the top level's in the toolbar's
  Add ⋮…" (`:2063-2077`): the root row's ⋮.
- "creates a section at the menu's top level from the toolbar's Add ⋮, and gives focus back to
  it" (`:2079-2104`): focus lands on the root's ⋮ inside the table.
- "draws Reorder's Done after the toolbar's Add ⋮" (`:2106-2113`): deleted.
- "draws the toolbar's plus with the same border as Reorder beside it" (`:4042-4057`): deleted.
- The Structure search block's `shownKeys` pins (`:4189`, `:4194`): `"root"` first.
- `focusedRowMenu()` (`:5213-5220`): the root row's ⋮ reads as `""`.
- The phone row-menu case (`:5530-5549`): the toolbar block goes; the root's ⋮ is in the rows loop.

`apps/dashboard/src/widgets/menu-document-tree.test.ts`
- "uses the Structure row's indentation, row height and swatch slot…" (`:182-250`): the extra
  "outer" section (comment: "Structure has no menu row") goes; the Structure keys become
  `drinks`, `drinks/beer`, `drinks/beer/mi`.

Part 2 and Task 6 change no existing check unless a task reports one.

## Task 1 — The root row: rows, keys, behaviour (decisions 1, 4, 5, 7)

Files: `apps/dashboard/src/widgets/menu-structure-table.ts`, `menu-structure-table.test.ts`,
`menu-structure-table.a11y.test.ts`, `menu-document-tree.test.ts`, `apps/dashboard/src/screens/menus-screen.test.ts`
(helpers and pins listed above that concern rows, levels and search — NOT the toolbar ones, which
are Task 3's).

The toolbar "+" stays in this task, so the branch is green at its commit.

- Types: `type RootRow = { kind: "root"; key: "root"; parentKey: null; name: string; counts: string; color: string | null }`
  beside the member `Row` (give it `kind: "member"`); the table is typed over `TableRow = RootRow | Row`.
  Export `ROOT_KEY = "root"`. The table's `rows` are `[root, ...members]` when there is at least
  one member, and `[]` for an empty menu (so the empty box still shows, `wt-data-table.ts:2530`).
  `#rowByKey` is built from member rows only.
- `#buildRows` walks with `parentKey` `ROOT_KEY` for the top level (today `null`, `:799`).
  `#moveOut`'s top-level check (`:631`) keeps working because `#rowByKey.get("root")` is undefined;
  leave a one-line comment only if the reason is not plain from the code.
- Name cell for the root: a `folder-cell` with an empty `folder-frame` (Task 2 adds the chip and
  counts), then `<strong part="root-name" data-test="root-name">${menuName}</strong>`. Not
  `menus.menu_prefix`. Kind and Available cells: nothing. Actions cell: `wt-row-actions`
  `data-test="actions-root"`, `label="Actions: <menu name>"`, holding `#adds([], "top")`.
- Table bindings: `rowCollapsible` false for the root; `rowActivation` "none"; `rowControls` →
  `gripSpace`; `rowSelectable` false; the name column's `searchValue` `""`; the Available filter's
  value `[]`; `rowToggleLabel` and `selectionLabel` handle the root without throwing (the table
  computes `rowToggleLabel` for every drawn row, `wt-data-table.ts:2652`).
- Tests first (real Chromium), each watched failing before the code:
  - the root row is the first drawn row, aria-level 1, `root-name` reads "Lunch Menu", no expand
    arrow (no `.row-activate`, no `tree-toggle`), no "Menu: Lunch Menu" anywhere; top-level members
    at aria-level 2, still starting closed;
  - its ⋮ (`actions-root`) holds exactly `new-section-top`, `include-menu-top`,
    `open-add-products-top` with the three labels, and each click sends `wt-structure-add` with
    `path: []`;
  - Collapse all, then Expand all: the root stays open and is never closed by `setExpanded("root", false)`;
  - Select mode: no `select-root` box; Select all ticks only members; `shownSelectableKeys()` has
    no `"root"`;
  - search "Lemonade": root drawn first, then the path to each match; search "zzz": no rows and the
    table's no-matches message; Available filter "no" with every product available: no rows and
    the no-matches message (root not drawn alone);
  - Reorder mode: the root draws a `grip-space`, no `drag-root`; a pointer drag of `m-burger`
    released over the root row sends no `wt-member-move` / `wt-member-move-into` and marks no gap
    or "into" on it; ArrowLeft on `drag-m-burger` sends nothing and announces nothing;
  - empty menu: no root row, the empty box with its three adds (existing case, unchanged).
  - Proof by deletion: put the root row into `#rowByKey` and watch the ArrowLeft and drop cases
    fail; restore.
- Update the row, level and search pins listed under "Changed test checks" for
  `menu-structure-table.test.ts` (not the toolbar ones), the a11y "no match" stays, the
  document-tree case, and `menus-screen.test.ts`'s `topLevelKeys`, `childKeys`, `:2397` and search
  pins. Run each touched file in full.
- Commit: "Menu Structure tab: a root row for the menu itself, holding the top-level adds (A453)".

## Task 2 — The root row's look: counts and colour (decisions 2, 3)

Files: `menu-structure-table.ts`, `menu-structure-table.test.ts`, `menu-structure-table.a11y.test.ts`,
`apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/menus-screen.ts` (pass
`.menuColor`), `menus-screen.test.ts` (one case).

- Counts: computed once per rows build from `this.nodes` (not per draw), as decision 2 says, and
  drawn as `<span part="count" data-test="count-root">` after the bold name on the same line.
  Styles copied from Products (`product-list.ts:228-253`): `margin-inline-start: var(--wt-space-2)`,
  muted, small, visually hidden when the table is `narrow` (import `visuallyHiddenStyles` from
  `@waitron/ui` as `product-list.ts:7` does).
- Colour: `@property({ attribute: false }) menuColor: string | null = null`, part of the rows memo
  inputs (`#rows`, `:754-769`). With a colour, `folderFrame(html\`<span part="swatch-box" data-test="color-root" aria-hidden="true">${swatchChip(color)}</span>\`)`;
  without, an empty `folderFrame()`.
- Host: `.menuColor=${structure.root?.color ?? null}` on `dashboard-menu-structure-table`
  (`menus-screen.ts:2373-2384`; the `?.` because some test fixtures build a structure without
  `root`).
- Tests first:
  - counts, EN and ES (restore the locale after, per testing rules): the Lunch fixture plus Wines
    included (Drinks shown twice, Lager listed in three places) reads the distinct counts; a menu of
    one section and one product reads "1 section, 1 product" / "1 sección, 1 producto"; products
    only reads "3 products"; one empty section only reads "1 section"; a menu holding only an
    include of an empty menu reads "0 products";
  - at 390px wide the count is visually hidden (zero-size clip) but present in the row's text;
  - colour: `menuColor: "#aabbcc"` paints the chip `rgb(170, 187, 204)` and it is not a button;
    `null` draws no `color-root`, and the root's name still starts where it does with a colour;
  - geometry (the A337 complaint): the root's leading frame and name start exactly one indent step
    left of the top-level rows', the same step as between level 2 and 3 — extend "starts every
    name one even step further in per level…" (`:868`), at 1280 and 390, reordering on and off;
  - a11y: one state with a coloured root and its counts, both themes;
  - host: `menus-screen.test.ts` — the mounted Lunch menu's root row shows the colour its
    structure's `root.color` holds. Then check whether saving a new colour in the menu's settings
    form refreshes the root chip without a reload; if it does not, the host reads the structure
    again after `#saveMenu` (`menus-screen.ts:1361-1389`) and a test pins it.
- Strings: `menus.section_count`, `menus.section_count_one` in EN and ES.
- Commit: "Menu Structure tab: the root row shows the menu's counts and colour (A453)".

## Task 3 — The toolbar "+" goes; focus returns to the root's ⋮ (decisions 6, 7)

Files: `menu-structure-table.ts`, `menu-structure-table.test.ts`, `menu-structure-table.a11y.test.ts`,
`menus-screen.test.ts`, `apps/dashboard/src/i18n/strings.ts`.

- Tests first:
  - no `[data-test="toolbar-adds"]` anywhere in the widget, with rows or without; the toolbar's end
    holds only what the host slots there (Reorder's Done);
  - `focusRowMenu("")` and `focusRowMenu("m-gone/m-also-gone")` focus `actions-root` inside the
    table; an empty menu still focuses `new-section-empty`;
  - host, `menus-screen.test.ts`: Add section from the root's ⋮, saved → focus is on the root's ⋮
    once the window closes and the menu is read again; the same for Include a menu and Add products
    (one case each, or one `it.each`); Cancel from each → focus on the root's ⋮; removing selected
    rows outside Select mode (`#removeSelected`, `menus-screen.ts:2667`, its focus hand-back at `:2688-2691`) → the root's ⋮.
- Code: delete the toolbar `wt-row-actions` (`:1123-1131`) and its CSS (`:126-129`);
  `focusRowMenu`'s fallback (`:745-747`) becomes the root row's ⋮ in the table's shadow root, then
  `[data-test$="-empty"]` in the widget; update its doc comment. Delete `menus.add_to_menu` in EN
  and ES (`strings.ts:2185`, `:4721`) once `grep -rn "menus.add_to_menu" apps packages` shows no
  user.
- Update every toolbar pin under "Changed test checks" (table tests, a11y state, menus-screen
  helpers and cases). `grep -rn "toolbar-adds" apps packages` must print nothing at the end.
- Commit: "Menu Structure tab: the toolbar's plus goes; the root row's ⋮ holds the adds (A453)".

## Task 4 — The Add products window keeps its buttons in view (decision 8)

Files: `apps/dashboard/src/widgets/section-add-products.ts`, a new
`apps/dashboard/src/widgets/section-add-products.window.test.ts`,
`section-add-products.a11y.test.ts`, `apps/dashboard/src/screens/menus-screen.ts`
(`#renderAddProducts`, `:3398-3448`), `menus-screen.test.ts` (one case).

- Tests first, the failing case stated before running: today the Add products button's bottom edge
  is below the window and the modal body scrolls.
  - `section-add-products.window.test.ts`: mount the widget inside `<wt-modal size="standard" open>`
    exactly as the host does (Cancel in the `cancel` slot), with 200 products, at 390×700 and at
    1280×844. Without scrolling anything: Cancel and Add products lie inside the window and inside
    the dialog's box; the modal body needs no scrolling (`scrollHeight <= clientHeight + 1`); the
    product list's own scroller does (`scrollHeight > clientHeight`). Scroll the list to its end:
    the buttons have not moved. With a host message in the `message` slot and the "none chosen"
    message showing: buttons still inside the window. With 3 products: buttons at the bottom of the
    window (standard modals keep full height).
  - `menus-screen.test.ts`: at 390×700, a menu with 200 addable products, open Add products from
    the root row's ⋮ (`open-add-products-top`): Cancel and Add products are inside the window
    without scrolling. Tick two, add: the request is sent and focus returns to the root's ⋮.
  - a11y: the window state at 390×700 with 200 products and with the message, both themes.
- Code: the widget becomes a column filling its container's height (`:host { display: flex;
  flex-direction: column; height: 100%; min-height: 0 }`); filters and the "Select all listed" row
  do not shrink; the list (a wrapper around the `ul` and the notices inside the fieldset) is the
  only scroller (`flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain`); a bottom
  block (`slot name="message"`, the none-chosen error, the count, `wt-form-actions`) does not
  shrink and draws `border-top: 1px solid var(--wt-color-border)` with `padding-top:
  var(--wt-space-3)`. Standalone (no bounded parent) the widget lays out as today, so its other
  tests are untouched. Update the widget's doc comment to name the `message` slot.
- Host: the refusal paragraph gets `slot="message"` and moves inside `<dashboard-section-add-products>`;
  nothing else in the host changes.
- Run `section-add-products.test.ts`, `.save-state.test.ts`, `.a11y.test.ts`,
  `menu-selections.unsaved.test.ts` and `menus-screen.test.ts` in full.
- Commit: "Add products window: the list scrolls and its buttons stay in view (A453)".

## Task 5 — The other list windows: proof, no change expected (decision 8)

Files: `apps/dashboard/src/widgets/home-shortcut-picker.test.ts` (or the menus-screen Home page
cases, wherever the add-shortcut window is mounted in a modal), `apps/dashboard/src/widgets/add-to-menus.test.ts`.

- Home page add-shortcut window: at 390×700, in its compact modal, with 200 options and 50 chosen,
  Add and Cancel lie inside the window without scrolling. State the failing case first (Add's
  bottom edge beyond 700). If it fails, move the window's `wt-form-actions` into the modal's
  footer as Task 4's decision allows and list the change.
- Add to menus: at 390×700 with 12 menus of 10 sections each, Add to menus and Skip lie inside the
  window, and stay put when the body is scrolled to its end (it uses the footer slot already, so
  this guards against a regression rather than driving a change).
- Move to section…: its body is one combobox, footer-slotted; no new check (name it in the report).
- Commit (only if a test was added): "Add-shortcut and Add to menus windows: checks that their
  buttons stay in view (A453)".

## Task 6 — `wt-dialog` keeps its footer in view (decision 8; FULL review path)

Files: `packages/ui/src/components/wt-dialog.ts`, `wt-dialog.test.ts`, `wt-dialog.a11y.test.ts`,
`wt-modal.ts`, `wt-modal.test.ts` (run; change only if a fold-in needs it).

- Tests first, failing case stated: at 390×700, a `wt-dialog` with a 1800px body and
  `wt-form-actions` in its footer draws Save below the window (the measurement above).
  - "scrolls a long body while the footer stays visible and stationary" (mirror
    `wt-modal.test.ts:455`): Save and Cancel inside the window; the body scrolls; scrolling it to
    its end leaves the buttons where they were; the dialog element itself does not scroll.
  - A short dialog is unchanged: its height still fits its content (compare with a heading and one
    line before and after the change — record the numbers).
  - A body message from footer actions (`formMessage`) is still scrolled into view inside the
    scrolling body when it changes (the existing "brings the message…" cases, run).
  - Token painting in a long dialog: the footer's divider reads `--wt-color-border`, the surface
    `--wt-color-surface-raised` (extend the existing paint cases, `wt-dialog.test.ts:181-208`,
    `:343-372`).
  - a11y (`wt-dialog.a11y.test.ts`): "open, with a body taller than the window", with focusable
    content and with text only, both themes. If axe flags the text-only scroller
    (`scrollable-region-focusable`), make the body focusable only while it overflows and test that
    a short dialog gains no extra tab stop.
- Code: `dialog[open] { display: flex; flex-direction: column; overflow: hidden }`; `.body {
  min-height: 0; overflow: auto; overscroll-behavior: contain }` (it does not grow, so short
  dialogs keep their height); `.footer { flex-shrink: 0 }`. The native modal dialog's own
  max-height bounds it; if the long-body test shows otherwise, set `max-height: calc(100dvh - 2 *
  var(--wt-space-5))` as `wt-modal` does. Remove from `wt-modal.ts` the rules that are now
  inherited (`dialog[open]` flex, `.footer` flex-shrink, `overflow: hidden`), keeping its own
  height, width and `.body { flex: 1 }`.
- Consumers: grep `<wt-dialog` in `apps` and `packages`; run the test files of the ones that hold
  lists or measure dialog geometry (at least `apps/dashboard/src/widgets/order-detail-dialog.test.ts`,
  `allergen-picker.test.ts`, `packages/ui/src/components/wt-data-table.test.ts`'s Customise cases,
  and `grep -ln "scrollHeight\|scrollTop" apps/till/src apps/dashboard/src` files that open a
  `wt-dialog`). `packages/ui/src/no-hardcoded-chrome.test.ts` and `scripts/style-token-names.test.ts`
  from the root. CI runs the rest.
- Commit: "wt-dialog: a long dialog scrolls its body and keeps its footer in view (A453)".

## Task 7 — Documentation and backlog

- `docs/developers/design-system.md`:
  - `:661-665` (empty box paragraph): the Structure tab now has a root row like Products' All
    products, whose ⋮ holds the top-level adds; an empty menu's box repeats them as buttons.
  - `:916-922` (the second tree): replace "draws no row for the menu itself … behind a plus button,
    'Add to this menu'" with the root row (bold name, counts, the menu's colour chip when it has
    one, the ⋮ with the three adds, not collapsible, not selectable, not a drop target); keep the
    A337 history to one dated pointer.
  - `:1025-1027` (focus return): "at the top level, to the root row's ⋮".
  - `:1465` (icon buttons without tooltips): drop the "Add to this menu" button clause.
  - `:3303-3305` (tabs whose list is a tree): "in its root row's ⋮".
  - `wt-dialog` row `:553` and the `wt-modal` paragraph `:1288-1289`: a long dialog's body scrolls
    and its footer stays in view, for both (only if Task 6 landed).
  - Beside the `wt-modal` footer rule (`:1289-1297`): one sentence — a window whose body is one
    long list (a section's Add products) scrolls the list and keeps its filters on top and its count
    and buttons at the bottom.
- `docs/backlog.md` and `docs/backlog/*.md`: no entry names A453, the toolbar "+" or pinned window
  buttons (grep `A453`, `toolbar`, `Add to this menu`, `pinned`, `scroll` on 2026-10-10 found
  none), so delete nothing. Add short entries only for points this branch leaves open: the
  root-key collision residual (decision 1) if the reviewer wants it tracked, and any `wt-dialog`
  consumer whose look Task 6 changed and the LOOK did not cover.
- `grep -rn "toolbar's Add\|Add to this menu\|no row for the menu" docs/developers apps packages`
  prints nothing outside dated specs and plans.
- Commit: "Docs: the Structure tab's root row and windows that keep their buttons in view (A453)".

## Task 8 — LOOK (the runner, with the dev stack)

Screenshots in `~/waitron-campaign-b/a453-shots/`, each EN and ES, light and dark, 1280 and 390 wide
(16 per row of this list unless it says otherwise):

1. Structure tab of a populated menu with a colour: root row, top-level rows closed.
2. The same with one section open and the root's ⋮ open.
3. A menu with no colour (the root's empty frame).
4. Reorder mode on (grip space on the root), and Select mode on (no box on the root) — EN light
   only, both widths.
5. A search with a match, and one with none (the no-matches box) — EN light only, both widths.
6. An empty menu (the box with three adds) — EN light only, both widths.
7. The Add products window with 200 products, unscrolled and with the list scrolled to its end,
   and with the refusal message showing; 390×700 and 1280×844.
8. (Task 6) Products' Customise columns at 390×700; an order's detail with 30 lines at 390×700;
   the allergen picker at 390×500 — EN light and dark. Plus one short `wt-dialog` (a delete
   confirm) to show it unchanged.

Compare 1 with the Products tree's All products row side by side and say in the PR how the two
match and where they differ (colour button vs chip; filter behaviour).

## Review focus

- Every member key, test id and host path is unchanged; only top-level `parentKey` moved.
- The root is in the table's rows but never in `#rowByKey`; no drag, keyboard move, selection or
  Select all path can act on it (each has a test, and the ArrowLeft / drop proofs by deletion).
- The no-matches box still appears for a search and for a filter that match nothing.
- Counts are distinct and include included menus' contents, in both languages, singular and plural.
- No "Menu: <name>" wording and a full indent step between the root and the top level.
- `grep -rn "toolbar-adds\|menus.add_to_menu"` prints nothing.
- The Add products window's buttons are in view at 390×700 with 200 products, with the message
  showing, and the widget's standalone layout is unchanged.
- (Task 6) Short `wt-dialog`s are unchanged in height and tab order; long ones scroll their body;
  `wt-modal` behaves as before (its suite passes unchanged).
- Every changed or deleted test check is listed with its reason.
