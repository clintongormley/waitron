# Prototype: the nine container gates for the application-level cross-server sync layer

**Date:** 2026-08-06
**Server:** `PostgreSQL 18.4` (`postgres:18-alpine`, the repo harness image), started by Testcontainers
with the **whole migration manifest** applied in order (core → identity → workforce → workforce-es →
fiscal → payments → scheduler → credentials, via `migrationOptionsFor(manifestSets(), null)`), plus
the design's **proposed §6 sync objects** (`sync_log` + a generic capture trigger + the `app.sync_apply`
echo-guard GUC) installed by the migrator. Every gate that acts "as the app" acts as a real
**non-superuser, non-BYPASSRLS LOGIN role `app_login`** that inherits `app_user`'s grants — so FORCE
ROW LEVEL SECURITY is genuinely in force (a superuser bypasses it, which is why PGlite cannot stand in
here — `CLAUDE.md` §4).
**Design under test:** `2026-08-02-app-level-sync-design.md`, §11's nine gates.
**Builds on:** `2026-08-02-replication-force-rls-prototype-findings.md` — which already proved, on the
same image, that native logical-replication *apply* is categorically refused into an RLS-enabled
relation by a non-BYPASSRLS role (gate 1's role premise), and that the **append-only INSERT-apply**
of a foreign registro under FORCE RLS as the app role works verbatim (Experiment 1 = gate 2's
append-only half). Those are **cited, not redone**.

**How to reproduce.** The gate 1–5, 7, 8 experiments were run as two throwaway vitest suites in
`packages/migrations/src/` (`sync-gates-a.scratch.test.ts`, `sync-gates-b.scratch.test.ts`, plus a
`_sync-gate-support.ts` helper) — deliberately in `@waitron/migrations` because it is the one package
that dev-depends on **both** `@waitron/fiscal-verifactu` and `@waitron/payments`, so a single container
carries the full schema. Run with `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations
test sync-gates` (10 tests). Those files are **not committed** — they were deleted after this doc was
written; the SQL each ran is quoted inline below. Gate 6 was run against a hand-started
`docker run postgres:18-alpine -c wal_level=logical`.

---

## SUMMARY

| Gate | What it proves | Verdict |
| --- | --- | --- |
| 1 | Generic capture trigger writes a byte-identical `sync_log` row under FORCE RLS; the `WHEN … app.sync_apply` clause reads the same-txn GUC and suppresses the echo | **PASS** |
| 2 | Watermark upsert on the mutable tables + `registros_facturacion` immutability backstop as the non-BYPASSRLS role | **PASS (with a design caveat on `envios`/`acks`)** |
| 3 | Idempotent re-delivery — `ON CONFLICT DO NOTHING` and the watermark never regress on a late/duplicate image | **PASS** |
| 4 | Seq-order is a topological order of the FK graph; the `23503`-defer backstop lands a fast-lane child after its parent | **PASS** |
| 5 | `payments` grant facts under the real role: INSERT+UPDATE yes, DELETE `42501`, cross-tenant hidden | **PASS (with a note: "read-only mirror" is app-level, not a grant)** |
| 6 | Non-superuser consumption of a logical slot | **N/A — outbox chosen; measured: needs the cluster-wide `REPLICATION` attribute, and `pg_create_subscription` is insufficient** |
| 7 | `sync_log` retention: prune to `min(last_applied_seq)` across all subscribers; a down subscriber holds the log; stalled-lag alarm | **PASS** |
| 8 | Environment handshake refuses a mismatched peer before any row applies — in **both** directions | **PASS** |
| 9 | `node_id` rekey (chain-append + `record-sale` series↔node guard) | **COVERED BY #54** (not re-proven) |

**Headline.** Every mechanism the chosen **outbox** path (§3b) depends on works under the
non-superuser + FORCE-RLS + `withTenant` model with **no new privilege** — capture, echo-suppression,
verbatim byte-identity, watermark upsert, idempotent re-delivery, the FK-defer backstop, and the
environment handshake all pass as `app_login`. By contrast the only alternative capture (§3a, native
slot) needs the **`REPLICATION` role attribute** even for a one-time backfill, and that attribute is
cluster-wide (it grants physical base-backup of the *entire* cluster) — measured, not assumed (gate 6).
So the gates **confirm the outbox is buildable inside the proven box and close the door on (a)** unless
`REPLICATION` is later judged acceptable.

**The single most decision-relevant finding** is a design caveat, not a blocker: **`envios` and `acks`
carry no monotonic column**, so the §5 watermark guard (`WHERE excluded.updated_at > table.updated_at`)
**cannot be written at the row level for them** — their non-regression depends entirely on the
subscriber's `seq` cursor never re-applying an older `seq`. That makes these two tables **ineligible for
any lane that can reorder** (they must ride the single ordered lane, never the `payments` fast lane), and
it means an out-of-order apply of an `envios` row would silently regress delivery state with no in-row
defense. The spec already notes "envios has no single monotonic column"; this gate turns that into an
explicit constraint: **`envios`/`acks` are single-lane, strictly seq-ordered, no fast lane.**

---

## Setup (verified, not assumed)

The proposed §6 sync objects, installed by the migrator (owner) after the manifest:

```sql
create table sync_log (
  seq bigint generated always as identity primary key,
  origin_id uuid not null, table_name text not null,
  op text not null check (op in ('insert','update')),
  tenant_id uuid not null, row_image jsonb not null,
  txid xid8 not null default pg_current_xact_id(),
  committed_at timestamptz not null default clock_timestamp());
alter table sync_log enable row level security;
alter table sync_log force row level security;
create policy sync_log_tenant_isolation on sync_log for all
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
revoke all on sync_log from app_user;
grant insert, select on sync_log to app_user;   -- see false-pass note (i)

create function sync_capture() returns trigger language plpgsql as $fn$
begin
  insert into sync_log (origin_id, table_name, op, tenant_id, row_image)
  values (coalesce(nullif(current_setting('app.node_id', true),'')::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid),
          tg_table_name, lower(tg_op), new.tenant_id, to_jsonb(new));
  return null;   -- AFTER trigger; return value ignored
end; $fn$;

create trigger registros_capture after insert on registros_facturacion
  for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
  execute function sync_capture();
create trigger payments_capture after insert or update on payments
  for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
  execute function sync_capture();
```

`app_login` is `create role app_login login password 'app_pw' in role app_user`
(`rolsuper=f rolbypassrls=f`, inherits `app_user`'s grants) — the deployment role the prior findings
doc used the same way. The capture trigger function is **not** `SECURITY DEFINER`, so it runs as the
invoking `app_login`, which holds `INSERT` on `sync_log` through `app_user`. Fixtures are seeded as the
superuser `admin` (RLS bypassed for setup); everything under test runs through
`pg.connectAs('app_login', …)` under `withTenant`-style `set_config('app.tenant_id', …, true)`.

---

## GATE 1 — generic capture trigger + echo suppression under FORCE RLS — PASS

**Failing case stated before running:** the apply path's *own* write reappears in `sync_log` (an
A→B→A echo loop), or the captured `row_image` mangles the `text` huella/amount so a mirrored record
would no longer hash to its stored `huella`.

**Control in the other direction (per §1):** with the `WHEN` clause **removed**, a replicated write
**must** re-capture (the echo must be shown to actually happen), so the clause is proven load-bearing
rather than merely present.

Run as `app_login`:

1. **Domain write** (no `app.sync_apply`) of a registro with `huella =
DEADBEEFCAFE0000…0000` (64 hex), `importe_total = '123.45'`, under `app.node_id = <node>`:

```
GATE1 domain-write capture: {
  table_name: 'registros_facturacion', op: 'insert',
  origin_id: 'b875d1fb-0469-430d-98b0-181c31fff0c0',        -- the app.node_id GUC, verbatim
  huella:  'DEADBEEFCAFE0000000000000000000000000000000000000000000000000000',
  importe: '123.45', importe_type: 'string',                -- to_jsonb kept the text column a JSON string
  n: '1' }
```

2. **Apply write** of a *foreign* registro with `app.sync_apply='on'` set in the **same transaction**:

```
GATE1 after guarded apply, sync_log count: 1 (expect 1 — echo suppressed)
```

The foreign registro **did** land in `registros_facturacion` (count 1) — suppression is of the
*capture*, not of the write.

3. **Control** — reinstall the trigger **without** the `WHEN` clause, clear `sync_log`, repeat the
apply write with `app.sync_apply='on'`:

```
GATE1 CONTROL (no WHEN clause), sync_log count after apply: 1 (expect 1 — echo occurs)
```

**Conclusion.** The `WHEN (current_setting('app.sync_apply', true) is distinct from 'on')` clause reads
the GUC set in the *same* transaction and suppresses the echo; removing it makes the replicated write
re-capture — so the clause is the mechanism, exactly the §6 echo-guard design. `to_jsonb(NEW)` preserves
the `text` huella and amount as JSON strings (`importe_type = 'string'`), so §5's byte-identity
requirement holds through capture, and `origin_id` carries the `app.node_id` GUC. No new privilege: the
trigger runs as `app_login`, which holds only `INSERT` on `sync_log`.

---

## GATE 2 — mutable-table watermark upsert + the immutability backstop — PASS (with a caveat)

**Failing case stated:** a late older image **regresses** a mirrored row (moves the mirror backward),
or a stray UPDATE mutates an immutable `registros_facturacion` row on the mirror.

**Watermark upsert on `payments`** (`ON CONFLICT (id) DO UPDATE … WHERE excluded.updated_at >
payments.updated_at`), as `app_login` under FORCE RLS:

```
GATE2 payments rowCounts: { first: 1, newer: 1, older: 0, redup: 0 } final state: refunded
```

`first` (fresh insert) and `newer` (updated_at T2 > T1) applied; `older` (T0 < T2) and `redup`
(= T2, not strictly `>`) were **no-ops** (`rowCount 0`) — the state never regressed from `refunded`
to the older `voided`. The control is the direction disagreement: the *newer* image did move the row,
the *older* one did not.

**Watermark upsert on `cadenas`** (`actualizado_en` watermark, `ON CONFLICT (tenant_id, node_id)`),
same role, FORCE RLS:

```
GATE2 cadenas rowCounts: { first: 1, newer: 1, older: 0 } final secuencia: 2
```

Never regressed to `secuencia 1`. So the two representative mutable tables — one with a natural
`updated_at`, one with `actualizado_en` — both upsert-with-watermark correctly as the non-BYPASSRLS
role (they carry the `UPDATE` grant `0001_payments_rls.sql:30` / `0001_registros_inmutables.sql:58`).

**The `registros_facturacion` immutability backstop:**

```
GATE2 WT001: app-role UPDATE: { code: '42501', … }  |  owner UPDATE: { code: 'WT001', … }
```

**Two distinct receipts, and a correction to the gate wording.** A stray *direct* UPDATE on
`registros_facturacion` **as `app_login` fails `42501` (permission denied) — the grant, not the trigger,
stops it first**, because `app_user` holds only `SELECT,INSERT`. The append-only trigger's `WT001`
(`reject_mutation()`, `0002_immutability.sql:22-23`) is only *reached* by a role that already holds
UPDATE — here the **owner** (superuser), which bypasses RLS but **not** triggers. So gate 2's phrasing
"a stray direct UPDATE still trips WT001" is literally true only for the owner; for the app role the
grant is the first and sufficient line of defence. Both layers verified, defence-in-depth intact.

**Caveat — `envios`/`acks` have no row-level watermark.** These two are keyed by `registro_id` and carry
**no monotonic column** (`envios` has `estado`/`intentos`/timestamps but nothing single and monotonic;
`acks` likewise). The §5 guard `WHERE excluded.updated_at > table.updated_at` therefore **cannot be
written for them** — there is no column to compare. Their non-regression must come from the subscriber's
`seq` cursor (gate 7) applying strictly in ascending `seq` and never re-applying an older one. The
upsert *mechanism* (grant + FORCE RLS + `ON CONFLICT (registro_id) DO UPDATE`) works for them as the app
role, but it is an **unconditional** last-write-wins, safe only because `envios`/`acks` have a single
global writer (the submitter, §2/§8) and ride one ordered lane. **Design consequence:** `envios`/`acks`
must never be placed on a reordering lane (e.g. the `payments` fast lane). This is the doc's most
decision-relevant finding.

---

## GATE 3 — idempotent re-delivery — PASS

**Failing case stated:** a re-delivered append-only row either errors on the duplicate or *overwrites*
the stored row; a re-delivered mutable image regresses the watermark.

**Append-only** (`insert … select * from jsonb_populate_record(null::registros_facturacion, $1) on
conflict (id) do nothing`), first delivery then a duplicate carrying **different bytes** (a different
huella), as `app_login`:

```
GATE3 append-only rowCounts: { first: 1, dup: 0 } stored huella === H1: true
```

The first delivery inserts (`rowCount 1`), the duplicate is a **visible no-op** (`rowCount 0`) and does
**not** overwrite — the stored huella is still the first one, so a re-delivery cannot silently rewrite an
immutable row even if the second image differs. **Mutable** re-delivery is the `redup` column of gate 2
(`rowCount 0`, no regression). A first delivery and a re-delivery therefore visibly differ (`1` vs `0`),
which is the state §11.3 asks the experiment to distinguish.

---

## GATE 4 — apply-in-seq-order preserves FK; the `23503`-defer backstop — PASS

**Failing case stated:** applying in `seq` order still raises a foreign-key violation (so `seq` order is
*not* a topological order and a separate sort is needed); or the fast-lane reorder is *not* caught by the
constraint (so a child could be applied with a dangling parent).

**Part 1 — seq order across two disjoint origins.** Two nodes (A, B) under one tenant, each emitting
`sale (seq n) → registro (seq n+1)`; FK targets (`sales`) are **not** pre-seeded — they arrive in the
stream, so an out-of-order apply would really break. Applied strictly ascending as `app_login`:

```
GATE4 in-seq-order violations: 0 landed: { sales: '2', regs: '2' }
```

Zero `23503`s — because each origin committed the parent before the child, ascending `seq` **is** a
topological order of the FK graph, and no runtime topological sort is needed (§4's primary guarantee).

**Part 2 — the `payments` fast-lane reorder.** A payment referencing a `sale` that the slow (fiscal)
lane has **not** yet delivered, applied first:

```
GATE4 defer: { firstCode: '23503', parentRc: 1, retryRc: 1, inOrderErr: undefined }
```

The reorder raises `23503 foreign_key_violation` (`firstCode`); park it, apply the parent sale
(`parentRc 1`), retry the parked child — it lands (`retryRc 1`). The control in the other direction is
`inOrderErr: undefined`: a payment whose sale is already present applies with no error, proving the
`23503` was purely the ordering, not the row. This is the §4 backstop that makes the §9 `payments` fast
lane safe.

---

## GATE 5 — `payments` grant facts under the real non-superuser role — PASS (with a note)

**Failing case stated:** the real `app_login` role can DELETE a payment (breaking the append/reversal
model), or can see/write another tenant's payment (RLS not actually enforced under the real role — the
#34 lesson that behaviour under the non-superuser role must be *measured*, not assumed).

```
GATE5 payments grant facts: { inserted: 1, updated: 1, delete: '42501', crossVisible: '0' }
```

`app_login` may INSERT (initiator write) and UPDATE (lifecycle/apply) its own tenant's payment; a DELETE
is refused `42501` (no DELETE grant — money is append/reversal, never deleted, `0001_payments_rls.sql:29`
`REVOKE ALL` + `GRANT SELECT,INSERT,UPDATE`); and a payment inserted under tenant A is **invisible**
under tenant B's context even though the role holds SELECT — RLS is genuinely enforced under the real
role. This extends `packages/payments/src/payments.rls.test.ts` (already green) with the DELETE-refusal
and the apply-side UPDATE.

**Note — "the mirror is read-only" is an application-level discipline, not a grant.** The grant gives the
mirror `UPDATE` on `payments` (it *needs* it for the watermark upsert). What makes the mirror non-
originating is that (a) its `payments_capture` trigger does not fire on an apply write (`app.sync_apply`
is set), so the mirror emits nothing into its own `sync_log`, and (b) only the initiating server's
domain writes originate a `sync_log` row (§2 ownership). So gate 5's "read-only mirror" is enforced by
the capture/echo mechanism (gate 1), not by withholding UPDATE — worth stating so a future reader does
not try to revoke UPDATE on the mirror and break apply.

---

## GATE 6 — non-superuser logical-slot consumption — N/A (outbox chosen); measured

The design chose the **outbox** (§3b) over native decoding (§3a); §11.6 is "option (a) only". Measured
anyway, per §1 (do not assume — measure), on `docker run postgres:18-alpine -c wal_level=logical`.

**Failing case stated:** a non-superuser without the `REPLICATION` attribute cannot create or drain a
logical slot at all, so option (a) is gated on a wide, cluster-level privilege.

| Role | Attribute | `pg_create_logical_replication_slot(…, 'pgoutput')` |
| --- | --- | --- |
| `plain_role` | `nosuperuser`, no replication | `ERROR: permission denied to use replication slots — Only roles with the REPLICATION attribute may use replication slots.` |
| `sub_role` | `nosuperuser` + **`pg_create_subscription`** granted | **same error** — `pg_create_subscription` does **not** grant slot use |
| `repl_role` | `nosuperuser` **`replication`** | `(s_repl,0/1BD4218)` — created; then drained: `pg_logical_slot_get_binary_changes(...)` → **4 change messages** |

So a non-superuser **can** create and drain a `pgoutput` slot, but **only** with the `REPLICATION` role
attribute; the `pg_create_subscription` predefined role (the SQL CREATE-SUBSCRIPTION path) is
**insufficient** for slot consumption — and that path is separately the one the prior prototype proved
RLS-blocks on apply.

**Is `REPLICATION` an acceptable widening? Measured: no.** `REPLICATION` is cluster-wide, not scoped to
the one publication. `repl_role` opened a **physical** replication connection and ran `IDENTIFY_SYSTEM`:

```
      systemid       | timeline |  xlogpos  | dbname
---------------------+----------+-----------+--------
 7670824052812795949 |        1 | 0/1C25C08 |
```

— i.e. it can stream the **entire cluster's WAL / take a base backup**, well beyond `pub_t`. The
controls in the other direction: `plain_role` and `sub_role` both get
`FATAL: permission denied to start WAL sender — Only roles with the REPLICATION attribute may start a WAL
sender process.` So `REPLICATION` is a security-posture widening in the same spirit as the `BYPASSRLS`
the design forbids, and the provisioner would have to grant it cluster-wide.

**Verdict.** N/A for the built system (outbox chosen). The measurement **confirms §3(a)'s stated concern
is real** and closes the door on (a) even for the §7 bulk-backfill unless `REPLICATION` is later judged
acceptable — §7 step 2 stays on the outbox.

---

## GATE 7 — `sync_log` retention / back-pressure under a down subscriber — PASS

**Failing case stated:** the log is pruned past a **down** subscriber's cursor, destroying rows it has
not yet applied (data loss); or a stalled subscriber raises no alarm.

Modelled with a `sync_cursor(subscriber_id, origin_id, last_applied_seq, alive)` table. One origin
produces `seq 1..10`; subscriber `peerB` is caught up (`10`), subscriber `cloud` is **down** (`4`).

```
GATE7 lag per subscriber: [ {cloud, lag 6, alive f}, {peerB, lag 0, alive t} ]
GATE7 high-water: { min_live: '10', min_all: '4' }
GATE7 sync_log before: 10 → after correct prune: 6 | would-delete correct: 4  naive(live-only): 10
GATE7 after cloud confirms 10, sync_log rows: 0 (bounded → 0)
```

- **Retention.** The correct prune deletes to `min(last_applied_seq)` across **all** subscribers
  (`= 4`), removing only `seq 1..4` and **retaining `seq 5..10`** — the rows the down `cloud` still
  needs (bounded growth held by the down subscriber; at-least-once, no loss).
- **The failing case, shown as a control.** A naive prune to the **live-only** min (`= 10`, ignoring the
  down subscriber) *would* delete all 10 rows — destroying `seq 5..10`. The `would-delete` counts
  (`naive 10 > correct 4`) make the data-loss direction concrete: excluding a down subscriber from the
  high-water is exactly the bug.
- **Bounded.** When `cloud` returns and confirms `10`, the high-water advances and the log drains to `0`
  — growth is bounded by the slowest live subscriber and released when it catches up.
- **Alarm.** `lag = origin_max − last_applied_seq` is `6` for the stalled `cloud` and `0` for `peerB`;
  a threshold over that lag is the `sync.stream_stalled` signal (§9). *When* to alarm vs. evict a dead
  subscriber remains the §12 ops-policy decision — this gate proves the mechanism, not the policy.

---

## GATE 8 — environment handshake refuses a mismatched peer before any row applies — PASS

**Failing case stated:** a peer in a different environment applies a row *before* the mismatch is
detected, leaking a pre-production record into a production series (an unrecoverable burn, `CLAUDE.md`
§5) — or the guard only fires in one direction.

The handshake reads the local `deployment.environment` (`0010_deployment_stamp.sql`, singleton `id=1`)
and compares it to the peer-advertised environment **before** any apply; on mismatch it raises
`sync.peer_environment_mismatch` and applies nothing. `applied` counts marker applies that ran.

```
GATE8 local=production:     { match: null, mismatch: 'sync.peer_environment_mismatch' } applied: 1
GATE8 local=preproduction:  { match: null, mismatch: 'sync.peer_environment_mismatch' } applied: 1
```

Both directions (the §1 control): a **production** node accepts a production peer and refuses a
preproduction one; a **preproduction** node accepts a preproduction peer and refuses a production one.
In each direction `applied == 1` — exactly the one matching apply ran, and the mismatched apply **never
executed** (the throw precedes it), so nothing crosses the environment boundary. `deployment` is the
guard, checked per handshake, never replicated as data (§2, §10).

---

## GATE 9 — the `node_id` rekey — COVERED BY #54 (not re-proven)

The spec was written pre-rekey and still says `till_id`; the schema now keys the SIF/chain/series on
`node_id` (the `#54` landing; `0013_rekey_chain_to_node.sql`,
`packages/fiscal-verifactu/drizzle/0012_add_node_id.sql`, `packages/db/drizzle/0016_add_node_id.sql`).
The two properties §11.9 asks for are already proven by landed real-container tests:

- **Chain-append under node-keying:** `packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts`
  — 20 concurrent appends take distinct `(tenant, node, secuencia)` positions with no gaps (per-node
  `cadenas` head lock); two tills of one node continue **one** per-node chain; two nodes of one tenant
  get distinct SIFs and distinct chains.
- **`record-sale.ts`'s series↔node guard:** `packages/core/src/record-sale.ts:229-235` raises
  `sale.series_wrong_node` when the named series does not belong to the sale's node, and
  `sale.series_wrong_purpose:240-244` for a non-standard series — both node-keyed.

No re-proof attempted here; marked covered-by-#54.

---

## Surprises / how this could be a false pass or false fail

- **(i) `sync_log` SELECT grant.** For the read-backs, these gates grant `app_user` **`SELECT`** on
  `sync_log`; the design (§6) instead gives `SELECT` to a **dedicated sync-tailer role** and the app
  role only `INSERT`. Granting SELECT to `app_user` does not change any capture/apply/watermark result
  (the trigger only needs INSERT), but the built system should keep the tailer-role split — a no-RLS or
  app-readable `sync_log` would be a cross-tenant side-channel (the Copilot-review point in §6). Not a
  false pass for the mechanisms proven, but a divergence to close at build time.
- **(ii) Byte-identity was tested through `to_jsonb` + `jsonb_populate_record`, not through the wire.**
  The huella/amount survive capture (`to_jsonb`, gate 1) and apply (`jsonb_populate_record`, gates 1–4)
  as JSON strings. The actual network serialisation/deserialisation of `sync_log.row_image` is out of
  scope here (spec §15 puts wire format elsewhere); a JSON transport that re-quotes numbers would need
  its own check.
- **(iii) `envios`/`acks` unconditional upsert is safe only under the single-writer + single-lane
  premise.** The gate proves the upsert *works* under RLS; it does **not** prove monotonicity, which
  these two tables cannot self-enforce (no watermark column). If a future change ever gives `envios` a
  second writer or a fast lane, this becomes a live regression hazard — see the gate 2 caveat.
- **(iv) Could be a false pass of the app-level path if run as a superuser.** It was not:
  `pg.connectAs('app_login', …)`, `rolsuper=f rolbypassrls=f`, and the cross-tenant reads in gates 5/1
  actively return nothing / reject — a superuser connection could not produce those.
- **(v) FK checks under RLS.** Applying a registro/sale/payment as `app_login` references FK targets the
  app role cannot necessarily `SELECT` cross-tenant; the inserts succeeded because PostgreSQL's RI
  triggers run as the constraint owner and are not subject to the querying role's RLS — the same reason
  Experiment 1 worked in the prior findings.

---

## Consequence for the design

The nine gates clear the way to **build the §3(b) application outbox**:

1. **Nothing needs a new privilege.** Capture, echo-suppression, verbatim apply, watermark upsert,
   idempotent re-delivery, the FK-defer backstop, and the environment handshake all run as the ordinary
   non-superuser `app_login` under FORCE RLS. The one grant added is `INSERT` on `sync_log` for the
   capture trigger (plus a dedicated tailer role's `SELECT`), both inside the existing model.
2. **Make `envios`/`acks` single-lane explicit in the enrolment registry (§6).** They cannot carry a
   row-level watermark; they must be applied strictly in `seq` order and are ineligible for the
   `payments` fast lane. This is the one place the spec's prose ("no single monotonic column") should
   become an enforced routing rule.
3. **Correct §2/§5's WT001 wording for `registros_facturacion`:** the app role is stopped by the
   `42501` grant, not the `WT001` trigger; `WT001` is the owner-level backstop. Both hold; the order
   matters for what an operator sees.
4. **Native decoding (§3a) is out even for the backfill** unless `REPLICATION` is judged acceptable —
   it is the *only* grantable path to slot consumption and it is cluster-wide (base-backup) reach.
   `pg_create_subscription` does not help. §7 step 2 stays on the outbox.
5. **Retention needs the min-across-all-live-subscribers discipline** and an operator action to declare
   a subscriber dead before pruning past it — the mechanism is proven; the *policy* (§12.4) is still
   ops' to set.
