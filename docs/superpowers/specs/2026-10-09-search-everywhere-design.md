# Every search follows one rule — design

> 2026-10-10: [A461's plan](../plans/2026-10-10-a461-product-search.md) supersedes
> Products and Menus Structure tree-search presentation and selection lifetime, and adds matching
> sections to the till's results. Search closeness and table-sort ties remain unchanged.


Status: approved in conversation 2026-10-09; this document awaits the owner's review.

## Why

PR #1478 gave the till's product search, and the dashboard's preview of the till home page, a
better rule: a product matches when its name holds every word typed, in any order, and the closest
matches come first. Every other search in Waitron still uses its own older rule — most match only an
unbroken run of the typed text, ignore capitals but not accents, and keep their own order. The owner
asked (2026-10-09) for every search to follow the new rule.

## The owner's decisions (2026-10-09)

1. **Every typed search uses #1478's rule.** A result matches when it holds every word typed, in any
   order. Accents, capital letters and punctuation are ignored. A word followed by a space (or any
   other character that is not a letter or digit) must be a whole word; the word still being typed
   may be any part of a word.
2. **A search of only punctuation shows nothing.** "&" or "-" alone finds no results. A search of
   only spaces is no search at all, and shows everything as today.
3. **Closest matches first, everywhere.** While a search is typed, results are ordered by how well
   they match, ahead of a table's own sort.
4. **In a tree, the closest matches come first among the rows under each parent**, so the parent
   rows (categories, sections) stay visible and place each result.
5. **The image library's search becomes exactly the product rule.** Its quoted phrases, `-word`
   exclusion and `or` are removed.
6. **The Orders list, Find a bill and Find an invoice follow the same rule**, accents included. An
   invoice number such as `A/12`, or a bare number, still finds that number exactly, as today.
7. **A search looks at names only; other fields are reached through the filters.** A product is
   found by its own name and its variants' names — not its category, price, extras or "sold
   separately". Staff keep their names, email and telephone (owner's answer). Readings applied the
   same way, for the owner to correct: a modifier list by its name and its extras' or options'
   names, not its "used by" text; a unit by its name and abbreviation; a device by its name; an
   order or bill by its party name, delivery label and table labels (the till's Find a bill has no
   table filter, so its search is the only way to find a bill by table).

_2026-10-10, A459: the owner clarified Find an invoice. A bare number also finds that invoice
number in every full-invoice series, listed newest first ahead of customer-name matches. Names
keep the shared ranking; `A/12` remains an exact series-and-number search._

## The rule, precisely

- **Folding.** Text and query are compared after decomposing accented letters, dropping the accent
  marks and lower-casing (`foldForSearch`, today in `packages/catalogue/src/device-home.ts`).
- **Words.** A word is a run of letters and digits. Everything else separates words, in the query
  and in the text alike.
- **Matching.** Every word of the query followed by a separator must be a whole word of the text. The
  last word, when the query ends in a letter or digit, must appear somewhere in the text, as any part
  of a word. A query with no words matches nothing, unless it is blank, which is no search.
- **Order.** By the query's last word: a whole word, then the start of a word, then inside a word;
  then the earlier position; then the shorter text; then the order the caller gave.

### Text in several parts

Many rows are searched on more than one field — a product's name, category, variants and price; a
person's display name, names, email and telephone. The matcher takes a row's text as an ordered list
of parts:

- each completed word may be a whole word of **any** part, and the word being typed may appear in
  any part;
- a word never spans two parts;
- the order compares the last word's best match: first its kind (whole, start, inside), then the
  part it was found in (earlier parts first — a table's columns in display order, so the name
  usually wins), then the position inside that part, then the total length, then the caller's
  order.

Single-text callers are the one-part case, and behave exactly as #1478 does today except for decision
2 (punctuation alone now matches nothing).

## Where the matcher lives

`foldForSearch` and the matcher move to `@waitron/shared`, which every package that searches already
depends on and which itself depends on no other package. `@waitron/catalogue` stops defining them;
its callers (the till's menu browser and the dashboard's home page preview) import from
`@waitron/shared`. The dashboard's private copy of the fold (`apps/dashboard/src/dashboard-app.ts`)
is deleted.

## The sites

### Shared components (`packages/ui`)

- **`wt-data-table`** — its search (the box it draws, and a `searchTerm` a screen hands it) uses the
  matcher, with each column's search value as one part, in column order. **A column with no search
  value is not searched** — the table no longer falls back to the sort value — so each screen
  declares a search value on its name columns alone (decision 7). While a search is typed, a flat table lists rows by match order; a column heading
  still changes the sort indicator, and that sort applies once the search is cleared. In tree mode,
  every row above a match stays open as today, and the rows under each parent are ordered by match
  — a parent that does not match itself, but holds matches, is ordered among its siblings by its
  best match beneath it. Rows a tree draws as part of their parent's row, and children a screen asks
  to keep in `rows` order, keep that rule.
- **`wt-combobox`** — its filter uses the matcher over each option's label and lists matches in
  match order. Where options are grouped under headings (the VAT return's period choice, adding a
  content language), matches are ranked within each group and the groups keep their order, as a
  tree ranks under each parent. The row offering to add a new value appears only when no option's label equals the
  query once both are folded. Type-ahead on a closed list (jump to the first label starting with the
  keys pressed) is not a search and is unchanged.
- Every screen that uses either component — products, menu prices, modifiers, units, devices,
  the menu structure, and the table column filters — follows from these two.

### What each table searches (decision 7)

- Products (`product-list.ts`): the name column, holding the product's name and its variants'
  names; a category row by its name. The price, extras and ordering ("sold separately") columns,
  and the category text inside the name column's search value, stop being searched.
- Menu prices (`menu-prices-table.ts`): the item's and the variant's names; not the price or the
  category.
- Modifiers (`modifiers-screen.ts`): the list's name and its items' or labels' names; not the
  "used by" text.
- Units (`units-screen.ts`): name and abbreviation, as today.
- Devices (`devices-screen.ts`): it declares no search value today, so it searches every sort value;
  its name column gains one and is the only one searched.
- The menu structure (`menu-structure-table.ts`): the row's name, as today.

### Screens with their own filter code

Each moves to the matcher, with match order:

- adding products to a section (`apps/dashboard/src/widgets/section-add-products.ts`);
- the menu structure's choice of which rows get a checkbox (`menu-structure-table.ts`
  `#rowSelectable`), which must agree with the table's own rule;
- the products that use a unit (`units-screen.ts`, `inUseSearch`), handed to its table as a
  search rather than filtered beforehand;
- staff (`staff-screen.ts`), with display name, first names, last names, email and telephone as
  parts, searched by the staff table itself (`searchTerm`) so a remembered heading sort cannot
  re-order the matches; the units-in-use list the same way;
- content translations (`content-translations-dialog.ts`);
- the allergen picker (`allergen-picker.ts`);
- the dashboard's navigation search (`dashboard-app.ts`): each page is searched on two parts, its
  label and its group's heading, so "menu prices" finds Prices under a Menu heading and a group
  whose heading matches still shows its whole group; groups keep their place in the navigation,
  and the pages inside a group are listed in match order, those matching on their own label first;
  the pages matching only with the heading leave out the length tie-break, so pages tied on the
  heading alone keep nav order.

### Image library (`packages/media`)

`listImages` (`packages/media/src/images.ts`) replaces its query parser and scorer with the matcher,
run over every language's name of each image as separate one-part texts; an image's match is its
best language's. The library's sort menu keeps its three choices: **relevance**, the default while a
search is typed, is the matcher's order; name and date keep their meaning and apply to the matching
images. The query parser, the scorer and `search-grammar.test.ts` are deleted with the feature. The
search still runs in the server's code inside the request's transaction, at the cost it has today;
the open backlog entry about that (the media library reading every matching image inside the venue
write lock) stays open.

### Database lookups (`apps/server`)

- the Orders list (`orders-list.ts`, `searchClause`), searching party name, delivery label and the
  party's table labels;
- Find a bill (`bill-lookup-api.ts`), which shares that clause;
- Find an invoice (`invoice-lookup-api.ts`), searching the customer's legal name.

SQLite cannot fold accents in SQL. The venue store registers one scalar function on every
connection it opens, read and write, `waitron_search_rank(query, part…)`: NULL when the parts do not
match, otherwise a sortable key from the shared matcher. The three lookups filter and
order with them inside SQL, so paging, counting and the existing `limit` stay in the database. The
invoice-number and bare-number forms keep their exact match and are checked first, as today. With a
search typed, rows come in match order, then newest first; with none, newest first as today.

A typed trailing space reaches the SQL: the boxes, the requests and the routes stop trimming the
search, and trim only to decide that it is blank, its length, and the number forms.

This was chosen over two alternatives: storing a folded copy of each searchable column (a migration,
and a copy to keep in step on every write) and reading every candidate row into the server's code
(which moves paging and counting out of SQL). It reads the rows today's `LIKE '%…%'` already reads —
both check every candidate row.

## Testing

Test-first at every site, each with examples that tell the new rule from the old:

- "tonic gin" finds "Gin & Tonic" (old rule: nothing);
- "cafe" finds "Café con leche" (old rule: nothing, for the sites that did not fold accents);
- "&" finds nothing (old rule: names containing "&");
- results arrive in match order, with fixtures whose old order differs from the new.

The matcher's own suite moves to `@waitron/shared` with it and gains the several-parts cases. The
store's function is tested through real SQL on a store opened with `openVenueStore`, on each of its connections. Tests that pin
the removed image-search grammar (phrases, exclusion, `or`) are deleted with it, and the PR lists
them. Tests elsewhere that assert the old order or the old substring rule are updated to the new
rule, keeping what each checks.

## Out of scope

- Searches that compare whole values rather than typed text: the province lookup
  (`packages/country`), name and email uniqueness, printing's accent stripping.
- The open backlog entry about the image library reading every image inside the write lock.

## Backlog

This branch also deletes the entry "`wt-data-table` searches a column's sort value when it has no
search value": a column with no search value is no longer searched.

This branch deletes the entry "Product search and image search follow different rules, and a search
of only punctuation lists every product" from `docs/backlog.md` and its detail in
`docs/backlog/catalogue.md`: these decisions settle it.
