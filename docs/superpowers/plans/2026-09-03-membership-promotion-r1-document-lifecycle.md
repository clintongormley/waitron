# Membership Promotion R1 — Document Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the venue a signed membership document that is minted locally — seeded at the primary's setup and re-minted on a local-secondary promotion — so a promotion has an org chart to bump and every node can name who is in charge.

**Architecture:** A pure `buildNextMembershipDocument` helper in `@waitron/membership` (bump `term`, build body, sign, assemble). Setup calls it once via a server-layer `seedTermZeroMembership` right after the node's identity key is established. `promoteLocalSecondaryToPrimary` calls it after the singleton-role flip, committing the flip and the new document in ONE owner transaction (closing the crash-between-writes gap). No new schema; no fiscal tables touched.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (PGlite for hermetic DB tests), Drizzle ORM, Ed25519 via `node:crypto` (already wrapped in `@waitron/membership`).

**Spec:** `docs/superpowers/specs/2026-09-03-reserved-standby-identity-and-promotion-design.md` — this plan implements **§6 R1** only (Document lifecycle + local-secondary promotion). R2 (reserve cloud identity at adopt), R3 (cloud promotion), and H2 (fiscal-record sync) are later plans off the same spec.

## Global Constraints

- **No backwards-compat / data-migration code** (CLAUDE.md §3) — pre-production; fresh venues get the term-0 seed at setup, so there is no un-seeded database to backfill.
- **Multi-table writes share ONE transaction** (CLAUDE.md §3) — the promote flip + document write commit together (Task 4).
- **Error codes name the domain concept**, and every file that throws imports its registry `import "./errors.js"` (CLAUDE.md §3). R1 adds no new error codes.
- **Spanish/English guard:** identifiers are English; this plan adds no Spanish schema tokens.
- **`contactUrl` is not consumed by any routing logic yet** (verified: only `verify.ts` structurally validates it) — the term-0 seed uses `""`; do not invent a URL.
- **Gate before commit-worthy:** `pnpm lint && pnpm typecheck && pnpm format:check`, and the touched package's `test:coverage` (not bare `test`) — coverage thresholds are `98/98/98/95` for `@waitron/membership`, `@waitron/db`, `@waitron/server`.
- **`@waitron/membership` is a pure leaf** (deps: `@waitron/shared` only). `buildNextMembershipDocument` must stay pure — no DB, no Node crypto beyond what `signDocumentBody` already uses.

---

### Task 1: `buildNextMembershipDocument` — the pure minting helper (`@waitron/membership`)

**Files:**
- Create: `packages/membership/src/build.ts`
- Modify: `packages/membership/src/index.ts` (add the export)
- Test: `packages/membership/src/build.test.ts`

**Interfaces:**
- Consumes: `signDocumentBody(body, privateKey)` (`./verify.js`); types `SignedMembershipDocument`, `MembershipDocumentBody`, `MembershipNode`, `Endorsement` (`./types.js`).
- Produces:
  ```ts
  export function buildNextMembershipDocument(args: {
    heldDocument: SignedMembershipDocument | null;
    nodes: readonly MembershipNode[];
    signerNodeId: string;
    signerPrivateKey: string;
    endorsements?: readonly Endorsement[];
  }): SignedMembershipDocument;
  ```
  `term = (heldDocument?.body.term ?? -1) + 1` (so a `null` held document yields term 0). Signs the whole body with `signDocumentBody`; `endorsements` defaults to `[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/membership/src/build.test.ts
import { describe, expect, it } from "vitest";
import { buildNextMembershipDocument } from "./build.js";
import { generateNodeKeyPair } from "./crypto.js";
import { verifyMembershipDocument } from "./verify.js";
import type { MembershipNode, SignedMembershipDocument } from "./types.js";

const signer = generateNodeKeyPair();
const nodeId = "11111111-1111-1111-1111-111111111111";
const self: MembershipNode = { nodeId, contactUrl: "", standing: "serving-primary" };

describe("buildNextMembershipDocument", () => {
  it("mints term 0 from a null held document, signed and verifiable", () => {
    const doc = buildNextMembershipDocument({
      heldDocument: null,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
    });
    expect(doc.body.term).toBe(0);
    expect(doc.body.nodes).toEqual([self]);
    expect(doc.signerNodeId).toBe(nodeId);
    expect(doc.endorsements).toEqual([]);
    const verified = verifyMembershipDocument(doc, { [nodeId]: signer.publicKey });
    expect(verified.valid).toBe(true);
  });

  it("bumps term by exactly one from the held document", () => {
    const held = { body: { term: 7, nodes: [self] } } as SignedMembershipDocument;
    const doc = buildNextMembershipDocument({
      heldDocument: held,
      nodes: [self],
      signerNodeId: nodeId,
      signerPrivateKey: signer.privateKey,
    });
    expect(doc.body.term).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/membership test build`
Expected: FAIL — `build.js` does not exist / `buildNextMembershipDocument is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/membership/src/build.ts
import type {
  Endorsement,
  MembershipDocumentBody,
  MembershipNode,
  SignedMembershipDocument,
} from "./types.js";
import { signDocumentBody } from "./verify.js";

/**
 * Mint the NEXT membership document (design §8): bump `term` by one over the held document (or start at
 * 0 when none is held), take the caller-supplied node list as the new org chart, and sign the whole body
 * with the minting node's own key. Pure — the caller reads the signer key and the held document, and
 * persists the result; this only builds and signs. `endorsements` defaults to none (R1 signs with a
 * directly-trusted key; the endorsement chain is an R2/R3 concern).
 */
export function buildNextMembershipDocument(args: {
  heldDocument: SignedMembershipDocument | null;
  nodes: readonly MembershipNode[];
  signerNodeId: string;
  signerPrivateKey: string;
  endorsements?: readonly Endorsement[];
}): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: (args.heldDocument?.body.term ?? -1) + 1,
    nodes: args.nodes,
  };
  return {
    body,
    signerNodeId: args.signerNodeId,
    signature: signDocumentBody(body, args.signerPrivateKey),
    endorsements: args.endorsements ?? [],
  };
}
```

Then add to `packages/membership/src/index.ts`, beside the other `verify`/`accept` exports:

```ts
export { buildNextMembershipDocument } from "./build.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/membership test build`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/membership/src/build.ts packages/membership/src/build.test.ts packages/membership/src/index.ts
git commit -s -m "feat(membership): buildNextMembershipDocument — the pure term-bump minting helper"
```

---

### Task 2: transaction-taking accessors `writeNodeMembershipTx` + `setSingletonRoleTx` (`@waitron/db`)

**Files:**
- Modify: `packages/db/src/node-membership.ts` (factor `writeNodeMembershipTx`)
- Modify: `packages/db/src/deployment.ts` (factor `setSingletonRoleTx`)
- Modify: `packages/db/src/index.ts` (export both `*Tx`)
- Test: `packages/db/src/node-membership.test.ts` (add a tx case), `packages/db/src/deployment.test.ts` (add a tx case) — extend the existing suites.

**Interfaces:**
- Consumes: `Transaction` (`./client.js`), already exported from `@waitron/db`.
- Produces:
  ```ts
  export function writeNodeMembershipTx(tx: Transaction, document: SignedMembershipDocument): Promise<void>;
  export function setSingletonRoleTx(tx: Transaction, role: SingletonRole): Promise<void>;
  ```
  Both are the same statements the standalone accessors run today, on a caller-provided tx, so Task 4 can commit the singleton flip and the document write in one transaction. The standalone `writeNodeMembership` / `setSingletonRole` keep their exact signatures and behaviour, now delegating to the `*Tx` form inside their own transaction.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/db/src/node-membership.test.ts
it("writeNodeMembershipTx writes inside a caller transaction", async () => {
  const db = await freshDb(); // however the suite builds its PGlite handle — mirror the existing tests
  const doc = sampleSignedDocument(3); // reuse the suite's document fixture (term 3)
  await db.transaction(async (tx) => {
    await writeNodeMembershipTx(tx, doc);
  });
  const held = await readNodeMembership(db);
  expect(held?.body.term).toBe(3);
});
```

```ts
// append to packages/db/src/deployment.test.ts
it("setSingletonRoleTx flips the role inside a caller transaction", async () => {
  const db = await freshStampedDb(); // stamped deployment, mirror the existing setSingletonRole tests
  await db.transaction(async (tx) => {
    await setSingletonRoleTx(tx, "secondary");
  });
  expect(await readSingletonRole(db)).toBe("secondary");
});
```

(Match the two suites' actual fixture/helper names — `sampleSignedDocument`, `freshDb`, `freshStampedDb` are placeholders for whatever those files already use; read the top of each test file first and reuse its setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/db test node-membership` and `pnpm --filter @waitron/db test deployment`
Expected: FAIL — `writeNodeMembershipTx` / `setSingletonRoleTx` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/db/src/node-membership.ts`, add the tx form and delegate the standalone accessor to it:

```ts
import type { Database, Transaction } from "./client.js";
// ...

/** The plain-upsert of the singleton on a caller-provided transaction (see `writeNodeMembership`). */
export async function writeNodeMembershipTx(
  tx: Transaction,
  document: SignedMembershipDocument,
): Promise<void> {
  const term = document.body.term;
  await tx
    .insert(nodeMembership)
    .values({ id: 1, term, document })
    .onConflictDoUpdate({
      target: nodeMembership.id,
      set: { term, document, updatedAt: sql`now()` },
    });
}

export async function writeNodeMembership(
  db: Database,
  document: SignedMembershipDocument,
): Promise<void> {
  await db.transaction((tx) => writeNodeMembershipTx(tx, document));
}
```

In `packages/db/src/deployment.ts`, factor `setSingletonRoleTx` and delegate:

```ts
import type { Database, Transaction } from "./client.js";
// ...

/** Sets the singleton-ownership role on a caller-provided transaction (see `setSingletonRole`). */
export async function setSingletonRoleTx(tx: Transaction, role: SingletonRole): Promise<void> {
  const result = await tx.execute<{ id: number }>(
    sql`update deployment set singleton_role = ${role} where id = 1 returning id`,
  );
  if (result.rows.length === 0) {
    throw new AppError("deployment.not_stamped", {});
  }
}

export async function setSingletonRole(db: Database, role: SingletonRole): Promise<void> {
  await db.transaction((tx) => setSingletonRoleTx(tx, role));
}
```

Export both from `packages/db/src/index.ts` beside their standalone siblings:

```ts
  setSingletonRole,
  setSingletonRoleTx,
  // ...
  writeNodeMembership,
  writeNodeMembershipTx,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/db test node-membership deployment`
Expected: PASS — the new tx cases AND the pre-existing `writeNodeMembership` / `setSingletonRole` cases (behaviour preserved by delegation).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/node-membership.ts packages/db/src/deployment.ts packages/db/src/index.ts packages/db/src/node-membership.test.ts packages/db/src/deployment.test.ts
git commit -s -m "feat(db): writeNodeMembershipTx + setSingletonRoleTx for shared-transaction callers"
```

---

### Task 3: `seedTermZeroMembership` at setup (`@waitron/server`)

**Files:**
- Create: `apps/server/src/membership-seed.ts`
- Modify: `apps/server/src/setup-api.ts` (new `seedMembership` dep + gate + call site at line ~393)
- Modify: `apps/server/src/boot.ts` (bind `seedMembership` in the setup-mode wiring, line ~652)
- Test: `apps/server/src/membership-seed.test.ts`

**Interfaces:**
- Consumes: `readNodeIdentityKey(db, ring, tenantId)` (`./node-identity.js`); `buildNextMembershipDocument` (`@waitron/membership`); `writeNodeMembership(db, document)` (`@waitron/db`).
- Produces:
  ```ts
  export function seedTermZeroMembership(
    deps: { db: Database; ring: KeyRing },
    tenantId: string,
    nodeId: string,
  ): Promise<void>;
  ```
  Reads the just-established identity key, builds the term-0 document naming this node `serving-primary` with `contactUrl: ""`, and writes it via `writeNodeMembership`. Called from the provision handler right after `establishIdentity`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/membership-seed.test.ts
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS, readMembershipTrustSet, readNodeMembership, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { verifyMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId, type NodeId, type TenantId } from "@waitron/shared";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("seedTermZeroMembership", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS], timeoutMs: 60_000 });
  let db: Database;
  let tenantId: TenantId;
  let nodeId: NodeId;

  beforeAll(async () => {
    db = suite.db;
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
    await establishNodeIdentity({ ownerDb: db, ring: RING }, tenantId, nodeId);
  }, 60_000);

  it("seeds a signed term-0 document naming this node serving-primary", async () => {
    await seedTermZeroMembership({ db, ring: RING }, tenantId, nodeId);
    const held = await readNodeMembership(db);
    expect(held?.body.term).toBe(0);
    expect(held?.body.nodes).toEqual([{ nodeId, contactUrl: "", standing: "serving-primary" }]);
    const trust = await readMembershipTrustSet(db, tenantId);
    expect(verifyMembershipDocument(held!, trust).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test membership-seed`
Expected: FAIL — `membership-seed.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/membership-seed.ts
import { buildNextMembershipDocument } from "@waitron/membership";
import { writeNodeMembership, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * Seed the venue's initial membership document (design §6 R1) right after `establishNodeIdentity`: a
 * fresh primary signs its own single-node org chart at term 0 with its own key, so a document exists
 * before any promotion needs to bump one. `contactUrl` is `""` — no routing consumer reads it yet, and
 * a single-node venue's tills reach the primary by other means. Runs on the owner connection at setup
 * (the same one that just sealed the key); reads the key back rather than threading it out of
 * establish, keeping the two primitives separate and independently testable.
 */
export async function seedTermZeroMembership(
  deps: { db: Database; ring: KeyRing },
  tenantId: string,
  nodeId: string,
): Promise<void> {
  const signerPrivateKey = await readNodeIdentityKey(deps.db, deps.ring, tenantId);
  const document = buildNextMembershipDocument({
    heldDocument: null,
    nodes: [{ nodeId, contactUrl: "", standing: "serving-primary" }],
    signerNodeId: nodeId,
    signerPrivateKey,
  });
  await writeNodeMembership(deps.db, document);
}
```

Wire it into `apps/server/src/setup-api.ts`:
- Add to `SetupApiDeps` (beside `establishIdentity`, ~line 52):
  ```ts
  /** `seedTermZeroMembership({ db, ring }, …)` bound in boot: mints the venue's term-0 membership document. */
  seedMembership?: (tenantId: string, nodeId: string) => Promise<void>;
  ```
- In the deps gate (~line 315-331), capture `const seedMembership = deps.seedMembership;` and add `seedMembership === undefined ||` to the `setup.not_ready` condition.
- After `await establishIdentity(result.tenantId, result.nodeId);` (~line 393), add:
  ```ts
  // Seed the venue's term-0 membership document (design §6 R1): after the identity key exists, before
  // the trading config is persisted. The primary signs its own org chart; boot has nothing to bump yet.
  await seedMembership(result.tenantId, result.nodeId);
  ```

Bind it in `apps/server/src/boot.ts` beside the `establishIdentity` binding (~line 652):
```ts
import { seedTermZeroMembership } from "./membership-seed.js";
// ...
            seedMembership: (tenantId, nodeId) =>
              seedTermZeroMembership({ db: ownerDb, ring }, tenantId, nodeId),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test membership-seed`
Expected: PASS. Then run the setup-api suite to confirm the new required dep did not break the deps gate: `pnpm --filter @waitron/server test setup-api` (update that suite's provision-happy-path deps to include a `seedMembership` stub if it constructs `SetupApiDeps` directly; a gate test should assert `setup.not_ready` when it is omitted).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/membership-seed.ts apps/server/src/membership-seed.test.ts apps/server/src/setup-api.ts apps/server/src/boot.ts
git commit -s -m "feat(server): seed the term-0 membership document at setup"
```

---

### Task 4: mint the next document on local-secondary promotion (`@waitron/server`)

**Files:**
- Modify: `apps/server/src/promote.ts` (extend `PromoteDeps`; mint + atomic commit)
- Modify: `apps/server/src/boot.ts` (pass `ring`, `tenantId`, `nodeId` into the promote deps, ~line 1641)
- Test: `apps/server/src/promote.test.ts` (extend)

**Interfaces:**
- Consumes: `readNodeIdentityKey` (`./node-identity.js`); `readNodeMembership`, `writeNodeMembershipTx`, `setSingletonRoleTx` (`@waitron/db`); `buildNextMembershipDocument` (`@waitron/membership`); `KeyRing` (`@waitron/credentials`); `MembershipNode` (`@waitron/membership`).
- Produces: `PromoteDeps` gains `ring: KeyRing; tenantId: string; nodeId: string`. `promoteLocalSecondaryToPrimary` behaviour is unchanged for the fence/mirror/already-primary paths; on a real promotion it now also mints and persists the next membership document, atomically with the singleton flip.

**Standings rule (spec §6 R1):** this node → `serving-primary`; whichever node was `serving-primary` → `sell-only`; every other node unchanged (contactUrl preserved). If this node is absent from the held list, append it as `serving-primary`. If no document is held, mint term 0 naming just this node `serving-primary` (`contactUrl: ""`).

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/server/src/promote.test.ts — extend the existing localSecondary() setup with an identity
// + a held document so the mint has a key to sign with and an org chart to bump.
it("mints the next membership document atomically with the role flip", async () => {
  const { db } = await localSecondary(); // stamped, (primary, secondary)
  // give this node an identity + a held term-3 document naming an OLD primary + this node as secondary
  const tenantId = await seedTenant(db);
  // ... seed a location + this node's id; establishNodeIdentity({ownerDb: db, ring: RING}, tenantId, nodeId);
  // ... writeNodeMembership(db, a term-3 doc: [{old, "", serving-primary}, {nodeId, "", serving-secondary}])
  const holders = createDeploymentHolders("primary", "secondary");
  const deps: PromoteDeps = { appDb: db, ownerDb: db, holders, log: noopLog, ring: RING, tenantId, nodeId };

  const result = await promoteLocalSecondaryToPrimary(deps, { oldNodeNeutralised: true });

  expect(result.alreadyPrimary).toBe(false);
  expect(await readSingletonRole(db)).toBe("primary");
  const held = await readNodeMembership(db);
  expect(held?.body.term).toBe(4); // bumped from 3
  const standings = Object.fromEntries(held!.body.nodes.map((n) => [n.nodeId, n.standing]));
  expect(standings[nodeId]).toBe("serving-primary");
  expect(standings[oldNodeId]).toBe("sell-only");
});

it("is idempotent: a second promote does not bump the term again", async () => {
  // ... same setup, call promote twice; second returns alreadyPrimary:true and the term stays 4.
});
```

(Reuse `RING` from the node-identity test pattern and the `@waitron/db/testing/seed.js` helpers; PGlite `appDb === ownerDb` as the existing suite already does.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test promote`
Expected: FAIL — `PromoteDeps` has no `ring`/`tenantId`/`nodeId`; the document is not minted (term stays 3, or `readNodeMembership` unchanged).

- [ ] **Step 3: Write minimal implementation**

Extend `PromoteDeps` in `apps/server/src/promote.ts`:
```ts
import { readNodeIdentityKey } from "./node-identity.js";
import {
  readNodeMembership,
  setSingletonRoleTx,
  writeNodeMembershipTx,
  type Database,
} from "@waitron/db";
import { buildNextMembershipDocument, type MembershipNode } from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";

export interface PromoteDeps {
  readonly appDb: Database;
  readonly ownerDb: Database;
  readonly holders: DeploymentHolders;
  readonly log: Logger;
  readonly ring: KeyRing;
  readonly tenantId: string;
  readonly nodeId: string;
}
```

Replace the single `setSingletonRole` write (current line 68) and the trailing refresh with: build the document first (pure, before the point-of-no-return), then commit the flip + write in one owner transaction:

```ts
  // Read the freshest state before deciding (unchanged) ...
  // mirror guard + already-primary guard (unchanged) ...

  // Build the next document BEFORE the point-of-no-return: read this node's signing key and the held
  // org chart, flip standings (this node -> serving-primary, the outgoing primary -> sell-only), and
  // sign. All reads + the in-memory sign happen before any write, so a failure here aborts cleanly.
  const signerPrivateKey = await readNodeIdentityKey(deps.appDb, deps.ring, deps.tenantId);
  const held = await readNodeMembership(deps.appDb);
  const nodes = nextStandings(held?.body.nodes ?? [], deps.nodeId);
  const document = buildNextMembershipDocument({
    heldDocument: held,
    nodes,
    signerNodeId: deps.nodeId,
    signerPrivateKey,
  });

  // PONR: the role flip and the new document commit together (CLAUDE.md §3 — one transaction), so a
  // crash cannot leave a primary with no document. Owner-role: both writes need it.
  await deps.ownerDb.transaction(async (tx) => {
    await setSingletonRoleTx(tx, "primary");
    await writeNodeMembershipTx(tx, document);
  });

  await refreshDeploymentHolders(deps.appDb, deps.holders);
  deps.log("info", "promotion.completed", { target: "local_secondary" });
  return { alreadyPrimary: false };
```

Add the pure standings helper in the same file:
```ts
/**
 * The new org chart after a local-secondary promotion (design §6 R1): this node becomes serving-primary,
 * the outgoing serving-primary becomes sell-only (still a replication source until drained), everyone
 * else is unchanged. If this node is not yet listed, it is appended as serving-primary — so a promote
 * with a held chart that omits the promoting node still names it correctly.
 */
function nextStandings(current: readonly MembershipNode[], selfNodeId: string): MembershipNode[] {
  const next = current.map((n): MembershipNode => {
    if (n.nodeId === selfNodeId) return { ...n, standing: "serving-primary" };
    if (n.standing === "serving-primary") return { ...n, standing: "sell-only" };
    return n;
  });
  if (!next.some((n) => n.nodeId === selfNodeId)) {
    next.push({ nodeId: selfNodeId, contactUrl: "", standing: "serving-primary" });
  }
  return next;
}
```

Pass the new deps in `apps/server/src/boot.ts` (~line 1641):
```ts
        return await promoteLocalSecondaryToPrimary(
          { appDb: db, ownerDb, holders, log, ring, tenantId: config.till.tenantId, nodeId: config.till.nodeId },
          attestation,
        );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server test promote`
Expected: PASS — the mint, the atomicity (both `singleton_role` and the document committed), and the idempotent re-run (term stays put). The pre-existing fence / mirror-guard / holder-flip cases still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/promote.ts apps/server/src/promote.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): mint the next membership document on local-secondary promotion"
```

---

## Self-review

**Spec coverage (§6 R1):**
- "Seed the term-0 document at setup" → Task 3 (`seedTermZeroMembership` + provision wiring).
- "`mintNextMembershipDocument` primitive … pure build-and-sign + persist split" → Task 1 (pure `buildNextMembershipDocument`); persist is the caller's `writeNodeMembership` / `writeNodeMembershipTx` (Tasks 2–4).
- "Wire `promoteLocalSecondaryToPrimary` … flip this node to serving-primary and the outgoing primary to sell-only" → Task 4 (`nextStandings`).
- Design decision "singleton flip and document write commit in ONE owner transaction" → Task 4 (`ownerDb.transaction`), enabled by Task 2's `*Tx` accessors.
- Design decision "outgoing primary → sell-only, not evicted" → Task 4 `nextStandings`.
- "`contactUrl` source pinned in the plan" → `""`, Global Constraints + Tasks 3/4.

**Placeholder scan:** the only deliberately-abstract bits are the test-fixture helper names in Tasks 2 and 4 (`freshDb`, `sampleSignedDocument`, the promote setup) — flagged inline to reuse each suite's existing setup rather than invent names blindly; every production code block is complete.

**Type consistency:** `buildNextMembershipDocument`'s argument object and return type match `SignedMembershipDocument` (Task 1) as consumed in Tasks 3 and 4; `writeNodeMembershipTx(tx, document)` / `setSingletonRoleTx(tx, role)` signatures (Task 2) match their Task 4 call sites; `PromoteDeps`' new `ring`/`tenantId`/`nodeId` (Task 4) match the boot call site.

**Note for the executor:** R1 signs promotion documents with the promoting node's own directly-trusted key (`endorsements: []`). A receiver that only trusts the promoting node transitively (via the primary's endorsement) is an R2/R3 concern — do not add endorsement plumbing here.
