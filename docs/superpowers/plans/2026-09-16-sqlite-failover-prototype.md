# SQLite + Litestream failover prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the throwaway rig that proves the SQLite + Litestream box→store→promote→return-with-a-tail→ship→rejoin loop holds together fiscally, before slice 1 rewrites the storage layer.

**Architecture:** A private workspace package `bench/sqlite-failover`, modelled on `bench/pglite-throughput` (Docker-dependent, run by hand; no scenario ever runs in CI). Seven scenarios (S0–S6) each assert one invariant from the topology design's gate-2 obligations and each carry a control that reproduces the opposite result. Four scenarios (S1, S2, S5, S6) exercise our own logic over `node:sqlite` with no Litestream, so they are deterministic and need no process orchestration — two of them (S1 and S6) against a local MinIO store, while S2 and S5 need no store at all; three (S0, S3, S4) drive the real Litestream binary. The rig stands up a **minimal model** of the fiscal ledger — it does not import `packages/fiscal-verifactu` — and each model piece cites the real table it mirrors.

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
-- MODEL of registros_facturacion (packages/fiscal-verifactu/src/schema/registros.ts:23,139).
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
>    that cannot fail. A stub modelling error 3000 is idempotent by construction, so its double
>    COUNTER can only ever read zero — the parts that assert still see a change, which the review
>    seat established by running one; every double this rig finds is the SAME invoice identity, which a real AEAT refuses.
>    The one genuine double-filing shape is a DIFFERENT identity for one sale (re-keying), which S2
>    does not model and fresh-series-on-restore guards. The second follow-up — fence before ship, meaning the old primary is
>    decommissioned before the tail moves — is written into topology design §5.2 on this branch.
>    Resolving its in-flight submissions first is explicitly NOT required there: the receiver deals
>    with such a row — its drain's five-minute reset today, and the boot reset §5.2 requires for the
>    copy it inherited through the stream, once that is built.

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

> **2026-09-18, as landed.** Six things below were changed while building it, and the code is what
> holds. (1) **There is no `SAVEPOINT`**, which Step 3 asks for. It was measured rather than argued:
> on SQLite 3.53.4, the engine node v26.7.0 carries, one transaction — a sale, a clashing invoice
> insert, then a clean invoice and a second sale — was run once with the clashing insert inside `SAVEPOINT`/`ROLLBACK TO` and once with
> only a `try`/`catch`, and both arms committed both sales and the clean invoice with no error on
> `COMMIT`. What SQLite's own documentation says about its default conflict resolution, quoted with
> its URL and the date it was read, is in `bench/sqlite-failover/README.md` → "What S5 measures, and
> the savepoint it does not need". The same probe written with `INSERT OR ROLLBACK` does print a
> difference, so it is capable of measuring one; a later insert here using a non-default conflict resolution has to
> re-run it. (2) The step-1 snippet is not the scenario. It ships a hand-built batch whose
> `records`, `sales` and `saleLines` are empty, so its "every other row applies" assertion would
> have been asserted over nothing; the scenario uses the spec's own setup instead — two nodes, a
> real `diffTail` of a real tail — and compares the rows the receiver ends up holding, field by
> field, with the rows that were shipped. (3) A case neither plan nor spec names is pinned: **the same tail shipped
> again**. A ship is retried whenever its confirmation is lost, so a branch reading every refused
> insert as a clash would hand a person the sender's clean invoice as a clash on the second ship.
> The rule distinguishes a row held under a DIFFERENT id (the clash) from one held under the SAME id
> (a retry, and a silent no-op). (4) Two control seats the **Interfaces** block below does not
> mention were added beside `applyTail`: `applyTailSilentDrop` and `applyTailUnisolated`, each a
> setting of the new `ClashRule` parameter that `applyShippedTail` takes. They reproduce the two
> failures spec §4's S5 rules out — `silent-drop` is "not silently dropped", where the row reaches
> neither the table nor the report, and `unisolated` is "not crashing the whole ship", where the
> uncaught refusal rolls the whole batch back. (5) S5 needs no object store, the same as S2: it
> ships between two in-memory SQLite databases and starts no MinIO container, which is why the
> Architecture paragraph at the top of this plan no longer says three scenarios use the store.
> (6) **A refused insert is classified by SQLite's extended result code before the table is read at
> all**, which neither plan nor spec asks for. Only 1555 (a primary key) and 2067 (a unique index)
> are read any further; every other refusal — a missing `NOT NULL` value, a trigger's `RAISE(ABORT)`
> — is rethrown and takes the batch down. Reading the table first would swallow those, because a
> receiver that already holds the arriving row's id looks exactly like a ship arriving twice. The
> scenario holds the apply to it with a third control, a receiver whose `BEFORE INSERT` trigger
> refuses the arriving row for a reason of its own, on the assertion "a refusal that is not about
> uniqueness leaves the apply instead of being read as a clash". Details and the runs behind all
> six: PR for this task, and
> `bench/sqlite-failover/README.md` → "What S5 measures, and the savepoint it does not need".

**Files:**
- Modify: `bench/sqlite-failover/src/model.ts` (`applyTail`'s `supplier_invoices` clash branch)
- Create: `bench/sqlite-failover/src/scenarios/s5_supplier_clash.ts`

**Interfaces:**
- Consumes: `openNode`, `applyTail`, `SupplierInvoiceRow`.
- Produces: `applyTail` classifies a refused `supplier_invoices` insert by SQLite's extended result code first — only a primary-key (1555) or unique-index (2067) refusal is read any further, anything else is rethrown and rolls the whole ship back — and then reads the rows already held: a `UNIQUE(supplier,invoice_number)` conflict against a row with a **different** id goes into `ApplyResult.skippedClashes` and is skipped, the same id is a retried ship and a silent no-op, and either way every other row in the batch still applies (the transaction is not aborted — the clash is isolated).

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

> **2026-09-18, as landed.** Everything below was measured on this machine against the pin
> (litestream v0.5.17 darwin-arm64, node v26.7.0, the pinned MinIO image), not read off
> documentation. Tasks 7, 8 and 9 drive this code, so read this before the Files and Interfaces
> blocks underneath it — several of those describe an interface that is not what landed.
>
> - **The Interfaces block below describes litestream 0.3's config, and this pin is 0.5.** What
>   landed writes a singular `replica:` object holding a URL —
>   `replica: { url: s3://<bucket>/<prefix>?endpoint=…&region=…&force-path-style=true }` — with the
>   credentials named as `${VAR}` and supplied in the child's environment, which is the shape 0.5's
>   own bundled sample config documents. That is a choice, not a requirement: the pin was also given
>   0.3's plural `replicas:` list with separate `type`/`bucket`/`path`/`endpoint`/`region` keys, and
>   it replicated and restored just as well. `force-path-style=true` was likewise measured NOT to be
>   required against a `http://localhost:<port>` endpoint, and is kept only because no other kind of
>   endpoint has been tried.
> - **`syncOnce` is `litestream replicate -once`**, which syncs everything and exits 0. The `sync`
>   subcommand this plan hints at is a different thing: its help asks for a control socket, so it
>   talks to a daemon that is already running.
> - **`syncInterval` was NOT implemented** — nothing drives it, and the daemon part of the scenario
>   waits on an observed effect rather than on a configured interval. `writeConfig` instead takes a
>   required `configPath`, because the caller chooses where the file goes. `replicate` returns
>   `{ kill(), exited }` rather than a raw `ChildProcess`, so a caller can wait for the child to be
>   GONE rather than for the signal to have been sent.
> - **`writeConfig` is now the only way to make a config this module will run.** It records the
>   store's credentials against the config path it wrote, and the spawn helpers refuse a config they
>   have no credentials for rather than running litestream with empty ones and getting a store error
>   back. A Task 7 author hand-writing a yaml will hit that refusal by name.
> - **`Store` grew a `credentials` field** (`src/store.ts`), which is how those credentials reach the
>   litestream child; it does not share the S3 client.
> - **Every litestream call is bounded and kills its child at the bound.** A caller's own deadline
>   cannot do this job: a poll that re-checks the clock each time round never gets back to the check
>   while awaiting a child that has stopped. Measured against a stub whose `restore` sleeps — with no
>   bound, a 60-second poll was still unsettled at 65 seconds and its cleanup had not run, so the
>   MinIO container stayed up too. The bound also settles ITSELF rather than waiting for the child's
>   `close` event, which fires when the stdio pipes close and so never arrives if the killed child's
>   own children inherited them.
> - **The scenario is larger than the snippet below, and the extra parts are the measurement.** The
>   snippet restores while the source database is still on disk, where a `restore` that merely copied
>   the file beside it would return exactly the same rows — measured: with `restore` replaced by
>   `copyFileSync` and the source left in place, the whole scenario reports PASS. As landed it deletes
>   the source first, compares the restored rows one by one rather than counting them, drives a
>   `replicate` daemon, and carries a control in which a prefix nothing streamed must yield no
>   database.
> - **A daemon part that writes immediately after spawning measures nothing.** With `replicate`
>   mutated to spawn the one-shot, an earlier shape of that part reported PASS with all four rows: the
>   one-shot syncs a few hundred milliseconds in, by which time the extra inserts have landed. It
>   waits for the first sync to be VISIBLE before writing again; the mutation then fails at the
>   deadline having seen 2 of 4.
> - **A control that counts errors is not a control.** The empty-prefix control first accepted any
>   non-empty error message, and a restore replaced by `throw new Error("spawn ENOENT")` left the
>   whole scenario PASSing — a litestream that could not be run recorded as a litestream that
>   refused. It now matches litestream's missing-backup words and prints them in the verdict.
>
> Four facts Tasks 7-9 will need, none of them things to re-derive:
>
> - **`restore` refuses a NON-EMPTY output path** — `Error: cannot restore, output path already
>   exists and is not empty: …. Use -force to overwrite`, before any store call. An EMPTY file there
>   is fine, and litestream removes it itself if the restore then fails. Nothing here passes `-force`.
>   A successful restore writes the output file and nothing else; the `-shm`/`-wal` sidecars beside it
>   are SQLite's, and appear only once something opens the result.
> - **A restore with the source database absent returns every row**, which is what makes a restore
>   evidence about the STORE rather than about the file next door.
> - **litestream logs to STDOUT**, not stderr (its bundled `etc/litestream.yml` documents
>   `logging.stderr` as defaulting to false; measured — one `replicate -once` gave 7 lines on stdout
>   and 0 on stderr). Errors from `restore` DO go to stderr, including a real store failure
>   (`NoSuchBucket`, exit 1, nothing on stdout).
> - **No WAL pragma is needed first.** A database in `openNode`'s default `delete` journal mode
>   replicated and restored fine, and litestream switched it to `wal` itself.

Everything S0/S3/S4 need: locate/verify the pinned binary, generate a config, stream and restore against MinIO.

**Files:**
- Create: `bench/sqlite-failover/src/setup-litestream.ts` (~~downloads the pinned darwin-arm64 binary into gitignored `.bin/`~~ — corrected 2026-09-18: it downloads the pinned binary for THIS host into the gitignored `.bin/`, composing the asset name from `process.platform` and `process.arch`, so a platform the rig has not been run on fails on a missing asset rather than installing a darwin binary. `x64` is mapped to `x86_64`, because that is how the command-line tool's assets are named.)
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

- [ ] **Step 3: Implement `setup-litestream.ts`** — fetch the GitHub release asset for `v0.5.17` (query `releases/tags/v0.5.17` ~~for the asset whose name matches `darwin-arm64`~~, download, extract into `.bin/`, chmod +x). Print the resolved path and version. **Establish** the exact asset name from the release API rather than hardcoding it. — corrected 2026-09-18: matching on a substring picks whichever artefact the release API happens to list first. The `v0.5.17` release holds both `litestream-0.5.17-darwin-arm64.tar.gz` (the command-line tool) and `litestream-vfs-v0.5.17-darwin-arm64.tar.gz` (a different artefact), so a `includes("darwin-arm64")` test matches two of them. What landed builds the full asset name from this host and looks for exactly that name.

- [ ] **Step 4: Implement `litestream.ts`** per the interfaces. Establish `syncOnce`'s exact command against the pin (litestream 0.5's one-shot/replicate-then-flush behaviour) and note in a comment what was observed.

- [ ] **Step 5: Run, watch it pass** — `LS … PASS`.

- [ ] **Step 6: Gate + commit** — `git commit -s -m "feat(bench): litestream foundation — resolve pinned binary, config, stream, restore"`.

---

### Task 7: S0 — the happy loop end to end

> **2026-09-18, as landed (revised the same day after review).** The scenario is ONE parametrised
> loop run THREE times, rather than the single sequence step 1 describes. Two flags separate the runs
> — does the returning box ship its tail, and do its own filings reach the store before it dies — and
> everything below follows from that shape. The three runs share ONE MinIO store and are kept apart
> by TERM, the way `s1_double_promotion.ts` keeps its control off its fenced race: box terms 1, 3 and
> 5 name the generation each run's box streams to, cloud terms 2, 4 and 6 name the generation each
> run's cloud opens and the create-only claim key it takes. Each run still gets its own temp
> directory. `bench/sqlite-failover/README.md` → "What S0's loop covers, and what its Part C records"
> carries the recorded run, the mutation list and the messages each mutation produced, including the
> two that show what the shared store costs: with one part's restore pointed at another part's
> generation, what refuses it is the check that part makes against its OWN box's rows — the
> field-by-field comparison in Part B, the attribution check in Part C.
>
> - **Litestream is driven by ONE-SHOT syncs here, never by the daemon.** Every upload S0 makes is
>   `syncOnce`; nothing in it calls `replicate`. So "the box dies before the next sync" is a scripted
>   step rather than the timing window it would be under the daemon, and S0 is no evidence about that
>   window. The 2026-09-17 note below asks for the REAL stream rather than a modelled ship, and that
>   is what a one-shot gives: a real litestream upload and a real restore. *(2026-09-18: when this
>   was written the daemon was the `LS` foundation check's alone. Task 8's S3 now runs one too — box-a
>   sells under a real `replicate` daemon and the scenario restores from that daemon's stream — so
>   "the daemon is still owed" no longer holds for the stream itself. What S0's own sentence says is
>   unchanged: S0 still starts no daemon, and still measures nothing about the timing window.)*
> - **Step 1's step 5 says "box-a returns fenced"; the landed scenario models no fence at all.**
>   Box-a reads the higher term from `current.json` and ships because the scenario has it ship —
>   nothing would have stopped it selling. The file's header says so, and a fenced node that cannot
>   sell is left to a later task.
> - **The verdict string is a `key=value` list, not prose** (`docs/backlog.md` records that shape as
>   settled for what Task 10 parses). Every number and identity the first version printed as a
>   sentence is still there, under a key: `happy-*` for Part A, `control-*` for Part B, `lag-*` for
>   Part C. The two flag keys read the flags rather than restating them, so a run with a flag flipped
>   cannot print the other one's label.
> - **Step 1's sequence has no control, and a scenario without one is incomplete** (this plan's
>   Global Constraints). Part B is it: the identical loop with the ship left out, where the cloud must
>   end up holding box-a 1..4 and not the tail. It drives Part A's OWN comparison over that state and
>   requires it to throw, rather than asserting "5 and 6 are missing" in words of its own — which
>   would stay green if Part A's comparison had stopped checking anything. Run with the ship handed
>   back to the control, it fails on "without the ship the cloud holds only the records the stream
>   carried", so it is not green by construction.
> - **Step 2 — "run, watch it fail" — did not happen, and saying otherwise would be inventing a red.**
>   Part A passed on its first run: there was no production code to add, the whole task being a
>   scenario over interfaces Tasks 1-6 landed. What stands in for it is the mutation list in the
>   README section named at the top of this note, each mutation applied on its own and the runner run
>   whole with `TESTCONTAINERS_RYUK_DISABLED=true node src/scenarios.ts` from `bench/sqlite-failover`
>   on 2026-09-18, each making one named assertion the one that failed. **Not every assertion in the
>   file has a mutation**, and the README names the ones that do not and why — among them the cloud's
>   own-chain lines below the first, which the length assertion above them reaches first. Two results
>   the README reports as they came out: the attribution check fires only on a row under a THIRD node
>   id (the sharper assertions reach every other state first), and a submit stub that keeps one entry
>   per identity leaves Part A green, Part C being what catches it.
> - **The question the 2026-09-17 note below poses is answered, and the answer is Part C.** The same
>   shape S2 found DOES arise here, by the stream-lag route that note names: with no sync after the
>   box files its own records, the promoted cloud restores them `pendiente` and files them a second
>   time. Measured: four records, `box-a:1` to `box-a:4`, each a verbatim same-identity copy — same
>   node, same secuencia, same huella, same payload as the row the box filed, asserted row by row.
>   **Part C does not decide S0's verdict**, which Parts A and B do: it is the duplicate a real AEAT
>   refuses with error 3000 and our drain reads as filed, which the owner has already read down
>   (README → "What the FAIL means against the real system"), and the model's stub would score it as a
>   double it is not. Part A is its control — the same code path, one flag different, zero re-filings
>   — and flipping Part C's flag to match Part A took the count from four to zero. **Part C runs Part
>   A's attribution check too**, because the repeats it counts are selected BY IDENTITY and so cannot
>   see a duplicate filed under a different node id: with an extra row carrying `box-a:1`'s payload
>   inserted as `box-c:1` before the cloud's first drain, the scenario reported PASS without that
>   check and fails on "the cloud filed box-a:1's record as box-c:1" with it.
> - **Step 1's assertion list grew three items and an order.** `assertChainsVerify` also checks that
>   each chain's secuencias run 1..N with no gap, not only that the huella links hold. The chain check
>   runs FIRST, so a corrupted payload is reported as a broken chain rather than as a content
>   mismatch. And both Part A and Part C assert that the cloud's drain files exactly the rows the
>   cloud itself held `pendiente` in the instant before it drained — a statement about the drain that
>   is true either way, which is what makes Part C's number a difference in the loop's state rather
>   than in what was asserted.
> - **"Exactly once" is measured on the SUBMIT LEDGER, not on the table.** `records` is keyed
>   `(node_id, secuencia)`, so it could not hold a row twice however the loop behaved; the ledger the
>   tax-agency stub writes is the only place the claim has any content. It is compared as a sorted
>   list, never counted.
> - **The SKIPPED path starts no container, and that was run rather than read.** With
>   `.bin/litestream` moved aside and no `litestream` on `PATH`, the scenario was called directly with
>   a `startStore` that throws if it is reached: it returned `SKIPPED … S0 is UNPROVEN until then`.
>   The control — the same call with the binary back — printed `THREW PROBE: startStore was called`.
> - **Nothing streams the cloud's own generation**, and no node here follows `current.json` to restore
>   from it: `promote` writes the pointer and a generation marker, and Part A reads the pointer back
>   to check it. A node restoring `gen-2-cloud-1` is Task 8's.
> - **No rig behaviour changed for this task.** `model.ts`, `promotion.ts`, `store.ts` and
>   `scenarios.ts` are untouched. Outside the new scenario the change edits four things and nothing
>   else: the package README (its S0 section, and one corrected sentence in its S2 one), a COMMENT in
>   `litestream.ts` whose receipt for asking a daemon to stop nicely named S0 as a future user of a
>   daemon S0 turns out never to start, this note, and a dated pointer in the topology design (§5.2)
>   for what Part A now runs of its streamed-`envios` assumption.

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

> **2026-09-18, as landed.** Everything below was measured on this machine against the pin
> (litestream v0.5.17 darwin-arm64, node v26.7.0, the pinned MinIO image). The scenario is three
> parts sharing one store, not the one sequence steps 1-4 describe, and **step 1's CONTROL does not
> reproduce the opposite result on this pin** — that is the largest deviation and the rest follow
> from it. The recorded run, the mutation list and the two assertions that have no mutation are in
> `bench/sqlite-failover/README.md` → "What S3's copy covers, and what its Part C records".
>
> - **The plan's control — additive-only diverges because stale compacted files are present — was
>   run, and it does NOT diverge.** With the destination holding only THIS lineage's files, some of
>   them taken before the source compacted and deleted them, the restore comes back identical to the
>   direct one: same file bytes, same rows, same chain tips. A replica file's name carries the
>   transaction range it covers (`venues/v1/gen-1-box-a/0000/0000000000000001-0000000000000001.ltx`,
>   read off a listing), so putting a file back under the name it already had puts the same range
>   back twice. That measurement is kept as Part C, which asserts only its preconditions and
>   RECORDS its outcome; it decides nothing. *(2026-09-18, after review: a litestream that DECLINES
>   to restore the same-lineage replica is also a result of this experiment, and it used to make the
>   whole scenario throw. Part C now has three outcomes — `identical`, `diverged: …` and `refused: …`,
>   that last being this rig's wrapper text followed by litestream's first stderr line. A second
>   correction the same day fixed WHICH declines count: the first attempt matched the wrapper
>   `litestream restore exited <code>: `, which goes on EVERY non-zero exit, so a wrongly copied
>   replica, a store error or an output file already in place would each have been recorded as an
>   outcome. It now matches litestream's missing-backup WORDS, and every other non-zero exit fails the
>   scenario. Driven from scratch copies whose same-lineage restore threw: the missing-backup words
>   gave a PASS printing `same-lineage-additive="refused: litestream restore exited 1: Error: no
>   matching backup files available"`; the decode error a wrongly copied replica really produces
>   (`decode database: decode header: non-contiguous transaction ids in input files`) threw and failed
>   the scenario — and against the wrapper-only matcher that same decode error was recorded as an
>   outcome with S3 reporting PASS, which is the defect the words-matcher removes. Also:
>   `same-lineage-rows=0` means no restore happened, not an empty database.)*
> - **What replaced it is a destination holding a FOREIGN lineage.** Part B streams a second venue's
>   replica (box-b, nine sales, one sync each) into the destination and then copies box-a's over it
>   additively. The restore exits 0 and hands back **box-b's nine rows** — a different venue's
>   ledger, no error anywhere. Part A uses the identical recipe with `propagateDeletions: true` and
>   is the verdict. So the scenario's claim is narrower and sharper than step 6's: a copied replica
>   equals a direct stream when the copy is a MIRROR, and an additive copy onto a dirty destination
>   silently restores whatever the leftovers win.
> - **Which assertion refuses the control is recorded rather than assumed, and it is not the row
>   comparison.** The mixed set of files restores a database SQLite itself calls damaged —
>   `row 1 missing from index sqlite_autoindex_chain_head_1` — while still reading back box-b's rows,
>   so Part A's integrity check is what fires. The verdict prints both that string and the refusal's
>   own words, because a later run refusing at the row comparison would be a different finding.
> - **`copyUp` returns `{ copied, deleted }`, not `void`.** The counts go in the verdict line, and
>   `deleted` is the number that separates the two modes: an additive copy of a source that dropped
>   files is indistinguishable from a mirror of a source that never did, if all a caller can see is
>   that the call returned. It also refuses two prefixes where one contains the other, rather than
>   handling them.
> - **Step 2 names the config keys the plan never did.** Deletion during compaction is real on this
>   pin but needs four GLOBAL keys, which `writeConfig` now writes behind a `fastCompaction` option:
>   `l0-retention: 2s`, `l0-retention-check-interval: 1s`, and a three-entry `levels` list at 2s/30s/
>   60s. The negative control was run: with the DEFAULT settings, box-a wrote 131 replica files in two
>   minutes and litestream deleted none of them, and the scenario fails on exactly that sentence.
>   What the individual keys mean is not established — only the effect of setting all four.
> - **Step 2's "run, watch it fail" happened, and its red was the missing module.** With the scenario
>   written and `src/copy-up.ts` absent, the runner reported
>   `s3_copied_replica | threw | FAIL | Cannot find module …/src/copy-up.ts`. `writeConfig`'s
>   `fastCompaction` option was added BEFORE that run, as infrastructure the scenario needed to reach
>   its subject at all, so it is not part of the red; nothing else in the scenario was red first,
>   every other interface it composes having already existed. The mutation list in
>   the README stands in for the rest, one mutation per assertion.
> - **Step 2's other prediction — "the mirror restore diverges because deletions were not
>   propagated" — is about Part B, not Part A**, and it holds there.
> - **The wait for a deletion is part of the scenario, not a setup detail.** Box-a keeps selling under
>   a real `replicate` daemon until the store has dropped a key it held, on an outer deadline over a
>   real listing. Because the part sells for as long as the wait takes, `direct-rows`, `source-keys`
>   and `deletion-waited-ms` differ run to run. **`deletion-waited-ms` is QUANTISED to the poll
>   interval, and is neither the store's latency nor litestream's**: the loop is sell, sleep 250ms,
>   list, so a deletion landing mid-sleep is not seen until the next poll and the number is a wait
>   rounded UP to the next 250ms. The sleeps are the measurement's RESOLUTION, not overhead on top of
>   the wait — subtracting them leaves a figure nothing measured, which an earlier version of this
>   bullet invited by setting the sale cadence against the total. Read it as "the fast compaction
>   settings did produce a deletion within this long, to a resolution of 250ms". Corrected 2026-09-18
>   twice over: until that day the clock also spanned the node open, three sales, the config write,
>   the daemon spawn, the kill and the final one-shot, so it was not even a bound on the loop.
> - **Box-a's database is deleted before any restore.** Without that, a `restore` that copied the file
>   next door would satisfy every comparison — the run where it did is in the `LS` section of the
>   README. The file bytes are also hashed BEFORE `openNode` touches them, so that nothing the open
>   does can enter the hash: it runs `CREATE TABLE IF NOT EXISTS` and creates the `-wal`/`-shm`
>   sidecars. That ordering is the conservative one and not a claim that an open WOULD change the
>   file — the one probe that looked (2026-09-18, a WAL-mode model database hashed before, during and
>   after an `openNode`) found `hash-open equal=true wal=true shm=true`, `hash-close equal=true`: the
>   sidecars appeared and the main file's bytes did not move.
> - **Step 5's parallel second stream (`gen-1-boxbis`) was not built.** The direct stream every copy is
>   judged against is box-a's OWN source prefix, restored separately. A second node streaming "the
>   same writes" would be a different lineage with different uuids in every payload, so the two
>   restores could never be byte-identical and the comparison step 6 asks for would be impossible.
> - **S3 found a flake in the rig, and fixing it changed `model.ts`.** S3 is the first scenario to
>   write to a database while a litestream DAEMON reads it, and one full run failed with
>   `database is locked`. Measured both ways, a node selling every 5ms for twelve seconds against a
>   daemon on the fast settings, about 1800 writes a time, and run twice by different people:
>   `PRAGMA busy_timeout` alone left 16 refusals and then 15, `BEGIN IMMEDIATE` alone left 19 and
>   then 15, both together left 0 on both runs. The counts move run to run; what reproduced is that
>   either change alone leaves writes refused. `openNode` now sets the timeout and `withTx` begins
>   with `BEGIN IMMEDIATE`. Every other scenario's verdict line still reads exactly as its own
>   recorded run did. **The MECHANISM was stated wrongly twice, and what stands is kept apart by
>   journal mode here (2026-09-18).** The first attempt reasoned about a deferred `BEGIN`; the
>   correction of it ran a control but ran it in `delete` mode, while the case the fix is about has
>   litestream switching the file to WAL. Three separate results: (1) the `delete`-mode finding, as a
>   `delete`-mode finding — first connection on `BEGIN` alone, the second's `BEGIN EXCLUSIVE` was
>   ACCEPTED; first on `BEGIN` then one `SELECT`, the second's was refused, "database is locked", so
>   there a plain `BEGIN` takes no lock and the first READ takes one. (2) The same probe in WAL does
>   not reproduce that half: both cases ACCEPTED, a reader there blocking nobody. (3) The OUTCOME the
>   fix rests on reproduces in BOTH modes — a holder taking `BEGIN IMMEDIATE` and keeping it 1500ms,
>   probe connection carrying `PRAGMA busy_timeout = 5000`: `delete`/deferred REFUSED at 0ms,
>   `delete`/immediate ACCEPTED at 1590ms, `wal`/deferred REFUSED at 1ms, `wal`/immediate ACCEPTED at
>   1613ms. "Deferred" is `recordSale`'s own sequence, read `chain_head` then insert. **WHY the
>   deferred transaction is refused differs by mode and was not established here.** The five seconds
>   is a bound on a stall and is NOT justified by a measurement: nothing here measured a litestream
>   checkpoint, and the only wait on record is the artificial 1500ms hold that probe chose (waited out
>   in 1590ms and 1613ms, the extra being the holder's commit).
> - **Outside the new files the change edits these:** `writeConfig`'s new option and the flake fix in
>   `src/litestream.ts` and `src/model.ts`, the package README (its new S3 section plus two sentences
>   that said S3 was still owed), and this note. Added when the review findings were applied on
>   2026-09-18, because S3 starting a `replicate` daemon retired sentences saying nothing but the `LS`
>   check does: `src/scenarios/s0_happy_loop.ts`'s header, and two dated notes in the design specs —
>   `docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md` (§4.4's copy-up
>   obligation, §5.2's list of what has not been run, and risk 8) and
>   `docs/superpowers/specs/2026-09-16-sqlite-failover-prototype-design.md` (S3's control, which this
>   branch measured to be false as written). `promotion.ts`, `store.ts` and `scenarios.ts` are
>   untouched.

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

> **2026-09-18, as landed.** Everything below was measured on this machine against the pin
> (litestream v0.5.17 darwin-arm64, node v26.7.0, the pinned MinIO image). The recorded run, the
> mutation list and the 2x2 probe are in `bench/sqlite-failover/README.md` → "What S4 measures, and
> what it does not". Five things differ from the steps above, and the code is what landed:
>
> - **The load is driven in ROUNDS with an idle pause, in BOTH arms, and step 3's continuous load
>   measured nothing about being offline.** Driven back to back, 7500 sales finish in about a second;
>   pointed at a live MinIO instead of the closed port, that shape still recorded
>   `peak-wal-bytes=310759272` — the offline figure — because litestream never gets a turn. Fifteen
>   rounds of five hundred with a 1500ms idle is what landed, in the offline arm and the control
>   alike, so the two differ in one thing: whether the config names a live store or a closed port.
> - **Step 2's "or do not start it" was not taken.** A new `src/unreachable-store.ts` gives
>   `writeConfig` a `Store` whose endpoint is a local port that was bound, read and released, and it
>   VERIFIES that premise with a TCP connection that has to be refused — an offline arm that was
>   quietly online would measure nothing. Its `putJson`/`getJson`/`listKeys` throw rather than
>   answering.
> - **A CONTROL was added that the steps do not ask for** (`CLAUDE.md` §1): the same load against a
>   REACHABLE store, where the WAL has to plateau. Without it, a growing WAL is equally consistent
>   with "this write volume always makes this much WAL". Measured: 21,086,192 bytes against the
>   offline arm's 310,404,952 for the same 7500 sales.
> - **A Part C was added, and it is the most decision-relevant thing here** — risk 9's own sentence,
>   "put our own process on the sale path". One `PRAGMA wal_checkpoint(TRUNCATE)` from our own
>   connection took **11,727.8ms** with the offline daemon running, answered `busy=1 log=75341
>   checkpointed=4`, and left the WAL untouched; with the daemon killed the same statement took
>   **48.6ms** and truncated it to zero. The blocked arm reproduced in every run that reached it
>   (11.7-12.5s, `busy=1` every time). It decides nothing and feeds the detail, the way S3's Part C
>   does.
> - **Step 5's WAL ceiling is a STATED ceiling, and the spec's illustrative one is not met.** Spec §4
>   S4 offers "a small multiple of the streamed data"; the measured amplification is about 80x
>   (310MB of WAL over a 3.85MB database), so that formulation was not adopted and the scenario
>   prints `spec-small-multiple-ceiling=not-met` rather than quietly substituting a bar that passes.
>   What landed is 64KiB a sale, which tests the growth's SHAPE — nothing in this repository records
>   the appliance's partition size, so it is not a disk guarantee.
>
> Two further findings worth carrying forward. **`wal_autocheckpoint = 0` is not what makes the
> offline WAL grow — the attached daemon is**: with an offline litestream holding the database,
> dropping the pragma changed nothing (41,189 bytes a sale against 41,387), because SQLite's own
> automatic checkpoint is refused the same way our explicit one is; with nothing attached the pragma
> decides everything (41,135 against 558). That widens risk 9 rather than answering it. And **250
> sales a day is an assumption, not a measurement** — nothing in this repository records the deli's
> real ticket count, so every figure is also reported per sale.

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
