# Membership Slice 3 — Distribution over `/sync-api/hello` + local adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute the held membership document over the existing `/sync-api/hello` handshake (serve side) and adopt a gossiped document on the puller (consume side) through the Slice-1 accept fence, persisting an accepted document into the Slice-2 `node_membership` singleton. This is transport + local adoption only — *acting* on an adopted document (demote / relinquish singletons / config-down-only / rejoin) is Slices 5–6, and populating the trust set from setup/adopt is Slice 4.

**Architecture:** Three seams, each following an existing pattern.
1. **Serve** — `/sync-api/hello` (mounted on the singleton primary, as today) adds a `membership` field read via `readNodeMembership(deps.db)`; the response becomes `{ nodeId, environment, membership }` (additive, backward-compatible).
2. **Consume** — `syncPullOnce` already GETs `/sync-api/hello` every tick; it threads the parsed `membership` field out through its result, and `runSyncPull` invokes a new **injected best-effort callback** `adoptMembership?(raw)` after a drain — the exact shape and error-handling of the existing `reportCursor` seam, so `@waitron/sync` stays a pure transport with **no** `@waitron/membership`/`@waitron/db` dependency.
3. **Adopt** — a new `apps/server/src/membership-adopt.ts` runs the Slice-1 `acceptMembershipDocument` fence against a **trust set** and, on accept, persists via a **term-guarded conditional upsert** (a monotonic backstop closing the two-lane race). `boot.ts` wires the callback to this module with an **empty trust set (the inert Slice-4 seam)**, so in production every gossiped document is `untrusted_signer` and adoption is a no-op; the mechanism is proven end-to-end only via **injected fixture trust sets** in tests.

**Tech Stack:** TypeScript (ESM), Hono (the `/sync-api` group), Drizzle (`sql` conditional upsert, hand-written custom SQL migration), Vitest (PGlite for adoption logic + persist; real Postgres via `useTemplateDb` for the grant read-back and the `/hello` handshake), `@waitron/membership` (`acceptMembershipDocument`, `TrustSet`, the test fixtures), `@waitron/db` (`readNodeMembership`/`writeNodeMembership`), `@waitron/sync` (the pull transport).

**Spec:** `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` — **§5 ("Distribution: self-verifying gossip")** and the acceptance test of **§4**. This plan implements only the distribution + local-adoption boundary; trust-set establishment (§4 setup/adopt) is Slice 4, promotion-mints (§8) Slice 5, rejoin (§6) Slice 6, conflict surface (§7) Slice 7.

## Global Constraints

- **Inert trust-set seam (owner decision, 2026-09-03):** Slice 3 builds and fully tests the adopt mechanism, but the runtime trust set is **empty (`{}`)** — Slice 4 (setup/adopt) populates it. `boot.ts` passes `{}`; production adoption is therefore a no-op (every document fails `verifyMembershipDocument` with `untrusted_signer`). All *adoption-success* assertions use an **injected fixture trust set** built from `generateNodeKeyPair()` + `signDoc` (`@waitron/membership`). Do **not** pull setup/adopt trust establishment forward into this slice.
- **`@waitron/sync` stays a pure transport (no membership/db dep):** the adopt logic reaches the pull loop only through an **injected callback** (`adoptMembership?: (raw: unknown) => Promise<void>`), mirroring the existing `reportCursor` seam. `@waitron/sync` must not gain a `@waitron/membership` or `@waitron/db` dependency. Verify with `pnpm --filter @waitron/sync exec cat package.json` after the change — dependencies unchanged.
- **Best-effort adoption, never blocks the pull (spec §5 witness-safety framing + the §2 "nothing may block a sale" posture):** a throwing/failing `adoptMembership` is logged (`sync.membership_adopt_failed`) and swallowed inside `runSyncPull`'s per-peer body — it must never grow a peer's backoff, fail the drain, or become a process-level unhandled rejection. This is the exact contract `reportCursor` already has (`pull.ts` ~205–224, 245–253).
- **Monotonic persistence (concurrency backstop):** the ordered and fast lanes both run `runSyncPull` and both adopt from the same peer, so read-accept-write can race. Persist through a **term-guarded conditional upsert** — `insert … on conflict (id) do update set … where node_membership.term < excluded.term` — an atomic single statement. This realizes the approved "race-safe monotonic guard" intent and is preferred over a `SELECT … FOR UPDATE` row lock because a lock on the **not-yet-existing** first row cannot serialize the first-adopt race, whereas the conditional upsert does. `acceptMembershipDocument` remains the trust + strictly-newer fence *in front*; the WHERE clause is the atomic backstop *behind* it. `writeNodeMembership` stays the Slice-2 dumb setter (owner decision) — the guarded write is a **new** helper in the adoption module, not a change to that accessor.
- **The deferred #198 write grant:** the adoption writer runs on the pull worker's **app-role pool** (`localSyncDb`, a member of `app_user`), so this slice ships the #198-deferred `GRANT INSERT, UPDATE ON node_membership TO app_user` in its own custom migration. **No DELETE** (a node never deletes the singleton; supersession is an UPDATE to a higher term). Read the ACL back **both directions** on real Postgres (CLAUDE.md §3 — the command tag lies): `app_user` now holds SELECT+INSERT+UPDATE and **not** DELETE.
- **No backwards-compat / no data migration (CLAUDE.md §3):** pre-production, drop-and-recreate. The `membership` field on `/hello` is additive; an older peer that omits it yields `membership === undefined`, which the adopt path treats as "nothing served".
- **English-only:** `@waitron/db` is in `GENERIC_PACKAGES`; `@waitron/sync` and `apps/server` are exempt/out-of-scope respectively. New tokens (`membership`, `adopt`, `term`, the `sync.membership_adopt_failed` log code) are English. No `english-only` list edit.
- **Coverage thresholds:** `@waitron/db`, `@waitron/sync`, `apps/server` are all standard non-browser packages — `98/98/98/95`.
- **Error/log codes:** `sync.membership_adopt_failed` is a **log** code (passed to `deps.log`), like the existing `sync.pull_failed`/`sync.cursor_report_failed` — it is **not** an `AppError`, so it is **not** registered in `packages/sync/src/errors.ts` (only `sync.stream_stalled` and the throwable codes are). Name it beside those in the domain vocabulary (`sync.<concept>`), never `sync.membership_adoption_error` or a package-named variant (CLAUDE.md §3 — grep the siblings: `pull_failed`, `cursor_report_failed`, `stream_stalled`).

## File Structure

```
packages/sync/
  src/pull.ts                       # SyncPullResult += membership; syncPullOnce parses it;
                                    #   RunSyncPullDeps += adoptMembership?; runSyncPull calls it best-effort
  src/pull.test.ts                  # + membership-threading + adopt-callback best-effort tests

packages/db/
  drizzle/0097_node_membership_write_grant.sql   # GRANT INSERT, UPDATE ON node_membership TO app_user
  drizzle/meta/_journal.json                      # + the 0097 entry (db:generate:custom)
  src/node-membership.ts            # comment update (writeNodeMembership: grant no longer owner-only)
  src/node-membership.rls.test.ts   # expectation flips: app_user now SELECT+INSERT+UPDATE, not DELETE

apps/server/
  src/membership-adopt.ts           # adoptMembership(deps, raw) → AcceptResult; persistIfNewer(db, doc) → boolean
  src/membership-adopt.test.ts      # PGlite: accept-fence + persist + persistIfNewer monotonic guard
  src/membership-gossip.e2e.test.ts # real /hello mount → real syncPullOnce → real adoptMembership + fixture trust set
  src/sync-api.ts                   # /sync-api/hello returns { nodeId, environment, membership }
  src/sync-api.rls.test.ts          # + /hello serves the held document (null when unset)
  src/boot.ts                       # wire adoptMembership into runSyncPull (empty trust set seam)
```

No cross-package CI-list edits: the grant migration joins the existing `core` folder (`packages/migrations/migrations.manifest.json` lists folders, unchanged); `@waitron/db`, `@waitron/sync` and `apps/server` already own their CI shards (`test-heavy`, `test-light-*`, `test-server`); no repo-wide pinned list (`GENERIC_PACKAGES`, `OWN_SHARD_PACKAGES`, `migratedSets`) changes.

---

## Task 1: `@waitron/sync` — thread the served document through the pull + best-effort adopt callback

**Files:**
- Modify: `packages/sync/src/pull.ts`
- Test: `packages/sync/src/pull.test.ts`

**Interfaces:**
- Consumes: the existing `/sync-api/hello` response, now `{ nodeId, environment, membership? }` (JSON).
- Produces:
  - `SyncPullResult` gains `readonly membership: unknown` — the raw parsed `hello.membership` (or `undefined` from an older peer).
  - `RunSyncPullDeps` gains `adoptMembership?: (rawMembership: unknown) => Promise<void>` — an injected, best-effort callback. When present, `runSyncPull` calls it once per peer per drain with the last-fetched `membership`. A throw is logged `sync.membership_adopt_failed` and swallowed.

- [ ] **Step 1: Write the failing tests in `packages/sync/src/pull.test.ts`**

Add a `describe` block. Use the file's existing `HttpClient` stub style (a fake `http` returning `{ status, text }`). The hello stub must now return a `membership` field; the `/sync-api/log` stub returns an empty NDJSON page so the drain ends after one iteration.

```ts
// --- membership gossip (Slice 3) ---
// A hello response now carries the held membership document. syncPullOnce threads the RAW parsed
// `membership` field out through its result, and runSyncPull hands it to an injected best-effort
// adoptMembership callback. The callback failing must NEVER fail the pull (spec §5: adoption is a
// witness optimisation, never a blocker) — same contract as reportCursor.
describe("membership gossip over /hello", () => {
  const DOC = { body: { term: 4, nodes: [] }, signerNodeId: "A", signature: "s", endorsements: [] };

  function helloThenEmptyLog(hello: unknown): HttpClient {
    return async (url: string) => {
      if (url.endsWith("/sync-api/hello")) {
        return { status: 200, text: async () => JSON.stringify(hello) };
      }
      // /sync-api/log → an empty page (short, so the drain stops after one iteration)
      return { status: 200, text: async () => "" };
    };
  }

  it("syncPullOnce carries the raw membership field out in its result", async () => {
    const result = await syncPullOnce(
      { ...baseDeps, http: helloThenEmptyLog({ nodeId: "A", environment: "production", membership: DOC }) },
      peer,
    );
    expect(result.membership).toEqual(DOC);
  });

  it("syncPullOnce back-compat: an older peer omitting membership yields undefined (no throw)", async () => {
    const result = await syncPullOnce(
      { ...baseDeps, http: helloThenEmptyLog({ nodeId: "A", environment: "production" }) },
      peer,
    );
    expect(result.membership).toBeUndefined();
  });

  it("runSyncPull invokes adoptMembership with the served document after a drain", async () => {
    const seen: unknown[] = [];
    const controller = new AbortController();
    await runSyncPull({
      ...baseRunDeps,
      http: helloThenEmptyLog({ nodeId: "A", environment: "production", membership: DOC }),
      adoptMembership: async (raw) => {
        seen.push(raw);
        controller.abort(); // one round is enough
      },
      signal: controller.signal,
    });
    expect(seen).toEqual([DOC]);
  });

  it("a throwing adoptMembership is logged sync.membership_adopt_failed and does NOT fail the pull", async () => {
    const logs: Array<[string, string]> = [];
    const controller = new AbortController();
    await runSyncPull({
      ...baseRunDeps,
      http: helloThenEmptyLog({ nodeId: "A", environment: "production", membership: DOC }),
      log: (level, code) => {
        logs.push([level, code]);
        if (code === "sync.membership_adopt_failed") controller.abort();
      },
      adoptMembership: async () => {
        throw new Error("adopt boom");
      },
      signal: controller.signal,
    });
    // The adopt failure was observable as a warn, and the peer was NOT recorded as a pull failure.
    expect(logs).toContainEqual(["warn", "sync.membership_adopt_failed"]);
    expect(logs.some(([, code]) => code === "sync.pull_failed")).toBe(false);
  });
});
```

> **Implementer note — reuse the file's existing helpers.** `pull.test.ts` already defines a `baseDeps`/`baseRunDeps`-style fixture, a `peer`, and a fake DB whose `readCursor` returns `0n`. Reuse whatever those are actually named in the file (open it first); the names above are illustrative. The load stub returning `""` decodes to an empty batch (`decodeBatch("")` → `[]`), so `applyBatch` applies nothing, the page is short, and the drain's `while` breaks after one iteration — which is what lets the single `adoptMembership` call fire.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @waitron/sync test pull.test`
Expected: FAIL — `result.membership` is `undefined` for the first test (property doesn't exist yet), and `adoptMembership` is not a known dep / never called.

- [ ] **Step 3: Thread `membership` through `syncPullOnce`**

In `packages/sync/src/pull.ts`, extend `SyncPullResult` (the `extends ApplyBatchResult` interface ~line 61):
```ts
export interface SyncPullResult extends ApplyBatchResult {
  readonly fetched: number;
  readonly advanced: boolean;
  /** The RAW `membership` field the peer advertised on /sync-api/hello (design §5), or `undefined`
   * from an older peer that does not serve it. Threaded out UNVERIFIED — the adopt callback runs the
   * @waitron/membership accept fence against it; this transport layer never inspects it. */
  readonly membership: unknown;
}
```
In `syncPullOnce`, where the hello body is parsed (~line 106), read `membership` alongside `environment` and include it in the returned object:
```ts
const helloBody = JSON.parse(await hello.text()) as { environment: string; membership?: unknown };
const sourceEnvironment = helloBody.environment;
// … existing fetch/apply …
return { ...result, fetched: rows.length, advanced: after > before, membership: helloBody.membership };
```

- [ ] **Step 4: Add the best-effort `adoptMembership` callback to `runSyncPull`**

Add to `RunSyncPullDeps` (beside `reportCursor`, ~line 149):
```ts
  /** Best-effort membership gossip (design §5): called once per peer per drain with the RAW
   * `membership` document that peer advertised on /hello. Injected so the loop stays a pure transport
   * (the accept fence + persist live in apps/server). A throw is logged sync.membership_adopt_failed
   * and swallowed — like reportCursor, it must NEVER fail the peer or grow its backoff (the pull is
   * never blocked on adoption, spec §5). Absent → no gossip. */
  adoptMembership?: (rawMembership: unknown) => Promise<void>;
```
In `runSyncPull`'s per-peer body, capture the final drain result and adopt after the `while` loop, in its **own** try/catch (mirror the `reportCursor` block ~245–253). The drain currently is:
```ts
        while (!deps.signal.aborted) {
          const result = await pullOnce(deps, peer);
          if (result.fetched < deps.batchLimit || !result.advanced) break;
        }
```
Change it to keep the last result and adopt:
```ts
        let last: SyncPullResult | undefined;
        while (!deps.signal.aborted) {
          last = await pullOnce(deps, peer);
          if (last.fetched < deps.batchLimit || !last.advanced) break;
        }
        // Best-effort membership adoption (spec §5): hand the peer's advertised document to the
        // injected callback. Its OWN try/catch — an adopt failure is a witness optimisation missing,
        // never a pull failure, so it is logged and swallowed here and must NEVER grow the peer's
        // backoff (same posture as the cursor report below). Runs only when a hello was fetched.
        if (deps.adoptMembership !== undefined && last !== undefined) {
          try {
            await deps.adoptMembership(last.membership);
          } catch {
            deps.log("warn", "sync.membership_adopt_failed", { originId: peer.nodeId, lane });
          }
        }
```
(The existing `reportCursor` block and `backoff.set(peer.nodeId, 0)` follow unchanged.)

- [ ] **Step 5: Run the tests, verify they pass**

Run: `pnpm --filter @waitron/sync test pull.test`
Expected: PASS. Then confirm no dep leaked in: `pnpm --filter @waitron/sync exec node -e "console.log(Object.keys(require('./package.json').dependencies))"` — `@waitron/membership`/`@waitron/db` absent.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/pull.ts packages/sync/src/pull.test.ts
git commit -s -m "feat(membership): thread /hello membership through the pull + best-effort adopt callback"
```

---

## Task 2: `apps/server` — the adoption module (accept fence + term-guarded persist)

**Files:**
- Create: `apps/server/src/membership-adopt.ts`
- Test: `apps/server/src/membership-adopt.test.ts`
- Modify: `apps/server/package.json` (add `@waitron/membership` dependency), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `acceptMembershipDocument`, `TrustSet`, `SignedMembershipDocument`, `AcceptResult` (`@waitron/membership`); `readNodeMembership` (`@waitron/db`); `Database` (`@waitron/db`); `Logger` (`./logger.js`); `nodeMembership` is **not** imported (kept encapsulated in `@waitron/db` — the guarded upsert is written as raw `sql` against the table name, see below).
- Produces:
  - `persistIfNewer(db: Database, document: SignedMembershipDocument): Promise<boolean>` — the term-guarded conditional upsert; returns whether the row changed. The monotonic backstop.
  - `adoptMembership(deps: AdoptMembershipDeps, raw: unknown): Promise<AcceptResult>` where
    `interface AdoptMembershipDeps { db: Database; trustSet: TrustSet }` — runs the accept fence and, on accept, `persistIfNewer`. Returns the `AcceptResult` so the boot wrapper can log.

- [ ] **Step 0: Add the `@waitron/membership` dependency to `apps/server`**

`apps/server` does **not** yet depend on `@waitron/membership` (it has `@waitron/db`, `@waitron/sync`, etc. but not this leaf). Add to `apps/server/package.json` `dependencies` (alphabetical — between `@waitron/layouts` and `@waitron/migrations`):
```json
"@waitron/membership": "workspace:*",
```
Then run `pnpm install` (updates `pnpm-lock.yaml`; commit it — CLAUDE.md §2, `--frozen-lockfile` is a CI gate). This is a runtime dependency: the adoption module (this task) and boot (Task 5) call `acceptMembershipDocument` at runtime, so it belongs in `dependencies`, not `devDependencies`.

- [ ] **Step 1: Write the failing tests in `apps/server/src/membership-adopt.test.ts`**

PGlite (the adoption logic is pure SQL + the pure `@waitron/membership` fence; no privilege/RLS behaviour — the grant is proven in Task 3 on real Postgres). Build a fixture trust set from a generated keypair.

```ts
import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "@waitron/membership";
import type { SignedMembershipDocument, TrustSet } from "@waitron/membership";
import { readNodeMembership, writeNodeMembership } from "@waitron/db";
import { createPgliteDb } from "@waitron/db"; // or the app's PGlite helper — see implementer note
import { CORE_MIGRATIONS } from "@waitron/db"; // whichever export runs the core migrations in-app
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { adoptMembership, persistIfNewer } from "./membership-adopt.js";

// A signed document at `term`, signed by node "A" with a generated identity key. The trust set maps
// "A" → that public key, so verifyMembershipDocument passes; an EMPTY trust set makes the same
// document untrusted_signer — the inert-seam production behaviour.
const kp = generateNodeKeyPair();
function doc(term: number): SignedMembershipDocument {
  return signDoc(sampleBody(term), "A", kp.privateKey); // sampleBody/signDoc from document-fixtures
}
const TRUST: TrustSet = { A: kp.publicKey };
const EMPTY: TrustSet = {};

describe("membership adoption", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  it("persistIfNewer upserts when there is no held document", async () => {
    expect(await persistIfNewer(pg.db, doc(3))).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(3);
  });

  it("persistIfNewer is monotonic — a lower term is a no-op, a higher term overwrites", async () => {
    await persistIfNewer(pg.db, doc(5));
    expect(await persistIfNewer(pg.db, doc(3))).toBe(false); // the atomic WHERE guard rejects it
    expect((await readNodeMembership(pg.db))?.body.term).toBe(5);
    expect(await persistIfNewer(pg.db, doc(7))).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(7);
  });

  it("adoptMembership accepts an authentic, strictly-newer document and persists it", async () => {
    const outcome = await adoptMembership({ db: pg.db, trustSet: TRUST }, doc(2));
    expect(outcome.accepted).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(2);
  });

  it("adoptMembership rejects an untrusted signer (the empty-trust-set production no-op)", async () => {
    const outcome = await adoptMembership({ db: pg.db, trustSet: EMPTY }, doc(9));
    expect(outcome).toEqual({ accepted: false, reason: "invalid", failure: "untrusted_signer" });
    expect(await readNodeMembership(pg.db)).toBeNull(); // nothing persisted
  });

  it("adoptMembership rejects a not-newer document and leaves the held one intact", async () => {
    await writeNodeMembership(pg.db, doc(5));
    const outcome = await adoptMembership({ db: pg.db, trustSet: TRUST }, doc(5));
    expect(outcome).toEqual({ accepted: false, reason: "not_newer" });
    expect((await readNodeMembership(pg.db))?.body.term).toBe(5);
  });

  it("adoptMembership treats a missing/malformed served value as nothing to adopt", async () => {
    expect((await adoptMembership({ db: pg.db, trustSet: TRUST }, undefined)).accepted).toBe(false);
    expect((await adoptMembership({ db: pg.db, trustSet: TRUST }, null)).accepted).toBe(false);
    expect((await adoptMembership({ db: pg.db, trustSet: TRUST }, { junk: 1 })).accepted).toBe(false);
    expect(await readNodeMembership(pg.db)).toBeNull();
  });
});
```

> **Implementer note — imports.** Import `sampleBody`/`signDoc` from `@waitron/membership`'s test fixtures **only if they are exported from the package barrel**; `document-fixtures.ts` is currently package-internal (not re-exported from `index.ts`). If it is not exported, inline a tiny local `doc()` builder in this test using the exported `signDocumentBody` (or `generateNodeKeyPair` + `canonicalize` are not needed — `signDocumentBody(body, kp.privateKey)` yields the signature) rather than exporting fixtures from the package (keep the package's public surface minimal, matching its Slice-1 barrel discipline). Confirm the correct PGlite/migration helper names the app already uses in a sibling test (e.g. how `mirror`/`sync` app tests spin up a PGlite `core` DB) — reuse those, don't invent new ones.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @waitron/server test membership-adopt`
Expected: FAIL — `./membership-adopt.js` does not exist.

- [ ] **Step 3: Write `apps/server/src/membership-adopt.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  acceptMembershipDocument,
  type AcceptResult,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import { readNodeMembership, type Database } from "@waitron/db";

/**
 * Local adoption of a gossiped membership document (design §5). Wired to the pull worker's
 * `adoptMembership` callback (boot.ts): every /sync-api/hello handshake hands the peer's advertised
 * document here. Runs the Slice-1 two-part accept fence (authentic via the trust set + strictly newer
 * than the held term) and, only on accept, persists it. Returns the `AcceptResult` so the caller can
 * log an adoption; a rejection is the normal, quiet case (an already-held or untrusted document).
 *
 * The `trustSet` is the inert Slice-4 seam: boot passes `{}` today, so every real gossiped document is
 * `untrusted_signer` and this is a production no-op until setup/adopt populates the trust set. The
 * mechanism is exercised only with an injected fixture trust set in tests.
 *
 * This NEVER throws for an expected rejection (untrusted / not-newer / malformed) — those are results,
 * not errors — so the pull loop's best-effort wrapper only ever logs on a genuine DB/transport fault.
 */
export interface AdoptMembershipDeps {
  db: Database; // the pull worker's app-role pool (member of app_user → INSERT/UPDATE on node_membership)
  trustSet: TrustSet;
}

export async function adoptMembership(
  deps: AdoptMembershipDeps,
  raw: unknown,
): Promise<AcceptResult> {
  // Nothing served (older peer) or a non-object blob: not a candidate document. Fold it into the
  // fence's own malformed verdict rather than a separate return shape — the caller only branches on
  // `accepted`.
  if (raw === null || typeof raw !== "object") {
    return { accepted: false, reason: "invalid", failure: "malformed" };
  }
  const held = await readNodeMembership(deps.db);
  const currentTerm = held === null ? null : held.body.term;
  // acceptMembershipDocument re-runs verifyMembershipDocument (structural + signature + trust), so
  // casting the unknown blob is safe — a malformed shape yields { accepted:false, failure:"malformed" }.
  const result = acceptMembershipDocument(raw as SignedMembershipDocument, currentTerm, deps.trustSet);
  if (result.accepted) await persistIfNewer(deps.db, result.document);
  return result;
}

/**
 * Term-guarded conditional upsert of the `node_membership` singleton — the atomic monotonic backstop
 * behind the accept fence (both the ordered and fast lanes adopt from the same peer, so read-accept-
 * write can race; the WHERE closes it, including the first-adopt race a row lock cannot). Returns
 * whether the row actually changed. Kept separate from @waitron/db's `writeNodeMembership`, which is a
 * deliberately dumb plain-upsert setter (owner decision, Slice 2); this is the runtime-adoption write.
 *
 * `term` is denormalised from `document.body.term` (the #197 number↔bigint reconciliation), the same
 * way `writeNodeMembership` does it. `document` is jsonb — Drizzle's `sql` parameter binds the object.
 */
export async function persistIfNewer(
  db: Database,
  document: SignedMembershipDocument,
): Promise<boolean> {
  const term = document.body.term;
  const res = await db.execute(sql`
    insert into node_membership (id, term, document)
    values (1, ${term}, ${document})
    on conflict (id) do update
      set term = excluded.term, document = excluded.document, updated_at = now()
      where node_membership.term < excluded.term
  `);
  return (res.rowCount ?? 0) > 0;
}
```

> **Implementer notes.**
> - `document` bound into a `jsonb` column: Drizzle serialises a JS object passed as a `sql` parameter to a `jsonb` column. If the driver binds it as `text` instead (a `42804` column-type error at runtime), cast explicitly — `${JSON.stringify(document)}::jsonb` — and pin the working form with the round-trip test above. Prefer the un-stringified object first; fall back only if PGlite/pg rejects it.
> - `res.rowCount` on the drizzle `execute` result is how "did the upsert change a row" is read (an INSERT reports 1; a conflict whose WHERE is false reports 0). Confirm the property name against the driver result shape used elsewhere in the app (some paths read `.rowCount`, some `.rows.length`); a `returning id`/`select` fallback is acceptable if `rowCount` is not reliable under PGlite.
> - Import `Database` from `@waitron/db`'s barrel if it is exported there; otherwise from wherever sibling app modules import the `Database` type.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @waitron/server test membership-adopt`
Expected: PASS (all six cases).

- [ ] **Step 5: Prove the monotonic guard by deletion (CLAUDE.md §4)**

Temporarily delete the `where node_membership.term < excluded.term` clause, re-run the "monotonic" test, and confirm it now FAILS (the `doc(3)` write overwrites the stored `5`). Restore the clause; confirm green. This proves the WHERE is load-bearing, not decorative.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/membership-adopt.ts apps/server/src/membership-adopt.test.ts
git commit -s -m "feat(membership): local adoption module — accept fence + term-guarded persist"
```

---

## Task 3: `@waitron/db` — the deferred `app_user` INSERT/UPDATE write grant

**Files:**
- Create: `packages/db/drizzle/0097_node_membership_write_grant.sql` (+ journal entry via `db:generate:custom`)
- Modify: `packages/db/src/node-membership.ts` (comment only), `packages/db/src/node-membership.rls.test.ts` (expectation flip)

**Interfaces:**
- Produces: `app_user` now holds SELECT+INSERT+UPDATE (not DELETE) on `node_membership`, so the pull worker's app-role pool can persist an adopted document (Task 2's `persistIfNewer`).

- [ ] **Step 1: Flip the failing assertion in `packages/db/src/node-membership.rls.test.ts`**

Change the expectation from Slice-2's SELECT-only to SELECT+INSERT+UPDATE, DELETE still denied, and update the test name + comment:
```ts
  it("app_user holds SELECT+INSERT+UPDATE on node_membership and NOT DELETE (runtime adoption write, Slice 3)", async () => {
    // Slice 3 adds the runtime-adoption write grant (#198 deferral): the pull worker persists a
    // gossiped, accepted document on the app pool (membership-adopt.ts / persistIfNewer). It never
    // DELETEs the singleton — supersession is an UPDATE to a higher term — so DELETE stays denied.
    const rows = await suite.admin.execute<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(sql`
      select
        has_table_privilege('app_user', 'node_membership', 'SELECT') as sel,
        has_table_privilege('app_user', 'node_membership', 'INSERT') as ins,
        has_table_privilege('app_user', 'node_membership', 'UPDATE') as upd,
        has_table_privilege('app_user', 'node_membership', 'DELETE') as del
    `);
    expect(rows.rows[0]).toEqual({ sel: true, ins: true, upd: true, del: false });
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test node-membership.rls`
Expected: FAIL — `ins`/`upd` are still `false` (grant not yet added).

- [ ] **Step 3: Generate + hand-write the grant migration**

Run: `pnpm --filter @waitron/db db:generate:custom --name node_membership_write_grant`
This appends an empty `0097_node_membership_write_grant.sql` and its `_journal.json` entry (drizzle-kit diffs nothing — `node_membership` is not in the schema barrel). Confirm the number is `0097` against the journal tail (`0096_node_membership` is current); if a rebase over `main` bumped it, use the next free number and keep the `_node_membership_write_grant` suffix (the Drizzle migration-number collision recovery: reset `drizzle/` to `main`, keep the schema TS, re-run `db:generate:custom`).

Write the SQL body:
```sql
-- Custom migration (drizzle-kit models no grants). Membership Slice 3 (distribution): the runtime-
-- adoption writer persists a gossiped, accepted membership document on the APP pool (a node adopting
-- a newer document over /sync-api/hello — apps/server/src/membership-adopt.ts). Slice 2 granted SELECT
-- only (owner-role writes); this adds the deferred INSERT/UPDATE. NO DELETE — the singleton is never
-- deleted, supersession is an UPDATE to a higher term.
GRANT INSERT, UPDATE ON "node_membership" TO app_user;
```

- [ ] **Step 4: Run it, verify red→green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test node-membership.rls`
Expected: PASS (`{ sel: true, ins: true, upd: true, del: false }`). The `core` template is rebuilt from the migration folder, so 0097 is included.

- [ ] **Step 5: Update the `writeNodeMembership` comment in `packages/db/src/node-membership.ts`**

The current comment says the accessor "runs on the provisioning/owner connection, never the app pool — until Slice 3 adds runtime adoption and, with it, the write grant." Slice 3 has now added the grant, but this **accessor is still the dumb owner/promote-path setter** — the runtime adoption write is `persistIfNewer` in `apps/server`, not this. Replace the last sentence to say so, so the comment does not go stale (CLAUDE.md §1 — a behaviour change retires every receipt about the old behaviour):
```ts
 * `app_user` now holds INSERT/UPDATE on `node_membership` (Slice 3's runtime-adoption grant), but the
 * runtime adoption write is the term-guarded `persistIfNewer` in apps/server, not this accessor: this
 * stays the dumb plain-upsert setter for the owner/promote paths (owner decision, Slice 2).
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/0097_node_membership_write_grant.sql packages/db/drizzle/meta/_journal.json \
        packages/db/src/node-membership.rls.test.ts packages/db/src/node-membership.ts
git commit -s -m "feat(membership): app_user INSERT/UPDATE grant on node_membership (Slice 3 adoption write)"
```

---

## Task 4: `apps/server` — serve the held document on `/sync-api/hello`

**Files:**
- Modify: `apps/server/src/sync-api.ts`
- Test: `apps/server/src/sync-api.rls.test.ts`

**Interfaces:**
- Consumes: `readNodeMembership` (`@waitron/db`).
- Produces: `GET /sync-api/hello` → `{ nodeId, environment, membership: SignedMembershipDocument | null }` (behind the existing peer-token guard).

- [ ] **Step 1: Add the failing test to `apps/server/src/sync-api.rls.test.ts`**

Alongside the existing "/sync-api/hello returns this node's id and environment" test, add: seed the singleton with a document (via `writeNodeMembership` on the admin pool), mount, and assert `/hello` returns it; and with no document seeded, `membership` is `null`.

```ts
  it("/sync-api/hello serves the held membership document (null when unset)", async () => {
    await withApp(async (app, pool) => {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "memPeer", name: "mem" });
      mountSyncApi(app, { db: pool, tenantId: "t", nodeId: "n", environment: "production" }, log);

      // Unset → membership is null.
      const before = await app.request("/sync-api/hello", {
        headers: { Authorization: `Bearer ${peer.token}` },
      });
      expect(before.status).toBe(200);
      expect((await before.json()).membership).toBeNull();

      // Seeded (owner/admin write) → /hello serves the whole document.
      const document = signDoc(sampleBody(4), "A", generateNodeKeyPair().privateKey);
      await writeNodeMembership(postgres.admin, document);
      const after = await app.request("/sync-api/hello", {
        headers: { Authorization: `Bearer ${peer.token}` },
      });
      expect(await after.json()).toMatchObject({ nodeId: "n", environment: "production" });
      expect((await after.json()).membership).toEqual(document);
    });
  });
```

> **Implementer note — the mount pool must hold SELECT on `node_membership`.** `deps.db` in `mountSyncApi` reads the held document; the pool it runs on must be an `app_user` member (production uses `syncDb`, which is). Reuse whichever pool the sibling `/hello` test mounts with that has `app_user` SELECT (the file already builds a `reader`/`pool` for this). Seed via `postgres.admin` (owner) since `writeNodeMembership` is owner-role. Reuse the file's existing `withApp`/`enrolPeer`/`log` helpers — names above are illustrative; open the file first. Import `writeNodeMembership` from `@waitron/db`, and `signDoc`/`sampleBody`/`generateNodeKeyPair` per Task 2's fixture note.

- [ ] **Step 2: Run the test, verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api.rls`
Expected: FAIL — the response has no `membership` field (`undefined`, not `null`/the document).

- [ ] **Step 3: Serve the document in `apps/server/src/sync-api.ts`**

Add the import and read the held document in the `/hello` handler:
```ts
import { readNodeMembership } from "@waitron/db";
// …
  app.get("/sync-api/hello", (c) =>
    run(c, log, async () => {
      await requirePeer(deps.db, c);
      // The held membership document rides the handshake (design §5): any puller re-runs the accept
      // fence against it (membership-adopt.ts). `null` when this node has never adopted one. Read on
      // the same app-role pool (app_user holds SELECT on node_membership).
      const membership = await readNodeMembership(deps.db);
      return c.json({ nodeId: deps.nodeId, environment: deps.environment, membership });
    }),
  );
```
Update the `mountSyncApi` doc comment's `/hello` sentence to mention it now returns `{ nodeId, environment, membership }` (design §5).

- [ ] **Step 4: Run the test, verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api.rls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync-api.ts apps/server/src/sync-api.rls.test.ts
git commit -s -m "feat(membership): serve the held membership document on /sync-api/hello"
```

---

## Task 5: `apps/server` — wire adoption into boot + the end-to-end gossip proof

**Files:**
- Modify: `apps/server/src/boot.ts`
- Test: `apps/server/src/membership-gossip.e2e.test.ts` (new — the real consume path)

**Interfaces:**
- Consumes: `adoptMembership` (Task 2), `runSyncPull`'s new `adoptMembership` dep (Task 1), `mountSyncApi`'s served document (Task 4).
- Produces: a running node's pull worker adopts a gossiped document (when its trust set is non-empty). In production the trust set is `{}` (inert seam), so this is wired-but-quiet until Slice 4.

- [ ] **Step 1: Write the failing end-to-end test `apps/server/src/membership-gossip.e2e.test.ts`**

This is the honest integration proof, and it does NOT go through the empty boot seam — it wires the **real** `adoptMembership` (Task 2) into the **real** `runSyncPull` (Task 1) against a **real** mounted `/sync-api/hello` (Task 4), with a **fixture** trust set. It proves the whole consume path: a document seeded on the source is served on `/hello`, pulled, accepted, and persisted into the subscriber's `node_membership`. Real Postgres (two DBs: source + subscriber), following the `mirror-e2e.rls.test.ts` two-node shape.

```ts
// Real end-to-end gossip (design §5): source serves the held document on /sync-api/hello; the
// subscriber's pull worker adopts it through the real accept fence + persist, with a FIXTURE trust
// set (production uses the empty Slice-4 seam, so this path is inert there — proven separately by the
// unit tests). Real Postgres: the source mounts the peer-authenticated API; the subscriber runs the
// real syncPullOnce/runSyncPull against it via an in-process fetch adapter.
it("a subscriber adopts the source's document over the /hello handshake", async () => {
  // 1. Source: enrol the subscriber as a peer, mount /sync-api, seed a term-4 document.
  // 2. Subscriber: runSyncPull one round, adoptMembership wired to the real module + fixture trust set.
  // 3. Assert: readNodeMembership(subscriberDb).body.term === 4.
  // 4. Second round with the SAME document → still term 4 (idempotent, not_newer).
  // 5. Empty trust set variant → subscriber's node_membership stays null (untrusted_signer, the
  //    production no-op).
});
```

> **Implementer note.** Model the two-node wiring on `apps/server/src/mirror-e2e.rls.test.ts` (source app + subscriber DB, an in-process `HttpClient` that routes to `app.request`). Drive one pull round with an `AbortController` the `adoptMembership` callback aborts (as in Task 1's runSyncPull test), or call `syncPullOnce` directly + `adoptMembership` to keep it deterministic. The fixture trust set is `{ <signerNodeId>: <keypair.publicKey> }`. If a full two-node harness is disproportionate, the minimum viable proof is: mount the real `/sync-api/hello` (Task 4) on a source DB, call the real `syncPullOnce` against it through an in-process fetch adapter, hand `result.membership` to the real `adoptMembership({ db: subscriberDb, trustSet: FIXTURE })`, and assert the subscriber's `node_membership`. Both the trusted (adopts) and empty-trust (no-op) directions must be asserted.

- [ ] **Step 2: Run it, verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test membership-gossip.e2e`
Expected: FAIL — boot does not yet wire `adoptMembership` (if driving through boot) / the wiring under test does not exist.

- [ ] **Step 3: Wire `adoptMembership` into `runSyncPull` in `boot.ts`**

In `boot.ts`, import the adoption module and build the callback with the **empty trust-set seam**, then pass it into `runSyncPull` inside `runLane` (~line 1139). The callback runs on the app-role `localSyncDb` (a member of `app_user`, so it holds the Slice-3 INSERT/UPDATE grant) and logs an adoption:
```ts
import { adoptMembership as adoptMembershipDocument } from "./membership-adopt.js";
// … inside the `if (syncConfig !== undefined)` block, after `localSyncDb` is fixed …

    // The membership trust set (design §4). SLICE-4 SEAM: empty today, so every gossiped document is
    // untrusted_signer and adoption is a production no-op until setup/adopt populates it. Kept as a
    // named local so Slice 4 replaces this one line with a real read.
    const membershipTrustSet: TrustSet = {};
    // Best-effort membership gossip on the pull handshake (design §5): the pull worker hands each
    // peer's advertised /hello document here; the accept fence + term-guarded persist run on the
    // app-role pool. A rejection (untrusted / not-newer) is the quiet normal case; a real fault is
    // logged by runSyncPull as sync.membership_adopt_failed. Shared by both lanes (idempotent + the
    // persist's WHERE guard is monotonic under the two-lane race).
    const adoptMembership = async (raw: unknown): Promise<void> => {
      const outcome = await adoptMembershipDocument({ db: localSyncDb, trustSet: membershipTrustSet }, raw);
      if (outcome.accepted) log.info("membership.adopted", { term: outcome.document.body.term });
    };
```
Then add `adoptMembership,` to the `runSyncPull({ … })` deps object in `runLane`.

> **Implementer note.** Import `TrustSet` from `@waitron/membership`. `log.info` — match the app `Logger`'s actual info method/shape (some call sites use `log("info", code, params)`); mirror a sibling `log.info`/`log(...)` call in `boot.ts`. `membership.adopted` is a log code (English, not an AppError) — do not register it. Confirm `localSyncDb` is in scope at the insertion point (it is the hoisted `const localSyncDb = syncDb` at ~line 1125).

- [ ] **Step 4: Run the e2e test + confirm boot still boots**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test membership-gossip.e2e boot.test`
Expected: PASS — the gossip e2e is green, and the existing boot tests still pass (the added dep is additive; the empty trust set means production boot behaviour is unchanged — `boot.test.ts` asserts no adoption).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/membership-gossip.e2e.test.ts
git commit -s -m "feat(membership): wire pull-handshake adoption into boot (empty trust-set seam)"
```

---

## Task 6: Package gates + whole-workspace guards

**Files:** none (verification only).

- [ ] **Step 1: The three changed packages' full coverage gates (UNFILTERED, so the cross-cutting guard suites load — CLAUDE.md §2)**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
```
Expected: PASS, all four thresholds ≥ 98/98/98/95 in each. Run each package UNFILTERED (not a name-filtered subset) so its whole-package guard suites (`inmutabilidad`, teardown, etc.) load.

- [ ] **Step 2: Fiscal isolation guard + root guards**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
pnpm vitest run scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/guarded-teardowns.test.ts
```
Expected: PASS. `node_membership` carries no `tenant_id`, so the `inmutabilidad` FORCE-RLS scan is out of scope for it by construction (unchanged from Slice 2 — the grant does not add a policy). The root guards confirm no pinned list went stale and every new teardown is guarded.

- [ ] **Step 3: The four-command gate + dependency-direction sanity**

```
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
pnpm --filter @waitron/membership test:coverage
```
Expected: PASS. `@waitron/membership` is unchanged by this slice (consumed only through its existing public surface); confirm it is still green since `apps/server` now depends on it at runtime.

- [ ] **Step 4: Whole-workspace breadth (RAM permitting — see memory on browser-vitest × pnpm-r)**

```
TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test:coverage
```
Expected: PASS. Run once before the PR so any dependent of `@waitron/sync`/`@waitron/db` the new edges touch is covered. If RAM is tight, rely on the per-package gates above + the pre-push hook's scoped run, and note it.

---

## Self-Review Notes (author)

- **Spec coverage (§5 + §4):** serve on `/hello` → Task 4; self-verifying adoption via the accept fence → Task 2; distribution over the existing pull handshake with no new authenticated channel → Task 1; the demote-never-promote asymmetry — Slice 3 only *persists* the newest authentic document (it does not act on it), which is inert and safe (§5's "strip authority" wiring is Slice 5) → recorded as deferred. The `node_membership` write path that §3's storage boundary left owner-only → Task 3's grant. §6 rejoin, §7 conflict surface, §8 promotion-mints are **out of scope** — later slices, named in the Goal.
- **Owner decisions honoured:** inert trust-set seam (empty `{}` in boot, fixtures in tests); `@waitron/sync` stays transport-only (injected callback, no membership/db dep); `writeNodeMembership` stays the dumb setter (the guarded write is a *new* `persistIfNewer`, not a change to it); grant is INSERT/UPDATE only, no DELETE, read back both directions on real Postgres.
- **Concurrency:** the two-lane read-accept-write race is closed by the atomic term-guarded conditional upsert (`persistIfNewer`), proven by deletion (Task 2 Step 5). This is a strictly-more-robust realization of the approved "monotonic guard" intent than a row lock (which cannot serialize the first-adopt on a not-yet-existing row) — stated here per CLAUDE.md §1 (the correction/refinement carries its reasoning).
- **CLAUDE.md §3 conventions:** `sync.membership_adopt_failed` / `membership.adopted` are log codes named `sync.<concept>` / `membership.<concept>` after grepping the siblings (`pull_failed`, `cursor_report_failed`, `stream_stalled`); not AppErrors, so not in `errors.ts`. No grant widened to pass a test (INSERT/UPDATE is the documented Slice-3 deferral, not a convenience). The `/hello` field is additive (no bwc code — pre-production).
- **CI-list traps (CLAUDE.md §2):** no repo-wide pinned list changes (manifest lists folders; the three packages own their existing shards; `GENERIC_PACKAGES`/`OWN_SHARD_PACKAGES`/`migratedSets` untouched). Task 6 runs each package UNFILTERED + the root guards + the fiscal isolation guard + (RAM permitting) the whole workspace, so no cross-cutting suite is skipped by scoping.
- **Migration-number collision (memory):** the grant lands as `0097` off current `main` (`0096_node_membership` is tail). If a rebase bumps it, reset `drizzle/` to `main`, keep the schema TS unchanged (this slice adds no table, only a grant), and re-run `db:generate:custom` at the next free number.
- **Stale-comment sweep (CLAUDE.md §1):** Task 3 Step 5 updates `writeNodeMembership`'s "owner-only until Slice 3" comment; Task 4 Step 3 updates `mountSyncApi`'s `/hello` doc sentence. Before the PR, grep `node_membership`/`membership` comments across `packages/db`, `packages/sync`, `apps/server` for any other "Slice 3"/"deferred"/"owner-only" receipt this slice retires.
```

