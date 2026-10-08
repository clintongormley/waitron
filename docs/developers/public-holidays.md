# Public holidays

A venue manager planning opening hours needs to know which days are public holidays where the venue
is. Waitron shows them on the Hours page (`/manage/hours`) in two layers. The national and regional
holidays come from the official list, transcribed into the country's pack and shipped with the
application. The town's own local holidays are entered by the venue, because Spain publishes them
separately for each municipality and Waitron holds no municipality list.

Holidays are information. Reading them writes nothing, and no holiday closes the venue, changes
its hours or creates a special date by itself. The one thing a holiday affects is a name a manager
is already writing: "Make this a special date" starts its draft with the day's holiday names, and
duplicating a special date onto a holiday names each copy after that holiday
(`duplicateHolidayNamedSpecialDates`, `packages/venue-service/src/holidays.ts`). The manager still
decides whether the venue closes.

## Where each part lives

- **The country contract**, `CountryHolidayCalendar`, is in `packages/country/src/holidays.ts`. A
  country pack that has holiday data sets `holidayCalendar`; a pack without it has no shipped
  holidays and allows no local entries.
- **Spain's data** is in `packages/country-es/src/data/`: `es-2026.ts` holds the 2026 rows,
  `regions.ts` maps each province code to its region and lists the territorial areas, and
  `sources.ts` names each official source with its address and SHA-256. The official pages
  themselves are archived byte for byte in `packages/country-es/src/data/sources/`, whose
  `README.md` says where each was fetched and what it is used for.
- **A venue's local holidays** are in two venue-service tables (migration
  `packages/venue-service/drizzle/0023_public_holidays.sql`). `holiday_geographies` holds one row
  for each address the venue has entered holidays or chosen an area for, keyed by country, province
  code and a normalized city, with the city as it was spelled and the territorial area chosen there.
  `local_holidays` holds the entries, each a date and a name.
- **The reader and writers** are in `packages/venue-service/src/holidays.ts`, and the routes under
  `/management-api/venue-service/` in `routes.ts` beside it. Reading needs `venue.view`; every
  write needs `venue_service.manage`.

## How a venue's holidays are worked out

The venue's address decides everything, and Waitron never guesses a missing part. The country comes
from the taxpayer row, the province from `locations.province` through the pack's province list, and
the city from `locations.city`. A province maps to a region, and the region selects that year's
national and regional rows. A province the pack does not recognise gets no shipped holidays at all,
rather than a guess at "all of Spain".

Two places need more than the province. In the 2026 annex, each Canary island has a holiday of its
own, and Arán has 17 June where the rest of Lleida has 26 December. A venue in one of those
provinces chooses its area under Special dates. Until it does, it sees only the holidays that apply
to the whole province, and the calendar says the area is needed. Canary provinces are refused at
setup today, so in practice only the Lleida choice is reachable.

Local holidays belong to the address they were entered for. When the city or province changes, the
old entries stay stored and are hidden, with a note naming the old city; when the address matches
again, they come back under the same ids. The city is compared after normalizing Unicode, trimming,
collapsing spaces and lowercasing, so "Villa  Real" and "villa real" are the same place, while
accents and punctuation still count.

Each year of a read carries a coverage entry that says how complete it is, and the Hours calendar
puts each state into words for the manager (the `hours.calendar.coverage.*` strings):

| `nationalRegional`    | Meaning                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `complete`            | The year is shipped and every shipped holiday that applies is shown.            |
| `area_required`       | Only holidays certain for the whole province are shown until an area is chosen. |
| `missing_year`        | The year is not shipped, so no official holiday is shown.                       |
| `unknown_region`      | The province is missing or not recognised, so no official holiday is shown.     |
| `unsupported_country` | The country's pack has no holiday data.                                         |

`local` is `address_unresolved` whenever the address does not resolve: no installed pack for the
country, a missing or unrecognised province, or a missing city. Only for a resolved address is it
`unsupported_country`, when the pack has no holiday data, and otherwise `owner_entered` or
`none_entered`. "None entered" means only that nobody entered any; it does not say the town has
none.

## The local allowance

A country's `localEntryLimit` caps how many local holidays one address may hold in a civil year.
Spain's is 2, from BOE-A-2025-21667: "hasta dos días de cada año natural con carácter de fiestas
locales". The writer refuses one more with `holiday.local_limit`, and a configuration import
refuses a bundle holding more with `setup.request_invalid`. The database does not count them, so a
raw write outside those two paths can store more.

A local holiday is the venue's own assertion. Nothing checks it against the town council's list.

## What a configuration transfer carries

An export carries every geography of the venue, matching or retained, with its area choice and all
its entries (`VENUE_SERVICE_CONFIGURATION_TRANSFER`, `packages/venue-service/src/configuration-transfer.ts`).
It carries no shipped holiday, no source hash and no data version: the receiving build reads its
own. On import every row gets a new id and belongs to the receiving venue, and which geography is
current follows the receiving venue's own address.

`validateHolidayConfiguration`, beside the file's Hours check, judges the holiday rows by the
receiving build's packs. It refuses a country or province code the pack does not have, a blank city
or one with spaces around it (the writer trims the city), a city key that is not the city's
normalized form, two geographies for one place, an area the pack does not offer for that province,
an entry whose geography is not in the bundle, an impossible or repeated date, a name the writer
would trim or refuse, and more entries in a civil year than the pack allows. A refusal is
`setup.request_invalid` naming the table or column, and the venue is not created. The cases are in that file's tests and in "public
holidays in a configuration transfer" in `apps/server/src/configuration-transfer.test.ts`. A bundle
from before the holiday tables existed is refused by the module schema version check.

## What has been verified, and what has not

The 2026 data was checked against the archived annex by a test, not by reading:

- "pins every shipped source to the SHA-256 of the archived page it was read from"
  (`packages/country-es/src/holidays.test.ts`) hashes each archived page and compares it with
  `sources.ts`. On 2026-10-06, `shasum -a 256 packages/country-es/src/data/sources/BOE-A-2025-21667.xml`
  printed `f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0`. The archived XML gives
  the resolution's publication date as `<fecha_publicacion>20251028</fecha_publicacion>`.
- "ships exactly the annex's rows, region by region, with its notes applied" turns the archived
  annex into one line per marked cell and note, turns `es-2026.ts` into the same lines, and expects
  no line missing and none extra. Its sibling case changes a region, a date and the Arán rule in a
  copy of the data and expects the comparison to notice each.

What is not verified:

- **Legal or payroll effect.** The data says which days the 2026 resolution lists. Whether a venue
  owes a holiday premium, or must close, is a question for the labour advisor and for the wage
  rules of "Wages / labour cost (SP16)" in [the backlog](../backlog.md), not something this data
  answers.
- **Local holidays.** They are whatever the venue entered.
- **2027.** It is not shipped. On 2026-10-06 the BOE daily summaries from 2026-08-01 to 2026-10-06
  held no "fiestas laborales" resolution for 2027, so a 2027 read reports `missing_year`. Andalucía
  has published its own 2027 calendar (BOJA, Decreto 84/2026), but one region's calendar is not the
  national list, and none of it is shipped.
- **Canary islands.** The island choice is built and tested from the data, but setup refuses the
  Canary provinces, so no venue reaches it yet.

## The yearly data update

Shipped data changes only through a normal pull request; nothing is fetched while Waitron runs.
These steps assume Spain; another country follows the same shape with its own official sources.

1. **When.** Each September, start looking for the following year's national list, and keep
   looking until it is published. Do not advertise a year before its data is shipped. Before every
   data release, look again for corrections to the year already shipped. These dates are a
   working habit, not a publication deadline anyone has promised.
2. **Where.** Search `boe.es` for `relación de fiestas laborales para el año YYYY`, or read the BOE
   daily summaries at `https://www.boe.es/datosabiertos/api/boe/sumario/<yyyymmdd>` for "fiestas
   laborales". Open the resolution, its annex, its notes and any linked correction. Use the labour
   holiday list, not the administrative calendar of working days for filings. A regional or
   provincial bulletin explains a region's choices or a local entry; it never stands in for the
   national list. When the province or island data changes, fetch INE's tables again.
3. **Capture.** Fetch the resolution's XML with `curl` from
   `https://www.boe.es/diario_boe/xml.php?id=<id>` into `packages/country-es/src/data/sources/`,
   run `shasum -a 256` on it, and record the hash in `sources.ts` and in the sources `README.md`
   table with the fetch date and the resolution's publication date. For each territorial note or
   unusual cell the data depends on, write down where it sits in the annex (the row and column, or
   the note's number), as the README does for 2026's notes 1 and 2. A moved address is not a new
   fact. A changed hash for a page already
   shipped means the page changed: compare its rows again before shipping anything.
4. **Transcribe and compare.** Write `es-YYYY.ts` by hand from the annex and notes, with data
   version `ES-YYYY.1`; a correction to a shipped year raises the revision (`ES-YYYY.2`). Keep every
   earlier year and every fact key unchanged, because a fact's id is `shipped:` plus its key. Keep
   each row's regions as the annex marks them. Never fill an empty cell from last year, and never
   work out a moved Monday yourself. Point the annex comparison test at the new year and read every
   difference it reports against the page.
5. **Verify.** Run the three country suites, then the venue-service holiday suites:

   ```sh
   pnpm --filter @waitron/country exec vitest run src/country.test.ts
   pnpm --filter @waitron/country-es exec vitest run src/holidays.test.ts
   pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts
   pnpm --filter @waitron/venue-service exec vitest run --project node src/holidays.test.ts src/holiday-naming.test.ts
   ```

   Read each `Tests` count. Check that the ordinary-working-day case still reads `complete` with no
   facts, that a year still unshipped reads `missing_year`, and that the Arán and Canary cases still
   pass. Record the counts and the comparison result in the pull request. A data-only update needs
   no database migration.
6. **Ship.** Open a signed-off pull request through the usual review, hook and CI. Update the
   coverage only for the years and regions you compared. A release changes no stored row: "reads a
   data revision's facts, version and allowance, leaving every stored row as it was"
   (`packages/venue-service/src/holidays.test.ts`) reads a venue through a revised pack and finds its
   `local_holidays`, `holiday_geographies` and `special_dates` rows unchanged. It does not compare a
   special date's hours cells, sales or working-time records; the holiday code does not read sales
   or working-time tables at all (its imports, read, not run). A release
   closes no venue, creates no special date and recalculates no wage.
