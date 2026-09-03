# Membership Promotion R2 — Reserve the Cloud's Dormant Identity at Adopt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the moment a cloud mirror adopts a venue — the earliest guaranteed-connected checkpoint — establish its complete-but-dormant standby identity (its own nodeId + membership keypair + a reserved installation number + disjoint invoice series + the primary's endorsement of its key), so a later promotion (R3) can activate it with no connectivity.

**Architecture:** The adopt handshake gains a small round-trip. The cloud generates its Ed25519 keypair + a fresh nodeId in memory and sends the public half + nodeId to the primary inside the existing `POST /management-api/mirror-bundle` request. The primary — the sole installation-number allocator (spec §4) — bumps its `contadores_instalacion`, derives disjoint series codes from its own series, and endorses the cloud's key with its own trusted key; it returns all three in a new `reservedIdentity` field on the bundle. The cloud then persists, on the OWNER connection under the venue's tenant scope, a dormant `nodes` row (its own nodeId, carrying its public key + the endorsement), a reserved `registro_sif` keyed to that nodeId (using the primary-supplied number — **never re-allocating**), a fresh empty `cadenas` head, reserved `invoice_series` rows, and the sealed private key. **Everything is inert: `config.till.nodeId` is unchanged, so no sale ever resolves the reserved SIF and the read-mirror runs exactly as today.** The sync-axis ripple (switching the runtime node id) is deferred to R3.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (PGlite for hermetic tests; real Postgres via Testcontainers for RLS/owner-role/counter-contention and the adopt e2e), Drizzle ORM, Ed25519 via `@waitron/membership` (`node:crypto` under the hood), the credentials vault (`@waitron/credentials`).

**Spec:** `docs/superpowers/specs/2026-09-03-reserved-standby-identity-and-promotion-design.md` — this plan implements **§6 R2** only (Reserve the cloud's dormant identity at adopt). R1 (document lifecycle, LANDED #205) is a prerequisite; R3 (cloud promotion) and H2 (fiscal-record sync) are later plans off the same spec.

## Decisions taken in this plan (flag for owner review at PR — fiscal-adjacent)

The spec fixes the model; these two sub-decisions are the plan's, taken from the code + constraints. Both are pre-production-reversible and owner-reviewed at land per the fiscal posture (spec "Supersedes a scheduling posture, not a fiscal one").

1. **Disjoint series code = `<primaryCode>-<numeroInstalacion>`.** The identity triple AEAT dedups on is `(NIF, NumSerieFactura, Fecha)` (spec §7; parent SIF spec §3 "series isolation"), so a promoted cloud must never share a series code with the primary. The reserved installation number is globally unique per NIF and **never reused** (`registro_sif_instalacion_uq`), so suffixing each primary series code with it (`FA` → `FA-3`, `RF` → `RF-3`) yields codes provably disjoint across every SIF of that NIF, with no allocator or lookup. Residual: an operator who manually named a primary series literally `FA-3` — backstopped by the `(tenant,node,code)` unique and AEAT error 3000, and vanishingly unlikely.
2. **The endorsement is stored on a new nullable `nodes.endorsement jsonb` column**, NOT in the credentials vault. Rationale: the vault's `validatePayload` (`packages/credentials/src/purposes.ts`) demands an EXACT, string-only field match, so adding `endorsement` to `membership.node_key` would (a) force the field onto the primary's key-only seal and (b) cannot hold the endorsement's object shape without stringifying. The endorsement is **public** membership data (a signature anyone may see), the exact sibling of `nodes.public_key` (added the same way by Slice 4, `0098`), so it belongs on the node row. The PRIVATE key stays sealed in the vault under `membership.node_key`, unchanged.

## Global Constraints

- **No backwards-compat / data-migration code** (CLAUDE.md §3) — pre-production. The `nodes.endorsement` column is nullable; existing node rows (and every fixture) carry NULL and are untouched.
- **Multi-table writes share ONE transaction, and `withTenant` IS that transaction** (CLAUDE.md §3). The cloud's whole reserved-identity persist (seal key + insert node + reserved SIF + cadenas head + series) commits in ONE `withTenant(ownerDb, tenantId)` transaction — a crash cannot leave a half-established identity.
- **The primary is the sole installation-number allocator** (spec §4). The cloud persists the primary-supplied `numeroInstalacion` verbatim and **never** writes `contadores_instalacion`. `writeReservedSif` (Task 1) does NOT mint.
- **Never fork the primary's chain** (CLAUDE.md §5). The reserved SIF is keyed to the cloud's OWN nodeId with a FRESH empty `cadenas` head (both-null pointer) — a distinct chain, never a resume of the primary's. `config.till.nodeId` is unchanged, so no sale touches it.
- **`registros_facturacion` immutability is untouched** — R2 writes `registro_sif`/`cadenas`/`invoice_series`/`nodes` only, never `registros_facturacion`.
- **Error codes name the domain concept**, and every file that throws imports its registry `import "./errors.js"` (CLAUDE.md §3). New codes go under `mirror.*` (server) / follow the sibling `<domain>.<snake_case>` convention.
- **Spanish/English guard:** identifiers are English (`apps/*` is out of the guard's scope anyway). No new Spanish schema tokens are added — `registro_sif`/`cadenas`/`invoice_series`/`numero_instalacion` already exist.
- **Never build SQL by string concatenation** (CLAUDE.md §3) — Drizzle parameterises; `CREATE ROLE`-style utility statements are not in scope here.
- **A new tenant-scoped table needs FORCE RLS + policy + grants** — R2 adds NO new table, only a nullable column on the existing `nodes` (already FORCE-RLS). After the column lands, run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the guard scans every `tenant_id`-bearing table) to confirm nothing regressed.
- **Gate before each commit-worthy change:** `pnpm lint && pnpm typecheck && pnpm format:check`, and the touched package's `test:coverage` (not bare `test`). Coverage thresholds are `98/98/98/95` for `@waitron/fiscal-verifactu`, `@waitron/db`, `@waitron/server` (the packages this plan touches).
- **Migration numbering (memory `drizzle-migration-rebase-collision`):** the `nodes.endorsement` migration is generated with `pnpm --filter @waitron/db db:generate` (do NOT hand-write the snapshot). Latest core migration at plan time is `0098`; the new one is `0099` (re-check on execution and renumber if `main` moved).

---

## File structure

- `packages/fiscal-verifactu/src/registro-sif.ts` (modify) — add `reserveInstallationNumber` (expose the counter bump) and `writeReservedSif` (persist a dormant SIF with a supplied number + fresh chain head). `packages/fiscal-verifactu/src/index.ts` (modify) — export both.
- `packages/db/src/schema/nodes.ts` (modify) — add the nullable `endorsement jsonb` column. `packages/db/drizzle/0099_*.sql` (generated) — the migration. `packages/db/src/reserved-identity.ts` (create) — the DB write/read accessors for the cloud's own dormant node + reserved series. `packages/db/src/index.ts` (modify) — export them.
- `apps/server/src/reserved-identity.ts` (create) — `generateStandbyIdentity` + `establishReservedStandbyIdentity` (the cloud-side orchestration, idempotent per spec §8). Test alongside.
- `apps/server/src/mirror-bundle.ts` (modify) — `MirrorBundle` gains `reservedIdentity`; `AssembleDeps` gains `ring` + `standby`; `assembleMirrorBundle` allocates+derives+endorses.
- `apps/server/src/mirror-bundle-api.ts` (modify) — `MirrorBundleApiDeps` gains `ring`; the handler reads + field-screens `standbyNodeId`/`standbyPublicKey` and threads them through.
- `apps/server/src/mirror-bundle-fetch.ts` (modify) — `fetchMirrorBundle` gains a `standby` argument sent in the request body.
- `apps/server/src/adopt.ts` (modify) — `adoptFromPrimary` generates the standby identity, threads it into `fetchBundle`, and persists the reserved identity after `adoptVenue`; `AdoptDeps.fetchBundle` signature widens.
- `apps/server/src/boot.ts` (modify) — pass `ring` into the mirror-bundle-api deps (trading-primary branch).

---

### Task 1: fiscal-verifactu reservation primitives (`reserveInstallationNumber` + `writeReservedSif`)

**Files:**
- Modify: `packages/fiscal-verifactu/src/registro-sif.ts`
- Modify: `packages/fiscal-verifactu/src/index.ts`
- Test: `packages/fiscal-verifactu/src/reserved-sif.rls.test.ts` (create)

**Interfaces:**
- Consumes: `contadoresInstalacion`, `registroSif` (`./schema/sif.js`); `cadenas` (`./schema/cadenas.js`); `Transaction` (`@waitron/db`); `NodeId`, `TenantId` (`@waitron/shared`). The existing private `mintNumeroInstalacion(tx, nif, idSistemaInformatico)` (registro-sif.ts:59) already does the atomic counter bump — `reserveInstallationNumber` is a thin public wrapper over it.
- Produces:
  ```ts
  export function reserveInstallationNumber(
    tx: Transaction,
    params: { nif: string; idSistemaInformatico: string },
  ): Promise<number>;

  export function writeReservedSif(
    tx: Transaction,
    params: {
      tenantId: TenantId;
      nodeId: NodeId;
      nif: string;
      idSistemaInformatico: string;
      numeroInstalacion: number;
    },
  ): Promise<{ id: string }>;
  ```
  `reserveInstallationNumber` bumps `contadores_instalacion` for `(nif, idSistemaInformatico)` and returns the number the caller may use (the pre-increment value), identical to what `registerSif` mints — but registers NOTHING. `writeReservedSif` inserts a `registro_sif` row with the SUPPLIED number (no mint, no counter touch) and a fresh empty `cadenas` head (`ultimoRegistroId`/`ultimaHuella` null) for that node — a dormant, brand-new chain. It does NOT retire a prior identity (a reserved node has none).

**Why real Postgres:** `reserveInstallationNumber`'s whole point is the atomic counter bump under contention, which PGlite serialises and cannot exercise (registro-sif.ts:50-57 explains the same for `registerSif`). Mirror the existing `chain.concurrency.test.ts` pattern (clone of the shared container's `core_fiscal` template).

- [ ] **Step 1: Write the failing test**

```ts
// packages/fiscal-verifactu/src/reserved-sif.rls.test.ts
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
// Reuse the package's real-PG harness + fixtures exactly as chain.concurrency.test.ts / a sif suite does;
// read the top of an existing *.rls.test.ts in this package first and mirror its setup (a seeded tenant +
// two nodes, a `withNode`-style tx helper on a clone of `core_fiscal`). The placeholders below name what
// the fixture must yield, not new helpers to invent.
import {
  currentSif,
  esPrimerRegistro,
  reserveInstallationNumber,
  writeReservedSif,
  registroSif,
} from "./index.js"; // registroSif re-exported for the assertion; if index does not re-export it, import from ./schema/sif.js
// ...harness imports (useRealPostgres / the package's own fixture)...

describe("reserved-sif primitives (real Postgres)", () => {
  // ...beforeAll seeds a tenant with a known tax_id (NIF), a primary node, and a distinct cloud node...

  it("reserveInstallationNumber advances the counter and hands back the pre-increment value", async () => {
    // First reservation for a fresh (nif, idSistema) returns 1, the next returns 2 (never-reuse).
    const first = await withTx((tx) => reserveInstallationNumber(tx, { nif: NIF, idSistemaInformatico: "W1" }));
    const second = await withTx((tx) => reserveInstallationNumber(tx, { nif: NIF, idSistemaInformatico: "W1" }));
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("writeReservedSif persists a dormant SIF with the supplied number and a fresh empty chain", async () => {
    const numero = await withTx((tx) => reserveInstallationNumber(tx, { nif: NIF, idSistemaInformatico: "W1" }));
    await withTx((tx) =>
      writeReservedSif(tx, {
        tenantId: brandTenantId(TENANT),
        nodeId: brandNodeId(CLOUD_NODE),
        nif: NIF,
        idSistemaInformatico: "W1",
        numeroInstalacion: numero,
      }),
    );
    // The reserved SIF is the node's live identity (revocado_en IS NULL) and carries the supplied number...
    const sif = await withTx((tx) => currentSif(tx, brandTenantId(TENANT), brandNodeId(CLOUD_NODE)));
    expect(sif.numeroInstalacion).toBe(numero);
    // ...on a brand-new empty chain (first record).
    expect(await withTx((tx) => esPrimerRegistro(tx, brandTenantId(TENANT), brandNodeId(CLOUD_NODE)))).toBe(true);
  });

  it("the unique index rejects re-persisting the same (nif, idSistema, numero)", async () => {
    const numero = await withTx((tx) => reserveInstallationNumber(tx, { nif: NIF, idSistemaInformatico: "W1" }));
    await withTx((tx) => writeReservedSif(tx, { tenantId: brandTenantId(TENANT), nodeId: brandNodeId(NODE_A), nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: numero }));
    await expect(
      withTx((tx) => writeReservedSif(tx, { tenantId: brandTenantId(TENANT), nodeId: brandNodeId(NODE_B), nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: numero })),
    ).rejects.toThrow(); // 23505 on registro_sif_instalacion_uq
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test reserved-sif`
Expected: FAIL — `reserveInstallationNumber` / `writeReservedSif` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/fiscal-verifactu/src/registro-sif.ts`, add below `mintNumeroInstalacion`:

```ts
/**
 * Reserve — but do not register — the next installation number for (NIF, IdSIF). The single-writer
 * counter bump `registerSif` performs, exposed on its own so the PRIMARY can allocate a standby's
 * number and hand it down in the adopt bundle (design §4: the primary is the sole allocator per NIF;
 * a standby's DB is a copy and must never mint). The standby persists the returned number via
 * `writeReservedSif` on ITS database — it never touches `contadores_instalacion`. Returns the number
 * the caller may use (the pre-increment value); the counter is advanced and the number is permanently
 * consumed (a never-promoted standby simply burns one cheap sequential number — gaps are permitted,
 * design §7).
 */
export function reserveInstallationNumber(
  tx: Transaction,
  params: { nif: string; idSistemaInformatico: string },
): Promise<number> {
  return mintNumeroInstalacion(tx, params.nif, params.idSistemaInformatico);
}

/**
 * Persist a DORMANT reserved SIF on a standby's own database (design §6 R2), keyed to the standby's
 * OWN nodeId with the number the PRIMARY allocated (`numeroInstalacion`) — NOT re-allocated here. It
 * is inert because no sale resolves this node (`config.till.nodeId` stays the primary's until a
 * promotion), and `currentSif` gates on `(tenant, node)`. A fresh empty `cadenas` head (both-null
 * pointer) makes it a brand-new chain, never a resume of anyone's (CLAUDE.md §5). No prior identity to
 * retire — a reserved node is new. The `registro_sif_instalacion_uq` unique on
 * (nif, id_sistema_informatico, numero_instalacion) is the never-reuse backstop; a duplicate number
 * raises 23505.
 */
export async function writeReservedSif(
  tx: Transaction,
  params: {
    tenantId: TenantId;
    nodeId: NodeId;
    nif: string;
    idSistemaInformatico: string;
    numeroInstalacion: number;
  },
): Promise<{ id: string }> {
  const [inserted] = await tx
    .insert(registroSif)
    .values({
      tenantId: params.tenantId,
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion: params.numeroInstalacion,
    })
    .returning({ id: registroSif.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("registro_sif: reserved insert returned no row");
  }
  /* v8 ignore stop */

  // A fresh empty chain head for this node — a distinct chain, never resumed (findings §1; mirrors
  // registerSif's cadenas reset). `secuencia` is left out of the SET deliberately (our outbox ordering
  // aid, not AEAT's — resetting it would collide on the next append).
  await tx
    .insert(cadenas)
    .values({ tenantId: params.tenantId, nodeId: params.nodeId })
    .onConflictDoUpdate({
      target: [cadenas.tenantId, cadenas.nodeId],
      set: { ultimoRegistroId: null, ultimaHuella: null, actualizadoEn: sql`now()` },
    });

  return { id: inserted.id };
}
```

Add both to `packages/fiscal-verifactu/src/index.ts` beside the existing `registerSif`/`currentSif` exports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/fiscal-verifactu test reserved-sif` then `pnpm --filter @waitron/fiscal-verifactu test:coverage`
Expected: PASS, coverage ≥ thresholds. Then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (no regression — no schema change here, but the primitives write fiscal tables).

- [ ] **Step 5: Commit**

```bash
git add packages/fiscal-verifactu/src/registro-sif.ts packages/fiscal-verifactu/src/index.ts packages/fiscal-verifactu/src/reserved-sif.rls.test.ts
git commit -s -m "feat(fiscal): reserveInstallationNumber + writeReservedSif for standby SIF reservation"
```

---

### Task 2: `nodes.endorsement` column + reserved-identity DB accessors (`@waitron/db`)

**Files:**
- Modify: `packages/db/src/schema/nodes.ts`
- Generated: `packages/db/drizzle/0099_*.sql` (+ the snapshot) via `db:generate`
- Create: `packages/db/src/reserved-identity.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/reserved-identity.test.ts` (create)

**Interfaces:**
- Consumes: `nodes`, `invoiceSeries` (schema), `withTenant`, `Transaction`, `Database` (`./client.js`); `Endorsement` (`@waitron/membership` — already a runtime dep of `@waitron/db`); `NodeId`, `TenantId` (`@waitron/shared`).
- Produces:
  ```ts
  export interface ReservedNodeInput {
    id: string;          // the standby's own nodeId
    tenantId: string;
    locationId: string;
    name: string;
    filingModule: string | null;
    taxModule: string | null;
    publicKey: string;   // base64 SPKI
    endorsement: Endorsement;
  }
  export function insertReservedNodeTx(tx: Transaction, node: ReservedNodeInput): Promise<void>;

  export interface ReservedSeriesInput {
    tenantId: string;
    nodeId: string;
    code: string;
    purpose: string;     // "standard" | "rectificative"
  }
  export function insertReservedSeriesTx(tx: Transaction, series: readonly ReservedSeriesInput[]): Promise<void>;

  export function readNodeEndorsement(
    db: Database,
    tenantId: string,
    nodeId: string,
  ): Promise<Endorsement | null>;
  ```
  All three are tenant-scoped writes/reads for the standby's OWN node. `insertReservedNodeTx` inserts the dormant node row (public_key + endorsement together). `insertReservedSeriesTx` inserts the reserved series (next_number defaults to 1). `readNodeEndorsement` is the R3 promote-signer's entry point (exercised here by the round-trip assertion). The `*Tx` accessors take a caller transaction so Task 3 commits them with the vault seal + reserved SIF in one transaction.

- [ ] **Step 1: add the schema column, then generate the migration**

In `packages/db/src/schema/nodes.ts`, add after `publicKey` (with a doc comment mirroring public_key's):

```ts
import type { Endorsement } from "@waitron/membership";
// ...
    // The primary's ENDORSEMENT of this node's public_key (design §4/§6 R2): a signed
    // (nodeId, publicKey, endorsedBy, signature) vouching that lets other members trust a document
    // this node later signs, chaining back to setup. Public data — the exact sibling of `public_key`
    // above — so it lives here, not in the secret vault (whose exact-match string-only payload cannot
    // hold it). Nullable: only a reserved STANDBY carries one; a fresh primary is self-trusted and has
    // NULL. Set owner-role at adopt (insertReservedNodeTx); app_user holds SELECT only. Read at R3
    // promotion to attach to the minted membership document.
    endorsement: jsonb("endorsement").$type<Endorsement>(),
```

Add `jsonb` to the `drizzle-orm/pg-core` import. Then:

Run: `pnpm --filter @waitron/db db:generate`
Expected: creates `packages/db/drizzle/0099_*.sql` containing `ALTER TABLE "nodes" ADD COLUMN "endorsement" jsonb;` and updates the snapshot. Confirm it is exactly that one ALTER (no unrelated diffs); if `main` moved and the number collided, follow memory `drizzle-migration-rebase-collision` (reset `drizzle/`, re-generate).

- [ ] **Step 2: Write the failing test**

```ts
// packages/db/src/reserved-identity.test.ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CORE_MIGRATIONS } from "./index.js";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  readNodeEndorsement,
  readMembershipTrustSet,
  withTenant,
} from "./index.js";
import type { Endorsement } from "@waitron/membership";

const ENDORSEMENT: Endorsement = {
  nodeId: "22222222-2222-2222-2222-222222222222",
  publicKey: "cloudpub",
  endorsedBy: "11111111-1111-1111-1111-111111111111",
  signature: "sig",
};

describe("reserved-identity accessors", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
  // ...beforeAll: seedTenant, insert a location (mirror the inline location-insert other db tests use),
  // capture tenantId + locationId; CLOUD_NODE = ENDORSEMENT.nodeId...

  it("insertReservedNodeTx persists a dormant node with its public key + endorsement", async () => {
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedNodeTx(tx, {
        id: CLOUD_NODE, tenantId, locationId, name: "cloud", filingModule: null, taxModule: null,
        publicKey: "cloudpub", endorsement: ENDORSEMENT,
      }),
    );
    expect(await readNodeEndorsement(suite.db, tenantId, CLOUD_NODE)).toEqual(ENDORSEMENT);
    // the dormant node's public key joins the trust set (readMembershipTrustSet reads public_key)
    const trust = await readMembershipTrustSet(suite.db, tenantId);
    expect(trust[CLOUD_NODE]).toBe("cloudpub");
  });

  it("readNodeEndorsement returns null for a node with no endorsement (a primary)", async () => {
    // ...seed a bare node via seedNode (no endorsement)... expect null.
  });

  it("insertReservedSeriesTx inserts the reserved series at next_number 1", async () => {
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: CLOUD_NODE, code: "FA-3", purpose: "standard" },
        { tenantId, nodeId: CLOUD_NODE, code: "RF-3", purpose: "rectificative" },
      ]),
    );
    const rows = await withTenant(suite.db, tenantId, (tx) =>
      tx.execute<{ code: string; next_number: number }>(
        sql`select code, next_number from invoice_series where node_id = ${CLOUD_NODE} order by code`,
      ),
    );
    expect(rows.rows.map((r) => [r.code, Number(r.next_number)])).toEqual([["FA-3", 1], ["RF-3", 1]]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @waitron/db test reserved-identity`
Expected: FAIL — the accessors are not exported.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/db/src/reserved-identity.ts
import { and, eq } from "drizzle-orm";
import type { Endorsement } from "@waitron/membership";
import type { Database, Transaction } from "./client.js";
import { nodes } from "./schema/nodes.js";
import { invoiceSeries } from "./schema/series.js";

export interface ReservedNodeInput {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  filingModule: string | null;
  taxModule: string | null;
  publicKey: string;
  endorsement: Endorsement;
}

/**
 * Insert the standby's OWN dormant node row (design §6 R2): its distinct nodeId, its public key, and
 * the primary's endorsement of that key. Owner-role: `nodes` grants app_user SELECT only
 * (`0017_nodes_rls.sql`), so public_key/endorsement writes need the owner (adopt already runs on
 * ownerDb). Caller supplies a `withTenant` tx so this commits with the reserved SIF + sealed key.
 */
export async function insertReservedNodeTx(tx: Transaction, node: ReservedNodeInput): Promise<void> {
  await tx.insert(nodes).values({
    id: node.id,
    tenantId: node.tenantId,
    locationId: node.locationId,
    name: node.name,
    filingModule: node.filingModule,
    taxModule: node.taxModule,
    publicKey: node.publicKey,
    endorsement: node.endorsement,
  });
}

export interface ReservedSeriesInput {
  tenantId: string;
  nodeId: string;
  code: string;
  purpose: string;
}

/** Insert the standby's reserved invoice series (next_number defaults to 1). Owner-role under the
 * caller's tenant tx, alongside the reserved node + SIF. */
export async function insertReservedSeriesTx(
  tx: Transaction,
  series: readonly ReservedSeriesInput[],
): Promise<void> {
  if (series.length === 0) return;
  await tx.insert(invoiceSeries).values(
    series.map((s) => ({ tenantId: s.tenantId, nodeId: s.nodeId, code: s.code, purpose: s.purpose })),
  );
}

/** The endorsement stored on a node's row, or null for a node that carries none (a self-trusted
 * primary). The R3 promote-signer reads it to attach to the membership document it mints. */
export async function readNodeEndorsement(
  db: Database,
  tenantId: string,
  nodeId: string,
): Promise<Endorsement | null> {
  return db.transaction(async (tx) => {
    // scope-consistent read under the tenant GUC — mirror how the sibling readers set app.tenant_id;
    // reuse withTenant if that is this file's convention (check readMembershipTrustSet).
    const [row] = await tx
      .select({ endorsement: nodes.endorsement })
      .from(nodes)
      .where(and(eq(nodes.tenantId, tenantId), eq(nodes.id, nodeId)))
      .limit(1);
    return row?.endorsement ?? null;
  });
}
```

(Executor: match `readNodeEndorsement`'s tenant-scoping to how `readMembershipTrustSet`/`readNodeMembership` already read `nodes` — use `withTenant` if that is the established pattern for a `nodes` read on this connection, since `nodes` is FORCE-RLS. The body above shows the query; use the file's own scoping idiom.)

Export all three from `packages/db/src/index.ts` beside the other node accessors.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/db test reserved-identity` then `pnpm --filter @waitron/db test:coverage`
Expected: PASS. Then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — confirms the `nodes` column add did not regress the FORCE-RLS / tenant-isolation scan.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/nodes.ts packages/db/drizzle packages/db/src/reserved-identity.ts packages/db/src/reserved-identity.test.ts packages/db/src/index.ts
git commit -s -m "feat(db): nodes.endorsement column + reserved-identity accessors"
```

---

### Task 3: cloud-side standby-identity orchestration (`apps/server`)

**Files:**
- Create: `apps/server/src/reserved-identity.ts`
- Test: `apps/server/src/reserved-identity.test.ts` (create)

**Interfaces:**
- Consumes: `generateNodeKeyPair`, type `Endorsement` (`@waitron/membership`); `putCredential`, `tryGetCredential`, `KeyRing` (`@waitron/credentials`); `insertReservedNodeTx`, `insertReservedSeriesTx`, `withTenant`, `Database` (`@waitron/db`); `writeReservedSif` (`@waitron/fiscal-verifactu`); `randomUUID` (`node:crypto`); `tenantId as brandTenantId`, `nodeId as brandNodeId` (`@waitron/shared`).
- Produces:
  ```ts
  export interface StandbyIdentity {
    nodeId: string;
    publicKey: string;
    privateKey: string;
  }
  export function generateStandbyIdentity(): StandbyIdentity; // randomUUID nodeId + generateNodeKeyPair

  export interface ReservedIdentityBundle {
    nif: string;
    idSistemaInformatico: string;
    numeroInstalacion: number;
    series: readonly { code: string; purpose: string }[];
    endorsement: Endorsement;
  }
  export function establishReservedStandbyIdentity(
    deps: { ownerDb: Database; ring: KeyRing },
    args: {
      tenantId: string;
      locationId: string;
      standby: StandbyIdentity;
      nodeName: string;
      filingModule: string | null;
      taxModule: string | null;
      reserved: ReservedIdentityBundle;
    },
  ): Promise<void>;
  ```
  `establishReservedStandbyIdentity` is **idempotent** (spec §8): if `membership.node_key` is already sealed for the tenant, it is a NO-OP (the identity was established by an earlier adopt attempt; re-running must not mint a fresh keypair or a second reserved SIF). Otherwise, in ONE `withTenant(ownerDb, tenantId)` transaction it: seals the private key (`putCredential` purpose `membership.node_key`), inserts the reserved node (`insertReservedNodeTx`, carrying public_key + endorsement), persists the reserved SIF (`writeReservedSif`, using the primary-supplied `numeroInstalacion`), and inserts the reserved series (`insertReservedSeriesTx`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/reserved-identity.test.ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS, withTenant, type Database } from "@waitron/db";
import { FISCAL_MIGRATIONS, currentSif } from "@waitron/fiscal-verifactu"; // match the real export name for the fiscal migrations bundle
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { tenantId as brandTenantId, nodeId as brandNodeId } from "@waitron/shared";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import type { Endorsement } from "@waitron/membership";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const ENDORSEMENT: Endorsement = { nodeId: "n", publicKey: "p", endorsedBy: "e", signature: "s" };

describe("establishReservedStandbyIdentity", () => {
  const suite = usePgliteDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, FISCAL_MIGRATIONS],
    timeoutMs: 60_000,
  });
  // ...beforeAll: seedTenant (known tax_id NIF), insert a location; capture tenantId + locationId...

  it("establishes a dormant identity: sealed key, reserved node, reserved SIF, reserved series", async () => {
    const standby = generateStandbyIdentity();
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db, ring: RING },
      {
        tenantId, locationId, standby, nodeName: "cloud", filingModule: "verifactu", taxModule: "iva",
        reserved: {
          nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 7,
          series: [{ code: "FA-7", purpose: "standard" }], endorsement: { ...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey },
        },
      },
    );
    // sealed private key present
    const cred = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tryGetCredential(tx, RING, { tenantId: brandTenantId(tenantId), purpose: "membership.node_key" }),
    );
    expect(cred?.privateKey).toBe(standby.privateKey);
    // reserved SIF is the cloud node's live identity with the supplied number
    const sif = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      currentSif(tx, brandTenantId(tenantId), brandNodeId(standby.nodeId)),
    );
    expect(sif.numeroInstalacion).toBe(7);
  });

  it("is idempotent: a second call with a fresh identity is a no-op (keeps the first)", async () => {
    const first = generateStandbyIdentity();
    const base = { tenantId, locationId, nodeName: "cloud", filingModule: null, taxModule: null };
    await establishReservedStandbyIdentity({ ownerDb: suite.db, ring: RING }, { ...base, standby: first, reserved: { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 1, series: [], endorsement: { ...ENDORSEMENT } } });
    const second = generateStandbyIdentity();
    await establishReservedStandbyIdentity({ ownerDb: suite.db, ring: RING }, { ...base, standby: second, reserved: { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 2, series: [], endorsement: { ...ENDORSEMENT } } });
    // the vault still holds the FIRST key; the SECOND node has no reserved SIF
    const cred = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tryGetCredential(tx, RING, { tenantId: brandTenantId(tenantId), purpose: "membership.node_key" }),
    );
    expect(cred?.privateKey).toBe(first.privateKey);
    const rows = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from registro_sif where node_id = ${second.nodeId}`),
    );
    expect(rows.rows[0]!.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test reserved-identity`
Expected: FAIL — `reserved-identity.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/reserved-identity.ts
import { randomUUID } from "node:crypto";
import { generateNodeKeyPair, type Endorsement } from "@waitron/membership";
import { putCredential, tryGetCredential, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  insertReservedSeriesTx,
  withTenant,
  type Database,
} from "@waitron/db";
import { writeReservedSif } from "@waitron/fiscal-verifactu";
import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
import "./errors.js";

export interface StandbyIdentity {
  nodeId: string;
  publicKey: string;
  privateKey: string;
}

/** Mint a standby's own identity in memory (design §6 R2): a fresh nodeId + Ed25519 keypair. Generated
 * BEFORE the adopt fetch so the public half + nodeId can be sent to the primary for endorsement +
 * number allocation; the private half is sealed by `establishReservedStandbyIdentity` after the tenant
 * exists (the vault FK is restrict). */
export function generateStandbyIdentity(): StandbyIdentity {
  const { publicKey, privateKey } = generateNodeKeyPair();
  return { nodeId: randomUUID(), publicKey, privateKey };
}

export interface ReservedIdentityBundle {
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: number;
  series: readonly { code: string; purpose: string }[];
  endorsement: Endorsement;
}

/**
 * Persist the standby's complete dormant identity on the cloud's own database (design §6 R2), all
 * inert until an R3 promotion activates it. IDEMPOTENT (design §8 / Slice-4 follow-up b): if the
 * membership key is already sealed, an earlier adopt attempt already established the identity — return
 * without minting a fresh keypair or a second reserved SIF (a re-fetch may have burned one cheap
 * primary number, which is acceptable; §7). Otherwise ONE owner tenant transaction seals the private
 * key, inserts the standby's own node (public_key + endorsement), persists the reserved SIF with the
 * PRIMARY-supplied number, and inserts the reserved series.
 */
export async function establishReservedStandbyIdentity(
  deps: { ownerDb: Database; ring: KeyRing },
  args: {
    tenantId: string;
    locationId: string;
    standby: StandbyIdentity;
    nodeName: string;
    filingModule: string | null;
    taxModule: string | null;
    reserved: ReservedIdentityBundle;
  },
): Promise<void> {
  const tenant = brandTenantId(args.tenantId);
  await withTenant(deps.ownerDb, tenant, async (tx) => {
    const existing = await tryGetCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: "membership.node_key",
    });
    if (existing !== null) return; // already established — idempotent no-op

    await putCredential(tx, deps.ring, {
      tenantId: tenant,
      purpose: "membership.node_key",
      value: { privateKey: args.standby.privateKey },
    });
    await insertReservedNodeTx(tx, {
      id: args.standby.nodeId,
      tenantId: args.tenantId,
      locationId: args.locationId,
      name: args.nodeName,
      filingModule: args.filingModule,
      taxModule: args.taxModule,
      publicKey: args.standby.publicKey,
      endorsement: args.reserved.endorsement,
    });
    await writeReservedSif(tx, {
      tenantId: tenant,
      nodeId: brandNodeId(args.standby.nodeId),
      nif: args.reserved.nif,
      idSistemaInformatico: args.reserved.idSistemaInformatico,
      numeroInstalacion: args.reserved.numeroInstalacion,
    });
    await insertReservedSeriesTx(
      tx,
      args.reserved.series.map((s) => ({
        tenantId: args.tenantId,
        nodeId: args.standby.nodeId,
        code: s.code,
        purpose: s.purpose,
      })),
    );
  });
}
```

(Executor: confirm `tryGetCredential` returns `null` when absent — the barrel exports it; the primary's `establishNodeIdentity` uses `getCredential`, which throws `credentials.missing`, so use `tryGetCredential` here for the presence check.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server test reserved-identity`
Expected: PASS (establishes; idempotent no-op).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/reserved-identity.ts apps/server/src/reserved-identity.test.ts
git commit -s -m "feat(server): establishReservedStandbyIdentity — cloud-side dormant identity persist"
```

---

### Task 4: primary bundle-mint reserves the identity (`assembleMirrorBundle` + endpoint)

**Files:**
- Modify: `apps/server/src/mirror-bundle.ts`
- Modify: `apps/server/src/mirror-bundle-api.ts`
- Test: `apps/server/src/mirror-bundle-api.rls.test.ts` (extend), `apps/server/src/mirror-bundle.rls.test.ts` (extend if it drives assemble directly)

**Interfaces:**
- Consumes: `reserveInstallationNumber`, `currentSif` (`@waitron/fiscal-verifactu`); `endorseKey`, type `Endorsement` (`@waitron/membership`); `readNodeIdentityKey` (`./node-identity.js`); `invoiceSeries`, `withTenant` (`@waitron/db`); `KeyRing` (`@waitron/credentials`).
- Produces (extends existing types):
  ```ts
  // mirror-bundle.ts
  export interface ReservedIdentity {
    nif: string;
    idSistemaInformatico: string;
    numeroInstalacion: number;
    series: { code: string; purpose: string }[];
    endorsement: Endorsement;
  }
  export interface MirrorBundle { /* ...existing... */ reservedIdentity: ReservedIdentity; }
  export interface AssembleDeps { /* ...existing... */ ring: KeyRing; standby: { nodeId: string; publicKey: string }; }
  // mirror-bundle-api.ts
  export interface MirrorBundleApiDeps { /* ...existing... */ ring: KeyRing; }
  ```
  The request body the endpoint reads gains `standbyNodeId: string` (uuid) + `standbyPublicKey: string` (non-empty), field-screened exactly like the credential fields (reject → `password.invalid`? No — use a new `mirror.standby_invalid`, see below).

**New error code:** `mirror.standby_invalid` (`{}`) in `apps/server/src/errors.ts`, mapped to 400 in the endpoint STATUS. Rationale: a malformed standby identity is a distinct client fault from bad credentials; do not overload `password.invalid` (which maps 401 and would mislead).

- [ ] **Step 1: Write the failing test** (extend `mirror-bundle-api.rls.test.ts`)

```ts
it("returns a reserved identity: a fresh number, disjoint series, and a valid endorsement", async () => {
  // The primary is provisioned with series FA (standard) + RF (rectificative) and an established node
  // identity (establishNodeIdentity). POST with a standby nodeId + public key.
  const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };
  const res = await app.request("/management-api/mirror-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password, standbyNodeId: standby.nodeId, standbyPublicKey: standby.publicKey }),
  });
  expect(res.status).toBe(200);
  const bundle = await res.json();
  const r = bundle.reservedIdentity;
  expect(r.numeroInstalacion).toBeGreaterThan(0);
  // disjoint series: every reserved code differs from the primary's own, one per primary series
  expect(r.series.map((s: any) => s.code).sort()).toEqual([`FA-${r.numeroInstalacion}`, `RF-${r.numeroInstalacion}`].sort());
  // the endorsement vouches for THIS standby and verifies against the primary's public key
  expect(r.endorsement.nodeId).toBe(standby.nodeId);
  expect(r.endorsement.publicKey).toBe(standby.publicKey);
  expect(r.endorsement.endorsedBy).toBe(PRIMARY_NODE_ID);
  // (verify with resolveSignerKey-equivalent: build a trust set {PRIMARY_NODE_ID: PRIMARY_PUB} and
  //  verifyBytes(canonicalize({nodeId,publicKey}), signature, PRIMARY_PUB) === true — or reuse the
  //  membership package's verify surface if one fits.)
});

it("rejects a missing/malformed standby identity with 400 mirror.standby_invalid", async () => {
  const res = await app.request("/management-api/mirror-bundle", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password }), // no standby fields
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error.code).toBe("mirror.standby_invalid");
});
```

(The suite already provisions a primary and authorises an admin; extend its setup to run `establishNodeIdentity` for the primary node — mirror how the node-identity / adopt.rls tests establish it — and to seed FA/RF series if the fixture does not already. Capture `PRIMARY_NODE_ID`/`PRIMARY_PUB`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test mirror-bundle-api`
Expected: FAIL — no `reservedIdentity`; standby fields unread.

- [ ] **Step 3: Write minimal implementation**

In `mirror-bundle.ts`, add `ReservedIdentity`, extend `MirrorBundle` + `AssembleDeps`, and in `assembleMirrorBundle` (inside a `withTenant(deps.appDb, tenantId)` tx — the same scope already used for the row reads) compute the reservation:

```ts
// after the parent rows are read, still in scope of appDb:
const reservedIdentity = await withTenant(deps.appDb, deps.designated.tenantId, async (tx) => {
  const primarySif = await currentSif(tx, brandTenantId(deps.designated.tenantId), brandNodeId(deps.designated.nodeId));
  const numeroInstalacion = await reserveInstallationNumber(tx, {
    nif: primarySif.nif,
    idSistemaInformatico: primarySif.idSistemaInformatico,
  });
  const primarySeries = await tx
    .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.nodeId, deps.designated.nodeId));
  const series = primarySeries.map((s) => ({ code: `${s.code}-${numeroInstalacion}`, purpose: s.purpose }));
  return { primarySif, numeroInstalacion, series };
});
const primaryKey = await readNodeIdentityKey(deps.appDb, deps.ring, deps.designated.tenantId);
const endorsement = endorseKey(
  deps.standby.nodeId,
  deps.standby.publicKey,
  deps.designated.nodeId,
  primaryKey,
);
// include in the returned bundle:
reservedIdentity: {
  nif: reservedIdentity.primarySif.nif,
  idSistemaInformatico: reservedIdentity.primarySif.idSistemaInformatico,
  numeroInstalacion: reservedIdentity.numeroInstalacion,
  series: reservedIdentity.series,
  endorsement,
},
```

(Executor: fold the above into `assembleMirrorBundle`'s existing structure cleanly — one extra `withTenant` block for the fiscal reads/writes plus the key read + endorse; import `eq` from drizzle-orm and the brand helpers. `currentSif` throwing `sif.not_registered` correctly surfaces a primary that was never registered — an impossible state for a trading primary, but let it propagate.)

In `mirror-bundle-api.ts`: add `ring` to `MirrorBundleApiDeps`; read `standbyNodeId`/`standbyPublicKey` from the body alongside the credential; field-screen (`isUuid(standbyNodeId)` && non-empty string `standbyPublicKey`) → else `throw new AppError("mirror.standby_invalid", {})`; add it to `STATUS` as 400; pass `ring` + `standby: { nodeId, publicKey }` into `assembleMirrorBundle`. Add `mirror.standby_invalid` to `apps/server/src/errors.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server test mirror-bundle-api mirror-bundle`
Expected: PASS. Confirm the existing auth/relay/token cases still pass (behaviour preserved; the token must still never appear in logs).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mirror-bundle.ts apps/server/src/mirror-bundle-api.ts apps/server/src/errors.ts apps/server/src/mirror-bundle-api.rls.test.ts apps/server/src/mirror-bundle.rls.test.ts
git commit -s -m "feat(server): primary reserves the standby's SIF + endorses its key in the mirror bundle"
```

---

### Task 5: wire the round-trip end to end (fetch + adopt + boot + e2e)

**Files:**
- Modify: `apps/server/src/mirror-bundle-fetch.ts`
- Modify: `apps/server/src/adopt.ts`
- Modify: `apps/server/src/boot.ts`
- Test: `apps/server/src/adopt.rls.test.ts` (extend), `apps/server/src/adopt-e2e.rls.test.ts` (extend), `apps/server/src/mirror-bundle-fetch.test.ts` (extend)

**Interfaces:**
- `fetchMirrorBundle(primaryUrl: string, credential: AdoptCredential, standby: { nodeId: string; publicKey: string }): Promise<MirrorBundle>` — sends `{ ...credential, standbyNodeId, standbyPublicKey }` as the JSON body.
- `AdoptDeps.fetchBundle: (primaryUrl, credential, standby) => Promise<MirrorBundle>` — signature widened to match.
- `adoptFromPrimary` generates the standby identity, threads it into the fetch, and after `adoptVenue` calls `establishReservedStandbyIdentity` before `sealMirrorToken`. It reads the cloud node's name/filing/tax from the designated node row in `bundle.rows.nodes` (the primary's, matched by `designated.nodeId`) so the dormant node mirrors the primary's modules.

- [ ] **Step 1: Write the failing test** (extend `adopt.rls.test.ts`)

```ts
it("establishes the standby's dormant identity from the bundle's reservedIdentity", async () => {
  // Hand-build a bundle (as the suite already does) that now carries reservedIdentity, and stub
  // fetchBundle to (a) capture the standby arg and (b) return that bundle.
  // After adoptFromPrimary:
  //  - a sealed membership.node_key exists on the mirror (the standby's private key)
  //  - a reserved registro_sif exists keyed to the standby's OWN nodeId (revocado_en null), number = reserved.numeroInstalacion
  //  - NO registro_sif exists for designated.nodeId (config.till.nodeId) — the mirror still has no LIVE selling SIF
  //  - the standby's nodes row carries the endorsement
  expect(fetchArgs.standby.nodeId).toBeDefined();
  const reservedSif = await withTenant(ownerDb, tenantId, (tx) =>
    tx.execute(sql`select numero_instalacion, node_id from registro_sif where revocado_en is null`));
  // exactly one, keyed to a node id !== designated.nodeId
  expect(reservedSif.rows).toHaveLength(1);
  expect(reservedSif.rows[0].node_id).not.toBe(designated.nodeId);
});
```

Extend `mirror-bundle-fetch.test.ts` to assert the request body now includes `standbyNodeId`/`standbyPublicKey`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test adopt mirror-bundle-fetch`
Expected: FAIL — `fetchBundle` takes two args; no reserved identity persisted.

- [ ] **Step 3: Write minimal implementation**

In `mirror-bundle-fetch.ts`, widen `fetchMirrorBundle` to take `standby` and serialize `{ ...credential, standbyNodeId: standby.nodeId, standbyPublicKey: standby.publicKey }` as the body.

In `adopt.ts`:
- widen `AdoptDeps.fetchBundle` and add nothing else to deps (`ownerDb` + `ring` are already present).
- in `adoptFromPrimary`: `const standby = generateStandbyIdentity();` before the fetch; `const bundle = await deps.fetchBundle(req.primaryUrl, req.credential, { nodeId: standby.nodeId, publicKey: standby.publicKey });`
- after `await adoptVenue(...)` and before `sealMirrorToken`, add:
  ```ts
  const primaryNode = bundle.rows.nodes.find((n) => n.id === designated.nodeId);
  await establishReservedStandbyIdentity(
    { ownerDb: deps.ownerDb, ring: deps.ring },
    {
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      standby,
      nodeName: `${(primaryNode?.name as string) ?? "venue"} (standby)`,
      filingModule: (primaryNode?.filingModule as string | null) ?? null,
      taxModule: (primaryNode?.taxModule as string | null) ?? null,
      reserved: bundle.reservedIdentity,
    },
  );
  ```
  (Executor: `bundle.rows.nodes` rows are `$inferInsert` camelCase — `id`, `name`, `filingModule`, `taxModule`. Cast as needed; they are `VenueRow` = `Record<string, unknown>`.)

In `boot.ts`: pass `ring` into the `mountMirrorBundleApi(...)` deps (trading-primary branch, ~line 1436-1456) — `ring` is already in scope there (used for `sealAeat`/identity). The setup-mode `adoptFromPrimary` closure already passes `ring`; the `fetchBundle: fetchMirrorBundle` binding now matches the widened three-arg signature automatically (the closure passes it through unchanged — verify no explicit arg list needs updating).

- [ ] **Step 4: Run the unit + endpoint tests**

Run: `pnpm --filter @waitron/server test adopt mirror-bundle-fetch`
Expected: PASS.

- [ ] **Step 5: Extend the headline adopt e2e**

In `adopt-e2e.rls.test.ts`: the primary side already mounts `mountMirrorBundleApi` over real HTTP; add `ring` to that mount's deps and ensure the primary node has an established identity + FA/RF series (mirror the primary provision the suite does). After the mirror reboots into mirror mode, REPLACE the current "no `registro_sif` on mirror" assertion (≈ lines 521-522) with the R2 reality, preserving its intent (the mirror never forks the primary's chain / has no LIVE selling SIF):

```ts
// R2: the mirror now holds exactly ONE reserved (dormant) registro_sif, keyed to its OWN nodeId —
// NOT to config.till.nodeId (the primary's), so no sale resolves it and the box still serves read-only.
const mirrorSifs = await withTenant(mirrorOwnerDb, tenantId, (tx) =>
  tx.execute<{ node_id: string }>(sql`select node_id from registro_sif where revocado_en is null`));
expect(mirrorSifs.rows).toHaveLength(1);
expect(mirrorSifs.rows[0]!.node_id).not.toBe(config.till.nodeId); // still no live SIF for the selling node
// the primary still has its own one (unchanged)
```

Keep the existing "writes return 403 `node.read_only`" assertion — the reserved identity must NOT make the mirror sellable (it is dormant; `config.till.nodeId` is unchanged and `deployment.mode` is still `mirror`). Confirm the round-trip: the standby's sealed key + endorsement are present on the mirror.

- [ ] **Step 6: Run the e2e + full server coverage**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test adopt-e2e` then `pnpm --filter @waitron/server test:coverage`
Expected: PASS, coverage ≥ 98/98/98/95. (Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally — CLAUDE.md §4 / memory.)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/mirror-bundle-fetch.ts apps/server/src/adopt.ts apps/server/src/boot.ts apps/server/src/adopt.rls.test.ts apps/server/src/adopt-e2e.rls.test.ts apps/server/src/mirror-bundle-fetch.test.ts
git commit -s -m "feat(server): reserve the cloud's dormant identity at adopt (R2 round-trip end to end)"
```

---

## Self-review

**Spec coverage (§6 R2):**
- "the cloud generates its keypair (private sealed locally), sends its public key + its own nodeId to the primary" → Task 3 `generateStandbyIdentity` (in-memory) + Task 5 `fetchMirrorBundle(…, standby)` sends them; Task 3 seals the private key.
- "the primary allocates the installation number (single-writer §4)" → Task 1 `reserveInstallationNumber` (bumps `contadores_instalacion`), called by Task 4 in `assembleMirrorBundle`.
- "computes the disjoint series" → Task 4 derives `<code>-<numeroInstalacion>` from the primary's own series (Decision 1).
- "endorses the cloud's key" → Task 4 `endorseKey(standby, primaryNode, primaryKey)` via `readNodeIdentityKey`.
- "the bundle returns the number, series, and endorsement" → Task 4 `MirrorBundle.reservedIdentity`.
- "The cloud persists a dormant nodes row + a reserved registro_sif (using the primary-supplied number, not re-allocating) + reserved invoice_series rows + the sealed private key + the endorsement" → Task 2 accessors + Task 1 `writeReservedSif` + Task 3 orchestration.
- "all inert; config.till.nodeId is unchanged" → Task 5 does NOT touch `config.till`/`persistTrading`'s nodeId; the reserved SIF is keyed to the standby nodeId; e2e asserts read-only preserved + no live SIF for the selling node.
- "This isolates the sync-axis ripple into R3" → no `deployment`/subscriber-id/boot-invariant change in this plan.
- §8 "R2 must guard the standby's establish so a re-run cannot mint a fresh keypair and orphan a previously-signed document" → Task 3 idempotent no-op keyed on the sealed `membership.node_key`.
- §7 fiscal receipts (never-reuse via `registro_sif_instalacion_uq`, series isolation, new chain, lawful SIF virtuales, immutability untouched) → Tasks 1-3 honour each; Global Constraints restate them; `inmutabilidad` run in Tasks 1-2.

**Placeholder scan:** the only abstracted items are test-fixture setup helper names in Tasks 1-5 (`withTx`, `NIF`, `TENANT`, `personId`, the suites' existing seed/provision helpers) — every one is flagged inline to reuse the existing suite's setup rather than invent names, and every production code block is complete. No "TODO"/"add validation"/"similar to Task N".

**Type consistency:** `ReservedIdentity` (Task 4) ↔ `ReservedIdentityBundle` (Task 3) carry the same fields (`nif`, `idSistemaInformatico`, `numeroInstalacion`, `series: {code,purpose}[]`, `endorsement`); the bundle field is `reservedIdentity`, read by Task 5 as `bundle.reservedIdentity`. `StandbyIdentity` (Task 3) `{nodeId,publicKey,privateKey}` matches the `standby` arg Task 5 passes to `fetchMirrorBundle`/`AssembleDeps.standby` (which uses only `{nodeId,publicKey}`). `insertReservedNodeTx`/`insertReservedSeriesTx`/`writeReservedSif` signatures (Tasks 1-2) match their Task-3 call sites. `fetchMirrorBundle`'s three-arg form (Task 5) matches `AdoptDeps.fetchBundle`.

**Open for R3 (out of scope, do NOT build here):** switching `config.till.nodeId` to the standby's own; the sync-axis split (subscriber id vs pulled origin, `boot.ts:1073` invariant); activating the SIF; minting the promotion document signed with the cloud's own endorsed key (reads `readNodeEndorsement` + `readNodeIdentityKey`); the term-guard on promote's document write (spec §8 R3 sharp edge). H2 (fiscal-record sync) is independent.
