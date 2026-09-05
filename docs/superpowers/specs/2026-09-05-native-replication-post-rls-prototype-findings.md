# Prototype: native logical replication on the post-RLS schema, owned and applied by a non-superuser

**Date:** 2026-09-05 (Track A item 2, `docs/backlog.md` → Whole-project design review).
**Server:** `PostgreSQL 18.6` (`postgres:18-alpine`, the repo harness image, aarch64), two containers
`proto-pgA` / `proto-pgB` on one Docker network, `wal_level=logical`, every other setting at its
default — including `max_slot_wal_keep_size = -1`.
**Question:** the 2026-08-02 prototype (`2026-08-02-replication-force-rls-prototype-findings.md`)
proved native logical replication cannot apply into FORCE-RLS tables under a non-superuser, and its
Stage 3b showed a second gate — `cannot SET ROLE to "postgres"` — when the apply role does not OWN
the table. Track A item 3 removes RLS and the multi-role set. Does native replication work on THAT
schema, with the real migrations, under a non-superuser apply role that owns the subscriber's
tables? Prove (a) `origin = none` stops the A→B→A echo, (b) a `registros_facturacion` row lands
byte-identical, (c) the append-only trigger still blocks a stray UPDATE on the subscriber, (d) a
one-sided column add errors loudly rather than dropping data, (e) lag and slot retention with the
subscriber down.

**Method.** No repo code. The real migrations (179 files, the nine manifest sets in order) were
applied with `psql` as `waitron_migrator` — `LOGIN CREATEROLE`, `rolsuper = f` — which owns the
database and therefore every table, the shape `waitron-provision instance` produces. RLS was then
stripped (every policy dropped, `NO FORCE` + `DISABLE ROW LEVEL SECURITY` on every table) to stand in
for item 3's end state. The failing case was written down before each probe; every number below is
pasted from the run, and the raw transcript (`results.log`) stayed in the session scratchpad.

---

## DECISION

**All of (a)–(d) pass, and (e) is measured.** By the decision rule recorded with this item: stop
adding outbox features and write the outbox → native replication swap spec (Track A item 4). Item 3
proceeds unchanged — this result is what it was gated on.

Every gate the 2026-08-02 prototype hit is gone on the post-RLS schema: the apply role is the table
owner, so `run_as_owner = false` (the default) needs no `SET ROLE`, and with no RLS there is nothing
for the apply worker to refuse. The one new residual is in (c2): the subscriber's append-only trigger
does NOT fire for the apply worker unless it is `ENABLE ALWAYS` — the swap spec must set that on the
fiscal tables.

---

## Setup (verified, not assumed)

```
pgA: applied 179 migration files as waitron_migrator rolsuper=false
pgB: applied 179 migration files as waitron_migrator rolsuper=false
82 tables, owners: waitron_migrator
75 RLS-enabled, 75 forced, 81 policies        -- before strip-rls
pgA: rls-enabled=0 policies=0                  -- after
pgB: rls-enabled=0 policies=0
```

Roles the migrations themselves create (all `NOLOGIN`): `app_user`, `tenant_provisioner`,
`credentials_enumerator`, `envios_drainer`, `payments_webhook_resolver`, `sales_coverage_checker`,
`sync_retention`, `sync_tailer`. The superuser — the seat the provisioning admin holds — created
`waitron_app` (`LOGIN … IN ROLE app_user`) and `waitron_repl` (`LOGIN REPLICATION`) and granted
`pg_create_subscription` to `waitron_migrator`. That superuser step is not optional:

```
CREATEROLE (non-superuser) creating a REPLICATION role → ERROR:  permission denied to create role
```

Every one of the 82 tables has a primary key (the query for tables with `relreplident = 'd'` and no
primary index returned nothing), so replica identity needs no per-table work. Three sequences exist:
`time_entries_ingest_seq_seq`, `sync_log_seq_seq`, `sync_config_conflicts_id_seq` (see finding 5).

Seeded on A as the owner: tenant → location → node → till → series → `registro_sif` +
`contadores_instalacion` → sale → `cadenas`. Registro 1 was inserted as `waitron_app` after
`set_config('app.tenant_id', …)`, the way the app writes: `1 registros; chain head seq 1; sync_log
rows 5` (the capture triggers fired on A).

**Publications**, as the owner, on both nodes:

```
published tables: 78 (excluded: __drizzle_migrations_* bookkeeping and the sync_* outbox tables)
pgA: pub_all created as waitron_migrator
FOR ALL TABLES as non-superuser → ERROR: must be superuser to create FOR ALL TABLES publication
```

**Subscription B ← A** (`copy_data = true, origin = none`), stated failing case: `srsubstate` stuck,
sync/apply error counts above zero, or no registro on B.

```
NOTICE:  created replication slot "sub_b_from_a" on publisher
after 3s: tables not yet 'ready' = 0; owner=waitron_migrator enabled=true origin=none run_as_owner=false
stats: apply_errors=0 sync_errors=0
B rows: registros=1 sales=1 cadenas_seq=1 sync_log=0 (A sync_log=5)
subscription requirements met by a non-superuser owner: pg_create_subscription member=true CREATE on db=true password_required=true
```

**Subscription A ← B** (`copy_data = false, origin = none`) then made it bidirectional; both slots
`active=true`. A B-originated row (`locations` "Sala from B") reached A — checked after the
`origin` control in (a), so it also shows A's subscription survived that flip.

---

## (b) A registro lands byte-identical

Stated failing case: the md5 differs, or the record-text diff is non-empty.

```
A md5=67465d849906eeeb25c0a33a7a56d6bb
B md5=67465d849906eeeb25c0a33a7a56d6bb
row text identical (1003 bytes, incl. ñ/€/“ ”, jsonb, timestamptz with microseconds)
```

Re-checked over all 5005 rows at the end (after (e)), hashing every column but the two probe
columns (d) had added:

```
A: f9f2699bbcd0c7feec2199248e74964e over 5005 rows
B: f9f2699bbcd0c7feec2199248e74964e over 5005 rows
-- probe columns dropped on both, raw record text:
all rows, raw record text: A=b15119c0cfa91a176bd461649348d3b6 B=b15119c0cfa91a176bd461649348d3b6
```

One reading in between looked like a failure and was not: a spot check of row 4321 by raw
`r::text` gave different hashes because B still carried `probe_b_only`, the subscriber-only column
from (d) — 36 columns on B against 35 on A. Stated here so nobody re-derives it.

## (a) `origin = none` stops the echo

Stated failing case: after registro 2 on A, A's `apply_error_count` rises (B echoes the row back
and A's primary key rejects it), or A holds two copies.

```
A: registros=2 apply_errors=0 | B: registros=2 apply_errors=0
A's log lines mentioning duplicate/conflict: 0
```

**Control in the other direction** — A's subscription set to `origin = any`, registro 3 on A. The
failing case of the control is "nothing changes", which would mean `origin = none` was never doing
any work:

```
A: registros=3 apply_errors=2 | B: registros=3 apply_errors=0
2026-09-05 17:25:07.238 UTC [1693] ERROR:  conflict detected on relation "public.registros_facturacion": conflict=multiple_unique_conflicts
2026-09-05 17:25:07.238 UTC [1693] DETAIL:  Key already exists in unique index "registros_facturacion_pkey", modified in transaction 984.
```

Back to `origin = none`: `apply_error_count` 2 → 2 over 6 s (the retry loop stopped), the apply
worker running, and no `SKIP` needed — the publisher's walsender filters the foreign-origin change
out on reconnect.

## (c) The append-only trigger on the subscriber

Stated failing case: `UPDATE 1`.

```
as waitron_app (rolsuper=f):
  UPDATE   → ERROR:  permission denied for table registros_facturacion
  DELETE   → ERROR:  permission denied for table registros_facturacion
  TRUNCATE → ERROR:  permission denied for table registros_facturacion
as waitron_migrator (rolsuper=f):
  UPDATE   → ERROR:  table registros_facturacion is append-only: UPDATE is not permitted
  DELETE   → ERROR:  table registros_facturacion is append-only: DELETE is not permitted
  TRUNCATE → ERROR:  cannot truncate a table referenced in a foreign key constraint
  app role setting session_replication_role=replica to dodge the trigger → ERROR:  permission denied to set parameter "session_replication_role"
  B row 1 unchanged: 123.45
```

The app role is stopped by its grants alone (`SELECT, INSERT` from `0001_registros_inmutables.sql`,
no RLS involved); the owner is stopped by the trigger; the app cannot switch itself into replica
mode to skip triggers. `TRUNCATE` hits the `cadenas` foreign key before the trigger gets a turn.

### (c2) A REPLICATED update — the residual, and what closes it

The apply worker runs in replica mode, and every trigger on `registros_facturacion` is
`tgenabled = O` (fires at origin only):

```
registros_facturacion_enforce_immutability tgenabled=O
registros_facturacion_block_truncate tgenabled=O
registros_facturacion_capture tgenabled=O
```

So a publisher that produces an UPDATE — only its table owner can, by `DISABLE TRIGGER` first, which
`app_user` cannot do; a superuser could — gets it applied on the subscriber silently:

```
B row 2 importe_total = 0.02 (A: 0.02); B apply_errors=3        -- default: applied, no error
```

With `ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER registros_facturacion_enforce_immutability`
on the subscriber, the same UPDATE is refused and the subscription stalls on it:

```
B row 3 importe_total = 123.45 (A: 0.03); B apply_errors=6
2026-09-05 17:29:12.144 UTC [179] ERROR:  table registros_facturacion is append-only: UPDATE is not permitted
2026-09-05 17:29:12.144 UTC [179] CONTEXT:  PL/pgSQL function public.reject_mutation() line 3 at RAISE
B sees 'after the bad update': 0 (0 = queued behind the refused transaction)
```

The operator procedure, as the non-superuser subscription owner: read the finish LSN from the
subscriber's log, then `ALTER SUBSCRIPTION … DISABLE; … SKIP (lsn = '0/328F738'); … ENABLE`:

```
B sees 'after the bad update': 1; B row 3 = 123.45 (A row 3 = 0.03)
```

The nodes now diverge on that row, by design: the subscriber kept the immutable record, the
publisher was corrupted. Reconciliation is a human matter (and AEAT `consultar` for the fiscal
tail), not something the mechanism should paper over.

## (d) A one-sided column add errors loudly

Stated failing case: registro 4 lands on B with the new column silently absent.

```
A: registros=4 apply_errors=2 | B: registros=3 apply_errors=3
2026-09-05 17:25:24.315 UTC [1437] ERROR:  logical replication target relation "public.registros_facturacion" is missing replicated column: "probe_extra"
-- then add the column on B (subscriber catches up)
A: registros=4 apply_errors=2 | B: registros=4 apply_errors=3
B row 4 probe_extra = set-on-A
-- the reverse: a column that exists only on the SUBSCRIBER (B)
A: registros=5 apply_errors=2 | B: registros=5 apply_errors=3
B row 5 probe_b_only = <null>
```

The row was held, not dropped; the publisher's `DEFAULT 'set-on-A'` was materialised and arrived
once B had the column; no `SKIP` was needed. A subscriber-only column is harmless (NULL).

## (e) Lag and slot retention with the subscriber down

Stated failing cases: an insert on A errors or blocks while B is down; the slot is invalidated and B
cannot catch up; B never reaches A's count.

```
max_slot_wal_keep_size on A = -1 (-1 = retain WAL for a dead subscriber WITHOUT LIMIT)
B stopped at 19:26:31
5000 registros inserted on A in 1s while B was down (A registros: 5 → 5005)
A's slot for B: sub_b_from_a active=false wal_status=reserved retained=16 MB safe_wal_size=NULL (unlimited)
2026-09-05 17:26:31.576 UTC [1858] ERROR:  apply worker for subscription "sub_a_from_b" could not connect to the publisher: connection to server at "proto-pgB" …
A's registros still accepting: <no error>
B started at 19:26:32
B caught up: registros=5005 (A=5005) 1s after B accepted connections; A's slot now: active=true retained=16 MB
B's 'while B down' location arrived: 1
```

The primary kept selling with the standby dead (CLAUDE.md §5's rule held at the database layer);
5000 registros cost 16 MB of retained WAL; catch-up was a second on a LAN.

---

## Findings the swap spec must carry

1. **Explicit table lists, per module.** `FOR ALL TABLES` (and `FOR TABLES IN SCHEMA`) need a
   superuser; the owner publishes a named list. The module contract owns its published tables the
   way it owns its migrations, and `__drizzle_migrations_*` must never be in a list — each node
   migrates itself (finding 4 is what happens when it has not).
2. **`ENABLE ALWAYS` the immutability triggers** on `registros_facturacion` (and any other
   append-only table) so a corrupted publisher is refused at the subscriber, not copied. Today's
   `tgenabled = O` is the default `CREATE TRIGGER` gives. The `sync_capture` triggers, by contrast,
   SHOULD stay `O` — they are the outbox this swap retires, and under apply they did not fire
   (B's `sync_log` stayed at 0 throughout).
3. **`origin = none` on every subscription** is the whole echo defence; PG18 reports the alternative
   as `conflict=multiple_unique_conflicts` and retries forever. The control above is the receipt.
4. **Additive DDL is subscriber-first, and the gate is loud.** A column the subscriber lacks stalls
   its subscription with `missing replicated column` until the subscriber migrates, then resumes by
   itself; a column only the subscriber has is harmless. That is the "subscriptions error until the
   subscriber migrates" gate item 4 sketches, measured. Column drops are the reverse order.
5. **Sequences do not replicate.** `time_entries.ingest_seq` (a serial) will be behind on a promoted
   standby; the swap spec needs a `setval` at promotion or a different key. The other two sequences
   belong to the outbox and go with it.
6. **Set `max_slot_wal_keep_size`.** At the default `-1` a dead standby makes the primary retain WAL
   without limit, and a full disk is the one failure that WOULD stop sales. A bound invalidates the
   slot instead, which means the standby re-adopts (a fresh initial copy: 78 tables in 3 s here) —
   the right trade for a warm standby. Monitor `pg_replication_slots.wal_status`.
7. **Provisioning gains one superuser step**: a `REPLICATION` role and `pg_create_subscription`
   membership cannot be granted by a `CREATEROLE` owner. The rest — publication, subscription,
   `SKIP`, `ENABLE ALWAYS` — is the owner's.
8. **Initial copy under the owner works** (`copy_data = true`, 78 tables, 3 s, no errors), so the
   adopt path can be a native initial sync rather than a backup restore.
9. **A refused transaction stalls everything behind it** (c2) — correct for a fiscal record, but the
   operator runbook needs the `SKIP (lsn)` procedure and the divergence it leaves.

## What this does not prove

- Nothing ran under concurrency or the app's real transaction shapes; inserts were `psql` batches.
- The replication connection was plain TCP on a Docker network — no TLS, no relay/tunnel (Track B
  item 2 / Track C item 5 decide the transport).
- DDL beyond `ADD COLUMN` / `DROP COLUMN` was not exercised; neither were partitioned tables (there
  are none) nor large objects (none).
- The chain itself was not verified — rows were realistic in shape and the `huella` values were
  well-formed but not computed; (b) is about bytes, not fiscal validity. Server-as-SIF gives each node
  its own chain, so a standby never continues the primary's chain anyway.
- Two-writer rows (`dining_tables` under active-active) were not tested; active-active is shelved.
- `postgres:18-alpine` reports 18.6 here where the 2026-08-02 run reported 18.4; nothing above is
  known to depend on the minor.

## Provenance

| Claim | Where it was measured |
| --- | --- |
| Migrations apply as a non-superuser owner | `migrate.sh` output: `applied 179 migration files as waitron_migrator rolsuper=false` |
| `FOR ALL TABLES` needs superuser | verbatim error above |
| Non-superuser cannot create a `REPLICATION` role | verbatim error above |
| (a)–(e), (c2) | the pasted blocks, each preceded by its stated failing case |
| Trigger enable states | `pg_trigger.tgenabled` on B, pasted above |
| Sequences | `pg_sequences` on A: three names, pasted above |
| PostgreSQL version | `select version()` on both containers at start: `PostgreSQL 18.6 on aarch…` |

Containers were torn down after the last receipt was taken (`docker rm -f proto-pgA proto-pgB`,
network `proto-net` removed).
