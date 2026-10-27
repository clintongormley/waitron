# A972 — demo data per country pack and region (design)

Status: design, waiting for the owner's answers to Q1–Q4 (lane B, 2026-10-27).

## What the owner asked for

A913 point 6, in the owner's words:

- 2026-10-20 ~08:45: "Each country pack should have country specific demo data".
- 2026-10-20 ~09:15: "Even region specific demo data, eg catalán demo in Catalunya".
- Point 5, same morning: "in country packs we should also always provide English, even though it
  is not an official language".

Earlier rulings this design keeps (W109, 2026-10-06): a country with no demo data of its own gets
the existing demo in English; a country pack must carry a made-up demo identity (company, tax
number, location name) to be offered at setup; practice sales are recorded through the venue's own
fiscal module.

## What happens today

- **The demo is a real product path, not only a developer tool.** Picking "Demo" in setup runs
  `seedInstalledDemo` (`apps/server/src/demo-seed.ts:17–39`, called from
  `apps/server/src/setup-api.ts:876–878`). It writes four menus (restaurant, drinks, deli, set
  lunch), a floor plan, staff, pictures and 30 days of practice sales into a practice venue. The
  developer stack runs the same seed (`apps/server/scripts/dev-setup.ts:241–247`). The seed never
  sends anything to AEAT: it records sales and leaves them queued (`seed-sales.ts:2–5`).
- **The pack names its demo; the server holds the data.** Spain's pack carries the made-up identity
  and a data-set name (`packages/country-es/src/spain.ts:311–317`: "Waitron Demo S.L.", B00000000,
  "Casa Delgado", `dataSet: "casa-delgado-es"`). The data itself — menus, option and extras lists,
  zones, tables, five staff, adjustment reasons — is in `apps/server/scripts/demo-seed/`
  (`data-sets/casa-delgado-es.ts`, `menu.ts` 968 lines, `floor.ts`, `staff.ts`,
  `seed-adjustments.ts`), with 45 placeholder pictures in `media/` that `gen-media.mjs` draws from
  each file name. The image copies them to `/app/demo-media/` (`deploy/Dockerfile:222`).
- **Customer text already follows the region.** The data has customer text in `es`, `en`, `ca`,
  `ca-ES-valencia` and `gl` (`data-sets/casa-delgado-es.ts:13`). The seed reads the location's
  stored province (`seed-catalogue.ts:92–98`) and writes the languages a new venue in that province
  starts with (`data-set.ts:176–181`). So a demo in Barcelona already shows Casa Delgado's menu in
  Catalan by default («Croquetes de pernil», `menu.ts:365`), with Spanish and English beside it, and
  prints Catalan receipts (Spain's pack fixes Catalonia's receipt language, `spain.ts:197–210`).
- **Staff text follows the person setting up**, English or Spanish only, because the staff apps
  exist in those two (`demo-seed.ts:12–14`; `data-set.ts:18–21`).
- **What is not translated:** 36 staff and kitchen names in `menu.ts` are one string written
  whatever the staff language — mostly Spanish («Croquetas», «PUNTO CARNE», «GUARNICIÓN POLLO»), a
  few English («MIXED SALAD», «Portion»). The seed writes them as they are
  (`seed-catalogue.ts:169, 173`; `seed-option-lists.ts:39–50`; `seed-extra-lists.ts:24–26`). The
  set lunch's English staff name is «Menú del Día» (`menu.ts:840`). Recorded by the A913 audit
  (`docs/backlog/english-only-audit.md`, Bucket D). Named in the seed's code, and English in every
  demo: the reporting categories (the English section name, `seed-catalogue.ts:131`), the four
  stations (`seed-catalogue.ts:55, 63–65`), the printer (`seed.ts:89`), the special day
  (`seed.ts:160`) and the menu periods (`seed-floor.ts:184, 194`).
- **A pack cannot import the data's types.** The data relies on types from `@waitron/catalogue`
  (VAT class, pricing unit, diet labels), `@waitron/adjustments` (reason kinds and actions),
  `@waitron/identity` (staff roles) and `apps/server` itself (table placement,
  `floor-reset-plan.ts`). Catalogue and adjustments both depend, through `@waitron/country-packs`,
  on `@waitron/country-es` (each `package.json`), so the pack importing them would make a loop,
  which `scripts/workspace-cycles.test.ts` refuses.
- **The pack is loaded in browsers.** The setup wizard and the till import `@waitron/country-packs`
  (`apps/setup/src/screens/venue-screen.ts:20`, `apps/till/src/screens/till-ticket-view.ts:14`),
  which imports Spain's pack (`packages/country-packs/src/registry.ts:9`). Whatever Spain's pack's
  main file reaches is shipped to those browsers.

## What changes

### 1. Spain's demo moves into Spain's pack

- **What moves:** the data only — menus, option and extras lists, floor, staff, reasons and the 45
  pictures — into `packages/country-es/src/demo/` and `packages/country-es/demo-media/`. Spanish
  words are allowed there: it is a package written for Spain (CLAUDE.md §3, English-only rule).
  The code that writes the data into a venue (`seed*.ts`) stays in `apps/server/scripts/demo-seed/`
  and serves every country. Files that mix data and code today are split: the adjustment reasons
  leave `seed-adjustments.ts`; the demo admin's email, password and PIN stay in `apps/server` (`dev-setup.ts:32`,
  `seed-staff.ts`); the functions in `floor.ts` stay in `apps/server`.
- **Kept out of the browsers.** The data is reached only through a second door into the package,
  `@waitron/country-es/demo` (an `exports` map with a main entry and a `demo` entry, as
  `@waitron/adjustments` already has for its `dashboard`; Spain's pack has no `exports` map today),
  never from its main file. Proof, with a control: after building, the setup and till bundles must
  NOT contain a dish name («Croquetes de pernil») and MUST still contain «Waitron Demo S.L.» (which
  stays in the main file). A root test also fails if the pack's main file ever imports its `demo`
  folder.
- **Types without the loop.** `@waitron/country` gains a loose description of a demo data set,
  `CountryDemoData`, with plain strings where catalogue, adjustments and identity have their own
  lists. The pack checks its data against that loosely, and `apps/server` — which may import all of
  them — checks each data set against the strict types at compile time, so a VAT class or role the
  seed does not know fails the build. No list is copied. (`@waitron/country` already holds a plain
  string for a VAT class: `defaultProductVatClass?: string`, `country.ts:115`.)
- **One list of every demo data set**, `@waitron/country-packs/demo`, beside the list of every pack
  that package already keeps. `apps/server` asks it for a data set by name.
- **Everything that names today's paths moves with them**: the Dockerfile's picture copy and the
  test that pins it (`scripts/deploy-image-env.test.ts:236–237`); where `seed-media.ts:11–12` and
  `gen-media.mjs:12, 141` look for pictures and the menu; `eslint.config.js:316`; the test-duration
  table (`apps/server/test-durations.json`). Pictures stay in one folder per data set; regional
  dishes add pictures with names of their own.
- **Tests come with the data.** Spain's pack measures coverage over its `src/`, apart from
  `index.ts`, at 98/98/98/95 (`packages/country-es/vitest.config.ts:11–14`). Moving data only, with the functions
  left in `apps/server`, keeps that easy; any function that does move brings its tests.
- **No visible change, and a check that could catch one.** The saved copy of the Spanish practice
  sales that a test compares against (`seed-sales.golden.test.ts`) does not read the menu — it sells
  five products it names itself — and the seed's other tests read the data from the same files they
  test. So neither can notice a damaged dish. Instead, the first pull request seeds a Madrid demo
  before and after the move and compares every row the seed writes (products, menus, lists, floor,
  staff, reasons), apart from ids and times; a one-word change to one dish must make that comparison
  fail.

### 2. English for every name the demo writes

- Every staff name and kitchen name the demo writes becomes a pair, English and Spanish, like the
  menu and department names already are (`StaffText`, `data-set.ts:21`): products, variants, option
  and extras lists and their labels, units' staff names and short forms, and the reporting category
  names. The seed writes the one for the staff language. The stations, printer, special day and menu
  periods, which the seed's code names in English, are decided in the plan the same way.
- The set lunch's English staff name becomes "Set lunch"; its customer name stays "Lunch menu",
  because each of a product's three names must differ in a demo or test fixture (CLAUDE.md §3).
- Visible change: an English demo's till, kitchen screen and dashboard show English staff and
  kitchen names. A Spanish demo changes only where a name is English today: the kitchen names
  «MIXED SALAD» and «COFFEE · DOWNSTAIRS BAR», the unit name «Portion» (`menu.ts:774, 875, 878`),
  the reporting categories, and the names the seed's code writes, get Spanish ones.

### 3. Regional demos

Spain's pack today gives its provinces five sets of language rules — Catalonia, Valencian Community,
Galicia, Balearic Islands, and Spanish for the rest — plus a Basque and Navarre case
(`spain.ts:197–262`). The proposal:

| Region (provinces) | Default customer language | Demo |
| --- | --- | --- |
| Catalonia (08, 17, 25, 43) | Catalan | **Catalan demo** |
| Balearic Islands (07) | Catalan | Catalan demo, shared (Q2) |
| Valencian Community (03, 12, 46) | Valencian | **Valencian demo** |
| Galicia (15, 27, 32, 36) | Galician | **Galician demo** |
| Every other supported province | Spanish | Spain's demo, as today |
| Basque Country, Navarre, Canary Islands, Ceuta, Melilla | — | none: setup refuses a venue there today (`setup-api.ts:449–451`) |

What a regional demo contains is Q1. Whatever the answer:

- **Chosen from the venue's province on the server**, from the same stored row the seed already
  reads for languages (`seed-catalogue.ts:92–98`). That row holds the province's NAME
  (`venue-screen.ts:342`), so it is looked up with `findAdministrativeArea` (`country.ts:170`), as
  the language rules are. Each province in Spain's pack may name its own demo data set; a province
  that names none uses the pack's. One place decides "is this the pack's own demo?" by the
  pack-wide name and must read the province's instead: the languages (`data-set.ts:176–181`),
  or a regional demo's customer text falls back to English. The staff language (`demo-seed.ts:33`)
  only asks whether the pack names a data set at all, so it needs no change.
  Setup's request needs no new field, unless Q3 makes the location name regional; then the browser
  works out the regional name too and the server repeats the check (CLAUDE.md §3, country packs).
- **Customer text in the region's language, Spanish and English.** Staff and kitchen text stays in
  English and Spanish (Q4). A regional drink goes into the bar's wine section, not the regional
  section, because the drinks menu is built from the bar's sections (`seed-catalogue.ts:214–225`).
- **Practice sales** in a regional demo are drawn from every product available at the location
  (`seed.ts:109`), regional dishes included.
  Spain's demo is unchanged.
- **Developer stack:** `wa-wt demo` keeps Madrid and Spain's demo. A developer setting (named in the
  plan) picks a region, and fills in a matching postcode, city and receipt language, so the regional
  demos can be looked at and tested.

## Questions for the owner

### Q1. What makes the Catalan demo Catalan?

Today a demo set up in Barcelona already shows Casa Delgado's menu in Catalan («Croquetes de
pernil», «Crema catalana»), with Spanish and English beside it, and prints Catalan receipts. What
it does not have: Catalan dishes, Catalan staff names, a Catalan restaurant.

- **(a) Nothing more.** The region changes the default language, as today. No new data.
- **(b) Casa Delgado plus a regional section.** Every regional demo is Casa Delgado with one extra
  menu section of regional dishes, a regional wine, and its own staff names. About eight products
  and five names per region; pictures are drawn from the file names, as today. Example for
  Catalonia:

  | Section «Especialitats de la casa» | Catalan (default) | Spanish | English |
  | --- | --- | --- | --- |
  | | Escalivada | Escalivada | Roasted peppers and aubergine |
  | | Esqueixada de bacallà | Esqueixada de bacalao | Salt cod salad |
  | | Botifarra amb mongetes | Butifarra con judías | Catalan sausage with white beans |
  | | Fideuà | Fideuá | Seafood noodles |
  | | Mel i mató | Mel i mató | Fresh cheese with honey |
  | Wine section | Copa de cava | Copa de cava | Glass of cava |

  Staff: Jordi Puig (manager), Montse Vila, Núria Soler, Pau Ferrer, Laia Roca. Valencia would
  have all i pebre, esgarraet, paella valenciana and orxata amb fartons; Galicia empanada galega,
  caldo galego, lacón con grelos, filloas and an Albariño.
- **(c) A separate restaurant per region**: its own menus, floor plan and staff. Each is about
  1,000 lines of data, three times over, to keep translated and tested.

**Recommended: (b), built one region at a time, Catalonia first.** It is what a person in
Barcelona would notice — their own dishes and names on the till — for a small fraction of (c)'s
data, and every screen, report and test that already works on Casa Delgado keeps working.

### Q2. Does the Balearic Islands demo share Catalonia's?

Both default to Catalan (`spain.ts:197–210, 242–245`). **Recommended: share it**, and give the
islands their own section (ensaïmada, tumbet, frit mallorquí) only if you ask. The alternative is a
fourth regional section now.

### Q3. Does the restaurant's name change by region?

The demo's company, tax number and location name are the same everywhere today: "Waitron Demo
S.L.", B00000000, "Casa Delgado". Setup fills the location name in for you
(`venue-screen.ts:381–384`).

- **(a) Keep "Casa Delgado" everywhere.** No setup change.
- **(b) A regional name**, for example «Can Delgado» in Catalonia. Setup fills the name in before
  you type the postcode or pick the province that decides the region, so the form would have to
  change the name when the region changes, as long as you have not edited it.

**Recommended: (a).** The regional dishes and staff carry the local feel; a second name adds a
setup-form change for little.

### Q4. Kitchen and staff names in the region's language?

The staff apps exist in English and Spanish only, so the demo writes staff and kitchen names in the
language of the person setting it up. In a Catalan demo set up in Spanish, the till button reads
«Butifarra» and the kitchen ticket «BUTIFARRA JUDÍAS», while the customer menu reads «Botifarra amb
mongetes».

- **(a) Keep staff and kitchen names in English or Spanish**, matching the staff screens.
- **(b) Catalan staff and kitchen names** in a Catalan demo, whatever the person's language.

**Recommended: (a).** Staff names follow the staff screens' language everywhere else in Waitron;
(b) would mix a Catalan button into Spanish screens until the staff apps are translated (backlog:
"Catalan, Valencian, Galician and Basque — … the whole app in all four", C125, parked).

## Build, after the answers

Pull requests in order, none with a database migration:

1. **Move** — the data and pictures into Spain's pack behind `@waitron/country-es/demo`, the loose
   type in `@waitron/country`, the list of data sets in `@waitron/country-packs/demo`, and every
   path that names the old place. No visible change, checked by the before-and-after comparison and
   the two-way bundle search above. **Full review** (finish-branch's full set of reviewers): the new
   type is read by three packages.
2. **English names** — staff and kitchen names as English–Spanish pairs; "Set lunch". Light review
   (fewer reviewers; no risky area touched).
3. **Regional demos** — per the answers, one pull request per region if Q1 is (b): the per-province
   data-set names, the province lookup, the regional data, the developer setting, and the setup form
   if Q3 is (b). Each region is looked at on the till, kitchen screen and dashboard, in both themes
   and at phone width. Full review for the first (it changes how the demo is chosen) and if Q3 is
   (b) (setup's browser and server must agree); light for the rest.

## Out of scope

- The other demo scripts (`*-demo.ts`) and test fixtures: A975 and A976.
- Translating the staff apps into Catalan, Valencian, Galician or Basque: C125.
- A demo for a country other than Spain: no other pack is offered at setup today.
