# Sync transport hardening — node-token rotation + retention-ops design (2026-08-16)

**#33 §14, "SIF topology follow-ups", on top of the commercial-lane outbox (#74), the transport /
network layer (#84, `@waitron/sync` + `mountSyncApi`) and the payments fast lane (#85).** Those slices
built capture, apply, the symmetric HTTP pull with redelivery + node-token auth, and the second
(payments) cadence. This slice builds the **two hardening pieces the backlog flagged as still-open**
under "SIF topology follow-ups" — the ones #85 deferred by owner decision:

1. **Node-token rotation** — roll the pre-shared node secret across both servers **without a
   synchronized restart**, by accepting a *set* of valid tokens during an overlap window.
2. **Dead-subscriber cleanup / retention-ops** — schedule the (currently unwired) `pruneSyncLog`, give
   the source **cross-node visibility** of each subscriber's cursor, and add an **explicit** operator
   verb to release a genuinely-dead subscriber's cursor so retention can advance past it.

> **Governing designs (reviewed with the owner):** `2026-08-02-app-level-sync-design.md` (the sync
> protocol) and its slice specs `2026-08-15-sync-transport-slice1-design.md` (#84) and
> `2026-08-15-sync-transport-slice2-design.md` (#85). This slice implements the two follow-ups those
> specs list as **deferred to "a future retention-operations slice"** (slice-2 §1) and **"deployment
> (#9) owns … the node token is still a single pre-shared value"** (slice-2 §1, §10). `file:line`
> references below come from a 2026-08-16 research pass against the landed tree; re-confirm at
> implementation time (`CLAUDE.md` §1).

---

## 0. HARD BOUNDARY — this slice does NOT touch the fiscal lane (H2)

The fiscal `registros`/hash-chain lane — `registros_facturacion`, the `registro_sif`/`cadenas`/
`invoice_series` identity tables, and the `envios`/`envio_flujo`/`acks` submission state — is a
**separate, owner-reviewed slice (H2)** and is **excluded here**. This item touches **only the
commercial-lane sync machinery** (`@waitron/sync`, `mountSyncApi`, the sync config in
`apps/server`). See §7 (Fiscal safety) for the grep-verified proof that nothing in this slice reads,
writes, enrolls, or reorders any fiscal table, hash, chain pointer, invoice number, or submission row.

---

## 1. What is already built (reused unchanged unless named)

- **Inbound auth is a single shared node token, fail-closed on blank.** `mountSyncApi`
  (`apps/server/src/sync-api.ts:98`) gates every route on `requireNodeToken`
  (`sync-api.ts:80-88`), a constant-time `timingSafeEqual` of the presented `Bearer` against **one**
  `deps.nodeToken: string` (`sync-api.ts:74`), throwing `sync.node_unauthorized` → 401 on a
  missing/blank/wrong token *before any DB work*. Config: `WAITRON_SYNC_NODE_TOKEN` (this node's
  inbound token, `required`, fail-closed on `VAR=`), plus a per-peer **outbound** token in
  `WAITRON_SYNC_PEERS` (`{ nodeId, url, token }`, `config.ts:148-207`); the peer that a pull dials is
  presented that peer's `token` as `Bearer` (`pull.ts:99,102,110`).
- **`sync_cursor` is per-`(subscriber_id, origin_id, lane)`** (PK repivoted by `0002_sync_cursor_lane.sql`),
  **no `tenant_id`, no RLS** — whole-DB operational state like `deployment`
  (`0000_sync_outbox.sql:95-107`; `0002_sync_cursor_lane.sql:17-21`). Granted `SELECT, INSERT, UPDATE`
  to `sync_tailer` (`0000:109`) and `SELECT, INSERT, UPDATE` to `sync_retention` (`0001_sync_retention.sql:55`)
  — **neither holds `DELETE`.**
- **Retention is a library function that boot never calls.** `pruneSyncLog(db)` deletes every
  `sync_log` row at/below the **per-origin `min(last_applied_seq)` across ALL `sync_cursor` rows**
  (alive or down), short-circuiting to `{pruned:0,highWater:0n}` when there are no subscribers
  (`retention.ts:65-89`). `lagFor(db)` reports each `(subscriber, origin)` pair's lag worst-first,
  with `alive` as **advisory metadata, never a prune filter** (`retention.ts:43-47,97-127`). Both run
  as a **`sync_retention` member** (whole-log permissive policy, `0001_sync_retention.sql:65-69`);
  `boot.ts` calls **neither** (verified: the only `@waitron/sync` imports in `boot.ts` are
  `runSyncPull` and `SyncLane`, `boot.ts:50`).
- **The subscriber advances its cursor on its OWN database.** `applyBatch` → `advanceCursor`
  writes `sync_cursor` on the *subscriber's* `subscriberDb` (`apply.ts:344-362`), keyed
  `(subscriber = self, origin = peer, lane)`. In the real two-node topology, the source that **holds**
  `sync_log` has **no cursor row telling it how far its subscribers have consumed its log** — the
  cross-node visibility gap slice-2 §1(ii) names, and the reason a scheduled `pruneSyncLog` on the
  source would prune **nothing** (its `sync_log.origin_id = self`, but no `sync_cursor` row carries
  `origin_id = self`, so the delete's join matches no row — verified against `retention.ts:78-88`).
- **The retention-variant `sync.stream_stalled` error exists but is unwired** (`errors.ts:37-43`;
  slice-2 §11). The transport variant is wired in `pull.ts:214-220`.

---

## 2. Piece 1 — node-token rotation (Slice A)

### 2.1 The problem, stated

Today both the inbound accepted token (`WAITRON_SYNC_NODE_TOKEN`) and each outbound presented token
(`WAITRON_SYNC_PEERS[].token`) are **single values**. To change the secret, an operator must edit both
nodes and restart them; there is an unavoidable window in which node A presents the *new* token while
node B still only accepts the *old* one (or vice-versa), and pulls 401 until the slower node restarts.
On a live active-active pair that is **downtime for the sync channel** — the durability tail grows and
the fast (payments) lane stalls exactly while both nodes are selling.

### 2.2 Mechanism — an accepted-token SET on the inbound side; the outbound token stays single

The fix is the standard overlap-window rotation: make the **validating (inbound) side accept a set** so
the two ends can be updated one at a time.

- **`WAITRON_SYNC_NODE_TOKEN` becomes a comma-separated SET** of one or more non-blank tokens — the
  tokens this node will accept from a peer. A single value (no comma) is the set `{that value}`, so an
  existing config is unchanged. Parsed to `nodeTokens: string[]` (`SyncTransportConfig`), each member
  trimmed; **a blank member (a stray `a,,b` or a leading/trailing comma) is a hard
  `server.config_invalid`**, and an unset/empty variable stays `server.config_missing` (unchanged
  fail-closed) — the empty-value trap (`CLAUDE.md` §3): a blank secret must never silently mean "accept
  anything", and an empty set must never reach the validator.
- **`requireNodeToken` validates the presented token against the whole set in constant time.** It
  iterates **every** member (never early-returns on a match, so request timing does not leak *which*
  token matched or the set's size), OR-ing a per-member guarded `timingSafeEqual` (length-checked
  first, since `timingSafeEqual` throws on a length mismatch). A blank presented token, or an empty
  accepted set, fails closed **before** any comparison — the same posture the single-token guard takes
  today (`sync-api.ts:85`).
- **The outbound presented token stays a single value per peer** (`WAITRON_SYNC_PEERS[].token`,
  unchanged). A pull presents exactly one token; the *receiver's* set is what makes both the old and
  new value acceptable during the window.

### 2.3 The rotation runbook (the reason the set exists — it is the deliverable's point)

Rolling the secret from `OLD` to `NEW` across nodes A and B **with no sync downtime**:

1. On **both** A and B, set `WAITRON_SYNC_NODE_TOKEN="OLD,NEW"` and restart each **one at a time**.
   Throughout, every node still accepts `OLD`, which every node is still presenting — no pull 401s.
2. On **both** A and B, change the **outbound** token to `NEW`: set each peer entry's `token` to `NEW`
   in `WAITRON_SYNC_PEERS`, and restart each one at a time. Each restarted node now presents `NEW`,
   which the peer already accepts (step 1). Still no 401s.
3. On **both** A and B, set `WAITRON_SYNC_NODE_TOKEN="NEW"` (drop `OLD`) and restart each one at a
   time. `OLD` is now presented by no node, so removing it from the accepted set locks out the
   retired secret.

At no step is any node simultaneously presenting a token the peer does not accept. The overlap set
`{OLD,NEW}` in steps 1-3 is the whole mechanism.

### 2.4 Decisions recorded

- **Config shape: comma-separated set, not JSON array or `PRIMARY`/`PREVIOUS` pair.** Comma-separated
  matches the operator-secret shape (base64/hex tokens carry no commas), keeps a single value working
  verbatim, and needs no new parse mode beyond a `split(",").map(trim).filter`-with-blank-rejection.
  A `PRIMARY`+`PREVIOUS` pair caps the overlap at two and adds a second variable that must agree; the
  set generalises to any window size with one variable. **(Owner-review, §8: low-risk, recorded.)**
- **Tokens are per-node and directional, unchanged.** The accepted set is *this* node's inbound
  tokens; the presented token is *per-peer* outbound. This is what the shipped model already is
  (`sync-api.ts:74` inbound vs `pull.ts:99` outbound); rotation only pluralises the inbound side.
- **No migration, no schema, no new error code.** Rotation is config + auth-guard only. `sync.node_unauthorized`
  stays the single uniform, param-free 401 (`errors.ts:44-47`) — a token must never reach a log line.

---

## 3. Piece 2 — dead-subscriber cleanup / retention-ops (Slice B)

Slice-2 §1 requires this be designed **as one coherent unit** of three parts: (i) `pruneSyncLog`
actually scheduled, (ii) a cross-node cursor-visibility mechanism, (iii) the eviction verb + its
`sync_cursor` DELETE grant. It also fixes the **explicit-not-automatic** decision this slice inherits.

### 3.1 Cross-node cursor visibility — a cursor-report channel (part ii)

**Why nothing else works.** On the source, `sync_log.origin_id = self`, but the only `sync_cursor`
rows the source writes locally are its *own* apply cursors (`origin = peer`), so a source-side
`pruneSyncLog` finds no `origin = self` cursor and holds the log forever (§1). The source must **learn**
each subscriber's cursor against it. Reasoning from the shipped model (slice-2 §1(ii): the subscriber
writes its cursor locally; retention runs where `sync_log` lives), the seam is a **feedback channel**
from subscriber → source that writes the source's own `sync_cursor`.

**The channel.** After a pull drains a peer, the puller **reports its cursor back to that peer**:

- **Puller side** — `runSyncPull`, after the per-peer drain loop settles for a lane, reads its local
  `(subscriber = self, origin = peer, lane)` cursor and POSTs `{ subscriberId: self, lane,
  lastAppliedSeq }` to the peer's `/sync-api/cursor` (same `Bearer` node token, same outbound
  connection direction the pull already dials — the on-prem box always dials outbound, per the sync
  memory). Injected as a `reportCursor` dep so the loop stays testable off-network; a report failure is
  swallowed into the existing per-peer backoff (never blocks the drain — reporting is best-effort
  operational metadata, not the sale path).
- **Source side** — `POST /sync-api/cursor` (node-token authenticated, on the same `mountSyncApi`
  group) calls `recordSubscriberCursor(db, { subscriberId, originId: deps.nodeId, lane, lastAppliedSeq })`.
  **The source stamps `origin = deps.nodeId` (its own id) — it never trusts a peer-supplied origin** —
  and upserts `sync_cursor(subscriber_id = <peer>, origin_id = self, lane, last_applied_seq)`. The
  upsert keeps `last_applied_seq` **monotonic** (`greatest(excluded, existing)` so a reordered/stale
  report never regresses the source's view) and **always bumps `updated_at`** (a heartbeat — the
  source's "last heard from this subscriber" signal). Runs as `sync_tailer`, which already holds
  `INSERT, UPDATE` on `sync_cursor` (`0000:109`) — **no new grant for the report side.**

Once reports flow, the source's `sync_cursor` carries an `origin = self` row per subscriber, and
`pruneSyncLog` (unchanged) holds the log at `min(last_applied_seq)` across them — exactly the
at-least-once, hold-for-the-slowest discipline, now correct across two nodes.

### 3.2 Scheduled retention sweep in boot (part i)

- **A `runRetentionSweep` loop** in `@waitron/sync` (mirroring `runSyncPull`'s abort-aware, injected-`sleep`
  shape so it is testable off the clock): each tick calls `pruneSyncLog(retentionDb)`, then `lagFor`,
  and logs a summary; for any subscriber whose lag exceeds an (optional) threshold it emits the
  **already-declared retention-variant `sync.stream_stalled`** (`{ subscriberId, originId, lag }`,
  `errors.ts:41-43`) — wiring the operator alarm that informs an eviction decision (`retention.ts:14`).
  Abort-checked before each prune and before each sleep, so `close()` stops it promptly.
- **A dedicated `sync_retention`-member pool.** Retention runs as `sync_retention` (the whole-log
  permissive policy is what makes the cross-tenant DELETE possible; `sync_tailer` is per-tenant fenced
  and a superuser prune is a false pass — `retention.gate.test.ts:11-24`). So a **new
  `WAITRON_SYNC_RETENTION_DATABASE_URL`** (a LOGIN role that is a member of `sync_retention`), distinct
  from `WAITRON_SYNC_DATABASE_URL` (a `sync_tailer` + `app_user` member).
- **Enablement:** the sweep starts iff sync is enabled (`WAITRON_SYNC_PEERS` set) **and**
  `WAITRON_SYNC_RETENTION_DATABASE_URL` is set — the same opt-in, fail-closed-on-blank posture as sync
  itself (`isUnset` → off). If sync is on but the retention URL is unset, boot logs a plain warn line
  so the operator knows the log will grow unpruned. **Cadence:** `WAITRON_SYNC_RETENTION_TICK_MS`
  (positive int, default a modest value e.g. `60_000` — a **tuning target, not a settled constant**,
  §8), parsed with the existing `positiveInt` shape. Torn down in `close()` alongside the pull worker
  and its pool (the existing `syncController`/`syncWorker`/`syncDb` teardown pattern, `boot.ts:379-436,594-619`).

### 3.3 The eviction verb + DELETE grant (part iii) — explicit, never automatic

- **`evictSubscriber(retentionDb, subscriberId): Promise<{ deleted: number }>`** in `@waitron/sync`
  (retention.ts): `DELETE FROM sync_cursor WHERE subscriber_id = $1`, returning the deleted-row count.
  It deletes **all** the subscriber's cursor rows (every origin, every lane). Once the row is gone,
  `pruneSyncLog`'s per-origin `min` no longer includes it, so the next sweep advances the log past the
  dead subscriber's position — the release.
- **The grant.** `sync_retention` holds only `SELECT, INSERT, UPDATE` on `sync_cursor` today
  (`0001_sync_retention.sql:55`). Migration **`0003_sync_cursor_evict.sql`** adds
  `GRANT DELETE ON sync_cursor TO sync_retention` — the single migration this whole item ships. No
  RLS/policy: `sync_cursor` carries no `tenant_id` and no RLS (`0000:95-99`), so a plain object GRANT
  is the whole mechanism (contrast the cross-tenant `sync_log` policy in `0001`). **Never widen
  `sync_tailer` or `app_user` to reach this** (`CLAUDE.md` §3): only `sync_retention` gets DELETE.
- **Why DELETE, not `alive = false`.** Retention's `min` is across **all** cursor rows regardless of
  `alive` (`retention.ts:43-47` — filtering the min to alive is the data-loss bug gate 7 controls
  for). So flagging a subscriber `alive = false` does **not** release the log; only removing its cursor
  row does. `alive` therefore stays purely advisory in this slice (untouched).
- **The operator surface is a local CLI, node-token-free, run against the retention URL.** Eviction is
  a **local operator action on the node that holds the log** — never a peer-facing endpoint (a peer
  must not be able to evict), so it is *not* on `mountSyncApi`. A thin `apps/server` bin
  (`waitron-sync-evict <subscriberId>`) connects via `WAITRON_SYNC_RETENTION_DATABASE_URL` and calls
  `evictSubscriber`, printing the count. **(Owner-review, §8: the surface choice is recorded; the
  policy — explicit-not-automatic — is already an owner decision, §3.4.)**

### 3.4 The explicit-not-automatic guardrail (inherited owner decision — do not relitigate)

Slice-2 §1 records, and this slice **inherits verbatim**: eviction must be an **explicit operator
action, never automatic**. "Slow" and "dead" are indistinguishable from the log (a cursor that stopped
advancing); only a human, confirming out-of-band, knows whether the peer is coming back.
**Auto-evicting a merely-slow-but-alive node is silent, unrecoverable data loss** — in true
active-active each node is the sole writer of its own partition, so pruning `sync_log` rows a slow-but-
alive B has not yet applied destroys rows that cannot be re-derived (slice-2 §1). A reimaged node
returns with a **fresh** identity and re-subscribes from zero (`CLAUDE.md` §5), so a correct eviction
is only ever of an identity that will never report again.

**Consequences for the executor:** the retention **sweep** must **never** call `evictSubscriber`, and
must **never** filter its prune by `alive` or by a last-seen TTL. If any step tempts you to add a TTL
sweep, an auto-evict, or an `alive`-filtered prune, **stop and leave the PR `needs-owner-review`** —
that is a reversal of a recorded owner decision (§8).

### 3.5 Decision: no `last_seen_at` column — reuse `updated_at`

The task floated a `last_seen_at` column as a plausible seam. **Rejected, with reason:** since
auto-eviction is forbidden (§3.4), a precise machine-read last-seen drives no automatic decision — it
is only advisory for the operator's alarm. `sync_cursor.updated_at` already exists (`0000:105`), and
`recordSubscriberCursor` bumps it on **every** report (§3.1, a genuine heartbeat), so the source
already has a "last heard from" timestamp without a new column. Adding `last_seen_at` would duplicate
it and pull `sync_cursor` into a migration it does not need. `lagFor` can surface `updated_at`
staleness later if the operator UI wants it (a reporting refinement, not built here). **No new column
on any table** (which also keeps the fiscal `inmutabilidad` FORCE-RLS scan untouched — §7).

---

## 4. Migrations & numbering

`packages/sync/drizzle/meta/_journal.json` lists `0000_sync_outbox`, `0001_sync_retention`,
`0002_sync_cursor_lane` (idx 0/1/2), so the next free number is **`0003`**. This item adds exactly
**one** migration, in **Slice B**:

- **`0003_sync_cursor_evict.sql`** — `GRANT DELETE ON sync_cursor TO sync_retention;` (§3.3).

**Slice A (rotation) adds no migration.** It is hand-written custom (drizzle-kit models no grants;
`sync_cursor` is raw-SQL, not a Drizzle table — the `0000`/`0001`/`0002` idiom, `0002_sync_cursor_lane.sql:1-6`).
Per repo convention: add the journal entry and a `0003_snapshot.json` copy of `0002`'s (no
Drizzle-tracked table/column changes; the migrator reads only the journal + `<tag>.sql` at runtime).
`packages/migrations/migrations.manifest.json` is **unchanged** — it points at the `sync` folder and
the journal enumerates members (`migrations.manifest.json:39-41`), so adding `0003` needs no manifest
edit. Nothing in **`packages/db`** changes: this item's highest-touched `packages/db` migration is
**none** (its journal is at `0042_purchase_invoices_rls.sql`; the trigger-gating `0037` landed with
#84 and is untouched here).

**No FORCE-RLS / `inmutabilidad` obligation:** `sync_cursor` is `tenant_id`-free and RLS-free
(`0000:95-99`), and this slice adds **no** `tenant_id`-bearing table and **no** column to one, so the
fiscal FORCE-RLS scan (keyed on a `tenant_id` column) has nothing new to cover (the same reasoning
slice-2 §8 recorded for `0002`).

---

## 5. Sequencing — one branch, two ordered slices (A then B)

- **Slice A (rotation)** touches `apps/server/src/config.ts` (parse the token set),
  `apps/server/src/sync-api.ts` (`SyncApiDeps.nodeTokens`, `requireNodeToken` over a set),
  `apps/server/src/boot.ts` (pass the set), and their tests. **No migration.**
- **Slice B (retention-ops)** touches `packages/sync/drizzle/0003_*` + journal + snapshot,
  `packages/sync/src/{retention.ts,cursor-report.ts,pull.ts,index.ts}`,
  `apps/server/src/{sync-api.ts,sync-http.ts,boot.ts,config.ts}`, a new eviction bin, and their tests.

They are **independent** (neither depends on the other's behaviour) but **share three files**
(`config.ts`, `sync-api.ts`, `boot.ts`). **Recommendation: land as ONE branch, Slice A first then
Slice B**, committed as an ordered sequence. Rationale: A is small, migration-free, and lowest-risk, so
landing it first settles the shared config/sync-api/boot surface that B then builds on, avoiding a
rebase collision; the migration-number question is settled once. A two-branch split is *possible* (A
has no migration and could merge independently first), but the shared files make one branch cleaner —
state this and prefer one branch.

---

## 6. Testing (per `CLAUDE.md` §4 — real Postgres only where the property needs it)

**Real Postgres (required — RLS as the non-superuser role, GRANT effectiveness, concurrency):**

- **Eviction releases the log, and the DELETE grant is load-bearing (prove-by-deletion).** As a
  `sync_retention` member (the `sync_pruner` login `retention.gate.test.ts:35` already creates): seed
  `sync_log` + two subscriber cursors, prune (held at the slower), `evictSubscriber` the dead one,
  prune again (advances past it). Then drop `GRANT DELETE ON sync_cursor`, confirm `evictSubscriber`
  raises a permission error (`42501`), restore, confirm it works — the difference that proves the grant
  (`CLAUDE.md` §1/§3, mirroring `retention.gate.test.ts`'s policy prove-by-deletion at `:217-254`).
- **Cross-node visibility makes a source-side prune advance.** As `sync_tailer`, `recordSubscriberCursor`
  writes an `origin = self` cursor; then `pruneSyncLog` (as `sync_retention`) holds/advances the
  source's own log at that reported cursor — the control being that **without** any reported cursor the
  same prune deletes nothing (the §1 gap), so the two directions visibly differ (`CLAUDE.md` §1).
  Prove monotonicity (a lower `lastAppliedSeq` report never regresses the row) and the heartbeat
  (`updated_at` bumps on a same-seq report).
- **`/sync-api/cursor` is node-token fail-closed and stamps `origin = self`.** Missing/blank/wrong
  token → 401 before any DB work (the `sync-api.rls.test.ts:46-60` convention); a good report with a
  peer-supplied `originId` still writes `origin = deps.nodeId` (the source ignores the peer's origin).
- **Rotation accepts any set member; an empty/blank set fails closed.** With `nodeTokens = ["OLD","NEW"]`,
  a `Bearer OLD` and a `Bearer NEW` both 200 and a `Bearer STALE` 401; a blank presented token 401; an
  empty accepted set is unconstructible (config throws) — the overlap window proven, and the two
  directions (accepted vs rejected) visibly differ.
- **Retention sweep + boot wiring.** `runRetentionSweep` prunes on its tick and stops on abort (injected
  `sleep`/`prune`, off-clock); the retention-variant `sync.stream_stalled` fires past the threshold. In
  `boot.test.ts`, with `WAITRON_SYNC_RETENTION_DATABASE_URL` set the sweep starts and `close()` tears
  it and its pool down; unset → no sweep (existing sync boot unaffected).

**PGlite / hermetic (sufficient — pure logic, no RLS):**

- `WAITRON_SYNC_NODE_TOKEN` set-parsing (single value, multi, blank-member rejection, unset→missing)
  and `WAITRON_SYNC_RETENTION_*` parsing — the `config.test.ts` shape.
- `requireNodeToken` set-membership + constant-time iteration (unit, no DB).
- `runSyncPull`'s cursor-report call (injected `reportCursor`, asserted args) and `runRetentionSweep`'s
  loop control (injected `prune`/`sleep`) — off-network, off-clock (`pull.test.ts` idiom).
- `HttpClient` `method`/`body` extension + `fetchHttpClient` mapping.

**Gate hygiene:** coverage is **98/98/98/95** for both `@waitron/sync` and `apps/server` (`packages/sync/vitest.config.ts`,
`apps/server/vitest.config.ts`); run `pnpm --filter @waitron/sync test:coverage` **and** the package
**unfiltered** so its in-package name guard loads (`registry.test.ts`'s `[a-z_]+` guard; `CLAUDE.md`
§3). Container suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally. `sync` is a `GENERIC_PACKAGE`
(english-only guard applies) — new identifiers stay English (`recordSubscriberCursor`, `evictSubscriber`,
`runRetentionSweep`); no new Spanish schema tokens.

---

## 7. Fiscal safety (H2) — grep-verified: this slice touches nothing fiscal

Run 2026-08-16 (re-run at implementation time):

- **No fiscal table appears in `packages/sync/src` production code.** `grep -rniE
  'registros_facturacion|registro_sif|\benvios\b|envio_flujo|\backs\b|huella|cadena|invoice_series|numero_instalacion|secuencia'
  packages/sync/src/` matches **only test files** — `invoice_series` as an FK-parent *fixture* for
  `sales` (`pull.gate.test.ts:68`, `apply.gate.test.ts:86`, `redelivery.gate.test.ts:81`), and
  `registros_facturacion` only in **comments** asserting a fiscal table is *not* enrollable
  (`apply.gate.test.ts:754-756`, the H2 guard; `registry.test.ts:180`, the vocabulary guard). No
  production module reads, writes, hashes, chains, or enrolls a fiscal row.
- **The enrolment registry is exactly the 14 commercial tables** (`registry.ts:47-186`): `sales`,
  `sale_lines`, `tenders`, `sale_settlements`, `sale_substitutions`, `sale_voids`, `payment_refunds`,
  `catalogues`, `categories`, `products`, `payments`, `payment_policy`, `working_orders`,
  `working_order_lines`. This slice **adds none** and touches the registry not at all.
- **This slice adds no capture trigger, no apply statement, no lane, no enrolled table.** Rotation is
  auth+config; retention-ops is a cursor-feedback channel, a scheduled `pruneSyncLog`, and a
  `sync_cursor` DELETE grant — all on **operational** state (`sync_cursor`, no `tenant_id`, no RLS)
  and the **commercial** `sync_log`. Nothing reads `registros_facturacion`, recomputes a `huella`,
  advances a `cadena`, mints/consumes an invoice number, or writes `envios`/`envio_flujo`/`acks`.
- **The fiscal-lane routing rule is undisturbed:** `envios`/`acks` carry no monotonic column and are
  fast-lane-ineligible by construction (they are not in `ENROLLED`); this slice moves no table to any
  lane. The fiscal `registros`/hash-chain sync stays the **separate owner-reviewed slice (H2)**, out of
  scope.

No fiscal invariant in `CLAUDE.md` §5 is in reach: no chain is appended, no number allocated, no
immutable row written, no environment stamp changed, no till re-registered.

---

## 8. Owner-review assumptions — flag rather than land on drift

A fresh executor should **land** the recorded decisions below but leave the PR **`needs-owner-review`
(and NOT land)** on any drift beyond them into the fiscal core or an unrecorded product/ops decision:

1. **Eviction is a deliberate data-release.** Building the **explicit, manual** verb + grant + local
   CLI **implements a recorded owner decision** (explicit-not-automatic, slice-2 §1) and is landable.
   **Drift that must stop and flag:** adding automatic eviction, a TTL/last-seen sweep, an
   `alive`-filtered prune, or a peer-facing evict endpoint — each reverses that decision and risks
   silent unrecoverable data loss (§3.4).
2. **Retention URL required-vs-optional is an ops-policy call.** This design makes the sweep **opt-in**
   (`WAITRON_SYNC_RETENTION_DATABASE_URL` set), consistent with sync's own opt-in, so existing hosts
   are unaffected; the runbook documents that a real active-active production deployment **must** set
   it (else the log grows unbounded). If the owner wants it **required** whenever sync is enabled
   (fail boot when unset), that is a one-line change — flag for confirmation, do not silently force it.
3. **Token-set config shape** (comma-separated `WAITRON_SYNC_NODE_TOKEN`) — recorded (§2.4); low-risk,
   landable. Flag only if an executor changes it to JSON/pair form.
4. **Retention cadence + lag-alarm threshold defaults** are **tuning targets, not settled constants**
   (like the fast-tick, `config.ts:102-106`). Land the defaults; do not present them as final.
5. **The eviction operator surface** (local CLI vs admin route) — recorded as a local CLI (§3.3);
   landable. A person-session admin route is a larger surface — flag if chosen.

Anything touching `registros`/the hash chain/invoice numbers/`envios`/`acks` (the H2 lane) is **out of
scope** — if a task appears to need it, stop and flag; do not extend into the fiscal lane.

---

## 9. Receipts

- **Single inbound token, fail-closed** — `sync-api.ts:74,80-88`; config `required` fail-closed on
  blank — `config.ts:140-146,202`. **Per-peer outbound token** — `config.ts:148-207`, presented at
  `pull.ts:99,102,110`.
- **`sync_cursor` PK `(subscriber_id, origin_id, lane)`, no `tenant_id`/RLS; grants** — `0000_sync_outbox.sql:95-107,109`,
  `0002_sync_cursor_lane.sql:17-21`; `sync_retention` holds `SELECT, INSERT, UPDATE` (not DELETE) —
  `0001_sync_retention.sql:55`.
- **`pruneSyncLog` min across ALL rows, `alive` never a filter; `lagFor` unwired; boot calls neither** —
  `retention.ts:43-47,65-89,97-127`; `boot.ts:50` imports only `runSyncPull`, `SyncLane`.
- **Subscriber advances its cursor locally; source has no `origin = self` cursor row** —
  `apply.ts:344-362`; slice-2 §1(ii); `retention.ts:78-88` (the delete join needs an `origin = self`
  cursor that only a report can create).
- **Retention runs as `sync_retention`; superuser prune is a false pass** — `retention.gate.test.ts:11-24,35`;
  whole-log permissive policy — `0001_sync_retention.sql:65-69`.
- **Retention-variant `sync.stream_stalled` exists, unwired** — `errors.ts:37-43`; `errors.test.ts:42-54`.
- **Next free sync migration is `0003`; sync migrations are hand-written custom; manifest unchanged** —
  `packages/sync/drizzle/meta/_journal.json`; `0002_sync_cursor_lane.sql:1-6`; `migrations.manifest.json:39-41`.
- **`sync_cursor` has no `tenant_id` → no inmutabilidad obligation** — `0000_sync_outbox.sql:95-99`;
  slice-2 §8.
- **HttpClient is `(url,{headers})→{status,text()}`** (needs a `method`/`body` extension for the report
  POST) — `pull.ts:18-21`, `sync-http.ts:10-11`.
- **Fiscal exclusion** — §7 greps; `apply.gate.test.ts:753-759` H2 guard (a fiscal-adjacent table is
  not enrollable); `ENROLLED` = 14 commercial tables — `registry.ts:47-186`.
