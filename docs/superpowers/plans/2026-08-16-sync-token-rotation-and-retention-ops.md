# Sync token rotation + retention-ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the commercial-lane sync transport with (A) **node-token rotation** — accept a *set* of
valid inbound tokens so the pre-shared secret rolls across both servers with no synchronized restart —
and (B) **retention-ops** — schedule the unwired `pruneSyncLog`, give the source cross-node visibility
of each subscriber's cursor (a cursor-report channel), and add an **explicit** operator verb to release
a genuinely-dead subscriber's cursor so retention advances past it.

**Architecture:** `@waitron/sync` (the sync library: `pull.ts`, `retention.ts`, a new `cursor-report.ts`,
migration `0003`) + `apps/server` (`config.ts`, `sync-api.ts`, `sync-http.ts`, `boot.ts`, a new eviction
bin). Symmetric active-active HTTP pull, node-token auth, application-level apply as the non-superuser
app role under `withTenant`. **Commercial lane only — the fiscal `registros`/hash-chain lane (H2) is
excluded** (see spec §0/§7).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle (`sql` templates, hand-written custom
migrations), Hono routes, pnpm workspace, Vitest (+ Testcontainers real Postgres, PGlite), `pg`/`undici`.

**Spec:** docs/superpowers/specs/2026-08-16-sync-token-rotation-and-retention-ops-design.md

## Global Constraints

- **Coverage 98/98/98/95** in both `@waitron/sync` and `apps/server`. CI shards run `test:coverage`,
  not `test` — verify with `pnpm --filter @waitron/sync test:coverage` and `pnpm --filter
  @waitron/server test:coverage`, and run each package **unfiltered** so its in-package guards load
  (`CLAUDE.md` §2/§3). Container suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Real Postgres for RLS / non-superuser roles / GRANT effectiveness / concurrency; PGlite is a false
  pass there** (single backend, superuser — `CLAUDE.md` §4). Pick PGlite/hermetic only for pure logic.
- **Prove every guard by deletion** (`CLAUDE.md` §1): remove the grant/check, watch the test fail,
  restore. Provide a control in the other direction where two answers could look alike.
- **Error codes name the domain concept, never the package; codes are never renamed once shipped**
  (`CLAUDE.md` §3). This plan adds **no new registered error code** — it reuses `sync.node_unauthorized`
  and the retention-variant `sync.stream_stalled` (both already in `errors.ts`), and uses plain
  (unregistered) log strings for operational lines, exactly as `pull.ts` does for `sync.pull_failed`.
- **English-only:** `sync` is a `GENERIC_PACKAGE` (`packages/db/src/english-only.ts`). All new
  identifiers are English (`recordSubscriberCursor`, `evictSubscriber`, `runRetentionSweep`); add no
  Spanish schema tokens. Do **not** reuse the fiscal noun `ack`/`acks` — this channel is a *cursor
  report*.
- **No backwards-compat / data-migration code — nothing is deployed** (`CLAUDE.md` §3). Schema changes
  drop/recreate; the `0003` grant needs no backfill.
- **Utility-statement SQL:** the one `GRANT` (migration `0003`) is a static literal, no interpolation.
  Every runtime statement binds values as parameters (`sql\`… ${v}\``), never string-concatenation
  (`CLAUDE.md` §3).
- **Every commit `git commit -s`.** Land as **one branch**, Slice A commits first, then Slice B
  (spec §5). Branch name e.g. `feat/sync-token-rotation-retention-ops`.
- **Fiscal-safety guardrail:** if any task appears to need `registros`/the hash chain/invoice
  numbers/`envios`/`acks`, STOP — that is the excluded H2 lane; leave the PR `needs-owner-review`
  (spec §8). Likewise stop and flag on any drift toward **automatic** eviction / a TTL sweep / an
  `alive`-filtered prune (a reversal of a recorded owner decision, spec §3.4).

---

## SLICE A — node-token rotation (no migration)

### Task A1 — `loadSyncConfig` parses `WAITRON_SYNC_NODE_TOKEN` as a token SET

**Files:**
- `apps/server/src/config.ts` (edit: `SyncTransportConfig.nodeToken: string` → `nodeTokens: string[]`; add a `tokenSet` helper)
- `apps/server/src/config.test.ts` (edit: new assertions)

**Interfaces:**
- Consumes: `Env` (`Record<string,string|undefined>`), the existing `required` / `isUnset` / `AppError` helpers.
- Produces: `SyncTransportConfig.nodeTokens: string[]` (≥1 non-blank member); `server.config_invalid { variable, reason: "blank_token_in_set" }` on a blank member; unchanged `server.config_missing` on unset/empty.

**Steps:**
1. [ ] Write a failing test in `config.test.ts`: `loadSyncConfig` with `WAITRON_SYNC_NODE_TOKEN: "OLD,NEW"` yields `nodeTokens: ["OLD", "NEW"]`; a single `"solo"` yields `["solo"]`; a `"a, b "` yields `["a","b"]` (trimmed); a `"a,,b"` or `"OLD,"` throws `/config_invalid|blank_token_in_set/`; an unset `WAITRON_SYNC_NODE_TOKEN` (with peers set) throws `server.config_missing`.
   ```ts
   it("reads WAITRON_SYNC_NODE_TOKEN as a comma-separated accepted-token SET", () => {
     const base = {
       WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
       WAITRON_SYNC_DATABASE_URL: "x",
     };
     expect(loadSyncConfig({ ...base, WAITRON_SYNC_NODE_TOKEN: "OLD,NEW" })!.nodeTokens).toEqual([
       "OLD",
       "NEW",
     ]);
     expect(loadSyncConfig({ ...base, WAITRON_SYNC_NODE_TOKEN: "solo" })!.nodeTokens).toEqual(["solo"]);
     expect(loadSyncConfig({ ...base, WAITRON_SYNC_NODE_TOKEN: "a, b " })!.nodeTokens).toEqual([
       "a",
       "b",
     ]);
     expect(() => loadSyncConfig({ ...base, WAITRON_SYNC_NODE_TOKEN: "a,,b" })).toThrow(
       /config_invalid|blank_token_in_set/,
     );
     expect(() => loadSyncConfig({ ...base, WAITRON_SYNC_NODE_TOKEN: "OLD," })).toThrow(
       /config_invalid|blank_token_in_set/,
     );
     expect(() => loadSyncConfig({ ...base })).toThrow(/config_missing|WAITRON_SYNC_NODE_TOKEN/);
   });
   ```
   Also **update every existing `loadSyncConfig` test** that reads `.nodeToken` to read `.nodeTokens` (grep `config.test.ts` for `nodeToken`), preserving each assertion's intent (`CLAUDE.md` — preserve behavioural assertions).
2. [ ] Run `pnpm --filter @waitron/server test config` — watch it FAIL (`nodeTokens` undefined / type error).
3. [ ] Implement in `config.ts`: change the interface field and add the parser, then use it in `loadSyncConfig`.
   ```ts
   // in SyncTransportConfig: replace `nodeToken: string;` with:
   /** The accepted INBOUND node tokens — the set a peer's Bearer is validated against. From
    * WAITRON_SYNC_NODE_TOKEN (comma-separated, ≥1 non-blank member). A set of one is the pre-rotation
    * case; ≥2 is the overlap window that rolls the secret with no synchronized restart (spec §2). */
   nodeTokens: string[];

   /** Parses a comma-separated accepted-token SET. `required` fails closed on unset/empty (a blank
    * secret must never mean "no auth", CLAUDE.md §3); a blank MEMBER (a stray `a,,b`) is a hard
    * config_invalid so an empty token can never enter the accepted set. */
   function tokenSet(env: Env, variable: string): string[] {
     const tokens = required(env, variable)
       .split(",")
       .map((t) => t.trim());
     if (tokens.some((t) => t.length === 0)) {
       throw new AppError("server.config_invalid", { variable, reason: "blank_token_in_set" });
     }
     return tokens;
   }
   // in loadSyncConfig's return object: replace `nodeToken: required(env, "WAITRON_SYNC_NODE_TOKEN"),` with:
   nodeTokens: tokenSet(env, "WAITRON_SYNC_NODE_TOKEN"),
   ```
4. [ ] Run `pnpm --filter @waitron/server test config` — watch it PASS.
5. [ ] `git commit -s -m "feat(sync): accept a SET of inbound node tokens (rotation overlap window)"`

---

### Task A2 — `requireNodeTokens` validates against the set in constant time

**Files:**
- `apps/server/src/sync-api.ts` (edit: `SyncApiDeps.nodeToken` → `nodeTokens`; `requireNodeToken` → `requireNodeTokens`)
- `apps/server/src/sync-api.rls.test.ts` (edit: deps + a rotation test)

**Interfaces:**
- Consumes: `SyncApiDeps.nodeTokens: string[]`, Hono `Context`.
- Produces: 401 `sync.node_unauthorized` unless the presented `Bearer` equals **some** set member; blank presented token or empty set → 401 (fail-closed).

**Steps:**
1. [ ] In `sync-api.rls.test.ts`, change the shared `deps` and the two `mountSyncApi({...nodeToken})` sites to `nodeTokens`, then add a rotation test asserting the overlap window:
   ```ts
   it("accepts ANY member of the node-token set (rotation overlap), rejects a retired token", async () => {
     const app = new Hono();
     mountSyncApi(app, { ...deps, nodeTokens: ["OLD", "NEW"] }, log);
     for (const tok of ["OLD", "NEW"]) {
       const res = await app.request("/sync-api/hello", { headers: { Authorization: `Bearer ${tok}` } });
       expect(res.status).toBe(200);
     }
     for (const bad of ["Bearer STALE", "Bearer ", ""]) {
       const res = await app.request("/sync-api/hello", { headers: bad ? { Authorization: bad } : {} });
       expect(res.status).toBe(401);
       expect((await res.json()).error.code).toBe("sync.node_unauthorized");
     }
   });
   ```
   Update the existing auth tests' `deps` from `nodeToken: "s3cret"` to `nodeTokens: ["s3cret"]` and each `mountSyncApi(..., { ..., nodeToken: "s3cret" }, ...)` to `nodeTokens: ["s3cret"]` (preserve their assertions).
2. [ ] Run `pnpm --filter @waitron/server test sync-api` — watch it FAIL (type error / `nodeToken` gone).
3. [ ] Implement in `sync-api.ts`:
   ```ts
   // SyncApiDeps: replace `nodeToken: string;` with:
   nodeTokens: string[]; // the accepted inbound token SET (rotation overlap window, spec §2)

   /** Constant-time Bearer check against the accepted SET. Iterates EVERY member without an
    * early return, so request timing leaks neither which token matched nor the set size; a blank
    * presented token or an empty set fails closed BEFORE any match can be recorded (the empty-secret
    * trap, CLAUDE.md §3). */
   function requireNodeTokens(c: Context, nodeTokens: readonly string[]): void {
     const header = c.req.header("Authorization") ?? "";
     const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
     const a = Buffer.from(presented);
     let matched = false;
     for (const token of nodeTokens) {
       const b = Buffer.from(token);
       matched = (presented.length !== 0 && a.length === b.length && timingSafeEqual(a, b)) || matched;
     }
     if (!matched) throw new AppError("sync.node_unauthorized", {});
   }
   // both routes: requireNodeToken(c, deps.nodeToken) → requireNodeTokens(c, deps.nodeTokens)
   ```
4. [ ] Run `pnpm --filter @waitron/server test sync-api` — watch it PASS.
5. [ ] `git commit -s -m "feat(sync): validate the Bearer node token against the accepted set"`

---

### Task A3 — boot passes the token set

**Files:**
- `apps/server/src/boot.ts` (edit: `nodeToken: syncConfig.nodeToken` → `nodeTokens: syncConfig.nodeTokens`)
- `apps/server/src/boot.test.ts` (edit: the sync-boot test still passes with a set of one)

**Steps:**
1. [ ] In `boot.test.ts`, the existing sync test sends `WAITRON_SYNC_NODE_TOKEN: "boot-node-token"` and requests with `Bearer boot-node-token`. Add one line asserting a second accepted token also works by setting `WAITRON_SYNC_NODE_TOKEN: "boot-node-token,rotated-token"` and asserting `Bearer rotated-token` → 200 on `/sync-api/hello` (the overlap window, end-to-end through boot). Run — watch it FAIL (boot still wires a single `nodeToken`, TS error).
2. [ ] In `boot.ts` `mountSyncApi({ ... })` deps, replace `nodeToken: syncConfig.nodeToken,` with `nodeTokens: syncConfig.nodeTokens,`.
3. [ ] Run `pnpm --filter @waitron/server test boot` — watch it PASS.
4. [ ] `git commit -s -m "feat(sync): wire the node-token set through boot"`

**End of Slice A.** Run the full gate (`pnpm lint && pnpm typecheck && pnpm format:check && pnpm --filter @waitron/server test:coverage`) before starting Slice B.

---

## SLICE B — retention-ops (migration `0003`)

### Task B1 — migration `0003`: `GRANT DELETE ON sync_cursor TO sync_retention`

**Files:**
- `packages/sync/drizzle/0003_sync_cursor_evict.sql` (new)
- `packages/sync/drizzle/meta/_journal.json` (edit: add idx 3)
- `packages/sync/drizzle/meta/0003_snapshot.json` (new: copy of `0002_snapshot.json`)
- `packages/sync/src/retention.gate.test.ts` (edit: a catalog check that the grant landed)

**Interfaces:** none (schema/grant only).

**Steps:**
1. [ ] Add a failing catalog assertion to `retention.gate.test.ts` (inside the existing gate-7 describe, reusing the shared container): `sync_retention` now holds `DELETE` on `sync_cursor`.
   ```ts
   it("0003 granted DELETE on sync_cursor to sync_retention", async () => {
     const r = await postgres.admin.execute<{ has: boolean }>(
       sql`select has_table_privilege('sync_retention', 'sync_cursor', 'DELETE') as has`,
     );
     expect(r.rows[0]!.has).toBe(true);
   });
   ```
2. [ ] Run `pnpm --filter @waitron/sync test retention` (needs Docker + `TESTCONTAINERS_RYUK_DISABLED=true`) — watch it FAIL (`has=false`; grant not yet present).
3. [ ] Create `0003_sync_cursor_evict.sql`:
   ```sql
   -- Hand-written custom migration (drizzle-kit models no roles/grants; sync_cursor is a raw-SQL
   -- table, so drizzle-kit has nothing to diff and 0003_snapshot.json is a copy of 0002's) — the
   -- 0000/0001/0002 idiom (0002_sync_cursor_lane.sql:1-6). Runs LAST in migrations.manifest.json's
   -- `sync` set, after 0000/0001/0002, so sync_cursor and the sync_retention role already exist.
   --
   -- WHAT THIS BUILDS. The one grant the dead-subscriber eviction verb needs. 0001 gave sync_retention
   -- SELECT, INSERT, UPDATE on sync_cursor (0001_sync_retention.sql:55) but NOT DELETE; evictSubscriber
   -- (packages/sync/src/retention.ts) releases a genuinely-dead subscriber by DELETEing its cursor rows
   -- so pruneSyncLog's per-origin min advances past it (spec §3.3). sync_cursor carries no tenant_id and
   -- no RLS (0000_sync_outbox.sql:95-99), so a plain object GRANT is the whole mechanism — no policy.
   -- Only sync_retention gets DELETE; sync_tailer/app_user are NOT widened (CLAUDE.md §3).
   GRANT DELETE ON sync_cursor TO sync_retention;
   ```
4. [ ] Append idx 3 to `meta/_journal.json` (`when` a strictly-increasing value past `0002`'s `1786492800002`, e.g. `1786492800003`, `tag: "0003_sync_cursor_evict"`, `breakpoints: true`).
5. [ ] `cp packages/sync/drizzle/meta/0002_snapshot.json packages/sync/drizzle/meta/0003_snapshot.json` (convention copy; the migrator reads only the journal + `<tag>.sql` at runtime — `migrations.ts:9-14`).
6. [ ] Run `pnpm --filter @waitron/sync test retention` — watch the catalog check PASS. Run `pnpm --filter @waitron/migrations test` to confirm the manifest/journal still loads (no manifest edit needed — `migrations.manifest.json:39-41`).
7. [ ] `git commit -s -m "feat(sync): 0003 grant DELETE on sync_cursor to sync_retention"`

---

### Task B2 — `evictSubscriber` verb (real-PG, prove-by-deletion of the grant)

**Files:**
- `packages/sync/src/retention.ts` (edit: add `evictSubscriber`)
- `packages/sync/src/index.ts` (edit: export it)
- `packages/sync/src/retention.gate.test.ts` (edit: eviction test)

**Interfaces:**
- Consumes: a `sync_retention`-member `Database`; `subscriberId: string`.
- Produces: `evictSubscriber(db, subscriberId): Promise<{ deleted: number }>` — `DELETE FROM sync_cursor WHERE subscriber_id = $1`.

**Steps:**
1. [ ] Add a failing test to `retention.gate.test.ts` (new describe, reusing `sync_pruner`): eviction releases the log, and the DELETE grant is load-bearing.
   ```ts
   it("evictSubscriber releases a dead subscriber's cursor so retention advances past it", async () => {
     await resetOutbox();
     const a = await seedTenant(postgres.admin);
     const b = await seedTenant(postgres.admin);
     await seedLog(10, a, b);
     await setCursor("peerB", 10, true); // caught up
     await setCursor("cloud", 4, false); // dead, holding the log at 4
     const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
     try {
       expect(await pruneSyncLog(pruner)).toEqual({ pruned: 4, highWater: 4n }); // held by `cloud`
       const evicted = await evictSubscriber(pruner, "cloud");
       expect(evicted).toEqual({ deleted: 1 });
       expect(await pruneSyncLog(pruner)).toEqual({ pruned: 6, highWater: 10n }); // advances past dead `cloud`
       expect(await remainingSeqs()).toEqual([]);
     } finally {
       await pruner.close();
     }
   });

   it("the DELETE grant is load-bearing: without it evictSubscriber cannot release the cursor", async () => {
     await resetOutbox();
     const a = await seedTenant(postgres.admin);
     const b = await seedTenant(postgres.admin);
     await seedLog(2, a, b);
     await setCursor("cloud", 0, false);
     const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
     try {
       await postgres.admin.execute(sql.raw(`revoke delete on sync_cursor from sync_retention`));
       try {
         await expect(evictSubscriber(pruner, "cloud")).rejects.toThrow(); // 42501 permission denied
       } finally {
         await postgres.admin.execute(sql.raw(`grant delete on sync_cursor to sync_retention`));
       }
       expect(await evictSubscriber(pruner, "cloud")).toEqual({ deleted: 1 }); // restored → works
     } finally {
       await pruner.close();
     }
   });
   ```
   Import `evictSubscriber` at the top of the test file.
2. [ ] Run `pnpm --filter @waitron/sync test retention` — watch it FAIL (`evictSubscriber` undefined).
3. [ ] Implement in `retention.ts`:
   ```ts
   /**
    * Releases a genuinely-dead subscriber by DELETEing all its `sync_cursor` rows (every origin, every
    * lane), so `pruneSyncLog`'s per-origin `min(last_applied_seq)` no longer includes it and the next
    * sweep advances the log past its position. Runs as a `sync_retention` member — the DELETE grant
    * `0003_sync_cursor_evict.sql` added (`sync_tailer`/`app_user` are NOT widened, CLAUDE.md §3).
    *
    * EXPLICIT, NEVER AUTOMATIC (spec §3.4, an inherited owner decision): "slow" and "dead" are
    * indistinguishable from the log, so an operator invokes this only after independently confirming
    * the node is gone — auto-evicting a slow-but-alive node is silent, unrecoverable data loss. Nothing
    * in this package calls it on a timer; `runRetentionSweep` never does. `.execute` exposes `.rows`
    * not pg's `.rowCount` (client.ts), so `returning subscriber_id` makes the count readable.
    */
   export async function evictSubscriber(
     db: Database,
     subscriberId: string,
   ): Promise<{ deleted: number }> {
     const deleted = await db.execute(
       sql`delete from sync_cursor where subscriber_id = ${subscriberId} returning subscriber_id`,
     );
     return { deleted: deleted.rows.length };
   }
   ```
   Export from `index.ts`: add `evictSubscriber` to the `retention.js` re-export line.
4. [ ] Run `pnpm --filter @waitron/sync test retention` — watch it PASS.
5. [ ] `git commit -s -m "feat(sync): evictSubscriber releases a dead subscriber's cursor"`

---

### Task B3 — `recordSubscriberCursor` source-side writer (cross-node visibility)

**Files:**
- `packages/sync/src/cursor-report.ts` (new)
- `packages/sync/src/index.ts` (edit: export)
- `packages/sync/src/retention.gate.test.ts` (edit: a real-PG test proving a reported cursor makes a source-side prune advance)

**Interfaces:**
- Consumes: a `sync_tailer`-member `Database`; `{ subscriberId: string; originId: string; lane: SyncLane; lastAppliedSeq: bigint }`.
- Produces: `recordSubscriberCursor(db, args): Promise<void>` — upsert `sync_cursor`, `last_applied_seq` monotonic (`greatest`), `updated_at` always bumped (heartbeat).

**Steps:**
1. [ ] Add a failing test to `retention.gate.test.ts` (reusing `tailer_login` + `sync_pruner`): a reported cursor is what lets the source's own prune advance; monotonic + heartbeat.
   ```ts
   it("recordSubscriberCursor makes a source-side prune advance (cross-node visibility, spec §3.1)", async () => {
     await resetOutbox();
     const a = await seedTenant(postgres.admin);
     const b = await seedTenant(postgres.admin);
     // sync_log rows are ORIGIN's own captured writes; a source pruning ITS OWN log needs an
     // origin=ORIGIN cursor, which in the real topology only a subscriber's report creates.
     await seedLog(6, a, b);
     const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
     const tailer = await postgres.pg.connectAs("tailer_login", "tp");
     try {
       // Control (the §1 gap): with NO reported cursor for origin=ORIGIN, the source prunes nothing.
       expect(await pruneSyncLog(pruner)).toEqual({ pruned: 0, highWater: 0n });
       expect(await remainingSeqs()).toEqual([1, 2, 3, 4, 5, 6]);
       // A subscriber reports it has applied up to seq 4 of ORIGIN → the source can now release 1..4.
       await recordSubscriberCursor(tailer, {
         subscriberId: "peerB",
         originId: ORIGIN,
         lane: "ordered",
         lastAppliedSeq: 4n,
       });
       expect(await pruneSyncLog(pruner)).toEqual({ pruned: 4, highWater: 4n });
       // Monotonic: a stale lower report never regresses; heartbeat: updated_at bumps on a same-seq report.
       const before = await postgres.admin.execute<{ ts: string }>(
         sql`select updated_at::text as ts from sync_cursor where subscriber_id = 'peerB'`,
       );
       await recordSubscriberCursor(tailer, {
         subscriberId: "peerB",
         originId: ORIGIN,
         lane: "ordered",
         lastAppliedSeq: 2n, // lower → must NOT regress
       });
       const after = await postgres.admin.execute<{ seq: string; ts: string }>(
         sql`select last_applied_seq::text as seq, updated_at::text as ts from sync_cursor where subscriber_id = 'peerB'`,
       );
       expect(after.rows[0]!.seq).toBe("4"); // held (monotonic)
       expect(after.rows[0]!.ts).not.toBe(before.rows[0]!.ts); // updated_at bumped (heartbeat)
     } finally {
       await tailer.close();
       await pruner.close();
     }
   });
   ```
   Import `recordSubscriberCursor` in the test file.
2. [ ] Run `pnpm --filter @waitron/sync test retention` — watch it FAIL (undefined).
3. [ ] Create `cursor-report.ts`:
   ```ts
   // The source-side cursor-report writer: cross-node visibility for retention (spec §3.1). A
   // subscriber POSTs how far it has applied a source's log; the source records it into its OWN
   // sync_cursor as (subscriber=<peer>, origin=self, lane, seq), so pruneSyncLog — which runs where
   // sync_log lives — can hold the log at the min across every subscriber's reported cursor. Runs as
   // sync_tailer, which already holds INSERT, UPDATE on sync_cursor (0000_sync_outbox.sql:109) — no
   // new grant. sync_cursor has no tenant_id and no RLS (0000:95-99), so no withTenant is needed.
   import { sql } from "drizzle-orm";
   import { type Database } from "@waitron/db";
   import type { SyncLane } from "./registry.js";

   export interface RecordSubscriberCursorArgs {
     /** The reporting subscriber's node id — the `subscriber_id` half of the key. */
     subscriberId: string;
     /** The origin this report is against — ALWAYS the source's own node id, stamped by the route
      * (never a peer-supplied value), so a peer cannot write a cursor for an arbitrary origin. */
     originId: string;
     lane: SyncLane;
     /** How far the subscriber has applied this origin's log. */
     lastAppliedSeq: bigint;
   }

   /**
    * Upserts the reporting subscriber's cursor on the SOURCE. `last_applied_seq` is kept monotonic with
    * `greatest(excluded, existing)` so a reordered/stale report never regresses the source's view, and
    * `updated_at` is bumped on EVERY report (a heartbeat — the source's "last heard from" signal, spec
    * §3.5, which is why no `last_seen_at` column is needed). Values bind as parameters (CLAUDE.md §3).
    */
   export async function recordSubscriberCursor(
     db: Database,
     args: RecordSubscriberCursorArgs,
   ): Promise<void> {
     await db.execute(
       sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq, updated_at)
           values (${args.subscriberId}, ${args.originId}::uuid, ${args.lane},
                   ${args.lastAppliedSeq.toString()}::bigint, now())
           on conflict (subscriber_id, origin_id, lane) do update
             set last_applied_seq = greatest(excluded.last_applied_seq, sync_cursor.last_applied_seq),
                 updated_at = now()`,
     );
   }
   ```
   Export from `index.ts`:
   ```ts
   export { recordSubscriberCursor } from "./cursor-report.js";
   export type { RecordSubscriberCursorArgs } from "./cursor-report.js";
   ```
4. [ ] Run `pnpm --filter @waitron/sync test retention` — watch it PASS.
5. [ ] `git commit -s -m "feat(sync): recordSubscriberCursor — source-side cross-node cursor visibility"`

---

### Task B4 — `POST /sync-api/cursor` route (node-token auth; stamps origin=self)

**Files:**
- `apps/server/src/sync-api.ts` (edit: add the route + a JSON-body helper)
- `apps/server/src/sync-api.rls.test.ts` (edit: route test)

**Interfaces:**
- Consumes: `SyncApiDeps` (db: sync_tailer-member, `nodeId`, `nodeTokens`); JSON body `{ subscriberId, lane?, lastAppliedSeq }`.
- Produces: node-token fail-closed 401; on success calls `recordSubscriberCursor(deps.db, { subscriberId, originId: deps.nodeId, lane: laneParam(lane), lastAppliedSeq })` and returns 200.

**Steps:**
1. [ ] Add failing tests to `sync-api.rls.test.ts` (reuse `sync_reader` = sync_tailer member for the write path; `throwingDb` for the auth path):
   ```ts
   it("POST /sync-api/cursor is node-token fail-closed and never touches the DB on 401", async () => {
     const app = new Hono();
     mountSyncApi(app, { ...deps, nodeTokens: ["s3cret"] }, log); // deps.db is throwingDb
     const res = await app.request("/sync-api/cursor", {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify({ subscriberId: "peerB", lane: "ordered", lastAppliedSeq: "5" }),
     });
     expect(res.status).toBe(401);
     expect((await res.json()).error.code).toBe("sync.node_unauthorized");
   });

   it("POST /sync-api/cursor records the report against origin=self (ignoring a peer-supplied origin)", async () => {
     const reader = await postgres.pg.connectAs("sync_reader", "rp");
     try {
       const app = new Hono();
       mountSyncApi(
         app,
         { db: reader, tenantId: "t", nodeId: NODE_A, environment: "production", nodeTokens: ["s3cret"] },
         log,
       );
       const res = await app.request("/sync-api/cursor", {
         method: "POST",
         headers: { Authorization: "Bearer s3cret", "content-type": "application/json" },
         // a hostile originId in the body must be IGNORED — the source stamps NODE_A
         body: JSON.stringify({ subscriberId: "peerB", originId: "deadbeef", lane: "fast", lastAppliedSeq: "7" }),
       });
       expect(res.status).toBe(200);
       const row = await postgres.admin.execute<{ origin: string; lane: string; seq: string }>(
         sql`select origin_id::text as origin, lane, last_applied_seq::text as seq
             from sync_cursor where subscriber_id = 'peerB'`,
       );
       expect(row.rows[0]).toMatchObject({ origin: NODE_A, lane: "fast", seq: "7" });
     } finally {
       await postgres.admin.execute(sql`delete from sync_cursor where subscriber_id = 'peerB'`);
       await reader.close();
     }
   });
   ```
2. [ ] Run `pnpm --filter @waitron/server test sync-api` — watch it FAIL (404 / no route).
3. [ ] Implement in `sync-api.ts`: import `recordSubscriberCursor`, add the route inside `mountSyncApi`. Reuse `afterSeq` for the seq screen and `laneParam` for the lane clamp; parse the body defensively (no 400 convention — a malformed report is a 200 no-op).
   ```ts
   // add to the "@waitron/sync" import: recordSubscriberCursor
   // inside mountSyncApi, after the /sync-api/log route:
   app.post("/sync-api/cursor", (c) =>
     run(c, log, async () => {
       requireNodeTokens(c, deps.nodeTokens);
       const body = (await c.req.json().catch(() => ({}))) as {
         subscriberId?: unknown;
         lane?: unknown;
         lastAppliedSeq?: unknown;
       };
       const subscriberId = typeof body.subscriberId === "string" ? body.subscriberId : "";
       if (subscriberId.length === 0) return c.body(null, 200); // machine surface: no-op, never a 400
       await recordSubscriberCursor(deps.db, {
         subscriberId,
         originId: deps.nodeId, // stamp OUR origin; never trust a peer-supplied one (spec §3.1)
         lane: laneParam(typeof body.lane === "string" ? body.lane : undefined),
         lastAppliedSeq: afterSeq(typeof body.lastAppliedSeq === "string" ? body.lastAppliedSeq : undefined),
       });
       return c.body(null, 200);
     }),
   );
   ```
4. [ ] Run `pnpm --filter @waitron/server test sync-api` — watch it PASS.
5. [ ] `git commit -s -m "feat(sync): POST /sync-api/cursor — subscribers report their cursor to the source"`

---

### Task B5 — extend `HttpClient` with `method`/`body`; update `fetchHttpClient`

**Files:**
- `packages/sync/src/pull.ts` (edit: `HttpClient` init gains `method?`, `body?`)
- `apps/server/src/sync-http.ts` (edit: forward them)
- `apps/server/src/sync-http.test.ts` (new: loopback POST round-trip)

**Interfaces:**
- Produces: `HttpClient = (url, init: { headers; method?: string; body?: string }) => Promise<{ status; text() }>`.

**Steps:**
1. [ ] Create `sync-http.test.ts`: start a one-shot `node:http` server on loopback, call `fetchHttpClient` with `method: "POST"` + a JSON body, assert the server received the method + body and the client saw the status.
   ```ts
   import { createServer } from "node:http";
   import { describe, expect, it } from "vitest";
   import { fetchHttpClient } from "./sync-http.js";

   describe("fetchHttpClient forwards method and body (cursor-report POST)", () => {
     it("POSTs a body and returns the status/text", async () => {
       const received: { method?: string; body: string } = { body: "" };
       const server = createServer((req, res) => {
         received.method = req.method;
         let b = "";
         req.on("data", (c) => (b += c));
         req.on("end", () => {
           received.body = b;
           res.writeHead(200, { "content-type": "text/plain" });
           res.end("ok");
         });
       });
       await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
       const port = (server.address() as { port: number }).port;
       try {
         const res = await fetchHttpClient(`http://127.0.0.1:${port}/sync-api/cursor`, {
           method: "POST",
           headers: { "content-type": "application/json" },
           body: JSON.stringify({ subscriberId: "n", lane: "fast", lastAppliedSeq: "3" }),
         });
         expect(res.status).toBe(200);
         expect(await res.text()).toBe("ok");
         expect(received.method).toBe("POST");
         expect(JSON.parse(received.body)).toEqual({ subscriberId: "n", lane: "fast", lastAppliedSeq: "3" });
       } finally {
         server.close();
       }
     });
   });
   ```
2. [ ] Run `pnpm --filter @waitron/server test sync-http` — watch it FAIL (body ignored — current adapter drops `method`/`body`).
3. [ ] Implement: in `pull.ts`, widen `HttpClient`'s init:
   ```ts
   export type HttpClient = (
     url: string,
     init: { headers: Record<string, string>; method?: string; body?: string },
   ) => Promise<{ status: number; text(): Promise<string> }>;
   ```
   In `sync-http.ts`:
   ```ts
   export const fetchHttpClient: HttpClient = (url, init) =>
     undiciFetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body });
   ```
4. [ ] Run `pnpm --filter @waitron/server test sync-http` — watch it PASS.
5. [ ] `git commit -s -m "feat(sync): HttpClient carries method/body for the cursor-report POST"`

---

### Task B6 — puller reports its cursor after draining a peer

**Files:**
- `packages/sync/src/pull.ts` (edit: `reportCursor` dep + report after the per-peer drain)
- `packages/sync/src/pull.test.ts` (edit: injected-`reportCursor` loop test)

**Interfaces:**
- Consumes (new dep on `RunSyncPullDeps`): `reportCursor?: (peer: PullPeer, report: { subscriberId: string; lane: SyncLane; lastAppliedSeq: string }) => Promise<void>` — defaults to a real POST via `deps.http`.
- Behaviour: after the inner drain settles for a peer, read the `(subscriber, origin=peer, lane)` cursor and report it; a report failure is swallowed (best-effort operational metadata, never blocks the drain or changes backoff).

**Steps:**
1. [ ] Add a failing test to `pull.test.ts`: with an injected `pullOnce` (drains to a short page) and an injected `reportCursor` spy, `runSyncPull` calls `reportCursor` once per peer per round with the peer + lane + a stringified seq; and a throwing `reportCursor` does not break the loop (the peer still counts healthy).
   ```ts
   it("reports the cursor to a peer after draining it, and a report failure does not break the loop", async () => {
     const reports: Array<{ peer: string; lane: string }> = [];
     const controller = new AbortController();
     let rounds = 0;
     await runSyncPull({
       ...dummyDeps,
       peers: [peerA],
       lane: "ordered",
       signal: controller.signal,
       minIdleMs: 10,
       maxBackoffMs: 100,
       log: noopLog,
       sleep: async () => {
         rounds += 1;
         if (rounds >= 2) controller.abort();
       },
       pullOnce: async () => short(0), // caught up immediately
       reportCursor: async (peer, report) => {
         reports.push({ peer: peer.nodeId, lane: report.lane });
         throw new Error("report boom"); // must be swallowed
       },
     });
     expect(reports.length).toBeGreaterThanOrEqual(1);
     expect(reports[0]).toEqual({ peer: peerA.nodeId, lane: "ordered" });
   });
   ```
   (`short(n)` already exists in `pull.test.ts` for a caught-up page — reuse it; if not, define it as `{ applied: n, deferred: 0, fetched: n, advanced: false }`.)
2. [ ] Run `pnpm --filter @waitron/sync test pull` — watch it FAIL (`reportCursor` not called).
3. [ ] Implement in `pull.ts`. Add the dep to `RunSyncPullDeps`, a default report built from `deps.http`, and the report call after the inner drain `while` loop (still inside the per-peer `try`, so a report error is caught by the existing per-peer `catch` — but to keep the report from affecting backoff, wrap the report in its own try/catch that only logs):
   ```ts
   // RunSyncPullDeps: add
   /** Reports this subscriber's cursor for a drained peer back to that peer (POST /sync-api/cursor),
    * so the SOURCE gains cross-node visibility for retention (spec §3.1). Injectable for the loop test;
    * defaults to a real POST via `http`. Best-effort — a failure is logged and swallowed, never
    * affecting the pull's own success/backoff. */
   reportCursor?: (
     peer: PullPeer,
     report: { subscriberId: string; lane: SyncLane; lastAppliedSeq: string },
   ) => Promise<void>;

   // near the top of runSyncPull:
   const report =
     deps.reportCursor ??
     (async (peer: PullPeer, r: { subscriberId: string; lane: SyncLane; lastAppliedSeq: string }) => {
       await deps.http(`${trimSlash(peer.url)}/sync-api/cursor`, {
         method: "POST",
         headers: { Authorization: `Bearer ${peer.token}`, "content-type": "application/json" },
         body: JSON.stringify(r),
       });
     });

   // inside the per-peer try, AFTER the inner `while` drain loop and BEFORE backoff.set(peer.nodeId, 0):
   try {
     const seq = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId, lane);
     await report(peer, { subscriberId: deps.subscriberId, lane, lastAppliedSeq: seq.toString() });
   } catch {
     deps.log("warn", "sync.cursor_report_failed", { originId: peer.nodeId, lane });
   }
   ```
   Note: the loop test injects `pullOnce`, so `readCursor` would hit the dummy DB — guard the test by having the injected `reportCursor` throw *before* any real cursor read matters, OR (cleaner) read the cursor only when `deps.reportCursor` is the default. Simplest: keep the `readCursor` inside the same `try` as `report`; in the loop test, inject `reportCursor` AND set `localDb` to a stub whose `execute` returns `{ rows: [{ seq: "0" }] }` so `readCursor` resolves. Adjust `dummyDeps.localDb` in this one test to such a stub. (`sync.cursor_report_failed` is a plain log string, not a registered code — same class as `sync.pull_failed`, `pull.ts:213`.)
4. [ ] Run `pnpm --filter @waitron/sync test pull` — watch it PASS. Then run the package unfiltered coverage (`pnpm --filter @waitron/sync test:coverage`) to confirm the new branch is covered.
5. [ ] `git commit -s -m "feat(sync): puller reports its cursor to the source after draining"`

---

### Task B7 — config knobs + `runRetentionSweep` loop

**Files:**
- `apps/server/src/config.ts` (edit: `SyncTransportConfig` gains `retentionDatabaseUrl?`, `retentionTickMs`; a `DEFAULT_SYNC_RETENTION_TICK_MS`)
- `apps/server/src/config.test.ts` (edit)
- `packages/sync/src/retention.ts` (edit: add `runRetentionSweep` + `RetentionSweepDeps`)
- `packages/sync/src/index.ts` (edit: export)
- `packages/sync/src/retention-sweep.test.ts` (new: hermetic loop-control test)

**Interfaces:**
- `RetentionSweepDeps { db: Database; sleep: (ms, signal) => Promise<void>; signal: AbortSignal; tickMs: number; log: (level, code, params?) => void; lagAlarmRows?: number; prune?: (db) => Promise<PruneResult>; lag?: (db) => Promise<SubscriberLag[]> }`
- `runRetentionSweep(deps): Promise<void>`

**Steps (config):**
1. [ ] In `config.test.ts`, assert `loadSyncConfig` reads `WAITRON_SYNC_RETENTION_TICK_MS` (positive int, default `60000`), refuses a non-positive value, and sets `retentionDatabaseUrl` only when `WAITRON_SYNC_RETENTION_DATABASE_URL` is set (absent → field omitted). Run — watch FAIL.
2. [ ] Implement in `config.ts`: add `const DEFAULT_SYNC_RETENTION_TICK_MS = 60_000;`; add the two fields to `SyncTransportConfig`; in `loadSyncConfig`'s return add:
   ```ts
   retentionTickMs: positiveInt(env, "WAITRON_SYNC_RETENTION_TICK_MS", DEFAULT_SYNC_RETENTION_TICK_MS),
   ...(isUnset(env.WAITRON_SYNC_RETENTION_DATABASE_URL)
     ? {}
     : { retentionDatabaseUrl: env.WAITRON_SYNC_RETENTION_DATABASE_URL }),
   ```
   with the interface fields documented (`retentionDatabaseUrl` a `sync_retention` LOGIN member; sweep off when unset — spec §3.2/§8).
3. [ ] Run `pnpm --filter @waitron/server test config` — watch PASS. Commit `-s`.

**Steps (sweep loop):**
4. [ ] Create `retention-sweep.test.ts` (hermetic, injected `prune`/`sleep`/`lag`): the loop prunes each tick, stops on abort, and emits the retention-variant `sync.stream_stalled` for a subscriber above `lagAlarmRows`.
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { runRetentionSweep } from "./retention.js";
   import type { Database } from "@waitron/db";

   const db = {} as Database;
   const noSignal = (): AbortSignal => new AbortController().signal;

   describe("runRetentionSweep", () => {
     it("prunes each tick and stops on abort", async () => {
       const controller = new AbortController();
       const prune = vi.fn(async () => ({ pruned: 2, highWater: 5n }));
       let ticks = 0;
       await runRetentionSweep({
         db,
         signal: controller.signal,
         tickMs: 10,
         log: () => {},
         prune,
         lag: async () => [],
         sleep: async () => {
           ticks += 1;
           if (ticks >= 3) controller.abort();
         },
       });
       expect(prune.mock.calls.length).toBeGreaterThanOrEqual(3);
     });

     it("emits sync.stream_stalled for a subscriber past the lag threshold", async () => {
       const controller = new AbortController();
       const logged: Array<[string, string]> = [];
       await runRetentionSweep({
         db,
         signal: controller.signal,
         tickMs: 10,
         lagAlarmRows: 5,
         log: (level, code) => logged.push([level, code]),
         prune: async () => ({ pruned: 0, highWater: 0n }),
         lag: async () => [
           { subscriberId: "cloud", originId: "o", lag: 9n, alive: false },
           { subscriberId: "peerB", originId: "o", lag: 1n, alive: true },
         ],
         sleep: async () => controller.abort(),
       });
       expect(logged).toContainEqual(["error", "sync.stream_stalled"]);
     });
   });
   ```
5. [ ] Run `pnpm --filter @waitron/sync test retention-sweep` — watch FAIL (`runRetentionSweep` undefined).
6. [ ] Implement in `retention.ts`:
   ```ts
   export interface RetentionSweepDeps {
     /** A LOGIN pool that is a member of sync_retention (the whole-log permissive policy). */
     db: Database;
     sleep: (ms: number, signal: AbortSignal) => Promise<void>;
     signal: AbortSignal;
     /** Idle interval between prunes (WAITRON_SYNC_RETENTION_TICK_MS). */
     tickMs: number;
     log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;
     /** Optional: emit the retention-variant sync.stream_stalled for any subscriber whose lag exceeds
      * this many rows — the operator signal that INFORMS a manual eviction (never triggers one). */
     lagAlarmRows?: number;
     /** Injectable for the loop test; default the real pruneSyncLog / lagFor. */
     prune?: (db: Database) => Promise<PruneResult>;
     lag?: (db: Database) => Promise<SubscriberLag[]>;
   }

   /**
    * The scheduled retention sweep boot starts (spec §3.2). Each tick prunes the log to the min across
    * every subscriber's (reported) cursor, then reports lag and alarms a stalled subscriber past the
    * threshold. It NEVER evicts and NEVER filters the prune by `alive` — eviction is an explicit
    * operator action (spec §3.4). Abort-checked before each prune and each sleep so close() stops it
    * promptly. Errors are logged and swallowed so a transient DB fault does not kill the sweep.
    */
   export async function runRetentionSweep(deps: RetentionSweepDeps): Promise<void> {
     const prune = deps.prune ?? pruneSyncLog;
     const lag = deps.lag ?? lagFor;
     while (!deps.signal.aborted) {
       try {
         const result = await prune(deps.db);
         deps.log("info", "sync.retention_swept", {
           pruned: result.pruned,
           highWater: result.highWater.toString(),
         });
         if (deps.lagAlarmRows !== undefined) {
           const threshold = BigInt(deps.lagAlarmRows);
           for (const s of await lag(deps.db)) {
             if (s.lag > threshold) {
               deps.log("error", "sync.stream_stalled", {
                 subscriberId: s.subscriberId,
                 originId: s.originId,
                 lag: Number(s.lag), // narrowed only at the alarm edge (retention.ts lag doc)
               });
             }
           }
         }
       } catch {
         deps.log("warn", "sync.retention_failed", {});
       }
       if (deps.signal.aborted) break;
       await deps.sleep(deps.tickMs, deps.signal);
     }
   }
   ```
   Export `runRetentionSweep` + `RetentionSweepDeps` from `index.ts` (add to the `retention.js` re-export). `sync.retention_swept`/`sync.retention_failed` are plain log strings (not registered codes — the `sync.pull_failed` precedent).
7. [ ] Run `pnpm --filter @waitron/sync test retention-sweep` — watch PASS. `git commit -s -m "feat(sync): runRetentionSweep — scheduled prune + lag alarm"`

---

### Task B8 — boot wires the retention sweep (and its pool teardown)

**Files:**
- `apps/server/src/boot.ts` (edit: start `runRetentionSweep` when `retentionDatabaseUrl` is set; tear it down)
- `apps/server/src/boot.test.ts` (edit)

**Interfaces:** Consumes `syncConfig.retentionDatabaseUrl`, `syncConfig.retentionTickMs`; a `sync_retention`-member pool via `createPostgresDb`.

**Steps:**
1. [ ] In `boot.test.ts`, extend the sync-boot test: with `WAITRON_SYNC_RETENTION_DATABASE_URL` set (reuse `databaseUrl` — the sweep's first prune runs against the migrated DB; a role that lacks the sync_retention policy simply prunes nothing, which is fine for the boot-wiring assertion) and `runRetentionSweep` mocked (`vi.mock("@waitron/sync")` already mocks `runSyncPull` in this file — add `runRetentionSweep` to the mock), assert `runRetentionSweep` was called once with `tickMs` from `WAITRON_SYNC_RETENTION_TICK_MS`, and that `close()` still resolves and tears down. Add a second case: with the retention URL UNSET, `runRetentionSweep` is NOT called (existing sync hosts unaffected). Run — watch FAIL.
2. [ ] In `boot.ts`: add `runRetentionSweep` to the `@waitron/sync` import (`boot.ts:50`); declare `let retentionDb: Database | undefined;` and `let retentionWorker: Promise<void> | undefined;` beside `syncDb`/`syncWorker` (`boot.ts:380-381`); inside `if (syncConfig !== undefined)`, after the pull-worker wiring, add:
   ```ts
   if (syncConfig.retentionDatabaseUrl !== undefined) {
     retentionDb = await createPostgresDb(syncConfig.retentionDatabaseUrl);
     retentionWorker = runRetentionSweep({
       db: retentionDb,
       sleep: realSleep,
       signal: syncController.signal, // the same controller close() aborts
       tickMs: syncConfig.retentionTickMs,
       log,
     });
     retentionWorker.catch((err) => log("error", "sync.worker_rejected", { errorCode: codeOf(err) }));
   } else {
     // Sync is on but no retention role is configured: the log will grow unpruned. Loud, not fatal
     // (spec §3.2/§8 — opt-in, documented-required-in-prod).
     log("warn", "sync.retention_unconfigured", {});
   }
   ```
   In `close()`, after `if (syncWorker !== undefined) await syncWorker.catch(() => {});` add `if (retentionWorker !== undefined) await retentionWorker.catch(() => {});`, and in the `finally` after `if (syncDb !== undefined) await syncDb.close();` add `if (retentionDb !== undefined) await retentionDb.close();`.
3. [ ] Run `pnpm --filter @waitron/server test boot` — watch PASS.
4. [ ] `git commit -s -m "feat(sync): schedule the retention sweep in boot"`

---

### Task B9 — the explicit eviction operator CLI

**Files:**
- `apps/server/src/sync-evict.ts` (new: testable command function)
- `apps/server/src/bin-sync-evict.ts` (new: thin process wrapper)
- `apps/server/package.json` (edit: add the `bin` entry, mirroring the existing bin convention)
- `apps/server/src/sync-evict.test.ts` (new)

**Interfaces:**
- `evictSubscriberCommand(deps: { argv: string[]; env: Env; connect: (url: string) => Promise<Database>; out: (line: string) => void }): Promise<number>` — returns an exit code (0 success, 2 usage/config error).

**Steps:**
1. [ ] Create `sync-evict.test.ts` (hermetic, injected `connect`): missing `subscriberId` → exit 2 + usage; missing `WAITRON_SYNC_RETENTION_DATABASE_URL` → exit 2; a good call connects, calls `evictSubscriber`, prints the count, closes the pool, exit 0.
   ```ts
   import { describe, expect, it, vi } from "vitest";
   import type { Database } from "@waitron/db";
   import { evictSubscriberCommand } from "./sync-evict.js";

   describe("evictSubscriberCommand", () => {
     it("requires a subscriberId", async () => {
       const out: string[] = [];
       const code = await evictSubscriberCommand({
         argv: [],
         env: { WAITRON_SYNC_RETENTION_DATABASE_URL: "x" },
         connect: async () => ({}) as Database,
         out: (l) => out.push(l),
       });
       expect(code).toBe(2);
       expect(out.join("\n")).toMatch(/usage/i);
     });

     it("requires WAITRON_SYNC_RETENTION_DATABASE_URL", async () => {
       const code = await evictSubscriberCommand({
         argv: ["peerB"],
         env: {},
         connect: async () => ({}) as Database,
         out: () => {},
       });
       expect(code).toBe(2);
     });

     it("evicts and closes the pool", async () => {
       const close = vi.fn(async () => {});
       const execute = vi.fn(async () => ({ rows: [{ subscriber_id: "peerB" }] }));
       const db = { execute, close } as unknown as Database;
       const out: string[] = [];
       const code = await evictSubscriberCommand({
         argv: ["peerB"],
         env: { WAITRON_SYNC_RETENTION_DATABASE_URL: "postgres://x" },
         connect: async () => db,
         out: (l) => out.push(l),
       });
       expect(code).toBe(0);
       expect(out.join("\n")).toMatch(/peerB.*1/);
       expect(close).toHaveBeenCalledOnce();
     });
   });
   ```
2. [ ] Run `pnpm --filter @waitron/server test sync-evict` — watch FAIL.
3. [ ] Implement `sync-evict.ts`:
   ```ts
   import { evictSubscriber } from "@waitron/sync";
   import { type Database } from "@waitron/db";

   type Env = Record<string, string | undefined>;

   /**
    * The EXPLICIT, operator-run dead-subscriber eviction (spec §3.3/§3.4). A human runs this locally
    * against the node that holds the log — NEVER automatic, never peer-facing — after independently
    * confirming the subscriber is gone. Connects as the sync_retention member
    * (WAITRON_SYNC_RETENTION_DATABASE_URL) and DELETEs the subscriber's cursor rows so the next
    * retention sweep advances the log past it.
    */
   export async function evictSubscriberCommand(deps: {
     argv: string[];
     env: Env;
     connect: (url: string) => Promise<Database>;
     out: (line: string) => void;
   }): Promise<number> {
     const subscriberId = deps.argv[0];
     if (subscriberId === undefined || subscriberId.length === 0) {
       deps.out("usage: waitron-sync-evict <subscriberId>");
       return 2;
     }
     const url = deps.env.WAITRON_SYNC_RETENTION_DATABASE_URL;
     if (url === undefined || url.length === 0) {
       deps.out("WAITRON_SYNC_RETENTION_DATABASE_URL is not set");
       return 2;
     }
     const db = await deps.connect(url);
     try {
       const { deleted } = await evictSubscriber(db, subscriberId);
       deps.out(`evicted subscriber ${subscriberId}: released ${deleted} cursor row(s)`);
       return 0;
     } finally {
       await db.close();
     }
   }
   ```
   And the thin wrapper `bin-sync-evict.ts` (mark the process wiring `/* v8 ignore */` where it cannot be unit-covered, matching boot's convention):
   ```ts
   #!/usr/bin/env node
   import { createPostgresDb } from "@waitron/db";
   import { evictSubscriberCommand } from "./sync-evict.js";

   /* v8 ignore start -- process wiring, exercised by an operator not a unit test */
   evictSubscriberCommand({
     argv: process.argv.slice(2),
     env: process.env,
     connect: createPostgresDb,
     out: (line) => process.stdout.write(`${line}\n`),
   }).then((code) => process.exit(code));
   /* v8 ignore stop */
   ```
   Add the `bin` field to `apps/server/package.json` (mirror the existing bin entry, e.g. `"waitron-sync-evict": "./dist/bin-sync-evict.js"` — confirm the built path against the existing bin's).
4. [ ] Run `pnpm --filter @waitron/server test sync-evict` — watch PASS.
5. [ ] `git commit -s -m "feat(sync): explicit operator CLI to evict a dead subscriber"`

---

## Finalisation

- [ ] **Backlog:** update `docs/backlog.md`'s "SIF topology follow-ups" — move **node-token rotation**
  and **dead-subscriber cleanup** out of "what NOW remains" into shipped, keeping **cloud-mirror**,
  **multi-tenant transport**, and the **fiscal-lane sync (H2)** as the remaining pieces. (A
  `docs/backlog.md`-only change is exempt from PR ceremony — `CLAUDE.md` §6 — but this whole item lands
  via PR, so fold the backlog edit into the branch.)
- [ ] **Full gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm --filter @waitron/sync
  test:coverage && pnpm --filter @waitron/server test:coverage`, plus each package **unfiltered**, with
  `TESTCONTAINERS_RYUK_DISABLED=true`. Also run `pnpm --filter @waitron/fiscal-verifactu test
  inmutabilidad` to confirm the FORCE-RLS scan is still green (this slice adds no `tenant_id`-bearing
  table — expected no-op, but run it per `CLAUDE.md` §3).
- [ ] **finish-branch review**, then land per `CLAUDE.md` §6 (wait for owner approval / `/land-branch`).
- [ ] **Owner-review gate (spec §8):** if any task drifted into the fiscal lane or toward AUTOMATIC
  eviction / a TTL sweep / an `alive`-filtered prune, leave the PR **`needs-owner-review` and do NOT
  land**. Otherwise the recorded decisions (comma-separated token set; opt-in retention URL; explicit
  manual eviction via CLI; tuning-target cadence) are landable as designed.

## Self-review against the spec

- **Rotation mechanism (spec §2):** A1-A3 pluralise the inbound token to a set, validate constant-time,
  fail-closed on blank/empty, keep the outbound token single — the overlap-window runbook works. ✔
- **Cross-node visibility (spec §3.1):** B3/B4/B5/B6 build `recordSubscriberCursor` + `/sync-api/cursor`
  (origin stamped self) + the puller report; B3's gate test proves a reported cursor is exactly what
  lets a source-side prune advance (the control being: no report → prunes nothing). ✔
- **Scheduled retention (spec §3.2):** B7/B8 add `runRetentionSweep` + the retention pool/tick config +
  boot wiring + teardown; opt-in on `WAITRON_SYNC_RETENTION_DATABASE_URL`. ✔
- **Eviction verb + grant, explicit-not-automatic (spec §3.3/§3.4):** B1 grant, B2 verb (prove-by-
  deletion of the grant), B9 the manual CLI; the sweep never evicts and never filters by `alive`. ✔
- **Migration number (spec §4):** exactly one, `0003_sync_cursor_evict.sql`, `packages/sync/drizzle`;
  no `packages/db` migration; no `tenant_id` table → no inmutabilidad obligation. ✔
- **No `last_seen_at` column (spec §3.5):** `recordSubscriberCursor` bumps the existing `updated_at`. ✔
- **Fiscal safety (spec §0/§7):** no task reads/writes/enrolls any fiscal table; all writes are on
  operational `sync_cursor` / commercial `sync_log`. ✔
- **No new registered error code:** reuses `sync.node_unauthorized` + retention-variant
  `sync.stream_stalled`; operational lines are plain log strings. ✔
- **Sequencing (spec §5):** one branch, Slice A then Slice B. ✔
