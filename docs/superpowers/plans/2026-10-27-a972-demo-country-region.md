# A972 Demo Data per Country and Region Implementation Plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans`. Read `superpowers:test-driven-development` before writing code. The parent driver owns workflow; do not automatically
delegate tasks to implementers or reviewers. Steps use checkboxes for tracking.

**Goal:** Give Spain regional practice restaurants while keeping shared seed writers country-neutral and ordinary browser bundles free of demo menus.

**Architecture:** Country packs own data and pictures behind secondary package exports. The server keeps database writers, domain-type checks, credentials and floor-placement functions. Lightweight
geography metadata chooses a dataset and restaurant name in browser and server; the chosen dataset can override demo plain names without translating staff applications.

**Tech stack:** TypeScript, pnpm, Vitest, real SQLite through `useVenueDb`, Lit browser tests, Vite and the existing image build.

**Spec:** [A972 design](../specs/2026-10-27-a972-demo-data-per-country-and-region-design.md). The owner's 27 October answers supersede its recommendations: Q1(b), Q2 share, Q3(b), Q4(b). This plan
needs no further design approval.

## Global constraints and execution order

- Publish this plan first through the `docs/`-only signed-commit workflow. That publication is not a sixth code PR. Then land exactly five independently working cuts, in the order below; no migration
  in any cut.
- Before **each** code cut, the driver refreshes main, queues, owner holds and committed-plus-dirty path reservations, then records the intended paths. The supplied orientation records main
  `d5c7ccb1a7ad8c0a936f6bc7a10b98c56b463360`; it is a checkpoint, not continuing authorization about later state.
- A918's dependency is satisfied by landed PRs #2128/#2130/#2137/#2141. Preserve its live starter-content policy. Other demo scripts and general fixtures remain A975/A976; staff-app translations
  remain C125.
- Preserve all parked trees and holds, including A696 `c79b2c03d`, A951, A963 #2145, A965 #2147 and A1154. A696 overlaps `country.ts`, `spain.ts`, country registry, `seed.ts`, `seed-sales.ts` and
  setup tests. #2145/#2147 overlap country surfaces.
- The lane E queue's 27 October A972 instruction expressly permits starting beside #2145/#2147 and rebasing onto whichever lands first. Its 7 October standing overlap waiver says whoever lands second
  rebases and preserves both behaviors. Record fresh overlaps; do not convert them into indefinite waits or modify another branch. Actual owner pauses and unlanded dependencies still apply.
- Read the current `CLAUDE.md`, relevant developer guides, queues and applicable skills at execution. The author read `conventions-data.md` country/module/English sections, `testing-guide.md`
  DB/browser/comparison rules, `products.md`, Forms/draft conventions and `writing-claims.md`.
- Never change fiscal writers, invoice-number allocation, `allocation.ts`, the existing sales golden or its JSON, golden huella, `inmutabilidad`, or another existing fiscal assertion. Practice sales
  use the unchanged fiscal seat. If protected scope becomes necessary, stop that cut for the owner; do not weaken the check.
- Keep `98/98/98/95`, existing coverage scopes and mutation floors. CI owns full package coverage; use focused local checks, the normal pre-push hook once per push, and required CI on the actual head.
  No whole-workspace local gate, new exclusions or threshold reductions.
- Cuts 1 and 3 each receive **one Claude run-it whole-branch review through Codex `finish-branch`**, after its initial rebase, in a disposable checkout with dependencies. Read completed findings. Cuts
  2/4/5 use the low-risk house workflow. Do not repeat full review solely for a later rebase.
- Every commit uses `git commit -s`; never bypass hooks. The driver follows current landing authorization, including the owner-only hold for changes to words printed on invoices. A changed dataset
  does not authorize changing receipt-language or snapshot writers.
- An observed behavioral RED must execute a named assertion and print a test count. A pre-suite import/loader error alone does not qualify; assert missing secondary exports within a test case before implementing them.
- All checks below are **required future verification**, not results obtained by this plan author. Keep commands' exit codes and Vitest test counts. Stop only recorded processes you started; preserve
  shared Docker state.

## Review Focus

1. An indirect main-entry re-export leaks demo data, while a legitimate secondary import is refused: cut 1 owns graph/deletion/acceptance cases in new `scripts/demo-boundaries.test.ts` and bundle
  controls.
2. A damaged dish outside the five hardcoded golden-sale products escapes comparison: cut 1 owns frozen full seed-row comparison and changed-dish control in new `seed.madrid-baseline.test.ts`.
3. Typing an old default name, then reviewing, going Back or discarding a draft loses ownership: cut 3 owns native-input and restoration cases in new `venue-screen.demo-region.test.ts` and existing
  setup unsaved tests.
4. Valencia's content tag, staff language and receipt language get conflated: cut 4 owns independent key/value and stored-sale assertions in `seed.regional.test.ts`, country registry and
  starter-language tests.
5. A regional wine never reaches Drinks, an image resolves only in source, or sales miss every regional dish: cuts 3–5 own actual menu/media/sales assertions in `seed.regional.test.ts` and
  `seed-media.test.ts`.

## Source findings and file map

These are reading receipts at the checkpoint, not runtime qualifications:

- `apps/server/scripts/demo-seed/data-set.ts` defines `DemoDataSet`, `demoDataSetFor(identity)` and `demoLanguagesFor(set, geography)`; the last compares only the pack-wide id today.
  `seed-catalogue.ts` reads stored tenant country/location province, writes categories from English names, and extracts bar sections into Drinks.
- `seed-catalogue.ts` also names beer/Negroni basenames and special menu prices; `seed-floor.ts` finds stations/categories by English names and writes periods and Standard; `seed.ts` names printer and
  Christmas Day. Move those data decisions as well as menus, people and reasons.
- `staff.ts` embeds `DEMO_DASHBOARD_PASSWORD` in the manager row. `seed-staff.ts` hashes it; `dev-setup.ts` reuses it for admin, alongside `DEMO_ADMIN_EMAIL`/`ADMIN_PIN`. Move people, not their
  password value, into the pack.
- `floor.ts` mixes data with `sizeFor`/`onGrid` and imports server `Placement`. Keep those functions in the server. The pack must have no server dependency, even for tests.
- `seedInstalledDemo(db, result, venue)` currently chooses from request country; `devSetup(opts)` provisions Madrid, then seeds the pack-wide id. Trace both and `demo-clock-profiles.test.ts`; do not
  fix only the catalogue writer.
- `spain.ts:173` gives Valencian provinces `defaultLocale: ca-ES`, but `spain.ts:212` gives **content** `ca-ES-valencia`; `country-packs/src/registry.ts` uses `defaultContentLocale`, and
  `shared/src/content-languages.ts:65` preserves the Valencia variant. `receiptLanguageRules` uses fixed receipt locale or pack default. These are three separate resolutions.
- `venue-screen.ts` retains receipt-default ownership in `VenueForm`; `setup-app.ts` stores patches and reconstructs screens. `parseVenue` normalizes/checks geography and preserves typed location
  names. Extend the ownership model explicitly rather than recognizing old defaults by string equality.

| Cut | Exact paths and responsibilities (`new` means proposed) |
| --- | --- |
| 1 contracts | New `packages/country/src/demo.ts`; export types from `src/index.ts`. New `packages/country-es/src/demo/{index,menu,floor,staff,reasons,casa-delgado-es,developer-presets}.ts`. New `packages/country-packs/src/demo.ts`. Modify both country package manifests to enumerate `.` and `./demo`. |
| 1 writers | Modify server `scripts/demo-seed/{data-set,floor,seed,seed-catalogue,seed-floor,seed-staff,seed-adjustments,seed-media}.ts`; new `credentials.ts` and `locale.ts`. Remove old data-only `menu.ts`, `staff.ts` and `data-sets/casa-delgado-es.ts` after every consumer moves. Keep `in-languages.ts` and `seed-sales.ts` behavior unchanged. |
| 1 media/guards | Move PNGs into `packages/country-es/demo-media/casa-delgado-es/`; move generator to `packages/country-es/scripts/gen-demo-media.mjs`. Modify `deploy/Dockerfile`, `eslint.config.js`, `scripts/deploy-image-env.test.ts`, `scripts/module-seams.test.ts`, `apps/server/test-durations.json`. New `scripts/demo-boundaries.test.ts`, `scripts/check-demo-browser-bundles{.mjs,.test.mjs}`. |
| 1 tests | New country-es `src/demo/data.test.ts`, country-packs `src/demo.test.ts`; split the existing server `data-set.test.ts` accordingly. New server `scripts/demo-seed/{data-set.typecheck,seed.madrid-baseline.test}.ts` and `testing/madrid-semantics.ts`. Immutable `madrid-before-move.{en,es}.json` and `madrid-before-move.manifest.json` live in `packages/country-es/test-fixtures/demo/`. New `src/demo-testing.ts` in country-es and country-packs exposes test-only fixture URLs. Keep DB writer tests in server. |
| 2 names | Modify country `src/demo.ts`, country-es demo data, server seed writers and `data-set.ts`; new server `scripts/demo-seed/seed-names.test.ts`. Update only affected nonfiscal name expectations and EN/ES demo guide wording. |
| 3 geography | Modify country `src/country.ts`/`country.test.ts`; new `src/demo-selection.ts` with export from `src/index.ts`. Modify country-es `spain.ts`/`spain.test.ts`, country-packs `registry.ts`/`registry.test.ts`; new country-es `src/demo/casa-delgado-ca.ts`/`regional.test.ts`. |
| 3 setup/dev | Modify server `src/{demo-seed,setup-api}.ts`, their tests including `setup-api.country-pack.test.ts`, `scripts/dev-setup.ts`/`dev-setup.test.ts`; modify setup `src/{api/client,events,setup-app,screens/venue-screen}.ts`; new `src/screens/venue-screen.demo-region.test.ts`. Extend existing venue/review/a11y/unsaved suites. New server `scripts/demo-seed/seed.regional.test.ts`. |
| 4–5 datasets | New country-es `src/demo/casa-delgado-{valencia,gl}.ts` and `demo-media/casa-delgado-{valencia,gl}/`; extend existing regional tests, registry, province metadata, developer presets and secondary exports per cut. No new architecture or application locale. |
| all documentation | Keep `docs/backlog.md` and `docs/backlog/architecture.md` accurate per cut; update current path claims in `docs/backlog/setup.md`. Add a dated pointer to historical `docs/backlog/english-only-audit.md`, without rewriting its historical table. Cuts 2–5 update `apps/server/src/guide/{en,es}/products.md` and `content-and-images.md` with shared heading ids; cut 3 also updates `docs/developers/{products,workflow-guide}.md` and `apps/server/README.md`. |

## Cut 1: Move data and media without changing the Madrid result

**Interfaces (all new unless described as existing):**

- `CountryDemoData<L extends string = string>` in `@waitron/country`: readonly structural menus/products/variants/units/options/extras/floor/staff/reasons, with `DemoText<L>` including EN/ES. Domain
  values such as VAT, pricing unit, dietary labels, roles, reason kinds/actions and placement shapes are strings, not copied enum lists. Use raw decimal strings for adjustment limits. No
  catalogue/identity/adjustments/server imports.
- Include data fields `mediaDataSet: string`, `stations` (kitchen/downstairsBar/upstairsBar/deli), `printerName`, `specialDayName`, `menuPeriodName`, `floor.setName`, and `menuPriceOverrides: readonly
  { menu: "drinks" | "lunch"; productImage: string; grossPrice: string }[]`. These describe existing writes, including beer 3.00 and lunch Negroni 9.00.
- Staff rows carry `displayName`, `email`, `role`, and `dashboardLogin: boolean`; never a password/PIN. Server `credentials.ts` owns existing credential constants/values. `seedStaff` assigns the
  shared password only when `dashboardLogin` is true, preserving manager/admin versus other accounts.
- Floor data carries raw `label, zoneKey, capacity, posX, posY, shape, rotation`; describe placements structurally in country types (`x,y,width,height,shape,rotation`), without importing server
  `Placement`. Server `floor.ts` exports `onGrid(raw: SeedRawTable): SeedTable`, retaining the existing algorithm and strict `Placement` result.
- Country-es `/demo` exports literal-preserving constants (`as const satisfies CountryDemoData<...>`), including every nested menu/person/reason aggregate; never annotate them in a way that erases
  enum literals into `string`. Country-packs `/demo` exports literal-preserving `DEMO_DATA_SETS` and `DEFAULT_DEMO_DATA_SET_ID`; remove the existing Casa Delgado fallback literal from generic server
  code. Main entries export neither this entry nor anything reaching it.
- Test-only `@waitron/country-es/demo/testing` exports `DEMO_BASELINE_FIXTURE_ROOT: URL` from new `src/demo-testing.ts`, pointing to `test-fixtures/demo/`. Test-only
  `@waitron/country-packs/demo/testing` exports `DEMO_BASELINE_FIXTURE_ROOTS: Readonly<Record<string, URL>>` keyed by dataset id, importing country implementations only in that aggregate.
  Add these explicit subpaths to both export maps. Only the server test harness reads bytes through these URLs; main and ordinary `/demo` entries must reach neither testing entry nor fixtures.
  Extend the boundary guard with transitive isolation and a legitimate test-import control; limit the module-seam exception to the two named secondary aggregate files and their exact demo/testing imports.
  Put later language-specific expected-name maps in the same pack-owned fixture directory, separate from live dataset imports. Keep the independent reader/comparator in server.
- Server `data-set.ts` retains the existing `DemoDataSet`, `demoDataSet(id)`, `demoDataSetFor(identity)` and `demoLanguagesFor(set, geography)` public roles. Refactor strict nested types to readonly
  inputs; check imported registry against `Readonly<Record<string, StrictCountryDemoData>>` before adapting raw floor/decimal data into the existing writer shape. Import real `VatClass`,
  `PricingUnit`, `DietaryLabel`, `PersonRoleValue`, adjustment input member types and `Placement`, not duplicate unions or casts that silence errors.
- `seedMedia` takes `SeedMediaInput & { mediaDataSet: string }`. New secondary export `DEMO_MEDIA_ROOTS: Readonly<Record<string, URL>>` maps each registered media dataset to its source root.
  `WAITRON_DEMO_MEDIA_SOURCE` denotes an installed **root**, containing `<mediaDataSet>/<basename>`; source roots use the identical layout. Reject an unregistered dataset/path traversal; keep Node
  filesystem access in server/generator, never secondary data exports.
- New `CountryDemoDeveloperPreset` describes `country, dataSet, locationName, postalCode, city, province, timeZone, addressLine1, addressLine2, dayCutover` plus optional `receiptLocale` (all strings
  except nullable address line 2). Country-es exports data-only presets through `/demo`, and country-packs `/demo` aggregates `DEMO_DEVELOPER_PRESETS: Readonly<Record<string,
  CountryDemoDeveloperPreset>>` and `DEFAULT_DEMO_DEVELOPER_PRESET`. Move today's Madrid geography/address defaults there now; cut 3 adds regional choices. `SeedRawTable` is the strict server
  raw-table type, with existing table-shape and zone-key unions; only its server `onGrid` result carries strict `Placement`.

- [ ] **1. Freeze the old database outcome before moving anything.** In a driver-created `mktemp -d` disposable detached checkout of the recorded original-main SHA, install dependencies. Write the
  comparison harness there against **its own** existing seed imports. Pin `TZ=Europe/Madrid`, Date `2026-10-08T10:00:00.000Z`, Madrid `28013`, `Europe/Madrid`, cutover `05:00`, invoice locale `es-ES`,
  existing provisioner settings and `salesDays: 0`; capture EN and ES staff runs. Never swap old files into the feature worktree.
- [ ] Capture all application tables before/after provisioning and seeding, with table/column manifests, row counts, added/changed/deleted rows and the complete seeded state of each affected table.
  Inspect seed call chains and reconcile every write target with the manifest, including seed-added rows in already provisioned tables. This comparison deliberately covers nonsale seed data; the
  unedited fiscal golden separately covers its five sale products, not all menu rows.
- [ ] Implement new test-only `readMadridSemantics(db: Database): Promise<MadridSemantics>` in `testing/madrid-semantics.ts`; `MadridSemantics` holds table/column inventory and rows keyed by semantic
  identity. Replace generated ids with deterministic identities: product image/parent+variant, menu and section paths, ordered list/label positions, zone/table labels, person email, reason name and
  parent identities for link rows. Refuse collisions, unresolved references and unclassified changed tables/columns. Keep FK relationships, embedded JSON references, ordering, prices, defaults,
  translations, availability, routing, permissions, layout and media-byte digests; do not simply delete every `*_id` or timestamp column. Verify published-document hashes against original JSON before
  comparing canonicalized JSON/digests, so embedded ids do not create false mismatches. Normalize only named generated timestamps and salted hashes; verify PIN/password success and wrong-secret
  refusal, password presence and roles before replacing hash bytes with semantic results. Preserve authored times and all null/absent distinctions.
- [ ] Freeze `madrid-before-move.{en,es}.json` and manifest with original SHA/settings/exporter digest before candidate data imports exist. Copy only these data artifacts and the independent harness
  into the feature branch, placing the frozen data/manifest in `packages/country-es/test-fixtures/demo/` and the independent harness in server. Read fixtures through the test-only country-packs seam,
  never from candidate menu constants; new non-English expected values remain pack-owned. Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`; initial baseline must pass against the unchanged seed. An optional old
  data archive/digest supplements this DB receipt, never replaces it.

  Use these baseline-checkout commands from the implementation worktree; keep both temporary paths until capture finishes:

  ```bash
  A972_BASELINE_PARENT=$(mktemp -d)
  A972_BASELINE_TREE="$A972_BASELINE_PARENT/old"
  git worktree add --detach "$A972_BASELINE_TREE" d5c7ccb1a7ad8c0a936f6bc7a10b98c56b463360
  pnpm --dir "$A972_BASELINE_TREE" install --frozen-lockfile
  ```

  New test-only capture option `WAITRON_CAPTURE_MADRID_BASELINE=<output-directory>` writes the two JSON files/manifest **only in that old checkout before the move**. After writing its independent
  harness there, run its `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts` with that option and an owned output directory. Retain raw/canonical capture
  receipts outside source; remove the capture-writing branch from the committed test so ordinary tests cannot refresh expectations. Remove the detached tree with `git worktree remove` when done.

- [ ] **2. RED:** Add tests for secondary exports, full structural records, no secret-valued fields, source/installed media roots and transitive main-entry isolation. Run `pnpm --filter
  @waitron/country-es exec vitest run src/demo/data.test.ts` and `pnpm --filter @waitron/country-packs exec vitest run src/demo.test.ts`; expect missing new exports. Run `pnpm exec vitest run
  scripts/demo-boundaries.test.ts scripts/check-demo-browser-bundles.test.mjs`; expect missing boundary/build checker behavior. Also add the type controls described in step 4 and run server typecheck
  before implementing its adapter. Record each intended failure separately.
- [ ] **3. Move data and adapt writers.** Keep `menu.ts`'s locale type/map on server in `locale.ts`; move only menu records. Split adjustment records from decimal conversion and writes, and floor
  records from placement functions. Move staff identities but retain server credentials. Bind station/category lookups to dataset values or returned ids so changing a name cannot break routing.
  Replace special beer/Negroni code with data-driven overrides. Keep every original written value, insertion order and price unchanged in this cut.
- [ ] Update all relative/type imports by whole-tree search, including every `scripts/demo-seed/*.test.ts`, `testing/provision-venue.test.ts` if affected, `scripts/dev-setup.ts`,
  `src/demo-seed{,.test}.ts` and `src/demo-clock-profiles.test.ts`. Data-only assertions move to country-es; registry/fallback assertions split into country-packs and server. Tests needing DB/modules
  remain server-owned. No dependency from a pack test back into server or domain packages.
- [ ] Change package export maps without deleting required existing deep-import compatibility accidentally; search actual consumers first. Keep direct country implementations named only in
  country-packs: refine `module-seams.test.ts` to allow **only `/demo` imports in its new secondary registry**, not a general second main-registry exemption. Keep main-registry checks intact.
- [ ] Move media bytes unchanged; generator receives dataset id and reads the actual exported dataset: `pnpm --filter @waitron/server exec tsx ../../packages/country-es/scripts/gen-demo-media.mjs
  casa-delgado-es`. For later cuts replace the last argument with that cut's id. Emit only that complete dataset folder, including inherited products; do not scrape one source file or prune another
  dataset. Keep its PNG algorithm. Point its ESLint Buffer override at the moved file. Docker copies `/src/packages/country-es/demo-media/` to `/app/demo-media/`; retain the env root
  `/app/demo-media`. Each regional cut adds its complete folder and matching `mediaDataSet` together.
- [ ] **4. Strict type GREEN and negative controls:** The step-2 RED fixture is `data-set.typecheck.ts`, included by existing server tsconfig: valid registry assignment plus `@ts-expect-error`
  controls for an invalid VAT class, staff role, pricing unit, dietary label, reason action/role, missing required text, and malformed floor-table/extra shape. Each invalid domain value must still
  satisfy the loose country contract and fail assignment to the strict server input. Its initial typecheck must fail for a
  missing strict contract or unused directive; after step 3 require no unused directives. In a disposable candidate remove each directive and require the specific diagnostic; weaken each strict field
  to string and require its now-unused directive to fail. Restore, then run `pnpm --filter @waitron/country typecheck`, `pnpm --filter @waitron/country-es typecheck`, `pnpm --filter
  @waitron/country-packs typecheck` and `pnpm --filter @waitron/server typecheck`. No `any`/double-cast escape.
- [ ] **5. Focused GREEN:** Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/data-set.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
  scripts/demo-seed/seed-catalogue.test.ts scripts/demo-seed/seed-floor.test.ts scripts/demo-seed/seed-staff.test.ts scripts/demo-seed/seed-adjustments.test.ts scripts/demo-seed/seed-media.test.ts
  scripts/demo-seed/seed-option-lists.test.ts scripts/demo-seed/seed.integration.test.ts scripts/demo-seed/seed.test.ts src/demo-seed.test.ts src/demo-clock-profiles.test.ts
  scripts/dev-setup.test.ts`. Run the two new pack suites and focused root boundary/module-cycle/deploy guards. Every original semantic baseline row must match.
- [ ] **6. Controls:** In a disposable candidate change the customer name of a dish outside the golden's five products; require a named row/field mismatch from `seed.madrid-baseline.test.ts`, restore
  and require pass. Also delete one translation, relationship or row and require omission detection. Plant a main→helper→demo import/re-export and require the graph guard to fail; restore and
  demonstrate legitimate `/demo` import succeeds. Delete the guard's traversal/restriction in that copy and require its own planted-failure case to fail. Check static import, export-from and literal
  dynamic import paths; type-only imports are not runtime reachability.
- [ ] **7. Build both real browser apps:** `pnpm --filter @waitron/setup build` and `pnpm --filter @waitron/till build`, then `node scripts/check-demo-browser-bundles.mjs apps/setup/dist
  apps/till/dist`. The new checker examines JS chunks recursively and fails missing/empty output, missing `Waitron Demo S.L.` **in either app**, or presence of `Croquetes de pernil` in either app. Its
  unit controls cover all three failures and a valid two-app output. In a disposable candidate, expose a consumed dish through main and show the real build/check fails; remove the identity marker and
  show the opposite check fails; restore and rebuild/check both.
- [ ] Run `pnpm --filter @waitron/server build` to check secondary exports in the Node bundle. If `docker info` succeeds, build with `docker build -f deploy/Dockerfile -t waitron:a972-cut1 .`, then
  inspect the copied folder and run an installed-media seed smoke in a throwaway venue. If unavailable, record the exact command/error and explicitly leave image build/runtime unqualified; source-root
  tests and Dockerfile text assertions do not qualify an image. Required image CI must still finish on this head.
- [ ] **8. Finish the cut:** Keep `apps/server/test-durations.json` aligned with moved/retained/new server test paths; regenerate measured values from actual server CI logs with `node
  scripts/test-durations.mjs apps/server/test-durations.json <saved-server-log>`, not invented measurements. Run focused `scripts/vitest-duration-sequencer.test.mjs` if the table changes. Update
  current path claims and backlog residuals. Review changed checks, stage explicit paths, `git commit -s -m "refactor: move Spanish demo data into its country pack"`, then the common finish protocol
  below.

## Cut 2: Plain names in English and Spanish

**Consumes:** cut 1's pack-owned data, strict adapter and unchanged fiscal seat.
**Produces (new):** `DemoPlainText<L> = Readonly<Record<"en" | "es", string> & Partial<Record<L, string>>>`; server `demoPlainText(text: DemoPlainText<string>, set: DemoDataSet, locale:
StaffLanguage): string`. In this cut it selects only EN/ES; cut 3 adds the optional dataset override.

- [ ] **1. RED:** Add `seed-names.test.ts`, seeding Madrid independently in EN and ES. Assert concrete written values across products/variants, units and abbreviations, categories/sections, menus,
  option lists/labels, extras, stations, printer, special day, periods, floor sets/zones, departments and reason names. Pin English lunch staff **Set lunch**, customer **Lunch menu**; Spanish lunch
  **Menú del Día**, customer **Menú del mediodía**. Pin English mixed-salad kitchen **SALAD · LUNCH**, Spanish **ENSALADA · MENÚ**; coffee kitchen **COFFEE · DOWNSTAIRS BAR** / **CAFÉ · BAR DE
  ABAJO**; unit **Portion** / **Ración**, abbreviation **ptn** / **rac**. Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-names.test.ts`; observe the incorrect
  English/Spanish names.
- [ ] **2. Implement:** Convert every authored plain-name field to `DemoPlainText`, including currently omitted product/variant kitchen names; supply distinct staff/customer/kitchen wording, not just
  different casing. Keep proper dish/person/restaurant names where appropriate. Translate category overrides, stations, printer, special day and new/existing menu periods (including renaming the
  reused period), rather than leaving English writer literals. Resolve via `demoPlainText`; preserve identifiers, roles, permissions, prices, customer maps and all sale writers. Make category/station
  routing use the same selected values or ids on both write and lookup paths.
- [ ] **3. GREEN:** Run the new names suite, then `seed-catalogue.test.ts`, `seed-floor.test.ts`, `seed-option-lists.test.ts`, `seed-adjustments.test.ts`, `seed.integration.test.ts`, `seed.test.ts`
  and country-es `src/demo/data.test.ts` with the explicit commands from cut 1, grouped by package. Add assertions enumerating every product/variant/list/label so an omitted field cannot hide behind a
  fallback. Check three distinct resolved names per EN/ES case. Keep live module `starter-content.ts` files untouched.
- [ ] The frozen cut-1 snapshot is historical: keep its JSON/manifest untouched. Extend the comparator with an explicit row/field old→new **name-only** expectation map for this authorized cut, failing
  unused entries and every unlisted difference; never regenerate its expected data from candidate imports. Preserve all non-name and relationship assertions. Include each changed pre-existing
  nonfiscal check in the inventory; do not change any fiscal assertion or golden.
- [ ] **4. Control:** Remove one English name, substitute Spanish into one English plain field, and remove one lookup translation in a disposable candidate; each relevant named test must fail. Restore
  and rerun the focused cases. Build/check both browser bundles again because data contracts/exports changed. Update EN/ES demo guide examples and remaining backlog entries.
- [ ] **5. Commit:** `git commit -s -m "fix: seed demo plain names in English and Spanish"`; run the common finish protocol with low-risk review.

## Cut 3: Catalonia, shared Balearic demo and geography-aware setup

**Interfaces (new):**

- `AdministrativeArea.demo?: { readonly dataSet: string; readonly locationName: string }`; `resolveCountryDemoIdentity(pack: CountryPack, areaValue?: string | null): CountryDemoIdentity | undefined`
  resolves with existing `findAdministrativeArea` (code/name/alias), overlays only id/name, and preserves company, tax id and department trading names. Main country-packs exports
  `resolveInstalledDemoIdentity(input: VenueGeography): CountryDemoIdentity | undefined` as a lightweight wrapper.
- Server `readDemoSeedSelection(db: Database, locationId: string): Promise<{ identity: CountryDemoIdentity; dataSet: DemoDataSet }>` reads stored singleton tenant country and location province. Both
  installed and developer seeding use it. `demoLanguagesFor` compares the geographically resolved id, not only `pack.demo.dataSet`. Missing pack-owned data uses the existing English fallback; unknown
  explicitly named ids still refuse.
- Dataset `plainNameLanguage?: L` supplies a **demo-only** override; `demoPlainText` chooses it before staff locale and throws if required override text is missing. Add `ca` for all base and regional
  plain fields (products, variants, lists/labels, units, menus/sections/categories, floor/department/station and ancillary names). Staff app locale remains EN/ES. Ordinary starter content keeps its
  present ownership policy.
- Setup `ProvisionBody.demoLocationNameSource?: "automatic" | "custom"` is a new demo-only top-level request/draft field; never persist it in a venue table. Include the source in `VenueForm`,
  snapshot, equality and restore. The existing shell draft/patch/root-snapshot mechanism carries it across Review/Back. Remove it when leaving Demo; `assembleBody` includes it only for Demo.
- Any real name-field edit sets source to `custom`, even if the new value equals a past/current default or is empty. Automatic programmatic fills do not claim custom ownership. A restored nonempty
  draft without a marker is conservatively custom; a fresh empty draft starts automatic. Never infer ownership from membership in a list of default strings.
- On valid postcode-derived or explicit province changes, resolve the lightweight identity; update name only while automatic. Invalid/incomplete geography leaves the last name and ownership intact,
  and existing form validation blocks submission. Discard restores both value and source; Keep preserves both. A same-text edit still changes ownership and must survive draft handling.
- `parseProvisionPayload` validates the new enum (bad type/null/value → `setup.request_invalid` naming `demoLocationNameSource`; reject it outside Demo), derives identity again from validated
  geography, and replaces `location.name` only for explicit `automatic`. Absent marker is custom for a nonempty supplied name. Custom typed names, including **Casa Delgado** in Barcelona, survive. Do
  not trust a browser-supplied dataset id, add one to the wire, or weaken country/province/fiscal validation.
- Server `resolveDeveloperDemo(value: string | undefined): CountryDemoDeveloperPreset` (new, in `dev-setup.ts`) reads the secondary preset registry. `WAITRON_DEMO_REGION` accepts
  unset/empty/whitespace as default Madrid; trim valid selectors; reject any unknown nonempty value **before filesystem/database work**. Resolve once and pass the preset through provision, selection
  and device/env setup. Reusing an existing venue keeps its stored geography; changing this setting never reprovisions it automatically.

| Developer selector | Stored geography / name | Receipt default for a new dev venue |
| --- | --- | --- |
| default or `madrid` | ES, 28013, Madrid/Madrid, Europe/Madrid, Casa Delgado | Preserve existing `SEED_INVOICE_LOCALE[seedLocale]` |
| `catalonia` | ES, 08001, Barcelona/Barcelona, Europe/Madrid, Can Delgado | ca-ES |
| `balearic` | ES, 07001, Palma/Balears, Illes, Europe/Madrid, Can Delgado | es-ES, current pack default |

All presets retain the existing address `1 Main Street`, null address line 2, `05:00` cutover, common fiscal territory, series settings, admin credentials, and unchanged legal company/tax identity.
Store province names from pack lookup, not guessed labels. Region receipt defaults come from existing `receiptLanguageRules`; device configuration and generated `WAITRON_TILL_LOCALE` must agree with
the actual stored receipt choice. Do not change staff-screen language or introduce new receipt choices.

- [ ] **1. RED selection:** Add country/country-packs cases for `08,17,25,43,07` and names/aliases, Madrid/unset/unknown area fallback and inherited ids (`constructor`, `__proto__`). All
  Catalan/Balearic choices resolve `casa-delgado-ca` / **Can Delgado**, with `Waitron Demo S.L.` / `B00000000` unchanged. Add stored-geography installed-seed cases and synthetic no-dataset country
  fallback; do not enable GB setup. Run country `src/country.test.ts`, country-es `src/spain.test.ts`, country-packs `src/registry.test.ts` and server `src/demo-seed.test.ts`; observe regional
  selection failures.
- [ ] **2. RED setup:** Add `venue-screen.demo-region.test.ts`: Madrid→Barcelona→Madrid automatic changes; direct province and postcode paths; invalid postcode; custom name before/after region change;
  edit back to **Casa Delgado** then change region; empty custom name remains invalid. Assert actual native input value. Extend `setup-app-venue.unsaved-changes.test.ts` for Review/Back, Keep/Discard,
  reconnect and root restoration of value **and ownership**, including same-text edits. Extend server `setup-api.country-pack.test.ts` for automatic normalization, custom preservation and bad markers;
  retain existing unsupported territory/postcode/timezone refusals. Run these files before implementation and record expected failures.
- [ ] **3. Implement geography/name ownership** using the interfaces above. Keep setup's Next as a wizard action under the existing Forms exception; no new Save gate or native form fields. Preserve
  field/bottom errors and receipt-default ownership. Update review display to use the actual drafted name. Pin browser submission and server persisted result in the same test matrix.
- [ ] **4. RED regional data, then implement:** Write the `seed.regional.test.ts` and pack `regional.test.ts` cases described in step 5 first; run both and observe the missing regional rows/maps.
  Then build `casa-delgado-ca` from the base plus one regional kitchen section **Especialitats de la casa**, one extra wine in the actual Wine and beer bar section, and five
  staff. Reuse base floor/options/extras/reasons, with Catalan demo plain-name maps. Set this dataset's `contentLanguages` to `ca,es,en`; supply all three on every new customer field and retain the
  inherited base records/maps. The base dataset keeps all its languages. Allocate a unique category color distinct from every inherited category. Keep composition declarative through named
  sections/array spreads; no server imports or pack-side writer/placement functions.

| Regional product (staff text) | New PNG basename | Gross / VAT |
| --- | --- | --- |
| Escalivada | catalonia-escalivada.png | 8.50 / reduced |
| Esqueixada de bacallà | catalonia-esqueixada.png | 11.50 / reduced |
| Botifarra amb mongetes | catalonia-botifarra.png | 13.50 / reduced |
| Fideuà | catalonia-fideua.png | 15.50 / reduced |
| Mel i mató | catalonia-mel-mato.png | 5.50 / reduced |
| Canelons de rostit | catalonia-canelons.png | 12.50 / reduced |
| Suquet de peix | catalonia-suquet.png | 17.50 / reduced |
| Copa de cava | catalonia-cava.png | 4.50 / general |

Keep all products available, `pricingUnit: each`, no variants or modifiers on these additions; do not invent dietary/allergen promises. Staff: Jordi Puig (manager/dashboard login), Montse Vila
(supervisor), Núria Soler, Pau Ferrer, Laia Roca (staff). Use distinct `manager`, `montse`, `nuria`, `pau`, `laia` addresses at `demo.waitron.local`, never the admin address; same PIN/password policy
as base.

- [ ] Resolve the exact example without collapsing three names: staff **Botifarra amb mongetes**; kitchen **Botifarra amb mongetes · cuina**; customer Catalan **Botifarra amb mongetes de la casa**, ES
  **Butifarra con judías de la casa**, EN **House Catalan sausage with white beans**. Both till and kitchen contain the owner's exact phrase; all three stored names have different wording. Apply
  distinct regional staff/kitchen wording to inherited products, variants and lists/labels around their unchanged customer maps. Author customer wording only for the new regional additions;
  uppercase-only differences do not count. Assert inherited customer maps byte-for-byte against the pack-owned baseline, separately from the expected staff/kitchen changes. A deliberate inherited
  customer-wording change is outside this cut and needs the explicit owner landing hold.
- [ ] **5. GREEN regional DB proof:** In new `seed.regional.test.ts`, provision Barcelona and Balearic venues with Spanish and English staff setup. Assert stored Catalan plain names, all expected
  customer keys, roles/password capabilities, base-product retention, one extra regional section, the wine under Drinks and accessible restaurant/lunch includes, menu prices, no translation gaps and
  every image resolving. Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.regional.test.ts scripts/demo-seed/seed-media.test.ts` before adding data in step 4 (RED), then after
  (GREEN). Run `pnpm --filter @waitron/country-es exec vitest run src/demo/regional.test.ts` for full maps, unique basenames/colors and distinct names.
- [ ] Use an explicit regional-only product pool in an added `seedSales` integration case so a regional dish **must** be recorded through the unchanged fiscal seat; assert its final stored
  name/descriptions and receipt tag. Separately spy around the real seed-sales call from `seedDemoRestaurant` to assert its pool contains **every** available product, including regional dishes and
  wine, then query final rows for a pinned-clock full seed. Never rely only on a random sample containing a regional product, and never rewrite stored snapshots after sale. Keep original
  golden/chronology tests unedited.
- [ ] **6. RED/GREEN developer path:** Extend `dev-setup.test.ts` with unset/empty/whitespace/unknown selector cases, all three supported presets, Spanish/English staff locale, generated env/device
  receipt config, stored geography and reuse behavior. Run `pnpm --filter @waitron/server exec vitest run scripts/dev-setup.test.ts src/demo-seed.test.ts src/setup-api.country-pack.test.ts
  scripts/demo-seed/data-set.test.ts`; implement the preset propagation and require GREEN. Add invalid-input test asserting no directory/database was touched.
- [ ] **7. Controls and browser checks:** Delete source ownership restoration, the stored-province selection, one regional override, and wine placement in separate disposable-candidate experiments;
  each owning test must fail. Restore and rerun. Run `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.demo-region.test.ts src/screens/venue-screen.test.ts
  src/screens/venue-screen.a11y.test.ts src/screens/review-screen.test.ts src/screens/review-screen.a11y.test.ts src/setup-app-venue.unsaved-changes.test.ts src/setup-app.test.ts`. Restore global
  language and avoid faking animation timers.
- [ ] Generate complete `demo-media/casa-delgado-ca/` from inherited plus new basenames; set `mediaDataSet` to that id. Run the common bundle checker and source/installed-root media tests. When
  runtime is available, use `WAITRON_DEMO_REGION=catalonia wa-wt demo <own-worktree-name>` for a new isolated venue; reset only an owned throwaway target. Look at setup, till, kitchen and dashboard in
  EN/ES, light/dark, desktop/390px. Record screenshots under allowed `__screenshots__/` paths. If unavailable, record exact failure and leave those observations unqualified.
- [ ] **8. Commit:** Update EN/ES guides with demo name-following and mixed regional-data/EN-ES-screen behavior, plus developer setting/reuse/defaults and current backlog residuals. Run the focused
  guide/link checks in the inventory. `git commit -s -m "feat: add Catalan and shared Balearic practice restaurants"`; use the common finish protocol with one Claude review.

## Cut 4: Valencia

**Consumes:** cut 3 selection, ownership, override resolver, media and dev contracts.
**Produces:** new `CASA_DELGADO_VALENCIA`, id/media folder `casa-delgado-valencia`, location **Casa Delgado de l'Horta**, `plainNameLanguage: ca-ES-valencia`, `contentLanguages: ca-ES-valencia,es,en`,
preset selector `valencia` (46001, València city, canonical province Valencia/València via `46`, Europe/Madrid, receipt es-ES). Same company/tax id and base floor. Add only province `03,12,46`
overrides.

- [ ] **1. RED:** Extend country-es `spain.test.ts`/`src/demo/regional.test.ts`, country-packs `registry.test.ts`/`starter-languages.test.ts`, server
  `seed.regional.test.ts`/`src/demo-seed.test.ts`/`scripts/dev-setup.test.ts`, and setup `venue-screen.demo-region.test.ts` with Valencia cases. Run the same explicit focused commands from cut 3 with
  these file paths, adding `pnpm --filter @waitron/country-packs exec vitest run src/starter-languages.test.ts`. Require absent selection/data failures first.
- [ ] **2. Implement:** Add one **Especialitats de l'Horta** section plus **Copa de vi de Requena** to Wine and beer. Products/basenames/prices: All i pebre / `valencia-all-pebre.png` / 14.50;
  Esgarraet / `valencia-esgarraet.png` / 8.50; Paella valenciana / `valencia-paella.png` / 16.50; Orxata amb fartons / `valencia-orxata.png` / 5.50; Arròs al forn / `valencia-arros-forn.png` / 13.50;
  Titaina / `valencia-titaina.png` / 9.50; Arnadí / `valencia-arnadi.png` / 5.50; wine / `valencia-wine.png` / 4.00. Food reduced, wine general; same availability/unit/no-new-modifier policy as cut 3.
- [ ] Add complete `ca-ES-valencia` staff/kitchen plain-name maps for inherited/new fields. Preserve inherited customer maps exactly; supply variant/ES/EN customer maps and distinct kitchen/customer
  wording only for new products. Staff: Vicent Ferrer (manager/dashboard), Amparo Soler
  (supervisor), Neus Martí, Pau Sanchis, Clara Peris (staff); emails `manager,amparo,neus,pau,clara` at the demo domain. Build its complete dataset media folder; no Catalan dataset mutation.
- [ ] **3. GREEN:** Explicitly assert starting-content keys/default **ca-ES-valencia**, separate from area UI preference **ca-ES**, staff app EN/ES and receipt **es-ES**. Assert selected plain text
  uses Valencian entries even with Spanish setup. Include a synthetic fixture where `ca` and `ca-ES-valencia` values differ; the stored row must select the latter. Do not add/change a locale switch,
  invoice-locale choice, shared resolver or receipt writer.
- [ ] Assert wine access, exact regional-only sale snapshots through the unchanged seat, complete full-seed pool, custom/automatic name round trips and media parity as in cut 3. Remove the Valencia
  override or point it to `ca` in a disposable copy; require the corresponding test failure, restore and require pass. Run country/server/setup typechecks, focused suites, both bundle builds/checker
  and available visual/image checks. Update guides/backlog residuals and signed commit `feat: add the Valencian practice restaurant`; common low-risk finish protocol.

## Cut 5: Galicia

**Consumes:** cut 3 contracts plus cut 4's intact Valencia behavior.
**Produces:** new `CASA_DELGADO_GL`, id/media folder `casa-delgado-gl`, location **A Casa Delgado**, `plainNameLanguage: gl`, `contentLanguages: gl,es,en`, selector `galicia` (15001, A Coruña city,
canonical province Coruña, A via `15`, Europe/Madrid, receipt es-ES). Add only province `15,27,32,36` overrides; company/tax id unchanged.

- [ ] **1. RED:** Add Galicia rows to the exact regional/selection/dev/setup tests named in cut 4. Run those focused files first; record absent Galicia id/name/data failures.
- [ ] **2. Implement:** One **Especialidades da casa** section and **Copa de Albariño** in Wine and beer. Products/basenames/prices: Empanada galega / `galicia-empanada.png` / 8.50; Caldo galego /
  `galicia-caldo.png` / 6.50; Lacón con grelos / `galicia-lacon.png` / 14.50; Filloas / `galicia-filloas.png` / 5.50; Xoubas fritidas / `galicia-xoubas.png` / 9.50; Mexillóns ao vapor /
  `galicia-mexillons.png` / 10.50; Bica / `galicia-bica.png` / 5.50; wine / `galicia-albarino.png` / 4.50. Same VAT/unit/availability rules as cut 4, unique section color and basenames.
- [ ] Add `gl` staff/kitchen plain-name maps for all inherited/new fields. Preserve inherited customer maps exactly; supply GL/ES/EN customer maps and distinct kitchen/customer wording only for new products. Staff: Xoán Varela (manager/dashboard), Uxía Castro (supervisor), Brais López,
  Iria Fernández, Antón Souto (staff); emails `manager,uxia,brais,iria,anton` at the demo domain. Generate the complete Galicia media folder; retain other datasets unchanged.
- [ ] **3. GREEN/control:** Assert GL staff/kitchen in both EN/ES apps, `gl,es,en` customer content, existing es-ES receipt default and final snapshots, wine in Drinks, full seed pool and forced
  regional-only sale, source/installed images, custom/automatic ownership and all previous regional/fallback rows. Delete the Galicia province override in a disposable copy and require a
  Galicia-specific failure; restore and pass. Run the cut-4 focused commands, typechecks, both browser builds/checker and available visual/image checks.
- [ ] Update EN/ES guides and developer preset documentation. Remove the completed A972 backlog entry only when all five cuts are delivered; keep deliberate choices (regional override, shared islands,
  no other countries) under `docs/backlog/architecture.md` → Decisions and deliberate limits. Preserve unrelated audit items. `git commit -s -m "feat: add the Galician practice restaurant"`; common
  low-risk finish protocol.

## Changed test checks inventory and common finish protocol

Before every commit/PR, record each changed existing assertion as `file / case / old expectation / new expectation / owner requirement / retained behavioral assertion`. New cases get a short
deletion/control receipt. No new approval gate for the authorized nonfiscal naming and selection changes; a fiscal assertion change remains a stop.

Name the five new Review Focus cases `rejects transitive main demo imports and accepts secondary use`, `preserves every Madrid seed row`, `restores custom name ownership after Review and Discard`,
`keeps Valencian content distinct from receipt and screen languages`, and `offers and records regional dishes and wine with both media roots`. Put each in its owning test file above; controls must
identify which assertion failed. These are proposed cases, not existing tests.

The selection/type commands reused by cuts 3–5 are:

```bash
pnpm --filter @waitron/country exec vitest run src/country.test.ts
pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts src/demo/data.test.ts src/demo/regional.test.ts
pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts src/demo.test.ts src/starter-languages.test.ts
pnpm --filter @waitron/country typecheck
pnpm --filter @waitron/country-es typecheck
pnpm --filter @waitron/country-packs typecheck
pnpm --filter @waitron/server typecheck
pnpm --filter @waitron/setup typecheck
```

| Check family | Intended change / retained checks |
| --- | --- |
| server `data-set.test.ts` | Move data completeness/reference checks to pack-owned tests; retain server strictness, language fallback, synthetic country support, unknown/inherited ids and setup eligibility. Do not replace tests with object identity checks alone. |
| catalogue/floor/options/staff/media/integration tests | Cut 1 imports/paths/raw-floor adapter only; retain row/value/routing/role/secret assertions. Cut 2 updates specifically authorized plain-name values while retaining modifier order, prices, routing, default flags, variants and language coverage. Cuts 3–5 add regional cases rather than weakening base cases. |
| `seed.madrid-baseline.test.ts` | Original JSON/manifest remain immutable. Cut 1 exact semantic equality; cut 2 explicit name-only deltas; regional cuts retain base comparison and add separate regional expectations. Unclassified tables/columns, missing relationships and unused exceptions fail. |
| setup/server/dev cases | Add geography and explicit name-source cases; retain custom text, unsupported areas, postcode match, canonical province/timezone, receipt choices, reuse and production refusal checks. Every whole-body shape gains only the new authorized field. |
| root boundaries/deploy/duration | New transitive runtime-import and two-app bundle checks with accepting/rejecting controls; update Docker media path expectation and secondary-registry rule narrowly. Remove a moved server duration entry only if no server test remains at that path. |
| protected fiscal checks | No edits to `seed-sales.golden.test.ts`, `testing/spanish-practice-sales.golden.json`, fiscal `src/write-path.e2e.test.ts`, `src/inmutabilidad.test.ts`, allocation or existing fiscal assertions. Do not set `WAITRON_WRITE_GOLDEN`. |

- [ ] Run root focused guards with `pnpm exec vitest run scripts/demo-boundaries.test.ts scripts/check-demo-browser-bundles.test.mjs scripts/workspace-cycles.test.ts scripts/module-seams.test.ts
  scripts/deploy-image-env.test.ts`; add `scripts/vitest-duration-sequencer.test.mjs` when its table changes. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and root
  `scripts/guide-links.test.ts` for guide changes. Do not claim text guards prove runtime behavior.
- [ ] For each cut touching the seed/fiscal boundary run **unedited** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts
  scripts/demo-seed/seed-sales.chronology.test.ts scripts/demo-seed/seed-sales.dated.test.ts`, and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
  src/inmutabilidad.test.ts`. Investigate a failure; never re-record or weaken it. CI supplies remaining package tests/coverage.
- [ ] For browser work measure headroom first (`memory_pressure | rg free`); avoid another coverage run in the same package. Use real Chromium, `useVenueDb` for database suites, pinned Date only with
  real watchdog timers, awaited native events and restored global locale. Keep focused logs and screenshot evidence; a skip or no test count is not a pass.
- [ ] Search the whole changed path set and current docs for old seed paths/naming claims: `rg -n 'demo-seed/(menu|staff|media|data-sets)|WAITRON_DEMO_MEDIA_SOURCE|Casa Delgado|Set lunch' apps
  packages scripts deploy docs README.md eslint.config.js`. Review historical matches as historical, current consumers as actionable. Inspect `git diff --check`, staged paths and the complete
  base-to-tip diff. Run package typechecks named above and the focused behavior/control checks for that cut.
- [ ] Announce readiness for `finish-branch`, or continue it if already requested by the parent. Use its one-review policy for cuts 1/3 and low-risk policy for 2/4/5. Let the normal push hook run; do
  not duplicate its workspace checks locally just to finish.
- [ ] Verify CI's `changes` outputs select all affected packages and real test/coverage or coverage-merge jobs completed on the current head, with required licence/image jobs and resolved findings.
  Read every required job, not just the summary. If image/dev runtime was unavailable locally, name exactly what remains unqualified and use the current-head CI evidence for what it actually ran.
- [ ] Respect the parent driver's current landing/lock/owner-hold rules; do not land from the plan-author seat. After authorized landing, refresh dependencies and verify the merge's own main CI, then
  start the next cut only after fresh reservations. Preserve both sides when an overlapping held branch later lands.
