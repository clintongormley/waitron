# SQLite + Litestream failover prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the throwaway rig that proves the SQLite + Litestream box→store→promote→return-with-a-tail→ship→rejoin loop holds together fiscally, before slice 1 rewrites the storage layer.

**Architecture:** A private workspace package `bench/sqlite-failover`, modelled on `bench/pglite-throughput` (Docker-dependent, run by hand; no scenario ever runs in CI). Seven scenarios (S0–S6) each assert one invariant from the topology design's gate-2 obligations and each carry a control that reproduces the opposite result. Four scenarios (S1, S2, S5, S6) exercise our own logic over `node:sqlite` and a local MinIO store with no Litestream, so they are deterministic and need no process orchestration; three (S0, S3, S4) drive the real Litestream binary. The rig stands up a **minimal model** of the fiscal ledger — it does not import `packages/fiscal-verifactu` — and each model piece cites the real table it mirrors.

**Tech Stack:** Node 26 (`node:sqlite` built-in; native `.ts` imports), `@aws-sdk/client-s3`, `testcontainers` (MinIO), the real `litestream` binary pinned to v0.5.17. No test framework — scenarios are plain scripts using `node:assert`, run via `node`, aggregated by a `scenarios` runner, exactly as the pglite bench's `bench` script works.

**Spec:** `docs/superpowers/specs/2026-09-16-sqlite-failover-prototype-design.md` (read it with this plan; §2 defines the minimal model, §4 the scenarios, §7 the measurements-not-gates rule).

## Global Constraints

- **Throwaway, and it says so.** Every model table and the toy hash carry a comment: this is a model of the real thing, not the real thing (spec §2). No file here is ever imported by a product package.
- **Non-fiscal-core.** Nothing in this plan modifies `packages/fiscal-verifactu` or any core migration/table. Every task is option-A autonomous (away-campaign decision 2026-09-16) and trips none of the campaign's H2.
- **No scenario ever runs in CI.** The package has **no `test` script and no `*.test.ts` file**, so root `pnpm -r test` and the CI shards never execute anything in it. That is NOT the same as CI never seeing the package: it is a workspace member, so the shards' filters and the root guard suite read it by name, and a member that declares no `test:coverage` script has to be listed in `PACKAGES_WITHOUT_TESTS` and `LIGHT_B_PACKAGES` (`scripts/changed-scope.mjs`) and subtracted in `test-light-a` (`.github/workflows/ci.yml`), exactly as `@waitron/bench-pglite` is. Task 1 measured what happens without that wiring: `npx vitest run scripts/changed-scope.test.mjs scripts/coverage-thresholds.test.ts scripts/ci-workflow.test.mjs` → `Test Files  3 failed (3)`. **Its gate is therefore `typecheck` + `format:check` + `lint` PLUS the root guard suite** (`pnpm vitest run`, which the pre-push hook runs anyway); the evidence a scenario works lives in the results note, not in CI.
- **A scenario is a measurement, not a build gate** (spec §7). A scenario that fails is a recorded outcome. The `scenarios` runner exits non-zero **only** on a critical-scenario failure (S0, S1, S2, S3, S6); S4/S5 failures are recorded and the run continues.
- **Every control must reproduce the opposite result** (`CLAUDE.md` §1). A scenario without a working control is incomplete: a green assertion where the failing case would look identical proves nothing.
- **Establish, do not assert, external behaviour** (memory `brief-what-to-establish-not-what-is-impossible`). Litestream's and MinIO's behaviour is confirmed by the rig on the pinned versions, not stated as fact up front.
- **Litestream pin:** `v0.5.17`. **MinIO pin:** a specific `minio/minio` image tag chosen in Task 1 and reused everywhere. **Node:** 26.x (`node:sqlite`, native `.ts` import — set `allowImportingTsExtensions` + `noEmit` in tsconfig).
- **Commit sign-off:** every commit `-s` (`CLAUDE.md` §6). Branch per task `feat/sqlite-failover-<slug>`; each task is its own PR via `finish-branch` → `land-branch`.

---

### Task 1: Package scaffold, store helper, minimal model, scenario runner

**Files:**
- Create: `bench/sqlite-failover/package.json`
- Create: `bench/sqlite-failover/tsconfig.json`
- Create: `bench/sqlite-failover/README.md`
- Create: `bench/sqlite-failover/src/store.ts` (MinIO Testcontainers helper + S3 client)
- Create: `bench/sqlite-failover/src/model.ts` (the minimal SQLite schema + node object + drain + tail-ship apply)
- Create: `bench/sqlite-failover/src/scenarios.ts` (the runner)
- Create: `bench/sqlite-failover/src/scenarios/s_smoke.ts` (a trivial scenario proving the harness)

**Interfaces (produced — later tasks consume these exact signatures):**
- `store.ts`: `export async function startStore(): Promise<Store>` where `Store = { endpoint: string; client: S3Client; bucket: string; stop(): Promise<void> }`.
- `model.ts`:
  - `export function openNode(nodeId: string, path?: string): NodeDb` (path omitted → in-memory). `NodeDb` wraps a `node:sqlite` `DatabaseSync` with the schema below plus helpers.
  - `export function recordSale(db: NodeDb, payloadCents: number): { secuencia: number; huella: string }` — appends one hash-linked `records` row + its `pendiente` `envios` row + a `sales` row, updating `chain_head`.
  - `export function toyHuella(prev: string | null, payload: string): string` — SHA-256 of `prev ?? "" + "|" + payload` (a MODEL hash; a comment says so).
  - `export function drainPass(db: NodeDb, submit: (nodeId: string, secuencia: number) => void): void` — mirrors the real drain: claims across every chain with no node filter, carries a per-pass in-memory blocked-chain `Set`, marks rows `enviando`→`enviado`.
  - `export function applyTail(receiver: NodeDb, senderNodeId: string, tail: TailBatch): ApplyResult` where `TailBatch = { records: RecordRow[]; envios: EnvioRow[]; sales: SaleRow[]; saleLines: SaleLineRow[]; supplierInvoices: SupplierInvoiceRow[] }` and `ApplyResult = { applied: number; skippedClashes: SupplierInvoiceRow[]; refusedForeign: number }`.
  - `export function diffTail(sender: NodeDb, receiverHeld: HeldSummary): TailBatch` — the rows the sender owns that the receiver lacks.
  - Row types (`RecordRow`, `EnvioRow`, `SaleRow`, `SaleLineRow`, `SupplierInvoiceRow`, `HeldSummary`) exported from `model.ts`.
- `scenarios.ts`: discovers `src/scenarios/s_*.ts`, runs each `export default async function(ctx): Promise<ScenarioResult>`, prints a Markdown table, exits non-zero only if a `critical` scenario has `verdict: "FAIL"`. `ScenarioResult = { id: string; title: string; verdict: "PASS" | "FAIL" | "MEASURED" | "SKIPPED"; critical: boolean; detail: string }`.

**The minimal schema (`model.ts`), each table commented as a model of its real counterpart:**

```sql
-- MODEL of registros_facturacion (packages/fiscal-verifactu/src/schema/registros.ts:35,148).
-- Append-only, hash-chained, keyed (node_id, secuencia). NOT the real ledger.
CREATE TABLE records (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  huella TEXT NOT NULL, huella_anterior TEXT, payload TEXT NOT NULL,
  PRIMARY KEY (node_id, secuencia)
);
-- MODEL of cadenas (…/schema/cadenas.ts:44). Per-node chain tip, updated in place by the owner.
CREATE TABLE chain_head (
  node_id TEXT PRIMARY KEY, last_secuencia INTEGER NOT NULL, last_huella TEXT NOT NULL
);
-- MODEL of envios (+ acks folded to `acked`). Submission state; child of records.
CREATE TABLE envios (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','enviando','enviado')),
  acked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, secuencia),
  FOREIGN KEY (node_id, secuencia) REFERENCES records(node_id, secuencia)
);
-- MODEL of a non-fiscal ledger: parent carries node_id, child hangs off the parent.
CREATE TABLE sales (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, total_cents INTEGER NOT NULL);
CREATE TABLE sale_lines (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  description TEXT NOT NULL, amount_cents INTEGER NOT NULL
);
-- MODEL of the one residual natural-key clash (outbox-swap §4.2): a supplier invoice number.
CREATE TABLE supplier_invoices (
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL,
  supplier TEXT NOT NULL, invoice_number TEXT NOT NULL,
  UNIQUE (supplier, invoice_number)
);
```

- [ ] **Step 1: Write the failing smoke scenario**

`src/scenarios/s_smoke.ts`:
```ts
import assert from "node:assert";
import { startStore } from "../store.ts";
import { openNode, recordSale } from "../model.ts";
export default async function () {
  const store = await startStore();
  try {
    const db = openNode("node-a");
    const { secuencia, huella } = recordSale(db, 500);
    assert.equal(secuencia, 1);
    assert.ok(huella.length === 64, "toy huella is a sha256 hex");
    // store is reachable: put and get a byte
    await store.client.putObject?.({}); // placeholder call, replaced in impl
    return { id: "smoke", title: "harness up", verdict: "PASS" as const, critical: false, detail: "store + sqlite + model" };
  } finally { await store.stop(); }
}
```

- [ ] **Step 2: Run it, watch it fail** — Run: `pnpm --filter @waitron/bench-sqlite-failover scenarios`. Expected: FAIL (modules not implemented / no such file).

- [ ] **Step 3: Scaffold the package.** Create `package.json` (`name:"@waitron/bench-sqlite-failover"`, `private:true`, `type:"module"`, scripts `scenarios: "node src/scenarios.ts"`, `typecheck: "tsc --noEmit"`, `setup:litestream: "node src/setup-litestream.ts"`; devDeps `@aws-sdk/client-s3`, `testcontainers`, `@types/node@^24`, `typescript@^5.7`). `tsconfig.json` with `allowImportingTsExtensions:true`, `noEmit:true`, `module:"nodenext"`, `target:"es2023"`. `README.md` states: throwaway, Docker + pinned litestream required, how to run, why no scenario runs in CI, and how the package is nevertheless wired into the shard lists (`PACKAGES_WITHOUT_TESTS` and `LIGHT_B_PACKAGES` in `scripts/changed-scope.mjs`, subtracted from `test-light-a` in `.github/workflows/ci.yml`) and read by the root guards. Run `pnpm install` at the repo root to link it.

- [ ] **Step 4: Implement `store.ts`.** `startStore()` starts a MinIO `GenericContainer(<pinned tag>)` with `--command ["server","/data"]`, root creds, exposed `9000`; builds an `S3Client` (`forcePathStyle:true`, region `us-east-1`, the dummy creds, `endpoint`); `CreateBucket` a fixed bucket; returns `{ endpoint, client, bucket, stop }`.

- [ ] **Step 5: Implement `model.ts`.** The schema above via `DatabaseSync` with `PRAGMA foreign_keys=ON`; `toyHuella` via `node:crypto` `createHash("sha256")`; `recordSale`, `drainPass`, `applyTail`, `diffTail` per the interfaces (later tasks flesh out `applyTail`'s terminal-state-wins and clash rules — here it does the append-only insert + FK-ordered parents-before-children + refuse-foreign). Fix the smoke scenario's placeholder store call to a real `PutObject`/`GetObject` round-trip.

- [ ] **Step 6: Implement `scenarios.ts`** — glob `src/scenarios/s_*.ts`, run each default export with a shared context `{ startStore }`, collect `ScenarioResult`s, print the Markdown table, exit `1` only if any `critical && verdict==="FAIL"`.

- [ ] **Step 7: Run, watch it pass** — Run: `pnpm --filter @waitron/bench-sqlite-failover scenarios`. Expected: the table with `smoke … PASS`, exit 0.

- [ ] **Step 8: Gate + commit** — Run `pnpm --filter @waitron/bench-sqlite-failover typecheck`, `pnpm format:check`, `pnpm lint`. Then:
```bash
git add bench/sqlite-failover
git commit -s -m "feat(bench): sqlite-failover harness — store, minimal model, runner"
```

---

### Task 2: S6 — the store's conditional-write primitive

Do S6 before S1: S1's fence uses the primitive S6 establishes.

**Files:**
- Create: `bench/sqlite-failover/src/store-cas.ts` (`export async function claimCreateOnly(store, key, body): Promise<"won"|"lost">`, `export async function probeConditionalWrites(store): Promise<CasReport>`)
- Create: `bench/sqlite-failover/src/scenarios/s6_store_cas.ts`

**Interfaces:**
- Consumes: `Store` from `store.ts`.
- Produces: `claimCreateOnly` (a create-only PUT: `PutObject` with `IfNoneMatch:"*"`; returns `"lost"` on a `412`/`PreconditionFailed`, `"won"` on success), and `CasReport = { createOnly: boolean; ifMatch: boolean; raceWinners: number; racers: number }`.

- [ ] **Step 1: Write the failing scenario** `s6_store_cas.ts`:
```ts
import assert from "node:assert";
export default async function ({ startStore }) {
  const store = await startStore();
  try {
    const { probeConditionalWrites } = await import("../store-cas.ts");
    const r = await probeConditionalWrites(store);
    assert.equal(r.createOnly, true, "MinIO must support If-None-Match:* create-only");
    assert.equal(r.raceWinners, 1, "exactly one of N create-only racers wins");
    const detail = `create-only=${r.createOnly} if-match=${r.ifMatch} race=${r.raceWinners}/${r.racers}`;
    return { id: "S6", title: "store conditional write", verdict: "PASS", critical: true, detail };
  } finally { await store.stop(); }
}
```

> **Landed 2026-09-17** with `ifMatch: "refuses-stale" | "accepts-stale" | "not-established"` plus an
> `ifMatchNote`, rather than the boolean above: a store may answer an `If-Match` it does not implement
> with an error rather than a 412, and a boolean could not tell that apart from a store that accepts
> stale ETags. `CasReport` also carries `unfencedWinners`, the unconditional control the race is
> measured against. The fenced race uses `Promise.all` rather than the `Promise.allSettled` of step
> 3(c): `claimCreateOnly` throws only on a non-precondition failure, which the critical measurement
> should not survive.

- [ ] **Step 2: Run, watch it fail** — `… scenarios` → FAIL (`store-cas.ts` missing).

- [ ] **Step 3: Implement `store-cas.ts`.** `claimCreateOnly` as above. `probeConditionalWrites`: (a) create-only — put `k1` with `IfNoneMatch:"*"` → expect ok; put `k1` again with `IfNoneMatch:"*"` → expect `412`; set `createOnly` accordingly. (b) if-match — put `k2`, read its `ETag`, put `k2` with `IfMatch:<etag>` → ok, put `k2` with `IfMatch:"\"stale\""` → expect `412`; set `ifMatch` (record, do not require — establishing, not asserting). (c) race — fire N=8 concurrent `claimCreateOnly` on one fresh key via `Promise.allSettled`; `raceWinners` = count of `"won"`.

- [ ] **Step 4: Run, watch it pass** — expect `S6 … PASS` and the recorded `if-match=…`.

- [ ] **Step 5: Gate + commit** — typecheck/format/lint, then `git commit -s -m "feat(bench): S6 — establish the store's conditional-write primitive"`.

---

### Task 3: S1 — offline double promotion, the CAS fence

> **2026-09-17, as landed.** Two things below were changed while building it, and the code is what
> holds. (1) The keys live under the venue prefix `venues/v1/` — topology design §2.2 — not at the
> bucket root: `venues/v1/claims/term-<n>.json`, `venues/v1/current.json`,
> `venues/v1/gen-<term>-<node>/OWNER`. That is the prefix Tasks 6, 7 and 8 already stream a
> generation into, so a later task does not have to reconcile two namespaces. (2) `promoteUnfenced`
> is a real read-check-write taking the base as an argument, not a plain PUT that always returns
> `"won"`; a control that cannot return anything else measures nothing, and the base is passed in so
> the control does not depend on the order the store serves two reads in. Details and the runs behind
> both: PR for this task, and `bench/sqlite-failover/README.md`.

**Files:**
- Create: `bench/sqlite-failover/src/promotion.ts` (`export async function promote(store, term, nodeId): Promise<"won"|"lost">`, `export async function promoteUnfenced(...)` the control)
- Create: `bench/sqlite-failover/src/scenarios/s1_double_promotion.ts`

**Interfaces:**
- Consumes: `claimCreateOnly` (Task 2), `Store`.
- Produces: `promote` — claims `claims/term-<term>.json` create-only; on `"won"` writes `current.json = {term, nodeId, gen:"gen-<term>-<nodeId>"}` and returns `"won"`; on `"lost"` writes nothing and returns `"lost"`. `promoteUnfenced` — the control: plain `PutObject` of `current.json`, no claim, always "won".

- [ ] **Step 1: Write the failing scenario** `s1_double_promotion.ts`:
```ts
import assert from "node:assert";
export default async function ({ startStore }) {
  const store = await startStore();
  try {
    const { promote, promoteUnfenced } = await import("../promotion.ts");
    // Two nodes promote to the SAME term from the same base — the offline double promotion.
    const results = await Promise.all([promote(store, 5, "box-a"), promote(store, 5, "box-b")]);
    const winners = results.filter((r) => r === "won").length;
    assert.equal(winners, 1, "exactly one node wins term 5");
    // current.json names the winner's generation
    const cur = await store.getJson("current.json");
    assert.match(cur.gen, /^gen-5-(box-a|box-b)$/);
    // CONTROL: without the fence, both "win" — proving the assertion tests the fence.
    const ctl = await Promise.all([promoteUnfenced(store, 6, "box-a"), promoteUnfenced(store, 6, "box-b")]);
    assert.equal(ctl.filter((r) => r === "won").length, 2, "control reproduces the double-accept");
    return { id: "S1", title: "double promotion fenced by CAS", verdict: "PASS", critical: true, detail: `winners=${winners}, control=2` };
  } finally { await store.stop(); }
}
```

- [ ] **Step 2: Run, watch it fail** — FAIL (`promotion.ts` missing). Add a `store.getJson` helper to `store.ts` if not present (a `GetObject` + JSON parse) as part of impl.

- [ ] **Step 3: Implement `promotion.ts`** per the interface.

- [ ] **Step 4: Run, watch it pass** — `S1 … PASS`, `winners=1, control=2`.

- [ ] **Step 5: Gate + commit** — `git commit -s -m "feat(bench): S1 — double promotion fenced by the store's conditional write"`.

---

### Task 4: S2 — a retried tail ship must not double-submit

The crux fiscal-safety scenario. Fleshes out `applyTail`'s terminal-state-wins rule and a minimal drain with an idempotency-asserting submit stub.

> **2026-09-17, as landed.** This note covers the WHOLE of Task 4, not only its step-1 snippet: the
> task's opening line, its **Files** and **Interfaces** lines and step 4's expected detail each
> describe a design that was not built, and the code is what holds. Five corrections.
>
> 1. **The submit stub does not assert, and does not throw.** `drainPass` catches a throwing
>    `submit`, returns the row to `pendiente` and blocks that chain for the rest of the pass, so an
>    `assert.ok` inside the stub is swallowed: S2 would pass however many times a record was
>    submitted, and `try { drainPass(...) } catch { doubled = true }` would never see a throw. The
>    stub records every `(node_id, secuencia)` it is handed instead, repeats kept, and the
>    assertions read that list afterwards. There is ONE such ledger for both nodes, because there is
>    one tax agency.
> 2. **`const held0 = { records: [] }` crashes** — `diffTail` reads `contiguousTo`, `saleIds` and
>    `supplierInvoiceIds` off the receiver summary. `summarise(receiver)` is used, which is the
>    honest way to ask what the receiver holds in any case.
> 3. **The snippet's sequence was already green before any production change**, so it was not a
>    failing test: under the `ON CONFLICT DO NOTHING` write it started from, a re-shipped
>    `pendiente` changed nothing on a row the receiver had marked `enviado`. Terminal-state-wins has
>    two sides and only the second was red — a terminal row on the SENDER must be ADOPTED by a
>    receiver still holding it `pendiente`, or the receiver's drain, which claims across every chain
>    with no node filter, files a record its owner has already filed. S2 therefore has two parts,
>    one per side, each with its own control (`applyTailRegressing` for the first,
>    `applyTailInsertOnly` for the second), both controls being thin wrappers over one shared
>    `applyTail` body with the `envios` rule as its one parameter. A third part covers spec §4's
>    blocked-set requirement. **Corrected later the same day:** an earlier draft of this item, and of
>    the README section it points at, said that requirement could not be measured because the blocked
>    set is a local variable. That was wrong — the set is live for the whole loop and `submit` is
>    called from inside it, so a ship issued from a later `submit` callback in the same pass runs with
>    a chain paused. Part E measures it. `bench/sqlite-failover/README.md` → "What S2 measures, and
>    what it does not" carries what IS and is not measured.
> 4. **`drainPass` was not changed by this task, and neither was the `submit` stub's contract.** The
>    opening line above ("a minimal drain with an idempotency-asserting submit stub") and the
>    **Files** line's "(complete `drainPass` terminal-state handling …)" both describe work the diff
>    does not contain. `git show ab59b646 -- bench/sqlite-failover/src/model.ts` has three hunks: the
>    schema comment, the `applyTail` doc comment (now `EnvioRule`) with `ENVIO_UPSERT` and the two
>    control wrappers, and `applyShippedTail`'s `envios` insert. No changed line is inside
>    `drainPass`'s body; the one changed line that NAMES it is a comment in the `EnvioRule` block
>    referring to it. `drainPass` landed whole in Task 1 and this task only read it. The **Interfaces → Produces** line is corrected in place below,
>    because a later task would otherwise read it as a contract.
> 5. **Step 4's expected `submitted=5/5` is not what the scenario reports, and PASS is no longer what
>    it measures.** The detail is a sentence per part, and the verdict is read off the measurement:
>    S2 is FAIL as landed, because a ship recomputed against a REFRESHED view of the receiver ships
>    nothing at all for a record the receiver already holds, so the receiver's drain files a record
>    its owner has already filed. The README's "What S2 measures" section carries the result and what
>    is open; the design decision is the owner's. **Owner review, later the same day:** the cost of
>    that FAIL was revised down — the real endpoint refuses a duplicate (error 3000) and the real
>    drain reads that as filed, and the designed order fences the old primary before it ships, so the
>    sender never files after shipping as Parts B, D and E's second half have it. README → "What the
>    FAIL means against the real system". **Refined again the same day:** the first follow-up first
>    named there — "a stub that answers a repeat the way AEAT does" — was dropped as a measurement
>    that cannot fail. A stub modelling error 3000 is idempotent by construction, so it can only ever
>    print zero; every double this rig finds is the SAME invoice identity, which a real AEAT refuses.
>    The one genuine double-filing shape is a DIFFERENT identity for one sale (re-keying), which S2
>    does not model and fresh-series-on-restore guards. The second follow-up — fence before ship,
>    resolving in-flight submissions first — is written into topology design §5.2 on this branch.

**Files:**
- Modify: `bench/sqlite-failover/src/model.ts` (complete `drainPass` terminal-state handling and `applyTail`'s `envios` terminal-state-wins branch)
- Create: `bench/sqlite-failover/src/scenarios/s2_no_double_submit.ts`

**Interfaces:**
- Consumes: `openNode`, `recordSale`, `drainPass`, `applyTail`, `diffTail` (Task 1).
- Produces: an `applyTail` whose `envios` apply is **terminal-state-wins** (a row already `enviado`/`acked` on the receiver is never regressed by a re-shipped `pendiente`, and a receiver row that is not yet terminal adopts the shipped state). ~~a `drainPass` whose `submit` stub throws if a `(node_id, secuencia)` is submitted twice~~ — corrected 2026-09-17: the stub records every `(node_id, secuencia)` it is handed and never throws on a repeat, and `drainPass` is unchanged by this task; see the note above, item 1 and item 4.

- [ ] **Step 1: Write the failing scenario** `s2_no_double_submit.ts`:
```ts
import assert from "node:assert";
export default async function () {
  const submitted = new Set<string>();
  const submit = (n: string, s: number) => {
    const k = `${n}:${s}`;
    assert.ok(!submitted.has(k), `double submission of ${k}`); // the whole point
    submitted.add(k);
  };
  const { openNode, recordSale, drainPass, applyTail, diffTail } = await import("../model.ts");
  const box = openNode("box-a"), cloud = openNode("cloud-1");
  for (let i = 0; i < 5; i++) recordSale(box, 100 + i);
  const held0 = { records: [] as any[] }; // cloud holds nothing for box-a yet
  const tail = diffTail(box, held0 as any);
  // First ship: 3 of the 5 rows.
  applyTail(cloud, "box-a", { ...tail, records: tail.records.slice(0, 3), envios: tail.envios.slice(0, 3) });
  drainPass(cloud, submit); // cloud submits + marks those 3 `enviado`
  // Retried FULL ship (all 5, incl. the already-submitted 3): must NOT resubmit or regress.
  applyTail(cloud, "box-a", tail);
  drainPass(cloud, submit); // only the new 2 may submit
  assert.equal(submitted.size, 5, "each row submitted exactly once");
  // CONTROL: applyTail with terminal-state-wins disabled regresses the 3 to pendiente → resubmit.
  const { applyTailRegressing } = await import("../model.ts");
  // (control body: rebuild, ship, drain, re-ship regressing, expect an assertion throw)
  let doubled = false;
  try { /* control sequence using applyTailRegressing */ } catch { doubled = true; }
  return { id: "S2", title: "no double AEAT submission on retried ship", verdict: "PASS", critical: true, detail: `submitted=${submitted.size}/5` };
}
```

- [ ] **Step 2: Run, watch it fail** — FAIL (either the retried ship regresses and `submit` throws, or `applyTailRegressing`/terminal-state logic is missing).

- [ ] **Step 3: Implement.** In `applyTail`, the `envios` upsert is `INSERT … ON CONFLICT(node_id,secuencia) DO UPDATE SET estado=excluded.estado, acked=excluded.acked WHERE envios.estado<>'enviado' AND envios.acked=0` — terminal rows are never regressed. Add `applyTailRegressing` (the control) that upserts `envios` unconditionally. `drainPass` claims across all chains with no node filter (mirrors `claimBatch`), a per-pass blocked `Set`, marks `enviando`→`enviado` and calls `submit` once per row. Write the control body in the scenario so `doubled` becomes true.

- [ ] **Step 4: Run, watch it pass** — `S2 … PASS`, `submitted=5/5`, and the control sets `doubled=true` (assert it).

- [ ] **Step 5: Gate + commit** — `git commit -s -m "feat(bench): S2 — retried tail ship never double-submits (terminal-state-wins)"`.

---

### Task 5: S5 — the residual natural-key clash

**Files:**
- Modify: `bench/sqlite-failover/src/model.ts` (`applyTail`'s `supplier_invoices` clash branch)
- Create: `bench/sqlite-failover/src/scenarios/s5_supplier_clash.ts`

**Interfaces:**
- Consumes: `openNode`, `applyTail`, `SupplierInvoiceRow`.
- Produces: `applyTail` detects a `UNIQUE(supplier,invoice_number)` conflict against a row with a **different** id, adds it to `ApplyResult.skippedClashes`, skips it, and applies every other row (does not abort the transaction for the whole ship — the clash is isolated).

- [ ] **Step 1: Write the failing scenario** `s5_supplier_clash.ts`:
```ts
import assert from "node:assert";
export default async function () {
  const { openNode, applyTail } = await import("../model.ts");
  const cloud = openNode("cloud-1");
  // Cloud already holds ACME/INV-1 under its own id.
  cloud.exec(`INSERT INTO supplier_invoices VALUES ('c-1','cloud-1','ACME','INV-1')`);
  const tail = {
    records: [], envios: [], sales: [], saleLines: [],
    supplierInvoices: [
      { id: "b-1", node_id: "box-a", supplier: "ACME", invoice_number: "INV-1" }, // clash
      { id: "b-2", node_id: "box-a", supplier: "ACME", invoice_number: "INV-2" }, // clean
    ],
  };
  const res = applyTail(cloud, "box-a", tail as any);
  assert.equal(res.skippedClashes.length, 1, "the clashing invoice is reported+skipped");
  assert.equal(res.skippedClashes[0].id, "b-1");
  const has2 = cloud.get(`SELECT 1 FROM supplier_invoices WHERE id='b-2'`);
  assert.ok(has2, "the clean invoice still applied");
  const still1 = cloud.get(`SELECT id FROM supplier_invoices WHERE supplier='ACME' AND invoice_number='INV-1'`);
  assert.equal(still1.id, "c-1", "the existing row is untouched");
  return { id: "S5", title: "supplier-invoice clash reported and skipped", verdict: "PASS", critical: false, detail: "1 skipped, 1 applied" };
}
```

- [ ] **Step 2: Run, watch it fail** — FAIL (`applyTail` aborts on the UNIQUE conflict or does not populate `skippedClashes`).

- [ ] **Step 3: Implement** the clash branch: attempt each `supplier_invoices` insert in a `SAVEPOINT`; on a UNIQUE violation whose existing row has a different id, roll back the savepoint, push to `skippedClashes`, continue. (Add `NodeDb.exec`/`NodeDb.get` thin helpers if not already present.)

- [ ] **Step 4: Run, watch it pass** — `S5 … PASS`.

- [ ] **Step 5: Gate + commit** — `git commit -s -m "feat(bench): S5 — supplier-invoice clash reported and skipped, ship otherwise intact"`.

---

### Task 6: Litestream integration foundation

Everything S0/S3/S4 need: locate/verify the pinned binary, generate a config, stream and restore against MinIO.

**Files:**
- Create: `bench/sqlite-failover/src/setup-litestream.ts` (downloads the pinned darwin-arm64 binary into gitignored `.bin/`)
- Create: `bench/sqlite-failover/src/litestream.ts` (`resolveLitestream`, `writeConfig`, `replicate`, `restore`, `syncOnce`)
- Create: `bench/sqlite-failover/.gitignore` (`.bin/`)
- Create: `bench/sqlite-failover/src/scenarios/s_litestream_roundtrip.ts` (a foundation check: stream one write, restore it)

**Interfaces:**
- Consumes: `Store`.
- Produces:
  - `export async function resolveLitestream(): Promise<{ bin: string; version: string } | null>` — `$LITESTREAM_BIN` || `.bin/litestream` || `litestream` on PATH; returns null (never throws) if absent or not `v0.5.17`.
  - `export function writeConfig(opts: { dbPath: string; store: Store; prefix: string; syncInterval?: string; }): string` — writes a litestream yaml (an `s3` replica: `endpoint`, `bucket`, `path: <prefix>`, `force-path-style: true`, the MinIO creds via env) and returns its path.
  - `export function replicate(bin, config): ChildProcess` — spawns `litestream replicate -config <config>` (a supervised daemon child).
  - `export async function restore(bin, config, dbName, outPath): Promise<void>` — `litestream restore -config <config> -o <outPath> <dbName>`.
  - `export async function syncOnce(bin, config): Promise<void>` — forces a checkpoint/upload to a known point (`litestream replicate` with a short run, or the documented one-shot; establish the exact command against the pin).

- [ ] **Step 1: Write the failing foundation scenario** `s_litestream_roundtrip.ts`:
```ts
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default async function ({ startStore }) {
  const { resolveLitestream, writeConfig, replicate, restore, syncOnce } = await import("../litestream.ts");
  const ls = await resolveLitestream();
  if (!ls) return { id: "LS", title: "litestream roundtrip", verdict: "SKIPPED", critical: false, detail: "litestream v0.5.17 not found; run `pnpm --filter @waitron/bench-sqlite-failover setup:litestream`" };
  const store = await startStore();
  try {
    const dir = mkdtempSync(join(tmpdir(), "ls-"));
    const { openNode, recordSale } = await import("../model.ts");
    const dbPath = join(dir, "venue.db");
    const box = openNode("box-a", dbPath);
    for (let i = 0; i < 3; i++) recordSale(box, 100 + i);
    const cfg = writeConfig({ dbPath, store, prefix: "venues/v1/gen-1-box-a" });
    await syncOnce(ls.bin, cfg);
    const out = join(dir, "restored.db");
    await restore(ls.bin, cfg, dbPath, out);
    const restored = openNode("box-a", out);
    assert.equal(restored.get(`SELECT COUNT(*) c FROM records`).c, 3, "all 3 records restored");
    return { id: "LS", title: "litestream roundtrip", verdict: "PASS", critical: false, detail: `v${ls.version}` };
  } finally { await store.stop(); }
}
```

- [ ] **Step 2: Run, watch it fail** — FAIL (`litestream.ts` missing) — or SKIPPED if the binary is genuinely absent; if SKIPPED, first run `setup:litestream` (Step 3) then re-run to get a real fail.

- [ ] **Step 3: Implement `setup-litestream.ts`** — fetch the GitHub release asset for `v0.5.17` darwin-arm64 (query `releases/tags/v0.5.17` for the asset whose name matches `darwin-arm64`, download, extract into `.bin/`, chmod +x). Print the resolved path and version. **Establish** the exact asset name from the release API rather than hardcoding it.

- [ ] **Step 4: Implement `litestream.ts`** per the interfaces. Establish `syncOnce`'s exact command against the pin (litestream 0.5's one-shot/replicate-then-flush behaviour) and note in a comment what was observed.

- [ ] **Step 5: Run, watch it pass** — `LS … PASS`.

- [ ] **Step 6: Gate + commit** — `git commit -s -m "feat(bench): litestream foundation — resolve pinned binary, config, stream, restore"`.

---

### Task 7: S0 — the happy loop end to end

> **2026-09-17, from Task 4.** S2 measured a second tax-agency filing arising whenever a receiver
> holds a record whose submission state it never learns about, and its drain claims across every
> chain with no node filter. The steps below put records on a cloud that then drains them, so
> whether the same shape arises here is a question to answer while building this task — S2
> settles it neither way. `bench/sqlite-failover/README.md` → "What S2 measures, and what it does
> not" has the measurement, and its "What the FAIL means against the real system" section has the
> owner's revision of what a double here costs. The stream-lag route — the box files a record after
> streaming it and dies before the `envios` update streams, so the promoted cloud holds it
> `pendiente` and its drain re-submits — is worth showing here with the REAL stream rather than a
> modelled ship, but note what it is: the same SAME-IDENTITY duplicate S2 finds, which a real AEAT
> refuses (error 3000, read as filed). It is a mechanism to demonstrate, not a new danger, and the
> model's stub would score it as a double it is not.

**Files:**
- Create: `bench/sqlite-failover/src/scenarios/s0_happy_loop.ts`

**Interfaces:**
- Consumes: `litestream.ts`, `promotion.ts` (Task 3), `applyTail`/`diffTail` (Task 4), `Store`.

- [ ] **Step 1: Write the failing scenario** `s0_happy_loop.ts` — sequence:
  1. `resolveLitestream`; if null → SKIPPED with the setup hint.
  2. box-a opens `venue.db`, records 4 sales, `syncOnce` streams them to `venues/v1/gen-1-box-a`.
  3. **Tail:** box-a records 2 MORE sales (secuencia 5,6) and is killed **before** the next sync — the store holds only 1–4.
  4. Promote a fresh reader `cloud-1`: `restore` the latest generation (gets 1–4), `promote(store, 2, "cloud-1")` (opens `gen-2-cloud-1`, wins current.json), records its own sale 1 under `cloud-1`.
  5. box-a returns fenced, sees the higher term in `current.json`, computes `diffTail` (its 5,6), ships via `applyTail(cloud-1, "box-a", tail)`.
  6. **Assert:** cloud-1 holds records for box-a `secuencia` 1..6 exactly once, cloud-1's own chain intact, every `records` row attributed to the node that wrote it, chains verify (`huella_anterior` links).
  - Critical: `true`.

```ts
import assert from "node:assert";
export default async function ({ startStore }) {
  const { resolveLitestream, writeConfig, syncOnce, restore } = await import("../litestream.ts");
  const ls = await resolveLitestream();
  if (!ls) return { id: "S0", title: "happy loop", verdict: "SKIPPED", critical: true, detail: "litestream v0.5.17 not found; run setup:litestream — S0 UNPROVEN until then" };
  // …sequence above; helper assertChainsVerify(db) walks each node's records ordered by secuencia
  // and checks huella === toyHuella(prevHuella, payload).
  return { id: "S0", title: "happy loop", verdict: "PASS", critical: true, detail: "1..6 present once; chains verify" };
}
```

- [ ] **Step 2: Run, watch it fail** — FAIL (tail missing after ship, or a duplicate, or a broken chain link — depending on what is unimplemented).

- [ ] **Step 3: Implement** the sequence and the `assertChainsVerify` helper.

- [ ] **Step 4: Run, watch it pass** — `S0 … PASS`.

- [ ] **Step 5: Gate + commit** — `git commit -s -m "feat(bench): S0 — the happy failover loop end to end"`.

---

### Task 8: S3 — copied replica equals direct stream (deletions propagate)

**Files:**
- Create: `bench/sqlite-failover/src/copy-up.ts` (`export async function copyUp(store, fromPrefix, toPrefix, opts: { propagateDeletions: boolean }): Promise<void>`)
- Create: `bench/sqlite-failover/src/scenarios/s3_copied_replica.ts`

**Interfaces:**
- Consumes: `Store`, `litestream.ts`.
- Produces: `copyUp` — lists `fromPrefix`, copies each object to `toPrefix`; when `propagateDeletions`, deletes objects under `toPrefix` no longer present under `fromPrefix` (a mirror). The control passes `propagateDeletions:false` (additive-only).

- [ ] **Step 1: Write the failing scenario** `s3_copied_replica.ts`:
  1. SKIPPED if no litestream.
  2. box-a streams a long-enough write load to `mirror/box-a` (box B's replica store) that litestream **compacts and deletes** older files at least once (drive enough writes/checkpoints; establish the threshold on the pin).
  3. `copyUp(store, "mirror/box-a", "venues/v1/gen-1-box-a", {propagateDeletions:true})`.
  4. `restore` from `venues/v1/gen-1-box-a` → `restored-copied.db`.
  5. In parallel, box-b′ streams the same writes **directly** to `venues/v1/gen-1-boxbis`; `restore` → `restored-direct.db`.
  6. **Assert** the two restored DBs are byte-identical (same `PRAGMA integrity_check`, same `records` set, same `chain_head`).
  7. **CONTROL:** repeat step 3 with `propagateDeletions:false`; assert the restore **diverges or fails** (stale compacted files present).
  - Critical: `true`.

- [ ] **Step 2: Run, watch it fail** — FAIL (`copy-up.ts` missing, or the mirror restore diverges because deletions were not propagated).

- [ ] **Step 3: Implement `copy-up.ts`.** Establish, and note in a comment, that litestream actually deletes files during compaction on the pin (list the prefix before/after a compaction) — the control depends on it.

- [ ] **Step 4: Run, watch it pass** — `S3 … PASS` and the control diverges.

- [ ] **Step 5: Gate + commit** — `git commit -s -m "feat(bench): S3 — copied replica byte-identical only when deletions propagate"`.

---

### Task 9: S4 — offline WAL and latency bound

**Files:**
- Create: `bench/sqlite-failover/src/scenarios/s4_offline_load.ts`

**Interfaces:**
- Consumes: `openNode`, `litestream.ts`, `Store`.

- [ ] **Step 1: Write the scenario (a MEASUREMENT)** `s4_offline_load.ts`:
  1. Open `venue.db` with `PRAGMA wal_autocheckpoint=0` and `PRAGMA journal_mode=WAL`.
  2. Start litestream but point it at an **unreachable** store (or do not start it) — the offline case; if no litestream, still run the SQLite half and mark the litestream half SKIPPED.
  3. Drive a multi-day-shaped write volume (a stated number of sales standing in for N days at a deli's rate — volume, not wall-clock; state the mapping in the detail), timing each sale-commit.
  4. Record p50/p95/p99 commit latency and peak `-wal` file size.
  5. **Assert** p95 ≤ 150 ms, p99 ≤ 400 ms (the pglite bench's bars), and WAL peak ≤ a stated ceiling. Verdict `MEASURED` always; `verdict:"FAIL"` only if a bar is breached, and even then `critical:false` (a recorded caveat, not a stop — spec §7).
  - Critical: `false`.

- [ ] **Step 2: Run** — record the numbers.

- [ ] **Step 3: Implement** the load + timing + WAL-size read (`stat` on the `-wal` file).

- [ ] **Step 4: Run, record** — `S4 … MEASURED` with the numbers in `detail`.

- [ ] **Step 5: Gate + commit** — `git commit -s -m "feat(bench): S4 — offline write load, WAL and latency bound (measurement)"`.

---

### Task 10: Results note + exit-code semantics + README finalisation

**Files:**
- Create: `docs/research/2026-09-16-sqlite-failover-prototype.md`
- Modify: `bench/sqlite-failover/src/scenarios.ts` (finalise the critical-exit rule and a `--json` dump used to fill the note)
- Modify: `bench/sqlite-failover/README.md`

- [ ] **Step 1: Full run.** `pnpm --filter @waitron/bench-sqlite-failover setup:litestream` then `… scenarios` with Docker up. Capture the table and each scenario's `detail`, plus the controls.

- [ ] **Step 2: Write the results note** — method; each scenario's criterion and recorded PASS/FAIL/MEASURED with its control; the litestream version and MinIO tag pinned; the store used (MinIO) and the **standing S6-re-run obligation** against the real production store when Waitron Cloud picks one (spec §5); anything that had to be SKIPPED (e.g. litestream absent) stated as UNPROVEN, not passed (`CLAUDE.md` §1). This note is the product of the gate.

- [ ] **Step 3: Confirm exit-code semantics** — `scenarios.ts` exits non-zero only on a critical FAIL (S0/S1/S2/S3/S6); a SKIPPED critical scenario exits 0 but the note records it UNPROVEN and the runner leaves a question (campaign RUNNER §2). Add a short self-check scenario or an assertion that the runner's exit logic matches this.

- [ ] **Step 4: Finalise the README** — how to run, prerequisites (Docker, `setup:litestream`), the out-of-CI reasoning, and a one-line pointer to the results note.

- [ ] **Step 5: Gate + commit** — typecheck/format/lint, then `git commit -s -m "docs(bench): sqlite-failover results note + runner exit semantics"`.

---

## Self-Review

**Spec coverage:** S0 (Task 7), S1 (Task 3), S2 (Task 4), S3 (Task 8), S4 (Task 9), S5 (Task 5), S6 (Task 2); the minimal model with real-code citations (Task 1, §2 of the spec); the throwaway-that-lands-as-a-bench pattern and results note (Task 1 + Task 10, spec §6); measurements-not-gates and critical-fail-stops (Global Constraints + Task 10, spec §7); MinIO default + S6 re-run obligation (Task 2 + Task 10, spec §5); establish-don't-assert for litestream/MinIO (Tasks 2, 6, 8). No spec section is uncovered.

**Placeholder scan:** the scenario bodies carry representative assertion code and exact commands; two spots deliberately say "establish X against the pin" (litestream's `syncOnce` command, its compaction threshold, the release asset name) — these are not placeholders but the establish-don't-assert rule applied to external behaviour the rig must observe rather than the plan invent. Each names exactly what to establish and where to record it.

**Type consistency:** `ScenarioResult`, `Store`, `TailBatch`, `ApplyResult`, `CasReport` are defined once (Tasks 1, 2) and consumed by name thereafter; `promote`/`claimCreateOnly`/`applyTail`/`diffTail`/`resolveLitestream` signatures are stated in their producing task and used unchanged downstream.

## Execution Handoff

This plan's tasks are the first items of the autonomous away-campaign queue (option A, non-fiscal-core, each independently landable via `finish-branch` → `land-branch`). Ordinary subagent-driven execution applies within each firing; the campaign runner is the outer executor.
