# Waitron module system — architecture design

**Date:** 2026-09-04
**Status:** architecture design. **Owner-reviewed:** the decisions in §2, §6 and §8 were taken with the
owner on 2026-09-04, in the session where the H2 fiscal-sync work surfaced the need.

**What this is.** A top-level architecture that turns each Waitron domain into an optional, swappable
**module** that owns its own schema, sync enrolment, UI, and vocabulary, plugged into a generic core
that imports nothing domain-specific. This document fixes the module contract, the enablement model,
and the decomposition. Each sub-project below gets its **own** spec → plan → build; this document is the
shared frame they argue from, not itself an implementation plan.

**How we got here.** The H2 fiscal-record sync work
([2026-09-04-h2-fiscal-record-sync-design.md](2026-09-04-h2-fiscal-record-sync-design.md)) needed to
enrol the Spanish-named fiscal tables into `@waitron/sync`, and hit the english-only guard
(`packages/db/src/english-only.ts`, `SPANISH_WORDS` is a *detection* list, `sync` is a scanned generic
package). That was the first place a real structural fact showed through: the generic sync layer
**imports domain schema** (`packages/sync/src/apply-sql.ts` imports `@waitron/payments` and
`@waitron/identity` schema tables centrally), so it *knows* every domain's tables. The owner's ruling:
invert it — the generic mechanism must know nothing; each domain package declares its own enrolment and
owns its own definitions. Generalised across schema, sync, UI and vocabulary, that is this module system.
H2's fiscal-record lane becomes one output of it (§8, SP-3).

---

## 1. The current reality this must fit (grounded, not aspirational)

Three facts from a survey of the tree (2026-09-04) constrain every decision below.

1. **Most "modules" are not modules yet — they live in the `core` monolith.** Only eight domains ship
   a separate migration set (`migrations.manifest.json`: core, identity, workforce, workforce-es,
   fiscal, payments, scheduler, credentials, sync). Kitchen, catalogue, tables/floor, printing, recipes,
   purchasing and reporting all live **inside** `@waitron/db`'s `core` set (there is no `kitchen`
   package at all; kitchen logic sits in `apps/server/src/kitchen*.ts`). Making those individually
   optional first requires **extracting each out of `core`** — a large refactor, deferred (§10).
   `core` itself can never be optional: everything FKs `tenants`, and fiscal's triggers depend on core
   functions (`packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql:5-8` relies on
   `reject_mutation()` / `current_tenant_id()` from `packages/db/drizzle/0002_immutability.sql`).

2. **Fiscal can be enabled at provisioning only, never toggled after.** `provisionVenue` →
   `applyVenue` always calls `registerSif` (`packages/provisioning/src/venue-apply.ts:158,203`), which
   mints a fresh installation number and starts a hash chain with **no business key** — a re-run mints
   a second, unrecoverable chain (`apps/server/src/provision.ts:40-56`, the double-provision guard at
   `:65-73`). The records are append-only and legally retained (CLAUDE.md §5). So fiscal is
   **required-but-swappable**, set once at provision, not a runtime on/off.

3. **The migration-time enablement decision precedes any DB row.** Migrations run at boot
   (`apps/server/src/boot.ts:505-508`, unfiltered `manifestSets()`), before provisioning stamps
   anything, so "which modules" cannot be read from a table at decision time. The generic runner is
   already a clean seam — `applyMigrations` loops whatever sets it is given
   (`packages/migrations/src/apply.ts:45`), and per-table grants ride inside each set's own SQL
   (e.g. `packages/db/drizzle/0055_kds1_stations_tickets_rls.sql:20`), so **skipping a set skips its
   grants for free** — but the "which sets" input has to arrive from outside the database (§6).

The UI is closed the same way: the card catalogue is a central hardcoded enumeration
(`packages/layouts/src/profile.ts:18-31` `CARD_TYPES`, `card-contract.ts:36` `CARD_CONTRACTS`), keys
map to components through one exhaustive switch (`apps/till/src/widgets/card-grid.ts:190-289`), and the
host statically imports every screen and **threads each card its domain-specific props**
(`card-grid.ts:71-128`, from `till-app.ts:2185-2213`). The prop-threading is the hard part of the UI
inversion (§7).

## 2. Scope (owner decision, 2026-09-04)

**Build now: the framework + fiscal as the exemplar.** Build the generic module framework (the four
registries + enablement + cross-node config replication), and prove it end-to-end by making **fiscal**
the first module onto it — its sync enrolment becomes H2's fiscal-record lane, it declares its own
vocabulary, its provisioning is gated, it is swappable. Fiscal is already a separate package, is the
swappability driver, and is where the clash lives, so it exercises every part of the framework except
the UI's hardest edge.

Fiscal is the archetype of a **country-dependent** module: the fiscal regime a venue runs is chosen by
its **jurisdiction** (Spain → `fiscal-verifactu`/Veri*Factu today; other countries, their own fiscal
modules later), and it is **not** meant to be baked into the image permanently — later it is an optional,
country-selected, installed module. So the framework must treat "which fiscal package fills the slot" as
a country-selected choice and hardcode **no** jurisdiction. What makes it buildable *now* without the
deferred code-distribution seam (§6) is only that `fiscal-verifactu` is present in the monorepo build for
this Spain exemplar — not any claim that fiscal is permanently image-present.

**Deferred, named not gated (§10):** extracting the other `core`-trapped domains into modules
(incremental, each its own effort); the runtime **code-distribution** mechanism (§6) — every module is
in the current monorepo build, so it is a designed seam, not built now (fiscal, being country-selected,
is its first future consumer, §6); the full UI inversion beyond fiscal's cards.

## 3. The module contract

A module is a package that exports **one** `WaitronModule` descriptor declaring what it owns. The core
consumes descriptors; it never reaches into a module. A descriptor declares:

- **`name`** — a stable id, matching its migration-set name.
- **schema + migrations** — its own drizzle set (the `X_MIGRATIONS` descriptor shape every packaged
  domain already exports, e.g. `packages/fiscal-verifactu/src/migrations.ts:9`) plus its ordering
  dependencies (at minimum "after core").
- **sync enrolment** — its `EnrolledTable[]` **and the column/schema information the generic apply
  needs**, so `@waitron/sync` imports no domain schema (§5, SP-2). The module owns its own table
  definitions.
- **UI contribution** — its cards: a `CardContract` per card (config schema, required capability,
  required permission, visibility states, spans, sale-critical) **plus the render component**, keyed by
  card id, registered into the generic host (§7, SP-4). Plus any capability flags it introduces.
- **vocabulary + error codes** — the regime terms it legitimately uses (generalising the
  english-only `EXEMPT_PACKAGES` list to "a module declares its own vocabulary") and its error registry.
- **theme** — theme tokens/overrides it contributes (generalising `THEMEABLE_TOKENS`,
  `packages/layouts/src/theme.ts:19-27`) so a module can ship its own themed surfaces.
- **privileges / permissions** — the permissions it introduces (generalising the closed `Permission`
  set in `@waitron/identity`) so a module's cards/routes can gate on its own permissions.
- **scheduled jobs (cronjobs)** — the periodic tasks it owns, contributed to the scheduler
  (`@waitron/scheduler`) and mounted only when enabled.
- **provisioning seed steps** — per-venue seeds it owns (fiscal's `registerSif`; kitchen's default
  station, `venue-apply.ts:126`), run only when the module is enabled.
- **runtime wiring** — the routes/workers to mount when enabled (following the existing
  env-presence-mounts-a-subsystem precedent, `apps/server/src/config.ts:303,383`).
- **compatibility & dependencies** — the core version range it targets and any module→module
  dependencies (§4a). The framework refuses an incompatible set before migrating anything.
- **enablement tier** — `mandatory` (core) | `provision-only` (fiscal) | `toggleable` (the rest).

**The contribution set is open, not fixed.** Sync/UI/vocabulary/theme/privileges/cronjobs are the kinds
identified today; adding a new registry kind (a module contributing another cross-cutting surface) is a
framework extension, not a change to every module. A module declares only the kinds it contributes to.

## 4. The domain-free core, via composition-root wiring

The generic packages — `@waitron/sync`, `@waitron/layouts`/the grid host, `@waitron/migrations` — import
**no** module. Instead the **composition root (`apps/server`, already exempt from the english-only guard
by a recorded decision, `english-only.ts`) imports the *enabled* module packages and registers their
descriptors** into an **open set of generic registries** — one per contribution kind (§3). Today:

- a **sync registry** the generic capture/apply reads (SP-2);
- a **card registry** the generic grid host reads (SP-4);
- a **migration registry** the boot runner reads (SP-1);
- a **vocabulary registry** the guard and error surfaces read;
- **theme, privileges and scheduled-job registries** the respective surfaces read;
- and any registry kind added later (§3, "the contribution set is open").

This DI seam is the whole point: swapping `fiscal-verifactu` for a different regime's package changes
only which descriptor `apps/server` registers — nothing in `sync`, `layouts` or `migrations` moves. It
is also why the english-only clash dissolves: the Spanish names live in the (exempt) fiscal module and
the (exempt) composition root; the generic packages stay English.

## 4a. Versions and dependencies

Modules and core evolve on their own schedules — trivially today (the monorepo version-locks everything),
but load-bearing once modules are independently distributed (§6). So the contract carries **version
compatibility** (a module declares the core version range it targets, and any module→module dependency),
and the framework **verifies compatibility before migrating anything** and refuses an incompatible set
loudly rather than migrating into a broken state.

This also fixes migration ordering, which is unenforced today (`packages/migrations/src/apply.ts:43-44`
notes the manifest order is load-bearing but nothing checks it). The boot runner orders migrations from
the **declared dependency graph with version gates** — "core must reach migration version X before this
module's migrations run", "module B after module A" — not a hand-maintained linear manifest. In the
current monorepo the graph is satisfied trivially (everything is at its locked version), so the gates are
enforced-but-never-tripped now; they become the real safety net when a module built against an older core
is installed onto a newer one.

## 5. Sync: the full inversion (SP-2)

Today `apply-sql.ts` centrally imports each domain's Drizzle schema and `registry.ts` enumerates all 22
tables. Inverted: `@waitron/sync` defines the enrolment **contract** and builds capture/apply generically
from **module-declared** enrolments that each carry their own column knowledge; it imports no domain
schema. **Every** package declares its own enrolment in place — including `@waitron/db` for its
`core`-resident tables (sales, kitchen, floor, …) — so the inversion is total without extracting those
domains from `core` (the `core` package simply declares enrolment for its own tables). Fiscal's
declaration is H2's lane (SP-3). The mechanism (`sync_log`, `sync_capture()`, `applyBatch`, the ordered
lane, per-`(subscriber, origin, lane)` cursor, `23503`-defer, echo guard, environment handshake) is
unchanged — only *where the enrolment is declared* moves.

## 6. Enablement and cross-node replication

The enabled-module set is a **deployment-wide** fact — every node of a venue runs the same modules, or
a mirror could not replicate a module's rows — with the **primary as source of truth**. The model is
**desired-state reconciled at boot**:

- **Desired state = an on-box module config file** naming the enabled modules and, for a swappable slot
  like fiscal, *which package* fills it. It is read at **startup, before migrations** — exactly when the
  decision is needed (§1.3) — and it is *persisted and mutable*, so install/remove is an edit to it.
- **Actual state = the `deployment` stamp** (the `id=1` singleton, `packages/db/drizzle/0010_deployment_stamp.sql`,
  which already carries mutable `mode`/`singleton_role`) records the module set the database was last
  migrated with. Boot **reconciles desired vs actual**: a module newly desired → run its migrations +
  provisioning seed; agreement → nothing; a module no longer desired → **soft-disable** (below). Drift is
  visible for free.
- **Install / remove takes effect on reboot.** Migrations are boot-time, so there is no online-migration
  path; editing the file and restarting is the whole flow ("may require a reboot" is the design, not a
  limitation).
- **Remove = soft-disable, data kept (owner decision).** Removing a module stops wiring it (routes, sync
  enrolment, UI cards, provisioning) and skips it at boot, but **leaves its tables and data intact** —
  re-enabling just re-wires, no loss. A separate, explicit, guarded **purge** is the only thing that
  drops tables, and it never applies to `core` or fiscal.
- **Tiers:** `core` is never in the file (always present); **fiscal is `provision-only`** — the
  jurisdiction's fiscal package fills the slot, chosen **by country at provisioning**, and once it has
  chained a record it is not removable (the records are immutable and legally retained); everything else
  is `toggleable`.

### Cross-node propagation

- **Each node runs its own migrations — schema is never synced, only data is.** The sync layer is
  application-level *row* replication (`sync_log` carries `row_image` jsonb, not DDL; native logical
  replication was deliberately rejected), and every node is an independent Postgres that runs the full
  manifest at boot today (`apps/server/src/boot.ts:505-508`, the mirror included). So installing a module
  does **not** mean "the primary migrates and the schema replicates" — it means each node, once its
  replicated desired set names the module, migrates **its own** database at its next reboot, and only then
  does the module's row data flow over sync. The primary never migrates a peer.
- **A schema-version gate makes the skew window safe — retention alone does not.** When the primary is
  migrated and a peer is not, retention holds the rows but does **not** make them *applicable*, and two
  failures lurk: a **new module's** rows hit a table the peer lacks (a loud wedge), and — the dangerous
  one — a **module upgrade's** rows carry a new column that `jsonb_populate_record(null::<table>, $1)`
  **silently drops** on the peer's older table, storing a row that looks complete but has lost a field.
  So a subscriber must **never apply a row from a schema version it has not itself migrated**. The gate:
  the hello handshake (which already carries the environment stamp) is extended to advertise each module's
  **migrated schema version**; a subscriber pulls only the modules in its **own** enabled set and applies
  rows only up to the version it has migrated — anything newer **parks** (never silently dropped, never
  wedged) until that node reboots and migrates. This is the same shape as the environment handshake, one
  axis over. Convergence for a schema change is a **rolling reboot** (already the model — each node reboots,
  migrates, resumes); the window in between is now safe rather than corrupting. No DDL crosses the wire.
- **The module set replicates.** A new secondary/mirror learns the primary's module set at **adopt** (it
  must, to migrate the right sets before any sync runs — so it rides the adopt handshake, like identity
  does today, `apps/server/src/adopt.ts`), and ongoing enable/disable **flows down** from the primary
  through the existing config channel into each peer's on-box file, applied on that peer's next reboot.
- **The module *code* must also be present on each node before it boots-and-migrates.** Two regimes:
  - **In-monorepo (the current build)** — for the Spain exemplar, `fiscal-verifactu` and every other
    package are in the monorepo build, so cross-node "install" is **config-only** and nothing has to
    distribute code. This is what lets SP-1..3 be built and the framework proven **now** — it is a
    property of *this build*, not a permanent claim about fiscal (§2).
  - **Runtime-installed (the target for fiscal itself, and for third-party modules)** — a
    country-selected fiscal module or a third-party module added to a running fleet: the code artifact
    must be fetched, **integrity-verified (signed by a trusted source — running fetched code makes
    trust mandatory)**, installed on every node, then enabled. This is a real distribution system, a
    **designed seam built later** (§10). Its **first consumer is fiscal itself** — a non-Spain venue
    installing its jurisdiction's fiscal module — so the seam is reserved deliberately, not speculatively.

## 7. The UI inversion (SP-4)

Invert the closed card system (§1) into a **card registry** the generic grid host reads: a module
registers each card's `CardContract` + render component + capability flags, and the host resolves cards
by lookup instead of a closed union and an exhaustive switch (the nine choke points map to registry
lookups). The **hard part is prop-threading**: today `till-app` feeds each card its domain props
(`stationQueue`, `cardProvider`, `zones`, `courses`…, `card-grid.ts:71-128`), so the host knows every
card. Inverted, cards become **self-sourcing** — the host passes only a **generic context** (the API
client, the current device/tab, theme), and each module's card fetches/subscribes its own data. That
refactor is the substance of SP-4.

**Coordination:** SP-4 touches exactly the files an in-flight session is editing for **SP-B3.2** (the
layout-designer grid editor — `@waitron/layouts`, `apps/till` card-grid, till-app). SP-4 is therefore
**sequenced after B3.2 lands**; SP-1/2/3 touch none of those files and proceed in parallel.

## 8. Decomposition and build order

Each is its own spec → plan → build → PR.

- **SP-1 — Module contract + registry + enablement.** The `WaitronModule` descriptor (the open
  contribution set, §3); the generic registries + composition-root registration; the version-compatibility
  check + dependency-graph/version-gated migration ordering (§4a) replacing the unenforced linear manifest;
  the on-box config file + `deployment`-stamp reconcile; the boot migration filter (`boot.ts:507`); the
  provisioning gate (`venue-apply.ts`) for module seed steps; cross-node config replication (adopt bootstrap
  + flow-down) with per-node migrate-then-enrol. *No UI. Parallel-safe with B3.2.* (SP-1 may itself split
  into slices — contract+registry, enablement+reconcile, versioned migration ordering, cross-node
  replication — settled in SP-1's own plan.)
- **SP-2 — Full sync inversion + schema-version gate.** `@waitron/sync` consumes module-declared
  enrolments, imports no domain schema; every package (core included) declares its own enrolment. Adds the
  **schema-version handshake** (§6): the subscriber pulls only its own enabled modules and parks rows newer
  than its migrated version — the anti-silent-corruption gate. *No UI.*
- **SP-3 — Fiscal as a module (delivers H2).** The fiscal module declares its sync enrolment (H2's
  fiscal-record lane — `registros_facturacion` insert-only + `registro_sif`/`cadenas`/`envios`/
  `envio_flujo`/`acks`), its vocabulary, and its gated provisioning; it is `provision-only`/swappable.
  The H2 spec's mechanism and gates carry forward here. *No UI.*
- **SP-4 — Module UI surface.** The card-registry inversion + self-sourcing cards + fiscal's cards.
  **After B3.2.**

## 9. Invariants preserved (receipts)

- **Fiscal core untouched in kind.** SP-3 replicates the immutable ledger verbatim and honours the
  append-only/FORCE-RLS/TRUNCATE guards on the subscriber exactly as the H2 spec details; provisioning
  still mints exactly one SIF per node at provision (`venue-apply.ts:158`), now gated on the fiscal
  module being the chosen slot, never toggled after.
  _(2026-09-05, SP-3c: the mint now runs through the fiscal module's `provisioning.seed`;
  `venue-apply.ts` imports no regime — see
  [`2026-09-05-module-sp3c-gated-provisioning-design.md`](2026-09-05-module-sp3c-gated-provisioning-design.md).)_
- **One database per environment** and the environment handshake are unchanged (SP-2 inherits
  `apply.ts:126-145`).
- **English-only guard preserved, not exempted-around.** The generic packages stay guarded; Spanish
  names live only in the exempt module + composition root (§4). No new whole-package exemption for a
  generic package — the exact thing the guard's own doc warns against.
- **Grants stay colocated with `CREATE TABLE`**, so a skipped/disabled module carries no orphaned grant
  loop (§1.3).

## 10. Out of scope (named, not gated)

- **Extracting the `core`-trapped domains** (kitchen, catalogue, tables, printing, recipes, purchasing,
  reporting) into their own module packages — incremental, each its own effort, needed before those
  become individually optional.
- **Runtime code-distribution** (§6) — signed module bundles, a trusted source, fetch/verify/install
  across nodes, versioning. A designed seam; built when a runtime-installed module first needs it. Its
  **first consumer is fiscal itself** (a non-Spain venue installing its jurisdiction's fiscal module,
  §2/§6), so this seam is what makes fiscal fully country-pluggable rather than monorepo-bound — deferred
  only because the Spain exemplar is in the current build.
- **Country / jurisdiction as a first-class deployment property** — today Spain is the only fiscal
  jurisdiction and `WAITRON_ENV` only distinguishes production/preproduction. Making country the selector
  of the fiscal slot (and any other jurisdiction-specific module) is part of fiscal's full realization,
  beyond the exemplar.
- **The full UI inversion beyond fiscal's cards** — other domains' cards migrate onto the registry
  incrementally (SP-4 builds the mechanism + fiscal's cards).

## 11. Interactions

- **H2 fiscal-record sync** — subsumed as SP-3; the standalone H2 spec/plan on `feat/h2-fiscal-record-sync`
  become reference material for SP-3, not a separate track.
- **SP-B3.2 (layout editor)** — in flight in another session; gates SP-4's start (§7).
- **Reserved-standby / membership (R-series)** — the adopt handshake this design extends to carry the
  module set is the same handshake R2/R3 use; SP-1's adopt change coordinates with that path.
- **Docs** — the backlog's Track-2 / SIF-topology menus gain a module-system row at SP-1 land.
