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

1. **What a pointer over row R offers**, while dragging member D (checked in this order):
   1. R is D, or inside D's branch → nothing (a section never goes into itself or below itself).
   2. R is read-only (a row inside an included menu) → nothing.
   3. R is in D's own list (R's list is D's list) → today's reorder, unchanged: the gap before R
      when R is above D, after R's last drawn row when below. A collapsed sibling SECTION's row still
      means "reorder beside it", not "into it", so reordering past a closed section keeps working.
   4. R is a section the menu owns (not an included menu), R is CLOSED, and R is not in D's list →
      INTO R, at the end. R's first cell is marked `drop-target` (as the Products tree marks a
      category); no gap is drawn, because R's children are not drawn.
   5. Otherwise (R is in another writable list of this menu — a row inside an open section, a
      top-level row while D is in a section, or an included menu's own row) → beside R in R's list:
      the gap before R when the pointer is in R's upper half, after R's last drawn row when in its
      lower half. The position sent is R's index in its list (before) or R's index + 1 (after).
   - Rules 4 and 5 offer nothing when the destination list already holds a member with D's ref (the
     same product, or the same section) — the server would refuse it as
     `menu_section.member_duplicate`; the client refuses it first, with no gap and no mark.
   - Today a row inside an open sibling section stands for that sibling (reorder). That changes:
     it is now rule 5, a place inside that section. List each test check this changes.
2. **Release.** Rule 3 sends `wt-member-move` exactly as today. Rules 4 and 5 send a new
   `wt-member-move-into` — `detail: { from: string[] /* D's list path */, memberId, to: string[]
   /* destination list path; [] for the top level */, position: number /* omitted for rule 4 */ }` —
   bubbling and composed like the others. No optimistic reorder for a cross-list move: the screen
   waits for the answer.
3. **Keyboard.** ArrowUp and ArrowDown keep moving within the list (unchanged, including sending
   nothing past either end). Two new keys on a grip:
   - **ArrowRight** moves the member INTO the drawn sibling directly above it, at the end, when that
     sibling is a section the menu owns (not an included menu) and its list does not already hold
     D's ref; otherwise nothing. Like indenting in an outline.
   - **ArrowLeft** moves a member that is inside a section OUT, to its section's own list, directly
     after its section; at the top level, or into a list already holding D's ref, nothing.
   - Each announces in the existing live region: "{item} moved into {section}" / "{item} moved out
     to {list}" (EN and ES strings; `{list}` is the menu's name at the top level). Focus follows the
     moved row's grip once the menu is read again. Both keys stop the event so the table does not
     also act on them. The grip's label is unchanged; the design-system paragraph documents the keys.
4. **The screen** (`apps/dashboard/src/screens/menus-screen.ts`) handles `wt-member-move-into` like
   the bulk Move: resolve both paths with `#targetAt`, hold `busy`, send
   `moveSectionMembersInto(destination, [{ listId: source, memberId }], position)` through the
   screen's write queue (`#writes.run`, one global chain, so it waits behind any unanswered
   same-list move), read the menu again, and open the destination (as `#moveSelected` does, so the
   moved row is drawn). A refusal shows in the tab's existing member error line (`memberError`,
   `codeMessage`), and the menu is read again. Not `#listWrite` if that would mis-attribute the
   refusal to one list; read both and say which was used and why.
5. **Docs.** `docs/developers/design-system.md`'s Structure paragraph ("offers only places among the
   member's siblings") changes to the rules above, as an owner decision dated 2026-10-07. Plan
   `docs/superpowers/plans/2026-10-04-menus-structure-tree.md` ~474–475 is historical: add a one-line
   dated pointer to this plan, do not rewrite it.

## Tasks

### Task 1 — the table (`menu-structure-table.ts` and its tests)

Test-first in real Chromium, in `apps/dashboard/src/widgets/menu-structure-table.test.ts` (use its
`mount`, `grip`, `pointer`, `nameAt`, `marked`, `settle`, `toggle`, `listen` helpers; extend the
fixture only by adding, and name each fixture growth). Cases, each failing first:
- a product dragged over a row inside another OPEN section shows the gap before/after by pointer
  half, and a release sends one `wt-member-move-into` with the right `from`, `to`, `position`, and no
  `wt-member-move`;
- a product dragged from a section over a top-level row shows the gap there and sends `to: []`;
- a product dragged over a CLOSED section (not its own list) marks that row `drop-target`, draws no
  gap, and a release sends `wt-member-move-into` with no `position`;
- a closed sibling section's row still offers today's reorder (gap, `wt-member-move`);
- refused, each with no gap, no `drop-target` and nothing sent on release: a section over its own
  descendants; a row inside an included menu; a product over a list (open, closed, or the top level)
  already holding that product; a section over a list already holding that section;
- an included menu's own row, in another list, offers a gap beside it (rule 5);
- ArrowRight into the section above (sends `wt-member-move-into`, announces), ArrowRight with a
  product above (nothing), ArrowRight with an included menu above (nothing), ArrowRight into a
  section already holding the product (nothing), ArrowLeft out of a section (sends `to` = the
  section's own list path, `position` = the section's index + 1, announces), ArrowLeft at the top
  level (nothing); both keys call `preventDefault` and do not reach the table;
- the existing test "offers no gap over a row outside the dragged member's own list, and a release
  there sends nothing" changes to the new rules: rewrite it to check, at least as strictly, the new
  gap or refusal for each row it visits. Record every changed check (file:line, before, after, which
  decision changed it) in the ledger's "Changed test checks" list.
- `drop-target` gets a token-only style in the table's styles (read how `product-list.ts` paints it
  and reuse it, or move it into `treeDragStyles` if both can share it).
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-structure-table` (and the
`.a11y` file beside it), then `pnpm --filter @waitron/dashboard exec tsc --noEmit -p .` and
`pnpm exec eslint apps/dashboard/src/widgets/menu-structure-table.ts`, `pnpm format:check`.

### Task 2 — the screen, strings and docs

Test-first in `apps/dashboard/src/screens/menus-screen.test.ts` (the "the Structure tree" cases;
the API fake already has `moveSectionMembersInto` from A337):
- a `wt-member-move-into` from the table sends one `moveSectionMembersInto(destination, [{listId:
  source, memberId}], position)` with the real list ids (a section's id; the menu's root list for
  `[]`), reads the menu again, opens the destination, and the moved product shows there;
- a refusal (the fake throws `menu_section.member_duplicate`) shows the member error line's text and
  reads the menu again; nothing else changes;
- the move waits behind an unanswered same-list move (queue order), as `#writes` promises;
- keyboard: after ArrowRight, focus is on the moved row's grip once the menu is read again.
Strings: the two announcements in EN and ES (`apps/dashboard/src/i18n/strings.ts`, or wherever
`action.reordered` lives). Docs per Decision 5. Run the focused screen tests, the table tests again,
`tsc`, eslint on changed files, `pnpm format:check`.

## Not in scope

Copying a product into a second section (owner decision open in the backlog). Moving into another
menu. Hover-to-open a closed section during a drag (the Products tree's `HOVER_OPEN_MS`): rule 4's
drop-at-the-end covers a closed section, and a person who wants a place inside opens it first.
