# The node as two containers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package a Waitron node as two containers (app + Postgres) with named volumes, so a blank
Linux box goes from power-on to a browser-driven setup wizard to a selling venue with nobody typing
anything on the box — and so a box whose server will not boot degrades to safe mode and then to a
recovery page instead of bricking.

**Architecture:** A new in-image entrypoint (`node-entry.ts`) becomes the container's command. It
waits for Postgres, ensures the instance shape (database + roles + replication bootstrap, never a
stamp and never a migration), merges the box's env files with the environment winning, reads an
escalation level, and then either starts the server or serves a recovery page. Docker's
`restart: unless-stopped` is the supervisor the server has always assumed. The app container uses
host networking on prem so mDNS, interface detection and port 443 work unchanged; a new
`WAITRON_BOX_ADDRESSES` override makes the box's advertised addresses injectable, which is what
makes a bridge/cloud profile possible later.

**Tech Stack:** Docker + Compose, `node:26-slim` (Debian trixie), `postgres:18-alpine`, PGDG
`postgresql-client-18`, esbuild bundles, Vitest (unit + Testcontainers real-Postgres), GitHub
Actions + GHCR.

**Spec:** [docs/superpowers/specs/2026-09-08-node-containers-design.md](../specs/2026-09-08-node-containers-design.md)

## Global Constraints

- **Every commit is signed off** — `git commit -s`. CI's `dco` job walks the whole PR range.
- **Per-task gate:** `pnpm --filter @waitron/server test:coverage` plus `pnpm lint`,
  `pnpm typecheck`, `pnpm format:check`. `apps/server` holds the **90/90/85/85** coverage floor.
  Tasks touching `packages/provisioning` run that package's `test:coverage` too — it holds the
  **98/98/98/95** bar.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** is required locally for any real-Postgres suite, or the
  suite hangs to the 180 s `hookTimeout`. Run `pnpm reap` if a run is interrupted.
- **`gtimeout`, never `timeout`** — GNU coreutils on macOS; `timeout` is not installed.
- **Error codes name the domain concept, never the throwing package**, and are never renamed once
  shipped. Every file that throws one imports its registry (`import "./errors.js"`).
- **Never build SQL by string concatenation** except utility statements, which take `quoteIdent` /
  `quoteLiteral` (`@waitron/provisioning`, `@waitron/shared`).
- **Comments carry the invariant and the non-obvious why, never the history.** The receipt (PR
  number, review round, experiment) belongs in the commit message.
- **A claim of necessity or impossibility needs a receipt** — the command that was run, or a cited
  `file:line`. State the experiment, not the conclusion.
- **Image versions are pinned and paired:** `postgres:18-alpine` and PGDG `postgresql-client-18`.
  `pg_dump` 17 refuses an 18 server (measured — spec §13), so bumping one without the other breaks
  the backup duty silently.
- **The entrypoint never stamps and never migrates** (spec §5). `stampDeployment` is permanent and
  one-way; `boot.ts` already migrates unconditionally.

---

## File structure

**New, in `apps/server/src/`** — each one thing, each independently testable:

| file | responsibility |
| --- | --- |
| `run-server.ts` | the signal-handling / shutdown routine, lifted out of `bin.ts` so `bin.ts` and `node-entry.ts` share one copy |
| `box-env.ts` | merge `instance.env` + `secrets.env` + `trading.env` into an env record, environment winning over file |
| `recovery-state.ts` | read/write `<state>/recovery.json`; the escalation decision as a pure function |
| `instance-bootstrap.ts` | ensure database + roles + replication bootstrap; write `instance.env` |
| `recovery-surface.ts` | the minimal HTTPS page served when the server will not boot |
| `node-entry.ts` | the container entrypoint: wires the five above in order |

**Modified:** `bin.ts` (use `run-server.ts`), `config.ts` (`WAITRON_BOX_ADDRESSES`, safe mode),
`box-reach.ts` (own the one IPv4 reader), `box-secrets.ts` (consume it), `boot.ts` (safe-mode
overlay + pass addresses), `apps/server/package.json` (bundle `node-entry`),
`scripts/changed-scope.mjs` (`deploy/**` is code), `.github/workflows/ci.yml` (the `image` job),
`docs/backlog.md`.

**New, in `deploy/`:** `Dockerfile`, `compose.yml`, `.env.example`, `prepare.sh`, `README.md`.

---

### Task 1: Lift the shutdown routine out of `bin.ts`

**Files:**
- Create: `apps/server/src/run-server.ts`
- Modify: `apps/server/src/bin.ts`
- Test: `apps/server/src/run-server.test.ts`

**Interfaces:**
- Consumes: `startServer` (`boot.ts`), `createLogger` (`logger.ts`), `codeOf` (`@waitron/server-kit`).
- Produces: `installShutdownHandlers(server: { close(): Promise<void> }, deps?: ShutdownDeps): void`
  where `ShutdownDeps = { on: (sig: NodeJS.Signals, fn: () => void) => void; write: (line: string, done: () => void) => void; exit: (code: number) => void; now: () => Date }`.
  Task 8 calls it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/run-server.test.ts
import { describe, expect, it, vi } from "vitest";
import { installShutdownHandlers } from "./run-server.js";

function harness(closeImpl: () => Promise<void>) {
  const handlers = new Map<string, () => void>();
  const exit = vi.fn();
  const written: string[] = [];
  installShutdownHandlers(
    { close: closeImpl },
    {
      on: (sig, fn) => void handlers.set(sig, fn),
      write: (line, done) => {
        written.push(line);
        done();
      },
      exit,
      now: () => new Date("2026-09-08T00:00:00Z"),
    },
  );
  return { handlers, exit, written };
}

describe("installShutdownHandlers", () => {
  it("closes and exits 0 on SIGTERM", async () => {
    const h = harness(() => Promise.resolve());
    h.handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
  });

  it("logs a classified code and exits 1 when close rejects", async () => {
    const h = harness(() => Promise.reject(new Error("pool end failed")));
    h.handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(1));
    expect(h.written.join("")).toContain("server.shutdown_failed");
    // The raw driver message can embed the connection string — it must not reach the sink.
    expect(h.written.join("")).not.toContain("pool end failed");
  });

  it("a second signal of a DIFFERENT name does not start a second shutdown", async () => {
    const close = vi.fn(() => Promise.resolve());
    const h = harness(close);
    h.handlers.get("SIGTERM")!();
    h.handlers.get("SIGINT")!();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/run-server.test.ts`
Expected: FAIL — `Failed to resolve import "./run-server.js"`.

- [ ] **Step 3: Write `run-server.ts`**

Move the logic verbatim from `bin.ts`; the only change is that the four process couplings become
injectable so the test never installs a real signal handler or exits the runner.

```ts
// apps/server/src/run-server.ts
import { codeOf } from "@waitron/server-kit";
import { createLogger } from "./logger.js";
import "./errors.js";

export interface ShutdownDeps {
  on: (signal: NodeJS.Signals, handler: () => void) => void;
  write: (line: string, done: () => void) => void;
  exit: (code: number) => void;
  now: () => Date;
}

const DEFAULT_DEPS: ShutdownDeps = {
  on: (signal, handler) => void process.once(signal, handler),
  write: (line, done) => void process.stdout.write(line, done),
  exit: (code) => process.exit(code),
  now: () => new Date(),
};

/**
 * Stop the server once on the first SIGTERM/SIGINT, then exit — the routine `bin.ts` and
 * `node-entry.ts` share.
 *
 * The latch spans BOTH signal names, not just `once` per name: `once` alone still lets one SIGTERM
 * and one SIGINT start `close()` concurrently, and the loser's rejection races the winner for the
 * exit code an operator's supervisor actually reads.
 *
 * `exit` runs from the write's completion callback, never straight after it: on a pipe (Docker,
 * systemd) `process.stdout.write` is asynchronous and exiting immediately truncates the one line
 * explaining the failure. The log carries `codeOf`'s classification rather than the caught value —
 * a `pg` pool `end()` rejection can embed the connection string it was built from.
 */
export function installShutdownHandlers(
  server: { close(): Promise<void> },
  deps: ShutdownDeps = DEFAULT_DEPS,
): void {
  const logShutdownFailure = createLogger((line) => deps.write(line, () => deps.exit(1)), deps.now);
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    deps.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void server.close().then(
        () => deps.exit(0),
        (error: unknown) => {
          logShutdownFailure("error", "server.shutdown_failed", { errorCode: codeOf(error) });
        },
      );
    });
  }
}
```

- [ ] **Step 4: Reduce `bin.ts` to its wiring**

```ts
// apps/server/src/bin.ts
import { startServer } from "./boot.js";
import { installShutdownHandlers } from "./run-server.js";
import "./errors.js";

const server = await startServer(process.env);
installShutdownHandlers(server);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS, coverage still at or above 90/90/85/85.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/run-server.ts apps/server/src/run-server.test.ts apps/server/src/bin.ts
git commit -s -m "refactor(server): lift the shutdown routine into run-server.ts

The container entrypoint needs the same signal handling bin.ts has always
had. Extracted with its process couplings injected, so the three behaviours
it carries (exit 0 on a clean close, a classified code on a rejection, one
shutdown across both signal names) are unit-tested for the first time
rather than only reasoned about in a comment."
```

---

### Task 2: `WAITRON_BOX_ADDRESSES` — make the box's advertised addresses injectable

**Files:**
- Modify: `apps/server/src/box-reach.ts`, `apps/server/src/box-secrets.ts`,
  `apps/server/src/config.ts`, `apps/server/src/boot.ts`
- Test: `apps/server/src/box-reach.test.ts`, `apps/server/src/config.test.ts`

**Interfaces:**
- Produces: `parseBoxAddresses(raw: string | undefined): string[] | undefined` (exported from
  `box-reach.ts`); `config.boxAddresses?: string[]`. `boot.ts` passes
  `config.boxAddresses ?? listBoxIpv4()` into `ensureBoxSecrets`, `buildReachInfo` and
  `startMdnsResponder`.

Why it exists: under bridge networking `listBoxIpv4` returns the container's `172.x` address —
non-internal by `os.networkInterfaces` but unreachable from the venue — so the QR encodes a dead
URL and the leaf's SANs cover the wrong address. Host networking (this spec's on-prem profile) does
not need the override; the cloud profile and the macOS proof do.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/box-reach.test.ts — append
import { parseBoxAddresses } from "./box-reach.js";

describe("parseBoxAddresses", () => {
  it("is undefined when unset or empty (the VAR=-means-unset rule)", () => {
    expect(parseBoxAddresses(undefined)).toBeUndefined();
    expect(parseBoxAddresses("")).toBeUndefined();
    expect(parseBoxAddresses("   ")).toBeUndefined();
  });

  it("parses one or many, trimming", () => {
    expect(parseBoxAddresses("192.168.1.10")).toEqual(["192.168.1.10"]);
    expect(parseBoxAddresses(" 192.168.1.10 , 10.0.0.4 ")).toEqual(["192.168.1.10", "10.0.0.4"]);
  });

  it("refuses a non-IPv4 entry", () => {
    expect(() => parseBoxAddresses("192.168.1.10,nope")).toThrow(/box_addresses_invalid/);
  });

  it("refuses loopback — it would advertise an address no device can reach", () => {
    expect(() => parseBoxAddresses("127.0.0.1")).toThrow(/box_addresses_invalid/);
  });
});
```

```ts
// apps/server/src/config.test.ts — append to the existing describe
it("carries WAITRON_BOX_ADDRESSES through to config", () => {
  const cfg = loadTestConfig({ WAITRON_BOX_ADDRESSES: "192.168.1.10" });
  expect(cfg.boxAddresses).toEqual(["192.168.1.10"]);
});

it("leaves boxAddresses undefined when the variable is unset", () => {
  expect(loadTestConfig({}).boxAddresses).toBeUndefined();
});
```

(`loadTestConfig` is this file's existing helper for building a minimal valid env — reuse it
exactly as the neighbouring cases do; do not invent a second one.)

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/box-reach.test.ts src/config.test.ts`
Expected: FAIL — `parseBoxAddresses` is not exported; `cfg.boxAddresses` is undefined in the
positive case.

- [ ] **Step 3: Implement the parser and let `box-secrets.ts` share the one reader**

```ts
// apps/server/src/box-reach.ts — add
import { AppError } from "@waitron/shared";
import "./errors.js";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The operator-supplied override for the addresses this box advertises — its certificate SANs, its
 * IP-QR and its mDNS answers. Unset, the interfaces are enumerated instead (`listBoxIpv4`).
 *
 * It exists because a container does not necessarily sit on the venue's network: under bridge
 * networking `listBoxIpv4` returns the container's own address, which is non-internal and
 * unreachable, so the box would mint a certificate for and advertise an address no device can
 * reach. Loopback is refused for the same reason it would be wrong to advertise.
 */
export function parseBoxAddresses(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const entries = raw.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    const match = IPV4.exec(entry);
    const octetsValid =
      match !== null && match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
    if (!octetsValid || entry.startsWith("127.")) {
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_BOX_ADDRESSES",
        reason: "box_addresses_invalid",
      });
    }
  }
  return entries;
}
```

In `box-secrets.ts`, delete the private `defaultListIpv4` and import `listBoxIpv4` from
`box-reach.js`. **Delete the `box-reach.ts` header sentence that justifies the duplication** — a
behaviour change retires its receipts (CLAUDE.md §1).

In `config.ts`, beside the other optional reads: `boxAddresses: parseBoxAddresses(env.WAITRON_BOX_ADDRESSES)`,
with the field declared on the config interface as `readonly boxAddresses?: string[]`.

In `boot.ts`, at each of the three call sites, replace the bare reader with the resolved list:

```ts
const boxAddresses = () => config.boxAddresses ?? listBoxIpv4();
// ensureBoxSecrets({ ..., listIpv4: boxAddresses })
// buildReachInfo({ ..., listIpv4: boxAddresses })
// startMdnsResponder({ hostname: BOX_HOSTNAME, getAddresses: boxAddresses, log })
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 5: Prove the override actually reaches the certificate**

Run: `pnpm --filter @waitron/server exec vitest run src/box-secrets.test.ts`
Then delete the `listIpv4` argument from the `ensureBoxSecrets` call in `boot.ts` and re-run the
box-secrets suite. Expected: a SAN assertion fails. Restore it. Record the deletion-proof in the
commit message — a guard nobody has failed on purpose is not a proven guard.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/box-reach.ts apps/server/src/box-reach.test.ts \
        apps/server/src/box-secrets.ts apps/server/src/config.ts \
        apps/server/src/config.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): WAITRON_BOX_ADDRESSES overrides the box's advertised addresses

A container does not necessarily sit on the venue's network: under bridge
networking listBoxIpv4 returns the container's own 172.x address, which is
non-internal by os.networkInterfaces and unreachable from the LAN, so the
box would mint a certificate for and advertise an address no device can
reach. Unset, behaviour is unchanged.

box-secrets.ts now shares box-reach.ts's reader rather than keeping its own
copy, and the header sentence justifying that duplication is deleted with
it. Proven by deletion: dropping the listIpv4 argument from the
ensureBoxSecrets call fails a SAN assertion."
```

---

### Task 3: Recovery state and the escalation decision

**Files:**
- Create: `apps/server/src/recovery-state.ts`
- Test: `apps/server/src/recovery-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RecoveryLevel = "normal" | "safe-mode" | "recovery";
  export interface RecoveryState {
    failures: number;
    level: RecoveryLevel;
    lastErrorCode: string | null;
    lastFailureAt: string | null;
  }
  export const FRESH: RecoveryState;
  export function levelFor(failures: number): RecoveryLevel;
  export function afterFailure(state: RecoveryState, errorCode: string, at: Date): RecoveryState;
  export async function readRecoveryState(stateDir: string): Promise<RecoveryState>;
  export async function writeRecoveryState(stateDir: string, state: RecoveryState): Promise<void>;
  ```
  Tasks 7 and 8 consume all of them.

Thresholds (spec §9.2): 3 consecutive failures → `safe-mode`; 6 → `recovery`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/recovery-state.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRESH,
  afterFailure,
  levelFor,
  readRecoveryState,
  writeRecoveryState,
} from "./recovery-state.js";

describe("levelFor", () => {
  it("escalates normal → safe-mode → recovery at 3 and 6", () => {
    expect(levelFor(0)).toBe("normal");
    expect(levelFor(2)).toBe("normal");
    expect(levelFor(3)).toBe("safe-mode");
    expect(levelFor(5)).toBe("safe-mode");
    expect(levelFor(6)).toBe("recovery");
    expect(levelFor(99)).toBe("recovery");
  });
});

describe("afterFailure", () => {
  it("counts up and records the classified code", () => {
    const at = new Date("2026-09-08T10:00:00Z");
    const next = afterFailure(FRESH, "module.config_invalid", at);
    expect(next.failures).toBe(1);
    expect(next.level).toBe("normal");
    expect(next.lastErrorCode).toBe("module.config_invalid");
    expect(next.lastFailureAt).toBe(at.toISOString());
  });

  it("reaches safe-mode on the third consecutive failure", () => {
    const at = new Date("2026-09-08T10:00:00Z");
    let s = FRESH;
    for (let i = 0; i < 3; i += 1) s = afterFailure(s, "boom", at);
    expect(s.failures).toBe(3);
    expect(s.level).toBe("safe-mode");
  });
});

describe("readRecoveryState", () => {
  it("is FRESH when the file is absent — an unprovisioned box is not a failing one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    expect(await readRecoveryState(dir)).toEqual(FRESH);
  });

  it("is FRESH when the file is corrupt, rather than throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeRecoveryState(dir, FRESH);
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(dir, "recovery.json"), "{ not json"),
    );
    expect(await readRecoveryState(dir)).toEqual(FRESH);
  });

  it("round-trips, and writes 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    const state = afterFailure(FRESH, "boom", new Date("2026-09-08T10:00:00Z"));
    await writeRecoveryState(dir, state);
    expect(await readRecoveryState(dir)).toEqual(state);
    const { mode } = await import("node:fs/promises").then((fs) =>
      fs.stat(join(dir, "recovery.json")),
    );
    expect(mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/recovery-state.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";

/** Where a box sits on the escalation, and therefore whether it can still SELL: `safe-mode` runs
 *  the server with the toggleable modules off (core + fiscal still trade); `recovery` runs no
 *  server at all. */
export type RecoveryLevel = "normal" | "safe-mode" | "recovery";

export interface RecoveryState {
  failures: number;
  level: RecoveryLevel;
  lastErrorCode: string | null;
  lastFailureAt: string | null;
}

export const FRESH: RecoveryState = {
  failures: 0,
  level: "normal",
  lastErrorCode: null,
  lastFailureAt: null,
};

const SAFE_MODE_AT = 3;
const RECOVERY_AT = 6;

export function levelFor(failures: number): RecoveryLevel {
  if (failures >= RECOVERY_AT) return "recovery";
  if (failures >= SAFE_MODE_AT) return "safe-mode";
  return "normal";
}

export function afterFailure(
  state: RecoveryState,
  errorCode: string,
  at: Date,
): RecoveryState {
  const failures = state.failures + 1;
  return {
    failures,
    level: levelFor(failures),
    lastErrorCode: errorCode,
    lastFailureAt: at.toISOString(),
  };
}

/**
 * Read `<stateDir>/recovery.json`. An absent OR unreadable file is FRESH, never a throw: this is
 * the file consulted on the path that exists to recover a broken box, so a corrupt copy of it must
 * not itself be what prevents booting.
 */
export async function readRecoveryState(stateDir: string): Promise<RecoveryState> {
  let text: string;
  try {
    text = await readFile(join(stateDir, "recovery.json"), "utf8");
  } catch {
    return FRESH;
  }
  try {
    const raw = JSON.parse(text) as Partial<RecoveryState>;
    const failures = typeof raw.failures === "number" && raw.failures >= 0 ? raw.failures : 0;
    return {
      failures,
      level: levelFor(failures),
      lastErrorCode: typeof raw.lastErrorCode === "string" ? raw.lastErrorCode : null,
      lastFailureAt: typeof raw.lastFailureAt === "string" ? raw.lastFailureAt : null,
    };
  } catch {
    return FRESH;
  }
}

/** 0600: it sits beside the vault key in the state volume. */
export async function writeRecoveryState(stateDir: string, state: RecoveryState): Promise<void> {
  await writeFileAtomic(join(stateDir, "recovery.json"), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}
```

Note `level` is always DERIVED from `failures` on read, never trusted from the file — a hand-edited
`level` cannot pin a box into recovery mode.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/recovery-state.ts apps/server/src/recovery-state.test.ts
git commit -s -m "feat(server): recovery escalation state in the state volume

Three consecutive failed boots reach safe mode, six reach recovery mode.
The level is always derived from the count on read rather than trusted from
the file, so a hand-edited level cannot pin a box into recovery; an absent
or corrupt file is FRESH rather than a throw, since this is the file
consulted on the path that exists to recover a broken box."
```

---

### Task 4: The instance bootstrap

**Files:**
- Create: `apps/server/src/instance-bootstrap.ts`
- Test: `apps/server/src/instance-bootstrap.pg.test.ts`

**Interfaces:**
- Consumes: `readInstanceState`, `planInstance`, `applyInstance`, `withDatabase`,
  `replicationBootstrapStatements`, `REPLICATION_ROLE`, `generatePassword` (all
  `@waitron/provisioning`); `createPostgresDb` (`@waitron/db`); `writeFileAtomic`, `formatEnvFile`,
  `parseEnvFile`.
- Produces:
  ```ts
  export interface InstanceUrls {
    databaseUrl: string;
    migrationsDatabaseUrl: string;
    replicationPassword: string;
  }
  export async function ensureInstance(opts: {
    bootstrapUrl: string;
    database: string;
    stateDir: string;
    log: Logger;
  }): Promise<InstanceUrls>;
  ```
  Task 8 calls it.

**The two rules this task exists to honour** (spec §5, and a Critical if broken):

1. **Apply only `create-database`, `create-role` and `grant-membership`.** Never `migrate`
   (`boot.ts` already migrates unconditionally before the mode branch), never `stamp`.
2. **Pass the environment READ FROM the database's own stamp**, or `preproduction` when there is
   none. `planInstance` throws `deployment.already_stamped` *before emitting any action* when the
   stamp disagrees, so a guessed value bricks every boot of a production box, not just the first.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/instance-bootstrap.pg.test.ts
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb } from "@waitron/db";
import { startPostgresContainer } from "@waitron/db/testing/postgres.js";
import { ensureInstance } from "./instance-bootstrap.js";

const noopLog = () => {};

describe("ensureInstance", () => {
  let container: Awaited<ReturnType<typeof startPostgresContainer>>;
  let bootstrapUrl: string;
  let stateDir: string;

  beforeAll(async () => {
    container = await startPostgresContainer();
    bootstrapUrl = container.uri;
    stateDir = await mkdtemp(join(tmpdir(), "wt-inst-"));
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("creates the database migrator-owned, both logins, and the replication role", async () => {
    const urls = await ensureInstance({
      bootstrapUrl,
      database: "waitron",
      stateDir,
      log: noopLog,
    });
    const admin = await createPostgresDb(bootstrapUrl);
    try {
      const owner = await admin.execute<{ owner: string }>(
        sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = 'waitron'`,
      );
      expect(owner.rows[0]?.owner).toBe("waitron_migrator");
      const repl = await admin.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_roles where rolname = 'waitron_repl' and rolreplication`,
      );
      expect(repl.rows[0]?.n).toBe(1);
    } finally {
      await admin.close();
    }
    expect(urls.databaseUrl).toContain("/waitron");
    // The app login must actually be able to connect with the password we persisted.
    const app = await createPostgresDb(urls.databaseUrl);
    await app.close();
  });

  it("does NOT stamp — the wizard's choice of production must remain open", async () => {
    const target = await createPostgresDb(
      (await ensureInstance({ bootstrapUrl, database: "waitron", stateDir, log: noopLog }))
        .migrationsDatabaseUrl,
    );
    try {
      const present = await target.execute<{ exists: boolean }>(
        sql`select to_regclass('public.deployment') is not null as exists`,
      );
      // Nothing migrated yet, so there is no table to stamp into — and nothing tried.
      expect(present.rows[0]?.exists).toBe(false);
    } finally {
      await target.close();
    }
  });

  it("is idempotent: a second run plans nothing and leaves instance.env byte-identical", async () => {
    const before = await readFile(join(stateDir, "instance.env"), "utf8");
    await ensureInstance({ bootstrapUrl, database: "waitron", stateDir, log: noopLog });
    expect(await readFile(join(stateDir, "instance.env"), "utf8")).toBe(before);
  });

  it("recreates a dropped database using the saved passwords (the rejoin shape)", async () => {
    const admin = await createPostgresDb(bootstrapUrl);
    try {
      await admin.execute(sql.raw(`drop database if exists waitron with (force)`));
    } finally {
      await admin.close();
    }
    const urls = await ensureInstance({
      bootstrapUrl,
      database: "waitron",
      stateDir,
      log: noopLog,
    });
    const app = await createPostgresDb(urls.databaseUrl);
    await app.close();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/instance-bootstrap.pg.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/instance-bootstrap.ts
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createPostgresDb, type Database } from "@waitron/db";
import {
  REPLICATION_ROLE,
  applyInstance,
  generatePassword,
  planInstance,
  readInstanceState,
  replicationBootstrapStatements,
  withDatabase,
  type InstanceAction,
} from "@waitron/provisioning";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface InstanceUrls {
  databaseUrl: string;
  migrationsDatabaseUrl: string;
  replicationPassword: string;
}

/**
 * The actions the ENTRYPOINT owns. `migrate` is `boot.ts`'s (it runs `applyMigrations`
 * unconditionally before the mode branch), and `stamp` is the WIZARD's: `stampDeployment` is
 * permanent and one-way, so stamping a default here would leave a box that can never be
 * provisioned as production.
 */
const OWNED: ReadonlySet<InstanceAction["kind"]> = new Set(["create-database", "create-role", "grant-membership"]);

/** Compose `<base>` with a different user, password and database — the two login URLs are the
 *  bootstrap URL's host/port with the generated credentials substituted. */
function urlFor(bootstrapUrl: string, user: string, password: string, database: string): string {
  const url = new URL(bootstrapUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Bring the cluster to the shape a Waitron node needs — the database owned by `waitron_migrator`,
 * the two login roles, and the replication bootstrap — and persist the generated credentials.
 * Safe to re-run on every container start: `planInstance` emits only what is missing, so a
 * wiped-and-rejoined box (roles are cluster-global, the database was dropped) plans exactly one
 * `create-database`.
 */
export async function ensureInstance(opts: {
  bootstrapUrl: string;
  database: string;
  stateDir: string;
  log: Logger;
}): Promise<InstanceUrls> {
  const envPath = join(opts.stateDir, "instance.env");
  let saved: Record<string, string> = {};
  try {
    saved = parseEnvFile(await readFile(envPath, "utf8"));
  } catch {
    saved = {};
  }

  const admin = await createPostgresDb(opts.bootstrapUrl);
  try {
    const state = await withDatabase(opts.bootstrapUrl, opts.database, async (target) =>
      readInstanceState(admin, opts.database, target),
    );

    // Read from the database, never guessed: planInstance REFUSES up front when the existing stamp
    // disagrees with the requested environment, so a wrong value here fails every future boot.
    const environment = state.inside?.stamp ?? "preproduction";
    const actions = planInstance(state, { database: opts.database, environment }).filter((action) =>
      OWNED.has(action.kind),
    );

    if (actions.length > 0) {
      opts.log("info", "instance.bootstrap_applying", { actions: actions.length });
      await applyInstance(actions, {
        admin,
        database: opts.database,
        adminUri: opts.bootstrapUrl,
        migrationsRoot: null,
        openTarget: () => openTarget(opts.bootstrapUrl, opts.database),
      });
    }

    // Passwords are recoverable ONLY off the actions that generated them — the CLI prints them for
    // the same reason. A role that already existed keeps whatever instance.env holds.
    const created = new Map(
      actions
        .filter((a): a is Extract<InstanceAction, { kind: "create-role" }> => a.kind === "create-role")
        .map((a) => [a.role, a.password]),
    );
    const appPassword = created.get("waitron_app") ?? passwordFrom(saved.DATABASE_URL);
    const migratorPassword =
      created.get("waitron_migrator") ?? passwordFrom(saved.WAITRON_MIGRATIONS_DATABASE_URL);
    const replicationPassword = saved.WAITRON_REPLICATION_PASSWORD ?? generatePassword();

    await ensureReplicationRole(admin, replicationPassword, opts.log);

    const urls: InstanceUrls = {
      databaseUrl: urlFor(opts.bootstrapUrl, "waitron_app", appPassword, opts.database),
      migrationsDatabaseUrl: urlFor(
        opts.bootstrapUrl,
        "waitron_migrator",
        migratorPassword,
        opts.database,
      ),
      replicationPassword,
    };
    await writeFileAtomic(
      envPath,
      formatEnvFile({
        DATABASE_URL: urls.databaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: urls.migrationsDatabaseUrl,
        WAITRON_REPLICATION_PASSWORD: replicationPassword,
      }),
      0o600,
    );
    return urls;
  } finally {
    await admin.close();
  }
}
```

Implement the three helpers the above names — `openTarget` (a `TargetConnection` over the target
database, matching how `cli.ts` builds one), `passwordFrom` (pull the password out of a saved URL,
throwing `server.config_invalid` with `reason: "instance_password_unrecoverable"` when the role
exists but no saved URL does), and `ensureReplicationRole` (run
`replicationBootstrapStatements(password)` only when `pg_roles` has no `REPLICATION_ROLE`, each
statement `sql.raw` and autocommit; never log the statement — it carries the password, the same
rule `CREATE ROLE` follows).

- [ ] **Step 4: Run the tests**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/instance-bootstrap.pg.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Prove the stamp filter by deletion**

Remove `"stamp"` from the filter so the entrypoint would apply it, add a test that pre-stamps the
database `production` and then calls `ensureInstance`, and confirm it throws
`deployment.already_stamped`. Expected: it does. Restore the filter and confirm the same test now
passes. Record both readings in the commit message — this is the failure the filter exists to
prevent, and a filter nobody has broken on purpose is not a proven filter.

- [ ] **Step 6: Run the provisioning package's gate too**

Run: `pnpm --filter @waitron/provisioning test:coverage`
Expected: PASS at 98/98/98/95 (this task imports from it but should not change it).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/instance-bootstrap.ts apps/server/src/instance-bootstrap.pg.test.ts
git commit -s -m "feat(server): ensure the instance shape on every container start

The database owned by waitron_migrator, the two login roles and the
replication bootstrap, re-run safely on every start, so a blank box needs
no manual waitron-provision instance and a wiped-and-rejoined box gets its
database back unattended. It also closes the gap db-wipe.ts records: a
crash between its drop and its create no longer needs an operator.

Applies only create-database / create-role / grant-membership. Migrating is
boot.ts's, and stamping is the WIZARD's: stampDeployment is permanent and
one-way, so a default stamp here would leave a box that can never be
provisioned as production. Proven by deletion — with 'stamp' left in the
filter, a pre-stamped production database makes planInstance throw
deployment.already_stamped before emitting any action; with the filter
restored the same case passes."
```

---

### Task 5: Merge the box's env files, environment winning

**Files:**
- Create: `apps/server/src/box-env.ts`
- Test: `apps/server/src/box-env.test.ts`

**Interfaces:**
- Produces: `loadBoxEnv(base: NodeJS.ProcessEnv, stateDir: string): Promise<NodeJS.ProcessEnv>`.
  Task 8 calls it.

Order: `instance.env`, then `secrets.env`, then `trading.env` — a later FILE overrides an earlier
one, and anything already in `base` (the real environment) beats all three. That precedence is
cloud rule 4's cheap half: a cloud profile injects `WAITRON_CREDENTIALS_KEY` from the environment
and the file is ignored.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/box-env.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBoxEnv } from "./box-env.js";

async function boxWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wt-env-"));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return dir;
}

describe("loadBoxEnv", () => {
  it("returns the base unchanged when no files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-env-"));
    expect(await loadBoxEnv({ A: "1" }, dir)).toEqual({ A: "1" });
  });

  it("loads all three files", async () => {
    const dir = await boxWith({
      "instance.env": "DATABASE_URL=postgres://app\n",
      "secrets.env": "WAITRON_CREDENTIALS_KEY=k\n",
      "trading.env": "WAITRON_ENV=production\n",
    });
    const env = await loadBoxEnv({}, dir);
    expect(env.DATABASE_URL).toBe("postgres://app");
    expect(env.WAITRON_CREDENTIALS_KEY).toBe("k");
    expect(env.WAITRON_ENV).toBe("production");
  });

  it("trading.env beats instance.env — the promote rewrites trading.env", async () => {
    const dir = await boxWith({
      "instance.env": "DATABASE_URL=postgres://from-instance\n",
      "trading.env": "DATABASE_URL=postgres://from-trading\n",
    });
    expect((await loadBoxEnv({}, dir)).DATABASE_URL).toBe("postgres://from-trading");
  });

  it("THE ENVIRONMENT BEATS EVERY FILE", async () => {
    const dir = await boxWith({ "secrets.env": "WAITRON_CREDENTIALS_KEY=from-file\n" });
    const env = await loadBoxEnv({ WAITRON_CREDENTIALS_KEY: "from-env" }, dir);
    expect(env.WAITRON_CREDENTIALS_KEY).toBe("from-env");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/box-env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/box-env.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.js";

/** Later files win over earlier ones: `trading.env` is rewritten by provisioning and by a promote,
 *  so it is the most recent statement of the box's identity. */
const FILES = ["instance.env", "secrets.env", "trading.env"] as const;

/**
 * The environment `startServer` is handed: the box's own env files merged under the real
 * environment. A variable already present in `base` ALWAYS wins — that is what lets a cloud
 * profile inject the vault key without the box having a `secrets.env` at all, and it is the half of
 * "every secret can come from the environment as well as a file" this spec builds.
 *
 * A missing file is normal (a setup box has no `trading.env`) and is skipped; an unreadable one is
 * skipped too rather than thrown, so a damaged file cannot be the thing that stops a box booting
 * into the recovery path that exists to fix it.
 */
export async function loadBoxEnv(
  base: NodeJS.ProcessEnv,
  stateDir: string,
): Promise<NodeJS.ProcessEnv> {
  const fromFiles: Record<string, string> = {};
  for (const name of FILES) {
    try {
      Object.assign(fromFiles, parseEnvFile(await readFile(join(stateDir, name), "utf8")));
    } catch {
      continue;
    }
  }
  return { ...fromFiles, ...base };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 5: Prove the precedence by deletion**

Swap the spread to `{ ...base, ...fromFiles }` and re-run. Expected: the "ENVIRONMENT BEATS EVERY
FILE" case fails. Restore it and note the reading in the commit message.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/box-env.ts apps/server/src/box-env.test.ts
git commit -s -m "feat(server): merge the box's env files with the environment winning

instance.env, then secrets.env, then trading.env, all under the real
environment. The precedence is what lets a cloud profile inject the vault
key with no secrets.env on disk. An unreadable file is skipped rather than
thrown: a damaged one must not be what stops a box reaching the recovery
path that exists to fix it. Proven by deletion — reversing the spread fails
the precedence case."
```

---

### Task 6: Safe mode — a boot-scoped module overlay

**Files:**
- Modify: `apps/server/src/config.ts`, `apps/server/src/boot.ts`
- Test: `apps/server/src/config.test.ts`, `apps/server/src/boot.safe-mode.test.ts`

**Interfaces:**
- Produces: `config.safeMode: boolean` (from `WAITRON_SAFE_MODE=1`), and a `boot.ts`-local
  `safeModeConfig(moduleConfig, modules)` that overlays every `toggleable` module off.

Safe mode is an OVERLAY, never a write to `modules.json`: the operator's file is untouched, so
leaving safe mode restores exactly what they had. The fiscal slot (`provision-only`) and `core`
(`mandatory`) stay ENABLED — a box that cannot chain locally must refuse to sell rather than sell
unfiled, so a broken fiscal module escalates to recovery mode instead of degrading into trading.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/boot.safe-mode.test.ts
import { describe, expect, it } from "vitest";
import { parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { safeModeConfig } from "./boot.js";

describe("safeModeConfig", () => {
  it("disables every toggleable module and keeps mandatory + provision-only", () => {
    const overlaid = safeModeConfig(parseModuleConfig({}, ALL_MODULES), ALL_MODULES);
    for (const module of ALL_MODULES) {
      const enabled = overlaid.overrides.get(module.name) !== false;
      expect(enabled, `${module.name} (${module.tier})`).toBe(module.tier !== "toggleable");
    }
  });

  it("keeps the fiscal slot enabled — a box that cannot chain must not sell unfiled", () => {
    const overlaid = safeModeConfig(parseModuleConfig({}, ALL_MODULES), ALL_MODULES);
    const fiscal = ALL_MODULES.filter((m) => m.tier === "provision-only");
    expect(fiscal.length).toBeGreaterThan(0);
    for (const module of fiscal) expect(overlaid.overrides.get(module.name)).not.toBe(false);
  });

  it("leaves an operator's own disable in place", () => {
    const operator = parseModuleConfig({ bookings: false }, ALL_MODULES);
    expect(safeModeConfig(operator, ALL_MODULES).overrides.get("bookings")).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/boot.safe-mode.test.ts`
Expected: FAIL — `safeModeConfig` is not exported from `boot.ts`.

- [ ] **Step 3: Implement**

In `config.ts`, beside the other booleans: `safeMode: env.WAITRON_SAFE_MODE === "1"`.

In `boot.ts`, export the overlay and apply it where `moduleConfig` is read:

```ts
/**
 * Safe mode's module set: every `toggleable` module off, `mandatory` (core) and `provision-only`
 * (the fiscal slot) untouched. An OVERLAY over the operator's parsed config rather than a write to
 * their `modules.json`, so leaving safe mode restores exactly what they had.
 *
 * The fiscal slot deliberately stays enabled. If fiscal is what is broken, safe mode fails too and
 * the entrypoint escalates to recovery mode — which is correct: a box that cannot hash-chain
 * locally must refuse to SELL rather than sell unfiled (CLAUDE.md §5).
 */
export function safeModeConfig(
  desired: ModuleConfig,
  modules: readonly WaitronModule[],
): ModuleConfig {
  const overrides = new Map(desired.overrides);
  for (const module of modules) {
    if (module.tier === "toggleable") overrides.set(module.name, false);
  }
  return { overrides };
}
```

and at the read site:

```ts
const desired = await readModuleConfig(config.stateDir);
const moduleConfig = config.safeMode ? safeModeConfig(desired, ALL_MODULES) : desired;
if (config.safeMode) {
  log("warn", "boot.safe_mode", {
    disabled: ALL_MODULES.filter((m) => m.tier === "toggleable").map((m) => m.name),
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.safe-mode.test.ts \
        apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): safe mode overlays the toggleable modules off

WAITRON_SAFE_MODE=1 boots with every toggleable module disabled and core +
the fiscal slot untouched, so a broken optional module still leaves a
selling venue. An overlay, never a write to modules.json, so leaving safe
mode restores the operator's own config exactly.

The fiscal slot stays enabled deliberately: if fiscal is what is broken,
safe mode fails too and the box escalates to recovery mode. A box that
cannot hash-chain locally must refuse to sell, not sell unfiled."
```

---

### Task 7: The recovery surface

**Files:**
- Create: `apps/server/src/recovery-surface.ts`
- Test: `apps/server/src/recovery-surface.test.ts`

**Interfaces:**
- Consumes: `RecoveryState` (Task 3), `readFile` for the log tail, `Hono`.
- Produces: `recoveryApp(deps: { state: RecoveryState; logDir: string; onRetry: (level: RecoveryLevel) => Promise<void> }): Hono`.
  Task 8 serves it over the box's own TLS.

Serves: `GET /` (a plain HTML page — what failed, the count, the last error code, the last 200 log
lines), `GET /recovery-api/status` (the same as JSON), `POST /recovery-api/retry` (reset to normal
and exit), `POST /recovery-api/safe-mode` (set the count to the safe-mode threshold and exit).
Docker's restart policy performs the restart; the handler only writes and exits.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/recovery-surface.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FRESH, afterFailure } from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";

const state = afterFailure(
  afterFailure(afterFailure(FRESH, "module.config_invalid", new Date()), "x", new Date()),
  "module.config_invalid",
  new Date(),
);

describe("recoveryApp", () => {
  it("states the level, the count and the last error on the page", async () => {
    const app = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry: vi.fn() });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("module.config_invalid");
    expect(body).toContain("3");
  });

  it("serves the same facts as JSON", async () => {
    const app = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry: vi.fn() });
    const res = await app.request("/recovery-api/status");
    expect(await res.json()).toMatchObject({
      failures: 3,
      level: "safe-mode",
      lastErrorCode: "module.config_invalid",
    });
  });

  it("retry asks for a normal boot; safe-mode asks for safe mode", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const app = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry });
    expect((await app.request("/recovery-api/retry", { method: "POST" })).status).toBe(200);
    expect(onRetry).toHaveBeenCalledWith("normal");
    expect((await app.request("/recovery-api/safe-mode", { method: "POST" })).status).toBe(200);
    expect(onRetry).toHaveBeenCalledWith("safe-mode");
  });

  it("shows the log tail, and tolerates no log at all", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    await writeFile(join(logDir, "waitron.log"), "line-one\nline-two\n");
    const app = recoveryApp({ state, logDir, onRetry: vi.fn() });
    expect(await (await app.request("/")).text()).toContain("line-two");
    const empty = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry: vi.fn() });
    expect((await empty.request("/")).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Build it with Hono (the app's existing router). Escape every interpolated value into the HTML —
the error code and log lines are attacker-influenceable in principle, and this page is served
before any authentication exists. Keep the markup inline and dependency-free: this page must render
when the app bundle's own module graph is what failed.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/recovery-surface.ts apps/server/src/recovery-surface.test.ts
git commit -s -m "feat(server): the recovery page served when the server will not boot

Plain HTML plus a JSON twin: the level, the consecutive failure count, the
last classified error and the log tail, with two actions — retry a normal
boot, or boot in safe mode. Both only write the counter and exit; Docker's
restart policy does the restart. Markup is inline and dependency-free
because this page has to render when the app's own module graph is what
failed."
```

---

### Task 8: The entrypoint

**Files:**
- Create: `apps/server/src/node-entry.ts`
- Modify: `apps/server/package.json` (bundle it)
- Test: `apps/server/src/node-entry.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5, 7.
- Produces: the container's `ENTRYPOINT`. Exports `runEntry(deps)` so the wiring is testable
  without spawning a process.

Order (spec §5): wait for Postgres → `ensureInstance` → `loadBoxEnv` (and DELETE
`WAITRON_BOOTSTRAP_DATABASE_URL` from what is passed on, plus set `WAITRON_ADMIN_DATABASE_URL` to
the migrator URL) → read the level → serve recovery, or start the server.

The counter clears only on a boot that STAYS UP: `startServer` resolving means migrations applied,
pools opened and the listener bound, and the timer then requires the process to survive
`STAYED_UP_MS` (120 000) beyond that. Clearing on "started" alone would be a measurement where pass
and fail look alike — a module throwing five seconds in would reset the counter every attempt and
the box would restart-loop forever without ever escalating.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/node-entry.test.ts
import { describe, expect, it, vi } from "vitest";
import { FRESH, levelFor } from "./recovery-state.js";
import { runEntry } from "./node-entry.js";

function deps(over: Partial<Parameters<typeof runEntry>[0]> = {}) {
  return {
    baseEnv: { WAITRON_BOOTSTRAP_DATABASE_URL: "postgres://postgres:pg@127.0.0.1/postgres" },
    stateDir: "/state",
    waitForPostgres: vi.fn(() => Promise.resolve()),
    ensureInstance: vi.fn(() =>
      Promise.resolve({
        databaseUrl: "postgres://app",
        migrationsDatabaseUrl: "postgres://migrator",
        replicationPassword: "r",
      }),
    ),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn(() => Promise.resolve(FRESH)),
    writeRecoveryState: vi.fn(() => Promise.resolve()),
    startServer: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveRecovery: vi.fn(() => Promise.resolve()),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    ...over,
  };
}

describe("runEntry", () => {
  it("never passes the superuser URL to the server", async () => {
    const d = deps();
    await runEntry(d);
    const env = d.startServer.mock.calls[0]![0] as NodeJS.ProcessEnv;
    expect(env.WAITRON_BOOTSTRAP_DATABASE_URL).toBeUndefined();
    expect(env.WAITRON_ADMIN_DATABASE_URL).toBe("postgres://migrator");
  });

  it("increments the counter and rethrows when the boot throws", async () => {
    const d = deps({ startServer: vi.fn(() => Promise.reject(new Error("boom"))) });
    await expect(runEntry(d)).rejects.toThrow();
    expect(d.writeRecoveryState).toHaveBeenCalledWith("/state", expect.objectContaining({ failures: 1 }));
  });

  it("sets WAITRON_SAFE_MODE at the safe-mode level", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) })),
    });
    await runEntry(d);
    expect((d.startServer.mock.calls[0]![0] as NodeJS.ProcessEnv).WAITRON_SAFE_MODE).toBe("1");
  });

  it("serves the recovery page and never starts the server at the recovery level", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 6, level: levelFor(6) })),
    });
    await runEntry(d);
    expect(d.serveRecovery).toHaveBeenCalled();
    expect(d.startServer).not.toHaveBeenCalled();
  });

  it("does NOT clear the counter merely because the server started", async () => {
    const d = deps({ readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 2 })) });
    await runEntry(d);
    // Only the stayed-up callback may clear it.
    expect(d.writeRecoveryState).not.toHaveBeenCalledWith("/state", expect.objectContaining({ failures: 0 }));
    expect(d.scheduleStayedUp).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runEntry` plus the thin process wiring**

`runEntry` takes every collaborator as a dependency (as the test shows) and the module's bottom
does the real wiring — the same "process wiring is not unit-tested" shape `bin-recovery.ts` uses,
under a `/* v8 ignore start */` with the reason stated.

- [ ] **Step 4: Add it to the server's build**

In `apps/server/package.json`'s `build` script, add another esbuild invocation for
`src/node-entry.ts` → `dist/node-entry.js`, matching the existing bins' flags exactly (bundle,
platform node, format esm, target node24, the `createRequire` banner).

- [ ] **Step 5: Run the tests and a real build**

Run: `pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/server build`
Expected: PASS, and `apps/server/dist/node-entry.js` exists.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/node-entry.ts apps/server/src/node-entry.test.ts apps/server/package.json
git commit -s -m "feat(server): the container entrypoint

Waits for Postgres, ensures the instance shape, merges the box's env files
under the real environment, reads the escalation level, then starts the
server or serves the recovery page. The supervisor the server has always
assumed (its restart request is SIGTERM to itself) is now Docker's restart
policy.

The superuser bootstrap URL is deleted from the environment the server
receives; the server's owner connection is the migrator, as boot.ts's setup
branch documents.

The failure counter clears only on a boot that STAYS UP, never on one that
merely started: clearing on 'started' is a measurement where pass and fail
look alike, and a module throwing five seconds in would reset the counter
on every attempt and loop forever without escalating."
```

---

### Task 9: The images, the compose file, and the one-time preparation

**Files:**
- Create: `deploy/Dockerfile`, `deploy/compose.yml`, `deploy/.env.example`, `deploy/prepare.sh`,
  `deploy/README.md`
- Modify: root `package.json` (a `build:image` script)

**Interfaces:** none in code. `deploy/compose.yml` names the app image
`ghcr.io/<owner>/waitron:main` with a local `waitron:dev` override documented in the README.

Everything here is settled by the spec's measurements — do not re-derive them, and do not
substitute a "simpler" base:

- `node:26-slim` is Debian trixie; `postgresql-client-18` comes from the **PGDG** apt repo, because
  trixie ships 17 and `pg_dump` 17 refuses an 18 server.
- `libcap2-bin` + `setcap cap_net_bind_service=+ep /usr/local/bin/node`, because the app container
  uses host networking, whose namespace keeps `ip_unprivileged_port_start=1024`.
- Every `/var/lib/waitron/*` mount point is `mkdir`'d and `chown`'d to `waitron` in the image, or
  the volume mounts root-owned and the app cannot write to it at all.

- [ ] **Step 1: Write the Dockerfile**

Two stages exactly as spec §3.1 describes. Pin `postgres` major and client major beside each other
with a comment naming the pairing.

- [ ] **Step 2: Build it and check the four measured properties**

```bash
docker build -f deploy/Dockerfile -t waitron:dev .
docker run --rm waitron:dev pg_dump --version                       # expect 18.x
docker run --rm waitron:dev getcap /usr/local/bin/node              # expect cap_net_bind_service=ep
docker run --rm waitron:dev sh -c 'id -u; ls -ldn /var/lib/waitron/state'  # expect non-root, owned by it
docker run --rm waitron:dev node /app/server.js 2>&1 | head -3      # expect server.config_missing
```

Expected: `pg_dump (PostgreSQL) 18.x`; the capability present; a non-zero uid owning the state dir;
and the bundle failing with `server.config_missing` rather than a module-resolution error.

- [ ] **Step 3: Write `compose.yml`, `.env.example` and `prepare.sh`**

Per spec §6/§7/§8: `app` on `network_mode: host` with `restart: unless-stopped`, the five named
volumes and the two-endpoint healthcheck; `db` on an internal bridge publishing
`127.0.0.1:5432:5432`, with the three cluster settings on `command:` and `pg_isready` as its
healthcheck; json-file logging capped at `10m` × 5. `prepare.sh` is non-interactive and idempotent
(install Docker if absent, enable it at boot, generate `.env` if absent, pull, up, then print and —
when `/dev/tty1` is writable — show the ready banner with a QR).

- [ ] **Step 4: Bring the whole stack up on blank volumes**

```bash
cd deploy && bash prepare.sh   # on this Mac: expect the Docker-install step to no-op
docker compose ps              # expect both healthy
curl -k https://127.0.0.1/setup-api/status
```

Expected: `{"environment":"preproduction",...}` with HTTP 200. If it is 503 you have hit `/health`
on a setup box, which is the trap the two-endpoint healthcheck exists for.

- [ ] **Step 5: Commit**

```bash
git add deploy/ package.json
git commit -s -m "feat(deploy): the two containers, the compose file and prepare.sh

App + Postgres with five named volumes, host networking on prem, and the
one-time preparation script the bootable installer will run unattended.

Three properties are measured, not assumed: pg_dump comes from PGDG because
Debian trixie ships 17 and 17 refuses an 18 server; node carries
cap_net_bind_service because host networking keeps the 1024 floor; every
volume mount point is chowned in the image because a fresh volume inherits
the image path's ownership and would otherwise mount root-owned."
```

---

### Task 10: CI — build the image, smoke it, publish it

**Files:**
- Modify: `.github/workflows/ci.yml`, `scripts/changed-scope.mjs`
- Test: `scripts/changed-scope.test.ts` (the existing root suite)

**`deploy/**` must classify as CODE**, or the `changes` job skips the image build for a Dockerfile
change — the exact hole CLAUDE.md §2 warns about.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/changed-scope.test.ts — append to the existing describe
it("classifies deploy/ as code, so a Dockerfile change builds the image", () => {
  expect(classifyPaths(["deploy/Dockerfile"]).code).toBe(true);
  expect(classifyPaths(["deploy/compose.yml"]).code).toBe(true);
});
```

(Use whichever exported helper the neighbouring cases use — read the file first and match it; do
not introduce a second classifier entry point.)

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm exec vitest run scripts/changed-scope.test.ts`
Expected: FAIL — `deploy/Dockerfile` currently classifies as documentation/inert.

- [ ] **Step 3: Add `deploy/**` to the code paths, then add the `image` job**

The job: `needs: changes`, `if: needs.changes.outputs.code == 'true'`, buildx with GHA cache;
compose up against fresh volumes; assert `/setup-api/status` is 200 and `/setup-api/ca.crt` serves
a PEM; `down -v`. On a push to `main` only, log in to GHCR with `GITHUB_TOKEN` and push `:main`,
`:sha-<short>` and a `v*` tag's version, `linux/amd64,linux/arm64` (amd64 only on PRs). Add it to
the `ci` aggregate job's `needs`.

- [ ] **Step 4: Run the root suite**

Run: `pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/changed-scope.mjs scripts/changed-scope.test.ts
git commit -s -m "ci: build, smoke and publish the node image

deploy/ classifies as code, or the changes job would skip the image build
for a Dockerfile change — the scoped-CI hole CLAUDE.md §2 records. The job
brings the compose stack up on fresh volumes and asserts the setup surface
answers over the box's own TLS, so the non-root bind to 443 under host
networking is exercised on every merge rather than only on a real box."
```

---

### Task 11: The run-it proof, the docs and the backlog

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-node-containers-design.md` (§11 receipts),
  `docs/backlog.md`, `deploy/README.md`

- [ ] **Step 1: Run the blank-box-to-selling proof**

On this Mac, with an override file publishing `443:443` and `WAITRON_BOX_ADDRESSES` set to the
Mac's LAN IP (Docker Desktop cannot put a container on the LAN — measured, spec §13). Before each
step, state what the FAILING case would print.

1. `docker volume rm` every waitron volume, then `bash deploy/prepare.sh`.
2. Open the wizard from a phone on the same network; trust the CA.
   *Failing case:* a certificate whose SANs show `172.` or `192.168.65.` under
   `openssl x509 -text` — that is the override not reaching `ensureBoxSecrets`.
3. Provision a **preproduction** venue.
4. Watch the container restart into trading mode (`docker compose logs -f app`).
5. Enrol the till with pairing code `DEMO`; record one sale.

- [ ] **Step 2: Run the recovery proof**

Force a failing boot (point `WAITRON_MIGRATIONS_DATABASE_URL` at a database the migrator cannot
reach), restart three times and confirm safe mode is entered; three more and confirm the recovery
page is served at the same URL with the box's own certificate. Then use its "retry" button and
confirm a normal boot resumes.
*Failing case for the counter rule:* if the box never escalates past `normal`, the stayed-up
condition is wrong — that is the exact bug Task 8's test exists to prevent.

- [ ] **Step 3: Record both receipts in the spec's §11 and §13**

Dated, stating what was run and what it printed. Note explicitly that the host-network variant is
still owed on a real Linux box.

- [ ] **Step 4: Update `docs/backlog.md`**

Mark push step 1's container half done; add the recovery spec as the named follow-on; keep the
bootable-USB installer as the next Track P item.

- [ ] **Step 5: Full gate, then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
Expected: PASS.

```bash
git add docs/ deploy/README.md
git commit -s -m "docs: the container proof receipts and the backlog update"
```

---

## Self-review

**Spec coverage.** §3.1 → Task 9. §3.2 → Task 9. §4 → Task 9. §5 steps 1–5 → Tasks 4, 5, 8 (step 1's
wait loop is inside Task 8's `waitForPostgres` dep). §6 → Task 2 + Task 9. §7 → Task 9. §8 → Task 9.
§9.1/9.2 → Tasks 3, 6, 8. §9.3 → Task 7. §10 → Task 10. §11 → Tasks 4, 8, 10, 11.

**Two gaps found and closed while reviewing:** the spec's §5 step 4 (read the level) had no task of
its own — folded into Task 8, which is where the branch lives. The `dist/package.json` marker
`bundle-smoke` asserts is produced by `copy-migrations.mjs`, which Task 9's runtime stage must copy
into `/app` — called out in Task 9 step 1's reference to spec §3.1.

**Placeholders:** none — every code step carries the code. Task 7 step 3 and Task 9 steps 1/3 give
the properties rather than full listings (an HTML page and a compose file), which is deliberate:
their content is fully determined by the spec sections cited, and transcribing them twice invites
the two copies to drift.

**Type consistency:** `RecoveryLevel`/`RecoveryState`/`FRESH` (Task 3) are used unchanged in Tasks
7 and 8. `InstanceUrls` (Task 4) is consumed in Task 8. `installShutdownHandlers` (Task 1) is
called in Task 8. `parseBoxAddresses` (Task 2) is read by `config.ts` in the same task.
`safeModeConfig` (Task 6) is exercised by the `WAITRON_SAFE_MODE` env var Task 8 sets.

**Review weight (CLAUDE.md):** this diff touches config/boot wiring, provisioning, a cross-package
contract and CI — a **risk trigger**, so the FULL ceremony applies: per-task reviews, and
`/finish-branch`'s wave with the simplify lenses plus the Codex run-it seat.
