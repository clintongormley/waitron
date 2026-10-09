# Every search follows one rule — design

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
  matcher, with each column's search value (or sort value, where it gives none) as one part, in
  column order. While a search is typed, a flat table lists rows by match order; a column heading
  still changes the sort indicator, and that sort applies once the search is cleared. In tree mode,
  every row above a match stays open as today, and the rows under each parent are ordered by match
  — a parent that does not match itself, but holds matches, is ordered among its siblings by its
  best match beneath it. Rows a tree draws as part of their parent's row, and children a screen asks
  to keep in `rows` order, keep that rule.
- **`wt-combobox`** — its filter uses the matcher over each option's label and lists matches in
  match order. The row offering to add a new value appears only when no option's label equals the
  query once both are folded. Type-ahead on a closed list (jump to the first label starting with the
  keys pressed) is not a search and is unchanged.
- Every screen that uses either component — products, menu prices, modifiers, units, devices,
  the menu structure, and the table column filters — follows from these two.

### Screens with their own filter code

Each moves to the matcher, with match order:

- adding products to a section (`apps/dashboard/src/widgets/section-add-products.ts`);
- the menu structure's choice of which rows get a checkbox (`menu-structure-table.ts`
  `#rowSelectable`), which must agree with the table's own rule;
- the products that use a unit (`units-screen.ts`, `inUseSearch`);
- staff (`staff-screen.ts`), with display name, first names, last names, email and telephone as
  parts;
- content translations (`content-translations-dialog.ts`);
- the allergen picker (`allergen-picker.ts`);
- the dashboard's navigation search (`dashboard-app.ts`): a group whose heading matches still shows
  its whole group; groups keep their place in the navigation, and the matching pages inside a group
  are listed in match order.

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

SQLite cannot fold accents in SQL. The venue store registers two scalar functions on every
connection it opens, read and write: one answers whether a text (in parts) matches a query, the other
gives its match order as a sortable value. Both run the shared matcher. The three lookups filter and
order with them inside SQL, so paging, counting and the existing `limit` stay in the database. The
invoice-number and bare-number forms keep their exact match and are checked first, as today. With a
search typed, rows come in match order, then newest first; with none, newest first as today.

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
store's functions are tested through real SQL on a real venue database (`useVenueDb`). Tests that pin
the removed image-search grammar (phrases, exclusion, `or`) are deleted with it, and the PR lists
them. Tests elsewhere that assert the old order or the old substring rule are updated to the new
rule, keeping what each checks.

## Out of scope

- Searches that compare whole values rather than typed text: the province lookup
  (`packages/country`), name and email uniqueness, printing's accent stripping.
- The open backlog entry about the image library reading every image inside the write lock.

## Backlog

This branch deletes the entry "Product search and image search follow different rules, and a search
of only punctuation lists every product" from `docs/backlog.md` and its detail in
`docs/backlog/catalogue.md`: these decisions settle it.
