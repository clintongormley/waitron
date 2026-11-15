# Holiday data sources

Each file here is an official page stored byte for byte, fetched with `curl` on 2026-10-06, except
`BOE-A-2026-21254.xml`, fetched on 2026-11-15. The
holiday tests (`../../holidays.test.ts`) hash each one and compare it with the SHA-256 the shipped
data names in `../sources.ts`, and they read the annex and INE tables from these files, never from
the network.

| File                         | Fetched from                                                   | SHA-256                                                            |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `BOE-A-2025-21667.xml`       | `https://www.boe.es/diario_boe/xml.php?id=BOE-A-2025-21667`    | `f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0` |
| `BOE-A-2026-21254.xml`       | `https://www.boe.es/diario_boe/xml.php?id=BOE-A-2026-21254`    | `2e8c47e795d370466bdfe4372d5a6789a1dcd906b68218da8d1b5569a992eb48` |
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
- **BOE-A-2026-21254**, the same Dirección General's resolution publishing the 2027 list,
  published in the BOE on 2026-10-13 (`<fecha_publicacion>20261013</fecha_publicacion>`). Its
  annex gives every 2027 row, region by region; note 1 again gives each Canary island a holiday of
  its own, and note 2 replaces 29 March (Pasqua Florida) with 17 June "En el territorio de Arán".
  This page has no `axis` or `id` attributes in its table, so the reader takes the regions from
  the table's last header row, a month from a cell holding only a month's name, and builds each
  row's id from its day and month, adding `A`, `B`, `C` in page order where rows share a date. Its
  Madrid column is headed "Com. de Madrid", which `../regions.ts` lists as another spelling of
  2026's "Com. Madrid".
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

## The 2026 and 2027 comparisons

For each shipped year, the test "ships exactly the annex's rows, region by region, with its notes
applied" turns the archived annex into one line per marked cell (key, date, name, scope, mark,
region, area rule) plus one per note holiday, and turns `../es-2026.ts` or `../es-2027.ts` into the
same lines. The two lists must be equal. Another test pins each annex's dated rows (36 in 2026, 35
in 2027) and its 2 notes, so a reader that drops rows fails. A third, "notices a wrong region, an
altered date and a dropped territorial note", changes a region, a date and the Arán rule in a copy
of that year's data and expects the comparison to notice each.

"never gives two holidays one name in a year, in any place a venue can choose" reads every shipped
year for each province, and each of its areas where it has some, and expects no holiday name twice:
the venue's date reader keeps only a name's first date in a year.

Deliberate territorial choices:

- A Canary island's holiday applies only on that island; with no island chosen it is left out and
  the year's coverage says `area_required`.
- In Lleida, 26 December 2026 and 29 March 2027 apply outside Arán, and 17 June inside it; with no
  choice, none of them applies. 26 December 2026 still applies in the rest of Cataluña and in Illes
  Balears, and 29 March 2027 in the rest of Cataluña and the other regions the annex marks.
- Annex rows are national (`*`, `**`) or regional (`***`) by their mark; note holidays are regional.

## 2027

Shipped as `ES-2027.1` in `../es-2027.ts`, from BOE-A-2026-21254 alone. Where its territorial
facts sit in the annex:

- **Note 1** (the first note under "Notas aclaratorias", referenced by the Canarias column header's
  "(1)") gives El Hierro 24 September, Fuerteventura 17 September, Gran Canaria 8 September, La
  Gomera 4 October, La Palma 5 August, Lanzarote y La Graciosa 15 September and Tenerife 2
  February.
- **Note 2** (referenced by the Cataluña column header's "(2)") replaces the 29 March "Lunes de
  Pascua" row's Cataluña cell with 17 June in Arán. In 2026 the same note replaced 26 December.
- The annex has no 15 August or 26 December row. Its 16 August row, "Lunes siguiente a asunción de
  la Virgen", is marked `**` in Andalucía, Aragón, Asturias, Canarias, Castilla y León and Madrid,
  and Extremadura's 11 October row is "Sustitución 15 de agosto", `***`.

The 2026 page was fetched again on 2026-11-15 and its SHA-256 was unchanged, so 2026 carries no
correction. A read for 2028 reports `missing_year`.

## Updating for a new year

Follow the runbook in
[`docs/developers/public-holidays.md`](../../../../../docs/developers/public-holidays.md#the-yearly-data-update).
