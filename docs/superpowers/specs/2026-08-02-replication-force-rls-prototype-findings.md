# Prototype: logical replication vs FORCE RLS under the non-superuser deployment role

**Date:** 2026-08-02
**Server:** `PostgreSQL 18.4` (`postgres:18-alpine`, the repo harness image), two instances on a
Docker network (`pgA` publisher, `pgB` subscriber), `wal_level=logical`.
**Question (spec `2026-08-01-local-server-sif-and-failover-design.md` §4):** is the cross-server
"complete copy" achievable with **native Postgres logical replication**, given the fiscal tables'
**FORCE row-level security** and the **non-superuser, non-BYPASSRLS deployment role** — or must the
sync be built at the application level?

**Independently re-verified (2026-08-02, on the live containers before teardown).** The decisive
block was reproduced by hand, not read: a fresh control row (`repl_control` id=4, no RLS) replicated
to the subscriber while a fresh valid registro (`secuencia=100`, FORCE RLS) did **not** — count 1 vs
0; `sub1_reg`'s `apply_error_count` climbed 82→83 while the control subscription `sub1_ctrl` stayed
at 0; the categorical refusal `user "sif_owner" cannot replicate into relation with row-level
security enabled` appeared in the subscriber log timestamped to the insert; and `sif_owner` was
confirmed `rolsuper=f rolbypassrls=f`. The two directions disagree (control replicates, RLS table
does not), which is what pins the cause on RLS rather than plumbing. Containers then torn down.

---

## DECISION

**Native logical replication is NOT viable under the FORCE-RLS + non-superuser constraint. The
sync mechanism must be APPLICATION-LEVEL.**

The single load-bearing receipt (re-runnable exactly as below): with the subscription owned by a
non-superuser, non-BYPASSRLS role that OWNS the `registros_facturacion` table on the subscriber,
the apply worker **categorically refuses** to write into it —

```
2026-08-02 11:09:23.263 UTC [708] ERROR:  user "sif_owner" cannot replicate into relation with row-level security enabled: "registros_facturacion"
```

— while, in the identical stream, a non-RLS control table replicates fine (so it is RLS, not
plumbing), a single-tenant per-role `app.tenant_id` default does **not** clear it (the refusal
precedes any policy evaluation), and granting `BYPASSRLS` to that same role clears it immediately
(so BYPASSRLS/superuser is the only native path — and it is exactly the constraint we must not
violate).

By contrast, **application-level insert works** (Experiment 1): the non-superuser app role, with the
tenant context set the way `withTenant`/`set_config('app.tenant_id', …)` sets it, inserts a foreign
server's same-tenant registros verbatim under FORCE RLS, while a cross-tenant insert is correctly
rejected.

---

## Setup (verified, not assumed)

Real schema objects confirmed on the migrated container (core + fiscal drizzle SQL applied in order
as superuser, exactly as `startRealPostgres` does):

```
FORCE RLS: relrowsecurity=true relforcerowsecurity=true
policy registros_facturacion_tenant_isolation cmd=* USING=(tenant_id = current_tenant_id()) WITHCHECK=(tenant_id = current_tenant_id())
trigger registros_facturacion_enforce_immutability: ... BEFORE DELETE OR UPDATE ... EXECUTE FUNCTION reject_mutation()
trigger registros_facturacion_block_truncate: ... BEFORE TRUNCATE ... EXECUTE FUNCTION reject_mutation()
app_user grants=INSERT,SELECT
app_user attrs: super=false bypassrls=false canlogin=false
owner=postgres
```

Key facts this establishes: the RLS policy is **tenant-scoped only** (`tenant_id =
current_tenant_id()`), NOT till/server-scoped; the append-only trigger fires on **UPDATE/DELETE/
TRUNCATE only, not INSERT**; `app_user` is non-super/non-bypassrls with INSERT+SELECT. The tenant
context is the `app.tenant_id` GUC read by `current_tenant_id()` (packages/db 0001_tenancy_rls.sql),
set via `select set_config('app.tenant_id', $1, true)` inside a transaction (`withTenant`).

Fixture: tenant **T1** (`1111…`) with two tills — `A1` ("server A's own" chain) and `A2` (the OTHER
server's chain, SAME tenant) — plus tenant **T2** (`2222…`) for the cross-tenant control. Each till
has a location, invoice_series, a live `registro_sif`, and sales rows as FK targets. A real
non-superuser LOGIN role `app_login` (member of `app_user`, `super=false bypassrls=false`) is used
so RLS is genuinely in force (PGlite/superuser would bypass it — CLAUDE.md §4).

---

## Experiment 1 — non-BYPASSRLS app role INSERTs a FOREIGN registro under FORCE RLS

Scenario: application-level replication. Server B's app receives a `registros_facturacion` row from
server A's write-set (same tenant T1, foreign till A2, its own secuencia + verbatim huella/chain
pointers) and inserts it as `app_login` with T1's tenant context set.

**Stated before running — the FAILING case would print:** `ERROR: new row violates row-level
security policy for table "registros_facturacion"` (WITH CHECK), or the append-only trigger error
`table registros_facturacion is append-only: INSERT is not permitted` (SQLSTATE WT001). Success =
`INSERT 0 1`.

**Control that must DISAGREE:** the same physical row that belongs to T2, inserted (1b) under T1's
context — a correct RLS setup REJECTS it — and (1c) under T2's own context — where it must SUCCEED.
If 1a (same-tenant foreign till) and 1b (cross-tenant) behaved alike, the experiment would separate
nothing.

Command: `docker exec -e PGPASSWORD=app_pw pgA psql -h 127.0.0.1 -U app_login -d waitron -f exp1.sql`

Verbatim output:

```
### whoami / RLS-subject check (must be app_login, non-superuser)
 current_user | session_user | bypassrls
--------------+--------------+-----------
 app_login    | app_login    | f

### 1a: context=T1, INSERT foreign-till (A2, SAME tenant) registro secuencia=1 primer  -- EXPECT: INSERT 0 1
INSERT 0 1
COMMIT

### 1a2: context=T1, INSERT foreign-till (A2) registro secuencia=2 NON-primer, verbatim anterior pointers -- EXPECT: INSERT 0 1
INSERT 0 1
COMMIT

### 1d: read back the two foreign-till rows -- huella must be the VERBATIM value inserted (no recompute)
 secuencia | num_serie_factura | primer_registro |                         anterior_huella                          |                              huella
-----------+-------------------+-----------------+------------------------------------------------------------------+------------------------------------------------------------------
         1 | A2/1              | t               |                                                                  | BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1
         2 | A2/2              | f               | BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1 | CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC2

### 1b: context=T1, INSERT a registro belonging to T2 (all FKs -> T2) -- EXPECT: ERROR new row violates RLS policy
psql:/exp1.sql:67: ERROR:  new row violates row-level security policy for table "registros_facturacion"
ROLLBACK

### 1c CONTROL: context=T2, INSERT the SAME T2 row -- EXPECT: INSERT 0 1 (disagrees with 1b)
INSERT 0 1
COMMIT
```

**Result / conclusion.**
- 1a & 1a2: a same-tenant, foreign-till registro (both a `primer` row and a chained non-primer row)
  INSERTs successfully under FORCE RLS as the non-BYPASSRLS role. Hypothesis confirmed: the policy
  is tenant-scoped, so a same-tenant foreign-till row passes WITH CHECK; the INSERT is not touched
  by the append-only trigger.
- 1d: the `huella` and `anterior_huella` are stored **exactly as supplied** (`BBB…B1`, `CCC…C2`) —
  nothing recomputes or re-chains the row; a replicated row carried verbatim is accepted verbatim.
- 1b vs 1c (control): the **identical** T2 row is REJECTED under T1's context and ACCEPTED under
  T2's context. The two disagree, proving 1b failed purely on tenant context (WITH CHECK), not on
  any row-validity or privilege reason, and that same-tenant-foreign-till (allowed) is genuinely
  separated from cross-tenant (rejected). This is exactly the passing shape the task required.

Application-level cross-replication is therefore sound: server B's app inserts server A's rows as
the ordinary non-superuser role, adopting each row's tenant scope — the same manoeuvre the
provisioner uses (`provisioner-role.rls.test.ts`).

---

## Experiment 2 — native Postgres logical replication vs FORCE RLS

Publisher `pgA`: `publication pub_reg for table registros_facturacion`, `publication pub_ctrl for
table repl_control` (a plain non-RLS control table), and a `repl_pub` (REPLICATION LOGIN) role for
the subscriber conninfo. All subscriptions use `copy_data=false` (stream new changes only — avoids
initial-COPY PK clashes with seeded rows and isolates the *apply* path).

### Stage 0 — case (i): SUPERUSER subscription owner (baseline + plumbing control)

**Stated before running — FAILING case:** rows never arrive on B (counts stay 0). SUCCESS: both the
control row and a fresh registro appear on B.

Subscriptions `sub0_ctrl`, `sub0_reg` owned by `postgres`. Insert on A: `repl_control(1,…)` and a
fresh registro on till A1 secuencia 2. Verbatim poll output:

```
poll 1: repl_control=1  registro=1
BOTH ARRIVED
--- subscription apply stats ---
sub0_ctrl|0|0
sub0_reg|0|0
```

**Conclusion:** replication plumbing works end-to-end, and a **superuser** apply worker bypasses
FORCE RLS — the FORCE-RLS `registros_facturacion` row applies with zero errors. This is case (i):
under a superuser/BYPASSRLS owner, rows land.

### Stage 1 — case (ii): NON-superuser, NON-BYPASSRLS subscription owner

On B: `sif_owner` (`super=false bypassrls=false canlogin=true`, member of `app_user`) is made the
**owner** of `registros_facturacion` (so FORCE RLS specifically applies to it) and of `repl_control`
(no RLS). Subscriptions `sub1_ctrl`, `sub1_reg` are created **as `sif_owner`** (granted
`pg_create_subscription` + `CREATE ON DATABASE`; conninfo carries a password, as PG requires for a
non-superuser owner).

```
registros owner=sif_owner force_rls=true
repl_control owner=sif_owner rls_enabled=false
sif_owner can exec current_tenant_id: true
sub1_ctrl owner=sif_owner enabled=true
sub1_reg  owner=sif_owner enabled=true
```

**Stated before running — the design-consistent result:** the non-RLS control row arrives, the
FORCE-RLS registro does NOT, and `sub1_reg` accrues apply errors. **The alarming (opposite) result
I am controlling for:** the registro ALSO arrives with zero errors, which would mean apply silently
bypasses RLS. The control (`repl_control`) arriving while the registro stalls is the disagreement
that pins it on RLS, not plumbing.

Insert on A: `repl_control(2,…)` and a fresh registro on till A1 secuencia 3. Verbatim poll:

```
poll 1: control(id=2)=1  registro(seq3)=0  sub1_reg apply_errors=2
...
poll 15: control(id=2)=1  registro(seq3)=0  sub1_reg apply_errors=5
```

Apply worker error in `pgB` log (the receipt):

```
2026-08-02 11:09:23.263 UTC [708] ERROR:  user "sif_owner" cannot replicate into relation with row-level security enabled: "registros_facturacion"
2026-08-02 11:09:23.265 UTC [1] LOG:  background worker "logical replication apply worker" (PID 708) exited with exit code 1
2026-08-02 11:09:28.258 UTC [751] LOG:  logical replication apply worker for subscription "sub1_reg" has started
2026-08-02 11:09:28.270 UTC [751] ERROR:  user "sif_owner" cannot replicate into relation with row-level security enabled: "registros_facturacion"
```

**Conclusion (case ii):** the control row replicates (plumbing is fine under the non-super owner),
but the FORCE-RLS registro is **categorically refused**. Crucially, the message is NOT "new row
violates row-level security policy" (a WITH CHECK failure) — it is a **blanket refusal to apply into
any RLS-enabled relation** by a role that does not bypass RLS. PostgreSQL does not even evaluate the
tenant predicate. The subscription retries the same LSN forever (error count climbs), so the stream
is permanently stuck on the first fiscal row.

### Stage 2 — escape hatch: single-tenant per-role `app.tenant_id` default

The local venue server is effectively single-tenant, so a natural idea is
`ALTER ROLE sif_owner SET app.tenant_id = '<the one tenant>'` so the apply worker's WITH CHECK would
pass. Tested (do not reason — run):

```
fresh sif_owner session sees app.tenant_id=11111111-1111-4111-8111-111111111111 current_tenant_id()=11111111-1111-4111-8111-111111111111
...
poll 12: registro(seq3)=0  apply_errors=17
2026-08-02 11:10:18.351 UTC [911] ERROR:  user "sif_owner" cannot replicate into relation with row-level security enabled: "registros_facturacion"
```

**Conclusion:** the role default IS honored by ordinary sessions (`current_tenant_id()` resolves to
T1), but the apply worker still fails with the **identical categorical error**. Because the refusal
precedes policy evaluation, satisfying WITH CHECK is irrelevant. **The single-tenant GUC trick does
not rescue native replication.**

### Stage 3 — confirm BYPASSRLS is the only native lever (the disqualified one)

```
sif_owner bypassrls now = true
poll 4: registro(seq3)=1  apply_errors=20   APPLIED after BYPASSRLS granted
3|A1/3|EEEE...E2|FFFF...F3   (replicated verbatim)
```

**Conclusion:** granting `BYPASSRLS` to the apply role unblocks apply immediately and the registro
lands verbatim. So the ONLY way to make native logical replication apply into the FORCE-RLS fiscal
tables is to give the applying role BYPASSRLS (or make it a superuser) — precisely the constraint
the design forbids.

### Stage 3b — a SECOND, independent gate: apply switches to the table owner

Control variant: an `ENABLE`-only (no FORCE) table with a permissive `using(true) with check(true)`
policy, **owned by `postgres`** on the subscriber, applied by non-owner `sif_owner` (bypassrls
removed again). It also never arrives — but with a *different* error:

```
2026-08-02 11:11:44.781 UTC [1147] ERROR:  role "sif_owner" cannot SET ROLE to "postgres"
2026-08-02 11:11:44.781 UTC [1147] CONTEXT:  processing remote data for replication origin "pg_17034" during message type "INSERT" in transaction 1037 ...
```

**Conclusion:** PG's apply worker (default `run_as_owner=false`) switches to the **table owner's**
role before writing. If the table is owned by a role the subscription owner is not a member of
(e.g. the superuser `postgres`, which is who owns the fiscal tables in the repo's
migrate-as-superuser model), apply fails at `SET ROLE` before RLS is even reached. So there are two
independent obstacles, and native replication under the non-super constraint hits one or the other
regardless of who owns the table on the subscriber:
- apply role **owns** the RLS table → "cannot replicate into relation with row-level security
  enabled" (Stage 1);
- apply role does **not** own it → "cannot SET ROLE to <owner>" (Stage 3b).
Both are cleared only by privilege escalation (BYPASSRLS, or membership in a privileged owner).

### Final state snapshot

```
sub1_ctrl   | sif_owner | apply_errors 0     (control table always replicated)
sub1_enable | sif_owner | apply_errors 20    (blocked: cannot SET ROLE to postgres)
sub1_reg    | sif_owner | apply_errors 20    (blocked on RLS until BYPASSRLS granted in Stage 3)
repl_control rows on B: 2 (1,2)              -- both control rows replicated
rls_enable_only rows on B: 0                 -- blocked
registros on B: seq 1 (seeded), 2 (stage0 superuser), 3 (stage1 blocked → stage3 bypassrls)
```

---

## Surprises / how this could be a false pass or false fail

- **The block is categorical, not a WITH CHECK failure.** I expected `new row violates row-level
  security policy`; the real message is `cannot replicate into relation with row-level security
  enabled`. This is stronger for the DECISION (it kills the per-role-GUC workaround outright), but it
  means the finding is about **RLS being enabled at all**, independent of FORCE, the policy text, or
  the tenant predicate. Any of the ~8 RLS-enabled tables in this schema (tenants, locations, tills,
  sales, cadenas, registro_sif, envios, registros_facturacion, …) is equally un-replicable natively
  under a non-BYPASSRLS role.
- **Could be a false FAIL if:** a future design turned RLS OFF on the subscriber's replica copies
  (viable only because the local server is single-tenant) — then native apply is not categorically
  blocked. That is a real option but it (a) diverges the replica's schema from the primary's, which
  the spec already flags as a hazard ("DDL is not auto-replicated"), and (b) drops the defense-in-
  depth the fiscal tables deliberately carry. It was not tested here because it changes the security
  posture rather than satisfying the stated constraint.
- **Could be a false PASS (of app-level) if:** Experiment 1 had been run as a superuser. It was not
  — `current_user=app_login, bypassrls=f` is printed in the receipt, and the cross-tenant control
  (1b) actively fails, which a superuser connection could not produce. So RLS was genuinely in force.
- **`copy_data=false` caveat:** Experiment 2 tested the *streaming apply* path, not the initial
  table COPY. The initial sync worker also runs as the subscription owner, so it is subject to the
  same block (and would fail identically on the first fiscal row) — not separately reproduced here.
- **run_as_owner:** left at its default (`false`). Setting `run_as_owner=true` moves the RLS check
  onto the subscription owner instead of the table owner, but that role is still non-BYPASSRLS, so
  it hits the Stage-1 categorical block. Either setting requires a BYPASSRLS role somewhere in the
  apply path.

---

## Consequence for the design

`docs/superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md` §4 lists "Postgres
logical replication with origin filtering, or two one-way logical-replication streams, or
`pglogical`" as the mechanism and explicitly says "prototype and prove against the real migrations."
Proven: **native logical replication cannot deliver the cross-server copy of the fiscal (and any
other RLS-enabled) tables without a BYPASSRLS/superuser role in the apply path**, which the
non-superuser deployment-role constraint forbids. The cross-replication must be **application-level
sync** — a process that reads the peer's new rows and INSERTs them as the ordinary non-superuser app
role with each row's tenant context set, exactly as Experiment 1 demonstrates works. (`pglogical`
runs its apply as a role too and is subject to the same RLS gate; it is not an exception.)
