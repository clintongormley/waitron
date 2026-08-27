# Sync Outbound Tunnel (cloud-mirror sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cloud subscriber pull sync data from a NAT'd venue box by inverting only the transport — the box dials out to a relay that blindly splices the cloud's TLS connection to the box's own HTTPS sync-api — with `runSyncPull` and the per-peer token auth unchanged.

**Architecture:** A new pure-Node `@waitron/tunnel` package holds a box-side tunnel client (`runTunnelClient`: a pool of outbound connections to a relay, a tiny newline-JSON handshake, then a raw byte splice to a local port) and a `testing/relay.ts` stand-in that pairs a box connection with a cloud connection and splices them. TLS runs end-to-end box↔cloud, so the relay only moves ciphertext. `apps/server` gains a `loadTunnelConfig` loader, a small tunnel-aware HTTP client for the cloud side, boot wiring guarded by config, and a real-Postgres e2e that proves the cloud pulls through the tunnel while the relay stays blind.

**Tech Stack:** TypeScript (ESM), Node `net`/`tls`, `undici` (already an `apps/server` dep), Vitest, Testcontainers (Postgres, e2e only). No new third-party dependency.

**Spec:** `docs/superpowers/specs/2026-08-27-sync-cloud-mirror-tunnel-design.md` — read it alongside this plan; the plan argues from it.

## Global Constraints

- **No application-level sync change.** `packages/sync/src/pull.ts`, `apps/server/src/sync-api.ts`, the wire format, the cursor/retention model, and sub-project A's per-peer token auth are **untouched**. B adds transport beneath them.
- **No SQL, no migration, no RLS, no grant** in this whole plan. `@waitron/tunnel` introduces no table.
- **English identifiers only.** Do not add `@waitron/tunnel` to `GENERIC_PACKAGES` (the english-only guard is opt-in per-package; the package is English by construction, and adding it would break a regex pinned in an out-of-scope package's `vocabulary-scope.test.ts` — CLAUDE.md §2). Just don't write Spanish.
- **Log codes name the domain concept** (`tunnel.*`), lowercase, dot-namespaced (CLAUDE.md §3). They are **logged as free strings**, never thrown as `AppError` — exactly like `sync.pull_failed`/`sync.cursor_report_failed`, which are logged but not in the `ErrorParams` registry. So this package ships **no `errors.ts`** and takes **no `@waitron/shared` dependency**. No log line or test name may carry a token or payload byte.
- **Config errors reuse `server.config_invalid`** (the existing code `loadSyncConfig` throws), never a new code.
- **Reuse crypto, write none.** The relay stand-in verifies the box token through an injected `verifyToken`; tests supply `crypto.timingSafeEqual`. No crypto is written in this package.
- **Coverage thresholds:** `@waitron/tunnel` and `@waitron/server` hold statements 98 / lines 98 / functions 98 / branches 95. Exclude the `src/index.ts` barrel from coverage (the `@waitron/shared` precedent).
- **Injected time only.** Every backoff/heartbeat delay goes through an injected `sleep(ms, signal)` and an `AbortSignal` (the `loop.ts`/`runSyncPull` idiom) so suites assert durations and SIGTERM never waits one out. Never call real `setTimeout`/`Date.now()` in the client.
- **Real Postgres for the e2e** (it exercises `sync_log`/`sync_cursor` under the sync roles; PGlite cannot show the role split — CLAUDE.md §4). Set `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **`git commit -s`** on every commit (DCO).

---

### Task 1: Scaffold `@waitron/tunnel` + the wire protocol + CI registration

**Files:**
- Create: `packages/tunnel/package.json`
- Create: `packages/tunnel/tsconfig.json`
- Create: `packages/tunnel/vitest.config.ts`
- Create: `packages/tunnel/src/index.ts`
- Create: `packages/tunnel/src/protocol.ts`
- Test: `packages/tunnel/src/protocol.test.ts`
- Modify: `scripts/changed-scope.mjs` (add `@waitron/tunnel` to `LIGHT_A_PACKAGES`)
- Modify: `.github/workflows/ci.yml` (test-light-b step: add `--filter "!@waitron/tunnel"`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Produces:
  - `type Frame = { t: "register"; boxId: string; token: string } | { t: "ack" } | { t: "reject"; code: string } | { t: "ping" } | { t: "pong" } | { t: "go" }`
  - `encodeFrame(frame: Frame): Buffer` — the frame as JSON + `"\n"`.
  - `decodeFrame(buffer: Buffer): { frame: Frame; rest: Buffer } | null` — the **first** complete newline-terminated frame and the bytes after its newline, or `null` when no complete line is buffered yet. **Never parses past one frame** — this is what lets the caller stop at `go` and hand `rest` to the splice without a TLS byte ever reaching the JSON parser.

- [ ] **Step 1: Create the package manifest.** `packages/tunnel/package.json`:

```json
{
  "name": "@waitron/tunnel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./testing/relay.js": "./src/testing/relay.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

The `exports` map is enumerated, not a wildcard (the `@waitron/db` convention, CLAUDE.md §3); `./testing/relay.js` maps to the `.ts` source (Task 2 creates the file).

- [ ] **Step 2: Create `tsconfig.json`** (mirror `packages/shared/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`** (mirror `packages/shared/vitest.config.ts`, keeping `singleFork` — it is load-bearing under the pre-push hook's `pnpm -r` load, CLAUDE.md/memory `singlefork-is-load-bearing`):

```typescript
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Single fork: @vitest/coverage-v8 under-merges branch coverage across forks under the
    // whole-workspace `pnpm -r test:coverage` the pre-push hook runs. The suite is tiny, so one
    // fork costs nothing and makes the gate deterministic (the packages/shared precedent).
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic (packages/shared precedent).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

- [ ] **Step 4: Write the failing protocol test.** `packages/tunnel/src/protocol.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "./protocol.js";

describe("encodeFrame", () => {
  it("serialises a frame as one newline-terminated JSON line", () => {
    expect(encodeFrame({ t: "ack" }).toString()).toBe('{"t":"ack"}\n');
  });
});

describe("decodeFrame", () => {
  it("returns null when no complete line is buffered yet", () => {
    expect(decodeFrame(Buffer.from('{"t":"a'))).toBeNull();
  });

  it("returns the first frame and the empty rest for one exact line", () => {
    const r = decodeFrame(encodeFrame({ t: "ping" }));
    expect(r).not.toBeNull();
    expect(r!.frame).toEqual({ t: "ping" });
    expect(r!.rest.length).toBe(0);
  });

  it("returns ONLY the first frame, leaving the second in rest", () => {
    const buf = Buffer.concat([encodeFrame({ t: "ack" }), encodeFrame({ t: "go" })]);
    const r = decodeFrame(buf)!;
    expect(r.frame).toEqual({ t: "ack" });
    expect(r.rest.toString()).toBe('{"t":"go"}\n');
  });

  it("hands raw post-go bytes back untouched as rest (the splice leftover)", () => {
    // A TLS ClientHello starts 0x16 0x03; it must never be parsed as a frame.
    const tls = Buffer.from([0x16, 0x03, 0x01, 0x00, 0x2a]);
    const buf = Buffer.concat([encodeFrame({ t: "go" }), tls]);
    const r = decodeFrame(buf)!;
    expect(r.frame).toEqual({ t: "go" });
    expect(r.rest.equals(tls)).toBe(true);
  });

  it("accepts a frame split across two reads by re-decoding the concatenation", () => {
    const whole = encodeFrame({ t: "reject", code: "tunnel.registration_rejected" });
    const first = whole.subarray(0, 5);
    expect(decodeFrame(first)).toBeNull();
    const r = decodeFrame(Buffer.concat([first, whole.subarray(5)]))!;
    expect(r.frame).toEqual({ t: "reject", code: "tunnel.registration_rejected" } satisfies Frame);
  });
});
```

- [ ] **Step 5: Run it, watch it fail.** Run: `pnpm --filter @waitron/tunnel test protocol` — Expected: FAIL (`decodeFrame`/`encodeFrame` not found).

- [ ] **Step 6: Implement `protocol.ts`:**

```typescript
// The tunnel's control-plane wire format: newline-delimited JSON frames used ONLY for the
// pre-splice handshake. After a `go` frame the connection carries raw bytes (the cloud's TLS
// records) and is never reframed — so decodeFrame stops after exactly one frame and returns the
// remaining bytes verbatim as `rest`, which the client hands straight to the byte splice.
export type Frame =
  | { t: "register"; boxId: string; token: string }
  | { t: "ack" }
  | { t: "reject"; code: string }
  | { t: "ping" }
  | { t: "pong" }
  | { t: "go" };

export function encodeFrame(frame: Frame): Buffer {
  return Buffer.from(`${JSON.stringify(frame)}\n`);
}

/**
 * The first complete newline-terminated frame in `buffer`, plus the bytes after that newline as
 * `rest`; or `null` when no `\n` has arrived yet. Parses at most one line, so bytes after a `go`
 * frame (raw TLS) are returned untouched in `rest` rather than fed to JSON.parse.
 */
export function decodeFrame(buffer: Buffer): { frame: Frame; rest: Buffer } | null {
  const nl = buffer.indexOf(0x0a);
  if (nl === -1) return null;
  const line = buffer.subarray(0, nl).toString();
  const rest = buffer.subarray(nl + 1);
  return { frame: JSON.parse(line) as Frame, rest };
}
```

- [ ] **Step 7: Create the barrel** `packages/tunnel/src/index.ts`:

```typescript
// The public surface of @waitron/tunnel. Re-exports only.
export { decodeFrame, encodeFrame } from "./protocol.js";
export type { Frame } from "./protocol.js";
```

- [ ] **Step 8: Run the protocol suite green.** Run: `pnpm --filter @waitron/tunnel test:coverage` — Expected: PASS, thresholds met.

- [ ] **Step 9: Register the package in the CI light shard.** In `scripts/changed-scope.mjs`, add `"@waitron/tunnel"` to `LIGHT_A_PACKAGES` (the array literal; put it next to `"@waitron/sync"`). A new package MUST land in exactly one light bin or `ci-workflow.test.mjs`'s partition assertion fails (see the `LIGHT_A_PACKAGES` doc comment in that file).

- [ ] **Step 10: Subtract it from the other bin in ci.yml.** In `.github/workflows/ci.yml`, in the **`test-light-b`** step's "LIGHT_A_PACKAGES — the other bin" subtraction block, add a line mirroring the siblings:

```bash
          set -- "$@" --filter "!@waitron/tunnel"
```

(Do **not** add any exclusion in `test-light-a` — bin A is where tunnel runs.) Verify the block you edited is the light-b one by confirming it already lists `!@waitron/sync` among the LIGHT_A subtractions.

- [ ] **Step 11: Update the lockfile.** Run: `pnpm install` (from the repo root). Expected: `pnpm-lock.yaml` gains `packages/tunnel`; no other resolution change.

- [ ] **Step 12: Prove the CI partition + scope guards still hold.** Run:
`pnpm vitest run scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs`
Expected: PASS — every workspace member (now including `@waitron/tunnel`) is selected by exactly one shard, nothing twice. If the partition test fails, re-check Steps 9–10.

- [ ] **Step 13: Commit.**

```bash
git add packages/tunnel scripts/changed-scope.mjs .github/workflows/ci.yml pnpm-lock.yaml
git commit -s -m "feat(tunnel): scaffold @waitron/tunnel + wire protocol; register in CI light-a shard"
```

---

### Task 2: The relay stand-in (`testing/relay.ts`)

**Files:**
- Create: `packages/tunnel/src/testing/relay.ts`
- Test: `packages/tunnel/src/testing/relay.test.ts`

**Interfaces:**
- Consumes: `encodeFrame`, `decodeFrame`, `Frame` (Task 1).
- Produces:
  - `interface RelayStandin { boxPort: number; clientPort: number; bytesSeen(): Buffer[]; close(): Promise<void> }`
  - `createRelayStandin(opts: { verifyToken: (boxId: string, token: string) => boolean; host?: string }): Promise<RelayStandin>` — starts two loopback listeners. Box connections `register`; a valid one is `ack`'d and parked in an idle pool keyed by `boxId`; an invalid one gets `{ t: "reject", code: "tunnel.registration_rejected" }` and is closed. A client connection to `clientPort` pops the oldest idle box connection (waiting briefly if none), sends it `go`, then splices the two sockets raw in both directions. `bytesSeen()` returns every buffer the relay copied client→box (for the blindness assertion — the relay records but never interprets).

- [ ] **Step 1: Write the failing pairing test.** `packages/tunnel/src/testing/relay.test.ts`:

```typescript
import { connect, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "../protocol.js";
import { createRelayStandin, type RelayStandin } from "./relay.js";

let relay: RelayStandin | undefined;
afterEach(async () => {
  if (relay !== undefined) await relay.close();
  relay = undefined;
});

const readFrame = (s: Socket): Promise<ReturnType<typeof decodeFrame>> =>
  new Promise((res) => s.once("data", (d) => res(decodeFrame(d))));

describe("createRelayStandin", () => {
  it("acks a box that registers with a valid token", async () => {
    relay = await createRelayStandin({ verifyToken: (id, t) => id === "box-1" && t === "good" });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "box-1", token: "good" }));
    expect((await readFrame(box))!.frame).toEqual({ t: "ack" });
    box.destroy();
  });

  it("rejects a bad token and closes the connection", async () => {
    relay = await createRelayStandin({ verifyToken: () => false });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "box-1", token: "nope" }));
    expect((await readFrame(box))!.frame).toEqual({
      t: "reject",
      code: "tunnel.registration_rejected",
    });
  });

  it("pairs a client with an idle box connection and splices both directions", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    // Box registers and waits for `go`, then echoes.
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await readFrame(box); // ack
    box.on("data", (d) => {
      const r = decodeFrame(d);
      if (r && r.frame.t === "go") {
        if (r.rest.length) box.write(r.rest); // echo any leftover
        box.on("data", (chunk) => box.write(chunk)); // echo subsequent bytes
      }
    });
    // Client connects and sends a payload; expects it echoed back through the splice.
    const client = connect(relay.clientPort, "127.0.0.1");
    const got = new Promise<string>((res) => client.once("data", (d) => res(d.toString())));
    // Give the relay a tick to send `go` before the client speaks.
    await new Promise((r) => setTimeout(r, 20));
    client.write("hello-through-the-tunnel");
    expect(await got).toBe("hello-through-the-tunnel");
    expect(relay.bytesSeen().map((b) => b.toString()).join("")).toContain("hello-through-the-tunnel");
    client.destroy();
    box.destroy();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/tunnel test relay` — Expected: FAIL (`createRelayStandin` not found).

- [ ] **Step 3: Implement `testing/relay.ts`.** Two `net.Server`s on ephemeral ports (`listen(0)`); an idle-pool `Map<string, Socket[]>`; on box `register` verify + `ack` + push to pool (or `reject` + destroy); on client connect, pop the oldest idle socket for any box (single-box stand-in — take the first pool with an idle socket; if none, wait up to a short timeout on an internal "idle available" signal), write `encodeFrame({ t: "go" })` to it, record client→box bytes into a `bytesSeen` array, and wire the raw splice:

```typescript
// Copy raw bytes both ways; record the client→box direction so a test can assert the relay only
// ever saw ciphertext. Attach both handlers synchronously so no chunk is dropped between `go` and
// the splice (Node will not emit the next 'data' until the current handler returns).
box.write(encodeFrame({ t: "go" }));
client.on("data", (d) => { seen.push(d); box.write(d); });
box.on("data", (d) => client.write(d));
const endBoth = () => { client.destroy(); box.destroy(); };
client.on("close", endBoth); box.on("close", endBoth);
client.on("error", endBoth); box.on("error", endBoth);
```

`close()` closes both servers and destroys any parked idle sockets, resolving when both `server.close` callbacks fire. Read box registration frames with a small per-socket buffer + `decodeFrame` loop (a `register` is one frame; ignore/`pong` any `ping` that arrives while idle — Task 3's client sends them).

- [ ] **Step 4: Run the relay suite green.** Run: `pnpm --filter @waitron/tunnel test:coverage` — Expected: PASS, thresholds met. (The relay lives under `src/testing/` but is real code with real tests; it is not a coverage-excluded barrel.)

- [ ] **Step 5: Commit.**

```bash
git add packages/tunnel/src/testing/relay.ts packages/tunnel/src/testing/relay.test.ts
git commit -s -m "feat(tunnel): relay stand-in — register/ack/reject + blind byte splice"
```

---

### Task 3: The tunnel client — pool, handshake, splice (happy path)

**Files:**
- Create: `packages/tunnel/src/client.ts`
- Test: `packages/tunnel/src/client.test.ts`
- Modify: `packages/tunnel/src/index.ts` (export the client)

**Interfaces:**
- Consumes: `encodeFrame`, `decodeFrame` (Task 1); `createRelayStandin` (Task 2, test only).
- Produces:
  - `interface TunnelClientDeps { relayHost: string; relayPort: number; boxId: string; token: string; localHost?: string; localPort: number; poolSize?: number; sleep: (ms: number, signal: AbortSignal) => Promise<void>; signal: AbortSignal; log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void; heartbeatMs?: number; minBackoffMs?: number; maxBackoffMs?: number }`
  - `runTunnelClient(deps: TunnelClientDeps): Promise<void>` — resolves when `deps.signal` aborts. Maintains `poolSize` (default 4) registered idle connections to the relay; on `go`, dials `localPort` and splices, then replenishes the pool. (Heartbeat + reconnect land in Task 4; this task is the single-connection happy path plus pool replenishment.)

- [ ] **Step 1: Write the failing round-trip test.** `packages/tunnel/src/client.test.ts` — stand up the real relay, a loopback "local service" that echoes, and the client; assert a client payload round-trips relay→tunnel-client→local-service→back:

```typescript
import { connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayStandin, type RelayStandin } from "./testing/relay.js";
import { runTunnelClient } from "./client.js";

let relay: RelayStandin | undefined;
let local: Server | undefined;
let ac: AbortController | undefined;
afterEach(async () => {
  ac?.abort();
  if (relay !== undefined) await relay.close();
  if (local !== undefined) await new Promise((r) => local!.close(() => r(null)));
  relay = local = ac = undefined;
});

const realSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }, { once: true });
  });

it("splices a client request down to the local service and back", async () => {
  local = createServer((s: Socket) => s.on("data", (d) => s.write(Buffer.concat([Buffer.from("echo:"), d]))));
  const localPort = await new Promise<number>((r) => local!.listen(0, () => r((local!.address() as { port: number }).port)));
  relay = await createRelayStandin({ verifyToken: () => true });
  ac = new AbortController();
  void runTunnelClient({
    relayHost: "127.0.0.1", relayPort: relay.boxPort, boxId: "b", token: "t",
    localPort, poolSize: 2, sleep: realSleep, signal: ac.signal,
    log: () => {},
  });
  await new Promise((r) => setTimeout(r, 50)); // let the pool register
  const client = connect(relay.clientPort, "127.0.0.1");
  const got = new Promise<string>((res) => client.once("data", (d) => res(d.toString())));
  await new Promise((r) => setTimeout(r, 20));
  client.write("ping");
  expect(await got).toBe("echo:ping");
  client.destroy();
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/tunnel test client` — Expected: FAIL (`runTunnelClient` not found).

- [ ] **Step 3: Implement `client.ts`.** A per-connection state machine: dial relay (`net.connect`), send `register`, buffer bytes and `decodeFrame` in a loop; on `ack` mark idle; on `go` switch to splice mode — dial `localPort`, write the post-`go` `rest` to the local socket first, then splice raw both ways (attach both `.on("data")` handlers synchronously in the `go` handler so no chunk is lost), and trigger a pool top-up. Keep a set of live connections; a `topUp()` opens connections until `poolSize` are registered-or-connecting. `import "./errors.js"` is **not** used (no errors.ts, per Global Constraints). Log `tunnel.*` codes via `deps.log`. The named splice-leftover concern (CLAUDE.md §1): the `go` handler MUST feed `rest` to the local socket before piping.

```typescript
// On `go`: dial the local service and splice. The rest (bytes buffered past the go newline) is fed
// to the local socket FIRST so nothing the cloud already sent is dropped, then both directions are
// wired synchronously — Node emits no further 'data' until this handler returns, so attaching the
// pipes here cannot race a lost chunk.
const local = connect(deps.localPort, deps.localHost ?? "127.0.0.1");
if (rest.length) local.write(rest);
relayConn.on("data", (d) => local.write(d));
local.on("data", (d) => relayConn.write(d));
// ...teardown on close/error either side; then topUp() to replace the consumed connection.
```

- [ ] **Step 4: Export the client** from `src/index.ts`:

```typescript
export { runTunnelClient } from "./client.js";
export type { TunnelClientDeps } from "./client.js";
```

- [ ] **Step 5: Run the client suite green.** Run: `pnpm --filter @waitron/tunnel test:coverage` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/tunnel/src/client.ts packages/tunnel/src/client.test.ts packages/tunnel/src/index.ts
git commit -s -m "feat(tunnel): box tunnel client — connection pool, handshake, splice-to-local"
```

---

### Task 4: Client resilience — heartbeat, reconnect/backoff, shutdown

**Files:**
- Modify: `packages/tunnel/src/client.ts`
- Test: `packages/tunnel/src/client.resilience.test.ts`

**Interfaces:**
- Consumes/Produces: extends `runTunnelClient` behaviour; no signature change. Adds two logged codes: `tunnel.stream_stalled` (backoff saturated at `maxBackoffMs` — operator alarm, params `{ boxId, backoffMs }`, no payload) and `tunnel.connection_lost` (an idle/registered connection dropped and is being replaced, params `{ boxId }`).

- [ ] **Step 1: Write the failing reconnect/backoff test.** Point the client at a **closed** port with a fake `sleep` that records durations and lets the loop turn; assert the backoff doubles from `minBackoffMs` to `maxBackoffMs` and that `tunnel.stream_stalled` is logged exactly when it first saturates. Then open a relay on that port and assert the pool recovers.

```typescript
it("backs off exponentially on an unreachable relay and logs stream_stalled at saturation", async () => {
  const durations: number[] = [];
  const ac = new AbortController();
  const codes: string[] = [];
  const fakeSleep = async (ms: number) => {
    durations.push(ms);
    if (durations.length >= 5) ac.abort(); // stop after a few cycles
  };
  await runTunnelClient({
    relayHost: "127.0.0.1", relayPort: 1, boxId: "b", token: "t", localPort: 1,
    poolSize: 1, sleep: fakeSleep as never, signal: ac.signal,
    minBackoffMs: 100, maxBackoffMs: 400,
    log: (_l, code) => codes.push(code),
  });
  expect(durations.slice(0, 4)).toEqual([100, 200, 400, 400]);
  expect(codes.filter((c) => c === "tunnel.stream_stalled")).toHaveLength(1); // once, at first saturation
});
```

- [ ] **Step 2: Write the failing heartbeat test.** A relay variant (or a raw `net.Server`) that accepts + acks a box connection then goes silent; assert the client, after `heartbeatMs` with no `pong`, drops that connection (logs `tunnel.connection_lost`) and re-registers. Use the injected `sleep` to drive the heartbeat clock.

- [ ] **Step 3: Write the failing shutdown test.** Start the client against a live relay; `ac.abort()`; assert `runTunnelClient` resolves promptly and every socket it opened is destroyed (no open handles).

- [ ] **Step 4: Run them, watch them fail.** Run: `pnpm --filter @waitron/tunnel test resilience` — Expected: FAIL.

- [ ] **Step 5: Implement resilience in `client.ts`.** A supervisory loop that keeps `poolSize` connections alive: a failed *establish* (connect refused / reject) drives a shared bounded-exponential backoff (`min`, doubling, capped at `max`), logging `tunnel.stream_stalled` on the transition into saturation (mirror `runSyncPull`'s `prev < max && next >= max` guard); a successful register resets it. Each idle connection runs a heartbeat: send `ping` every `heartbeatMs`; if no `pong` by the next tick (or the socket closes), destroy it, log `tunnel.connection_lost`, and top the pool back up. All timing via `deps.sleep(ms, deps.signal)`; the whole loop and every socket tears down on `deps.signal` abort. Defaults: `heartbeatMs` 15000, `minBackoffMs` 1000, `maxBackoffMs` 60000.

- [ ] **Step 6: Run the resilience suite green + the whole package unfiltered.** Run:
`pnpm --filter @waitron/tunnel test:coverage` then `pnpm --filter @waitron/tunnel test` — Expected: PASS, thresholds met.

- [ ] **Step 7: Commit.**

```bash
git add packages/tunnel/src/client.ts packages/tunnel/src/client.resilience.test.ts
git commit -s -m "feat(tunnel): heartbeat, bounded-backoff reconnect, clean shutdown"
```

---

### Task 5: Config — `loadTunnelConfig` in `apps/server`

**Files:**
- Modify: `apps/server/src/config.ts` (add `TunnelConfig` + `loadTunnelConfig`)
- Test: `apps/server/src/config.test.ts` (add a `loadTunnelConfig` describe block)

**Interfaces:**
- Consumes: the existing `Env`, `isUnset`, `required`, `positiveInt`, `AppError("server.config_invalid", ...)` helpers in `config.ts`.
- Produces:
  - `interface TunnelConfig { relayHost: string; relayPort: number; boxId: string; token: string; poolSize: number }`
  - `loadTunnelConfig(env: Env): TunnelConfig | undefined` — `undefined` when `WAITRON_TUNNEL_RELAY_URL` is unset (tunnel off). When set: parse the URL (reject empty/invalid → `server.config_invalid` reason `not_a_url`), require `WAITRON_TUNNEL_BOX_ID` and `WAITRON_TUNNEL_TOKEN` (blank → `config_invalid` reason `field_blank`), and read `WAITRON_TUNNEL_POOL_SIZE` as a positive int defaulting to 4.

- [ ] **Step 1: Write the failing config tests.** In `apps/server/src/config.test.ts`:

```typescript
describe("loadTunnelConfig", () => {
  const base = {
    WAITRON_TUNNEL_RELAY_URL: "tcp://relay.example:9000",
    WAITRON_TUNNEL_BOX_ID: "box-1",
    WAITRON_TUNNEL_TOKEN: "secret",
  };
  it("returns undefined when the relay url is unset (tunnel off)", () => {
    expect(loadTunnelConfig({})).toBeUndefined();
  });
  it("parses a full config with the default pool size", () => {
    expect(loadTunnelConfig(base)).toEqual({
      relayHost: "relay.example", relayPort: 9000, boxId: "box-1", token: "secret", poolSize: 4,
    });
  });
  it("refuses an empty relay url", () => {
    expect(() => loadTunnelConfig({ ...base, WAITRON_TUNNEL_RELAY_URL: "" }))
      .toThrow(/config_invalid|not_a_url/);
  });
  it("refuses a missing box id when the relay url is set", () => {
    expect(() => loadTunnelConfig({ ...base, WAITRON_TUNNEL_BOX_ID: "" })).toThrow();
  });
  it("refuses a non-positive pool size", () => {
    expect(() => loadTunnelConfig({ ...base, WAITRON_TUNNEL_POOL_SIZE: "0" })).toThrow();
  });
});
```

Note: an empty `WAITRON_TUNNEL_RELAY_URL` counts as unset for the "off" switch **only** through `isUnset` — but the spec requires an explicitly *provided-yet-empty* URL to fail closed, not to silently disable the tunnel. Implement the off-switch on `isUnset` (absent OR empty → `undefined`) to match `loadSyncConfig`'s `WAITRON_SYNC_PEERS` posture, and rely on the URL parse to reject a present-but-malformed value; drop the "refuses an empty relay url" case if it conflicts, and instead assert an empty URL yields `undefined` (tunnel off), matching the sync loader. Pick one and state it in a comment (CLAUDE.md §3, "an empty connection string is a valid connection string" — the point is it must never reach a dialer as `""`). **Decision for this plan:** empty `WAITRON_TUNNEL_RELAY_URL` ⇒ `undefined` (off), exactly like empty `WAITRON_SYNC_PEERS`; a *non-empty but unparseable* URL throws `config_invalid`. Update the test above accordingly before implementing.

- [ ] **Step 2: Run them, watch them fail.** Run: `pnpm --filter @waitron/server test config` — Expected: FAIL (`loadTunnelConfig` not found).

- [ ] **Step 3: Implement `loadTunnelConfig`** in `config.ts`, mirroring `loadSyncConfig`'s structure (the `isUnset` off-switch, `AppError("server.config_invalid", { variable, reason })`, `positiveInt` for the pool size with default 4). Parse the URL with `new URL(...)`; take `.hostname` and `Number(.port)`.

- [ ] **Step 4: Run green.** Run: `pnpm --filter @waitron/server test config` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): loadTunnelConfig — WAITRON_TUNNEL_* env, fail-closed"
```

---

### Task 6: Cloud-side tunnel-aware HTTP client

**Files:**
- Create: `apps/server/src/tunnel-http.ts`
- Test: `apps/server/src/tunnel-http.test.ts`
- Modify: `apps/server/package.json` (add `@waitron/tunnel` dependency — needed only by the e2e in Task 8, add it here where the first `@waitron/tunnel` import appears; if `tunnel-http.ts` does not import it, defer this to Task 8)

**Interfaces:**
- Consumes: `undici` `Agent`/`fetch`; `HttpClient` from `@waitron/sync` (the seam `runSyncPull` uses).
- Produces:
  - `tunnelHttpClient(opts: { ca?: string; servername?: string }): HttpClient` — an `HttpClient` whose requests go through an `undici` `Agent` configured to validate TLS against `opts.servername` (the box hostname) and trust `opts.ca` (the box's self-signed CA). The caller sets `peer.url` to the relay's `https://host:clientPort/`. The exact `Agent` connect shape is pinned by the test below (spec §7 — verified, not asserted from memory).

- [ ] **Step 1: Write the failing test.** Stand up a loopback TLS server with a self-signed cert for `box.test` (reuse `apps/server/src/self-signed-cert.test.ts`'s helper or generate one inline), then assert `tunnelHttpClient({ ca, servername: "box.test" })` GETs `https://127.0.0.1:<port>/` successfully (proving the servername/ca override), and that without the `ca` it fails the TLS handshake.

```typescript
it("connects to the relay address while validating the box hostname + CA", async () => {
  const { key, cert, ca } = makeSelfSigned("box.test"); // helper: SAN=box.test
  const server = createHttpsServer({ key, cert }, (_req, res) => res.end("ok"));
  const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const http = tunnelHttpClient({ ca, servername: "box.test" });
  const res = await http(`https://127.0.0.1:${port}/`, { headers: {} });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
  server.close();
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/server test tunnel-http` — Expected: FAIL.

- [ ] **Step 3: Implement `tunnel-http.ts`** using the `undici` `Agent` custom-`connect` pattern (`aeat-transport.ts:124` is the reference). Start from `new Agent({ connect: { servername: opts.servername, ca: opts.ca } })` and adapt until the test passes — the working connector form is the deliverable, not a guess. Adapt undici's `Response` to `@waitron/sync`'s `{ status, text() }` seam exactly as `sync-http.ts` does.

- [ ] **Step 4: Run green.** Run: `pnpm --filter @waitron/server test tunnel-http` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/tunnel-http.ts apps/server/src/tunnel-http.test.ts
git commit -s -m "feat(server): tunnel-aware HTTP client (relay address, box SNI + CA)"
```

---

### Task 7: Boot wiring (config-guarded, inert when unset)

**Files:**
- Modify: `apps/server/src/boot.ts` (start `runTunnelClient` beside the sync block; add to `close()` teardown)
- Modify: `apps/server/package.json` (add `@waitron/tunnel` dependency if not already added in Task 6)
- Test: extend the boot/sync wiring test (`apps/server/src/boot.test.ts` or the focused sync-wiring test) — configured ⇒ client started; unset ⇒ not started; `close()` aborts it.

**Interfaces:**
- Consumes: `loadTunnelConfig` (Task 5), `runTunnelClient` (Tasks 3–4), `config.httpPort`, the boot `AbortController`/`log`/`realSleep` already in scope.
- Produces: no new exported surface; the tunnel client is an internal boot worker.

- [ ] **Step 1: Write the failing wiring test.** Assert that with `WAITRON_TUNNEL_*` set, boot calls a `runTunnelClient` spy with `localPort === config.httpPort`, the configured relay host/port/boxId/token, and the boot signal; with it unset, the spy is not called; and `close()` triggers the abort. Inject the spy via the same dependency seam boot uses for `runSyncPull` (add a `runTunnelClientImpl` default param on the boot function, mirroring how `runSyncPull` is injectable, if such a seam exists; otherwise assert via a started/aborted observable — a resolved promise on abort).

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/server test boot` (narrow to the new cases) — Expected: FAIL.

- [ ] **Step 3: Implement the boot wiring.** After the sync block (~`boot.ts:862`): `const tunnelConfig = loadTunnelConfig(env);` then, when defined, start `runTunnelClient({ relayHost, relayPort, boxId, token, localPort: config.httpPort, sleep: realSleep, signal: shutdown.signal, log })`, keep its promise, and add its abort to the same teardown path `runSyncPull` uses (`boot.ts:1027`-region). Document it in the boot idiom (the guarded-worker comment style already there). When `tunnelConfig` is `undefined`, log an info line that the tunnel is off and start nothing.

- [ ] **Step 4: Run green.** Run: `pnpm --filter @waitron/server test boot` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/boot.ts apps/server/package.json apps/server/src/boot.test.ts pnpm-lock.yaml
git commit -s -m "feat(server): boot the tunnel client when WAITRON_TUNNEL_* is configured"
```

---

### Task 8: Headline e2e — the cloud pulls through the tunnel, relay stays blind

**Files:**
- Create: `apps/server/src/tunnel-e2e.test.ts`

**Interfaces:**
- Consumes: `mountSyncApi` + the real sync-api HTTPS serve path (`buildServeOptions`/`tls.ts`), `runSyncPull` + `syncPullOnce` (`@waitron/sync`), `createRelayStandin` (`@waitron/tunnel/testing/relay.js`), `runTunnelClient` (`@waitron/tunnel`), `tunnelHttpClient` (Task 6), a real Postgres via the sync test harness, `enrolPeer`/`authenticatePeer` (A's `sync_peers`, `@waitron/sync`).

- [ ] **Step 1: Write the e2e.** Topology, all on loopback:
  1. Real Postgres (Testcontainers) migrated with the sync schema; enrol a peer (A's `enrolPeer`) to get a per-peer token; seed a handful of `sync_log` rows for an origin.
  2. Serve the sync-api over **HTTPS** on `127.0.0.1:0` with a self-signed cert for `box.test` (the `tls.ts`/self-signed helper). Capture its port.
  3. `createRelayStandin({ verifyToken: () => true })`.
  4. `runTunnelClient({ relayHost:"127.0.0.1", relayPort: relay.boxPort, boxId:"box.test", token:"t", localPort: <https port>, ... })`.
  5. Drive `runSyncPull` against a **second** Postgres (the cloud mirror DB) with `http: tunnelHttpClient({ ca, servername: "box.test" })`, `peers: [{ nodeId, url: \`https://127.0.0.1:${relay.clientPort}/\`, token: <per-peer token> }]`.
  6. Assert: the cloud DB receives + applies the seeded rows, the `sync_cursor` advances, and `POST /sync-api/cursor` succeeds (source-side cursor visible).
  7. **Blindness:** `relay.bytesSeen()` concatenated contains no plaintext HTTP verb, no `"Bearer"`, and no substring of the per-peer token; assert every recorded buffer's first byte is a TLS content-type (`0x14`–`0x17`) — the relay saw only TLS records.

- [ ] **Step 2: Prove blindness by deletion (negative control).** Temporarily serve the sync-api as **plain HTTP** instead of HTTPS and confirm the blindness assertion FAILS (the relay now sees `GET /sync-api/hello` and the Bearer token); restore HTTPS and confirm it passes. Leave the HTTPS version committed; this step is a manual proof, not a committed second test.

- [ ] **Step 3: Prove the leftover-buffer handoff (negative control).** In the client's `go` handler, temporarily drop the `rest` write; confirm a request whose first bytes arrive in the same chunk as `go` fails; restore and it passes. (This exercises the CLAUDE.md §1 named trap.)

- [ ] **Step 4: Run the e2e.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tunnel-e2e` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/tunnel-e2e.test.ts
git commit -s -m "test(server): e2e — cloud pulls through the outbound tunnel; relay stays blind"
```

---

### Task 9: Docs the change retires + full-suite verification

**Files:**
- Modify: `apps/server/src/config.ts` (doc the `WAITRON_TUNNEL_*` block — done in Task 5, verify it reads well beside the sync/peer config)
- Modify: `docs/superpowers/specs/2026-08-07-management-dashboard-design.md` (T1 note §5/§8: a **dated pointer** that the reusable box-dials-out mechanism now exists in `@waitron/tunnel` — a pointer, not a rewrite)
- (Backlog + memory are updated at land time by `/land-branch`; note them, do not edit the backlog here — a `docs/backlog.md` edit follows the lightweight direct-to-main flow, separate from this PR.)

- [ ] **Step 1: Add the dated pointer** to the dashboard design's T1 section: one line under §5's T1 bullet noting `@waitron/tunnel` (this branch) implements the box-dials-out reverse-tunnel pattern against a local relay stand-in, cite the B spec. Do not rewrite the historical text.

- [ ] **Step 2: Grep for anything the change makes stale.** Run: `grep -rn "WAITRON_TUNNEL\|@waitron/tunnel\|runTunnelClient" apps/server/src docs` and confirm every mention is current (no doc still calls the tunnel "deferred/unbuilt" in a file this branch touched — CLAUDE.md §1, editing a file is not auditing it).

- [ ] **Step 3: Run the whole affected suites unfiltered** (cross-cutting guards do not load under a name-filter — CLAUDE.md §2/§4):
```bash
pnpm --filter @waitron/tunnel test:coverage
pnpm --filter @waitron/server test:coverage
pnpm vitest run scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/guarded-teardowns.test.ts
```
Expected: all PASS. (The root-project guards confirm the new package trips none of them — no unguarded teardown, no unreachable `errors.ts` since the package ships none, no CI-partition drift.)

- [ ] **Step 4: Run the four-command gate** (CLAUDE.md §2):
```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add docs/superpowers/specs/2026-08-07-management-dashboard-design.md
git commit -s -m "docs(dashboard): point T1 at the @waitron/tunnel box-dials-out mechanism"
```

---

## Self-Review

**1. Spec coverage:**
- §3 blind byte-splice reverse tunnel → Tasks 1–4, 8. ✓
- §5 package structure (`protocol`/`client`/`testing/relay`, enumerated exports, no SQL) → Tasks 1–3. ✓ (No `errors.ts` — justified in Global Constraints against the `sync.pull_failed` precedent; spec §5/§14 mentioned one, this plan deliberately drops it and says why. The spec's own §14 says the codes are "logged, not thrown", which is exactly the free-string case that needs no registry.)
- §6 wire protocol + leftover-buffer trap → Task 1 (`decodeFrame` + `rest`), Task 3/8 (splice leftover, negative control). ✓
- §7 cloud tunnel-aware client → Task 6. ✓
- §8 relay auth + config → Task 2 (`verifyToken`, `reject`), Task 5 (`loadTunnelConfig`). ✓
- §9 reconnect/backoff/shutdown → Task 4. ✓
- §10 boot wiring guarded → Task 7. ✓
- §12 testing incl. blindness assertion + proven-by-deletion → Task 8. ✓
- §13 security review points → covered by Task 8's blindness + Task 5's fail-closed config; the human security review runs at finish-branch.
- §15 docs retired → Task 9. ✓
- CI-scope registration (the §2 trap; not in the spec but mandatory for a new package) → Task 1 Steps 9–12. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Each code step carries real code. Task 5 Step 1 flags a genuine either/or (empty-URL semantics) and **resolves it in the same step** (empty ⇒ off, matching `loadSyncConfig`) rather than leaving it open.

**3. Type consistency:** `Frame`, `encodeFrame`, `decodeFrame` (Task 1) are consumed with those exact names in Tasks 2–3. `createRelayStandin`/`RelayStandin`/`bytesSeen` (Task 2) match their use in Tasks 3/8. `runTunnelClient`/`TunnelClientDeps` (Task 3) match Tasks 4/7/8. `loadTunnelConfig`/`TunnelConfig` (Task 5) match Task 7. `tunnelHttpClient` (Task 6) matches Task 8. `poolSize` default 4 is consistent across spec §8, Task 3, Task 5.

## Execution Handoff

Follow the SDD workflow: a fresh subagent per task with the two-stage review between tasks.
</content>
