# Membership Promotion R3b — cloud/mirror promotion (restart-into-primary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an adopted read-only cloud mirror into the venue's primary on the identity it already holds (R3a) — a mode/role flip with an endorsed, term-guarded membership document and a corrected numbering series, followed by a restart into `mode=primary`. No identity switch, no SIF re-mint: the reserved SIF and disjoint series established at adopt (R2) simply become live.

**Architecture:** R3a already made the cloud run under its OWN nodeId (`config.till.nodeId`), with its own dormant `registro_sif` (fresh both-null chain head), reserved disjoint `invoice_series`, sealed `membership.node_key`, and the primary's endorsement of its key on `nodes.endorsement`. R3b adds the missing **mirror → primary** promote path (parent SIF spec §5b). The promote (1) builds+signs the next membership document with the cloud's OWN key, attaching the primary's endorsement so peers that trust only the primary transitively trust it — all BEFORE the point-of-no-return; (2) commits, in ONE owner transaction, `mode → primary`, `singleton_role → primary`, and the **term-guarded** document write; (3) the boot wiring then corrects `config.till.seriesId` to the cloud's own reserved standard series, persists `trading.env`, and restarts. On reboot the box comes up `mode=primary`: `currentSif(config.till.nodeId)` returns the reserved SIF (now the live selling SIF), the primary-only workers start, and the pull subscriber does not (the old primary is dead).

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (PGlite hermetic for logic; real Postgres via Testcontainers for the RLS/e2e suites), Drizzle ORM. **No new migration** — R3b writes only into rows R2 already created (`nodes`/`registro_sif`/`invoice_series`/`node_membership`/`deployment`).

**Spec:** `docs/superpowers/specs/2026-09-04-membership-promotion-r3-cloud-promotion-design.md` — this plan implements **§4 (R3b)** only. §3 (R3a) LANDED (#210). Parent arc spec: `docs/superpowers/specs/2026-09-03-reserved-standby-identity-and-promotion-design.md`.

## Global Constraints

- **Fiscal invariants are unrecoverable (CLAUDE.md §5).** R3b must NEVER call `registerSif` (that revokes + re-mints, burning a second `numeroInstalacion` and forking a chain). The reserved SIF is only *used*: once `mode=primary` under the cloud's own nodeId, `currentSif(tenant, ownNodeId)` returns the reserved row directly (`revocadoEn IS NULL`) — no activation, no status flip. R3b writes `deployment` + `node_membership` + `trading.env` only; it touches no fiscal record and no chain.
- **Series isolation is fiscal.** The corrected `seriesId` MUST be the cloud's own reserved STANDARD series (code `<primaryCode>-<numeroInstalacion>`, from `deriveReservedSeriesCodes` at R2), NEVER the primary's `designated.seriesId` (which adopt left inert). Two nodes emitting the same `NumSerieFactura` under one NIF is exactly the AEAT-3000 collision the disjoint series prevent.
- **No backwards-compat / data-migration code** (CLAUDE.md §3) — pre-production.
- **One transaction for the point-of-no-return (CLAUDE.md §3).** The `mode` flip, the `singleton_role` flip, and the document write commit together or not at all. The `deployment_role_valid_ck` CHECK forbids the transient `(mirror, primary)` pair, so within that transaction set `mode='primary'` (leaving `singleton_role='secondary'`) BEFORE `singleton_role='primary'` — the intermediate `(primary, secondary)` is valid, `(mirror, primary)` is never written.
- **Everything before the PONR is abortable with zero lasting effect** (parent spec §7): the document read+build+sign and the series-id read are all reads/in-memory; a failure there leaves the mirror exactly as it was.
- **The term-guard is the parent spec §8 "R3 sharp edge".** A promote that read held term N could race a gossip-adopt landing term N+k and regress it. R3b's document write goes through the **term-guarded** `persistNodeMembershipIfNewer` (a `Tx` variant, joining the PONR transaction), and if that write is NOT accepted (a concurrent ≥ term already landed) the WHOLE PONR transaction aborts with `promotion.membership_superseded` — the flip does not commit against a superseded org chart. Idempotent re-run recovers.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** (CLAUDE.md §3); codes are never renamed once shipped. Every file that throws a code imports its registry (`import "./errors.js"`). R3b adds `promotion.membership_superseded` (apps/server) and `series.no_standard_for_node` (@waitron/db).
- **`withTenant` for any RLS-scoped read/write.** `nodes` and `invoice_series` are FORCE-RLS; reads run under `withTenant` on `app_user`'s SELECT (the pattern `readNodeEndorsement`/`readMembershipTrustSet` use).
- **Gate before each commit:** `pnpm lint && pnpm typecheck && pnpm format:check`, and the touched package's `test:coverage` (not bare `test`) — thresholds `98/98/98/95` for `@waitron/db` and `apps/server`. Real-PG/e2e suites need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **Model selection (memory):** implementation subagents run on Opus 5; planning/orchestration on Opus 4.8.

---

## File structure

- `packages/db/src/node-membership.ts` (modify) — add `persistNodeMembershipIfNewerTx(tx, document)`; refactor `persistNodeMembershipIfNewer` to delegate. Test: `packages/db/src/node-membership.test.ts`.
- `packages/db/src/deployment.ts` (modify) — add `setDeploymentModeTx(tx, mode)`; refactor `setDeploymentMode` to delegate. Test: `packages/db/src/deployment.test.ts` (or the file that already covers `setDeploymentMode` — grep).
- `packages/db/src/reserved-identity.ts` (modify) — add `readStandardSeriesId(db, tenantId, nodeId)`. `packages/db/src/errors.ts` (modify) — add `series.no_standard_for_node`. `packages/db/src/index.ts` (modify) — export `persistNodeMembershipIfNewerTx`, `setDeploymentModeTx`, `readStandardSeriesId`. Test: `packages/db/src/reserved-identity.test.ts` (grep; create if absent, mirroring a sibling).
- `apps/server/src/membership-mint.ts` (modify) — accept + forward optional `endorsements`.
- `apps/server/src/promote.ts` (modify) — add `promoteMirrorToPrimary(deps, attestation)` + its `PromoteMirrorDeps`/`MirrorPromotionResult`; keep `promoteLocalSecondaryToPrimary` refusing a mirror unchanged. `apps/server/src/errors.ts` (modify) — add `promotion.membership_superseded`. Test: `apps/server/src/promote.test.ts` (extend) + a new `apps/server/src/promote-mirror.rls.test.ts` if a real-PG suite is warranted.
- `apps/server/src/boot.ts` (modify) — expose `promoteMirrorToPrimary?` on `StartedServer` in mirror mode; wire the closure (promote → persist corrected trading.env → restart). Test: `apps/server/src/boot.promote.test.ts` (extend) and/or `apps/server/src/adopt-e2e.rls.test.ts` (extend the headline mirror e2e).

---

### Task 1: PONR transaction primitives — `Tx` variants (`@waitron/db`)

The point-of-no-return is ONE owner transaction. Two of its three writes only have own-transaction accessors today; add `Tx` siblings so all three share one transaction.

**Files:**
- Modify: `packages/db/src/node-membership.ts`
- Modify: `packages/db/src/deployment.ts`
- Modify: `packages/db/src/index.ts` (export both)
- Test: `packages/db/src/node-membership.test.ts`, `packages/db/src/deployment.test.ts` (grep for the file already testing `setDeploymentMode`)

**Interfaces:**
- Produces: `persistNodeMembershipIfNewerTx(tx: Transaction, document: SignedMembershipDocument): Promise<boolean>` — the term-guarded upsert on a caller tx, returns `true` iff a row changed (strictly-newer accepted). `setDeploymentModeTx(tx: Transaction, mode: DeploymentMode): Promise<void>` — the mode flip on a caller tx, same co-set + fail-loud contract as `setDeploymentMode`.

- [ ] **Step 1: write the failing test for `persistNodeMembershipIfNewerTx`**

In `packages/db/src/node-membership.test.ts` (read it first; reuse its `doc(term)` fixture and db setup), add a suite that proves the tx variant term-guards inside a caller transaction and can be rolled back:

```ts
it("persistNodeMembershipIfNewerTx accepts a strictly-newer doc on a caller tx", async () => {
  await writeNodeMembership(db, doc(3));
  const accepted = await db.transaction((tx) => persistNodeMembershipIfNewerTx(tx, doc(4)));
  expect(accepted).toBe(true);
  expect((await readNodeMembership(db))?.body.term).toBe(4);
});

it("persistNodeMembershipIfNewerTx rejects a non-newer doc (returns false, no write)", async () => {
  await writeNodeMembership(db, doc(5));
  const accepted = await db.transaction((tx) => persistNodeMembershipIfNewerTx(tx, doc(5)));
  expect(accepted).toBe(false);
  expect((await readNodeMembership(db))?.body.term).toBe(5);
});

it("a false return lets the caller roll back the whole transaction", async () => {
  await writeNodeMembership(db, doc(7));
  await expect(
    db.transaction(async (tx) => {
      const accepted = await persistNodeMembershipIfNewerTx(tx, doc(6));
      if (!accepted) throw new Error("superseded"); // caller's abort
    }),
  ).rejects.toThrow("superseded");
  expect((await readNodeMembership(db))?.body.term).toBe(7); // untouched
});
```

Import `persistNodeMembershipIfNewerTx` from the barrel (add it to the imports).

- [ ] **Step 2: run it to verify it fails**

Run: `pnpm --filter @waitron/db test node-membership`
Expected: FAIL — `persistNodeMembershipIfNewerTx` is not exported.

- [ ] **Step 3: implement `persistNodeMembershipIfNewerTx` and delegate**

In `packages/db/src/node-membership.ts`, extract the tx variant and have the `Database` version open a transaction and delegate (preserving the existing behaviour + doc comment):

```ts
/** The term-guarded singleton upsert on a caller-provided transaction — the atomic monotonic backstop
 * (accept iff strictly newer) that a caller can commit in the SAME transaction as a related write
 * (CLAUDE.md §3). Returns `true` iff a row actually changed; a `false` means a concurrent ≥ term is
 * already held, and the caller decides whether to abort the transaction. R3b's mirror→primary promote
 * commits it with the `deployment` flip so the org chart cannot regress under a gossip-adopt race
 * (spec §8 "R3 sharp edge"); `persistNodeMembershipIfNewer` is this on its own transaction. */
export async function persistNodeMembershipIfNewerTx(
  tx: Transaction,
  document: SignedMembershipDocument,
): Promise<boolean> {
  const term = document.body.term;
  const rows = await tx
    .insert(nodeMembership)
    .values({ id: 1, term, document })
    .onConflictDoUpdate({
      target: nodeMembership.id,
      set: { term, document, updatedAt: sql`now()` },
      setWhere: sql`${nodeMembership.term} < ${term}`,
    })
    .returning({ id: nodeMembership.id });
  return rows.length > 0;
}
```

Then rewrite `persistNodeMembershipIfNewer` to delegate: `return db.transaction((tx) => persistNodeMembershipIfNewerTx(tx, document));`. Confirm `Transaction` is imported (it is used elsewhere in the file — check the import from `./client.js`).

- [ ] **Step 4: run it to verify it passes**

Run: `pnpm --filter @waitron/db test node-membership` → PASS. The pre-existing `persistNodeMembershipIfNewer` tests must still pass (proves the delegate is behaviour-preserving — CLAUDE.md: preserve behavioural assertions).

- [ ] **Step 5: write the failing test for `setDeploymentModeTx`**

Grep for the suite that already covers `setDeploymentMode` (`grep -rl "setDeploymentMode" packages/db/src/*.test.ts`); add there (reuse its stamped-db setup):

```ts
it("setDeploymentModeTx flips mode on a caller tx and co-sets singleton_role for mirror", async () => {
  await db.transaction((tx) => setDeploymentModeTx(tx, "mirror"));
  expect(await readDeploymentMode(db)).toBe("mirror");
  expect(await readSingletonRole(db)).toBe("secondary");
});

it("setDeploymentModeTx to primary leaves singleton_role untouched", async () => {
  await setSingletonRole(db, "secondary");
  await setDeploymentMode(db, "mirror"); // (mirror, secondary)
  await db.transaction(async (tx) => {
    await setDeploymentModeTx(tx, "primary"); // (primary, secondary) — valid, no CHECK violation
    await setSingletonRoleTx(tx, "primary"); // (primary, primary)
  });
  expect(await readDeploymentMode(db)).toBe("primary");
  expect(await readSingletonRole(db)).toBe("primary");
});
```

- [ ] **Step 6: run it, verify it fails, implement, verify it passes**

Run: `pnpm --filter @waitron/db test <that-file>` → FAIL (`setDeploymentModeTx` not exported). Then in `packages/db/src/deployment.ts` extract `setDeploymentModeTx(tx, mode)` from `setDeploymentMode` (same co-set-for-mirror + fail-loud-on-0-rows logic, but on `tx.execute`), and have `setDeploymentMode` delegate via `db.transaction`. Re-run → PASS, and the pre-existing `setDeploymentMode` tests still pass.

- [ ] **Step 7: export both from the barrel + gate**

Add `persistNodeMembershipIfNewerTx` and `setDeploymentModeTx` to `packages/db/src/index.ts`. Run: `pnpm --filter @waitron/db test:coverage`, then `pnpm lint && pnpm typecheck && pnpm format:check`.

- [ ] **Step 8: commit**

```bash
git add packages/db/src/node-membership.ts packages/db/src/node-membership.test.ts packages/db/src/deployment.ts packages/db/src/index.ts packages/db/src/*.test.ts
git commit -s -m "feat(db): Tx variants of the PONR primitives — persistNodeMembershipIfNewerTx, setDeploymentModeTx"
```

---

### Task 2: `readStandardSeriesId` — the cloud's own reserved standard series (`@waitron/db`)

R3b corrects `config.till.seriesId` to the cloud's OWN reserved standard series id. Its rows were inserted at adopt (`insertReservedSeriesTx`) with generated ids that were never echoed back, so R3b must read the id by `(tenant, node, purpose='standard')`.

**Files:**
- Modify: `packages/db/src/reserved-identity.ts` (add the reader)
- Modify: `packages/db/src/errors.ts` (add `series.no_standard_for_node`)
- Modify: `packages/db/src/index.ts` (export `readStandardSeriesId`)
- Test: `packages/db/src/reserved-identity.test.ts` (grep; if absent, create mirroring `mirror-config.test.ts`'s db-accessor shape)

**Interfaces:**
- Produces: `readStandardSeriesId(db: Database, tenantId: string, nodeId: string): Promise<string>` — the id of the node's `purpose='standard'` `invoice_series` row; throws `series.no_standard_for_node` if none.

- [ ] **Step 1: add the error code**

In `packages/db/src/errors.ts`, in the `series.*` group (beside `series.not_found`), add — matching the domain-concept doc style of its siblings:

```ts
    /**
     * A node has no `purpose='standard'` invoice series. Reached by R3b's mirror→primary promote when
     * correcting `config.till.seriesId` to the cloud's OWN reserved standard series (the code the primary
     * derived at adopt, `<primaryCode>-<numeroInstalacion>`). A promoted cloud always has one (R2
     * established it), so this is a corruption/misuse refusal, structured so it reaches a screen
     * translatable rather than a raw empty-result crash — the shape `sif.not_registered` follows.
     * `series.*` names the domain concept; never renamed once shipped.
     */
    "series.no_standard_for_node": { tenantId: string; nodeId: string };
```

- [ ] **Step 2: write the failing test**

In `packages/db/src/reserved-identity.test.ts` (read a sibling first for the CORE-migrations + tenant/node seed + `asAppUser`/owner-db setup; `insertReservedSeriesTx` runs owner-role under `withTenant`, the read runs `app_user` under `withTenant`):

```ts
it("readStandardSeriesId returns the node's standard series id, not the rectificative", async () => {
  // seed a node under a tenant, then insert its reserved series (standard + rectificative)
  await withTenant(ownerDb, brandTenantId(tenantId), (tx) =>
    insertReservedSeriesTx(tx, [
      { tenantId, nodeId, code: "F-42", purpose: "standard" },
      { tenantId, nodeId, code: "R-42", purpose: "rectificative" },
    ]),
  );
  const id = await readStandardSeriesId(appDb, tenantId, nodeId);
  // it is a real series row, of purpose 'standard'
  const [row] = await withTenant(appDb, brandTenantId(tenantId), (tx) =>
    tx.select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose }).from(invoiceSeries).where(eq(invoiceSeries.id, id)),
  );
  expect(row).toEqual({ code: "F-42", purpose: "standard" });
});

it("readStandardSeriesId throws series.no_standard_for_node when the node has none", async () => {
  const err = await captureError(() => readStandardSeriesId(appDb, tenantId, otherNodeId));
  expect(isAppError(err) && err.code).toBe("series.no_standard_for_node");
});
```

- [ ] **Step 3: run it to verify it fails**

Run: `pnpm --filter @waitron/db test reserved-identity`
Expected: FAIL — `readStandardSeriesId` not exported.

- [ ] **Step 4: implement**

In `packages/db/src/reserved-identity.ts` (it already imports `invoiceSeries`, `withTenant`, `eq`, `brandTenantId`; add `and` from `drizzle-orm` and `AppError` from `@waitron/shared` if not present, plus `import "./errors.js"`):

```ts
/**
 * The id of a node's standard-purpose invoice series, read under `withTenant` (invoice_series is
 * FORCE-RLS; rides app_user's SELECT, like `readNodeEndorsement`). R3b's mirror→primary promote reads
 * the cloud's OWN reserved standard series here and points `config.till.seriesId` at it, so the promoted
 * cloud numbers under its disjoint `<primaryCode>-<numeroInstalacion>` series, never the primary's.
 * Throws `series.no_standard_for_node` rather than returning null — every caller needs one.
 */
export function readStandardSeriesId(
  db: Database,
  tenantId: string,
  nodeId: string,
): Promise<string> {
  return withTenant(db, brandTenantId(tenantId), async (tx) => {
    const [row] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, nodeId), eq(invoiceSeries.purpose, "standard")))
      .limit(1);
    if (row === undefined) {
      throw new AppError("series.no_standard_for_node", { tenantId, nodeId });
    }
    return row.id;
  });
}
```

(The tenant GUC from `withTenant` scopes the row to this tenant; `node_id` + `purpose` narrow within it — the same reasoning `readNodeEndorsement` documents for omitting an explicit `tenant_id` predicate.)

- [ ] **Step 5: export + run + gate**

Add `readStandardSeriesId` to `packages/db/src/index.ts`. Run: `pnpm --filter @waitron/db test reserved-identity` → PASS, then `pnpm --filter @waitron/db test:coverage`, then `pnpm lint && pnpm typecheck && pnpm format:check`. Also confirm the error-code reachability guard is green (the root `errors-reachable` guard runs from the pre-push hook): `pnpm --filter @waitron/db test english-only` is NOT it — run `pnpm vitest run scripts/errors-reachable.test.ts` from the repo root if in doubt.

- [ ] **Step 6: commit**

```bash
git add packages/db/src/reserved-identity.ts packages/db/src/reserved-identity.test.ts packages/db/src/errors.ts packages/db/src/index.ts
git commit -s -m "feat(db): readStandardSeriesId — a node's own standard invoice series, for R3b series correction"
```

---

### Task 3: thread `endorsements` through `mintNextMembershipDocument` (`apps/server`)

R3b mints the first production document signed by a NON-setup key (the cloud's own), so it must attach the primary's endorsement of that key. `buildNextMembershipDocument` already accepts optional `endorsements`; the server-layer helper must forward it.

**Files:**
- Modify: `apps/server/src/membership-mint.ts`
- Test: `apps/server/src/membership-mint.test.ts` (grep; if absent, extend `promote.test.ts`'s mint assertions — but prefer a focused unit here)

**Interfaces:**
- Consumes: `buildNextMembershipDocument({ …, endorsements? })` (`@waitron/membership`).
- Produces: `mintNextMembershipDocument(deps, args)` where `args` gains optional `endorsements?: readonly Endorsement[]`, forwarded to `buildNextMembershipDocument`. Backward compatible — R1 callers pass none → `[]`.

- [ ] **Step 1: write the failing test**

In `apps/server/src/membership-mint.test.ts` (read a sibling like `node-identity.test.ts` for the RING + establishNodeIdentity setup; PGlite is sufficient):

```ts
it("forwards endorsements onto the signed document", async () => {
  // establish a node identity so the mint has a key; build an endorsement fixture
  const endorsement: Endorsement = {
    nodeId, publicKey: "b64pub", endorsedBy: "primary-node", signature: "b64sig",
  };
  const doc = await mintNextMembershipDocument(
    { db, ring: RING },
    { tenantId, heldDocument: null, nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }], signerNodeId: nodeId, endorsements: [endorsement] },
  );
  expect(doc.endorsements).toEqual([endorsement]);
});

it("defaults to no endorsements when none are given (R1 behaviour preserved)", async () => {
  const doc = await mintNextMembershipDocument(
    { db, ring: RING },
    { tenantId, heldDocument: null, nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }], signerNodeId: nodeId },
  );
  expect(doc.endorsements).toEqual([]);
});
```

- [ ] **Step 2: run it to verify it fails**

Run: `pnpm --filter @waitron/server test membership-mint`
Expected: FAIL — the first test fails (`endorsements` not accepted/forwarded) or a TS error on the unknown arg.

- [ ] **Step 3: implement**

In `apps/server/src/membership-mint.ts`, add `endorsements?: readonly Endorsement[];` to the `args` type (import `Endorsement` from `@waitron/membership`), and pass `endorsements: args.endorsements` to `buildNextMembershipDocument`. Update the doc comment: no longer "R1 signs directly-trusted" only — the helper now forwards an optional endorsement chain (R3b attaches the primary's endorsement).

- [ ] **Step 4: run it to verify it passes**

Run: `pnpm --filter @waitron/server test membership-mint` → PASS. The R1 promote/seed paths (which pass no `endorsements`) still get `[]`.

- [ ] **Step 5: gate + commit**

Run: `pnpm --filter @waitron/server test membership-mint`, `pnpm lint && pnpm typecheck && pnpm format:check`.

```bash
git add apps/server/src/membership-mint.ts apps/server/src/membership-mint.test.ts
git commit -s -m "feat(server): mintNextMembershipDocument forwards an optional endorsement chain (R3b)"
```

---

### Task 4: `promoteMirrorToPrimary` — the mirror→primary path (`apps/server`)

The core of R3b: build the endorsed document (abortable), read the corrected series id (abortable), commit the PONR (mode+singleton+term-guarded doc in ONE owner tx), and return the corrected series id for the caller to persist. The function does NOT persist `trading.env` or restart — the boot wiring (Task 5) does, mirroring how `adoptFromPrimary` persists and the endpoint restarts.

**Files:**
- Modify: `apps/server/src/promote.ts`
- Modify: `apps/server/src/errors.ts` (add `promotion.membership_superseded`)
- Test: `apps/server/src/promote.test.ts` (extend)

**Interfaces:**
- Consumes: `readNodeMembership`, `readNodeEndorsement`, `readStandardSeriesId` (Task 2), `setDeploymentModeTx`/`setSingletonRoleTx`/`persistNodeMembershipIfNewerTx` (Task 1), `nextStandings`, `mintNextMembershipDocument` (Task 3, with `endorsements`), `refreshDeploymentHolders`.
- Produces: `promoteMirrorToPrimary(deps: PromoteMirrorDeps, attestation: FenceAttestation): Promise<MirrorPromotionResult>` where `MirrorPromotionResult = { alreadyPrimary: boolean; seriesId: string }`. `PromoteMirrorDeps` = `PromoteDeps` (same `appDb`/`ownerDb`/`holders`/`log`/`ring`/`tenantId`/`nodeId`).

- [ ] **Step 1: add the error code**

In `apps/server/src/errors.ts`, beside `promotion.not_a_local_secondary`:

```ts
    /**
     * A mirror→primary promote (R3b) minted a membership document at term N+1 over the held term N, but a
     * concurrent gossip-adopt had already landed a document at term ≥ N+1 by the time the point-of-no-return
     * transaction ran. The term-guarded write (`persistNodeMembershipIfNewer`) refused it — writing would
     * regress the org chart (parent spec §8 "R3 sharp edge") — so the WHOLE promote transaction aborts and
     * the mode/singleton flip does not commit: the node stays a mirror. Idempotent re-run recovers (it reads
     * the now-newer held term and mints over it). `heldTerm`/`mintedTerm` are org-chart generation counters,
     * not secrets. `promotion.*` names the domain concept; never renamed once shipped.
     */
    "promotion.membership_superseded": { heldTerm: number; mintedTerm: number };
```

- [ ] **Step 2: write the failing tests**

In `apps/server/src/promote.test.ts`, add a `describe("promoteMirrorToPrimary")` suite. Build a `mirror()` fixture like `localSecondary()` but stamped `mirror` with a reserved node identity, an endorsement on the node row, and a reserved standard series. Read the existing `localSecondary()` + `establishNodeIdentity` + `heldTermThreeDoc` helpers first and reuse them. Key setup: the cloud's OWN node needs (a) an identity key sealed (so the mint can sign) and (b) an `endorsement` on its `nodes` row and (c) a `purpose='standard'` invoice_series row. Use `insertReservedNodeTx`/`insertReservedSeriesTx`/`writeReservedSif` under `withTenant`, or the higher-level `establishReservedStandbyIdentity` — whichever keeps the fixture readable (prefer the low-level inserts so the test states exactly what it seeds).

```ts
it("flips mode+singleton to primary, mints an endorsed term-bumped doc, and returns the corrected seriesId", async () => {
  const { db, deps, tenantId, nodeId, standardSeriesId, endorsement } = await mirror();
  // seed a held term-3 chart naming the outgoing primary as serving-primary
  await writeNodeMembership(db, heldTermThreeDoc(nodeId, "old-primary", []));

  const result = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });

  expect(result.alreadyPrimary).toBe(false);
  expect(result.seriesId).toBe(standardSeriesId); // corrected to the cloud's OWN standard series
  expect(await readDeploymentMode(db)).toBe("primary");
  expect(await readSingletonRole(db)).toBe("primary");

  const held = await readNodeMembership(db);
  expect(held?.body.term).toBe(4); // bumped
  const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
  expect(standings[nodeId]).toBe("serving-primary");
  expect(standings["old-primary"]).toBe("sell-only");
  // Signed by the cloud's OWN key, carrying the primary's endorsement (the first non-setup-signed doc).
  expect(held!.signerNodeId).toBe(nodeId);
  expect(held!.endorsements).toEqual([endorsement]);
});

it("refuses without a fence attestation, leaving the node a mirror", async () => {
  const { db, deps } = await mirror();
  const err = await captureError(() => promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: false }));
  expect(isAppError(err) && err.code).toBe("promotion.fence_not_attested");
  expect(await readDeploymentMode(db)).toBe("mirror"); // no write
});

it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
  const { db, deps } = await mirror();
  await writeNodeMembership(db, heldTermThreeDoc((await deps(noopLog)).nodeId, "old-primary"));
  const first = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });
  const second = await promoteMirrorToPrimary(deps(noopLog), { oldNodeNeutralised: true });
  expect(second.alreadyPrimary).toBe(true);
  expect(first.seriesId).toBe(second.seriesId);
  expect((await readNodeMembership(db))?.body.term).toBe(4); // not re-bumped
});

it("aborts the whole PONR with promotion.membership_superseded when a newer term raced in", async () => {
  // Held term 3; simulate a concurrent adopt landing term 10 AFTER the mint reads term 3 but before
  // the PONR write. The cleanest deterministic way: seed held=3, mint reads 3 → builds 4; then write
  // term 10 directly before the PONR by stubbing the ordering — OR simpler: seed held=10 and force the
  // mint to build term 4 by injecting a stale heldDocument. Prefer: seed held=10 but call an internal
  // that mints over a stale term-3 read. If the function reads held once and mints term+1, seed held=3,
  // then between the mint and the tx write a concurrent write to term 10. Use a test seam: seed held=3,
  // run promote; inside, before the tx, no seam exists — so instead assert via a lower-level unit:
  // wrap persistNodeMembershipIfNewerTx behaviour is already covered in Task 1. Here, seed held so the
  // MINTED term is NOT strictly newer: seed held=3, then also write term 4 via a second connection
  // right after reading. Simplest deterministic form: seed held term 5, and have the mint build over a
  // stale null/term-4 by pre-seeding, so mintedTerm(=?) <= heldTerm.
  //
  // Concretely: seed held=5. promote reads held=5 → mints term 6. To force rejection, seed held=6
  // AFTER the mint but the function reads+mints+writes without a seam. Therefore test the rejection at
  // the function boundary by seeding held to a term the mint cannot beat: monkeypatch readNodeMembership
  // is heavy. RECOMMENDATION: expose the abort by seeding held=3, then in the test replace the ownerDb
  // with one whose node_membership already holds term 99 (a separate pre-write), so the mint (reading
  // appDb held=3 → term 4) writes term 4 guarded against 99 → rejected → throw. Since appDb===ownerDb
  // here (PGlite), pre-write term 99 AFTER seeding held=3 is impossible without a seam.
  //
  // FINAL deterministic approach for this suite: seed held=3 on the db; then, to model the race, WRITE
  // term 4 via writeNodeMembership just before calling promote — so the mint reads held term 4 (not 3),
  // builds term 5, and that IS newer (no rejection). That does NOT exercise rejection. Rejection is
  // therefore proven at the Task-1 tx level (persistNodeMembershipIfNewerTx returns false) PLUS a
  // focused test here that constructs the exact state: pre-write held term 5, then call a NARROWED
  // internal `commitMirrorPromotion(tx-deps, document@term4)` if extracted. If not extracted, assert
  // the throw by seeding held term 5 and passing a heldDocument override is not available.
});
```

**NOTE for the implementer on the rejection test:** the comment above is deliberately left as reasoning, not final code — resolve it by **extracting the PONR body into a small internal `commitMirrorPromotionTx(tx, document)`** (sets mode→primary, singleton→primary, term-guarded write; throws `promotion.membership_superseded` on a `false` return) and unit-testing THAT directly: seed held=5, call `db.transaction((tx) => commitMirrorPromotionTx(tx, doc(4)))`, assert it throws `promotion.membership_superseded` AND that `readNodeMembership` is still term 5 and `readDeploymentMode` is still `mirror` (the whole tx rolled back — proving the flip does not commit against a superseded chart). This is the honest, deterministic way to prove the sharp-edge guard by construction; delete the exploratory comment.

- [ ] **Step 3: run to verify failure**

Run: `pnpm --filter @waitron/server test promote` → FAIL (`promoteMirrorToPrimary` not exported).

- [ ] **Step 4: implement `promoteMirrorToPrimary`**

In `apps/server/src/promote.ts`, add (imports: `readNodeEndorsement`, `readStandardSeriesId`, `setDeploymentModeTx`, `persistNodeMembershipIfNewerTx` from `@waitron/db`):

```ts
export interface MirrorPromotionResult {
  readonly alreadyPrimary: boolean;
  /** The cloud's OWN reserved standard series id — the caller persists it into trading.env so the
   * promoted primary numbers under its disjoint series, not the primary's (spec §4.3). */
  readonly seriesId: string;
}

/**
 * Mirror → primary (parent SIF spec §5b; R3 design §4). A read-only mirror becomes the venue's primary
 * on the identity it already holds (R3a gave it its own nodeId; R2 reserved its SIF + disjoint series +
 * sealed key + the primary's endorsement). No identity ceremony, no SIF re-mint: `currentSif` returns
 * the reserved SIF once the box reboots `mode=primary`.
 *
 * ABORT-BEFORE-PONR (parent spec §7): the fence check, the held/endorsement/series reads, and the
 * in-memory mint all run BEFORE the one owner transaction, so any failure there leaves the mirror
 * exactly as it was. The PONR is ONE owner transaction — `mode→primary` (leaving singleton_role, so the
 * transient pair is the valid `(primary, secondary)`, never `(mirror, primary)`), then
 * `singleton_role→primary`, then the TERM-GUARDED document write; if that write is refused (a concurrent
 * gossip-adopt landed a ≥ term), the whole transaction aborts with `promotion.membership_superseded` and
 * the flip does not commit against a superseded chart (spec §8 "R3 sharp edge"). Idempotent: an
 * already-primary node returns `{ alreadyPrimary: true }` before any mint. The caller persists the
 * returned `seriesId` into trading.env and restarts — the mirror is not selling, so a restart costs
 * nothing (contrast the LIVE local-secondary promote).
 */
export async function promoteMirrorToPrimary(
  deps: PromoteDeps,
  attestation: FenceAttestation,
): Promise<MirrorPromotionResult> {
  assertFenced(attestation); // before PONR: abortable, zero lasting effect

  await refreshDeploymentHolders(deps.appDb, deps.holders);
  // Read the corrected series id up front — it is also the value an already-primary re-run returns.
  const seriesId = await readStandardSeriesId(deps.appDb, deps.tenantId, deps.nodeId);

  if (deps.holders.mode.current === "primary") {
    return { alreadyPrimary: true, seriesId }; // already promoted — idempotent no-op
  }

  // Build the endorsed document BEFORE the PONR: read the held org chart, flip standings (this node →
  // serving-primary, outgoing primary → sell-only), read the primary's endorsement of this node's key,
  // and sign with this node's OWN key. R3b attaches the endorsement so a peer trusting only the primary
  // transitively trusts this document (parent wire-protocol §4) — the first production doc signed by a
  // non-setup key.
  const held = await readNodeMembership(deps.appDb);
  const endorsement = await readNodeEndorsement(deps.appDb, deps.tenantId, deps.nodeId);
  const document = await mintNextMembershipDocument(
    { db: deps.appDb, ring: deps.ring },
    {
      tenantId: deps.tenantId,
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
      endorsements: endorsement === null ? [] : [endorsement],
    },
  );

  // PONR: mode + singleton + term-guarded doc in ONE owner transaction (CLAUDE.md §3). Order respects
  // deployment_role_valid_ck: primary+secondary is valid, (mirror, primary) is never written.
  await deps.ownerDb.transaction(async (tx) => {
    await setDeploymentModeTx(tx, "primary"); // (primary, secondary)
    await setSingletonRoleTx(tx, "primary"); // (primary, primary)
    const accepted = await persistNodeMembershipIfNewerTx(tx, document);
    if (!accepted) {
      // A concurrent gossip-adopt landed a ≥ term while we minted; abort the whole PONR so the flip does
      // not commit against a superseded chart. Re-read the held term for the diagnostic.
      const current = await readNodeMembership(deps.appDb);
      throw new AppError("promotion.membership_superseded", {
        heldTerm: current?.body.term ?? -1,
        mintedTerm: document.body.term,
      });
    }
  });

  await refreshDeploymentHolders(deps.appDb, deps.holders);
  deps.log("info", "promotion.completed", { target: "mirror" });
  return { alreadyPrimary: false, seriesId };
}
```

Extract the tx body into `commitMirrorPromotionTx(tx, document, appDbForDiag)` if the Task-4 rejection test needs it as a unit (recommended). Keep `promoteLocalSecondaryToPrimary`'s mirror-refusal branch UNCHANGED — `promoteMirrorToPrimary` is the separate path, and the local function must still refuse a mirror (its test at `promote.test.ts` "refuses a mirror" stays green).

- [ ] **Step 5: run to verify passes + gate**

Run: `pnpm --filter @waitron/server test promote` → PASS (all suites, incl. the unchanged `promoteLocalSecondaryToPrimary` ones and the rejection unit). Then `pnpm --filter @waitron/server test:coverage`, `pnpm lint && pnpm typecheck && pnpm format:check`.

- [ ] **Step 6: prove the guards by deletion (CLAUDE.md §4)**

Temporarily (a) delete the `if (!accepted) throw` block → the rejection test must fail; restore. (b) Swap `setDeploymentModeTx(tx, "primary")` and `setSingletonRoleTx(tx, "primary")` order → a real-PG run would hit `deployment_role_valid_ck` (note: PGlite enforces CHECKs too, so the ordering test can be PGlite). Confirm each guard is load-bearing, then restore. Do NOT commit the deletions.

- [ ] **Step 7: commit**

```bash
git add apps/server/src/promote.ts apps/server/src/promote.test.ts apps/server/src/errors.ts
git commit -s -m "feat(server): promoteMirrorToPrimary — mirror→primary with endorsed, term-guarded document (R3b)"
```

---

### Task 5: wire the mirror promote into boot + the headline e2e (`apps/server`)

> **UPDATE 2026-09-04 (owner decision, landed after this plan was written):** the `trading.env` persist moved to **BEFORE the point-of-no-return**, INSIDE `promoteMirrorToPrimary` via an injected `persistTradingEnv` callback (`MirrorPromoteDeps`) — NOT after the promote in the boot closure as the paragraphs below describe. A corrected series is inert on a still-read-only mirror, so persisting it pre-PONR is safe if the promote aborts and closes the process-crash window (the persist-after-PONR ordering below would leave). The boot closure now supplies the concrete `writeTradingEnv` and only schedules the restart. The "spec-faithful ordering / crash-window residual" framing in this plan's Self-review §3 is superseded by this; a narrower power-loss residual remains (writeFileAtomic does not fsync). Read the code (`promote.ts` `MirrorPromoteDeps.persistTradingEnv`) as the source of truth; the wiring description below records the original plan.

Expose `promoteMirrorToPrimary` as an in-process `StartedServer` method in mirror mode only (following the existing in-process promote trigger — there is no HTTP promote surface yet, spec §8), and wire the closure to promote → persist the corrected `trading.env` → restart.

**Files:**
- Modify: `apps/server/src/boot.ts`
- Test: `apps/server/src/boot.promote.test.ts` (extend) and `apps/server/src/adopt-e2e.rls.test.ts` (extend the headline mirror e2e)

**Interfaces:**
- Consumes: `promoteMirrorToPrimary`/`MirrorPromotionResult` (Task 4); `writeTradingEnv`/`TradingConfig` (already imported); `config.*` + `till.*` fields (all present in the trading branch).
- Produces: `StartedServer.promoteMirrorToPrimary?: (attestation: FenceAttestation) => Promise<MirrorPromotionResult>` — present only when `isMirror`; `promoteLocalSecondaryToPrimary?` present only when `!isMirror`.

**Why one task:** the exposure gate (mirror vs local), the closure (promote → persist → restart), and the e2e that proves the whole chain coherent must land together — a half-wired promote is untestable.

- [ ] **Step 1: extend `StartedServer` + `makeStartedServer` to expose the right field by mode**

In `apps/server/src/boot.ts`:
- Add to `StartedServer` (beside `promoteLocalSecondaryToPrimary?`): `promoteMirrorToPrimary?: (attestation: FenceAttestation) => Promise<MirrorPromotionResult>;` with a doc comment (in-process only, mirror mode only, restart-into-primary, requires a fence). Import `MirrorPromotionResult` from `./promote.js`.
- Change `makeStartedServer`'s `promote?` param to carry its kind: `promote?: { kind: "mirror"; run: (a: FenceAttestation) => Promise<MirrorPromotionResult> } | { kind: "local-secondary"; run: (a: FenceAttestation) => Promise<PromotionResult> }`. Update the spread at `boot.ts:370`:

```ts
...(promote === undefined
  ? {}
  : promote.kind === "mirror"
    ? { promoteMirrorToPrimary: promote.run }
    : { promoteLocalSecondaryToPrimary: promote.run }),
```

- [ ] **Step 2: wire the closure at the trading-branch `makeStartedServer` call (~boot.ts:1651)**

Replace the current 6th-arg closure (which unconditionally builds `promoteLocalSecondaryToPrimary`) with a mode dispatch. For `!isMirror`, keep today's `local-secondary` closure verbatim (just wrapped as `{ kind: "local-secondary", run: … }`). For `isMirror`, build a `mirror` closure that promotes, then — only on a real promotion (`!alreadyPrimary`) — persists the corrected `trading.env` and restarts:

```ts
isMirror
  ? {
      kind: "mirror" as const,
      run: async (attestation: FenceAttestation) => {
        const ownerDb = await createPostgresDb(config.migrationsDatabaseUrl);
        try {
          const result = await promoteMirrorToPrimary(
            { appDb: db, ownerDb, holders, log, ring, tenantId: till.tenantId, nodeId: till.nodeId },
            attestation,
          );
          if (!result.alreadyPrimary) {
            // Correct trading.env: the promoted primary numbers under its OWN reserved standard series
            // (result.seriesId), not the primary's inert designated.seriesId that adopt wrote (spec §4.3).
            // Every other value is re-emitted unchanged from the running config.
            const next: TradingConfig = {
              tenantId: till.tenantId,
              tillId: till.tillId,
              nodeId: till.nodeId,
              seriesId: result.seriesId,
              locationId: till.locationId,
              databaseUrl: config.databaseUrl,
              migrationsDatabaseUrl: config.migrationsDatabaseUrl,
              syncDatabaseUrl: config.syncDatabaseUrl,
              environment: config.environment,
            };
            await writeTradingEnv(config.stateDir, next);
            // Restart into mode=primary — the same persist-then-restart transition provision/adopt use.
            // Fire on the next tick so the in-process caller's result is returned first.
            setTimeout(() => process.kill(process.pid, "SIGTERM"), 0);
          }
          return result;
        } finally {
          await ownerDb.close();
        }
      },
    }
  : { kind: "local-secondary" as const, run: async (attestation: FenceAttestation) => { /* today's closure */ } }
```

Confirm `config.environment` is the `"production" | "preproduction"` `TradingConfig.environment` expects (it is — `writeTradingEnv` at setup uses `config.environment`). Confirm `config.syncDatabaseUrl` is threaded (a mirror always has it — R3a/adopt guarantees it in trading.env; re-emitting it keeps the mirror-sync pool available should the promote abort before restart, and it is harmless on a primary that no longer pulls).

- [ ] **Step 3: extend `boot.promote.test.ts`**

Read `apps/server/src/boot.promote.test.ts` first. Add a case that boots a MIRROR (stamped `mirror`, with a reserved identity + endorsement + standard series + held membership doc — reuse the fixtures from Task 4 or the adopt e2e's mirror seed), asserts:
- `started.promoteMirrorToPrimary` is defined and `started.promoteLocalSecondaryToPrimary` is undefined (mode-gated exposure).
- calling it with `{ oldNodeNeutralised: true }` returns `{ alreadyPrimary: false, seriesId }`, flips `deployment` to `(primary, primary)`, and writes a `trading.env` whose `WAITRON_TILL_SERIES_ID` equals the cloud's own standard series id (read the written file, or stub `writeTradingEnv`/`process.kill` — prefer injecting a `stateDir` temp dir and reading the file back; guard the `process.kill` restart in tests by asserting on the persisted file, NOT by letting SIGTERM fire — e.g. spy on `process.kill` or run the closure's promote+persist directly). Verify a NON-mirror boot still exposes `promoteLocalSecondaryToPrimary` and not `promoteMirrorToPrimary`.

**Restart-in-test caution (CLAUDE.md §4):** never let `setTimeout(() => process.kill(...))` actually fire in a test — it SIGTERMs the vitest process. Either stub `process.kill` (assert it was called with `("SIGTERM")`) or structure the closure so the test drives promote+persist without the timer. Prefer a `process.kill` spy restored in `afterEach`.

- [ ] **Step 4: extend the headline mirror e2e (`adopt-e2e.rls.test.ts`)**

Read `apps/server/src/adopt-e2e.rls.test.ts`. After the existing adopt → reboot-as-mirror → pull → serve-read-only flow, add a promotion leg (real Postgres):
- Call the in-process `promoteMirrorToPrimary` (or drive the promote function directly with the booted mirror's db/owner handles) with a fence attestation.
- Assert `deployment` is `(primary, primary)`, the held `node_membership` is term-bumped, signed by the cloud's OWN nodeId, carries the primary's endorsement, and **verifies against a trust set containing ONLY the primary's key** (transitive trust via the endorsement — the load-bearing fiscal-adjacent assertion). Use `verifyMembershipDocument(held, { [primaryNodeId]: primaryPublicKey })`.
- Assert `currentSif(tx, tenant, cloudNodeId)` returns the RESERVED SIF (its `numeroInstalacion` = the reserved number, its chain head both-null) — proving the reserved SIF becomes the live selling SIF with no re-mint. (`currentSif` needs a `withTenant` tx.)
- Assert the corrected `seriesId` is the cloud's own standard series (code endswith `-<numeroInstalacion>`), NOT `designated.seriesId`.
- Keep every existing adopt/pull/read-only assertion green.

Do NOT attempt a full second reboot into primary in the e2e (the supervisor loop is out of process); asserting the persisted `trading.env` + the DB state is the provable surface. Note this scoping in a test comment.

- [ ] **Step 5: run the full gate**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (all green, incl. `promote`, `boot.promote`, `adopt-e2e`). Then `pnpm lint && pnpm typecheck && pnpm format:check`. Also run the fiscal cross-package guard (a promoted cloud touches no tenant-scoped schema, but confirm nothing regressed): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.

- [ ] **Step 6: commit**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.promote.test.ts apps/server/src/adopt-e2e.rls.test.ts
git commit -s -m "feat(server): wire mirror→primary promote into boot (in-process, restart-into-primary) (R3b)"
```

---

### Task 6: backlog + spec pointer

**Files:**
- Modify: `docs/backlog.md` (the membership-promotion arc row: R3b LANDED, note residuals)

- [ ] **Step 1: update the backlog**

In `docs/backlog.md`, in the R3 arc row, mark **R3b (cloud promotion) LANDED** (PR # on land), summarising: mirror→primary in-process promote, endorsed + term-guarded document, reserved SIF/series become live on restart, `seriesId` corrected. Record the named residuals as carry-ins (they are already deferrals in the spec §6, restate for visibility):
- **Crash window (accepted, benign in R3b scope):** a crash between the PONR commit and the `trading.env` correction leaves `mode=primary` with the primary's inert `seriesId` persisted; harmless while till-reroute is deferred (nothing sells against the promoted cloud yet), but the till-reroute slice MUST close it (persist the corrected series before it routes sales, or resolve the series at boot from the node's own standard series).
- **Till-side reroute** (spec §6) — how tills discover/sell against a promoted cloud — remains its own slice; R3b makes the cloud a *capable* primary, not a *sold-against* one.
- **H2 (fiscal-record sync to mirrors)** — independent, unchanged.

This is a `docs/backlog.md` edit — per CLAUDE.md §6 it merges to `main` directly (no PR); do it AFTER the code PR lands, in the same session, as its own lightweight commit on `main`.

- [ ] **Step 2: commit (with the code PR, the plan doc travels; the backlog row lands separately per §6)**

The plan doc itself commits with Task 1 (or on branch creation). The backlog row is a separate lightweight `main` commit at land time.

---

## Self-review

**Spec coverage (§4 R3b — the four numbered design points):**
- §4.1 "Build the promotion document BEFORE the PONR … endorsements: [readNodeEndorsement(cloudNodeId)] … first production document signed by a non-setup key" → Task 3 (mint forwards endorsements) + Task 4 (reads endorsement, attaches, builds pre-PONR).
- §4.2 "Point-of-no-return — ONE owner transaction: mode → primary, singleton_role → primary, write the document term-guarded … via persistNodeMembershipIfNewer" → Task 1 (Tx variants) + Task 4 (the PONR tx + supersede abort).
- §4.3 "Persist + restart. Point config.till.seriesId at the cloud's own reserved standard series, persist trading.env, restart" → Task 2 (readStandardSeriesId) + Task 5 (persist corrected trading.env + SIGTERM restart).
- §4 "On reboot … currentSif(config.till.nodeId) returns the reserved SIF" → Task 5 e2e asserts `currentSif` returns the reserved SIF (no activation code — the reserved row is already `revocadoEn IS NULL`).
- §5 fiscal receipts (new chain, número never reused, immutability, at-most-one-primary) → no `registerSif` call anywhere (Global Constraints); e2e asserts the reserved SIF/series are USED not re-minted; the fence + term-guard are the at-most-one-primary backstops.

**Placeholder scan:** the only intentionally non-final block is the Task-4 rejection-test reasoning comment, which is explicitly resolved by the "extract `commitMirrorPromotionTx` and unit-test it" instruction that follows it — the implementer deletes the exploratory comment. Fixture names (`mirror()`, `ownerDb`/`appDb`, `standardSeriesId`, `endorsement`) reuse existing suite setup, flagged to read siblings first. Every production edit is concrete (exact call sites + code).

**Type consistency:** `persistNodeMembershipIfNewerTx(tx, doc): Promise<boolean>` (Task 1) is consumed in Task 4's PONR. `setDeploymentModeTx(tx, mode): Promise<void>` (Task 1) consumed in Task 4. `readStandardSeriesId(db, tenantId, nodeId): Promise<string>` (Task 2) consumed in Task 4 and its return flows through `MirrorPromotionResult.seriesId` (Task 4) into `TradingConfig.seriesId` (Task 5). `mintNextMembershipDocument`'s new `endorsements?` (Task 3) is passed in Task 4. `MirrorPromotionResult` (Task 4) is the `StartedServer.promoteMirrorToPrimary` return (Task 5).

**Decisions taken (flag at owner review-at-land):**
1. **Separate function `promoteMirrorToPrimary`**, not an extension of `promoteLocalSecondaryToPrimary` — the two are genuinely different (live vs restart-into-primary; the local one still refuses a mirror). Mode-gated exposure keeps each callable only where valid.
2. **Term-guard rejection aborts the WHOLE PONR** (`promotion.membership_superseded`), rolling back the mode/singleton flip — the safest reading of the spec §8 sharp edge (atomic, refuse-if-superseded); idempotent re-run recovers. This is a membership/org-chart decision, not a fiscal-chain one.
3. **Spec-faithful ordering** (PONR → persist trading.env → restart, the persist in the boot wiring) — the crash window it leaves is documented as an accepted, benign-in-R3b residual (nothing sells against the cloud until till-reroute) and handed to the till-reroute slice. A pre-PONR persist would also be safe (a corrected seriesId is inert on a mirror), but deviating from the owner-reviewed ordering without consultation is avoided.

**Out of scope (later slices):** the till-side reroute (§6), the promoted cloud's reachability model, H2's wire detail, an HTTP/break-glass promote surface (§8 — none exists for the local promote either), and closing the crash window (till-reroute slice).
