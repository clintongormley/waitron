# Public holidays

You plan holidays in the Calendar's Year (`/manage/opening-hours/view/year`). Public
holidays come only from the country's shipped calendar: its national and regional dates. The venue
is not a holiday source. To change the venue's hours on a day, your town's holiday included, make
that day a special day (see "Special days" in [conventions-data.md](conventions-data.md)). A
special day belongs to the venue, not to a saved town address, and the country's local-holiday
number does not cap special days.

A public holiday is information: reading one does not write a special day or change opening hours.
On a public date, the day box's Make a special day opens the special-day painter on a new day with the
holiday's name and date filled in; you choose its dates, whether it repeats every year, and whether
each date is Closed all day. When a special day of that name already exists, the painter first
offers Add to <name>, which opens that day with this date added, unsaved. Opened on a picked run
whose first date is the holiday, the new day holds every date of the run, and Add to adds them all.
The Year's and the
month's readers are `readOpeningHoursYear` and `readOpeningHoursMonth` in
`packages/venue-service/src/opening-hours-calendar.ts`, and the painter draws each date's season
hours from `readSeasonDays` in the same file; the painter, the Year and the month are
`special-day-painter.ts`, `opening-hours-year.ts` and `opening-hours-month.ts` in
`packages/venue-service/src/dashboard/`.

A special-day date saved on a public holiday records that holiday's official name
(`special_day_dates.holiday_name`); a date the special day already held keeps the name it was saved
with (`saveSpecialDay` in `packages/venue-service/src/special-days.ts`). On a special day that
repeats every year, such a date falls in each later year on the date the country calendar gives a
holiday of that name, and in no year whose shipped data lacks that name, a year with no shipped
data included; any other repeating date falls on the same month and day (`specialDateIn`, same
file; "applies nothing in a year whose list lacks the name, or that has no list" in
`special-days.holiday-name.test.ts`). The readiness list warns `special_day.holiday_missing` for
each such date the venue's current or next year places nowhere, and `special_day.date_shared` for
each date in those years that falls where a different special day applies, naming both
(`specialDayReadiness`, `special-days.ts`). A configuration bundle carries no holiday lists, so
its import compares such a date with the others in its first year only (`validateSpecialDays`,
`packages/venue-service/src/configuration-transfer.ts`).

## Where each part lives

- `CountryHolidayCalendar` in `packages/country/src/holidays.ts` describes shipped facts and their
  coverage. A pack without it supplies no official holidays; you can still add special days.
- Spain's data lives in `packages/country-es/src/data/`: `es-2026.ts` holds the rows, `regions.ts`
  maps provinces and territorial areas, and `sources.ts` holds source addresses and hashes.
  The archived pages and their provenance remain in `packages/country-es/src/data/sources/`.
- Special days live in `special_days` and `special_day_dates`, declared in
  `packages/venue-service/src/schema/seasons.ts`; `saveSpecialDay` in `special-days.ts` validates
  them. `packages/venue-service/drizzle/0038_clammy_klaw.sql` dropped `local_holidays`.
- `holiday_geographies` in `packages/venue-service/src/schema/holidays.ts` retains the holiday-area
  choice for an address. `readHolidayAreaModel` and `saveHolidayArea` in `holidays.ts` read and write
  that choice; the area control is in the Year. The routes in `routes.ts` require `venue.view`
  for reads and `venue_service.manage` for writes.

## Official dates follow your address; special days follow your venue

`readAddress` and `readHolidays` in `packages/venue-service/src/holidays.ts` resolve the country
from the taxpayer, the province from the pack's province list, and the city from the location.
A missing or unknown province supplies no official facts. If the official calendar offers a
territorial choice, choose it in the Year; until then, only facts certain for the whole province
are shown. The 2026 territorial source notes remain in the archived sources README.

An area's identity uses country, province and normalized city. Changing the address stops using
that area's choice, but keeps it stored for a later matching address. `holidayCityKey` normalizes
Unicode, trims and collapses spaces, and lowercases; accents and punctuation still count.
Special days are not filtered by that identity, and you can add them without a recognized holiday
address or country calendar.

Each read supplies coverage for every year it spans. When public holidays are available, the
Year draws a coverage sentence only when the shown year's `nationalRegional` is not `complete` or
the year has no coverage entry (`#notes`, `opening-hours-year.ts`). No `local` value below means
the list carries the town's holidays, and the Year does not mention them.

| `nationalRegional` | Meaning |
| --- | --- |
| `complete` | The year's applicable shipped official dates are included. |
| `area_required` | Only whole-province facts are shown until you choose an area. |
| `missing_year` | No official data is shipped for that year. |
| `unknown_region` | The province cannot be resolved for official data. |
| `unsupported_country` | The country has no shipped holiday calendar. |

`local` is `address_unresolved`, `unsupported_country` or `none_entered`, from the holiday address
and calendar alone (`readHolidays`). A special day never counts as a local holiday and never becomes
an official fact, whatever its name: "does not count a special day as a local holiday, whatever its
name" in `packages/venue-service/src/holidays.test.ts`.

## The local number is information

`localEntryLimit` remains in the country contract and reaches `readSpecialDaysModel` as
`localHolidaysPerYear`.
Spain's 2 comes from BOE-A-2025-21667: "hasta dos días de cada año natural con carácter de fiestas
locales". The source is archived in `packages/country-es/src/data/sources/BOE-A-2025-21667.xml`.
It is guidance about the public calendar, not a limit on special days: no screen has shown it since
A506-6 removed the old Calendar view (2026-10-13), and `saveSpecialDay` never reads it. A special day is your assertion; nothing checks
it against a municipal list.

## What a configuration transfer carries

`VENUE_SERVICE_CONFIGURATION_TRANSFER` in `packages/venue-service/src/configuration-transfer.ts`
carries retained holiday-area geographies, seasons with their department and zone weeks (see
"Seasons and season weeks" in [conventions-data.md](conventions-data.md)), and special days with
their dates, holiday names and paint (see "Special days" there). Public facts, source hashes and
shipped data versions come from the receiving build's pack.

`validateHolidayConfiguration` validates geographies and area choices against the receiving packs;
`validateSeasonWeeks` validates special days, their dates and their paint. The cases are in
`packages/venue-service/src/configuration-transfer.test.ts`.

**2026-10-13, A506-5:** named days, and the `special_dates` table that held the venue's own
holidays, were dropped; dropping them needs a venue reset, and nothing carries them into special
days. Historical plans describe the earlier models; their dated pointers identify each replacement.

## Earlier source verification and its limits

The dated observations below retain the 2026-10-06 source receipts. For the current model, use the
sections above; the old local-entry storage and allowance no longer apply.

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
   coverage only for the years and regions you compared. Reading the new shipped data writes no
   special day: `readHolidays` in `packages/venue-service/src/holidays.ts` reads the country
   calendar alone, and returns facts and coverage. It can move a special day, though: a repeating
   date saved on a public holiday falls wherever the shipped data puts that holiday's name
   (`specialDateIn`, `packages/venue-service/src/special-days.ts`), so renaming a holiday or
   moving its date in the data moves or drops that date in the years it covers after the year the
   date was saved in. Run the holiday suites above to check the current reader; the earlier
   local-table receipt below is historical.

### Earlier data-revision receipt

**2026-10-09, A366 slice 2:** the 2026-10-06 data-revision experiment described here used
`local_holidays`, which the slice now retires. It is not evidence about today's named-day writes.
**2026-10-13, A506-5:** `special_dates` is dropped too. The case now finds the venue's
`holiday_geographies` and `special_days` rows unchanged.

The earlier receipt asserted: "reads a
   data revision's facts, version and allowance, leaving every stored row as it was"
   (`packages/venue-service/src/holidays.test.ts`) reads a venue through a revised pack and finds its
   `local_holidays`, `holiday_geographies` and `special_dates` rows unchanged. It does not compare a
   special date's hours cells, sales or working-time records; the holiday code does not read sales
   or working-time tables at all (its imports, read, not run). A release
   closes no venue, creates no special date and recalculates no wage.
