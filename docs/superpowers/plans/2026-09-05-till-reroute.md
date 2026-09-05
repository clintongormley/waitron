# Till Reroute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A till, handheld or display keeps working across a change of primary with no one touching it: it learns the venue's servers at boot, probes each one, talks to the one accepting sales, and follows a promotion in either direction with only a PIN re-prompt.

**Architecture:** The server gains a public role probe (`GET /api/node`), the server list on the boot read (from the membership document, which adopt now appends the joining node to), CORS for the venue's own origins, a tenant-domain-scoped device cookie, and venue-wide till reads. The till gains a `ServerRouter` applied as a `fetch` wrapper (the `TillApi` is untouched), which probes every listed server and re-targets requests at whichever answers `acceptingSales: true`; `till-app` reacts to a move by locking for a PIN and re-booting, and shows a status line with "check again".

**Tech Stack:** TypeScript, Hono (server, `hono/cors`), Lit (till), Vitest (browser mode for `apps/till`, PGlite + real Postgres via Testcontainers for `apps/server`), Drizzle.

**Spec:** `docs/superpowers/specs/2026-09-05-till-reroute-design.md` — read it first; every task below cites the section it implements.

## Global Constraints

- **No new table, no new migration** (`docs/backlog.md` → Sequencing: nothing before Track A's squash). Every task here is code + config + docs only.
- **Six slices, each its own branch + PR** (spec §7): create each worktree with `python3 ~/workspace/tools/worktree.py new waitron <branch>` (never plain `git worktree add`), run the gate before pushing, then `/finish-branch`. Branch names: `feat/till-reroute-s1-server-truth`, `feat/till-reroute-s2-cors-cookie`, `feat/till-reroute-s3-venue-reads`, `feat/till-reroute-s4-router`, `feat/till-reroute-s5-behaviour`, `feat/till-reroute-s6-e2e`.
- **Per-slice gate** (run yourself, then the hook runs it again): `pnpm lint && pnpm typecheck && pnpm format:check`, then `pnpm --filter <pkg> test:coverage` for every package the slice touched (`@waitron/membership`, `@waitron/server`, `@waitron/till`). `apps/till` runs in real headless Chromium — never two browser-mode runs at once, never beside another session's `pre-push` (`pgrep -f .husky/pre-push` must print nothing).
- **Every commit `git commit -s`** (DCO).
- **Error codes name the domain concept and are never renamed.** This plan adds none on the server; the till adds i18n KEYS (`server.*`, `sale.unconfirmed`), which are UI copy, not error codes.
- **Comments carry the invariant, not the history** (CLAUDE.md §1). Cite the spec section in one line; never narrate the change.
- **Spanish identifiers in `apps/*` are caught only by review** — keep identifiers English; Spanish only inside the `es` string map.
- **TDD:** failing test → run it → minimal code → run → commit, per task.
- **Do not touch** `packages/sync` or `packages/db/src/enrolment.ts` (Track A's ground). The two cleanups the backlog once attached to this item are dropped (spec §1).

---

## File map

| File | Responsibility | Slice |
| --- | --- | --- |
| `packages/membership/src/standings.ts` (+ test, `index.ts`) | `withMember`: append/refresh a member with its `contactUrl` | S1 |
| `apps/server/src/config.ts` (+ test) | `advertisedOrigin`, `tenantDomain` | S1, S2 |
| `apps/server/src/membership-seed.ts` (+ test) | term-0 document carries the primary's `contactUrl` | S1 |
| `apps/server/src/mirror-bundle-fetch.ts`, `mirror-bundle-api.ts` (+ tests) | adopt carries `standbyContactUrl`; the primary mints the next document with the member appended | S1 |
| `apps/server/src/node-api.ts` (new, + test) | `GET /api/node` | S1 |
| `apps/server/src/till-api.ts` (+ test) | `servers` + `nodeId` on `GET /api/till` | S1 |
| `apps/server/src/boot.ts` | wire `acceptingSales`, `readMembership`, the CORS middleware, `tenantDomain` | S1, S2 |
| `apps/server/src/allowed-origins.ts` (new, + test) | the origin allow-list with its 30 s cache | S2 |
| `apps/server/src/device-session.ts`, `device-api.ts` (+ tests) | `cookieDomainFor`, `Domain` on set/clear | S2 |
| `apps/server/src/working-order.ts` (+ test), `boot.mirror.rls.test.ts` | venue-wide till reads | S3 |
| `CLAUDE.md` §5 | wording | S3 |
| `apps/till/src/api/client.ts` (+ test) | `TillServer`, `servers`/`nodeId` on `TillInfo`, `isNetworkFailure` | S4, S5 |
| `apps/till/src/api/server-router.ts` (new, + test) | `ServerRouter`, `withServerTarget`, persistence | S4 |
| `apps/till/src/main.ts` | composition | S4 |
| `apps/till/src/till-app.ts` (+ test) | react to a move; `sale.unconfirmed`; pass statuses to the lock screen | S5 |
| `apps/till/src/screens/till-lock-screen.ts` (+ tests) | the status line + "check again" | S5 |
| `apps/till/src/i18n/strings.ts` | keys, en + es | S5 |
| `apps/server/src/till-reroute-e2e.rls.test.ts` (new) | two-process contract proof | S6 |
| `docs/backlog.md`, spec pointers | landing notes | S6 |

---

## Slice S1 — server truth (branch `feat/till-reroute-s1-server-truth`)

### Task 1: `withMember` in `@waitron/membership`

**Files:**
- Modify: `packages/membership/src/standings.ts`
- Modify: `packages/membership/src/index.ts`
- Test: `packages/membership/src/standings.test.ts`

**Interfaces:**
- Produces: `withMember(current: readonly MembershipNode[], nodeId: string, contactUrl: string): MembershipNode[]` — appends `{ nodeId, contactUrl, standing: "serving-secondary" }` when absent; when present, replaces only `contactUrl` (standing untouched); never mutates the input.

- [ ] **Step 1: Write the failing tests**

Append to `packages/membership/src/standings.test.ts`:

```ts
import { withMember } from "./standings.js";

describe("withMember", () => {
  it("appends an absent node as serving-secondary with its contactUrl", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://box.deli.test", standing: "serving-primary" },
    ];
    expect(withMember(current, other, "https://cloud.deli.test")).toEqual([
      { nodeId: self, contactUrl: "https://box.deli.test", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
    ]);
  });

  it("refreshes only the contactUrl of a node already listed, keeping its standing", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "https://box.deli.test", standing: "serving-primary" },
      { nodeId: other, contactUrl: "", standing: "sell-only" },
    ];
    expect(withMember(current, other, "https://cloud.deli.test")).toEqual([
      { nodeId: self, contactUrl: "https://box.deli.test", standing: "serving-primary" },
      { nodeId: other, contactUrl: "https://cloud.deli.test", standing: "sell-only" },
    ]);
  });

  it("returns a new array and never mutates the input", () => {
    const current: MembershipNode[] = [
      { nodeId: self, contactUrl: "", standing: "serving-primary" },
    ];
    const frozen = Object.freeze(current.map((n) => Object.freeze({ ...n })));
    const next = withMember(frozen, other, "https://cloud.deli.test");
    expect(next).not.toBe(frozen);
    expect(frozen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/membership test standings`
Expected: FAIL — `withMember` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/membership/src/standings.ts`:

```ts
/**
 * The org chart after a node JOINS (adopt, till-reroute design §3.3): the node is appended as
 * `serving-secondary` — the standing for "a member that is not primary"; under warm standby it still
 * sells nothing, because a till obeys `GET /api/node`'s `acceptingSales`, never the standing — with its
 * advertised `contactUrl`, the address tills route on. A node already listed keeps its standing and only
 * has its `contactUrl` refreshed (a re-adopt after a wipe). Returns a new array; never mutates the input.
 */
export function withMember(
  current: readonly MembershipNode[],
  nodeId: string,
  contactUrl: string,
): MembershipNode[] {
  if (current.some((n) => n.nodeId === nodeId)) {
    return current.map((n): MembershipNode => (n.nodeId === nodeId ? { ...n, contactUrl } : n));
  }
  return [...current, { nodeId, contactUrl, standing: "serving-secondary" }];
}
```

In `packages/membership/src/index.ts` change the standings export line to:

```ts
export { nextStandings, evictNode, withMember } from "./standings.js";
```

- [ ] **Step 4: Run the package's tests**

Run: `pnpm --filter @waitron/membership test:coverage`
Expected: PASS, thresholds met.

- [ ] **Step 5: Commit**

```bash
git add packages/membership/src/standings.ts packages/membership/src/standings.test.ts packages/membership/src/index.ts
git commit -s -m "feat(membership): withMember — append a joining node with its contactUrl (till-reroute §3.3)"
```

### Task 2: `advertisedOrigin` config

**Files:**
- Modify: `apps/server/src/config.ts` (the `ServerConfig` interface near `managementOrigin`, and `loadConfig` where `managementOrigin` is loaded)
- Test: `apps/server/src/config.test.ts`

**Interfaces:**
- Produces: `config.advertisedOrigin: string` — the origin tills route on for this node (`scheme://host[:port]`, no path). `WAITRON_ADVERTISED_ORIGIN`; unset/empty (`isUnset`) → `config.managementOrigin`; a value that does not parse as a bare origin → `server.config_invalid` with `{ variable: "WAITRON_ADVERTISED_ORIGIN", reason: "not_an_origin" }`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/config.test.ts`, beside the existing `managementOrigin` assertions (the test around line 257 that loads a full production env, and the dev-defaults test around line 109), add:

```ts
it("advertisedOrigin defaults to managementOrigin when unset or empty", () => {
  const base = loadConfig(devEnv(), MIGRATIONS_ROOT, MEDIA_ROOT, STATE_ROOT);
  expect(base.advertisedOrigin).toBe(base.managementOrigin);
  const empty = loadConfig(
    { ...devEnv(), WAITRON_ADVERTISED_ORIGIN: "" },
    MIGRATIONS_ROOT,
    MEDIA_ROOT,
    STATE_ROOT,
  );
  expect(empty.advertisedOrigin).toBe(empty.managementOrigin);
});

it("advertisedOrigin is the configured bare origin", () => {
  const config = loadConfig(
    { ...devEnv(), WAITRON_ADVERTISED_ORIGIN: "https://box.deli.waitron.app" },
    MIGRATIONS_ROOT,
    MEDIA_ROOT,
    STATE_ROOT,
  );
  expect(config.advertisedOrigin).toBe("https://box.deli.waitron.app");
});

it("advertisedOrigin refuses a value that is not a bare origin", () => {
  for (const bad of ["box.deli.waitron.app", "https://box.deli.waitron.app/till", "not a url"]) {
    expect(() =>
      loadConfig({ ...devEnv(), WAITRON_ADVERTISED_ORIGIN: bad }, MIGRATIONS_ROOT, MEDIA_ROOT, STATE_ROOT),
    ).toThrow(
      expect.objectContaining({
        code: "server.config_invalid",
        params: { variable: "WAITRON_ADVERTISED_ORIGIN", reason: "not_an_origin" },
      }),
    );
  }
});
```

Use whatever helper the file already uses to build a minimal dev env (read the top of `config.test.ts`; the names above — `devEnv`, `MIGRATIONS_ROOT`, `MEDIA_ROOT`, `STATE_ROOT` — are to be replaced by the file's actual helper/constant names).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/server test config.test`
Expected: FAIL — `advertisedOrigin` is undefined / no throw.

- [ ] **Step 3: Implement**

In the `ServerConfig` interface, after `managementOrigin`:

```ts
  /**
   * The origin tills route on for THIS node (till-reroute design §3.3): what the node writes as its
   * `contactUrl` in the membership document and what the CORS allow-list treats as "self". A bare
   * origin (`scheme://host[:port]`, no path). From `WAITRON_ADVERTISED_ORIGIN`; unset or empty →
   * `managementOrigin`, the origin the dashboard is already served from.
   */
  advertisedOrigin: string;
```

Add a helper beside `requiredInProduction`:

```ts
/**
 * A bare origin, or the fallback when unset/empty. `new URL(raw).origin === raw` is the whole check: a
 * missing scheme, a path, a query or a fragment all make the parsed origin differ from the input (or
 * fail to parse), and a URL that is nothing but its origin round-trips byte-for-byte.
 */
function bareOrigin(env: Env, variable: string, fallback: string): string {
  const raw = env[variable];
  if (isUnset(raw)) return fallback;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    throw new AppError("server.config_invalid", { variable, reason: "not_an_origin" });
  }
  if (origin !== raw) throw new AppError("server.config_invalid", { variable, reason: "not_an_origin" });
  return raw;
}
```

In `loadConfig`, after `managementOrigin: requiredInProduction(...)`, the object literal cannot reference its own sibling, so compute first:

```ts
  const managementOrigin = requiredInProduction(env, "WAITRON_MANAGEMENT_ORIGIN", environment, DEFAULT_MANAGEMENT_ORIGIN);
```

then in the literal: `managementOrigin,` and `advertisedOrigin: bareOrigin(env, "WAITRON_ADVERTISED_ORIGIN", managementOrigin),`.

- [ ] **Step 4: Run**

Run: `pnpm --filter @waitron/server test config.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): WAITRON_ADVERTISED_ORIGIN — the origin tills route on, defaulting to the management origin (till-reroute §3.3)"
```

### Task 3: the term-0 document carries the primary's `contactUrl`

**Files:**
- Modify: `apps/server/src/membership-seed.ts`
- Modify: `apps/server/src/boot.ts:766` (the `seedTermZeroMembership(...)` call)
- Test: `apps/server/src/membership-seed.test.ts:48`

**Interfaces:**
- Produces: `seedTermZeroMembership(deps, tenantId, nodeId, contactUrl: string)`.

- [ ] **Step 1: Change the test**

In `membership-seed.test.ts`, pass `"https://box.deli.test"` as a fourth argument to every `seedTermZeroMembership(...)` call and change the line-48 expectation to:

```ts
expect(held?.body.nodes).toEqual([
  { nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
]);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/server test membership-seed`
Expected: FAIL (typecheck error on the extra argument, or `contactUrl: ""` in the document).

- [ ] **Step 3: Implement**

`membership-seed.ts`: add the parameter and thread it — `nodes: nextStandings([], nodeId)` becomes

```ts
    nodes: withMember(nextStandings([], nodeId), nodeId, contactUrl),
```

(import `withMember` from `@waitron/membership`; `nextStandings([], nodeId)` appends self as serving-primary with `""`, `withMember` refreshes the url and keeps the standing). Replace the header sentence about `contactUrl` being `""` with: `contactUrl` is the node's `advertisedOrigin` — the address tills route on (till-reroute design §3.3).

`boot.ts:766`: `seedTermZeroMembership({ db: ownerDb, ring }, tenantId, nodeId, config.advertisedOrigin)`.

- [ ] **Step 4: Run**

Run: `pnpm --filter @waitron/server test membership-seed boot.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/membership-seed.ts apps/server/src/membership-seed.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): the term-0 membership document carries the primary's advertised origin as contactUrl (till-reroute §3.3)"
```

### Task 4: adopt appends the joining node to the document

**Files:**
- Modify: `apps/server/src/mirror-bundle-fetch.ts:38-70` (body gains `standbyContactUrl`)
- Modify: `apps/server/src/mirror-bundle-api.ts:96-175` (screen `standbyContactUrl`; after `assembleMirrorBundle`, mint + persist the next document)
- Modify: `apps/server/src/adopt.ts` / `boot.ts` — whatever builds the `standby` argument for `fetchMirrorBundle` passes `contactUrl: config.advertisedOrigin`
- Test: `apps/server/src/mirror-bundle-api.rls.test.ts`, `apps/server/src/mirror-bundle-fetch.test.ts`

**Interfaces:**
- Consumes: `withMember` (Task 1); `mintNextMembershipDocument(deps, { tenantId, heldDocument, nodes, signerNodeId })` and `readNodeMembership`/`writeNodeMembership` (`@waitron/db`).
- Produces: request body field `standbyContactUrl: string` (may be `""` — a standby with no advertised origin is still a member); `fetchMirrorBundle(primaryUrl, credential, standby: { nodeId; publicKey; contactUrl })`.

- [ ] **Step 1: Write the failing tests**

`mirror-bundle-fetch.test.ts` — extend the test that asserts the posted body to expect `standbyContactUrl: "https://cloud.deli.test"` when `standby.contactUrl` is that value.

`mirror-bundle-api.rls.test.ts` — beside "returns a bundle for an authorised admin credential" (line 193), add:

```ts
it("appends the standby to the membership document with its contactUrl, term bumped, signed by the primary", async () => {
  // Arrange exactly as the authorised-credential test does, then:
  const before = await readNodeMembership(suite.admin);
  const res = await app.request("/management-api/mirror-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...credentialBody, // the same personId/password the sibling test posts
      standbyNodeId: STANDBY_NODE_ID,
      standbyPublicKey: STANDBY_PUBLIC_KEY,
      standbyContactUrl: "https://cloud.deli.test",
    }),
  });
  expect(res.status).toBe(200);
  const after = await readNodeMembership(suite.admin);
  expect(after?.body.term).toBe((before?.body.term ?? -1) + 1);
  expect(after?.body.nodes).toContainEqual({
    nodeId: STANDBY_NODE_ID,
    contactUrl: "https://cloud.deli.test",
    standing: "serving-secondary",
  });
  expect(after?.signerNodeId).toBe(PRIMARY_NODE_ID);
  expect(verifyMembershipDocument(after!, trustSet).valid).toBe(true);
});

it("refuses a non-string standbyContactUrl as mirror.standby_invalid", async () => {
  const res = await app.request("/management-api/mirror-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...credentialBody, standbyNodeId: STANDBY_NODE_ID, standbyPublicKey: STANDBY_PUBLIC_KEY, standbyContactUrl: 42 }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });
});
```

Replace the capitalised names with the suite's own fixtures (read the sibling test; the trust set is the primary's public key, obtainable the way the seed test builds it).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/server test mirror-bundle`
Expected: FAIL — the document is unchanged / body field not posted.

- [ ] **Step 3: Implement**

`mirror-bundle-fetch.ts`: widen the `standby` parameter type to `{ nodeId: string; publicKey: string; contactUrl: string }` and post `standbyContactUrl: standby.contactUrl` beside the two existing fields.

`mirror-bundle-api.ts`: in the body type add `standbyContactUrl?: unknown`; in the screen, `typeof body.standbyContactUrl !== "string"` → `mirror.standby_invalid` (an empty string is allowed). After `const bundle = await assembleMirrorBundle({...})` and before `return c.json(bundle)`:

```ts
      // Append the standby to the org chart NOW (till-reroute design §3.3): a standby appears in the
      // document only when it promotes today, which is exactly when a till has no address for it.
      // `withMember` keeps every other node as it was; the next term is signed by this primary.
      const held = await readNodeMembership(deps.appDb);
      const document = await mintNextMembershipDocument(
        { db: deps.appDb, ring: deps.ring },
        {
          tenantId: deps.designated.tenantId,
          heldDocument: held,
          nodes: withMember(held?.body.nodes ?? [], standby.nodeId, standbyContactUrl),
          signerNodeId: deps.designated.nodeId,
        },
      );
      await writeNodeMembership(deps.appDb, document);
```

(`app_user` holds INSERT/UPDATE on `node_membership` — `0097_node_membership_write_grant.sql`. If `mintNextMembershipDocument` needs the owner connection for the key read, use the same `db` the seed path uses — check `membership-mint.ts`'s `readNodeIdentityKey` and mirror `promote.ts:143`'s call, which is the precedent.)

Callers of `fetchMirrorBundle` (grep `fetchMirrorBundle(`): pass `contactUrl: config.advertisedOrigin` from the standby's own config.

- [ ] **Step 4: Run**

Run: `pnpm --filter @waitron/server test mirror-bundle adopt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mirror-bundle-fetch.ts apps/server/src/mirror-bundle-fetch.test.ts apps/server/src/mirror-bundle-api.ts apps/server/src/mirror-bundle-api.rls.test.ts apps/server/src/adopt.ts apps/server/src/boot.ts
git commit -s -m "feat(server): adopt appends the standby to the membership document with its contactUrl (till-reroute §3.3)"
```

### Task 5: `GET /api/node`

**Files:**
- Create: `apps/server/src/node-api.ts`
- Create: `apps/server/src/node-api.test.ts`
- Modify: `apps/server/src/boot.ts` (mount in trading mode, beside `mountTillApi`)

**Interfaces:**
- Produces:

```ts
export interface NodeApiDeps {
  nodeId: string;
  /** Boot-captured (spec §3.1): mode primary AND singleton_role primary AND not fenced. */
  acceptingSales: boolean;
  environment: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
}
export interface NodeProbe {
  nodeId: string;
  term: number | null;
  standing: NodeStanding | null;
  acceptingSales: boolean;
  environment: string;
}
export function mountNodeApi(app: Hono, deps: NodeApiDeps): void;
```

- [ ] **Step 1: Write the failing tests**

`apps/server/src/node-api.test.ts`:

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { mountNodeApi } from "./node-api.js";

const NODE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function doc(nodes: SignedMembershipDocument["body"]["nodes"], term = 3): SignedMembershipDocument {
  return { body: { term, nodes }, signerNodeId: NODE, signature: "sig", endorsements: [] };
}

function mount(overrides: Partial<Parameters<typeof mountNodeApi>[1]> = {}): Hono {
  const app = new Hono();
  mountNodeApi(app, {
    nodeId: NODE,
    acceptingSales: true,
    environment: "preproduction",
    readMembership: () =>
      Promise.resolve(doc([{ nodeId: NODE, contactUrl: "https://box.deli.test", standing: "serving-primary" }])),
    ...overrides,
  });
  return app;
}

describe("GET /api/node", () => {
  it("answers this node's id, term, standing, acceptingSales and environment", async () => {
    const res = await mount().request("/api/node");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      nodeId: NODE,
      term: 3,
      standing: "serving-primary",
      acceptingSales: true,
      environment: "preproduction",
    });
  });

  it("answers acceptingSales:false verbatim from the boot-captured flag", async () => {
    const res = await mount({ acceptingSales: false }).request("/api/node");
    expect((await res.json()).acceptingSales).toBe(false);
  });

  it("answers null term/standing when no document is held or this node is not listed", async () => {
    const none = await mount({ readMembership: () => Promise.resolve(null) }).request("/api/node");
    expect(await none.json()).toMatchObject({ term: null, standing: null });
    const unlisted = await mount({
      readMembership: () => Promise.resolve(doc([{ nodeId: OTHER, contactUrl: "", standing: "serving-primary" }])),
    }).request("/api/node");
    expect(await unlisted.json()).toMatchObject({ term: 3, standing: null });
  });

  it("sends no-store so a probe is never cached", async () => {
    const res = await mount().request("/api/node");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/server test node-api`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/node-api.ts`:

```ts
import type { Hono } from "hono";
import type { NodeStanding, SignedMembershipDocument } from "@waitron/membership";

export interface NodeApiDeps {
  nodeId: string;
  /**
   * Boot-captured (till-reroute design §3.1): `mode === "primary" && singleton_role === "primary" &&
   * !fenced`, read once with the mount guards in boot.ts. Captured, not live, on purpose: a promotion
   * persists its corrected series before the point of no return and takes effect on restart, so a
   * promoted-but-not-restarted process must keep answering false.
   */
  acceptingSales: boolean;
  environment: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
}

export interface NodeProbe {
  nodeId: string;
  term: number | null;
  standing: NodeStanding | null;
  acceptingSales: boolean;
  environment: string;
}

/**
 * `GET /api/node` — the public role probe a till polls every few seconds on EVERY server it knows
 * (till-reroute design §3.1): "who are you, are you accepting sales". No auth, no DB write, mounted on
 * every mode; the one DB read is the whole-DB membership row.
 */
export function mountNodeApi(app: Hono, deps: NodeApiDeps): void {
  app.get("/api/node", async (c) => {
    const held = await deps.readMembership();
    const self = held?.body.nodes.find((n) => n.nodeId === deps.nodeId);
    const body: NodeProbe = {
      nodeId: deps.nodeId,
      term: held?.body.term ?? null,
      standing: self?.standing ?? null,
      acceptingSales: deps.acceptingSales,
      environment: deps.environment,
    };
    c.header("cache-control", "no-store");
    return c.json(body);
  });
}
```

`boot.ts`, in trading mode next to `mountTillApi` (after `holders`/`fenced` exist):

```ts
  mountNodeApi(app, {
    nodeId: config.till.nodeId,
    acceptingSales:
      holders.mode.current === "primary" && holders.singletonRole.current === "primary" && !fenced,
    environment: config.environment,
    readMembership: () => readNodeMembership(db),
  });
```

Add a boot test in `boot.test.ts` (PGlite trading boot): `GET /api/node` on a fresh primary answers `acceptingSales: true`; in `boot.mirror.rls.test.ts`: the mirror answers `false`; in `boot.fence.test.ts`: a fenced boot answers `false`. State the failing case in each test's comment (a live read would flip after `setDeploymentMode`; the captured flag must not).

- [ ] **Step 4: Run**

Run: `pnpm --filter @waitron/server test node-api boot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/node-api.ts apps/server/src/node-api.test.ts apps/server/src/boot.ts apps/server/src/boot.test.ts apps/server/src/boot.mirror.rls.test.ts apps/server/src/boot.fence.test.ts
git commit -s -m "feat(server): GET /api/node — the public role probe with boot-captured acceptingSales (till-reroute §3.1)"
```

### Task 6: `servers` and `nodeId` on `GET /api/till`

**Files:**
- Modify: `apps/server/src/till-api.ts` (`TillApiDeps`, the `GET /api/till` response)
- Modify: `apps/server/src/boot.ts` (wire `readMembership`)
- Test: `apps/server/src/till-api.test.ts` (`deps()` factory at line 223 and the `GET /api/till` tests)

**Interfaces:**
- Produces on the JSON: `nodeId: string`, `servers: Array<{ nodeId: string; url: string; standing: NodeStanding }>` — nodes with a non-empty `contactUrl`, `evicted` excluded, ordered `serving-primary`, `serving-secondary`, `sell-only`.
- `TillApiDeps.readMembership: () => Promise<SignedMembershipDocument | null>`.

- [ ] **Step 1: Write the failing tests**

In `till-api.test.ts`, add `readMembership: () => Promise.resolve(null)` to the `deps()` factory, and add:

```ts
it("GET /api/till lists the venue's servers from the membership document, primary first, evicted and address-less nodes excluded", async () => {
  const app = new Hono();
  const document = {
    body: {
      term: 5,
      nodes: [
        { nodeId: "b", contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
        { nodeId: "c", contactUrl: "https://old.deli.test", standing: "evicted" },
        { nodeId: "d", contactUrl: "", standing: "sell-only" },
        { nodeId: cfg.nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
      ],
    },
    signerNodeId: cfg.nodeId,
    signature: "sig",
    endorsements: [],
  } as const;
  mountTillApi(app, { ...deps(suite.db), readMembership: () => Promise.resolve(document) }, collect([]));
  const res = await app.request("/api/till");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.nodeId).toBe(cfg.nodeId);
  expect(body.servers).toEqual([
    { nodeId: cfg.nodeId, url: "https://box.deli.test", standing: "serving-primary" },
    { nodeId: "b", url: "https://cloud.deli.test", standing: "serving-secondary" },
  ]);
});

it("GET /api/till answers servers: [] when no document is held", async () => {
  const app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  const body = await (await app.request("/api/till")).json();
  expect(body.servers).toEqual([]);
  expect(body.nodeId).toBe(cfg.nodeId);
});
```

Existing `GET /api/till` tests that `toEqual` the whole body gain `nodeId: cfg.nodeId, servers: []`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/server test till-api.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `till-api.ts`: add to `TillApiDeps`

```ts
  /** The held membership document — the venue's server list tills route on (till-reroute §3.2). */
  readMembership: () => Promise<SignedMembershipDocument | null>;
```

Add a pure helper (export it for its own unit test if you prefer):

```ts
const STANDING_ORDER: Record<NodeStanding, number> = {
  "serving-primary": 0,
  "serving-secondary": 1,
  "sell-only": 2,
  evicted: 3,
};

/** The routable servers: an address, not evicted, primary first (till-reroute design §3.2). */
export function routableServers(
  held: SignedMembershipDocument | null,
): Array<{ nodeId: string; url: string; standing: NodeStanding }> {
  if (held === null) return [];
  return held.body.nodes
    .filter((n) => n.contactUrl !== "" && n.standing !== "evicted")
    .sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing])
    .map((n) => ({ nodeId: n.nodeId, url: n.contactUrl, standing: n.standing }));
}
```

In the `GET /api/till` handler, read `const held = await deps.readMembership();` before the `withTenant` block (it is a whole-DB row, no tenant scope), and add to the response: `nodeId: deps.cfg.nodeId, servers: routableServers(held),`.

`boot.ts`: add `readMembership: () => readNodeMembership(db)` to the `mountTillApi` deps.

- [ ] **Step 4: Run**

Run: `pnpm --filter @waitron/server test till-api boot.test`
Expected: PASS.

- [ ] **Step 5: Commit, gate, PR**

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): GET /api/till carries nodeId and the venue's routable servers (till-reroute §3.2)"
pnpm lint && pnpm typecheck && pnpm format:check
pnpm --filter @waitron/membership test:coverage && pnpm --filter @waitron/server test:coverage
```

Then `/finish-branch`.

---

## Slice S2 — cross-origin plumbing (branch `feat/till-reroute-s2-cors-cookie`)

### Task 7: the origin allow-list

**Files:**
- Create: `apps/server/src/allowed-origins.ts`
- Create: `apps/server/src/allowed-origins.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AllowedOriginsDeps {
  advertisedOrigin: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  devMode: boolean;
  now: () => number;
  ttlMs?: number; // default 30_000
}
export function createOriginAllowlist(deps: AllowedOriginsDeps): (origin: string) => Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { createOriginAllowlist } from "./allowed-origins.js";

function doc(urls: string[]): SignedMembershipDocument {
  return {
    body: { term: 1, nodes: urls.map((u, i) => ({ nodeId: `n${i}`, contactUrl: u, standing: "serving-secondary" })) },
    signerNodeId: "n0",
    signature: "s",
    endorsements: [],
  };
}

describe("createOriginAllowlist", () => {
  it("allows the advertised origin and every contactUrl origin, and nothing else", async () => {
    const allow = createOriginAllowlist({
      advertisedOrigin: "https://box.deli.test",
      readMembership: () => Promise.resolve(doc(["https://cloud.deli.test/", ""])),
      devMode: false,
      now: () => 0,
    });
    expect(await allow("https://box.deli.test")).toBe(true);
    expect(await allow("https://cloud.deli.test")).toBe(true);
    expect(await allow("https://evil.example")).toBe(false);
    expect(await allow("http://cloud.deli.test")).toBe(false); // scheme is part of an origin
  });

  it("re-reads the document only after the TTL", async () => {
    let t = 0;
    const read = vi.fn().mockResolvedValue(doc(["https://cloud.deli.test"]));
    const allow = createOriginAllowlist({ advertisedOrigin: "https://box.deli.test", readMembership: read, devMode: false, now: () => t, ttlMs: 30_000 });
    await allow("https://cloud.deli.test");
    await allow("https://cloud.deli.test");
    expect(read).toHaveBeenCalledTimes(1);
    t = 30_001;
    await allow("https://cloud.deli.test");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("allows the three Vite dev origins only in devMode", async () => {
    const base = { advertisedOrigin: "http://localhost:8080", readMembership: () => Promise.resolve(null), now: () => 0 };
    expect(await createOriginAllowlist({ ...base, devMode: true })("http://localhost:5190")).toBe(true);
    expect(await createOriginAllowlist({ ...base, devMode: false })("http://localhost:5190")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/server test allowed-origins` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { SignedMembershipDocument } from "@waitron/membership";

export interface AllowedOriginsDeps {
  advertisedOrigin: string;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  devMode: boolean;
  now: () => number;
  ttlMs?: number;
}

const DEV_ORIGINS = ["http://localhost:5190", "http://localhost:5191", "http://localhost:5192"];

/** A contactUrl's origin, or null when it does not parse — a malformed address allows nothing. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Which browser origins may call this node's API with credentials (till-reroute design §3.4): this
 * node's own advertised origin and the origin of every `contactUrl` in the held membership document —
 * the venue's own servers, nothing else. The document is re-read at most once per `ttlMs` (default
 * 30 s): a preflight or a cross-origin request must not cost a DB read each.
 */
export function createOriginAllowlist(deps: AllowedOriginsDeps): (origin: string) => Promise<boolean> {
  const ttl = deps.ttlMs ?? 30_000;
  let cached: { at: number; origins: Set<string> } | undefined;
  return async (origin) => {
    if (origin === deps.advertisedOrigin) return true;
    if (deps.devMode && DEV_ORIGINS.includes(origin)) return true;
    const t = deps.now();
    if (cached === undefined || t - cached.at > ttl) {
      const held = await deps.readMembership();
      const origins = new Set<string>();
      for (const n of held?.body.nodes ?? []) {
        const o = originOf(n.contactUrl);
        if (o !== null) origins.add(o);
      }
      cached = { at: t, origins };
    }
    return cached.origins.has(origin);
  };
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(server): origin allow-list from the advertised origin + the membership document (till-reroute §3.4)`.

### Task 8: mount CORS on `/api/*`

**Files:**
- Modify: `apps/server/src/boot.ts` (after `app.use("*", requestIdMiddleware(...))`, trading mode only — the allow-list needs `config.till`)
- Test: `apps/server/src/cors.test.ts` (new; a Hono-level test of the exact middleware options, factored into a small helper)

**Interfaces:**
- Produces: `apps/server/src/cors.ts` exporting `corsForVenue(allow: (origin: string) => Promise<boolean>): MiddlewareHandler` built on `hono/cors`.

- [ ] **Step 1: Write the failing tests**

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { corsForVenue } from "./cors.js";

function app(): Hono {
  const a = new Hono();
  a.use("/api/*", corsForVenue((o) => Promise.resolve(o === "https://cloud.deli.test")));
  a.post("/api/session", (c) => c.json({ ok: true }));
  a.get("/api/till", (c) => c.json({ ok: true }));
  return a;
}

describe("corsForVenue", () => {
  it("answers a preflight from an allowed origin with credentials, the content-type and dev-device headers", async () => {
    const res = await app().request("/api/session", {
      method: "OPTIONS",
      headers: { origin: "https://cloud.deli.test", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://cloud.deli.test");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-waitron-dev-device");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("sets no CORS headers for a stranger (the browser then blocks)", async () => {
    const res = await app().request("/api/till", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves a same-origin request (no Origin header) untouched", async () => {
    const res = await app().request("/api/till");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, module not found.

- [ ] **Step 3: Implement** `apps/server/src/cors.ts`:

```ts
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { DEV_DEVICE_HEADER } from "./device-session.js";

/**
 * CORS for the venue's own origins only (till-reroute design §3.4). `origin` returning null makes
 * hono/cors emit no Allow-Origin header, so the browser blocks a stranger; an allowed origin is echoed
 * exactly (never `*` — credentials ride these requests). Same-origin requests carry no Origin header
 * and pass through unchanged.
 */
export function corsForVenue(allow: (origin: string) => Promise<boolean>): MiddlewareHandler {
  return cors({
    origin: async (origin) => ((await allow(origin)) ? origin : null),
    credentials: true,
    allowHeaders: ["content-type", DEV_DEVICE_HEADER],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
}
```

`boot.ts` (trading mode, before the mounts):

```ts
  const allowOrigin = createOriginAllowlist({
    advertisedOrigin: config.advertisedOrigin,
    readMembership: () => readNodeMembership(db),
    devMode: config.devMode,
    now: () => Date.now(),
  });
  app.use("/api/*", corsForVenue(allowOrigin));
```

- [ ] **Step 4: Run** `pnpm --filter @waitron/server test cors boot.test` — PASS. **Step 5: Commit** `feat(server): CORS for the venue's own origins on /api/* (till-reroute §3.4)`.

### Task 9: the device cookie's `Domain`

**Files:**
- Modify: `apps/server/src/config.ts` (+ test) — `tenantDomain?: string` from `WAITRON_TENANT_DOMAIN` (unset/empty → absent; lower-cased; refuse a value containing `/`, `:` or whitespace → `server.config_invalid` `{ variable, reason: "not_a_domain" }`)
- Modify: `apps/server/src/device-session.ts` — `cookieDomainFor`, `setDeviceCookie(c, value, secure, domain?)`, `clearDeviceCookie(c, domain?)`
- Modify: `apps/server/src/device-api.ts:204,586` and `DeviceApiDeps` (`tenantDomain?: string`); `boot.ts` wires `tenantDomain: config.tenantDomain`
- Test: `apps/server/src/device-session.test.ts`, `apps/server/src/device-api.test.ts:44`

**Interfaces:**
- Produces: `cookieDomainFor(host: string | undefined, tenantDomain: string | undefined): string | undefined` — the tenant domain when `host` (port stripped, lower-cased) equals it or ends with `"." + it`; else `undefined`.

- [ ] **Step 1: Write the failing tests**

`device-session.test.ts`:

```ts
describe("cookieDomainFor", () => {
  it("scopes to the tenant domain for a host under it (port stripped, case-insensitive)", () => {
    expect(cookieDomainFor("box.deli.waitron.app", "deli.waitron.app")).toBe("deli.waitron.app");
    expect(cookieDomainFor("Box.Deli.Waitron.App:8443", "deli.waitron.app")).toBe("deli.waitron.app");
    expect(cookieDomainFor("deli.waitron.app", "deli.waitron.app")).toBe("deli.waitron.app");
  });
  it("stays host-only for waitron.local, loopback, a look-alike, or no tenant domain", () => {
    expect(cookieDomainFor("waitron.local", "deli.waitron.app")).toBeUndefined();
    expect(cookieDomainFor("localhost:8080", "deli.waitron.app")).toBeUndefined();
    expect(cookieDomainFor("notdeli.waitron.app", "deli.waitron.app")).toBeUndefined();
    expect(cookieDomainFor("box.deli.waitron.app", undefined)).toBeUndefined();
    expect(cookieDomainFor(undefined, "deli.waitron.app")).toBeUndefined();
  });
});
```

`device-api.test.ts`: beside the existing Set-Cookie assertion (line 44), a test that mounts with `tenantDomain: "deli.waitron.app"` and posts the enrol request with `host: box.deli.waitron.app` → the `set-cookie` contains `Domain=deli.waitron.app`; and with `host: waitron.local` → no `Domain=`. The un-enrol route's clearing Set-Cookie carries the same `Domain` under the tenant host.

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`device-session.ts`:

```ts
/**
 * The `Domain` a device cookie is scoped to (till-reroute design §3.5): the tenant domain when the
 * request host is it or a subdomain of it — so the same httpOnly credential rides to every one of the
 * venue's servers (`box.<tenant>…`, `cloud.<tenant>…`) — and host-only otherwise (`waitron.local`,
 * loopback dev). The comparison strips the port and ignores case; the leading-dot check is what stops
 * `notdeli.waitron.app` from matching `deli.waitron.app`.
 */
export function cookieDomainFor(host: string | undefined, tenantDomain: string | undefined): string | undefined {
  if (host === undefined || tenantDomain === undefined) return undefined;
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  return bare === tenantDomain || bare.endsWith("." + tenantDomain) ? tenantDomain : undefined;
}

export function setDeviceCookie(c: Context, value: string, secure: boolean, domain?: string): void {
  setCookie(c, DEVICE_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    ...(domain === undefined ? {} : { domain }),
  });
}

export function clearDeviceCookie(c: Context, domain?: string): void {
  deleteCookie(c, DEVICE_COOKIE, { path: "/", ...(domain === undefined ? {} : { domain }) });
}
```

`device-api.ts`: `setDeviceCookie(c, ..., deps.secureCookies, cookieDomainFor(c.req.header("host"), deps.tenantDomain))` and the same for `clearDeviceCookie`. `config.ts`: `tenantDomain` per the interface above. `boot.ts`: thread `tenantDomain: config.tenantDomain` into the device API deps.

- [ ] **Step 4: Run** `pnpm --filter @waitron/server test device-session device-api config.test` — PASS. **Step 5: Commit** `feat(server): device cookie scoped to WAITRON_TENANT_DOMAIN when the host is under it (till-reroute §3.5)`.

### Task 10: the manual same-site cookie probe (a receipt, not code)

**Files:** none in the repo; the receipt goes into the S2 PR description and, once landed, into a dated pointer under the spec's §3.4.

- [ ] **Step 1: State the failing case.** If a `SameSite=Strict; Domain=deli.test` cookie set by `box.deli.test` were NOT sent on a `fetch` from a page at `https://box.deli.test` to `https://cloud.deli.test` with `credentials: "include"`, the second host would answer `401 device.unauthorized` on `GET /api/device/me`. That 401 is what this probe must be able to show.

- [ ] **Step 2: Two hosts under one parent.** Add to `/etc/hosts`: `127.0.0.1 box.deli.test cloud.deli.test`. Mint leafs with mkcert (`brew install mkcert && mkcert -install && mkcert box.deli.test cloud.deli.test`).

- [ ] **Step 3: Two servers.** Run two `apps/server` processes against two `pnpm dev:setup`-style databases (the dev-stack-from-a-worktree note on `main`, `docs/backlog.md` → Reference, shows the per-database `.env`), each with `WAITRON_TLS_CERT_FILE`/`KEY_FILE` from step 2, `WAITRON_TENANT_DOMAIN=deli.test`, `WAITRON_ADVERTISED_ORIGIN=https://box.deli.test:8443` / `https://cloud.deli.test:8444`, and the same device row on both (enrol on the box, then copy the `devices` row into the cloud DB with `pg_dump -t devices | psql`). Seed the box's membership document with the cloud's contactUrl (S1's adopt path, or a direct `writeNodeMembership` from a one-off script).

- [ ] **Step 4: The probe.** In Chrome at `https://box.deli.test:8443/`, pair the device, then in DevTools:

```js
await (await fetch("https://cloud.deli.test:8444/api/device/me", { credentials: "include" })).status
```

Expected: `200`. Control (the failing direction): repeat with the cookie set host-only (unset `WAITRON_TENANT_DOMAIN` on the box, re-pair) → `401`.

- [ ] **Step 5: Record.** Paste both results, the two `Set-Cookie` headers and the request's `Cookie` header (from the Network panel) into the PR description under "Same-site cookie receipt", plus Chrome's version. Then the gate and `/finish-branch`.

---

## Slice S3 — venue-wide reads (branch `feat/till-reroute-s3-venue-reads`)

### Task 11: drop the own-node filter from till reads

**Files:**
- Modify: `apps/server/src/working-order.ts:2806, 2850, 2930, 2995, 3911, 4222`
- Test: `apps/server/src/working-order.test.ts:439-446, 511, 579, 724, 786`; `apps/server/src/boot.mirror.rls.test.ts:296-307` (comment only); any test found by `grep -n "ANOTHER node" apps/server/src/*.test.ts`

- [ ] **Step 1: Flip the tests first.** Rename and invert the four "ANOTHER node" tests in `working-order.test.ts`:

```ts
it("lists an open order from ANOTHER node of the same tenant — reads are venue-wide under warm standby (till-reroute §3.6)", async () => {
  const { cfg, cafeId } = await setupVenue();
  const mine = randomUUID();
  await parkOrder({ db }, cfg, { id: mine, lines: [{ productId: cafeId, quantity: "1" }] });
  const foreign = await seedForeignNodeOrder(cfg);
  const listed = (await listHeldOrders({ db }, cfg)).map((o) => o.id);
  expect(listed).toContain(mine);
  expect(listed).toContain(foreign);
});
```

and for the three by-id paths (`getHeldOrder`, edit, abandon): the foreign order is found/edited/abandoned like the node's own. Update `seedForeignNodeOrder`'s doc comment: the row exists to prove reads are venue-wide (a promoted node inherits open tabs tagged with the dead node's id — swap spec §4.3). Keep `node_id` inserted.

For `listStationQueue`/`listExpoQueue` (sites 3911, 4222): find their tests with the grep above and flip the same way.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/server test working-order` → the flipped tests FAIL (the filter still hides the row).

- [ ] **Step 3: Implement.** At each of the six sites remove the `eq(workingOrders.nodeId, cfg.nodeId)` / `eq(ticketItems.nodeId, cfg.nodeId)` term (and a now-single-arm `and(...)` collapses to its remaining predicate). Add ONE comment at `listHeldOrders`:

```ts
// Venue-wide, not node-scoped (till-reroute design §3.6): under warm standby one node sells at a time,
// and a promoted node inherits the venue's open tabs tagged with the dead node's id (swap spec §4.3).
// `node_id` is still written at create — the writer's id, for replication — and never filtered on here.
```

In `boot.mirror.rls.test.ts:296-307` replace the "session-shaped, not routing-shaped" paragraph with: the 401 holds because a mirror refuses `POST /api/session`; reads are venue-wide since till-reroute §3.6, so no node-scope premise remains.

- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage` — PASS (the unfiltered package run, CLAUDE.md §2's name-filtered-run trap).

- [ ] **Step 5: Commit** `feat(server): till reads are venue-wide — a promoted node serves the open tabs it inherited (till-reroute §3.6)`.

### Task 12: CLAUDE.md §5 wording

**Files:** `CLAUDE.md` (§5, the "Nothing EXTERNAL may block a sale" bullet).

- [ ] **Step 1: Replace the bullet with:**

```markdown
- **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.** AEAT, the card network
  and the internet are never on the sale path of whichever node is primary: records chain locally and
  the outbox drains later; a card falls back to 4G, a standalone terminal or cash. What a till DOES
  need is the one node accepting sales — the on-site box when the internet is down; a promoted cloud
  when the box is dead (which needs the internet); box-down AND internet-down together is no failover,
  the MVP's accepted case (`docs/backlog.md` → *MVP for go-live*). The till follows the primary and
  never chooses (`2026-09-05-till-reroute-design.md` §2); only the primary sells. Fiscal submission is
  an outbox, never inline.
```

- [ ] **Step 2: `pnpm format:check`** (a root `CLAUDE.md` is format-checked). **Step 3: Commit** `docs(claude): §5 — a till needs the venue's primary (till-reroute §3.8)`. Gate, `/finish-branch`.

---

## Slice S4 — till router (branch `feat/till-reroute-s4-router`)

### Task 13: the boot payload types

**Files:**
- Modify: `apps/till/src/api/client.ts:47` (`TillInfo`)
- Test: `apps/till/src/till-app.test.ts` (the shared `till` fixture near line 265 gains `nodeId: "n1", servers: []`)

- [ ] **Step 1:** add to `TillInfo`:

```ts
  /** This node's id, so the app can tell which `servers` entry it is on (till-reroute §3.2). */
  nodeId: string;
  /** The venue's routable servers, primary first — the list the ServerRouter probes (§3.2). */
  servers: TillServer[];
```

and

```ts
export interface TillServer {
  nodeId: string;
  url: string;
  standing: "serving-primary" | "serving-secondary" | "sell-only";
}
```

- [ ] **Step 2:** `pnpm --filter @waitron/till typecheck` shows every fixture missing the fields; add `nodeId: "n1", servers: []` to each. Run `pnpm --filter @waitron/till test till-app` — PASS. Commit `feat(till): TillInfo carries nodeId + servers (till-reroute §3.2)`.

### Task 14: `ServerRouter`

**Files:**
- Create: `apps/till/src/api/server-router.ts`
- Create: `apps/till/src/api/server-router.test.ts`

**Interfaces:**

```ts
export type ServerState = "unknown" | "unreachable" | "standby" | "primary";
export interface ServerEntry { nodeId?: string; url: string }
export interface ServerStatus { url: string; label: string; state: ServerState; term: number | null }
export interface RouterOptions {
  origin: string;                       // the page's own origin — always listed
  fetchImpl: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem">; // default: globalThis.localStorage if present
  intervalMs?: number;                  // default 5_000
  timeoutMs?: number;                   // default 3_000
}
export class ServerRouter extends EventTarget {
  constructor(opts: RouterOptions);
  readonly current: string;             // the target origin
  readonly waiting: boolean;            // last round: nobody accepting sales
  statuses(): ServerStatus[];
  setServers(list: ServerEntry[]): void; // merges the page origin in; persists
  probeNow(): Promise<void>;
  start(): void; stop(): void;
  beginRequest(): void; endRequest(): void;
}
// Events: "server-changed" (CustomEvent<{ from: string; to: string }>), "state-changed" (Event)
export const SERVERS_STORAGE_KEY = "waitron.servers";
```

- [ ] **Step 1: Write the failing tests** (browser mode; `probeNow()` is the unit, the interval is not exercised):

```ts
import { describe, expect, it, vi } from "vitest";
import { SERVERS_STORAGE_KEY, ServerRouter } from "./server-router.js";

const BOX = "https://box.deli.test";
const CLOUD = "https://cloud.deli.test";

type Answer = { acceptingSales: boolean; term: number | null; nodeId: string } | "down";

/** A fetch that answers /api/node per origin from a mutable table; "down" rejects like a dead host. */
function probeFetch(table: Record<string, Answer>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const a = table[url.origin];
    if (a === undefined || a === "down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ...a, standing: null, environment: "preproduction" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("ServerRouter", () => {
  it("starts on the page origin and stays there when a round has no yes anywhere (a blip moves nothing)", async () => {
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ nodeId: "b", url: BOX }, { nodeId: "c", url: CLOUD }]);
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);
    await r.probeNow();
    expect(r.current).toBe(BOX);
    expect(r.waiting).toBe(true);
    expect(moved).not.toHaveBeenCalled();
    expect(r.statuses()).toEqual([
      { url: BOX, label: "box.deli.test", state: "unreachable", term: null },
      { url: CLOUD, label: "cloud.deli.test", state: "standby", term: 1 },
    ]);
  });

  it("moves to the first server that says yes, in the round it says it", async () => {
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    table[CLOUD] = { acceptingSales: true, term: 2, nodeId: "c" };
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    expect(r.waiting).toBe(false);
    expect(moved).toHaveBeenCalledTimes(1);
    expect((moved.mock.calls[0]![0] as CustomEvent).detail).toEqual({ from: BOX, to: CLOUD });
  });

  it("moves back when the box says yes and the cloud says no", async () => {
    const table: Record<string, Answer> = { [BOX]: { acceptingSales: false, term: 3, nodeId: "b" }, [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    table[BOX] = { acceptingSales: true, term: 3, nodeId: "b" };
    table[CLOUD] = { acceptingSales: false, term: 3, nodeId: "c" };
    await r.probeNow();
    expect(r.current).toBe(BOX);
  });

  it("prefers the higher term when two servers both say yes", async () => {
    const table: Record<string, Answer> = { [BOX]: { acceptingSales: true, term: 1, nodeId: "b" }, [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });

  it("does not move while a request is in flight; moves on the next round", async () => {
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    r.beginRequest();
    await r.probeNow();
    expect(r.current).toBe(BOX);
    r.endRequest();
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });

  it("times out a hanging probe as unreachable", async () => {
    const hanging = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    ) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl: hanging, storage: memoryStorage(), timeoutMs: 20 });
    await r.probeNow();
    expect(r.statuses()[0]?.state).toBe("unreachable");
  });

  it("persists the list and reads it back; a throwing storage degrades to the page origin", () => {
    const storage = memoryStorage();
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    r.setServers([{ nodeId: "c", url: CLOUD }]);
    expect(JSON.parse(storage.data.get(SERVERS_STORAGE_KEY)!)).toEqual({ servers: [{ nodeId: "c", url: CLOUD }] });
    const r2 = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    expect(r2.statuses().map((s) => s.url)).toEqual([BOX, CLOUD]);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const r3 = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage: broken });
    expect(r3.statuses().map((s) => s.url)).toEqual([BOX]);
    expect(() => r3.setServers([{ url: CLOUD }])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/till test server-router` → FAIL, module not found. (Serialise with any other browser-mode run.)

- [ ] **Step 3: Implement** `apps/till/src/api/server-router.ts`:

```ts
export type ServerState = "unknown" | "unreachable" | "standby" | "primary";
export interface ServerEntry { nodeId?: string; url: string }
export interface ServerStatus { url: string; label: string; state: ServerState; term: number | null }
export interface RouterOptions {
  origin: string;
  fetchImpl: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
  intervalMs?: number;
  timeoutMs?: number;
}

export const SERVERS_STORAGE_KEY = "waitron.servers";

interface Tracked extends ServerEntry { state: ServerState; term: number | null }

/**
 * The one place the till knows more than one server exists (till-reroute design §4.1). It holds the
 * venue's server list, probes every server each round, and points `current` at whichever answered
 * `acceptingSales: true` — the highest `term` if several. If none did, `current` stays where it is and
 * the till keeps probing: there is no giving up on a server and no failure count (owner, 2026-09-05).
 * The page's own origin is always listed, so a stale or empty cache still reaches the box.
 */
export class ServerRouter extends EventTarget {
  #servers: Tracked[];
  #current: string;
  #waiting = false;
  #inFlight = 0;
  #pendingMove: string | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;

  constructor(opts: RouterOptions) {
    super();
    this.#origin = opts.origin;
    this.#fetch = opts.fetchImpl;
    this.#storage = opts.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    this.#intervalMs = opts.intervalMs ?? 5_000;
    this.#timeoutMs = opts.timeoutMs ?? 3_000;
    this.#current = opts.origin;
    this.#servers = this.#merge(this.#load());
  }

  get current(): string { return this.#current; }
  get waiting(): boolean { return this.#waiting; }

  statuses(): ServerStatus[] {
    return this.#servers.map((s) => ({ url: s.url, label: new URL(s.url).hostname, state: s.state, term: s.term }));
  }

  setServers(list: ServerEntry[]): void {
    this.#servers = this.#merge(list);
    this.#save(list);
    this.dispatchEvent(new Event("state-changed"));
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => void this.probeNow(), this.#intervalMs);
    void this.probeNow();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  beginRequest(): void { this.#inFlight += 1; }
  endRequest(): void { this.#inFlight = Math.max(0, this.#inFlight - 1); }

  /** One probe round over every listed server, then the target rule (§4.1). */
  async probeNow(): Promise<void> {
    await Promise.all(this.#servers.map((s) => this.#probe(s)));
    const yes = this.#servers.filter((s) => s.state === "primary");
    this.#waiting = yes.length === 0;
    if (yes.length > 0) {
      const best = yes.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
      if (best.url !== this.#current) this.#move(best.url);
    }
    this.dispatchEvent(new Event("state-changed"));
  }

  #move(to: string): void {
    if (this.#inFlight > 0) { this.#pendingMove = to; return; }
    const from = this.#current;
    this.#current = to;
    this.#pendingMove = undefined;
    this.dispatchEvent(new CustomEvent("server-changed", { detail: { from, to } }));
  }

  async #probe(s: Tracked): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(`${s.url}/api/node`, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) { s.state = "unreachable"; s.term = null; return; }
      const body = (await res.json()) as { acceptingSales?: unknown; term?: unknown; nodeId?: unknown };
      s.state = body.acceptingSales === true ? "primary" : "standby";
      s.term = typeof body.term === "number" ? body.term : null;
      if (typeof body.nodeId === "string") s.nodeId = body.nodeId;
    } catch {
      s.state = "unreachable";
      s.term = null;
    } finally {
      clearTimeout(timer);
    }
  }

  #merge(list: ServerEntry[]): Tracked[] {
    const byUrl = new Map<string, Tracked>();
    for (const s of this.#servers ?? []) byUrl.set(s.url, s);
    const next: Tracked[] = [];
    const push = (e: ServerEntry) => {
      const url = new URL(e.url).origin;
      if (next.some((n) => n.url === url)) return;
      const prev = byUrl.get(url);
      next.push({ url, nodeId: e.nodeId ?? prev?.nodeId, state: prev?.state ?? "unknown", term: prev?.term ?? null });
    };
    push({ url: this.#origin });
    for (const e of list) { try { push(e); } catch { /* a malformed url is dropped, never fatal */ } }
    return next;
  }

  #load(): ServerEntry[] {
    try {
      const raw = this.#storage?.getItem(SERVERS_STORAGE_KEY);
      if (raw === null || raw === undefined) return [];
      const parsed = JSON.parse(raw) as { servers?: unknown };
      return Array.isArray(parsed.servers) ? (parsed.servers as ServerEntry[]).filter((e) => typeof e?.url === "string") : [];
    } catch {
      return [];
    }
  }

  #save(list: ServerEntry[]): void {
    try {
      this.#storage?.setItem(SERVERS_STORAGE_KEY, JSON.stringify({ servers: list }));
    } catch {
      /* private window / blocked storage: the list lives in memory for this page */
    }
  }
}
```

Note the merge on `setServers` keeps each server's last state, and the page origin is always first. When `#pendingMove` is set and a later round finds `#inFlight === 0`, the target rule recomputes anyway, so `#pendingMove` needs no replay.

- [ ] **Step 4: Run** `pnpm --filter @waitron/till test server-router` — PASS. **Step 5: Commit** `feat(till): ServerRouter — probe every server, follow the one accepting sales (till-reroute §4.1)`.

### Task 15: `withServerTarget`

**Files:** `apps/till/src/api/server-router.ts` (+ tests in `server-router.test.ts`)

**Interfaces:** `export function withServerTarget(fetchImpl: typeof fetch, router: ServerRouter): typeof fetch` — a relative path (`/api/…`, `/media/…`) becomes `router.current + path`; absolute URLs, `URL` and `Request` inputs pass through; wraps the call in `beginRequest`/`endRequest`.

- [ ] **Step 1: Tests**

```ts
describe("withServerTarget", () => {
  it("rewrites a relative path onto the current target and leaves absolute inputs alone", async () => {
    const seen: string[] = [];
    const base = vi.fn(async (input: RequestInfo | URL) => { seen.push(String(input instanceof Request ? input.url : input)); return new Response("{}"); }) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({ [CLOUD]: { acceptingSales: true, term: 1, nodeId: "c" } }), storage: memoryStorage() });
    r.setServers([{ url: CLOUD }]);
    await r.probeNow();
    const f = withServerTarget(base, r);
    await f("/api/till");
    await f("https://elsewhere.test/x");
    await f(new URL("https://elsewhere.test/y"));
    expect(seen).toEqual([`${CLOUD}/api/till`, "https://elsewhere.test/x", "https://elsewhere.test/y"]);
  });

  it("holds a move while a wrapped request is in flight", async () => {
    let release!: () => void;
    const base = vi.fn(() => new Promise<Response>((res) => { release = () => res(new Response("{}")); })) as unknown as typeof fetch;
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: true, term: 1, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: CLOUD }]);
    const pending = withServerTarget(base, r)("/api/sales", { method: "POST" });
    await r.probeNow();
    expect(r.current).toBe(BOX);
    release();
    await pending;
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });
});
```

- [ ] **Step 2: FAIL** (not exported). **Step 3: Implement**

```ts
/** Apply the router as a fetch wrapper (§4.1): the TillApi keeps `baseUrl = ""` and never learns that
 * more than one server exists. Same-origin behaviour is byte-identical until a move happens. */
export function withServerTarget(fetchImpl: typeof fetch, router: ServerRouter): typeof fetch {
  return async (input, init) => {
    const target = typeof input === "string" && input.startsWith("/") ? `${router.current}${input}` : input;
    router.beginRequest();
    try {
      return await fetchImpl(target, init);
    } finally {
      router.endRequest();
    }
  };
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `feat(till): withServerTarget — route relative API paths at the router's current server (till-reroute §4.1)`.

### Task 16: composition in `main.ts`

**Files:** `apps/till/src/main.ts` (excluded from coverage; no test — the S6 contract test and the S5 app tests cover the parts).

- [ ] **Step 1:** replace the fetch composition with:

```ts
const router = new ServerRouter({ origin: location.origin, fetchImpl: fetch });
const fetchImpl = createInstrumentedFetch(withDevDeviceHeader(withServerTarget(fetch, router)), diag);
router.start();
```

and pass `.router=${router}` to `<till-app>` (the `?dev` chooser keeps a plain `new TillApi("", fetchImpl)`). Import `ServerRouter`, `withServerTarget` from `./api/server-router.js`. Update the file's header comment: the router sits BELOW the dev header and the instrumentation so a moved request is logged with its real URL.

- [ ] **Step 2:** `pnpm --filter @waitron/till typecheck` — `router` is not yet a property of `TillApp` → add it in S5's Task 17; for S4, declare the property now in `till-app.ts` (`@property({ attribute: false }) router?: ServerRouter;`) with no behaviour, so the slice typechecks. Commit `feat(till): compose the ServerRouter into the app's fetch chain (till-reroute §4.1)`. Gate (`pnpm --filter @waitron/till test:coverage`), `/finish-branch`.

---

## Slice S5 — till behaviour (branch `feat/till-reroute-s5-behaviour`)

### Task 17: react to a move

**Files:**
- Modify: `apps/till/src/till-app.ts` (`connectedCallback`/`disconnectedCallback`, `#boot`, a new `#onServerChanged`)
- Test: `apps/till/src/till-app.test.ts`

**Interfaces:**
- Consumes: `ServerRouter` events; `TillInfo.servers`.

- [ ] **Step 1: Write the failing tests** (mount with a router built on a stub fetch, as in Task 14; the app test's `mountWidget("till-app", { api, router })`):

```ts
it("on server-changed: drops the operator, locks with server.switched, and re-boots against the new target", async () => {
  const router = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage: memoryStorage() });
  const api = stubApi(); // getTill resolves the shared `till` fixture; getDeviceIdentity rejects
  const app = await mountApp(api, router);
  await loginAs(app, "Ana"); // the suite's existing login helper
  expect(app.operatorPersonId).not.toBe("");
  router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }));
  await flush(app);
  expect(app.screen).toBe("lock");
  expect(app.operatorPersonId).toBe("");
  expect(app.shadowRoot!.textContent).toContain(t("server.switched"));
  expect(api.getTill).toHaveBeenCalledTimes(2);
});

it("feeds the boot payload's servers to the router", async () => {
  const router = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage: memoryStorage() });
  const setServers = vi.spyOn(router, "setServers");
  const api = stubApi({ getTill: vi.fn().mockResolvedValue({ ...till, servers: [{ nodeId: "c", url: CLOUD, standing: "serving-secondary" }] }) });
  await mountApp(api, router);
  expect(setServers).toHaveBeenCalledWith([{ nodeId: "c", url: CLOUD, standing: "serving-secondary" }]);
});
```

- [ ] **Step 2: FAIL.** **Step 3: Implement** in `till-app.ts`:

```ts
  @property({ attribute: false }) router?: ServerRouter;

  readonly #onServerChanged = (event: Event): void => {
    const { to } = (event as CustomEvent<{ from: string; to: string }>).detail;
    diag.nav("server.switched", { to });
    // The login session was a row on the server we just left (till-reroute §4.3): drop the operator
    // locally, lock, say why, and re-run the boot against the new target. The working order stays in
    // memory — the held-orders list on the new server shows its replicated state.
    this.operatorPersonId = "";
    this.operatorName = "";
    this.canEdit = false;
    this.errorKey = "server.switched";
    this.#setScreen("lock");
    void this.#boot();
  };
  readonly #onServerState = (): void => this.requestUpdate();

  override connectedCallback(): void {
    super.connectedCallback();
    this.router?.addEventListener("server-changed", this.#onServerChanged);
    this.router?.addEventListener("state-changed", this.#onServerState);
  }

  override disconnectedCallback(): void {
    this.router?.removeEventListener("server-changed", this.#onServerChanged);
    this.router?.removeEventListener("state-changed", this.#onServerState);
    super.disconnectedCallback();
  }
```

(If `diag.nav` is not the trail's method name, use the one `till-app` already calls for navigation.) In `#boot`, after `const till = await this.api.getTill();` and the `isConnected` guard: `this.router?.setServers(till.servers);`. Because `router` is set by property AFTER `connectedCallback` in `mountWidget`, also subscribe in `willUpdate` when `router` changes (`changed.has("router")`): remove from the old, add to the new.

- [ ] **Step 4: PASS. Step 5: Commit** `feat(till): follow a server move — lock for a PIN and re-boot (till-reroute §4.3)`.

### Task 18: `sale.unconfirmed`

**Files:**
- Modify: `apps/till/src/api/client.ts` (export `isNetworkFailure`)
- Modify: `apps/till/src/till-app.ts` (`#onPay` at line ~868, `#onPayTab` at ~1873, the `pay` path at ~923, `#onPlace` at ~1035)
- Test: `apps/till/src/api/client.test.ts`, `apps/till/src/till-app.test.ts`

- [ ] **Step 1: Tests**

`client.test.ts`:

```ts
describe("isNetworkFailure", () => {
  it("is true for a fetch TypeError or an AbortError, false for a server {code}", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isNetworkFailure({ code: "sale.empty_basket" })).toBe(false);
    expect(isNetworkFailure(new Error("x"))).toBe(false);
  });
});
```

`till-app.test.ts`, beside the existing "sale.error" test:

```ts
it("shows sale.unconfirmed, basket kept, when the sale request got no answer", async () => {
  const api = stubApi({ recordSale: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
  const app = await mountApp(api);
  await loginAs(app, "Ana");
  await addLineAndPay(app); // the suite's existing counter helpers
  expect(app.shadowRoot!.textContent).toContain(t("sale.unconfirmed"));
  expect(app.screen).toBe("counter");
  expect(counterLines(app)).toHaveLength(1);
});
```

- [ ] **Step 2: FAIL. Step 3: Implement**

`client.ts`:

```ts
/**
 * Whether a rejected request never reached a server (till-reroute §4.3): `fetch` rejects with a
 * TypeError when the host is unreachable and with an AbortError on a timeout; a server that answered
 * rejects through `#request` as a `{ code }`. The distinction decides `sale.unconfirmed` (a human must
 * check before retrying) versus `sale.error` (the server refused; retry freely).
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
}
```

In each of the four catch blocks: `this.errorKey = isNetworkFailure(err) ? "sale.unconfirmed" : "sale.error";` (`place.error` keeps its own key for the server-refused case: `isNetworkFailure(err) ? "sale.unconfirmed" : "place.error"`).

- [ ] **Step 4: PASS. Step 5: Commit** `feat(till): sale.unconfirmed when the sale request got no answer (till-reroute §4.3)`.

### Task 19: the status line and "check again"

**Files:**
- Modify: `apps/till/src/screens/till-lock-screen.ts` (props `serverStatuses: ServerStatus[]`, `serverWaiting: boolean`; a `check-again` event; the line rendered under the roster in `#renderList`)
- Modify: `apps/till/src/till-app.ts` (pass `.serverStatuses=${this.router?.statuses() ?? []} .serverWaiting=${this.router?.waiting ?? false} @check-again=${() => void this.router?.probeNow()}` to `<till-lock-screen>`; a compact `role="status"` banner in the shell header while `router?.waiting`)
- Test: `apps/till/src/screens/till-lock-screen.test.ts`, `till-lock-screen.a11y.test.ts`, `apps/till/src/till-app.test.ts`

- [ ] **Step 1: Tests**

```ts
it("renders one row per server with its state, and a check-again button", async () => {
  const el = await mountWidget<TillLockScreen>("till-lock-screen", {
    api: stubApi(),
    serverStatuses: [
      { url: "https://box.deli.test", label: "box.deli.test", state: "unreachable", term: null },
      { url: "https://cloud.deli.test", label: "cloud.deli.test", state: "standby", term: 2 },
    ],
    serverWaiting: true,
  });
  await flush(el);
  const line = el.shadowRoot!.querySelector("[data-server-status]")!.textContent!;
  expect(line).toContain("box.deli.test");
  expect(line).toContain(t("server.unreachable"));
  expect(line).toContain("cloud.deli.test");
  expect(line).toContain(t("server.standby"));
  expect(line).toContain(t("server.waiting_promotion"));
  const again = vi.fn();
  el.addEventListener("check-again", again);
  (el.shadowRoot!.querySelector("[data-check-again]") as HTMLElement).click();
  expect(again).toHaveBeenCalledTimes(1);
});

it("renders nothing when only the page's own server is known and it is primary", async () => {
  const el = await mountWidget<TillLockScreen>("till-lock-screen", {
    api: stubApi(),
    serverStatuses: [{ url: "https://box.deli.test", label: "box.deli.test", state: "primary", term: 1 }],
    serverWaiting: false,
  });
  await flush(el);
  expect(el.shadowRoot!.querySelector("[data-server-status]")).toBeNull();
});
```

Add the two-row case to the a11y suite (axe passes with the `role="status"` line).

- [ ] **Step 2: FAIL. Step 3: Implement** in the lock screen:

```ts
  @property({ attribute: false }) serverStatuses: ServerStatus[] = [];
  @property({ type: Boolean }) serverWaiting = false;

  #renderServers() {
    const known = this.serverStatuses;
    if (known.length <= 1 && !this.serverWaiting && known[0]?.state === "primary") return nothing;
    const row = (s: ServerStatus) => `${s.label}: ${t(`server.${s.state}` as StringKey)}`;
    return html`
      <p class="status" role="status" data-server-status>
        ${known.map(row).join(" · ")}${this.serverWaiting ? html` — ${t("server.waiting_promotion")}` : nothing}
        <wt-button variant="secondary" data-check-again @click=${() => this.dispatchEvent(new CustomEvent("check-again"))}>
          ${t("server.check_again")}
        </wt-button>
      </p>
    `;
  }
```

rendered at the end of `#renderList`. In `till-app.ts` the shell header gets, while `this.router?.waiting`: `<p class="banner" role="status">${t("server.waiting_promotion")}</p>`.

- [ ] **Step 4: PASS** (`pnpm --filter @waitron/till test till-lock-screen till-app`). **Step 5: Commit** `feat(till): server status line + check again on the lock screen (till-reroute §4.4)`.

### Task 20: i18n keys

**Files:** `apps/till/src/i18n/strings.ts` (both maps; `es` is `Record<StringKey, string>`, so a missing Spanish sibling is a compile error).

- [ ] **Step 1:** add to `en`:

```ts
  // Server status (till-reroute §4.4)
  "server.unknown": "checking",
  "server.unreachable": "unreachable",
  "server.standby": "standby, not promoted",
  "server.primary": "accepting sales",
  "server.waiting_promotion": "Local server unreachable — waiting for the standby to be promoted",
  "server.check_again": "Check again",
  "server.switched": "Moved to another server. Enter your PIN.",
  "sale.unconfirmed": "The server did not answer. Check whether the sale went through before trying again.",
```

and to `es`:

```ts
  "server.unknown": "comprobando",
  "server.unreachable": "sin conexión",
  "server.standby": "en espera, sin promover",
  "server.primary": "aceptando ventas",
  "server.waiting_promotion": "Servidor local sin conexión — esperando a que se promueva el de reserva",
  "server.check_again": "Comprobar de nuevo",
  "server.switched": "Cambiado a otro servidor. Introduce tu PIN.",
  "sale.unconfirmed": "El servidor no respondió. Comprueba si la venta se registró antes de reintentar.",
```

- [ ] **Step 2:** `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till test:coverage` — PASS. Commit `feat(till): server status + unconfirmed-sale strings, en + es`. Gate, `/finish-branch`. (Tasks 17–19 will not compile until this task's keys exist — do Task 20 FIRST within S5, or in the same commit as Task 17.)

---

## Slice S6 — the two-process contract proof (branch `feat/till-reroute-s6-e2e`)

### Task 21: `till-reroute-e2e.rls.test.ts`

**Files:**
- Create: `apps/server/src/till-reroute-e2e.rls.test.ts` (real Postgres; copy the container/template scaffolding of `boot.mirror.rls.test.ts` — its env constants, `startServer`, `freePort`, `poll`, the `mirror`-stamped clone — and the device fixture of `device-session.test.ts:81-95`)
- Create: `apps/till/src/api/server-router.contract.test.ts` — feeds the router the SAME JSON bodies this e2e asserts, so the two sides are pinned to one contract

- [ ] **Step 1: Write the e2e** (state the failing case before each step, in comments):

```ts
describe("till reroute — two processes, one venue", () => {
  it("A primary, B standby; A dies; B promoted; a till-shaped client follows with a PIN re-prompt and sees the inherited tab", async () => {
    // Both databases carry the same device row (seeded directly — replication of `devices` is Track
    // A's) and the same person (persons already replicate).
    const a = await startServer(envFor("primary", dbA, portA));
    const b = await startServer(envFor("mirror", dbB, portB));
    try {
      // 1. Probes. FAILING CASE: a live `mode` read would make B answer true after the flip below.
      expect(await probe(portA)).toMatchObject({ acceptingSales: true });
      expect(await probe(portB)).toMatchObject({ acceptingSales: false });

      // 2. The device cookie authenticates on A; B refuses a login (read-only gate) — the "waiting" row.
      const jar = await pairOn(portA); // POST /api/device/enrol → the Set-Cookie value
      expect((await get(portA, "/api/device/me", jar)).status).toBe(200);
      const refused = await post(portB, "/api/session", { personId, pin: "5555" }, jar);
      expect(refused.status).toBe(403);
      expect((await refused.json()).error.code).toBe("node.read_only");

      // 3. A opens a tab, then dies. Seed the same open order into B's DB tagged with A's node id — the
      // state a replicated tab would be in (swap spec §4.3). FAILING CASE: with node-scoped reads B
      // would list nothing after promotion.
      await post(portA, "/api/working-orders", { id: tabId, lines: [{ productId, quantity: "1" }] }, jar, sessionOnA);
      await seedOpenOrder(dbB, { id: tabId, nodeId: NODE_A });
      await a.close();
      await expect(probe(portA)).rejects.toThrow();

      // 4. Promote B: the deployment flip a human's promote performs (item 3 builds the endpoint), then
      // restart — acceptingSales is boot-captured. FAILING CASE: the un-restarted B still answers false.
      expect(await probe(portB)).toMatchObject({ acceptingSales: false });
      await setDeploymentMode(dbB, "primary");
      await setSingletonRole(dbB, "primary");
      await b.close();
      const b2 = await startServer(envFor("primary", dbB, portB));
      try {
        expect(await probe(portB)).toMatchObject({ acceptingSales: true });
        // 5. The till re-logs-in on B with the SAME device cookie and sees A's tab.
        const login = await post(portB, "/api/session", { personId, pin: "5555" }, jar);
        expect(login.status).toBe(200);
        const held = await get(portB, "/api/working-orders", jar, cookieOf(login));
        expect((await held.json()).map((o: { id: string }) => o.id)).toContain(tabId);
      } finally {
        await b2.close();
      }
    } finally {
      await a.close().catch(() => undefined);
    }
  });
});
```

Write `probe`, `get`, `post`, `pairOn`, `seedOpenOrder`, `envFor`, `cookieOf` as small local helpers on `fetch` + `sql` (the suite owns them; no shared harness change). Save each `/api/node` body to `apps/till/src/api/__fixtures__/node-probe.json` (an array of the four bodies observed at steps 1 and 4) — the contract file.

- [ ] **Step 2: The contract test on the till side** reads that JSON and drives `ServerRouter` through the same four rounds (A primary/B standby → A down/B standby → A down/B primary), asserting `current` and `waiting` at each; its failing case is a router that moves on the standby answer.

- [ ] **Step 3: Run** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test till-reroute-e2e` and `pnpm --filter @waitron/till test server-router.contract` — PASS; then both packages' `test:coverage`, the gate, `/finish-branch`.

### Task 22: landing notes

**Files:** `docs/backlog.md` (Track B item 1 → LANDED with the six PR numbers; item 2's proof still pending; the "decisions first" line unchanged), `docs/superpowers/specs/2026-09-05-till-reroute-design.md` (a dated "Built" line at the top naming the PRs and the same-site receipt's PR), `docs/superpowers/specs/2026-09-05-till-reroute-route-decision.md` (§5 pointer: replication requirement still open until Track A's S2), `docs/ui-review.md` (area 19 note unchanged; the lock screen's status line is not a Track 1 correction).

- [ ] **Step 1:** make the edits in the S6 branch (docs ride the code PR here because the spec's "Built" line must land with the code). Commit `docs: till reroute landed — backlog + spec pointers`.

---

## Self-review (done while writing; kept as the reader's checklist)

- **Spec coverage:** §3.1 → T5; §3.2 → T6, T13; §3.3 → T1–T4; §3.4 → T7, T8, T10; §3.5 → T9; §3.6 → T11; §3.7 → unchanged, asserted in T21 step 2; §3.8 → T12; §4.1 → T14–T16; §4.2 → T17 (`#boot` order is unchanged because the router owns the target; the "own origin first" rule is the router's constructor default); §4.3 → T17, T18; §4.4 → T19, T20; §5 rows → T14 tests + T21; §6 → each task's test block; §7 → the six slice headings; §8 → the Global Constraints "do not touch" line and T21's seeding note.
- **Type consistency:** `NodeProbe` (T5) is what `ServerRouter.#probe` (T14) reads (`acceptingSales`, `term`, `nodeId`); `TillServer` (T13) is what `setServers` (T14) accepts (`ServerEntry` is its structural subset); `ServerStatus` (T14) is what the lock screen renders (T19); `readMembership` has one signature in T5, T6, T7.
- **Placeholders:** the two helper-name substitutions in T2 and T4 point at the test file's own existing helpers rather than inventing names; everything else is written out.
