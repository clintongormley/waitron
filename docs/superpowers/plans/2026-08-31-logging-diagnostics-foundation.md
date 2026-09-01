# Logging & Diagnostics Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Waitron durable, correlated, runtime-tunable logging on the server and a first-ever activity trail + crash capture in the browser apps — the substrate a one-touch bug report (Slice 2) will read from — plus a manager diagnostic-mode viewer.

**Architecture:** Server-side, a Hono request-id middleware stamps every request and the tiny JSON logger gains level filtering, a rotating disk sink + reader, and an in-memory verbosity controller; three `/management-api/diagnostics` endpoints expose recent logs + verbosity behind the manager gate. Client-side, a new zero-dependency `@waitron/diagnostics` package provides a bounded ring buffer, an injected-target error boundary, and an instrumented `fetch` that the apps drop into their existing api-client constructor. A polling dashboard screen views it live.

**Tech Stack:** TypeScript, Hono 4 + `@hono/node-server`, Node `fs`, Lit 3 + Vite, Vitest (Node for the package/server, browser-mode + Playwright + axe for the apps), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md` — read it alongside this plan.

## Global Constraints

- **Nothing may block a sale.** Logging is best-effort: a sink/disk failure degrades to stdout and is never thrown into a request path; every client hook is `try`/`catch` and never breaks the app.
- **Redaction by construction.** Logs carry only: level, event name, request-id, HTTP method, Hono **route pattern** (`c.req.routePath`, never the concrete path), status, duration, and caller-chosen enums/codes. Never request/response bodies, query strings, concrete path segments, fiscal rows, secrets, or PII.
- **Error codes name the DOMAIN CONCEPT and are never renamed once shipped.** The one new server code is `diagnostics.invalid_verbosity`. The client package throws no `AppError`.
- **Every commit is `git commit -s`.** Feature branch `feat/logging-diagnostics-foundation` in its worktree; never commit to `main`.
- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and per-package `pnpm --filter <pkg> test:coverage` before claiming green (CI shards run coverage). Non-browser package thresholds are `98/98/98/95`; the browser apps are `95/95/90/88`.
- **English identifiers** everywhere under `packages/`; Spanish only as i18n VALUES in `apps/*`.
- **`packages/diagnostics` is browser-safe and zero-dependency**; it throws nothing, ships no `errors.ts`, and does not augment `@waitron/shared`.

---

## Phase A — Server logging foundation

### Task 1: Log levels + threshold filtering in the logger

**Files:**
- Modify: `apps/server/src/logger.ts`
- Test: `apps/server/src/logger.test.ts` (extend existing)

**Interfaces:**
- Produces: `type LogLevel = "debug" | "info" | "warn" | "error"`; `createLogger(sink: (line: string) => void, now: () => Date, getThreshold?: () => LogLevel): Logger`; `const LOG_LEVELS: Record<LogLevel, number>`. The third `getThreshold` arg is optional and defaults to `() => "info"`, so the two existing call sites keep compiling.

- [ ] **Step 1: Write the failing tests** — append to `apps/server/src/logger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLogger, LOG_LEVELS, type LogLevel } from "./logger.js";

describe("createLogger level filtering", () => {
  const at = () => new Date("2026-08-31T10:00:00.000Z");

  it("drops events below the default info threshold", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), at);
    log("debug", "noisy");
    log("info", "kept");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).event).toBe("kept");
  });

  it("emits debug when the threshold source returns debug", () => {
    const lines: string[] = [];
    let level: LogLevel = "info";
    const log = createLogger((l) => lines.push(l), at, () => level);
    log("debug", "before");
    level = "debug";
    log("debug", "after");
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["after"]);
  });

  it("orders levels debug < info < warn < error", () => {
    expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.info);
    expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.warn);
    expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/server test logger` → FAIL (`LOG_LEVELS` not exported; `debug` not assignable to `LogLevel`).

- [ ] **Step 3: Implement** — edit `apps/server/src/logger.ts`:

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

/**
 * One structured JSON line per event, on an injected sink ... (keep the existing doc comment).
 * `getThreshold` is read at EACH call so a runtime verbosity change takes effect immediately;
 * an event whose level is below the threshold is dropped before the sink is touched. It defaults
 * to a constant `info` so the pre-existing two-arg call sites are unchanged.
 */
export function createLogger(
  sink: (line: string) => void,
  now: () => Date,
  getThreshold: () => LogLevel = () => "info",
): Logger {
  return (level, event, fields) => {
    if (LOG_LEVELS[level] < LOG_LEVELS[getThreshold()]) return;
    sink(`${JSON.stringify({ ...fields, at: now().toISOString(), level, event })}\n`);
  };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test logger` → PASS. Also `pnpm --filter @waitron/server typecheck` (existing two-arg callers still compile).

- [ ] **Step 5: Prove the guard by deletion** — temporarily change the filter line to `if (false)`, confirm the "drops events below the default info threshold" test fails, then restore.

- [ ] **Step 6: Commit** — `git add apps/server/src/logger.ts apps/server/src/logger.test.ts && git commit -s -m "feat(server): log levels + runtime threshold filtering"`

---

### Task 2: Verbosity controller (diagnostic mode)

**Files:**
- Create: `apps/server/src/verbosity.ts`
- Test: `apps/server/src/verbosity.test.ts`

**Interfaces:**
- Consumes: `LogLevel` (Task 1).
- Produces: `interface VerbosityController { current(): LogLevel; raise(level: LogLevel, ttlMs: number): void; revertsAt(): Date | null }`; `createVerbosityController(opts: { defaultLevel: LogLevel; now: () => Date }): VerbosityController`. Auto-reverts to `defaultLevel` after `ttlMs` via `setTimeout`.

- [ ] **Step 1: Write the failing test** — `apps/server/src/verbosity.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerbosityController } from "./verbosity.js";

describe("verbosity controller", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-08-31T10:00:00.000Z") }));
  afterEach(() => vi.useRealTimers());
  const now = () => new Date();

  it("defaults to the configured level", () => {
    const c = createVerbosityController({ defaultLevel: "info", now });
    expect(c.current()).toBe("info");
    expect(c.revertsAt()).toBeNull();
  });

  it("raises then auto-reverts after the ttl", () => {
    const c = createVerbosityController({ defaultLevel: "info", now });
    c.raise("debug", 60_000);
    expect(c.current()).toBe("debug");
    expect(c.revertsAt()).toEqual(new Date("2026-08-31T10:01:00.000Z"));
    vi.advanceTimersByTime(59_999);
    expect(c.current()).toBe("debug");
    vi.advanceTimersByTime(1);
    expect(c.current()).toBe("info");
    expect(c.revertsAt()).toBeNull();
  });

  it("a second raise replaces the pending revert", () => {
    const c = createVerbosityController({ defaultLevel: "info", now });
    c.raise("debug", 10_000);
    c.raise("debug", 60_000);
    vi.advanceTimersByTime(10_000);
    expect(c.current()).toBe("debug"); // first timer was cleared
    vi.advanceTimersByTime(50_000);
    expect(c.current()).toBe("info");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/server test verbosity` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/server/src/verbosity.ts`:

```ts
import type { LogLevel } from "./logger.js";

export interface VerbosityController {
  current(): LogLevel;
  raise(level: LogLevel, ttlMs: number): void;
  revertsAt(): Date | null;
}

/**
 * In-memory only, by design: a restart reverts to `defaultLevel`, because we never want debug
 * verbosity stuck on across a reboot. A pending auto-revert timer is replaced (cleared) by a
 * later `raise`, so the most recent window wins rather than the earliest expiring first.
 */
export function createVerbosityController(opts: { defaultLevel: LogLevel; now: () => Date }): VerbosityController {
  let level = opts.defaultLevel;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let revertsAt: Date | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    revertsAt = null;
  };
  return {
    current: () => level,
    revertsAt: () => revertsAt,
    raise(next, ttlMs) {
      clear();
      level = next;
      revertsAt = new Date(opts.now().getTime() + ttlMs);
      timer = setTimeout(() => {
        level = opts.defaultLevel;
        timer = null;
        revertsAt = null;
      }, ttlMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref(); // never keep the process alive
    },
  };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test verbosity` → PASS.

- [ ] **Step 5: Commit** — `git add apps/server/src/verbosity.ts apps/server/src/verbosity.test.ts && git commit -s -m "feat(server): in-memory verbosity controller with auto-revert"`

---

### Task 3: Rotating file sink + tee

**Files:**
- Create: `apps/server/src/log-file.ts`
- Test: `apps/server/src/log-file.test.ts`

**Interfaces:**
- Produces: `interface RotatingFileSinkOptions { dir: string; fileName?: string; maxBytes: number; maxFiles: number }`; `createRotatingFileSink(opts: RotatingFileSinkOptions, onError?: (e: unknown) => void): (line: string) => void`; `tee(...sinks: Array<(line: string) => void>): (line: string) => void`. The reader is Task 4. `fileName` defaults to `"waitron.log"`.

- [ ] **Step 1: Write the failing tests** — `apps/server/src/log-file.test.ts`:

```ts
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRotatingFileSink, tee } from "./log-file.js";

describe("rotating file sink", () => {
  const dirs: string[] = [];
  const mkdir = () => { const d = mkdtempSync(join(tmpdir(), "diag-")); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0; });

  it("appends lines to the current file", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 1000, maxFiles: 3 });
    sink("a\n"); sink("b\n");
    expect(readFileSync(join(dir, "waitron.log"), "utf8")).toBe("a\nb\n");
  });

  it("rotates when the size cap is exceeded and prunes to maxFiles", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 8, maxFiles: 2 });
    sink("1234567\n"); // 8 bytes → fills current
    sink("aaa\n");     // triggers rotate → waitron.log.1 holds the first line
    sink("bbb\n");
    sink("ccc\n");     // more rotations; only current + maxFiles rotated kept
    const files = readdirSync(dir).sort();
    // current + at most maxFiles rotated
    expect(files.filter((f) => f.startsWith("waitron.log")).length).toBeLessThanOrEqual(3);
    expect(files).toContain("waitron.log");
    expect(files).not.toContain("waitron.log.3");
  });

  it("degrades to a no-op (never throws) when the directory is unwritable", () => {
    const errors: unknown[] = [];
    const sink = createRotatingFileSink(
      { dir: "/nonexistent/definitely/not/writable", maxBytes: 10, maxFiles: 2 },
      (e) => errors.push(e),
    );
    expect(() => { sink("x\n"); sink("y\n"); }).not.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(1); // reported once
  });

  it("tee fans a line to every sink", () => {
    const a: string[] = []; const b: string[] = [];
    const t = tee((l) => a.push(l), (l) => b.push(l));
    t("hi\n");
    expect(a).toEqual(["hi\n"]);
    expect(b).toEqual(["hi\n"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/server test log-file` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/server/src/log-file.ts`:

```ts
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RotatingFileSinkOptions {
  dir: string;
  fileName?: string;
  maxBytes: number;
  maxFiles: number;
}

/**
 * Best-effort synchronous file sink. The box process is the single sequential writer, so rotation
 * needs no cross-process locking. On ANY IO failure it reports once (via `onError`) and becomes a
 * no-op — the sale-safety invariant: logging never throws into a request path. The paired `tee`
 * still writes stdout, so a degraded file sink loses the file, not the line.
 */
export function createRotatingFileSink(
  opts: RotatingFileSinkOptions,
  onError: (e: unknown) => void = () => {},
): (line: string) => void {
  const fileName = opts.fileName ?? "waitron.log";
  const current = join(opts.dir, fileName);
  let degraded = false;
  const sizeOf = (p: string): number => { try { return statSync(p).size; } catch { return 0; } };
  const rotate = () => {
    // waitron.log.(N-1) → .N, dropping the oldest beyond maxFiles, then waitron.log → .1
    rmSync(join(opts.dir, `${fileName}.${opts.maxFiles}`), { force: true });
    for (let i = opts.maxFiles - 1; i >= 1; i--) {
      try { renameSync(join(opts.dir, `${fileName}.${i}`), join(opts.dir, `${fileName}.${i + 1}`)); } catch { /* gap ok */ }
    }
    renameSync(current, join(opts.dir, `${fileName}.1`));
  };
  return (line) => {
    if (degraded) return;
    try {
      mkdirSync(opts.dir, { recursive: true });
      if (sizeOf(current) > 0 && sizeOf(current) + Buffer.byteLength(line) > opts.maxBytes) rotate();
      appendFileSync(current, line);
    } catch (e) {
      degraded = true;
      onError(e);
    }
  };
}

export function tee(...sinks: Array<(line: string) => void>): (line: string) => void {
  return (line) => { for (const s of sinks) s(line); };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test log-file` → PASS.

- [ ] **Step 5: Prove degrade-on-error by deletion** — remove the `catch` block's `degraded = true` (let it rethrow), confirm the "degrades to a no-op" test fails, restore.

- [ ] **Step 6: Commit** — `git add apps/server/src/log-file.ts apps/server/src/log-file.test.ts && git commit -s -m "feat(server): rotating file log sink + tee"`

---

### Task 4: Log reader (recent + byRequestIds)

**Files:**
- Modify: `apps/server/src/log-file.ts`
- Test: `apps/server/src/log-file.test.ts` (extend)

**Interfaces:**
- Produces: `type LogEvent = { at: string; level: string; event: string; requestId?: string } & Record<string, unknown>`; `interface LogReader { recent(opts?: { limit?: number }): LogEvent[]; byRequestIds(ids: Iterable<string>): LogEvent[] }`; `createLogReader(opts: { dir: string; fileName?: string; maxFiles: number }): LogReader`. `recent` returns newest-last across current + rotated files, capped by `limit` (default 500).

- [ ] **Step 1: Write the failing tests** — extend `log-file.test.ts`:

```ts
import { createLogReader } from "./log-file.js";

describe("log reader", () => {
  const dirs: string[] = [];
  const mkdir = () => { const d = mkdtempSync(join(tmpdir(), "diag-r-")); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0; });

  it("returns the most recent N events across rotated files, oldest first", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 30, maxFiles: 5 });
    for (let i = 0; i < 10; i++) sink(`${JSON.stringify({ at: `t${i}`, level: "info", event: `e${i}` })}\n`);
    const reader = createLogReader({ dir, maxFiles: 5 });
    const recent = reader.recent({ limit: 3 });
    expect(recent.map((e) => e.event)).toEqual(["e7", "e8", "e9"]);
  });

  it("filters by request ids", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 10_000, maxFiles: 2 });
    sink(`${JSON.stringify({ at: "t1", level: "info", event: "http.request", requestId: "r1" })}\n`);
    sink(`${JSON.stringify({ at: "t2", level: "info", event: "http.request", requestId: "r2" })}\n`);
    const reader = createLogReader({ dir, maxFiles: 2 });
    expect(reader.byRequestIds(["r2"]).map((e) => e.requestId)).toEqual(["r2"]);
  });

  it("returns [] when no log file exists yet", () => {
    expect(createLogReader({ dir: mkdir(), maxFiles: 2 }).recent()).toEqual([]);
  });

  it("skips unparseable lines rather than throwing", () => {
    const dir = mkdir();
    const sink = createRotatingFileSink({ dir, maxBytes: 10_000, maxFiles: 2 });
    sink("not json\n");
    sink(`${JSON.stringify({ at: "t", level: "info", event: "ok" })}\n`);
    expect(createLogReader({ dir, maxFiles: 2 }).recent().map((e) => e.event)).toEqual(["ok"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/server test log-file` → FAIL (`createLogReader` missing).

- [ ] **Step 3: Implement** — append to `apps/server/src/log-file.ts`:

```ts
import { readFileSync } from "node:fs";

export type LogEvent = { at: string; level: string; event: string; requestId?: string } & Record<string, unknown>;

export interface LogReader {
  recent(opts?: { limit?: number }): LogEvent[];
  byRequestIds(ids: Iterable<string>): LogEvent[];
}

export function createLogReader(opts: { dir: string; fileName?: string; maxFiles: number }): LogReader {
  const fileName = opts.fileName ?? "waitron.log";
  // Oldest rotated file first, current file last → chronological order overall.
  const orderedPaths = (): string[] => {
    const paths: string[] = [];
    for (let i = opts.maxFiles; i >= 1; i--) paths.push(join(opts.dir, `${fileName}.${i}`));
    paths.push(join(opts.dir, fileName));
    return paths;
  };
  const readAll = (): LogEvent[] => {
    const out: LogEvent[] = [];
    for (const p of orderedPaths()) {
      let text: string;
      try { text = readFileSync(p, "utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (line === "") continue;
        try { out.push(JSON.parse(line) as LogEvent); } catch { /* skip a torn/garbage line */ }
      }
    }
    return out;
  };
  return {
    recent(o) {
      const all = readAll();
      const limit = o?.limit ?? 500;
      return all.slice(Math.max(0, all.length - limit));
    },
    byRequestIds(ids) {
      const set = new Set(ids);
      return readAll().filter((e) => e.requestId !== undefined && set.has(e.requestId));
    },
  };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test log-file` → PASS.

- [ ] **Step 5: Commit** — `git add apps/server/src/log-file.ts apps/server/src/log-file.test.ts && git commit -s -m "feat(server): log reader (recent + byRequestIds)"`

---

### Task 5: Request-id middleware

**Files:**
- Create: `apps/server/src/request-id.ts`
- Test: `apps/server/src/request-id.test.ts`

**Interfaces:**
- Consumes: `Logger` (Task 1).
- Produces: `sanitizeRequestId(raw: string | null | undefined): string | null`; `requestIdMiddleware(log: Logger, now: () => Date): MiddlewareHandler` (from `hono`); a `declare module "hono" { interface ContextVariableMap { requestId: string } }` augmentation so `c.get("requestId")` is typed everywhere. Logs `http.request` at **debug**.

- [ ] **Step 1: Write the failing tests** — `apps/server/src/request-id.test.ts`:

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { requestIdMiddleware, sanitizeRequestId } from "./request-id.js";

const at = () => new Date("2026-08-31T10:00:00.000Z");

describe("sanitizeRequestId", () => {
  it("strips control chars and caps length; rejects empty/garbage", () => {
    expect(sanitizeRequestId("abc-123.DEF_9")).toBe("abc-123.DEF_9");
    expect(sanitizeRequestId("bad\nid; rm -rf")).toBeNull(); // contains disallowed chars
    expect(sanitizeRequestId("x".repeat(200))).toBeNull(); // too long
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId("")).toBeNull();
  });
});

describe("requestIdMiddleware", () => {
  const app = () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), at, () => "debug");
    const a = new Hono();
    a.use("*", requestIdMiddleware(log, at));
    a.post("/api/thing/:id", (c) => c.json({ requestId: c.get("requestId") }));
    return { a, lines };
  };

  it("generates an id, echoes it, exposes it in context", async () => {
    const { a } = app();
    const res = await a.request("/api/thing/42", { method: "POST" });
    const echoed = res.headers.get("x-request-id");
    expect(echoed).toMatch(/^[A-Za-z0-9._-]+$/);
    expect((await res.json()).requestId).toBe(echoed);
  });

  it("reuses a sanitisable client-supplied id", async () => {
    const { a } = app();
    const res = await a.request("/api/thing/42", { method: "POST", headers: { "x-request-id": "client-abc" } });
    expect(res.headers.get("x-request-id")).toBe("client-abc");
  });

  it("logs http.request with the route pattern, never the concrete path or query or body", async () => {
    const { a, lines } = app();
    await a.request("/api/thing/42?secret=shh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card: "4242424242424242" }),
    });
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === "http.request");
    expect(entry.level).toBe("debug");
    expect(entry.routePath).toBe("/api/thing/:id");
    const blob = JSON.stringify(entry);
    expect(blob).not.toContain("42?secret");
    expect(blob).not.toContain("secret");
    expect(blob).not.toContain("4242424242424242");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/server test request-id` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/server/src/request-id.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "./logger.js";

// Make c.get("requestId") / c.set("requestId", …) typed across the whole server.
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

const VALID = /^[A-Za-z0-9._-]{1,64}$/;

/** A client-supplied id is accepted only if it is safe to embed in a structured log verbatim —
 * bounded length and a strict charset, so a hostile value cannot inject a newline and forge a line. */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return VALID.test(raw) ? raw : null;
}

export function requestIdMiddleware(log: Logger, now: () => Date): MiddlewareHandler {
  return async (c, next) => {
    const id = sanitizeRequestId(c.req.header("x-request-id")) ?? randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    const start = now().getTime();
    await next();
    log("debug", "http.request", {
      requestId: id,
      method: c.req.method,
      routePath: c.req.routePath, // the matched pattern, never the concrete path/query
      status: c.res.status,
      durationMs: now().getTime() - start,
    });
  };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test request-id` → PASS. If the echoed-header assertion fails (Hono not merging a pre-`next` `c.header`), switch to setting it after `await next()` via `c.header("x-request-id", id)` immediately before the `log(...)` call and re-run — the test is the arbiter.

- [ ] **Step 5: Prove the redaction by deletion** — change `routePath: c.req.routePath` to `routePath: c.req.url`, confirm the "never the concrete path or query" test fails (it now contains `secret`), then restore.

- [ ] **Step 6: Commit** — `git add apps/server/src/request-id.ts apps/server/src/request-id.test.ts && git commit -s -m "feat(server): request-id middleware with route-pattern logging"`

---

### Task 6: Error-boundary request-id enrichment

**Files:**
- Modify: `apps/server/src/error-boundary.ts`
- Test: `apps/server/src/error-boundary.test.ts` (extend; update existing mocks to provide `c.get`)

**Interfaces:**
- Consumes: the `ContextVariableMap` augmentation (Task 5) — `c.get("requestId")` is typed.
- Produces: no signature change to `createErrorBoundary`; the `warn`/`error` log lines gain a `requestId` field read from context (`undefined` when absent — `JSON.stringify` drops it).

- [ ] **Step 1: Write the failing test** — append to `apps/server/src/error-boundary.test.ts`, following the file's existing mock-context pattern (a `Context`-shaped stub). Add a `get` to the stub returning `"req-xyz"` for `"requestId"`:

```ts
it("includes the request id on an AppError warn line", async () => {
  const logged: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
  const log = (level: string, event: string, fields?: Record<string, unknown>) => logged.push({ level, event, fields });
  const c = makeContext({ requestId: "req-xyz" }); // extend the existing helper to seed context vars
  const boundary = createErrorBoundary({ "sale.void_forbidden": 403 }, "till.failed");
  await boundary(c, log as never, async () => { throw new AppError("sale.void_forbidden", { saleId: "s1" }); });
  const warn = logged.find((l) => l.level === "warn");
  expect(warn?.fields?.requestId).toBe("req-xyz");
});
```

(If the file has no `makeContext` helper, add a minimal one that returns an object with `json`, `res`, and `get: (k) => vars[k]`.)

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/server test error-boundary` → FAIL (`requestId` undefined on the warn fields).

- [ ] **Step 3: Implement** — edit the boundary body in `apps/server/src/error-boundary.ts`:

```ts
  return async (c, log, fn) => {
    try {
      return await fn();
    } catch (cause) {
      const requestId = c.get("requestId");
      if (isAppError(cause)) {
        const httpStatus = status[cause.code] ?? 400;
        log("warn", cause.code, { ...cause.params, requestId });
        return c.json({ error: { code: cause.code, params: cause.params } }, httpStatus);
      }
      log("error", tag, { errorCode: codeOf(cause), requestId });
      return c.json({ error: { code: "server.internal" } }, 500);
    }
  };
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test error-boundary` → PASS. Update any other existing error-boundary test whose stub context lacks `get` (add `get: () => undefined`); run the file again to confirm all green.

- [ ] **Step 5: Commit** — `git add apps/server/src/error-boundary.ts apps/server/src/error-boundary.test.ts && git commit -s -m "feat(server): correlate error-boundary logs with request id"`

---

### Task 7: `diagnostics.view` permission + `diagnostics-api` endpoints

**Files:**
- Modify: `packages/identity/src/permissions.ts` (+ its test if it pins the list)
- Modify: `apps/server/src/errors.ts` (register `diagnostics.invalid_verbosity`)
- Create: `apps/server/src/diagnostics-api.ts`
- Test: `apps/server/src/diagnostics-api.test.ts`; update `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Consumes: `VerbosityController` (Task 2), `LogReader` (Task 4), `LogLevel` (Task 1), `createErrorBoundary`, `requireManagementSession`, `withTenant`, `asAppUser`, `authorizeManager`.
- Produces: `interface DiagnosticsApiDeps { db: Database; cfg: { tenantId: string }; reader: LogReader; verbosity: VerbosityController; defaultLevel: LogLevel }`; `mountDiagnosticsApi(app: Hono, deps: DiagnosticsApiDeps, log: Logger): void`. Routes: `POST /management-api/diagnostics/verbosity` `{ level, ttlMinutes }`, `GET /management-api/diagnostics/verbosity`, `GET /management-api/diagnostics/recent?limit=`.

- [ ] **Step 1a: Add the permission** — in `packages/identity/src/permissions.ts` add `"diagnostics.view"` to the `PERMISSIONS` array (with a one-line comment: `// view recent logs + toggle diagnostic verbosity; manager + admin`) and add `"diagnostics.view"` to the `MANAGER` set. Update `packages/identity/src/permissions.test.ts` if it asserts the full `PERMISSIONS` list or the manager set.

- [ ] **Step 1b: Register the error code** — in `apps/server/src/errors.ts`, inside the server's `declare module "@waitron/shared"` block, add:

```ts
    // A diagnostics verbosity request named a level outside {debug,info} or a ttl outside its bounds.
    // `reason` is a fixed enum string (never a raw input value) — the redaction discipline holds.
    "diagnostics.invalid_verbosity": { reason: "level" | "ttl" };
```

- [ ] **Step 2: Write the failing tests** — `apps/server/src/diagnostics-api.test.ts`. Follow the existing `*-api.test.ts` harness in this dir (spin a Hono app + a real/seeded management session, or the existing session stub). Cover:

```ts
// pseudocode shape — mirror the sibling management-api.test.ts harness for session seeding
it("rejects an unauthenticated caller with 401", async () => {
  const res = await app.request("/management-api/diagnostics/recent", { method: "GET" }); // no cookie
  expect(res.status).toBe(401);
});
it("rejects a staff session with 403", async () => { /* seed a staff session cookie */ expect(res.status).toBe(403); });
it("returns recent lines for a manager", async () => {
  // reader stub returns two events
  const res = await managerReq("/management-api/diagnostics/recent?limit=2");
  expect(res.status).toBe(200);
  expect((await res.json()).lines).toHaveLength(2);
});
it("raises verbosity and reports it back", async () => {
  await managerPost("/management-api/diagnostics/verbosity", { level: "debug", ttlMinutes: 5 });
  const res = await managerReq("/management-api/diagnostics/verbosity");
  expect((await res.json()).level).toBe("debug");
});
it("rejects an invalid level with diagnostics.invalid_verbosity", async () => {
  const res = await managerPost("/management-api/diagnostics/verbosity", { level: "trace", ttlMinutes: 5 });
  expect(res.status).toBe(400);
  expect((await res.json()).error.code).toBe("diagnostics.invalid_verbosity");
});
it("rejects an out-of-range ttl", async () => {
  const res = await managerPost("/management-api/diagnostics/verbosity", { level: "debug", ttlMinutes: 0 });
  expect((await res.json()).error.code).toBe("diagnostics.invalid_verbosity");
});
```

Use a stub `LogReader` (`{ recent: () => [...], byRequestIds: () => [] }`) and a real `createVerbosityController`.

- [ ] **Step 3: Run to verify it fails** — `pnpm --filter @waitron/server test diagnostics-api` → FAIL.

- [ ] **Step 4: Implement** — `apps/server/src/diagnostics-api.ts` (mirror `management-api.ts`'s boundary + `requireManagementSession` + `withTenant`/`asAppUser`/`authorizeManager` pattern):

```ts
import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import type { LogLevel, Logger } from "./logger.js";
import type { LogReader } from "./log-file.js";
import type { VerbosityController } from "./verbosity.js";
import "./errors.js";

export interface DiagnosticsApiDeps {
  db: Database;
  cfg: { tenantId: string };
  reader: LogReader;
  verbosity: VerbosityController;
  defaultLevel: LogLevel;
}

const STATUS = {
  "management_session.required": 401,
  "authorization.not_permitted": 403,
  "diagnostics.invalid_verbosity": 400,
} as const;

const ALLOWED_LEVELS: readonly LogLevel[] = ["debug", "info"];
const MAX_TTL_MINUTES = 120;

export function mountDiagnosticsApi(app: Hono, deps: DiagnosticsApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "diagnostics.failed");
  const authorize = async (c: Parameters<typeof run>[0]) => {
    const sessionId = requireManagementSession(c);
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "diagnostics.view" });
    });
  };

  app.get("/management-api/diagnostics/recent", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const raw = Number(c.req.query("limit") ?? "200");
      const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 1000) : 200;
      return c.json({ lines: deps.reader.recent({ limit }) });
    }),
  );

  app.get("/management-api/diagnostics/verbosity", (c) =>
    run(c, log, async () => {
      await authorize(c);
      return c.json({ level: deps.verbosity.current(), revertsAt: deps.verbosity.revertsAt()?.toISOString() ?? null });
    }),
  );

  app.post("/management-api/diagnostics/verbosity", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const body = (await c.req.json()) as { level?: unknown; ttlMinutes?: unknown };
      const level = body.level;
      if (typeof level !== "string" || !ALLOWED_LEVELS.includes(level as LogLevel)) {
        throw new AppError("diagnostics.invalid_verbosity", { reason: "level" });
      }
      const ttl = body.ttlMinutes;
      if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_MINUTES) {
        throw new AppError("diagnostics.invalid_verbosity", { reason: "ttl" });
      }
      deps.verbosity.raise(level as LogLevel, ttl * 60_000);
      return c.body(null, 204);
    }),
  );
}
```

(Confirm the exact import specifiers for `withTenant`/`asAppUser`/`Database`/`authorizeManager` against how `management-api.ts` imports them, and copy that spelling.)

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @waitron/server test diagnostics-api` and `pnpm --filter @waitron/identity test permissions` → PASS.

- [ ] **Step 6: Commit** — `git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts apps/server/src/errors.ts apps/server/src/diagnostics-api.ts apps/server/src/diagnostics-api.test.ts && git commit -s -m "feat(server): diagnostics endpoints + diagnostics.view permission"`

---

### Task 8: Boot wiring + config

**Files:**
- Modify: `apps/server/src/config.ts` (log dir + rotation limits, all optional with defaults)
- Modify: `apps/server/src/boot.ts`
- Test: `apps/server/src/boot.test.ts` (extend; update any log-line-count assertions)

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: in `startServer`, a `VerbosityController`, a `createRotatingFileSink` under `<stateDir>/logs`, the `tee(stdout, file)` sink, `createLogger(sink, now, () => verbosity.current())`, `app.use("*", requestIdMiddleware(log, now))` mounted immediately after `const app = healthApp(...)` (before the mirror-gate `if (isMirror)` block), and `mountDiagnosticsApi(app, { db, cfg: { tenantId: config.till.tenantId }, reader, verbosity, defaultLevel: "info" }, log)` mounted with the other management surfaces (after the gate).

- [ ] **Step 1: Config defaults** — add to `ServerConfig` (and `loadConfig`): `logDir: string` (default `join(stateDir, "logs")`), `logMaxBytes: number` (default `10_000_000`), `logMaxFiles: number` (default `5`), each overridable by env (`WAITRON_LOG_DIR`, `WAITRON_LOG_MAX_BYTES`, `WAITRON_LOG_MAX_FILES`) with the same `isUnset` guard the other dirs use. Add a config test mirroring an existing one (default computed from `stateDir`; env override respected).

- [ ] **Step 2: Write the failing boot test** — extend `apps/server/src/boot.test.ts` (or add `boot-diagnostics.test.ts` if boot.test.ts is large) with an e2e:

```ts
it("stamps x-request-id, and after raising verbosity the request appears in recent logs", async () => {
  // boot a server (setup or trading mode, per the existing harness) with WAITRON_STATE_DIR = a tmp dir
  const res = await fetch(`${base}/health`); // or any route
  expect(res.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._-]+$/);
  // raise verbosity via a manager session, hit a route, then GET /recent and assert an http.request line is present
});
```

If a full boot e2e is too heavy here, assert the wiring at the seam instead: a unit test that `startServer`'s assembled logger writes a file under `<stateDir>/logs/waitron.log` after an `info` event. Keep at least one test that the file sink is actually wired.

- [ ] **Step 3: Implement the wiring** in `apps/server/src/boot.ts`:
  - Replace the line-415 logger construction:

```ts
  const now = () => new Date();
  const verbosity = createVerbosityController({ defaultLevel: "info", now });
  const fileSink = createRotatingFileSink(
    { dir: config.logDir, maxBytes: config.logMaxBytes, maxFiles: config.logMaxFiles },
    // one-time degrade notice, to stdout only (the file is what failed):
    () => process.stdout.write(`${JSON.stringify({ at: now().toISOString(), level: "warn", event: "log.file_unavailable" })}\n`),
  );
  const reader = createLogReader({ dir: config.logDir, maxFiles: config.logMaxFiles });
  const log = createLogger(tee((line) => process.stdout.write(line), fileSink), now, () => verbosity.current());
```

  Note ordering: `config` must be loaded before this block (move the `loadConfig(...)` call above it if needed — it currently sits just after the logger).

  - Immediately after `const app = healthApp(health, now);` (boot.ts:480), add `app.use("*", requestIdMiddleware(log, now));`.
  - Where the other management surfaces mount (near `mountManagementApi`, after the mirror gate), add `mountDiagnosticsApi(app, { db, cfg: { tenantId: config.till.tenantId }, reader, verbosity, defaultLevel: "info" }, log);`.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/server test boot` (and `test config`) → PASS. Because request logging is `debug` and dropped by default, existing boot tests that count log lines should be unaffected; if any assert an exact set of lines, re-run the whole file and update only genuinely changed expectations (do not weaken a behavioural assertion — see CLAUDE.md).

- [ ] **Step 5: Full server gate** — `pnpm --filter @waitron/server test:coverage` → green at threshold.

- [ ] **Step 6: Commit** — `git add apps/server/src/config.ts apps/server/src/boot.ts apps/server/src/*.test.ts && git commit -s -m "feat(server): wire rotating logs, verbosity, request-id middleware, diagnostics api"`

---

## Phase B — Client diagnostics package + apps

### Task 9: Scaffold `@waitron/diagnostics` and enrol it in the repo-wide lists

**Files:**
- Create: `packages/diagnostics/package.json`, `packages/diagnostics/tsconfig.json`, `packages/diagnostics/vitest.config.ts`, `packages/diagnostics/src/index.ts`
- Modify: `packages/db/src/english-only.ts`, `scripts/english-only.test.ts`, `scripts/changed-scope.mjs`
- Test: the enrolment guards (`scripts/english-only.test.ts`, `scripts/ci-workflow.test.mjs`, `scripts/changed-scope.test.mjs`) must stay green.

**Interfaces:**
- Produces: the workspace member `@waitron/diagnostics` (`"main": "./src/index.ts"`), initially exporting nothing but ready for Tasks 10–12.

- [ ] **Step 1: Create the package files.**

`packages/diagnostics/package.json` (copy `packages/shared`'s shape; **no `dependencies`** — zero deps):

```json
{
  "name": "@waitron/diagnostics",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "mutation": "stryker run"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^9.6.1",
    "@stryker-mutator/vitest-runner": "^9.6.1",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/diagnostics/tsconfig.json` (verbatim copy of `packages/shared/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["vitest/globals"] },
  "include": ["src", "test"]
}
```

`packages/diagnostics/vitest.config.ts` (copy `packages/shared/vitest.config.ts` — keep `fileParallelism: false`, `poolOptions.forks.singleFork: true`, thresholds `98/98/98/95`, and `exclude: [...coverageConfigDefaults.exclude, "src/index.ts"]`).

`packages/diagnostics/src/index.ts` (barrel; filled by later tasks):

```ts
// The public surface of @waitron/diagnostics — a browser-safe, zero-dependency client logging
// library. Re-exports only; excluded from coverage in vitest.config.ts.
export {};
```

- [ ] **Step 2: Enrol in the repo-wide lists.**
  - `packages/db/src/english-only.ts` — add `"diagnostics"` to `GENERIC_PACKAGES` (bare name, no `@waitron/`).
  - `scripts/english-only.test.ts` — add `"diagnostics"` to the pinned `.toEqual([...])` array and change the "sixteen" wording to "seventeen".
  - `scripts/changed-scope.mjs` — add `"@waitron/diagnostics"` to `LIGHT_B_PACKAGES` (exactly one bin; B keeps the light bins balanced by count).

- [ ] **Step 3: Install + verify the guards** — from the worktree root: `pnpm install` (links the new member), then `pnpm --filter @waitron/diagnostics typecheck`, and run the enrolment guards: `pnpm exec vitest run scripts/english-only.test.ts scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs` → all PASS. (A missing/double enrolment fails these loudly.)

- [ ] **Step 4: Commit** — `git add packages/diagnostics packages/db/src/english-only.ts scripts/english-only.test.ts scripts/changed-scope.mjs pnpm-lock.yaml && git commit -s -m "chore(diagnostics): scaffold @waitron/diagnostics package + enrol in scope/english lists"`

---

### Task 10: Ring buffer + redaction guard

**Files:**
- Create: `packages/diagnostics/src/log.ts`
- Modify: `packages/diagnostics/src/index.ts`
- Test: `packages/diagnostics/src/log.test.ts`

**Interfaces:**
- Produces: `type ClientLogLevel = "debug" | "info" | "warn" | "error"`; `type TrailField = string | number | boolean`; `interface TrailEvent { at: string; level: ClientLogLevel; event: string; fields: Record<string, TrailField> }`; `interface DiagnosticsLog { record(level: ClientLogLevel, event: string, fields?: Record<string, unknown>): void; snapshot(): TrailEvent[] }`; `createDiagnosticsLog(opts?: { max?: number; now?: () => Date; strict?: boolean }): DiagnosticsLog`. Non-primitive field values are dropped (in `strict` they throw); strings are capped at 300 chars; at most 20 fields; buffer default `max = 200`, evicting oldest.

- [ ] **Step 1: Write the failing tests** — `packages/diagnostics/src/log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDiagnosticsLog } from "./log.js";

const at = () => new Date("2026-08-31T10:00:00.000Z");

describe("diagnostics ring buffer", () => {
  it("keeps only the last `max` events, oldest evicted", () => {
    const log = createDiagnosticsLog({ max: 2, now: at });
    log.record("info", "a"); log.record("info", "b"); log.record("info", "c");
    expect(log.snapshot().map((e) => e.event)).toEqual(["b", "c"]);
  });

  it("snapshot returns a copy that cannot mutate the buffer", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "a");
    log.snapshot().push({ at: "x", level: "info", event: "hacked", fields: {} });
    expect(log.snapshot().map((e) => e.event)).toEqual(["a"]);
  });

  it("keeps primitive fields and drops non-primitive ones", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "api", { status: 200, code: "sale.void", ok: true, body: { card: "4242" } });
    expect(log.snapshot()[0]!.fields).toEqual({ status: 200, code: "sale.void", ok: true });
  });

  it("in strict mode, a non-primitive field throws (guard is provable)", () => {
    const log = createDiagnosticsLog({ now: at, strict: true });
    expect(() => log.record("info", "x", { body: { a: 1 } })).toThrow();
  });

  it("caps a long string field", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "x", { s: "z".repeat(1000) });
    expect((log.snapshot()[0]!.fields.s as string).length).toBe(300);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/diagnostics test log` → FAIL.

- [ ] **Step 3: Implement** — `packages/diagnostics/src/log.ts`:

```ts
export type ClientLogLevel = "debug" | "info" | "warn" | "error";
export type TrailField = string | number | boolean;
export interface TrailEvent {
  at: string;
  level: ClientLogLevel;
  event: string;
  fields: Record<string, TrailField>;
}
export interface DiagnosticsLog {
  record(level: ClientLogLevel, event: string, fields?: Record<string, unknown>): void;
  snapshot(): TrailEvent[];
}

const MAX_STRING = 300;
const MAX_FIELDS = 20;

/**
 * The ONLY way an event enters the trail. `redact` is the guarantee that a body can never reach the
 * buffer: a field is kept only if its value is a string / number / boolean, strings are truncated,
 * and the field count is capped. In `strict` mode (tests) a rejected field throws so the guard is
 * provable by deletion.
 */
function redact(fields: Record<string, unknown> | undefined, strict: boolean): Record<string, TrailField> {
  const out: Record<string, TrailField> = {};
  if (fields === undefined) return out;
  let count = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (count >= MAX_FIELDS) break;
    if (typeof v === "number" || typeof v === "boolean") { out[k] = v; count++; continue; }
    if (typeof v === "string") { out[k] = v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v; count++; continue; }
    if (strict) throw new Error(`diagnostics: non-primitive field "${k}" rejected`);
    // else: silently drop in production — never let a body through
  }
  return out;
}

export function createDiagnosticsLog(opts: { max?: number; now?: () => Date; strict?: boolean } = {}): DiagnosticsLog {
  const max = opts.max ?? 200;
  const now = opts.now ?? (() => new Date());
  const strict = opts.strict ?? false;
  const buffer: TrailEvent[] = [];
  return {
    record(level, event, fields) {
      buffer.push({ at: now().toISOString(), level, event, fields: redact(fields, strict) });
      if (buffer.length > max) buffer.splice(0, buffer.length - max);
    },
    snapshot: () => buffer.map((e) => ({ ...e, fields: { ...e.fields } })),
  };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/diagnostics test log` → PASS.

- [ ] **Step 5: Prove by deletion** — in `redact`, temporarily accept objects (add `out[k] = v as never`), confirm "keeps primitive fields and drops non-primitive ones" fails, restore.

- [ ] **Step 6: Export + commit** — add `export { createDiagnosticsLog } from "./log.js";` and `export type { DiagnosticsLog, TrailEvent, ClientLogLevel, TrailField } from "./log.js";` to `src/index.ts`. `git add packages/diagnostics/src && git commit -s -m "feat(diagnostics): bounded ring buffer with redaction guard"`

---

### Task 11: Error capture (injected target)

**Files:**
- Create: `packages/diagnostics/src/error-capture.ts`
- Modify: `packages/diagnostics/src/index.ts`
- Test: `packages/diagnostics/src/error-capture.test.ts`

**Interfaces:**
- Consumes: `DiagnosticsLog` (Task 10).
- Produces: `interface ErrorTarget { addEventListener(type: string, listener: (ev: unknown) => void): void }`; `installErrorCapture(target: ErrorTarget, log: DiagnosticsLog): void`. Listens `"error"` and `"unhandledrejection"`; records an `error`-level event with `{ name, message?, code?, stack? }` (all primitives; `code` duck-typed from a `{ code: string }` reason). A DOM is not required — the app passes `window`; tests pass a stub.

- [ ] **Step 1: Write the failing tests** — `packages/diagnostics/src/error-capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDiagnosticsLog } from "./log.js";
import { installErrorCapture } from "./error-capture.js";

function fakeTarget() {
  const listeners: Record<string, (ev: unknown) => void> = {};
  return {
    addEventListener: (type: string, fn: (ev: unknown) => void) => { listeners[type] = fn; },
    dispatch: (type: string, ev: unknown) => listeners[type]?.(ev),
  };
}

describe("installErrorCapture", () => {
  it("records a window error with name and message", () => {
    const log = createDiagnosticsLog(); const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("error", { message: "boom", error: { name: "TypeError", stack: "at x" } });
    const e = log.snapshot().at(-1)!;
    expect(e.level).toBe("error");
    expect(e.fields.name).toBe("TypeError");
    expect(e.fields.message).toBe("boom");
  });

  it("records the domain code from a rejected { code } (duck-typed, not verbatim)", () => {
    const log = createDiagnosticsLog(); const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("unhandledrejection", { reason: { code: "sale.void_forbidden" } });
    expect(log.snapshot().at(-1)!.fields.code).toBe("sale.void_forbidden");
  });

  it("never throws even on a malformed event", () => {
    const log = createDiagnosticsLog(); const t = fakeTarget();
    installErrorCapture(t, log);
    expect(() => t.dispatch("error", null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/diagnostics test error-capture` → FAIL.

- [ ] **Step 3: Implement** — `packages/diagnostics/src/error-capture.ts`:

```ts
import type { DiagnosticsLog } from "./log.js";

export interface ErrorTarget {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
}

function codeOf(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "code" in value) {
    const c = (value as { code: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

/** Attaches best-effort crash capture to an injected target (the app passes `window`). Every handler
 * is wrapped so a malformed event can never surface a second error out of the logger itself. */
export function installErrorCapture(target: ErrorTarget, log: DiagnosticsLog): void {
  target.addEventListener("error", (ev) => {
    try {
      const e = ev as { message?: unknown; error?: { name?: unknown; stack?: unknown } };
      log.record("error", "window.error", {
        ...(typeof e?.error?.name === "string" ? { name: e.error.name } : {}),
        ...(typeof e?.message === "string" ? { message: e.message } : {}),
        ...(typeof e?.error?.stack === "string" ? { stack: e.error.stack } : {}),
      });
    } catch { /* never break the app */ }
  });
  target.addEventListener("unhandledrejection", (ev) => {
    try {
      const reason = (ev as { reason?: unknown })?.reason;
      const code = codeOf(reason);
      const name = typeof (reason as { name?: unknown })?.name === "string" ? (reason as { name: string }).name : undefined;
      log.record("error", "window.unhandledrejection", {
        ...(code !== undefined ? { code } : {}),
        ...(name !== undefined ? { name } : {}),
      });
    } catch { /* never break the app */ }
  });
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/diagnostics test error-capture` → PASS.

- [ ] **Step 5: Export + commit** — add `export { installErrorCapture } from "./error-capture.js";` and `export type { ErrorTarget } from "./error-capture.js";` to `src/index.ts`. `git add packages/diagnostics/src && git commit -s -m "feat(diagnostics): injected-target error capture"`

---

### Task 12: Instrumented fetch + path masking

**Files:**
- Create: `packages/diagnostics/src/instrument-fetch.ts`
- Modify: `packages/diagnostics/src/index.ts`
- Test: `packages/diagnostics/src/instrument-fetch.test.ts`

**Interfaces:**
- Consumes: `DiagnosticsLog` (Task 10).
- Produces: `maskPath(path: string): string`; `createInstrumentedFetch(baseFetch: typeof fetch, log: DiagnosticsLog, opts?: { makeId?: () => string; baseUrl?: string }): typeof fetch`. Sets `x-request-id`, logs `api` start/end (masked path, method, status, requestId, and `code` on failure via `res.clone()`), never a body.

- [ ] **Step 1: Write the failing tests** — `packages/diagnostics/src/instrument-fetch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDiagnosticsLog } from "./log.js";
import { createInstrumentedFetch, maskPath } from "./instrument-fetch.js";

describe("maskPath", () => {
  it("masks uuid and numeric segments", () => {
    expect(maskPath("/api/sales/123")).toBe("/api/sales/:id");
    expect(maskPath("/management-api/persons/2f1c8e2a-0000-4000-8000-000000000000")).toBe("/management-api/persons/:id");
    expect(maskPath("/management-api/layout")).toBe("/management-api/layout");
  });
});

describe("createInstrumentedFetch", () => {
  it("sets x-request-id and logs start/end without a body", async () => {
    const log = createDiagnosticsLog();
    let seenHeader: string | null = null;
    const base = vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeader = new Headers(init?.headers).get("x-request-id");
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, { makeId: () => "rid-1" });
    await f("http://box/api/sales/9", { method: "POST", body: JSON.stringify({ card: "4242424242424242" }) });
    expect(seenHeader).toBe("rid-1");
    const events = log.snapshot();
    expect(events.map((e) => e.fields.phase)).toEqual(["start", "end"]);
    const end = events.at(-1)!;
    expect(end.fields).toMatchObject({ method: "POST", path: "/api/sales/:id", status: 200, requestId: "rid-1" });
    expect(JSON.stringify(events)).not.toContain("4242424242424242"); // body never recorded
  });

  it("captures the domain code on a failure via res.clone()", async () => {
    const log = createDiagnosticsLog();
    const base = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "sale.void_forbidden" } }), { status: 403 }),
    );
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, { makeId: () => "rid-2" });
    const res = await f("http://box/api/sales/void", { method: "POST" });
    expect(await res.json()).toEqual({ error: { code: "sale.void_forbidden" } }); // body still readable by #request
    expect(log.snapshot().at(-1)!.fields.code).toBe("sale.void_forbidden");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/diagnostics test instrument-fetch` → FAIL.

- [ ] **Step 3: Implement** — `packages/diagnostics/src/instrument-fetch.ts`:

```ts
import type { DiagnosticsLog } from "./log.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replace dynamic path segments (uuids, all-numeric ids) with `:id` so the trail records a stable
 * pattern, never a concrete id or PII in a path segment. */
export function maskPath(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg !== "" && (UUID.test(seg) || /^\d+$/.test(seg)) ? ":id" : seg))
    .join("/");
}

export function createInstrumentedFetch(
  baseFetch: typeof fetch,
  log: DiagnosticsLog,
  opts: { makeId?: () => string; baseUrl?: string } = {},
): typeof fetch {
  const makeId = opts.makeId ?? (() => crypto.randomUUID());
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const id = makeId();
    const method = (init?.method ?? "GET").toUpperCase();
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    let path = urlStr;
    try { path = maskPath(new URL(urlStr, opts.baseUrl ?? "http://local").pathname); } catch { /* keep raw */ }
    const headers = new Headers(init?.headers);
    headers.set("x-request-id", id);
    log.record("debug", "api", { phase: "start", method, path, requestId: id });
    try {
      const res = await baseFetch(input, { ...init, headers });
      let code: string | undefined;
      if (!res.ok) {
        try { code = ((await res.clone().json()) as { error?: { code?: string } })?.error?.code; } catch { /* no body */ }
      }
      log.record(res.ok ? "info" : "warn", "api", {
        phase: "end", method, path, status: res.status, requestId: id, ...(code !== undefined ? { code } : {}),
      });
      return res;
    } catch (e) {
      log.record("error", "api", { phase: "end", method, path, requestId: id, error: "network" });
      throw e;
    }
  }) as typeof fetch;
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/diagnostics test instrument-fetch` → PASS.

- [ ] **Step 5: Package coverage green** — add `export { createInstrumentedFetch, maskPath } from "./instrument-fetch.js";` to `src/index.ts`, then `pnpm --filter @waitron/diagnostics test:coverage` → green at `98/98/98/95`.

- [ ] **Step 6: Commit** — `git add packages/diagnostics/src && git commit -s -m "feat(diagnostics): instrumented fetch with request-id + path masking"`

---

### Task 13: Wire the trail into the till and dashboard

**Files:**
- Create: `apps/dashboard/src/diagnostics.ts`, `apps/till/src/diagnostics.ts`
- Modify: `apps/dashboard/src/main.ts`, `apps/till/src/main.ts` (construct the client with the instrumented fetch + install error capture)
- Modify: `apps/dashboard/src/dashboard-app.ts`, `apps/till/src/till-app.ts` (log a `nav` event on screen change)
- Modify: `apps/dashboard/package.json`, `apps/till/package.json` (add the dependency)
- Test: `apps/dashboard/src/dashboard-app.test.ts`, `apps/till/src/till-app.test.ts` (extend)

**Interfaces:**
- Consumes: `createDiagnosticsLog`, `installErrorCapture`, `createInstrumentedFetch` (Tasks 10–12).
- Produces: a module singleton `diag` per app (`apps/<app>/src/diagnostics.ts`) used by both `main.ts` and the app shell.

- [ ] **Step 1: Add the dependency** — add `"@waitron/diagnostics": "workspace:*"` to `dependencies` in `apps/dashboard/package.json` and `apps/till/package.json`, then `pnpm install` from the worktree root.

- [ ] **Step 2: Create the per-app singleton** — `apps/dashboard/src/diagnostics.ts` (and the identical file in `apps/till/src/`):

```ts
import { createDiagnosticsLog } from "@waitron/diagnostics";

// One trail per app session, shared by main.ts (wiring) and the app shell (nav events).
export const diag = createDiagnosticsLog();
```

- [ ] **Step 3: Wire `main.ts`** — in `apps/dashboard/src/main.ts`, install crash capture and construct the client with the instrumented fetch (main.ts is coverage-excluded, so no test needed here):

```ts
import { createInstrumentedFetch, installErrorCapture } from "@waitron/diagnostics";
import { diag } from "./diagnostics.js";
// ...
installErrorCapture(window, diag);
const api = new DashboardApi("", createInstrumentedFetch(fetch, diag));
```

Do the same in `apps/till/src/main.ts` with `TillApi`.

- [ ] **Step 4: Write the failing nav test** — extend `apps/dashboard/src/dashboard-app.test.ts`:

```ts
import { diag } from "./diagnostics.js";
it("records a nav event when the screen changes", async () => {
  const { el } = await mountApp(/* existing harness with a non-staff getMe */);
  const before = diag.snapshot().length;
  (el as unknown as { selectScreenForTest(s: string): void }); // use the existing nav click in the harness instead
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-sales"]')!.click();
  await el.updateComplete;
  const nav = diag.snapshot().slice(before).find((e) => e.event === "nav");
  expect(nav?.fields.screen).toBe("sales");
});
```

- [ ] **Step 5: Implement nav logging** — in `apps/dashboard/src/dashboard-app.ts`, import `diag` and log in `#selectScreen`:

```ts
import { diag } from "./diagnostics.js";
// ...
  #selectScreen(screen: Screen): void {
    diag.record("info", "nav", { screen });
    this.screen = screen;
    this.drawerOpen = false;
  }
```

Add the equivalent in `apps/till/src/till-app.ts` at its screen-change method.

- [ ] **Step 6: Run to verify pass** — `pnpm --filter @waitron/dashboard test dashboard-app` and `pnpm --filter @waitron/till test till-app` → PASS.

- [ ] **Step 7: Commit** — `git add apps/dashboard apps/till pnpm-lock.yaml && git commit -s -m "feat(till,dashboard): wire diagnostics trail (instrumented fetch, crash capture, nav)"`

---

### Task 14: Dashboard api-client methods + i18n for diagnostics

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (three methods + response types)
- Modify: the dashboard i18n catalogue (both locales) — follow the existing `nav.*` / screen-string pattern
- Test: `apps/dashboard/src/api/client.test.ts` (extend)

**Interfaces:**
- Produces on `DashboardApi`: `type DiagnosticsLine = { at: string; level: string; event: string; requestId?: string } & Record<string, unknown>`; `type Verbosity = { level: "debug" | "info"; revertsAt: string | null }`; `getRecentLogs(limit?: number): Promise<{ lines: DiagnosticsLine[] }>`; `getVerbosity(): Promise<Verbosity>`; `setVerbosity(level: "debug" | "info", ttlMinutes: number): Promise<void>`.

- [ ] **Step 1: Write the failing test** — extend `apps/dashboard/src/api/client.test.ts` (mirror an existing method test with a stub `fetchImpl`):

```ts
it("getRecentLogs GETs the recent endpoint with the limit", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ lines: [] }), { status: 200 }));
  const api = new DashboardApi("", fetchImpl as unknown as typeof fetch);
  await api.getRecentLogs(50);
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/recent?limit=50", expect.objectContaining({ method: "GET" }));
});
it("setVerbosity POSTs level + ttl", async () => {
  const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
  const api = new DashboardApi("", fetchImpl as unknown as typeof fetch);
  await api.setVerbosity("debug", 5);
  expect(fetchImpl).toHaveBeenCalledWith(
    "/management-api/diagnostics/verbosity",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ level: "debug", ttlMinutes: 5 }) }),
  );
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @waitron/dashboard test api/client` → FAIL.

- [ ] **Step 3: Implement** — add to `DashboardApi` (using the existing `#request` choke point):

```ts
  getRecentLogs(limit = 200): Promise<{ lines: DiagnosticsLine[] }> {
    return this.#request<{ lines: DiagnosticsLine[] }>(`/management-api/diagnostics/recent?limit=${limit}`, "GET");
  }
  getVerbosity(): Promise<Verbosity> {
    return this.#request<Verbosity>("/management-api/diagnostics/verbosity", "GET");
  }
  setVerbosity(level: "debug" | "info", ttlMinutes: number): Promise<void> {
    return this.#request<void>("/management-api/diagnostics/verbosity", "POST", { level, ttlMinutes });
  }
```

Add the `DiagnosticsLine` / `Verbosity` type exports near the other client types.

- [ ] **Step 4: Add i18n keys** — in the dashboard i18n catalogue (both `en` and `es` locale files; locate them beside `apps/dashboard/src/i18n/`), add, following the existing `nav.*` keys: `nav.diagnostics`, and screen strings `diagnostics.title`, `diagnostics.verbosity.on`, `diagnostics.verbosity.raise`, `diagnostics.verbosity.window`, `diagnostics.action.pause`, `diagnostics.action.resume`, `diagnostics.action.clear`, `diagnostics.empty`. English values are plain; provide the Spanish translations (this is `apps/*`, so Spanish VALUES are expected — only identifiers stay English).

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @waitron/dashboard test api/client` → PASS; `pnpm --filter @waitron/dashboard typecheck`.

- [ ] **Step 6: Commit** — `git add apps/dashboard/src/api apps/dashboard/src/i18n && git commit -s -m "feat(dashboard): diagnostics api-client methods + i18n keys"`

---

### Task 15: Dashboard live-log viewer screen + gated nav entry

**Files:**
- Create: `apps/dashboard/src/screens/diagnostics-screen.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (Screen union, side-effect import, NAV_GROUPS entry with a manager gate, `#renderScreen` case, per-item nav filter)
- Test: `apps/dashboard/src/screens/diagnostics-screen.test.ts`, `apps/dashboard/src/screens/diagnostics-screen.a11y.test.ts`

**Interfaces:**
- Consumes: `DashboardApi.getRecentLogs / getVerbosity / setVerbosity` (Task 14).
- Produces: the `dashboard-diagnostics-screen` custom element; a `NavItem` gains an optional `requiresManager?: boolean`, filtered in `#nav()` by `this.sessionRole === "manager" || this.sessionRole === "admin"`.

- [ ] **Step 1: Add the per-item nav gate + screen registration** in `apps/dashboard/src/dashboard-app.ts`:
  - `type NavItem = { screen: Screen; labelKey: StringKey; requiresManager?: boolean };`
  - add `"diagnostics"` to the `Screen` union;
  - add `import "./screens/diagnostics-screen.js";` to the side-effect imports;
  - add `{ screen: "diagnostics", labelKey: "nav.diagnostics", requiresManager: true }` to the `configuration` group's `items`;
  - in `#nav()`, filter each group's items: `.filter((item) => !item.requiresManager || this.sessionRole === "manager" || this.sessionRole === "admin")` before the `.map`;
  - add `case "diagnostics": return html\`<dashboard-diagnostics-screen .api=${this.api}></dashboard-diagnostics-screen>\`;` to `#renderScreen()`.

- [ ] **Step 2: Write the failing tests** — `apps/dashboard/src/screens/diagnostics-screen.test.ts` (mirror `service-status-screen.test.ts`'s `mountWidget` + stub-api pattern):

```ts
it("polls recent logs on connect and renders lines", async () => {
  const api = { getRecentLogs: vi.fn(async () => ({ lines: [{ at: "t", level: "info", event: "http.request" }] })),
                getVerbosity: vi.fn(async () => ({ level: "info", revertsAt: null })), setVerbosity: vi.fn() };
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
  await flush(el);
  expect(api.getRecentLogs).toHaveBeenCalled();
  expect(el.shadowRoot!.textContent).toContain("http.request");
});
it("raising verbosity posts debug + a window", async () => {
  const api = { getRecentLogs: vi.fn(async () => ({ lines: [] })), getVerbosity: vi.fn(async () => ({ level: "info", revertsAt: null })), setVerbosity: vi.fn(async () => undefined) };
  const { el } = await mountWidget<DiagnosticsScreen>("dashboard-diagnostics-screen", { api });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="raise-verbosity"]')!.click();
  await flush(el);
  expect(api.setVerbosity).toHaveBeenCalledWith("debug", expect.any(Number));
});
```

Add a `dashboard-app` test that the `nav-diagnostics` entry is absent for a `supervisor` session and present for a `manager` session.

- [ ] **Step 3: Run to verify it fails** — `pnpm --filter @waitron/dashboard test diagnostics-screen` → FAIL.

- [ ] **Step 4: Implement the screen** — `apps/dashboard/src/screens/diagnostics-screen.ts` (mirror `service-status-screen.ts`; use a polling interval started in `connectedCallback` and cleared in `disconnectedCallback`):

```ts
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeOf } from "../i18n/codes.js";
import type { DashboardApi, DiagnosticsLine, Verbosity } from "../api/client.js";

const POLL_MS = 1500;
const WINDOW_MINUTES = 15;

@customElement("dashboard-diagnostics-screen")
export class DiagnosticsScreen extends LitElement {
  static override styles = [baseStyles, css`/* level colouring, monospace log rows */`];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private lines: DiagnosticsLine[] = [];
  @state() private verbosity?: Verbosity;
  @state() private paused = false;
  @state() private errorKey: string | null = null;
  #timer?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#refresh();
    this.#timer = setInterval(() => { if (!this.paused) void this.#refresh(); }, POLL_MS);
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#timer !== undefined) clearInterval(this.#timer);
  }
  async #refresh(): Promise<void> {
    try {
      const [recent, verbosity] = await Promise.all([this.api.getRecentLogs(200), this.api.getVerbosity()]);
      this.lines = recent.lines;
      this.verbosity = verbosity;
      this.errorKey = null;
    } catch (error) { this.errorKey = codeOf(error); }
  }
  async #raise(): Promise<void> {
    try { await this.api.setVerbosity("debug", WINDOW_MINUTES); await this.#refresh(); }
    catch (error) { this.errorKey = codeOf(error); }
  }
  override render(): TemplateResult {
    return html`
      <h1>${t("diagnostics.title")}</h1>
      <div class="controls">
        <wt-button variant="primary" data-test="raise-verbosity" @click=${() => void this.#raise()}>
          ${t("diagnostics.verbosity.raise")}
        </wt-button>
        ${this.verbosity?.revertsAt ? html`<span>${t("diagnostics.verbosity.on")} · ${this.verbosity.revertsAt}</span>` : nothing}
        <wt-button variant="secondary" data-test="toggle-pause" @click=${() => (this.paused = !this.paused)}>
          ${t(this.paused ? "diagnostics.action.resume" : "diagnostics.action.pause")}
        </wt-button>
        <wt-button variant="ghost" data-test="clear" @click=${() => (this.lines = [])}>${t("diagnostics.action.clear")}</wt-button>
      </div>
      ${this.lines.length === 0
        ? html`<p>${t("diagnostics.empty")}</p>`
        : html`<ol class="log">${this.lines.map((l) => html`<li class="lvl-${l.level}"><code>${l.at} ${l.level} ${l.event}</code></li>`)}</ol>`}
      ${this.errorKey ? html`<p class="error" role="alert">${this.errorKey}</p>` : nothing}
    `;
  }
}
declare global {
  interface HTMLElementTagNameMap { "dashboard-diagnostics-screen": DiagnosticsScreen; }
}
```

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @waitron/dashboard test diagnostics-screen` and the dashboard-app nav test → PASS. Then the a11y test `pnpm --filter @waitron/dashboard test diagnostics-screen.a11y`.

- [ ] **Step 6: Dashboard coverage** — `pnpm --filter @waitron/dashboard test:coverage` → green at `95/95/90/88`.

- [ ] **Step 7: Commit** — `git add apps/dashboard/src && git commit -s -m "feat(dashboard): live diagnostics log viewer + manager-gated nav"`

---

### Task 16: Whole-branch gate + lockfile

**Files:** none new — verification only.

- [ ] **Step 1: Lockfile** — `pnpm install` (no changes expected beyond Tasks 9/13); `pnpm install --frozen-lockfile` must pass.
- [ ] **Step 2: The gate** — from the worktree root: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Step 3: Coverage on every touched package** — `pnpm --filter @waitron/diagnostics --filter @waitron/server --filter @waitron/identity --filter @waitron/dashboard --filter @waitron/till test:coverage`.
- [ ] **Step 4: Cross-cutting guards** (these live in the root project / other packages and are invisible to a filtered run — CLAUDE.md §2/§4): `pnpm exec vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs`, and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (no new tenant-scoped table, so expected green — a cheap confirmation).
- [ ] **Step 5: Reap any leaked testcontainers** — `pnpm reap` (real-PG suites in the server package; run with `TESTCONTAINERS_RYUK_DISABLED=true`).
- [ ] **Step 6: Commit any lockfile/format fixes** — `git commit -s` as needed.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- §5 request correlation → Task 5 (+ Task 6 error enrichment, §6d).
- §6a level filtering → Task 1; §6b rotating sink + reader → Tasks 3–4; §6c verbosity + endpoints → Tasks 2, 7; §6d error boundary → Task 6.
- §7 client package (ring buffer, redaction, error boundary, instrumented fetch, nav) → Tasks 9–13.
- §8 dashboard viewer → Tasks 14–15.
- §9 data flow → exercised end-to-end by Task 8's boot test + Task 12/15.
- §10 failure modes → Task 3 (degrade), Task 5 (sanitise), Task 7 (auth), Task 2 (auto-revert).
- §11 testing → each task is TDD with the named assertions.
- §12 repo conventions → Task 9 (lists), Task 7 (permission + code registration), Task 16 (cross-cutting guards).

**2. Placeholder scan** — no "TBD"/"add error handling"/"similar to Task N": each code step carries real code. Two deliberately-located-at-implementation items are flagged, not hand-waved: the exact i18n catalogue file path (Task 14 Step 4 — "beside `apps/dashboard/src/i18n/`") and the sibling session-seeding harness for `diagnostics-api.test.ts` (Task 7 Step 2 — "mirror `management-api.test.ts`"). Both name the file to copy from.

**3. Type consistency** — `LogLevel` (server) and `ClientLogLevel` (client) are distinct by design (client never has server levels beyond the four; they share spelling). `createLogger`'s third arg is optional throughout. `DiagnosticsLog.record(level, event, fields?)` is used identically in Tasks 11/12/13. `createInstrumentedFetch` returns `typeof fetch`, assignable to both apps' `FetchLike`. `VerbosityController` methods (`current`/`raise`/`revertsAt`) match between Tasks 2 and 7. The diagnostics endpoints' paths match between Task 7 (server) and Task 14 (client): `/management-api/diagnostics/{recent,verbosity}`.

**Risk notes for the executor:**
- Task 5 Step 4: if Hono does not merge a pre-`next` response header, move the echo after `await next()` (the test decides).
- Task 8 Step 4: `http.request` is `debug` specifically so existing boot log-count assertions do not move; if any does, re-check it is genuinely stale before editing (do not weaken a behavioural assertion).
- Task 6: update every existing error-boundary test whose stub `Context` lacks `get`.

