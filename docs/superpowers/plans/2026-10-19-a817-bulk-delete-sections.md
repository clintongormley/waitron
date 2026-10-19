# A817 — the Structure tab's Select mode deletes sections in bulk

**Backlog entry (owner, 2026-10-17):** "a bulk Delete for sections is wanted". Today Remove from menu
stays disabled while a section the menu owns is selected, because such a section is deleted, not
removed; each is deleted from its own row's ⋮. Done when a test selects two of the menu's own
sections, deletes them in one action and finds both gone. Left open by A337.

**Branch:** `feat/a817-bulk-delete-sections` · **Review path:** FULL (a new write route) ·
**Migration:** none.

## Decisions (conservative; stated in the PR)

1. **A separate Delete button, not a widened Remove.** The selection bar becomes **Move to
   section…**, **Remove from menu**, **Delete**, Done. Both Remove and Delete are judged on the
   rows SENT — `#sentKeys(this.structureSelected)`, so a row inside a selected section travels with
   it and does not count. Delete is enabled when at least one row is sent and every sent row is a
   section the menu owns (not an included menu). Remove from menu is enabled when at least one row is
   sent and none of them is an owned section. (Today Remove reads the raw ticks,
   `menus-screen.ts:2575-2579`; judging it on sent rows is the same answer except when a product is
   ticked inside a ticked section, where both rules then agree.) Each button is quiet (secondary)
   whenever it is disabled and `danger` when it can act, as Remove is today. The row ⋮'s own
   "Delete section" is unchanged.
2. **A mixed selection** — the sent rows hold an owned section AND something else (a product or an
   included menu) — leaves both Remove and Delete quiet and disabled, and the note under the bar
   says so in one line: "Delete sections and remove other items separately." / "Elimina las
   secciones y quita los demás elementos por separado." The old note ("Sections are deleted from
   their own row's ⋮.") is retired, and the note now shows ONLY for a mixed selection; keep its
   `data-test="selection-sections-note"`.
3. **Delete asks first**, like Remove: heading "Delete 2 sections?" / "Delete 1 section?" (Spanish
   "¿Eliminar 2 secciones?" / "¿Eliminar 1 sección?"). Each SECTION is listed ONCE (a section shown
   in two places — the screen tests' Drinks, at the top level and inside Favourites — is one
   section, one line, one id sent) by its name; a section with owned sections below it adds the
   count, counted by `#ownedDescendants` (`menus-screen.ts:3428`, which skips included menus):
   "Wines and the section below it" / "Wines and the 2 sections below it", in the single delete's
   words (`menus.delete_section_one`, `menus.delete_section_note`). Then "Their products stay." /
   "Sus productos se conservan." (the single delete's Spanish verb, `strings.ts` near `:5666`), and a
   danger **Delete** confirm.
4. **One request, one transaction.** `POST /management-api/sections/delete` with
   `{ "sectionIds": [...] }` answers 204. It needs the catalogue write permission through the same
   `gated` wrapper every catalogue write uses (`apps/server/src/catalogue-api.ts:792-802`), which
   also sets the `x-waitron-menu-revision` header. A missing field, a non-array, a non-string entry,
   an EMPTY list or a repeated id is `management.request_invalid` (field `sectionIds`) — `idList`
   (`:223`) accepts `[]`, so the empty check is explicit, and the duplicate check is as
   `selectionBody` does it. A non-uuid entry is `shared.invalid_id` (kind `SectionId`), which
   `idList` → `requireUuidParam` already throws, as for every id in this file. An unknown id is
   `menu_section.not_found`, a menu root or home layout `menu_section.wrong_role` (both with
   `{ sectionId }`, as today), and in either case NOTHING is deleted (the checks run before any
   write — check it in a test). No POST `/management-api/sections/:id` route exists
   (`catalogue-api.ts:585-705`), so nothing shadows the new path. No new error code; the dashboard
   already has messages for every code above.
5. **After success** the selection clears, the structure re-reads, the mode stays on and focus goes
   to Select — as a successful Remove does (`#removeSelected`). A refusal shows in the confirm and
   leaves its Delete action enabled (CLAUDE.md §3: a refusal never disables the action by itself).

## Task 1 — `deleteSections` in `packages/catalogue` (implementer)

Files: `packages/catalogue/src/sections.ts`, `sections.test.ts`, the package's export list.

- Refactor `deleteSection(tx, id)` (`sections.ts:214`) into `deleteSections(tx, ids)`:
  - load the section graph ONCE; check every id (exists → else `menu_section.not_found`; role
    `section` → else `menu_section.wrong_role`, details `{ sectionId }` as today) before any write;
  - the deleted set is the union of each id's descendants (the existing `collect`); an id that is a
    descendant of another id in the same call is deleted once; a repeated id is harmless here (the
    route refuses repeats; this function de-duplicates);
  - home-layout shortcuts to any deleted section become Missing with `sectionPathName` (as today);
  - delete the set through `batches()` (`packages/catalogue/src/batches.ts`), as `removeMembers`
    does (`sections.ts:416`) — one statement binding a large list overflows the call stack;
  - renumber each list that is a non-home parent of a NAMED id, less any list that is itself being
    deleted, leaving out every member that points at ANY deleted section; each such list once;
  - mark the menus changed through `writeStructureChange(tx, graph, namedIds)` (`sections.ts:345`)
    or exactly what the current single delete's `menusContaining` + `onStructureChanged` does,
    unioned over the named ids and sorted — the hook is called once.
  - `deleteSections(tx, [])` does nothing and writes nothing (the route refuses an empty list).
  - `deleteSection(tx, id)` becomes `deleteSections(tx, [id])`; every existing `deleteSection` test
    must pass UNEDITED.
- Tests (failing first): two sibling sections deleted in one call, both gone and the parent list
  renumbered with no gap; a parent and its own child named together; an unknown id among good ones
  refuses with `menu_section.not_found` and nothing is deleted; a menu root refuses with
  `menu_section.wrong_role` and nothing is deleted; a home shortcut to a deleted section becomes
  Missing with its path name; two sections in two different menus call the structure-changed hook
  exactly once with the sorted pair of menus (shape of `sections.test.ts:666-673`); a section of a
  menu that another menu includes is deleted and the including menu loses its product (follow the
  `menu-inclusion.test.ts:252` case); two sections side by side in one list, renumbered with no
  gap. Use `useVenueDb`. Assert domain error codes.
- Run: `pnpm --filter @waitron/catalogue exec vitest run src/sections.test.ts` and every file that
  imports `deleteSection` (`grep -rln deleteSection packages apps`).

## Task 2 — the route and the client method (implementer)

Files: `apps/server/src/catalogue-api.ts`, `apps/server/src/catalogue-api.test.ts`,
`apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client-routes.test.ts` (near `:980`,
`:1013`).

- Route per Decision 4: `idList(body.sectionIds, "sectionIds", "SectionId")` plus explicit empty and
  duplicate checks.
- Tests: 204 and both sections gone; `request_invalid` for missing field, non-array, empty and
  repeated; `shared.invalid_id` for a non-uuid; `not_found` writes nothing; add the route to the
  401/403 table "requires a management session and refuses staff on every section route"
  (`catalogue-api.test.ts:5644-5686`) and to the request-body table (`:5479`); the response carries
  the `x-waitron-menu-revision` header like its siblings.
- Client: `deleteSections(ids: string[]): Promise<void>` → `POST /management-api/sections/delete`,
  with its `client-routes.test.ts` row beside `removeSectionMembers`.
- Checked by the plan review: no live-subscription list or route guard names the sibling
  `section-members/remove`, so nothing else lists the route.

## Task 3a — the Delete button, its enablement and the mixed note (implementer)

Files: `apps/dashboard/src/screens/menus-screen.ts` (`#renderSelectionBar`, ~`:2573`),
`apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/menus-screen.test.ts`,
`apps/dashboard/src/screens/menus-screen.a11y.test.ts`.

- Decisions 1 and 2. `data-test="selection-delete"`. Pressing Delete opens nothing yet beyond
  setting a `deletingSelected` state the next task renders (or leave the click to Task 3b — but the
  button and its enablement land here, tested).
- Intended rewrites of existing tests (the note's meaning changes): `menus-screen.test.ts:4702`
  (Spanish) and `:4716` assert the old note text — they become the mixed note, shown for a mixed
  selection; `menus-screen.a11y.test.ts:580-590` ticks only `m-drinks` and waits for the note — it
  becomes a product plus a section. List each in the PR.
- New tests (failing first), each checking disabled AND quiet colour as `menus-screen.test.ts:4674-4679`
  does for Remove: Delete enabled + danger with two owned sections ticked; disabled with nothing
  ticked, with only products ticked, with only an included menu ticked; section S plus a product
  inside S → Delete enabled, Remove disabled, no note; owned section + product elsewhere → both
  disabled, note shown; owned section + included-menu row → both disabled, note shown; Spanish note.

## Task 3b — the confirm and the delete (implementer)

Files: `apps/dashboard/src/screens/menus-screen.ts`, `strings.ts`, `menus-screen.test.ts` (its fake
API, `WRITES` list at `:336`, the Structure selection cases), `menus-screen.a11y.test.ts`.

- Decisions 3 and 5. The confirm mirrors Remove's (`removingSelected`, `#removeSelected`, the confirm
  near `:3424`), with its own `deletingSelected` / `deleteSelectedError`. Keep it in step with the
  selection in all three places Remove's is: `#keepSelectionOwned` remaps it (`:2654`),
  `#keepSelection` trims it and closes it when nothing is left (`:2667`), opening another menu
  resets it (`:1254`).
- Add `deleteSections` to the test fake beside `removeSectionMembers` — the fake must REMOVE the
  deleted sections (and their descendants) from its structure, or "both gone" proves nothing — and
  to `WRITES`.
- Tests (failing first): THE DONE TEST — tick two of the menu's own sections, press Delete, confirm:
  `deleteSections` called once with both ids, after the re-read both rows are gone, the selection is
  empty, Select mode still on, focus on Select; Drinks ticked in both places (`tickLemonadeInBothPlaces`
  shows how) → one line in the confirm, one id sent; a section with one and with two owned sections
  below it shows the matching count line; a refusal (`menu_section.not_found`) shows in the confirm
  and its Delete stays enabled; the confirm closes when a live re-read drops every listed section;
  Spanish heading. Add the confirm to the a11y test in both themes.

## Task 3c — docs and LOOK (implementer)

- `docs/developers/design-system.md:1413` "three buttons" → four, naming Delete; rewrite the
  Remove-disabled sentence to Decisions 1–2 (judged on sent rows; mixed note); `:1430` "Both send one
  request" → name the third route `POST /management-api/sections/delete` (`deleteSections`,
  `packages/catalogue/src/sections.ts`).
- `docs/backlog.md`: delete the A817 entry.
- No user guide covers the Menus Structure tab (`apps/server/src/guide/{en,es}` hold only
  content-and-images, modifiers and products), so no guide change.
- LOOK: screenshots of the selection bar (sections only; mixed with the note) and the confirm (with a
  count line), light and dark, desktop and 390 px, saved to `~/waitron-campaign-b/a817-shots/`; the
  temporary screenshot test is not committed.

## Not in scope

Deleting products, deleting from the Products tab, and any change to the row ⋮'s single delete.

_Dated note, 2026-10-19: the build did change the row ⋮'s single "Delete section" dialog — it now
closes when another menu is opened, because finish-branch found it deleting the first menu's
section from the second menu's screen (#1885)._
