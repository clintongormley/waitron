# `instance` plans a migrate on every run

**Date:** 2026-07-30
**Status:** implemented on `fix/provisioning-migrate-gate`. §1-§3 and §5 are the design as approved;
§4's second half is a post-implementation measurement, added once the code existed to run.
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

## 4. Cost, and the consequence that was measured

**Cost per no-op run**, read off `apply.ts:32-55` and `dialect.js:54-58` rather than measured: one
dedicated `pg.Client` connect for the lock, a `pg_advisory_lock`/`pg_advisory_unlock` pair, one
`createPostgresDb`, and then **per manifest set** a `CREATE SCHEMA IF NOT EXISTS "public"`
(`dialect.js:54`), a `CREATE TABLE IF NOT EXISTS <journal>` (`:55`) and a journal read (`:56-58`).
No timing is claimed here, and none is needed — the alternative is a gate that silently skips
required work.

The first two of those three are **not privilege-free**, which is what the paragraph below turned
out to be about: PostgreSQL checks the privilege for an `IF NOT EXISTS` statement before it
evaluates whether the object exists (`apps/server/README.md`, "Two connection strings, one purpose
split"), so `CREATE SCHEMA` needs database-level `CREATE` and `CREATE TABLE` needs `CREATE` on
`public`, on every run, whether or not either object is already there. An earlier version of this
section listed only the lock and the journal reads, and the comment it was drafted alongside
(`instance-plan.ts`) went further and said re-running the migrator "cannot be wrong" — falsified by
this section's own measurement, one paragraph down.

**The consequence, now measured rather than reasoned about.** An admin that can read inside the
target database but cannot create objects in it: before this change a fully-journalled re-run
planned no `migrate` and exited 0; after this change it attempts migrations, and does fail.

Reproduced in a container, not extrapolated: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/provisioning test instance-apply.rls`, against `postgres:18-alpine`
(`instance-apply.rls.test.ts`'s "a partially-privileged admin reads state but fails the migrate"). A
role holding `CONNECT` on the target database and `SELECT` on `deployment`, but no `CREATE` on
`public` and no ownership of either object, is created and probed with its own credentials for every
step, including `migrate`'s own internal reconnect (see the note on the probe's first draft, below).
`readInstanceState` over that role succeeds completely — all five manifest sets read as journalled,
the stamp reads `preproduction` — so this admin reaches the planner, which emits `{ kind: "migrate" }`
as its first action, exactly as §2/§3 above describe. `applyInstance` then fails on that action with:

```
DrizzleQueryError: Failed query: CREATE SCHEMA IF NOT EXISTS "public"
cause: error: permission denied for database waitron_instance_suite
  code: '42501', file: 'aclchk.c', routine: 'aclcheck_error'
```

raised by the statement at `drizzle-orm@0.45.2/pg-core/dialect.js:54`, inside `PgDialect.migrate` —
the same line §1 cites. **Cite the `.js`.** The stack trace names this frame
`pg-core/dialect.ts:85`, and that file does not exist: the installed package ships `dialect.js`,
`dialect.cjs`, `dialect.d.ts`, `dialect.d.cts` and two maps, and nothing else. `.ts:85` is the
shipped source map talking — `dialect.js.map`'s `sources` is `["../../src/pg-core/dialect.ts"]`,
with `sourcesContent` — so it resolves in a debugger and not in an editor. A reader who takes it
literally and opens `dialect.js:85` lands inside `buildWithCTE`, an unrelated method (checked in
the installed copy: `escapeString` is `:79-81`, `buildWithCTE` opens at `:82`).

The call chain, caller first — which is the reverse of the order the stack trace prints it, and of
how an earlier version of this line wrote it: `packages/provisioning/src/instance-apply.ts:183`
(the `migrate` case) → `packages/migrations/src/apply.ts:45` → `packages/db/src/migrate.ts:48` →
Drizzle's own migrator.

It fails there before any journal table is read. Drizzle's migrator issues
`CREATE SCHEMA IF NOT EXISTS "public"` unconditionally at the start of every `migrate` call, whether
or not the schema already exists, and schema creation is a database-level `CREATE` privilege in
PostgreSQL — exactly the one this admin was deliberately never granted.

**The failure is not one of this package's `AppError`s.** `instance-apply.ts`'s `migrate` case
carries no `try`/`catch`, unlike `create-role` and `grant-membership`, so the raw driver failure
reaches the caller unclassified. `cli.ts`'s `reportFailure` rethrows anything that is not an
`AppError`, and `bin.ts`'s top-level catch prints `unexpected failure (${error.name})`. Run through
the built bundle, not traced: `pnpm --filter @waitron/provisioning build`, then a real
`postgres:18-alpine` container migrated and stamped by a full admin exactly as above, then
`WAITRON_ADMIN_DATABASE_URL=postgres://partial_admin:p@<host>/postgres node dist/bin.js instance
--database waitron_probe --environment preproduction --yes` — exit code `1`, stderr **exactly**
`unexpected failure (Error)`, not `(DrizzleQueryError)`. The reason is `error.name`, not
`error.constructor.name`: `drizzle-orm@0.45.2`'s `DrizzleQueryError` (`errors.js`) extends `Error`
directly and never sets `this.name`, so it inherits the prototype's `"Error"` — only the sibling
`DrizzleError` class sets `this.name = "DrizzleError"` in its constructor, and a failed query is a
`DrizzleQueryError`, not that. An earlier version of this paragraph asserted `(DrizzleQueryError)`
while labelling itself "traced rather than run" in the same sentence — the hedge was correct and the
assertion past it was not; this is what actually running it prints. Reclassifying this into a
`provisioning.*` code is a real gap this measurement surfaces; it is recorded here, not fixed here —
out of scope for a docs-and-reproduction task.

**A narrower shape was not tested, and nothing is claimed about it.** This role held no `CREATE` on
the database at all, which is what let schema creation fail first, before a single journal table was
read. Whether an admin holding `CREATE` on the database but refused only on the already-existing
`public` schema specifically would get further — past schema creation and into the journal reads
themselves, perhaps failing later or not at all — is a different, narrower fixture this measurement
does not speak to.

**A defect in the reproduction's own first draft, worth recording alongside the finding.** The test
helper this suite already had, `deps(as, database)`, built `ApplyDeps` by closing over the outer
`adminUri` regardless of `as`, so an initial `deps(probeAdmin)` ran the `migrate` action's internal
reconnect (`applyMigrations(withDatabase(deps.adminUri, ...))`) as the fully-privileged admin instead
of the role under test, and printed a spurious "APPLY SUCCEEDED" that measured the wrong role
entirely. The helper now takes a third parameter, `uri`, defaulting to that same outer `adminUri`;
the committed test passes `probeUri`, so every action — including `migrate`'s own reconnect — runs as
the under-privileged admin. That the parameter is load-bearing was proven by mutation rather than
argued: dropping it (`deps(probe, DATABASE)`) and running
`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test instance-apply.rls -t "a
partially-privileged admin reads state but fails the migrate"` fails at
`instance-apply.rls.test.ts:610` with `AssertionError: expected null to be '42501'` — nothing was
thrown, because the migrate ran as `prov_admin`.

The adjacent case is already refused earlier — `cli.ts:283-287` records, from a run through the built
bundle, that an admin which did not create the target database fails the stamp read with
`permission denied for table deployment` (42501) and surfaces as `provisioning.state_unreadable`
before the planner is ever called. That receipt is for a differently-deprived admin — one refused
before the planner runs at all — and the measurement above is what now covers the partially-
privileged admin this section used to leave open.

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

**Making `status` say what actually applied** is deferred here rather than merely rejected, and is
recorded so a future session does not re-derive the decision from scratch. §2's "Alternatives
rejected" turns down comparing journal ROWS against each set's `meta/_journal.json` **for the
planner** — the planner does not need that precision, because re-running an idempotent migrator is
cheaper than a check that can be wrong. But the same comparison would let `status` report
"core: 4 of 4 applied" instead of `journal present`, and that is a real improvement this change
deliberately does not make: it would pull the migrations root, and therefore a filesystem read, into
a command that is DB-introspection-only today. The reasoning against it is about the planner; anyone
revisiting it **for the report** is looking at a different trade-off and should weigh it afresh
rather than treating §2 as having settled it.
