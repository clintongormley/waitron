# Public holidays

You plan holidays in Opening hours → Calendar (`/manage/opening-hours/view/calendar`). The official
national and regional dates come from the country's shipped calendar. Add your town's holidays
as your own named days with kind Holiday, alongside other holidays you choose for your venue.
Your own days belong to the venue, rather than to a saved town address. Their dates can repeat
annually, and the country's local-holiday number does not cap them.

A public holiday is information: reading one does not write a named day or change opening hours.
Add on a public date starts the named-day draft with its public name and Holiday kind; you decide
whether to keep the normal week, give the date its own hours, or close the venue. The reader is
`readNamedDaysModel` in `packages/venue-service/src/named-days.ts`; the editor and Calendar actions
are in `packages/venue-service/src/dashboard/named-day-editor.ts` and `hours-calendar.ts`.

## Where each part lives

- `CountryHolidayCalendar` in `packages/country/src/holidays.ts` describes shipped facts and their
  coverage. A pack without it supplies no official holidays; you can still add your own days.
- Spain's data lives in `packages/country-es/src/data/`: `es-2026.ts` holds the rows, `regions.ts`
  maps provinces and territorial areas, and `sources.ts` holds source addresses and hashes.
  The archived pages and their provenance remain in `packages/country-es/src/data/sources/`.
- Own days live in `special_dates`, declared in `packages/venue-service/src/schema/hours.ts`.
  `saveSpecialDate` in `hours.ts` validates their kind, repeat, own-hours and closure choices.
  `packages/venue-service/drizzle/0036_hard_jubilee.sql` retires `local_holidays` and the transitional colour.
- `holiday_geographies` in `packages/venue-service/src/schema/holidays.ts` retains the holiday-area
  choice for an address. `readHolidayAreaModel` and `saveHolidayArea` in `holidays.ts` read and write
  that choice; the area control is in Calendar. The routes in `routes.ts` require `venue.view`
  for reads and `venue_service.manage` for writes.

## Official dates follow your address; own days follow your venue

`readAddress` and `readHolidays` in `packages/venue-service/src/holidays.ts` resolve the country
from the taxpayer, the province from the pack's province list, and the city from the location.
A missing or unknown province supplies no official facts. If the official calendar offers a
territorial choice, choose it in Calendar; until then, only facts certain for the whole province
are shown. The 2026 territorial source notes remain in the archived sources README.

An area's identity uses country, province and normalized city. Changing the address stops using
that area's choice, but keeps it stored for a later matching address. `holidayCityKey` normalizes
Unicode, trims and collapses spaces, and lowercases; accents and punctuation still count.
Your own holidays are not filtered by that identity (`readHolidays` reads `special_dates` by
`locationId`). You can add them even without a recognized holiday address or country calendar.

Each read supplies coverage for every year it spans. Calendar reports official and local coverage
independently (`hours-calendar.ts`, the named-month and retained date-panel renderers).

| `nationalRegional` | Meaning |
| --- | --- |
| `complete` | The year's applicable shipped official dates are included. |
| `area_required` | Only whole-province facts are shown until you choose an area. |
| `missing_year` | No official data is shipped for that year. |
| `unknown_region` | The province cannot be resolved for official data. |
| `unsupported_country` | The country has no shipped holiday calendar. |

`local` is `owner_entered` if an own Holiday occurs anywhere in that year, including a yearly
repeat. Otherwise the reader reports `address_unresolved`, `unsupported_country` or `none_entered`
from the holiday address and calendar. Those states say that no own holidays have been entered;
none prevents you adding one. A January read can therefore report owner-entered coverage for an
own holiday in December. `holidays.test.ts` exercises that year-wide read and annual repeats.
Working days do not count as local holidays, and own holidays do not become official facts.

## The local number is information

`localEntryLimit` remains in the country contract and reaches Calendar as `localHolidaysPerYear`.
Spain's 2 comes from BOE-A-2025-21667: "hasta dos días de cada año natural con carácter de fiestas
locales". The source is archived in `packages/country-es/src/data/sources/BOE-A-2025-21667.xml`.
It is guidance about the public calendar, not a limit on your own named holidays.
`saveSpecialDate` and configuration validation do not count own holidays against it; the
three-own-holidays case in `packages/venue-service/src/holidays.test.ts` exercises the writer.
An own holiday is your assertion; these paths do not check a municipal list.

## What a configuration transfer carries

`VENUE_SERVICE_CONFIGURATION_TRANSFER` in `packages/venue-service/src/configuration-transfer.ts`
carries named days and retained holiday-area geographies, without local-holiday entries or the
retired colour. It also carries dated department schedules and zone closed times. Public facts,
source hashes and shipped data versions come from the receiving build's pack.

`validateHolidayConfiguration` validates geographies and area choices against the receiving packs;
`validateHoursConfiguration` validates named days, their occurrences and station cells. Named-day
and zone configuration tests are in `packages/venue-service/src/configuration-transfer.test.ts`.
Retiring the old table and colour requires a venue reset; it does not migrate the old local entries
into named days. Historical plans describe the earlier allowance and address-owned entries; their
2026-10-09 pointers identify this replacement.

## Earlier source verification and its limits

The dated observations below retain the 2026-10-06 source receipts. For the current named-day
model, use the sections above; the old local-entry storage and allowance no longer apply.

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
   coverage only for the years and regions you compared. Reading the new shipped data does not
   author named days: `readHolidays` in `packages/venue-service/src/holidays.ts` reads the country
   calendar and stored named days, and returns facts and coverage. Run the holiday suites above
   to check the current reader; the earlier local-table receipt below is historical.

### Earlier data-revision receipt

**2026-10-09, A366 slice 2:** the 2026-10-06 data-revision experiment described here used
`local_holidays`, which the slice now retires. It is not evidence about today's named-day writes.

The earlier receipt asserted: "reads a
   data revision's facts, version and allowance, leaving every stored row as it was"
   (`packages/venue-service/src/holidays.test.ts`) reads a venue through a revised pack and finds its
   `local_holidays`, `holiday_geographies` and `special_dates` rows unchanged. It does not compare a
   special date's hours cells, sales or working-time records; the holiday code does not read sales
   or working-time tables at all (its imports, read, not run). A release
   closes no venue, creates no special date and recalculates no wage.
