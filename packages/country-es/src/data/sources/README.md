# Holiday data sources

Each file here is an official page stored byte for byte, fetched with `curl` on 2026-10-06. The
holiday tests (`../../holidays.test.ts`) hash each one and compare it with the SHA-256 the shipped
data names in `../sources.ts`, and they read the annex and INE tables from these files, never from
the network.

| File                         | Fetched from                                                   | SHA-256                                                            |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `BOE-A-2025-21667.xml`       | `https://www.boe.es/diario_boe/xml.php?id=BOE-A-2025-21667`    | `f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0` |
| `BOE-A-2015-2294.xml`        | `https://www.boe.es/diario_boe/xml.php?id=BOE-A-2015-2294`     | `a59f3a3219306ec2101d78396346e4a7d5e871f37d539b9fb863ff2b22cf2e6a` |
| `ine-cod_ccaa_provincia.htm` | `https://www.ine.es/daco/daco42/codmun/cod_ccaa_provincia.htm` | `f559a786aff364869f0e5bf263e9b8b4a38f991021b387b9130215634ef2e452` |
| `ine-cod_islas.htm`          | `https://www.ine.es/daco/daco42/codmun/cod_islas.htm`          | `30429ef73e04d10830e11ec6d81bc40ca5eb1399646ccb43a4f89780acfba47a` |
| `ine-cod_provincia.htm`      | `https://www.ine.es/daco/daco42/codmun/cod_provincia.htm`      | `47aa7f7e5d80d3af6a22bb2369ebf8bc86ae58a3400caeaa07e145763004f428` |

What each one is used for:

- **BOE-A-2025-21667**, the Dirección General de Trabajo's resolution publishing the 2026 holiday
  list. Its annex gives every 2026 national and regional row, region by region, and two clarifying
  notes: note 1 gives each Canary island a holiday of its own, and note 2 replaces 26 December with
  17 June "En el territorio de Arán". Its fourth legal ground allows "hasta dos días de cada año
  natural con carácter de fiestas locales", which is Spain's local-holiday allowance of 2. The
  annex's `headers` attributes are not reliable (the 2 April row's País Vasco and La Rioja cells
  name `header1704`), so the reader takes a cell's region from its column position.
- **INE `cod_ccaa_provincia.htm`** maps each province code to its community code (CODAUTO), Ceuta
  (51 → 18) and Melilla (52 → 19) included. `../regions.ts` pairs each annex column with the INE
  community of the same code; the names differ (for example "Com. Madrid" and "Madrid, Comunidad
  de").
- **INE `cod_islas.htm`** places each Canary island in its province. INE has no row for La
  Graciosa; note 1 names "Lanzarote y La Graciosa" together, so they are one choice, in Lanzarote's
  province (35).
- **BOE-A-2015-2294**, Catalonia's Arán law, whose preamble says Arán "quedó definitivamente
  incorporado a la nueva provincia de Lleida". So only Lleida is asked which part it is in.
- **INE `cod_provincia.htm`** is not shipped as a source; the tests use it to check that the
  province map covers exactly INE's provinces and the pack's own list.

## The 2026 comparison

The test "ships exactly the annex's rows, region by region, with its notes applied" turns the
archived annex into one line per marked cell (key, date, name, scope, mark, region, area rule) plus
one per note holiday, and turns `../es-2026.ts` into the same lines. The two lists must be equal.
Another test pins the annex at 36 dated rows and 2 notes, so a reader that drops rows fails. Changing a region, a date, a name or the
Arán rule in the shipped data made it fail.

Deliberate territorial choices:

- A Canary island's holiday applies only on that island; with no island chosen it is left out and
  the year's coverage says `area_required`.
- In Lleida, 26 December applies outside Arán and 17 June inside it; with no choice, both are left
  out. 26 December still applies in the rest of Cataluña and in Illes Balears.
- Annex rows are national (`*`, `**`) or regional (`***`) by their mark; note holidays are regional.

## 2027

Not shipped. On 2026-10-06 the BOE daily summaries
(`https://www.boe.es/datosabiertos/api/boe/sumario/<yyyymmdd>`) from 2026-08-01 to 2026-10-06 were
fetched and none contained "fiestas laborales"; the same check on 2025-10-28 finds
BOE-A-2025-21667. A read for 2027 reports `missing_year`.

## Updating for a new year

1. Fetch the new resolution's XML from `https://www.boe.es/diario_boe/xml.php?id=<id>` with `curl`
   into this folder, and record its `shasum -a 256`.
2. Transcribe its annex and notes by hand into a new `es-<year>.ts`, with a new data version, and
   add the source to `../sources.ts`.
3. Point the comparison test at the new year and run it; read every difference against the page.
