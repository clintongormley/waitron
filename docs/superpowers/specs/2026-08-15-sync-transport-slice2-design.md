# Sync transport / network layer — slice 2 design (2026-08-15)

**#33 §14, on top of the transport slice 1 (#84) and the commercial-lane outbox (#74).** Slice 1
built the symmetric HTTP pull that moves `sync_log` batches between the two shop servers on **one
ordered lane per origin**. This slice adds exactly **one** of the five pieces slice 1 deferred:
**(a) a payments fast lane** — a second, tighter cadence carrying only `payments` + `payment_refunds`
independently of the ordered stream, so the customer-money (double-charge) exposure that active-active
selling creates is replicated ahead of the rest of the commercial stream.

> **The governing design is `2026-08-02-app-level-sync-design.md`** (reviewed with the owner). Its §9
> recommends the payments fast lane ("a real second cadence to build and tune, and the reason §4 needs
> the cross-lane FK-defer backstop"); its §11 / §12 decision 3 settled "a separate fast replication lane
> for `payments` → BUILD IT". This slice is that build. The governing text predates the
> `server_id`→`node_id` re-key (#54): where it writes `server_id`, the shipped schema reads `node_id` /
> `origin_id`. File:line references below come from the 2026-08-15 research pass against the landed
> `@waitron/sync`; re-confirm at implementation time.

---

## 1. Scope

**In slice 2 — the payments fast lane, and only that:**

- **(a) Payments fast lane.** A `lane` dimension on `sync_cursor` so the fast and ordered streams
  track **independent cursors**; `payments` + `payment_refunds` marked fast in the enrolment registry;
  a lane/table filter on `readSyncLogSince` and `/sync-api/log`; and a **second cadence** in
  `runSyncPull` — a tight tick for the payments lane beside the existing tick for the ordered lane.

**Deferred (each still its own later slice), the four remaining transport-2 pieces:**

- **Dead-subscriber cleanup** — draining the log past a node an operator declares dead. Briefly scoped
  into this slice, then **pulled back out** (owner decision, 2026-08-15): shipping it here would put the
  capability two layers ahead of the machinery that uses it. It needs, designed as **one coherent unit**
  by a future **retention-operations** slice:
  - **(i) `pruneSyncLog` actually scheduled.** Today it is an unwired library function `boot.ts` never
    calls (nor `lagFor`); nothing drains the log yet, so nothing is *held* by a dead subscriber yet.
  - **(ii) a cross-node cursor-visibility mechanism.** In the real two-node topology a subscriber writes
    its cursor **locally** — `applyBatch` advances `sync_cursor` on the *subscriber's own* database
    (`apply.ts:325-338`) — while `pruneSyncLog` and any eviction run on the database that **holds
    `sync_log`**. The co-located model where both meet in one database holds only in the gate test
    (`retention.gate.test.ts`), not across two nodes. Until a subscriber's cursor is visible to the
    source, an eviction verb there has nothing coherent to act on.
  - **(iii) the eviction verb itself + its `sync_cursor` DELETE grant.** `sync_retention` holds only
    `SELECT, INSERT, UPDATE` on `sync_cursor` today (`0001_sync_retention.sql:55`); the future slice adds
    the `DELETE` grant alongside the verb that needs it.

  **The explicit-not-automatic decision that future slice inherits (recorded here so it is not
  relitigated):** eviction must be an **explicit operator action, never automatic**. Declaring a node
  dead is a human call (governing §12 decision 4 ops-policy; #33 §8 human-driven failover) — "slow" and
  "dead" look identical from the log (a cursor that stopped advancing), and only a human knows whether
  the peer is coming back. **Auto-evicting a merely-slow-but-alive node is silent, unrecoverable data
  loss:** in true active-active (governing §12 decision 5) each node is the sole writer of its own
  partition, so if node B is slow (a network partition, a long GC pause) and the system evicts B's cursor
  to free A's log, A **prunes `sync_log` rows B has not yet applied**; when B returns they are gone from
  A's log, and because each row has exactly one writer they cannot be re-derived. The at-least-once,
  hold-for-the-slowest model (`retention.ts:50-63`; governing §9) exists precisely so a slow node loses
  nothing — automatic eviction defeats the reason it was chosen. So the future verb is invoked by a human
  only after independently confirming the node is gone (a reimaged node returns with a **fresh** identity
  and re-subscribes from zero — `CLAUDE.md` §5, "re-registering a till starts a new chain").
- **Multi-tenant transport** — a whole-log reader role so the cloud mirror can iterate every tenant.
  The tailer stays per-tenant fenced (`sync_log_tenant_isolation`, `0000_sync_outbox.sql:48`).
- **Cloud-mirror peer** — a third, read-only subscriber (governing §9). This slice adds no cloud role.
- **Node-token rotation** — deployment (#9) owns production TLS + secret lifecycle; the node token is
  still a single pre-shared value per node (`config.ts:193`).

**Still deferred from slice 1's own list (unchanged):** the **fiscal lane / hash-chain sync**
(`registros_facturacion`, the `registro_sif`/`cadenas`/`invoice_series` identity tables, and the
`envios`/`envio_flujo`/`acks` submission state — governing §8), promotion/fencing tooling (governing
§15), and config-flow-down of the reference tables. The fiscal-lane routing rule stands: `envios`/`acks`
**carry no monotonic column** and are **ineligible for any fast lane** (governing §11) — a fact this
slice does not disturb, because the only tables it moves to a fast lane are the two named below.

**Owner decisions carried in (governing §12):** a `payments` fast lane is BUILT (decision 3); the deli
is TRUE ACTIVE-ACTIVE (decision 5), which is why the fast lane matters — it shrinks the customer-money
(double-charge) exposure that only exists because both nodes sell concurrently.

---

## 2. Inherited constraints (settled, not re-litigated here)

- **One ordered lane per origin, apply in `seq` order** (governing §4). `sync_log.seq` ascending is a
  topological order of the FK graph within one origin, so a parent's row carries a strictly lower `seq`
  than its child's (`registry.test.ts:177-209` pins the rank invariant).
- **The `23503` FK-defer backstop already exists** (governing §4, "for when a lane is split"). It is
  the machinery a split lane needs, and it is already in `applyBatch` — §3 confirms it by citation, and
  **no new correctness machinery is added by this slice.**
- **Retention holds the log at `min(last_applied_seq)` across ALL `sync_cursor` rows**, alive or down
  (`retention.ts:78-88`); `alive` is alarm metadata, never a prune filter (`retention.ts:43-47`;
  governing §9 correction). A down subscriber therefore holds the log — the deliberate trade for
  at-least-once with no data loss. Draining past a genuinely-dead subscriber is the deferred
  retention-operations concern (§1), not built here; retention itself is unwired and unchanged by this
  slice.
- **Conflict-freedom by construction** — each node is the sole writer of its own `origin_id` partition,
  so every `ON CONFLICT` only de-duplicates a re-delivery (governing §9).
- **Environment isolation crosses the boundary** — `applyBatch` throws `sync.peer_environment_mismatch`
  before applying anything (`apply.ts:136-141`); untouched here.
- **Cursor monotonicity** — `advanceCursor`'s `WHERE excluded.last_applied_seq > sync_cursor.last_applied_seq`
  never moves a cursor backward (`apply.ts:325-338`); the lane split preserves this per lane.

---

## 3. What slices #74 / #84 already provide (reused unchanged, and the backstop confirmed)

- **`applyBatch(subscriberDb, rows, opts)`** (`apply.ts:117-218`) — reads each origin's cursor once
  (`readCursors`, `apply.ts:307-317`), applies each row in ascending `seq` in its own `withTenant` tx
  with `app.sync_apply='on'` (`apply.ts:290-304`), and advances each origin's cursor **only below any
  still-parked gap** (`apply.ts:206-215`).
- **The `23503` park — the cross-lane backstop this slice depends on, confirmed by reading `applyBatch`:**
  - `tryApplyRow` returns the sentinel `"deferred"` **only** on SQLSTATE `23503`; every other error
    propagates (`apply.ts:269-280`, the `pgErrorCode(error) === "23503"` branch at `apply.ts:277`).
  - a parked row is pushed to a retry queue (`apply.ts:190`) and retried after the rest of the batch
    lands its parent (the retry pass, `apply.ts:194-204`);
  - the cursor is held **below the lowest still-parked seq** (`eligible = settled.filter(s => deferred.every(d => s < d))`,
    `apply.ts:212-214`), so a later batch redelivers the parked row (at-least-once).
  **This is exactly the ordering hazard a split lane introduces** (governing §4): a fast-lane
  `payments` row whose parent is still on the ordered lane raises `23503`, parks, and lands on a later
  fast pull once the ordered lane has delivered the parent — see §4e. No new code.
- **`runSyncPull` / `syncPullOnce`** (`pull.ts:80-196`) — the per-peer drain loop with bounded backoff,
  keyed on `fetched` **and** `advanced`, never `applied` (`pull.ts:173-176`). Its progress guard already
  breaks a full-but-unadvanced page and yields to the round-robin — the property the fast lane reuses
  for cross-lane parking (§4e).
- **`sync_cursor`** — `(subscriber_id, origin_id)` PK, `last_applied_seq`, `alive`, **no `tenant_id`,
  no RLS** (`0000_sync_outbox.sql:100-107`), granted `SELECT, INSERT, UPDATE` to `sync_tailer`
  (`:109`).
- **The registry** — `ENROLLED` (`registry.ts:39-164`), the audit surface for "what crosses the wire",
  pinned table-by-table against governing §2 by `registry.test.ts`.

---

## 4. Piece (a) — the payments fast lane

### 4a. A `lane` dimension on `sync_cursor`

Today one ordered lane per origin uses one cursor row per `(subscriber, origin)`. Two lanes need two
independent cursors per `(subscriber, origin)`, so:

- Add `lane text not null default 'ordered'` to `sync_cursor`.
- Re-pivot the primary key from `(subscriber_id, origin_id)` to `(subscriber_id, origin_id, lane)`.

Migration `0002_sync_cursor_lane.sql` in `packages/sync/drizzle/` (numbering + custom-vs-auto in §5).
The `default 'ordered'` matters only for the pre-production drop-and-recreate story: there is no
deployed data (`CLAUDE.md` §3, "no backwards-compatibility … until Waitron is in production"), and a
freshly-migrated database has zero `sync_cursor` rows, so the default backfills nothing — it exists so
a hand-run `INSERT` that omits `lane` still lands on the ordered lane, matching the wire default (§4c).

**Consumers of the old two-column key that this PK change forces to update** (traced, `CLAUDE.md` §1):

| Site | Today | After |
| --- | --- | --- |
| `apply.ts:307-317` `readCursors` | `where subscriber_id = $1` | add `and lane = $2`; read the applying lane's cursors only |
| `apply.ts:325-338` `advanceCursor` | `on conflict (subscriber_id, origin_id)` | `on conflict (subscriber_id, origin_id, lane)` (arbiter = the new PK), carry `lane` in the insert |
| `apply.ts:183-188` seq-skip | compares against `cursorAtStart.get(originId)` | compare against the applying lane's cursor |
| `pull.ts:62-68` `readCursor` | `where subscriber_id = $1 and origin_id = $2` | add `and lane = $3` (else it reads an arbitrary one of the two lane rows) |
| `retention.gate.test.ts:74-79` `setCursor` | `on conflict (subscriber_id, origin_id)` | `(subscriber_id, origin_id, lane)`, seed a `lane` value |

`pruneSyncLog` (`retention.ts:78-88`) needs **no** change — it `group by origin_id` and takes the
`min`, which now naturally spans both lane rows (§4e proves this waits for the slower lane).

**`lagFor` also reads `sync_cursor` — and needs no change to stay green (verified, left untouched).**
`lagFor` (`retention.ts:97-127`) selects one row per `sync_cursor` row, so with the lane column it will
return one row **per lane** per `(subscriber, origin)` once both lanes have cursors. Its gate test does
**not** break under this: it locates rows by `subscriberId` via `.find` and asserts fields via
`toMatchObject` (`retention.gate.test.ts:134-138`) with **no** row-count assertion, so the extra lane
rows are invisible to it — only the cursor-**writing** fixture `setCursor` must add a `lane` (the table
row above). So `lagFor` is left **untouched**. Giving its output a `lane` field so the two rows are
distinguishable belongs to the deferred retention-operations slice that actually consumes `lagFor` (§1);
today it is an unwired reporting function (`boot.ts` calls neither `lagFor` nor `pruneSyncLog`), so the
undistinguished rows harm nothing this slice ships.

### 4b. Marking the fast-lane tables in the registry

`payments` (`registry.ts:128-135`, `fkRank 1`) and `payment_refunds` (`registry.ts:93-100`, `fkRank 2`)
become the fast-lane tables; the other twelve enrolled tables stay ordered.

**How the lane attaches to `EnrolledTable`.** The registry style is fully explicit — every field is
spelled out on every one of the fourteen entries, with no implicit defaults in the structure
(`registry.ts:39-164`). So add an explicit field, not a side set:

```ts
export type SyncLane = "ordered" | "fast";
// …in EnrolledTable:
/** Which replication lane carries this table (§ fast-lane design). `payments`/`payment_refunds`
 *  ride the tight fast lane; every other enrolled table rides the ordered lane. */
lane: SyncLane;
```

Set `lane: "fast"` on `payments` and `payment_refunds`, `lane: "ordered"` on the other twelve. Derive
the per-lane table list once from `ENROLLED` — a helper `tablesForLane(lane): string[]` — rather than a
second hand-kept array (the drift `CLAUDE.md` §2 warns of). Extend `registry.test.ts`'s independent
`SPEC` table with `lane`, and add an assertion that the **fast set is exactly `{payments,
payment_refunds}`** and the ordered set is the remaining twelve — so a future enrolment can't silently
land a table on the wrong lane. This mirrors how `registry.test.ts:124-144` already pins mode / key /
watermark / captureOps.

`envios`/`acks` never appear here (they are fiscal-lane, not enrolled — governing §11's fast-lane
ineligibility is honoured by construction: they are not in `ENROLLED` at all).

### 4c. The source read + `/sync-api/log` gain a lane/table filter

**`readSyncLogSince`** (`source.ts:22-52`) gains an optional table filter:

```ts
export interface ReadSyncLogArgs {
  originId?: string;
  afterSeq: bigint;
  limit: number;
  tables?: string[]; // restrict to these table_names (a lane's tables); omitted → every table
}
```

Add `and table_name = any(${tables})` to the `where` (alongside the existing `seq > afterSeq` and
optional `origin_id`, `source.ts:37-39`). The array binds as a single parameter (`= any($n)`), so no
identifier is interpolated and the `CLAUDE.md` §3 concatenation question does not arise — the values
are fixed registry names regardless.

**`/sync-api/log`** (`sync-api.ts:94-109`) gains a `lane` query param. The **lane** is the wire
dimension, not a client-supplied table list: both nodes run the same registry, so the route maps
`?lane=` → `tablesForLane(lane)` server-side and passes that to `readSyncLogSince`. Concretely:

```text
GET /sync-api/log?originId=<peer>&after=<cursor>&limit=N&lane=fast|ordered
```

An unknown or missing `lane` **clamps to `ordered`**, following the machine-to-machine fail-safe posture
this endpoint already takes for `after` and `limit` (`sync-api.ts:30-56`: garbage clamps to a safe
default, never a 400 — the endpoint has no param-invalid convention). Clamping to `ordered` is the safe
direction: the ordered tables never silently disappear, and the fast tick always sends `lane=fast`
explicitly (a test pins that the fast pull requests exactly `{payments, payment_refunds}`). Sending an
explicit `lane` per request means the single undifferentiated slice-1 stream (all fourteen tables in one
pull) no longer exists — every pull is now lane-scoped. That is a clean break, permitted because nothing
is deployed and both peers upgrade together (`CLAUDE.md` §3).

### 4d. Two cadences in `runSyncPull`

`runSyncPull` becomes **lane-scoped**: it gains a `lane: SyncLane` and threads it through `syncPullOnce`
(which requests `?lane=` and reads/advances the `(subscriber, origin, lane)` cursor) and through
`ApplyBatchOptions.lane` (which selects the cursor rows `applyBatch` reads and advances). `boot.ts`
then starts **two** invocations against the same peers, same `localDb`, same HTTP client:

- the **ordered lane** at the existing idle interval `config.minTickMs` and backoff ceiling
  `config.maxTickMs` (`boot.ts:382-383`, unchanged cadence);
- the **fast lane** at a tighter idle interval (a new knob, below), same backoff ceiling.

`boot.ts` wraps the two in `syncWorker = Promise.all([ordered, fast])` (or awaits both in `close()`);
the existing `syncController.abort()` (`boot.ts:547`) stops both, and the existing
`await syncWorker.catch(() => {})` teardown (`boot.ts:556`) already swallows a worker rejection so it
cannot skip pool teardown — that guard covers two lanes as written.

**Running two lanes concurrently against one peer is safe** because they touch **disjoint tables**
(fast `{payments, payment_refunds}`; ordered the other twelve) and **disjoint cursor rows**
(`lane='fast'` vs `lane='ordered'`), so they never race on a row or a cursor. The one cross-lane
interaction — a fast `payments` row referencing an ordered `working_orders` parent — is resolved by the
`23503` park, not by a shared transaction (§4e). Each invocation keeps its own per-peer backoff map
(`pull.ts:162`), so a peer being unreachable stalls both lanes independently and each logs its own
`sync.stream_stalled`; add `lane` to the transport signal's params so the alarm names which lane
saturated (`sync.stream_stalled`'s transport variant, `errors.ts:38-40` — a param-shape change, not a
code rename, so it stays within `CLAUDE.md` §3's "codes are never renamed" rule). `sync.pull_failed`
(`pull.ts:182`) is a log line, not a registered thrown code, so adding `lane` to it is free.

**The fast-tick knob.** Add `fastMinIdleMs` to `SyncTransportConfig` (`config.ts:148-152`), parsed by
`loadSyncConfig` from `WAITRON_SYNC_FAST_TICK_MS` as a positive integer (the existing `parsePositiveInt`
shape, `config.ts:206-214`), defaulting to a tight value (a starting point — **1000 ms** — that
governing §9 explicitly says is a tuning target, not a settled constant). It lives on the sync config
because it is meaningless without sync enabled, the same reason `nodeToken`/`peers` do. No cross-guard
against `minTickMs` is imposed: a fast tick that is not tighter than the ordered tick is a
mis-tuning, not a correctness failure, and the scheduler's `minTickMs`/`skipRetryMs` guards
(`config.ts:263-309`) are about the fiscal loop, orthogonal to sync.

### 4e. The fast-lane cursor invariant (the load-bearing correctness point)

Two lanes read the **same** `sync_log` ordered by the same `seq`. What keeps each lane's cursor from
being dragged past the other lane's un-applied rows is that **the two lanes read a disjoint set of
tables**, so a given `sync_log` row belongs to **exactly one lane** (decided by `table_name`), and the
two lanes' `seq` streams are disjoint subsequences of `sync_log`.

- **Each cursor advances only over its own lane's rows.** A fast pull requests `?lane=fast`, so
  `readSyncLogSince` returns only `payments`/`payment_refunds` rows; `applyBatch` (opts `lane='fast'`)
  reads, skips against, and advances **only** the `lane='fast'` cursor row. It can never advance the
  `lane='ordered'` cursor, so it can never make the ordered lane skip an un-applied `sales`/`tenders`/…
  row. Symmetrically for the ordered lane. This is the whole reason the `lane` column exists: with one
  shared cursor, a fast pull that advanced to seq 4 (a `payments` row) would make the ordered lane skip
  the `sales` row at seq 1 and the `tenders` row at seq 3 — silent data loss. Separate lane cursors
  remove that by construction.

- **The cross-lane FK hazard is handled by the pre-existing `23503` park.** `payments.working_order_id`
  is **NOT NULL → `working_orders`** (`packages/payments/src/schema/payments.ts:56`; governing §4:279),
  and `working_orders` is an **ordered-lane** table. So a fast `payments` row can arrive before its
  `working_orders` parent (also `payments.sale_id` → `sales`, nullable, `payments.ts:59`, another
  ordered-lane parent when set). When the fast lane applies such a row and the parent is absent,
  `applyBatch` gets `23503`, **parks** it (`apply.ts:277,190`), the in-batch retry cannot land it
  (the parent is on the *other* lane, never in a fast batch), so the fast cursor is **held below** the
  parked seq (`apply.ts:212-214`), `applyBatch` returns `advanced=false`, and `runSyncPull`'s progress
  guard **breaks the drain and yields** (`pull.ts:175`). On a later fast tick the row is redelivered;
  once the ordered lane has applied the parent, it lands. `payment_refunds → payments` is **intra**-fast-lane
  (`registry.test.ts:196`), so seq-order within the fast batch already orders it — no cross-lane park.
  > **Note for the implementer:** `pull.ts`'s progress-guard comment (`pull.ts:150-158`) frames the
  > `advanced=false` break as *cross-origin* parking (a parent on a different peer). The fast lane adds
  > a *cross-lane* case with the identical signature (a full page, all `23503`-parked, `advanced=false`).
  > Update that comment to name both causes; the mechanism is unchanged.

- **Retention correctly waits for the slower lane, and never prunes a row either lane still needs.**
  `pruneSyncLog` groups `sync_cursor` by `origin_id` and takes `min(last_applied_seq)`
  (`retention.ts:80-85`). With the lane split there are now up to **2× the cursor rows per
  `(subscriber, origin)`**, and the `group by origin_id` `min` naturally spans **both** lanes (and all
  subscribers). A `sync_log` row at seq `S` (belonging to lane `L`) is deleted only when the per-origin
  min ≥ `S`, which requires **every** cursor for that origin — including lane `L`'s own cursor for every
  subscriber — to have passed `S`. So no row is ever pruned before its own lane has applied it: **safe**.
  It also requires the *other* lane's cursor ≥ `S`, which is stricter than necessary (the other lane
  never consumes row `S`), so retention is **conservative** — during a lane lull it holds already-applied
  rows until the trailing lane's `seq` catches up. That over-retention is **bounded and harmless** (a
  lull produces few new rows; in an active POS payments are frequent, so the fast cursor tracks near the
  head), and it is the deliberate "hold at the slowest confirmed position" discipline the whole retention
  model already embodies (`retention.ts:52-63`). A per-lane-`max` refinement (prune each lane's tables to
  its own lane's cursor) is a possible future precision improvement, deliberately **not** built here.

**The invariant, stated:** *for every origin, `pruneSyncLog` holds `sync_log` at the minimum
`last_applied_seq` across all `(subscriber, lane)` cursor rows, so a `sync_log` row is deleted only
after every lane that could consume it has applied it — the fast and ordered cursors advance
independently and neither drags the other.*

**The test that proves it** (real Postgres, §8): seed `sync_log` with interleaved fast-lane and
ordered-lane rows for one origin; set the **fast cursor high and the ordered cursor low** (and, as the
control in the other direction — `CLAUDE.md` §1 "a measurement where both answers look alike measures
nothing" — the fast low and the ordered high); assert `pruneSyncLog` holds at the **slower** lane's seq
in each case and that the two lane cursors **visibly disagree** (as `retention.gate.test.ts:116-131`
already contrasts the min-across-all vs the naive live-only min). Prove by deletion that advancing one
lane's cursor alone does **not** move the boundary, and advancing the trailing lane does. (`pruneSyncLog`
itself is unchanged; this test is new because the *fixture* — two lane cursors per origin — is new.)

---

## 5. Migrations & numbering

`packages/sync/drizzle/meta/_journal.json` lists `0000_sync_outbox` and `0001_sync_retention` (idx 0,
1), so the next free number is **`0002`**. This slice adds exactly **one** migration:

- **`0002_sync_cursor_lane.sql`** — `alter table sync_cursor add column lane text not null default
  'ordered'`; then `alter table sync_cursor drop constraint sync_cursor_pkey` and `alter table
  sync_cursor add primary key (subscriber_id, origin_id, lane)`.

(The `sync_cursor` DELETE grant that dead-subscriber eviction needs is **not** here — it ships with the
verb in the deferred retention-operations slice, §1.)

**It is a hand-written custom migration (`drizzle-kit generate --custom`), not auto.** `sync_cursor` is
created in raw SQL and is **not** a Drizzle-modelled table, so `drizzle-kit` has nothing to diff a PK
change against — the existing `0000`/`0001` say exactly this (`0000_sync_outbox.sql:1-3`;
`0001_sync_retention.sql:1-4`, "drizzle-kit models no roles, policies or grants, so none of this
survives a later `generate`"). A PK repivot is in that same set. Per repo convention add a journal entry
and a `0002_snapshot.json` copy (the migrator reads only the journal + `<tag>.sql`; the snapshot is
convention, never read at runtime — `migrations.ts:9-14`).

`packages/migrations/migrations.manifest.json` is **unchanged**: it points at the `sync` folder and the
journal enumerates the members (`migrations.manifest.json:38-42`), so adding `0002` needs no manifest
edit.

---

## 6. Data flow

```text
boot.ts (sync enabled): two lane-scoped runSyncPull invocations, per peer, sharing localDb + http
  ORDERED lane  (idle config.minTickMs, backoff config.maxTickMs):
    → GET peer /sync-api/log?originId=<peer>&after=<ordered cursor>&limit=N&lane=ordered   (12 tables)
        → applyBatch(localDb, rows, { subscriberId, lane: 'ordered', … })
            → advance (subscriber, origin, 'ordered') cursor below any gap
  FAST lane     (idle WAITRON_SYNC_FAST_TICK_MS ~1s, backoff config.maxTickMs):
    → GET peer /sync-api/log?originId=<peer>&after=<fast cursor>&limit=N&lane=fast          (payments, payment_refunds)
        → applyBatch(localDb, rows, { subscriberId, lane: 'fast', … })
            → a payments row whose working_orders parent is still on the ordered lane → 23503 → park,
              hold the fast cursor below it, advanced=false → drain breaks, yields; redelivered next
              fast tick, lands once the ordered lane has applied the parent
            → advance (subscriber, origin, 'fast') cursor below any gap
```

Symmetric and active-active as before: every node runs both the `mountSyncApi` source and both pull
lanes against its peers. **Retention adds no runtime step here** — `pruneSyncLog` stays unwired (`boot.ts`
does not call it); when a future retention-operations slice runs it, its per-origin `min(last_applied_seq)`
now spans both lane cursor rows (§4e), holding the log at the slower lane.

---

## 7. Error handling

- **Cross-lane FK park** — a fast `payments` row whose ordered parent has not arrived stays parked, the
  fast cursor held below it, redelivered on a later fast pull (`apply.ts:212-214`; §4e). No new error.
- **Env mismatch** — unchanged: `applyBatch` throws `sync.peer_environment_mismatch` before any row on
  either lane (`apply.ts:136-141`).
- **Auth** — unchanged: a missing/blank/wrong node token → 401 (`sync-api.ts:69-77`), the fast and
  ordered pulls both back off.
- **Stalled lane** — a lane's backoff saturating raises `sync.stream_stalled`; add `lane` to the
  transport variant's params so the alarm names the stalled lane (`errors.ts:38-40`).
- **No error param carries row content** (the `sync.*` code rule, `errors.ts:6-15`): `lane` is a fixed
  enum, a schema fact, never a captured row's bytes.

---

## 8. Testing

Per `CLAUDE.md` §4, pick real Postgres wherever RLS, the non-superuser roles, GRANT effectiveness, or
concurrency/ordering is the property under test — PGlite is a **false pass** there (single backend,
superuser). All container suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally
(`vitest.config.ts:6-10` sets the 180 s `hookTimeout`).

**Real Postgres (required):**

- **Fast-lane cursor independence + retention-waits-for-the-slower-lane** (§4e) — the `min`-across-lanes
  boundary is an RLS-fenced cross-tenant `DELETE` as the non-superuser `sync_retention` member, exactly
  `retention.gate.test.ts`'s reason for real PG; a PGlite superuser prune bypasses the policy
  (`retention.gate.test.ts:10-24`). Includes the two-direction control (fast-high/ordered-low and the
  reverse) and prove-by-deletion that one lane's advance alone does not move the boundary. The
  `setCursor` fixture must seed a `lane` for the PK repivot (§4a) — a pure consequence of the schema
  change, not new behaviour.
- **Cross-lane `23503` park** (§4e) — a fast `payments` row applied before its ordered `working_orders`
  parent parks and holds the fast cursor; after the parent lands on the ordered lane, a redelivered fast
  pull applies it. Concurrency + FK behaviour under the real app role — false pass on PGlite (one
  backend can't exercise two concurrent lanes).
- **Two-lane end-to-end** — capture a `payments` write and a `sales` write on the source; assert the
  fast lane lands `payments` on its tighter tick and the ordered lane lands `sales` on its own,
  advancing the two cursor rows independently.

**PGlite (sufficient, and preferred where the heavier target's justification does not apply — `CLAUDE.md`
§4):**

- The registry lane assignments (`registry.test.ts` extension — fast set is exactly
  `{payments, payment_refunds}`; every entry carries a `lane`), `tablesForLane`, and the wire/route lane
  mapping — pure data, no RLS.
- `config.ts` parsing of `WAITRON_SYNC_FAST_TICK_MS` (positive-int, default, empty-value fail-safe) — the
  `config.test.ts` shape.
- `runSyncPull`'s two-cadence loop control with an injected `pullOnce`/`sleep` (`pull.ts:111-123` already
  injects both) — the loop is testable off the network and off the clock.

**Coverage thresholds are 98/98/98/95** for both `@waitron/sync` (`packages/sync/vitest.config.ts:24`)
and `apps/server` (`apps/server/vitest.config.ts:48`). CI shards run `test:coverage`, not plain `test`
(`CLAUDE.md` §2), so verify green with `pnpm --filter @waitron/sync test:coverage` and run the package
**unfiltered** so its own in-package guard loads (`registry.test.ts:146-155`, the `[a-z_]+` name guard —
a name-filtered run would skip it, `CLAUDE.md` §3). The tree-wide guards (errors-reachability,
english-only, teardown) run from the **root** Vitest project via the pre-push hook / CI `lint` job, not
from this package (`CLAUDE.md` §4). No `inmutabilidad` run is needed: this slice adds **no**
`tenant_id`-bearing table — `sync_cursor` stays `tenant_id`-free and RLS-free
(`0000_sync_outbox.sql:95-99`), so the fiscal FORCE-RLS scan (keyed on a `tenant_id` column) has nothing
new to cover.

---

## 9. Parallel-safety with the workforce-roster branch

- **Migration journals are isolated.** `packages/sync/drizzle` uses migration table
  `__drizzle_migrations_sync` (`migrations.manifest.json:38-42`); `packages/workforce/drizzle` uses
  `__drizzle_migrations_workforce` (`migrations.manifest.json:8-12`), and its journal is at
  `0009_roster_published_period_uq` — a workforce branch adds `0010+` **there**, this slice adds
  `0002` under `packages/sync/drizzle`. Different folders, different journals, different tables:
  they cannot collide. `migrations.manifest.json` itself is **unchanged** by this slice (§5), so there is
  no shared-manifest edit either.
- **The one shared file is `apps/server/src/boot.ts`.** This slice edits the sync block
  (`boot.ts:348-386`) — turning one `runSyncPull` call into two lane-scoped ones and threading the
  fast-tick config. A workforce-roster branch touches the adjacent `mountWorkforceApi(app, …)` mount line
  (`boot.ts:340`). These are distinct, non-overlapping lines a few apart — a trivial textual merge, the
  same "adjacent mount lines" pattern the shift-planning slice 1 established.

---

## 10. Receipts

- **The `23503` park is already the split-lane backstop** — `apply.ts:277` (`pgErrorCode === "23503"` →
  `"deferred"`), `:190` (park), `:194-204` (in-batch retry), `:212-214` (cursor held below the lowest
  parked seq). Governing §4 names it "the backstop, for when a lane is split." **No new correctness
  machinery.**
- **`payments` cross-lane parent is NOT NULL `working_orders`** — `packages/payments/src/schema/payments.ts:56`
  (`working_order_id … .notNull()`), `:59` (`sale_id` nullable); governing §4:279. `payment_refunds →
  payments` is intra-fast-lane (`registry.test.ts:196`).
- **`sync_cursor` PK is `(subscriber_id, origin_id)`, no RLS** — `0000_sync_outbox.sql:100-107`,
  `:95-99`. `advanceCursor`/`readCursors`/`readCursor` key on it — `apply.ts:334`, `:308-310`,
  `pull.ts:64-65`.
- **`pruneSyncLog` groups by `origin_id`, `min(last_applied_seq)` across ALL rows** — `retention.ts:80-85`;
  `alive` is not a prune filter — `retention.ts:43-47`. `lagFor` returns `{subscriberId, originId, lag,
  alive}` worst-first and its gate test asserts via `.find` + `toMatchObject` with no row-count —
  `retention.ts:97-127`, `retention.gate.test.ts:134-138` (why the lane column leaves it green).
- **Journal next-free number 0002; sync migrations are custom** — `packages/sync/drizzle/meta/_journal.json`
  (0000, 0001); custom-migration convention `0000_sync_outbox.sql:1-3`, `0001_sync_retention.sql:1-4`.
- **`runSyncPull` drain keys on `fetched` + `advanced`; the progress guard breaks a full-but-unadvanced
  page** — `pull.ts:173-176`, comment `:150-158` (currently framed cross-origin; the fast lane adds the
  cross-lane case). `syncPullOnce` computes `advanced` by reading the cursor before/after —
  `pull.ts:90,105-106`.
- **Sync config is enabled iff `WAITRON_SYNC_PEERS` is set; the sync worker's idle/backoff are
  `config.minTickMs`/`config.maxTickMs`** — `config.ts:164-197`, `boot.ts:372-385`; defaults
  `DEFAULT_MIN_TICK_MS = 5_000` (`config.ts:101`).
- **`/sync-api/log` clamps garbage params to safe defaults, no 400 convention** — `sync-api.ts:30-56`,
  route `:94-109`; `readSyncLogSince` where-clause `source.ts:37-39`.
- **Dead-subscriber cleanup is deferred, not built** — `sync_retention` holds `SELECT, INSERT, UPDATE`
  (not `DELETE`) on `sync_cursor` today (`0001_sync_retention.sql:55`); the subscriber writes its cursor
  locally (`apply.ts:325-338`) while `pruneSyncLog` runs where `sync_log` lives — the cross-node
  visibility gap the retention-operations slice must close (§1).
- **Coverage 98/98/98/95** — `packages/sync/vitest.config.ts:24`, `apps/server/vitest.config.ts:48`.
- **Governing design** — payments fast lane recommended §9 / decided §12(3); dead-subscriber eviction is
  ops-policy §12(4) — **deferred** to a retention-operations slice (§1); `envios`/`acks`
  fast-lane-ineligible §11; true active-active §12(5).

---

## 11. Resolved questions & deferred refinements

- **How does a lane's cursor avoid dragging the other's?** Disjoint tables → disjoint `seq` streams →
  independent per-lane cursor rows; the shared cursor is what would have dragged, and the `lane` column
  removes it (§4e).
- **Does retention wait for the slower lane?** Yes — `min` across both lane cursor rows per origin, with
  no change to `pruneSyncLog` (§4e). Over-retention during a lane lull is bounded and safe.
- **Is new correctness machinery needed for the cross-lane FK order?** No — the `23503` park already
  handles it; the only code touched is a comment naming the cross-lane cause (§4e, §10).
- **How many migrations?** One — `0002_sync_cursor_lane.sql` (the lane column + PK repivot), custom (§5).
  The `sync_cursor` DELETE grant is deferred with dead-subscriber cleanup.
- **Does `lagFor` need to change under the lane column?** No — verified against its gate test
  (`.find` + `toMatchObject`, no row-count), so it stays green untouched; only the `setCursor` fixture
  changes (§4a). Making its output lane-distinguishing is deferred with the retention-operations slice.
- **Why is dead-subscriber cleanup deferred, and what does the future slice inherit?** It needs
  `pruneSyncLog` scheduled, a cross-node cursor-visibility mechanism, and the eviction verb + DELETE
  grant designed as one unit; it inherits the **explicit-not-automatic** decision — auto-evicting a
  slow-but-alive node is silent, unrecoverable data loss (§1).
- **Deferred refinement (not built):** a per-lane `max(seq)` so `lagFor` reports a lane's exact lag
  rather than its lag against the origin's whole-stream head (§4e). Deferred with the
  retention-operations slice that consumes `lagFor`.
- **Deferred (the four remaining transport-2 pieces):** dead-subscriber cleanup, multi-tenant transport,
  cloud-mirror peer, node-token rotation (§1).
