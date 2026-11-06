# A353 — Undo on the Preview's change list: implementation plan

> **For implementers:** dispatch each task as `subagent_type: "implementer"`. Read
> `superpowers:test-driven-development` first: every task starts with a failing test you watch
> fail for the reason it names, then the smallest change that passes it. One task per dispatch.
> An implementer past about 150 tool calls with the task unfinished stops at a passing (or
> cleanly failing) point, commits, and returns a handover.

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
`main` at `16207675ad`, except: the `grep`s whose results are quoted; a shell walk of the
relative imports reachable from `menu-document-types.ts`, `section-types.ts` and `menu-types.ts` in
`packages/catalogue/src` (17 files reached; none contains `from "@waitron/db`, `drizzle-orm`,
`hono`, `pg`, `node:` or `../index.js`); and the plan review's two probe suites
(`/Users/clintongormley/waitron-campaign-c/a353-plan-review.md`, "What was run"), whose results
this plan cites as "the review ran". Each "Expected" below is a prediction until its task runs it.

---

## 1. Decisions and their receipts

### Decision 1 — no route change, no new route, no server-side freshness check

The rule: an Undo needs a freshness check only if the ordinary save of the same field has one,
or if a stale Undo could do something a stale ordinary save of the same form could not.

- **No ordinary save on these routes checks freshness.** Each route parses the body and calls
  the catalogue function inside `gated`, which authorizes and runs one `withTransaction`, then sets
  the `x-waitron-menu-revision` response header; it compares nothing
  (`apps/server/src/catalogue-api.ts:809-819`). The routes: menu name
  `PATCH /management-api/catalogues/:id` (`:1010-1028`, the menu form's own route); a dish's menu
  price `PATCH …/items/:itemId` (`:1207-1233`); one variant's menu price
  `PATCH …/variants/:variantId` (`:1257-1276`); a section `PATCH /management-api/sections/:id`
  (`:614-620`); an include's folder `PUT …/members/:memberId/folder` (`:703-712`); Home display
  `PATCH …/home-display` (`:741-755`); members add / remove / move-in / position
  (`:637-646`, `:657-664`, `:666-675`, `:693-701`); section delete (`:622-628`); shortcuts
  (`:757-793`). The dashboard's client sends no revision on any of them
  (`apps/dashboard/src/api/client.ts:2985-2987`, `:3050-3055`, `:3119-3145`, `:3372-3404`,
  `:3426-3436`, `:3024-3047`).
- **The only freshness checks in this area** are publish's `expectedHash`
  (`catalogue-api.ts:1097-1109` → `packages/catalogue/src/menu-publication.ts:638`, which throws
  `menu.changed_since_preview`) and the live patch's `baseVersionId` (`client.ts:3070`).
  Undo publishes nothing.
- **Each Undo sends what an ordinary save on the same route sends, or less.** The section form
  sends every presentation field (`apps/dashboard/src/screens/menus-screen.ts:1712-1738`); an Undo
  sends only the fields its change names. The Home display controls save one field at a time
  (`menus-screen.ts:2028-2064`, called at `:3141,3155,3165`); an Undo sends only the fields whose
  live and current values differ. PR 3 sends `position` on `POST …/members`, which no ordinary
  save sends but the route already reads (`:637-646`).
- **Three places where an Undo could do more than a stale ordinary save, each closed in the
  dashboard:** a publish racing an Undo that is still out (Publish and Schedule are blocked while
  an Undo is out, Task 1.10); a Home display Undo racing a Home save still out (Undo is blocked
  while one is, Task 1.9); and deleting a section with things in it, which the ordinary delete
  confirms first (`menus-screen.ts:3439-3442,3500-3512`) — so Undo deletes only an **empty** new section
  (PR 4).
- **The bulk variant-price route is never used.** `PUT …/items/:itemId/variants`
  (`catalogue-api.ts:1244-1255` → `packages/catalogue/src/variants.ts:381-427`) deletes the menu
  price of every Active variant it is not sent, and no screen calls it (`grep '/variants\`'
  apps/dashboard/src/api/client.ts` finds nothing), so a stale call could clear a price no
  ordinary save touches.
- **The preview an Undo is planned from is a live query** — `MenuReadController` reads through
  `api().liveData` and re-reads on change (`apps/dashboard/src/api/menu-read-controller.ts:44-52,120-138`).

PR 1 does change catalogue code that builds the change list (Tasks 1.1 and 1.2: who a price change
is credited to, and one optional field on a price change). Neither is a route or a table.

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
so Task 1.3 adds the file to that guard's `SUBPATHS` list (a single `.ts` entry is allowed:
`:18-22,33-43`). The shell walk above predicts the entry passes.

### Decision 3 — drafts: Undo stages nothing, and nothing staged can be behind it

Every staged draft reachable from the menu editor lives in a modal: the menu and section forms
(`section-details-form.ts:136,255`), the include form (`include-folder-form.ts:328`), the Move,
shortcut and add-products windows (`menus-screen.ts:2294,2937,3266,3532,3667`), and the
schedule form on the Preview tab itself (`menu-publications.ts:465,712,770`). `wt-modal` extends
`wt-dialog` (`packages/ui/src/components/wt-modal.ts:6`), which opens with `showModal()`
(`wt-dialog.ts:381-389`), so while any of them is open the Preview's list behind it cannot be
activated. The Price overrides fields save on Enter or when focus leaves them, and the Home
display controls save at once (the review read `menus-screen.ts:2028-2062`). The Preview widget
holds no draft scope of its own (`grep draftScopeFor apps/dashboard/src/widgets/menu-preview.ts`
finds nothing). So Undo takes no draft scope and adds no `*.unsaved.test.ts`. The links that
leave the page go through the same handlers as today's links of that kind.

Undo still follows the screen's write discipline: it sets `busy`, runs inside the screen's write
queue, and finishes with `#refresh()` (`menus-screen.ts:1263-1265`), as `#saveSection`
(`:1712-1738`) and `#saveInclude` (`:1740-1760`) do. A price Undo runs in `#priceWrites`
(`:851`) **under its own scope, `"undo:" + <row key>`**, never under the Price overrides tab's
row key: the tab clears a field's "saving" mark only when that key's count is down to one
(`:2070-2075`), so an Undo counted under the same key would leave the mark set for good (the
review ran this against the real `ListWriteQueue`). The queue is one chain whatever the scope
(`apps/dashboard/src/widgets/section-writes.ts:38-49`), so the Undo still runs after a save that
is out.

### Decision 4 — the guide gains nothing

No guide page describes the Preview's change list: `grep -rn -i preview
apps/server/src/guide/en/*.md` hits only `appearance.md`, `content-and-images.md:65,244` and
`products.md:29,49-51,324`, none about the list, and `apps/dashboard/src/help-guide.ts` maps no
menus key. An Undo beside each change is found by trying it, so by the house rule it earns no
sentence. `docs/developers/design-system.md`'s Preview contract (`:5386-5407`) does get the new
actions, in the PR that adds them.

### Decision 5 — a price Undo is offered only when it puts back the whole live price

One price change credited to this menu can come from two edits: this menu's own price and the
price it inherits (the product's own, or an included menu's). Writing back this menu's own stored
setting restores the whole live price exactly when:

- the live version had a price of its own on this menu — an own price always wins
  (`packages/catalogue/src/menu-combine.ts:20-24,47`), so after the write the price is the live one;
  or
- the live version had none, and the price this menu would inherit now equals the live price.

The preview document cannot show the second: while this menu sets a price, the offer's price is
that price (`operations.ts:615-625`) and the frozen offer drops `combined`
(`menu-document-types.ts:35-49`). So Task 1.2 adds one optional field to a this-menu
`price_changed` change, `inheritedPrice`, taken from the proposed combined price's `otherwise`
when this menu sets a price (`diffEntries` already receives the combined offers,
`menu-publication.ts:379`). In every other case the price change has **no Undo**. Both sides are
pinned with real-database cases in Task 1.5.

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
`/manage/menus/menu/<includedMenu.id>/view/structure` (Q1b for prices), with no link when the
change carries no `includedMenu`. **No Undo is offered anywhere when the menu has never been
published** (`preview.live === null`): there is no live value to put back.

| Kind | Sources | What M gets, the existing write, and when it is offered | PR |
| --- | --- | --- | --- |
| `menu_renamed` | M | Undo: `renameCatalogue(menuId, live.menuName)` → route `:1010-1028` → `updateMenuDetails` with only `name` (`operations.ts:849-887`, checks the name is free at `:879`). Always. | 1 |
| `price_changed` | M, P, I | Undo: `updateMenuItem(menuId, <current menu-item id>, { grossPrice: live.grossPrice })` → `:1207-1233` → `updateMenuItem` (`operations.ts:408-417`). The current item id is the key of the preview document's offer for that product. **Only when Decision 5 holds**; otherwise no Undo. Task 1.1 first makes every change of this menu's own price credited to M. | 1 |
| `product_changed` | M (always `["variants"]`), P, I | Undo: `setMenuVariantPrice(menuId, itemId, variantId, live.menuPrice)` → `:1257-1276` → `variants.ts:433-460` — **only when exactly one Active variant's own menu price differs, no variant moved only because the dish's own menu price moved** (`menu-document.ts:840-850`; those go with the price change's Undo), **and either the live variant had a price of its own on this menu, or what it would charge now without one equals its live price** (otherwise the variant, inheriting again, still differs and is listed again). That price comes from the change's `inheritedVariantPrices` (review fix, below Task 1.2). Two or more differing variants: **no Undo**. | 1 |
| `section_changed` on this menu's own section (no `includedMenu` on the node) | M, I | Undo: `updateSection(sectionId, patch)` → `:614-620` → `sections.ts:181-198`, the patch holding only the change's fields from the live node: `names` → `internalName` and `names`; `image`; `color`. For `names`, **only when every content language switched off now has the same name live and now**: the merge refuses a switched-off language unless the stored text matches exactly (`optional-translations.ts:36-43`; the review ran both refusing cases), so the planner is given the enabled languages. Otherwise **no Undo**. | 1 |
| `home_display_changed` | M | Undo: `setHomeDisplay(menuId, device, <only the fields where live and current differ>)` → `:741-755` → `menu-home.ts:115-133`. A live value the device no longer takes is refused `menu.home_display_invalid`. Not while a Home save is out. | 1 |
| `section_changed` on an include of another menu (what this menu's include fixes, or folder/direct) | M (fields from the parent's path, `menu-document.ts:716-733`), I (what the included menu changed) | Undo: `setIncludeFolder(listId, memberId, { showAsFolder: !live.direct, overrides })` → `:703-712` → `include-folder.ts:78-106`. `overrides` is the live node's `fixed` (or `{}`) when live showed a folder; when live showed it directly, `overrides` is left out so the stored ones stay hidden (`include-folder.ts:94-102` keeps them). Offered only when the included menu appears exactly once in this menu's own lists, live and now (`menu-document.ts:930-968` merges every copy into one change), and, for fixed names, under the same switched-off-language rule as an own section (the same merge runs at `include-folder.ts:66`). | 2 |
| `product_added` | M, I | Undo: `removeSectionMember(listId, memberId)` → `:657-664` → `sections.ts:293-305`, when the product now has exactly one placement and it is in this menu's own lists. | 3 |
| `product_moved` | M, I | One difference only: a placement added → `removeSectionMember`; a placement removed, its list still there → `addSectionMember(listId, ref, position)`; one removed and one added → `moveSectionMembersInto(liveList, [{ listId, memberId }], position)` → `:666-675` → `sections.ts:360-409` (same menu, `:373-375`). More than one difference: **no Undo**. | 3 |
| `product_removed` | M, P (deleted), I | Undo: `addSectionMember(listId, ref, position)` when the live offer had one placement, in this menu's own lists, that list still exists, the menu holds the product nowhere now, and the live offer had no menu price and no variant menu price — removal reset those (`menu-structure.ts:160-209`), and one call cannot put them back. Otherwise **no Undo**. P (product deleted): **no link** (Q1c). | 3 |
| `product_deleted` | P | **No Undo and no link** (Q1c): saving a deleted product is refused `product.archived` (`product-editor.ts:132-135`). | 1 |
| `section_added` | M, I | An include added to this menu's own list → `removeSectionMember`, when every product reached through it was not live or is reached another way too. An own section moved here from another of this menu's lists → `moveSectionMembersInto` back. A new own section → `deleteSection` (`:622-628`, `sections.ts:200-251`) **only when it is empty now** (no members at any depth). Otherwise **no Undo**. | 4 |
| `section_removed` | M, I | An include removed → `addSectionMember(listId, { kind: "section", sectionId }, position)` when the live include showed a folder fixing nothing (a new member gets that default; anything else needs a second write), and every product reached only through it had no live menu price. An own section moved away → `moveSectionMembersInto` back (the same write as its `section_added`). **An own section deleted: no Undo** — `createSectionIn` makes a new id and none of its members come back. | 4 |
| `order_changed` | M, I | Undo: `moveSectionMember(listId, memberId, to)` → `:693-701` → `sections.ts:307-317`, when moving one member puts the common members back in their live order. Otherwise **no Undo**. | 5 |
| `home_shortcuts_changed` | M | Undo: exactly one of `removeHomeShortcut`, `addHomeShortcut(ref, position)`, `moveHomeShortcut`, or replace (`POST …/shortcuts/:memberId/replace`, `:768-775`) restores the whole live row of tiles, and no live tile it touches is an empty slot (a target the live version did not hold, `menu-document.ts:221-231`). Otherwise **no Undo**. | 5 |
| `extra_unit_changed` | P | Edit product (the item's product). | 1 |
| `extra_portion_changed`, `extra_max_quantity_changed` | P | Edit product, or Edit extras list (Q1a): these two are set only in the extras-list form (`grep -l maxQuantity apps/dashboard/src/widgets/*.ts` finds only `extra-list-form.ts`). | 1 |

### Left without Undo when the work is done (to list in each PR and in the backlog)

1. Any this-menu change on a menu that has never been published — nothing live to go back to.
2. A price change where writing back this menu's own setting would not bring back the whole live
   price — the price it inherits moved too.
3. A dish whose change lists two or more variants' own menu prices — needs one write per variant,
   or the bulk route that also clears variants the change does not name.
4. A variant price that moved only because the dish's own menu price moved — undone by the dish's
   price change instead; and a variant with no price here live whose Undo would leave it inheriting
   a price that moved since (the dish's, the product's own variant price, or an included menu's).
5. A section or include name change where a language switched off since has a different name —
   the save refuses a switched-off language it would change.
6. An include whose change covers two or more copies of the same included menu — one write per copy.
7. A product removed from more than one place, or whose list is gone, or that had its own menu
   price or variant prices — removing it reset those, and one write cannot set them again.
8. A product that moved in more than one way at once.
9. A new section that is not empty — deleting it would take more than this one change with it,
   without the confirmation an ordinary delete asks for.
10. An include put back whose live version was shown directly or fixed a name, photo or colour, or
    whose products had their own prices here — needs a second write.
11. A deleted section — it cannot be recreated under its old id.
12. An order change that needs more than one move, and a shortcut change that needs more than one
    write or touches a slot that was empty when published.
13. Every shared-product and included-menu change, by the owner's scope (they get links instead).
14. A Home display setting whose published value is outside the range allowed today is offered an
    Undo that is then refused with `menu.home_display_invalid` (its sentence says so). This happens
    only if a later release narrows the allowed range; no code change for it in PR 1.

**For PR 1's text.** An Undo changes the preview of any menu that INCLUDES this one, exactly as an
ordinary save of the same field does. The real-database tests check that an Undo leaves alone a
menu that does not include this one; none compares against an including menu.

---

## 3. New and changed words, English and Spanish (for the owner before landing)

All in `apps/dashboard/src/i18n/strings.ts` (English map, then the Spanish map further down the
same file; the Spanish screens call a menu "carta", `strings.ts:6914`). Reused keys are listed so
the owner sees every word the feature shows. "Hide" / "Ocultar" is the change's existing Hide
link (`menu_preview.hide_change`); the tab names are the existing `menus.tab_structure`
("Structure" / "Estructura") and `menus.tab_home` ("Home page" / "Página de inicio").

**Actions and results (PR 1)**

| Key | English | Spanish |
| --- | --- | --- |
| `menu_preview.undo` (new) | Undo | Deshacer |
| `menu_preview.undoing` (new) | Undoing… | Deshaciendo… |
| `menu_preview.undone` (new) | Undone: {change}. | Cambio deshecho: {change}. |
| `menu_preview.undo_refused` (new) | Not undone. {reason} | No se ha deshecho. {reason} |
| `menu_preview.undo_refused_change` (new) | Not undone on {menu}: {change}. {reason} | No se ha deshecho en {menu}: {change}. {reason} |
| `menu_preview.edit_menu` (new) | Edit {menu} | Editar {menu} |
| `product.edit` (reused) | Edit product | Editar producto |
| `extras.edit` (reused, only if Q1a says so) | Edit extras list | Editar lista de extras |

`{change}` is the change's own bullet text as the list shows it. `{menu}` is the name of the menu
the Undo was sent from, as the menu list names it when the refusal arrives, or the name it had
when the Undo was sent once it is gone from the list: shown on another menu, a reason such as
"This menu has been deleted…" would otherwise read as being about the menu open now. `{reason}` is
one of the sentences below; a code none of them names falls back to its existing `codeMessage`
text.

**Refusal sentences, one per foreseeable refusal (PR 1)** — each fills `{reason}` above.

| Key | Code it answers, and from which Undo | English | Spanish |
| --- | --- | --- | --- |
| `menu_preview.undo_name_taken` | `menu.name_taken`, menu name | Another menu is now called {name}. Rename that menu, then undo this again. | Otra carta se llama ahora {name}. Cambia el nombre de esa carta y vuelve a deshacer esto. |
| `menu_preview.undo_menu_gone` | `catalogue.not_found`, menu name and Home display | This menu has been deleted, so there is nothing to put back. | Esta carta se ha eliminado, así que no hay nada que deshacer. |
| `menu_preview.undo_item_gone` | `menu_item.not_found`, a dish's or a variant's price | {name} is no longer on this menu, so its price here cannot be put back. Add it to the menu again first, or hide this change. | {name} ya no está en esta carta, así que no se puede recuperar su precio aquí. Vuelve a añadirlo a la carta o oculta este cambio. |
| `menu_preview.undo_section_gone` | `menu_section.not_found`, a section | Section {name} has been deleted, so it cannot be put back. | La sección {name} se ha eliminado, así que no se puede recuperar. |
| `menu_preview.undo_section_invalid` | `menu_section.invalid`, a section, when the refusal names the `color` or `image` field, or names none and the Undo sent only those (otherwise the code's own message) | {name}'s published photo or colour can no longer be used. Change it on the Structure tab, or hide this change. | La foto o el color publicados de {name} ya no se pueden usar. Cámbialos en la pestaña Estructura u oculta este cambio. |
| `menu_preview.undo_language_off` | `content.translation_invalid`, a section | A language {name} was published in has been switched off since, so its name cannot be put back. Change it on the Structure tab, or hide this change. | Desde la publicación se ha desactivado un idioma del nombre de {name}, así que no se puede recuperar. Cámbialo en la pestaña Estructura u oculta este cambio. |
| `menu_preview.undo_display_invalid` | `menu.home_display_invalid`, Home display | The published {device} display setting is no longer offered. Choose one on the Home page tab, or hide this change. | El ajuste de pantalla publicado para {device} ya no se ofrece. Elige otro en la pestaña Página de inicio u oculta este cambio. |

`{device}` is the existing `home.device_handheld` / `home.device_till` ("Handheld" / "Terminal de
mano", "Till" / "Caja registradora"). An Undo refused once its change is no longer drawn (the
person has left this menu's Preview tab, or a fresh preview no longer lists the change) is named
beside the list with `menu_preview.undo_refused_change` ("Not undone on {menu}: {change}.
{reason}"), where a price save refused away from its tab is named
(`menus-screen.ts:2099-2109`). It does not reuse `menus.change_not_saved` ("Your change to {name}
was not saved."): that would say the change itself was lost, when only the Undo failed.

PRs 2–5 add their own refusal sentences to this section, in the same form, before each lands.

---

## 4. Owner questions

**Q1 — three changes where the scope's link cannot do the job.** (a) An extras item's portion or
maximum quantity is labelled "shared product", but only the extras-list form can change it; the
product editor cannot. (b) After Task 1.1, a price change credited to an included menu is one that
menu set or cleared (or a menu it includes did), and it is set on that menu's Price overrides tab,
not its Structure tab. A price set two includes down is credited to the outer include (Brunch
includes Lunch, which includes Drinks; Drinks sets a price → credited to Lunch), so "Edit {menu}"
opens the outer menu's Price overrides tab. A product's own price change seen only through an
include is credited to the included menu as well (A1373). (c) A deleted product's editor refuses
every save.
**Recommended:** (a) **Edit extras list**, to `/manage/modifiers/view/extras/list/<listId>`; (b)
**Edit {menu}** to that menu's `…/view/prices` for `price_changed` and variant-price
`product_changed` from an included menu, Structure for every other included change; (c) no link
on a deleted product. If the owner prefers the scope as written, every P change links to the
product editor and every I change to Structure; only the destinations change.

The words in section 3 also go to the owner before PR 1 lands.

---

## 5. Pull requests

| PR | What it delivers |
| --- | --- |
| 1 | Price changes credited to the menu that made them; Undo end to end for menu name, a dish's menu price, one variant's menu price, an own section's name/photo/colour and Home display; Edit product / Edit {menu} links on every shared and included change. |
| 2 | Undo for what this menu's include of another menu fixes, and folder/direct. |
| 3 | Undo for products added, moved and removed in this menu's own lists. |
| 4 | Undo for includes added and removed, own sections moved, and a new own section that is empty. |
| 5 | Undo for one-move order changes and one-write shortcut changes; the A353 backlog entry is deleted and the left-out list becomes its own entry. |

Shared per-task checks (run by every task, in addition to its own): `pnpm format:check`; the
touched package's `pnpm --filter <pkg> typecheck`; read the `Tests` count of every Vitest run (a
run without one proves nothing). Before any browser run, check headroom with
`memory_pressure | grep free`.

The planner's public shape, fixed in Task 1.3 and extended by later PRs:

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
  /** The content languages switched on now. */
  languages: readonly string[];
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
/** Every change's action, by change id, worked out once. */
export function menuChangeActions(input: MenuUndoInput): ReadonlyMap<string, MenuChangeAction>;
```

`MenuUndoCommand` is a union whose members name the dashboard client method they map to and
carry that method's arguments, plus the display names a refusal sentence needs (the variant's
name, the section's name), which the sender does not send: PR 1 has `renameCatalogue`,
`updateMenuItem`, `setMenuVariantPrice`, `updateSection`, `setHomeDisplay`; PR 2 adds
`setIncludeFolder`; PR 3 `removeSectionMember`, `addSectionMember`, `moveSectionMembersInto`; PR 4
`deleteSection`; PR 5 `moveSectionMember` and the four shortcut writes. The real-database tests
run each command through the catalogue function its route calls (the route and line are in
section 2), using a mapping kept in the test file; the dashboard maps the same command to the
client method (Task 1.6). `"none"` carries no reason the user sees; tests assert it by kind.

### PR 1 — crediting fix, scalar Undo, and the links

PR 1 changes the shape of a change the dashboard reads (Task 1.2's optional field), so treat it as
touching a cross-package contract when `finish-branch` weighs its review.

#### Task 1.1 — a price change is credited to the menu whose setting moved

Files: `packages/catalogue/src/menu-document.ts` (`diffEntries`, the `price_changed` push at
`:1007-1023`); tests in `packages/catalogue/src/menu-publication.test.ts` (real database).

Today the source comes from the proposed combined price before `grossPrice` is looked at, and an
included menu's candidate always carries `source.kind === "menu"` (`menu-combine.ts:25-33`), so
clearing this menu's own price on a product it reaches only through an include is credited to the
included menu (the review ran it: Lunch clears Lemonade's price → `included_menu`, Drinks; the
control, Dinner clearing Burger's, → `this_menu`).

The fix is one rule: when this menu's own price setting changed, the change is `this_menu`. Every
other price change is credited as before. Following the included candidate's `from` chain to tell
a product's own price change apart from an included menu's was tried and reverted: when an
included menu clears its own price the proposed price comes from the product, so that reading
credits the shared product where the included menu made the change, and the live published
document does not record where its price came from. A product's own price change that reaches a
menu only through an include, where no menu sets a price, therefore stays credited to the included
menu; that is backlog item A1373.

When this menu's own dish price moved and a variant's price follows the dish, the variant's
`product_changed` is credited to `this_menu` too (`productFields`, the `priceSource.kind ===
"parent"` branch); every other variant price change is credited as before.

- [ ] Failing cases first (`useCatalogueDb` + `menusFixture`, publish, change, `previewMenu`):
  1. Lunch clears its own price for Lemonade (reached only through Drinks) → `this_menu`.
  2. Control: Dinner sets, then clears, its own price for Burger → `this_menu` both times.
  3. Drinks sets its own price for Lemonade and Lunch sets none → `included_menu`, Drinks.
  4. Drinks sets 3.40 for Lemonade, Dinner is published, Drinks clears it → `included_menu`,
     Drinks.
  5. Brunch includes Lunch, Brunch is published, Lunch clears its 2.80 → `included_menu`, Lunch.
  6. Lemonade's variant has no price of its own, Lunch is published, Lunch clears its own price →
     the dish's `price_changed` and the variant's `product_changed` are both `this_menu`.
- [ ] Implement: `was.grossPrice !== offer.grossPrice` → `this_menu`; otherwise as before. In
  `productFields`, a variant whose price follows the dish while the dish's own menu price moved →
  `this_menu`.
- [ ] No existing assertion changes.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.test.ts src/menu-document.test.ts src/menu-change-navigation.test.ts src/menu-preview-includers.test.ts`

#### Task 1.2 — a this-menu price change says what this menu would inherit now

Files: `packages/catalogue/src/menu-document-types.ts` (the `price_changed` member, `:210`: add
`inheritedPrice?: string | null`, documented as "on a this-menu change while this menu sets a
price: what it would charge with none; null when the places it would inherit from disagree");
`menu-document.ts` (set it from `combined.get(productId)?.price` when its source is `own`: its
`otherwise`, the value when decided, else null); `menu-publication.test.ts`.

- [ ] Failing cases: Dinner sets a price for Burger (live had none) → `inheritedPrice` is Burger's
  product price; then Burger's product price changes too → `inheritedPrice` is the new product
  price; Dinner clears a price it had live → no `inheritedPrice` (this menu sets none now); a
  shared-product price change → no field. `diffMenuDocuments` (no combined offers) never sets it.
- [ ] Existing `toEqual` assertions on this-menu price changes gain the field and nothing else.
- [ ] Same command as Task 1.1.

**Review fix (variants).** A this-menu `product_changed` carries `inheritedVariantPrices?:
Record<string, string | null>`: by variant id, for each variant this menu sets a price for, the
`otherwise` of its combined price (its value when decided, else null); left out when this menu
sets no variant price. The planner offers a variant Undo whose live variant had no price here only
when this value equals the live price. Pinned by "says what each variant this menu prices would
charge without its own price" in `menu-publication.test.ts`, and in `menu-undo.db.test.ts` by
three cases offering nothing (the product's own Large price, the product price Large follows
through a dish Lunch sets no price for, and Drinks' own Large price, each moved after Lunch set
Large) and two offered ones (Large follows Lunch's own dish price while the product's price
moved; Large has its own product price while Lunch's dish price moved).

#### Task 1.3 — the planner's routing, and the purity guard

Files: create `packages/catalogue/src/menu-undo.ts`, `packages/catalogue/src/menu-undo.test.ts`;
modify `scripts/dashboard-browser-purity.test.ts` (add `"packages/catalogue/src/menu-undo.ts"`
to `SUBPATHS`).

- [ ] Failing tests first (built `MenuPreview` values, no database): a P `product_changed` →
  `edit_product` with its `productId`; an `extra_unit_changed` → `edit_product`;
  `extra_portion_changed` and `extra_max_quantity_changed` → as Q1a settles; a `product_deleted`,
  and a `product_removed` credited to P → `none` (Q1c); an I `order_changed` with `includedMenu` →
  `edit_menu` Structure; an I `price_changed` → `edit_menu` as Q1b settles; an I change without
  `includedMenu` → `none`; every M kind when `preview.live === null` → `none`; every M kind not yet
  built → `none`. `menuChangeActions` answers one entry per change id.
- [ ] Implement with `import type` lines only (Decision 2).
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.test.ts`
- [ ] Root guard: `pnpm exec vitest run scripts/dashboard-browser-purity.test.ts` — expect the new
  entry's cases to pass. Prove it by deletion: add a throwaway `import "./menu-structure.js";`
  to `menu-undo.ts`, watch the reachable case fail naming `drizzle-orm`, remove it.

#### Task 1.4 — rename, Home display, own section: real database

Files: create `packages/catalogue/src/menu-undo.db.test.ts`; modify `menu-undo.ts`.

Set-up for every case: `useCatalogueDb()` (`packages/catalogue/test/fixtures.ts:210-212`, a
real `useVenueDb`) and `menusFixture` (`test/menus-fixture.ts:54`; Dinner owns the section
Mains). Publish with `previewMenu` then `publishMenu(tx, menuId, hash, "person-1")`, as
`menu-publication.test.ts:142-145` does. Make the change under test **and one unrelated change**
on the same menu. Read `previewMenu`, take the change's action from `menuChangeActions`, run its
command through the catalogue function (mapping in the test file), read `previewMenu` again. Each
case asserts: the change's id is gone; every other change id, and its text fields, is unchanged;
the other menu's preview is unchanged; and the stored fields the command did not name are
unchanged.

- [ ] `menu_renamed`: rename Dinner, also change Burger's menu price. Expected failure: action is
  `none`. Refusal case: another menu has taken the old name; the write throws `menu.name_taken`
  (assert the code outside the transaction), and the preview read after still lists the rename.
- [ ] `home_display_changed`: change handheld columns only → the command carries `columns` alone;
  change columns and tiles → both, not `order`; the till's display and the shortcuts are unchanged.
- [ ] `section_changed` (own): change Mains' names and colour together; one call puts both back;
  its photo is untouched. Languages (the review ran the merge's refusals): a language switched off
  since, with the same name live and now → Undo offered and the name kept; edited before it was
  switched off → `none`; emptied before it was switched off → `none`.
- [ ] Photo field: `mediaImageExists` answers false when the media table is absent
  (`sections.ts:65-66`) and `useCatalogueDb` loads only the core and catalogue migrations, so this
  suite may be unable to store a section photo. Check first. If it can, add "a photo added since →
  put back to none". If it cannot, the photo field is covered by Task 1.3's planner test only; say
  so in the PR. (A live photo cannot be deleted from the library while a live version uses it —
  the review read `packages/media/src/images.ts:229-252,414-428` — so there is no "photo gone"
  database case.)
- [ ] An I `section_changed` (the included Drinks menu renamed) stays `edit_menu`.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 1.5 — a dish's menu price and one variant's: real database

Files: `menu-undo.ts`, `menu-undo.db.test.ts`. Fixtures: Burger in Dinner's own section Mains
(`menus-fixture.ts:114-121`), and Lemonade, which Lunch reaches only through Drinks and sets its own
price for (`:47-49,111,168`), with one variant, Large (`:78-93`). Add a second variant inside the
test where a case needs two. Run the price cases on **both** Burger/Dinner and Lemonade/Lunch.

- [ ] Offered, and the whole live price comes back (Decision 5): live had an own price, now a
  different one; live had an own price, now none (needs Task 1.1); live had `"0.00"`; live had
  none, now one, and the product's own price unchanged (`inheritedPrice` equals the live price).
  After each, the change is gone and `null` stays `null`, zero stays zero.
- [ ] Not offered: live had none, now one, **and** the product's own price changed too → the
  this-menu change's action is `none`. Also assert the shared-product price change that Burger's
  product price alone makes (Dinner setting nothing) has action `edit_product`.
- [ ] One variant's menu price changed → `setMenuVariantPrice` with the live value; the other
  variant's price row is untouched. Two variants changed → `none`. The dish's menu price changed
  while a variant inherits it → the variant's M change is `none`, and undoing the dish's price
  removes both. A variant that follows the dish, whose live price here was none, changed while the
  dish's menu price also moved → `none`; one with its own product price → offered (review fix).
- [ ] A variant made Inactive after the preview (reachable only through a race: the product editor
  refuses it with `product.on_live_menu`, so the test writes the rows directly; the dashboard words
  the refusal with the code's own message): the write throws `product.variant_not_found`, and
  the preview read after no longer lists the variant's M change but lists a P `variants` change
  (making it Inactive deleted its menu rows, `variants.ts:376-378`).
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 1.6 — the dashboard's command sender and the words

Files: create `apps/dashboard/src/api/menu-undo.ts` (`sendMenuUndo(api, command)` and
`undoRefusalText(error, command)`) and `apps/dashboard/src/api/menu-undo.test.ts`; modify
`apps/dashboard/src/i18n/strings.ts` (both maps: every new key in section 3).

- [ ] Failing test first: for each PR 1 command, a recording fake `DashboardApi` sees exactly one
  call, to the named method, with the command's arguments in order, and no display name.
- [ ] `undoRefusalText` gives each section 3 sentence, filled, for its code (one case per row),
  and `codeMessage` only for a code none of them names (try `management.request_invalid`).
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/api/menu-undo.test.ts`
- [ ] Root guard: `pnpm exec vitest run scripts/english-only.test.ts`.

#### Task 1.7 — the Preview's links (no writes)

Files: `apps/dashboard/src/widgets/menu-preview.ts`; create
`apps/dashboard/src/widgets/menu-preview.undo.test.ts`; extend `menu-preview.a11y.test.ts`.

- [ ] Failing browser tests: a P change shows **Edit product** with
  `href=/manage/catalogue/product/<id>` and, on a plain click, sends `wt-edit-product` with
  `{ productId }` (reuse `openProduct` from `menu-publish-warnings.ts:29-40` by exporting it); a
  click with a modifier key is left to the browser. An I change shows **Edit {menu}** as a plain
  `href` to that menu's Structure (or Prices, Q1b) address, like the includer links
  (`menu-preview.ts:753-764`); test its plain click and its modifier click too. A deleted product
  shows neither. An M change shows no Edit link. The links sit after View and before Hide.
- [ ] The widget works out every change's action once per `preview` (later also `structure`
  and `home`) with `menuChangeActions` in `willUpdate`, and draws from that map; a test counts one
  call per new preview, not one per row per render.
- [ ] A11y: add the link states to the existing light/dark loop (`menu-preview.a11y.test.ts:91-120`).
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.undo.test.ts src/widgets/menu-preview.a11y.test.ts src/widgets/menu-preview.test.ts`
- [ ] Root guards: `scripts/primary-coloured-text.test.ts`, `scripts/style-token-names.test.ts`.

#### Task 1.8 — the Undo action in the widget

Files: `menu-preview.ts`, `menu-preview.undo.test.ts`, `menu-preview.a11y.test.ts`.

The control is a native `<button type="button" class="undo">` drawn like the row's links
(`color: var(--wt-color-primary-text)`, underline, no border or background, `font: inherit`,
focus ring from `--wt-focus-ring`), as `menu-patch-dialog.ts:222-246` draws its link-styled
button. It is a button because it writes; an `<a>` would open a new tab on a middle click and
undo nothing. New properties: `undoing: string | null` (the change whose Undo is out),
`undoBlocked: boolean` (another write, a Home save or a publish is out), `undoRefusals:
Record<string, string>` (change id → sentence), `undoResult: string | null` (the bullet text of
the last success).

The change list is rebuilt for every new preview object — `#renderChanges` wraps it in
`keyed(preview, …)` (`menu-preview.ts:610`) — so focus and announcements are handled by change id.

- [ ] Failing tests, one at a time:
  - Undo is drawn only where the action is `undo`, never on a P or I change, and not when
    `preview.live === null`.
  - A click, Enter and Space each send one `wt-menu-undo` with
    `detail: { changeId, change: <bullet text> }`, `bubbles: true, composed: true`, after
    `event.stopPropagation()` on the click. Use `userEvent.click` and `userEvent.keyboard`, not
    `element.click()`.
  - While `undoing === id`: text **Undoing…**, `aria-disabled="true"`, primary-text colour kept,
    and a second click sends nothing. While `undoBlocked`: `aria-disabled="true"`, muted colour
    (`--wt-color-text-muted`), and a click sends nothing.
  - While `undoing !== null`, Publish is drawn `secondary` and disabled, and `#publish`
    (`menu-preview.ts:541-559`) returns.
  - A refusal for the id: a paragraph inside that bullet reading "Not undone. {reason}", which the
    Undo points at with `aria-describedby`. It carries `role="alert"` only on the render that first
    shows that message; handed a **new** preview object that lists the same change, the paragraph
    is drawn as plain text and is not announced again.
  - Focus kept by id: before an update, record the change id of a focused Undo; after it, if that
    change is still listed, focus its Undo — tested by handing a new preview object listing the
    same change, once after a refusal and once while `undoing`. If the change is gone, focus the
    first remaining Hide link, or else the changes pane (`data-test="changes-pane"`), as `#hide`
    does (`menu-preview.ts:352-365`). If focus was outside the list, it is left alone.
  - `undoResult`: one `role="status"` line under the changes heading, "Undone: {change}.", drawn
    outside the list's body so it shows in every state — tested with `failed = true` (the body
    is then the error and Retry, `menu-preview.ts:582-600`).
  - No dialog opens.
- [ ] Undo's accessible name is "Undo", described by the bullet's text (`aria-describedby` on the
  bullet's `<span>`).
- [ ] A11y in both themes: ready, undoing, blocked, refused, with the success line, and failed
  with the success line.
- [ ] Work every change's action out again when the switched-on content languages change, not only
  on a new preview: a section-name Undo depends on them (Task 1.7's actions are redone per preview
  only). Drawing Undo changes the two whole-row pins in `menus-screen.test.ts` ("keeps the Preview
  tab in the address…" and "previews again and says the menu changed…") again, the same way Task
  1.7 did: the new link's word goes before "Hide".
  *Correction (as built):* neither pin needed to change — their fixture `lunchPreview()` has
  `live: null`, so no Undo is drawn.
- [ ] Run the three widget suites as in Task 1.7. Root guards as in Task 1.7, plus
  `scripts/native-form-fields.test.ts` (expect no new finding: a button is not a field).

#### Task 1.9 — the screen: sending an Undo

Files: `apps/dashboard/src/screens/menus-screen.ts`; create
`apps/dashboard/src/screens/menus-screen.preview-undo.test.ts` (the existing
`menus-screen.test.ts` is 12,883 lines).

Undoing a dish's own price also removes the bullet of a variant that follows that price, so the
success line names the change that was undone and must not suggest that nothing else moved.

The screen keeps one record of the Undo that is out, `undoOut = { menuId, changeId }` (change ids
repeat across menus, so the id alone cannot say which menu's Undo it is). It is set when the write
is queued and cleared only when that task ends. The Preview widget's `undoing` is the record's
`changeId` only while the record's menu is the one open, else null.

`#undo(changeId, change)`: return unless `menuId`, `preview` and no `previewError`; return when
`busy`, `undoOut !== null` (one Undo out at a time, on any menu), `homePending !== null`
(`:752,2030`) or this menu is publishing. Take
the action from the actions map built from `{ preview, languages: currentContentLanguages().languages }`;
return unless `undo`. Set `busy`, `undoOut`, clear this change's refusal and `undoResult`. Run in
`#priceWrites.run("undo:" + <row key>)` for the two price commands (Decision 3), else
`#writes.run("undo:" + menuId)`. Inside: `await sendMenuUndo(this.api, command)`. While the same
menu's Preview tab is shown (`this.menuId === menuId && this.view === "preview"`, as `#savePrice`
judges it, `:2099-2109`): a success sets `undoResult`, and a refusal sets
`undoRefusals[changeId] = undoRefusalText(…)` when the current preview read has not failed and
still lists `changeId`. Otherwise a refusal sets `memberError` with
`menu_preview.undo_refused_change` ("Not undone on {menu}: {change}. {reason}", `{menu}` the
menu list's name for the menu the Undo was sent from, or the name taken when it was sent once
that menu is gone, `{reason}` from `undoRefusalText`), and a success away from the Preview sets
nothing. After a rename success also `await this.#watchMenus().catch(() => undefined)`
as `#saveMenu` does (`:1427`); after a success `await this.#refresh()`. Clear `busy` and
`undoOut` in a `finally` around the task's body. `#publish` returns while `undoOut`'s menu is the
menu being published. Pass `undoing` (as above), `undoBlocked = busy || homePending !== null || publishing.has(menuId) || undoOut !== null`,
`undoRefusals`, `undoResult` to `dashboard-menu-preview` in `#renderPreview` (`:3029-3058`), and
listen for `wt-menu-undo`.

- [ ] Failing tests with a fake API (pattern: `menus-screen.home-columns.test.ts`), one at a time:
  - A rename Undo calls `renameCatalogue` once with the live name, then the preview is read again,
    the change is gone, and "Undone: …" shows; the menu list is read again.
  - A refusal (a fake `menu_section.invalid` on a section Undo): the change stays, its sentence is
    beside it, no success line.
  - A write that succeeds followed by a failed re-read: the success line stays and the preview's
    read error shows; nothing says the Undo failed.
  - Two quick clicks send one write.
  - Refused after the person switched to Structure: `memberError` reads "Not undone on {menu}:
    {change}. {reason}", never "was not saved".
  - Refused after a fresh preview stopped listing the change while the Undo was out: the same
    sentence in `memberError`.
  - Refused after the menu was renamed, and after it was deleted, while the Undo was out:
    `{menu}` is the new name, then the name taken when the Undo was sent.
  - An Undo held unanswered on one menu, another menu opened (the fixture gives it a change with
    the same id, which shows "Undo", not "Undoing…"), the first reopened: its Publish is drawn
    disabled, and a publish asked for anyway sends nothing.
  - On the other menu while that Undo is out: Publish and Schedule are enabled, its Undo is
    drawn blocked, and a publish asked for is sent.
  - A publish of this menu out, then an Undo asked for: nothing sent.
  - The preview's read failed, then an Undo asked for: nothing sent.
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.preview-undo.test.ts src/screens/menus-screen.heading.test.ts`

#### Task 1.10 — the screen: what an Undo out blocks, and leaving

Files: `menus-screen.ts`, `apps/dashboard/src/widgets/menu-publications.ts`,
`menus-screen.preview-undo.test.ts`.

Task 1.9 already keeps the record of the Undo that is out (`undoOut = { menuId, changeId }`,
cleared only when its task ends), already makes `#publish` return while `undoOut`'s menu is the
menu being published, and already passes the widget `undoing` only while that menu is open. This
task builds on that record. The publications widget gains a `blocked` property; while it is set,
Schedule is drawn `secondary` and disabled rather than hidden (today it is drawn only while
`#canSchedule()` answers true, `menu-publications.ts:425-435,881-889`). The screen passes
`blocked = undoOut?.menuId === menuId` in `#renderPreview`. `#select` (`:1280`) clears
`undoRefusals` and `undoResult`, and nothing about `undoOut`: the record must outlive the menu
being left, or Publish could run on a menu whose Undo is still out. `#showView` (`:1249-1262`)
clears `undoRefusals` and `undoResult` when leaving the Preview tab; `#publish` clears
`undoResult`. A refreshed preview drops refusals whose id it no longer lists, nothing else.

- [ ] Failing tests, one at a time:
  - An Undo held unanswered → Schedule is drawn disabled (the Publish half is Task 1.9's).
  - A Price overrides save of the same row still out, then a price Undo; once both finish,
    `savingPrices` no longer holds the row's key, and the Undo ran after the save.
  - A Home save held out → Undo is drawn blocked and sends nothing.
  - Switching to Structure while the Undo is out: refused → "Not undone on {menu}: {change}.
    {reason}" is beside the list in `memberError`; succeeded → no success line when the person comes back to Preview.
  - Opening another menu while the Undo is out: refused → "Not undone on {menu}: {change}.
    {reason}", naming the menu the Undo was sent from, beside the list; succeeded →
    nothing shown on the other menu.
  - A live feed snapshot arriving while a refusal is shown keeps the refusal.
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.preview-undo.test.ts src/widgets/menu-publications.test.ts`

#### Task 1.11 — contract, backlog, look, finish

- [ ] `docs/developers/design-system.md` Preview contract (`:5386-5407`): one paragraph naming the
  actions per source, Undo's states, that Publish and Schedule wait while an Undo is out, where its
  refusal and success show, and that it never asks for confirmation; point at
  `menu-preview.undo.test.ts`.
- [ ] `docs/backlog/catalogue.md` A353 entry and its `docs/backlog.md` line: replace the
  PARKED note with what PR 1 built and what PRs 2–5 will add; drop the pointer to the old local
  branch. Ask the owner before deleting `feat/menu-preview-undo` and its worktree.
- [ ] LOOK: start the stack with `wa-wt demo waitron-feat-a353-preview-undo`. Publish a menu,
  then make one change of each PR 1 kind plus a shared-product and an included-menu change.
  Screenshot the Preview in English and Spanish, light and dark, at 1280 and 390 wide (eight
  shots), plus one with a refusal, one with the success line, and one with an Undo out (Publish
  waiting). Keep them in a scratch folder outside the repository and show them to the owner;
  never commit them.
- [ ] The PR description lists every kind left without Undo (section 2), the section 3 words, and
  any "changed test checks" (Tasks 1.1 and 1.2 have none).
- [ ] Tell the owner the branch is ready for `finish-branch`.

### PR 2 — an include's own presentation

#### Task 2.1 — planner and real database

Files: `menu-undo.ts`, `menu-undo.test.ts`, `menu-undo.db.test.ts`. Fixture: Lunch includes Drinks
once (`menus-fixture.ts:111`).

- [ ] Failing cases, each run through `setIncludeFolder` (`include-folder.ts:78-106`):
  fixed names and colour put back together; a fixed photo cleared back to following;
  folder → direct put back (overrides left out, the stored ones still stored after);
  direct → folder put back with the live `fixed`; a switched-off language with the same fixed
  name live and now → offered and kept; edited or emptied before it was switched off → `none`;
  Drinks included twice in Lunch's own lists and both copies changed → `none`;
  an I change on the same section (Drinks renamed in its own menu) stays `edit_menu`.
- [ ] Planner finds `listId` and `memberId` from `input.structure`: the list is the parent path's
  last section (or `rootSectionId`), the member is that list's child whose `ref.sectionId` matches.
- [ ] `pnpm --filter @waitron/catalogue exec vitest run src/menu-undo.db.test.ts src/menu-undo.test.ts`

#### Task 2.2 — dashboard

Files: `api/menu-undo.ts` (+ test, + this PR's refusal sentences in section 3 and `strings.ts`),
`widgets/menu-preview.ts` (new `structure` property, passed to the planner),
`screens/menus-screen.ts` (pass `this.structure`; it is always read with the preview,
`menus-screen.ts:1055-1061`), `menus-screen.preview-undo.test.ts`.

- [ ] Failing tests: the sender maps `setIncludeFolder`; the widget draws Undo on an include's M
  change only once the structure is present, and works out the actions once per
  (`preview`, `structure`); the screen sends one `setIncludeFolder` with the live input and reads
  again.
- [ ] Focused runs as in Tasks 1.6–1.10; design-system line; short LOOK of an include change in
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
- [ ] Same command as Task 3.1.

#### Task 3.3 — dashboard

Files: `api/client.ts` (`addSectionMember(id, ref, position?)`, sending `position` only when
given — the route already reads it, `catalogue-api.ts:637-646`), its contract test,
`api/menu-undo.ts` (+ test, + this PR's refusal sentences), `menus-screen.ts`,
`menus-screen.preview-undo.test.ts`.

- [ ] Failing tests: existing `addSectionMember` callers still send `{ ref }` alone; the sender
  maps the three structural commands; a structural Undo runs in `#writes.run(<listId>)`, so it
  waits behind a Structure write to the same list still out.
- [ ] Focused runs; design-system line; LOOK; ready for `finish-branch`.

### PR 4 — sections and includes

#### Task 4.1 — includes added and removed

- [ ] Failing real-database cases: an include of a third menu added to Dinner → `removeSectionMember`;
  the same when one of its products is also on Dinner directly (the product stays, prices kept);
  when one of its products was live only through a path removed since → `none`. Removing Drinks
  from Lunch → `none`, because Lemonade, reached only through Drinks, had Lunch's own price, which
  the removal reset (`menus-fixture.ts:47-49,168`); a fixture without that price restores it whole
  at its live position. A live include shown directly or fixing a field → `none`.

#### Task 4.2 — own sections moved, added, deleted

- [ ] Failing cases: Mains moved under a new section and back — both the `section_added` and the
  `section_removed` change offer the same `moveSectionMembersInto`, and one call clears both plus
  the products-moved changes it caused; a new empty section → `deleteSection`; a new section
  holding anything at all (new products included) → `none`; Mains deleted → `none`.

#### Task 4.3 — dashboard

- [ ] Sender cases for `deleteSection`, plus this PR's refusal sentences; screen runs both in
  `#writes.run(<listId>)`; focused runs; design-system line; LOOK; ready for `finish-branch`.

### PR 5 — order and shortcuts, and closing the item

#### Task 5.1 — `order_changed`

- [ ] Failing real-database cases on Dinner's top level and inside Mains: one member moved →
  `moveSectionMember(listId, memberId, to)` with `to` in the stored list, and the common members'
  order matches live after; a member added and the rest unmoved → first check what
  `menu-document.ts:1131-1155` emits, and if an order change is listed, it is `none`; two members
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
  with contract tests; sender cases and this PR's refusal sentences; the widget works out the
  actions once per (`preview`, `structure`, `home`); screen runs a shortcut Undo in
  `#writes.run("home:" + menuId)` as `#shortcutWrite` does (`:1863-1880`).
- [ ] Run `menus-screen.home-tab.test.ts` and `menus-screen.home-shortcuts.unsaved.test.ts` as well.
- [ ] Backlog: delete the A353 entry; add one short entry in the same area listing what is left
  without Undo (section 2), each with its reason. Design-system line; LOOK; ready for
  `finish-branch`.
