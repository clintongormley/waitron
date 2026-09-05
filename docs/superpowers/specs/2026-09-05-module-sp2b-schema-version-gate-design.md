# SP-2b — schema-version handshake + park gate

**Date:** 2026-09-05
**Status:** design. **Owner-reviewed:** scope decided 2026-09-05 under a standing "continue the modules
track, make rulings" instruction — the rulings below (§7) are recorded for the owner to countermand, not
gated on a per-question approval.

**Implements:** [module-system-architecture §6](2026-09-04-module-system-architecture-design.md) and the
SP-2b sketch in [sp-2a §6](2026-09-05-module-sp2a-sync-inversion-design.md#6-sp-2b-sketched-not-built-here)
— the second and final slice of SP-2. SP-2a inverted sync enrolment (each module declares its own
enrolment; `apps/server` assembles `ALL_SYNC_ENROLMENTS` and injects it). SP-2b adds the **schema-version
handshake + park gate**: the anti-silent-corruption mechanism that makes the cross-node schema-skew window
safe.

**Decides:** that the `/sync-api/hello` handshake advertises each module's **migrated** schema version;
that a subscriber **parks** (never applies, never drops) a row whose owning module the source has migrated
ahead of the subscriber, reusing the existing at-least-once park machinery; that module identity is stamped
onto the assembled enrolment so a row's module is resolvable at apply time; and that the "pull only your
enabled modules" source filter is **deferred** (cursor-unsafe today, no live case).

---

## 1. The hazard, precisely (why this slice exists)

Every node runs its **own** migrations; the sync layer replicates **rows**, not DDL (architecture §6, a
deliberate rejection of native logical replication). So during any schema change there is a **skew window**:
one node has migrated a module to a newer version and another has not. The apply path is
`insert into <t> select * from jsonb_populate_record(null::<t>, $1)` (`packages/sync/src/apply-sql.ts`),
and `jsonb_populate_record` **silently drops** any JSON key with no matching column on the target table. So
the dangerous direction is a **source ahead of the subscriber**: the source, migrated to v+1, writes a row
carrying a new column; the subscriber, still at v, applies it and silently loses that column — a row that
looks complete but is not. Retention alone does not fix this: it holds the rows but does not make them
*applicable*.

There is a second, louder failure in the same family — a **brand-new module's** rows hitting a table the
subscriber lacks entirely — but that surfaces as a hard error (`sync.table_not_enrolled` or a `42P01`),
not silent corruption. The silent one is the target of this slice.

The gate (architecture §6): **a subscriber must never apply a row from a schema version it has not itself
migrated.** Convergence for a schema change is a **rolling reboot** — each node reboots, migrates, resumes
— and this slice makes the in-between window *safe* rather than *corrupting*. No DDL crosses the wire.

## 2. Scope (owner rulings, §7)

**In scope — the version-park gate.** The `/sync-api/hello` handshake advertises each module's migrated
schema version; the subscriber parks a row whose owning module the source is ahead on, until the subscriber
reboots and migrates. This is the anti-silent-corruption gate, and it has a **live purpose today**: the
rolling-migration skew window is real even though nothing is toggleable.

**Deferred — the "pull only your enabled modules" source filter** (architecture §6's "a subscriber pulls
only the modules in its own enabled set"). Two receipts, both grounded (§7 ruling 1):

1. **It is cursor-unsafe with the current single per-lane cursor.** Excluding a module's tables from the
   source read while the lane cursor still advances to the batch's high settled seq moves the cursor
   **past** rows that were never delivered (`packages/sync/src/apply.ts:224-233` advances to `high`; the
   next fetch is `seq > cursor`, `source.ts:55`). If the subscriber later enables that module, its
   historical rows below the advanced cursor are **gone** — the exact silent gap this initiative exists to
   prevent. Safe source-side exclusion needs the exclusion to be monotone with the cursor (never re-include
   a previously-excluded table below the current cursor), which ties it to the enablement lifecycle.
2. **There is no live case.** Nothing is genuinely toggleable (SP-1b/SP-1d receipts: the practical
   toggleable set is empty). A subscriber's enabled set never differs from its peer's, so the filter would
   exclude nothing.

It is built alongside the first genuinely-toggleable module, designed against the enablement lifecycle then
— the same deferral shape as ongoing flow-down (SP-2a §7).

## 3. The mechanism reuses the proven park machinery (unchanged in kind)

`apply.ts` already parks rows and holds the cursor safely. Today the only park trigger is a `23503`
foreign-key violation (`tryApplyRow` returns the `"deferred"` sentinel, `apply.ts:301-316`). The
bookkeeping (`OriginProgress.deferred` set, `settleOrPark`, `apply.ts:73-78/186-197`) and the cursor-advance
(`eligible = settled.filter(s => [...deferred].every(d => s < d))`, `high = max(eligible)`,
`apply.ts:224-233`) guarantee a parked seq **holds the lane cursor strictly below itself**, so it — and
everything above it — is re-fetched (`seq > cursor`) and redelivered on the next batch until it applies.
**At-least-once, never-skip** (the comment at `apply.ts:224-227` states it; verified in the SP-2b
grounding).

**SP-2b adds a second park reason,** routed through the same machinery: before the FK-apply attempt, a row
whose **owning module's source version exceeds the subscriber's migrated version** is parked. Because it is
funnelled into the same `deferred` set, it inherits the cursor-hold and redelivery for free.

**One difference from the FK-defer, and it is already handled.** A `23503` park is self-healing *within* a
batch — the parent may arrive later in the same batch, so there is a retry pass. A **version** park is
**not** self-healing within a batch: the subscriber's migrated version only changes when it reboots and
migrates, so a version-parked row cannot land until a later pull *after* the subscriber has migrated. That
produces the "full page, `advanced === false`, all-parked" signature the drain loop already breaks on
(`packages/sync/src/pull.ts:60-64/199-218`) — it yields to the per-peer round-robin and the idle sleep
rather than busy-looping, and redelivery happens on a later round. So the version-park needs **no new drain
logic**; it slots into an existing shape. (The version-park is therefore skipped in the retry pass — retry
cannot change a version verdict within one batch — an implementation nicety, not a correctness point.)

**Telemetry, not folded into the FK counter.** `ApplyBatchResult.deferred` and the `deferred` count are
documented as "parked on a `23503`" (`apply.ts:63-70/186-197`). A version-park gets its **own** counter
(e.g. `ApplyBatchResult.versionParked`) and a log line, so an operator watching a rolling migration sees
"N rows parked awaiting this node's migration" distinctly from FK-defers. The gate is a normal operational
state, not an error — **no new error code** (§7 ruling 4).

## 4. The handshake and the version numbers

**`/sync-api/hello` gains `moduleVersions`.** Today it returns `{ nodeId, environment, membership }`
(`apps/server/src/sync-api.ts:121-130`). SP-2b adds `moduleVersions: Record<string, number>` — the
source's **applied** schema version per module (`appliedSchemaVersion(db, m.migrations)` for `m` in
`ALL_MODULES`, keyed by `m.name`). This is the row-count-of-the-drizzle-journal primitive SP-1a proved
(`packages/migrations/src/schema-version.ts:50`), the same number boot already computes for its reconcile
drift probe (`apps/server/src/boot.ts:578-590`) — except SP-2b keeps the **number**, not the `> 0`
boolean.

**It is a boot snapshot.** Migrations run only at boot (`boot.ts:557-560`), so a node's applied versions are
stable between reboots. The source computes its map once at boot (on the migrator connection, because
`appliedSchemaVersion`'s `42P01→0` catch must run auto-commit outside a transaction, `boot.ts:581`
records this) and injects it into `SyncApiDeps.moduleVersions`. `/hello` echoes it. Recomputing per
request would be correct but pointless; the snapshot is the clean fit.

**Applied vs applied, not expected.** The source advertises what its **database is migrated to** (its rows
are written under that schema); the subscriber compares its **own applied** version. `applied > applied`
is the exact condition under which the source's rows can carry a column the subscriber's table lacks.
(`expectedSchemaVersion`, what the *code* ships, is not used here — a node can ship code for v+1 but not
yet have migrated to it, and it is the migrated schema, not the shipped code, that the row must match.)

**The subscriber side.** The subscriber computes its own applied-version map at boot (it already runs this
exact loop, `boot.ts:581-584`) and threads it into the pull deps. `syncPullOnce` parses `moduleVersions`
off `helloBody` (parallel to how it reads `environment`, `pull.ts:111-115`) and passes both the source's
map and the subscriber's own map into `applyBatch` opts (parallel to `sourceEnvironment`,
`apply.ts:43-60`). The park predicate, per row: resolve the row's module `M`; park iff
`sourceModuleVersions[M] > subscriberModuleVersions[M]`.

**Robustness at the edges.** The predicate is `(source[M] ?? 0) > (subscriber[M] ?? 0)` → park — a missing
per-module version counts as **0** in the comparison, not as "skip the check". Two distinct edge cases fall
out of that, and they are not the same:

- **A peer that serves *no* `moduleVersions` map at all** (an older peer predating SP-2b) → the gate is
  **disabled entirely**, behaviour identical to today. This is the compatibility case, mirroring how
  `membership` already tolerates an older peer that omits its field (`pull.ts:70-75`). The subscriber
  detects "no map served" (the field is absent/undefined on `helloBody`) and skips the version gate.
- **A peer that serves the map but a specific module is missing from one side** → that module compares as
  0. A module absent from the *source* map (`source 0`) never parks (0 never exceeds anything). A module the
  *subscriber* is at 0 on (it has not migrated it) while the source is ahead **does** park — correctly, since
  the subscriber's table may be missing the source's columns (or the table itself). See the "always
  temporary" note below for why this cannot wedge today.

A subscriber that is *ahead* of the source (`subscriber > source`) never parks — applying an older row into a
newer table is safe (`jsonb_populate_record` fills only the columns present; missing newer columns take their
defaults), the normal steady state after the subscriber has migrated.

**The park is always temporary today — so it never permanently wedges the cursor.** A parked seq holds the
lane cursor strictly below itself (§3), so a row parked **forever** would stop the lane cursor advancing
past it forever — unbounded redelivery, a wedge. That only happens if the subscriber can never reach the
source's version for that module, i.e. it lacks the module **entirely and permanently**. Today that cannot
occur: **every node runs every module** (nothing is genuinely toggleable — SP-1b/SP-1d), so a version-park
is *always* the transient rolling-migration skew, cleared on the subscriber's next reboot-and-migrate, and
the cursor resumes. The permanent-lack case — a node that has *disabled* a module and will never apply its
rows — is precisely the deferred enabled-set pull filter's domain (§2): that filter must exclude a disabled
module's rows from the pull *from a known seq forward*, so they are never offered rather than parked forever.
So the version-park's safety and the enabled-set filter's deferral rest on the **same** fact — every node
runs every module today — which is why they are one decision, not two (§7 ruling 1).

## 5. Module identity at apply time

A `sync_log` row carries only `table_name` (`source.ts:52` → `SyncLogRow.table`, `apply.ts:33`). To gate by
module, apply must resolve `row.table → owning module`. But `ALL_SYNC_ENROLMENTS` **flattens away** the
module boundary — `ALL_MODULES.flatMap((m) => m.sync ?? [])` (`apps/server/src/modules.ts:134-136`)
discards `m.name`, and `EnrolledTable` (`packages/sync-enrolment/src/enrolment.ts:23-32`) has no module
field.

**Ruling (§7.3): build a `table → module` map at the composition root, and thread it into `applyBatch` —
do not stamp `module` onto each enrolment entry.** The composition root knows each module's name; it builds:

```ts
export const MODULE_BY_TABLE: ReadonlyMap<string, string> = new Map(
  ALL_MODULES.flatMap((m) => (m.sync ?? []).map((e) => [e.table, m.name] as const)),
);
```

and threads it (a `ReadonlyMap<string, string>`) into `ApplyBatchOptions` alongside the version maps
(§4). `applyBatch`'s gate resolves a row's module with `moduleByTable.get(row.table)`.

Why a side map, not a field on the entry: the per-package `*_ENROLMENT` arrays stay module-free (a package
should not repeat its own name), **and** the SP-2a enrolment type (`EnrolledTable`) and the deps that thread
it (`SyncApiDeps`/`SyncPullDeps`/`DrainProgressArgs.enrolments`) stay exactly as SP-2a landed them —
widening them to an `EnrolledTable & { module }` would ripple `module` onto every sync test fixture that
builds an enrolment array, for a concern only the apply gate has. The map is the smaller, better-scoped
change: only `ApplyBatchOptions` grows, and only the composition root builds the map. (Considered and
rejected: `AssembledEnrolment = EnrolledTable & { module }` threaded everywhere — larger blast radius on
SP-2a's just-landed threading and its fixtures, for no gain the map does not already give.)

## 6. Data flow (end to end)

1. **Boot (both nodes):** compute `moduleVersions = { m.name: appliedSchemaVersion(db, m.migrations) }` over
   `ALL_MODULES` on the migrator connection (the reconcile loop already does the `> 0` version of this).
2. **Source:** inject its map into `SyncApiDeps.moduleVersions`; `/sync-api/hello` returns it alongside
   `nodeId`/`environment`/`membership`.
3. **Subscriber pull:** `syncPullOnce` fetches `/hello`, parses `moduleVersions` (its own map is already in
   the pull deps), threads both into `applyBatch` opts.
4. **Apply:** for each row, resolve `module` via the dispatch map; if `source[module] > subscriber[module]`,
   park (funnel through the `deferred` machinery, hold cursor, increment `versionParked`); else apply
   normally. The environment gate (`apply.ts:126-145`) still runs first, unchanged — it refuses the whole
   batch on an environment mismatch before any per-module version check.
5. **Convergence:** the operator reboots the subscriber; it migrates the lagging module; its boot-snapshot
   version rises to ≥ the source's; the next pull re-fetches the parked seqs (held below the cursor) and
   applies them.

## 7. Rulings (recorded for the owner)

1. **Build the version-park gate; defer the enabled-set pull filter.** The gate has a live purpose (rolling
   migration) and is cursor-safe by construction; the filter has no live case and is cursor-unsafe with
   today's single per-lane cursor (§2). — Cost if wrong: if the owner wants the enabled-set filter now, it
   is an additive follow-up, but it must be designed against the enablement lifecycle to stay cursor-safe.
2. **Coarse per-module, not per-row.** The gate compares one version per module, not a per-row schema
   stamp; no `sync_log` schema-version column, no migration. — Cost if wrong: a coarse gate parks a
   module's *whole* set during the skew window, including rows written under the OLD version that would
   have been safe to apply; the cost is a slightly larger park set during a brief rolling-reboot window on
   a mirror (a failover target, not read live), which is proportionate. Per-row tagging would need a
   capture-trigger + `sync_log` change for a marginal window-size gain.
3. **Thread module identity as a `table → module` map built at the composition root** (§5), not as a field
   on each enrolment entry. — Cost if wrong: none material; the alternative (`module` on every entry) is a
   larger, more repetitive change that ripples onto SP-2a's threading and fixtures.
4. **No new error code; a telemetry counter + log for version-parks** (§3). The park is a normal
   operational state. — Cost if wrong: an operator lacks a distinct signal; mitigated by the dedicated
   counter and a log line.
5. **Boot-snapshot versions on both sides** (§4). — Cost if wrong: a version that changed without a reboot
   would be stale — but migrations only run at boot, so it cannot.

## 8. Testing

- **The park, real-Postgres, both directions of skew** (extends the apply-gate suite, real-PG because it
  exercises the actual `jsonb_populate_record` drop and the cursor). A source-ahead module → its rows park
  (not applied, `versionParked` counted), the cursor holds below them; then raise the subscriber's version
  for that module and re-deliver → they apply, cursor advances. **Proven by deletion:** remove the version
  check → the ahead-module row applies and silently loses the new column (assert the column is null/absent
  on the applied row) → restore → parked. This is the anti-silent-corruption proof; make the fixture a
  table with a column the subscriber's (older) schema lacks, so the drop is observable.
- **Subscriber-ahead and equal versions apply normally** (no park) — the steady state.
- **Older-peer tolerance:** a `/hello` with no `moduleVersions` (or a module absent from the map) → treated
  as no gate, behaviour identical to today (a unit/pull test with a hand-built hello body).
- **`moduleVersions` handshake wiring:** `/sync-api/hello` returns the source's per-module applied versions
  (a real-PG or hand-built-deps test); `syncPullOnce` parses and threads them (pull test).
- **Module identity:** `ALL_SYNC_ENROLMENTS` carries the correct `module` per table (a pin that each of the
  22 tables maps to its owning module — core/identity/payments), proven by deletion (drop the stamp → the
  gate can't resolve a module → a guard fails).
- **Behaviour-preserving with no skew:** every existing sync suite passes unchanged (equal versions → the
  gate never fires). The graph-honesty guard, parity pin, and real-PG completeness pin (SP-2a) are
  unaffected — no enrolment metadata moves.
- **The env gate still precedes the version gate** (`apply.ts:126-145` unchanged) — a version test must not
  weaken the environment refusal.

## 9. Invariants preserved (receipts)

- **The cursor/park machinery is unchanged in kind** — SP-2b adds a park *reason*, not a new cursor model;
  the at-least-once/never-skip property (`apply.ts:224-233`) carries the version-park unchanged (§3).
- **No migration, no grant, no schema change, no new error code** — the version numbers ride the existing
  `/hello` JSON; the gate is in-memory apply logic (§3/§7.4).
- **Behaviour-preserving with no skew** — equal versions never park; a pre-SP-2b peer that omits
  `moduleVersions` gates nothing (§4).
- **The environment handshake is untouched and still runs first** — the version gate is "one axis over,"
  finer-grained (per-module park) than the environment gate (whole-batch refuse), exactly as architecture
  §6 frames it.
- **Fiscal untouched** — fiscal enrols nothing yet (SP-3); no fiscal table is in the assembled set, so the
  gate never sees a fiscal row. The immutable-ledger guards are out of this slice's blast radius.
- **SP-2a's guards hold** — no enrolment metadata moves; parity/completeness/graph-honesty are unaffected.

## 10. Interactions

- **SP-2a** — consumes the assembled enrolment set and the injected-deps seam it established, unchanged; the
  new `MODULE_BY_TABLE` map is a sibling of `ALL_SYNC_ENROLMENTS` at the composition root, and SP-2a's
  `EnrolledTable` type and its threading are untouched (§5).
- **SP-1a** — consumes `appliedSchemaVersion` (the proved primitive) for both sides' version maps.
- **SP-1b/SP-1d** — the deferred enabled-set filter (and ongoing flow-down) is the same "first
  genuinely-toggleable module" trigger; SP-2b does not build it (§2).
- **SP-3 (fiscal as a module)** — once fiscal enrols its lane, its rows ride the same version gate for free;
  a fiscal schema change during a rolling migration parks rather than corrupts, which matters more for the
  legally-retained ledger than for any other table.
- **R-series (rolling reboot / adopt)** — convergence is the rolling reboot the membership work already
  models; SP-2b makes the window between reboots safe.
- **No UI** — parallel-safe with the B3.2 layout-editor session.
