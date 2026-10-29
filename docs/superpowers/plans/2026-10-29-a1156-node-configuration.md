# A1156 Node Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, inline with the
> driver. Steps use checkbox (`- [ ]`) syntax. This publication is a documentation-only plan
> milestone; it does not start implementation.

**Goal:** Separate the box's node identity from genuine till settings, and name the server's
assembled trading context and invoicing backend accurately without changing trading behaviour.

**Architecture:** Load node identity and till preferences independently, then resolve location from
the database at the existing boot boundary. Keep the runtime context flat, with explicitly named
constituent interfaces, to preserve spreads and avoid rewriting every field access. Replace the old
runtime type in one closed, mechanical PR; split boot behaviour and dependency names into
neighbouring PRs.

**Tech Stack:** TypeScript, Node.js, Drizzle/SQLite, Hono, Vitest, pnpm workspace.

**Spec:** [A1156 in the committed backlog](../../backlog.md), plus the owner constraints recorded
below. Local supporting inputs: `/Users/clintongormley/waitron-campaign-e/queue.md` A1154–A1156 and
its 2026-10-05 changed-check decision; `receipts/a1154-register-till-investigation.md` §5 Class B,
historical only. Those local files are not required to recover the scope from this committed plan.

## Global Constraints

- Owner scope, 2026-10-29: PLAN first, docs-only publication first. Build only A1156; no recovery,
  UI, registration, chain, hash, series or unrelated fixes. A1154 landed `82f0d4789`; A1155 landed
  `b1b0f10952a59eb59f7358bd681a3cdc94d9b61c`.
- Identity input is **only `WAITRON_NODE_ID`**; location comes from `nodes.location_id`.
  `WAITRON_TILL_LOCALE` and `WAITRON_TILL_TIPS` remain till settings. No retired-setting aliases,
  compatibility wrappers, migrations or reset requirement.
- Rename `tillBackend` to `nodeBackend`; rename `server.till_config_missing`/`invalid` to
  `server.node_config_missing`/`invalid`. Error parameters remain exactly `{ key }`, never the
  rejected value or an error cause containing it.
- Preserve every existing behavioural assertion. Whole-object assertions stay whole-object
  assertions. The owner's 2026-10-05 rule permits equally strict changes to checks deliberately
  changed by this scope; record each in the PR's **Changed test checks** section with file:line,
  before/after and this plan's authority. Driver supplies the campaign FYI. Type-only imports and
  annotations may follow the renamed interfaces without changing test bodies, inputs or assertions;
  the exact H2 files and fiscal invariants below stay unchanged.
- Do not change fiscal registrations or writers, chain/hash/series logic, immutable migrations,
  protected golden huella or `inmutabilidad` tests. If the final split requires a protected edit,
  park the build for the owner, not an alias or a weaker assertion.
- Keep cash-register names: `apps/till`, `TillApiDeps`, `TillSaleResult`, `OrderFlow`, till
  profiles, devices, printers, routes and environment names for the actual app. Do not rename these
  by a blanket `till` substitution.
- Trace every consumer, alias, spread, fixture and gate before editing. Searches provide a path
  inventory, not runtime verification. Preserve request provenance, request-local sinks and recorded
  receipt facts separately from current receipt presentation.
- Each PR must compile and retain behaviour by itself. Aim below one implementer's roughly 100 tool
  calls per PR; batch mechanical changes and focused checks. No compatibility alias is justified by
  that budget.
- Future execution reads the TDD skill before code or tests, observes each new split test fail for
  the expected reason, then implements and observes it pass. Use `useVenueDb`, controlled clocks and
  one `freePorts(n)` allocation where applicable; never write to a child server's live database.
- CI owns broad package coverage. Run focused checks locally, the normal push hook once, and require
  current-head CI coverage/merge jobs. One Claude run-it whole-branch review per meaningful code
  branch during `finish-branch`; inspect its findings. Owner alone lands any fiscal-registration
  change. This docs-only plan needs no external run-it review.

## Build boundary

Build may proceed after this docs-only publication and reservation checks. Mechanical import paths
and type annotations may move to the new interfaces while preserving test inputs, bodies and
assertions. Keep `write-path.e2e.test.ts`, `inmutabilidad.test.ts`, golden data and fiscal
executable logic unchanged. Park a proposed invariant change or a controversial behavioural check
for the owner.

READ: `apps/server/src/served-at-huella.test.ts:37` imports `TillConfig`; `:138` annotates its
fixture. The same type dependency appears in the server's filing suites, and
`till-config.filing.test.ts:8` imports the reader that moves. These imports and annotations belong
in the migration inventory; they are not changed behavioural checks. `apps/server/tsconfig.json:7`
includes tests in typechecking.

READ: `packages/fiscal-verifactu/src/registro-sif.ts:72` contains an obsolete `config.till.nodeId`
parenthetical. Deleting that parenthetical is commentary cleanup, not a change to registration
logic. Keep its executable statements unchanged and isolate the cleanup if necessary; it does not
block the implementation slices. If a slice touches fiscal registration code, the owner lands it
under A1156's explicit landing rule. No additional build approval is required for the naming/type
split.

## Review Focus

1. Settings without a node must still enter setup; empty or malformed node input must not borrow an
   old identity. PR1 loader/config and boot cases.
2. Missing location after pending adoption must refuse ordinary trading, while pending adoption must
   answer without a node row. PR1 paired boot controls.
3. Default `es-ES` differs from raw override `undefined`; explicit `es-ES`, empty, Catalan and
   unsupported raw locales must keep their distinct derivation paths. PR1 settings/venue-locale
   cases.
4. A mirror's own node and its data node must remain distinct through reads, writes and invoice
   actions. PR1 and PR3 mirror cases, including the existing primary control.
5. Two devices on one node must retain separate origins and request sinks; live receipt trim must
   not replace saved issuer, names, language or totals. PR2 request controls and PR3 receipt suites.

## Source map (READ, not execution evidence)

Read against `4654c4e9837c4df0692c7e01ebf29c4ae44d24e7`; reorient against the build's base before
relying on line numbers.

| Boundary              | Source and implication for the plan                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixed shape           | `apps/server/src/till-config.ts:14` includes identity, preferences, fiscal values and request effects; `:60` derives environment identity with `Omit`, so it also carries unrelated optional fields. Replace with explicit interfaces.                                                                                 |
| Parsing               | `till-config.ts:80` defaults locale to `es-ES`, derives `invoiceLocales: [locale]`, preserves raw override except unset/empty, enables tips only for `true`/`1`; `:96` gates solely on node presence.                                                                                                                  |
| Location / filing     | `till-config.ts:100` joins nodes to locations; `:116` reads the stamped filing module transactionally. `restore.ts:735` uses the same location reader with artifact identity. Move these readers without changing queries.                                                                                             |
| Boot gates            | `boot.ts:991`, `:1044`, `:1118`, `:1130` use identity presence for migrations, reconciliation, discovery and setup. `first-fiscal-mode.ts:26` checks node and DB location; `:34` clears identity during incomplete publication.                                                                                        |
| Adoption / mirror     | `boot.ts:1513` returns from pending adoption before `:1555` location resolution. `:1698` separates own identity from `dataNodeId`; `:2165`, `:2170`, `:2182` supply that data id to reports/orders/customer reads.                                                                                                     |
| Runtime assembly      | `boot.ts:1766` resolves filing module and fiscal slot; `:1770` builds backend; `:1774` adds limit, operation-description requirements/default and practice mode. `:1784` passes raw override to `readVenueLocale`.                                                                                                     |
| Request lineage       | `request-config.ts:6` spreads configuration then sets device origin; `made-here.ts:37` spreads it and attaches sending device/same request sink. `testing/session-device.ts:68` returns `C & { origin: DeviceOrigin }`.                                                                                                |
| Request effects       | `working-order.ts:1884` reads sending device, `:1917` fills sink; `till-sale.ts:1931` stores it; `made-here.ts:199` replays it. Cancellation, adjustment, draft, group and move paths also pass it onward.                                                                                                             |
| Preferences / fiscal  | `till-setup.ts:119` exposes tips and `:126` exposes backend limit; `till-sale.ts:1447` clamps tips off; `bill-payments.ts:1098` supplies tips to allocation. `sale-operation-description.ts:16` distinguishes false from absent; `:44` uses offered default. `packages/fiscal-none/src/backend.ts:29` sets limit null. |
| Locale sources        | `working-order.ts:760` reads DB invoice languages; `venue-locale.ts:151` selects sale language; `testing/invoice-customer-fixture.ts:128` and `testing/order-venue.ts:256` read config `invoiceLocales`. Keep that field; do not infer deletion from its comment.                                                      |
| Saved / live receipts | `invoice-document.ts:39` loads sale/node location, `:49` overrides context location, `:86` prefers filed issuer, `:101` reads current trim language, `:130` uses saved sale language/names. `receipt-print.ts:196` reads live trim; `:220` prefers ticket issuer.                                                      |
| Persisted contract    | `trading-config.ts:34` writes `WAITRON_NODE_ID`; `restore.ts:94` names only that identity key; `:717` reads artifact identity. Preserve bytes/keys and artifact-versus-target selection.                                                                                                                               |

Paths without a prefix in this table are under `apps/server/src/`. Consult `CLAUDE.md`,
`docs/developers/{conventions-data,testing-guide,writing-claims,workflow-guide}.md`, especially
error renames, pre-live compatibility, distinct identities, guard controls and changed prose.

## Files and final interfaces

Preserve existing field mutability and optionality in the new interfaces. No nested-field conversion
is intended. Task filenames below are relative to `apps/server/src/` unless explicitly rooted at
`apps/`, `packages/`, `scripts/` or `docs/`.

| File                                                                       | Final responsibility and exact interface                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create `apps/server/src/node-config.ts`                                    | `NodeIdentityConfig { nodeId: NodeId }`; `NodeConfig extends NodeIdentityConfig { locationId: LocationId }`; `loadNodeIdentity(env: NodeJS.ProcessEnv): NodeIdentityConfig`; `tryLoadNodeIdentity(env: NodeJS.ProcessEnv): NodeIdentityConfig \| undefined`. Move `readNodeLocation(db: Database \| Transaction, id: NodeId): Promise<LocationId \| null>` and `readFilingModule(db: Database, cfg: NodeIdentityConfig): Promise<string \| null>` here. |
| Modify `apps/server/src/till-config.ts`                                    | Only genuine app configuration: `TillAppSettings { locale: string; invoiceLocales: string[]; localeOverride?: string; tipsEnabled: boolean }`; `loadTillAppSettings(env: NodeJS.ProcessEnv): TillAppSettings`. Keep `OrderFlow = "prepay" \| "ticket_then_pay"` here. `invoiceLocales` remains the existing derived preference field, never a substitute for DB/sale languages.                                                                         |
| Create `apps/server/src/trading-context.ts`                                | `FiscalRuntimeContext { simplifiedInvoiceLimit: Decimal \| null; operationDescriptionRequired?: boolean; operationDescriptionDefault?: string }`; `RequestEffects { sendingDeviceId?: string; madeHereSink?: Set<string> }`; `TradingContext extends NodeConfig, TillAppSettings, FiscalRuntimeContext, RequestEffects { practiceMode?: boolean }`.                                                                                                     |
| Same context file                                                          | Move `OriginConfig extends TradingContext { origin: Origin }` and `DeviceRequestConfig extends TradingContext { origin: DeviceOrigin }`. These names already describe provenance; retain them. Request effects belong to requests, not identity; their optional flat position preserves existing background call signatures. `practiceMode` is a runtime flag from onboarding, not identity or a fiscal input.                                          |
| Modify `config.ts`, `boot.ts`, `first-fiscal-mode.ts`, `rejoin-command.ts` | `ServerConfig.node?: NodeIdentityConfig` and required `tillApp: TillAppSettings`. Boot resolves `const node: NodeConfig`, composes `const tradingContext: TradingContext`, and builds `const nodeBackend: FiscalBackend`. No location on environment identity.                                                                                                                                                                                          |
| Modify `request-config.ts`, `made-here.ts`                                 | `requestCfg(cfg: TradingContext, device: { deviceId: string }): DeviceRequestConfig`; `sendingCfg<C extends TradingContext>(cfg: C, c: Context, device: { deviceId: string }): C`; replay takes `Pick<RequestEffects, "madeHereSink">`. Preserve spread order, origin, and sink identity.                                                                                                                                                               |
| Modify invoice/order dependency files                                      | `OrdersApiDeps.tradingContext: TradingContext`, while `cfg: { nodeId: string }` remains the separate data-read scope. Replace `till` with `tradingContext` in `orders-reprint.ts`, `orders-invoice-pdf.ts`, `invoice-customer-data.ts`, `invoice-customer-data-api.ts` dependency shapes and all callers. Other `cfg`/`venueCfg` properties retain names.                                                                                               |
| Consumers and fixtures                                                     | Exact path set comes from the inventory below, including server `scripts/`, `src/testing/`, mixed imports of `OrderFlow`, `Pick`/generic uses, casts, inferred objects and hand-written route dependency fixtures. No exports from the old module to accommodate unmigrated callers.                                                                                                                                                                    |

## Task 0: Reorient and release the build boundary

- [ ] Driver publishes and reviews this plan as docs-only first. Record no runtime verification for
      this milestone.
- [ ] Apply the build boundary above. Do not ask for renewed approval of the naming/type split,
      settled environment contract or inline execution method.
- [ ] Re-read current source and reservations. The local snapshot is
      `/Users/clintongormley/waitron-campaign-e/receipts/a1156-plan-20261029/reservations.json`; it
      reserves **no code for this plan**. Coordinate Lane B backup-settings `boot.ts`, F A964
      kitchen/receipt files, A1206 start-again paths and parked E A696/A951/F A739. Preserve their
      behaviour when rebasing; do not touch their worktrees.
- [ ] In the future registered build worktree, capture the following inventories outside tracked
      product files. Read all matches, follow aliases (`cfg`, `till`, `venueCfg`, `saleCfg`,
      `designated`) and spreads to terminal readers/writers. Classify protected paths before edits;
      refresh after each PR.

```bash
git grep -n -E 'TillConfig|TillIdentityConfig|OriginConfig|DeviceRequestConfig|loadTillConfig|tryLoadTillConfig|till-config' -- apps packages scripts
git grep -n -E 'ServerConfig|loadConfig|vi\.mock.*config|\bconfig:' -- apps/server
git grep -n -E 'config\.till\b|deps\.till\b|tillBackend|server\.till_config_|till_config_partial' -- .
git grep -n -E 'sendingDeviceId|madeHereSink|practiceMode|operationDescription(Required|Default)|simplifiedInvoiceLimit|invoiceLocales|localeOverride|dataNodeId' -- apps/server packages
git grep -n -E '\.\.\.(cfg|config|till|deps|saleCfg)|\b(till|venueCfg|designated):' -- apps/server
git grep -n -E 'TillConfig|config\.till|tillBackend|loadTillConfig|server\.till_config_' -- '*.md'
```

An empty search exits 1; distinguish that expected absence from command failure. Inventory prose by
meaning as well as identifiers. Historical plans/specs retain history, with a dated pointer when
needed; active README/developer guidance follows the new names.

## Task 1 / PR1: Separate environment inputs and preserve boot gates

**Files:** Create `node-config.ts`, `node-config.test.ts`, `node-config.location.test.ts`,
`boot.node-configuration.test.ts`; modify `till-config.ts`, `till-config.test.ts`, `config.ts`,
`config.test.ts`, `errors.ts`, `boot.ts`, `first-fiscal-mode.ts`, `rejoin-command.ts`,
`venue-locale.test.ts`, `restore.ts` import only, and every loader/reader/error consumer in Task 0.
Existing suites: `boot.test.ts`, `boot.setup-routes.test.ts`, `boot.mirror.test.ts`,
`first-fiscal-mode.test.ts`, `rejoin-command.test.ts`, `till-config.filing.test.ts`. Include every
handwritten `ServerConfig` fixture and configuration mock from Task 0 in this PR's closure. Update
complete config fixtures such as `first-fiscal-mode.test.ts`; keep intentionally narrow listener
fixtures in `landing-listener.test.ts` narrow.

**Interfaces:** Produce the node/settings loaders and `ServerConfig` shape above. Temporarily retain
the existing **interface** `TillConfig`, now extending `NodeConfig` and `TillAppSettings` with its
current runtime fields. This is the old internal composition pending PR2, not an alias or alternate
input; no new caller may adopt it. Delete `TillIdentityConfig`, `loadTillConfig`,
`tryLoadTillConfig` with their entire consumer closure in this PR.

- [ ] **Red:** Add `node identity excludes app preferences` and
      `app settings do not establish node identity` tests: `loadNodeIdentity` returns only
      `{ nodeId: NODE }`; settings return only locale/derived locales/override/tips, including
      `localeOverride: undefined` when absent. Use `toStrictEqual` for new shapes. `loadConfig` has
      `node` and `tillApp`, no `till`. First run fails because the new loaders/properties do not
      exist, not an unrelated fixture failure.
- [ ] **Red:** Pin absent/empty node: optional reader returns undefined, required reader throws
      `server.node_config_missing` with exactly `{ key: "WAITRON_NODE_ID" }`. Malformed UUID and a
      distinctive pasted secret throw `server.node_config_invalid`; serialized error, message,
      params and causes must not contain that secret. Retired keys remain ignored, both alone and
      beside a distinct current id.
- [ ] **Red:** Settings table: locale undefined/empty gives `es-ES`, `["es-ES"]`, undefined
      override; explicit `es-ES` preserves that override; `ca-ES` and unsupported `zz-ZZ` remain raw
      in all derived preference fields. Tips true/1 enable; undefined/empty/false/0/yes do not.
      Settings-only input must not create identity.
- [ ] **Characterize:** Add `raw locale override leaves GB geography visible` in
      `venue-locale.test.ts`: a GB tenant/location with undefined/empty settings override resolves
      `en-GB`; explicit `es-ES` resolves `es-ES`; unsupported raw override falls back to `en-GB`.
      Pass the settings loader's raw override through the real resolver. This distinguishes the
      answers; the existing Barcelona fallback resolves `es-ES` either way. Retain existing
      Catalan/unsupported tests. Run this behavioural control before and after the split.
- [ ] **Red:** New DB-reader cases use node `33333333-3333-4333-8333-333333333333`, location
      `55555555-5555-4555-8555-555555555555`, two nodes sharing that location, and an unknown node
      returning null. Missing location after adoption is represented by no own-node row. READ:
      `packages/db/src/schema/nodes.ts:22` requires a location FK; do not create a dangling row by
      disabling constraints. Keep the existing absent-node trading rejection, changing only the
      approved code name and retaining params.
- [ ] **Red:** In the new boot suite, settings-only input serves setup; configured GB/fiscal-none
      identity reaches trading with its DB location, null simplified limit and no
      operation-description requirement. Add
      `GB boot uses raw override rather than defaulted locale`: GET `/api/till` answers display
      locale `en-GB` with unset/empty override, `es-ES` with explicit `es-ES`, and `en-GB` with
      unsupported `zz-ZZ`. Keep existing no-fiscal write assertions unchanged. Incomplete first
      setup clears only `config.node`, leaving app settings intact.
- [ ] **Red:** Pair pending-adoption/no-node boot (status `{ adoption: "pending" }`, public help, no
      ordinary trading) with otherwise identical no-latch boot rejecting missing location. After
      completion/latch removal, missing location must also refuse; use a separate stopped-server
      fixture, not an invented successful adoption path. Retain existing pending-adoption
      assertions.
- [ ] **Implement:** Extract identity parsing and DB readers unchanged apart from
      names/types/errors. Parse settings independently, always. Change **every** presence/mutation
      gate to `config.node`; neither `tillApp` nor a fiscal slot decides setup mode. Assemble
      runtime fields only after pending adoption and DB location resolution; preserve raw locale
      override, fiscal defaults, limit and practice mode derivation.
- [ ] **Implement closure:** Rejoin reads only node identity. Replace old loader spreads in
      boot/receipt fixtures with explicit node-loader plus settings-loader spreads. Move all
      `readNodeLocation`/`readFilingModule` imports together; leave restore implementation,
      trading.env writers and fiscal registrations untouched. Update active error wording/docs
      copies and prefix consumers found by inventory; no stored-code migration.
- [ ] **Green:** Run each focused command below, read nonzero test counts and failures, then run
      `pnpm --filter @waitron/server typecheck`. Preserve exact config shape assertions, split into
      independently complete node/settings expectations; document every changed check. Fix
      compilation closure before committing.

```bash
pnpm --filter @waitron/server exec vitest run src/node-config.test.ts src/node-config.location.test.ts src/till-config.test.ts src/config.test.ts src/rejoin-command.test.ts src/venue-locale.test.ts
pnpm --filter @waitron/server exec vitest run src/boot.node-configuration.test.ts src/first-fiscal-mode.test.ts src/boot.mirror.test.ts
pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.setup-routes.test.ts src/trading-config.test.ts src/restore.test.ts src/fiscal-none.e2e.test.ts src/till-config.filing.test.ts
```

- [ ] Commit only this slice with
      `git commit -s -m "refactor(server): separate node identity from till settings"`; finish the
      PR through the common gate below. This cut contains the behavioural boundary work, leaving the
      mass type-name change for a separate review.

## Task 2 / PR2: Replace the mixed runtime type in one dependency closure

**Files:** Create `trading-context.ts`, `trading-context.test.ts`; modify `till-config.ts`,
`request-config.ts`, `request-config.test.ts`, `made-here.ts`, and **all** runtime-type
import/annotation consumers from Task 0, including `apps/server/scripts/dev-setup.ts`,
`apps/server/scripts/demo-seed/seed-floor.ts`, `apps/server/src/testing/session-device.ts`,
hand-written fixtures and type-only imports/annotations in the server's fiscal suites. Do not guess
a fixed file count.

**Interfaces:** Produce `TradingContext`, `FiscalRuntimeContext`, `RequestEffects`, `OriginConfig`,
`DeviceRequestConfig` exactly as above. Remove the `TillConfig` export completely. Keep
`OriginConfig`/`DeviceRequestConfig` names and device-only origin narrowing. Keep `OrderFlow` in the
app configuration module; split mixed imports instead of moving an unrelated type.

- [ ] **Structural red:** Add `trading context preserves every constituent` with a type import from
      the proposed `trading-context.ts`, a complete annotated fixture, and exact `requestCfg`
      output. `pnpm --filter @waitron/server typecheck` must fail on the missing type module/export
      before implementation. Vitest erases type imports; do not claim this is a runtime red. Run the
      same fixture through current request helpers as a behavioural characterization before moving
      types.
- [ ] **Characterize:** Extend request controls before moving types: two devices on the same context
      yield distinct device origins with unchanged node/location; dashboard/job origins stay valid
      through `OriginConfig`, stored-device recovery still refuses non-device origin. Assert
      `sendingCfg(requestCfg(...))` preserves origin, changes only sending device/sink, reuses one
      sink within a request, allocates a distinct sink for another request and never mutates the
      base object. Run these cases before and after the move; they already describe existing
      behaviour. The compiler failure above supplies this slice's structural red.
- [ ] **Implement:** Move the runtime definitions, not their meaning; use constituent interfaces and
      flat composition. Update direct imports, `Pick`/`Omit`, generics, satisfies/casts, inferred
      factories and handwritten fixture types in one batch. Do not keep duplicate old/new exports.
      `deviceRequestCfg<C extends TradingContext>` retains `Promise<C & { origin: DeviceOrigin }>`;
      preserve `sendingCfg`'s generic return and optional request effects.
- [ ] **Implement closure:** Update cancellation, adjustments, working-order, drafts, groups, move,
      payment/recovery, printer, device and floor consumers identified by inventory. Limit edits in
      domain writers to imports/type annotations; do not change their statements, call arguments or
      field access semantics. If compilation needs a behavioural change or an H2-protected edit,
      stop that slice and return the dependency finding to the driver.
- [ ] **Green:** Run the commands below and package typecheck. Re-run PR1's new loader/config tests
      because removing the old interface must not rejoin the environment inputs. Refresh inventory:
      no live `TillConfig`/`TillIdentityConfig` symbols or old type re-exports; inspect actual
      dependency closure, not only search absence.

```bash
pnpm --filter @waitron/server exec vitest run src/trading-context.test.ts src/request-config.test.ts src/made-here.routes.test.ts src/simplified-limit.test.ts src/sale-operation-description.test.ts
pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/bill-payments.test.ts src/till-sale-integrated.db.test.ts
pnpm --filter @waitron/server typecheck
```

- [ ] Commit with `git commit -s -m "refactor(server): name the composed trading context"`; finish
      this independently green PR. This is a wide mechanical closure, not a field-path redesign; one
      consistent replacement pass keeps it plausible within the call budget.

## Task 3 / PR3: Name runtime ownership and close the receipt/read boundary

**Files:** Modify `boot.ts`, `orders-api.ts`, `orders-reprint.ts`, `orders-invoice-pdf.ts`,
`invoice-customer-data.ts`, `invoice-customer-data-api.ts`, their dependency-object callers/tests
from Task 0, `orders-api.test.ts`, `invoice-customer-data-api.test.ts`, and
`boot.node-configuration.test.ts`. Update active `apps/till/README.md`,
`packages/db/src/mirror-config.ts` pointer, `packages/country-packs/src/registry.ts` loader pointer.
Delete the obsolete registration-comment parenthetical as commentary only, subject to the build
boundary above. Driver owns backlog updates.

**Interfaces:** Boot locals become `node`, `tradingContext`, `nodeBackend`; the five invoice/order
dependency shapes use `tradingContext`. Existing backend parameters named `backend`, existing `cfg`
parameters and genuine till application names stay. No `config.till`, `deps.till`, `tillBackend`,
overloaded `TillConfig`, temporary composition or old-loader re-export remains in active source.

- [ ] **Red:** Add an order/invoice route fixture using the new dependency property, with own node
      different from data node and node location different from both ids. Assert data-scope reads
      return origin-node rows; printer/location and write scopes still use the own node/location.
      Initial focused run fails on the new property being unsupported; retain existing mirror write
      refusals and primary controls.
- [ ] **Characterize:** Before renaming runtime values, pin Demo/Prepare practice true and Live
      false with the same configured tips/locale; compare route-visible tips/limit/locale and
      simulated print results. Preserve absent/false operation requirement versus true, and offered
      default/limit values. These cases should already pass; the dependency-property test supplies
      this slice's red. Do not invent a behaviour change to make characterization tests fail.
- [ ] **Implement:** Rename local bindings with lexical scope awareness and replace dependency keys
      at both declaration and every construction site. Keep `dataNodeId` only on existing
      report/order/customer read scopes; never spread it over `node.nodeId` or
      `tradingContext.nodeId`. Keep sale-location overrides in invoice documents, saved
      issuer/line/language facts, and live trim/logo/address lookups in their existing paths.
- [ ] **Green:** Run the focused suites below, PR1 boot/mirror controls, and package typecheck.
      Existing two-device fiscal-chain and receipt assertions remain unchanged; mechanical
      type/import names follow the new interfaces. If an expected receipt, money value or fiscal
      record must change, the naming refactor has escaped scope; park it, do not update the
      expectation.

```bash
pnpm --filter @waitron/server exec vitest run src/boot.node-configuration.test.ts src/boot.mirror.test.ts src/orders-api.test.ts src/invoice-customer-data-api.test.ts src/orders-invoice-pdf.test.ts src/orders-reprint.test.ts
pnpm --filter @waitron/server exec vitest run src/receipt-language.test.ts src/receipt-print.test.ts src/invoice-document.test.ts src/sale-till-source.receipt.test.ts
pnpm --filter @waitron/server typecheck
```

- [ ] **Audit:** Re-run Task 0 inventories across source, scripts, fixtures, active prose and the
      base-to-tip diff. The retained `invoiceLocales` preference must still equal `[locale]`;
      DB/sale `invoiceLocales` must retain their separate meaning. Leave no misleading active old
      composite name. Historical documents remain historical. No new guard is required: do not
      modify existing guards to accommodate the refactor.
- [ ] Commit with `git commit -s -m "refactor(server): name node backend and trading dependencies"`;
      finish through the gate below. This cut isolates runtime wiring/receipt review from mechanical
      type migration.

## Common verification and finish gate for each code PR

All commands in this plan are **prospective**, not verification already performed. Use actual
focused file paths confirmed by `rg --files` on the build base; if a listed suite has moved, resolve
its successor before running, never accept “no tests”.

- [ ] Record each red reason and subsequent green test count. Preserve existing assertions; include
      exact whole-shape/error-code changes in the changed-check inventory. Run unchanged fiscal
      hash/immutability suites whenever editing nearby composition or types:

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts
pnpm exec vitest run scripts/no-till-as-issuer.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts
```

- [ ] Capture protected-file byte diffs against each PR base. Require
      `git diff --exit-code <slice-base> -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
      to be empty, as well as unchanged huella/golden data and fiscal executable statements. List
      mechanical imports/annotations separately from changed checks; test inputs and behavioural
      assertions remain intact except for the explicitly scoped equally strict shape/error-name
      changes.
- [ ] In a **disposable installed candidate tree**, assign deletion controls to the slice that owns
      each assertion. PR1 changes boot's locale override argument to defaulted locale:
      `GB boot uses raw override rather than defaulted locale` must fail (`es-ES` instead of
      `en-GB`). PR2 removes `requestCfg`'s spread, expecting the whole-shape preservation assertion
      to fail, then removes `sendingCfg`'s sink assignment, expecting its new request-sink identity
      assertion to fail. Name these request cases in `trading-context.test.ts`. PR3 repeats a
      control only where its wiring changes justify it. Restore each mutation before the next. Never
      mutate the feature checkout to measure old code.
- [ ] Create that disposable tree from the signed slice commit with
      `git worktree add --detach "$probe_dir" HEAD` under a directory you created with `mktemp -d`;
      install there with `pnpm install --frozen-lockfile`. Bound each focused run with
      `node scripts/run-with-deadline.mjs 180 -- pnpm --filter @waitron/server exec vitest run <owning-test-file>`;
      record the expected assertion failure, not timeout/import failure. Remove only this recorded
      tree/directory and processes started by these controls.
- [ ] Legitimate negative controls retain settings-only setup, tips/locale configuration, device
      profiles, two cash-register devices on one node and genuine till names. If review requires a
      **new** naming guard, add it as an explicit reviewed scope change: prove each forbidden
      construct fails in the disposable tree and these legitimate inputs pass. No broad `till` ban
      or existing guard allowlist expansion.
- [ ] Announce readiness for `finish-branch`, then execute it when requested/already authorized. One
      Claude run-it review per meaningful branch after initial rebase, in its own complete
      disposable checkout; triage findings in the feature worktree. No repeated whole-workspace
      local coverage run or duplicate push hook.
- [ ] Require the normal hook, signed-off commits, resolved findings/conversations and required CI
      on the current head, including affected package coverage merges. Rebase for real overlapping
      code/conflicts, not `BEHIND` alone. Driver handles residual backlog entries;
      fiscal-registration changes remain parked for owner landing. A green intermediate PR is not
      completion of A1156.
