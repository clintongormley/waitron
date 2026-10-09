# Product names, variants and the product editor

A product is sold by three different audiences at once. The waiter hunting for it on a till button
wants the name the venue uses in the kitchen doorway. The diner reading the receipt wants it in their
own language. The cook reading the ticket wants whatever fits on 42 characters of thermal paper.
Those three are not the same string, and trying to serve all of them from one field is what this
model replaces.

So a product carries up to three names, and so does each of its variants.

## The three names

| Name | Stored as | Who reads it |
| --- | --- | --- |
| **Name** | `products.name` — plain text, `not null` | Staff. The dashboard, the till's product buttons and basket, a table tab's line list, the sales reports, the image library's "what uses this photo" list |
| **Customer-facing name** | `products.customer_name` — a language map (JSON), nullable | Diners. The printed receipt and the printed allergen sheet |
| **Kitchen name** | `products.kitchen_name` — plain text, nullable | Cooks. The kitchen ticket and the kitchen display |

A variant is itself a `products` row whose `parent_id` names its parent, so it carries the same
three in the same three columns.

Two rules govern how those six fields become one displayed string, and both of them live in
`packages/catalogue/src/product-presentation.ts`, apart from the per-language step named below.
Nothing else re-implements either one, with one exception named under _What a sold line freezes_
below.

**Each name falls back on its own.** A blank customer-facing name falls back to Name; a blank kitchen
name falls back to Name. A customer-facing name blank in one language but not in the default
language takes the default language's text in the text frozen for the receipt
(`toInvoiceLineDescriptions`, below), not Name; that per-language step is `resolveContentText`
(`packages/shared/src/content-languages.ts`), not `product-presentation.ts`. The printed allergen sheet instead requests only its chosen language: the receipt language when
the till has a catalogue for it, else English. An absent or disabled customer translation uses
Name (untagged staff text), rather than substituting a different customer translation (`customerProductName`,
`apps/till/src/widgets/product-name.ts`). They do not fall back
to each other, and a product with a customer-facing name but no kitchen name still prints its staff
Name to the kitchen.

**Name a variant relative to its product.** Give Seagrams Gin and London Gin variants called
Single or Double. A standalone line shows `Seagrams Gin (Single)`: the product and variant's
staff names on the till and tab, customer names on the receipt, and kitchen names on kitchen
paper and screens. Each half falls back independently to its own staff name. A product without
a variant keeps its name. Where the product is already shown — a variant picker, editor table,
or nested top-sellers row — the variant's own relative name is enough.

**Active product names are unique among products; active variant names are unique within their
product.** You can give Seagrams Gin and London Gin a variant named Single, and you can also
have a product named Single. Two active products called Single, or two active Single variants
of one active product, are refused with `product.name_taken`, ignoring case and surrounding
spaces (`packages/catalogue/src/product-names.ts`). A save that preserves an existing clash
without creating another keeps the existing behavior.

You can name a product `Gin (Double)` even when `Gin` has a `Double` variant: the saved-name
checks permit both, and their displayed labels match. A held-group summary combines quantities
with matching display labels while retaining the individual line ids (`listOrderGroups`,
`apps/server/src/order-groups.ts`). Choose different saved names if you need distinct labels.

Each name write stores its folded `products.name_key`. Product and single-variant lookups
compare that key within the relevant parent scope; a row with a null key is absent from those
lookups. A whole-family save compares the submitted variant names directly. Configuration
imports also compare names directly, grouping products separately from each product's variants
(`validateCatalogueConfiguration`, `packages/catalogue/src/configuration-transfer.ts`). An
import sets the keys through `storeProductNameKeys` in the catalogue module's `afterImport`;
a bundle carrying a name key is refused. A product with no `active` value counts as active,
the column's default. An import refuses an `active` value other than 0 or 1, a category or
product name that is not text, or a product, category or section colour other than null or
lowercase `#rrggbb`, with `setup.request_invalid` naming the column.

The three resolvers, one per audience:

- `staffPresentationName` — the product's staff name followed by its relative variant in parentheses. Takes only the two staff
  names, so a caller holding a row with nothing else on it does not have to invent four empty fields.
- `customerPresentationText` — applies the blank-falls-back-to-Name rule to the customer-facing
  maps, and hands back the product's map and the variant's map still separate.
- `kitchenPresentationName` — the product and relative variant's kitchen names in the same format,
  each falling back to its own staff name. Like `staffPresentationName` it takes no
  locale: a kitchen name carries no per-language text, so there is nothing to resolve against.

Turning the two frozen customer maps of a sold line into the one label a receipt prints is
`joinCustomerPresentationText`, which is separate because its callers are rendering something
already *sold* — see below.

## Filling missing customer names together

When several items lack the same language, open that language's translation dialog from
Content languages. You enter customer-facing text without changing staff or kitchen names.
A missing default-language name needs its own explicit entry. For example, with English as
base, Spanish “Limonada para clientes” needs an English companion only if that item has no
English customer name already.

A shared product, variant, option, extras list or unit changes wherever that definition is
used in the working menus. A folder included in a menu keeps its own name override; translating
that folder changes that inclusion. Check the menu preview and publish it separately to use
the new text on the till.

The `inline changes preserve publication and recorded names` cases in
`packages/catalogue/src/menu-publication.test.ts` and `apps/server/src/till-api.receipt.test.ts`
exercise this boundary. The catalogue case translates all nine kinds, reads both working menus,
checks the audience-specific name consumers and retains the published rows until explicit
publication. The server case files a sale, saves a customer name through the authenticated
translation route and reprints the recorded customer text. It compares the complete stored
sale, line, fiscal-record, invoice-series and publication rows before and after the save and
reprint. These checks cover those fixtures; they do not exercise an external filing service.

## What a sold line freezes

A line freezes its names, its gross price and its VAT class when it is added and never reads them
from the catalogue again, so editing a product does not rewrite yesterday's receipt; the VAT class
comes from the published menu, and the rate from the day the invoice is issued, below. `working_order_lines` and `sale_lines` each carry:

- `name` — the product's staff name at add time; on a line sold as a variant, the PARENT's. On a
  line with no variant this is what the basket and a retrieved tab show after the product has been
  renamed or deleted; on a variant line they join it with `variant_name`.
- `descriptions` — the customer-facing text, already resolved through `customerPresentationText` and
  then narrowed to exactly the location's saved receipt languages (`locations.invoice_locales`) by
  `toInvoiceLineDescriptions`. A receipt prints the entry for the sale's language (`sales.locale`),
  which is the first of that list when the sale is filed. An order placed before the location's
  receipt languages change and collected after is filed with `sales.locale` in the new language
  while its lines' `descriptions` hold entries only for the languages saved when they were added
  (the case "accepts a change while an order is placed, and the order can still be collected" in
  `apps/server/src/location-settings-api.orders-open.test.ts`); when the new language is not among
  them, `lineName` (`apps/server/src/receipt-ticket.ts`) prints the line's first stored name
  instead.
- `variant_name`, `variant_descriptions`, `variant_kitchen_name`, `kitchen_name` — the chosen
  variant's own three names (`variant_name` and `variant_kitchen_name` as the variant row holds
  them, `variant_descriptions` resolved and narrowed like `descriptions` above), plus the product's
  (the parent's) kitchen name. A receipt language that neither its own text nor the default
  language's text resolves is filled with the variant's staff name, by
  `fillBlankLocalesWithStaffName` (`packages/catalogue/src/product-presentation.ts`), when the line
  is priced (`priceOrderLines`, `apps/server/src/working-order.ts`).
  Keeping both sets is what lets a report group variant lines under their parent.
  An extras item naming a variant freezes a composed pair from the published offer instead
  (`readExtraProducts`, `packages/catalogue/src/offered-modifiers.ts`); its child line carries
  that pair in its name fields, with no separate variant fields.
- `option_snapshots` — the diner's answers to the options lists this dish offered, each one frozen
  as the list's three names and the chosen label's three names, and no ids at all
  (`OptionSnapshot`, `packages/shared/src/option-selection.ts`). So this column carries
  customer-facing text of its own, alongside the two `descriptions` columns above. An extras pick is
  not in here: it becomes its own priced child line, which carries the picked product's names in the
  columns above like any other line.

The open order's line names what it sells in `working_order_lines.product_id`: the chosen variant,
or the product itself when it has no Active variant. The filed `sale_lines` row keeps the frozen
names, and records the same product in its own `product_id` and a variant's parent in
`parent_product_id`, as plain values with no foreign key, so no catalogue edit reaches a filed line
(sales classification spec §3). Neither table has a `variant_id` column.

**A line's VAT class is the one its published menu froze, fixed when its price is; its rate is the
one in force on the day the invoice is issued.** Each published menu version records the VAT class
of each dish, variant and extras item, and no rate (`buildMenuDocument`,
`packages/catalogue/src/menu-document.ts`), and a till is served that class rather than the
product's current one. A line added to a held order or a tab stores that
class (`working_order_lines.vat_class`) with its gross price; a walk-up sale is priced at payment,
from the version live then (`priceOrderLines`, `apps/server/src/working-order.ts`). A variant with
no class of its own was frozen at its parent's class, and an extras line takes the class frozen for
its picked product. Raising the quantity of an unsent line in place keeps that row's class; a line
an edit adds takes the class of the version live then. So a change to a product's VAT class reaches
a till only when a menu including it is published again, and until then that menu shows
Unpublished changes.

Each class's percentage is a dated table in code (`VAT_RATE_TABLE` and `vatRateOn`,
`packages/catalogue/src/vat-rates.ts`): a legal change ships as a new entry dated from the day it
takes effect. Issuing the invoice takes one clock reading, prices every line's class at the rate in
force on that reading's local calendar date, and dates the invoice with the same reading
(`issueMoment`, `apps/server/src/issue-moment.ts`). An order open across a change therefore pays the
new rate, and publishing a menu early cannot bring a rate forward. Invoice-first issues at placing,
so it takes the placing day's rate, or, when the order is paid before it is placed, at payment,
taking that day's rate; an integrated card payment fixes its gross lines before the
reader and takes the rate when its record is issued after it (`finalizeCapture`,
`apps/server/src/till-sale.ts`). The
filed `sale_lines.vat_rate` is the percentage actually filed. A reprint or a replay rebuilds its
lines' gross amounts from the stored lines and takes its VAT breakdown from the filed record. The
line's reporting classification is recorded when the line is added, from the product's
classification then (`working_order_lines.classification`), and issuance copies it (menus spec
`2026-09-20-menus-categories-and-home-layouts-design.md` §11.4, its 2026-09-27 notes).

Because both customer maps (`descriptions` and `variant_descriptions`) had their fallback applied
*before* being frozen, neither falls back again at render time, except that
`joinCustomerPresentationText` falls back to the variant's frozen staff name for a variant map with
no text at all. The kitchen names are frozen raw and fall back when drawn, through
`kitchenPresentationName`.

**An options answer is the exception to that, deliberately.** `buildLineExtras`
(`apps/server/src/modifier-selection.ts`) freezes the list's and the label's customer-facing map
exactly as the catalogue row holds it — `null` included — and widens each plain staff name into a
one-entry map under the venue's default content language. Nothing has fallen back by the time the
row is written, so the customer-to-staff fallback for an answer runs at RENDER time instead, in
`customerOptionSnapshotLabels` (`packages/catalogue/src/option-snapshot-labels.ts`): it takes the customer
map when `nonBlankTranslations` says that map holds text in some language and the staff map
otherwise, then resolves whichever it picked against the locale it was asked for, then the venue's
default content language — read from the staff map's one key, which both builders write under that
language (`buildLineExtras`, and `optionSnapshotOf` in `apps/till/src/state/held-options.ts`) — then
any language the map holds. The kitchen half
(`optionSnapshotLabels`, same file) takes no language step: through `kitchenPresentationName` it
prints the kitchen name and falls back to the staff map's one value.

That customer-to-staff step is the exception the top of this file points at — the one place the
rule is spelled out away from `product-presentation.ts`. A list and a label carry no variant, so
there is no whole `customerPresentationText` to call, only the same
`nonBlankTranslations(…) ?? <the staff name>` fold written out again. Checked by following every
use of `nonBlankTranslations` in the tree: the other callers use it to normalise a map on a write
path and none of them falls back to a staff name.
These builders lived in `apps/server` until Task 12 (2026-09-21) and went into `packages/catalogue`
there, because the till had to show the same labels on its own settled ticket and a browser cannot
import from `apps/server`. A third builder for the till's own staff wording
(`staffOptionSnapshotLabels`) sits beside them, and the till reaches all three through
`apps/till/src/widgets/option-snapshot.ts`.

None of these columns enters the fiscal hash, and none of them is sent to AEAT either. A filed
Veri\*Factu record has no line list at all — the goods reach it only as the sale's total, its VAT
breakdown, and one `DescripcionOperacion` string for the whole sale. That string is the venue's
configured operation description, which `packages/fiscal-verifactu` offers as "Venta en
establecimiento" (`packages/fiscal-verifactu/src/slot.ts`): `packages/core/src/record-sale.ts` reads
it from `locations.operation_description` and hands it to the fiscal backend as
`descriptionOfOperation`, and `packages/fiscal-verifactu/src/backend.ts` files it. These columns are
presentation columns, like `unit_name`.

Where each one surfaces:

| Surface | Reads | Code |
| --- | --- | --- |
| Receipt line — the goods identification, art. 7.1.e | the product and relative variant's frozen customer maps joined in parentheses | `apps/server/src/receipt-lines.ts` |
| Receipt — one `<list>: <label>` line under the dish | each frozen answer's customer maps, falling back to its staff maps | `customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts` |
| Kitchen ticket, including a watcher's copy | dishes and split-off extras read frozen kitchen names, falling back to staff names; a following extra's `+` line reads its frozen staff name; cross-references read kitchen names; options answers read kitchen names, falling back to staff names | `buildTicketItems`, `apps/server/src/kitchen-print.ts` |
| Also on this order (not for this station), on a station's own ticket and in its kitchen screen's order card | the kitchen names, through `kitchenPresentationName` | `readRestOfOrder`, `apps/server/src/rest-of-order.ts` |
| Kitchen display and the expediter's pass | dishes and split-off extras read frozen kitchen names, falling back to staff names; a following extra reads its frozen customer `descriptions`; cross-references read kitchen names | `readQueueSubItems`, `listStationQueue` and `listExpoQueue`, `apps/server/src/working-order.ts`, and `listPassScreen` and `listPassMonitor`, `apps/server/src/pass-board.ts` |
| Make now, on the till that sent made-here items | the staff names through `staffPresentationName`, each option answer's staff wording, and each extra's frozen staff name with ` x<n>` | `readMadeHereItems`, `apps/server/src/made-here.ts`, shown by `apps/till/src/widgets/make-now.ts` |
| Till buttons and basket | the staff names | `apps/till/src/widgets/product-name.ts` |
| A table tab's line list | the staff names, resolved server-side | `readTabLines`, `apps/server/src/working-order.ts` |
| Current orders on the till's table screen | the staff names, for each dish and each extra under it, resolved server-side | `readCurrentOrders`, `apps/server/src/order-groups.ts` |
| The floor's chip for a held dish that can no longer be sold ("Unavailable: Steak") | the staff names, resolved server-side | `readPartySignals`, `apps/server/src/table-signals.ts` |
| Till screens showing an options ANSWER | the reader each one names at the call site — kitchen on the rail and the pass, customer on the settled ticket, staff in the basket and the tab drawer | `optionAnswers`, `apps/till/src/widgets/option-snapshot.ts` |
| Printed allergen sheet | the customer-facing name held in the menu's published version | `apps/till/src/screens/till-allergen-screen.ts` |
| Top-sellers report | the product's frozen staff name, with each variant's own frozen staff name on a row nested under it | `packages/reporting/src/top-sellers.ts` |
| An adjustment record's `line_name` | the line's frozen staff names through `staffPresentationName`: the product and any relative variant joined in parentheses | `recordAdjustment`, `packages/adjustments/src/record.ts`, given it by `applyAdjustment`, `apps/server/src/adjustments-apply.ts` |

Two of those rows are worth reading twice.

A cook sees the same dish name and options answers whether the order arrives on paper or on a
screen: the ticket, the station queue and the pass resolve those through their kitchen wording.
The extras rows above record how a following extra differs between paper and screen. Each dish is
added from a zone's menu offer, which carries the product's and the variant's kitchen names as the
menu's published version holds them (`priceOrderLines`, `apps/server/src/working-order.ts`), so a
short dish kitchen name typed after publishing reaches all three surfaces on lines added once the
menu is published again. A blank kitchen name shows the staff name, including the variant's staff
name on a variant line. A
venue with no service zone sells nothing: sent lines with no zone, the till's three line-carrying
routes, `POST /api/sales`, `POST /api/pay` and `POST /api/working-orders`, take the starting zone of
the device's profile when the profile has a department — or, when that zone is switched off or has
left the department, the first by position of the profile's zones still usable — and refuse
`device_profile.no_service_zone` when none is; a profile with no
department takes the venue's counter-default zone, refused `service_zone.default_missing` when the
venue has none (`resolveHttpOrderZone`, `apps/server/src/till-api.ts`; `resolveNewOrderZone` and
`readProfileZones`, `packages/venue-service/src/`).

The top-sellers report groups lines under the parent's staff name, `sale_lines.name`, ranks those
products by quantity sold (name breaks a tie), and lists
under each one a row per `sale_lines.variant_name` sold with it — so "Wine by the glass" shows its
total with "175 ml" and "125 ml" beneath. The product's own row counts every line under its
name, including any sold as the product itself with no variant, and the report's row limit counts
products, not variants. It is a staff-facing report, so it shows the names staff use, not the
wording a diner reads on a receipt.

**Each surface shows ONE of a product's three names — staff, customer-facing or kitchen — and a
fixture gives the three DIFFERENT text**, or the test passes whether the surface reads the right
name or the wrong one. Cost: a report reading the diner's wording, recorded above the fixtures in
`packages/reporting/src/top-sellers.test.ts`.

## The translation gap report

`listContentTranslationGaps` (`packages/catalogue/src/content-languages.ts`) is what refuses to let
you switch your default content language while text is still missing. A product's and a variant's
customer-facing name is **optional** — absent, what is shown is the staff name
(`customerPresentationText`, `packages/catalogue/src/product-presentation.ts`) — so a wholly absent
one (`null` or `{}`) is never a gap. Only a partly filled one is: fill in Spanish and leave English
blank, and that is a gap, because you clearly meant to translate it and stopped. An options list's,
an options label's and an extras list's customer-facing name is optional in the same way and is left
out of the report for the same reason. Two of those three now reach a surface: an options list's and
an options label's customer-facing name are what the printed receipt puts under the dish
(`customerOptionSnapshotLabels`, `packages/catalogue/src/option-snapshot-labels.ts`), which is also where
the fallback to the staff name happens, so a missing one still is not a gap. An extras list's own
name reaches no order or receipt surface at all — a pick becomes its own line carrying the picked
PRODUCT's names, and nothing copies the list's name onto it. A menu section's customer-facing names
(`sections.names`, kind `menu_section`) are optional too, and only a partly filled map is reported.
The report reads owned sections and menu roots; a menu's customer-facing names are its root's. It
also reads each include of a menu that fixes a customer-facing name of its own (kind `menu_include`,
listed as `included_menu`, "Included menu folder"): the names that include's folder shows, which are
the included menu's own names with the ones the include fixes laid over them
(`readContentTranslationCandidates`, `packages/catalogue/src/content-languages.ts`). An include that
fixes no name yields no row, because `json_patch` with a null patch answers null, so a gap in the
names its folder shows is reported on the included menu's own row. As for a section, only a
partly filled map is a gap. An include is counted while it shows its sections directly too, because
switching the folder back on shows those names again. Its row shows the included menu root's staff
name, under the menu that includes it. One kind the query reports, `unit`, has no optional
customer-facing name to fall back from and stays required. A category has one plain internal name
and is not in the report. An options list contributes two of the report's kinds and not one, both
of them in the optional group: the list's own name (`option_list`) and each of its labels
(`option_label`), each with its own table. An extras list contributes one kind, `extra_list`, and no
second one: each of its items names a product and carries no name of its own, so `extra_list_items`
holds no map for the report to read.

A content-language save that leaves out a language Waitron keeps enabled for the venue's area (its
area's `requiredContentLocales` in the country pack) is refused (`content.language_required`,
`writeContentLanguages` in `packages/catalogue/src/content-languages.ts`), but nothing makes that
language's text complete. On the dashboard's Content languages page, **Edit translations** in a
language's row menu opens the **Missing translations** report in a read-only dialog (`listTranslationGapReport`,
`packages/catalogue/src/content-translation-report.ts`, read through
`GET /management-api/content-translation-gaps`). For each enabled language it lists the report's own
gaps for that language, marked **Partly translated** (only these stop that language becoming the
default), and, for every language except the default, what has no customer-facing name at all,
marked **No customer-facing name**, because there the staff name is shown in its place (an absent
extras list name is never listed: it reaches no receipt). Under the default language an absent name
is not listed, because the staff name stands as that language's text. Each row shows the staff name
— a unit, which has none, shows its name in the default language, or any text it has — and links to
the screen that edits it. That list leaves out an archived product, an archived variant and every
variant of an archived product, a disabled options or extras list and its options, and what a
switched-off menu owns; the default-change check above still counts all of them except an archived
variant, which it skips too. Image names (the media module's contribution) are checked on a change
of default but are not in the list.

## Content languages per region

**2026-10-08, A419:** Valencian is a separate content language, `ca-ES-valencia`.
Spain offers it alongside Catalan. New venues in the Valencian Community start with Valencian
as the default, Spanish and English; Valencian and Spanish are required there. Existing Catalan
text remains under `ca`: it is neither moved nor used as an implicit Valencian translation.
Missing requested text still falls back to the venue's configured default. Receipt languages
and interface translations keep their own choices. This replaces the Valencian parts of the
2026-10-06 decisions below.

The owner's decisions (2026-10-06 ~17:23, W109; built in W109-6, #1320, and W109-4, #1322), for real
venues and the demo. As relayed in lane A's queue (`~/waitron-campaign/queue.md`, WATCHER
NOTE of 17:23 above W109-1) and `~/waitron-campaign/questions.md` ("2026-10-06 17:23 — OWNER
ANSWERS"):

- Required content languages, in Spain's pack, for real venues too: _"every area not named below:
  **Spanish** required"_ (_"service must be offered in Spanish even where the law does not require
  Spanish on printed menus"_); Catalonia Catalan and Spanish (unchanged); Valencian Community
  Catalan and Spanish (unchanged), _"'Valenciano' is Catalan (`ca`) for now"_, foreign-language
  notice kept;
  **Balearic Islands Spanish + Catalan**, _"Stricter than the law … the owner's choice"_ (the law
  asks for one official language, `docs/compliance/regional-language-rules.md`); Galicia Galician +
  Spanish (unchanged), two-foreign-languages notice kept; Basque Country and Navarre _"no change"_.
- _"English is switched on (not required) in every region. A NEW venue starts with its region's
  required languages plus English"_ — no more Catalan in Galicia or Madrid.
- _"The demo fills exactly those languages."_
- Default content language (owner "a"): the regional language wherever one is required (Catalan in
  Catalonia, the Valencian Community and the Balearic Islands; Galician in Galicia), Spanish
  elsewhere; the venue can still change it.

As built (W109-6): Spain's pack requires Spanish in every area it
does not otherwise name and Spanish + Catalan in the Balearic Islands, defaults to the regional
language in the Valencian Community, the Balearic Islands and Galicia, and a new venue starts with
`resolveInstalledStartingContentLanguages` (`packages/country-packs/src/registry.ts`): its default,
its area's required languages, then English. The dashboard's required-language messages now say
Waitron keeps the language enabled for the region, not that the region requires it. The new rules reach existing venues
at their next start; only their stored language list waits for a reset.

As built for the demo (W109-4): a demo keeps the languages setup gives
its area (except a pack with no data set of its own: English is its default, its languages are
English plus the area's required ones, and a required language the set has no text in is listed
as missing, W109-2), writes every customer-facing text in each of them
(menus' customer names included), and
saves its row through the required-language check; a Barcelona demo is Catalan (default), Spanish
and English with nothing listed as missing.

## Colour

A colour helps staff find a dish on a busy till, so a product has one colour, the same on every
menu and in every section that holds it. Nothing stores a colour on a menu's placement of a product
or on its Price overrides tab.

That colour is worked out in order. It is the product's own colour (`products.color`) if it has
one. Otherwise it is its main category's colour, or, when that category has none, the colour of the
nearest category above it that does (`category_details.color`). Otherwise it is the venue's
default colour (`catalogue_settings.default_color`); with no default it has none, and each
screen draws its usual neutral look. The rule lives in one place, `effectiveColor`, `categoryColor` and
`categoryColorSource` (which also says which category the colour came from) in
`packages/catalogue/src/color-inheritance.ts`, which the server and the
dashboard both call. So colouring a category colours every product under it, at any depth, that
has no colour of its own and no coloured category nearer to it, and the default colours every
product with no colour of its own and no coloured category above it, a product in no category
included.

You set a product's own colour in the product editor, which has a colour chooser after Name;
its first choice, "Use category colour", shows the colour the product would take from its category
(following a category you change in the editor before saving), or says "Its category has no
colour." When no category above the product has a colour and the venue has a default, that choice
reads "Use default colour" and shows the default (`renderColor`,
`apps/dashboard/src/widgets/product-editor.ts`). Choosing it saves no colour of the product's own.
A colour is lowercase `#rrggbb`, or null for none. A save refuses anything else, an empty string
included, as `product.invalid` with `field: "color"`; a default colour is refused as
`category.invalid` with `field: "color"` (`saveCatalogueDefaultColor`,
`packages/catalogue/src/settings.ts`). A configuration import refuses the whole
bundle when a product's, a category's or a menu section's colour, or the default, is anything else,
as `setup.request_invalid` with `field` set to `products.color`, `category_details.color`,
`sections.color` or `catalogue_settings.default_color` (`validateCatalogueConfiguration`,
`packages/catalogue/src/configuration-transfer.ts`). A category's colour is set from the colour
square before its name in the Products tree, or from the one in the box that names or renames it
([product-categories.md](product-categories.md)). The default is set from the square before
All products, the tree's first row, whose chooser is headed "Colour of All products"; at phone
width the tree hides that square, as it hides the categories'.

**A colour reaches a till only when a menu is published.** Publishing records each offer's colour
in the menu's version, as it does the photo and description (`freezeOffer`,
`packages/catalogue/src/menu-document.ts`). Changing a category's colour, or moving an uncoloured
category under a coloured one, whether through `updateCategory` or the Products tree's Move
(`moveCatalogueItems`), or changing the venue's default colour (`saveCatalogueDefaultColor`), makes a published menu read as changed when it holds a product whose worked-out
colour this changes (one with no colour of its own and no coloured category nearer to it), and the
menu's Preview tab names the change "colour" for that product. The version on sale keeps the old colour until you
publish (the "a category's colour" cases in `packages/catalogue/src/menu-publication.test.ts`). The
dashboard's Products tree, product editor and a menu's Structure tab draw the stored default, not
a published version's. A
product's own colour goes into the next version's offer in the same way
(`packages/catalogue/src/menu-document.test.ts`), though no test reads a menu's status after one. A live version in an
earlier document format is not sold from: [product-categories.md](product-categories.md).

A menu section has a colour of its own, set in the section form. It paints the section's own tile
and nothing else: the products inside the section keep their own colours.

On the till (`apps/till/src/widgets/menu-browser.ts`), a product tile and a section tile with a
colour fill with it, and their labels, and a section tile's folder icon, switch to black or white,
whichever reads better on that colour (`readableTextColor`, `packages/ui/src/category-color.ts`). A
tile with no colour, or with a value that is not a lowercase `#rrggbb` colour, keeps the plain look.
That is the menu's Colours display; in its Thumbnails display a tile with an image shows the image
and is not filled (_On the till_, below).
The dashboard does the same with such a value: the swatches in the Products
tree and a menu's Structure tree draw it as no colour, and the colour chooser's "Use category
colour" choice says the category has none (`apps/dashboard/src/widgets/color-field.ts`).

A sold-out till tile, painted or not, is filled `--wt-color-surface-sunken` at full strength
instead of taking `wt-button`'s usual disabled fade — the light grey of `--wt-color-border` in the
light theme, and the page's own `--wt-color-bg` in the dark, a level below an available tile's
`--wt-color-surface` — its name, price and "Sold out" in `--wt-color-text`. A painted one keeps
its colour as a stripe along its left edge, `--wt-space-1` wide, with a one-pixel `--wt-color-text`
line on the tile's side of the stripe (W92a, A292). Both are inset shadows, which take no layout
width, so the labels stay centred; a shadow's offset is physical, so the stripe would stay on the
left in a right-to-left language, and the till has none (`catalogues`,
`apps/till/src/i18n/strings.ts`). The button stays disabled, so a tap adds nothing. The "tile
colours" cases in `apps/till/src/widgets/menu-browser.test.ts` work out each label's contrast as it
is seen, the button's opacity included, and hold it at 4.5:1 or more in both themes; they also pin
the fill, the stripe's colour and width, that each sold-out tile's name and label block are centred
within 1px of its button's centre, that in the dark theme the fill is no lighter than the page, the
disabled button and the language of "Sold out". One case mounts a sold-out tile in each of the 24
`CATEGORY_PALETTE` colours in both themes and requires each stripe to reach 3:1 against the tile's
fill or, where it does not, the line beside it to reach 3:1 against both the fill and the stripe.
Measured in Chromium on 2026-10-06, the stripe alone falls short for 19 colours in the light theme
(lowest 1.02:1) and 2 in the dark (lowest 2.03:1), and for those colours the line's lowest is
4.23:1 in the light theme and 5.72:1 in the dark; with the line deleted that case failed in both
themes, naming those 21 colours. axe does not check any of this: the case "home, with a plain and
two painted (dark and pale) sold-out tiles and a weighed product's tile, has no violations" in
`menu-browser.a11y.test.ts` passed on the old fade, under which the painted tiles' labels read at
2.16:1 to 3.49:1.

## Variants

A variant is a `products` row whose `parent_id` names its parent product — "125 ml" and
"175 ml" under "Wine by the glass". There is no separate variant table. A variant's parent is a
top-level product in the same catalogue, is fixed when the variant is created, and a variant has no
variants of its own (the one-level rule is the core migration `packages/db/drizzle/0004_variant_one_level.sql`). A product
may have any number of variants, one included.

### What a variant reads from its parent

**Every field a variant leaves blank reads its parent's, except its three names.** Among them its
tax rate, course, description, image and allergen and dietary declarations
are its parent's while its own column is blank and its own once it sets them
(`effectiveProductColumns`, whose keys are `INHERITED_KEYS`,
`packages/catalogue/src/variant-fallback.ts`). Its main reporting category is always its parent's,
whatever its own `category_id` holds: `effectiveProductColumns.categoryId` reads the parent's for a
variant, `readProductEditor` returns `primaryCategoryId: null` for one, the editor save refuses a
variant body naming a category (`product.invalid`, field `primaryCategoryId`) and writes the
variant's column back to null, and deleting a category clears it from any variant still holding it
(`vacateCategories`, `packages/catalogue/src/categories.ts`). No migration clears the categories
variants held before this rule (A209), and the owner decided on 2026-10-03 that none will be
written: there is no data-migration code before go-live (CLAUDE.md §3) and the dev venue is reset
before then. So an older variant row may still store one until the next save of the variant's
own page or until that category is deleted.

Its unit is always its parent's too (A222), and with it the legacy `pricing_unit`: the unit read
joins the parent's `product_units` row, never one the variant stores (`unitOwnerJoin`, same file),
and `effectiveProductColumns.pricingUnit` reads the parent's. `readProductEditor` returns
`unitId: null` for a variant; the editor save refuses a variant body naming a unit
(`product.invalid`, field `unitId`) and otherwise deletes any unit row the variant stores and
blanks its `pricing_unit`; and `assignProductUnit` answers a variant's id with `product.not_found`.
No migration clears the units variants stored before this rule: that carries the owner's category
decision above over to units, which the owner has yet to confirm. Unit management ignores such a
row: `productsUsingUnit` lists products with no parent only, reassigning a unit's products skips a
variant, and `deleteUnit` deletes those rows before the unit (`packages/catalogue/src/units.ts`).

Its colour is always its parent's too (W92), whatever its own `color` column holds:
`effectiveProductColumns.color` reads the parent's for a variant, and `readProductEditor` returns
`color: null` for one. A variant's page shows no colour chooser; the editor save refuses a variant
body carrying a colour (`product.invalid`, field `color`) and writes the variant's column back to
null. `updateProduct` (`packages/catalogue/src/operations.ts`) given a colour answers a variant's
id with `product.not_found`. A published offer carries one colour, its product's; its variants carry none.

Its extras and options
lists are always its parent's. Its Name, customer-facing name and kitchen name are never inherited: a blank customer or
kitchen name falls back to the variant's own staff name (_The three names_, above).

A variant's published allergens stay blank, and so read as its parent's, until it sets allergens of
its own, and its published diet likewise until it sets a diet override of its own; once set, each is
computed over the parent's recipe-derived values and recomputed when those change
(`republishOverlays`, `packages/catalogue/src/operations.ts`).

### Price

A variant's own price may be blank. On a menu it is charged the most specific price that is set
(`resolveOfferPrice`, `packages/catalogue/src/offer-price.ts`):

1. that menu's price for the variant (`menu_item_variant_overrides.price`);
2. else the variant's own price (`products.unit_price` on its row);
3. else its parent's price on that menu (`menu_items.gross_price`);
4. else its parent's own price.

A menu may leave any product's price blank (`menu_items.gross_price` is nullable), which means the
product's own price. A menu's Price overrides tab shows the price a blank field inherits as its
placeholder: one amount, the range across a product's Active sizes, or a clash
(`apps/dashboard/src/widgets/menu-price-inheritance.ts`). The
product-editor save accepts a blank variant price both in the parent's variants list and on the
variant's own page (`parseProductEditorInput`, `packages/catalogue/src/product-editor-input.ts`),
and `writeProductVariants` (`packages/catalogue/src/variants.ts`) stores it blank.

A variant follows its parent onto every menu the parent is on; it never gets a `menu_items` row of
its own (`addProductToMenu` refuses one with `menu_item.variant_not_allowed`, and a section refuses
one as a member with `menu_section.membership_invalid`). A menu stores something
for a variant only to override its price there: a `menu_item_variant_overrides` row, keyed by the
parent's menu row and the variant, holds that menu's price, and saving the price blank deletes the
row. Saving one size's price on a menu writes that size's row alone (`setMenuVariantPrice`,
`packages/catalogue/src/variants.ts`), while `setMenuVariants` replaces the row of every Active size
at once. An archived size holds no row: archiving it deletes its row on every menu, and
`setMenuVariantPrice` refuses one with `product.variant_not_found`. The table's
`menu_item_variant_overrides_overrides_ck` refuses a row with no price.

### Active and Available

A variant has the same two states as a product (_One save, one transaction_ below).
Archiving a saved variant keeps its row; Remove on an unsaved one just drops it from the draft.
A saved active variant left out of a product save is archived too (`setProductVariants`). An
already archived variant, omitted or sent inactive, stays unchanged. A live or scheduled menu
holding the variant refuses the archive with `product.on_live_menu`.

A product is on an active menu when that menu's working structure places it — in the menu's own
sections, or inside an active menu it includes — and the product is Active; it is sellable when it
is also Available. A variant is listed under its parent's offer while it is Active, and is sellable
while it is Available (`readOfferVariants` in `listMenuOffers`,
`packages/catalogue/src/operations.ts`). A menu has no on/off setting of its own for a product or a
variant. To take a product off a menu, change the structure so that nothing in it places the
product; one that comes through an included menu goes when that menu's structure stops placing it or
the menu is no longer included. Archiving is refused while a live or scheduled published menu includes the product or variant.
Remove it and publish first. Archiving a product then removes it from menu drafts and extras
lists, archives its variants and clears their menu prices. Archiving a variant clears its menu
prices and removes it from extras lists. Neither can be enabled again
([product-categories.md](product-categories.md), "Moving and deleting").

You can fix an archived product's or variant's customer-facing translations by naming that target
in the content-translations route. The automatic missing-translations list still leaves archived
families out. An edit opened before archiving needs Review latest before it can save because the
activity state is part of its saved baseline. Other inactive translation targets remain unavailable.
The archived product keeps its unit assignment. You cannot delete a unit that it still uses or
reassign it to another unit; the unit remains available for its retained details.

A menu's Price overrides tab lists every Active product an active menu's working structure
reaches, with its Active sizes. The working offers leave archived products and sizes out. The tab's Available
column reads the product's, or a size's, own Available flag. The tab reads `menuPrices`; a
menu's offers, and the published document built from them
(`packages/catalogue/src/menu-document.ts`), come from `listMenuOffers` (both in
`packages/catalogue/src/operations.ts`), and both leave an archived product or size out.

The offers a till sells from are each menu's published version, which leaves out a product that was
archived when it was published (`listMenuOffers`, `packages/catalogue/src/operations.ts`). A product
that is Unavailable, or has become archived since, is served in its place marked unavailable
(`applyLiveFields`, `packages/catalogue/src/menu-document.ts`). A change to a menu's structure
reaches the tills only when the menu is published again. Whether each product and variant is
Active and Available, including products picked as extras, is read from the current rows
(`applyLiveFields`).

### On the till

Each product placed in a menu's published structure gets a button in the till's menu browser
(`apps/till/src/widgets/menu-browser.ts`): where the structure places it, in the search results,
and wherever the menu's Device Home Page places it. Where the device's service zone serves more than one
menu, the search results also list each other served menu's matching products in a group of their
own, each at that menu's price; [design-system.md](design-system.md), _The till's menu search_. The exception is a product whose
standalone ordering the menu published as Not sold separately (`LiveOffer.ordering`): it has no
button anywhere, and a section left with nothing else goes too (`indexMenu`), though a dish's
extras list still offers it. Staff only gets a button like Public, because there is no guest
ordering yet. A draft line, or a counter basket line not yet saved, that holds a dish now sold only
as an extra is marked "Only sold as an extra" (`lineBlock`, `apps/till/src/state/menu-refresh.ts`):
a draft leaves it out of what it sends and offers it for removal, and the counter holds Pay until it
is removed. A line already stored on a held order or tab is not marked, and still sends and pays,
because it was already ordered. The server refuses a new standalone line for such a dish with
`product.not_sold_separately`, by the same published setting. A diet filter that staff turn on
hides the dishes it rejects. A section it leaves with nothing keeps its place, faded and not
openable, reading "Nothing matches the filter" (`unfilteredProducts`,
`apps/till/src/widgets/menu-browser.ts`) — in the full menu, as a shortcut and inside an open
section; if the filter empties the section that is open, the till says "Not found" and shows home.
A dish that cannot be sold now keeps its button, greyed, and a tap on it
does nothing (`hasSomethingToSell`, `apps/till/src/widgets/product-pick.ts`), so the buttons around
it do not move; the till's
menu-state poll greys and restores it without reloading the offers (`apps/till/src/till-app.ts`). A
variant never has a button: it is listed only nested under its parent's offer
(`LiveOffer.variants`). The till reads its offers from the zone
(`GET /api/default-service-zone/offers`, `GET /api/service-zones/:zoneId/offers`).

Under search, the till shows the menu's Device Home Page shortcuts and the menu's own structure as
two blocks, in the order the menu's display for that kind of device sets: a handheld (a phone or a
tablet) uses the menu's Handheld display and every other device its Till display. "Device Home Page
first" puts the shortcuts first and "Menu first" the structure; neither reorders anything inside a
block. A divider naming the second block sits between them, and a block with nothing to show is
left out with no divider. The display's column count is the most a grid shows: a grid shows fewer
where a tile would be narrower than its minimum, so a phone held upright shows two or three. A
canvas card that sets its own column count keeps it. In Colours mode a tile fills with its
colour (_Colour_, above); in Thumbnails mode it shows the product's or section's image instead, and
a tile with no image falls back to its colour, else the plain tile. A shortcut whose target the
till does not show keeps its place as an empty slot, so the shortcuts after it do not move; a
shortcut to a section a diet filter emptied shows that section's faded tile in the slot instead. The
display and the shortcuts come from the menu's published version, so a change reaches the till
only when the menu is published.

Tapping a parent sold in whole units, and not tied to a scale, opens the picker at once
(`pickProduct`, `apps/till/src/widgets/product-pick.ts`). A parent sold by weight or in fractions, or
tied to a scale, asks for its quantity on the keypad first and then opens the same picker (`#addWeight`,
`apps/till/src/widgets/tender-pay.ts`). The picker lists the variants in the one variant order,
`products.variant_order`, set by the product editor (`writeProductVariants` writes the order the
variants were sent in). The first available one is chosen to start with; an unavailable one stays
listed, drawn disabled; each is labelled with its difference from the parent's price on that menu
("+€1.50") where it has one (`till-modifier-picker`, `apps/till/src/widgets/modifier-picker.ts`;
the difference is worked out in `apps/till/src/api/client.ts`). A product none of whose variants is
available on that menu keeps its button, greyed (`hasSomethingToSell`). An extras list does not offer a product
that has an Active variant (`readExtraProducts`, `packages/catalogue/src/offered-modifiers.ts`),
since the order path refuses one picked as an extra (below). The catalogue refuses both ways of
putting one there: an extras list naming such a product (`extras.product_has_variants`), and an
Active variant on a product an extras list offers (`product.offered_as_extra`, which names the
lists). A variant itself may be an extra.

### The sale line

**A product with an Active variant, Available or not, is never sold as itself** (#556): a
line that rings it up without naming a variant is refused `product.variant_required`, and so is an
extras pick of it. Every sale line names a zone's menu offer, and `selectMenuVariant`
(`packages/catalogue/src/variants.ts`) refuses a dish line that names no variant. An extras pick
cannot name a variant, so `priceOrderLines` (`apps/server/src/working-order.ts`) refuses a pick of
such a product; a pick of a variant itself sells. That refusal comes from one read for the whole
basket's picks (`parentsWithActiveVariants`, `packages/catalogue/src/variants.ts`). A product whose
variants are all archived sells as itself.

On the server, an edit of a held order keeps each stored line it names, at its stored price —
including one whose product, or one of whose extras, has since gained an Active variant — and
prices only what the edit adds (menus plan D10; `updateHeldOrder`,
`apps/server/src/working-order.ts`). Lowering or keeping such a line's quantity is allowed; raising
it is refused `product.variant_required`, as a raise of a line whose product has become archived or
Unavailable is refused. Paying a held order bills its stored lines at their stored prices and
VAT classes, at each class's rate on the day of issue, as _What a sold line freezes_ says; a line not yet sent, dish
or extra, whose product is now archived or Unavailable is refused `product.unavailable`, while a
sent one is billed whatever its product's availability (`priceStoredOrderForIssuance`, same file;
a card payment already captured is filed as it stands). On the till, retrieving the order keeps
such an extra in the basket, marked "Not offered now" and counted in the total, as it keeps a
sold-out one, because the list the pick was taken from no longer offers it (`deriveExtraSelections`,
`apps/till/src/state/held-extras.ts`) and paying with no edit still bills it: an unedited retrieved
basket sends no update (`#syncIfDirty`, `apps/till/src/till-app.ts`). The till never sends such a
pick, so the first edit takes it off the basket, and the server removes that extra from the line
and keeps the rest at their stored prices.

A line sold as a variant has the variant as its `product_id`. It is priced and taxed at the
variant's effective values above, and freezes the parent's names beside the variant's own
(_What a sold line freezes_, above), so reports can group it under its parent. The filed
`sale_lines` row names the variant and its parent only as plain values, never as keys. In the kitchen, the variant is routed by its parent's
row in the routing grid: the parent's product cells first, then its effective category's cells and
each parent category's, or the No category cells when the parent has no category, then All
categories (`selectRoutingCell`). Its course, category, allergens and dietary labels
are its effective values (`effectiveProductColumns`; `packages/venue-service/src/routing.ts`;
`priceOrderLines`, `fireLines` and `readQueueSubItems`, `apps/server/src/working-order.ts`). The
till splits a tab line by the unit precision the line
froze (`TabLine.unitPrecision`), since a variant is not one of the till's products.

### In the product editor

Under Available, **Standalone ordering** offers three choices: Public, Staff only and Not sold
separately (`products.ordering`). A variant's own page does not offer it, because the till and the
server read the dish's setting and a variant is only ever ordered under its dish. The products list
shows the same setting as a column with a filter (`apps/dashboard/src/widgets/product-list.ts`).

The editor allows any number of variants, one included (`apps/dashboard/src/widgets/product-editor.ts`):

- **Add variant** opens the Add window for one variant, and saving that window adds one row.
  Cancelling it adds nothing. The window's heading names the product by its staff name as the form
  holds it, saved or not: "Add variant to: Coffee", or "Edit variant of: Coffee" for an existing
  variant (`editor.add_variant_to`, `editor.edit_variant_of`). While that name is blank it reads
  plain "Add variant" or "Edit variant". A variant's own page reads the parent's saved staff name
  in its editor response and heads "Edit variant of: Coffee"; reloading reads that name again.
- The Pricing section holds the price field and then VAT. While at least one variant is Active the
  price's label reads "Base price per" and the unit (`editor.base_price_unit`), or "Base price"
  alone (`editor.base_price`) for a product with no unit, a variant with no price of its own shows
  the base price as its hint, in its window and in its table row, and the Pricing section is a fold
  whose closed line names the base price and the VAT (`pricingSummary`). The fold opens on a VAT,
  unit or price error (`SECTION_FIELDS`) and starts open on a product never saved. The table and Add
  variant are a separate Variants section under it, always open.
- An active saved row's menu offers **Open**, **Edit** and **Archive**; an unsaved row uses
  **Remove**. **Open** goes to the
  variant's own page and is shown only for a saved variant; it is disabled, with a line saying to
  save first, while the product form has unsaved changes, because opening the page replaces the form.
- A click on a variant's row, or Enter on it, opens its edit window, as the menu's **Edit** does. The
  drag handle, the Available switch and the row menu keep their own clicks.
- **Archive** stages `active: false` on a saved variant. Its row stays visible with
  **Archived when saved** and **Keep**, which cancels that change before Save. **Remove** drops a
  variant never saved from the draft. The table hides variants archived before the editor opened;
  there is no show/hide toggle and no action to bring them back (`dashboard-variant-table`,
  `apps/dashboard/src/widgets/variant-table.ts`). An archive refused on Save keeps the draft open
  and names the live or scheduled menus holding the variant.

A variant also has its own product page: the product editor's routes read and save a variant's id.
The value it reads is the variant's own row, a field it leaves blank read blank, and its parent's
value for each of those fields in `inherited` — for allergens, the parent's published declaration
(the allergens staff set on it together with those its recipe derives, or no declaration at all
while nothing on the parent has been reviewed or its recipe has an unreviewed ingredient), since
that is what a blank reads as, while the variant's own allergens field holds only what staff set on
the variant. Saving a blank keeps the field inheriting, and saving a value overrides it for that
variant alone. The main category, the unit and the colour are the exceptions: the read gives a
variant `primaryCategoryId: null`, `unitId: null` and `color: null`, and the save refuses a non-null
value of any of them with `product.invalid`. The variant always takes its parent's category and
unit, and the save stores no colour on it (`readProductEditor` and `saveProductEditor`, with the
refusals in `parseProductEditorInput`, `packages/catalogue/src/product-editor-input.ts`). The page
shows the parent's unit beside the price as fixed text, with no unit button or dropdown
(`renderPrice`, `apps/dashboard/src/widgets/product-editor.ts`). A variant's body may leave its
price, tax rate and dietary declarations blank, which
a product with no parent may not; it carries no variants and no extras or options lists of its own;
and its parent never changes, so a body naming a different `parentId` is refused
(`saveProductEditor`, `packages/catalogue/src/product-editor.ts`).

### Photos

A variant's own photo is `products.image` on its row. The image library lists it among a photo's
uses as a `variant` of its parent and refuses to delete a photo one still uses (`listImageUsages`
and `deleteImage` in `packages/media/src/images.ts`); a variant with no photo of its own shows its
parent's and holds no use of it.

`products.image` is protected by the database, variant rows included, but not by a real foreign
key: `packages/media/drizzle/0001_image_references.sql` protects it with **four triggers** — one on
insert, one on an update of `image`, one on deleting the parent image, one on renaming it.
That file's own header states what a trigger is not, and two of its points matter to anyone reading
this page: `pragma foreign_key_list('products')` does not list the rule, so nothing that enumerates
keys from the engine sees it; and a write naming a missing filename is refused with errcode 1811
(`SQLITE_CONSTRAINT_TRIGGER`), where a declared key refuses it with 787
(`SQLITE_CONSTRAINT_FOREIGNKEY`), while a refused delete of an image in use is 1811 either way when
the key is `on delete restrict`. Guard:
`packages/media/src/image-references.test.ts`, whose cases use top-level products. For a variant
row, measured 2026-09-23 with a throwaway suite over the core, catalogue and media migration sets:
inserting a variant naming a photo that does not exist, and deleting with raw SQL a photo a variant
uses, were each refused with errcode 1811 by `products_media_image_fk`, while a variant naming a
photo that exists was accepted.

## The editor form

`dashboard-product-editor` (`apps/dashboard/src/widgets/product-editor.ts`) is one short form. The
fields that change often are always visible; everything else is folded into a `wt-disclosure`
section with a summary on its closed line. Kitchen, Descriptors and Nutritional info name each
field they hold, with "None specified" (`modifiers.none_specified`) for one left blank; the Pricing
fold leaves a blank base price, and a VAT class the form does not offer, off its line. The
Descriptors rows are cut after one and two lines, which can hide a later language's value, so
opening the section is what shows every value. Top to bottom: the category path, Name, with the
photo beside it as a small button that opens the image library (absent when the editor is given no
`api`), the colour chooser (absent on a variant's page), Available, Standalone ordering (absent on
a variant's page), ▸ Kitchen, ▸ Descriptors, ▸ Nutritional info, Pricing (a ▸ fold once some
variant is Active), Variants, Modifiers, then Cancel and Save. An archived product opens a plain-text details panel through View, not this editor. Opened on a
variant, the same form is the variant's own page: it has no colour chooser and no Standalone
ordering, Modifiers or Variants section, and each field the variant may leave blank to take the parent's value shows that value as its hint; the course, description,
allergens and dietary preferences also show it in italic on their folded section's closed line.

The form's Modifiers section is one ordered list mixing extras lists and options lists, reordered by
each row's handle — a pointer drag or the arrow keys (`reorder-table.ts`'s `handle`) — with each row
naming the list's plain STAFF name and which kind it is.

Sections start collapsed, and open and closed state is not remembered. Pricing is the exception: it
does not fold at all while no variant is Active, and its fold starts open on a product never saved.
A section holding a validation error opens itself and cannot be collapsed until the error is fixed —
that is `wt-disclosure`'s `has-error`, described in [the design system](design-system.md).

The main category is the form's first line: its path, the names joined with " › " (`categoryPathText`,
`apps/dashboard/src/widgets/classification-fields.ts`), "No category" (`categories.none`) for none, or "Unavailable
selection" (`editor.missing_choice`) for a category id the loaded list lacks. On a product the path is
`categoryPathField` in the same file, a `wt-combobox` with `appearance="link"` and the action word
"Change" (`editor.change_category`). Its list offers "No category" first, then every category
depth-first with each set of siblings sorted by name (`byLabel`), a row showing the category's own
name indented by its depth while nothing is searched for; once chosen, the path is what shows. The control keeps the name
`primary`, so a refused `category.not_found` on save lands under it. On a variant's page the
parent's path is plain text with no Change, and the save always sends `primaryCategoryId: null`.
New categories are made on the Products screen (`folders.add_category`,
`apps/dashboard/src/widgets/product-list.ts`); the editor has no button for one. See
[Product categories](product-categories.md).

## One save, one transaction

**The course is saved with an active product.** `applyRouting` runs for an active editor result
inside the same transaction the product write already opened (`apps/server/src/catalogue-api.ts`), so a course id the venue does not have
rolls the whole product back, and you can choose a course as you create the product.

The product write body carries `name` (required, plain text), `customerName` (a language map or
`null`), `description`, `kitchenName`, `image`, the price and tax fields, `primaryCategoryId` (the
main reporting category; on a variant it must be `null`, and any other value is refused with
`product.invalid`; a body carrying the retired `labelIds` is refused), `modifiers` (the ordered attachment list, each entry a `kind` of `extras` or
`options` and a list id — it replaced the flat `modifierIds` on 2026-09-19), the allergen and
dietary declarations, the two required state flags `active` and `available` (below), the required
`ordering` (a body carrying the retired `soldAlone` is refused), and `variants`
— each variant carrying `name`, `customerName`, `kitchenName`, `image`, `unitPrice`, `available` and
a required `active`, plus `id` when it already exists. An active variant sent with `active: false`, or left out of the body, is archived; an already
archived variant sent inactive or omitted remains unchanged (`writeProductVariants`,
`packages/catalogue/src/variants.ts`). A customer-facing name whose every entry is blank parses to
`null`, so "I typed spaces" and "I left it empty" store identically.

A product has two states. **Active / Archived** is its retained state. Archive sets `active: false`
and keeps the row. Switching it back on is refused with `product.archived`. Editor saves, product
patches, variant writes, extras-list additions, course and recipe writes, and unit reassignment
refuse an archived product too. Translation fixes, the main reporting category and folder moves
remain allowed.
**Available / Unavailable** is "sold out for now": the editor's Available switch sends `available`,
and it hides nothing in the dashboard. The till sells a product, or offers it as an extra, only when
it is both (`applyLiveFields` in `packages/catalogue/src/menu-document.ts` marks it on each
served offer and extras item, and `priceOrderLines` in `apps/server/src/working-order.ts` refuses
what it marks) —
except that an edit of a held order may keep a line at or below its quantity although its dish or
an extra has since become archived or Unavailable (a raise is checked in `updateHeldOrder`, and a
change to the note, options or extras of a line the kitchen already has is refused
`product.unavailable` too, because the changed line is sent to the kitchen again — `applyLineEdits`),
and paying bills such a line only once it has been sent; unsent, it is refused `product.unavailable`
(`priceStoredOrderForIssuance`).
`listMenuOffers` keeps an Unavailable product's offer, as it does an Available one. A variant is
listed only under its parent's offer, only while Active, and as available only while Available; a
menu cannot hide one (_Active and Available_, under _Variants_).
