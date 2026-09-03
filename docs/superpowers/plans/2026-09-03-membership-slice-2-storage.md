# Membership Slice 2 — Storage (`node_membership` singleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the membership document from Slice 1 in a whole-DB operational singleton `node_membership`, with read/write accessors on `@waitron/db`, mirroring the `mirror_config` singleton exactly. This is storage only — the two-part accept fence stays in `@waitron/membership` (`acceptMembershipDocument`), invoked by the Slice-3 adoption path, not here.

> **Reconciled 2026-09-03 (simplify pass, commit `13f5d852`):** the `document` column shipped as
> **`jsonb`**, not the `text` this plan first specified — it matches the package's convention for
> structured document columns (`catalogue`/`incidents`/`layouts`/…), lets the driver parse on read
> and Drizzle serialise on write (no hand-rolled `JSON.parse`/`stringify`), and is safe because
> verification recomputes `canonicalize(body)` from the parsed object (no byte-preservation need).
> The code/SQL blocks below have been updated to `jsonb`; follow them, not any lingering `text`.

**Architecture:** A new singleton table `node_membership` (`id = 1`; `term bigint`, `document jsonb`, `updated_at`) — **no `tenant_id`, no RLS**, like `mirror_config`/`deployment`/`sync_cursor` (whole-DB state, out of the fiscal FORCE-RLS scan by construction). Created by a hand-written custom migration that also `GRANT SELECT ... TO app_user` (a node reads the held document on the app pool at boot; writes are owner-role only). The table is deliberately **kept out of `schema/index.ts`** for the same reason `mirror-config.ts`/`deployment.ts` are (a `--custom` migration drizzle-kit never diffed into a snapshot). Two accessors on `@waitron/db`: `readNodeMembership` (`to_regclass` probe → `SignedMembershipDocument | null`) and `writeNodeMembership` (plain owner-role upsert of the `id = 1` row). `@waitron/db` takes a **type-only** dependency on the leaf `@waitron/membership` for the `SignedMembershipDocument` type — no runtime import, so no cycle and no membership error-registry load in `db`.

**Tech stack:** TypeScript (ESM), Drizzle (`pgTable`, hand-written custom SQL migration), Vitest (PGlite for the accessor round-trip; real Postgres via `useTemplateDb` for the grant read-back), `@waitron/membership` (types only).

**Spec:** `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` §3 ("Storage") — *"a new whole-DB singleton `node_membership` (`id = 1`; columns `term bigint`, `document`, `updated_at`) — mirroring the `mirror_config` singleton pattern: no `tenant_id`, no RLS … The signature is over the canonical whole document, so it is stored and moved as one unit — not a per-row synced table."* This plan implements only that storage boundary; distribution (§5), promotion-mints (§8), rejoin (§6) and conflict surface (§7) are later slices.

## Global constraints

- **Mirror `mirror_config` exactly** (owner decision, 2026-09-03): `GRANT SELECT ON node_membership TO app_user` and nothing more; `writeNodeMembership` runs owner-role, exercised under the owner/admin connection in tests. The runtime-adoption write grant (`app_user` INSERT/UPDATE) is **deferred to Slice 3**, when the gossip-adoption writer exists and its role is known. Do **not** widen the grant here (CLAUDE.md §3: "grants are deliberate", "never widen a grant to make a test pass").
- **Plain-upsert dumb setter** (owner decision, 2026-09-03): `writeNodeMembership` just upserts; it does **not** run the accept test. The authentic-and-strictly-newer fence is `acceptMembershipDocument` in `@waitron/membership`, called by the Slice-3 caller before it persists.
- **`term` reconciliation** (backlog follow-up from #197): the Slice-1 document carries `term` as a JS `number`; the storage column is `bigint`. Resolve it by **deriving the `term` column from `document.body.term` on every write**, so a write through `writeNodeMembership` keeps the column and the in-blob term in step (a property of the accessor, not a DB-enforced constraint — a raw SQL write could set them apart). Read the term back from the parsed document (a `number`, safely below 2^53 for this ≤3-node topology — `term` increments by one per membership edit). Use Drizzle `bigint("term", { mode: "number" })`, the same mode `catalogues.version` uses.
- **No `tenant_id`, no RLS, out of the schema barrel** — exactly as `packages/db/src/schema/mirror-config.ts`. Adding it to `schema/index.ts` would make drizzle-kit aware of a table its snapshot chain never recorded and risk a duplicate `CREATE TABLE` on the next plain `drizzle-kit generate` (see the mirror-config header).
- **No backwards-compat / no data migration** (CLAUDE.md §3): pre-production, drop-and-recreate.
- **English-only**: `@waitron/db` is already in `GENERIC_PACKAGES`; `node_membership`/`term`/`document`/`updated_at` are English. No `english-only` list edit.
- **Coverage thresholds:** `98/98/98/95` (standard non-browser package config — `@waitron/db`'s existing config).

## File structure

```
packages/db/
  package.json                          # + "@waitron/membership": "workspace:*" dependency
  drizzle/0096_node_membership.sql       # custom migration: CREATE TABLE + singleton CHECK + GRANT SELECT
  drizzle/meta/_journal.json             # + the 0096 entry (written by db:generate:custom)
  src/
    schema/node-membership.ts            # pgTable, singleton CHECK, NOT re-exported from schema/index.ts
    node-membership.ts                   # readNodeMembership / writeNodeMembership accessors
    node-membership.test.ts              # PGlite round-trip + null semantics + singleton CHECK
    node-membership.rls.test.ts          # real-PG grant read-back (app_user SELECT-only)
    index.ts                             # + export the read/write accessors (NOT the table — mirror_config precedent)
```

No cross-package CI-list edits: `node_membership` lands in the existing `core` migration folder (`packages/migrations/migrations.manifest.json` lists folders, not tables — unchanged), and `@waitron/db` already has its own `test-heavy` shard.

---

## Task 1: Schema, migration, and the `@waitron/membership` dependency

**Files:**
- Create: `packages/db/src/schema/node-membership.ts`
- Create: `packages/db/drizzle/0096_node_membership.sql` (+ journal entry via `db:generate:custom`)
- Modify: `packages/db/package.json` (add `@waitron/membership` dep), `pnpm-lock.yaml`
- Test: `packages/db/src/node-membership.rls.test.ts` (grant read-back)

**Interfaces:**
- Produces: `nodeMembership` (the Drizzle table), and the migrated `node_membership` table with `GRANT SELECT` to `app_user`.

- [ ] **Step 1: Add the `@waitron/membership` dependency (type-only consumer)**

In `packages/db/package.json`, add to `dependencies` (alphabetical, beside `@waitron/shared`):
```json
"@waitron/membership": "workspace:*",
```
This is consumed **only** via `import type { SignedMembershipDocument }` in Task 2, so it never loads membership's runtime (no error-registry double-register, no cycle — membership depends on `@waitron/shared` alone).

- [ ] **Step 2: Write `src/schema/node-membership.ts`**

```ts
import { bigint, check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";

/**
 * The venue's current membership document (membership & rejoin wire-protocol, design §3). A whole-
 * database operational singleton — NO tenant_id, NO RLS — like `deployment`/`mirror_config`/
 * `sync_cursor`, so it is out of the fiscal `inmutabilidad` FORCE-RLS scan by construction (that scan
 * keys on the tenant_id column, which this table does not have).
 *
 * The signed document is stored as ONE unit (the `document` jsonb column holds the whole
 * `SignedMembershipDocument`), never a per-row synced table — a row-image would not carry a
 * signature over the node list (design §3). `jsonb` follows the package's convention for structured
 * document columns; the driver parses it on read and Drizzle serialises it on write. `term` is
 * denormalised into its own bigint column from `document.body.term` so ordering/superseding can be
 * read without parsing the blob. `writeNodeMembership` derives the column from the blob on every
 * write, so a write through that accessor keeps the two in step — a property of the accessor, not a
 * DB constraint (a raw SQL write could set them apart).
 *
 * Deliberately NOT re-exported from `./schema/index.ts` (which `drizzle.config.ts` reads and
 * `client.ts` derives `Schema` from), for the same reason `mirror-config.ts`/`deployment.ts` are:
 * `0096_node_membership.sql` is a hand-written custom migration, so drizzle-kit never diffed this
 * table into any snapshot. Adding it to the barrel would risk a duplicate `CREATE TABLE` on the next
 * plain `drizzle-kit generate`. The accessors are exported from the package barrel (`../index.ts`,
 * via `../node-membership.ts`); that surface is unaffected.
 */
export const nodeMembership = pgTable(
  "node_membership",
  {
    id: integer("id").primaryKey().notNull().default(1),
    // JS `number` (mode) reconciles the Slice-1 document's `number` term with the bigint column; the
    // ≤3-node topology increments `term` by one per edit, so it never approaches 2^53.
    term: bigint("term", { mode: "number" }).notNull(),
    document: jsonb("document").$type<SignedMembershipDocument>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("node_membership_singleton_ck", sql`${t.id} = 1`)],
);
```

- [ ] **Step 3: Generate the custom migration shell, then hand-write it**

Run: `pnpm --filter @waitron/db db:generate:custom --name node_membership`
This appends an empty `packages/db/drizzle/0096_node_membership.sql` and its `_journal.json` entry (drizzle-kit never diffs `node_membership` — it is not in the schema barrel — so the generated file is the empty custom template). Confirm the number against the current journal tail; if `db:generate:custom` picks a different number because another migration landed first, use that number and keep the `_node_membership` suffix. (It landed as **0096** on rebase — #199 added `0088`–`0095` on `main` in the meantime, the Drizzle migration-number collision: reset `drizzle/` to `main`, keep the schema TS, regenerate the custom migration at the next free number.)

Then write the SQL body (mirror `0072_mirror_config.sql`):
```sql
-- Custom migration (drizzle-kit models no grants). The venue's current membership document — an
-- operational whole-database singleton like `deployment`/`mirror_config`/`sync_cursor`: NO tenant_id,
-- NO RLS, out of the fiscal inmutabilidad FORCE-RLS scan by construction. `document` (jsonb) holds
-- the whole signed SignedMembershipDocument (design §3); `term` is denormalised from document.body.term
-- for ordering. GRANT SELECT to app_user (a node reads the held document on the app pool at boot);
-- writes are owner-role only. The runtime-adoption write grant is deferred to membership Slice 3.
CREATE TABLE "node_membership" (
	"id" integer PRIMARY KEY NOT NULL DEFAULT 1,
	"term" bigint NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_membership_singleton_ck" CHECK ("node_membership"."id" = 1)
);
--> statement-breakpoint
GRANT SELECT ON "node_membership" TO app_user;
```

- [ ] **Step 4: Write the failing grant read-back test `src/node-membership.rls.test.ts`**

Mirror `mirror-config.rls.test.ts` verbatim in shape (real Postgres, `useTemplateDb({ template: "core" })`, `has_table_privilege` read both directions):
```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "./testing/lifecycle.js";

// Real Postgres, not PGlite: this asserts the object-privilege GRANT on `node_membership` (CLAUDE.md
// §3 — the command tag lies, so the ACL is read back BOTH directions). PGlite runs every connection
// as a superuser and would answer these probes the same regardless of the real grant, so a PGlite
// pass would be a false pass. `node_membership` carries no tenant_id and no RLS, so there is no
// policy to exercise; the grant is the one thing real Postgres is needed for here.
describe("node_membership grants", () => {
  const suite = useTemplateDb({ template: "core" });

  it("app_user holds SELECT on node_membership and NOT INSERT/UPDATE/DELETE (owner-only write)", async () => {
    // app_user MUST hold SELECT (a node reads the held document on the app pool at boot) and MUST NOT
    // hold any write — the document is written owner-role only until Slice 3 adds runtime adoption.
    const rows = await suite.admin.execute<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(sql`
      select
        has_table_privilege('app_user', 'node_membership', 'SELECT') as sel,
        has_table_privilege('app_user', 'node_membership', 'INSERT') as ins,
        has_table_privilege('app_user', 'node_membership', 'UPDATE') as upd,
        has_table_privilege('app_user', 'node_membership', 'DELETE') as del
    `);
    expect(rows.rows[0]).toEqual({ sel: true, ins: false, upd: false, del: false });
  });
});
```

- [ ] **Step 5: Run it, verify red→green**

The `core` template is rebuilt from the migration folder, so the new 0096 is included. Run:
```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test node-membership.rls
```
Expected: PASS once the migration + grant are in place. (If run before Step 3's SQL body is written, it fails on the missing table — the fail-first signal.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/node-membership.ts packages/db/drizzle/0096_node_membership.sql \
        packages/db/drizzle/meta/_journal.json packages/db/src/node-membership.rls.test.ts \
        packages/db/package.json pnpm-lock.yaml
git commit -s -m "feat(membership): node_membership singleton table + app_user SELECT grant"
```

---

## Task 2: Accessors (`readNodeMembership` / `writeNodeMembership`) + round-trip tests

**Files:**
- Create: `packages/db/src/node-membership.ts`
- Test: `packages/db/src/node-membership.test.ts` (PGlite)
- Modify: `packages/db/src/index.ts` (export table + accessors)

**Interfaces:**
- Consumes: `nodeMembership` (Task 1); `SignedMembershipDocument` (`@waitron/membership`, type-only).
- Produces:
  - `readNodeMembership(db: Database): Promise<SignedMembershipDocument | null>`
  - `writeNodeMembership(db: Database, document: SignedMembershipDocument): Promise<void>`

- [ ] **Step 1: Write the failing accessor test `src/node-membership.test.ts`** (mirror `mirror-config.test.ts`)

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { createPgliteDb } from "./client.js";
import { readNodeMembership, writeNodeMembership } from "./node-membership.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError } from "./testing/errors.js";
import { usePgliteDb } from "./testing/lifecycle.js";

// PGlite, not real Postgres: the accessor round-trip is pure SQL logic (upsert/read of a singleton),
// with no privilege or RLS behaviour to observe. The grant read-back PGlite cannot show
// authoritatively lives in node-membership.rls.test.ts.

function doc(term: number, signerNodeId = "server-1"): SignedMembershipDocument {
  return {
    body: {
      term,
      nodes: [{ nodeId: "server-1", contactUrl: "https://s1", standing: "serving-primary" }],
    },
    signerNodeId,
    signature: `sig-${term}`,
    endorsements: [],
  };
}

describe("node_membership accessors", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  it("reads null before any write (a node that has never adopted a document)", async () => {
    expect(await readNodeMembership(pg.db)).toBeNull();
  });

  it("reads null when the table itself is absent (a pre-migration handle)", async () => {
    // A bare, unmigrated PGlite: node_membership does not exist yet, so the `to_regclass` probe must
    // answer "absent" rather than throw — the exact state of a node that never ran 0096.
    const bare = await createPgliteDb();
    expect(await readNodeMembership(bare)).toBeNull();
    await bare.close();
  });

  it("upserts the singleton and reads back the whole document", async () => {
    const d = doc(3);
    await writeNodeMembership(pg.db, d);
    expect(await readNodeMembership(pg.db)).toEqual(d);
  });

  it("denormalises term from document.body.term into the bigint column", async () => {
    await writeNodeMembership(pg.db, doc(7));
    const r = await pg.db.execute<{ term: string }>(sql`select term from node_membership where id = 1`);
    expect(Number(r.rows[0]?.term)).toBe(7);
  });

  it("is a singleton — a second write updates the row in place, never inserts a second", async () => {
    await writeNodeMembership(pg.db, doc(1));
    await writeNodeMembership(pg.db, doc(2));
    const count = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int as n from node_membership`,
    );
    expect(count.rows[0]?.n).toBe(1);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(2);
  });

  it("is a plain setter — it does NOT enforce monotonicity (that is acceptMembershipDocument's job)", async () => {
    // Storage is dumb (design §3 / owner decision): the authentic-and-strictly-newer fence lives in
    // @waitron/membership's acceptMembershipDocument, called by the Slice-3 adoption path BEFORE it
    // persists. A lower term written directly here simply overwrites — proving the fence is not here.
    await writeNodeMembership(pg.db, doc(5));
    await writeNodeMembership(pg.db, doc(2));
    expect((await readNodeMembership(pg.db))?.body.term).toBe(2);
  });

  it("permits at most one row — the singleton CHECK rejects any id but 1", async () => {
    const error = await captureError(() =>
      pg.db.execute(
        sql`insert into node_membership (id, term, document) values (2, 1, '{}')`,
      ),
    );
    expect(error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @waitron/db test node-membership.test`
Expected: FAIL — `node-membership.js` not defined.

- [ ] **Step 3: Write `src/node-membership.ts`** (mirror `mirror-config.ts`)

```ts
import { sql } from "drizzle-orm";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { Database } from "./client.js";
import { nodeMembership } from "./schema/node-membership.js";

/**
 * The held membership document (design §3/§5), or `null` when the table/row is absent — a node that
 * has never adopted a document (unstamped database) or a pre-migration handle. `null` covers BOTH
 * "the table does not exist yet" and "the table is empty", and callers must not tell them apart:
 * both mean nothing has recorded who is currently in charge.
 *
 * Returns the document WHOLE and unverified — the caller re-runs `verifyMembershipDocument` /
 * `acceptMembershipDocument` (@waitron/membership) against it; this layer is storage, not the fence.
 *
 * Uses `to_regclass` rather than catching an undefined-table error, exactly as `readMirrorConfig`/
 * `readDeploymentMode` do: a failed statement aborts the enclosing transaction in PostgreSQL, so
 * probing by failure would poison a transaction the caller may still need.
 */
export async function readNodeMembership(db: Database): Promise<SignedMembershipDocument | null> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.node_membership') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return null;

  const rows = await db.execute<{ document: SignedMembershipDocument }>(
    sql`select document from node_membership where id = 1`,
  );
  const row = rows.rows[0];
  if (row === undefined) return null;
  // `document` is a jsonb column, so the driver hands it back already parsed. Structural validity is
  // the caller's verify step, not ours.
  return row.document;
}

/**
 * Owner-role UPSERT of the singleton (`id = 1`). A PLAIN setter — it does NOT run the accept test
 * (owner decision, 2026-09-03): the authentic-and-strictly-newer fence is `acceptMembershipDocument`
 * in @waitron/membership, called by the Slice-3 adoption path before it persists here.
 *
 * `term` is denormalised from `document.body.term` (the backlog #197 reconciliation of the Slice-1
 * `number` term with this bigint column). Deriving it here keeps the column and the in-blob term in
 * step for writes through this accessor; the DB does not enforce it, so a raw SQL write could set
 * them apart.
 * `app_user` holds no INSERT/UPDATE on `node_membership` (the grant read-back asserts it), so this
 * runs on the provisioning/owner connection, never the app pool — until Slice 3 adds runtime
 * adoption and, with it, the write grant.
 */
export async function writeNodeMembership(
  db: Database,
  document: SignedMembershipDocument,
): Promise<void> {
  const term = document.body.term;
  await db
    .insert(nodeMembership)
    .values({ id: 1, term, document })
    .onConflictDoUpdate({
      target: nodeMembership.id,
      set: { term, document, updatedAt: sql`now()` },
    });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @waitron/db test node-membership.test`
Expected: PASS.

- [ ] **Step 5: Export from the barrel**

Add to `packages/db/src/index.ts` (beside the `mirror-config` exports at ~line 84) — the accessors
ONLY, not the `nodeMembership` table (the simplify pass dropped the table export to match the
`mirror_config` precedent, which exports only its accessors; the accessor imports the table directly
from `./schema/node-membership.js`, and nothing outside the package needs it):
```ts
export { readNodeMembership, writeNodeMembership } from "./node-membership.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/node-membership.ts packages/db/src/node-membership.test.ts packages/db/src/index.ts
git commit -s -m "feat(membership): readNodeMembership/writeNodeMembership singleton accessors"
```

---

## Task 3: Package gate + whole-workspace guards

**Files:** none (verification only).

- [ ] **Step 1: `@waitron/db` full coverage gate**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
```
Expected: PASS, all four thresholds ≥ (98/98/98/95). Run UNFILTERED within the package (not a name-filtered subset) so the cross-cutting `@waitron/db` guard suites load — the `inmutabilidad`/`english-only`/teardown/reachability guards (CLAUDE.md §2 "a filtered test run does not load a package's guard suites"). `node_membership` has no `tenant_id`, so the `inmutabilidad` FORCE-RLS scan does not cover it — that is correct and expected, not a gap.

- [ ] **Step 2: Root guards + fiscal isolation guard**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
pnpm vitest run scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/guarded-teardowns.test.ts
```
Expected: PASS. The fiscal `inmutabilidad` suite scans every `tenant_id`-bearing table for FORCE RLS; `node_membership` has none, so it is out of scope by construction (this is the deliberate design, mirroring `mirror_config`). The root guards confirm no pinned list went stale.

- [ ] **Step 3: `@waitron/membership` still green (dependency direction sanity)**

```
pnpm --filter @waitron/membership test:coverage
```
Expected: PASS — `@waitron/db` now depends on it, but the dependency is type-only and does not touch membership's own surface.

---

## Self-review notes (author)

- **Spec coverage:** §3 storage (`node_membership` singleton, `term`/`document`/`updated_at`, no tenant_id/no RLS, mirror `mirror_config`, whole-document-as-one-unit) → Tasks 1–2. §4–§8 (trust, distribution, rejoin, conflict, promotion) are **out of scope** — later slices. The Slice-1 accept fence is deliberately NOT duplicated in storage (owner decision: plain-upsert setter).
- **Grant discipline (CLAUDE.md §3):** SELECT-only to `app_user`, read back both directions on real Postgres (Task 1 Step 4); INSERT/UPDATE/DELETE asserted absent. The runtime-adoption write grant is deferred to Slice 3 by owner decision — do not widen here.
- **`term` reconciliation (#197 follow-up):** resolved by deriving the bigint column from `document.body.term` on write (Task 2 Step 3), pinned by the denormalisation test (Task 2 Step 1). `mode: "number"` is safe for this ≤3-node, one-increment-per-edit topology.
- **Barrel/snapshot trap:** `node-membership.ts` schema is kept out of `schema/index.ts` (like `mirror-config.ts`), so drizzle-kit never diffs it and cannot emit a duplicate `CREATE TABLE`. The migration is hand-written `--custom`.
- **CI-list traps (CLAUDE.md §2):** no cross-package list edits — the migration joins the existing `core` folder (manifest lists folders, unchanged), `@waitron/db` already owns its `test-heavy` shard, and `db` is already in `GENERIC_PACKAGES`. Task 3 runs the package UNFILTERED + the root guards so no cross-cutting suite is skipped and no pinned list is left stale. Before the PR, run the whole workspace (`pnpm -r test:coverage`, RAM permitting — see memory) so any dependent of `@waitron/db` that the new `@waitron/membership` edge touches is covered.
