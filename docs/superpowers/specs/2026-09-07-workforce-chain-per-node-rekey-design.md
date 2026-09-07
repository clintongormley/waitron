# Working-time chain — per-node rekey (Track A item 3, between steps 2 and 4)

**Status:** brainstormed 2026-09-07 (owner, this session); fresh-context Fable review folded (same
day); plan not yet written. Prerequisite for the outbox→native-replication swap slices S3/S4
([2026-09-05-outbox-to-native-replication-swap-design.md](2026-09-05-outbox-to-native-replication-swap-design.md)
§4.4). Its own PR, ahead of the two-node fixture (swap S1).

**Model note:** this spec touches the immutable working-time record and adds a line to `CLAUDE.md`
§5; it got the fresh-context Fable read before the plan was written (owner model rule). That review
overturned the first draft's restore mechanism — see §5 and the history note there.

---

## 1. Why

`workforce_chains` is keyed `(tenant_id, location_id)` and `time_entries` is unique on
`(tenant_id, location_id, sequence_no)` — one tamper-evidence hash chain of clock events per
workplace, whichever node writes it (`packages/workforce/src/schema/workforce-chains.ts`,
`.../time-entries.ts`). That key is what forces a single writer per location: two nodes appending to
the same location would collide head-on on `time_entries_chain_position_uq`.

Under the primary-mirror failover model, a location's chain is written by **one node at a time**, but
across a promotion by **two nodes in succession**: the on-site box writes, dies; the cloud is
promoted and writes; the box returns. Both nodes' entries carry the same `sequence_no` values from the
shared key — a fork, and a `23505` (or, under native replication, a subscription stall) on every
overlapping link. The fiscal chain had exactly this shape and was rekeyed per node (server-as-SIF,
PRs #33/#54: `cadenas` moved from `(tenant, till)` to `(tenant, node)`). The working-time record is a
launch-day legal duty (art. 34.9 ET; `docs/backlog.md` → Workforce), so a clock event is a row to
neither lose nor fork.

This is the swap spec's §4.4 decision, pulled into its own brainstorm and PR.

---

## 2. Decisions (owner, 2026-09-07)

1. **Chain key becomes `(tenant_id, node_id, location_id)`** — `node_id` is ADDED, not substituted
   for `location_id`. One chain per writer per workplace. A returned box's tail sits beside the
   cloud's on the same table (different `node_id`, so no position clash), AND an inspector verifying
   workplace A never needs workplace B's rows. Under primary-mirror the "only one node writes a
   location at a time" rule stays a POLICY (the same one `sales.node_id` follows), not something the
   key enforces. Two chains for one location arise only across a promotion, never concurrently.
2. **A hashed `recorded_at` replaces `ingest_seq` and orders corrections across nodes.** Two approved
   corrections of one entry recorded on different nodes sit in different chains, so `sequence_no`
   cannot compare them, and both nodes must compute the SAME winner once each holds both rows. The
   winner is the greatest `(recorded_at, node_id, sequence_no)` — a strict total order over the set
   (the `(node_id, sequence_no)` tail is unique per location) that every node computes identically.
   Within one chain it must reduce to today's `sequence_no` rule, which requires `recorded_at` to be
   monotonic per chain — enforced, not assumed (§4.1). `ingest_seq` — a `GENERATED ALWAYS AS IDENTITY`
   column whose sequence does not replicate (prototype finding 5) and which the hash does not cover —
   is dropped; its two jobs (creation order, correction tie-break) both move to columns that replicate
   and are hashed, closing that finding in the same change.
3. **A cold-restored box CONTINUES its chain — no reset, no restore hook.** A restored box keeps the
   dead box's `node_id` (SP-3d §3.1) and its backup's chain heads intact (each pointing at row M with
   M's hash). Its next append continues that chain at M+1, chaining onto M's stored hash. `verifyChain`
   stays strictly one-segment-from-position-1. If a survivor (a promoted cloud) holds a longer copy of
   that chain, the box's post-restore rows collide LOUDLY at drain (`23505` / `multiple_unique_conflicts`
   → the operator SKIPs, or the box is wiped and re-adopts per swap §4.2 step 5) — never a silent
   merge. This is fiscal's ACTUAL behaviour (fiscal continues `secuencia` and relies on the unique
   index to refuse a fork), and it is why the first draft's "reset the pointer + clock-floor like
   fiscal" was dropped (§5 history).
4. **Packaging: one PR.** The replication proof itself (a drained tail beside the cloud's chain) is the
   swap's S1 two-node fixture, which lands after.

---

## 3. Schema and the append path

### 3.1 Tables

**`workforce_chains`** (`packages/workforce/src/schema/workforce-chains.ts`):

- add `nodeId: uuid("node_id").notNull().references(() => nodes.id)` (this table already uses the
  plain one-argument FK form; match its siblings — `tenant_id`/`location_id` here — not `time_entries`).
- primary key becomes `(tenantId, nodeId, locationId)`.
- add `lastRecordedAt: timestamp("last_recorded_at", { withTimezone: true, mode: "string" })` (nullable,
  both-null with the pointer or set) — the mutable high-water mark that keeps `recorded_at` monotonic
  per chain (§4.1). app_user keeps its existing `SELECT, INSERT, UPDATE` on this head table.
- `sequenceNo`, `lastEntryId`, `lastEntryHash`, `updatedAt`, and `workforce_chains_pointer_ck`
  unchanged. Still created lazily by `lockChainHead`'s `insert … on conflict do nothing`
  (`chain.ts`), so a reserved standby seeds nothing at join, and a cold restore needs no hook.

**`time_entries`** (`packages/workforce/src/schema/time-entries.ts`):

- add `nodeId: uuid("node_id").notNull()` with a NAMED array-form FK
  `foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id], name: "time_entries_node_fk" }).onDelete("restrict")`
  — this table uses the array form for every FK deliberately (coverage; see its `employments.ts`
  note), so `node_id` follows suit. Stamped by the append, never by the device.
  `captured_by_till_id` STAYS as it is (informational capture snapshot, the choice `registros.till_id`
  made at the fiscal rekey).
- add `recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull()` — the
  recording node's clock at append, whole seconds (§4.1).
- drop `ingestSeq` and its `time_entries_ingest_seq_seq` identity sequence.
- `time_entries_chain_position_uq` becomes `(tenantId, nodeId, locationId, sequenceNo)`.
- add `check("time_entries_recorded_at_second_ck", sql`date_trunc('second', recorded_at) =
  recorded_at`)`, mirroring `time_entries_event_at_second_ck`.
- `location_id` stays `NOT NULL` and hashed; all existing FKs, checks and indexes unchanged except the
  position uq above.

Both new columns are written once at INSERT and the app holds no UPDATE on `time_entries`, so the
existing `REVOKE` + `reject_mutation` trigger (`drizzle/0001_workforce_baseline_sql.sql`) already
covers them; `immutability.test.ts` asserts it.

### 3.2 The hash

`chain-hash.ts`'s `EntryHashInput` and `canonicalString` gain two fields. Field order is still free (no
real chains exist), but FIXED and documented anew:

- `NodeId` immediately after `LocationId` — the chain key must be in the digest, or a party past the
  immutability floor could re-point a row at another node's chain undetected (the reasoning that hashes
  `CapturedByTillId`). This does not offend `CLAUDE.md` §5's "never put our own metadata into a hash":
  that rule exists because AEAT fixes the fiscal digest; THIS chain's digest is ours to define.
- `RecordedAtMs` (`String(Date.parse(recordedAt))`) immediately after `EventAtMs` — so the cross-node
  tie-break value cannot be reordered undetected.

`VerifiableEntry`, `EntryHashInput`, `TimeEntryRecord` (`projection.ts`) gain `nodeId` and
`recordedAt`; `ingestSeq` is removed from all three.

### 3.3 The append path

`appendToChain` and `lockChainHead` (`chain.ts`) take the chain key as a `ChainKey { tenantId,
nodeId, locationId }` rather than two positional strings. `attemptAppend`:

- stamps `node_id`;
- computes `recorded_at` from an injected clock (default `() => new Date()`), takes
  `max(clock, head.last_recorded_at)` (§4.1), truncates it to a whole second at the SAME choke point as
  `event_at` (`truncateToWholeSecond`), and feeds it to BOTH the hash and the stored column;
- writes `sequence_no`, `last_entry_id`, `last_entry_hash` AND `last_recorded_at` back onto the head in
  the existing head `UPDATE`.

A correction copies person and location from its target but is chained under the RECORDING node
(`clocking.ts`'s `appendCorrection`).

`ClockEventInput`, `CorrectionRequestInput`, `CorrectionApprovalInput` (`clocking.ts`) gain `nodeId`,
supplied per call the way `recordSale` takes `input.nodeId` (`packages/core/src/record-sale.ts:86`).
`WorkforceApiDeps.cfg` (`apps/server/src/workforce-api.ts`) becomes `{ tenantId, nodeId }`;
`boot.ts:1340`'s `mountWorkforceApi` call has `config.till.nodeId` in scope (`config.ts` documents
"the sync node ID is `config.till.nodeId`", line 375). No HTTP clock-in route exists today (only tests
call `clockIn`/`clockOut`), so the app-facing blast radius is `workforce-api.ts` plus its two test
files.

### 3.4 Migration

Nothing is deployed. The workforce baseline is regenerated from the edited schema (reset `drizzle/` to
`origin/main`, `pnpm --filter @waitron/workforce db:generate --name workforce_baseline`, then
`db:generate:custom` and paste the immutability triggers + grants back verbatim — the `CLAUDE.md` §6
migration-regeneration procedure). No backfill (`CLAUDE.md` §3: no data-migration code pre-production).

---

## 4. `recorded_at`, precedence, and the reads

### 4.1 The column and its monotonicity

`recorded_at` is the append's own timestamp — the recording node's wall clock, whole-second, supplied
by `appendToChain` from an injectable clock, NEVER by the caller (it is not a device input like
`event_at`). Hashed as `RecordedAtMs`.

**Monotonic per chain, by construction.** A wall clock steps backward (NTP, an operator edit), so the
append stamps `recorded_at = max(clock(), head.last_recorded_at)` under the head row lock it already
holds, and writes the result to `last_recorded_at`. Within one chain `recorded_at` is then
non-decreasing, so the precedence order below reduces to today's `sequence_no` order — proven by a test
that injects a backward-stepping clock (§7). ACROSS chains the recording clocks decide; skew is the
same accepted posture `event_at` carries, and under sequential writers the promotion gap dwarfs
plausible skew, so the order is stable in practice. The one misorder it admits — a promoted cloud whose
clock trails the box's by more than the promotion gap — is named here and left as the NTP posture, not
engineered against.

### 4.2 Correction precedence

Today `approveCorrection` refuses a second approval of a target (`hasApprovedCorrection`,
`clocking.ts:472`), so "at most one approved correction per target" is a DB-WIDE invariant. The rekey
turns it into a PER-CHAIN invariant: an approval on the cloud cannot see an approval still sitting in
the box's undrained tail, so one target can end up with two approved corrections across two chains. That
is the whole reason a precedence rule is needed.

`applyCorrections` (`projection.ts`) picks the latest approved correction of a target by the greatest
`(recordedAt, nodeId, sequenceNo)` instead of the greatest `sequenceNo`. Within one chain `recorded_at`
is monotonic (§4.1) and `node_id` constant, so this reduces to today's rule and the existing single-node
tests still hold. Across chains the recording clock decides, ties broken by `node_id` then
`sequence_no`. The comparison is a single total order over the tuple — NOT a "same-node → sequence_no,
else recorded_at" special case, which is not transitive across three entries spanning two chains.

`currentState` (`clocking.ts`) orders `by event_at desc, recorded_at desc, node_id desc, sequence_no
desc` — the same deterministic "most recent event" without `ingest_seq`.

### 4.3 Reads that do NOT change

`entriesForLocationInPeriod`, `entriesForPersonInPeriod` and `exportTimeRecord` (`clocking.ts`,
`registro-jornada.ts`) filter by tenant + location/person + time window, never by chain, so a
location's registro is already the UNION of its chains with no change. Whether the exported registro may
be SHOWN as two chains stays the labour-advisor presentation question (swap §4.4), untouched here.

---

## 5. Restore, and the verifier

### 5.1 No restore hook — the chain continues

`packages/workforce` declares NO `backup.restore` hook. After a cold restore the restored database
holds the backup's `workforce_chains` heads (each pointing at its row M with M's stored hash) and rows
1..M. The next `appendToChain` reads the head, computes M+1, and chains M+1 onto M's hash — the chain
simply continues. Row M was restored verbatim, so its hash is intact and the link is valid.

If a survivor holds a longer copy of that chain (positions up to N > M), the box's post-restore rows
land on positions the survivor already holds and are refused LOUDLY at drain — a `23505` locally, or a
subscription stall (`multiple_unique_conflicts`) under native replication, which swap §4.2 step 4
already handles by SKIP, and which the primary-mirror rejoin (wipe + re-adopt, swap §4.2 step 5) avoids
by never draining a returned box's own lineage. A fork is thus surfaced, never silently merged.

**History (why the first draft changed).** The 2026-09-07 draft reset the head pointer and clock-floored
`sequence_no`, by analogy to the fiscal restore. The fresh-context Fable read showed the analogy did not
transfer: fiscal does NOT floor its chain position — `secuencia` continues (`registro-sif.ts`'s
`resetChainHead` nulls only the pointer; `cadenas.secuencia` is never reset because
`registros_tenant_node_secuencia_uq` forbids it, and it is "OUR ordering aid ... NOT AEAT's",
`registros.ts:50`), and fiscal resets the POINTER only to open a fresh SIF chain for AEAT — an external
identity workforce has no equivalent of. Worse, resetting the pointer forced a mid-chain genesis, which
would have forced `verifyChain` to accept a genesis mid-walk; since app_user holds INSERT on
`time_entries`, that would let a compromised app plant a self-consistent fabricated segment the strict
verifier rejects today — weakening the §5 tamper-evidence promise as defense-in-depth against a
runbook violation (an operator cold-restoring while a survivor exists, instead of promoting the
survivor). Continuing the chain keeps the strict verifier and the loud-fork behaviour, with no hook, no
floor and no new table.

### 5.2 The verifier is unchanged

`verifyChain` (`chain-hash.ts`) stays exactly as it is: one segment, genesis at position 1, strict
contiguity from 1, each `prev_entry_hash` equal to the previous row's stored hash, each hash recomputed
(now including `NodeId` and `RecordedAtMs`). "Any inserted, removed, or reordered entry breaks the
chain" (workforce design §5) holds unchanged. Fiscal has no whole-chain walk to compare against —
`verify.ts` is an art. 7.i look-back over the last two rows only (`order by secuencia desc limit 2`) —
so there is no fiscal precedent to mirror here; the workforce whole-chain verifier is its own guarantee
and stays strong.

A small `readChain(tx, key): Promise<VerifiableEntry[]>` helper returns one `(tenant, node, location)`
chain's rows (reading `event_at`/`recorded_at` through the same `to_char(… 'HH24:MI:SS"Z"')` shape the
existing reads use, or the recompute mismatches under node-postgres) for a test — and later a status
page — to verify against the database rather than hand-rolling the select.

---

## 6. Testing

Workforce sits at the 90/90/85/85 floor. Every claim below is a RUN, not a read (`CLAUDE.md` §1/§4).

- **`chain-hash.test.ts`** — the new canonical order (`NodeId` after `LocationId`, `RecordedAtMs` after
  `EventAtMs`); re-pointing a row's `node_id` (recomputing nothing else) is `hash_mismatch`; the strict
  segment invariants unchanged, re-proven by deletion.
- **`chain.test.ts`** (PGlite) — two nodes appending to one location produce two chains with independent
  positions that both verify; `recorded_at` is stamped whole-second from the injected clock and fed to
  both hash and column; a BACKWARD-stepping injected clock still yields non-decreasing `recorded_at` per
  chain (the `last_recorded_at` high-water mark), proven by deletion of the `max`; the location export is
  the union.
- **`chain.concurrency.test.ts`** (real Postgres, `describeEachTarget` / `useRealPostgres`) — the
  position uq re-proven on `(tenant, node, location)`, as fiscal's node-rekey concurrency suite did: a
  naive read-then-write loses the race and the loser retries under the savepoint.
- **`projection.test.ts` / `corrections.test.ts`** — cross-node precedence: two approved corrections of
  one target from two nodes, `recorded_at` decides; equal `recorded_at` falls to `node_id`; within one
  chain the result equals today's `sequence_no` rule.
- **Restore continuation** (real Postgres, `restore-fiscal-e2e.test.ts` shape) — seed a chain to
  position M, "restore" (a fresh DB loaded with rows 1..M and the head at M), append: the new row is M+1
  chained onto M's hash, `verifyChain` ok end to end (one segment). Negative/fork control: a second DB
  holding 1..N (N>M) receives the box's M+1 → `23505` on the position uq (the loud fork, not a silent
  merge).
- **`clocking.test.ts`** — `nodeId` threaded through the four inputs; `currentState`'s order without
  `ingest_seq`.
- **`workforce-api.test.ts` / `.pg.test.ts`** — `cfg.nodeId` supplied; a clock event lands under that
  node.
- **`index.test.ts`, `migrations.test.ts`, `schema-ownership.test.ts`** follow the regenerated baseline;
  `immutability.test.ts` adds the two new `time_entries` columns to the revoked-mutation assertions.
- **`packages/workforce-es`** — `registro-jornada.test.ts` constructs `TimeEntryRecord` with `ingestSeq`
  (lines 115/125/135); those fixtures drop `ingestSeq` and gain `nodeId`/`recordedAt`. Run this package
  too, not only `@waitron/workforce`.
- **Not proven here, by design:** the actual replication drain (box tail beside cloud chain) — that is
  swap S1's two-node fixture, which lands after this PR; the `23505` control above is its local proxy.

Run the whole `@waitron/workforce` and `@waitron/workforce-es` packages unfiltered (not a name-filtered
subset) and the two `apps/server` workforce-api suites before believing a pass (`CLAUDE.md` §2).

---

## 7. Docs updated in the same PR

- This spec (committed).
- A dated pointer in the swap spec §4.4 (rekeyed per node → landed; key is `(tenant, node, location)`,
  NOT `(tenant, node)`; restore continues the chain rather than resetting) and in the 2026-07-22
  workforce design §5 ("per location" → "per node per location"; the central-ingest framing now spans a
  promotion).
- `CLAUDE.md` §5's re-registration bullet gains one line: UNLIKE the fiscal chain, the working-time
  chain is NOT reset on a cold restore — it continues from the backup's head, and a fork with a
  surviving copy surfaces as a loud drain stall (the fiscal reset exists to mint a fresh SIF for AEAT,
  which the working-time record has no equivalent of).
- `docs/backlog.md` Track A: the working-time rekey (between steps 2 and 4) marked landed with the PR
  number; the swap S3/S4 prerequisite discharged.

---

## 8. Out of scope

- The clock-in HTTP route and till UI (not wired today; `cfg.nodeId` is plumbed but no route added).
- Per-device offline sub-chaining (workforce design §5 escalation, deferred).
- Showing a location's export as two chains (labour advisor; swap §4.4).
- Any active-active write behaviour — primary-mirror means one writer at a time (owner, this session).
- The replication mechanism itself (swap S1–S7), including the drain-conflict SKIP path.
