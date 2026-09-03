# Membership Slice 4 — setup/adopt trust establishment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Slice-3 adoption mechanism *live* by giving each node an Ed25519 identity at setup — a keypair whose private half is sealed in the box vault and whose public half rides on `nodes.public_key` — and populating boot's `membershipTrustSet` from a real read of that column, replacing the empty `{}` seam. A fresh primary trusts itself; a cloud mirror trusts the primary through the node row `adoptVenue` already replicates. Adoption is inert no longer.

**Architecture:** Four seams, each following an existing pattern.
1. **Schema** — a new nullable `nodes.public_key` `text` column (a *generated* Drizzle migration, not custom — it is a real modelled column) + two `@waitron/db` accessors: `setNodePublicKey` (owner-role UPDATE) and `readMembershipTrustSet` (app-role SELECT → `TrustSet`).
2. **Vault** — a new `PURPOSES` entry `membership.node_key` (`["privateKey"]`), sealed under the box key exactly like `sync.mirror_token`.
3. **Identity** — a new `apps/server/src/node-identity.ts`: `establishNodeIdentity` generates a keypair, seals the private key (`putCredential`), and stamps `nodes.public_key`; `readNodeIdentityKey` is its inverse (the Slice-5 signer's entry point, exercised now by a round-trip). Wired into the fresh-primary provision handler beside the AEAT-cert seal.
4. **Boot** — `const membershipTrustSet: TrustSet = {}` becomes `await readMembershipTrustSet(localSyncDb, till.tenantId)`. The adopt path needs no code change; a test proves the mirror's trust set is `{primary}` after `adoptFromPrimary`.

**Tech Stack:** TypeScript (ESM), Drizzle (a modelled column via `db:generate`, `sql`/query-builder accessors), `@waitron/credentials` (`putCredential`/`getCredential`/`KeyRing`/`PURPOSES`), `@waitron/membership` (`generateNodeKeyPair`, `TrustSet`), Vitest (PGlite for the pure round-trip logic; real Postgres via `useTemplateDb`/`useRealPostgres` for the grant/RLS read-backs and the provision/adopt e2e), Hono (the `/setup-api/provision` handler).

**Spec:** `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` — **§4 ("Trust: node identity keys chained from setup")**, the setup half only. This plan implements trust-anchor establishment at setup + adopt and the live boot read; the **endorsement chain** (`endorseKey`, a distinct second-serving-box identity, primary-vouches-for-a-new-key) is **deferred** — it has no consumer until promotion (Slice 5) or an add-second-box slice, and the cloud mirror runs *as* the primary's nodeId and never signs. Slice 3 (distribution): `docs/superpowers/plans/2026-09-03-membership-slice-3-distribution.md`.

## Global Constraints

- **Owner decisions (2026-09-03, this brainstorm):**
  1. **Trust anchors only — defer endorsement.** Build setup self-trust + adopt trusts-primary + the live boot read. Do **not** build `endorseKey` wiring, a distinct cloud identity, or private-key *signing* use — those are Slice 5+. Named as deferred, not forgotten.
  2. **Public keys live on `nodes.public_key`.** The trust set is `SELECT id, public_key FROM nodes` (non-null rows). The mirror inherits the primary's anchor *for free* because `adoptVenue` copies the primary's node row verbatim — the adopt path gets **no** new code.
  3. **The private key reuses the credentials vault** — a new `PURPOSES` purpose sealed under the box key, the exact `sealMirrorToken`/`readMirrorToken` shape. No new sealing plumbing.
- **The cloud mirror seals no private key.** It runs as the primary's nodeId in `mode='mirror'` and never signs; only the *primary* (fresh-primary provision path) generates + seals a key. `establishNodeIdentity` is called on the provision path only, never on adopt.
- **`nodes` is tenant-scoped + FORCE-RLS** (`0017_nodes_rls.sql`). Every read/write of `public_key` runs under `withTenant` with the tenant GUC set — the owner is subject to FORCE RLS, so even `setNodePublicKey` needs it. `app_user` already holds **SELECT** on `nodes` (rides the read); it must **not** gain UPDATE (writes stay owner-role — CLAUDE.md §3, never widen a grant). A nullable column adds no policy, so the `inmutabilidad` FORCE-RLS scan stays green (`nodes` already forces RLS).
- **Nullable column, no backfill (CLAUDE.md §3):** pre-production, drop-and-recreate. `public_key` is `text` NULL — matching the `filing_module`/`tax_module` nullability precedent on the same table, which keeps the reshape off every bare-node fixture (`seedNode`, `seedNodesForSifContention`, `drain-fixtures`). `readMembershipTrustSet` filters nulls, so a keyless fixture node simply is not a trust anchor.
- **English-only:** `@waitron/db` and `@waitron/credentials` are in `GENERIC_PACKAGES`; `apps/server` is out of scope. New tokens (`public_key`, `membership`, `node_key`, `privateKey`, `publicKey`, `identity`, `trust`) are English. No `SPANISH_WORDS` edit.
- **Coverage thresholds:** `@waitron/db`, `@waitron/credentials`, `apps/server` are standard non-browser packages — `98/98/98/95`.
- **Migration numbering (memory — Drizzle rebase collision):** the column migration lands at the next free number after `0097_node_membership_write_grant.sql` (current tail), i.e. `0098`. It is a **generated** migration (`db:generate`, not `db:generate:custom`) because `public_key` is a modelled schema column. If a rebase over `main` bumps it, reset `drizzle/` to `main`, keep the schema TS, re-run `db:generate`, and re-verify RLS + `inmutabilidad`.
- **No cross-package pinned-list edits:** the migration joins the existing `core` folder (`migrations.manifest.json` lists folders, unchanged); the three packages own their existing CI shards (`test-heavy` = `@waitron/db`, `test-light-*` = `@waitron/credentials`, `test-server` = `apps/server`); `GENERIC_PACKAGES`/`OWN_SHARD_PACKAGES`/`migratedSets` are untouched.

## File Structure

```
packages/db/
  src/schema/nodes.ts               # + publicKey: text("public_key") (nullable)
  drizzle/0098_node_public_key.sql  # ALTER TABLE nodes ADD COLUMN public_key (db:generate)
  drizzle/meta/*                     # snapshot + journal entry (db:generate)
  src/node-identity.ts               # NEW: setNodePublicKey + readMembershipTrustSet accessors
  src/node-identity.test.ts          # PGlite: round-trip + null-filter
  src/node-identity.rls.test.ts      # real PG: app_user SELECT yes / UPDATE no on public_key
  src/index.ts                       # export setNodePublicKey, readMembershipTrustSet

packages/credentials/
  src/purposes.ts                    # + "membership.node_key": ["privateKey"]
  src/purposes.test.ts               # new purpose validates (present + reachable)

apps/server/
  src/node-identity.ts               # NEW: establishNodeIdentity + readNodeIdentityKey (vault + public_key)
  src/node-identity.test.ts          # PGlite: establish seals + stamps + reads back
  src/setup-api.ts                   # provision handler calls establishIdentity after provision()
  src/setup-api.ts (deps)            # SetupApiDeps += establishIdentity?
  src/setup-provision.e2e.test.ts    # (or extend setup-api test) provision → nodes.public_key set + trust={self}
  src/boot.ts                        # wire establishIdentity dep; replace the trust-set seam with the real read
  src/adopt.rls.test.ts              # + after adopt, readMembershipTrustSet(mirrorDb) === {primary}
```

---

## Task 1: `@waitron/db` — `nodes.public_key` column + trust-set accessors

**Files:**
- Modify: `packages/db/src/schema/nodes.ts`
- Create: `packages/db/drizzle/0098_node_public_key.sql` (+ snapshot/journal via `db:generate`)
- Create: `packages/db/src/node-identity.ts`, `packages/db/src/node-identity.test.ts`, `packages/db/src/node-identity.rls.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces:
  - `setNodePublicKey(db: Database, tenantId: string, nodeId: string, publicKey: string): Promise<void>` — owner-role UPDATE of `nodes.public_key`, under `withTenant` (nodes is FORCE-RLS). No-op-safe on a non-matching id (0 rows) — the caller passes a just-minted id, so a 0-row update would be a bug, but this accessor does not assert it (the provision path is the only caller and its id is fresh).
  - `readMembershipTrustSet(db: Database, tenantId: string): Promise<TrustSet>` — reads `{ id → public_key }` for every `nodes` row whose `public_key` is non-null, under `withTenant`, as the app role. `TrustSet` is `@waitron/membership`'s `Readonly<Record<string,string>>`.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema/nodes.ts`, add to the `pgTable("nodes", { … })` column map (after `taxModule`, before `createdAt`):
```ts
    // The node's Ed25519 identity PUBLIC key (base64 SPKI DER), the membership trust anchor (design
    // §4). Nullable like filing_module/tax_module above: pre-production, and bare-node fixtures carry
    // none — a keyless node is simply not a trust anchor (readMembershipTrustSet filters nulls). The
    // PRIVATE half is sealed in the vault (apps/server/node-identity.ts), never here. This column rides
    // adoptVenue's verbatim node-row copy, so a mirror inherits the primary's anchor with no bundle
    // change. Set owner-role at provision (setNodePublicKey); app_user holds SELECT only.
    publicKey: text("public_key"),
```
Confirm `text` is already imported at the top (it is — `import { … text … } from "drizzle-orm/pg-core"`).

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @waitron/db db:generate`
Expected: a new `drizzle/0098_node_public_key.sql` containing `ALTER TABLE "nodes" ADD COLUMN "public_key" text;`, plus a snapshot + `_journal.json` entry. Confirm the number is `0098` against the journal tail (`0097_node_membership_write_grant` is current). If a rebase over `main` bumped it, reset `drizzle/` to `main`, keep the schema TS, re-run `db:generate`.

- [ ] **Step 3: Write the failing accessor tests (PGlite)**

`packages/db/src/node-identity.test.ts` — reuse the package's PGlite lifecycle helper (`usePgliteDb` from `./testing/lifecycle.js`; open a sibling test, e.g. `node-membership.test.ts`, for the exact fixture + how a tenant/location/node are seeded). Seed a tenant + location + node (via the existing seed helpers — `seedNode`/`applyVenue`, whichever the sibling uses), then:
```ts
import { describe, expect, it } from "vitest";
import { setNodePublicKey, readMembershipTrustSet } from "./node-identity.js";
// + the package's PGlite lifecycle + node-seeding helpers (copy from node-membership.test.ts / a nodes test)

describe("membership trust-set accessors", () => {
  // pg = usePgliteDb(...); seed tenantId + a node with id nodeId (public_key initially null)

  it("readMembershipTrustSet omits a node whose public_key is null", async () => {
    expect(await readMembershipTrustSet(pg.db, tenantId)).toEqual({});
  });

  it("setNodePublicKey stamps the column and readMembershipTrustSet returns { nodeId: key }", async () => {
    await setNodePublicKey(pg.db, tenantId, nodeId, "PUBKEY_B64");
    expect(await readMembershipTrustSet(pg.db, tenantId)).toEqual({ [nodeId]: "PUBKEY_B64" });
  });

  it("readMembershipTrustSet returns every keyed node (two-node topology)", async () => {
    // seed a second node nodeId2 in the same tenant
    await setNodePublicKey(pg.db, tenantId, nodeId, "KEY_A");
    await setNodePublicKey(pg.db, tenantId, nodeId2, "KEY_B");
    expect(await readMembershipTrustSet(pg.db, tenantId)).toEqual({ [nodeId]: "KEY_A", [nodeId2]: "KEY_B" });
  });
});
```

> **Implementer note.** PGlite connects as superuser (bypasses RLS), so this proves the query + null-filter logic; the RLS *grant* enforcement is Task 1 Step 6 on real Postgres. Reuse the sibling's exact tenant/node seeding — do not invent a new fixture. `nodeId2` needs a second `nodes` row under the same tenant (a second `seedNode`, or a raw insert on the owner connection).

- [ ] **Step 4: Run the tests, verify they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test node-identity.test`
Expected: FAIL — `./node-identity.js` does not exist.

- [ ] **Step 5: Write `packages/db/src/node-identity.ts`**

```ts
import { eq } from "drizzle-orm";
import type { TrustSet } from "@waitron/membership";
import { tenantId as brandTenantId } from "@waitron/shared";
import { nodes } from "./schema/nodes.js";
import { withTenant, type Database } from "./tenancy.js";

/**
 * Stamp a node's membership identity PUBLIC key (design §4) on the owner connection. `nodes` is
 * FORCE-RLS, so this runs under `withTenant` with the tenant GUC set — the owner is subject to the
 * policy too. app_user holds no UPDATE on `nodes` (setNodePublicKey is owner-role, like the provision
 * writes it sits beside). The PRIVATE half is sealed in the vault (apps/server/node-identity.ts).
 */
export function setNodePublicKey(
  db: Database,
  tenantId: string,
  nodeId: string,
  publicKey: string,
): Promise<void> {
  const tenant = brandTenantId(tenantId);
  return withTenant(db, tenant, async (tx) => {
    await tx.update(nodes).set({ publicKey }).where(eq(nodes.id, nodeId));
  });
}

/**
 * The node's membership trust anchors (design §4): every `nodes` row's `{ id → public_key }`, skipping
 * the keyless ones (bare fixtures, a not-yet-stamped node). Read as the app role under `withTenant`
 * (app_user holds SELECT on `nodes`). Boot reads this into `membershipTrustSet`: a fresh primary gets
 * `{ self }`; a cloud mirror gets `{ primary }` from the node row `adoptVenue` replicated.
 */
export function readMembershipTrustSet(db: Database, tenantId: string): Promise<TrustSet> {
  const tenant = brandTenantId(tenantId);
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx.select({ id: nodes.id, publicKey: nodes.publicKey }).from(nodes);
    const trust: Record<string, string> = {};
    for (const r of rows) if (r.publicKey !== null) trust[r.id] = r.publicKey;
    return trust;
  });
}
```

> **Implementer notes.**
> - Import paths: confirm how the barrel/sibling accessors import `withTenant`/`Database` (`./tenancy.js` vs `./client.js`) and `nodes` — copy the sibling's exact specifiers. `brandTenantId` is `@waitron/shared`'s `tenantId` brand (see `mirror-token.ts:3`).
> - `@waitron/membership` is a **type-only** dep of `@waitron/db` already (Slice 2, `readNodeMembership` imports `SignedMembershipDocument`) — `import type { TrustSet }` reuses that edge; do not add a runtime dep.

- [ ] **Step 6: Write the real-Postgres RLS test**

`packages/db/src/node-identity.rls.test.ts` — model on `node-membership.rls.test.ts` (real PG via `useRealPostgres`/`useTemplateDb`, an `admin`/owner pool + an `app_user` pool). Assert the grant shape on the new column:
```ts
  it("app_user holds SELECT and NOT UPDATE on nodes.public_key (trust read is app-role, writes owner-role)", async () => {
    const rows = await admin.execute<{ sel: boolean; upd: boolean }>(sql`
      select
        has_column_privilege('app_user', 'nodes', 'public_key', 'SELECT') as sel,
        has_column_privilege('app_user', 'nodes', 'public_key', 'UPDATE') as upd
    `);
    expect(rows.rows[0]).toEqual({ sel: true, upd: false });
  });

  it("readMembershipTrustSet works on the app pool; setNodePublicKey does not (owner-only)", async () => {
    // seed a node on the owner pool, stamp it via setNodePublicKey(ownerDb, …)
    // readMembershipTrustSet(appDb, tenantId) → { nodeId: key }   (app_user SELECT ok)
    // setNodePublicKey(appDb, …) rejects (app_user has no UPDATE) → expect a thrown permission error
  });
```

> **Implementer note.** Reuse `node-membership.rls.test.ts`'s harness verbatim for the pools/seeding; `has_column_privilege` is the column-level analogue of the `has_table_privilege` that file already uses. The second test's owner-vs-app split proves the read rides the app pool (so the boot read in Task 4 is legitimate) and the write is fenced. `useTemplateDb` rebuilds `core` from the migration folder, so `0098` is included.

- [ ] **Step 7: Export from the barrel**

In `packages/db/src/index.ts`, export the two accessors beside the Slice-2 `readNodeMembership`/`writeNodeMembership` exports:
```ts
export { setNodePublicKey, readMembershipTrustSet } from "./node-identity.js";
```

- [ ] **Step 8: Run the tests, verify red→green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test node-identity`
Expected: PASS (PGlite + RLS).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/nodes.ts packages/db/drizzle/0098_node_public_key.sql \
        packages/db/drizzle/meta packages/db/src/node-identity.ts \
        packages/db/src/node-identity.test.ts packages/db/src/node-identity.rls.test.ts \
        packages/db/src/index.ts
git commit -s -m "feat(membership): nodes.public_key trust-anchor column + trust-set accessors (Slice 4)"
```

---

## Task 2: `@waitron/credentials` — the `membership.node_key` vault purpose

**Files:**
- Modify: `packages/credentials/src/purposes.ts`
- Modify: `packages/credentials/src/purposes.test.ts` (or the sibling that pins `PURPOSES`)

**Interfaces:**
- Produces: a new sealable purpose `"membership.node_key"` with the single field `["privateKey"]`, so `apps/server/node-identity.ts` can `putCredential`/`getCredential` the node's Ed25519 private key under the box key.

- [ ] **Step 1: Add the failing test**

In `packages/credentials/src/purposes.test.ts` (open it first for the exact assertion style — it likely round-trips `validatePayload` per purpose):
```ts
  it("membership.node_key requires exactly privateKey", () => {
    expect(isPurpose("membership.node_key")).toBe(true);
    expect(() => validatePayload("membership.node_key", { privateKey: "PK_B64" })).not.toThrow();
    expect(() => validatePayload("membership.node_key", {})).toThrow(); // missing
    expect(() => validatePayload("membership.node_key", { privateKey: "x", extra: "y" })).toThrow(); // unexpected
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @waitron/credentials test purposes`
Expected: FAIL — `isPurpose("membership.node_key")` is `false`.

- [ ] **Step 3: Register the purpose**

In `packages/credentials/src/purposes.ts`, add to the `PURPOSES` object (after `sync.mirror_token`):
```ts
  /** The node's own Ed25519 membership identity PRIVATE key (base64 PKCS8 DER), sealed under the box
   * key at setup (design §4 — apps/server/src/node-identity.ts). A box-local operational secret, one
   * field, the exact shape of `sync.mirror_token`. Never leaves the box: a value sealed under one box
   * key cannot be opened under another (GCM auth fails). Set only on the PROVISION path — a cloud
   * mirror runs as the primary's nodeId and never signs, so it seals none. */
  "membership.node_key": ["privateKey"],
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @waitron/credentials test purposes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/credentials/src/purposes.ts packages/credentials/src/purposes.test.ts
git commit -s -m "feat(membership): membership.node_key vault purpose for the node identity key (Slice 4)"
```

---

## Task 3: `apps/server` — the node-identity module (generate + seal + stamp)

**Files:**
- Create: `apps/server/src/node-identity.ts`, `apps/server/src/node-identity.test.ts`
- Modify: `apps/server/package.json` if `@waitron/membership` is not yet a dep (it was added in Slice 3 Task 2 — confirm), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `generateNodeKeyPair` (`@waitron/membership`); `KeyRing`, `putCredential`, `getCredential` (`@waitron/credentials`); `setNodePublicKey`, `withTenant`, `Database` (`@waitron/db`); `tenantId` brand (`@waitron/shared`).
- Produces:
  - `establishNodeIdentity(deps: EstablishIdentityDeps, tenantId: string, nodeId: string): Promise<void>` where `interface EstablishIdentityDeps { ownerDb: Database; ring: KeyRing }` — generates a keypair, seals the private key under `membership.node_key`, and stamps `nodes.public_key`. The provision path's identity step, beside `sealAeat`.
  - `readNodeIdentityKey(appDb: Database, ring: KeyRing, tenantId: string): Promise<string>` — unseals the private key (base64 PKCS8). The Slice-5 signer's entry point; exercised now by the round-trip. Throws `credentials.missing`/`credentials.decrypt_failed` (surfaced by the vault).

- [ ] **Step 0: Confirm the `@waitron/membership` dependency**

`apps/server` gained `@waitron/membership` in Slice 3 (Task 2). Confirm: `grep '"@waitron/membership"' apps/server/package.json`. If absent, add `"@waitron/membership": "workspace:*"` to `dependencies` (alphabetical) and run `pnpm install` (commit `pnpm-lock.yaml` — `--frozen-lockfile` is a CI gate).

- [ ] **Step 1: Write the failing test (PGlite)**

`apps/server/src/node-identity.test.ts` — model the vault wiring on how `mirror-token`'s round-trip is tested (find `mirror-token.test.ts` / the adopt test that seals + reads a token; reuse its `KeyRing` fixture — a fixed 32-byte key — and its `core` PGlite spin-up that seeds a tenant + node). PGlite is superuser (bypasses RLS), so this proves the crypto + stamp round-trip; the RLS enforcement is proven in Task 1 (`nodes`) and the credentials package's own suites (unchanged).
```ts
import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "@waitron/membership";
import { readMembershipTrustSet } from "@waitron/db";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
// + the mirror-token test's KeyRing fixture + PGlite core DB seeding a tenant + a node (id = nodeId)

describe("node identity establishment", () => {
  // pg = <core PGlite>; ring = <fixed test KeyRing>; seed tenantId + node nodeId (public_key null)

  it("establishNodeIdentity stamps a public key that becomes the sole trust anchor", async () => {
    await establishNodeIdentity({ ownerDb: pg.db, ring }, tenantId, nodeId);
    const trust = await readMembershipTrustSet(pg.db, tenantId);
    expect(Object.keys(trust)).toEqual([nodeId]);
    expect(typeof trust[nodeId]).toBe("string"); // base64 SPKI, non-empty
    expect(trust[nodeId].length).toBeGreaterThan(0);
  });

  it("the sealed private key round-trips and pairs with the stamped public key", async () => {
    await establishNodeIdentity({ ownerDb: pg.db, ring }, tenantId, nodeId);
    const priv = await readNodeIdentityKey(pg.db, ring, tenantId);
    const pub = (await readMembershipTrustSet(pg.db, tenantId))[nodeId];
    // Proof they are ONE keypair: a signature by the sealed private key verifies under the stamped public key.
    const { signBytes, verifyBytes } = await import("@waitron/membership");
    const sig = signBytes("membership-slice-4-probe", priv);
    expect(verifyBytes("membership-slice-4-probe", sig, pub)).toBe(true);
  });
});
```

> **Implementer note.** The keypair-pairing assertion (sign with the sealed private key, verify under the stamped public key) is the load-bearing proof — it fails if `establishNodeIdentity` seals one key and stamps a *different* one. `signBytes`/`verifyBytes` are already exported from `@waitron/membership` (crypto.ts). Reuse the exact `KeyRing` test fixture from `mirror-token`'s test rather than hand-rolling one.

- [ ] **Step 2: Run it, verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test node-identity`
Expected: FAIL — `./node-identity.js` does not exist.

- [ ] **Step 3: Write `apps/server/src/node-identity.ts`**

```ts
import { generateNodeKeyPair } from "@waitron/membership";
import { getCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { setNodePublicKey, withTenant, type Database } from "@waitron/db";
import { tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";

/**
 * Establish this node's membership identity (design §4) at setup: generate an Ed25519 keypair, seal
 * the PRIVATE half in the box vault under `membership.node_key`, and stamp the PUBLIC half on
 * `nodes.public_key` — the trust anchor boot reads (readMembershipTrustSet). Called ONLY on the
 * fresh-primary provision path (setup-api provision handler, beside sealAeat): a cloud mirror runs as
 * the primary's nodeId and never signs, so it seals no key and inherits the primary's anchor through
 * the node row adoptVenue replicates.
 *
 * The order mirrors sealMirrorToken: the vault row is FK-restricted to the tenant, so this runs AFTER
 * provisionVenue mints it. `nodes` is FORCE-RLS, so both the seal (tenant_credentials WITH CHECK) and
 * the stamp (nodes policy) run under `withTenant` on the owner connection.
 */
export interface EstablishIdentityDeps {
  ownerDb: Database;
  ring: KeyRing;
}

export async function establishNodeIdentity(
  deps: EstablishIdentityDeps,
  tenantId: string,
  nodeId: string,
): Promise<void> {
  const tenant = brandTenantId(tenantId);
  const { publicKey, privateKey } = generateNodeKeyPair();
  await withTenant(deps.ownerDb, tenant, (tx) =>
    putCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: "membership.node_key",
      value: { privateKey },
    }),
  );
  await setNodePublicKey(deps.ownerDb, tenantId, nodeId, publicKey);
}

/**
 * Unseal the node's identity PRIVATE key (base64 PKCS8) as `app_user` under `withTenant` — the same
 * role/path readMirrorToken uses. The Slice-5 signer's entry point (mint + sign a membership
 * document); exercised now by the establish round-trip. Throws `credentials.decrypt_failed` (a key
 * sealed under a different box key) or `credentials.missing` (never established).
 */
export function readNodeIdentityKey(appDb: Database, ring: KeyRing, tenantId: string): Promise<string> {
  const tenant = brandTenantId(tenantId);
  return withTenant(appDb, tenant, async (tx) => {
    const c = await getCredential(tx, ring, { tenantId: tenant, purpose: "membership.node_key" });
    return c.privateKey as string;
  });
}
```

> **Implementer notes.**
> - This is a near-clone of `mirror-token.ts` (seal/read under `withTenant`) plus the `setNodePublicKey` stamp — keep the two functions symmetric with it. `import "./errors.js"` keeps the reachability convention even though this module throws none of its own (the vault's codes propagate); match the sibling — if `mirror-token.ts` omits it, omit it here.
> - `putCredential`/`getCredential` and `withTenant` want a `tx` from `withTenant`; `putCredential`'s `value` is validated against `PURPOSES["membership.node_key"]` (Task 2) — exactly `{ privateKey }`, no more.

- [ ] **Step 4: Run it, verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test node-identity`
Expected: PASS (both cases, incl. the keypair-pairing proof).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/node-identity.ts apps/server/src/node-identity.test.ts
git commit -s -m "feat(membership): node-identity module — generate, seal private key, stamp public key (Slice 4)"
```

---

## Task 4: `apps/server` — wire identity establishment into the provision handler

**Files:**
- Modify: `apps/server/src/setup-api.ts` (the `SetupApiDeps` shape + the `/setup-api/provision` handler)
- Modify: `apps/server/src/boot.ts` (bind the `establishIdentity` dep)
- Test: `apps/server/src/setup-api.*.test.ts` (extend the provision test, or a new `setup-provision.e2e` — see note)

**Interfaces:**
- Consumes: `establishNodeIdentity` (Task 3); the `result: { tenantId, nodeId, … }` `provisionVenue` already returns.
- Produces: after a successful `POST /setup-api/provision`, the freshly-minted node carries `public_key`, so `readMembershipTrustSet(db, tenantId)` returns `{ thatNodeId: key }`.

- [ ] **Step 1: Write the failing test**

Find the existing provision test (grep `setup-api` + `provision` in `apps/server/src/*.test.ts` — likely `setup-api.rls.test.ts` or a `setup-provision` e2e that already POSTs `/setup-api/provision` end to end with a real DB). Add an assertion that the provisioned node ends up a trust anchor:
```ts
  it("provision establishes the primary's node identity — its key is the sole trust anchor", async () => {
    // … existing successful POST /setup-api/provision against a real core DB, with the identity dep wired …
    const { tenantId } = /* provision response */;
    const trust = await readMembershipTrustSet(appDb, tenantId);
    // exactly one anchor (the primary's own node), non-empty base64 key
    expect(Object.keys(trust)).toHaveLength(1);
    expect(Object.values(trust)[0]).toMatch(/.+/);
  });
```

> **Implementer note — mount the dep.** The provision handler gates on its injected deps (`provision`, `sealAeat`, …) being defined (`setup-api.ts:315-324`). The test must supply an `establishIdentity` binding the same way it supplies `sealAeat` — bind it to `establishNodeIdentity({ ownerDb, ring }, …)` with the test's owner DB + a `KeyRing` fixture. If the existing provision test seeds no vault/ring, model the ring on Task 3's fixture and on how `sealAeat` is wired in that test. Prefer extending the existing provision e2e over a new file if one already drives the full POST.

- [ ] **Step 2: Run it, verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test <the provision test file>`
Expected: FAIL — the node's `public_key` is null (`readMembershipTrustSet` returns `{}`).

- [ ] **Step 3: Add the `establishIdentity` dep + call it in the handler**

In `apps/server/src/setup-api.ts`, add to `SetupApiDeps` (beside `sealAeat`):
```ts
  /** Establishes the node's membership identity after provisionVenue mints it (design §4): generates a
   * keypair, seals the private key, stamps nodes.public_key. Bound in boot to
   * `establishNodeIdentity({ ownerDb, ring }, …)`. Optional like the other provision deps so an unwired
   * box refuses via the deps gate rather than half-provisioning. Provision path only — a mirror seals none. */
  establishIdentity?: (tenantId: string, nodeId: string) => Promise<void>;
```
In the handler's deps gate (`setup-api.ts:309-324`), capture and require it alongside the others:
```ts
    const establishIdentity = deps.establishIdentity;
    // … add `establishIdentity === undefined ||` to the `if (…)` gate → directError(c, log, "setup.not_ready", 503)
```
Then call it after `provision()` returns and before `persistTrading` (beside `sealAeat`, `setup-api.ts:381-387`):
```ts
        const result = await provision({ environment, venue });

        // Establish this node's membership identity (design §4): after the tenant/node are minted (the
        // vault row is FK-restricted to the tenant) and before the trading config is persisted. A fresh
        // primary becomes its own sole trust anchor; boot reads it into membershipTrustSet.
        await establishIdentity(result.tenantId, result.nodeId);

        // Seal the AEAT cert AFTER provision mints the tenant …
        if (aeatCert !== undefined) {
          await sealAeat(result.tenantId, aeatCert);
        }
```

> **Implementer note — the latch.** `establishIdentity` runs inside the same `try` whose `catch` resets `provisioning = false` (`setup-api.ts:408-414`), so an identity failure resets the latch for a corrected retry, exactly like a `sealAeat` failure. `establishNodeIdentity` is idempotent-enough for a retry: a second run generates a *new* keypair and UPSERTs the vault row + overwrites `public_key` — acceptable pre-restart (no document has been signed yet). Do not add rollback.

- [ ] **Step 4: Bind the dep in boot**

In `apps/server/src/boot.ts`, where the setup-api deps object is built (grep `sealAeat:` / `mountSetup` / `provision:` — near `boot.ts:620`), add:
```ts
        establishIdentity: (tenantId, nodeId) =>
          establishNodeIdentity({ ownerDb, ring }, tenantId, nodeId),
```
Import `establishNodeIdentity` from `./node-identity.js` at the top. Confirm `ownerDb` and `ring` are the same bindings `sealAeat` uses in that deps object (they are — `sealAeat` seals under the box ring on the owner connection); reuse them verbatim.

- [ ] **Step 5: Run the test + the existing provision/boot suites**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test setup-api boot.test node-identity`
Expected: PASS — the new anchor assertion is green and the existing provision/boot tests still pass (the dep is additive; a boot that wires it changes only that the provisioned node now carries a key).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/setup-api.ts apps/server/src/boot.ts apps/server/src/<provision test file>
git commit -s -m "feat(membership): establish node identity on the provision path (Slice 4)"
```

---

## Task 5: `apps/server` — the live boot trust-set read + the adopt-inherits-primary proof

**Files:**
- Modify: `apps/server/src/boot.ts` (replace the empty-seam line)
- Test: `apps/server/src/adopt.rls.test.ts` (the mirror inherits `{primary}`), and — if a real trust set is now reachable — tighten `apps/server/src/membership-gossip.e2e.test.ts`

**Interfaces:**
- Consumes: `readMembershipTrustSet` (Task 1); the `adoptFromPrimary` flow (unchanged) + the primary's now-stamped `nodes.public_key`.
- Produces: boot's `membershipTrustSet` is a real read; the Slice-3 `adoptMembership` callback now accepts a genuinely-trusted document.

- [ ] **Step 1: Write the failing adopt test**

The adopt path itself needs **no change** — this test *proves* that. In `apps/server/src/adopt.rls.test.ts` (which already exercises `adoptFromPrimary` against a hand-built or real `MirrorBundle`), stamp the primary's node row with a public key in the source rows, run adopt, then assert the mirror's trust set:
```ts
  it("a mirror inherits the primary's trust anchor through the replicated node row (no adopt change)", async () => {
    // Build the bundle so the primary's nodes row carries public_key = PRIMARY_PUB (as establishNodeIdentity
    // would have stamped it on the primary). Run adoptFromPrimary against the mirror's DB.
    await adoptFromPrimary(deps, req);
    const trust = await readMembershipTrustSet(mirrorAppDb, designated.tenantId);
    expect(trust).toEqual({ [designated.nodeId]: "PRIMARY_PUB" });
  });
```

> **Implementer note.** The existing `adopt.rls.test.ts` builds `AdoptVenueRows` (see its header note about `assembleMirrorBundle` — "column-for-column rows ready to insert verbatim"). Set `public_key` on the `nodes` row in those rows; `adoptVenue` inserts it verbatim, and `readMembershipTrustSet` on the mirror's app pool reads it back. If the file builds the bundle via the real `assembleMirrorBundle` against a source DB, stamp the source node via `setNodePublicKey` first. This is the end-to-end proof of Owner Decision 2 (adopt rides replication).

- [ ] **Step 2: Run it, verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test adopt.rls`
Expected: FAIL — before the schema column exists in this branch's mental model it would be a type error; with it present, FAIL only if the row's `public_key` is dropped. (If it passes immediately, the column already rides replication — confirm by asserting the *value*, not just presence, so a dropped column fails.)

- [ ] **Step 3: Replace the boot seam**

In `apps/server/src/boot.ts:1141-1144`, replace:
```ts
    // The membership trust set (design §4). SLICE-4 SEAM: empty today, so every gossiped document is
    // untrusted_signer and adoption is a production no-op until setup/adopt populates it. Kept as a
    // named local so Slice 4 replaces this one line with a real read.
    const membershipTrustSet: TrustSet = {};
```
with:
```ts
    // The membership trust set (design §4): the node's own key at setup, plus the primary's key on a
    // mirror (inherited through adoptVenue's replicated node row). Read from nodes.public_key on the
    // app pool under the venue tenant (readMembershipTrustSet). A fresh primary trusts itself; a mirror
    // trusts the primary — so the Slice-3 adoptMembership callback now accepts a genuinely-trusted,
    // strictly-newer gossiped document instead of the empty-seam no-op.
    const membershipTrustSet: TrustSet = await readMembershipTrustSet(localSyncDb, till.tenantId);
```
Import `readMembershipTrustSet` from `@waitron/db` at the top of `boot.ts` (beside the existing `@waitron/db` imports).

> **Implementer note.** `localSyncDb` is the app-role pool the `adoptMembership` callback already runs on (`boot.ts:1128,1153`) — a member of `app_user`, which holds SELECT on `nodes`. `withTenant` inside `readMembershipTrustSet` switches to `app_user` + sets the tenant GUC, so the read is correctly scoped. `till.tenantId` is in scope (used at `boot.ts:1167`). Because the seam is no longer empty, delete the now-false `/* v8 ignore next */` + "Unreachable in production" comment on the `if (outcome.accepted)` branch at `boot.ts:1156-1161` — that branch is now reachable (a mirror adopting the primary's real document), so it is covered by the gossip e2e rather than ignored. Confirm coverage still passes after removing the ignore; if boot's own unit tests never reach it, keep the e2e as its cover and leave a one-line note (do not re-add a false "unreachable" claim — CLAUDE.md §1).

- [ ] **Step 4: Tighten the Slice-3 gossip e2e to a real trust set (if reachable)**

`apps/server/src/membership-gossip.e2e.test.ts` proved adoption with a *fixture* trust set. Now a real one is reachable: stamp the source node via `establishNodeIdentity` (or `setNodePublicKey`), read the subscriber's trust set via `readMembershipTrustSet`, and drive the same pull → adopt. Keep the fixture-trust variant too (it documents the empty-seam no-op direction). If wiring a real trust set here is disproportionate to the existing harness, leave the e2e as-is and rely on Task 5 Step 1 (adopt) + Task 4 (provision) as the real-key proofs — note which.

- [ ] **Step 5: Run the boot + adopt + gossip suites**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.test adopt membership-gossip`
Expected: PASS. Boot now reads a real trust set (empty on a bare-node boot fixture, `{self}`/`{primary}` on a provisioned/adopted one — confirm the boot fixtures still pass; a fixture node with no `public_key` yields `{}`, the same behaviour as the old seam, so existing boot assertions hold).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/adopt.rls.test.ts apps/server/src/membership-gossip.e2e.test.ts
git commit -s -m "feat(membership): live boot trust-set read; adopt inherits the primary's anchor (Slice 4)"
```

---

## Task 6: Package gates + whole-workspace guards

**Files:** none (verification only).

- [ ] **Step 1: The three changed packages' full coverage gates (UNFILTERED — cross-cutting guard suites load, CLAUDE.md §2)**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
```
Expected: PASS, thresholds ≥ 98/98/98/95 in each. Run each UNFILTERED so its whole-package guard suites (`inmutabilidad` reference, teardown scan, English-only) load — a filtered run does not (CLAUDE.md §2).

- [ ] **Step 2: Fiscal isolation guard + root guards**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
pnpm vitest run scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/guarded-teardowns.test.ts
```
Expected: PASS. `nodes` already FORCE-RLS with a tenant-isolation policy (`0017_nodes_rls.sql`); a nullable column adds no policy, so the `inmutabilidad` scan (which keys on the `tenant_id` column) stays green for it. The root guards confirm no pinned list went stale and every new teardown is guarded (the new suites use `usePgliteDb`/`useRealPostgres` helpers, which own their teardown — CLAUDE.md §4).

- [ ] **Step 3: The four-command gate**

```
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```
Expected: PASS.

- [ ] **Step 4: Whole-workspace breadth (RAM permitting — see memory on browser-vitest × pnpm-r)**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test:coverage
```
Expected: PASS. Run once before the PR so any dependent of `@waitron/db`/`@waitron/credentials` the new column/purpose touches is covered (e.g. `@waitron/provisioning`'s `adoptVenue`/`applyVenue`, which now carry an extra `nodes` column through their row shapes). If RAM is tight, rely on the per-package gates + the pre-push hook's scoped run, and note it.

---

## Self-Review Notes (author)

- **Spec coverage (§4, setup half):** node identity keypair per node → Task 3 (`establishNodeIdentity`); private key never shared, sealed under the box key → Task 2 purpose + Task 3 seal; the setup root = a node trusting its own key → Task 4 (provision stamps the primary's anchor); "the endorsed key set rides in the adopt bundle" reduced to **the replicated node row** because the cloud runs as the primary's nodeId (Owner Decision 1/2) → Task 5 Step 1 proves it with no adopt change; the two-part acceptance test consuming the trust set → already Slice 3, now fed a real `TrustSet` by Task 5's boot read. **Endorsement chain, distinct cloud identity, private-key signing** → explicitly deferred (Slice 5+), stated in Goal + Global Constraints.
- **Owner decisions honoured:** (1) trust anchors only, endorsement deferred; (2) `nodes.public_key` column, adopt rides replication (no bundle change); (3) private key in the credentials vault under a new purpose. All three have a named task.
- **Grants (CLAUDE.md §3):** `app_user` gains nothing — it already holds SELECT on `nodes` (rides the trust read); writes are owner-role (`setNodePublicKey`, `establishNodeIdentity` on `ownerDb`). The RLS test (Task 1 Step 6) reads the ACL back both directions (`has_column_privilege` SELECT=t / UPDATE=f). No grant widened to pass a test.
- **Vault reuse (CLAUDE.md §3):** `membership.node_key` is a new domain-concept purpose (`domain.concept`, like `sync.mirror_token`), field `privateKey`, validated exact-match. The node-identity module is a near-clone of `mirror-token.ts` — same `withTenant` + seal/read shape, same box-key cross-box property.
- **Migration (memory — Drizzle collision):** `0098_node_public_key` is a **generated** migration (modelled column) off current tail `0097`. Reset-`drizzle/`-to-`main` + re-`db:generate` if a rebase bumps it; re-verify RLS + `inmutabilidad`.
- **CI-list traps (CLAUDE.md §2):** no repo-wide pinned list changes; the three packages own their existing shards; Task 6 runs each UNFILTERED + the root guards + the fiscal guard + (RAM permitting) the whole workspace, so no cross-cutting suite is skipped by scoping.
- **Stale-comment sweep (CLAUDE.md §1):** Task 5 Step 3 removes boot's now-false "SLICE-4 SEAM: empty today" + "Unreachable in production" `/* v8 ignore */`. Before the PR, grep `SLICE-4`/`Slice 4`/`empty trust`/`inert`/`untrusted_signer` across `apps/server`, `packages/db`, `packages/sync` for any other Slice-3 receipt this slice retires (the Slice-3 e2e's "production uses the empty Slice-4 seam" comment, `membership-gossip.e2e.test.ts`, is now only half-true — the empty seam is gone; update it to "a bare node with no stamped key yields an empty trust set").
- **Type consistency:** `TrustSet` (`Readonly<Record<string,string>>`) is the return of `readMembershipTrustSet` (Task 1) and the parameter of `adoptMembership`/the boot local (Slice 3) — same type end to end. `establishNodeIdentity(deps, tenantId, nodeId)` / `readNodeIdentityKey(appDb, ring, tenantId)` (Task 3) match their call sites (Task 4 boot binding; the Task 3 round-trip test). `setNodePublicKey(db, tenantId, nodeId, publicKey)` signature is identical in the accessor (Task 1 Step 5), the module that calls it (Task 3), and the tests.
```
