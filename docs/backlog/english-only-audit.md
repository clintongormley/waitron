# A913 — non-English text in general code: the audit

Audited 2026-10-20 on main `a3be14ba4`. A dated record: it describes the tree as it was that day.
The rule it checks is in [conventions-data.md](../developers/conventions-data.md#general-code-is-english-only);
the backlog entry is [A913](architecture.md#a913-find-the-non-english-text-in-general-code-then-propose-fixes).
Nothing here changes code. The owner chooses what to fix; each fix then becomes its own item.

## In plain English

The rule says Spanish (and Catalan, Galician, Basque) may appear only in the Veri\*Factu package,
in translation files, and in AEAT's own field names. Outside those homes, two scans found 133
non-test files and about 1,150 test files to judge. After reading them:

- **Real venues get Spanish starter content.** Every new venue gets a kitchen station called
  «Cocina» with no English name at all, and its starter service steps and device-profile names fall
  back to Spanish for every language except English — so a Catalan venue gets Spanish.
- **Printed, emailed and served text lives in the code files, not in translation files.**
  `apps/server` has no translation file. Ten of its pages, printouts and emails (kitchen tickets,
  account emails, the recovery page, report pages, test pages and more) keep a table of languages
  inline. Most already pick a language at run time, so fixing them means MOVING text, not
  translating it.
- **Some surfaces print Spanish whatever the venue's language.** The card payment slip (no English
  at all); the sample receipt (always a Spanish sale); kitchen tickets and the order-number slip on
  an installed box — they follow a server setting, `WAITRON_TILL_LOCALE`, which defaults to Spanish
  and which setup never writes (from reading); a receipt whose stored language is `en-GB` (no pack
  has English receipt words — today only a developer's English demo stores `en-GB`); and a full
  invoice's address, which the till ends with «España» whatever the invoice's language.
- **Spain-only logic sits in general code.** Found while reading (the scans look for text, so this
  list is not exhaustive): the till's «España» above and its fixed `countryCode: "ES"`, and the
  server's full-invoice check, which requires «España», a five-digit postcode and a Spanish tax ID
  (`apps/server/src/invoice-selection.ts:20–33, 46`).
- **The three packages written for Spain** (`country-es`, `workforce-es`, `reporting`) are mostly
  official text — BOE holiday and province names, AEAT's form descriptions — but `country-es`'s
  receipt words and `workforce-es`'s export labels are ordinary label text that could move to
  translation files. The owner decides the policy (question below).
- **The demo restaurant** ships on every box (it runs when "Demo" is picked in setup, always as a
  practice venue). Its customer-facing text has English; about 33 staff and kitchen names do not.
- **One script can put Spanish sample text into a real venue:** `settle-invoice-first.ts` accepts
  `WAITRON_ENV=production` and writes «Comida», «Descuento» and «Supervisora».
- **Tests** spell Spanish widely — see the tests summary.
- **The English-only guard sees little of this.** It reads only `.ts` files under `src/` of a listed
  set of packages, knows 135 words, and never looks at accents. 63 of the 133 candidate files give
  it nothing to find even when fed to it directly.

`packages/adjustments` is not audited here: lane C's A758-1 is fixing its starter reasons now.

## Bucket A — allowed

| file:line | text | why it is allowed |
| --- | --- | --- |
| `packages/core/src/record-correction.ts:41–44`, `record-sale.ts:102`, `record-void.ts:69`, `record-substitution.ts:32, 60` | `FacturasRectificadas`, `NumSerieFactura`, `IDFacturaAnulada`, `FacturasSustituidas`, `TipoFactura`; one «…» quote of AEAT's developer FAQ (cited at line 42) | AEAT field names in backticks; a verbatim, cited AEAT quote |
| `packages/db/src/english-only.ts:123–148, 184–189` | the guard's own word list | The guard's list; excluded by name (`SELF`) |
| `packages/db/src/schema/columns.ts:158` | `cuota_total` / `importe_total` | Backtick citation of the fiscal package's columns |
| `apps/server/src/till-sale.ts:316` | `NumSerieFactura` | AEAT field name in a comment |
| `apps/server/README.md:315–348` | `sello`, `representante`, `consultar` | Values of fiscal-verifactu's certificate kinds and AEAT's query operation |
| five demo scripts (`allergens-demo.ts:43`, `daily-close-demo.ts:92`, `daily-close-z-demo.ts:101`, `dev-setup.ts:212`, `modelo-303-demo.ts:260`) | «Venta en establecimiento» | The filed operation description; copies fiscal-verifactu's default (`packages/fiscal-verifactu/src/slot.ts:100`). Could import it instead of repeating it |
| `apps/server/scripts/receipt-look.ts:87–88` | AEAT's QR address parameters; «QR tributario:» | AEAT's names and the required caption (home: `packages/fiscal-verifactu/src/backend.ts:163`) |
| `packages/shared/src/locales.ts:8`, `packages/identity/src/fold.ts:14, 19`, `identity/src/schema/persons.ts:74` | «Español»; `López`, `José García` | A language's own name in the language picker (deliberate, comment at lines 4–5); accented examples in comments about case and accent folding |

## Bucket B — the three packages written for Spain (facts for the owner)

None of these is scanned by the guard. "Official" means the file cites the official source and, where
noted, a test compares the text with an archived copy.

| package / file:line | what the Spanish is | who sees it | English today? | what a move would touch |
| --- | --- | --- | --- | --- |
| `country-es/src/receipt-labels.ts:8–166` | Receipt words: «Factura», «Efectivo», «Propina», «PRUEBA - SIN COBRO REAL»… 38 keys in es, ca, gl, eu. Some are tax terms («Factura simplificada», «Base imponible», «IVA») but the file cites no prescribed wording | Diners (receipts, invoices, invoice email), staff (till ticket view, refund receipts) | **No.** No pack has English receipt words; `receiptLabelsFor` falls back to Spanish for `en-GB` (`packages/country-packs/src/registry.ts:152–160`). Spain offers only es, ca, gl and eu as receipt languages (`spain.ts:294`); only the refund receipt carries a few English words of its own (`apps/server/src/tender-refund-receipt.ts:84–91`) | One file: 152 strings out, 38 English ones in |
| `country-es/src/spain.ts:199–235` | Three notices on regional language laws, Waitron's own wording | Owner, content-languages screen | Yes, `{ en, es }` pairs | 3 pairs |
| `country-es/src/spain.ts:110–163`, `data/regions.ts:62–96` | 52 province names and island names, from INE and BOE (proper place names) | Owner, province and area pickers | Proper nouns | One area label, «Lleida, fuera del territorio de Arán», is Waitron's wording (the BOE says «En el territorio de Arán») |
| `country-es/src/data/es-2026.ts:74–170` | 44 holiday names, verbatim from BOE-A-2025-21667 (a test compares them, `holidays.test.ts:287`) | Owner, special days in the opening-hours calendar | No: a holiday row has one `name` | 44 names a year |
| `country-es/src/data/sources.ts`, `holidays.ts:7`, `data/official-sources.ts`, `data/sources/*` | BOE and INE titles, quotes, the archived official pages and a parser that matches BOE sentences | Nobody (tests, comments) | n/a | Must stay Spanish to match the official text |
| `country-es/src/spain.ts:314–315` | Demo venue names «Casa Delgado», «Deli Delgado» | Demo only | n/a | Proper names |
| `reporting/src/dr303-layout.ts:61–1366`, `dr303.ts`, `modelo-303.ts`, `types.ts`, `vat-return.ts`, `period.ts`, `input-vat.ts`; `reference/*` | AEAT's form-field descriptions generated verbatim as comments; AEAT manual quotes; comments using «régimen general», «IVA devengado»; identifiers `Modelo303`, `DEVENGADO_BOXES`; segment names `"comun"`, `"pagina1"` | **Nobody**: the output is AEAT's fixed-layout file of numbers and constants | n/a | Only identifiers and comments could change (`DEVENGADO_BOXES` → `OUTPUT_VAT_BOXES`). `dr303.ts:91–95` strips accents because AEAT requires it — stays |
| `workforce-es/src/record-export.ts:19–71, 120–133, 186–188, 412–431` | About 68 `[English, Spanish]` label pairs of the working-time export; Waitron's wording, no prescribed field names cited | Manager, worker, workers' representatives, labour inspectorate (PDF and CSV) | **Yes** | One file, ~68 pairs |
| `workforce-es/src/registro-jornada.ts:26–31` (put into the export at `record-export.ts:334–341`) | Access-holder values `trabajador`, `representantes_legales`, `inspeccion_trabajo` | Printed as-is in both the English and the Spanish export (`apps/server/src/attendance-export-pdf.ts:120, 141`) — from reading, not run | **No** | 3 values × 2 languages |
| `workforce-es/src/registro-jornada.ts`, `schema/convenio-config.ts`, `vocabulary.ts` | Spanish type and field names (`RegistroDeJornada`, `fecha`, `horaInicio`), table `convenio_config`, the labour vocabulary | Nobody; `record-export.ts` maps onto English keys before labelling | n/a | Renaming the table is a migration |

Also: `apps/server/scripts/modelo-303-demo.ts` prints modelo 303 wording («casilla 27 — régimen
general», «IVA deducible», «por fichero») to a developer's console on purpose (its line 7 says so).
And a wrong comment: `reporting/src/dr303-layout.ts:14–16` (and its generator,
`reference/generate-dr303-layout.py:184–186, 274–275`) says the guard scans `reporting`'s string
literals and skips comments. Both halves are wrong: the guard never reads `reporting`
(`packages/db/src/english-only.ts:9–12`), and where it does read, it reads comment text too (its
test "flags bare Spanish prose in a line comment"). It should be fixed whatever the owner decides.

## Bucket C — user-visible text outside a translation file

`apps/server` has no `src/i18n/` and no `strings.ts`; a search for one found only locale helpers.

| file:line | text (short) | who sees it | what exists today |
| --- | --- | --- | --- |
| `apps/server/src/payment-slip.ts:21–55` (11 strings) | «JUSTIFICANTE DE PAGO», «Este documento no es una factura», «Sin contacto», «Banda», «Autorización», «Propina», «Cobrado» | Diner, card payment slip | **No English, no language choice.** Only dates and money follow a locale: the server's `WAITRON_TILL_LOCALE` setting, `es-ES` when unset (`payment-slip-print.ts:92`, `till-config.ts:83`). Already in the backlog (`docs/backlog/languages.md:33–39`) |
| `apps/server/src/sample-receipt.ts:14–39` | `locale: "es-ES"`, «Mesa 6», «MUESTRA/1», «Café y tostada», «Recibo de muestra» | Owner, sample receipt, A4 sample and receipt preview | **Takes no language** |
| `apps/till/src/widgets/invoice-recipient-dialog.ts:279` | `…, ${province}, España` | Business customer, on the full invoice the server prints verbatim (`apps/server/src/receipt-document.ts:238`) | Till strings exist (`apps/till/src/i18n/strings.ts`); `apps/setup/src/country-name.ts:12–22` names a country in a given language. Better: store the country code, name it when printing |
| `apps/server/src/tender-refund-receipt.ts:94–99` | «JUSTIFICANTE DE DEVOLUCIÓN», «La factura original no cambia», and Catalan, Galician and Basque rows | Diner, refund receipt | Inline table with an English fallback (`:100–103`); the other labels come from `receiptLabelsFor`. Home: `country-es`'s receipt words plus English ones |
| `apps/server/src/kitchen-ticket.ts:166–464` (about 25 words) | «Para cocina:», «CAMBIADO», «QUITAR:», «MOVIDO», «Pedido», «(mostrador)» | Kitchen staff | Inline `{ en, es }` tables (`:347`, `:366`, `:462`). The language is the server's `WAITRON_TILL_LOCALE` setting, not the venue's (`kitchen-print.ts:620` and others; `till-config.ts:83`): it defaults to `es-ES`, and setup never writes it (`trading-config.ts:33–41`; only `scripts/dev-setup.ts:152` sets it). So — from reading — every installed venue gets Spanish kitchen tickets; any non-Spanish setting gives English (`ticketLanguage`, `:371–373`) |
| `apps/server/src/account-email.ts:38–72, 125` | «Configura tu cuenta de Waitron», «Restablece tu contraseña…»; a stray inline choice at `:125` | Staff and owners: invitation, reset, email-change emails | Inline `COPY = { en, es }` |
| `apps/server/src/attendance-email.ts:18–22, 46, 49` | «fichar la entrada…», «Fichajes pendientes» | Staff, missed clocking email | Inline choices |
| `apps/server/src/attendance-export-pdf.ts:29–160` | «Registro de jornada», «Desde», «continuación», «Página» | Manager, representatives, inspector: the PDF's frame | Inline choices; body labels come from `workforce-es` |
| `apps/server/src/category-sales-page.ts:48–65` (13) | «Categorías en el momento de la venta», «Sin categoría» | Manager, printed report | `STRINGS: Record<SupportedLocale, …>` at `:32` |
| `apps/server/src/guide-pages.ts:73–85` (9) | «Guía de Waitron», «Página no encontrada» | Staff and owners, the guide frame | `GUIDE_TEXT: { en, es }` at `:60` |
| `apps/server/src/printer-test-page.ts:26–29`, `test-page.ts:21–25` | «Página de prueba», «Mida con una regla…» | Owner, printer test and ruler pages | `Record<SupportedLocale, …>` tables |
| `apps/server/src/recovery-surface.ts:107–425` (about 50) | «Waitron no ha arrancado», «Reintentar un arranque normal» | Operator, the page shown when the box fails to start | Tables keyed by language; must stay loadable without the database |
| `packages/dashboard-kit/src/codes.ts:9`, `alert-messages.ts:21` (and `table-strings.ts`) | «Algo salió mal, inténtalo de nuevo», «Algo requiere atención» | Owner and managers, fallback error and alert | `{ en, es }` pairs in generic code; the guard skips them (they are not listed words) |

## Bucket D — starter and demo content written into a database

**Real venues:**

| file:line | text | English beside it? |
| --- | --- | --- |
| `packages/provisioning/src/venue-apply.ts:308` | kitchen station «Cocina» | **No.** Written for every new location |
| `packages/venue-service/src/service-steps.ts:110–138` | «Montar mesa», «Tomar nota», «¿Algo más?» (also for every new department) | Yes, but `:123` picks Spanish for every language except English (A900) |
| `packages/layouts/src/device-profile.ts:131–152` | «Mostrador», «Cocina», «Móvil» | Yes, but `DEFAULT_PROFILE_LANGUAGE = "es"` (`:152`) |
| `apps/server/scripts/settle-invoice-first.ts:126–177` | «Comida», «Descuento», «Supervisora» | No. An operator script that accepts `WAITRON_ENV=production` (`:13`); the lines become filed records |

**The installed demo** (`apps/server/src/demo-seed.ts`, run only when setup's mode is "demo", always
as a practice venue — `apps/server/src/setup-api.ts:528–529, 787–789`):

| file:line | text | English beside it? |
| --- | --- | --- |
| `apps/server/scripts/demo-seed/menu.ts` (70 maps) | customer names and descriptions in en, es, ca, ca-ES-valencia, gl | Yes |
| `menu.ts:30–944` | about 33 staff and kitchen names: «Croquetas», «CROQ JAMON», «PUNTO CARNE», «GUARNICIÓN POLLO»… | **No**; written even in an English demo (`seed-catalogue.ts:170, 174`); `menu.ts:22–23` explains the option lists' staff names as deliberate, the others carry no stated reason |
| `menu.ts:840` | `{ en: "Menú del Día", … }` | The English slot holds Spanish |
| `data-sets/casa-delgado-es.ts`, `floor.ts`, `seed-adjustments.ts`, `seed-floor.ts:259` | menu, zone, status, reason names | Yes |
| `staff.ts:24–38` | «Marta Ruiz», «Lucía Fernández»… | Personal names |

**Developer tools** (local or throwaway venues): `dev-setup.ts:213–316` (admin «Administradora»,
devices «Mostrador», «Camarero 1», «Pantalla Cocina» — Spanish even when the dev demo is English);
the demo scripts `allergens-demo.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`,
`modelo-303-demo.ts`, `cloud-integration-fixture.ts` (dish, device, node and person names).

**A trap for the fix:** the demo seed finds the default station by its Spanish name
(`apps/server/scripts/demo-seed/seed-catalogue.ts:46–56`, `name = 'Cocina'`, then renames it). Renaming
the provisioned station breaks that lookup; finding it by `is_default` (as `dev-setup.ts` does) avoids it.

## Bucket E — identifiers, file names and comments

| where | examples | suggested |
| --- | --- | --- |
| `apps/server/src/report-api.ts:221`, `receipt-figures.ts:56`, `working-order.ts:4637` | «obligado», «Descuento», «Mesa 4» in comments | English |
| `apps/server/README.md:347` | setting `WAITRON_CERT_CHECK_NOMBRE` | `…_LEGAL_NAME`, or keep (echoes AEAT's field) |
| `apps/dashboard/src/api/client.ts:3846`, `widgets/purchase-list.ts:12`, `screens/devices-screen.ts:1113` | «facturas recibidas», «Cocina, Barra» | English |
| `apps/till/src/screens/till-ticket-view.ts:110, 141`, `widgets/counter-waiting.ts:16`, `table-targets.ts:66, 75`, `station-queue.ts:485`, `tender-pay.ts:47, 79` | «Descuento 12,5%», «fecha de expedición», «Mesa 4», «Entrantes», «(datáfono)» | English |
| `packages/core/src/record-substitution.ts:43–67` | «factura de canje», «siempre debe llevar el destinatario» — quotes with no source named | Cite or drop |
| `packages/db/src/schema/purchase-invoices.ts:18–51`, `purchasing/src/types.ts:5` | «factura recibida», «régimen general», «recargo de equivalencia» | English, or a cited term |
| `packages/db/src/schema/floor-zones.ts:7`, `dining-tables.ts:19`, `venue-service/src/schema/menus.ts:19`, `venue-service/src/dashboard/hours-view.ts:66`, `catalogue/src/pricing.ts:142` | «Comedor», «Terraza 3», «Mañanas», a Spanish date example, «céntimo» | English |
| demo scripts and seed | `caja1`, `AGUA`, `JAMON`, `MENU_DEL_DIA`, `cocina`, `diaId`, `clase`, `casilla`, key `período`, comments «cierre Z», «descuadre», «rectificativa»; 45 photos named after Spanish dishes (`demo-seed/media/jamon-iberico.png`…) | English names |

## Bucket F — other

| file:line | what it is |
| --- | --- |
| `apps/server/src/invoice-selection.ts:31` | Spain-only check in general code: a full-invoice address must end with «España», or staff get `invoice.recipient_invalid`. Home: `country-es`, beside the tax ID check it already uses |
| `packages/ui/demo/main.ts:66–274` | About 45 Spanish strings in the ui package's developer showcase («Cobrar», «Modo formación»); not shipped, not scanned |
| `apps/setup/src/receipt-languages.ts:6–9` | «Español», «Català», «Galego», «Euskara» on setup's review screen; the venue screen shows translated labels instead, so the two disagree |
| `apps/server/src/printer-test-page.ts:19`, `sample-receipt.ts:38` | «Café, jamón, niño · 5 € · ¿Sí? ¡Sí!» and «…pingüino · 5 €» — character samples printed in every language |
| `apps/server/scripts/receipt-look.ts` | A developer tool drawing Spanish sample receipts as pictures; never run by CI, writes no database |
| `apps/server/README.md:152–156` | Example setup values «Mostrador», «Calle Mayor 1» |
| `apps/server/scripts/cloud-translation-vectors.ts:36` | `{ ca: "Cigaló", es: "Carajillo" }` — sample translation in the Cloud contract's test data; translation is its subject |
| `apps/server/scripts/demo-seed/menu.ts` (English values) | «Manchego», «Padrón», «Idiazábal» kept in English menu text, as English menus do |

## Test support files outside `*.test.ts`

Test helpers under `testing/` and `test/` folders hold Spanish fixture venues: whole Spanish menus
(`apps/server/src/testing/bill-venue.ts:66–75`, `party-venue.ts:57–65`, `adjustment-venue.ts`,
`split-extras-venue.ts`), «Venta en establecimiento» and «Caja 1» in boot and stream helpers, a
Spanish A4 invoice for line-wrapping checks (`full-invoice-fixture.ts`), the station default
«Cocina» (`packages/db/src/testing/seed.ts:44–50`), a frozen configuration export in five languages
(`apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`), a signed Cloud
test vector whose bytes cannot change (`apps/server/test/cloud-translation-vector.json`), and the
demo seed's 4,173-line golden snapshot (`demo-seed/testing/spanish-practice-sales.golden.json`, mostly
fiscal column names, which are allowed). `apps/server/src/testing/fiscal-fixtures.ts` is AEAT field
names and allowed.

## Tests

Of the 1,151 candidate test files, **973 really spell Spanish or Catalan** (962 without
`packages/adjustments`). A further 109 hold only the operation description («Hostelería», «Venta en
establecimiento»), 43 hold non-English text for a sound reason (15 test accent handling, 14 show a
language under its own name, 14 hold only AEAT field names), 22 hold only the loanwords «Café» or
«Entrées», and 4 were false positives. Counts come from a line classifier checked by hand (every file
it found nothing in, every identifier-only file, 30 random "real" files, and 20 random lines per large
package); the "real screen wording" counts are good to about ±20%.

Why tests spell it, largest first:

1. **Spanish test data** — about 9,000 lines: «Mesa 5», «Cocina», «Caña», «Ana García», Madrid
   addresses. Nearly all could be English. One cause: the server's test venues default to Spanish
   (`apps/server/src/testing/clock-venue.ts:68–69`, `testing/fiscal-fixtures.ts:86–87`), so names go
   under `es` and receipts print in Spanish.
2. **Identifiers and comments echoing that data** — about 4,200 lines (`mesa5`, `jamon`, `openMesa`).
3. **Checks on a Spanish screen** — about 1,300 real lines. Every dashboard, till, setup and module
   screen already has a strings file, and about 670 test files in the dashboard, till and setup
   already import one (counted by grepping for the import). The server is the exception: only its receipt words sit in a file a test could read
   (`packages/country-es/src/receipt-labels.ts:7`).
4. **AEAT wire names** — allowed.
5. **Accent handling itself** — folding, sorting, byte limits, the printer's character set, modelo 303
   rules. These need accented characters, not Spanish words, and stay.

| package | files with real non-English text | main reason | strings file a test could read | size of the change |
| --- | --- | --- | --- | --- |
| apps/server | 319 (+55 operation description only) | data; Spanish test venues | receipts only; other pages keep inline tables | screen checks ~250 lines; data ~4,150 + ~2,370 identifiers |
| apps/till | 190 | data | `apps/till/src/i18n/strings.ts` | screen checks ~225; data ~1,590 + ~1,390 |
| apps/dashboard | 177 | data, screen checks | `apps/dashboard/src/i18n/strings.ts` | screen checks ~420; data ~1,290 |
| packages/venue-service | 80 | data, screen checks | `src/dashboard/strings.ts` | screen checks ~180; data ~330 + ~290 |
| packages/catalogue | 31 | second-language content | not needed | data ~230 |
| apps/setup | 30 | screen checks | `apps/setup/src/i18n/strings/*.ts` | ~126 |
| packages/ui | 27 | Spanish sample labels on components | none | ~100 |
| packages/db | 16 (+32 operation description) | data | not needed | small |
| packages/bookings, staffing, media | 14, 14, 9 | names, screen checks | yes | small (8–28 each) |
| packages/adjustments | 11 | being fixed in A758-1 | yes | — |
| packages/reporting | 8 | modelo 303 character rules (stay); category names | n/a | small |
| packages/ui-core | 7 | sample labels (`<wt-button>Cobrar</wt-button>`) | none | ~40 |
| core, provisioning, layouts, printing, shared, dashboard-kit | 4–6 each | data; dashboard-kit tests its own translation lookup (needs a decision) | — | small |
| workforce-es, country-es, country-packs, payments-sumup, purchasing, print-agent, store | 1–3 each | Spain-specific terms, official text, a real place name, small data | — | tiny |

Five examples:

1. A Spanish screen checked — `apps/setup/src/screens/cert-screen.test.ts:472`:
   `expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");` — the screen uses
   `t("cert.fix_fields")` and the Spanish already sits at `apps/setup/src/i18n/strings/venue.ts:425`.
2. Spanish data — `apps/server/src/move-merge.test.ts:380`: `const mesa5 = await v.table("Mesa 5");`
3. Spanish identifiers — `apps/server/src/till-api.service-periods.test.ts:98`:
   `tostada: { desayunos: string; almuerzo: string };`
4. AEAT wire name (allowed) — `apps/server/src/qr-link-range.test.ts:16`: `NombreRazonEmisor: "Waitron SL",`
5. Accent handling (stays) — `packages/shared/src/text-search.test.ts:18`:
   `it("folds case and accents, so jamon finds Jamón", …`

Tests that genuinely need non-English data: accent tests; a language's own name; Spanish dates and
amounts produced by the browser's own formatter (about 155 lines, e.g. «mié 21 oct», «12,50 €»);
official text and real places (the BOE annex, «A Coruña»); tests of the translation lookup itself.
Second-language content needs a second language, not real Spanish words — «Drinks (es)» would do.

## What the English-only guard misses, and a proposal

`scripts/english-only.test.ts` (with `packages/db/src/english-only.ts`) is weaker than its name in
five measured ways. Measured 2026-10-20 on main a3be14ba4 with a throwaway root test (not committed)
that ran the guard's own `findSpanish` with the assembled forbidden set over this audit's 133
non-test candidate files:

1. **It reads only `.ts` files under `packages/<name>/src/`, for the 36 packages `GENERIC_PACKAGES`
   names** (`sourceFilesIn`, `packages/db/src/english-only.ts:225–239`). So it never reads:
   - anything under `apps/` (a recorded decision: `apps/server` is the composition root, comment at
     `english-only.ts:70–77`);
   - packages left off the list: `bookings`, `venue-service`, `ui-core`, `server-kit`, `country-gb`,
     and the Spain-specific `reporting`, `country-es` (`workforce-es` and `fiscal-verifactu`, the
     vocabulary owners, are read only to prove their own declared words occur there, never checked
     against the rest of the list);
   - folders beside `src/`, even in a listed package: a `test/` folder (`core/test/fixtures.ts`
     holds `venta`, unread) or `packages/ui/demo/main.ts` (16 hits from the guard's own matcher, unread);
   - any file that is not `.ts`: JSON seed and golden files, hand-written `.sql`, `.mjs`, `.md`,
     `.py`, `.xml`.
2. **It knows only 135 words** (23 in its base list, the rest declared by `fiscal-verifactu` and
   `workforce-es`), nearly all of them fiscal, labour or sales-ledger words. Most everyday restaurant
   Spanish is not on it. The probe's sample lines: `"Cambio del cliente"` → `cliente`;
   `"Mesa 4"` → `mesa`; `"Cambio de idea"`, `"Cocina"`, `"Terraza"`, `"Propina"` → nothing.
   Of the 133 candidate files, 63 produced no hit at all from the guard's matcher, even fed to it
   directly; only the audit's own scans (accents, and a wider word list) flagged them.
3. **It does not look at accents.** Its tokeniser folds accented letters to plain ones and then
   compares against the word list, so `"Plato frío"` is invisible unless `plato` or `frio` is listed.
4. **It exempts by shape, not content:** a `«…»` quote anywhere (code included), a backtick
   citation in a comment, any `dashboard/strings.ts`, and `provisioning`'s test files.
5. **It cannot tell a translation value from a leak.** The comment at `english-only.ts:48–50` says
   "user-facing translation VALUES (a `{ en, es }` copy entry) are not vocabulary", but nothing in
   the matcher implements that: an `es` value outside `dashboard/strings.ts` either fires (if its
   word is listed) or passes (if not), by luck of the word list.

**Proposal (for the owner to choose from; nothing changed here):**

- **Scope.** Scan every tracked text file under `packages/` and `apps/` (`.ts`, `.mjs`, `.json`,
  `.sql`, `.html`, `.md`), every folder, minus an explicit list of HOMES that is short and pinned by
  test: `packages/fiscal-verifactu/**`, `**/i18n/**`, `**/strings.ts`,
  `apps/server/src/guide/<lang>/**`, plus whatever the owner rules for the Spain-specific packages
  (question below). This retires the `apps/*` decision: the composition root may wire a regime, but
  its own TEXT can still be English. Fiscal wire names it must spell would need a way through —
  for example the existing backtick-citation rule, or importing the name from the fiscal package;
  how many such names `apps/server` spells was not measured.
- **Word list → accent test plus a short word list.** Add a second check that refuses any letter
  from `[áéíóúñ¿¡àèòçü]` outside the homes, with a small allowlist of English loanwords
  (`café`, `entrées`…, only if the owner wants them; 22 test files hold nothing else). Keep
  `findSpanish` for accent-free words and grow its base list with the restaurant words this audit
  found (`cocina`, `terraza`, `barra`, `sala`, `propina`, `camarero`, `cuenta`, `plato`…), checked
  against English collisions.
- **The `{ en, es }` carve-out.** Either delete the comment (nothing implements it) or make it real:
  an object literal whose keys are language codes is a translation table and is skipped — but the
  rule says translation tables belong in a translation FILE, so the simpler choice is to delete the
  comment and let only the homes hold Spanish.
- **Tests.** The rule covers tests, so the scope includes them; until the test clean-up lands (see
  the tests summary), a per-package list of test folders still to clean, shrinking only, pinned by
  the suite like `module-seams`' allowlist.

## Coverage: what was run and what was not

Pass 1 (accented letters), over every tracked file under `packages/` and `apps/` outside the homes
and binary types:

```sh
git ls-files packages apps | /usr/bin/grep -v '^packages/fiscal-verifactu/' | /usr/bin/grep -v '/i18n/' \
  | /usr/bin/grep -v 'strings\.ts$' | /usr/bin/grep -v '^apps/server/src/guide/' \
  | /usr/bin/grep -Ev '\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|otf|xsd|wsdl|p12|pem|der|bin|db|sqlite|zip|gz)$' > files.txt
LC_ALL=en_US.UTF-8 xargs /usr/bin/grep -l -E '[áéíóúñÁÉÍÓÚÑ¿¡àèòçÀÈÒÇüÜ]' < files.txt
```

5,948 files scanned; 846 matched (91 non-test). The locale matters: under the C locale the same
bracket matched the bytes of an em dash and reported 2,123 files.

Pass 2 (accent-free words): a whole-token scan, splitting camelCase and snake_case, for about 190
Spanish and Catalan words (restaurant, money, staff, calendar and common short words), case
insensitive — 14,589 matching lines, 2,249 of them in 105 non-test files. The script and word list
are kept with the campaign's notes, not in the repository. Every non-test hit was then read and
judged by hand; common short words (`del`, `los`, `para`) produced many hits that were English
(`DEL` the control character, a `del` alias for deliveries) and were dropped.

The guard probe: a throwaway root test (not committed) ran `findSpanish` with the assembled forbidden
set over the 133 non-test candidate files and over six sample lines.

**Not covered:** Spanish words outside the pass-2 list with no accent (spot-checked by reading each
file in full, not exhaustive); file and folder names other than those found while reading; the
ISO-8859-1 `.htm` sources in `country-es` (a UTF-8 grep shows none, but they are Spanish and
official); `packages/adjustments` (A758-1); anything outside `packages/` and `apps/` (`scripts/`,
`deploy/`, `bench/`). Statements marked "from reading" were traced through the code, not run.
