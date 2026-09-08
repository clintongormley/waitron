# Print Agent Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone print-agent process (a db-free package behind a `Host` seam + a container host) that joins a venue with admin accept/deny, follows the primary, pulls its printers' jobs and pushes the bytes to USB/IP printers.

**Architecture:** `packages/print-agent` holds the wire client, the follow-the-primary router, the loop and the two hardware transports (moved out of `packages/printing`); `apps/print-agent` is the container host (env/state-dir config, a LAN setup/status page, esbuild bundle, Dockerfile). Server side, join-and-accept replaces the pairing code: `print_agents` gains `approved_at` + `join_code`, `print_agent_pairing_codes` is dropped, `authenticateAgent` answers `agent.pending` for an unapproved row, and the job-pull reply carries the venue's server list.

**Tech Stack:** TypeScript (ESM, Node 24), Hono (setup page + routes), Drizzle (schema/migration), Vitest (PGlite + real Postgres via `@waitron/db/testing`), esbuild, Lit (dashboard).

**Spec:** `docs/superpowers/specs/2026-09-08-print-agent-process-design.md`

> **⚠ Amended 2026-09-08, after this plan was written — do not execute Tasks 2, 4, 5, 6, 7, 8 or 10
> as written.** The owner extended join-and-accept to devices and chose one mechanism for both
> surfaces
> ([2026-09-08-device-join-and-accept-design.md](../specs/2026-09-08-device-join-and-accept-design.md)
> §7). Four changes reach this plan:
>
> 1. The verification code is a **two-digit number the admin picks out of three**, not a 4-character
>    Crockford string. `join_code` → `verification_number`; `JoinReply.verificationCode`, the agent
>    status page and every `"ABCD"` fixture change with it (Tasks 2, 4, 5, 6, 7, 8, 10).
> 2. `GET /management-api/print-agents` **must not return the number**. A `…/:id/challenge` route
>    returns three shuffled numbers, no decoy equal to any other pending request's real number across
>    both surfaces; accept takes `{ choice }` and a wrong choice denies the row (Tasks 6, 7, 8).
> 3. `POST /print-api/agent/join` is gated on a **venue-wide fifteen-minute pairing window** held in
>    memory on the primary (`agent.pairing_closed`); a refused agent retries with backoff, which is
>    distinct from denied (Tasks 4, 6, 7, 8).
> 4. Recommended and pending the owner's call: pending agents move to `print_agent_join_requests`
>    (`local`), which retires both the `active`-flag overload and `agent.pending` (Tasks 5, 6, 7).
>
> Tasks 1, 3, 9 and 11 are unaffected. Regenerate the rest from the amended spec before executing.

## Global Constraints

- Branch `feat/print-agent` in a worktree made with `python3 ~/workspace/tools/worktree.py new waitron feat/print-agent` (CLAUDE.md §6). Every commit `git commit -s`.
- `@waitron/print-agent` has **no workspace dependencies** and never imports `@waitron/db` or `@waitron/printing` (spec §2.1).
- Every `verify` step runs `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test:coverage` and `pnpm format:check` (root) — coverage floors `90/90/85/85` for the new package and app, `98/98/98/95` for `packages/db`.
- Error codes name the domain concept (`agent.*`), are declared in `packages/printing/src/errors.ts`, and every throwing file imports `./errors.js` (CLAUDE.md §3). The deleted `agent.pairing_*` codes are removed outright — nothing is shipped; the commit says so.
- No SQL by string concatenation (Drizzle `sql` tags / query builder only). Every read scopes to `cfg.tenantId` explicitly, by-id reads included (CLAUDE.md §3).
- Pre-production: the schema change is a regenerated core migration, no backfill (CLAUDE.md §3). Never widen a grant to pass a test.
- Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` and Docker; run `pnpm reap` first if a previous run was interrupted (CLAUDE.md §4).
- Setup/status page: published on the LAN by default; shows no secret, carries no job (spec §2.2/§5).
- Shared files (spec §8): `apps/server/src/boot.ts` (one dep at the `mountPrintApi` call), `packages/db` schema + one regenerated migration, `packages/db/src/classification.ts`, the dashboard printers screen + client + strings. Rebase per CLAUDE.md §3's migration recipe if `main` moves under them.
- Comments state the invariant and the non-obvious why, never the history (CLAUDE.md §1); thin on touch, no sweeps.

---

## File map

| Path | Responsibility |
| --- | --- |
| `packages/print-agent/package.json`, `tsconfig.json`, `vitest.config.ts` | the db-free package scaffold (Task 1) |
| `packages/print-agent/src/transport.ts` (+ `.test.ts`) | `PrintTransport`, `PrinterTarget`, `Transport`, `NetworkTcpTransport`, `UsbTransport`, `RoutingTransport`, `FakeSink` — moved verbatim (Task 1) |
| `packages/print-agent/src/client.ts` (+ `.test.ts`) | `createClient`: `probeNode`, `join`, `pullJobs`, `report` over an injected `fetch`, typed results (Task 2) |
| `packages/print-agent/src/router.ts` (+ `.test.ts`) | `Router`: the server list, the probe round, `current` (Task 3) |
| `packages/print-agent/src/host.ts` | the `Host` seam, `AgentConfig`, `AgentStatus` (Task 4) |
| `packages/print-agent/src/agent.ts` (+ `.test.ts`) | `createAgent`: `runOnce`, `start`, `stop` (Task 4) |
| `packages/print-agent/src/testing/fake-host.ts` | the in-memory `Host` the loop suite and the e2e use (Task 4) |
| `packages/print-agent/src/index.ts` | the barrel (Tasks 1–4) |
| `packages/db/src/schema/print-agents.ts`, `src/index.ts`, `src/classification.ts`, `drizzle/0008_*` | `approved_at` + `join_code`; pairing table dropped (Task 5) |
| `packages/printing/src/agent.ts`, `errors.ts` (+ tests) | `joinAgent`, `acceptAgent`, `denyAgent`, `authenticateAgent` (pending); codes (Task 6) |
| `apps/server/src/print-api.ts` (+ tests), `boot.ts` | join/accept/deny/list; `servers` + `nodeId` on the pull (Task 7) |
| `apps/dashboard/src/api/client.ts`, `screens/printers-screen.ts`, `i18n/strings.ts` (+ tests) | the pending list with Accept/Deny (Task 8) |
| `apps/print-agent/*` | the container host: `config.ts`, `state.ts`, `setup-page.ts`, `host.ts`, `bin.ts`, `Dockerfile` (Task 9) |
| `apps/server/src/print-agent-e2e.test.ts` | join → accept → enqueue → pull → bytes on a loopback printer → done; revoke → unauthorized (Task 10) |
| `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `scripts/english-only.test.ts` | the three places a new workspace member must be registered (Tasks 1 and 9) |
| `docs/backlog.md`, the spec's status line | landing notes (Task 11) |

Tasks 2–4 depend only on Task 1; Tasks 5–8 are independent of Tasks 2–4. Task 9 needs 4; Task 10 needs 4 and 7.

---

### Task 1: Scaffold `@waitron/print-agent` and move the transports into it

**Files:**
- Create: `packages/print-agent/package.json`, `packages/print-agent/tsconfig.json`, `packages/print-agent/vitest.config.ts`, `packages/print-agent/src/index.ts`
- Move: `packages/printing/src/transport.ts` → `packages/print-agent/src/transport.ts`; `packages/printing/src/transport.test.ts` → `packages/print-agent/src/transport.test.ts`
- Modify: `packages/printing/package.json` (add the dependency), `packages/printing/src/printers.ts:56-57`, `packages/printing/src/runtime.ts:1-4`, `packages/printing/src/index.ts:24-25`, `packages/printing/src/runtime.test.ts:11-12`, `packages/printing/src/runtime.race.test.ts:10-11`, `packages/printing/src/runtime.reclaim.test.ts:10` (their `./transport.js` imports), `packages/db/src/english-only.ts:14-40`, `scripts/english-only.test.ts:75-106`, `scripts/changed-scope.mjs:278-314`, `.github/workflows/ci.yml:1112-1135, 1181-1204`

**Interfaces:**
- Produces (barrel `@waitron/print-agent`): `PrintTransport = "usb" | "network_tcp" | "cloud_poll"`, `PrinterTarget`, `Transport`, `NetworkTcpTransport`, `UsbTransport`, `RoutingTransport`, `TransportAdapters`, `FakeSink`, `DEFAULT_TCP_TIMEOUT_MS`, `NetworkTcpOptions` — exactly today's `packages/printing/src/transport.ts` exports plus the `PrintTransport` union.

- [ ] **Step 1: Create the package scaffold**

`packages/print-agent/package.json`:

```json
{
  "name": "@waitron/print-agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/print-agent/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src"]
}
```

`packages/print-agent/vitest.config.ts`:

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Hermetic: every suite here runs against fakes (a loopback TCP listener, a temp file, a fake fetch,
// an in-memory Host). No database, no container, no hardware.
export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
```

- [ ] **Step 2: Move the transport module and its test**

```bash
git mv packages/printing/src/transport.ts packages/print-agent/src/transport.ts
git mv packages/printing/src/transport.test.ts packages/print-agent/src/transport.test.ts
```

In `packages/print-agent/src/transport.ts` replace the line `import type { PrintTransport } from "./printers.js";` with the union itself, placed above `PrinterTarget`:

```ts
/** How a printer is reached — the `print_transport` pgEnum on the server (packages/db schema/printers.ts).
 * Declared here, in the db-free package, so the agent and the server share one wire vocabulary. */
export type PrintTransport = "usb" | "network_tcp" | "cloud_poll";
```

Create `packages/print-agent/src/index.ts`:

```ts
export {
  DEFAULT_TCP_TIMEOUT_MS,
  FakeSink,
  NetworkTcpTransport,
  RoutingTransport,
  UsbTransport,
} from "./transport.js";
export type {
  NetworkTcpOptions,
  PrintTransport,
  PrinterTarget,
  Transport,
  TransportAdapters,
} from "./transport.js";
```

- [ ] **Step 3: Point `@waitron/printing` at the new package**

`packages/printing/package.json` dependencies: add `"@waitron/print-agent": "workspace:*"`.

`packages/printing/src/printers.ts:56-57` — replace the `PrintTransport` declaration with a re-export:

```ts
/** How a printer is reached — the `print_transport` pgEnum; the union lives in `@waitron/print-agent`. */
export type { PrintTransport } from "@waitron/print-agent";
```

and add `import type { PrintTransport } from "@waitron/print-agent";` at the top of `printers.ts` (the `REQUIRED_FIELDS` record still names the type).

`packages/printing/src/runtime.ts:3-4` → `import type { PrintTransport, PrinterTarget, Transport } from "@waitron/print-agent";`

`packages/printing/src/index.ts:24-25` — delete the two `./transport.js` lines and add:

```ts
// The transports live in @waitron/print-agent (the db-free agent package); re-exported so the
// server-side suites keep one import for `FakeSink` and the runtime's `Transport` type.
export { FakeSink } from "@waitron/print-agent";
export type { PrinterTarget, Transport } from "@waitron/print-agent";
```

In the THREE runtime suites that import it — `runtime.test.ts:11-12`, `runtime.race.test.ts:10-11`, `runtime.reclaim.test.ts:10` — replace `from "./transport.js"` with `from "@waitron/print-agent"`. (`runtime.active.test.ts` imports no transport; leave it alone.)

`packages/db/src/english-only.ts` `GENERIC_PACKAGES`: add `"print-agent",` after `"printing",`.

**`scripts/english-only.test.ts:75-106` pins that array VERBATIM AND IN ORDER**
(`expect([...GENERIC_PACKAGES]).toEqual([…])`) — add `"print-agent"` in the same position there, or
Step 5 goes red.

**Register the new member in the CI shard bins** (`scripts/changed-scope.mjs`'s own header at :274-276
says a member missing from both bins makes `scripts/ci-workflow.test.mjs` fail, and that test asserts
each member appears exactly once): add `"@waitron/print-agent"` to `LIGHT_B_PACKAGES` (:297-314,
beside `"@waitron/printing"`), and add the matching literal exclusion line to `.github/workflows/ci.yml`'s
**test-light-a** step (:1112-1135), which excludes light-b's members:
`set -- "$@" --filter "!@waitron/print-agent"`.

- [ ] **Step 4: Install and run the moved suite**

```bash
pnpm install
pnpm --filter @waitron/print-agent test:coverage
```

Expected: the transport suite passes unchanged (FakeSink / NetworkTcpTransport / UsbTransport / RoutingTransport); coverage over `transport.ts` ≥ 90.

- [ ] **Step 5: Verify the rest of the workspace still sees the transports**

```bash
pnpm --filter @waitron/print-agent lint typecheck
pnpm --filter @waitron/printing lint typecheck test:coverage
pnpm typecheck
pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/ci-workflow.test.mjs
pnpm format:check
```

Expected: all green. `errors-reachable` skips the new package (no `src/errors.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/print-agent packages/printing packages/db/src/english-only.ts scripts/english-only.test.ts scripts/changed-scope.mjs .github/workflows/ci.yml pnpm-lock.yaml
git commit -s -m "feat(print-agent): db-free package; move the transports out of @waitron/printing"
```

---

### Task 2: The wire client

**Files:**
- Create: `packages/print-agent/src/client.ts`, `packages/print-agent/src/client.test.ts`
- Modify: `packages/print-agent/src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface NodeProbe { nodeId: string; term: number | null; acceptingSales: boolean; environment: string }
export interface ServerEntry { url: string; nodeId?: string }
export interface WireJob { id: string; printerId: string; transport: PrintTransport; host: string | null; port: number | null; usbPath: string | null; payload: Uint8Array }
export interface PullReply { nodeId: string; servers: ServerEntry[]; jobs: WireJob[] }
export interface JoinReply { agentId: string; token: string; verificationCode: string }
export type JobOutcome = { status: "done" } | { status: "failed"; error: string }
export type Failure =
  | { kind: "unreachable"; detail: string }   // network error, timeout, 5xx
  | { kind: "unauthorized" }                   // 401
  | { kind: "pending" }                        // 403 agent.pending
  | { kind: "rate_limited" }                   // 429
  | { kind: "full" }                           // 409 agent.join_full
  | { kind: "bad_reply"; detail: string }      // any other status, or a body the shape check rejects
export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure }
export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
  join(url: string, name: string): Promise<Result<JoinReply>>;
  pullJobs(url: string, token: string): Promise<Result<PullReply>>;
  report(url: string, token: string, jobId: string, outcome: JobOutcome): Promise<Result<void>>;
}
export function createClient(opts: { fetch: typeof fetch; timeoutMs?: number }): AgentClient
```

- [ ] **Step 1: Write the failing tests**

`packages/print-agent/src/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

const URL_A = "http://a.test";

describe("createClient — probeNode", () => {
  it("returns the node probe on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(200, { nodeId: "n1", term: 3, acceptingSales: true, environment: "preproduction" }),
    );
    const client = createClient({ fetch: fetchImpl });
    expect(await client.probeNode(URL_A)).toEqual({
      ok: true,
      value: { nodeId: "n1", term: 3, acceptingSales: true, environment: "preproduction" },
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${URL_A}/api/node`);
  });

  it("a thrown fetch, a timeout and a 5xx are all `unreachable`", async () => {
    const thrown = createClient({ fetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
    expect(await thrown.probeNode(URL_A)).toMatchObject({ ok: false, failure: { kind: "unreachable" } });

    const never = createClient({
      fetch: vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })),
      timeoutMs: 10,
    });
    expect(await never.probeNode(URL_A)).toMatchObject({ ok: false, failure: { kind: "unreachable" } });

    const down = createClient({ fetch: vi.fn().mockResolvedValue(reply(503)) });
    expect(await down.probeNode(URL_A)).toMatchObject({ ok: false, failure: { kind: "unreachable" } });
  });

  it("a body missing acceptingSales is `bad_reply`", async () => {
    const client = createClient({ fetch: vi.fn().mockResolvedValue(reply(200, { nodeId: "n1" })) });
    expect(await client.probeNode(URL_A)).toMatchObject({ ok: false, failure: { kind: "bad_reply" } });
  });
});

describe("createClient — join", () => {
  it("POSTs { name } and returns the join reply", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(201, { agentId: "a1", token: "a1.secret", verificationCode: "ABCD" }),
    );
    const client = createClient({ fetch: fetchImpl });
    expect(await client.join(URL_A, "kitchen-pi")).toEqual({
      ok: true,
      value: { agentId: "a1", token: "a1.secret", verificationCode: "ABCD" },
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/join`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "kitchen-pi" });
  });

  it("maps 429 → rate_limited and 409 → full", async () => {
    const limited = createClient({ fetch: vi.fn().mockResolvedValue(reply(429, { code: "agent.join_rate_limited" })) });
    expect(await limited.join(URL_A, "x")).toEqual({ ok: false, failure: { kind: "rate_limited" } });
    const full = createClient({ fetch: vi.fn().mockResolvedValue(reply(409, { code: "agent.join_full" })) });
    expect(await full.join(URL_A, "x")).toEqual({ ok: false, failure: { kind: "full" } });
  });
});

describe("createClient — pullJobs", () => {
  it("sends the Bearer, decodes base64 payloads and returns servers + nodeId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(200, {
        nodeId: "n1",
        servers: [{ nodeId: "n1", url: "http://a.test", standing: "serving-primary" }],
        jobs: [
          {
            id: "j1",
            printerId: "p1",
            transport: "network_tcp",
            host: "10.0.0.9",
            port: 9100,
            usbPath: null,
            payload: Buffer.from([1, 2, 3]).toString("base64"),
          },
        ],
      }),
    );
    const client = createClient({ fetch: fetchImpl });
    const result = await client.pullJobs(URL_A, "a1.secret");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodeId).toBe("n1");
    expect(result.value.servers).toEqual([{ nodeId: "n1", url: "http://a.test" }]);
    expect(result.value.jobs[0]!.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl.mock.calls[0]![1].headers.authorization).toBe("Bearer a1.secret");
  });

  it("maps 401 → unauthorized and 403 agent.pending → pending", async () => {
    const unauth = createClient({ fetch: vi.fn().mockResolvedValue(reply(401, { code: "agent.unauthorized" })) });
    expect(await unauth.pullJobs(URL_A, "t")).toEqual({ ok: false, failure: { kind: "unauthorized" } });
    const pending = createClient({ fetch: vi.fn().mockResolvedValue(reply(403, { code: "agent.pending" })) });
    expect(await pending.pullJobs(URL_A, "t")).toEqual({ ok: false, failure: { kind: "pending" } });
  });

  it("a reply whose jobs is not an array is `bad_reply`", async () => {
    const client = createClient({ fetch: vi.fn().mockResolvedValue(reply(200, { nodeId: "n1", servers: [], jobs: "no" })) });
    expect(await client.pullJobs(URL_A, "t")).toMatchObject({ ok: false, failure: { kind: "bad_reply" } });
  });
});

describe("createClient — report", () => {
  it("POSTs the outcome to the job's result route and resolves on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(204));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.report(URL_A, "t", "j1", { status: "failed", error: "boom" })).toEqual({ ok: true, value: undefined });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/jobs/j1/result`);
    expect(JSON.parse(init.body as string)).toEqual({ status: "failed", error: "boom" });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/print-agent test -- client`
Expected: FAIL — `./client.js` does not exist.

- [ ] **Step 3: Implement `client.ts`**

```ts
import type { PrintTransport } from "./transport.js";

export interface NodeProbe {
  nodeId: string;
  term: number | null;
  acceptingSales: boolean;
  environment: string;
}
export interface ServerEntry {
  url: string;
  nodeId?: string;
}
export interface WireJob {
  id: string;
  printerId: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  usbPath: string | null;
  payload: Uint8Array;
}
export interface PullReply {
  nodeId: string;
  servers: ServerEntry[];
  jobs: WireJob[];
}
export interface JoinReply {
  agentId: string;
  token: string;
  verificationCode: string;
}
export type JobOutcome = { status: "done" } | { status: "failed"; error: string };

/** Why a call did not succeed. Network conditions are VALUES here, never throws: the loop decides
 * what each one means for its phase (spec §4), and nothing about a dead server may crash the agent. */
export type Failure =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized" }
  | { kind: "pending" }
  | { kind: "rate_limited" }
  | { kind: "full" }
  | { kind: "bad_reply"; detail: string };
export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
  join(url: string, name: string): Promise<Result<JoinReply>>;
  pullJobs(url: string, token: string): Promise<Result<PullReply>>;
  report(url: string, token: string, jobId: string, outcome: JobOutcome): Promise<Result<void>>;
}

/** Per-request deadline: a probe on a dead box must settle fast (the till's 3 s). */
export const DEFAULT_TIMEOUT_MS = 3_000;

const fail = <T>(failure: Failure): Result<T> => ({ ok: false, failure });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** The status → failure fold every call shares. A 5xx is "unreachable" (the node is there but not
 * serving); the four client-fault statuses map to their own kinds; anything else is a bad reply. */
async function failureOf(res: Response): Promise<Failure> {
  if (res.status >= 500) return { kind: "unreachable", detail: `HTTP ${res.status}` };
  if (res.status === 401) return { kind: "unauthorized" };
  // 403 on `/print-api/agent/*` is only ever `agent.pending`: the surface's other 403 codes
  // (`authorization.not_permitted`, `person.suspended`, print-api.ts:135-136) belong to the
  // management routes, which an agent token never reaches.
  if (res.status === 403) return { kind: "pending" };
  if (res.status === 429) return { kind: "rate_limited" };
  if (res.status === 409) return { kind: "full" };
  return { kind: "bad_reply", detail: `HTTP ${res.status}` };
}

export function createClient(opts: { fetch: typeof fetch; timeoutMs?: number }): AgentClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(
    url: string,
    init: RequestInit & { headers?: Record<string, string> },
  ): Promise<Result<Response>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await opts.fetch(url, { ...init, signal: controller.signal });
      return res.ok ? ok(res) : fail(await failureOf(res));
    } catch (error) {
      return fail({ kind: "unreachable", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(res: Response): Promise<Result<unknown>> {
    try {
      return ok(await res.json());
    } catch {
      return fail({ kind: "bad_reply", detail: "not JSON" });
    }
  }

  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

  return {
    async probeNode(url) {
      const res = await call(`${url}/api/node`, { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) return res;
      const body = await json(res.value);
      if (!body.ok) return body;
      const b = body.value;
      if (!isRecord(b) || typeof b.nodeId !== "string" || typeof b.acceptingSales !== "boolean" || typeof b.environment !== "string") {
        return fail({ kind: "bad_reply", detail: "node probe shape" });
      }
      return ok({
        nodeId: b.nodeId,
        term: typeof b.term === "number" ? b.term : null,
        acceptingSales: b.acceptingSales,
        environment: b.environment,
      });
    },

    async join(url, name) {
      const res = await call(`${url}/print-api/agent/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return res;
      const body = await json(res.value);
      if (!body.ok) return body;
      const b = body.value;
      if (!isRecord(b) || typeof b.agentId !== "string" || typeof b.token !== "string" || typeof b.verificationCode !== "string") {
        return fail({ kind: "bad_reply", detail: "join reply shape" });
      }
      return ok({ agentId: b.agentId, token: b.token, verificationCode: b.verificationCode });
    },

    async pullJobs(url, token) {
      const res = await call(`${url}/print-api/agent/jobs`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      });
      if (!res.ok) return res;
      const body = await json(res.value);
      if (!body.ok) return body;
      const b = body.value;
      if (!isRecord(b) || typeof b.nodeId !== "string" || !Array.isArray(b.servers) || !Array.isArray(b.jobs)) {
        return fail({ kind: "bad_reply", detail: "pull reply shape" });
      }
      const servers: ServerEntry[] = [];
      for (const s of b.servers) {
        if (isRecord(s) && typeof s.url === "string") {
          servers.push(typeof s.nodeId === "string" ? { url: s.url, nodeId: s.nodeId } : { url: s.url });
        }
      }
      const jobs: WireJob[] = [];
      for (const j of b.jobs) {
        if (!isRecord(j) || typeof j.id !== "string" || typeof j.printerId !== "string" || typeof j.transport !== "string" || typeof j.payload !== "string") {
          return fail({ kind: "bad_reply", detail: "job shape" });
        }
        jobs.push({
          id: j.id,
          printerId: j.printerId,
          transport: j.transport as PrintTransport,
          host: typeof j.host === "string" ? j.host : null,
          port: typeof j.port === "number" ? j.port : null,
          usbPath: typeof j.usbPath === "string" ? j.usbPath : null,
          payload: new Uint8Array(Buffer.from(j.payload, "base64")),
        });
      }
      return ok({ nodeId: b.nodeId, servers, jobs });
    },

    async report(url, token, jobId, outcome) {
      const res = await call(`${url}/print-api/agent/jobs/${jobId}/result`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(outcome),
      });
      return res.ok ? ok(undefined) : res;
    },
  };
}
```

Add to `index.ts`:

```ts
export { DEFAULT_TIMEOUT_MS, createClient } from "./client.js";
export type { AgentClient, Failure, JobOutcome, JoinReply, NodeProbe, PullReply, Result, ServerEntry, WireJob } from "./client.js";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/print-agent test:coverage`
Expected: PASS; `client.ts` ≥ 90 lines.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @waitron/print-agent lint typecheck && pnpm format:check
git add packages/print-agent
git commit -s -m "feat(print-agent): wire client — probe, join, pull, report as typed results"
```

---

### Task 3: The follow-the-primary router

**Files:**
- Create: `packages/print-agent/src/router.ts`, `packages/print-agent/src/router.test.ts`
- Modify: `packages/print-agent/src/index.ts`

**Interfaces:**
- Consumes: `AgentClient["probeNode"]`, `ServerEntry`, `NodeProbe` (Task 2)
- Produces:

```ts
export type ServerState = "unknown" | "unreachable" | "standby" | "primary";
export interface TrackedServer { url: string; nodeId?: string; state: ServerState; term: number | null }
export interface RouterOptions { configuredUrl: string; environment?: string; probe: AgentClient["probeNode"] }
export class Router {
  constructor(opts: RouterOptions)
  get current(): string
  get environment(): string | undefined   // fixed by the first successful probe when not given
  servers(): TrackedServer[]
  merge(list: ServerEntry[]): void         // the configured url is never dropped
  probe(): Promise<{ moved: boolean; anyAccepting: boolean }>
}
```

- [ ] **Step 1: Write the failing tests**

`packages/print-agent/src/router.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { NodeProbe, Result } from "./client.js";
import { Router } from "./router.js";

const A = "http://a.test";
const B = "http://b.test";

function probeFrom(table: Record<string, Partial<NodeProbe> | "down">) {
  return vi.fn(async (url: string): Promise<Result<NodeProbe>> => {
    const row = table[url];
    if (row === undefined || row === "down") return { ok: false, failure: { kind: "unreachable", detail: "x" } };
    return {
      ok: true,
      value: { nodeId: row.nodeId ?? url, term: row.term ?? null, acceptingSales: row.acceptingSales ?? false, environment: row.environment ?? "preproduction" },
    };
  });
}

describe("Router", () => {
  it("starts on the configured url and stays there while it accepts sales", async () => {
    const router = new Router({ configuredUrl: A, probe: probeFrom({ [A]: { acceptingSales: true } }) });
    expect(router.current).toBe(A);
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: true });
    expect(router.current).toBe(A);
  });

  it("moves to the server that accepts sales, the highest term on a tie", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({ [A]: { acceptingSales: true, term: 3 }, [B]: { acceptingSales: true, term: 5 } }),
    });
    router.merge([{ url: B }]);
    expect(await router.probe()).toEqual({ moved: true, anyAccepting: true });
    expect(router.current).toBe(B);
  });

  it("keeps current when nobody accepts (no giving up, no failure count)", async () => {
    const probe = probeFrom({ [A]: "down", [B]: { acceptingSales: false } });
    const router = new Router({ configuredUrl: A, probe });
    router.merge([{ url: B }]);
    for (let i = 0; i < 3; i += 1) {
      expect(await router.probe()).toEqual({ moved: false, anyAccepting: false });
    }
    expect(router.current).toBe(A);
    expect(router.servers().map((s) => s.state)).toEqual(["unreachable", "standby"]);
  });

  it("skips a server in another environment", async () => {
    const router = new Router({
      configuredUrl: A,
      environment: "preproduction",
      probe: probeFrom({ [A]: { acceptingSales: false }, [B]: { acceptingSales: true, environment: "production" } }),
    });
    router.merge([{ url: B }]);
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: false });
    expect(router.current).toBe(A);
  });

  it("fixes the environment from the first successful probe when none was given", async () => {
    const router = new Router({ configuredUrl: A, probe: probeFrom({ [A]: { acceptingSales: true, environment: "production" } }) });
    expect(router.environment).toBeUndefined();
    await router.probe();
    expect(router.environment).toBe("production");
  });

  it("merge never drops the configured url, dedupes by origin and drops non-http urls", () => {
    const router = new Router({ configuredUrl: A, probe: probeFrom({}) });
    router.merge([{ url: `${B}/`, nodeId: "b" }, { url: B }, { url: "mailto:x@y" }, { url: "not a url" }]);
    expect(router.servers().map((s) => s.url)).toEqual([A, B]);
    router.merge([{ url: B }]);
    expect(router.servers().map((s) => s.url)).toEqual([A, B]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/print-agent test -- router`
Expected: FAIL — `./router.js` does not exist.

- [ ] **Step 3: Implement `router.ts`**

```ts
import type { AgentClient, ServerEntry } from "./client.js";

export type ServerState = "unknown" | "unreachable" | "standby" | "primary";

export interface TrackedServer {
  url: string;
  nodeId?: string;
  state: ServerState;
  term: number | null;
}

export interface RouterOptions {
  configuredUrl: string;
  /** The environment the agent joined against. Unset until the first successful probe fixes it. */
  environment?: string;
  probe: AgentClient["probeNode"];
}

/**
 * The till's follow-the-primary rule (till-reroute design §4.1), for a Node process: probe every known
 * server, point `current` at the one accepting sales (highest term on a tie), and when none does keep
 * `current` and keep probing — there is no giving up and no failure count. The configured address is
 * always a member, so a bad server list can never strand the agent. A server answering another
 * environment is skipped: an agent must never pull a preproduction venue's jobs from a production node
 * or the reverse (CLAUDE.md §5).
 */
export class Router {
  #servers: TrackedServer[] = [];
  #current: string;
  #environment: string | undefined;
  readonly #configured: string;
  readonly #probe: AgentClient["probeNode"];

  constructor(opts: RouterOptions) {
    this.#configured = new URL(opts.configuredUrl).origin;
    this.#current = this.#configured;
    this.#environment = opts.environment;
    this.#probe = opts.probe;
    this.merge([]);
  }

  get current(): string {
    return this.#current;
  }
  get environment(): string | undefined {
    return this.#environment;
  }
  servers(): TrackedServer[] {
    return this.#servers.map((s) => ({ ...s }));
  }

  /** Merge a server list into the known set: by origin, the configured address first and never dropped,
   * earlier state kept for a server already known, malformed and non-http entries ignored. */
  merge(list: ServerEntry[]): void {
    const byUrl = new Map(this.#servers.map((s) => [s.url, s]));
    const next: TrackedServer[] = [];
    const push = (entry: ServerEntry): void => {
      let origin: string;
      try {
        const parsed = new URL(entry.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        origin = parsed.origin;
      } catch {
        return;
      }
      if (next.some((n) => n.url === origin)) return;
      const prev = byUrl.get(origin);
      next.push({
        url: origin,
        nodeId: entry.nodeId ?? prev?.nodeId,
        state: prev?.state ?? "unknown",
        term: prev?.term ?? null,
      });
    };
    push({ url: this.#configured });
    for (const entry of list) push(entry);
    this.#servers = next;
  }

  /** One round: probe every server in parallel, then apply the rule. */
  async probe(): Promise<{ moved: boolean; anyAccepting: boolean }> {
    await Promise.all(
      this.#servers.map(async (s) => {
        const result = await this.#probe(s.url);
        if (!result.ok) {
          s.state = "unreachable";
          s.term = null;
          return;
        }
        const node = result.value;
        this.#environment ??= node.environment;
        s.nodeId = node.nodeId;
        s.term = node.term;
        s.state = node.acceptingSales && node.environment === this.#environment ? "primary" : "standby";
      }),
    );
    const accepting = this.#servers.filter((s) => s.state === "primary");
    if (accepting.length === 0) return { moved: false, anyAccepting: false };
    const best = accepting.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
    const moved = best.url !== this.#current;
    this.#current = best.url;
    return { moved, anyAccepting: true };
  }
}
```

Add to `index.ts`: `export { Router } from "./router.js"; export type { RouterOptions, ServerState, TrackedServer } from "./router.js";`

- [ ] **Step 4: Run the tests; prove the two guards by deletion**

Run: `pnpm --filter @waitron/print-agent test:coverage` → PASS.
Then temporarily delete `&& node.environment === this.#environment` → the environment test fails; restore. Temporarily delete `push({ url: this.#configured });` → the merge test fails; restore. Record both in the commit message.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @waitron/print-agent lint typecheck && pnpm format:check
git add packages/print-agent
git commit -s -m "feat(print-agent): follow-the-primary router (environment skip and configured-url pin proven by deletion)"
```

---

### Task 4: The `Host` seam and the loop

**Files:**
- Create: `packages/print-agent/src/host.ts`, `packages/print-agent/src/agent.ts`, `packages/print-agent/src/agent.test.ts`, `packages/print-agent/src/testing/fake-host.ts`
- Modify: `packages/print-agent/src/index.ts`

**Interfaces:**
- Consumes: `createClient`/`AgentClient` (Task 2), `Router` (Task 3), `Transport`/`PrinterTarget` (Task 1)
- Produces:

```ts
// host.ts
export interface AgentConfig { serverUrl: string; name: string; environment?: string }
export type AgentPhase = "unconfigured" | "pending" | "running" | "unauthorized" | "unreachable";
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
export function fakeHost(overrides?: Partial<{ config: AgentConfig | null; token: string | null; transport: Transport; fetch: typeof fetch }>): Host & { statuses: AgentStatus[]; logs: string[]; sleeps: number[] }
```

- [ ] **Step 1: Write `host.ts`** (types only — the code above, with this header)

```ts
import type { Transport } from "./transport.js";

/**
 * The seam between the agent's logic and the machine it runs on (spec §2.1). A container host reads
 * env + a state directory and serves a setup page; a native till host later reads a settings screen.
 * The loop never touches the filesystem, a clock, a timer or a logger directly — only this.
 */
```

- [ ] **Step 2: Write the fake host**

`packages/print-agent/src/testing/fake-host.ts`:

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

- [ ] **Step 3: Write the failing loop tests**

`packages/print-agent/src/agent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAgent } from "./agent.js";
import type { AgentClient, Failure, NodeProbe, PullReply, Result } from "./client.js";
import { fakeHost } from "./testing/fake-host.js";
import { FakeSink } from "./transport.js";

const A = "http://a.test";
const CONFIG = { serverUrl: A, name: "kitchen-pi" };
const primary: NodeProbe = { nodeId: "n1", term: 1, acceptingSales: true, environment: "preproduction" };
const okR = <T>(value: T): Result<T> => ({ ok: true, value });
const failR = <T>(failure: Failure): Result<T> => ({ ok: false, failure });

/** A scripted client: each method is a vi.fn you set per test. */
function client(over: Partial<AgentClient> = {}): AgentClient {
  return {
    probeNode: vi.fn(async () => okR(primary)),
    join: vi.fn(async () => okR({ agentId: "a1", token: "a1.s", verificationCode: "ABCD" })),
    pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [] })),
    report: vi.fn(async () => okR(undefined)),
    ...over,
  };
}

describe("createAgent — phases", () => {
  it("unconfigured: reports the phase and does nothing else", async () => {
    const host = fakeHost({ config: null });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("unconfigured");
    expect(c.probeNode).not.toHaveBeenCalled();
  });

  it("no token: joins at the current server, saves the token, reports pending with the code", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(c.join).toHaveBeenCalledWith(A, "kitchen-pi");
    expect(await host.token()).toBe("a1.s");
    expect(host.statuses.at(-1)).toMatchObject({ phase: "pending", verificationCode: "ABCD", current: A });
    expect(c.pullJobs).not.toHaveBeenCalled();
  });

  it("fixes the environment into the saved config on the first successful probe", async () => {
    const host = fakeHost({ config: CONFIG, token: "t" });
    await createAgent({ host, client: client() }).runOnce();
    expect((await host.config())?.environment).toBe("preproduction");
  });

  it("pending pull → phase pending; unreachable pull → phase unreachable; the token is kept", async () => {
    const host = fakeHost({ config: CONFIG, token: "t" });
    const pulls = vi.fn()
      .mockResolvedValueOnce(failR({ kind: "pending" }))
      .mockResolvedValueOnce(failR({ kind: "unreachable", detail: "x" }));
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("pending");
    await agent.runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
    expect(await host.token()).toBe("t");
  });

  it("unauthorized: clears the token, reports the phase and halts until restart", async () => {
    const host = fakeHost({ config: CONFIG, token: "t" });
    const c = client({ pullJobs: vi.fn(async () => failR({ kind: "unauthorized" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(await host.token()).toBeNull();
    expect(host.statuses.at(-1)?.phase).toBe("unauthorized");
    await agent.runOnce();
    await agent.runOnce();
    expect(c.join).not.toHaveBeenCalled(); // halted: no re-join without a restart
    expect(c.pullJobs).toHaveBeenCalledTimes(1);
  });

  it("running: merges the reply's servers into the router", async () => {
    const host = fakeHost({ config: CONFIG, token: "t" });
    const c = client({
      pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [{ url: "http://b.test", nodeId: "n2" }], jobs: [] })),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect((c.probeNode as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[0])).toContain("http://b.test");
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });
});

describe("createAgent — push and report", () => {
  const job = (id: string) => ({ id, printerId: "p1", transport: "network_tcp" as const, host: "10.0.0.9", port: 9100, usbPath: null, payload: new Uint8Array([7, 7]) });

  it("sends each job's bytes through the transport, in order, and reports done", async () => {
    const sink = new FakeSink();
    const host = fakeHost({ config: CONFIG, token: "t", transport: sink });
    const c = client({ pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1"), job("j2")] })) });
    await createAgent({ host, client: c }).runOnce();
    expect(sink.written.map((w) => w.printerId)).toEqual(["p1", "p1"]);
    expect(sink.written[0]!.bytes).toEqual(new Uint8Array([7, 7]));
    expect(c.report).toHaveBeenNthCalledWith(1, A, "t", "j1", { status: "done" });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "t", "j2", { status: "done" });
    expect(host.statuses.at(-1)?.lastJobAt).toBeTypeOf("number");
  });

  it("a failed send reports failed with the error text and keeps going", async () => {
    const transport = { send: vi.fn().mockRejectedValueOnce(new Error("no route")).mockResolvedValueOnce(undefined) };
    const host = fakeHost({ config: CONFIG, token: "t", transport });
    const c = client({ pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1"), job("j2")] })) });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenNthCalledWith(1, A, "t", "j1", { status: "failed", error: "no route" });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "t", "j2", { status: "done" });
    expect(host.statuses.at(-1)?.lastError).toBe("no route");
  });

  it("a report that cannot be delivered is logged and dropped (the lease reclaims)", async () => {
    const host = fakeHost({ config: CONFIG, token: "t" });
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
    const host = fakeHost({ config: CONFIG, token: "t" });
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
    const host = fakeHost({ config: CONFIG, token: "t" });
    const agent = createAgent({ host, client: client() });
    await agent.runOnce();
    await agent.runOnce();
    await agent.runOnce();
    expect(host.logs.filter((l) => l.includes("phase")).length).toBe(1);
  });

  it("never throws: a client that throws becomes an unreachable status", async () => {
    const host = fakeHost({ config: CONFIG, token: "t" });
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
import { createClient, type AgentClient, type WireJob } from "./client.js";
import type { AgentConfig, AgentStatus, Host } from "./host.js";
import { Router } from "./router.js";

/** The idle poll interval (spec §4 step 6). A non-empty batch re-polls at once; only an empty pull sleeps. */
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

/**
 * The loop (spec §4). `runOnce` is one tick — config, probe, credential, pull, push+report — and
 * NEVER throws: every failure becomes a status the host renders. `start` repeats it until `stop`.
 * State that survives ticks: the router (server list + current), and `halted`, set when the server
 * says unauthorized — the token is dead, and re-joining on our own would put a denied agent straight
 * back into the admin's list, so only a restart asks again (spec §3).
 */
export function createAgent(opts: AgentOptions): Agent {
  const host = opts.host;
  const client = opts.client ?? createClient({ fetch: host.fetch });
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  let router: Router | undefined;
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
    const round = await r.probe();
    if (config.environment === undefined && r.environment !== undefined) {
      await host.saveConfig({ ...config, environment: r.environment });
    }
    if (round.moved) host.log.info("following", { current: r.current });
    const current = r.current;

    let token = await host.token();
    if (token === null) {
      const joined = await client.join(current, config.name);
      if (!joined.ok) {
        report({ phase: "unreachable", serverUrl: config.serverUrl, current, lastError: describe(joined.failure) });
        return false;
      }
      token = joined.value.token;
      await host.saveToken(token);
      report({ phase: "pending", serverUrl: config.serverUrl, current, verificationCode: joined.value.verificationCode });
      return false;
    }

    const pulled = await client.pullJobs(current, token);
    if (!pulled.ok) {
      switch (pulled.failure.kind) {
        case "pending":
          report({ phase: "pending", serverUrl: config.serverUrl, current });
          return false;
        case "unauthorized":
          halted = true;
          await host.saveToken(null);
          report({ phase: "unauthorized", serverUrl: config.serverUrl, current, verificationCode: undefined });
          return false;
        default:
          report({ phase: "unreachable", serverUrl: config.serverUrl, current, lastError: describe(pulled.failure) });
          return false;
      }
    }
    r.merge(pulled.value.servers);
    for (const job of pulled.value.jobs) await push(job, token, current);
    report({ phase: "running", serverUrl: config.serverUrl, current, verificationCode: undefined });
    return pulled.value.jobs.length > 0;
  }

  function describe(failure: { kind: string; detail?: string }): string {
    return failure.detail === undefined ? failure.kind : `${failure.kind}: ${failure.detail}`;
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

Add to `index.ts`:

```ts
export { POLL_INTERVAL_MS, createAgent } from "./agent.js";
export type { Agent, AgentOptions } from "./agent.js";
export type { AgentConfig, AgentPhase, AgentStatus, Host, HostLog } from "./host.js";
```

and add a subpath export for the fake host in `package.json` so the e2e (Task 10) can import it without it entering the barrel:

```json
"exports": {
  ".": "./src/index.ts",
  "./testing/fake-host.js": "./src/testing/fake-host.ts"
}
```

(`main` stays for tooling; `exports` is the enumerated map, the `@waitron/db` convention.)

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @waitron/print-agent test:coverage`
Expected: PASS; package ≥ 90/90/85/85. If the `start` test hangs, the `stop()` hook in the fake's `sleep` is not firing — check `host.sleeps.length >= 2`.

- [ ] **Step 7: Verify and commit**

```bash
pnpm --filter @waitron/print-agent lint typecheck && pnpm typecheck && pnpm format:check
git add packages/print-agent
git commit -s -m "feat(print-agent): Host seam and the poll loop (join → pending → running; unauthorized halts)"
```

---

### Task 5: Schema — `print_agents.approved_at` + `join_code`; drop the pairing table

**Files:**
- Modify: `packages/db/src/schema/print-agents.ts`, `packages/db/src/index.ts:32`, `packages/db/src/classification.ts:89-93`, `packages/db/src/schema/printing.test.ts`, `packages/fiscal-verifactu/src/privileges.expected.ts:54`, `packages/printing/src/testing/global-setup.ts:11-14`
- Create (generated): `packages/db/drizzle/0008_print_agent_join.sql` + `meta/0008_snapshot.json` + `meta/_journal.json` entry

**Interfaces:**
- Produces: `printAgents.approvedAt: timestamp | null`, `printAgents.joinCode: text | null`; `printAgentPairingCodes` no longer exists.

- [ ] **Step 1: Write the failing schema test**

In `packages/db/src/schema/printing.test.ts`: delete `seedPairingCode` (lines 79-90) and the two `print_agent_pairing_codes` tests (152-198); drop `printAgentPairingCodes` from the import on line 8; rename the describe to `printing schema (print_agents/printers/print_jobs — columns, CHECKs, FKs)`. Extend the `print_agents` column test (line 119) to assert the two new columns:

```ts
    expect(row!.approvedAt).toBeNull(); // NULL = pending, until an admin accepts
    expect(row!.joinCode).toBeNull();
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update print_agents set approved_at = now(), join_code = 'ABCD' where id = ${id}`),
    );
    const [approved] = await asApp(TENANT_A, (tx) => tx.select().from(printAgents).where(sql`id = ${id}`));
    expect(approved!.approvedAt).not.toBeNull();
    expect(approved!.joinCode).toBe("ABCD");
```

- [ ] **Step 2: Run it to see it fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test -- printing`
Expected: FAIL — `approvedAt` is not a column.

- [ ] **Step 3: Change the schema**

In `print-agents.ts`, after `lastSeenAt`:

```ts
    // NULL until an admin accepts the join request (the dashboard's Accept). `authenticateAgent` refuses
    // an unapproved row with `agent.pending`, so a knocking agent can neither claim nor report.
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    // The 4-character verification code shown in the dashboard's pending list AND on the agent's own
    // status page, so an admin can tell which box is asking. Not a secret; cleared on accept.
    joinCode: text("join_code"),
```

Delete the whole `printAgentPairingCodes` table — its doc comment starts at `:59` and the export runs `:76-115`. `uniqueIndex` is used only there, so drop that import; `text` must STAY (the new `joinCode` column needs it). Rewrite the file header's mention of the pairing code to describe join-and-accept in one line.

`packages/db/src/index.ts:32` → `export { printAgents } from "./schema/print-agents.js";`

`packages/db/src/classification.ts:89-93` → delete the `print_agent_pairing_codes` `classify(...)` call.

`packages/fiscal-verifactu/src/privileges.expected.ts:54` → delete the `print_agent_pairing_codes: "SID",` line.

`packages/printing/src/testing/global-setup.ts` needs THREE edits, all stale claims the behaviour change retires (CLAUDE.md §1): the table list at `:12` loses `print_agent_pairing_codes`; the `dockerRequired` string at `:29-31` loses its "single-use pairing-code redemption" rationale, becoming `"the join/accept/deny verbs run as the real deployment role with its exact grants, and PGlite's all-superuser connection would pass a missing grant."`; and the paragraph at `:24` that justifies real Postgres by "prove the single-use enrol race" is no longer true — the race test is deleted with the pairing code, so restate it as the grants/role rationale.

- [ ] **Step 4: Generate the migration**

```bash
pnpm --filter @waitron/db db:generate --name print_agent_join
cat packages/db/drizzle/0008_print_agent_join.sql
```

Expected content (drizzle's own output; do not hand-edit):

```sql
DROP TABLE "print_agent_pairing_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "print_agents" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_agents" ADD COLUMN "join_code" text;
```

The `CASCADE` also takes `print_agent_pairing_codes_lookup_idx` (`0001_db_baseline_sql.sql:761`) and the table's two FKs (`:699-700`) — expected, not a surprise. No `--custom` twin is needed: `0001_db_baseline_sql.sql:474` grants `SELECT, INSERT, UPDATE ON "print_agents"` with NO column list, so the two new columns are already covered, and `:476-478`'s pairing grants vanish with the table.

- [ ] **Step 5: Run the package and the root guards**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test -- privileges
pnpm vitest run scripts/classification-complete.test.ts scripts/append-only-enable-always.test.ts scripts/module-graph-honesty.test.ts
grep -rn "print_agent_pairing\|printAgentPairingCodes" apps packages scripts --include='*.ts' --include='*.mjs' --exclude-dir=coverage --exclude-dir=node_modules --exclude-dir=dist | grep -v "/drizzle/"
```

Expected: db green at 98/95; privileges green; guards green; the grep prints only `packages/printing/src/agent.ts` + its test (Task 6 removes those) and nothing else.

- [ ] **Step 6: Commit**

```bash
git add packages/db packages/fiscal-verifactu/src/privileges.expected.ts packages/printing/src/testing/global-setup.ts
git commit -s -m "feat(db): print_agents.approved_at + join_code; drop print_agent_pairing_codes (join-and-accept replaces the pairing code; pre-production, no backfill)"
```

---

### Task 6: `@waitron/printing` — join / accept / deny, pending auth, codes

**Files:**
- Modify: `packages/printing/src/agent.ts` (rewrite), `packages/printing/src/agent.test.ts` (rewrite), `packages/printing/src/errors.ts`, `packages/printing/src/errors.test.ts`, `packages/printing/src/index.ts:13-14`

**Interfaces:**
- Produces (from `@waitron/printing`):

```ts
export const MAX_PENDING_AGENTS = 10;
export interface PrintAgentConfig { tenantId: string; locationId: string }   // unchanged
export function joinAgent(tx, cfg: PrintAgentConfig, input: { name: string }): Promise<{ agentId: string; token: string; verificationCode: string }>
export function acceptAgent(tx, cfg: { tenantId: string }, input: { agentId: string }): Promise<void>   // throws agent.not_found
export function denyAgent(tx, cfg: { tenantId: string }, input: { agentId: string }): Promise<void>     // throws agent.not_found
export function authenticateAgent(tx, cfg: { tenantId: string }, token: string): Promise<{ agentId: string }>  // throws agent.pending on an unapproved row
```
- Codes: add `agent.pending`, `agent.join_full`, `agent.join_rate_limited` (all `Record<string, never>`); delete `agent.pairing_invalid`, `agent.pairing_expired`, `agent.pairing_rate_limited`.

- [ ] **Step 1: Rewrite `errors.test.ts` and extend `agent.test.ts` (failing first)**

`errors.test.ts`: delete the three `agent.pairing_*` cases; add:

```ts
  it("constructs agent.pending with NO params (a knocking agent that has not been accepted)", () => {
    const error = new AppError("agent.pending", {});
    expect(error.code).toBe("agent.pending");
    expect(error.params).toEqual({});
  });
  it("constructs agent.join_full with NO params (the per-tenant pending cap)", () => {
    expect(new AppError("agent.join_full", {}).code).toBe("agent.join_full");
  });
  it("constructs agent.join_rate_limited with NO params (the join flood guard)", () => {
    expect(new AppError("agent.join_rate_limited", {}).code).toBe("agent.join_rate_limited");
  });
```

`agent.test.ts`: replace the `generateAgentCode + enrolAgent` describe and the race describe with:

```ts
describe("joinAgent / acceptAgent / denyAgent", () => {
  it("join mints a pending row with a 4-char Crockford code and a verifySecret-able token; the hash is not the plaintext", async () => {
    const cfg = await setup();
    const { agentId, token, verificationCode } = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "kitchen-pi" }));
    expect(token.startsWith(`${agentId}.`)).toBe(true);
    expect(verificationCode).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    const { rows } = await suite.admin.execute<{ token_hash: string; approved_at: string | null; join_code: string; name: string; location_id: string }>(
      sql`select token_hash, approved_at, join_code, name, location_id from print_agents where id = ${agentId}`,
    );
    expect(rows[0]!.approved_at).toBeNull();
    expect(rows[0]!.join_code).toBe(verificationCode);
    expect(rows[0]!.name).toBe("kitchen-pi");
    expect(rows[0]!.location_id).toBe(cfg.locationId);
    expect(rows[0]!.token_hash).not.toContain(token.slice(agentId.length + 1));
    expect(verifySecret(token.slice(agentId.length + 1), rows[0]!.token_hash)).toBe(true);
  });

  it("the (MAX_PENDING_AGENTS + 1)th pending join in a tenant → agent.join_full; another tenant is unaffected", async () => {
    const cfg = await setup();
    for (let i = 0; i < MAX_PENDING_AGENTS; i += 1) {
      await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: `box-${i}` }));
    }
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "one-more" })))).toBe("agent.join_full");
    const other = await setup();
    await expect(asApp(suite.admin, other, (tx) => joinAgent(tx, other, { name: "elsewhere" }))).resolves.toBeDefined();
  });

  it("accept stamps approved_at and clears join_code; a second accept and an unknown id → agent.not_found", async () => {
    const cfg = await setup();
    const { agentId } = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "a" }));
    await asApp(suite.admin, cfg, (tx) => acceptAgent(tx, cfg, { agentId }));
    const { rows } = await suite.admin.execute<{ approved_at: string | null; join_code: string | null }>(
      sql`select approved_at, join_code from print_agents where id = ${agentId}`,
    );
    expect(rows[0]!.approved_at).not.toBeNull();
    expect(rows[0]!.join_code).toBeNull();
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => acceptAgent(tx, cfg, { agentId })))).toBe("agent.not_found");
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => acceptAgent(tx, cfg, { agentId: randomUUID() })))).toBe("agent.not_found");
  });

  it("deny revokes a pending row (active=false, still unapproved); an approved row cannot be denied", async () => {
    const cfg = await setup();
    const { agentId } = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "a" }));
    await asApp(suite.admin, cfg, (tx) => denyAgent(tx, cfg, { agentId }));
    const { rows } = await suite.admin.execute<{ active: boolean; approved_at: string | null }>(sql`select active, approved_at from print_agents where id = ${agentId}`);
    expect(rows[0]).toEqual({ active: false, approved_at: null });
    const b = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "b" }));
    await asApp(suite.admin, cfg, (tx) => acceptAgent(tx, cfg, { agentId: b.agentId }));
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => denyAgent(tx, cfg, { agentId: b.agentId })))).toBe("agent.not_found");
  });

  it("accept and deny are tenant-scoped: tenant B cannot act on tenant A's pending agent", async () => {
    const cfgA = await setup();
    const cfgB = await setup();
    const { agentId } = await asApp(suite.admin, cfgA, (tx) => joinAgent(tx, cfgA, { name: "a" }));
    expect(await codeOf(() => asApp(suite.admin, cfgB, (tx) => acceptAgent(tx, cfgB, { agentId })))).toBe("agent.not_found");
    expect(await codeOf(() => asApp(suite.admin, cfgB, (tx) => denyAgent(tx, cfgB, { agentId })))).toBe("agent.not_found");
  });
});
```

In the `authenticateAgent` describe, replace `enrolled()` with:

```ts
  async function enrolled(): Promise<{ cfg: PrintAgentConfig; agentId: string; token: string }> {
    const cfg = await setup();
    const { agentId, token } = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "Auth agent" }));
    await asApp(suite.admin, cfg, (tx) => acceptAgent(tx, cfg, { agentId }));
    return { cfg, agentId, token };
  }
```

and add:

```ts
  it("a valid token on an UNAPPROVED row → agent.pending (distinct from unauthorized); a wrong secret on it → agent.unauthorized", async () => {
    const cfg = await setup();
    const { agentId, token } = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "knock" }));
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, token)))).toBe("agent.pending");
    const forged = `${agentId}.${randomBytes(32).toString("base64url")}`;
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, forged)))).toBe("agent.unauthorized");
  });

  it("a denied (never approved, inactive) row → agent.unauthorized", async () => {
    const cfg = await setup();
    const { agentId, token } = await asApp(suite.admin, cfg, (tx) => joinAgent(tx, cfg, { name: "knock" }));
    await asApp(suite.admin, cfg, (tx) => denyAgent(tx, cfg, { agentId }));
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, token)))).toBe("agent.unauthorized");
  });
```

Update the imports: `import { MAX_PENDING_AGENTS, acceptAgent, authenticateAgent, denyAgent, joinAgent } from "./agent.js";` and drop `createHash`/`PAIRING_TTL_MS`.

- [ ] **Step 2: Run to see them fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test -- agent errors`
Expected: FAIL — `joinAgent` is not exported.

- [ ] **Step 3: Rewrite `agent.ts`**

Keep the file's imports minus `createHash`; keep `UUID_RE` and `PrintAgentConfig`; delete `PAIRING_TTL_MS`, `PAIRING_CODE_BYTES`, `generateAgentCode`, `enrolAgent`. Replace the header comment's three verbs with join / accept / deny / authenticate in the same shape. Add:

```ts
import { and, eq, isNull, sql } from "drizzle-orm";

/** Pending join requests a tenant may hold at once. `join` is unauthenticated, so this bounds what a
 * stranger who can reach the URL can put in the admin's list; refused, never evicted, so a flood cannot
 * push the real agent out (spec §5). */
export const MAX_PENDING_AGENTS = 10;

/** Crockford base32 — the alphabet the device pairing code uses (no I, L, O, U), so a code read aloud
 * across a kitchen is unambiguous. 256 % 32 === 0, so `byte % 32` is unbiased. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VERIFICATION_CODE_LENGTH = 4;
function verificationCode(): string {
  return Array.from(randomBytes(VERIFICATION_CODE_LENGTH), (b) => CROCKFORD[b % 32]!).join("");
}

/**
 * A knocking agent's join request (spec §2.3): inserts a PENDING `print_agents` row — `approved_at`
 * NULL, a verification code the dashboard and the agent's page both show — and returns the bearer
 * token the agent keeps. The token is useless until an admin accepts (`authenticateAgent` answers
 * `agent.pending`). The pending count is checked in the same transaction as the insert; two joins
 * racing at the cap can both pass the count (no lock is taken), an accepted over-run of at most a
 * few rows — the cap is a nuisance bound, not a security boundary.
 */
export async function joinAgent(
  tx: Transaction,
  cfg: PrintAgentConfig,
  input: { name: string },
): Promise<{ agentId: string; token: string; verificationCode: string }> {
  const [{ pending }] = await tx
    .select({ pending: sql<number>`count(*)::int` })
    .from(printAgents)
    .where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.active, true), isNull(printAgents.approvedAt)));
  if (pending! >= MAX_PENDING_AGENTS) throw new AppError("agent.join_full", {});

  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const code = verificationCode();
  const [agent] = await tx
    .insert(printAgents)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      name: input.name,
      tokenHash: hashSecret(secret),
      active: true,
      joinCode: code,
    })
    .returning({ id: printAgents.id });
  return { agentId: agent!.id, token: `${agent!.id}.${secret}`, verificationCode: code };
}

/** Accept a pending agent: stamps `approved_at`, clears the code. Only a pending, active row in this
 * tenant matches; anything else (approved already, denied, unknown, another tenant's) → `agent.not_found`. */
export async function acceptAgent(tx: Transaction, cfg: { tenantId: string }, input: { agentId: string }): Promise<void> {
  const updated = await tx
    .update(printAgents)
    .set({ approvedAt: sql`now()`, joinCode: null })
    .where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.id, input.agentId), eq(printAgents.active, true), isNull(printAgents.approvedAt)))
    .returning({ id: printAgents.id });
  if (updated.length === 0) throw new AppError("agent.not_found", { id: input.agentId });
}

/** Deny a pending agent: revokes it without ever approving (`active := false`, `approved_at` stays
 * NULL), so the row is refused by auth and hidden by the dashboard. `app_user` holds no DELETE here. */
export async function denyAgent(tx: Transaction, cfg: { tenantId: string }, input: { agentId: string }): Promise<void> {
  const updated = await tx
    .update(printAgents)
    .set({ active: false })
    .where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.id, input.agentId), eq(printAgents.active, true), isNull(printAgents.approvedAt)))
    .returning({ id: printAgents.id });
  if (updated.length === 0) throw new AppError("agent.not_found", { id: input.agentId });
}
```

In `authenticateAgent`: select `approvedAt: printAgents.approvedAt` beside `tokenHash`; after the `verifySecret` check add:

```ts
  // Secret first, THEN approval: a wrong secret on a pending row is `unauthorized`, so "pending" is
  // only ever told to the holder of the real token.
  if (row.approvedAt === null) throw new AppError("agent.pending", {});
```

The `agentId`-typed uuid guard and the tenant predicate are unchanged. **A pending agent's
`last_seen_at` is NOT recorded**: the throw above precedes the sighting UPDATE, and even below it the
throw rolls back the route's single `withTenant` transaction. So the pending list shows no
"last knocked" time — out of scope for this slice, and the sighting resumes the moment the agent is
accepted. Say exactly that in the code comment; do not claim the gate is unchanged.

`errors.ts`: delete the three `agent.pairing_*` entries and their doc; add:

```ts
    /** The token verified but the agent has not been accepted yet — told only to the real token's
     * holder (secret checked first), so it is not an oracle. NO params. */
    "agent.pending": Record<string, never>;
    /** The tenant already holds MAX_PENDING_AGENTS pending join requests; refused, never evicted. NO params. */
    "agent.join_full": Record<string, never>;
    /** The join flood guard refused this attempt before any DB work (the enrol-rate-limit mechanism, in
     * this surface's own namespace). NO params. */
    "agent.join_rate_limited": Record<string, never>;
```

and change the file header's "Thrown by the printer/agent CRUD, enrolment and runtime" to "…, join/accept/deny and runtime".

`index.ts:13-14` → `export { MAX_PENDING_AGENTS, acceptAgent, authenticateAgent, denyAgent, joinAgent } from "./agent.js";`

- [ ] **Step 4: Run the package**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test:coverage`
Expected: PASS. (`packages/printing` sits at the 90/90/85/85 FLOOR — `packages/printing/vitest.config.ts:33`; it is not one of `scripts/coverage-thresholds.test.ts`'s six high-bar packages.) The `apps/server` typecheck is now RED until Task 7 — expected; do not run `pnpm typecheck` here.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @waitron/printing lint typecheck && pnpm format:check
git add packages/printing
git commit -s -m "feat(printing): joinAgent/acceptAgent/denyAgent; authenticateAgent answers agent.pending; pairing verbs and codes removed (nothing shipped, no deprecation sibling)"
```

---

### Task 7: Server routes — join / accept / deny / list; `servers` on the pull

**Files:**
- Modify: `apps/server/src/print-api.ts` (deps, STATUS, the enrol/codes routes → join/accept/deny, the list projection, the pull reply), `apps/server/src/enrol-rate-limit.ts` (the `code` union + its stale prose — **required, see Step 0**), `apps/server/src/print-api.test.ts`, `apps/server/src/print-api.pg.test.ts`, `apps/server/src/boot.ts:1416`, `apps/server/src/print-agent-session.ts` (header comment only)

**Interfaces:**
- Consumes: `joinAgent`, `acceptAgent`, `denyAgent`, `MAX_PENDING_AGENTS` (Task 6); `routableServers`, `SignedMembershipDocument` from `@waitron/membership`; `readNodeMembership` from `@waitron/db` (boot).
- Produces:

```ts
export interface PrintApiDeps {
  db: Database;
  cfg: { tenantId: string; locationId: string; nodeId: string };
  readMembership: () => Promise<SignedMembershipDocument | null>;
  enrolRateLimiter?: EnrolRateLimiter;   // now built with code "agent.join_rate_limited"
}
```
Routes: `POST /print-api/agent/join {name}` → 201 `{agentId, token, verificationCode}`; `GET /print-api/agent/jobs` → `{ nodeId, servers: RoutableServer[], jobs }`; `GET /management-api/print-agents` rows gain `approvedAt`, `joinCode` and omit denied rows; `POST /management-api/print-agents/:id/accept` → 204; `POST …/:id/deny` → 204. `POST …/codes` and `POST /print-api/agent/enrol` are gone (404).

- [ ] **Step 0: Retype the rate limiter's code union (`apps/server/src/enrol-rate-limit.ts`)**

Task 6 deleted `agent.pairing_rate_limited` from the registry, and `enrol-rate-limit.ts:65` still names
it in `EnrolRateLimiterOptions["code"]`, with `new AppError(code, {})` at `:104` — so `apps/server` is
red until this lands. Retype it:

```ts
  code?: "device.pairing_rate_limited" | "agent.join_rate_limited";
```

There is **no `max` option and there must not be one**: `:48-55` records the deliberate decision that
the window and cap are baked in so the limiter "can never be constructed with a different rate POLICY
than the one it ships". Tests drive it with the injectable clock and an in-process pre-fill instead.

Then sweep this file's stale prose, which a behaviour change retires (CLAUDE.md §1): lines 1-4, 9-13,
20-22 and 59-63 all cite `POST /print-api/agent/enrol`, "the pairing-code DELETE" and
`agent.pairing_rate_limited`. Rewrite each to name `POST /print-api/agent/join`, the pending-row
insert, and `agent.join_rate_limited`.

- [ ] **Step 1: Rewrite the test helpers and the enrol tests (failing first)**

In BOTH `print-api.test.ts` and `print-api.pg.test.ts` replace the `enrolAgent` helper with:

```ts
/** Join (unauth) then accept (manager) — the agent's id + Bearer token, ready to claim. */
async function joinAndAccept(app: Hono, name = "Cocina agent"): Promise<{ agentId: string; token: string }> {
  const join = await send(app, "POST", "/print-api/agent/join", { body: { name } });
  expect(join.status).toBe(201);
  const { agentId, token } = (await join.json()) as { agentId: string; token: string };
  const accept = await send(app, "POST", `/management-api/print-agents/${agentId}/accept`, { cookie: managerCookie });
  expect(accept.status).toBe(204);
  return { agentId, token };
}
```

and rename every `enrolAgent(app, …)` call to `joinAndAccept(app, …)`.

The two suites have DIFFERENT `mountApp` signatures — do not merge them. In `print-api.test.ts` it becomes:

```ts
function mountApp(enrolRateLimiter?: EnrolRateLimiter, held: SignedMembershipDocument | null = null): Hono {
  const app = new Hono();
  mountPrintApi(
    app,
    { db: suite.db, cfg: { tenantId, locationId, nodeId: NODE_ID }, readMembership: async () => held, enrolRateLimiter },
    noopLog,
  );
  return app;
}
```

with `const NODE_ID = "33333333-3333-4333-8333-333333333333";` and
`import type { SignedMembershipDocument } from "@waitron/membership";`.

In `print-api.pg.test.ts` the existing signature is `function mountApp(tenant: Tenant): Hono`
(`:78-81`), called `mountApp(tenantA)` at roughly twenty sites — keep that shape and widen it:

```ts
function mountApp(tenant: Tenant, held: SignedMembershipDocument | null = null): Hono {
  const app = new Hono();
  mountPrintApi(
    app,
    { db: suite.admin, cfg: { ...tenant, nodeId: NODE_ID }, readMembership: async () => held },
    noopLog,
  );
  return app;
}
```

Every existing `mountApp(tenantA)` call site keeps working unchanged.

Replace the `mountPrintApi — agent enrol` describe in `print-api.test.ts` with:

```ts
describe("mountPrintApi — agent join / accept / deny", () => {
  it("join (unauth) → 201 { agentId, token, verificationCode }; the row is pending and listed with its code", async () => {
    const app = mountApp();
    const res = await send(app, "POST", "/print-api/agent/join", { body: { name: "kitchen-pi" } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agentId: string; token: string; verificationCode: string };
    expect(body.token.startsWith(`${body.agentId}.`)).toBe(true);
    expect(body.verificationCode).toMatch(/^[0-9A-Z]{4}$/);
    const list = await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie });
    const rows = (await list.json()) as { id: string; approvedAt: string | null; joinCode: string | null; name: string }[];
    expect(rows.find((r) => r.id === body.agentId)).toMatchObject({ approvedAt: null, joinCode: body.verificationCode, name: "kitchen-pi" });
  });

  it("a pending agent's claim and report are 403 agent.pending; after accept the claim is 200 and the code is cleared", async () => {
    const app = mountApp();
    const join = await send(app, "POST", "/print-api/agent/join", { body: { name: "x" } });
    const { agentId, token } = (await join.json()) as { agentId: string; token: string };
    const claim = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(claim.status).toBe(403);
    expect(((await claim.json()) as { error: { code: string } }).error.code).toBe("agent.pending");
    const report = await send(app, "POST", `/print-api/agent/jobs/${randomUUID()}/result`, { bearer: token, body: { status: "done" } });
    expect(report.status).toBe(403);
    expect((await send(app, "POST", `/management-api/print-agents/${agentId}/accept`, { cookie: managerCookie })).status).toBe(204);
    expect((await send(app, "GET", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);
    const rows = (await (await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })).json()) as { id: string; joinCode: string | null; approvedAt: string | null }[];
    expect(rows.find((r) => r.id === agentId)).toMatchObject({ joinCode: null });
    expect(rows.find((r) => r.id === agentId)!.approvedAt).not.toBeNull();
  });

  it("deny → 204; the agent's claim is then 401 and the row is hidden from the list; accept/deny of an approved or unknown id → 404", async () => {
    const app = mountApp();
    const join = await send(app, "POST", "/print-api/agent/join", { body: { name: "stranger" } });
    const { agentId, token } = (await join.json()) as { agentId: string; token: string };
    expect((await send(app, "POST", `/management-api/print-agents/${agentId}/deny`, { cookie: managerCookie })).status).toBe(204);
    expect((await send(app, "GET", "/print-api/agent/jobs", { bearer: token })).status).toBe(401);
    const rows = (await (await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })).json()) as { id: string }[];
    expect(rows.some((r) => r.id === agentId)).toBe(false);
    const { agentId: approved } = await joinAndAccept(app, "approved");
    expect((await send(app, "POST", `/management-api/print-agents/${approved}/deny`, { cookie: managerCookie })).status).toBe(404);
    expect((await send(app, "POST", `/management-api/print-agents/${approved}/accept`, { cookie: managerCookie })).status).toBe(404);
    expect((await send(app, "POST", `/management-api/print-agents/${randomUUID()}/accept`, { cookie: managerCookie })).status).toBe(404);
    expect((await send(app, "POST", "/management-api/print-agents/nope/accept", { cookie: managerCookie })).status).toBe(400);
  });

  it("join screens the body (missing name → 400; empty/malformed body → 400, never 500)", async () => {
    const app = mountApp();
    expect((await send(app, "POST", "/print-api/agent/join", { body: {} })).status).toBe(400);
    expect((await app.request("/print-api/agent/join", { method: "POST" })).status).toBe(400);
    expect((await app.request("/print-api/agent/join", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" })).status).toBe(400);
  });

  it("the (MAX_PENDING_AGENTS + 1)th pending join → 409 agent.join_full", async () => {
    const app = mountApp(); // the default limiter admits ENROL_RATE_MAX (30) per window; 11 joins fit
    for (let i = 0; i < MAX_PENDING_AGENTS; i += 1) {
      expect((await send(app, "POST", "/print-api/agent/join", { body: { name: `b${i}` } })).status).toBe(201);
    }
    const full = await send(app, "POST", "/print-api/agent/join", { body: { name: "b-more" } });
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe("agent.join_full");
  });

  it("rate-limits join: the (cap+1)th attempt is 429 agent.join_rate_limited BEFORE the DB, then the window resets", async () => {
    // THE GUARD (proven by deletion): a per-process GLOBAL fixed-window counter checked at the TOP of
    // the join handler, before the body parse and the pending-count read. Deleting `enrolLimiter.check()`
    // from print-api.ts's join route makes the (cap+1)th attempt join/400 instead of 429.
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow, code: "agent.join_rate_limited" });
    const app = mountApp(limiter);
    // Pre-fill to the cap IN-PROCESS, so no HTTP join happens first and the pending cap is never
    // approached — the next HTTP attempt is the (cap+1)th → 429.
    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();
    const limited = await send(app, "POST", "/print-api/agent/join", { body: { name: "x" } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "agent.join_rate_limited" },
    });
    // Past the window the counter resets and the request reaches the handler — a real join now, 201.
    fakeNow += ENROL_RATE_WINDOW_MS + 1;
    const after = await send(app, "POST", "/print-api/agent/join", { body: { name: "x" } });
    expect(after.status).toBe(201);
  });

  it("the deleted routes answer 404: POST /print-api/agent/enrol and POST /management-api/print-agents/codes", async () => {
    const app = mountApp();
    expect((await send(app, "POST", "/print-api/agent/enrol", { body: { code: "x" } })).status).toBe(404);
    expect((await send(app, "POST", "/management-api/print-agents/codes", { cookie: managerCookie, body: { label: "x" } })).status).toBe(404);
  });
});
```

(Write out the rate-limit test body from the existing one at lines 184-211; the comment above lists the four substitutions. Check `createEnrolRateLimiter`'s options in `enrol-rate-limit.ts:48-66` for the `max` field's actual name.)

Add to the `agent claim + report` describe:

```ts
  it("the claim reply carries nodeId and the venue's routable servers (primary first, evicted and address-less excluded)", async () => {
    const held = signedMembershipDoc(5, {
      signerNodeId: NODE_ID,
      nodes: [
        { nodeId: "b", contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
        { nodeId: "c", contactUrl: "https://old.deli.test", standing: "evicted" },
        { nodeId: "d", contactUrl: "", standing: "sell-only" },
        { nodeId: NODE_ID, contactUrl: "https://box.deli.test", standing: "serving-primary" },
      ],
    });
    const app = mountApp(undefined, held);
    const { token } = await joinAndAccept(app);
    const body = (await (await send(app, "GET", "/print-api/agent/jobs", { bearer: token })).json()) as { nodeId: string; servers: unknown; jobs: unknown[] };
    expect(body.nodeId).toBe(NODE_ID);
    expect(body.servers).toEqual([
      { nodeId: NODE_ID, url: "https://box.deli.test", standing: "serving-primary" },
      { nodeId: "b", url: "https://cloud.deli.test", standing: "serving-secondary" },
    ]);
    expect(body.jobs).toEqual([]);
    const bare = (await (await send(mountApp(), "GET", "/print-api/agent/jobs", { bearer: (await joinAndAccept(mountApp())).token })).json()) as { servers: unknown };
    expect(bare.servers).toEqual([]);
  });
```

with `import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";` and `import { MAX_PENDING_AGENTS } from "@waitron/printing";`.

**The gate suites — both files, and neither is optional.**

`print-api.test.ts:781-824` builds a `routes` array whose FIRST entry (`:786`) is
`["POST", "/management-api/print-agents/codes", { label: "X" }]`, driving two gate tests
(unauth → 401, staff → 403). Deleting that route makes both receive 404. Replace that entry with the
two new gated routes, which need a pending agent id — so hoist a `join` before the loop and use its id:

```ts
    ["POST", `/management-api/print-agents/${pendingId}/accept`, undefined],
    ["POST", `/management-api/print-agents/${pendingId}/deny`, undefined],
```

In `print-api.pg.test.ts` there are THREE gate tests, not one: `:203` (whose requests at `:218` and
`:228` both post to the codes route), `:315` and `:555`. Change `:203`'s three requests to
`POST /management-api/print-agents/${agentId}/accept` on a freshly joined, unaccepted agent —
unauth 401, staff 403, manager 204 — and leave `:315` / `:555` alone (they gate the station and
receipt-printer routes, which this task does not touch; confirm they still pass).

Finally, delete the PGlite suite's `agent-codes screens the body` test (`:465`) — the new
`join screens the body` test above replaces it.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/server test -- print-api.test`
Expected: FAIL (typecheck/import errors on `joinAgent`, the routes 404).

- [ ] **Step 3: Rewrite the routes**

In `print-api.ts`:

- Imports: replace `enrolAgent, generateAgentCode` with `acceptAgent, denyAgent, joinAgent`; add `import { routableServers, type SignedMembershipDocument } from "@waitron/membership";`; add `isNotNull, or` to the drizzle import.
- `PrintApiDeps.cfg` gains `nodeId: string`; add `readMembership: () => Promise<SignedMembershipDocument | null>` with the doc: `/** The held membership document — the server list the pull reply carries (till-reroute §3.2). Injected because `node_membership` is a whole-DB singleton outside any `withTenant`. */`
- `enrolLimiter` default: `createEnrolRateLimiter({ code: "agent.join_rate_limited" })`; update its comment.
- `STATUS`: delete the three `agent.pairing_*` rows; add `"agent.pending": 403, "agent.join_full": 409, "agent.join_rate_limited": 429`. Update the doc block's first bullet accordingly.
- Replace the enrol route with:

```ts
  // ── Agent join (UNAUTHENTICATED) ─────────────────────────────────────────────────────────────────
  app.post("/print-api/agent/join", (c) =>
    run(c, log, async () => {
      // Rate-limit FIRST, before the body parse and the pending-count read, so a flood on this
      // unauthenticated route costs no DB work (CLAUDE.md §5's never-block-a-sale posture).
      enrolLimiter.check();
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const joined = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return joinAgent(tx, deps.cfg, { name });
      });
      // The token is the agent's ONLY secret and leaves the process ONLY here. It is useless until an
      // admin accepts the row (every agent route answers `agent.pending` until then).
      return c.json(joined, 201);
    }),
  );
```

- In the claim route, after `claimed`:

```ts
      const held = await deps.readMembership();
      return c.json({
        nodeId: deps.cfg.nodeId,
        servers: routableServers(held),
        jobs: claimed.map(/* unchanged */),
      });
```

- Delete the `/management-api/print-agents/codes` route. In the list route add `approvedAt: printAgents.approvedAt, joinCode: printAgents.joinCode` to the projection and a where clause that hides denied rows:

```ts
          // A denied request is a revoked row that was never approved — not an agent, so not listed:
          // show what is approved (active or revoked) or still pending (active, unapproved).
          .where(and(eq(printAgents.tenantId, deps.cfg.tenantId), or(isNotNull(printAgents.approvedAt), eq(printAgents.active, true))))
```

- Add after the list route:

```ts
  // ── Accept / deny a pending agent (printer.manage) ───────────────────────────────────────────────
  app.post("/management-api/print-agents/:id/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const agentId = requireUuidParam(c.req.param("id"), "PrintAgentId");
      await gated(sessionId, (tx) => acceptAgent(tx, deps.cfg, { agentId }));
      return c.body(null, 204);
    }),
  );
  app.post("/management-api/print-agents/:id/deny", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const agentId = requireUuidParam(c.req.param("id"), "PrintAgentId");
      await gated(sessionId, (tx) => denyAgent(tx, deps.cfg, { agentId }));
      return c.body(null, 204);
    }),
  );
```

- Update the `mountPrintApi` doc block (points 1 and 3) and the file header's list of reachable codes. In `print-agent-session.ts` the header's "This module throws exactly one code" note stays true; no change needed beyond reading it.

`boot.ts:1416`:

```ts
    mountPrintApi(
      app,
      {
        db,
        cfg: { tenantId: till.tenantId, locationId: till.locationId, nodeId: till.nodeId },
        readMembership: () => readNodeMembership(db),
      },
      log,
    );
```

`till.nodeId` is correct and confirmed: `till-config.ts:60` declares `nodeId: NodeId`, and it is the same value `mountNodeApi` already receives 63 lines above at `boot.ts:1355`. `readNodeMembership` is already imported at `boot.ts:13`. Update the comment block above it (lines 1407-1415): "UNAUTHENTICATED agent join (`POST /print-api/agent/join`, a pending row an admin accepts or denies)" and "(accept/deny/list/revoke agents, printers CRUD, recent jobs)".

- [ ] **Step 4: Run both suites**

```bash
pnpm --filter @waitron/server test -- print-api.test
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- print-api.pg.test boot.test
```

Expected: PASS. If `boot.test` complains about `mountPrintApi` deps, the fixture there mounts the real boot — no change expected.

- [ ] **Step 5: Verify (server is its own CI shard — run its full coverage once) and commit**

```bash
pnpm --filter @waitron/server lint typecheck
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm typecheck && pnpm format:check
git add apps/server
git commit -s -m "feat(server): print-agent join/accept/deny routes; the claim reply carries nodeId + the venue's servers; enrol + codes routes removed"
```

---

### Task 8: Dashboard — the pending list with Accept / Deny

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`PrintAgentRow` :913-919, `createAgentCode` :1913-1915, the banner comment :1898-1902), `apps/dashboard/src/api/client.test.ts:1936-1965`, `apps/dashboard/src/screens/printers-screen.ts` (class doc :66-77, state :247-252, methods 400-437, `#renderAgent`, `#renderCodePanel` → deleted, `#renderAgentsSection`), `apps/dashboard/src/screens/printers-screen.test.ts` (stub :123 + the six generate/code tests + the two OTHER `createAgentCode` consumers, see Step 3), `apps/dashboard/src/screens/printers-screen.a11y.test.ts` (stub :119 + the pairing-panel case :158-174 — **required, it drives the deleted widgets**), `apps/dashboard/src/i18n/strings.ts` (en :201-209, es :761-769)

**Interfaces:**
- Consumes: the Task 7 routes.
- Produces: `PrintAgentRow` gains `approvedAt: string | null; joinCode: string | null`; `DashboardApi.acceptAgent(id)`, `denyAgent(id)`; `createAgentCode` removed.

- [ ] **Step 1: Client + its tests (failing first)**

`client.test.ts`: replace the `createAgentCode` test with:

```ts
  it("acceptAgent / denyAgent POST the agent's accept / deny routes and resolve on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.acceptAgent("a1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents/a1/accept", { method: "POST", credentials: "include" });
    await expect(api.denyAgent("a1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents/a1/deny", { method: "POST", credentials: "include" });
  });
```

and add `approvedAt: "2026-08-25T13:00:00.000Z", joinCode: null` to each fixture row in the `agents` array of that describe (the second one `approvedAt: null, joinCode: "ABCD"`).

`client.ts`: `PrintAgentRow` gains the two fields (doc: `approvedAt` null = waiting for Accept; `joinCode` the verification code while pending); delete `createAgentCode`; add:

```ts
  /** `POST /management-api/print-agents/:id/accept` — accept a pending join request (204). 404
   * `agent.not_found` when the row is not pending. */
  acceptAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/accept`, "POST");
  }
  /** `POST /management-api/print-agents/:id/deny` — refuse a pending join request (204): the row is
   * revoked without ever being approved and drops out of the list. */
  denyAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/deny`, "POST");
  }
```

Update the comment block at 1898-1902 ("mints a single-use pairing code" → "acceptAgent/denyAgent act on a pending join request").

- [ ] **Step 2: Strings**

`strings.ts` en: delete `printers.agent_label`, `printers.generate_title`, `printers.generate`, `printers.code_title`, `printers.code_hint`, `printers.copy`, `printers.copied`, `printers.done`; add:

```ts
  "printers.pending_title": "Print agents waiting to join",
  "printers.no_pending": "No agent is asking to join",
  "printers.verification_code": "Code",
  "printers.accept": "Accept",
  "printers.deny": "Deny",
  "printers.deny_confirm": "Confirm deny?",
  "printers.join_hint":
    "On the computer the printer is plugged into, open http://<that computer>:9110 and enter this server address:",
```

es:

```ts
  "printers.pending_title": "Agentes de impresión esperando aprobación",
  "printers.no_pending": "Ningún agente está pidiendo unirse",
  "printers.verification_code": "Código",
  "printers.accept": "Aceptar",
  "printers.deny": "Rechazar",
  "printers.deny_confirm": "¿Confirmar rechazo?",
  "printers.join_hint":
    "En el ordenador al que está conectada la impresora, abre http://<ese ordenador>:9110 e introduce esta dirección del servidor:",
```

Update the section comment (line 193) to "print agents (pending join requests · accept/deny · revoke · last-seen)". **There is no en/es key-parity test** — `apps/dashboard/src/i18n/t.test.ts` is the only strings suite and compares no key sets. Parity is enforced by TypeScript alone (`es` is typed `Record<StringKey, string>`), so an omission in `es` is a TYPECHECK error, not a test failure. Also confirmed safe: `printers.done` is not shared — `devices-screen.ts:568,571,576` uses the separate `devices.*` twins.

- [ ] **Step 3: Screen tests (failing first)**

In `printers-screen.test.ts`: the `agents` fixture gets `approvedAt`/`joinCode` on `a1` (approved) and `a2` (revoked, approved); add a third `a3: { id: "a3", name: "kitchen-pi", active: true, lastSeenAt: null, enrolledAt: "…", approvedAt: null, joinCode: "ABCD" }`. In `stubApi` replace `createAgentCode` with `acceptAgent: vi.fn().mockResolvedValue(undefined), denyAgent: vi.fn().mockResolvedValue(undefined)`. Delete the SIX generate/copy/dismiss tests (`:260, 277, 291, 308, 325, 342`).

Two further tests consume `createAgentCode` and must be retargeted, not deleted — they cover the
double-submit lock, which still matters: the parametrised `it.each` at ~`:1024-1030` and
`it("keeps Test Print working while Generate is pending without unlocking Generate")` at ~`:1080-1113`.
Point both at `acceptAgent` (the new primary mutation) and rename the second's "Generate" to "Accept".

Then add:

```ts
  // ── Agents: pending join requests ────────────────────────────────────────────────────────────────

  it("renders a pending agent under 'waiting to join' with its verification code, not in the enrolled list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    expect(text(el, "[data-test=pending-name-a3]")).toBe("kitchen-pi");
    expect(text(el, "[data-test=pending-code-a3]")).toBe("ABCD");
    expect(q(el, "[data-test=agent-row-a3]")).toBeNull();
    expect(q(el, "[data-test=agent-row-a1]")).toBeTruthy();
  });

  it("shows the empty pending placeholder and the join hint with this dashboard's origin", async () => {
    const api = stubApi({ listAgents: vi.fn().mockResolvedValue(agents.filter((a) => a.approvedAt !== null)) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=no-pending]")).toBeTruthy();
    expect(text(el, "[data-test=join-origin]")).toBe(window.location.origin);
  });

  it("accepts a pending agent on one click, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=accept-agent-a3]")!.click();
    await flush(el);
    expect(api.acceptAgent).toHaveBeenCalledWith("a3");
    expect(api.listAgents).toHaveBeenCalledTimes(2);
  });

  it("denies only on the confirming second click, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=deny-agent-a3]")!.click();
    await el.updateComplete;
    expect(api.denyAgent).not.toHaveBeenCalled();
    expect(text(el, "[data-test=deny-agent-a3]")).toBe(t("printers.deny_confirm", "es-ES"));
    q(el, "[data-test=deny-agent-a3]")!.click();
    await flush(el);
    expect(api.denyAgent).toHaveBeenCalledWith("a3");
  });

  it("shows the error banner when accept is rejected", async () => {
    const api = stubApi({ acceptAgent: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "agent.not_found" })) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=accept-agent-a3]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).toBeTruthy(); // the suite's banner selector (printers-screen.test.ts:252)
  });
```

The banner selector is `[role=alert]`, confirmed at `printers-screen.test.ts:252`.

**`printers-screen.a11y.test.ts`** (same step): its stub at `:119` provides `createAgentCode`, and its
second case at `:158`, `"renders the shown-once pairing-code panel accessibly"`, types into
`[data-test=agent-label]` (`:166`) and clicks `[data-test=generate-code]` (`:174`) — all deleted here.
Swap the stub entries for `acceptAgent`/`denyAgent` and replace that case with a pending-row one:

```ts
  it("renders a pending join request accessibly (accept and deny are named controls)", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
    await flush(el);
    expect(q(el, "[data-test=accept-agent-a3]")).toBeTruthy();
    expect(q(el, "[data-test=deny-agent-a3]")).toBeTruthy();
    await expectNoAxeViolations(el); // use whatever helper the file already calls
  });
```

- [ ] **Step 4: Screen implementation**

In `printers-screen.ts`:

- Delete state `newAgentLabel`, `generatedCode`, `copied`; add `@state() private armedDenyId: string | null = null;` beside `armedRevokeId`, and reset it in `#load` next to `armedRevokeId`.
- Delete `#onAgentLabel`, `#generateCode`, `#copyCode`, `#dismissCode`, `#renderCodePanel`. Add:

```ts
  /** Accept a pending agent (single click — accepting is the safe direction), then reload. */
  async #acceptAgent(id: string): Promise<void> {
    await this.#mutate(() => this.api.acceptAgent(id));
  }

  /** The two-step deny, the revoke shape: first click ARMS, second on the same row confirms. */
  #onDenyAgent(id: string): void {
    if (this.armedDenyId === id) {
      this.armedDenyId = null;
      void this.#mutate(() => this.api.denyAgent(id));
      return;
    }
    this.armedDenyId = id;
  }

  #renderPending(agent: PrintAgentRow): TemplateResult {
    const armed = this.armedDenyId === agent.id;
    return html`<li data-test="pending-row-${agent.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="pending-name-${agent.id}">${agent.name}</span>
            <span class="meta"
              >${t("printers.verification_code")}:
              <code data-test="pending-code-${agent.id}">${agent.joinCode ?? ""}</code></span
            >
          </div>
          <wt-button variant="primary" size="sm" data-test="accept-agent-${agent.id}" @click=${() => void this.#acceptAgent(agent.id)}
            >${t("printers.accept")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="deny-agent-${agent.id}"
            data-armed=${armed ? "true" : nothing}
            @click=${() => this.#onDenyAgent(agent.id)}
            >${armed ? t("printers.deny_confirm") : t("printers.deny")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }
```

- `#renderAgentsSection` becomes: the pending section first (`printers.pending_title`, list of `this.agents.filter((a) => a.approvedAt === null)` or `<p class="empty" data-test="no-pending">`), then the join hint `<p class="code-hint">${t("printers.join_hint")} <code data-test="join-origin">${window.location.origin}</code></p>`, then the existing enrolled list over `this.agents.filter((a) => a.approvedAt !== null)`. Update the class doc comment (lines 72-75) to describe accept/deny.

- [ ] **Step 5: Run the dashboard suite (browser mode — check headroom first)**

```bash
memory_pressure | grep free
pnpm --filter @waitron/dashboard test:coverage
pnpm --filter @waitron/dashboard lint typecheck
pnpm vitest run scripts/dashboard-browser-purity.test.ts
```

Expected: PASS at the floor; the a11y suite (`printers-screen.a11y.test.ts`) still passes — if it asserts the removed form, update it to the pending list.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/dashboard
git commit -s -m "feat(dashboard): print agents waiting to join — accept/deny replaces the pairing-code form"
```

---

### Task 9: `apps/print-agent` — the container host

**Files:**
- Create: `apps/print-agent/package.json`, `tsconfig.json`, `vitest.config.ts`, `Dockerfile`, `.dockerignore`, `src/config.ts` (+ test), `src/state.ts` (+ test), `src/setup-page.ts` (+ test), `src/host.ts` (+ test), `src/bin.ts`

**Interfaces:**
- Consumes: `createAgent`, `Host`, `AgentConfig`, `AgentStatus`, `RoutingTransport`, `NetworkTcpTransport`, `UsbTransport` (`@waitron/print-agent`).
- Produces:

```ts
// config.ts
export interface EnvConfig { serverUrl?: string; name?: string; stateDir: string; setupPort: number }
export function readEnv(env: NodeJS.ProcessEnv, hostname: string): EnvConfig   // defaults: stateDir /var/lib/waitron-print-agent, port 9110
// state.ts
export class FileState { constructor(dir: string); readConfig(): Promise<AgentConfig | null>; writeConfig(c: AgentConfig): Promise<void>; readToken(): Promise<string | null>; writeToken(t: string | null): Promise<void> }
// setup-page.ts
export interface SetupDeps { status: () => AgentStatus; config: () => Promise<AgentConfig | null>; saveConfig: (c: AgentConfig) => Promise<void>; envLocked: boolean; defaultName: string }
export function createSetupApp(deps: SetupDeps): Hono   // GET / (HTML), POST /setup (form), GET /status.json
// host.ts
export function createContainerHost(opts: { env: EnvConfig; state: FileState; fetch?: typeof fetch; log?: Console; onStatus: (s: AgentStatus) => void }): Host
```

- [ ] **Step 1: Scaffold**

`package.json`:

```json
{
  "name": "@waitron/print-agent-app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/bin.ts",
  "bin": { "waitron-print-agent": "./dist/print-agent.js" },
  "scripts": {
    "build": "esbuild src/bin.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/print-agent.js --banner:js=\"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\"",
    "dev": "tsx src/bin.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@waitron/print-agent": "workspace:*",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "esbuild": "^0.25.0",
    "tsx": "^4.23.1",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

(The package NAME is `@waitron/print-agent-app` so it does not collide with the library; the directory is `apps/print-agent` as the spec names it.)

`tsconfig.json` as `apps/server`'s with `"include": ["src"]`. `vitest.config.ts` — written out rather
than described, because `scripts/coverage-thresholds.test.ts` reads this file as TEXT and matches the
threshold literal exactly (a spread or an extra key fails it):

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Hermetic: temp dirs and `app.request`, no listener, no container, no hardware.
export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` is the process entry — wired by hand, exercised by a manual boot; everything it
      // calls is tested directly.
      exclude: [...coverageConfigDefaults.exclude, "src/bin.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
```

`Dockerfile`:

```dockerfile
# The print agent — one bundled file on node 24. Build from the workspace root:
#   pnpm --filter @waitron/print-agent-app build
#   docker build -t waitron-print-agent apps/print-agent
# Run (LAN setup page on 9110; a USB printer needs its device passed in):
#   docker run -d --name print-agent -v waitron-print-agent:/var/lib/waitron-print-agent \
#     -p 9110:9110 --device /dev/usb/lp0 -e WAITRON_SERVER_URL=https://box.example waitron-print-agent
FROM node:24-alpine
ENV NODE_ENV=production WAITRON_STATE_DIR=/var/lib/waitron-print-agent WAITRON_SETUP_PORT=9110
RUN mkdir -p /var/lib/waitron-print-agent && chown node:node /var/lib/waitron-print-agent
COPY dist/print-agent.js /app/print-agent.js
USER node
VOLUME ["/var/lib/waitron-print-agent"]
EXPOSE 9110
CMD ["node", "/app/print-agent.js"]
```

`.dockerignore`: `node_modules`, `src`, `coverage`, `*.test.ts`.

- [ ] **Step 2: `config.ts` + test**

Test (`src/config.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { readEnv } from "./config.js";

describe("readEnv", () => {
  it("applies the defaults and the hostname as the name", () => {
    expect(readEnv({}, "kitchen-pi")).toEqual({ serverUrl: undefined, name: "kitchen-pi", stateDir: "/var/lib/waitron-print-agent", setupPort: 9110 });
  });
  it("reads every value from env and refuses an empty server url and a bad port", () => {
    expect(readEnv({ WAITRON_SERVER_URL: "https://box.test/", WAITRON_AGENT_NAME: "n", WAITRON_STATE_DIR: "/tmp/x", WAITRON_SETUP_PORT: "9200" }, "h"))
      .toEqual({ serverUrl: "https://box.test", name: "n", stateDir: "/tmp/x", setupPort: 9200 });
    expect(readEnv({ WAITRON_SERVER_URL: "" }, "h").serverUrl).toBeUndefined();
    expect(() => readEnv({ WAITRON_SETUP_PORT: "abc" }, "h")).toThrow(/WAITRON_SETUP_PORT/);
    expect(() => readEnv({ WAITRON_SERVER_URL: "not a url" }, "h")).toThrow(/WAITRON_SERVER_URL/);
  });
});
```

Implementation: trim; an empty string is unset (CLAUDE.md §3's `isUnset` rule); `serverUrl` normalised to `new URL(v).origin`, throwing `WAITRON_SERVER_URL is not an http(s) origin` otherwise; the port must be an integer 1–65535.

- [ ] **Step 3: `state.ts` + test**

Test (`src/state.test.ts`, temp dir via `mkdtemp`, removed in `afterEach`):

```ts
it("reads null before anything is written; writes the token 0600 atomically; null clears it", async () => {
  const state = new FileState(dir);
  expect(await state.readToken()).toBeNull();
  expect(await state.readConfig()).toBeNull();
  await state.writeToken("a1.secret");
  expect(await state.readToken()).toBe("a1.secret");
  expect((await stat(join(dir, "token"))).mode & 0o777).toBe(0o600);
  expect(await readdir(dir)).not.toContain("token.tmp");
  await state.writeToken(null);
  expect(await state.readToken()).toBeNull();
  await state.writeConfig({ serverUrl: "https://a", name: "n" });
  expect(await state.readConfig()).toEqual({ serverUrl: "https://a", name: "n" });
});
it("a corrupt config.json reads as null (the page asks again) and does not throw", …);
```

Implementation: `mkdir(dir, { recursive: true })` on first write; `writeFile(tmp, data, { mode: 0o600 })` then `rename(tmp, path)`; `readToken` returns `null` on `ENOENT`; `readConfig` parses and validates `{ serverUrl: string, name: string, environment?: string }`, returning `null` on any failure.

- [ ] **Step 4: `setup-page.ts` + test**

Test (`src/setup-page.test.ts`) via `app.request`:

```ts
it("GET / unconfigured renders the server-address form with the default name", …);            // contains name="serverUrl" and value="kitchen-pi"
it("POST /setup saves { serverUrl, name } and redirects to /", …);                              // 303, saveConfig called with the origin-normalised url
it("POST /setup with a bad url re-renders the form with an error and saves nothing", …);        // 400
it("GET / pending shows the verification code; running shows current + last job; unauthorized says restart", …);
it("GET /status.json returns the status with no token field", …);
it("when envLocked, POST /setup is refused (405) and the form is read-only", …);
```

Implementation: a `Hono` app; the HTML is a template string (no framework, inline CSS, a `<meta name="viewport">`); `POST /setup` reads `await c.req.parseBody()`; the status page auto-refreshes with `<meta http-equiv="refresh" content="5">`. Copy: "Waitron print agent", "Server address", "Name", "Save", "Waiting for approval in the dashboard — verification code", "Following", "Last job", "Last error", "This agent was denied or revoked — restart it to ask to join again."

- [ ] **Step 5: `host.ts` + test**

```ts
export function createContainerHost(opts): Host {
  const transport = new RoutingTransport({ network_tcp: new NetworkTcpTransport(), usb: new UsbTransport() });
  return {
    config: async () => {
      // Env wins over the file: a compose-supplied address is never overridden by the page.
      if (opts.env.serverUrl !== undefined) {
        const saved = await opts.state.readConfig();
        return { serverUrl: opts.env.serverUrl, name: opts.env.name ?? saved?.name ?? "print-agent", environment: saved?.environment };
      }
      return opts.state.readConfig();
    },
    saveConfig: (c) => opts.state.writeConfig(c),
    token: () => opts.state.readToken(),
    saveToken: (t) => opts.state.writeToken(t),
    transport,
    fetch: opts.fetch ?? fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: { info: (m, f) => log.info(line(m, f)), warn: …, error: … },   // one JSON line per call
    status: opts.onStatus,
  };
}
```

Test: env precedence (env url + saved environment survive), file-only config, `saveToken` round-trips through a `FileState` on a temp dir, `status` forwards.

- [ ] **Step 6: `bin.ts`**

```ts
import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import { createAgent, type AgentStatus } from "@waitron/print-agent";
import { readEnv } from "./config.js";
import { createContainerHost } from "./host.js";
import { createSetupApp } from "./setup-page.js";
import { FileState } from "./state.js";

const env = readEnv(process.env, hostname());
const state = new FileState(env.stateDir);
let status: AgentStatus = { phase: "unconfigured", serverUrl: null, current: null };
const host = createContainerHost({ env, state, onStatus: (s) => { status = s; } });
const agent = createAgent({ host });
const page = createSetupApp({
  status: () => status,
  config: () => host.config(),
  saveConfig: (c) => host.saveConfig(c),
  envLocked: env.serverUrl !== undefined,
  defaultName: env.name ?? hostname(),
});
serve({ fetch: page.fetch, port: env.setupPort, hostname: "0.0.0.0" });
host.log.info("setup page", { port: env.setupPort });
const stop = (): void => { agent.stop(); process.exit(0); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await agent.start();
```

- [ ] **Step 7: Build, run the suite, smoke the bundle**

```bash
pnpm install
pnpm --filter @waitron/print-agent-app test:coverage lint typecheck
pnpm --filter @waitron/print-agent-app build
WAITRON_STATE_DIR=$(mktemp -d) WAITRON_SETUP_PORT=9111 gtimeout 5 node apps/print-agent/dist/print-agent.js; echo "exit=$?"
```

Expected: tests green at the floor; the bundle starts, logs the setup page line and a `phase unconfigured` line, and `gtimeout` ends it (exit 124). Optionally `curl -s localhost:9111/status.json` during those 5 s shows `"phase":"unconfigured"`.

- [ ] **Step 8: Register the app in the CI shard bins**

Same rule as Task 1 (`scripts/changed-scope.mjs:274-276`; `scripts/ci-workflow.test.mjs` asserts every
member appears in exactly one bin): add `"@waitron/print-agent-app"` to `LIGHT_B_PACKAGES`
(`scripts/changed-scope.mjs:297-314`) and the matching literal exclusion line to `.github/workflows/ci.yml`'s
**test-light-a** step (`:1112-1135`): `set -- "$@" --filter "!@waitron/print-agent-app"`.

Run: `pnpm vitest run scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && pnpm format:check
git add apps/print-agent scripts/changed-scope.mjs .github/workflows/ci.yml pnpm-lock.yaml
git commit -s -m "feat(print-agent-app): container host — env/state-dir config, LAN setup/status page, esbuild bundle, Dockerfile"
```

---

### Task 10: End to end — the real routes, the agent loop, a loopback printer

**Files:**
- Create: `apps/server/src/print-agent-e2e.test.ts`
- Modify: `apps/server/package.json` (devDependency `"@waitron/print-agent": "workspace:*"`)

**Interfaces:**
- Consumes: `mountPrintApi` (Task 7), `mountNodeApi` (`node-api.ts`), `createAgent` + `fakeHost` (Task 4), `NetworkTcpTransport` (Task 1), `enqueuePrintJob`/`esc` (`@waitron/printing`).

- [ ] **Step 1: Write the e2e**

```ts
import net from "node:net";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { enqueuePrintJob, esc } from "@waitron/printing";
import { NetworkTcpTransport, createAgent, createClient } from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountNodeApi } from "./node-api.js";
import { mountPrintApi } from "./print-api.js";
import "./errors.js";

// The whole arc in one process: the real print + node routes on PGlite, the real agent loop with its
// fetch pointed at the Hono app, and a loopback TCP listener standing in for a 9100 printer. The
// physical-printer half is manual (spec §6); this proves everything up to the socket.
const noopLog: Logger = () => {};
const NODE_ID = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "http://box.test";

let tenantId: string;
let locationId: string;
let managerCookie: string;
let app: Hono;
let printer: net.Server;
let printerPort: number;
const received: Buffer[] = [];

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`insert into locations (tenant_id, name, invoice_locales, operation_description) values (${tenantId}, 'Barra', array['es-ES'], 'Venta') returning id`);
    locationId = loc.rows[0]!.id;
    const sid = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`insert into persons (tenant_id, display_name, pin_hash, role) values (${tenantId}, 'M', ${hashPin("1234")}, 'manager') returning id`);
      return (await startManagementSession(tx, { tenantId, personId: mgr.rows[0]!.id })).id;
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${sid}`;
  },
});

beforeAll(async () => {
  app = new Hono();
  mountNodeApi(app, { nodeId: NODE_ID, acceptingSales: true, environment: "preproduction", readMembership: async () => null }, noopLog);
  mountPrintApi(app, { db: suite.db, cfg: { tenantId, locationId, nodeId: NODE_ID }, readMembership: async () => null }, noopLog);
  printer = net.createServer((socket) => socket.on("data", (chunk) => received.push(chunk)));
  await new Promise<void>((resolve) => printer.listen(0, "127.0.0.1", resolve));
  printerPort = (printer.address() as net.AddressInfo).port;
});
afterAll(async () => {
  if (printer !== undefined) await new Promise<void>((resolve) => printer.close(() => resolve()));
});

/** The agent's fetch, routed into the in-process Hono app (a full URL; Hono matches on the path). */
const appFetch: typeof fetch = (input, init) => app.request(String(input), init);

const manage = (method: "POST" | "GET", path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie: managerCookie, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe("print agent end to end", () => {
  it("join → accept → enqueue → pull → bytes on the printer → done; revoke → unauthorized and halted", async () => {
    const host = fakeHost({ config: { serverUrl: ORIGIN, name: "e2e-agent" }, transport: new NetworkTcpTransport(), fetch: appFetch });
    const agent = createAgent({ host, client: createClient({ fetch: appFetch }) });

    await agent.runOnce();
    expect(agent.status.phase).toBe("pending");
    const code = agent.status.verificationCode!;
    const pending = (await (await manage("GET", "/management-api/print-agents")).json()) as { id: string; joinCode: string | null; name: string }[];
    const mine = pending.find((r) => r.name === "e2e-agent")!;
    expect(mine.joinCode).toBe(code);

    await agent.runOnce();
    expect(agent.status.phase).toBe("pending");

    expect((await manage("POST", `/management-api/print-agents/${mine.id}/accept`)).status).toBe(204);
    await agent.runOnce();
    expect(agent.status.phase).toBe("running");
    expect(agent.status.current).toBe(ORIGIN);

    const created = await manage("POST", "/management-api/printers", { name: "Loopback", transport: "network_tcp", agentId: mine.id, host: "127.0.0.1", port: printerPort });
    expect(created.status).toBe(201);
    const { id: printerId } = (await created.json()) as { id: string };
    const payload = esc().init().line("Hola").cut().bytes();
    const { jobId } = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      // `enqueuePrintJob(tx, cfg, printerId, payload) => { jobId }` (outbox.ts:21-26) — positional,
      // not an input object, and it returns a wrapper. The idiom is print-api.test.ts:123-129.
      return enqueuePrintJob(tx, { tenantId, locationId }, printerId, payload);
    });

    await agent.runOnce();
    await new Promise((r) => setTimeout(r, 50)); // let the listener drain the socket
    expect(Buffer.concat(received)).toEqual(Buffer.from(payload));
    const job = await suite.db.execute<{ status: string }>(sql`select status from print_jobs where id = ${jobId}`);
    expect(job.rows[0]!.status).toBe("done");
    expect(agent.status.lastJobAt).toBeTypeOf("number");

    expect((await manage("POST", `/management-api/print-agents/${mine.id}/revoke`)).status).toBe(204);
    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
    expect(await host.token()).toBeNull();
    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
  });
});
```

Both signatures are confirmed against the code: `enqueuePrintJob(tx, cfg, printerId, payload) => { jobId }` (`outbox.ts:21-26`) and `mountNodeApi(app, deps, log)` (`node-api.ts:52`). Write them as given.

- [ ] **Step 2: Run it**

```bash
pnpm install
pnpm --filter @waitron/server test -- print-agent-e2e
```

Expected: PASS. If the bytes assertion is empty, the `NetworkTcpTransport` resolved before the listener's `data` fired — raise the wait to 200 ms, not the transport.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter @waitron/server lint typecheck && pnpm format:check
git add apps/server
git commit -s -m "test(server): print-agent end to end — join, accept, pull, loopback printer, revoke"
```

---

### Task 11: Docs and the gate

**Files:**
- Modify: `docs/backlog.md` (Track H item 1 → "BUILT, PR #…"; the *Printing + hardware surface* paragraph), `docs/superpowers/specs/2026-09-08-print-agent-process-design.md` (status line: built, PR number, the manual-receipt row left open until the owner's HP run)

- [ ] **Step 1: Backlog + spec status**

In the spec's line 3: `**Status:** built (PR #<n>), awaiting the manual HP receipt (§6).` In `docs/backlog.md` Track H's bullet: item 1 → `**BUILT** (#<n>; manual HP receipt pending)`. Fill `#<n>` after `/finish-branch` opens the PR.

- [ ] **Step 2: The full gate, then finish-branch**

```bash
pnpm reap
memory_pressure | grep free
pnpm lint && pnpm typecheck && pnpm format:check
TESTCONTAINERS_RYUK_DISABLED=true pnpm test
git diff --name-only origin/main..HEAD
```

Expected: green; the diff touches only the paths in the file map plus `pnpm-lock.yaml`. Then commit the docs, run `/finish-branch` (light path: no fiscal trigger, but the schema/grant change IS a migrations trigger — so the FULL ceremony: per-task reviews already ran, the wave keeps the simplify lenses + the Codex run-it seat).

---

## Self-review

- **Spec coverage.** §1 decisions → Tasks 4 (Host/halt), 3 (servers from the pull, no discovery), 6–8 (join-and-accept, pairing deleted), 9 (LAN page). §2.1 → Tasks 1–4. §2.2 → Task 9. §2.3 data/auth/routes/dashboard → Tasks 5, 6, 7, 8. §3 → Task 4 tests (pending, unauthorized halts) + Task 10. §4 → Task 4 (one simplification: any non-empty batch re-polls at once, not only a full one — one extra empty request per burst, noted in `POLL_INTERVAL_MS`'s comment). §5 → Task 6 (cap refused not evicted, secret-before-approval), Task 7 (limiter first), Task 9 (0600, no secret on the page). §6 → every task's tests; the manual HP run is the owner's, after the PR. §7 untouched. §8 → Task 11's diff check.
- **Placeholders.** Task 7 Step 1's rate-limit test is described by substitution from the existing test rather than repeated — the four substitutions are enumerated and the source lines named; Task 9 Steps 4–5 give the test names and the copy but not every HTML line. Both are deliberate: the implementer transcribes from a named source.
- **Type consistency.** `Result`/`Failure` (Task 2) are what Task 3's `probe` and Task 4's loop consume; `AgentStatus.verificationCode` is set in Task 4 and read by Task 9's page and Task 10; `PrintApiDeps.cfg.nodeId` + `readMembership` (Task 7) match the two test `mountApp`s and Task 10's mount; `joinAndAccept` returns `{ agentId, token }` as the old helper did.
