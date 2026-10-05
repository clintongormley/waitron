# Menu Structure as one navigable tree (W88) — implementation plan

> **For agentic workers:** implement each task test-first: write the failing test, run it and watch
> it fail for the reason you expect, then write the least code that passes. Use
> `superpowers:subagent-driven-development`. The branch touches no risk trigger (no fiscal
> invariant, migration, permission, concurrency or cross-package contract), so it takes the light
> review path: no per-task reviewer, then `/finish-branch`.

**Goal.** On a menu's Structure tab, replace the two-panel editor (the "What is on this menu"
outline beside the "editable version" list) with one full-width tree table that looks and behaves
like the Products tree; move the add actions into row menus; and replace the "All menus" back button
with a "Menus › <menu>" breadcrumb, with "Unpublished changes" as a link to Preview.

**Spec.** The owner's queue item W88, quoted in full in Appendix A, with the lane rules that bind it.
The most important rule: **an existing test assertion that has to change is a STOP for the owner.**
Task 0 asks before any such edit is made.

**Architecture.** A new widget, `dashboard-menu-structure-table`, draws the menu as a
`wt-data-table` in tree mode (`rowParent`), keyed by each row's path of member ids, in menu order
(no sort column). The first row is the menu itself, "Menu: <name>", like Products' "All products".
Each row carries its own ⋮ menu: the root and every section the menu owns offer New section here,
Include a menu and Add products for exactly that list; owned rows also carry a grip for keyboard and
pointer reordering among their siblings. Rows inside an included menu are drawn read-only. The
widget only reports what the person asked for, as events naming the list's path; the screen keeps
every write, its queue, refusal handling and dialogs, and now takes the target list from the event
rather than from "the list being edited". The server does not change: every call the tree needs
already exists (`getMenuStructure`, `createSectionIn`, `addSectionMember`, `addSectionProducts`,
`removeSectionMember`, `moveSectionMember`, `updateSection`, `deleteSection` —
`apps/dashboard/src/api/client.ts:1778`, `:2105`–`:2137`).

**Files.**

| Action | File | Why |
| --- | --- | --- |
| Create | `apps/dashboard/src/widgets/menu-structure-table.ts` | The new tree widget |
| Create | `apps/dashboard/src/widgets/menu-structure-table.test.ts`, `menu-structure-table.a11y.test.ts` | Its behaviour and accessibility, both themes |
| Modify | `apps/dashboard/src/screens/menus-screen.ts` | Heading area, Structure tab, targets taken from events, focus return |
| Modify | `apps/dashboard/src/screens/menus-screen.test.ts`, `menus-screen.a11y.test.ts` | New cases; the existing edits only as the owner approves in Task 0 |
| Modify | `apps/dashboard/src/i18n/strings.ts` | One string added, three retired (below) |
| Modify | `docs/developers/design-system.md`, `docs/backlog.md` | The item requires both |
| Not touched | `member-list-editor.ts`, `menu-structure-tree.ts`, `wt-data-table.ts`, `reorder-table.ts`, any server code | See "Why these stay" |

**Why these stay.** `dashboard-member-list-editor` stays because the Home page tab's layout editor
uses it (`apps/dashboard/src/widgets/home-layout-editor.ts:345`–`366`). `dashboard-menu-structure-tree`
stays because the Preview tab draws the publishable menu with it, read-only
(`apps/dashboard/src/widgets/menu-preview.ts:532`–`537`). Both keep their own tests unedited. Their
menu-editing branches become unused by product code (member-list-editor's section Open/Edit/Delete
and included-menu actions, `member-list-editor.ts:389`–`404`; the outline's edit buttons and
`current`, `menu-structure-tree.ts:96`–`97`, `:121`–`126`, `:175`–`187`). Pruning them would delete
assertions in `member-list-editor.test.ts` and `menu-structure-tree.test.ts`, so this branch records
them in the backlog instead (Open question 8). `wt-data-table` already has everything the tree needs
(below), so `packages/ui` is untouched.

---

## How the code is today (pointers the tasks rely on)

**The editor view.** `#renderEditor` (`menus-screen.ts:2426`–`2458`) draws a ghost "All menus"
button with `data-test="back"` (`:2428`–`2432`, string `menus.back`), the menu name as `h1`
(`:2433`), the state line (`#renderStatusLine`, `:2261`–`2268`, text from `statusLine`, `:81`–`86`,
e.g. "Unpublished changes · Live: version 2 · 10:15"), then the tabs. While the Structure tab is
shown, the tabs' `actions` slot holds three buttons, `new-section`, `include-menu`,
`open-add-products` (`#renderListActions`, `:1949`–`1980`, rendered at `:2450`), each acting on the
list being edited through `#here()` (`:737`–`744`).

**The Structure tab.** `#renderStructure` (`:1982`–`2021`) draws the "Included in" notice
(`data-test="included-by"`, `:2004`), then a two-column grid (`.structure`, CSS `:260`–`268`): the
outline `dashboard-menu-structure-tree` under the heading `menus.tree_heading` "What is on this menu"
(`:2006`–`2018`), and `#renderListEditor` (`:1902`–`1947`): an in-panel breadcrumb
(`#renderBreadcrumb`, `:1878`–`1900`, `data-test="breadcrumb"`, crumbs `crumb-<n>`), an `h2` with the
list's name, the note `sections.members_saved_note`, and `dashboard-member-list-editor` for the list
being edited, with its own bottom "Add a product" picker (`member-list-editor.ts:486`–`516`).

**"The list being edited".** `path` (`menus-screen.ts:438`) is the member ids from the menu's top
level to that list; it is not in the address (`#open` and `#backToList` write only `dashboard`,
`menu` and `view`, `:986`–`995`). `#resolvePath` (`:668`–`681`) derives `#trail`, `#listId`,
`#listMembers` and `#inSection` from it. The outline asks to open a list with `wt-structure-edit`
(`:2013`–`2016`), the list editor with `wt-member-open` (`:1941`–`1944`, `#openSection`,
`:1214`–`1219`); both land in `#edit` (`:1221`–`1224`), which also clears the refusal line.

**Writes.** `#listWrite` (`:1147`–`1164`) and `#move` (`:1167`–`1212`) target `#here()`. Moves go
through `ListWriteQueue.move` and reconcile the answer with `placesOf`/`withOrder`
(`:156`–`206`); adds and removes hold `busy`. `#saveSection` (`:1232`–`1255`), `#includeMenu`
(`:1274`–`1294`) and `#addProducts` (`:1296`–`1316`) take their window's own `ListTarget`
(`:61`–`66`), set when the window opened. A window whose path no longer leads to its list is closed
with `menus.list_gone` (`#closeLostList`, `:694`–`705`); a write saved to a list that left says
`menus.list_gone_saved` (`:709`–`712`); a refusal about a list other than the one being edited is
named, `menus.change_not_saved` (`#reportRefusedElsewhere`, `:717`–`723`). The add-products picker is
told what its list already holds only when its list is the one being edited
(`.inSection=${target.listId === this.#listId ? this.#inSection : []}`, `:2403`).

**W87's link.** On the Menus list, `#changesCell` (`:1558`–`1569`) draws "Unpublished changes"
(`menus.changes_link`) as `<a href="/manage/menus/menu/<id>/view/preview">` for a menu whose state is
`changed`; `#openPreview` (`:1572`–`1577`) leaves a click with a modifier key or a non-primary button
to the browser and otherwise opens the Preview tab in place. Its style is
`wt-data-table::part(changes-link)` (`:368`–`377`), colour `--wt-color-primary-text`.

**The Products tree to match** (`apps/dashboard/src/widgets/product-list.ts`). Rows are a union with
a root row (`:39`, `ROOT_KEY = "root"` at `:31`, built at `:659`), drawn as a folder icon and bold
"All products" with a count (`:1027`–`1033`), whose ⋮ (`data-test="actions-root"`) holds the adds
(`:1034`–`1040`, `#addItems` `:991`–`1009`). Categories carry a grip button (`part="drag-grip"`,
`:1046`–`1052`) before their folder icon; a row that cannot be dragged keeps the grip's width with
`part="grip-space"` (`:162`–`166`; the draft row uses it at `:1023`; the root row draws neither,
`:1029`–`1033`) (2026-10-05: true at the plan's base, 4696d803d; W84 (#1199) later gave Products'
root row `grip-space`, and W88 gave the Menus root the same — see W88's commit "Menus Structure
tree: names line up at every level, as in the Products tree".)
The ⋮ column is keyed `actions`, `pinned: "end"`
(`:946`–`951`). The table is configured at `:1187`–`1258`: `initiallyCollapsed`, `rowCollapsible`
refusing the root (`:1229`), `rowActivation` "toggle" for categories (`:1232`–`1237`),
`rowToggleLabel` (`:1238`–`1244`), Expand all (`:1214`–`1215`). Its pointer drag (`:294`–`534`) marks
the dragged row `part="dragging"`, draws a floating `.drag-ghost` and a dashed gap
(`drop-gap-before`/`drop-gap-after`, `:106`–`119`), using `holdPageCursor`, `releasePageCursor` and
`pointerElementsAt` from `packages/ui/src/reorder-table.ts:23`–`55`; Escape cancels (`:374`–`380`)
and the click a released drag sends is swallowed (`:384`–`390`). `focusRowMenu` (`:1175`–`1182`)
puts focus back on a row's ⋮, which the catalogue screen does when an add's window closes
(`catalogue-screen.ts:518`–`522`).

**`wt-data-table` in tree mode** (`packages/ui/src/components/wt-data-table.ts`): `rowParent` (`:604`),
`rowCollapsible` (`:610`), `rowActivation` (`:622`), `rowToggleLabel` (`:631`),
`initiallyCollapsed` (`:634`, seeded once per branch, `:840`–`858`), `setExpanded` (`:1576`–`1580`),
`revealRow` (`:1588`–`1605`), and `wt-expand-change` for a person's toggle (`:1558`–`1568`). With no
column `sortValue` and no `rowGroup`, siblings keep the order given (`#sortByColumn`, `:1354`), which
is what menu order needs. Rows render in the table's own shadow root with `data-row-key`,
`aria-level` and `aria-expanded` (`:2144`–`2170`), unkeyed (`entries.map`, `:2144`), so after a
reorder the same DOM button can belong to a different row.

**Why the existing reorder controller cannot be reused here.** `ReorderController` reads rows from
its host's own shadow root (`#rows()`, `reorder-table.ts:343`; `#rowAt`, `:397`), assumes the i-th
`<tr>` of one `<tbody>` is the i-th item (`:405`), and refocuses inside its host's shadow root
(`:205`). In the tree the rows live in `wt-data-table`'s shadow root and a section's descendants sit
between it and its next sibling. The tree therefore takes Products' pointer pattern, restricted to
siblings, and its own keyboard handling (Task 2).

---

## Existing assertions affected

All line numbers are the worktree's, at `main` 4696d803d. (`origin/main` has since moved two commits,
touching only `product-list.ts` — pointers after its line 766 shift by −1 — and
`docs/developers/design-system.md` — pointers after its line 1024 shift by +2. No test file moved.)
The lists below were made by scanning every `expect` statement and every line that reaches the old
outline, the old list editor, the in-panel breadcrumb or the three tab buttons, then reading each
hit; every hit is listed.

Verdicts:

- **KEEP** — the test is not edited.
- **HELPER** — the test body is not edited; it passes because a shared helper it calls is changed
  (helpers are listed first, with the `expect` lines inside them).
- **DRIVER** — only lines that reach a control or fire an event change (for example
  `click(el, "open-add-products")` becomes `rowAction(el, "m-drinks", "open-add-products")`, or
  `emit(memberList(el), "wt-member-move", { memberId, to })` becomes
  `emit(structure(el), "wt-member-move", { path: [], memberId, to })`). Every `expect` line is
  unchanged.
- **RETARGET** — at least one `expect` now reads the same fact from the new tree, with the expected
  value unchanged (for example `topLevel(el).map((item) => item.dataset.path)` becomes
  `topLevelKeys(el)`, still `toEqual(["m-drinks", "m-burger", "m-fav"])`).
- **REPLACE** — an expected value changes, or an assertion is deleted, because it pins UI the spec
  removes.

Under THE RULE every row other than KEEP is an edit, and so a STOP. The verdicts let the owner
approve by category (Task 0). Nothing below is added to an existing case: every new check in Tasks
3 and 4 is a new case.

### Shared helpers in `apps/dashboard/src/screens/menus-screen.test.ts`

| Lines | Helper | Lines that change, and how | `expect` inside |
| --- | --- | --- | --- |
| 573–578 | `mountLunch` (71 call sites) | 575 waits for `structure(el)` instead of `tree(el)`; 576 awaits its `updateComplete` | 575 RETARGET |
| 646–648 | `tree` | 647 → `structure(el)` returns `dashboard-menu-structure-table` | — |
| 650–652 | `inTree` | 651 → `inStructure`, searching the table's shadow root | — |
| 654–658 | `clickInTree` | 655–656 → `clickInStructure` | — |
| 660–665 | `topLevel` | 662–664 → `topLevelKeys(el)`, the keys of rows at `aria-level="2"` | — |
| 667–669 | `memberList` | removed; `childKeys(el, key)` lists a row's children's keys in order | — |
| 675–677 | `breadcrumb` | → `currentPlace(el)`: the menu name, then the names down to the row marked current, joined " › " | — |
| 679–683 | `editDrinks` | 681 opens Drinks by its row's toggle | 682 RETARGET (`currentPlace(el)` "Lunch Menu › Drinks") |
| 685–703 | `takeDrinksOff` | — | 702 RETARGET (`currentPlace(el)` "Lunch Menu") |
| 2831–2837 | `visit` | — | 2835 RETARGET (waits for `structure(el)`) |
| 3046–3066 | `refuseAddWhileDinnerReads` | 3053 → Add products from Drinks' ⋮ | — |
| 5275–5286 | name-forms table, `new-section` entry | 5283 `currentPlace`; 5284 → New section here from Drinks' ⋮ | — |
| 5301–5303 | `opened` | — | 5303 RETARGET (waits for `structure(el)`) |
| 5700–5711 | `openInclude` | 5701 → Include a menu from the current row's ⋮ (the root, or Drinks after `editDrinks`) | — |
| new | `rowAction(el, key, action)` | opens `actions-<key>`, clicks `<action>-<key>` | — |
| new | `afterDialogCloses` use | focus tests wait as `afterDialogCloses` (803–807) does | — |

### Test cases in `menus-screen.test.ts`

| Case | Verdict | Lines that change, and how |
| --- | --- | --- |
| **1770** shows the root's members, expanding Drinks shows them inline | RETARGET | 1773 and 1778 read names and text from the table instead of the outline; 1775 opens Drinks by its row. `expect` 1774 `["Burger","Drinks","Favourites"]`, 1776 and 1780 keep their values, because the root row's name carries `data-test="root-name"`, not `"name"` (Task 1) |
| **1783** edits the menu's own top level first | RETARGET + **REPLACE** | 1785 `currentPlace` "Lunch Menu"; 1786 ids via `childKeys(el,"root")`, same values; **1791 deleted**: `members.map(position)` `[0,1,2]` reads an input of the removed list editor |
| **1796** edits a section in place, showing the path as a text breadcrumb | **REPLACE** | **1808–1810** (the in-panel `NAV`, `aria-current="location"` "Beer") and **1816–1819** (`crumb-1`, `crumb-0` and their two `expect`s) pin the removed in-panel breadcrumb; 1799, 1806, 1807, 1813 RETARGET; 1804, 1812 DRIVER. Becomes: open Drinks, then Beer, by their rows; `currentPlace` "Lunch Menu › Drinks › Beer"; Beer's name `aria-current="true"`; `childKeys(el,"m-drinks/m-beer")` `["m-drinks/m-beer/m-lager-2"]`; closing Beer makes Drinks current, closing Drinks makes the top level current |
| **1822** keeps the current list's Add actions beside the Structure tab | **REPLACE** | **1826–1832**: the three buttons in the tabs' `actions` slot, which the spec removes. Becomes: the root's ⋮ and Drinks' ⋮ each hold `new-section-<key>`, `include-menu-<key>`, `open-add-products-<key>`, and the tabs' `actions` slot holds none |
| 1835 new-section form refusal | DRIVER | 1841 |
| 1852 creates a section… | DRIVER + RETARGET | 1856; 1881 `currentPlace` |
| 1884 new-section closed when its list leaves | DRIVER | 1889 |
| 1903 new-section kept while out | DRIVER | 1909 |
| 1937 created section saved after its list left | DRIVER | 1943 |
| 1965 no message when the person opens another list | DRIVER + RETARGET | 1970; 1975 `crumb-0` → close Drinks; 1976 `currentPlace` "Lunch Menu" |
| **1984** names the list a removal takes a member out of… | **REPLACE** | **1988, 1990** read the removed editor's `listName` → Burger's ⋮ reads "Remove from Lunch Menu", Lemonade's "Remove from Drinks"; **1994** `[Open section, Edit, Delete]` → Beer's ⋮ `[New section here, Include a menu, Add products, Edit, Delete]`; 1987, 1991–1992, 1995 DRIVER; 1997, 1999 KEEP |
| 2002 edits section details and deletes… | DRIVER | 2019, 2056: `wt-member-edit`/`wt-member-delete` from the table (`edit-m-drinks`, `delete-m-drinks`) |
| **2066** adds a product or section chosen in the list | **REPLACE (delete)** | 2070 drives the bottom "Add a product" picker, which the spec removes, through `wt-member-add`, which no longer exists. Product adds stay covered by 2645 onwards |
| 2080 ArrowUp/ArrowDown reorder, focus stays | RETARGET | 2083, 2085, 2087, 2090–2091, 2107 reach the grip `drag-m-burger` and rows in the table; `expect` 2096 and 2113 via `topLevelKeys`, 2104 and 2121 row order, 2105 and 2122 `activeElement` in the table's shadow root — values unchanged |
| 2126 last of several queued moves | DRIVER + RETARGET | 2129–2130 gain `path: []`; 2133 |
| 2142 different members' moves | DRIVER + RETARGET | 2145–2146; 2149 |
| 2159 another change lands while a move is out | DRIVER + RETARGET | 2167; 2187, 2200, 2203 |
| 2210 another item moved past | DRIVER + RETARGET | 2215; 2235, 2249 |
| 2256 a read already showing the order | DRIVER + RETARGET | 2261; 2281, 2295 |
| 2302 earlier move's update lands | DRIVER + RETARGET | 2318–2319; 2339, 2351 |
| 2361 earlier finished batch | DRIVER + RETARGET | 2365–2366, 2376; 2368, 2396, 2410 |
| 2417 move after a refusal | DRIVER + RETARGET | 2442–2443, 2456; 2448, 2475, 2489 |
| 2496 answer after leaving the menu | DRIVER | 2500 |
| 2514 move sent while no menu shown | DRIVER + RETARGET | 2524–2525; 2535 |
| 2545 a move reorders the owned section… | DRIVER + RETARGET | 2575 gains `path: ["m-drinks"]`; 2584 opens Favourites by its row; 2585–2588 `inside` → `childKeys`; `expect` 2577, 2589, 2594 keep their values (`"m-drinks/m-lager"` …) |
| 2598 answer names unknown members | DRIVER | 2611 |
| 2615 refused move drops the queue | DRIVER | 2624, 2625, 2635 |
| 2645 adds products to a section | DRIVER | 2649 |
| 2680 refused product add | DRIVER | 2686 |
| 2697 picker closed when its section leaves | DRIVER + RETARGET | 2702; 2721 |
| 2739 picker kept while out | DRIVER | 2745 |
| 2773 add saved after section left | DRIVER | 2779 |
| 2795 picker hides nothing after loss | DRIVER | 2801 |
| 2814 one add while out | DRIVER | 2819 |
| 2841 windows close on navigation | DRIVER | 2843, 2851 (root's ⋮) |
| 2858 picker kept across menus | DRIVER | 2884 |
| 2903 refused picker on another menu | DRIVER | 2908 |
| 2927 refused new section after Back | DRIVER + RETARGET | 2931; 2949 |
| **2955** list named on the menus list after Back | **REPLACE** | **2960** drives the removed `wt-member-add`. Becomes: Lemonade's "Remove from Drinks" (after `editDrinks`), with `removeSectionMember` held and then refusing `menu_section.not_found`. So 2956–2957 (the held `addSectionMember`), **2961** (`expect(client.addSectionMember).toHaveBeenCalledOnce()` → `removeSectionMember`), 2964 (the rejection) and **2965–2971** (the message's reason becomes `menu_section.not_found`'s; still names Drinks) change |
| 2974 move refused after Back | DRIVER | 2978 |
| **2992** list named after going up to the top level | **REPLACE** + RETARGET | **2997** drives `wt-member-add` → the same refused removal as 2955: 2993–2994 (the held mock), **2998** (`addSectionMember` → `removeSectionMember`), 3001 and **3002–3008** (the reason) change; 2999 `crumb-0` → close Drinks; 3000 `currentPlace` (RETARGET) |
| 3011 move refused after going up | DRIVER + RETARGET | 3016 gains `path`; 3018 close Drinks; 3019 `currentPlace` |
| 3030 refused move unnamed while still there | DRIVER + RETARGET | 3035; 3041 |
| 3074 refused picker while the other structure is read | HELPER + RETARGET | helper 3053; 3094 |
| 3100 refused picker when the other structure fails | HELPER | helper 3053 only |
| 3106 new section created while elsewhere | DRIVER | 3110 |
| 3131 picker retried after coming back | DRIVER | 3136 |
| 3180 add saved while structure unreadable | DRIVER + RETARGET | 3184; 3201 |
| **3206** a refused change beside the list | **REPLACE** | **3211** drives `wt-member-add` → Burger's "Remove from Lunch Menu" refused: 3207–3209 (the mock moves to `removeSectionMember`, `menu_section.not_found`) and **3212–3216** (the message becomes that code's instead of `menu_section.member_cycle`'s). 3217 KEEP. A refused inclusion stays in its own window, as 5814 already checks |
| 3220 saved but reload failed | DRIVER | 3224 gains `path: []` |
| 3230 structure retry | RETARGET | 3236 |
| 3680 offer window closed by Back | DRIVER + RETARGET | 3694 opens Drinks by its row; 3695 `currentPlace` |
| 5468, 5506, 5590, 5605, 5633 new section with names; include-menu field | DRIVER | 5480, 5524, 5593, 5609, 5635 (root's ⋮) |
| 5713, 5726 (×2), 5763, 5773 (×2), 5800, 5814 inclusion target and validation | HELPER | `editDrinks`, `openInclude`, `takeDrinksOff`, `visit` |
| the `new-section` row of 5325, 5333, 5358, 5378, 5401, 5416 (name forms) | HELPER | the table entry and `opened` |
| 6064 structure back after an outage | RETARGET | 6077 |
| 761, 3288, 3308, 3340, 3698, 3827, 3954, 3976, 4017, 4113, 4138, 4175, 4233, 4267, 4365, 4379, 4549, 5649, 5901, 6098 | KEEP | they use `back`, `menu-status` or `included-by`, kept with the same text and behaviour. `click(el, "back")` (761, 2502, 2527, 2936, 2962, 2980, 3343, 4130, 4169, 4370, 4384, 4394, 5933) works on the new `<a>` only because its plain-click handler calls `preventDefault` (Task 3) |
| 4454, 4496, 4580, 4636, 4894 | KEEP | Preview's outline and Home's member list, both unchanged |

The 19 `menu-status` assertions (3960–6111) are KEEP: "Unpublished changes" becomes a link inside
the same paragraph, and the test's `text()` collapses whitespace, so the text read is unchanged.

### `apps/dashboard/src/screens/menus-screen.a11y.test.ts`

| Lines | Case | Verdict | Lines that change |
| --- | --- | --- | --- |
| 242–249 | helper `editDrinks` | helper | 243 opens Drinks by its row; 246 waits for Drinks to be the current row instead of `#list-heading` |
| 272 | Structure tab, ×3 states | KEEP | now checks the new tree (and, after Task 3, one heading landmark — see Task 3) |
| 279 | expanded owned section being edited | RETARGET | 281 and the clicks after it → Drinks' row; 285 waits for the current row. `expectNoA11yViolations` unchanged |
| 291 | include-menu picker | DRIVER | 294 |
| 299 (×2) | new-section form | DRIVER | 304 |
| 428 | add-products picker | DRIVER | 430, 433 |
| 333 | Preview tab | KEEP | 344 is Preview's own outline |

### Widget suites

`menu-structure-tree.test.ts`, `menu-structure-tree.a11y.test.ts`, `member-list-editor.test.ts`,
`member-list-editor.a11y.test.ts`, `home-layout-editor*.test.ts`, `menu-preview*.test.ts`: KEEP.

### Counts

- REPLACE: 8 cases (1783, 1796, 1822, 1984, 2066, 2955, 2992, 3206), one of them (2066) deleted.
- RETARGET (and not REPLACE): 24 cases, 23 in the main file and 1 in the a11y file, plus five
  `expect` lines inside helpers (575, 682, 702, 2835, 5303).
- DRIVER only: 30 cases (26 in the main file, 4 in the a11y file).
- HELPER only: 15 cases (3100, 8 inclusion cases, 6 name-form cases).
- Everything else KEEP. No fixture grows; no golden or fiscal test is touched.

---

## Open questions (each with the default this plan is written to)

1. **Approve the test edits (Task 0).** Default asked for: approve DRIVER, HELPER and RETARGET
   wholesale, and the eight REPLACE cases as described in the table.
2. **What "opening a section" and "current-path focus" become.** Default: a section row opens and
   closes in place from a click or Enter anywhere on it, as a Products category does. The screen's
   `path` becomes "the current section": set when the person opens a section, or uses an add action
   from a row's ⋮ (that row becomes current); collapsing the current section, or one holding it,
   makes its parent current. Its name is bold and underlined with `aria-current="true"`, its
   ancestors are held open after a refresh, and a refusal is named unless it concerns the current
   list, the rule `#reportRefusedElsewhere` applies today. No "Open section" item in the ⋮ (Products
   has none either). The current section stays out of the address, as `path` is today.
3. **Pointer reordering looks like Products, not like the old list.** Default: drag by the grip (a
   finger only by the grip, as Products); the dragged row fades, a ghost follows the pointer, a dashed
   gap shows where it will land among its siblings only, and one move is sent on release; Escape
   cancels. The old list slid rows live and also sent one move on release
   (`member-list-editor.ts:302`–`318`). Keyboard reordering stays ArrowUp/ArrowDown on the grip,
   one move per press, announced, focus kept on the grip.
4. **When the heading's "Unpublished changes" is a link.** Default: only while the menu's state is
   `changed` (as W87's list), and as plain text while the Preview tab is already shown. Never
   published, published-and-current, checking and could-not-be-checked show plain text, worded as
   today.
5. **Does the breadcrumb extend to the current section** ("Menus › Lunch Menu › Drinks")? Default
   no: the spec names two crumbs, and the tree shows the place itself.
6. **The root row's words.** Default: reuse `menus.menu_prefix`, "Menu: {name}" / "Menú: {name}",
   the words included menus already use. Alternative: a new Spanish "Carta: {name}", matching the
   screen title "Cartas".
7. **How "read-only" shows inside an included menu.** Default: rows inside it have no grip (an empty
   grip-width space keeps names aligned), no ⋮, and muted text; the included menu's own row says
   "Read-only here" under its name, and its ⋮ holds "Edit <menu>" (a link to that menu's own editor)
   and "Remove from this menu". Its sections still open and close for browsing.
8. **The now-unused editing branches of the two kept widgets.** Default: leave them and their tests,
   record a backlog entry; pruning them deletes assertions, so it needs its own owner answer.
9. **Products' extras.** Default: Expand all / Collapse all in the toolbar (Products' strings),
   folder icons for sections and included menus, and the product thumbnail or placeholder as Products
   draws it. No item counts on the root row.
10. **Dark-theme contrast of the heading link.** W87 measured the link blue at 3.57:1 on a
    highlighted row in the dark theme (backlog, W87 entry). The heading link sits on the page
    background, not a row, and was not measured. Default: if axe fails it in the dark theme, stop
    and ask rather than change a token in this item.

---

## Task 0 — Ask the owner (no code)

Append to `/Users/clintongormley/waitron-campaign-b/questions.md` an entry headed with the time,
"W88: the Structure tab's tests have to change — may they? — needs-owner-review", containing the
"Existing assertions affected" section above (it can link this plan by path) and Open questions
1–10 with their defaults. Mark W88 parked on Task 0 in the lane queue as the runner's rules say.

Tasks 1, 2 and 3 edit no existing test, so they can proceed while the answer is awaited. Task 4
starts only after the owner answers question 1.

---

## Task 1 — The tree widget: rows, ⋮ menus, read-only included menus, current section

**Contract** (`apps/dashboard/src/widgets/menu-structure-table.ts`, element
`dashboard-menu-structure-table`):

- Properties: `nodes: MenuStructureNode[]`, `products: Product[]` (names and images), `menuName:
  string`, `current: string[]` (path of the current section; `[]` is the menu's top level), `busy:
  boolean`.
- Rows: the root, key `"root"`, parent `null`; then every node, key = its path of member ids joined
  with `/` (a top-level member's key is its member id), parent = its parent's key or `"root"`. A
  section shown in two places therefore has two rows (`m-drinks` and `m-fav/m-fav-drinks` in the test
  fixture `lunchNodes`, `menus-screen.test.ts:202`–`218`). A node inside an included menu
  (any ancestor with `includedMenuId`) is read-only.
- Table: `wt-data-table` with `rowParent`, `initiallyCollapsed`, `rowCollapsible` false for the root,
  `rowActivation` "toggle" for section rows and "none" otherwise, `rowToggleLabel` from
  `menus.expand`/`menus.collapse`, Expand all/Collapse all, `aria-label` `menus.tree_heading`,
  `noMatchesMessage=${tableNoMatches()}`, no `sortValue` anywhere. Columns: Name (`members.name`),
  Type (`members.kind`, `memberKindLabel`), Actions (`members.actions`, key `actions`,
  `pinned: "end"`).
- Name cell: on member rows, a grip button (`part="drag-grip"`, `data-test="drag-<key>"`) for owned
  rows, or `part="grip-space"` for rows inside an included menu, so names line up; the root row, like
  Products' "All products" (`product-list.ts:1029`–`1033`), draws neither (2026-10-05: true at
  the plan's base, 4696d803d; W84 (#1199) later gave Products' root row `grip-space`, and W88 gave
  the Menus root the same — see W88's commit "Menus Structure tree: names line up at every level, as
  in the Products tree".) Then a folder icon for the
  root, sections and included menus, or the product's thumbnail or placeholder (copy Products'
  parts); then the name. A member's name carries `data-test="name"` (staff name via `memberName`;
  `menus.menu_prefix` for an included menu). **The root's name carries `data-test="root-name"`, not
  `"name"`**, so a reader of member names does not pick it up (this keeps case 1770's expected values;
  see the table). The current row's name carries `aria-current="true"` and `part="current"` (bold,
  underlined). Under the included menu's name, `menus.read_only_here`
  (`data-test="read-only-<key>"`); under the root's name when the menu is empty,
  `menus.structure_empty` (`data-test="empty"`). Rows inside an included menu are muted through
  `part="read-only"` on the elements the widget draws in their cells (the name span and the Type
  span); the widget does not set parts on the `<tr>`, which `wt-data-table` owns.
- Strings: this task adds `menus.read_only_here` in both catalogues (`t()` is typed by `StringKey`,
  `strings.ts:2145`, so the typecheck needs it here).
- ⋮ (`wt-row-actions`, `align="end"`, `data-test="actions-<key>"`, label "Actions: <name>"), every
  `wt-button` `align="start"` and disabled while `busy`:
  - root and owned sections: `new-section-<key>` (`menus.new_section`), `include-menu-<key>`
    (`menus.include_menu`), `open-add-products-<key>` (`sections.add_products`); owned sections then
    a divider, `edit-<key>` (`action.edit`), `delete-<key>` (`action.delete`);
  - products in an owned list: `remove-<key>` (`members.remove_from` with the holding list's name);
  - an included menu's row: `source-<key>`, an `<a href="/manage/menus/menu/<id>/view/structure">`
    reading `menus.edit_included`, and `remove-<key>` (`menus.remove_included`);
  - rows inside an included menu: no ⋮.
- Events (bubbling, composed; the click that asked is stopped): `wt-structure-add`
  `{ action: "new-section" | "include-menu" | "add-products", path }`; `wt-member-remove`
  `{ path /* the holding list */, memberId }`; `wt-member-edit` and `wt-member-delete`
  `{ sectionId, path }`; `wt-structure-edit` `{ path }` when the person opens a section (that path)
  or closes the current one or one holding it (the closed row's parent's path), from the table's
  `wt-expand-change`.
- When `current` changes, every row on the way to it is opened with `setExpanded`.
- Collapse all (the toolbar button) closes branches without a `wt-expand-change`
  (`wt-data-table.ts:1740`). After each table update the widget therefore checks whether the
  current row is still drawn; if a closed ancestor hides it, it sends `wt-structure-edit` with the
  path of the deepest ancestor still drawn whose own branch is open, or `[]`.
- An empty section has no toggle (`wt-data-table.ts:2149`–`2151` need children), so it becomes
  current only through an add from its own ⋮.
- Method `focusRowMenu(key)`: focuses that row's ⋮, or the nearest ancestor's when the row is gone.

**Failing tests first** — `apps/dashboard/src/widgets/menu-structure-table.test.ts` (mount with
`mountWidget`; register `DASHBOARD_ICONS` from `../icons.js` so icons draw):

1. Draws "Menu: Lunch Menu" first, then Burger, Drinks, Favourites in menu order (not alphabetical:
   use a fixture whose order is not sorted), each a level deeper than the root (`aria-level`).
2. Sections start closed; a click on Drinks' row shows Lager, Beer, Lemonade under it; a second click
   hides them. Staff names only: none of "Bebidas", "Something to drink", "for guests", "COCINA".
3. Drinks shown in two places opens and closes on its own in each (`m-drinks` versus
   `m-fav/m-fav-drinks`).
4. The root's ⋮ holds New section here, Include a menu, Add products, in that order, and each sends
   `wt-structure-add` with `path: []`; Drinks' ⋮ sends `path: ["m-drinks"]`; the copy of Drinks under
   Favourites sends `["m-fav", "m-fav-drinks"]`.
5. Drinks' ⋮ also holds Edit and Delete, sending `{ sectionId: "s-drinks" }`; Lemonade's holds only
   "Remove from Drinks", sending `wt-member-remove { path: ["m-drinks"], memberId: "m-lemonade" }`.
6. Included menu: its row reads "Menu: Wines" with "Read-only here"; its ⋮ holds a link to
   `/manage/menus/menu/wine/view/structure` and "Remove from this menu"
   (`wt-member-remove { path: [], memberId: "included-wine" }`); after opening it, its sections open
   and close, but none of its rows has a grip or a ⋮, and each one's name and Type spans carry
   `part~="read-only"`.
7. `current = ["m-drinks", "m-beer"]` opens Drinks and Beer and marks only Beer's name
   `aria-current="true"`.
8. Opening Favourites sends `wt-structure-edit { path: ["m-fav"] }`; closing Drinks while
   `current = ["m-drinks", "m-beer"]` sends `{ path: [] }`; closing an unrelated section sends
   nothing. With `current = ["m-drinks", "m-beer"]`, Collapse all sends `{ path: [] }`.
9. While `busy`, every ⋮ action and grip is disabled, and a click on one sends nothing.
10. An empty menu shows the root row with "Nothing is on this menu yet." and its ⋮.
11. `focusRowMenu("m-drinks/m-beer")` focuses Beer's ⋮; for a key no longer drawn it focuses the
    parent's.
12. At a 390×844 viewport (`page.viewport`; record `window.innerWidth`), every row's ⋮ is on screen
    (`expectRowMenusOnScreen` from `@waitron/ui/src/test-helpers.js`).
13. The root row's name has `data-test="root-name"`; `[data-test="name"]` in the table reads only
    members' names.

`menu-structure-table.a11y.test.ts`, light and dark: closed tree; Drinks and the included menu open;
current row marked; a ⋮ open; busy.

**Implement** the widget to the contract, reusing `memberName`/`memberKindLabel`
(`member-list-editor.ts:21`–`35`) and Products' part names and CSS for grip, folder, thumbnail and
muted text, all through `--wt-*` tokens.

**Run** (check headroom first: `memory_pressure | grep free`):

```
pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-structure-table.test.ts src/widgets/menu-structure-table.a11y.test.ts
pnpm --filter @waitron/dashboard typecheck
pnpm exec eslint apps/dashboard/src/widgets/menu-structure-table.ts apps/dashboard/src/widgets/menu-structure-table.test.ts apps/dashboard/src/widgets/menu-structure-table.a11y.test.ts
pnpm exec prettier --check apps/dashboard/src/widgets/menu-structure-table*.ts
```

Read the `Tests` count in the output; a run with no count is not a pass.

---

## Task 2 — Reordering in the tree (keyboard and pointer)

**Contract additions.** The grip sends `wt-member-move { path /* the holding list */, memberId, to }`.
The widget shows a move at once by keeping a per-list order overlay, cleared when `nodes` changes
(the same rule `member-list-editor.ts:224`–`225` follows), so a second key press works from the order
on screen. Grips are disabled while `busy`, as today (`reorder-table.ts` handle,
`member-list-editor.ts:194`).

**Failing tests first** (same test file):

1. ArrowDown on Burger's grip sends `{ path: [], memberId: "m-burger", to: 1 }`, draws Drinks first at
   once, keeps focus on `drag-m-burger` after the table re-renders (its rows are unkeyed, so the
   widget refocuses by `data-test`), and announces `action.reordered` ("Burger moved to position 2 of
   3"); ArrowUp sends `to: 0`. ArrowUp on the first and ArrowDown on the last send nothing.
2. With Drinks open, ArrowDown on Lager (`drag-m-drinks/m-lager`) sends
   `{ path: ["m-drinks"], memberId: "m-lager", to: 1 }` and leaves the top level's order alone.
3. Moving Drinks while it is open carries its children with it.
4. Pointer: pressing Burger's grip and moving over Favourites' row marks Burger `part~="dragging"`,
   shows the ghost and a gap after Favourites' last visible row; release sends one move,
   `to: 2`; nothing is sent per row crossed.
5. Pointer over a row outside the dragged row's siblings (a child of another section, the root)
   offers no gap and a release there sends nothing.
6. Escape during a drag cancels it, sends nothing, and the following click does not toggle the row it
   ended on. `pointercancel` sends nothing.
7. A release where the drag started sends nothing.
8. A new `nodes` value drops the overlay and draws what it says.
9. No grip on the root or inside an included menu; the included menu's own row has one.
10. Siblings `m-fav` and `m-fav-drinks` (a fixture with both at one level): dragging over
    `m-fav-drinks`' child row maps to `m-fav-drinks`, not `m-fav`.

**Implement** keyboard handling on the grip button, and the pointer drag modelled on Products'
(`product-list.ts:294`–`534`) but choosing a target among the dragged row's siblings only: the row
under the pointer (`pointerElementsAt`) maps to the sibling whose key equals that row's key, or
whose key followed by `/` starts that row's key (a plain string prefix is wrong: `m-fav` is a prefix
of `m-fav-drinks`);
gap before that sibling when moving up, after its last visible descendant when moving down.

**Run** the Task 1 commands again. **Look** (method in Task 5) at a drag in progress at 1280 px in
both themes.

---

## Task 3 — The heading: "Menus › <menu>" and the Unpublished changes link

No existing assertion changes: `data-test="back"`, the `h1` text and the state line's text are kept.
The old in-panel breadcrumb (`menus-screen.ts:1881`, `data-test="breadcrumb"`, labelled
`menus.breadcrumb` "Where you are") is still drawn until Task 4, so the heading's landmark must not
share either: `breadcrumb(el)` in the test file takes the first `[data-test="breadcrumb"]`, which would
then be the heading's, and two `nav` landmarks with one name fail axe's `landmark-unique` (the
reviewer's probe, `.superpowers/sdd/w88/plan-review.md`, C1). The heading's landmark therefore has its
own test id, `menu-breadcrumb`, and its own name, a new string `menus.menu_trail`. Task 4 retires
`menus.breadcrumb` with the in-panel breadcrumb.

**Failing tests first** — new cases in `menus-screen.test.ts`:

1. The editor shows a navigation landmark (`data-test="menu-breadcrumb"`) named `menus.menu_trail`
   ("Path to this menu") holding one link,
   "Menus" (`menus.title`), `href="/manage/menus"`, `data-test="back"`, drawn underlined
   (`text-decoration-line` includes `underline`) in the colour `--wt-color-primary-text` resolves to;
   then the `h1` "Lunch Menu" on the same line at 1280 px. The page has one `h1`, and no other heading
   reads "Lunch Menu" on the Structure tab (the old list's `h2` is gone in Task 4; assert here only
   that the heading area adds none). Its name differs from every other landmark's on the page.
2. A plain click on Menus goes to the list and `/manage/menus`, and its click event is
   `defaultPrevented` (the existing `click(el, "back")` calls, 13 of them, rely on this: without it the
   anchor navigates the test page); a click with Ctrl, Meta, Shift or Alt is not prevented.
3. With Lunch `changed`, the state line's "Unpublished changes" is a link
   (`data-test="status-changes"`) to `/manage/menus/menu/menu-lunch/view/preview`, and the line still
   reads exactly "Unpublished changes · Live: version 2 · <time>"; a plain click opens the Preview tab
   and writes that address; a modified click is left to the browser. The link is drawn underlined and
   in the colour `--wt-color-primary-text` resolves to, as the Menus link is.
4. No link for `current`, `unpublished`, while checking, after the state read fails, or while the
   Preview tab is shown (Open question 4); the words are unchanged.
5. At 390 px the breadcrumb and the menu name wrap without the page scrolling sideways
   (`document.scrollingElement.scrollWidth <= innerWidth`).
6. a11y (`menus-screen.a11y.test.ts`, new case, light and dark): the editor heading with the link,
   on the Structure tab with the old in-panel breadcrumb still present (no `landmark-unique`).

**Implement** in `#renderEditor` and `#renderStatusLine`: replace the back button (`:2428`–`2432`)
with `<nav aria-label=${t("menus.menu_trail")} data-test="menu-breadcrumb"><a data-test="back" …>Menus</a><span aria-hidden="true">›</span></nav>`
followed by the `h1` outside the landmark, laid out on one wrapping line. Reuse `#openPreview` for
the state line's link and W87's link styling. Delete the `.back` style (`:257`–`259`). Retire
`menus.back` from both catalogues (only `menus-screen.ts:2430` reads it; no test does); add
`menus.menu_trail`. The Menus link's plain-click handler calls `preventDefault`, then `#backToList`.

**Run**

```
pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts src/screens/menus-screen.a11y.test.ts
pnpm --filter @waitron/dashboard typecheck
pnpm exec eslint apps/dashboard/src/screens/menus-screen.ts apps/dashboard/src/screens/menus-screen.test.ts apps/dashboard/src/screens/menus-screen.a11y.test.ts apps/dashboard/src/i18n/strings.ts
pnpm exec prettier --check apps/dashboard/src/screens/menus-screen*.ts apps/dashboard/src/i18n/strings.ts
```

The whole of `menus-screen.test.ts` and `menus-screen.a11y.test.ts` must pass unedited at the end
of this task (the KEEP list depends on it). Run both files in full, not filtered by name.

---

## Task 4 — Put the tree on the Structure tab (only after the owner answers Task 0)

**Screen changes** (`menus-screen.ts`):

- `#renderStructure`: keep the error, loading and `included-by` parts (`:1983`–`2004`); replace the
  `.structure` grid with `<dashboard-menu-structure-table>` at full width. Remove
  `#renderListEditor`, the in-panel `#renderBreadcrumb`, `#renderListActions` and their call
  (`:2450`), the outline's import (`:24`), and the CSS for `.structure`, `.panel` and `.breadcrumb`.
- Targets: replace `#here()` with `#targetAt(path)` (menu id, path, `listIdOf(structure,
  trailOf(structure, path))`, and the list's name). `#listWrite(path, write)` and `#move(path,
  memberId, to)` take the event's path; the three add handlers open their window on
  `#targetAt(event.detail.path)` and make that path current (`#edit`). `#closeLostList`,
  `#reportSavedToLost` and `#reportRefusedElsewhere` stay as they are: the last still compares with
  the current list.
- The add-products picker's `inSection` comes from its own target's list
  (`placesOf(structure, target.listId)[0]`), so a picker opened on a list that is not current still
  hides what that list holds; when the list has gone it is `[]`, as `:2403` gives today.
- Remove `#listMembers`, `#memberProducts`, `#openSection` and the `wt-member-open`/`wt-member-add`
  handling, which nothing sends any more.
- Focus return: remember the row key a window opened from, and call the table's
  `focusRowMenu(key)` from each window's `wt-close` — the add-products and include `wt-modal`s, and
  the `wt-modal` inside `dashboard-section-details-form`, whose `wt-close` is composed — as the
  catalogue screen does (`catalogue-screen.ts:726`–`728`, `:757`–`758`). Not from Lit's update: a
  native dialog hands focus back by itself when it closes, and `wt-dialog` reports the close a task
  later (`packages/ui/src/components/wt-dialog.ts:138`–`147`), by which time the menu item it was
  opened from sits in a closed popover. A window closed because its list left (`#closeLostList`)
  returns focus to the nearest row still drawn. A removal or deletion, which opens no window or
  closes one whose row is gone, returns focus to the parent row's ⋮.
- Retire `sections.members_saved_note`, `sections.members_label` and `menus.breadcrumb` (only
  `menus-screen.ts:1907`, `:1913` and `:1881` read them; no test does).

**Failing tests first** — new cases in `menus-screen.test.ts`:

1. Target identity: Add products from the Drinks row under Favourites (`m-fav/m-fav-drinks`) sends
   `addSectionProducts("s-drinks", …)`; from Favourites, `"s-fav"`; from the root, `"root-lunch"`;
   New section here and Include a menu likewise (`createSectionIn`, `addSectionMember`).
2. Using an add from a row's ⋮ makes it current; a refusal on that list is unnamed, a refused move in
   another list is named "Your change to <list> was not saved. …".
3. A new case (the existing 2545 is not extended): a move inside Drinks sends
   `moveSectionMember("s-drinks", …)` and the answer reorders both places Drinks appears without
   reading the menu again.
4. An included menu: its contents open for browsing; its rows offer no ⋮ or grip; "Remove from this
   menu" sends `removeSectionMember("root-lunch", "<its member id>")` and nothing touches the included
   menu's own sections; the "Edit Wines" link points at that menu's Structure tab; a refused inclusion
   (`menu_section.member_cycle`) stays in the include window (as 5814).
5. Focus: after New section here is cancelled, saved or refused-then-cancelled, and after Add products
   and Include a menu close, focus is on the ⋮ of the row they were opened from; after removing
   Lemonade it is on Drinks' ⋮. Each case focuses the menu item first, as a person's click leaves it,
   and waits for the close the way `afterDialogCloses` (`menus-screen.test.ts:803`–`807`) does
   before reading focus.
6. Busy: while an add or removal is out, every ⋮ action and grip is disabled.
7. The tabs' `actions` slot is empty on the Structure tab, and no "Add a product" picker exists.
8. Phone width: at 390×844, the Structure tab does not scroll sideways and every row's ⋮ is on screen.
9. A structural refresh keeps the tree's state: with Drinks and Beer open and Beer current, a live
   `section_members` change that leaves both in place re-reads the menu, and afterwards Drinks and Beer
   are still open and Beer's name still carries `aria-current="true"`.

Then make the edits the owner approved in Task 0, exactly as classified in the table above: change
the helpers first, then the DRIVER and RETARGET lines, then the REPLACE cases as described. Do not
change an `expect` line outside the approved set; if one fails, stop and diagnose rather than edit it.
Name every changed assertion in the PR description, grouped by verdict.

**Run** the Task 3 commands. Then `pnpm --filter @waitron/dashboard exec vitest run src/widgets` (the
kept widgets' suites, to show they still pass unedited).

---

## Task 5 — Look, docs, backlog, and the last checks

**Look.** Two ways; use the first, and the second if anything looks wrong.

1. A throwaway file, `apps/dashboard/src/screens/look-w88.test.ts`, never committed: register
   `DASHBOARD_ICONS`; mount the screen with the `menus-screen.test.ts` fixtures plus an included menu,
   with `mountWidget(…, theme)` for `"light"` and `"dark"`; for each `page.viewport(390, 844)` and
   `page.viewport(1280, 900)`, read and log `window.innerWidth`, then save
   `page.screenshot({ path: "look/w88-<theme>-<width>-<state>.png" })` for: the closed tree; Drinks,
   Favourites and the included menu open with Beer current; the root's ⋮ open; a section's ⋮ open; a
   drag in progress (1280 only); the heading with and without the Unpublished changes link. The path
   must be relative to the test file (`docs/developers/testing-guide.md`, "A screenshot is saved only
   to a path Vite's `server.fs` configuration allows"). Move the PNGs to
   `.superpowers/sdd/w88/look/`, delete `look/` and any `__screenshots__/look-w88.test.ts`, and the
   test file. Open every PNG and check: names, grips and ⋮ line up in columns; indentation reads at a
   glance; read-only rows look read-only; the link is blue and underlined and legible in dark; nothing
   is clipped or scrolls sideways at 390 px.
2. The dev stack: `wa-wt demo waitron-feat-menus-structure-tree`, open a menu's Structure tab, and
   check the same states in both themes at both widths.

**i18n** (`apps/dashboard/src/i18n/strings.ts`, English near `:1950`, Spanish near `:4107`):

| Key | English | Spanish | Change |
| --- | --- | --- | --- |
| `menus.read_only_here` | Read-only here | Solo lectura aquí | added (Task 1) |
| `menus.menu_trail` | Path to this menu | Ruta hasta esta carta | added (Task 3) |
| `menus.back` | All menus | Todas las cartas | retired (Task 3) |
| `menus.breadcrumb` | Where you are | Dónde estás | retired (Task 4) |
| `sections.members_saved_note` | Changes to this list are saved straight away. | Los cambios en esta lista se guardan al momento. | retired (Task 4) |
| `sections.members_label` | Items in {name} | Elementos de {name} | retired (Task 4) |

Reused unchanged: `menus.title`, `menus.tree_heading` (now the table's accessible
name), `menus.menu_prefix`, `menus.new_section`, `menus.include_menu`, `sections.add_products`
(pinned by `apps/dashboard/src/i18n/t.test.ts`), `members.remove_from`, `menus.remove_included`,
`menus.edit_included`, `members.reorder`, `action.reordered`, `menus.expand`, `menus.collapse`,
`menus.structure_empty`, `members.name`, `members.kind`, `members.actions`, `folders.expand_all`,
`folders.collapse_all`, `menu_status.*`. Before retiring a key, grep `apps/` and `packages/` for it.

**`docs/developers/design-system.md`.**

- Beside the Products tree paragraph (around `:516` and the tree-mode section `:662`–`686`): the
  Menus Structure tab is the second tree — a root row "Menu: <name>" whose ⋮ holds the adds, adds on
  each owned section's ⋮ acting on that section wherever it appears, rows keyed by path, menu order
  (no sort), grips for owned rows only, included menus read-only with a link to their own editor,
  reordering by the grip (arrow keys; a pointer drag among siblings with Products' ghost and gap),
  focus returning to the ⋮ a window was opened from. Name the guards (the new widget suites).
- Tabbed pages (`:2065`–`2068` at 4696d803d; `:2067`–`2070` after rebasing on newer `main`): the Structure tab, like Products, puts its adds in row menus, not
  the `actions` slot.
- A detail page's heading: "<list> › <name>", the list a link drawn underlined in
  `--wt-color-primary-text`, the `h1` outside the landmark; a page state linking to where it is
  resolved (the Unpublished changes link).
- `:291`–`292` says "the Menus screen shows the same editor on a page": no longer true; say which
  screen still uses `member-list-editor.ts` (check with grep first).

**`docs/backlog.md`.** There is no W88 entry today (W88 is a lane queue item). Add a "DONE (W88,
owner 2026-10-04)" entry after W81's (`:2833`), stating what changed and what was not checked.
Append to W87's "Left open by W87: the editor heading still reads …" sentence (`:2810`–`2811`) a dated
pointer that W88 did it. Add a pointer to the A201 entry's sentence about "the menu screen's members
editor" (`:1588`–`1590`) that W88 removed that picker from the Menus screen. Add an open entry for
Open question 8 (the two widgets' unused editing branches), one for the second copy of Products'
pointer drag (`product-list.ts:294`–`534` and the new widget; a shared helper would serve both), and
anything the look step found and left.

**Last checks.** Write the ledger `docs/handoffs/2026-10-04-w88-menus-structure-tree.md` as the
global instructions require. Run the focused suites once more, then `/finish-branch` with the worktree
path. CI runs the dashboard's coverage shards (bar 98/98/98/95): read the dashboard job's result on
the PR's head before calling it green.

---

## Appendix A — the queue item, verbatim

> ### W88. Replace the split Menu structure editor with one navigable tree — `in-progress` (lane B, from 2026-10-04 ~21:55) — was `pending` (moved from lane E 2026-10-04 ~18:05 by the supervising watcher) (moved from lane D 2026-10-04 ~17:20) (owner 2026-10-04, Casa Delgado Structure screenshot)
> - Replace the standalone “All menus” back control with a breadcrumb, “Menus › Casa Delgado”: Menus is a visibly underlined blue link to the Menus list, and the current menu is named after it. In the same heading area, show “Unpublished changes” as a blue underlined link to this menu's Preview tab only while it has unpublished changes; keep the live version/time and loading/error states truthful without repeating the menu name as multiple competing headings. Coordinate this with W87's list link and URL behavior.
> - Make Structure one full-width, Products-style tree/table. Remove the separate “What is on this menu” outline and the right-hand “editable version” panel. Start with a root row labeled “Menu: {name}”, analogous to All products, then show sections, included menus and products beneath it with clear indentation, aligned name/drag/action columns, expand/collapse, and the same visual language as the Products tree. Keep menu order and existing keyboard/pointer reorder behavior, opening a section, current-path focus and refusal messages.
> - Move New section, Include a menu, Add products (W81's shorter label) and the bottom Add a product picker into contextual kebab actions on the root or the owned section where the item will be added. Keep the right-edge row action for edit, remove and other actions on owned items; the add actions must target the correct list, even when a section appears in several places. Remove the duplicate buttons and bottom picker. Preserve create/include/add errors, loading, disabled/busy states and focus return.
> - An included menu and its nested sections/products can be opened and browsed within this tree, but are visibly read-only in the including menu: no editing, dragging, adding or deleting inside the included source. The including menu may remove its inclusion without changing the source; an explicit link may open the source menu's own editor. Keep cycle prevention and structural refresh behavior.
> - Test-first for root/section contextual actions, target list identity, nesting and navigation, reorder, read-only included content, removal of an inclusion, breadcrumb and Preview links, keyboard focus and responsive layout. Inspect both themes at desktop and phone widths. Update `docs/developers/design-system.md` and `docs/backlog.md` in the PR. Its own PR, after W79/W81/W87 where the Menus files overlap.

Note on "the bottom Add a product picker": the item lists it among the things to move into the ⋮
menus and then says to remove it. This plan reads it as: Add products (the multi-select picker) in
the ⋮ replaces it; there is no separate single-product add in the tree.

## Appendix B — the rules that bind the item (from `.superpowers/sdd/w88/item.md`)

- Every item is its own pull request and must leave `main` green on its own. A test that must be
  edited to pass is a STOP, not a fix. Adding what a stub or fixture lacks is not an edit if no
  assertion changes and no golden or fiscal test is touched; name each grown fixture in the PR.
- Owner decision 2026-10-04 ~19:15: every changed assertion is asked about first, including one that
  pins exactly the behaviour the item was asked to change. Write the exact assertions (file:line) and
  why in `questions.md` and wait; carry on with other eligible work meanwhile.
- A finding outside the item's scope goes to `docs/backlog.md` and `questions.md`, not fixed on the
  side. Every item updates `docs/backlog.md` in the same change.
