# `instance` plans a migrate on every run

**Date:** 2026-07-30
**Status:** approved, not yet implemented
**Package:** `packages/provisioning`

Closes the first of the five follow-ups deferred from PR #11
([handoff](../../handoffs/2026-07-30-provisioning-instance-landed.md) §5), the one recorded there as
a product decision rather than a cleanup.

---

## 1. The defect

`planInstance` emits `migrate` only when some manifest set's journal table is absent
(`packages/provisioning/src/instance-plan.ts:132-133`):

```ts
const applied = new Set(state.inside?.migratedSets ?? []);
if (manifestSets().some((set) => !applied.has(set.name))) actions.push({ kind: "migrate" });
```

`migratedSets` is journal-**table** existence, not "this set finished" — `readInside` probes each set
with `to_regclass` (`instance-state.ts:120-132`). Those two facts are not the same, and Drizzle's own
migrator is what separates them. Read directly from
`node_modules/.pnpm/drizzle-orm@0.45.2*/node_modules/drizzle-orm/pg-core/dialect.js`, not inherited
from the existing comment that cites it:

- **`dialect.js:54-55`** runs `CREATE SCHEMA IF NOT EXISTS` and then the statement built at
  `dialect.js:48-51` — `CREATE TABLE IF NOT EXISTS <schema>.<table> (id SERIAL PRIMARY KEY, hash text
NOT NULL, created_at bigint)` — **before** anything else.
- **`dialect.js:60`** opens `session.transaction`, and every one of the set's migrations runs inside
  that single transaction.

So an `instance` interrupted inside a set rolls the set's migrations back and leaves its journal
table behind, because the table was created outside the transaction that was rolled back. Every
journal is then present and the set is empty.

**The consequence.** A re-run reads every journal as present, plans no `migrate`, issues the grants,
writes the stamp and exits 0 — reporting a provisioned deployment whose last set never ran. That is
the same "reports success having done nothing" shape as the ineffective-`GRANT` defect that
`verifyGrants` was written to close, one file over.

`status` already discloses this (`status-command.ts:40-66`, `README.md:109-115`), which makes the
report honest and the tool still wrong: disclosure is not repair.

## 2. The decision

**`planInstance` emits `migrate` unconditionally.** `migratedSets` stays, as a field `status` reads
and the planner does not.

This is the reasoning the same function already applies to grants, quoted from
`instance-plan.ts:158-163`: *"Issuing both unconditionally is cheaper than a check that can be
wrong."* A gate whose input cannot express the thing it gates on is such a check.

It is also what the design spec asked for.
[`2026-07-29-provisioning-tool-design.md`](2026-07-29-provisioning-tool-design.md) §4 gives the
Migrations row's existence check as *"the migrator's existing advisory lock and journal — already
idempotent"*, delegating idempotency to the migrator. The shipped code added a second, weaker gate in
front of it. This change removes that gate rather than adding to the spec.

**Why the delegation holds.** `applyMigrations` serialises on a fixed advisory key held on a
dedicated client (`packages/migrations/src/apply.ts:32-55`), and
`packages/migrations/src/apply.concurrency.test.ts`'s *"serialises on the advisory lock and leaves
one journal row per migration"* is the standing receipt for two hosts racing it. Within a set,
Drizzle skips what is already recorded — `dialect.js:61-62` applies a migration only when
`!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis`.

Note what that condition **is**: a watermark against the single most recent journal row
(`dialect.js:57` selects `order by created_at desc limit 1`), not a per-migration hash check. It
is the right primitive for "resume a set that stopped part-way", which is exactly the state this
change exists to repair, and it means an empty journal table replays the whole set.

### Alternatives rejected

- **Compare journal rows to each set's `meta/_journal.json`.** Precise enough to plan `migrate` only
  when something is genuinely pending, and it would let `status` say "core: 4 of 4 applied". Rejected
  on surface area: `readInstanceState` would need the migrations root, which is an apply-time
  dependency today (`ApplyDeps.migrationsRoot`), and `status` would grow a filesystem read it does
  not currently have. It buys precision in a plan summary at the cost of a second thing that can be
  wrong about which migrations exist.
- **Keep the gate, sharpen the wording.** Cheapest, and rejected because it leaves the hole open. The
  handoff records this defect's shape as the one `verifyGrants` already had to close; closing it in
  one place and documenting it in the other is not a position worth holding.

## 3. What changes

| File | Change |
| --- | --- |
| `src/instance-plan.ts` | Delete the gate; push `{ kind: "migrate" }` unconditionally in the same position. Drop the now-unused `manifestSets` import. |
| `src/instance-plan.ts` | `describeAction`'s `migrate` case → `"apply any pending migrations, in every set"`. |
| `src/instance-state.ts` | `InsideState.migratedSets`' doc comment: same meaning, new justification. |
| `src/status-command.ts` | Closing caveat: replace the last clause; keep the `dialect.js` receipt. |
| `README.md:109-115` | The same sentence, the same correction. |
| `docs/superpowers/specs/2026-07-29-provisioning-tool-design.md` | Dated note under §4. |

**Position is unchanged.** `migrate` stays after `create-database` and before every `create-role`.
That ordering is not stylistic and its receipt stays with it: `app_user` and `tenant_provisioner` are
created *by* the core set (`0001_tenancy_rls.sql:18`, `0011_provisioner_role.sql:58`), so
`create role … in role app_user` against a blank cluster fails `role "app_user" does not exist`
(42704) — which is how the tool failed on its first end-to-end run.

**Three places carry a justification that stops being true**, and each is the kind of thing this
repository's §1 exists for — a sentence that stays behind after the code it described moved. The
third is not a comment but printed output, which makes it the one that matters most:

- `instance-state.ts:36-38`: *"the planner only needs to know whether migrating is worth attempting
  at all, and it attempts it whenever anything is missing."* False as soon as the planner stops
  reading the field. Rewritten to say it is a report field whose only consumer is `formatStatus`.
- `status-command.ts:51-53` and `README.md:112-113`: *"a re-run of `instance` will NOT repair, since
  the planner emits `migrate` only when a journal is missing."* Becomes the opposite of the truth.
  Rewritten as the remedy — a re-run of `instance` applies whatever is still pending.
- **`status-command.ts:61-66` is the same claim in printed output**, not a comment: the report ends
  *"`instance` plans a migrate only when a journal is MISSING."* An operator reads this one. It is
  the reason `status-command.test.ts` has to assert the old clause is gone rather than only that a
  new one is present.

The reason `journal present` is weaker than `applied` does **not** change, and neither does its
citation: `status` still cannot distinguish a started set from a finished one, so the per-set lines
and the `dialect.js:54-60` receipt stay exactly as they are.

`instance-plan.ts`'s header paragraph ("**The result is never empty**") stays true and gains
`migrate` as a second reason alongside the two unconditional grants.

## 4. Cost, and one consequence that is not yet verified

**Cost per no-op run**, read off `apply.ts:32-55` rather than measured: one dedicated `pg.Client`
connect for the lock, a `pg_advisory_lock`/`pg_advisory_unlock` pair, one `createPostgresDb`, and one
journal read per manifest set. No timing is claimed here, and none is needed — the alternative is a
gate that silently skips required work.

**The consequence I have not reproduced.** An admin that can read inside the target database but
cannot create objects in it: today a fully-journalled re-run plans no `migrate` and exits 0; after
this change it attempts migrations and may fail 42501.

The adjacent case is already refused earlier — `cli.ts:283-287` records, from a run through the built
bundle, that an admin which did not create the target database fails the stamp read with
`permission denied for table deployment` (42501) and surfaces as `provisioning.state_unreadable`
before the planner is ever called. **That receipt does not cover a partially-privileged admin**, and
extrapolating from it is precisely the move §1 of `CLAUDE.md` forbids.

**Implementation must therefore do one of two things and say which:** reproduce the partially-
privileged admin in a container and record what happens, or state in the commit that the consequence
is unverified. It must not be asserted in either direction from reading.

## 5. Testing

**RED first, and the existing suite supplies it.** `instance-plan.test.ts`'s "plans only the
idempotent grants" asserts an exhaustive `toEqual` against a fully-provisioned state
(`migratedSets` listing all five sets), so it goes red the moment `migrate` becomes unconditional.
That failure is the starting point, not an obstacle — the assertion is doing its job.

| Test | Target | What it pins |
| --- | --- | --- |
| every set journalled → plan still contains `migrate` | pure | The decision. Proven by deletion **in reverse**: restore the gate, confirm this test fails. |
| `instance-plan.test.ts:140` (`migratedSets: ["core"]`) | pure | Stops discriminating — every state now yields `migrate`. Repurposed or deleted, not left as a test that cannot fail. |
| `describeAction` on `{kind:"migrate"}` | pure | The new wording. |
| `status-command.test.ts` | pure | The new caveat, and that the old clause is gone. |
| `cli.test.ts` | pure | The fully-provisioned fixture's plan summary now carries the migrate line. The "never puts a generated password in the plan summary" counter is unaffected. |
| interrupted-set repair | **real Postgres** | The defect itself. |

**The container test is the one that matters** and it is the only new heavy suite. PGlite cannot
substitute: this needs the real migrations applied by the real migrator.

The shape to construct is "every journal table present, the LAST set empty" — that is what makes
today's planner and the new one disagree. Build it forwards, never by damaging a migrated database:

1. Create the target database and run `applyMigrations` over `manifestSets().slice(0, -1)` — every
   set but the last, applied for real by the real migrator.
2. In that database, create the last set's journal table by hand with Drizzle's own shape, read out
   of `dialect.js:48-51`: `id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint`, zero rows.
   All five journals are now present, four sets are complete and one is empty — §1's post-rollback
   state exactly.
3. Run `instance`. Today's planner reads five journals, plans no `migrate`, issues the grants, writes
   the stamp and **exits 0** with the last set never applied. The new one plans `migrate`;
   `lastDbMigration` is `undefined` for that set alone, so `dialect.js:62` applies it in full while
   the other four are skipped by the watermark.
4. Assert against the schema, not the journal — a table belonging to the last set now exists — since
   journal presence is the very signal being shown to be insufficient.

**Why not the simpler "no set applied at all" variant**, i.e. pre-creating all five journal tables
against an empty database: it does not reproduce this defect. `deployment` is itself created by a
migration, and `stampDeployment` INSERTs into it after `readDeploymentEnvironment` returns `null` for
an absent table (`packages/db/src/deployment.ts:39-41`), so today's tool would **fail** on the stamp
rather than exit 0. A test built that way would pass while demonstrating the wrong thing — a louder
failure, not the silent one this change exists to close.

Damaging an already-migrated database instead would need each set's table list and would have to
respect the inbound foreign keys `apply.ts:43-44` records (`core` carries `tenants`, which every
other set references). Neither is under test.

`TESTCONTAINERS_RYUK_DISABLED=true` is required locally.

**Gate:** `pnpm --filter @waitron/provisioning test:coverage` **unfiltered** — a name-filtered run
does not load a package's cross-cutting guard suites — then
`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` from the root.

## 6. Out of scope

The four remaining follow-ups from the handoff's §5 — structural password redaction, extracting
`createTerminalIo` out of `bin.ts`, collapsing `ApplyDeps.database` against the action list, and the
duplicated order-tracking IO fixture. None is a dependency of this change.
