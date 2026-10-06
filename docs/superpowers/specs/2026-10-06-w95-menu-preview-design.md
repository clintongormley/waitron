# W95: inspect the proposed menu and follow its changes

Date: 2026-10-06. Source checkout: `abbe54638da5f91d2d4c84c340790965cb12ae2e` (A291).
Authority: Lane D `queue.md`, W95, including the Price override wording follow-up.
The owner authorises unattended design and planning. The parent driver reviews these
artifacts, handles their documentation workflow, and implements inline. This document
proposes behaviour; the source pointers below are inspected code, not runtime verification.

## Outcome and scope

You can inspect what publishing will put on the menu and follow every unpublished
change to its exact place. Desktop Preview has the hierarchical menu on the left and
changes on the right. At phone width they stack. Publication state, warnings, clashes
and the publish action remain easy to find. A product opens an interactive inspection
of its frozen variants and modifiers; selections change only this inspection.

One implementation PR. Accept only document format 3. Keep the existing publication
hash gate, warning confirmation, permissions and fiscal invariants. Add no migration,
new package, online-menu site or ordering endpoint. Leave A290's read-count optimisation
and A299's dead-widget deletion to their own items. Preserve W69's navigation protection
when rebasing shared screen code. Do not claim pixel parity with an online menu: none
exists in this task's supplied context.

## Source map and actual limits

| Inspected source                                                                                                  | What it establishes and what the design must respect                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/widgets/menu-preview.ts:97`, `:457`, `:514`, `:603`                                           | Staff-name tree conversion, plain change list, and vertical composition. Replace the presentation, retaining publication behaviour.                                           |
| `apps/dashboard/src/widgets/menu-preview.ts:397`, `:547`, `:567`                                                  | Warning confirmation is bound to a hash; clashes disable Publish. The clash label currently reads `menu_prices.menu_price`.                                                   |
| `packages/catalogue/src/menu-document-types.ts:49`, `:87`, `:142`, `:225`                                         | Members carry section/product IDs; offers are keyed by menu-item ID. Changes lack occurrence/field identity. Preview has no before document.                                  |
| `packages/catalogue/src/menu-document.ts:176`, `:314`, `:353`                                                     | Builder walks every occurrence; offers freeze effective values. Canonical hashing covers the document, not the preview envelope.                                              |
| `packages/catalogue/src/menu-document.ts:594`, `:789`, `:1047`                                                    | Diff shape stops descending on a repeated section. Section relocation uses removal/addition; order changes have name paths only. Correct occurrence traversal for navigation. |
| `packages/catalogue/src/menu-publication.ts:259`, `:287`, `:298`, `:349`, `:393`                                  | Preview already reads its own live document, adds extra-only deletions, refines source and fills `alsoOn`. Enrich only after those steps.                                     |
| `packages/catalogue/src/menu-publication.ts:77`, `:435`                                                           | Unsupported formats refuse `menu.reset_required`; publishing rebuilds and checks the expected hash before inserting a version.                                                |
| `apps/server/src/catalogue-api.ts:700`, `:930`, `:938`                                                            | Existing manager gate and transaction wrap preview/publish. Keep route URLs and publish body `{ expectedHash }`.                                                              |
| `apps/dashboard/src/api/client.ts:127`, `:1894`, `:1938`; `apps/dashboard/src/api/live-queries.ts:185`            | Shared type leaf, preview client, publish client and existing publication subscriptions are the consumers.                                                                    |
| `apps/dashboard/src/screens/menus-screen.ts:980`, `:1210`, `:2144`, `:2298`                                       | Query snapshots assign the preview; stale publish rereads it. Preview and Home use the same proposed document.                                                                |
| `packages/catalogue/src/menu-types.ts:31`, `:64`, `:189`, `:213`, `:230`                                          | Resolved offer/variant/extra prices, translated names, units, declarations, pick limits and options defaults. Options own no surcharge.                                       |
| `packages/shared/src/content-languages.ts:90`, `:114`; `packages/catalogue/src/product-presentation.ts:52`, `:77` | Requested language then configured default; wholly blank customer names fall back to that entity's staff name. Variant names never inherit the parent's.                      |
| `packages/catalogue/src/schema/sections.ts:33`, `:83`; `packages/catalogue/src/section-graph.ts:163`              | Sections have names/image/colour, no description. A parent list contains a subject once; paths distinguish repetition under different ancestors.                              |
| `packages/catalogue/src/menu-document-types.ts:62`, `:87`; `packages/catalogue/src/menu-document.ts:497`          | Root has no translated title or image; variant has no description. Current availability is an overlay applied elsewhere. Do not fill these gaps from drafts.                  |
| `packages/catalogue/src/device-home.ts:68`; `apps/dashboard/src/widgets/device-home-preview.ts:32`, `:298`        | Frozen image filename, encoded media URL, image before colour in Thumbnails mode, validated data colours. Home preview remains a device view.                                 |
| `packages/catalogue/src/product-ordering.ts:1`                                                                    | `staff_only` currently behaves like `public`; guest ordering does not exist. Do not introduce ordering policy here.                                                           |

Format 3's root title is the frozen `menuName`, visibly identified as an internal-title
fallback in customer views. Included roots do carry section translations. Show all
available section details, but invent no section or variant descriptions. Display the
document's frozen content, not a promise of current availability. Say this once beside
the view selector. A future customer site must explicitly supply its availability policy.

## Architecture choice

1. **Choose a browser-safe catalogue contract plus isolated Lit renderer in the dashboard.**
   Catalogue owns IDs, occurrences and translation provenance. A renderer module accepts
   document, view, labels and media URL function, with no API, router, dashboard locale
   singleton or publication state. The dashboard host owns interaction and publication
   chrome. This makes the renderer/contract reusable without creating a package for a
   site that does not exist.
2. Extend the staff structure tree. Its staff-name/editing model would continue mixing
   customer content with editor behaviour and would leave exact detail targets awkward.
3. Create a shared UI package or catalogue-dependent `wt-*` primitive now. That adds
   dependency/API work beyond this feature. Extract the isolated renderer when an actual
   second app needs packaging; reuse is an interface commitment, not pixel parity.

## Contract and stable identity

Keep `MenuDocument` and its hash input unchanged. Extend `MenuPreview` with required
`live: null | { versionId: string; document: MenuDocument }`, read from the same `own`
version already used for status/diff, inside the same transaction. A never-published menu
has `live: null`. This is the **before** snapshot, not a second HTTP read.

In `menu-document-types.ts`, name the current change union `MenuChangeBody` and make
`MenuChange = MenuChangeBody & { id: string; targets: { before: MenuTarget[]; after: MenuTarget[] } }`.
Keep all existing kind/source/wording fields. Preserve two identities at diff emission:
`section_added`/`section_removed` gain required `parentSectionIds: string[]`, copied from
the actual ID path in the section loops; `order_changed` gains required
`listSectionId: string | null` (`null` is root). The navigation helper must not recover
these from `under`/`list` display names. Each target has one of these shapes:

```ts
type MenuField =
  | { kind: "summary" }
  | { kind: "name"; audience: "staff" | "customer" | "kitchen"; language?: string }
  | { kind: "description"; language: string }
  | {
      kind:
        | "price"
        | "override"
        | "image"
        | "color"
        | "unit"
        | "allergens"
        | "diet"
        | "vat"
        | "ordering";
    }
  | { kind: "variants" | "extras" | "options" }
  | { kind: "portion" | "maxQuantity" | "limits" | "default" | "members" };
type MenuTarget =
  | { kind: "title"; menuId: string }
  | { kind: "list"; sectionIds: string[] }
  | { kind: "section"; sectionIds: string[]; field: MenuField }
  | {
      kind: "product";
      sectionIds: string[];
      menuItemId: string;
      productId: string;
      variantId?: string;
      listId?: string;
      extraProductId?: string;
      optionLabelId?: string;
      field: MenuField;
    }
  | {
      kind: "home";
      device: "handheld" | "till";
      field: "shortcuts" | "columns" | "tiles" | "order";
    };
```

Product `sectionIds` identifies its containing list from root (`[]` at top level).
Section `sectionIds` includes the section itself. List `[]` means the root list.
An extra-only subject is addressed through **each parent dish occurrence**, its list ID
and extra product ID, never an imaginary standalone offer. Variant and option-label
IDs distinguish rows even when text matches. Omitted IDs mean the containing field/group;
mutually inapplicable nested IDs are never combined. No CSS selector is supplied by the server.
Before targets are empty when `live` is null; never fabricate a default before document.

`menu-navigation.ts` supplies `indexMenuOccurrences(document): MenuOccurrence[]`,
`menuTargetKey(target): string`, and
`navigateMenuChanges(live, proposed, changes: readonly MenuChangeBody[]): MenuChange[]`.
`MenuOccurrence = { target: MenuTarget; ancestorSectionIds: string[] }`.
Index the actual document depth first, including empty sections and every repeated
subtree; only the current ancestor path prevents cycles. Do not reuse Home's deduplicated
index. Keys are JSON tuples of kind, IDs, full section path and field identity, not names,
positions or delimiter-joined strings. A row ID is a deterministic JSON tuple of menu ID,
kind, source/included-menu ID, subject IDs, field identities and affected occurrence keys.
Sort key sets for identity; keep target arrays in document order for presentation.
Exclude display text, money values, `alsoOn`, language selection and the hash itself.

For aggregated changes, compare the frozen old/new values to enumerate actual changed
languages, variants, lists, extras and labels. Deleted nested values have before targets;
added values have after targets. Group/order/limit changes also have their group target.
Do not navigate every variant or modifier when only one changed.

| Existing change kind                | Required targets and default activation                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_added`                     | All after occurrences, summary/detail.                                                                                                                                       |
| `product_removed`                   | All before occurrences, labelled Removed; no after target.                                                                                                                   |
| `product_deleted`                   | All before standalone and/or parent-extra occurrences, labelled Removed.                                                                                                     |
| `product_moved`                     | All before/after occurrences, old/new place controls; open first newly added path, otherwise first after.                                                                    |
| `price_changed`                     | Before/after effective dish price and/or raw override, whichever differs; an override change with equal effective price targets staff inspection of override.                |
| `product_changed`                   | Every actually changed field/nested subject/language at each affected dish/extra occurrence.                                                                                 |
| `extra_unit_changed`                | Parent dish, list, extra product, unit, both sides.                                                                                                                          |
| `extra_portion_changed`             | Parent dish, list, extra product, portion, both sides.                                                                                                                       |
| `extra_max_quantity_changed`        | Parent dish, list, extra product, maxQuantity, both sides, including null.                                                                                                   |
| `section_added` / `section_removed` | Exact after/before occurrence from parentSectionIds plus sectionId, summary. A section move keeps these two existing kinds; cross-link the same section ID's old/new places. |
| `section_changed`                   | All before/after occurrences and changed name language/audience, image or colour. Included roots retain the same rule.                                                       |
| `order_changed`                     | All before/after occurrences of listSectionId (null is root); focus the chosen list heading.                                                                                 |
| `home_shortcuts_changed`            | Both device views, shortcuts; after is default.                                                                                                                              |
| `home_display_changed`              | Named device, only columns/tiles/order that differ; after is default.                                                                                                        |
| `menu_renamed`                      | Before/after frozen title, not a customer product node.                                                                                                                      |

Existing `from`/`to`/`under`/`list` name paths remain explanatory copy. ID paths are the
authority. Source and `alsoOn` remain visible. Also show `includedMenu.name` where present;
do not turn another affected menu's name into a guessed-ID link.

## Content and interaction

Default to the configured default customer language. A shared field primitive with
semantic name `menu-preview-view` offers **Internal names (staff only)** and each enabled
content language. Dashboard EN/ES controls the interface; the selected content language
controls names/descriptions independently. Keep selection across same-menu refreshes if
enabled, otherwise choose the new default. Use locale/content controllers only in the host.

`resolveMenuText(map, staffName, view, config)` returns
`{ text, origin: "requested" | "default" | "staff" | "missing", language: string | null, missingRequested: boolean }`.
Reuse shared language resolution: requested enabled language, then configured default,
then own staff name for **names only**, including a nonblank map containing neither
requested nor default-language text. That final labelled fallback is the new renderer's
policy; it does not change shared, till or receipt resolution. Descriptions with such a
map remain missing. Mark default-language and staff fallbacks beside
the text, with its actual `lang`; a missing Spanish translation must not look Spanish.
Null, `{}`, whitespace-only values and partially translated maps are distinct test inputs.
Descriptions with no text are omitted unless targeted, where a labelled empty value is
focusable. Internal view shows staff names; inspection may expose kitchen names/VAT/override
settings explicitly as staff-only fields. Those never become customer headings or badges.
Internal names changes names only; descriptions and translated unit names/abbreviations
use the configured default language with the same explicit provenance. Targets for another
enabled language select that customer language; staff/kitchen targets select Internal names,
as do VAT and raw override targets. A disabled-language change opens labelled staff inspection
of its stored text, not a new enabled-language choice.

Render nested section headings and collapsible lists, thumbnails and products from
`root.members`, joining `menuItemId` to `offers`. Retain empty sections and repeated
products. A product opens a detail region inside the preview pane. Show its description,
unit, effective price, image, allergens (including contains/may-contain/source and unknown),
diet profile/unknown and dietary declarations without inferring safety from missing data.
Variant selection shows that variant's frozen effective price/image/unit/declarations;
name fallback uses its own staff name. Parent description stays labelled as the dish's.
Show `ordering` as a labelled inspection fact; keep all document occurrences inspectable.
W95 introduces no guest eligibility or sale policy for `staff_only` or `not_sold_separately`.

Use frozen `unitPrice`, not `grossPrice`/`menuPrice` override nulls, for displayed prices.
For variants display individual effective prices and a Decimal-compared min/max range
in the product summary; zero is a price. Unit-priced offers keep their unit and are not
given a fictitious one-dish total. Extras show frozen price **per pick/portion**, portion,
unit, preselection, `minPicks`/nullable `maxPicks` and nullable per-item `maxQuantity`.
Local pick counts obey both caps; quantities count towards list limits. Below-minimum
inspection explains the remaining requirement without any save action. Preserve saved
over-precision portions verbatim. Options are single-choice with frozen default, labels
and no invented price. No total calculation, order request, VAT-rate calculation or
availability overlay is added. Controls demonstrate choices and their effective prices.

Images use the frozen filename through injected `mediaUrl(filename)`; the dashboard
adapter uses `/media/${encodeURIComponent(filename)}`. Use Thumbnails' image/colour/neutral
precedence and validated data colour with readable text; no catalogue fetch or parent-image
guessing in the renderer. Missing or failed images show a neutral placeholder with the
name still present. Adjacent name makes thumbnail alt text empty.

Each change row is a real button operable by pointer, Enter and Space. Activation picks
the first after target (before for removals), opens ancestors/detail, awaits rendering,
scrolls it into view and focuses the exact heading/value (`tabindex=-1` where needed).
Show a text Change/Removed marker plus a token-painted outline; colour alone is insufficient.
Rows with multiple fields/occurrences expose separately named target controls and a count;
names may label them but IDs select them. A product move and section relocation offer
**Before**/**Proposed** place controls. Before switches only the left pane to `live.document`,
with version/date and a conspicuous removal label; **Return to proposed** is always available.
Home targets open an embedded read-only `dashboard-device-home-preview` from the selected
snapshot with the named device and a focusable changed-settings summary. An **Open Home
page settings** link uses the existing tab address; it never renders fresh Home drafts as
the hashed preview. Title changes focus the preview's frozen title.

Desktop panes share a top publication strip; each pane can scroll, with wrapped warnings
and clashes in the strip. Below 800px use one column, preview then changes, page scrolling
and a **Return to selected change** control beside the destination/detail. It returns
focus and scroll to the row on both widths. Long one-word names and paths wrap within
`min-width: 0`; no page-wide horizontal scroll at 390px. Reduced motion avoids smooth
scrolling. No focus trap in the inline detail; its Back control restores its opener.

## Freshness and acceptance

The displayed proposed document is exactly `preview.document`; `live`/navigation metadata
is outside its hash. Language, local choice, expansion, before view and navigation make
no API call and never rebuild/hash/mutate the document. Publish always sends the proposed
`preview.hash`, even while viewing Before or Device Home Page. On a newer query snapshot,
replace the whole envelope, invalidate confirmation and local choices, re-resolve a selected
row by ID without stealing focus; clear it with an announced explanation if gone. Loading
after stale refusal removes the old publish action. Background load failures and action
failures retain their own provenance. A stale publish still refuses with
`menu.changed_since_preview` and writes no version; a successful publish followed by a
failed read remains a published result plus load failure.

Plan tasks T1–T6 map every W95 acceptance bullet: T1 stable navigation and before snapshot;
T2 customer/internal languages and explicit fallback; T3 hierarchy/details/images/prices/
variants/modifiers; T4 panes, every linked change, removal/move/Home/title/source and clash
copy; T5 snapshot/hash/concurrent publish integration; T6 EN/ES × light/dark × 390/1280
visual/a11y evidence and design-system/backlog updates. Keep publication, rollback, source,
price, permission and format refusal assertions; replace staff-tree presentation assertions
with at least equally strict new-content assertions and enumerate changed checks in PR/FYI.
Fiscal and root guard checks stay unedited. No unresolved owner decision is required to
implement this scope; the unavailable content fields above are explicit limits, not draft
data to smuggle into Preview.
