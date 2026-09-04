# SP-1b — Module enablement + boot reconcile

**Date:** 2026-09-04
**Status:** design. **Owner-reviewed:** scope + the four forking decisions below approved 2026-09-04
(the brainstorm that produced this spec).

**Implements:** [module-system-architecture §6 / §8 SP-1b](2026-09-04-module-system-architecture-design.md)
and the [SP-1a forward-warning](2026-09-04-module-sp1a-contract-and-migration-source.md#4-migration-source-inversion)
— the second slice of SP-1. SP-1a made `ALL_MODULES` the source of truth for the boot migration list
but used it **whole**; SP-1b makes the recorded `tier` and an on-box config file **act**: it computes
an *enabled set*, filters the boot migration list by it, gates provisioning's fiscal seed on it, and
defines soft-disable. Versioned dependency ordering (SP-1c), cross-node config replication (SP-1d),
and the route/worker/sync/card registries (SP-2/SP-4) are later slices and are **out of scope** here.

**Decides (the four owner forks from the brainstorm):**
1. **Default = all enabled.** An absent or silent config file means every module in `ALL_MODULES` is
   enabled — today's behaviour, unchanged. Disabling is an explicit opt-out.
2. **Scope = mechanism + fiscal gate.** Build reconcile/filter/provisioning-gate; prove it
   behaviour-preserving with the full set; prove the filter *can* skip a set by fixture; gate fiscal's
   `registerSif` seed. **No production module is declared safely-off** — the static wiring inversion
   that would make identity/payments/sync/… independently disableable is SP-2/SP-4 + the deferred
   core-extraction (architecture §10). The practical toggleable set is empty today; **fiscal is the one
   genuine provision-only slot** (owner steer: the other eight are effectively core).
3. **Actual state is DERIVED, not stored.** No new `deployment` column. A module is *migrated* iff its
   drizzle table has rows — read with SP-1a's `appliedSchemaVersion`, which **already returns 0 for a
   never-migrated module** (`packages/migrations/src/schema-version.ts:59-61` catches SQLSTATE `42P01`),
   so reconcile is set arithmetic over `desired` (the file) vs `migrated` (the DB) with no new primitive
   to build. See §3 for the one edge (a migration-less module) this defers and why YAGNI applies.
4. **Config file = sparse override map, default-on** — not the spec's literal "naming the enabled
   modules" allowlist. See §2 for the deviation and its receipt.

It is **behaviour-preserving**: with the default (no file, or a file disabling nothing) the same nine
sets migrate in the same order in both trading and setup mode, and `registerSif` runs exactly as
today.

---

## 1. The seams this touches (grounded)

- **Boot migration list** — `apps/server/src/boot.ts:507-510` runs
  `applyMigrations(config.migrationsDatabaseUrl, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), config.migrationsRoot))`,
  unconditionally, before the pool opens. SP-1b inserts an enablement **filter** between `ALL_MODULES`
  and `orderedMigrationSets`.
- **Setup mode** — `apps/server/src/boot.ts:528` (`config.till === undefined`) serves only `/health` +
  the setup surface; the DB is migrated by the shared prefix above (line 532's comment: "The DB is
  migrated all the same … ready for the provisioning wizard"). Setup must keep migrating **all** sets
  (SP-1a §4 invariant, `boot.ts:531` in the SP-1a spec's numbering) — the wizard needs the full schema
  regardless of the eventual enabled set.
- **Provisioning venue seed** — `packages/provisioning/src/venue-apply.ts:4` imports `registerSif`, and
  `applyVenue` (`:42`) mints a SIF chain (`registerSif`, spec/architecture §1.2: an unrecoverable
  hash chain with no business key). This is the safety-critical seed to gate.
- **Provisioning instance migrate** — `packages/provisioning/src/instance-apply.ts:183-186` migrates a
  bare DB with `migrationOptionsFor(manifestSets(), deps.migrationsRoot)` — **unfiltered**, the exact
  divergence the SP-1a forward-warning names.
- **On-box state dir** — `config.stateDir` (`apps/server/src/config.ts:87`, default `defaultStateRoot`,
  overridable by `WAITRON_STATE_DIR`) already holds `trading.env`/`secrets.env`. The module config
  file is a sibling. Atomic writes use the existing `writeFileAtomic` (`apps/server/src/fs-atomic.ts`),
  as `writeTradingEnv` does (`apps/server/src/trading-config.ts:38`).
- **`deployment` singleton** — `packages/db/drizzle/0010_deployment_stamp.sql`, one `id=1` row carrying
  `environment`/`mode`/`singleton_role`; **not** in the drizzle snapshot chain (its schema TS
  documents why: `packages/db/src/schema/deployment.ts` header). Decision 3 means SP-1b adds **no**
  column here — the caveat is noted only to record that we deliberately avoided reopening it.

## 2. The config file (desired state)

**Location:** `<stateDir>/modules.json`, sibling to `trading.env`. Read at **boot, before migrations**
— exactly when the decision is needed (architecture §1.3): the enabled set is not a DB row, because
the decision precedes any row.

**Shape — a sparse override map, default enabled:**

```json
{ "modules": { "fiscal": false } }
```

- A module is enabled **unless** it appears with value `false`. Absent key = enabled. Absent file =
  every module enabled (today's behaviour).
- `core` is `mandatory` and cannot be disabled: writing `"core": false` is a **loud config error**
  (`module.core_not_disableable`), never a silent override.
- An unknown module name (not in the module list) is a **loud config error**
  (`module.config_unknown`) — a typo that silently disabled nothing is the failure mode we refuse.
- A malformed file (not an object, `modules` not an object, a value that is not a boolean) is a
  **loud config error** (`module.config_invalid`).

**Error codes are `module.*`, not `server.*`.** The parser is pure and lives in the generic
`@waitron/module` package, which **cannot** import `apps/server`'s `server.*` registry (a package
never imports an app). The domain concept is the module system, so `module.*` is the correct prefix
by the house convention (name the concept, not the throwing package —
`packages/shared/src/errors.ts`). SP-1b adds a new `packages/module/src/errors.ts` declaring
`module.config_invalid` / `module.config_unknown` / `module.core_not_disableable`, re-imported from
the package barrel (the root reachability guard, `scripts/errors-reachable.test.ts`, requires it).
`@waitron/module` gains a `@waitron/shared` dependency for `AppError`.

**`fiscal` (`provision-only`) is not special-cased in the parser.** The parser lets `fiscal` be
disabled like any toggleable module — it has no DB and cannot know whether a chain exists. The
provision-only *consequence* is enforced downstream: **fresh** venue provisioning with `fiscal`
disabled is refused (§4). Refusing to disable an **already-chained** fiscal is **out of scope for
SP-1b and inert here anyway** — with no per-module fiscal wiring yet (SP-2/SP-4), disabling a chained
fiscal only makes the boot filter skip fiscal's *already-applied* migrations (a no-op), so it turns
nothing off and mints nothing. The real "cannot disable a chained fiscal" guard lands in **SP-3**,
where fiscal's wiring can actually be switched off; SP-1b must not claim to enforce it.

**Why sparse-override and not the architecture's "naming the enabled modules" (allowlist).** An
allowlist makes a **newly-shipped** module (added to the module list in a release, not named in an
operator's existing file) default to **disabled** — the dangerous direction, silently dropping a
module's migrations on upgrade. Default-on is the safe direction, and it matches the owner's answer
(all modules enabled; the eight non-fiscal modules are effectively core and should not casually turn
off). Recorded as a deliberate deviation from architecture §6's wording, with this reason.

**Parsing is pure and validated** — a `parseModuleConfig(raw: unknown, known: readonly string[]):
ModuleConfig` in `@waitron/module` that rejects a non-object, a non-boolean value, an unknown name,
and `core: false`, throwing the typed `module.*` codes above. `known` is the set of valid module
names (the composition root passes `ALL_MODULES`' names) so the parser needs no import of the module
list. "The caller only passes safe values" is not a defence — the file is operator-editable
(CLAUDE.md §3), so the parser validates rather than trusts.

## 3. Reconcile (derived actual state)

Pure logic in `@waitron/module`, so it is tested without a DB:

```text
enabledSet   = { m ∈ ALL_MODULES : config does not disable m }     // desired
migratedSet  = { m ∈ ALL_MODULES : appliedSchemaVersion(db, m) > 0 } // actual, DERIVED
```

- `toMigrate  = enabledSet − migratedSet`  → migrate (+ run its provisioning seed when provisioned)
- `steady     = enabledSet ∩ migratedSet`  → nothing (already migrated; idempotent re-run is a no-op)
- `softDisabled = migratedSet − enabledSet` → **skip migration + skip seed, data kept** (§5)

**Why derive rather than store a `deployment` column** (decision 3). SP-1a already exposes
`appliedSchemaVersion(db, module)` (`packages/migrations/src/schema-version.ts:50`), which reads the
module's `__drizzle_migrations_<name>` row count — so "has this DB migrated module X" is a fact the DB
already holds. Storing a second copy on `deployment` would be a redundant encoding to keep consistent
(the class §1 of CLAUDE.md warns about) and would need a fresh `--custom` migration on the
snapshot-chain-sensitive singleton. Deriving needs neither.

- **`appliedSchemaVersion` on a never-migrated module already returns `0`** — it catches SQLSTATE
  `42P01` (`undefined_table`) and returns 0 (`schema-version.ts:59-61`), so a module whose drizzle
  table has never been created reads as version 0, exactly the "unmigrated" the reconcile needs. No
  hardening is required; SP-1b relies on this behaviour and pins it with a reconcile-level test
  (below), rather than re-implementing it.
- **The reconcile reads run OUTSIDE any transaction.** That `42P01` catch aborts the enclosing
  transaction if there is one (a failed statement poisons its transaction — the reason
  `readDeploymentEnvironment` uses `to_regclass` instead). SP-1b's reconcile runs at boot on the
  migrator connection *before* the pool opens and before any migration transaction, calling
  `appliedSchemaVersion` per module standalone, so each missing-table catch aborts nothing. Reconcile
  must not be moved inside a caller transaction without switching the probe to `to_regclass` first.
- **The one edge derivation cannot cover** is a **migration-less** module — a future pure-code module
  contributing only cards/routes/cronjobs, with no drizzle set and thus no table to derive from. All
  nine current modules have a migration set (`ALL_MODULES`, `apps/server/src/modules.ts`), and SP-1b's
  contract ties every module to one, so this edge is unreachable today. A stored enablement marker is
  the fix **when a migration-less module first exists** — added then, not speculatively now (YAGNI).
  Recorded so a later slice adding such a module knows to revisit this, rather than silently treating
  it as permanently un-migrated.

**Drift is logged, not acted beyond the three classes above.** At boot, `softDisabled` (a module the
DB has but the file no longer wants) and any `toMigrate` are logged at `info` so an operator sees the
reconcile outcome; nothing else changes as a side effect.

## 4. Boot + provisioning gating

**Boot (trading mode).** Read `<stateDir>/modules.json` → `enabledSet` → filter `ALL_MODULES` →
`orderedMigrationSets(filtered)` → the unchanged `migrationOptionsFor(…, config.migrationsRoot)`. The
`from`-path resolution and the `set_missing` guard are reused verbatim (SP-1a §4) — only the input
list narrows.

**Boot (setup mode) migrates ALL — unchanged.** The filter is trading-only. Setup has no venue and no
config choice yet; it migrates the full schema so the wizard can run (`boot.ts:532` comment; SP-1a §4
invariant "setup-migrates-all"). A box therefore reaches trading mode with the full schema present;
the trading-mode filter then narrows *future* migration runs to the enabled set. Because the default
is all-enabled, setup-all and trading-filtered agree by default; they diverge only once a module is
explicitly disabled, and then only in that the disabled module's tables were already created in setup
and are simply left un-wired (the same end state as soft-disable — data/tables kept, §5).

**Provisioning seed gate — refuse, do not half-build (the safety-critical part).** `registerSif` mints
an unrecoverable chain (architecture §1.2), so a box that does not run fiscal must never call it. But
`applyVenue` **mandates** a SIF — it throws `applyVenue: register-sif never ran` if the plan omits one
(`packages/provisioning/src/venue-apply.ts:184`), and the whole trading path assumes a per-node SIF
(`sales.fiscal_backend`, `recordSale`, the chain). A *working* fiscal-less venue — planning without
`register-sif`, `VenueResult.sif` optional, the sale/chain path tolerating no fiscal — is a large
change to the fiscal core and is exactly **SP-3** ("fiscal as a module + gated provisioning;
swappable"). So SP-1b does **not** build it. Instead:

- The venue-provisioning entry (`provisionVenue`, `apps/server/src/provision.ts:62`, the composition
  root — it holds `ALL_MODULES` with their `tier`s and can compute the enabled set) refuses
  provisioning loudly with `module.provision_only_disabled` (param `{ module }`) **if any
  `provision-only` module is disabled**, before `planVenue`/`applyVenue` run. The guard is **generic
  — it names no module**: it iterates the `provision-only` tier (only `fiscal` today) and refuses on
  the first disabled one, so `@waitron/module` stays free of the token "fiscal". This guarantees the
  safety invariant (never mint a chain when fiscal is disabled) as a *refusal*, not a silent skip and
  not a half-built fiscal-less path.
- In the Spain exemplar `fiscal` is always enabled (default-on, no UI disables it), so the guard never
  fires in practice and provisioning is **behaviour-preserving**. It is the safety net + the seam SP-3
  builds the real fiscal-less path onto. `registerSif` itself is untouched.
- The existing per-node fiscal-module slot (`resolveFiscalModules` → `nodes.filing_module`/`tax_module`,
  `sales.fiscal_backend`, `packages/provisioning/src/fiscal-modules.ts`) is the SP-3 seam and is **not
  touched here** — SP-1b gates *whether fiscal runs at all*, not *which fiscal package fills the slot*.

**Provisioning instance migrate — the divergence is benign; not filtered here.** `instance-apply.ts:183-186`
migrates on unfiltered `manifestSets()`, and the provisioning CLI's source of truth **is** the manifest
(`@waitron/migrations`), not `apps/server`'s `ALL_MODULES` (a package cannot import an app). SP-1a's
forward-warning feared filtered-boot vs unfiltered-provisioning diverging; the resolution here is that
the divergence is **benign by construction**, not that it must be eliminated:

- Over-migrating a *toggleable* module creates its (empty) tables and writes its drizzle rows. At the
  next trading boot, reconcile derives that module as **migrated**; if the file disables it, it lands
  in `softDisabled` — tables kept, un-wired — which is *exactly* soft-disable's end state (§5). No
  corruption, no wedge.
- The one harmful seed, `registerSif`, is gated at the venue entry above — table creation alone mints
  no chain (the immutable tables are simply empty).

So SP-1b leaves the provisioning CLI's migrate on `manifestSets()` and **defers** unifying it onto the
module-declared source to **SP-3**, where fiscal-as-a-module owns its provisioning and the CLI's source
inversion belongs. This is a deliberate, receipted narrowing of the forward-warning (the migrate half
is benign; only the seed half is safety-critical, and that half is gated). `manifestSets()` stays the
runtime source for every consumer SP-1a enumerated.

**The SP-1a pin still holds.** `orderedMigrationSets(ALL_MODULES)` deep-equals `manifestSets()`
compares the **full** list to the **full** manifest, and SP-1b never mutates `ALL_MODULES` — it filters
a *copy* at the boot call site. So the pin is untouched; SP-1b adds its own tests over the *filtered*
list.

## 5. Soft-disable in SP-1b (bounded)

Architecture §6 defines soft-disable as "stop wiring it (routes, sync enrolment, UI cards,
provisioning) and skip it at boot, but leave its tables and data intact." In SP-1b the per-module
route/sync/card registries **do not exist yet** (SP-2/SP-4), so there is nothing to un-wire there.
SP-1b's soft-disable is therefore exactly:

- **skip its migrations** at boot (the trading-mode filter), and
- for a disabled `provision-only` module, **refuse venue provisioning** (§4) rather than seed it —
  in SP-1b that is the entirety of the "seed gate", because no working fiscal-less venue path exists
  yet (SP-3),

while **leaving any existing tables and rows intact** — a disabled module's
`__drizzle_migrations_<name>` and data tables are never dropped. Re-enabling (removing the `false`
from the file) puts it back in `toMigrate`/`steady` on the next boot with no data loss. **Purge** (the
only thing that drops tables) is explicitly **out of scope** — it is the guarded, separate action of
architecture §6, never applied to `core` or a chained fiscal module, and no runtime disables a
production module in SP-1b anyway.

## 6. Testing

- **`parseModuleConfig` (pure, `@waitron/module`)** — default-on for absent keys; absent/empty input →
  all enabled; a non-object, a non-object `modules`, and a non-boolean value each throw
  `module.config_invalid`; `core: false` throws `module.core_not_disableable`; an unknown name throws
  `module.config_unknown`; a well-formed disable of a toggleable module yields the expected set. Proven
  by deletion for each validation branch (remove the check → the rejection test fails → restore).
- **`reconcile` (pure)** — the three classes (`toMigrate`/`steady`/`softDisabled`) over hand-built
  `enabled`/`migrated` sets, including a state where the two visibly disagree (CLAUDE.md §1: a
  measurement where both answers look alike measures nothing) — e.g. one module migrated-but-disabled
  **and** one enabled-but-unmigrated in the same fixture, so the two differences are distinguishable.
- **`appliedSchemaVersion` on a missing table returns 0** — SP-1a already covers this
  (`schema-version.test.ts`); SP-1b does not re-test the primitive, only relies on it. The reconcile
  test below is where SP-1b exercises the unmigrated → `toMigrate` path end to end.
- **Boot migration filter, real Postgres:** driving the boot migration step (not a full trading boot —
  a disabled statically-wired module would break the app, which SP-1b does not claim to support) with
  no `modules.json` migrates every set (every `__drizzle_migrations_<name>` present + populated,
  behaviour-preserving, extends the SP-1a boot/migration test); with a `modules.json` disabling one
  **toggleable** module (a fixture, not a production recommendation), that module's migration table is
  **absent** and the rest present — the filter demonstrably skips a set. Setup mode's migrate list is
  unfiltered regardless of the file (a unit assertion over the list the setup branch builds).
- **Provisioning fiscal-gate refusal:** `provisionVenue` with `fiscal` disabled throws
  `module.provision_only_disabled` **before** `planVenue`/`applyVenue` run (no chain minted); with
  `fiscal` enabled (the default) it proceeds unchanged. Proven by deletion of the guard (remove it →
  the fiscal-disabled case reaches `applyVenue` and either mints a chain or throws
  `register-sif never ran`, failing the "refused early, nothing minted" assertion). The generic guard
  is exercised via the `provision-only` tier, not a hardcoded `"fiscal"`.
- **english-only** — `@waitron/module` stays a scanned generic package holding only generic logic
  (config parsing, set arithmetic) — **no domain vocabulary**, and no module-name literal (`fiscal`,
  `verifactu`, …); the Spanish `registros_facturacion`/`registerSif` names stay in the exempt
  `fiscal-verifactu` + the exempt `apps/server` composition root. Run
  `pnpm vitest run scripts/english-only.test.ts` green — a claim to verify, not assert.
- **errors-reachable** — the new `packages/module/src/errors.ts` must be reachable from
  `packages/module/src/index.ts`; the root guard `scripts/errors-reachable.test.ts` discovers
  `@waitron/module` (it ships both `index.ts` and `errors.ts`) automatically. Run
  `pnpm vitest run scripts/errors-reachable.test.ts` green.
- **Guards run whole-package, not filtered** (CLAUDE.md §2/§4): after touching `provision.ts`, run
  `pnpm --filter @waitron/server test:coverage` and `pnpm --filter @waitron/module test:coverage`
  unfiltered. No schema table is added here, so the fiscal `inmutabilidad` suite is unaffected, but the
  guard sits on the fiscal seed path — run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
  to confirm nothing about the chain moved.

## 7. Invariants preserved (receipts)

- **Behaviour-preserving by default** — no file (or a file disabling nothing) migrates the same nine
  sets in the same order in both modes (§4), and `registerSif` runs exactly as today (§4 gate is a
  no-op when fiscal is enabled, the default).
- **Setup still migrates the full schema** for the wizard (`boot.ts:532`; the filter is trading-only).
- **Fiscal chain untouched** — SP-1b gates *whether venue provisioning proceeds* when fiscal is
  disabled (a refusal before `applyVenue`); it changes nothing about the chain `registerSif` mints, the
  immutability guards, or the double-provision latch (`apps/server/src/provision.ts`). `registerSif`
  and `applyVenue`'s mandatory-SIF contract (`venue-apply.ts:184`) are unchanged.
- **No schema change, no new privilege, no `deployment` column** — SP-1b adds a config-file reader, a
  pure parser + reconcile, one boot-time migration filter, and one provisioning refusal guard; it
  writes no migration and touches no grant (decision 3).
- **English-only preserved, not exempted-around** — no new whole-package exemption; the generic
  `@waitron/module` stays English (architecture §9).
- **The SP-1a inversion pin is untouched** — `ALL_MODULES` is filtered by a copy at the call site,
  never mutated (§4).

## 8. Interactions

- **SP-1a** — consumes `ALL_MODULES` + `tier` (recorded there, acted on here) and
  `appliedSchemaVersion` (the derived-actual primitive). Addresses SP-1a §4's forward-warning by the
  receipted split in §4: the safety-critical **seed** is gated (fiscal-disabled provisioning refused),
  while the **migrate** divergence is shown benign and its source-unification deferred to SP-3.
- **SP-1c** — replaces the explicit `ALL_MODULES` order with the derived dependency graph + version
  gates; SP-1b's filter operates on whatever ordered list SP-1c later produces (it filters, it does not
  order).
- **SP-1d** — cross-node config replication: the `modules.json` SP-1b reads locally is the file SP-1d
  will bootstrap at adopt and flow down from the primary. SP-1b keeps the file **local-only**; no
  replication here.
- **SP-2** — the schema-version handshake reads `appliedSchemaVersion` (unchanged; SP-1b relies on its
  existing missing-table → 0 behaviour, `schema-version.ts:59-61`) and pulls only the subscriber's
  **enabled** modules — the set SP-1b computes.
- **SP-3** — fiscal-as-a-module builds the **working fiscal-less venue path** SP-1b only *refuses*
  (planning without `register-sif`, `VenueResult.sif` optional, the sale/chain path tolerating no
  fiscal), unifies the provisioning CLI's migrate onto the module-declared source, moves fiscal's
  descriptor into its package, and adds its sync enrolment/vocabulary + the per-node fiscal-module slot
  (`resolveFiscalModules`) on top. SP-1b's refusal guard is the seam it replaces.
- **Tier steer (owner, 2026-09-04)** — the eight non-fiscal modules are effectively core and should
  not casually be disablable; fiscal is the one genuine provision-only slot. SP-1b honors the recorded
  tiers mechanically (default-all makes it moot in practice) and does **not** re-tier those eight —
  that is its own change if the owner wants it, not this slice.
- **No UI** — parallel-safe with the SP-B3.2 layout-editor session (architecture §7).
