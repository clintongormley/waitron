# Sync transport / network layer — slice 1 design (2026-08-15)

**#33 §14, on top of the commercial-lane outbox (#74).** The outbox already **captures** every
commercial write into `sync_log` and can **apply** a batch idempotently; what is missing is the thing
that **moves batches between the two shop servers** and keeps pulling. This slice builds that: a
**symmetric HTTP pull** with a **redelivery loop**, single ordered lane.

> **The governing design is `2026-08-02-app-level-sync-design.md`** (reviewed with the owner). The
> older draft on branch `docs/sif-sync-protocol-design` is **superseded** (it predates the whole sync
> campaign and recommends reusing `till_id`, contradicting the `node_id` re-key that landed as #54) —
> do not start from it. File:line references below come from the 2026-08-15 research pass; re-confirm
> at implementation time.

---

## 1. Scope

**In slice 1:**

- A `@waitron/sync` **transport module**: a source read + a pull loop that feeds the existing
  `applyBatch`.
- A `mountSyncApi` HTTP group on `apps/server`, **node-token authenticated** (not a person session).
- The wire format (NDJSON; `row_image` carried as raw `jsonb` text — see §4b).
- **Two required fixes** that redelivery makes load-bearing: (A) gate the un-gated business
  BEFORE-triggers on `app.sync_apply`; (B) thread `nodeId` through the `payments`/catalogue write
  paths.

**Deferred (each its own later slice):** the tighter **payments fast lane** (a second cadence/lane),
the **cloud-mirror** peer, **dead-subscriber** cleanup ops, **multi-tenant** transport (a whole-log
reader role), node-**token rotation** (deployment #9 owns production TLS + secret lifecycle), and
promotion/fencing tooling.

**Excluded (a separate owner-reviewed slice, H2):** the **fiscal-lane / hash-chain sync**
(`registros_facturacion`, the `registro_sif`/`cadenas`/`invoice_series` identity tables, and the
`envios`/`envio_flujo`/`acks` submission state). Slice-1's registry deliberately enrols only the 14
non-fiscal commercial tables.

**Owner decisions (2026-08-15):** symmetric **HTTP pull**; node-to-node auth by **pre-shared node
token over TLS**.

---

## 2. Inherited constraints (from the governing spec + the container gates)

Settled, not re-litigated here:

- **Apply is application-level** — native logical-replication *apply* is categorically refused into an
  RLS relation by a non-BYPASSRLS role, and provisioning refuses a BYPASSRLS role. Every apply is our
  own process inserting each foreign row as `app_user` with `app.tenant_id` set via `withTenant`.
- **Owner column is explicit `node_id`** on the commercial tables (the #54 re-key); `sync_capture`
  reads it directly.
- **Conflict-freedom by construction** — each node is the sole writer of its own `node_id` partition,
  so `ON CONFLICT` only ever de-duplicates a re-delivery, never adjudicates.
- **Ordering** — apply in the origin's commit order (`sync_log.seq` ascending), one ordered lane per
  origin; `23503` FK-violations park and retry after the parent lands.
- **`envios`/`acks` carry no monotonic column** (container gate 2) → they are **ineligible for any
  reordering / fast lane** and must ride the single ordered lane. (They are fiscal-lane and thus
  excluded from slice 1 anyway, but the routing rule stands.)
- **Environment isolation crosses the boundary** — a peer refuses a mismatched
  `deployment.environment` (`sync.peer_environment_mismatch`) before applying anything.
- **Retention holds the log at `min(last_applied_seq)` across ALL subscribers**, alive or down.

---

## 3. What #74 already provides (reused unchanged)

- `applyBatch(subscriberDb, rows, opts): Promise<ApplyBatchResult>` (`apply.ts:114`) — reads the
  authoritative env stamp (`readDeploymentEnvironment`, `db/deployment.ts:35`), throws
  `sync.peer_environment_mismatch` on a mismatched source (`apply.ts:120-138`), sorts by `seq`,
  applies each row in its own `withTenant` tx with `app.sync_apply='on'` (the echo guard) binding the
  image as `$1::jsonb` (`apply.ts:287-300`), parks `23503` children and retries (`apply.ts:266-277`),
  and advances each cursor only **below any still-parked gap** (`apply.ts:203-212`) — the at-least-once
  invariant the transport relies on.
- `SyncLogRow = { seq, originId, table, op, tenantId, rowImage, txid? }` (`apply.ts:30`).
- `sync_log` / `sync_cursor` (migration `0000_sync_outbox.sql`); `sync_tailer` holds per-tenant
  `SELECT` on `sync_log`; `sync_retention` (migration `0001`) holds whole-log `SELECT,DELETE` via a
  permissive policy. The apply worker connects as a LOGIN role that is a member of `app_user` **and**
  `sync_tailer`.
- `withTenant(tx, tenantId, fn, { nodeId })` (`db/tenancy.ts:52`) — when `nodeId` is supplied it sets
  `app.node_id`, which `sync_capture` stamps into `sync_log.origin_id`; omitting it falls back to the
  all-zero origin (fix B closes that gap for the non-till writers).

---

## 4. Components

### 4a. `@waitron/sync` transport module (new)

- `readSyncLogSince(sourceDb, { originId, afterSeq, limit }): Promise<SyncLogRow[]>` — runs as
  `sync_tailer` under the deli tenant context; selects `sync_log` rows with `seq > afterSeq` (optionally
  for one `originId`), `order by seq asc limit N`. **Selects `row_image::text`** (see §4b).
- `syncPullOnce(localDb, peer, { subscriberId }): Promise<ApplyBatchResult>` — reads the local
  `(subscriberId = local node id, originId = peer node id)` cursor, HTTP-GETs the peer's `/sync-api/log`
  past it, decodes the NDJSON into `SyncLogRow[]`, and calls `applyBatch` (which advances the cursor).
- **The pull worker** — a background loop started in `boot.ts`: for each configured peer, GET
  `/sync-api/hello` once (env + node-id handshake), then repeatedly `syncPullOnce` until a batch comes
  back empty, then sleep and repeat. Bounded exponential backoff on transport/HTTP errors; a persistent
  lag past a threshold raises `sync.stream_stalled` (already defined) for the operator alarm.

### 4b. Wire format — the byte-identity rule

Container gate finding (ii): `to_jsonb`/`jsonb_populate_record` preserve `1.50::numeric` byte-for-byte
**in-process**, but a JSON transport that lets **JS re-parse the numbers** would turn `1.50` into `1.5`
and corrupt money/quantity columns. So:

- The source selects `row_image::text` — Postgres's canonical `jsonb` text.
- Each NDJSON line carries that text as a **string** field (`rowImage` is a JSON-encoded string, not an
  inlined object), plus `seq` **as a string** (dodges JS's 2^53 limit), and the plain
  `originId`/`table`/`op`/`tenantId`.
- On apply, that string is bound as a **text parameter** and cast `$1::jsonb` — **JS never parses the
  row's numeric values**. `applyBatch`/`applyOneRow` must therefore accept `rowImage` as raw jsonb text
  and bind it as text→jsonb (a small, explicit change to how the image is bound; verify the current
  binding path).

This is the load-bearing correctness point of the transport and gets its own byte-identity test (§7).

### 4c. `apps/server` — `mountSyncApi` (new), node-token authenticated

A new `apps/server/src/sync-api.ts`, mounted in `boot.ts`, gated by a **node-token middleware**
(`Authorization: Bearer <token>` checked against the configured peer tokens) — **not** the person
session cookie.

| Route | Purpose |
| --- | --- |
| `GET /sync-api/hello` | returns this node's `{ nodeId, environment }` for the peer's handshake |
| `GET /sync-api/log?originId=&after=&limit=` | NDJSON stream of `sync_log` rows past `after`, read as `sync_tailer` |

The DB connection for these routes uses a role that is a member of `sync_tailer` (read) under the deli
tenant context. Config (new): `WAITRON_SYNC_NODE_ID`, `WAITRON_SYNC_NODE_TOKEN` (this node's token that
peers must present), and `WAITRON_SYNC_PEERS` (a list of `{ nodeId, url, token }` — the token to present
to each peer). Over TLS in production (#9); dev on loopback/LAN. An empty/blank token or peer URL is
refused explicitly (the empty-connection-string / empty-filter class of trap — a blank secret must fail
closed, never default to "no auth").

### 4d. The two required fixes

- **(A) Gate the business BEFORE-triggers.** `tenders_reject_post_settlement`,
  `working_orders_enforce_transition`, and `working_order_lines_require_open_parent` are **not** gated
  on `app.sync_apply`. Under redelivery (which slice-1 lacked), a batch that throws a **non-`23503`**
  error mid-way leaves committed rows above an un-advanced cursor; re-applying e.g. a `tenders` row
  after its `sale_settlements` row committed raises `WT002` and **wedges the stream**. Fix: one
  `packages/db` migration re-creating each trigger with `WHEN (app.sync_apply IS DISTINCT FROM 'on')`
  (the mirror applies a source's already-validated write verbatim). **Re-create from each trigger's
  latest definition** — some were re-created by `0030_prepare_collect.sql`, not only their original
  `0004`/`0012` — so read the current DDL before copying. This is the slice's **only** `packages/db`
  migration.
- **(B) Thread `nodeId` through the remaining writers.** `payments`/`payment_refunds`
  (`packages/payments/src/reconcile.ts`) and the catalogue write paths use the plain 3-arg
  `withTenant`, so they capture the **all-zero** origin. Before two nodes write concurrently, thread
  `{ nodeId: cfg.nodeId }` through those paths (the till path already does, `apps/server/src/working-order.ts`),
  so the cursor/lag/retention model — all keyed on `origin_id` — cannot conflate two sources' sequences.
  Code-only, no migration.

---

## 5. Data flow

```
pull worker (per configured peer)
  → GET peer /sync-api/hello        (node token; env + node-id handshake)
  → loop: GET peer /sync-api/log?originId=<peer>&after=<local cursor>&limit=N   (NDJSON, row_image as jsonb text)
        → applyBatch(localDb, rows, {subscriberId=localNode, localEnvironment, sourceEnvironment})
            → env handshake → per-row withTenant+app.sync_apply='on' → $1::jsonb apply → 23503 park/retry
            → advance sync_cursor below any gap
     until empty → sleep(backoff) → repeat
```

Symmetric: every node runs both the `mountSyncApi` source **and** the pull worker against its peers
(true active-active, owner decision).

---

## 6. Error handling

- **Env mismatch** — `applyBatch` throws `sync.peer_environment_mismatch` before applying anything; the
  worker logs, alarms, and does **not** advance. (Environment isolation is unrecoverable if crossed —
  fiscal §5 "one database per environment".)
- **Auth** — a missing/blank/wrong node token → 401 from `mountSyncApi`; the worker backs off.
- **FK park** — a `23503` child whose parent has not arrived stays parked, cursor held; at-least-once
  redelivery lands it on a later pass.
- **Stalled stream** — lag past threshold → `sync.stream_stalled` for the operator.
- **No error param carries row content** (the `sync.*` code rule).

---

## 7. Testing

- **Real-Postgres two-node end-to-end** (two DBs/containers; needs `TESTCONTAINERS_RYUK_DISABLED=true`
  locally): capture a commercial write on the source, pull, assert it lands on the target and the
  cursor advances; re-pull the same range and assert **idempotent** (no duplicate, no error).
- **Redelivery-wedge test — proves fix (A) by deletion:** without the trigger guard, a redelivered
  `tenders`/settlement sequence raises `WT002`; with it, clean. Remove the guard, watch it fail,
  restore.
- **Byte-identity test:** file a row with a money/quantity `numeric` (e.g. `1.50`), pull it across the
  HTTP wire, assert the target column is byte-identical — the control that JS never re-quoted the
  number.
- **Env-mismatch refusal:** a source stamped `production` against a `preproduction` local refuses
  (`sync.peer_environment_mismatch`), by deletion of the handshake.
- **Node-token auth:** blank/absent/wrong token → 401; correct token → stream (fail-closed proven).

The two-node container harness is the heavy part; pick real-Postgres only where the property needs it
(RLS-as-`app_user`, concurrency, cross-DB), PGlite nowhere here (it is single-backend + superuser).

---

## 8. Parallel-safety with the shift-planning slice

This slice's **only** `packages/db` migration is the trigger-gating (A). The shift-planning slice adds
**no** migration. Since only this slice touches `packages/db/drizzle/meta/_journal.json`, the two
branches cannot collide there — safe in parallel worktrees.

---

## 9. Receipts

- The three business triggers live in `packages/db/drizzle` — grep found
  `0004_working_orders.sql`, `0012_sale_settlement.sql`, **and `0030_prepare_collect.sql`** name them,
  so the gating migration must re-create from the latest (`0030`) definition, not the originals.
- `sync_capture`, the `WHEN app.sync_apply` echo guard, the `to_jsonb`/`jsonb_populate_record`
  round-trip, the `23503` fast-lane defer, and the environment handshake were all proven to work with
  **no new privilege** on real `postgres:18-alpine` — `2026-08-06-sync-container-gates-findings.md`
  (nine gates, all pass).
- Byte-identity caveat (JSON wire re-quoting numerics) — same findings doc, "surprise (ii)": the
  round-trip is proven **in-process**, not through a JSON transport, which is why §4b keeps JS away
  from the row's numbers.
- `payments`/`payment_refunds` use the plain 3-arg `withTenant` (all-zero origin) —
  `reconcile.ts:280,318,662` (research pass); confirm at implementation.
