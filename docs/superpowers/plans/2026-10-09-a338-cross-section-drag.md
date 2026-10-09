# A338 — Dragging a product or section into a different section moves it there

Owner, 2026-10-07 ~12:40: "if i drag a product in the menu into a different section, it doesn't
move". Today the menu's Structure tab refuses it by design: `#targetFor`
(`apps/dashboard/src/widgets/menu-structure-table.ts`) accepts only the dragged row's siblings, and
`#move` emits only a same-list reorder (`wt-member-move`). This plan makes a drag (and the keyboard)
move a member into another list of the same menu.

**No server change.** A337 added `POST /management-api/sections/:id/members/move-in`
(`moveMembersInto`, `packages/catalogue/src/sections.ts`; client `moveSectionMembersInto`,
`apps/dashboard/src/api/client.ts`). It already takes a `position` (counted in the destination
without the moved members; past the end means last), moves the member ROW itself (so a product keeps
the menu's price for it — `menu_items` is keyed by menu and product, not by section — and an included
menu keeps its folder setting), refuses a list of another menu (`menu_section.invalid`
`{field: "listId"}`), a section into itself or below itself (`menu_section.member_cycle`) and a
duplicate (`menu_section.member_duplicate`). So the review path is LIGHT unless a task finds it must
change the server, in which case stop and say so.

## Decisions

1. **What a pointer over row R offers**, while dragging member D (checked in this order).
   "D's sections" are D's own section id (when D is a section) and every section id inside D's node,
   at any depth (as the screen's `sectionIdsWithin` collects them) — a section can be shown in two
   places, so a row KEY is not enough to tell "inside D".
   1. R is D, or inside D's branch, or R's list is one of D's sections → nothing (a section never
      goes into itself or below itself, wherever that list is drawn).
   2. R is read-only (a row inside an included menu) → nothing. D is a product whose product no
      longer exists (no entry in the products the table holds) and R is not D's sibling → nothing
      (the server leaves such rows out of a list's contents and would answer
      `menu_section.not_found`).
   3. R is an INTO target: a section the menu owns (not an included menu), not one of D's sections,
      whose drawn row is not open (`aria-expanded` is not `"true"`: closed, or empty and so drawing
      no arrow), and the pointer is in the MIDDLE HALF of R's height → INTO R, at the end. This
      applies to a sibling section too: the owner's request says dropping on a collapsed section's
      own row puts the item at its end. R's first cell is marked `drop-target` (as the Products tree
      marks a category); no gap is drawn. Pointer in R's top or bottom quarter → the rules after
      this one decide. A product that no longer exists is never offered INTO a section.
   4. R is D's SIBLING (same `parentKey`) → today's reorder, unchanged: the gap before R when R is
      above D, after R's last drawn row when below; release sends `wt-member-move`.
   5. R is in D's own list but is not D's sibling (the same list shown in another place) → nothing.
   6. Otherwise (R is in another writable list of this menu — a row inside an open section, a
      top-level row while D is in a section, an open section's own row, or an included menu's own
      row) → beside R in R's list: the gap before R when the pointer is in R's upper half, after R's
      last drawn row when in its lower half. The position sent is R's index among ALL the members of
      its list (the table's current order, `#order` applied, not only the drawn ones) for before,
      that index + 1 for after.
   - Rules 3 and 6 offer nothing when the destination list already holds a member with D's ref (the
     same product, or the same section) — the server would refuse it as
     `menu_section.member_duplicate`; the client refuses it first, with no gap and no mark.
   - Today a row inside an open sibling section stands for that sibling (reorder), and a closed
     sibling section's row means "reorder beside it". Both change (rules 6 and 3). List each test
     check this changes.
2. **Release.** Rule 4 sends `wt-member-move` exactly as today. Rules 3 and 6 send a new
   `wt-member-move-into` — `detail: { from: string[] /* D's list path */, memberId, to: string[]
   /* destination list path; [] for the top level */, position: number /* omitted for rule 3 */ }` —
   bubbling and composed like the others. No optimistic reorder for a cross-list move: the screen
   waits for the answer.
3. **Keyboard.** ArrowUp and ArrowDown keep moving within the list (unchanged, including sending
   nothing past either end). Two new keys on a grip:
   - **ArrowRight** moves the member INTO the drawn sibling directly above it, at the end, when that
     sibling is a section the menu owns (not an included menu), not one of D's sections, and its
     list does not already hold D's ref; otherwise nothing. Like indenting in an outline.
   - **ArrowLeft** moves a member that is inside a section OUT, to its section's own list, directly
     after its section; at the top level, or into a list already holding D's ref, nothing.
   - Each announces in the existing live region: "{item} moved into {section}" / "{item} moved out
     to {list}" (EN and ES strings; `{list}` is the menu's name at the top level). Focus follows the
     moved row's grip once the menu is read again: the table keeps the pending focus until `busy`
     is false after new `nodes` have arrived, then focuses the grip at the new key (destination path
     plus member id), or, if no such row is drawn (a refusal), the grip at the old key. Both keys
     call `preventDefault` (no sideways scroll); `wt-data-table` has no ArrowLeft/ArrowRight
     handling of its own (reviewer's search of `packages/ui/src`). The grip's label is unchanged;
     it gains `aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"`, and the design-system
     paragraph documents the keys.
4. **The screen** (`apps/dashboard/src/screens/menus-screen.ts`) handles `wt-member-move-into` like
   the bulk Move: resolve both paths with `#targetAt`, hold `busy`, send
   `moveSectionMembersInto(destination, [{ listId: source, memberId }], position)` through the
   screen's write queue (`#writes.run` with the DESTINATION list id as its scope — one global chain,
   so it waits behind any unanswered same-list move; `#moveSelected` itself calls the API
   directly, so this is a deliberate difference), read the menu again, and open the destination (as
   `#moveSelected` does, so the moved row is drawn). Before sending, check that `#targetAt` resolved
   each path to a target as long as the path sent (it falls back to an ancestor, or the top level,
   for a path that no longer leads anywhere); if not, send nothing and read the menu again. A
   refusal shows in the tab's existing member error line (`memberError`, `codeMessage`), and the
   menu is read again.
5. **Docs.** `docs/developers/design-system.md`'s Structure paragraph ("offers only places among the
   member's siblings") changes to the rules above, as an owner decision dated 2026-10-07. Plan
   `docs/superpowers/plans/2026-10-04-menus-structure-tree.md` ~474–475 is historical: add a one-line
   dated pointer to this plan, do not rewrite it.

## Tasks

### Task 1a — the table's drag rules, release and mark (`menu-structure-table.ts` and its tests)

Test-first in real Chromium, in `apps/dashboard/src/widgets/menu-structure-table.test.ts` (use its
`mount`, `grip`, `pointer`, `nameAt`, `marked`, `settle`, `toggle`, `listen` helpers; extend the
fixture only by adding, and name each fixture growth). Cases, each failing first:
- a product dragged over a row inside another OPEN section shows the gap before/after by pointer
  half, and a release sends one `wt-member-move-into` with the right `from`, `to`, `position`, and no
  `wt-member-move`;
- a product dragged from a section over a top-level row shows the gap there and sends `to: []`;
- a product dragged over the middle of a CLOSED section's row (another list's, and a sibling's)
  marks that row `drop-target`, draws no gap, and a release sends `wt-member-move-into` with no
  `position`; over the same row's top or bottom quarter it offers the gap beside it instead;
- an EMPTY owned section (no arrow) takes a drop into it the same way;
- refused, each with no gap, no `drop-target` and nothing sent on release: a section over its own
  descendants; a section over a row of a list that is inside it but drawn elsewhere (the fixture's
  Favourites holds Drinks: drag Favourites over `m-drinks/m-lager`, and over a closed section
  inside Drinks); a row inside an included menu; a product over a list (open, closed, or the top
  level) already holding that product; a section over a list already holding that section; a row
  of D's own list drawn in another place (rule 5); a product whose product no longer exists, over
  another list;
- an included menu's own row, in another list, offers a gap beside it (rule 6);
- the existing test "offers no gap over a row outside the dragged member's own list, and a release
  there sends nothing" changes to the new rules: rewrite it to check, at least as strictly, the new
  gap or refusal for each row it visits. Record every changed check (file:line, before, after, which
  decision changed it) in the ledger's "Changed test checks" list.
- `drop-target` gets a token-only style in the table's styles (read how `product-list.ts` paints it
  and reuse it, or move it into `treeDragStyles` if both can share it), and the `.a11y` file beside
  the table gains an axe case mid-drag with a row marked `drop-target`, in both themes.
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-structure-table` (and the
`.a11y` file beside it), then `pnpm --filter @waitron/dashboard exec tsc --noEmit -p .` and
`pnpm exec eslint apps/dashboard/src/widgets/menu-structure-table.ts`, `pnpm format:check`.

### Task 1b — the table's ArrowLeft and ArrowRight

Test-first, same file: ArrowRight into the section above (sends `wt-member-move-into`, announces),
ArrowRight with a product above (nothing), with an included menu above (nothing), into a section
already holding the product (nothing), a section into a section above that sits inside it elsewhere
(nothing); ArrowLeft out of a section (sends `to` = the section's own list path, `position` = the
section's index + 1 in that list, announces), ArrowLeft at the top level (nothing), ArrowLeft into a
list already holding the product (nothing); each key's default action is prevented (check
`defaultPrevented`); the grip carries `aria-keyshortcuts`; focus is restored per Decision 3 (drive
it in the table test by setting `busy` and then new `nodes`, as the screen would; and a refusal —
`busy` off with unchanged nodes — focuses the old grip). Same run commands as Task 1a.

### Task 2 — the screen, strings and docs

Test-first in `apps/dashboard/src/screens/menus-screen.test.ts` (the "the Structure tree" cases;
the API fake already has `moveSectionMembersInto` from A337):
- a `wt-member-move-into` from the table sends one `moveSectionMembersInto(destination, [{listId:
  source, memberId}], position)` with the real list ids (a section's id; the menu's root list for
  `[]`), reads the menu again, opens the destination, and the moved product shows there;
- a refusal (the fake throws `menu_section.member_duplicate`) shows the member error line's text and
  reads the menu again; nothing else changes;
- the move waits behind an unanswered same-list move (queue order), as `#writes` promises;
- a move whose path no longer resolves (the section was removed by a live update) sends nothing;
- keyboard: after ArrowRight, focus is on the moved row's grip once the menu is read again.
Strings: the two announcements in EN and ES (`apps/dashboard/src/i18n/strings.ts`, or wherever
`action.reordered` lives). Docs per Decision 5. Run the focused screen tests, the table tests again,
`tsc`, eslint on changed files, `pnpm format:check`.

## Not in scope

Copying a product into a second section (owner decision open in the backlog). Moving into another
menu. Hover-to-open a closed section during a drag (the Products tree's `HOVER_OPEN_MS`): rule 4's
drop-at-the-end covers a closed section, and a person who wants a place inside opens it first.
