# Membership Promotion R3a — split identity at join (own id from adopt)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the moment a cloud mirror adopts, it runs as its **own** node — `config.till.nodeId` is the cloud's own reserved nodeId, the sync peer token is enrolled for that id, and the primary's nodeId is persisted separately as the mirror's *origin*. The mirror stays a read-only mirror (`mode = mirror`); it just no longer impersonates the primary's identity for sync. This makes promotion (R3b) a mode/role flip with no identity switch.

**Architecture:** The sync protocol is already axis-split — the cursor key is `(subscriber, origin, lane)` and the apply path preserves each row's own `originId`. Today's shared identity is forced by three wiring facts: `enrolPeer(subscriberId: designated.nodeId)`, `persistTrading(nodeId: designated.nodeId)`, and `boot` deriving the pull peer's origin from `config.till.nodeId`. R3a flips all three to the two-distinct-ids model: **own identity** = `config.till.nodeId` (the cloud's own), **mirrored origin** = a new `mirror_config.origin_node_id` (the primary's). The cloud's own `nodes`/`registro_sif`/`invoice_series` rows (R2) key to the own id, and its own node row carries the same `location_id`/modules as the primary's, so every read that resolves via `cfg.nodeId` still resolves correctly.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (PGlite hermetic + real Postgres via Testcontainers for the RLS/e2e suites), Drizzle ORM, hand-written custom migration (drizzle-kit models no grants and `mirror_config` is out of the schema barrel).

**Spec:** `docs/superpowers/specs/2026-09-04-membership-promotion-r3-cloud-promotion-design.md` — this plan implements **§3 (R3a)** only. R3b (promotion) is a later plan off the same doc.

## Global Constraints

- **No backwards-compat / data-migration code** (CLAUDE.md §3) — pre-production. `mirror_config` is empty on any real DB (written only at adopt; no R2-adopted mirror exists in production), so an `ADD COLUMN … NOT NULL` with no default is safe on every database (primary DBs carry the table empty too).
- **`mirror_config` is a whole-DB singleton, NO tenant_id, NO RLS** (like `deployment`) and is **kept out of the schema barrel** (`schema/index.ts`) — its migrations are **hand-written custom** (`drizzle-kit generate --custom`), never plain `db:generate`. Add the column to BOTH the Drizzle schema object (`schema/mirror-config.ts`, used by `writeMirrorConfig`'s `.insert`) AND a hand-written custom migration. Do NOT run plain `db:generate` (it does not see this table and could later emit a duplicate `CREATE TABLE`).
- **`app_user` holds SELECT-only on `mirror_config`; writes are owner-role.** Adding a column changes no grant. `readMirrorConfig` runs as `app_user` at boot; `writeMirrorConfig` runs owner-role at adopt.
- **The identity flip is ONE atomic change** — the token's subscriber (primary side) must equal the mirror's `config.till.nodeId` (subscriber), and the pull peer's origin must be the primary's id. Task 2 lands all of it together; a partial flip breaks the pull. (This is why Task 2 is one task, not three.)
- **Fiscal invariants untouched:** R3a writes `mirror_config` + `trading.env` only. No fiscal table, no `deployment`, no chain. The mirror still does not sell.
- **Error codes name the domain concept**; every throwing file imports `import "./errors.js"`. R3a adds no new error codes.
- **Migration numbering (memory `drizzle-migration-rebase-collision`):** the new custom migration is the next number after the latest `packages/db/drizzle/*.sql` (0099 at plan time → **0100**; re-check on execution and renumber if `main` moved). Append its journal entry the way `--custom` does (or hand-append consistently with 0072's entry).
- **Gate before each commit:** `pnpm lint && pnpm typecheck && pnpm format:check`, and the touched package's `test:coverage` (not bare `test`) — thresholds `98/98/98/95` for `@waitron/db`, `@waitron/server`. Real-PG/e2e suites need `TESTCONTAINERS_RYUK_DISABLED=true`.

---

## File structure

- `packages/db/src/schema/mirror-config.ts` (modify) — add `originNodeId` column. `packages/db/drizzle/0100_*.sql` (create, hand-written custom) — the ALTER + journal. `packages/db/src/mirror-config.ts` (modify) — `MirrorConnection.originNodeId` + both accessors. `packages/db/src/mirror-config.test.ts` (create/extend).
- `apps/server/src/mirror-bundle.ts` (modify) — `enrolPeer(subscriberId: deps.standby.nodeId)`.
- `apps/server/src/adopt.ts` (modify) — `persistTrading(nodeId: standby.nodeId)`; `writeMirrorConfig({ …, originNodeId: designated.nodeId })`.
- `apps/server/src/boot.ts` (modify) — `mirrorPeer.nodeId = loaded.originNodeId`; rewrite the "subscriber==origin==adopted node" comment (boot.ts:1073-1078, 1099).
- Tests updated: `apps/server/src/{adopt.rls,adopt-e2e.rls,mirror-bundle.rls,mirror-bundle-api.rls,mirror-e2e.rls}.test.ts` (+ `boot.mirror.rls` if present) — the R2/C2b assertions that pin the enrolment id / persisted node id / peer origin.

---

### Task 1: `mirror_config.origin_node_id` — the mirrored-origin home (`@waitron/db`)

**Files:**
- Modify: `packages/db/src/schema/mirror-config.ts`
- Create: `packages/db/drizzle/0100_mirror_config_origin_node.sql` (+ journal entry) — hand-written custom
- Modify: `packages/db/src/mirror-config.ts`
- Test: `packages/db/src/mirror-config.test.ts` (extend or create)

**Interfaces:**
- Produces: `MirrorConnection` gains `originNodeId: string`; `writeMirrorConfig(db, cfg)` writes it; `readMirrorConfig(db)` returns it (or `null` for an absent/empty table, unchanged).

- [ ] **Step 1: add the schema column**

In `packages/db/src/schema/mirror-config.ts`, add to the `mirrorConfig` pgTable columns (after `boxCaPem`, before `adoptedAt`), importing `uuid` from `drizzle-orm/pg-core`:

```ts
    // The nodeId of the PRIMARY this mirror pulls from — its sync ORIGIN, distinct from this node's
    // OWN identity (config.till.nodeId). Split out here (membership R3a) so the mirror can run under its
    // own id as SUBSCRIBER while still applying the primary's rows (origin = this value). Written
    // owner-role at adopt = designated.nodeId (the primary's). NOT NULL: every mirror has exactly one
    // origin; the table is empty until adopt, so the ADD COLUMN NOT NULL is safe pre-production.
    originNodeId: uuid("origin_node_id").notNull(),
```

- [ ] **Step 2: write the custom migration**

Create `packages/db/drizzle/0100_mirror_config_origin_node.sql` (mirror 0072's hand-written-custom style — a comment, then the DDL; no grant change needed since the table-level `GRANT SELECT` already covers the new column):

```sql
-- Custom migration (mirror_config is out of the schema barrel; drizzle-kit never diffs it). Add the
-- mirror's sync ORIGIN nodeId (the primary it pulls from), distinct from its OWN identity
-- (config.till.nodeId). Membership R3a: the cloud runs as its own node from adopt. NOT NULL is safe —
-- mirror_config is empty until an adopt writes it (a primary carries the table empty too).
ALTER TABLE "mirror_config" ADD COLUMN "origin_node_id" uuid NOT NULL;
```

Append the journal entry to `packages/db/drizzle/meta/_journal.json` in the same shape drizzle-kit uses (idx 100, tag `0100_mirror_config_origin_node`, `breakpoints: true`) — copy the newest existing entry's shape exactly and bump `idx`/`when`/`tag`. Do NOT run `db:generate` (plain) — `mirror_config` is out of the barrel; if you need a snapshot, `db:generate:custom` produced this scaffold. Verify `pnpm --filter @waitron/db exec drizzle-kit up` is not needed; the migration runner applies `*.sql` in order.

- [ ] **Step 3: thread it through the accessors + write the failing test**

In `packages/db/src/mirror-config.ts`: add `originNodeId: string;` to `MirrorConnection`; add `originNodeId: cfg.originNodeId` to both the `.values({…})` and the `onConflictDoUpdate` `set` of `writeMirrorConfig`; add `origin_node_id: string` to the `readMirrorConfig` row select + `originNodeId: row.origin_node_id` to its return.

Test (extend `mirror-config.test.ts`, or create it mirroring a sibling db accessor test — real-PG or PGlite with `CORE_MIGRATIONS`; read a sibling first):

```ts
it("round-trips originNodeId through write/read", async () => {
  const cfg = { relayUrl: "https://relay:1/", boxHostname: "box", boxCaPem: "PEM", originNodeId: PRIMARY_NODE };
  await writeMirrorConfig(ownerDb, cfg);
  const back = await readMirrorConfig(appDb);
  expect(back).toEqual(cfg);
});
```

- [ ] **Step 4: run + gate**

Run: `pnpm --filter @waitron/db test mirror-config` (RED first if you write the test before the accessor change), then `pnpm --filter @waitron/db test:coverage`, then `pnpm lint && pnpm typecheck && pnpm format:check`. Also `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (a column on a whole-DB no-RLS table must NOT appear in the tenant-scoped FORCE-RLS scan — confirm still green).

- [ ] **Step 5: commit**

```bash
git add packages/db/src/schema/mirror-config.ts packages/db/drizzle/0100_mirror_config_origin_node.sql packages/db/drizzle/meta/_journal.json packages/db/src/mirror-config.ts packages/db/src/mirror-config.test.ts
git commit -s -m "feat(db): mirror_config.origin_node_id — the mirror's sync origin, split from its own id"
```

---

### Task 2: flip the mirror to its own identity (atomic wiring) (`apps/server`)

**Files:**
- Modify: `apps/server/src/mirror-bundle.ts` (enrolPeer subscriber → the cloud's own id)
- Modify: `apps/server/src/adopt.ts` (persist own id as nodeId; persist primary's id as originNodeId)
- Modify: `apps/server/src/boot.ts` (pull peer origin ← `mirror_config.origin_node_id`; retire the shared-id comment)
- Modify tests: `apps/server/src/{adopt.rls,adopt-e2e.rls,mirror-bundle.rls,mirror-bundle-api.rls,mirror-e2e.rls}.test.ts` (+ `boot.mirror.rls` if present)

**Interfaces:**
- Consumes: `MirrorConnection.originNodeId` (Task 1); `deps.standby.nodeId` (already in `AssembleDeps`/adopt from R2); `readMirrorConfig`/`writeMirrorConfig`.
- Produces: no new exported signatures — a behaviour change to the three wiring points + `writeMirrorConfig`'s call site now passing `originNodeId`.

**Why one task:** the token's enrolled subscriber (mirror-bundle), the mirror's `config.till.nodeId` (adopt→persistTrading), and the pull peer's origin (boot) must change together — any one alone breaks the pull (subscriber≠token, or origin=own-id-with-no-rows). The headline `adopt-e2e.rls` (real HTTP round-trip: adopt → reboot as mirror → pull → serve read-only) is the guard that this is coherent.

- [ ] **Step 1: write/adjust the failing e2e expectation first**

In `apps/server/src/adopt-e2e.rls.test.ts` (the headline e2e), after the mirror reboots into mirror mode, add/adjust assertions to pin the split (RED until the wiring lands):
- `config.till.nodeId` on the mirror is the **standby's own** nodeId (the one the mirror generated), NOT `designated.nodeId`.
- `mirror_config.origin_node_id` equals `designated.nodeId` (the primary's).
- the pull still works and the mirror still **serves read-only** (writes → 403 `node.read_only`) AND a read-through that resolves via `cfg.nodeId` (e.g. the report/venue-clock path, or whatever the e2e already reads) still returns the venue's data — proving the cloud's own node row resolves the same location. Keep every existing read-only/pull assertion.

Run: `pnpm --filter @waitron/server test adopt-e2e` → expect RED on the new nodeId/origin assertions.

- [ ] **Step 2: primary — enrol the token for the cloud's own id**

In `apps/server/src/mirror-bundle.ts`, change `enrolPeer(deps.retentionDb, { subscriberId: deps.designated.nodeId, name: "cloud mirror" })` to `subscriberId: deps.standby.nodeId`. Update the doc comment ("The token's subscriber is the … node id") to say the **standby's own** id. Update `mirror-bundle.rls.test.ts` / `mirror-bundle-api.rls.test.ts` assertions that pin the enrolled subscriber (find them — the token/subscriber checks).

- [ ] **Step 3: mirror — persist the two ids to their two homes**

In `apps/server/src/adopt.ts`, in `adoptFromPrimary`:
- `writeMirrorConfig(deps.ownerDb, { relayUrl: bundle.relayUrl, boxHostname: bundle.boxHostname, boxCaPem: bundle.boxCaPem, originNodeId: designated.nodeId })` — add `originNodeId` (the primary's).
- `deps.persistTrading({ …, nodeId: standby.nodeId, … })` — change `nodeId` from `designated.nodeId` to `standby.nodeId` (the cloud's own; `standby` is already generated earlier in this function for R2). Leave `tenantId`/`locationId`/`tillId`/`seriesId` as `designated.*` (shared venue / inert-on-mirror; `seriesId` is corrected to the cloud's own reserved series at R3b). Update the doc comment on the persist to note nodeId is now the mirror's OWN id.
- Update `adopt.rls.test.ts`: the persisted-trading assertion now expects `nodeId: standby.nodeId`; the `writeMirrorConfig`/`readMirrorConfig` assertion now includes `originNodeId: designated.nodeId`.

- [ ] **Step 4: boot — derive the pull origin from mirror_config; retire the shared-id assumption**

In `apps/server/src/boot.ts`:
- line ~1099: `mirrorPeer = { nodeId: loaded.originNodeId, url: loaded.relayUrl, token }` — the pull peer's origin is the PRIMARY's id (from `mirror_config`), not `config.till.nodeId`. (`loaded` is `readMirrorConfig(db)`; it now carries `originNodeId`.)
- `subscriberId: till.nodeId` (line ~1173) is unchanged in code — its *value* is now the cloud's own id, which is correct.
- Rewrite the comment block (~1073-1078): the subscriber (`config.till.nodeId`, the cloud's OWN id) and the origin it pulls (`mirror_config.origin_node_id`, the primary's) are now **distinct** — describe the split and why (membership R3a; the cursor is `(subscriber=own, origin=primary, lane)`). Remove the "same adopted node" claim.
- Update `mirror-e2e.rls.test.ts` (which seeds `mirror_config` "the way adoptFromPrimary would") to seed `originNodeId` too and to run the mirror under its own subscriber id; update any `boot.mirror.rls` assertions on the peer/subscriber id.

- [ ] **Step 5: verify the read-through risk, then run the full gate**

Grep every consumer of `cfg.nodeId` / `config.till.nodeId` on the mirror's read paths (`report-api.ts`, `recipe-api.ts`, `box-status.ts`, `me-api.ts`, `till-api.ts`, the mounts in `boot.ts`). Confirm each either (a) resolves via the node row for its **location** (works — the cloud's own node row shares the primary's `location_id` + modules, set by R2) or (b) does not filter replicated data by `node_id = cfg.nodeId`. Note the finding in the report. `report-api.ts:166` states the sales aggregation ignores `cfg.nodeId`; confirm that holds and that `resolveVenueClock`/location resolution (report-api.ts:124/153) find the cloud's own node. If any read filters replicated **data** by `cfg.nodeId`, STOP and surface it — that read must use the origin id instead, which is a design amendment, not a mechanical fix.

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (all green, incl. the adopt-e2e now GREEN on the new assertions), then `pnpm lint && pnpm typecheck && pnpm format:check`.

- [ ] **Step 6: commit**

```bash
git add apps/server/src/mirror-bundle.ts apps/server/src/adopt.ts apps/server/src/boot.ts apps/server/src/adopt.rls.test.ts apps/server/src/adopt-e2e.rls.test.ts apps/server/src/mirror-bundle.rls.test.ts apps/server/src/mirror-bundle-api.rls.test.ts apps/server/src/mirror-e2e.rls.test.ts
git commit -s -m "feat(server): mirror runs as its own node from adopt (subscriber=own id, origin=primary)"
```

---

## Self-review

**Spec coverage (§3 R3a — the four cuts):**
- "`mirror_config` gains `origin_node_id`" → Task 1.
- "`assembleMirrorBundle` enrols the peer token for the cloud's own id" → Task 2 Step 2.
- "`adoptFromPrimary` persists own id as nodeId, primary's id as originNodeId" → Task 2 Step 3.
- "`boot` derives the two ids from their two homes; retire the shared-id assumption" → Task 2 Step 4.
- "the read-only serving path resolves data by tenant, never by config.till.nodeId (verify)" → Task 2 Step 5 (the explicit risk verification + the e2e read-through guard).

**Placeholder scan:** the only abstracted items are test-fixture names (`PRIMARY_NODE`, `ownerDb`/`appDb`, the e2e's existing read assertion) — flagged to reuse each suite's existing setup. Every production edit is concrete (exact call-site changes + the migration SQL).

**Type consistency:** `MirrorConnection.originNodeId: string` (Task 1) matches `writeMirrorConfig`'s new call-site arg in adopt (Task 2 Step 3) and `boot`'s `loaded.originNodeId` read (Task 2 Step 4). `enrolPeer`'s `subscriberId` is a string in both the old (`designated.nodeId`) and new (`standby.nodeId`) forms.

**Out of scope (R3b / later):** the mode/role flip, the endorsed term-guarded promotion document, activating the SIF, `config.till.seriesId` correction to the cloud's own reserved series, the primary-only worker start, and the till-side reroute. R3a leaves the box a read-only mirror running under its own identity.
