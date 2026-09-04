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
  (`server.*` — a fact about this process's config), never a silent override.
- An unknown module name (not in `ALL_MODULES`) is a **loud config error** — a typo that silently
  disabled nothing is the failure mode we refuse.
- `fiscal` is `provision-only`: it may be disabled here **only before it has chained a record**
  (§4). Disabling a fiscal module that has already minted a SIF is refused — the records are immutable
  and legally retained (CLAUDE.md §5).

**Why sparse-override and not the architecture's "naming the enabled modules" (allowlist).** An
allowlist makes a **newly-shipped** module (added to `ALL_MODULES` in a release, not named in an
operator's existing file) default to **disabled** — the dangerous direction, silently dropping a
module's migrations on upgrade. Default-on is the safe direction, and it matches the owner's answer
(all modules enabled; the eight non-fiscal modules are effectively core and should not casually turn
off). Recorded as a deliberate deviation from architecture §6's wording, with this reason.

**Parsing is pure and validated** — a `parseModuleConfig(raw: unknown): ModuleConfig` in
`@waitron/module` that rejects a non-object, an unknown name, and `core: false`, throwing the typed
`server.*` config error (the composition root owns the file, so the code lives where the file is read;
the pure parser lives in `@waitron/module` so it is unit-testable without a filesystem). "The caller
only passes safe values" is not a defence — the file is operator-editable (CLAUDE.md §3), so the
parser validates rather than trusts.

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

**Provisioning seed gate (the safety-critical part).** `applyVenue`'s `registerSif` (and any future
per-module seed, e.g. the kitchen default station, `venue-apply.ts:116`) runs **only if that module is
enabled**. `registerSif` mints an unrecoverable chain, so a box that does not run fiscal must never
call it. The `applyVenue` planner/executor gains the enabled set as an input and skips the fiscal seed
when fiscal is disabled. In the Spain exemplar fiscal is always enabled, so this is behaviour-preserving;
the gate is what makes a non-fiscal box correct.

**Provisioning instance migrate — lockstep with boot.** `instance-apply.ts:183-186` migrates on
unfiltered `manifestSets()`. SP-1b makes it consult the **same** enabled set (threaded in as an
input — the CLI resolves it from the same `modules.json`, defaulting to all when absent), so a
disabled module's tables are never created by the provisioner either. This closes the SP-1a
forward-warning: filtered-boot and provisioning no longer diverge. **`manifestSets()` stays** the
runtime source for the *other* consumers SP-1a enumerated (`instance-state`, `status-command`, dev
scripts, harnesses, bundle-layout) — SP-1b filters the **migrate input**, it does not remove the
manifest.

**The SP-1a pin still holds.** `orderedMigrationSets(ALL_MODULES)` deep-equals `manifestSets()`
compares the **full** list to the **full** manifest, and SP-1b never mutates `ALL_MODULES` — it filters
a *copy* at the call site. So the pin is untouched; SP-1b adds its own tests over the *filtered* list.

## 5. Soft-disable in SP-1b (bounded)

Architecture §6 defines soft-disable as "stop wiring it (routes, sync enrolment, UI cards,
provisioning) and skip it at boot, but leave its tables and data intact." In SP-1b the per-module
route/sync/card registries **do not exist yet** (SP-2/SP-4), so there is nothing to un-wire there.
SP-1b's soft-disable is therefore exactly:

- **skip its migrations** at boot (the filter), and
- **skip its provisioning seed** (the gate),

while **leaving its tables and rows intact** — a disabled module's `__drizzle_migrations_<name>` and
data tables are never dropped. Re-enabling (removing the `false` from the file) puts it back in
`toMigrate`/`steady` on the next boot with no data loss. **Purge** (the only thing that drops tables)
is explicitly **out of scope** — it is the guarded, separate action of architecture §6, never applied
to `core` or a chained fiscal module, and no runtime disables a production module in SP-1b anyway.

## 6. Testing

- **`parseModuleConfig` (pure, `@waitron/module`)** — default-on for absent keys; absent file → all
  enabled; `core: false` throws; unknown name throws; a well-formed disable of a toggleable module
  yields the expected set. Proven by deletion for each validation branch (remove the check → the
  rejection test fails → restore).
- **`reconcile` (pure)** — the three classes (`toMigrate`/`steady`/`softDisabled`) over hand-built
  `enabled`/`migrated` sets, including a state where the two visibly disagree (CLAUDE.md §1: a
  measurement where both answers look alike measures nothing) — e.g. one module migrated-but-disabled
  **and** one enabled-but-unmigrated in the same fixture, so the two differences are distinguishable.
- **`appliedSchemaVersion` on a missing table returns 0** — SP-1a already covers this
  (`schema-version.test.ts`); SP-1b does not re-test the primitive, only relies on it. The reconcile
  test below is where SP-1b exercises the unmigrated → `toMigrate` path end to end.
- **Boot filter, real Postgres, both modes:** with no `modules.json`, every `__drizzle_migrations_<name>`
  table is present + populated after a trading boot (behaviour-preserving, extends the SP-1a boot test);
  with a `modules.json` disabling one **toggleable** module (a fixture, not a production
  recommendation), that module's migration table is **absent** after a trading boot while the rest are
  present — the filter demonstrably skips a set. Setup mode migrates all regardless of the file.
- **Provisioning seed gate:** `applyVenue` with fiscal enabled calls `registerSif` (unchanged);
  `applyVenue` with fiscal disabled does **not** — proven by deletion of the gate (removing it makes
  the fiscal-disabled case mint a chain, failing the assertion).
- **Provisioning instance migrate lockstep:** the instance migrate over a fixture disabling one set
  omits that set's tables, matching the boot filter.
- **english-only** — `@waitron/module` stays a scanned generic package holding only generic logic
  (config parsing, set arithmetic) — **no domain vocabulary**; the Spanish `registros_facturacion`/
  `registerSif` names stay in the exempt `fiscal-verifactu` + the exempt `apps/server` composition
  root. Run `pnpm vitest run scripts/english-only.test.ts` green — a claim to verify, not assert.
- **Guards run whole-package, not filtered** (CLAUDE.md §2/§4): after touching `venue-apply.ts` /
  `instance-apply.ts`, run `pnpm --filter @waitron/provisioning test:coverage` unfiltered, and
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — no schema table is added here, but the
  gate touches the fiscal seed path.

## 7. Invariants preserved (receipts)

- **Behaviour-preserving by default** — no file (or a file disabling nothing) migrates the same nine
  sets in the same order in both modes (§4), and `registerSif` runs exactly as today (§4 gate is a
  no-op when fiscal is enabled, the default).
- **Setup still migrates the full schema** for the wizard (`boot.ts:532`; the filter is trading-only).
- **Fiscal chain untouched** — SP-1b gates *whether* `registerSif` runs; it changes nothing about the
  chain it mints, the immutability guards, or the double-provision latch (`apps/server/src/provision.ts`).
  A fiscal module that has chained a record cannot be disabled (§2).
- **No schema change, no new privilege, no `deployment` column** — SP-1b adds a config file reader, a
  pure reconcile, and two call-site filters; it writes no migration and touches no grant (decision 3).
- **English-only preserved, not exempted-around** — no new whole-package exemption; the generic
  `@waitron/module` stays English (architecture §9).
- **The SP-1a inversion pin is untouched** — `ALL_MODULES` is filtered by a copy at the call site,
  never mutated (§4).

## 8. Interactions

- **SP-1a** — consumes `ALL_MODULES` + `tier` (recorded there, acted on here) and
  `appliedSchemaVersion` (the derived-actual primitive). Closes SP-1a §4's forward-warning by gating
  provisioning in lockstep with boot.
- **SP-1c** — replaces the explicit `ALL_MODULES` order with the derived dependency graph + version
  gates; SP-1b's filter operates on whatever ordered list SP-1c later produces (it filters, it does not
  order).
- **SP-1d** — cross-node config replication: the `modules.json` SP-1b reads locally is the file SP-1d
  will bootstrap at adopt and flow down from the primary. SP-1b keeps the file **local-only**; no
  replication here.
- **SP-2** — the schema-version handshake reads `appliedSchemaVersion` (unchanged; SP-1b relies on its
  existing missing-table → 0 behaviour, `schema-version.ts:59-61`) and pulls only the subscriber's
  **enabled** modules — the set SP-1b computes.
- **SP-3** — fiscal-as-a-module: its gated provisioning seed is the `registerSif` gate SP-1b builds;
  SP-3 moves fiscal's descriptor into its package and adds its sync enrolment/vocabulary on top.
- **Tier steer (owner, 2026-09-04)** — the eight non-fiscal modules are effectively core and should
  not casually be disablable; fiscal is the one genuine provision-only slot. SP-1b honors the recorded
  tiers mechanically (default-all makes it moot in practice) and does **not** re-tier those eight —
  that is its own change if the owner wants it, not this slice.
- **No UI** — parallel-safe with the SP-B3.2 layout-editor session (architecture §7).
