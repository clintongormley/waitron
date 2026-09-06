# Drop row-level security, collapse the roles, squash the migrations, delete the outbox

**Date:** 2026-09-05. **Status:** design, awaiting owner review; Track A item 3, with item 4's swap
folded in as one chain (owner decision below).
**Inputs:** the owner's brief for item 3 (`docs/backlog.md` → Whole-project design review → Track A),
the two prototype findings
([2026-08-02](2026-08-02-replication-force-rls-prototype-findings.md),
[2026-09-05](2026-09-05-native-replication-post-rls-prototype-findings.md)), the swap spec
([2026-09-05-outbox-to-native-replication-swap-design.md](2026-09-05-outbox-to-native-replication-swap-design.md)),
and a brainstorm with the owner the same evening.

## 0. Decisions taken with the owner (2026-09-05)

1. **All at once.** Nothing is deployed, so item 3 does not keep the outbox alive for the swap to
   replace later: the chain below removes row-level security, collapses the roles, squashes the
   migrations, and deletes the outbox, ending in the swap spec's end state. The swap's slices are
   steps of this chain, not separate items.
2. **One signature, on step 4.** The "[owner] at land" mark applied literally would mean five
   sign-offs. Only step 4 changes what happens to a fiscal record in a way no diff can prove (rows
   start flowing through Postgres; the immutability trigger starts firing for the replication
   process). Steps 1, 2, 3 and 5 land as ordinary pull requests; step 1 carries its mechanical
   proof in the PR.
3. From the brief, unchanged: keep `tenant_id` columns and composite foreign keys; keep the
   owner-vs-app split; keep `withTenant` as the transaction primitive with its session variable
   hollowed out; a superuser stays refused by the provisioner.

## 1. The end state

Numbers measured on `main` at 5af4a4d5, 2026-09-05 (commands in Provenance):

| | Today | After |
| --- | --- | --- |
| migration files | 179 across nine modules (core 111) | about 18: one generated + one hand-written baseline per module |
| `CREATE POLICY` | 95 | 0 |
| `ROW LEVEL SECURITY` switches | 190 | 0 |
| database roles the migrations create | 8 (`app_user` + 7 helpers) | 1 (`app_user`) |
| logins the provisioner creates | migrator, app | migrator, app, replication |
| `*.rls.test.ts` suites | 122 (50 in `apps/server`, 29 in `packages/db`) | 0 |
| functions / triggers / grants carried | 15 / 62 / 209 | the same, minus `current_tenant_id()`, the capture triggers and the helper-role grants |
| outbox tables | 4 | 0 |

**Kept.** Every `tenant_id` column and every composite FK (the schema's shape does not change);
`withTenant(db, tenantId, fn)` as the only way a route opens a transaction — it stops calling
`set_config('app.tenant_id', …)` and instead asserts that `tenantId` is the one tenant the database
holds (read once at boot from `tenants`; a mismatch throws `tenancy.wrong_tenant`, a new code) —
and `app.node_id` goes with the capture triggers in step 4; the owner-vs-app split (`waitron_migrator`
owns every table, `waitron_app` is a `LOGIN` member of the `NOLOGIN` `app_user`); every append-only
trigger and every grant that stops the app updating or deleting a fiscal record, a sale, a tender, a
settlement, a void, a substitution, a daily close, an order amendment or a clock-in (none of which
ever depended on RLS: the prototype's `permission denied` for `waitron_app` on `registros_facturacion`
came from the grants alone).

**Deviation (2026-09-06, step 1 as landed).** `withTenant` does not assert the single tenant at
runtime — it keeps `tenantId` as an explicit write-path parameter but reads no tenant at boot and
throws no `tenancy.wrong_tenant`. Many suites seed more than one tenant for reasons unrelated to
isolation, so a runtime one-tenant assertion would break them; the one-tenant property is enforced
where tenants are created and by `app_user` holding no INSERT on `tenants`, pinned by the privilege
matrix.

**Correction (2026-09-06, finish-branch fix wave).** "Enforced where tenants are created" was
aspirational, not real, when the line above was first written: nothing refused a second obligado.
There are TWO production tenant-creation paths — the setup-api provision handler (`provisionVenue`,
the UI's `POST /setup-api/provision`) and the `venue` CLI (ops/dev) — and the first fix guarded only
the CLI, so the UI gap stood. Both now read the existing `(country, tax_id)` set before applying and
throw `provisioning.foreign_tenant` for any identity but the one already present (the same identity
re-provisions, D8; an empty database is the first tenant), through ONE shared decision —
`assertNoForeignTenant` (`packages/provisioning/src/tenant-guard.ts`) — both renamed to obligado, and a
third entry point (mirror adopt) added, by the 2026-09-06 correction below. The guard lives at those
entry points, NOT in `applyVenue`: ~50 real-PG suites provision many distinct obligados through
`applyVenue` into one shared container by design ("each test gets its own tenant so its state is
order-independent"), and a guard inside `applyVenue` would break all of them while enforcing nothing
production does not already route through the two entry points.

**Correction (2026-09-06, adopt-guard fix wave).** The correction above found TWO tenant-creation
paths; there is a THIRD — the mirror adopt orchestrator (`adoptFromPrimary`, `apps/server/src/adopt.ts`),
which `adoptVenue` inserts a tenant through and which stood UNguarded (a foreign bundle adopted into
an occupied instance database would have stood up a second obligado, worst of all on the box where
hash-chained fiscal rows later flow in by sync). It now shares the same guard. The guard, its types
and its error were also renamed off the infra word "tenant" onto the fiscal concept they enforce:
`assertNoForeignObligado` / `readObligadoIdentities` / `ObligadoIdentity` in
`packages/provisioning/src/obligado-guard.ts`, error `provisioning.foreign_obligado`. The `tenants`
table, `withTenant` and `tenant_id` (legitimate multi-tenancy infra) keep their names.

**Gone.** All 95 policies and 190 `ENABLE`/`FORCE` switches; `current_tenant_id()`; the
`sync_log` / `sync_cursor` / `sync_peers` / `sync_config_conflicts` tables, `sync_capture()` and
every capture trigger, and the `app.sync_apply`-gated variants of the `0037` triggers (they become
plain triggers); the seven helper roles.

**The seven helper roles, one by one.** Five of them exist to OWN a `SECURITY DEFINER` "seam"
function: the app calls the function, the function runs as the helper role, and the helper role's
permissive policy lets it read across the tenant boundary the app's own policy would refuse
(`packages/credentials/drizzle/0002_credentials_tenant_seam.sql`, `packages/db/drizzle/0005_sales.sql`
say so in their headers). Without policies there is no boundary to cross:

| role | what it is for today | after |
| --- | --- | --- |
| `tenant_provisioner` | membership for `waitron_migrator`, to insert the tenant row under RLS | the owner inserts directly; no role, no grant |
| `credentials_enumerator` | owns `credential_tenants(text)`, called by `packages/credentials/src/store.ts` | function becomes invoker-rights, owned by the migrator; role dropped |
| `envios_drainer` | owns `envios_tenants_with_work()`, called by the fiscal drain (`drain.ts`) | same |
| `payments_webhook_resolver` | owns `resolve_payment_tenant(…)`, called by the Stripe webhook route | same |
| `sales_coverage_checker` | owns `sales_assert_tenders_cover(uuid)` and `sale_settlements_check_coverage(…)`, the deferred tender-coverage checks | same — `0005_sales.sql` explains the `DEFINER` existed to close a fail-open hole *under RLS*; without RLS invoker rights is the plain reading |
| `sync_tailer`, `sync_retention` | the outbox source, cursor and retention paths | fold into `app_user` in step 1 so the outbox keeps running; deleted with it in step 4 |

`app_user` still does not get `INSERT` on `tenants`, `nodes`, `locations` beyond what it holds
today: creating those is the owner's job at provisioning, and CLAUDE.md §3's "never widen a grant"
stands. The grant matrix that results is the per-module grant suite in §4.

**Replication (from the swap spec, unchanged here):** every trigger calling `reject_mutation()` is
`ENABLE ALWAYS`; `track_commit_timestamp = on`, `max_slot_wal_keep_size = 4GB`, `wal_level =
logical` are instance settings the provisioner writes; the replication login and
`pg_create_subscription` are the provisioner's one superuser step.

## 2. The squash, and its proof

Per module, in manifest order (`core`, `identity`, `workforce`, `workforce-es`, `payments`,
`scheduler`, `credentials`, `sync`, `fiscal`): delete `drizzle/*.sql` and `drizzle/meta/`, then

1. `drizzle-kit generate --name baseline` — the DDL Drizzle derives from the module's schema as it
   is today: tables, columns, constraints Drizzle knows, indexes, FKs. One file, one snapshot.
2. `drizzle-kit generate --custom --name baseline_sql` — the hand-written SQL Drizzle does not know,
   carried verbatim from the old files in their original order: `CREATE FUNCTION`s, `CREATE
   TRIGGER`s, `GRANT`/`REVOKE`s, `CREATE ROLE app_user NOLOGIN` (core), the `ENABLE ALWAYS` lines.
   Nothing rewritten, nothing "tidied": the proof below is what lets a reader trust it.

The manifest and the per-module bookkeeping tables (`__drizzle_migrations_<module>`) are unchanged;
each journal shrinks to two entries. `expectedSchemaVersion` (SP-2b) reads a journal's length and
would report 2 for every module — it is deleted in step 4 with the gate it served, and nothing is
deployed to be confused in between (CLAUDE.md §3, "no backwards-compatibility code until
production").

**The proof, before step 1's PR opens.** Two `postgres:18-alpine` containers. Apply the OLD
migrations (all 179, as the migrator role) to one and the NEW baselines to the other. `pg_dump
--schema-only --no-owner` both. Normalise the old dump by removing exactly the objects this design
deletes — `CREATE POLICY …`, `ALTER TABLE … ROW LEVEL SECURITY`, `current_tenant_id`, the seven
`CREATE ROLE`s and every `GRANT`/`REVOKE` naming them, the `SECURITY DEFINER` clauses of §1's
table — and the new dump by removing the `ENABLE ALWAYS` lines. **The diff must be empty.** The
script, both dumps and the diff go in the PR; the command goes in the commit message. A non-empty
diff is a defect in the baseline, never something to normalise away.

Behavioural receipts in the same PR, all as `waitron_app` on the migrated container: `UPDATE
registros_facturacion` → `42501`; `INSERT` succeeds; `DELETE`/`TRUNCATE` → `42501`; as
`waitron_migrator`: `UPDATE` → `reject_mutation`'s error. (The prototype produced the first and the
last on the stripped schema; the PR repeats them on the baselines.)

## 3. The chain

Each step is its own plan and pull request, green on its own, landing on `main` in order. Only step 4
waits for the owner's signature.

1. **Baselines + RLS gone + roles collapsed + tests.** The nine baselines of §2, with the outbox
   tables still present (as plain tables, no fencing) so the outbox code compiles and its tests pass
   until step 4. `withTenant` hollowed. The 122 `*.rls.test.ts` read, then deleted; their
   privilege facts moved into the grant suites (§4); `asAppUser`, `ProbeRole`, `inmutabilidad`
   reshaped (§4). The provisioner's role list shrunk (§5). CLAUDE.md §2–§4 rewritten (§6). The
   proof of §2 attached. **Largest diff of the chain, all mechanical.**
2. **Classification contract, guards, two-node fixture** — swap spec S1. `classify()` replaces
   `enrol()`'s modes and lanes in `packages/sync-enrolment`; the root guards "every table classified
   exactly once" and "every `reject_mutation` trigger is `ENABLE ALWAYS`"; the two-container harness
   seeded from the prototype scripts. Additive; the outbox still runs on the old enrolment data
   until step 4.
3. **Provisioning** — swap spec S2. The superuser step, publications and subscriptions on adopt, the
   WireGuard key in the bundle, environment refusal, the three instance settings. Proven against the
   fixture; proven on real machines by Track B item 2.
4. **Promotion and return on Postgres's numbers, and the outbox deleted** — swap spec S4 + S5 in one
   PR, because `rejoin`, `retire`, `box-status` and the R3 promotion read the outbox until they read
   `pg_replication_slots`. Deletes: the `packages/sync` source files of the swap spec §7, the four
   tables (a second regeneration of the `sync` module — its baseline becomes the thin native layer's,
   or empty), the capture triggers from every module's custom baseline, `sync-api.ts` and its
   siblings, the pull/retention workers in `boot.ts`, the sync-token half of the mirror bundle, the
   SP-2b gate, the settings-conflict gate, and every test of those. **Owner signs this one:** it is
   where fiscal rows first flow natively and where `ENABLE ALWAYS` first matters.
5. **Status, alarms, the standby-first migration check, the link on the box image** — swap spec S6
   + S7, with Track B item 2.

**Between 2 and 4:** the working-time chain's per-node rekey (swap spec §4.4), its own brainstorm and
PR, owned by workforce. Step 4's drain of `time_entries` is unsafe without it.

## 4. Tests and the harness

- **Read before deleting.** Each `*.rls.test.ts` is opened and its non-RLS assertions listed: what
  the app role may `SELECT`/`INSERT`/`UPDATE`/`DELETE` on which table, which write a trigger
  refuses, which privilege a probe role lacks. Those move; the isolation assertions (tenant A cannot
  see tenant B) are deleted, since there is no tenant B.
- **Grant suites, one per module**, real Postgres, as `waitron_app` through `asAppUser`: a table of
  (table, verb) → allowed/`42501`, derived by hand from the baseline's `GRANT`s and checked against
  the live `has_table_privilege()`, plus the trigger refusals as the owner. `asAppUser` keeps its
  `SET ROLE` and loses its `set_config`. `ProbeRole` keeps its membership shape (the grant probes use
  it) and loses its tenant half.
- **`inmutabilidad` is rewritten** into the swap spec's guard: every table that must be append-only
  has its `reject_mutation` pair, and each is `ENABLE ALWAYS`; the tenant-id catalog scan goes.
- **PGlite where RLS was the only reason.** Every real-Postgres suite is tagged with why: privileges,
  triggers-as-a-role, concurrency, or "RLS as the deployment role". The last group moves to PGlite.
  Measured before and after: real-Postgres test files (**212 today**, `grep -l` over the harness
  entry points; the backlog's "190" is stale and is corrected in this change) and the unfiltered
  `pnpm test:coverage` wall clock, both recorded in step 1's PR.
- **The two-node fixture** (step 2) is Track A's, in `@waitron/db/testing`: two containers on one
  network, `wal_level = logical`, migrated by the migrator role, adopted by the real code.

## 5. The provisioner

- `assertUsable` refuses `SUPERUSER` still: a superuser can `DISABLE TRIGGER` and the append-only
  guarantee is the triggers. It stops refusing `BYPASSRLS`, which no longer means anything; the
  `provisioning.role_over_privileged` code stays (never renamed) with the `bypassRls` field dropped
  from its payload.
- `REQUIREMENTS`: the migrator's `memberOf` loses `tenant_provisioner`; the app login's stays
  `["app_user"]`; a `replication` login is added in step 3 with the superuser step beside the
  existing one.
- The tenant row is inserted by the owner connection during `instance`/venue provisioning, which
  already holds that connection.

## 6. Guidance and measurements

CLAUDE.md, in step 1: §3's "a new `tenant_id`-bearing table needs FORCE RLS + policy + grants" bullet
is replaced by "every new table is classified `ledger`/`state`/`local` (swap spec §2.1), and an
append-only table's `reject_mutation` triggers are `ENABLE ALWAYS` — both enforced by root guards";
§4's PGlite bullet is reworded — PGlite runs as a superuser, so grants and triggers are not enforced
there, which is why privilege and trigger tests need a container; §3's migration-collision recipe is
rewritten for the two-file baselines (regenerate the module's baseline, never hand-edit a snapshot —
still true); §2's coverage paragraph is untouched. `docs/backlog.md`: item 3 carries this chain, item
4 is folded in, the "no new table until A3 lands" rule stays until step 1 lands, the outbox sections
under *Sync* are closed in step 4. The 2026-08-02 sync design and both prototype docs get one more
dated pointer each in step 4.

## 7. Fiscal safety

Nothing in this chain writes a fiscal row the app did not, changes `computeHuella`, or touches a
series. What changes for fiscal records is who may write them (the grant matrix, unchanged for
`app_user`, proven in §2's receipts) and how they reach a standby (step 4, the owner's signature,
with the two-node suite's byte-identity and `ENABLE ALWAYS` receipts in the PR). The chain is per
node before and after.

## 8. Before the plan: verifications owed

1. That `drizzle-kit generate` from a fresh `meta/` reproduces every constraint the old chain built
   up through `ALTER`s. The §2 diff is the check. The known risk is a constraint Drizzle never knew
   about (a hand-written `CHECK` that lives only in a custom migration): the diff surfaces it, and it
   moves into the module's custom baseline file, never into the generated one.
2. That each of the five seam functions in §1's table behaves identically as invoker-rights: the
   grant suite calls every one as `waitron_app` and asserts the same result as before (the
   old-schema container of §2's proof is the control).
3. The `withTenant` boot-time tenant read on a database with zero tenants (a freshly provisioned
   instance before its venue exists): the assertion must not brick provisioning — plan it as
   "unset until the first tenant exists".
4. The PGlite candidates list, by reading each suite's header (the harness tags do not exist yet).

## 9. Interactions

- **Track B:** item 6 (node-role collapse) waits for step 4, which removes the pull and retention
  workers from `boot.ts`; the one-case config-conflict-gate trim is moot — the gate is deleted in
  step 4; item 2 (cloud standby end to end) proves steps 3 and 5 on real machines.
- **Track C:** the module contract's "sync" concern becomes classification (step 2, in
  `packages/sync-enrolment`, Track A's file; the descriptor in `packages/module` references it —
  textual coordination); SP-2b's gate is retired in step 4; no new core table until step 1 lands.
- **Coverage split (#239):** `packages/sync` keeps the high bar through the deletion; its remaining
  files are the thin native layer and are tested by the two-node fixture.

## Provenance

| Claim | Where |
| --- | --- |
| 122 `*.rls.test.ts`; 50 / 29 in server / db | `find packages apps -name '*.rls.test.ts'` on 5af4a4d5 |
| 179 migration files, core 111 | `ls packages/*/drizzle/*.sql` |
| 95 policies, 190 RLS switches, 15 functions, 62 triggers, 209 grants | greps over `packages/*/drizzle/*.sql`, 2026-09-05 |
| 8 roles and who uses each | `grep 'CREATE ROLE'`; `grep -rl <role> packages/*/src apps/server/src` (sync_tailer 14 files, sync_retention 7, tenant_provisioner 2, credentials_enumerator 1, envios_drainer 1, the other two 0) |
| 212 real-Postgres test files | `grep -rlE 'useRealPostgres|describeEachTarget|startMigratedPostgres|useTemplateDb|REQUIRE_DOCKER|startPostgresContainer' --include='*.test.ts'` |
| `waitron_app`'s UPDATE/DELETE/TRUNCATE on `registros_facturacion` → `permission denied` without RLS; the owner's → `reject_mutation` | prototype findings (c), 2026-09-05 |
| `assertUsable` refuses superuser or bypassrls today | `packages/provisioning/src/instance-plan.ts:217` |
| Owner decisions in §0 | brainstorm transcript 2026-09-05 |
