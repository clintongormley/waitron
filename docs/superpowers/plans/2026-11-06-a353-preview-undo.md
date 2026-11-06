# A353 — Undo on the Preview's change list: implementation plan

> **For implementers:** dispatch each task as `subagent_type: "implementer"`. Read
> `superpowers:test-driven-development` first: every task starts with a failing test you watch
> fail for the reason it names, then the smallest change that passes it. One task per dispatch.

**Goal.** On a menu's Preview tab, each unpublished change made in this menu gets an **Undo**
action that puts that one change back to the live version, by calling a write the dashboard
already uses. A change made to a shared product gets **Edit product**; a change that came from an
included menu gets a link to that menu. Undo writes, the preview is read again, and the change
leaves the list. A refusal stays beside its change. There is no confirmation; the success message
says what was undone.

**Base.** `main` at `16207675ad`. Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a353-preview-undo`,
branch `feat/a353-preview-undo`. Every pull request below lands on its own and leaves `main`
working; each later one starts from a fresh branch off `main` after the earlier one has landed.

**The old attempt.** `feat/menu-preview-undo` (`e04b3abe7`, about 2,160 commits behind) is used
only as a checklist of change kinds. Its server-side re-planning layer and hash "basis" are
dropped (see Decision 1). Nothing is rebased from it.

**What was run while planning, and what was only read.** Everything below is from reading
`main` at `16207675ad`, except two things that were run: the `grep`s whose results are quoted, and
a shell walk of the relative imports reachable from `menu-document-types.ts`, `section-types.ts`
and `menu-types.ts` in `packages/catalogue/src` (17 files reached; none contains
`from "@waitron/db`, `drizzle-orm`, `hono`, `pg`, `node:` or `../index.js`). No test, server or
browser was run. Each "Expected" below is a prediction until its task runs it.

---

## 1. Decisions and their receipts

### Decision 1 — no server-side freshness check, and no server change at all

The rule: an Undo needs a freshness check only if the ordinary save of the same field has one,
or if a stale Undo could do something a stale ordinary save of the same form could not.

- **No ordinary save on these routes checks freshness.** Each route parses the body and calls
  the catalogue function inside `gated`, which authorizes and runs one `withTransaction`, then sets
  the `x-waitron-menu-revision` response header; it compares nothing
  (`apps/server/src/catalogue-api.ts:809-819`). The routes: menu name
  `PATCH /management-api/catalogues/:id` (`:1010-1028`); a dish's menu price
  `PATCH …/items/:itemId` (`:1207-1233`); one variant's menu price `PATCH …/variants/:variantId`
  (`:1257-1276`); a section `PATCH /management-api/sections/:id` (`:614-620`); an include's
  folder `PUT …/members/:memberId/folder` (`:703-712`); Home display
  `PATCH …/home-display` (`:741-755`); members add / remove / move-in / position
  (`:637-646`, `:657-664`, `:666-675`, `:693-701`); section delete (`:622-628`); shortcuts
  (`:757-793`). The dashboard's client sends no revision on any of them
  (`apps/dashboard/src/api/client.ts:2985-2987`, `:3050-3055`, `:3119-3145`, `:3372-3404`,
  `:3426-3436`, `:3024-3047`).
- **The only freshness checks in this area** are publish's `expectedHash`
  (`catalogue-api.ts:1097-1109` → `packages/catalogue/src/menu-publication.ts:638`, which throws
  `menu.changed_since_preview`) and the live patch's `baseVersionId` (`client.ts` `patchLiveMenu`).
  Undo publishes nothing, so neither applies.
- **Each Undo below sends exactly what an ordinary save on the same route sends, or less.** The
  section form sends every presentation field (`apps/dashboard/src/screens/menus-screen.ts:1712-1738`);
  an Undo sends only the fields its change names. The one route where a stale call could do more
  than any ordinary save is the bulk variant-price `PUT …/items/:itemId/variants`
  (`catalogue-api.ts:1244-1255` → `packages/catalogue/src/variants.ts:381-427`), which deletes the
  menu price of every Active variant it is not sent. No screen calls it (`grep '/variants\`'
  apps/dashboard/src/api/client.ts` finds nothing), so a stale bulk call could clear a variant
  price no ordinary save touches. **Undo never uses that route** (see the variants row below).
- **The preview an Undo is planned from is a live query** — `MenuReadController` reads through
  `api().liveData` and re-reads on change (`apps/dashboard/src/api/menu-read-controller.ts:46-50,120-138`) —
  so the stale window is the same as for an ordinary form left open.

So: no new route, no change to any existing route, no new error code. Every Undo is the dashboard
calling an existing client method (or, from PR 3 on, an existing route through a thin new client
wrapper) with the live value.

### Decision 2 — the planner is a pure module in `@waitron/catalogue`, guarded as browser-safe

`packages/catalogue/src/menu-undo.ts` decides, for one change, which action to offer. It lives in
the catalogue package so its real-database tests sit beside `previewMenu` and the write functions.
The dashboard already imports runtime catalogue modules by deep path — `menu-navigation.js`
(`apps/dashboard/src/widgets/menu-preview.ts:9`), `menu-patch.js`, `menu-combine.js` — and the
package has no `exports` map (`node -e` on `packages/catalogue/package.json` printed
`exports: undefined`), so `@waitron/catalogue/src/menu-undo.js` resolves.

Rules for the module: **only `import type` lines**, and only from the type leaves
`./menu-document-types.js`, `./section-types.js`, `./menu-types.js`. It declares its own
structural input type for the menu's structure (the dashboard's `MenuStructureNode` in
`client.ts:340-352` and the catalogue's in `menu-structure.ts:14-26` both fit it) rather than
importing `menu-structure.ts`, which imports `drizzle-orm`. The browser-purity guard scans every
relative `from "…"`, type imports included (`scripts/dashboard-browser-purity.test.ts:70-77,97-110`),
so Task 1.1 adds the file to that guard's `SUBPATHS` list (a single `.ts` entry is allowed:
`:18-22,43-45`). The shell walk above predicts the entry passes.

### Decision 3 — drafts: Undo stages nothing, and nothing staged can be behind it

Every staged draft reachable from the menu editor lives in a modal: the menu and section forms
(`section-details-form.ts:136,255`), the include form (`include-folder-form.ts:328`), the Move,
shortcut and add-products windows (`menus-screen.ts:2294,2937,3266,3532,3667`), and the
schedule form on the Preview tab itself (`menu-publications.ts:465,712,770`). `wt-modal` extends
`wt-dialog` (`packages/ui/src/components/wt-modal.ts:6`), which opens with `showModal()`
(`wt-dialog.ts:389`), so while any of them is open the Preview's list behind it cannot be
activated. The Preview widget holds no draft scope of its own (`grep draftScopeFor
apps/dashboard/src/widgets/menu-preview.ts` finds nothing). So Undo takes no draft scope and adds
no `*.unsaved.test.ts`. The link-style actions that leave the page (Edit product, Edit {menu},
Edit extras list) go through the same handlers as today's links of that kind, which already pass
through the leave coordinator.

Undo still follows the screen's write discipline: it sets `busy`, runs inside the screen's write
queue (`#writes`, `menus-screen.ts:850`; a price Undo in `#priceWrites`, `:851`, under the same
key the Price overrides tab uses, `menu-prices-table.ts:86-87`), and finishes with `#refresh()`
(`:1263-1265`), exactly as `#saveSection` (`:1712-1738`) and `#saveInclude` (`:1740-1760`) do.

### Decision 4 — the guide gains nothing

No guide page describes the Preview's change list: `grep -rn -i preview
apps/server/src/guide/en/*.md` hits only `appearance.md`, `content-and-images.md:65,244` and
`products.md:29,49-51,324`, none about the list, and `apps/dashboard/src/help-guide.ts` maps no
menus key. An Undo beside each change is found by trying it, so by the house rule it earns no
sentence. `docs/developers/design-system.md`'s Preview contract (`:5386-5407`) does get the new
actions, in the PR that adds them.

### Decision 5 — what an Undo of a price puts back

A `price_changed` change is credited to this menu when this menu's own price differs
(`menu-document.ts:1007-1023`). Its Undo puts back this menu's own setting (a price, or no price so
the dish inherits). If the inherited price also moved meanwhile — say the product's own price —
the list then shows a smaller price change credited to "shared product". That remainder is the
shared change, which this menu's Undo does not own. Task 1.3 pins it with a test.

---

## 2. Every change kind, where it comes from, and what each gets

Sources: **M** this menu, **P** shared product, **I** included menu. The kinds and where each is
emitted: `menu-document-types.ts:195-251`; `menu-document.ts:891-892` (rename), `:894-929`
(sections added and removed), `:930-968` (section changed), `:969-1006` (products removed and
moved), `:1007-1023` (price), `:1024-1056` (product changed), `:1057-1069` (product added),
`:1072-1129` (extras), `:1131-1155` (order), `:1157-1165` (Home). `previewMenu` re-credits a
removal to M when the product is still reachable, or to P when it was deleted
(`menu-publication.ts:412-428`), and adds `product_deleted` (P) for an extra-only product
(`:401-411`).

**Every P change** gets **Edit product** (`product.edit`, the product editor, through the same
`wt-edit-product` event the Preview's warnings already send, `menu-publish-warnings.ts:29-40`),
except as owner question Q1 below settles. **Every I change** gets **Edit {menu}**, a link to
`/manage/menus/menu/<includedMenu.id>/view/structure`, with no link when the change carries no
`includedMenu`. **No Undo is offered anywhere when the menu has never been published**
(`preview.live === null`): there is no live value to put back.

| Kind | Sources | What M gets, the existing write, and when it is offered | PR |
| --- | --- | --- | --- |
| `menu_renamed` | M | Undo: `renameCatalogue(menuId, live.menuName)` → route `:1010-1028` → `updateMenuDetails` with only `name` (`operations.ts:849-887`, checks the name is free at `:879`). Always. | 1 |
| `price_changed` | M, P, I | Undo: `updateMenuItem(menuId, <current menu-item id>, { grossPrice: live.grossPrice })` → `:1207-1233` → `updateMenuItem`. The current item id is the key of the preview document's offer for that product. Always (Decision 5). | 1 |
| `product_changed` | M (always `["variants"]`), P, I | Undo: `setMenuVariantPrice(menuId, itemId, variantId, live.menuPrice)` → `:1257-1276` → `variants.ts:433-460` — **only when exactly one Active variant's own menu price differs**, and no variant moved only because the dish's own menu price moved (`menu-document.ts:840-853`; those go away with the price change's Undo). Two or more differing variants: **no Undo** (one route per variant, or the bulk route Decision 1 rules out). | 1 |
| `section_changed` on this menu's own section (no `includedMenu` on the node) | M, I | Undo: `updateSection(sectionId, patch)` → `:614-620` → `sections.ts:181-198`, the patch holding only the change's fields from the live node: `names` → `internalName` and `names`; `image`; `color`. Always. Languages switched off since are kept by the merge (`optional-translations.ts:30-49`); a live photo deleted from the library is refused `menu_section.invalid` (`sections.ts:80-85`) and shown beside the change. | 1 |
| `home_display_changed` | M | Undo: `setHomeDisplay(menuId, device, live.home[device])` → `:741-755` → `menu-home.ts:115-133`. A live value the device no longer takes is refused `menu.home_display_invalid` and shown. | 1 |
| `section_changed` on an include of another menu (what this menu's include fixes, or folder/direct) | M (fields from the parent's path, `menu-document.ts:716-733`), I (what the included menu changed) | Undo: `setIncludeFolder(listId, memberId, { showAsFolder: !live.direct, overrides })` → `:703-712` → `include-folder.ts:78-106`. `overrides` is the live node's `fixed` (or `{}`) when live showed a folder; when live showed it directly, `overrides` is left out so the stored ones stay hidden (`include-folder.ts:94-102` keeps them). Offered only when the included menu appears exactly once in this menu's own lists, live and now (`menu-document.ts:930-968` merges every copy into one change). | 2 |
| `product_added` | M, I | Undo: `removeSectionMember(listId, memberId)` → `:657-664` → `sections.ts:293-305`, when the product now has exactly one placement and it is in this menu's own lists. | 3 |
| `product_moved` | M, I | One difference only: a placement added → `removeSectionMember`; a placement removed, its list still there → `addSectionMember(listId, ref, position)`; one removed and one added → `moveSectionMembersInto(liveList, [{ listId, memberId }], position)` → `:666-675` → `sections.ts:360-409` (same menu, `:373-375`). More than one difference: **no Undo**. | 3 |
| `product_removed` | M, P (deleted), I | Undo: `addSectionMember(listId, ref, position)` when the live offer had one placement, in this menu's own lists, that list still exists, the menu holds the product nowhere now, and the live offer had no menu price and no variant menu price — removal reset those (`menu-structure.ts:160-209`), and one call cannot put them back. Otherwise **no Undo**. P (product deleted): **no link** (Q1). | 3 |
| `product_deleted` | P | **No Undo and no link** (Q1): saving a deleted product is refused `product.archived` (`product-editor.ts:132-135`). | 1 |
| `section_added` | M, I | An include added to this menu's own list → `removeSectionMember`, when every product reached through it was not live or is reached another way too. An own section moved here from another of this menu's lists → `moveSectionMembersInto` back. A new own section → `deleteSection` (`:622-628`, `sections.ts:200-251`) when nothing under it was live and no shortcut points into it. Otherwise **no Undo**. | 4 |
| `section_removed` | M, I | An include removed → `addSectionMember(listId, { kind: "section", sectionId }, position)` when the live include showed a folder fixing nothing (a new member gets that default; anything else needs a second write), and every product reached only through it had no live menu price. An own section moved away → `moveSectionMembersInto` back (the same write as its `section_added`). **An own section deleted: no Undo** — `createSectionIn` makes a new id and none of its members come back. | 4 |
| `order_changed` | M, I | Undo: `moveSectionMember(listId, memberId, to)` → `:693-701` → `sections.ts:307-317`, when moving one member puts the common members back in their live order. Otherwise **no Undo**. | 5 |
| `home_shortcuts_changed` | M | Undo: exactly one of `removeHomeShortcut`, `addHomeShortcut(ref, position)`, `moveHomeShortcut`, or replace (`POST …/shortcuts/:memberId/replace`, `:768-775`) restores the whole live row of tiles, and no live tile it touches is an empty slot (a target the live version did not hold, `menu-document.ts:221-231`). Otherwise **no Undo**. | 5 |
| `extra_unit_changed` | P | Edit product (the item's product). | 1 |
| `extra_portion_changed`, `extra_max_quantity_changed` | P | Edit product, or Edit extras list (Q1): these two are set only in the extras-list form (`grep -l maxQuantity apps/dashboard/src/widgets/*.ts` finds only `extra-list-form.ts`). | 1 |

### Left without Undo when the work is done (to list in each PR and in the backlog)

1. Any this-menu change on a menu that has never been published — nothing live to go back to.
2. A dish whose change lists two or more variants' own menu prices — needs one write per variant,
   or the bulk route that also clears variants the change does not name.
3. A variant price that moved only because the dish's own menu price moved — undone by the dish's
   price change instead.
4. An include whose change covers two or more copies of the same included menu — one write per copy.
5. A product removed from more than one place, or whose list is gone, or that had its own menu
   price or variant prices — removing it reset those, and one write cannot set them again.
6. A product that moved in more than one way at once.
7. A new section that holds something that was live, or that a shortcut points into — deleting it
   would take the live things with it.
8. An include put back whose live version was shown directly or fixed a name, photo or colour, or
   whose products had their own prices here — needs a second write.
9. A deleted section — it cannot be recreated under its old id.
10. An order change that needs more than one move, and a shortcut change that needs more than one
    write or touches a slot that was empty when published.
11. Every shared-product and included-menu change, by the owner's scope (they get links instead).

---

## 3. New and changed words, English and Spanish (for the owner before landing)

All in `apps/dashboard/src/i18n/strings.ts` (English map, then the Spanish map further down the
same file). Reused keys are listed so the owner sees every word the feature shows.

| Key | English | Spanish | PR |
| --- | --- | --- | --- |
| `menu_preview.undo` (new) | Undo | Deshacer | 1 |
| `menu_preview.undoing` (new) | Undoing… | Deshaciendo… | 1 |
| `menu_preview.undone` (new) | Undone: {change}. | Cambio deshecho: {change}. | 1 |
| `menu_preview.undo_refused` (new) | Not undone. {reason} | No se ha deshecho. {reason} | 1 |
| `menu_preview.undo_name_taken` (new) | Another menu is now called {name}. | Otra carta se llama ahora {name}. | 1 |
| `menu_preview.edit_menu` (new) | Edit {menu} | Editar {menu} | 1 |
| `product.edit` (reused) | Edit product | Editar producto | 1 |
| `extras.edit` (reused, only if Q1 says so) | Edit extras list | Editar lista de extras | 1 |

`{change}` is the change's own bullet text as the list shows it (for example "Undone: Burger price
changed from €12.00 to €13.00."). `{reason}` is the refusal's existing message (`codeMessage`),
except `menu.name_taken`, which has no message of its own outside the menu form
(`menus-screen.ts:1415-1417` maps it to a field text that says "Enter a different name") and so
uses `menu_preview.undo_name_taken`. An Undo refused after the person has left the menu is
named beside the list with the existing `menus.change_not_saved` ("Your change to {name} was not
saved. {reason}" / "No se ha guardado tu cambio en {name}. {reason}"), as a late publish
refusal is (`menus-screen.ts:1467-1473`).

---

## 4. Owner questions

**Q1 — three changes where the scope's link cannot do the job.** (a) An extras item's portion or
maximum quantity is labelled "shared product", but only the extras-list form can change it; the
product editor cannot. (b) An included menu's price change is set on that menu's Price overrides
tab, not its Structure tab. (c) A deleted product's editor refuses every save.
**Recommended:** (a) **Edit extras list**, to `/manage/modifiers/view/extras/list/<listId>`; (b)
**Edit {menu}** to that menu's `…/view/prices` for `price_changed` and variant-price
`product_changed` from an included menu, Structure for every other included change; (c) no link
on a deleted product. If the owner prefers the scope as written, every P change links to the
product editor and every I change to Structure; only the destination strings change.

The words in section 3 also go to the owner before PR 1 lands.

---

## 5. Pull requests

| PR | What it delivers |
| --- | --- |
| 1 | Undo end to end for menu name, a dish's menu price, one variant's menu price, an own section's name/photo/colour and Home display; Edit product / Edit {menu} links on every shared and included change. |
| 2 | Undo for what this menu's include of another menu fixes, and folder/direct. |
| 3 | Undo for products added, moved and removed in this menu's own lists. |
| 4 | Undo for includes added and removed, own sections moved, and a new own section with nothing live under it. |
| 5 | Undo for one-move order changes and one-write shortcut changes; the A353 backlog entry is deleted and the left-out list becomes its own entry. |

Shared per-task checks (run by every task, in addition to its own): `pnpm format:check`; the
touched package's `pnpm --filter <pkg> typecheck`; read the `Tests` count of every Vitest run (a
run without one proves nothing). Before any browser run, check headroom with
`memory_pressure | grep free`.

The planner's public shape, fixed in Task 1.1 and extended by later PRs:

```ts
export interface UndoStructureNode {
  memberId: string;
  ref: MemberRef;
  children?: readonly UndoStructureNode[];
  ownerMenuId?: string;
  includedMenuId?: string;
  folder?: IncludeFolder;
}
export interface MenuUndoInput {
  preview: MenuPreview;
  /** From PR 2 on. */
  structure?: { rootSectionId: string; nodes: readonly UndoStructureNode[] } | null;
  /** From PR 5 on: the working Home page with member ids. */
  home?: MenuHome | null;
}
export type MenuChangeAction =
  | { kind: "undo"; command: MenuUndoCommand }
  | { kind: "edit_product"; productId: string }
  | { kind: "edit_menu"; menuId: string; tab: "structure" | "prices" }
  | { kind: "edit_extras_list"; listId: string }
  | { kind: "none" };
export function menuChangeAction(input: MenuUndoInput, change: MenuChange): MenuChangeAction;
```

`MenuUndoCommand` is a union whose members name the dashboard client method they map to and carry
that method's arguments: PR 1 has `renameCatalogue`, `updateMenuItem`, `setMenuVariantPrice`,
`updateSection`, `setHomeDisplay`; PR 2 adds `setIncludeFolder`; PR 3 `removeSectionMember`,
`addSectionMember`, `moveSectionMembersInto`; PR 4 `deleteSection`; PR 5 `moveSectionMember` and
the four shortcut writes. The real-database tests run each command through the catalogue
function its route calls (the route and line are in section 2), using a mapping kept in the test
file; the dashboard maps the same command to the client method (Task 1.4). `"none"` carries no
reason the user sees; tests assert it by kind.

### PR 1 — scalar Undo, and the links

#### Task 1.1 — the planner's routing, and the purity guard

Files: create `packages/catalogue/src/menu-undo.ts`, `packages/catalogue/src/menu-undo.test.ts`;
modify `scripts/dashboard-browser-purity.test.ts` (add `"packages/catalogue/src/menu-undo.ts"`
to `SUBPATHS`).

- [ ] Failing tests first (`menu-undo.test.ts`, built `MenuPreview` values, no database): a P
  `product_changed` → `edit_product` with its `productId`; an `extra_unit_changed` →
  `edit_product`; `extra_portion_changed` and `extra_max_quantity_changed` → as Q1 settles; a
  `product_deleted`, and a `product_removed` credited to P → `none` (Q1c); an I `order_changed`
  with `includedMenu` → `edit_menu` Structure; an I `price_changed` → `edit_menu` prices (Q1b);
  an I change without `includedMenu` → `none`; every M kind when `preview.live === null` →
  `none`; every M kind not yet built → `none`. Expected failure: the module does not exist, then
  each assertion fails until its branch is written.
- [ ] Implement with `import type` lines only (Decision 2).
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.test.ts`
- [ ] Root guard: `pnpm exec vitest run scripts/dashboard-browser-purity.test.ts` — expect the new
  entry's cases to pass. Prove it by deletion: add a throwaway `import "./menu-structure.js";`
  to `menu-undo.ts`, watch the reachable case fail naming `drizzle-orm`, remove it.

#### Task 1.2 — rename, Home display, own section: real database

Files: create `packages/catalogue/src/menu-undo.db.test.ts`; modify `menu-undo.ts`.

Set-up for every case: `useCatalogueDb()` (`packages/catalogue/test/fixtures.ts:210-212`, a
real `useVenueDb`) and `menusFixture` (`test/menus-fixture.ts:54`; Dinner owns the section
Mains). Publish with `previewMenu` then `publishMenu(tx, menuId, hash, "person-1")`, as
`menu-publication.test.ts:142-145` does. Make the change under test **and one unrelated change**
on the same menu. Read `previewMenu`, find the change, take `menuChangeAction`, run its command
through the catalogue function (mapping in the test file), read `previewMenu` again. Each case
asserts: the change's id is gone; every other change id, and its text fields, is unchanged; the
other menu's preview is unchanged; and the stored fields the command did not name are unchanged.

- [ ] `menu_renamed`: rename Dinner, also change Burger's menu price. Expected failure: action is
  `none`. Also: a refusal case — another menu has taken the old name; the write throws
  `menu.name_taken` (assert the code outside the transaction) and the change is still listed.
- [ ] `home_display_changed`: change handheld columns and tiles; the till's display and the
  shortcuts are unchanged after.
- [ ] `section_changed` (own): change Mains' names and colour together; one call puts both back;
  its photo is untouched. The photo field: `mediaImageExists` answers false when the media table
  is absent (`sections.ts:65-66`), and `useCatalogueDb` loads only the core and catalogue
  migrations, so this suite may be unable to store any section photo. Check first; if it cannot,
  put the photo cases (a photo added since → put back to none; a live photo deleted from the
  library since → refused `menu_section.invalid`, change still listed) in an `apps/server`
  real-database suite that already loads the media migrations, and say in the PR which suite
  holds them.
- [ ] An I `section_changed` (the included Drinks menu renamed) stays `edit_menu`.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 1.3 — a dish's menu price and one variant's: real database

Files: `menu-undo.ts`, `menu-undo.db.test.ts`. Fixture: Lunch sets its own price for Lemonade;
Lemonade has one variant, Large (`menus-fixture.ts:47-49,78-93,168`). Add a second variant inside the
test where a case needs two.

- [ ] Dish price, three live values: a price, no price (inherits), and `"0.00"` — each restored
  exactly (`null` stays `null`, zero stays zero).
- [ ] The remainder case (Decision 5): live has no menu price; set one and also change the
  product's own price; after Undo the M change is gone and a P `price_changed` is listed.
- [ ] One variant's menu price changed → `setMenuVariantPrice` with the live value; the other
  variant's price row is untouched.
- [ ] Two variants changed → `none`. The dish's menu price changed while a variant inherits it →
  the variant's M change is `none`, and undoing the dish's price change removes both.
- [ ] A variant made Inactive after the preview → the write throws `product.variant_not_found`
  and the change stays listed.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 1.4 — the dashboard's command sender

Files: create `apps/dashboard/src/api/menu-undo.ts` (`sendMenuUndo(api, command)` and
`undoRefusalText(error, command)`) and `apps/dashboard/src/api/menu-undo.test.ts`.

- [ ] Failing test first: for each PR 1 command, a recording fake `DashboardApi` sees exactly one
  call, to the named method, with the command's arguments in order. `undoRefusalText` gives
  `menu_preview.undo_name_taken` filled with the name for `menu.name_taken`, and `codeMessage`
  for any other code (try `menu_section.invalid` and `menu.home_display_invalid`).
- [ ] Add the six new strings (section 3) to both maps of `strings.ts` here, so later tasks can use them.
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/api/menu-undo.test.ts`
- [ ] Root guard: `pnpm exec vitest run scripts/english-only.test.ts`.

#### Task 1.5 — the Preview's links (no writes)

Files: `apps/dashboard/src/widgets/menu-preview.ts`; create
`apps/dashboard/src/widgets/menu-preview.undo.test.ts`; extend `menu-preview.a11y.test.ts`.

- [ ] Failing browser tests: a P change shows **Edit product** with
  `href=/manage/catalogue/product/<id>` and, on a plain click, sends `wt-edit-product` with
  `{ productId }` (reuse `openProduct` from `menu-publish-warnings.ts:29-40` by exporting it); a
  click with a modifier key is left to the browser. An I change shows **Edit {menu}** with that
  menu's Structure (or Prices, Q1b) address. A deleted product shows neither. An M change shows
  no Edit link. The links sit after View and before Hide.
- [ ] Each row's actions come from `menuChangeAction({ preview: this.preview }, change)`.
- [ ] A11y: add the three link states to the existing light/dark loop
  (`menu-preview.a11y.test.ts:91-120`).
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.undo.test.ts src/widgets/menu-preview.a11y.test.ts src/widgets/menu-preview.test.ts`
- [ ] Root guards: `scripts/primary-coloured-text.test.ts`, `scripts/style-token-names.test.ts`.

#### Task 1.6 — the Undo action in the widget

Files: `menu-preview.ts`, `menu-preview.undo.test.ts`, `menu-preview.a11y.test.ts`.

The control is a native `<button type="button" class="undo">` drawn like the row's links
(`color: var(--wt-color-primary-text)`, underline, no border or background, `font: inherit`,
focus ring from `--wt-focus-ring`), as `menu-patch-dialog.ts:222-246` draws its link-styled
button. It is a button because it writes; an `<a>` would open a new tab on a middle click and
undo nothing. New properties: `undoing: string | null` (the change whose Undo is out),
`undoBlocked: boolean` (another write or a publish is out), `undoRefusals: Record<string, string>`
(change id → message), `undoResult: string | null` (the bullet text of the last success).

- [ ] Failing tests, one at a time:
  - Undo is drawn only where `menuChangeAction` answers `undo`, never on a P or I change, and not
    when `preview.live === null`.
  - A click, Enter and Space each send one `wt-menu-undo` with `detail: { changeId, change: <bullet text> }`,
    `bubbles: true, composed: true`, after `event.stopPropagation()` on the click. Use
    `userEvent.click` and `userEvent.keyboard`, not `element.click()`.
  - While `undoing === id`: text **Undoing…**, `aria-disabled="true"`, primary-text colour kept,
    and a second click sends nothing. While `undoBlocked`: `aria-disabled="true"`, muted colour
    (`--wt-color-text-muted`), and a click sends nothing.
  - A refusal for the id: a `role="alert"` paragraph inside that bullet reading
    "Not undone. {reason}"; the Undo keeps focus and points at it with `aria-describedby`.
    It is not cleared by a new preview that still lists the change.
  - `undoResult`: one `role="status"` line under the changes heading, "Undone: {change}.".
  - Focus: when the bullet whose Undo had focus disappears from a new preview, focus goes to the
    first remaining Hide link, or else the changes pane (`data-test="changes-pane"`), as `#hide`
    does (`menu-preview.ts:352-365`); if focus had moved elsewhere, it is left alone.
  - No dialog opens.
- [ ] Undo's accessible name is "Undo", described by the bullet's text (`aria-describedby` on the
  bullet's `<span>`).
- [ ] A11y in both themes: ready, undoing, blocked, refused, and with the success line.
- [ ] Run the three widget suites as in Task 1.5. Root guards as in Task 1.5, plus
  `scripts/native-form-fields.test.ts` (expect no new finding: a button is not a field).

#### Task 1.7 — the screen

Files: `apps/dashboard/src/screens/menus-screen.ts`; create
`apps/dashboard/src/screens/menus-screen.preview-undo.test.ts` (the existing
`menus-screen.test.ts` is 12,883 lines).

`#undo(changeId, change)`: return unless `menuId`, `preview` and no `previewError`; return when
`busy` or this menu is publishing. Plan with `menuChangeAction({ preview, structure })`; return
unless `undo`. Set `busy`, `undoing`, clear this change's refusal and `undoResult`. Run in
`#priceWrites.run(<price key>)` for the two price commands, else `#writes.run("undo:" + menuId)`:
`await sendMenuUndo(this.api, command)`; on a refusal, while the same menu is open, store
`undoRefusals[changeId] = undoRefusalText(…)`, else set `memberError` with
`menus.change_not_saved`; on success, while the same menu is open, set `undoResult`; after a
rename also `await this.#watchMenus().catch(() => undefined)` as `#saveMenu` does
(`menus-screen.ts:1427`); then `await this.#refresh()`; always clear `busy` and `undoing`.
`#select` (`:1280`) clears `undoRefusals`, `undoResult`, `undoing`; `#publish` (`:1442`) clears
`undoResult`. A refreshed preview drops refusals whose id it no longer lists, nothing else.
Pass `undoing`, `undoBlocked = busy || publishing.has(menuId)`, `undoRefusals`, `undoResult`
to `dashboard-menu-preview` in `#renderPreview` (`:3029-3058`) and listen for `wt-menu-undo`.

- [ ] Failing tests with a fake API (pattern: `menus-screen.home-columns.test.ts`), one at a time:
  - A rename Undo calls `renameCatalogue` once with the live name, then the preview is read again,
    the change is gone, and "Undone: …" shows; the menu list is read again.
  - A price Undo queued behind an unanswered Price overrides save of the same row runs after it.
  - A refusal (`menu_section.invalid` on a photo): the change stays, the message is beside it, no
    success line.
  - A write that succeeds followed by a failed re-read: the success line stays and the preview's
    read error shows; nothing says the Undo failed.
  - Two quick clicks send one write.
  - Leaving the menu while the write is out: the refusal is named beside the list; a success
    shows nothing on the other menu.
  - A live feed snapshot arriving while a refusal is shown keeps the refusal.
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.preview-undo.test.ts src/screens/menus-screen.heading.test.ts`

#### Task 1.8 — contract, backlog, look, finish

- [ ] `docs/developers/design-system.md` Preview contract (`:5386-5407`): one paragraph naming the
  actions per source, Undo's states, where its refusal and success show, and that it never asks
  for confirmation; point at `menu-preview.undo.test.ts`.
- [ ] `docs/backlog/catalogue.md` A353 entry and its `docs/backlog.md` line: replace the
  PARKED note with what PR 1 built and what PRs 2–5 will add; drop the pointer to the old local
  branch. Ask the owner before deleting `feat/menu-preview-undo` and its worktree.
- [ ] LOOK: start the stack with `wa-wt demo waitron-feat-a353-preview-undo`. Publish a menu,
  then make one change of each PR 1 kind plus a shared-product and an included-menu change.
  Screenshot the Preview in English and Spanish, light and dark, at 1280 and 390 wide (eight
  shots), plus one with a refusal and one with the success line. Keep them in a scratch folder
  outside the repository and show them to the owner; never commit them.
- [ ] The PR description lists every kind left without Undo (section 2) and the section 3 words.
- [ ] Tell the owner the branch is ready for `finish-branch`. It touches no money path, fiscal
  record, migration or permission; whether the dashboard importing a new catalogue module counts
  as a cross-package contract (the full review path) is `finish-branch`'s call, not this plan's.

### PR 2 — an include's own presentation

#### Task 2.1 — planner and real database

Files: `menu-undo.ts`, `menu-undo.test.ts`, `menu-undo.db.test.ts`. Fixture: Lunch includes Drinks
once (`menus-fixture.ts:111`).

- [ ] Failing cases, each run through `setIncludeFolder` (`include-folder.ts:78-106`):
  fixed names and colour put back together; a fixed photo cleared back to following;
  folder → direct put back (overrides left out, the stored ones still stored after);
  direct → folder put back with the live `fixed`; a language switched off since is kept;
  Drinks included twice in Lunch's own lists and both copies changed → `none`;
  an I change on the same section (Drinks renamed in its own menu) stays `edit_menu`.
- [ ] Planner finds `listId` and `memberId` from `input.structure`: the list is the parent path's
  last section (or `rootSectionId`), the member is that list's child whose `ref.sectionId` matches.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 2.2 — dashboard

Files: `api/menu-undo.ts` (+ test), `widgets/menu-preview.ts` (new `structure` property, passed
to the planner), `screens/menus-screen.ts` (pass `this.structure`; it is always read with the
preview, `menus-screen.ts:1055-1061`), `menus-screen.preview-undo.test.ts`.

- [ ] Failing tests: the sender maps `setIncludeFolder`; the widget draws Undo on an include's M
  change only once the structure is present; the screen sends one `setIncludeFolder` with the
  live input and reads again.
- [ ] Focused runs as in Tasks 1.4–1.7; design-system line; short LOOK of an include change in
  both languages and themes; ready for `finish-branch`.

### PR 3 — products in this menu's own lists

Shared helper (Task 3.1 writes it): resolve a document path (section ids from the root) to the
structure list it names and its stored children; a path is "own" when no node on it has
`includedMenuId`. Positions for an add are counted in the stored list (which holds products no
version shows, `menu-structure.ts:82-100`): just after the nearest earlier live sibling still in
the list, else first.

#### Task 3.1 — `product_added` and `product_moved`

- [ ] Failing real-database cases: a product added once to Dinner's Mains → `removeSectionMember`;
  added in two places → `none`; added only through an include → stays `edit_menu`. Moves: added
  a second place → remove that one; removed from one of two places → `addSectionMember` at the
  live position; moved from Mains to the top level → `moveSectionMembersInto` back, its menu price
  kept (it never stopped being reached); moved in two ways → `none`. Every case: the Lunch preview
  is unchanged and an unrelated change on Dinner stays.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 3.2 — `product_removed`

- [ ] Failing cases: removed from its one own place, no own prices → `addSectionMember` at its
  live position and the order around it matches live; removed while it had its own menu price →
  `none`; its list deleted since → `none`; still held somewhere in the structure → `none`;
  removed from an included menu → `edit_menu`; deleted product → `none`.

#### Task 3.3 — dashboard

Files: `api/client.ts` (`addSectionMember(id, ref, position?)`, sending `position` only when
given — the route already reads it, `catalogue-api.ts:637-646`), its contract test,
`api/menu-undo.ts` (+ test), `menus-screen.ts`, `menus-screen.preview-undo.test.ts`.

- [ ] Failing tests: existing `addSectionMember` callers still send `{ ref }` alone; the sender
  maps the three structural commands; a structural Undo runs in `#writes.run(<listId>)`, so it
  waits behind a Structure write to the same list still out.
- [ ] Focused runs; design-system line; LOOK; ready for `finish-branch`.

### PR 4 — sections and includes

#### Task 4.1 — includes added and removed

- [ ] Failing real-database cases: an include of a third menu added to Dinner → `removeSectionMember`;
  the same when one of its products is also on Dinner directly (the product stays, prices kept);
  when one of its products was live only through a path removed since → `none`. Removing Drinks
  from Lunch → `addSectionMember` puts it back at its live position, Lemonade's own price on
  Lunch is reset by the removal so this case is `none` (Lunch sets Lemonade's price,
  `menus-fixture.ts:47-49,168`); a fixture without prices restores it whole. A live include shown
  directly or fixing a field → `none`.

#### Task 4.2 — own sections moved, added, deleted

- [ ] Failing cases: Mains moved under a new section and back — both the `section_added` and the
  `section_removed` change offer the same `moveSectionMembersInto` and one call clears both, plus
  the products-moved changes it caused; a new empty section → `deleteSection`; a new section
  holding only new products → `deleteSection`; a new section holding a live product moved in →
  `none`; a new section a shortcut points into → `none`; Mains deleted → `none`.

#### Task 4.3 — dashboard

- [ ] Sender cases for `deleteSection`; screen runs both in `#writes.run(<listId>)`; focused runs;
  design-system line; LOOK; ready for `finish-branch`.

### PR 5 — order and shortcuts, and closing the item

#### Task 5.1 — `order_changed`

- [ ] Failing real-database cases on Dinner's top level and inside Mains: one member moved →
  `moveSectionMember(listId, memberId, to)` with `to` in the stored list, and the common members'
  order matches live after; a member added and the rest unmoved → the order change is `none`
  only if it is listed at all (check what `menu-document.ts:1131-1155` emits first); two members
  swapped far apart (needs two moves) → `none`; an include and an own section as the moved member.

#### Task 5.2 — `home_shortcuts_changed`

- [ ] Planner takes `input.home` (`MenuHome`, `section-types.ts:75-80`; the document's tile `i`
  is the stored tile `i`, `menu-document.ts:221-231`). Failing cases for each single write:
  one tile added → remove; one removed → add at its position; one moved → move; one replaced →
  replace; two edits → `none`; the touched live tile was an empty slot → `none`.

#### Task 5.3 — dashboard, and the Home read on the Preview tab

The Preview tab reads `structure` and `preview` only (`menus-screen.ts:1055-1061`), and leaving
the Home tab drops the Home read (`#showView`, `:1249-1262`, calls `#releaseHome`).
- [ ] Before editing, trace every reader of `#menuReadParts`, `menuHome`, `homeLoadError`,
  `homeError` and `#releaseHome` (`#menuReadFailed`, `#applyMenuRead`, `#watchMenu`, `#watchHome`,
  `#rereadHome`, `#renderHome`, `#renderHomePreview`) and write down what each does when Home is
  also read on the Preview tab. Then read Home on Preview too, and keep `homeError` and
  `homeFieldErrors` cleared when leaving the Home tab.
- [ ] Failing tests: the Preview tab's read asks for `home`; a Home read failure on the Preview
  tab hides only the shortcut Undo; client gains `addHomeShortcut(menuId, ref, position?)` and
  `replaceHomeShortcut(menuId, memberId, ref)` for the existing routes (`catalogue-api.ts:757-775`),
  with contract tests; sender cases; screen runs a shortcut Undo in `#writes.run("home:" + menuId)`
  as `#shortcutWrite` does (`:1863-1880`).
- [ ] Run `menus-screen.home-tab.test.ts` and `menus-screen.home-shortcuts.unsaved.test.ts` as well.
- [ ] Backlog: delete the A353 entry; add one short entry in the same area listing what is left
  without Undo (section 2), each with its reason. Design-system line; LOOK; ready for
  `finish-branch`.
