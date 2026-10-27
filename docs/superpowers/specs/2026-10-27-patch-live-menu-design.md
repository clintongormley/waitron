# Patching the live menu in an emergency — design

Status: approved by the owner, 2026-10-27.

## Name

The screens call this **"Patch live menu"**, and the version it produces a **patch** (owner,
2026-10-27). The idea is a hot patch: the frozen version is changed directly, the way a binary is
patched without rebuilding it from source, which is also why the next normal publish from the
products overwrites it. In this document "correction" and "patch" mean the same thing.

## Why

A published menu version is a frozen copy of the menu (`menu_versions.document`), and the till
names and prices every sale from it. A new version is always built from the one shared working
state: the live product, menu-item and section rows (`buildMenuDocuments`,
`packages/catalogue/src/menu-document.ts:96`). There is no draft per version.

So once work on the NEXT menu has started in the products, a mistake found in the LIVE version
cannot be fixed without first undoing that work: put the products back, publish, then redo the
changes. If the next version is already queued, "Publish now" is also refused, because versions go
live only in number order (`overtakenBy`, `packages/catalogue/src/menu-publication.ts:572`), so the
queued version has to be cancelled first.

The owner wants a deliberately rough emergency editor: change a few values in the version that is
live now, and put that correction live at once, without touching anything else.

## Goals

- A manager can correct these values on things already in the live version of ONE menu:
  - **Wording:** staff name, customer name in every content language, kitchen name, and
    description, on products, variants, extras-list items, options-list labels and sections.
    Also the names of extras lists and options lists.
  - **Price:** a product's or variant's price on this menu, and an extra's price.
  - **Picture:** on products, variants, extras and sections.
  - **VAT class.**
- The correction goes live as soon as it is saved.
- The version list stays in the order things actually went live (see "Numbering").

## Non-goals

- Adding, removing or moving anything: no new products, variants, extras, labels or sections, no
  re-ordering, no change of which sections a product sits in, no Device Home Page change.
- Correcting a version that is still waiting for its date. That one is fixed the normal way: change
  the products, cancel it and queue it again.
- Scheduling a correction for later.
- Fixing several menus at once. A product on the Lunch and Dinner menus is corrected on each menu
  separately (owner, 2026-10-27).
- A full editing experience. This is an emergency tool and stays plain.
- **Allergens and diet labels.** Not patchable: they will always be read from the live product on
  every screen (decision 10), so the product editor already fixes them everywhere at once.
- **Unit.** It cannot be changed: switching a unit can turn a counted item into a weighed one
  (owner, 2026-10-27, dropping it from the original list).
- **Knock-on changes.** Correcting a dish never changes its variants, even ones that were copying
  the dish's value: the version does not record which values were copied, so any automatic change
  would be a guess (owner, 2026-10-27: "this is an emergency editor"). The dish's form lists its
  variants with their values, so the manager sees each and fixes it.

## Anti-goals: it fails even if it works when

- **The correction leaks anywhere else.** It changes ONLY the live version of the menu being
  corrected. The products, the menus' working state, any queued version and every other menu's
  live version stay exactly as they were (owner, 2026-10-27). If the same mistake is in those, the
  manager fixes it there the normal way.
- **Open orders change.** Lines already rung up keep their price and VAT class. The correction
  applies only to lines added after it goes live (owner, 2026-10-27).
- **A queued version is lost or its date moves.** The version waiting for its date still goes live
  at its date, with its own content, replacing the corrected one exactly as it would have replaced
  the original.

## Decided by the owner

1. **Scope of fields:** the list under Goals (owner: "Wording, wrong price, picture, allergen,
   unit, vat"; unit later dropped, allergens moved out by decision 10).
2. **Only the version being corrected changes.** Nothing flows into products, queued versions or
   other menus.
3. **Emergency use only:** the live version, put live at once, no scheduling, no correcting a
   queued version.
4. **Open orders keep their price** (and VAT class).
5. **Editor shape: "pick an item, then edit it"** (option A in the mockup, below). A menu tree on
   one side with a search box. Picking an item shows a short form with only the correctable fields,
   in every content language. Variants and extras are reached from their item. Changed items are
   marked. "Review N changes" opens a final step listing every change as "old → new". The step
   reminds the manager that open orders keep their old prices. It warns that the queued version (if
   any) will not carry these corrections, and that the next normal publish from the products will
   put the old values back unless the products are fixed too. It has "Keep editing" and "Put live
   now".
6. **A correction is a new version with a new number,** not a note on the old one.
7. **Who:** anyone allowed to publish menus. No reason field: the change list records what changed,
   who changed it and when.
8. **One menu at a time.**
9. **An extra is corrected once, for every copy.** The version stores a separate copy of each
   extras and options list inside every dish that offers it (`FrozenOffer.offeredModifiers`,
   `packages/catalogue/src/menu-document-types.ts`). A correction to an extras item, an options
   label or a list's name is written into every copy in this menu's version (owner, 2026-10-27).
   An extras item holds its wording twice (`presentation` and `name`/`customerName`); both change
   together.
10. **Allergens and diet labels have one source: the live product, on every screen** (owner,
    2026-10-27). Today the till's menu reads them from the published version while the kitchen
    screen, the table's allergy check and order lines read the live product
    (`apps/server/src/line-nutrition.ts`), so the two can disagree and nothing says which is which.
    Making them live everywhere is separate work with its own design; this patch editor therefore
    does not touch them. Earlier in the conversation the owner had put allergens and diet labels in
    scope; this decision replaces that.

Mockups (option A was chosen):
`.superpowers/brainstorm/31622-1793085084/content/editor-layout.html` (local, gitignored).

## Numbering — how the queued version keeps its place

`menu_versions` is append-only (`packages/catalogue/src/classification.ts:25`), a version's number
is unique per menu, and a number is never reused. Example: version 4 is live and version 5 is
queued for 3 November. Saving a correction to version 4 does this, in ONE transaction:

1. It writes the corrected document as a new version under the next number, **6**, and makes it
   live at once (as `publishMenu` does: it moves the `menu_publications` pointer and records the
   version's photos in `menu_version_images`).
2. It cancels every still-queued version of that menu (5), and queues each one again with the SAME
   document and SAME `activates_at` under new numbers above the correction (**7**), in their
   original order. The cancelled copy (5) does not appear in the dashboard's list, which shows only
   queued versions (`apps/dashboard/src/widgets/menu-publications.ts:856`).

The manager sees 6 live and 7 waiting. Number 5 is used up by the withdrawn copy.

The ordinary overtaking refusal (`menu_publication.overtakes_queued`) does not apply to a
correction, because step 2 moves every queued version after it.

## What the builder must hold to

- **The correction is built from the live version's document, never from the working state.** The
  editor reads the live document, the manager's changes are applied to a copy of it, and only the
  listed fields can differ. The server checks that: a request that changes anything else is refused.
- **Base-version check.** The save names the version it corrects. If the live version is no longer
  that one (another correction, a publish, or a queued version that came due in the meantime), the
  save is refused. The refusal explains what happened and offers to reload the editor on the new
  live version with nothing lost that can be kept. (CLAUDE.md: a refusal explains what happened and
  what each choice does.)
- **A queued version that comes due while the editor is open** makes the correction moot for that
  version. The base-version check covers it.
- **Values are checked the way the normal product editor checks them:** prices at money scale, a
  VAT class from the allowed set, translated text merged with `mergeOptionalTranslations` so text
  in a switched-off language is kept, the same languages as the menu's content languages, and
  the same field-level refusals beside the field (Forms contract, `design-system.md`).
- **Price on a menu.** An offer's and a variant's `unitPrice` in the version is already the price
  the till charges: the menu's price when one is set, otherwise the product's
  (`packages/catalogue/src/operations.ts:603-613`, `:812-818`). The till reads `unitPrice` and
  nothing else (`apps/server/src/working-order.ts:826-846`). So a price correction rewrites
  `unitPrice`. `grossPrice` / `menuPrice` are kept consistent with it, because the preview's change
  list compares them (`menu-document.ts:1007`).
- **A field is corrected only where the version holds it** (designer's call). Sections carry an internal name, customer names, a picture and a colour. Only
  products carry a description. There is no kitchen name or description on a section to correct.
- **Live fields stay live.** Availability, course and reporting category are not in the document
  and are not part of the editor.
- **A section shown through an included menu's folder** can carry its own names or picture
  (`fixed`, `include-folder-presentation.ts`). Such a copy keeps its override for that field; every
  other copy takes the patch (designer's call).
- **A dish with variants** is never sold at its own price or VAT class (the till refuses a line
  without a variant, `packages/catalogue/src/variants.ts:521-524`). Its form says so beside those
  two fields (designer's call).
- **A dish and the same product as an extra are corrected separately** (designer's call). They
  carry different prices and sit in different places in the tree.
- **Pictures** are chosen from the venue's existing photos, or uploaded through the same path the
  product editor uses. The new version's photos are recorded in `menu_version_images` so media
  keeps them.
- **Included menus.** Sections and items that came into this menu from an included menu are
  embedded in its document, so correcting them changes only this menu's version, as decision 2
  requires.
- **Content hash and duplicates.** A correction whose document comes out identical to the live
  version saves nothing and says so.
- **Where it lives in the dashboard:** a "Patch live menu…" action wherever the menu screen
  shows the live version. The current list shows only queued versions, so placing the action is the
  builder's call, alongside A547's layout of the publishing area.
- **Permission:** the same gate as `POST /management-api/catalogues/:id/publish`.
- **Help guide** for the menu screen updated in English and Spanish.
- **Tests:** a correction leaves products, working state, queued versions and other menus unchanged
  (each asserted); open lines keep price and VAT class; the queued version keeps its date and
  content and still goes live; the base-version refusal fires; a field outside the list is refused;
  allergen and diet fields are refused.

## Left to the builder

- The exact layout of the tree and form, within the design system and option A.
- The API shape: one route taking the base version id and a list of field changes, or the whole
  edited document checked field by field.
- How the "old → new" list words each change, reusing the preview's change list where it fits.
- How a correction shows in any version history or activity view beyond the queued list.

## Deliberately left out

- **Going back to an older version.** Discussed and left for now (owner, 2026-10-27), with no
  backlog entry.

## Risk triggers

Touches money (prices, VAT class on future sales) and a by-id read (the live version). It does not
touch the fiscal chain: invoices are already dated and numbered and carry their own lines. Full
review ceremony.
