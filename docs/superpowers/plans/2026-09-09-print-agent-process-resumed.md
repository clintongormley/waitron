# Print Agent Process (resumed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the standalone print-agent process — the wire client's join/status/pull/report half, the poll loop behind a `Host` seam, the server-side enrolment rebuilt to CONSUME the shared `join_requests` mechanism the device slice (#287) landed, the dashboard's second consumer, a container host, and an end-to-end test — so a venue with the agent running and one IP printer prints kitchen tickets and receipts end to end.

**Architecture:** The db-free `@waitron/print-agent` package (foundation landed in #282: transports, `probeNode`, the follow-the-primary `Router`) gains `join`/`joinStatus`/`pullJobs`/`report` on the wire client and a `Host`-seam poll loop. Enrolment is **join-and-accept over the shared `join_requests` table** — the print agent is a SECOND consumer of the mechanism #287 built for devices: it reuses `createJoinRequest`, `listPendingJoinRequests`, `challengeFor`, `denyJoinRequest`, the pairing window, the shared list/challenge/deny/pairing-mode routes, and the shared `device.*` join error codes; it ADDS only its own accept verb (`acceptPrintAgentJoinRequest`), a status resolver (`readAgentJoinStatus`), an agent knock + status route, an agent accept route, and the printers-screen UI. The old per-agent pairing-code path (`print_agent_pairing_codes`, `generateAgentCode`, `enrolAgent`, `POST /print-api/agent/enrol`, `POST /management-api/print-agents/codes`) is retired.

**Tech Stack:** TypeScript (ESM, Node 24), Hono, Drizzle, Vitest (PGlite + real Postgres via `@waitron/db/testing`), esbuild, Lit (dashboard).

**Specs:**
- `docs/superpowers/specs/2026-09-08-print-agent-process-design.md` (the base design)
- `docs/superpowers/specs/2026-09-08-device-join-and-accept-design.md` §7 (the amendment that this plan implements — it supersedes the base design's §2.3)

**Supersedes:** `docs/superpowers/plans/2026-09-08-print-agent-process.md` Tasks 2 (join half), 4, 5, 6, 7, 8, 10, 11. Those tasks add `approved_at`/`join_code` columns to `print_agents` and make `join` insert a pending `print_agents` row — the pre-amendment design. Do not execute them. Tasks 1 and 3 of that plan (the package scaffold, the transport move, the router) LANDED in #282 and are unchanged.

## What already exists — reuse unchanged, do not rebuild

From #287 (`apps/server/src/join-requests.ts`, `packages/db/src/schema/join-requests.ts`, `apps/server/src/join-api.ts`, `apps/dashboard/src/screens/devices-screen.ts`, `apps/dashboard/src/api/client.ts`):

- The `join_requests` table (`kind` pgEnum already has `"print_agent"`), classified `local`, with grants `SELECT, INSERT, DELETE ON join_requests TO app_user` (no UPDATE).
- `createJoinRequest(tx, cfg, { kind, label, numbers? }) → { joinId, verificationNumber, token }` — pass `kind: "print_agent"` and it works unchanged. Takes a per-tenant advisory lock, sweeps lapsed, enforces the `(tenant, kind)` cap (`PENDING_CAP = 10`, throws `device.join_full`), mints the real number + two decoys under the cross-surface exclusion, mints `token = randomBytes(32).base64url`, stores `hashSecret(token)`.
- `listPendingJoinRequests(tx, cfg, kind)`, `challengeFor(tx, cfg, id)`, `joinRequestKind(tx, cfg, id)`, `denyJoinRequest(tx, cfg, id)` — all kind-agnostic, already serve `print_agent`.
- The shared routes in `mountJoinApi`: `GET /management-api/join-requests?kind=`, `GET …/:id/challenge`, `POST …/:id/deny`, and `GET/POST/DELETE /management-api/pairing-mode`. The permission map already holds `print_agent → "printer.manage"`.
- `authenticateAgent(tx, cfg, token)` (`packages/printing/src/agent.ts`) — the Bearer verify (`${agentId}.${secret}` split, UUID screen, `verifySecret` against `print_agents.token_hash`, `active = true`, throttled `last_seen_at`). **Unchanged.**
- `requireAgent` (`apps/server/src/print-agent-session.ts`) — the Bearer guard. **Unchanged.**
- The client methods `joinRequests(kind)`, `joinChallenge(id)`, `denyJoinRequest(id)`, `pairingMode()`, `openPairingMode()`, `closePairingMode()` (`apps/dashboard/src/api/client.ts`). **Unchanged.**
- The shared join error codes, already declared in `apps/server/src/errors.ts:1104-1124` and mapped in the mounts: `device.pairing_closed` (403), `device.join_full` (429), `device.join_rate_limited` (429), `device.join_mismatch` (400). The agent flow reuses these — the `device.` prefix is the shared mechanism's shipped name (codes are never renamed — CLAUDE.md §3), not a surface claim; the agent client reads the HTTP STATUS, never the code string.

## Global Constraints

- Branch `feat/print-agent-process` in the worktree at `/Users/clintongormley/workspace/worktrees/waitron-feat-print-agent-process` (already created). Every commit `git commit -s`.
- `@waitron/print-agent` has **no workspace dependencies** and never imports `@waitron/db` or `@waitron/printing` (base spec §2.1). The `import-x/no-restricted-paths` zone in `eslint.config.js` enforces this — an empty `dependencies` block does not.
- Every `verify` step runs `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test:coverage` and `pnpm format:check` (root). Coverage floors: `90/90/85/85` for `@waitron/print-agent`, `apps/print-agent`, `packages/printing` and `apps/server`; `98/98/98/95` for `packages/db`. `packages/printing` is NOT one of the six high-bar packages (`packages/printing/vitest.config.ts`).
- Error codes name the DOMAIN CONCEPT (CLAUDE.md §3). This flow ADDS no error codes — it reuses the shared `device.*` join codes and `agent.unauthorized`, and DELETES `agent.pairing_invalid` / `agent.pairing_expired` / `agent.pairing_rate_limited` (nothing is shipped; the commit says so, no deprecation sibling).
- No SQL by string concatenation (Drizzle `sql` tags / query builder only). **Every read scopes to `cfg.tenantId` explicitly, by-id reads included** (CLAUDE.md §3) — the till-reroute S3 receipt: a by-id read keyed on a UUID alone let one tenant read another's row. Real-PG two-tenant probes as `app_user` (`rolsuper = f`), not reasoning, are what catch this class.
- Pre-production: the schema change is a regenerated core migration, no backfill; drop and recreate (CLAUDE.md §3). Never widen a grant to pass a test (`app_user` holds no DELETE on `print_agents`; the deny path deletes a `join_requests` row, where `app_user` DOES hold DELETE).
- Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` and Docker; run `pnpm reap` first if a previous run was interrupted (CLAUDE.md §4). Chromium browser suites are not touched here.
- Comments state the invariant and the non-obvious why, never the history (CLAUDE.md §1); thin on touch, no sweeps.

## Decisions this plan makes (fill-ins the amendment left to the plan) — flag for review

1. **Token format.** The agent knock returns the bearer `${joinId}.${secret}` in the body. FORCED: `authenticateAgent` splits on the first `.` and treats the head as the `print_agents.id`, and accept carries the request's `id` into `print_agents.id`, so one token authenticates the status poll (while pending, via `readAgentJoinStatus`) AND the job pull (once approved, via `authenticateAgent`) — the device cookie trick, for a headless process.
2. **A dedicated agent status route.** `GET /print-api/agent/join/status` (Bearer) → `pending | approved | not_approved`. FORCED by retiring `agent.pending`: with pending rows in `join_requests` (not `print_agents`), a pull with a not-yet-approved token would `agent.unauthorized` (401), which the loop treats as revoked → halt. The loop must therefore learn approval from a status poll, exactly as a device does, before it ever pulls.
3. **Reuse `device.join_mismatch` for the agent accept.** The mismatch is the identical domain concept and the code is already declared, 400-mapped, and carries a surface-neutral dashboard message. Inventing `agent.join_mismatch` for the same concept would give one concept two homes. Documented at the throw site.
4. **The verification number is held in the loop's memory, not persisted** (base spec §2.1 seam is `token()/saveToken()`, and `AgentStatus.verificationCode` is rendered from memory). A restart WHILE pending keeps the token (so no orphan row) but loses the number, so the status page shows "waiting for approval" without a number until the admin denies and the operator restarts. Persisting it is a seam change deferred out of this slice; noted in the status-page copy.
5. **A new `pairing_closed` agent phase.** The amendment (§7.2) requires the status page to say "Ask the manager to switch on pairing mode" — distinct from denied — so the loop needs a phase for a window-shut join, and retries with backoff rather than halting.
6. **No dev auto-accept for the agent knock** (device dev-mode auto-accept, spec §8, is not mirrored). In dev, pairing mode is held permanently open, so an agent knock succeeds and waits for a dashboard accept; there is no agent auto-running in the dev compose yet (that is Track P). Deferred, noted.
7. **A pairing-mode control on the printers screen too.** The window is venue-wide (one holder), but an admin setting up a printer is on the printers screen; it reads/writes the same holder as the devices screen. Mirrors the devices-screen control.

---

## File map

| Path | Responsibility | Task |
| --- | --- | --- |
| `packages/print-agent/src/client.ts` (+ `.test.ts`) | add `join`, `joinStatus`, `pullJobs`, `report`; generalise `foldFetch` for POST+Bearer; widen `Failure` with `rate_limited`/`pairing_closed`; add wire types | 1 |
| `packages/print-agent/src/index.ts` | export the new client types/values | 1, 2 |
| `packages/print-agent/src/host.ts` | the `Host` seam, `AgentConfig`, `AgentStatus`, `AgentPhase`, `HostLog` | 2 |
| `packages/print-agent/src/agent.ts` (+ `.test.ts`) | `createAgent`: `runOnce`, `start`, `stop`, the status-poll loop | 2 |
| `packages/print-agent/src/testing/fake-host.ts` | the in-memory `Host` for the loop suite and the e2e | 2 |
| `packages/print-agent/package.json` | the `./testing/fake-host.js` subpath export | 2 |
| `packages/db/src/schema/print-agents.ts`, `src/index.ts`, `src/classification.ts`, `drizzle/00NN_*` | drop `print_agent_pairing_codes` (table, export, classification, grant) | 3 |
| `packages/fiscal-verifactu/src/privileges.expected.ts`, `packages/printing/src/testing/global-setup.ts` | retire the pairing-table receipts | 3 |
| `packages/printing/src/agent.ts`, `errors.ts`, `index.ts` (+ tests) | delete `generateAgentCode`/`enrolAgent`/`PAIRING_*`; delete the three `agent.pairing_*` codes; keep `authenticateAgent` | 4 |
| `apps/server/src/join-requests.ts` (+ `.pg.test.ts`) | add `acceptPrintAgentJoinRequest`, `readAgentJoinStatus` | 5 |
| `apps/server/src/print-api.ts` (+ tests), `enrol-rate-limit.ts`, `boot.ts` | the agent knock + status routes; `servers`+`nodeId` on the pull; `pairingMode`+`readMembership` deps; retire enrol/codes routes | 6 |
| `apps/server/src/join-api.ts` (+ tests) | the agent accept route | 6 |
| `apps/dashboard/src/api/client.ts`, `screens/printers-screen.ts`, `i18n/strings.ts`, `i18n/codes.ts` (+ tests) | the pending-agents list + Accept/Deny + pairing control; retire the generate-code UI | 7 |
| `apps/print-agent/*` | the container host: `config.ts`, `state.ts`, `setup-page.ts`, `host.ts`, `bin.ts`, `Dockerfile` | 8 |
| `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `scripts/english-only.test.ts` | register the new `apps/print-agent` workspace member | 8 |
| `apps/server/src/print-agent-e2e.test.ts` | open window → knock → list (number absent) → challenge → accept → status approved → pull → bytes → done; then revoke → unauthorized | 9 |
| `docs/backlog.md`, the two specs' status lines | landing notes | 10 |

Task dependencies: 1→2; 3→4→5→6; 6 needs 5; 7 needs 6; 8 needs 2; 9 needs 2 and 6; 10 last. Tasks 1–2 and 3–6 are two independent chains until 9.

---

### Task 1: Wire client — `join`, `joinStatus`, `pullJobs`, `report`

**Files:**
- Modify: `packages/print-agent/src/client.ts`, `packages/print-agent/src/client.test.ts`, `packages/print-agent/src/index.ts`

**Interfaces:**
- Consumes: the landed `foldFetch`, `Failure`, `Result`, `NodeProbe`, `ServerEntry`, `probeNode` in `client.ts`; `PrintTransport` from `./transport.js`.
- Produces (added to `@waitron/print-agent`):

```ts
export type JoinStatus = "pending" | "approved" | "not_approved";
export interface JoinReply { token: string; verificationNumber: string }
export interface WireJob { id: string; printerId: string; transport: PrintTransport; host: string | null; port: number | null; usbPath: string | null; payload: Uint8Array }
export interface PullReply { nodeId: string; servers: ServerEntry[]; jobs: WireJob[] }
export type JobOutcome = { status: "done" } | { status: "failed"; error: string };
export type Failure =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized" }
  | { kind: "rate_limited" }       // 429 — window flood OR pending cap; both mean back off
  | { kind: "pairing_closed" }     // 403 — the venue's pairing window is shut
  | { kind: "bad_reply"; detail: string };
export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
  join(url: string, name: string): Promise<Result<JoinReply>>;
  joinStatus(url: string, token: string): Promise<Result<JoinStatus>>;
  pullJobs(url: string, token: string): Promise<Result<PullReply>>;
  report(url: string, token: string, jobId: string, outcome: JobOutcome): Promise<Result<void>>;
}
```

- [ ] **Step 1: Write the failing tests**

Extend `packages/print-agent/src/client.test.ts`. Keep the existing `probeNode` describes. Add a small helper at the top if not present:

```ts
function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}
```

Add:

```ts
describe("createClient — join", () => {
  it("POSTs { name } to /print-api/agent/join and returns { token, verificationNumber }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(201, { token: "a1.secret", verificationNumber: "07" }));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.join(URL_A, "kitchen-pi")).toEqual({ ok: true, value: { token: "a1.secret", verificationNumber: "07" } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/join`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "kitchen-pi" });
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("maps 403 → pairing_closed and 429 → rate_limited", async () => {
    const closed = createClient({ fetch: vi.fn().mockResolvedValue(reply(403, { code: "device.pairing_closed" })) });
    expect(await closed.join(URL_A, "x")).toEqual({ ok: false, failure: { kind: "pairing_closed" } });
    const limited = createClient({ fetch: vi.fn().mockResolvedValue(reply(429, { code: "device.join_rate_limited" })) });
    expect(await limited.join(URL_A, "x")).toEqual({ ok: false, failure: { kind: "rate_limited" } });
  });

  it("a body missing verificationNumber is bad_reply", async () => {
    const client = createClient({ fetch: vi.fn().mockResolvedValue(reply(201, { token: "a1.secret" })) });
    expect(await client.join(URL_A, "x")).toMatchObject({ ok: false, failure: { kind: "bad_reply" } });
  });
});

describe("createClient — joinStatus", () => {
  it("sends the Bearer and decodes the status string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { status: "approved" }));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.joinStatus(URL_A, "a1.secret")).toEqual({ ok: true, value: "approved" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/join/status`);
    expect(init.headers.authorization).toBe("Bearer a1.secret");
  });

  it("an unknown status string is bad_reply", async () => {
    const client = createClient({ fetch: vi.fn().mockResolvedValue(reply(200, { status: "weird" })) });
    expect(await client.joinStatus(URL_A, "t")).toMatchObject({ ok: false, failure: { kind: "bad_reply" } });
  });
});

describe("createClient — pullJobs", () => {
  it("sends the Bearer, decodes base64 payloads, returns servers + nodeId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, {
      nodeId: "n1",
      servers: [{ nodeId: "n1", url: "http://a.test", standing: "serving-primary" }],
      jobs: [{ id: "j1", printerId: "p1", transport: "network_tcp", host: "10.0.0.9", port: 9100, usbPath: null, payload: Buffer.from([1, 2, 3]).toString("base64") }],
    }));
    const client = createClient({ fetch: fetchImpl });
    const result = await client.pullJobs(URL_A, "a1.secret");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodeId).toBe("n1");
    expect(result.value.servers).toEqual([{ url: "http://a.test", nodeId: "n1" }]);
    expect(result.value.jobs[0]!.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${URL_A}/print-api/agent/jobs`);
    expect(fetchImpl.mock.calls[0]![1].headers.authorization).toBe("Bearer a1.secret");
  });

  it("401 → unauthorized; a reply whose jobs is not an array is bad_reply", async () => {
    const unauth = createClient({ fetch: vi.fn().mockResolvedValue(reply(401, { code: "agent.unauthorized" })) });
    expect(await unauth.pullJobs(URL_A, "t")).toEqual({ ok: false, failure: { kind: "unauthorized" } });
    const bad = createClient({ fetch: vi.fn().mockResolvedValue(reply(200, { nodeId: "n1", servers: [], jobs: "no" })) });
    expect(await bad.pullJobs(URL_A, "t")).toMatchObject({ ok: false, failure: { kind: "bad_reply" } });
  });
});

describe("createClient — report", () => {
  it("POSTs the outcome to the job's result route and resolves on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(204));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.report(URL_A, "t", "j1", { status: "failed", error: "boom" })).toEqual({ ok: true, value: undefined });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/jobs/j1/result`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ status: "failed", error: "boom" });
    expect(init.headers.authorization).toBe("Bearer t");
  });

  it("a thrown fetch on report is unreachable (so the loop drops it, the lease reclaims)", async () => {
    const client = createClient({ fetch: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });
    expect(await client.report(URL_A, "t", "j1", { status: "done" })).toMatchObject({ ok: false, failure: { kind: "unreachable" } });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/print-agent test -- client`
Expected: FAIL — `client.join is not a function`.

- [ ] **Step 3: Generalise `foldFetch` and add the four calls**

In `client.ts`, first widen the `Failure` union to the shape in **Interfaces** above (add `rate_limited`, `pairing_closed`; delete the JSDoc line that promised `pending`/`full`). Add the wire types (`JoinStatus`, `JoinReply`, `WireJob`, `PullReply`, `JobOutcome`) above `AgentClient`, and widen `AgentClient` to the four new methods.

Generalise `foldFetch` to take a request init and to fold the two new statuses. Replace its signature and status folding:

```ts
async function foldFetch<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  parseOk: (response: Response) => Promise<T | undefined>,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...init.headers },
      body: init.body,
      signal: controller.signal,
    });
    if (response.status === 401) return { ok: false, failure: { kind: "unauthorized" } };
    if (response.status === 403) return { ok: false, failure: { kind: "pairing_closed" } };
    if (response.status === 429) return { ok: false, failure: { kind: "rate_limited" } };
    if (response.status >= 500) return { ok: false, failure: { kind: "unreachable", detail: `status ${response.status}` } };
    if (!response.ok) return { ok: false, failure: { kind: "bad_reply", detail: `status ${response.status}` } };
    const value = await parseOk(response);
    if (value === undefined) return { ok: false, failure: { kind: "bad_reply", detail: "invalid response body" } };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, failure: { kind: "unreachable", detail: describeRejection(error) } };
  } finally {
    clearTimeout(timer);
  }
}
```

Update the `probeNode` caller to pass the new `init` arg: `foldFetch(opts.fetch, \`${url}/api/node\`, timeoutMs, {}, parseNodeProbe)`. Note this now folds a 403/429 on `/api/node` to `pairing_closed`/`rate_limited` instead of `bad_reply` — harmless (the `Router` treats every `!ok` probe as `unreachable`, `router.ts:134`), but grep the existing `probeNode` tests and adjust any case that asserted a 403/429 → `bad_reply` (none is expected on a node probe).

Add a small JSON reader and the four methods inside `createClient`'s returned object:

```ts
async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : undefined;
}

function parseVoid(): Promise<undefined | true> {
  // 204 has no body; any 2xx is success. Return a non-undefined sentinel so foldFetch treats it as ok.
  return Promise.resolve(true);
}
```

(For `report`, wrap with a `parseOk` that returns `true` so `foldFetch`'s `undefined`-means-bad check is satisfied, then the method maps `true → undefined`.)

The methods:

```ts
    join(url, name) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/join`,
        timeoutMs,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
        async (response) => {
          const b = await readJson(response);
          if (b === undefined || typeof b.token !== "string" || typeof b.verificationNumber !== "string") return undefined;
          return { token: b.token, verificationNumber: b.verificationNumber };
        },
      );
    },
    joinStatus(url, token) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/join/status`,
        timeoutMs,
        { headers: { authorization: `Bearer ${token}` } },
        async (response) => {
          const b = await readJson(response);
          const s = b?.status;
          return s === "pending" || s === "approved" || s === "not_approved" ? s : undefined;
        },
      );
    },
    pullJobs(url, token) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/jobs`,
        timeoutMs,
        { headers: { authorization: `Bearer ${token}` } },
        parsePullReply,
      );
    },
    async report(url, token, jobId, outcome) {
      const result = await foldFetch(
        opts.fetch,
        `${url}/print-api/agent/jobs/${jobId}/result`,
        timeoutMs,
        { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(outcome) },
        parseVoid,
      );
      return result.ok ? { ok: true, value: undefined } : result;
    },
```

`parsePullReply` (module-level, beside `parseNodeProbe`):

```ts
async function parsePullReply(response: Response): Promise<PullReply | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.nodeId !== "string" || !Array.isArray(b.servers) || !Array.isArray(b.jobs)) return undefined;
  const servers: ServerEntry[] = [];
  for (const s of b.servers) {
    if (typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).url === "string") {
      const e = s as Record<string, unknown>;
      servers.push(typeof e.nodeId === "string" ? { url: e.url as string, nodeId: e.nodeId } : { url: e.url as string });
    }
  }
  const jobs: WireJob[] = [];
  for (const j of b.jobs) {
    if (typeof j !== "object" || j === null) return undefined;
    const e = j as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.printerId !== "string" || typeof e.transport !== "string" || typeof e.payload !== "string") return undefined;
    jobs.push({
      id: e.id,
      printerId: e.printerId,
      transport: e.transport as PrintTransport,
      host: typeof e.host === "string" ? e.host : null,
      port: typeof e.port === "number" ? e.port : null,
      usbPath: typeof e.usbPath === "string" ? e.usbPath : null,
      payload: new Uint8Array(Buffer.from(e.payload, "base64")),
    });
  }
  return { nodeId: b.nodeId, servers, jobs };
}
```

Add `import type { PrintTransport } from "./transport.js";` at the top if not present.

- [ ] **Step 4: Extend the barrel**

`packages/print-agent/src/index.ts` — add to the client type export: `JoinReply, JoinStatus, JobOutcome, PullReply, WireJob, AgentClient` (keep `createClient`, `DEFAULT_TIMEOUT_MS`, `Failure`, `Result`, `NodeProbe`, `ServerEntry`).

- [ ] **Step 5: Run and verify**

```bash
pnpm --filter @waitron/print-agent test:coverage
pnpm --filter @waitron/print-agent lint typecheck && pnpm format:check
```

Expected: PASS, package ≥ 90/90/85/85. The router suite still passes (its `Failure` uses are a subset).

- [ ] **Step 6: Commit**

```bash
git add packages/print-agent
git commit -s -m "feat(print-agent): wire client join/status/pull/report (join-and-accept; 403 pairing_closed, 429 rate_limited)"
```

---

### Task 2: `Host` seam and the poll loop

**Files:**
- Create: `packages/print-agent/src/host.ts`, `packages/print-agent/src/agent.ts`, `packages/print-agent/src/agent.test.ts`, `packages/print-agent/src/testing/fake-host.ts`
- Modify: `packages/print-agent/src/index.ts`, `packages/print-agent/package.json`

**Interfaces:**
- Consumes: `createClient`/`AgentClient`/`WireJob` (Task 1), `Router` (landed), `Transport`/`PrinterTarget` (landed).
- Produces:

```ts
// host.ts
export interface AgentConfig { serverUrl: string; name: string; environment?: string }
export type AgentPhase = "unconfigured" | "pending" | "pairing_closed" | "running" | "unauthorized" | "unreachable";
export interface AgentStatus { phase: AgentPhase; serverUrl: string | null; current: string | null; verificationCode?: string; lastJobAt?: number; lastError?: string }
export interface HostLog { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void; error(msg: string, fields?: Record<string, unknown>): void }
export interface Host {
  config(): Promise<AgentConfig | null>;
  saveConfig(config: AgentConfig): Promise<void>;
  token(): Promise<string | null>;
  saveToken(token: string | null): Promise<void>;
  transport: Transport;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  log: HostLog;
  status(status: AgentStatus): void;
}
// agent.ts
export const POLL_INTERVAL_MS = 2_000;
export interface AgentOptions { host: Host; client?: AgentClient; intervalMs?: number }
export interface Agent { runOnce(): Promise<void>; start(): Promise<void>; stop(): void; readonly status: AgentStatus }
export function createAgent(opts: AgentOptions): Agent
// testing/fake-host.ts
export function fakeHost(overrides?): Host & { statuses: AgentStatus[]; logs: string[]; sleeps: number[]; setToken(t): void; setConfig(c): void }
```

- [ ] **Step 1: Write `host.ts`** (types only)

```ts
import type { Transport } from "./transport.js";

/**
 * The seam between the agent's logic and the machine it runs on (base spec §2.1). A container host reads
 * env + a state directory and serves a setup page; a native till host later reads a settings screen.
 * The loop never touches the filesystem, a clock, a timer or a logger directly — only this.
 */
export interface AgentConfig {
  serverUrl: string;
  name: string;
  /** Fixed by the first successful probe of the configured address; pins which environment's jobs the
   * agent will ever pull (CLAUDE.md §5). */
  environment?: string;
}

export type AgentPhase =
  | "unconfigured"
  | "pending"
  | "pairing_closed"
  | "running"
  | "unauthorized"
  | "unreachable";

export interface AgentStatus {
  phase: AgentPhase;
  serverUrl: string | null;
  current: string | null;
  /** The two-digit number the admin matches in the dashboard. Held in memory from the join reply; a
   * restart while pending loses it (see the resumed plan's decision 4). */
  verificationCode?: string;
  lastJobAt?: number;
  lastError?: string;
}

export interface HostLog {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface Host {
  config(): Promise<AgentConfig | null>;
  saveConfig(config: AgentConfig): Promise<void>;
  token(): Promise<string | null>;
  saveToken(token: string | null): Promise<void>;
  transport: Transport;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  log: HostLog;
  status(status: AgentStatus): void;
}
```

- [ ] **Step 2: Write the fake host** (`packages/print-agent/src/testing/fake-host.ts`)

```ts
import type { AgentConfig, AgentStatus, Host } from "../host.js";
import { FakeSink, type Transport } from "../transport.js";

/** An in-memory Host: config/token live in fields, `sleep` resolves at once and records the ms,
 * `status` and the log are captured for assertions. The default `fetch` rejects (unreachable). */
export function fakeHost(
  overrides: Partial<{ config: AgentConfig | null; token: string | null; transport: Transport; fetch: typeof fetch }> = {},
): Host & { statuses: AgentStatus[]; logs: string[]; sleeps: number[]; setToken(t: string | null): void; setConfig(c: AgentConfig | null): void } {
  let config = overrides.config === undefined ? null : overrides.config;
  let token = overrides.token ?? null;
  let clock = 1_000;
  const statuses: AgentStatus[] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const line = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
    logs.push(`${level} ${msg}${fields ? " " + JSON.stringify(fields) : ""}`);
  };
  return {
    statuses,
    logs,
    sleeps,
    setToken: (t) => { token = t; },
    setConfig: (c) => { config = c; },
    config: async () => config,
    saveConfig: async (c) => { config = c; },
    token: async () => token,
    saveToken: async (t) => { token = t; },
    transport: overrides.transport ?? new FakeSink(),
    fetch: overrides.fetch ?? (async () => { throw new Error("ECONNREFUSED"); }),
    now: () => (clock += 1),
    sleep: async (ms) => { sleeps.push(ms); },
    log: { info: line("info"), warn: line("warn"), error: line("error") },
    status: (s) => { statuses.push(s); },
  };
}
```

- [ ] **Step 3: Write the failing loop tests** (`packages/print-agent/src/agent.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import { createAgent } from "./agent.js";
import type { AgentClient, Failure, JoinStatus, NodeProbe, PullReply, Result } from "./client.js";
import { fakeHost } from "./testing/fake-host.js";
import { FakeSink } from "./transport.js";

const A = "http://a.test";
const CONFIG = { serverUrl: A, name: "kitchen-pi" };
const primary: NodeProbe = { nodeId: "n1", term: 1, acceptingSales: true, environment: "preproduction" };
const okR = <T>(value: T): Result<T> => ({ ok: true, value });
const failR = <T>(failure: Failure): Result<T> => ({ ok: false, failure });

/** A scripted client; each method is a vi.fn you override per test. Defaults walk the happy path:
 * probe → join → approved → empty pull. */
function client(over: Partial<AgentClient> = {}): AgentClient {
  return {
    probeNode: vi.fn(async () => okR(primary)),
    join: vi.fn(async () => okR({ token: "a1.s", verificationNumber: "07" })),
    joinStatus: vi.fn(async () => okR<JoinStatus>("approved")),
    pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [] })),
    report: vi.fn(async () => okR(undefined)),
    ...over,
  };
}

describe("createAgent — phases", () => {
  it("unconfigured: reports the phase and probes nothing", async () => {
    const host = fakeHost({ config: null });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("unconfigured");
    expect(c.probeNode).not.toHaveBeenCalled();
  });

  it("no token: joins, saves the token, reports pending with the number, does NOT poll status yet", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(c.join).toHaveBeenCalledWith(A, "kitchen-pi");
    expect(await host.token()).toBe("a1.s");
    expect(host.statuses.at(-1)).toMatchObject({ phase: "pending", verificationCode: "07", current: A });
    expect(c.joinStatus).not.toHaveBeenCalled();
    expect(c.pullJobs).not.toHaveBeenCalled();
  });

  it("join refused because the window is shut → pairing_closed, token stays null, retries next tick", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client({ join: vi.fn(async () => failR({ kind: "pairing_closed" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("pairing_closed");
    expect(await host.token()).toBeNull();
    await agent.runOnce();
    expect(c.join).toHaveBeenCalledTimes(2); // no halt — it keeps asking
  });

  it("have token, status pending → phase pending, no pull", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("pending")) });
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("pending");
    expect(c.pullJobs).not.toHaveBeenCalled();
    expect(await host.token()).toBe("a1.s");
  });

  it("have token, status not_approved (denied) → clears token, unauthorized, halts", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("not_approved")) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(await host.token()).toBeNull();
    expect(host.statuses.at(-1)?.phase).toBe("unauthorized");
    await agent.runOnce();
    await agent.runOnce();
    expect(c.join).not.toHaveBeenCalled();      // halted: no re-join without a restart
    expect(c.joinStatus).toHaveBeenCalledTimes(1);
  });

  it("status approved → pulls this same tick and reports running", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(c.joinStatus).toHaveBeenCalledTimes(1);
    expect(c.pullJobs).toHaveBeenCalledTimes(1);
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });

  it("once approved, later ticks pull WITHOUT polling status again", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client();
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect(c.joinStatus).toHaveBeenCalledTimes(1);
    expect(c.pullJobs).toHaveBeenCalledTimes(2);
  });

  it("fixes the environment into the saved config on the first successful probe", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    await createAgent({ host, client: client() }).runOnce();
    expect((await host.config())?.environment).toBe("preproduction");
  });

  it("pull unreachable → phase unreachable, token kept, no halt", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ pullJobs: vi.fn(async () => failR({ kind: "unreachable", detail: "x" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
    expect(await host.token()).toBe("a1.s");
    await agent.runOnce();
    expect(c.pullJobs).toHaveBeenCalledTimes(2);
  });

  it("pull unauthorized (revoked after approval) → clears token, unauthorized, halts", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ pullJobs: vi.fn(async () => failR({ kind: "unauthorized" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(await host.token()).toBeNull();
    expect(host.statuses.at(-1)?.phase).toBe("unauthorized");
    await agent.runOnce();
    expect(c.pullJobs).toHaveBeenCalledTimes(1); // halted
  });

  it("running: merges the reply's servers into the router", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [{ url: "http://b.test", nodeId: "n2" }], jobs: [] })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect((c.probeNode as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[0])).toContain("http://b.test");
  });
});

describe("createAgent — push and report", () => {
  const job = (id: string) => ({ id, printerId: "p1", transport: "network_tcp" as const, host: "10.0.0.9", port: 9100, usbPath: null, payload: new Uint8Array([7, 7]) });

  it("sends each job's bytes through the transport, in order, and reports done", async () => {
    const sink = new FakeSink();
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport: sink });
    const c = client({ pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1"), job("j2")] })) });
    await createAgent({ host, client: c }).runOnce();
    expect(sink.written.map((w) => w.printerId)).toEqual(["p1", "p1"]);
    expect(sink.written[0]!.bytes).toEqual(new Uint8Array([7, 7]));
    expect(c.report).toHaveBeenNthCalledWith(1, A, "a1.s", "j1", { status: "done" });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "a1.s", "j2", { status: "done" });
    expect(host.statuses.at(-1)?.lastJobAt).toBeTypeOf("number");
  });

  it("a failed send reports failed with the error text and keeps going", async () => {
    const transport = { send: vi.fn().mockRejectedValueOnce(new Error("no route")).mockResolvedValueOnce(undefined) };
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport });
    const c = client({ pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1"), job("j2")] })) });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenNthCalledWith(1, A, "a1.s", "j1", { status: "failed", error: "no route" });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "a1.s", "j2", { status: "done" });
    expect(host.statuses.at(-1)?.lastError).toBe("no route");
  });

  it("a report that cannot be delivered is logged and dropped (the lease reclaims)", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1")] })),
      report: vi.fn(async () => failR({ kind: "unreachable", detail: "gone" })),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenCalledTimes(1);
    expect(host.logs.some((l) => l.includes("report") && l.includes("j1"))).toBe(true);
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });
});

describe("createAgent — start/stop and logging", () => {
  it("start loops runOnce, sleeping the interval after an empty pull and not at all after a batch", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const pulls = vi.fn()
      .mockResolvedValueOnce(okR<PullReply>({ nodeId: "n1", servers: [], jobs: [{ id: "j1", printerId: "p1", transport: "network_tcp", host: "h", port: 1, usbPath: null, payload: new Uint8Array() }] }))
      .mockResolvedValue(okR<PullReply>({ nodeId: "n1", servers: [], jobs: [] }));
    const agent = createAgent({ host, client: client({ pullJobs: pulls }), intervalMs: 50 });
    const originalSleep = host.sleep;
    host.sleep = async (ms) => { await originalSleep(ms); if (host.sleeps.length >= 2) agent.stop(); };
    await agent.start();
    expect(host.sleeps).toEqual([50, 50]); // tick 1 had a batch → no sleep; ticks 2 and 3 slept
    expect(pulls).toHaveBeenCalledTimes(3);
  });

  it("logs on a phase change, not on every tick", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const agent = createAgent({ host, client: client() });
    await agent.runOnce();
    await agent.runOnce();
    await agent.runOnce();
    expect(host.logs.filter((l) => l.includes("phase")).length).toBe(1);
  });

  it("never throws: a client that throws becomes an unreachable status", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ probeNode: vi.fn(async () => { throw new Error("bug"); }) });
    await expect(createAgent({ host, client: c }).runOnce()).resolves.toBeUndefined();
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `pnpm --filter @waitron/print-agent test -- agent`
Expected: FAIL — `./agent.js` does not exist.

- [ ] **Step 5: Implement `agent.ts`**

```ts
import { createClient, type AgentClient, type Failure, type WireJob } from "./client.js";
import type { AgentConfig, AgentStatus, Host } from "./host.js";
import { Router } from "./router.js";

/** The idle poll interval (base spec §4 step 6). A non-empty batch re-polls at once; only an empty pull sleeps. */
export const POLL_INTERVAL_MS = 2_000;

export interface AgentOptions {
  host: Host;
  client?: AgentClient;
  intervalMs?: number;
}

export interface Agent {
  runOnce(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  readonly status: AgentStatus;
}

function describe(failure: Failure): string {
  return "detail" in failure ? `${failure.kind}: ${failure.detail}` : failure.kind;
}

/**
 * The loop (base spec §4, as amended by device-join §7). `runOnce` is one tick and NEVER throws —
 * every failure becomes a status the host renders. Enrolment is join-and-accept: a knocking agent
 * JOINS (creating a shared join-request), then POLLS its status until an admin accepts, and only THEN
 * pulls. It never pulls with an unapproved token (that reads as `unauthorized` and would halt it).
 *
 * Cross-tick state: the router (server list + current), `approved` (set once the status poll first
 * says so, so later ticks skip the poll and pull straight away — a restart re-confirms it in one
 * poll), and `halted` (set on `not_approved`/`unauthorized` — the token is dead and re-joining on our
 * own would put a denied agent straight back into the admin's list, so only a restart asks again).
 */
export function createAgent(opts: AgentOptions): Agent {
  const host = opts.host;
  const client = opts.client ?? createClient({ fetch: host.fetch });
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  let router: Router | undefined;
  let approved = false;
  let halted = false;
  let running = false;
  let status: AgentStatus = { phase: "unconfigured", serverUrl: null, current: null };
  let lastPhaseLine = "";

  function report(next: Partial<AgentStatus> & { phase: AgentStatus["phase"] }): void {
    status = { ...status, ...next };
    const line = `${status.phase}@${status.current ?? "-"}`;
    if (line !== lastPhaseLine) {
      lastPhaseLine = line;
      host.log.info("phase", { phase: status.phase, current: status.current, error: status.lastError });
    }
    host.status(status);
  }

  function routerFor(config: AgentConfig): Router {
    if (router === undefined || router.servers()[0]!.url !== new URL(config.serverUrl).origin) {
      router = new Router({ configuredUrl: config.serverUrl, environment: config.environment, probe: client.probeNode });
    }
    return router;
  }

  async function halt(config: AgentConfig, current: string): Promise<void> {
    halted = true;
    approved = false;
    await host.saveToken(null);
    report({ phase: "unauthorized", serverUrl: config.serverUrl, current, verificationCode: undefined });
  }

  async function push(job: WireJob, token: string, current: string): Promise<void> {
    let outcome: { status: "done" } | { status: "failed"; error: string };
    try {
      await host.transport.send(
        { id: job.printerId, transport: job.transport, host: job.host, port: job.port, usbPath: job.usbPath },
        job.payload,
      );
      outcome = { status: "done" };
      status = { ...status, lastJobAt: host.now(), lastError: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = { status: "failed", error: message };
      status = { ...status, lastError: message };
    }
    const sent = await client.report(current, token, job.id, outcome);
    if (!sent.ok) {
      // Dropped on purpose: the server's claim lease reclaims an unreported job (at-least-once).
      host.log.warn("report dropped", { job: job.id, failure: sent.failure });
    }
  }

  /** Returns true when the tick did work (a non-empty batch), so `start` re-polls at once. */
  async function tick(): Promise<boolean> {
    const config = await host.config();
    if (config === null) {
      report({ phase: "unconfigured", serverUrl: null, current: null });
      return false;
    }
    if (halted) {
      report({ phase: "unauthorized", serverUrl: config.serverUrl });
      return false;
    }
    const r = routerFor(config);
    await r.probe();
    if (config.environment === undefined && r.environment !== undefined) {
      await host.saveConfig({ ...config, environment: r.environment });
    }
    const current = r.current;

    let token = await host.token();
    if (token === null) {
      const joined = await client.join(current, config.name);
      if (!joined.ok) {
        if (joined.failure.kind === "pairing_closed") {
          report({ phase: "pairing_closed", serverUrl: config.serverUrl, current });
        } else {
          report({ phase: "unreachable", serverUrl: config.serverUrl, current, lastError: describe(joined.failure) });
        }
        return false;
      }
      token = joined.value.token;
      await host.saveToken(token);
      approved = false;
      report({ phase: "pending", serverUrl: config.serverUrl, current, verificationCode: joined.value.verificationNumber });
      return false;
    }

    if (!approved) {
      const s = await client.joinStatus(current, token);
      if (!s.ok) {
        report({ phase: "unreachable", serverUrl: config.serverUrl, current, lastError: describe(s.failure) });
        return false;
      }
      if (s.value === "pending") {
        report({ phase: "pending", serverUrl: config.serverUrl, current });
        return false;
      }
      if (s.value === "not_approved") {
        await halt(config, current);
        return false;
      }
      approved = true;
    }

    const pulled = await client.pullJobs(current, token);
    if (!pulled.ok) {
      if (pulled.failure.kind === "unauthorized") {
        await halt(config, current);
      } else {
        report({ phase: "unreachable", serverUrl: config.serverUrl, current, lastError: describe(pulled.failure) });
      }
      return false;
    }
    r.merge(pulled.value.servers);
    for (const job of pulled.value.jobs) await push(job, token, current);
    report({ phase: "running", serverUrl: config.serverUrl, current, verificationCode: undefined });
    return pulled.value.jobs.length > 0;
  }

  async function runOnce(): Promise<boolean> {
    try {
      return await tick();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.log.error("tick failed", { error: message });
      report({ phase: "unreachable", lastError: message });
      return false;
    }
  }

  return {
    get status() {
      return status;
    },
    async runOnce() {
      await runOnce();
    },
    async start() {
      running = true;
      while (running) {
        const busy = await runOnce();
        if (!running) break;
        if (!busy) await host.sleep(intervalMs);
      }
    },
    stop() {
      running = false;
    },
  };
}
```

- [ ] **Step 6: Barrel + subpath export**

`packages/print-agent/src/index.ts` — add:

```ts
export { POLL_INTERVAL_MS, createAgent } from "./agent.js";
export type { Agent, AgentOptions } from "./agent.js";
export type { AgentConfig, AgentPhase, AgentStatus, Host, HostLog } from "./host.js";
```

`packages/print-agent/package.json` — add an enumerated `exports` map (the `@waitron/db` convention; keeps `fake-host` out of the barrel):

```json
"exports": {
  ".": "./src/index.ts",
  "./testing/fake-host.js": "./src/testing/fake-host.ts"
}
```

(Leave `main` for tooling.)

- [ ] **Step 7: Run and verify**

```bash
pnpm --filter @waitron/print-agent test:coverage
pnpm --filter @waitron/print-agent lint typecheck && pnpm typecheck && pnpm format:check
```

Expected: PASS, package ≥ 90/90/85/85. If `start` hangs, the fake's `sleep` stop-hook is not firing — check `host.sleeps.length >= 2`. `src/testing/**` and `src/index.ts` are coverage-excluded (`vitest.config.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/print-agent
git commit -s -m "feat(print-agent): Host seam and the poll loop (join → poll status → pull; window-shut retries, denied/revoked halts)"
```

---

### Task 3: Schema — drop `print_agent_pairing_codes`

**Files:**
- Modify: `packages/db/src/schema/print-agents.ts`, `packages/db/src/index.ts:33`, `packages/db/src/classification.ts:89`, `packages/db/src/schema/printing.test.ts`, `packages/fiscal-verifactu/src/privileges.expected.ts`, `packages/printing/src/testing/global-setup.ts`
- Create (generated): `packages/db/drizzle/00NN_drop_print_agent_pairing_codes_sql.sql` + snapshot/journal entry

**Interfaces:**
- Produces: `printAgentPairingCodes` no longer exists. `printAgents` is UNCHANGED (id, tenant_id, location_id, name, token_hash, active, last_seen_at, enrolled_at). No new columns.

**Precedent:** `packages/db/drizzle/0010_drop_device_pairing_codes_sql.sql` — the device slice's drop of the analogous table. Read it before generating: it is a `--custom` migration (`DROP TABLE … CASCADE`), and the classification scanners already subtract a dropped table (device-join spec §4.1), so no guard change is needed here.

- [ ] **Step 1: Write the failing schema test**

In `packages/db/src/schema/printing.test.ts`: drop `printAgentPairingCodes` from the import; delete `seedPairingCode` and the `print_agent_pairing_codes` describe/tests. Add a guard that the table is gone:

```ts
  it("print_agent_pairing_codes no longer exists (join-and-accept replaced the pairing code)", async () => {
    await expect(
      asApp(TENANT_A, (tx) => tx.execute(sql`select 1 from print_agent_pairing_codes limit 1`)),
    ).rejects.toThrow(/relation .*print_agent_pairing_codes.* does not exist/);
  });
```

(Confirm the exact `sql`/`asApp`/`TENANT_A` names against the file's existing tests; reuse them verbatim.)

- [ ] **Step 2: Run it to see it fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test -- printing`
Expected: FAIL — the table still exists, the `select` succeeds.

- [ ] **Step 3: Drop the table everywhere it is named**

- `packages/db/src/schema/print-agents.ts`: delete the whole `printAgentPairingCodes` `pgTable` and its doc comment. Drop the now-unused `uniqueIndex` import ONLY if nothing else in the file uses it (grep the file first). Trim the file header's mention of the pairing code to one line describing join-and-accept.
- `packages/db/src/index.ts:33`: `export { printAgents } from "./schema/print-agents.js";` (drop `printAgentPairingCodes`).
- `packages/db/src/classification.ts:89`: delete the `classify("print_agent_pairing_codes", "local", …)` call.
- `packages/fiscal-verifactu/src/privileges.expected.ts`: delete the `print_agent_pairing_codes: …` line.
- `packages/printing/src/testing/global-setup.ts`: remove `print_agent_pairing_codes` from the table list; if its `dockerRequired`/rationale prose cites the pairing-code redemption race (deleted in Task 4), restate it as the grants/deployment-role rationale (the join/accept/deny verbs run as the real `app_user` with its exact grants, which PGlite's all-superuser connection cannot check). A behaviour change retires every receipt about the old behaviour (CLAUDE.md §1) — read the whole file, not just the hunk.

- [ ] **Step 4: Generate the migration**

```bash
pnpm --filter @waitron/db db:generate:custom --name drop_print_agent_pairing_codes_sql
```

Paste into the generated `00NN_drop_print_agent_pairing_codes_sql.sql` (model on `0010_drop_device_pairing_codes_sql.sql`):

```sql
DROP TABLE "print_agent_pairing_codes" CASCADE;
```

The `CASCADE` also drops `print_agent_pairing_codes_lookup_idx` and the table's FKs — expected. No grant twin: nothing else grants on that table once it is gone. Do NOT hand-edit `_journal.json`/snapshots beyond what `db:generate:custom` writes.

- [ ] **Step 5: Run the package and the root guards**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test -- privileges
pnpm vitest run scripts/classification-complete.test.ts scripts/append-only-enable-always.test.ts
grep -rn "print_agent_pairing\|printAgentPairingCodes" apps packages scripts --include='*.ts' --include='*.mjs' --exclude-dir=coverage --exclude-dir=node_modules --exclude-dir=dist | grep -v "/drizzle/"
```

Expected: db green at 98/95; privileges green; guards green; the grep prints only `packages/printing/src/agent.ts` + its test (Task 4 removes those) and nothing else.

- [ ] **Step 6: Commit**

```bash
git add packages/db packages/fiscal-verifactu/src/privileges.expected.ts packages/printing/src/testing/global-setup.ts
git commit -s -m "feat(db): drop print_agent_pairing_codes (join-and-accept replaces the pairing code; pre-production, no backfill)"
```

---

### Task 4: `@waitron/printing` — retire the pairing-code verbs and codes

**Files:**
- Modify: `packages/printing/src/agent.ts`, `packages/printing/src/agent.test.ts`, `packages/printing/src/errors.ts`, `packages/printing/src/errors.test.ts`, `packages/printing/src/index.ts`

**Interfaces:**
- Produces (from `@waitron/printing`): `authenticateAgent` (unchanged signature). `generateAgentCode`, `enrolAgent`, `PAIRING_TTL_MS`, `PAIRING_CODE_BYTES` are GONE.
- Codes: DELETE `agent.pairing_invalid`, `agent.pairing_expired`, `agent.pairing_rate_limited`. Add none.

- [ ] **Step 1: Cut the failing tests down**

`errors.test.ts`: delete the three `agent.pairing_*` construction cases.
`agent.test.ts`: delete the `generateAgentCode`/`enrolAgent` describes and the pairing-code race describe. Keep the `authenticateAgent` describe but change its `enrolled()` helper to mint a row directly, since `enrolAgent` is gone — insert an approved `print_agents` row via SQL and hash a secret with `@waitron/identity`'s `hashSecret`:

```ts
  async function enrolled(): Promise<{ cfg: PrintAgentConfig; agentId: string; token: string }> {
    const cfg = await setup();
    const secret = randomBytes(32).toString("base64url");
    const [{ id }] = (
      await suite.admin.execute<{ id: string }>(sql`
        insert into print_agents (tenant_id, location_id, name, token_hash, active)
        values (${cfg.tenantId}, ${cfg.locationId}, 'Auth agent', ${hashSecret(secret)}, true)
        returning id`)
    ).rows;
    return { cfg, agentId: id, token: `${id}.${secret}` };
  }
```

(Import `hashSecret` from `@waitron/identity`, `randomBytes` from `node:crypto`, `sql` as the file already does. Confirm `suite.admin`/`setup`/`asApp`/`codeOf` names against the file.)

- [ ] **Step 2: Run to see them fail / not compile**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test -- agent errors`
Expected: FAIL — the deleted verbs are still imported/exported, or the `enrolled` helper references removed symbols.

- [ ] **Step 3: Cut `agent.ts`, `errors.ts`, `index.ts`**

- `packages/printing/src/agent.ts`: delete `PAIRING_TTL_MS`, `PAIRING_CODE_BYTES`, `generateAgentCode`, `enrolAgent`, and any now-unused imports (`createHash`, `printAgentPairingCodes`). KEEP `authenticateAgent`, `PrintAgentConfig`, `UUID_RE`, `TOKEN_BYTES` if still used, `hashSecret`/`verifySecret`/`randomBytes`. Trim the file header to name only `authenticateAgent` (join/accept now live in `apps/server/src/join-requests.ts`; say so in one line).
- `packages/printing/src/errors.ts`: delete the three `agent.pairing_*` entries and their JSDoc. Change the file header's "enrolment" mention to reflect that agent enrolment is join-and-accept (shared codes in `apps/server`).
- `packages/printing/src/index.ts`: `export { authenticateAgent } from "./agent.js";` (drop `PAIRING_TTL_MS`, `generateAgentCode`, `enrolAgent`).

- [ ] **Step 4: Run the package**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test:coverage`
Expected: PASS at 90/90/85/85. `apps/server` typecheck is RED until Task 6 (it still imports `enrolAgent`/`generateAgentCode`) — expected; do not run `pnpm typecheck` yet.

Also run the reachability guard (the deleted codes must leave no dangling declaration):

```bash
pnpm vitest run scripts/errors-reachable.test.ts
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @waitron/printing lint typecheck && pnpm format:check
git add packages/printing
git commit -s -m "feat(printing): retire generateAgentCode/enrolAgent and the agent.pairing_* codes (join-and-accept replaces the pairing code; nothing shipped, no deprecation sibling)"
```

---

### Task 5: Server verbs — `acceptPrintAgentJoinRequest` and `readAgentJoinStatus`

**Files:**
- Modify: `apps/server/src/join-requests.ts`, `apps/server/src/join-requests.pg.test.ts` (or the existing `join-requests` real-PG suite — confirm the filename)

**Interfaces:**
- Consumes: `printAgents` from `@waitron/db`; `hashSecret`/`verifySecret` from `@waitron/identity` (already imported); the existing `sweepLapsed`, `AppError`, `Transaction`, `TillConfig`.
- Produces:

```ts
export type AgentAcceptResult = { ok: true; agentId: string; name: string } | { ok: false; reason: "mismatch" };
export function acceptPrintAgentJoinRequest(tx: Transaction, cfg: TillConfig, id: string, input: { choice: string }): Promise<AgentAcceptResult>;
export function readAgentJoinStatus(tx: Transaction, cfg: TillConfig, joinId: string, token: string): Promise<"pending" | "approved" | "not_approved">;
```

- [ ] **Step 1: Write the failing real-PG tests**

Add to the real-PG join-requests suite (mirror the `acceptDeviceJoinRequest` tests). Use the real `app_user` role (`rolsuper = f`) and TWO tenants for the isolation test:

```ts
describe("acceptPrintAgentJoinRequest", () => {
  it("a right choice inserts a print_agents row (id = joinId, name = label, token carried) and deletes the request", async () => {
    const cfg = await tenant();
    const { joinId, verificationNumber, token } = await asApp(cfg, (tx) => createJoinRequest(tx, cfg, { kind: "print_agent", label: "kitchen-pi" }));
    const result = await asApp(cfg, (tx) => acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: verificationNumber }));
    expect(result).toEqual({ ok: true, agentId: joinId, name: "kitchen-pi" });
    const [agent] = await asApp(cfg, (tx) => tx.select().from(printAgents).where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.id, joinId))));
    expect(agent).toMatchObject({ id: joinId, name: "kitchen-pi", active: true });
    // At the VERB layer `token` IS the bare secret (createJoinRequest returns it un-composed);
    // print_agents.token_hash was copied from the request, so verifySecret(secret, hash) holds. The
    // route composes `${joinId}.${secret}` — that composition is asserted in Task 6, not here.
    expect(verifySecret(token, agent!.tokenHash)).toBe(true);
    const gone = await asApp(cfg, (tx) => tx.select().from(joinRequests).where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, joinId))));
    expect(gone).toHaveLength(0);
  });

  it("a wrong choice returns mismatch, consumes the request (single-use), inserts no agent", async () => {
    const cfg = await tenant();
    const { joinId, verificationNumber } = await asApp(cfg, (tx) => createJoinRequest(tx, cfg, { kind: "print_agent", label: "x" }));
    const wrong = String((Number(verificationNumber) + 1) % 100).padStart(2, "0");
    expect(await asApp(cfg, (tx) => acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: wrong }))).toEqual({ ok: false, reason: "mismatch" });
    const agents = await asApp(cfg, (tx) => tx.select().from(printAgents).where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.id, joinId))));
    expect(agents).toHaveLength(0);
    // consumed: a retry is not_found
    expect(await codeOf(() => asApp(cfg, (tx) => acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: verificationNumber })))).toBe("join_request.not_found");
  });

  it("refuses a device request 404 (kind predicate rides the delete)", async () => {
    const cfg = await tenant();
    const { joinId } = await asApp(cfg, (tx) => createJoinRequest(tx, cfg, { kind: "device", label: "d" }));
    expect(await codeOf(() => asApp(cfg, (tx) => acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: "00" })))).toBe("join_request.not_found");
  });

  it("tenant-scoped: tenant B cannot accept tenant A's agent request", async () => {
    const cfgA = await tenant();
    const cfgB = await tenant();
    const { joinId, verificationNumber } = await asApp(cfgA, (tx) => createJoinRequest(tx, cfgA, { kind: "print_agent", label: "a" }));
    expect(await codeOf(() => asApp(cfgB, (tx) => acceptPrintAgentJoinRequest(tx, cfgB, joinId, { choice: verificationNumber })))).toBe("join_request.not_found");
  });
});

describe("readAgentJoinStatus", () => {
  it("pending before accept, approved after, and not_approved for a wrong token or unknown id", async () => {
    const cfg = await tenant();
    // `token` is the bare secret at the verb layer (see acceptPrintAgentJoinRequest's test); the route
    // splits the Bearer and hands readAgentJoinStatus the secret, so pass `token` directly here.
    const { joinId, verificationNumber, token } = await asApp(cfg, (tx) => createJoinRequest(tx, cfg, { kind: "print_agent", label: "a" }));
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, joinId, token))).toBe("pending");
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, joinId, "wrong"))).toBe("not_approved");
    await asApp(cfg, (tx) => acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: verificationNumber }));
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, joinId, token))).toBe("approved");
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, randomUUID(), token))).toBe("not_approved");
  });
});
```

(Confirm the suite's real helper names — `asApp`, `tenant`/`setup`, `codeOf` — and reuse them. The token the agent holds is `${joinId}.${secret}`; `readAgentJoinStatus` receives the SECRET only, because the route splits the Bearer, exactly as the device status route does.)

- [ ] **Step 2: Run to see them fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- join-requests`
Expected: FAIL — `acceptPrintAgentJoinRequest`/`readAgentJoinStatus` are not exported.

- [ ] **Step 3: Implement the two verbs** (in `apps/server/src/join-requests.ts`)

Add `printAgents` to the `@waitron/db` import. Add, mirroring `acceptDeviceJoinRequest` and `readJoinStatus`:

```ts
/** What {@link acceptPrintAgentJoinRequest} hands back. A wrong choice is a RESULT, never a throw —
 * the same reason {@link acceptDeviceJoinRequest} returns: an AppError would roll the consuming delete
 * back into existence and turn a wrong tap into an unlimited retry (design §1.2). */
export type AgentAcceptResult = { ok: true; agentId: string; name: string } | { ok: false; reason: "mismatch" };

/**
 * Approve a print agent's ask-to-join. The mirror of {@link acceptDeviceJoinRequest}, minus the device
 * binding: consume the request with a locking `DELETE … RETURNING` whose `kind = "print_agent"` predicate
 * rides along (a device row, another tenant's, or an already-decided one all fold into
 * `join_request.not_found`), then — only on a matching choice — insert the real `print_agents` row with
 * the request's own id and token hash, so the bearer the agent has held since join keeps working.
 * ONE transaction: `withTenant` covers the delete and the insert together.
 */
export async function acceptPrintAgentJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  input: { choice: string },
): Promise<AgentAcceptResult> {
  await sweepLapsed(tx, cfg);
  const [row] = await tx
    .delete(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, id), eq(joinRequests.kind, "print_agent")))
    .returning({
      id: joinRequests.id,
      label: joinRequests.label,
      verificationNumber: joinRequests.verificationNumber,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    });
  if (row === undefined) throw new AppError("join_request.not_found", {});
  if (input.choice !== row.verificationNumber) return { ok: false, reason: "mismatch" };

  await tx.insert(printAgents).values({
    id: row.id,
    tenantId: cfg.tenantId,
    locationId: row.locationId,
    name: row.label,
    tokenHash: row.tokenHash,
    active: true,
  });
  return { ok: true, agentId: row.id, name: row.label };
}

/**
 * What a print agent polling with `${joinId}.${secret}` should be told (device-join §7.3). The mirror
 * of {@link readJoinStatus}, resolving the approved fallback against `print_agents` rather than
 * `devices` — the id is carried through accept, so one selector answers both questions. Denied,
 * lapsed and never-existed all fold into `not_approved`; the agent's recovery (restart → re-join) is
 * identical in every case.
 */
export async function readAgentJoinStatus(
  tx: Transaction,
  cfg: TillConfig,
  joinId: string,
  token: string,
): Promise<"pending" | "approved" | "not_approved"> {
  await sweepLapsed(tx, cfg);
  const [pending] = await tx
    .select({ tokenHash: joinRequests.tokenHash })
    .from(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, joinId)));
  if (pending !== undefined) {
    return verifySecret(token, pending.tokenHash) ? "pending" : "not_approved";
  }
  const [accepted] = await tx
    .select({ tokenHash: printAgents.tokenHash })
    .from(printAgents)
    .where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.id, joinId), eq(printAgents.active, true)));
  if (accepted !== undefined && verifySecret(token, accepted.tokenHash)) return "approved";
  return "not_approved";
}
```

- [ ] **Step 4: Run the suite and the whole package's typecheck-adjacent guards**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- join-requests
pnpm --filter @waitron/server lint
```

Expected: the two new describes pass; the wider `apps/server` typecheck is still RED until Task 6.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/join-requests.ts apps/server/src/join-requests.pg.test.ts
git commit -s -m "feat(server): acceptPrintAgentJoinRequest + readAgentJoinStatus (print agent joins the shared join_requests mechanism)"
```

---

### Task 6: Server routes — the agent knock, status, accept; `servers` on the pull; retire enrol/codes

**Files:**
- Modify: `apps/server/src/print-api.ts`, `apps/server/src/print-api.test.ts`, `apps/server/src/print-api.pg.test.ts`, `apps/server/src/enrol-rate-limit.ts`, `apps/server/src/join-api.ts`, `apps/server/src/join-api.pg.test.ts` (or the join-api test suite — confirm), `apps/server/src/boot.ts`, `apps/server/src/print-agent-session.ts` (header comment only)

**Interfaces:**
- Consumes: `createJoinRequest`, `readAgentJoinStatus`, `acceptPrintAgentJoinRequest` (Task 5), `listPendingJoinRequests`/`challengeFor`/`denyJoinRequest` (existing), `authenticateAgent`/`requireAgent` (existing), `routableServers`/`SignedMembershipDocument` from `@waitron/membership`, `readNodeMembership` from `@waitron/db`, `createPairingMode`/`PairingMode` (existing).
- Produces:

```ts
export interface PrintApiDeps {
  db: Database;
  // The FULL TillConfig, not a narrowed 3-field literal: the shared verbs (createJoinRequest,
  // readAgentJoinStatus, acceptPrintAgentJoinRequest) are typed `cfg: TillConfig` with BRANDED
  // tenantId/locationId, so a plain-string object does not typecheck (join-api.ts types its dep the
  // same way and boot passes `till` verbatim). TillConfig also carries `nodeId` for the pull reply.
  cfg: TillConfig;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  pairingMode: PairingMode;
  enrolRateLimiter?: EnrolRateLimiter;   // built with code "device.join_rate_limited"
}
```
Routes: `POST /print-api/agent/join {name}` → 201 `{ token, verificationNumber }` (window-gated, rate-limited); `GET /print-api/agent/join/status` (Bearer) → 200 `{ status }`; `GET /print-api/agent/jobs` (Bearer) → `{ nodeId, servers, jobs }`; `POST /management-api/print-agent-join-requests/:id/accept {choice}` (`printer.manage`) → 204 (or `device.join_mismatch` 400); the list/challenge/deny of the agent's pending rows are the SHARED `join-api` routes with `kind=print_agent`. `POST /print-api/agent/enrol` and `POST /management-api/print-agents/codes` are GONE (404).

- [ ] **Step 0: Retype the rate limiter** (`apps/server/src/enrol-rate-limit.ts`)

Task 4 deleted `agent.pairing_rate_limited` from the AppError registry, so the `"agent.pairing_rate_limited"` member of the `code` union (`:65`) is now an invalid code type. Narrow the union — the default at `:90` is ALREADY `device.join_rate_limited` (no change there):

```ts
  code?: "device.join_rate_limited";
```

Also update the two stale references to `agent.pairing_rate_limited` — the file header (`:1-4`) and the module doc (`:57-64`) — to the shared `device.*` code (a behaviour change retires every receipt, CLAUDE.md §1). (A one-member union documents intent; a future surface widens it here. Keep the no-`max` policy note.) This is genuinely required in the same landing, and the Task 3→4→6 order satisfies it.

- [ ] **Step 1: Write the failing route tests**

**First: both existing `mountPrintApi` constructions now miss required deps and must be updated, or the package will not typecheck** — `print-api.test.ts:71` (`{ db, cfg: { tenantId, locationId }, enrolRateLimiter }`) and `print-api.pg.test.ts:80` (`{ db: suite.admin, cfg: tenant }`). Both need `pairingMode`, `readMembership`, and a full `TillConfig` for `cfg`. Give the PGlite harness a `mount({ pairingOpen })` helper that builds a `createPairingMode()` (opened or not) and a `readMembership` returning a membership fixture (mirror the till-api pull test's fixture); update the `.pg.test.ts` harness the same way.

`print-api.test.ts` (PGlite) — the knock, status, and the deleted routes:

```ts
describe("POST /print-api/agent/join", () => {
  it("window shut → 403 device.pairing_closed with no row created", async () => {
    const { app } = mount({ pairingOpen: false });
    const res = await app.request("/print-api/agent/join", { method: "POST", headers: json, body: JSON.stringify({ name: "kitchen-pi" }) });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("device.pairing_closed");
  });

  it("window open → 201 { token, verificationNumber }, a pending join_requests row, no print_agents row", async () => {
    const { app, db, cfg } = mount({ pairingOpen: true });
    const res = await app.request("/print-api/agent/join", { method: "POST", headers: json, body: JSON.stringify({ name: "kitchen-pi" }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.verificationNumber).toMatch(/^\d{2}$/);
    expect(body.token).toMatch(/^[0-9a-f-]{36}\./); // ${joinId}.${secret}
    const [req] = await asApp(db, cfg, (tx) => tx.select().from(joinRequests).where(eq(joinRequests.kind, "print_agent")));
    expect(req).toBeDefined();
    const agents = await asApp(db, cfg, (tx) => tx.select().from(printAgents));
    expect(agents).toHaveLength(0);
  });
});

describe("GET /print-api/agent/join/status", () => {
  it("pending before accept; approved after; not_approved with a garbage token", async () => {
    const { app, joinAndReadNumber, accept } = mount({ pairingOpen: true });
    const { token } = await joinAndReadNumber("kitchen-pi");
    const pending = await app.request("/print-api/agent/join/status", { headers: { authorization: `Bearer ${token}` } });
    expect((await pending.json()).status).toBe("pending");
    await accept(); // admin accept with the right number
    const approved = await app.request("/print-api/agent/join/status", { headers: { authorization: `Bearer ${token}` } });
    expect((await approved.json()).status).toBe("approved");
    const bad = await app.request("/print-api/agent/join/status", { headers: { authorization: "Bearer nope.nope" } });
    expect((await bad.json()).status).toBe("not_approved");
  });
});

describe("the deleted enrol/codes routes are gone", () => {
  it("POST /print-api/agent/enrol → 404; POST /management-api/print-agents/codes → 404", async () => {
    const { app } = mount({ pairingOpen: true });
    expect((await app.request("/print-api/agent/enrol", { method: "POST", headers: json, body: "{}" })).status).toBe(404);
    expect((await app.request("/management-api/print-agents/codes", { method: "POST", headers: managementHeaders, body: "{}" })).status).toBe(404);
  });
});
```

Add a pull test asserting `servers` + `nodeId` are present (mirror the till-api pull test's membership fixture).

`join-api.pg.test.ts` (real PG) — the agent accept route and the shared routes with `kind=print_agent`:

```ts
it("accept: right number → 204 and a print_agents row; wrong number → 400 device.join_mismatch and no row", async () => { /* knock via createJoinRequest, GET challenge, POST accept {choice} */ });
it("the shared list/challenge/deny serve kind=print_agent under printer.manage, and refuse a session without it 403", async () => { /* … */ });
it("the DEVICE accept route 404s a print_agent request and this route 404s a device request (kind filtering)", async () => { /* … */ });
it("accept is tenant-scoped: tenant B's printer.manage session cannot accept tenant A's agent request", async () => { /* real app_user, two tenants */ });
```

- [ ] **Step 2: Run to see them fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- print-api join-api`
Expected: FAIL — routes 404 / deps missing.

- [ ] **Step 3: Rewrite `print-api.ts`**

- Imports: drop `enrolAgent`, `generateAgentCode`; add `createJoinRequest`, `readAgentJoinStatus` from `./join-requests.js`; add `routableServers`, `type SignedMembershipDocument` from `@waitron/membership`; keep `authenticateAgent` (via `requireAgent`).
- `PrintApiDeps`: add `cfg.nodeId`, `readMembership`, `pairingMode`; keep `enrolRateLimiter?`. Rewrite the header comment to describe join-and-accept and the shared window; remove the `device.* never appears` claim (the knock now answers `device.*` join codes by design — say so).
- `STATUS`: delete `agent.pairing_invalid`/`agent.pairing_expired`/`agent.pairing_rate_limited`; add `device.pairing_closed` (403), `device.join_full` (429), `device.join_rate_limited` (429). Keep `agent.unauthorized` (401), `agent.not_found` (404), the printer/station/management codes.
- Build the limiter with the shared code: `deps.enrolRateLimiter ?? createEnrolRateLimiter({ code: "device.join_rate_limited" })`.

> **The review found the earlier draft used helper signatures that do not exist. Use the REAL ones,
> verified against the siblings in these files, and model each route on its device twin:**
> - `run(c, log, async () => …)` — three args, `log` is `mountPrintApi`'s param (`print-api.ts:240`).
> - `await asAppUser(tx)` — single-arg, MUTATES the tx's role; then use `tx` (`print-api.ts:230`,
>   `device-api.ts:263`). There is no three-arg callback form.
> - `const body = await readJsonBody<{ name: unknown }>(c); const name = requireString(body.name, "name");`
>   — `readJsonBody<T>(c)` takes no mapper; `requireString(value, field)` takes the field VALUE
>   (`print-api.ts:247-248`, `device-api.ts:260-261`).
> - `requireUuidParam(c.req.param("id"), "PrinterId")` (`print-api.ts:356`).
> - `requireManagementSession(c)` for the session id — there is no `sessionId(c)` (`join-api.ts:249`).
> - `gated(sessionId, permission, (tx) => …)` in join-api ALREADY opens `withTenant` + `asAppUser` +
>   `authorizeManager` and hands the callback a `tx` — do NOT open a second transaction inside it
>   (`join-api.ts:135-144`, `:287-304`).

- Replace `POST /print-api/agent/enrol` with the knock (mirror `device-api.ts:242`'s ordering — limiter FIRST, window SECOND, both before any DB work):

```ts
  app.post("/print-api/agent/join", (c) =>
    run(c, log, async () => {
      enrolLimiter.check(); // throws device.join_rate_limited before the pool is touched
      if (!deps.pairingMode.isOpen()) {
        deps.pairingMode.noteRefused();
        throw new AppError("device.pairing_closed", {});
      }
      const body = await readJsonBody<{ name: unknown }>(c);
      const name = requireString(body.name, "name");
      const made = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createJoinRequest(tx, deps.cfg, { kind: "print_agent", label: name });
      });
      return c.json({ token: `${made.joinId}.${made.token}`, verificationNumber: made.verificationNumber }, 201);
    }),
  );
```

- Add the status route (Bearer, but NOT `requireAgent` — a pending token is not yet a print_agents row, so it must resolve through `readAgentJoinStatus`, not `authenticateAgent`). **It MUST guard the split-out id with `isUuid` before touching the `uuid` column** (the device sibling does — `device-api.ts:307` — without it `Bearer nope.nope` is a `22P02` 500, which the plan's own test would trip):

```ts
  app.get("/print-api/agent/join/status", (c) =>
    run(c, log, async () => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      const dot = bearer.indexOf(".");
      const joinId = dot > 0 ? bearer.slice(0, dot) : "";
      const secret = dot > 0 ? bearer.slice(dot + 1) : "";
      if (!isUuid(joinId)) return c.json({ status: "not_approved" as const });
      const status = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return readAgentJoinStatus(tx, deps.cfg, joinId, secret);
      });
      return c.json({ status });
    }),
  );
```

(Import `isUuid` from `./till-session.js`, as `join-api.ts:31` does.)

- The pull route: add `nodeId` + `servers` to the reply, mirroring `till-api.ts:844`:

```ts
      const held = await deps.readMembership();
      return c.json({ nodeId: deps.cfg.nodeId, servers: routableServers(held), jobs });
```

- Delete `POST /management-api/print-agents/codes`. Keep `GET /management-api/print-agents` (lists real `print_agents` rows — all approved now; no projection change needed) and `POST /management-api/print-agents/:id/revoke`.

- [ ] **Step 4: Add the agent accept route to `join-api.ts`**

Mirror the device accept (`join-api.ts:270-298`), gated on `device.manage`? No — on `printer.manage`. Import `acceptPrintAgentJoinRequest`. The `STATUS` map already has `device.join_mismatch: 400`. Add:

Model this EXACTLY on the device accept route (`join-api.ts:270-316`), changing only the path, the permission (`printer.manage`, not `device.manage`), the verb (`acceptPrintAgentJoinRequest`), and the input (`{ choice }` only). `gated` already opens the transaction and hands the callback a `tx`; the id is read from the param and guarded oracle-free (`isUuid` → `join_request.not_found`, mirroring the device sibling — decision M3), and the `device.join_mismatch` is thrown AFTER the transaction returns:

```ts
  // The print agent's accept — the only per-surface print route here; list/challenge/deny are shared
  // above. A device request is refused 404 by the kind predicate riding acceptPrintAgentJoinRequest's
  // consuming delete.
  app.post("/management-api/print-agent-join-requests/:id/accept", (c) =>
    run(c, log, async () => {
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("join_request.not_found", {}); // oracle-free, like device accept (:297)
      const body = await readJsonBody<{ choice: unknown }>(c);
      const choice = requireString(body.choice, "choice");
      const result = await gated(requireManagementSession(c), "printer.manage", (tx) =>
        acceptPrintAgentJoinRequest(tx, deps.cfg, id, { choice }),
      );
      if (!result.ok) throw new AppError("device.join_mismatch", {}); // AFTER the tx commits — see acceptDeviceJoinRequest's header
      return c.body(null, 204);
    }),
  );
```

(Verify `gated`'s exact arity and whether it takes `run` outside or inside against `join-api.ts:270-304`, and match it — the shape above follows the device sibling. `printer.manage` is a real `Permission`, `join-api.ts:87`.)

- [ ] **Step 5: Wire boot** (`apps/server/src/boot.ts:1486`)

```ts
    mountPrintApi(
      app,
      {
        db,
        cfg: till, // the full TillConfig (carries branded tenantId/locationId + nodeId) — pass it verbatim, as mountJoinApi does at :1475
        readMembership: () => readNodeMembership(db),
        pairingMode,
      },
      log,
    );
```

`till` already carries `nodeId` (it is the pull reply's `deps.cfg.nodeId`, same as `till-api.ts:844`), `pairingMode` is in scope from `:1447`, and `readNodeMembership` is imported (`:13`) and used the same way at `:1301`/`:1413`.

- [ ] **Step 6: Header comment on `print-agent-session.ts`**

If its header claims the agent surface never touches the join/pairing mechanism, update that one line: the knock and status routes are unauthenticated-or-pending and do NOT go through `requireAgent`; the jobs/result routes still do.

- [ ] **Step 7: Run the package**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm --filter @waitron/server lint typecheck
pnpm typecheck
pnpm format:check
```

Expected: PASS at the floor; whole-workspace typecheck green (Tasks 3–5's consumers now resolve).

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -s -m "feat(server): agent knock/status/accept over the shared join mechanism; servers+nodeId on the pull; enrol/codes routes retired"
```

---

### Task 7: Dashboard — the pending-agents list, Accept/Deny, pairing control

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (+ `.test.ts`), `apps/dashboard/src/screens/printers-screen.ts` (+ `.test.ts` and its a11y suite), `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`

**Interfaces:**
- Consumes: the existing shared client methods `joinRequests("print_agent")`, `joinChallenge(id)`, `denyJoinRequest(id)`, `pairingMode()`, `openPairingMode()`, `closePairingMode()`; the `JoinRequestRow` (no number) and `PairingModeState` types.
- Produces: `acceptPrintAgentJoinRequest(id, { choice }): Promise<void>` on the client; the printers screen renders the agent join queue.

- [ ] **Step 1: Client method + failing test**

`apps/dashboard/src/api/client.ts` — add beside `acceptDeviceJoinRequest`:

```ts
  /** Accept a print agent's ask-to-join: POST the chosen number to the print-agent accept route. A
   * wrong choice comes back device.join_mismatch (the row is already gone) — the screen treats the row
   * as terminal, exactly as the device accept does. */
  async acceptPrintAgentJoinRequest(id: string, input: { choice: string }): Promise<void> {
    await this.#post(`/management-api/print-agent-join-requests/${id}/accept`, input);
  }
```

(Match the file's real request helper — `#post`/`postJson`/whatever `acceptDeviceJoinRequest` uses.) Add a `client.test.ts` case asserting the method hits that path with `{ choice }`.

- [ ] **Step 2: Retire the generate-code UI, add the join queue**

`printers-screen.ts` — the pattern to copy is `devices-screen.ts` (`#openRequest`/`#deny`/`#accept`/`#renderPairing`/`#renderJoinRequest`/`#renderAcceptDialog`). The agent accept dialog is SIMPLER than the device one — it has NO profile/station/register pickers, only the three number buttons.

- Remove the `#generateCode`/`generatedCode` shown-once state and its render, AND delete the now-unused `createAgentCode` client method (`api/client.ts:1995-1997`) and its client test (`client.test.ts:2034-2038`). Grep `createAgentCode` and `generateCode` to catch every reference.
- Add state: `pairing: PairingModeState | null`, `pendingJoins: JoinRequestRow[]`, `openRequestId: string | null`, `challenges: Record<string, string[]>`, `armedDenyId: string | null`, `submitting: boolean`. On load, fetch `joinRequests("print_agent")` and `pairingMode()`.
- Pairing control (venue-wide holder): a toggle that calls `openPairingMode()`/`closePairingMode()` and shows `openUntil` + `refusedRecently`, mirroring the devices-screen control (resumed-plan decision 7).
- The pending list: for each row, name + a Review button; Review fetches `joinChallenge(id)` once (cache in `challenges`) and opens a dialog with three `<wt-button data-choice=${n}>` buttons; a tap calls `acceptPrintAgentJoinRequest(id, { choice })`. On `device.join_mismatch` (via `codeOf`) close the dialog and reload the queue (the row is terminal). Deny is the two-step armed confirm calling `denyJoinRequest(id)`.
- The enrolled list below shows the approved agents from `listAgents()` (unchanged) with Revoke.
- Keep the one-line operator hint: "On the computer the printer is plugged into (or from here, at `http://<that computer>:9110`), enter this server address: `<the dashboard's own origin>`."

- [ ] **Step 3: Strings + code message**

`i18n/strings.ts` — add `printers.*` keys mirroring the `devices.*` join keys (`pairing_title`, `pairing_open`, `pairing_open_until`, `pairing_close`, `pairing_refused`, `join_waiting_title`, `join_none`, `join_review`, `join_deny`, `join_deny_confirm`, `join_dialog_title`, `join_match_prompt`, `join_choice_label`), English + Spanish. Remove the now-dead generate-code keys — `printers.generate`, `printers.code_title` AND `printers.generate_title` (`:220`, `:794` — grep `printers.generate` to catch every one).
`i18n/codes.ts` — `device.join_mismatch` already has a surface-neutral message (`:256`); reuse it. If any `agent.pairing_*` code message exists, delete it.

- [ ] **Step 4: Run the dashboard package**

```bash
pnpm --filter @waitron/dashboard test:coverage
pnpm --filter @waitron/dashboard lint typecheck && pnpm format:check
```

Expected: PASS at the floor, a11y suites green (the three choice buttons carry accessible labels; the announced number requirement is the devices-screen's — the agent screen shows no number on the LIST, only in the challenge dialog).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard
git commit -s -m "feat(dashboard): print-agent join queue (Accept/Deny + pairing control); generate-code UI retired"
```

---

### Task 8: Container host — `apps/print-agent`

**Files:**
- Create: `apps/print-agent/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts` (+ test), `src/state.ts` (+ test), `src/setup-page.ts` (+ test), `src/host.ts`, `src/bin.ts`, `Dockerfile`, `.dockerignore`
- Modify: `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `scripts/english-only.test.ts`

**Interfaces:**
- Consumes: `createAgent`, `Host`, `AgentConfig`, `AgentStatus`, `RoutingTransport`/`NetworkTcpTransport`/`UsbTransport`/`TransportAdapters` from `@waitron/print-agent`.
- Produces: a runnable container that joins, follows the primary, and prints.

This task follows the OLD plan's Task 9 (`docs/superpowers/plans/2026-09-08-print-agent-process.md` Task 9) unchanged in shape — it was independent of the enrolment amendment — with these deltas from the new loop:

- The setup/status page renders the six phases including `pairing_closed` (message: "Ask the manager to switch on pairing mode in the dashboard, then wait — this agent keeps asking.") and `pending` (message: "Waiting for approval — verification code **NN**"; when the number is absent after a restart, show "Waiting for approval — restart to get a fresh code" per resumed-plan decision 4).
- `config.ts`: env `WAITRON_SERVER_URL`, `WAITRON_AGENT_NAME` (default hostname), `WAITRON_STATE_DIR` (default `/var/lib/waitron-print-agent`), `WAITRON_SETUP_PORT` (default 9110); env wins over `<state-dir>/config.json`; `""` is unset (`isUnset`) — CLAUDE.md §3, an empty connection/URL string is a real one.
- `state.ts`: `config.json` (the page writes it) and `token` (mode 0600, written atomically via a temp file + rename). `saveToken(null)` unlinks it.
- `host.ts`: assemble the `Host` from `config`/`state`, `fetch` (global), `RoutingTransport` over the real adapters (`NetworkTcpTransport`, and `UsbTransport` on `/dev/usb/lp0` when present), `Date.now`, a real `sleep`, a small structured logger, and the `status` callback the page reads.
- `bin.ts`: build the host, `createAgent({ host }).start()`, and serve the Hono setup page (published on the LAN by default; a venue that wants loopback changes the compose publish line).
- `Dockerfile`: node 24 alpine, esbuild bundle to `dist/print-agent.js` (mirror `apps/server`'s bundling), the state dir a named volume, a USB printer via `--device /dev/usb/lp0`.
- Register the new workspace member exactly as the old plan's Task 1 registered `@waitron/print-agent`: add `apps/print-agent` (its package name) to `scripts/changed-scope.mjs`'s light bin and the matching `.github/workflows/ci.yml` exclusion, and add its short name to `scripts/english-only.test.ts`'s `GENERIC_PACKAGES` pin if apps are scanned (they are not — confirm; `apps/*` is out of english-only scope, so likely no change, but the CI-shard registration IS required or `scripts/ci-workflow.test.mjs` fails).

Follow the old Task 9's step-by-step TDD (config precedence; the 0600 atomic token write; the setup page's save and per-phase rendering via Hono `app.request` with no listener) verbatim, adjusting only the phase set above. Coverage floor 90/90/85/85.

Commit: `git commit -s -m "feat(print-agent): container host — env/state config, LAN setup page, esbuild bundle, Dockerfile"`

- [ ] Execute the old plan's Task 9 steps with the deltas above, then verify: `pnpm --filter @waitron/print-agent-host test:coverage lint typecheck && pnpm typecheck && pnpm format:check && pnpm vitest run scripts/ci-workflow.test.mjs scripts/english-only.test.ts`. (Use the real package name you chose for `apps/print-agent`.)

---

### Task 9: End to end — join → accept → pull → bytes → done; revoke → unauthorized

**Files:**
- Create: `apps/server/src/print-agent-e2e.test.ts`

**Interfaces:**
- Consumes: `mountPrintApi` + `mountJoinApi` + `createPairingMode` (real, on PGlite), `createAgent` + `fakeHost` (from `@waitron/print-agent` and its `./testing/fake-host.js`), `enqueuePrintJob` (`@waitron/printing`), a loopback TCP listener as the printer.

- [ ] **Step 1: Write the e2e** (packages never import apps — this lives in `apps/server`)

The flow, driving the REAL server through Hono `app.request` routed into the agent's `host.fetch`:

```ts
// 1. Boot: migrate a PGlite db, seed a tenant + location + node, mount print-api + join-api with a
//    createPairingMode() holder; open the window (pairingMode.open()).
// 2. A loopback TCP server (net.createServer) captures bytes; register a network_tcp printer at its host:port.
// 3. fakeHost whose fetch routes `${base}${path}` into app.request; config = { serverUrl: base, name: "e2e" };
//    transport = RoutingTransport over a real NetworkTcpTransport.
// 4. agent.runOnce() → JOINS (window open) → phase pending; capture the verificationNumber from host.statuses.
// 5. As admin (a printer.manage management session): GET the shared list (kind=print_agent) and ASSERT the
//    number is ABSENT from the payload; GET the challenge; POST the agent accept with the matching number.
// 6. agent.runOnce() → status approved → pull → but there is no job yet: assert phase running, no bytes.
// 7. enqueuePrintJob for that printer; agent.runOnce() → the bytes land on the loopback listener; the job is `done`.
// 8. Revoke the agent (POST /management-api/print-agents/:id/revoke); agent.runOnce() → phase unauthorized,
//    token cleared, and a subsequent runOnce claims nothing (halted).
```

Assert: bytes received equal the enqueued payload; the job row is `done`; the list payload never carried the number; post-revoke the agent is `unauthorized` and pulls nothing.

- [ ] **Step 2: Run**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- print-agent-e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/print-agent-e2e.test.ts
git commit -s -m "test(server): print-agent end to end — join, accept, pull, print, done; revoke halts"
```

---

### Task 10: Docs — landing notes

**Files:**
- Modify: `docs/backlog.md` (Track H item 1 + the printing/hardware surface section), the two specs' status lines

- [ ] **Step 1: Update the backlog**

In `docs/backlog.md` Track H item 1: record that the print-agent process LANDED (join-and-accept over the shared `join_requests` mechanism; the container host; the e2e), the `print_agent_pairing_codes` table and `generateAgentCode`/`enrolAgent`/enrol+codes routes retired, and clear the "BLOCKED on device enrolment" note. Move item 1 to done; leave items 2 (virtual PDF + retention), 3 (un-pin IP printers), 4 (SumUp) as the next work. Update the "No agent PROCESS" line in the printing/hardware surface section.

- [ ] **Step 2: Update the spec status lines**

Add a dated pointer to both specs' status lines: implemented on `feat/print-agent-process`, the enrolment per device-join §7 (shared `join_requests`), superseding the base design's §2.3 and the old plan's Tasks 5–8. Historical text stays; add a pointer, don't rewrite (CLAUDE.md §6).

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md docs/superpowers/specs/2026-09-08-print-agent-process-design.md docs/superpowers/specs/2026-09-08-device-join-and-accept-design.md
git commit -s -m "docs(backlog): print-agent process LANDED — join-and-accept over the shared join_requests mechanism"
```

---

## Self-review notes

- **Spec coverage.** Base spec §2.1 (client, router, transports, loop, host) → Tasks 1–2 (+ landed #282). §2.2 (container host) → Task 8. §2.3 as amended by device-join §7 (join_requests, window, challenge, accept, retire pairing) → Tasks 3–7. §4 loop (with the status-poll change) → Task 2. §5 security (one secret, window+cap, pending useless, `printer.manage`) → Tasks 5–7. §6 testing → Tasks 1,2,5,6,9. §7 out-of-scope stays out (virtual PDF, un-pin, SumUp). Device-join §7.1–7.4 all land in Tasks 5–7.
- **No new error codes** — the flow reuses `device.*` join codes + `agent.unauthorized`, deletes `agent.pairing_*`. Confirmed against `apps/server/src/errors.ts:1104-1124` and `join-api.ts:64` / `device-api.ts:139-143`.
- **Type consistency.** `JoinReply.token`/`verificationNumber` (Task 1) → the agent stores `token`, displays `verificationNumber` (Task 2) → the route returns `{ token: ${joinId}.${secret}, verificationNumber }` (Task 6). `readAgentJoinStatus(tx, cfg, joinId, secret)` (Task 5) ← the status route splits the Bearer (Task 6). `acceptPrintAgentJoinRequest → AgentAcceptResult` (Task 5) ← the accept route throws `device.join_mismatch` on `{ ok: false }` (Task 6).
- **Tenant scoping** proven by two-tenant real-PG probes as `app_user` in Tasks 5 and 6 (accept, status, the shared by-id routes).
- **Grants:** deny deletes a `join_requests` row (`app_user` holds DELETE there); accept inserts a `print_agents` row (`app_user` holds INSERT); no grant is widened.

2026-09-12 update: [Printer configuration tabs](../specs/2026-09-12-printer-configuration-tabs.md)
replaces manual pairing controls with the Add dialog lifecycle and uses Disable/Enable for retained agents.
