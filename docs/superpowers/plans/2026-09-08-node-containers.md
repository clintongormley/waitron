# The node as two containers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package a Waitron node as two containers (app + Postgres) with named volumes, so a blank
Linux box goes from power-on to a browser-driven setup wizard to a selling venue with nobody typing
anything on the box — and so a box whose server will not boot serves a recovery page instead of
bricking silently.

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

**Modified:** `bin.ts` (use `run-server.ts`), `config.ts` (`WAITRON_BOX_ADDRESSES`),
`box-reach.ts` (own the one IPv4 reader), `box-secrets.ts` (consume it), `discovery-api.ts` +
`boot.ts` (thread the addresses through five call sites), `apps/server/package.json` (bundle
`node-entry`),
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
  Task 7 calls it.

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
- Test: `apps/server/src/box-reach.test.ts`, `apps/server/src/config.test.ts`,
  `apps/server/src/boot.test.ts` (the SAN deletion-proof — it is the only suite that observes
  `boot.ts`'s wiring)

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

  // AppError's message is the CODE alone (`super(code)` — packages/shared/src/errors.ts), so a
  // regex on the message can never see `reason`. Assert the structured fields instead.
  it("refuses a non-IPv4 entry", () => {
    expect(() => parseBoxAddresses("192.168.1.10,nope")).toThrow(
      expect.objectContaining({
        code: "server.config_invalid",
        params: expect.objectContaining({ reason: "box_addresses_invalid" }),
      }),
    );
  });

  it("refuses loopback — it would advertise an address no device can reach", () => {
    expect(() => parseBoxAddresses("127.0.0.1")).toThrow(
      expect.objectContaining({ code: "server.config_invalid" }),
    );
  });
});
```

```ts
// apps/server/src/config.test.ts — append to the existing describe
it("carries WAITRON_BOX_ADDRESSES through to config", () => {
  const cfg = loadConfig(
    { ...MIN_ENV, WAITRON_BOX_ADDRESSES: "192.168.1.10" },
    ROOT,
    MEDIA_ROOT,
    STATE_ROOT,
  );
  expect(cfg.boxAddresses).toEqual(["192.168.1.10"]);
});

it("leaves boxAddresses undefined when the variable is unset", () => {
  expect(loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT).boxAddresses).toBeUndefined();
});
```

**Read `config.test.ts` before writing these.** Its actual shape is a four-positional-argument
`loadConfig(env, ROOT, MEDIA_ROOT, STATE_ROOT)` over a `MIN_ENV` constant that already carries
`DATABASE_URL` and the five `WAITRON_TILL_*` ids. There is no single-argument helper — match the
neighbouring cases exactly and do not add one.

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

In `boot.ts`, thread the resolved list into FIVE call sites — read them first, because they are
three different consumers and the mDNS one appears three times:

```ts
const boxAddresses = () => config.boxAddresses ?? listBoxIpv4();
```

| consumer | where | how |
| --- | --- | --- |
| `ensureBoxSecrets` | `boot.ts` (setup branch, ~`:687`) | add `listIpv4: boxAddresses` — the parameter already exists (`box-secrets.ts`), the call simply does not pass it today |
| `mountDiscovery` → `buildReachInfo` | `boot.ts` (~`:675`) builds the deps; the call is in `discovery-api.ts` (~`:65`) | thread `listIpv4` through `mountDiscovery`'s deps. **`buildReachInfo` is NOT called from `boot.ts`** — do not look for it there |
| `startMdnsResponder` | `boot.ts` `:831`, `:950`, `:2018` | `getAddresses: boxAddresses` at **all three**; patching one leaves two advertising the container's address |

Verify the count before you start: `grep -n 'startMdnsResponder\|ensureBoxSecrets\|mountDiscovery' apps/server/src/boot.ts`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 5: Prove the override reaches the certificate — at the level that can actually see it**

`box-secrets.test.ts` imports `ensureBoxSecrets` directly and injects its own `listIpv4`; it never
calls `startServer`, so deleting the argument at `boot.ts`'s call site leaves that suite GREEN. A
deletion-proof whose control was never run is exactly the false receipt CLAUDE.md §1 is about.

The proof has to observe the wiring, so add it to `boot.test.ts` (which boots against a real
container): boot with `WAITRON_BOX_ADDRESSES=203.0.113.7`, read the leaf back out of the state dir
and assert `203.0.113.7` is among its SANs and that no interface address is.

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/boot.test.ts`
Then delete `listIpv4: boxAddresses` from the `ensureBoxSecrets` call and re-run.
Expected: the new SAN assertion fails. Restore it and record BOTH readings in the commit.

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
  export type RecoveryLevel = "normal" | "recovery";
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

Threshold (spec §9.2): 3 consecutive failures → `recovery`. One degraded level only — §9.1 records
why a degraded-but-trading mode cannot be built on the tiers that exist.

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
  it("escalates normal → recovery at 3", () => {
    expect(levelFor(0)).toBe("normal");
    expect(levelFor(2)).toBe("normal");
    expect(levelFor(3)).toBe("recovery");
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

  it("reaches recovery on the third consecutive failure", () => {
    const at = new Date("2026-09-08T10:00:00Z");
    let s = FRESH;
    for (let i = 0; i < 3; i += 1) s = afterFailure(s, "boom", at);
    expect(s.failures).toBe(3);
    expect(s.level).toBe("recovery");
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

/** Where a box sits on the escalation, and therefore whether it can still SELL. Only two levels:
 *  a degraded-but-trading mode cannot be built on the tiers that exist (spec §9.1) and belongs to
 *  the recovery spec. */
export type RecoveryLevel = "normal" | "recovery";

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

const RECOVERY_AT = 3;

export function levelFor(failures: number): RecoveryLevel {
  return failures >= RECOVERY_AT ? "recovery" : "normal";
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

Three consecutive failed boots reach recovery mode. The level is always
derived from the count on read rather than trusted from the file, so a
hand-edited level cannot pin a box into recovery; an absent or corrupt file
is FRESH rather than a throw, since this is the file consulted on the path
that exists to recover a broken box."
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
  Task 7 calls it.

**The three rules this task exists to honour** (spec §5, each a Critical if broken):

1. **Never apply `stamp`.** `stampDeployment` is permanent and one-way, and the environment is the
   operator's choice in the wizard. A default stamp here leaves a box that can never be provisioned
   as production.
2. **Apply `migrate` only when the cluster has no `app_user` role.** Both extremes are broken.
   Filtering it always fails a VIRGIN box on every boot: `app_user` is created by the core migration
   (`packages/db/drizzle/0001_db_baseline_sql.sql`), and `planInstance` emits `migrate` BEFORE the
   `grant-membership waitron_migrator → app_user` and `create-role waitron_app … IN ROLE app_user`
   that need it, so they fail `role "app_user" does not exist`. Applying it always is also wrong:
   `applyInstance`'s migrate runs `manifestSets()` — the FULL manifest — so it would migrate modules
   the operator disabled, which `boot.ts`'s trading branch deliberately does not. Gating on
   `app_user` gives a virgin cluster one full migration here (identical to the `setup-migrates-all`
   boot that follows, and there is no `modules.json` yet) and leaves every later start's migrations
   to `boot.ts`.
3. **Pass the environment READ FROM the database's own stamp**, or `preproduction` when there is
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
    // Roles are CLUSTER-global, so the pg_roles count above passes even if the bootstrap ran
    // against the WRONG database — both answers look alike (CLAUDE.md §1). The schema-local half is
    // what distinguishes them, so assert it IN THE TARGET database: a default-privileges entry for
    // the migrator granting SELECT to waitron_repl.
    const target = await createPostgresDb(urls.migrationsDatabaseUrl);
    try {
      const acl = await target.execute<{ n: number }>(
        sql`select count(*)::int as n
              from pg_default_acl d
              join pg_roles owner on owner.oid = d.defaclrole
             where owner.rolname = 'waitron_migrator'
               and array_to_string(d.defaclacl, ',') like '%waitron_repl%'`,
      );
      expect(acl.rows[0]?.n).toBe(1);
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
      // The `deployment` TABLE exists — the core migration creates it
      // (packages/db/drizzle/0001_db_baseline_sql.sql), and on a virgin cluster this entrypoint
      // ran that migration to mint `app_user`. What must NOT exist is a ROW: stamping is the
      // wizard's, and an unstamped database is what keeps `production` reachable.
      const present = await target.execute<{ exists: boolean }>(
        sql`select to_regclass('public.deployment') is not null as exists`,
      );
      expect(present.rows[0]?.exists).toBe(true);
      const stamped = await target.execute<{ n: number }>(
        sql`select count(*)::int as n from deployment`,
      );
      expect(stamped.rows[0]?.n).toBe(0);
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
const OWNED: ReadonlySet<InstanceAction["kind"]> = new Set([
  "create-database",
  "create-role",
  "grant-membership",
]);

/** Compose `<base>` with a different user, password and database — the two login URLs are the
 *  bootstrap URL's host/port with the generated credentials substituted. */
function urlFor(bootstrapUrl: string, user: string, password: string, database: string): string {
  const url = new URL(bootstrapUrl);
  // Assign RAW: the URL setters percent-encode already, so encoding here would double-encode and
  // `passwordFrom` would read a still-encoded password back and re-encode it.
  url.username = user;
  url.password = password;
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
    // TWO-PHASE read, exactly as `cli.ts`'s `withState` does it: `readInstanceState`'s `target` is a
    // connection to the target database, and on a first provision there is none to open.
    // `withDatabase(uri, database)` returns a connection STRING (it is not a scope function), and
    // the target is reached AS THE MIGRATOR — without `withRole` the later `create-role` runs as the
    // admin, which is not what `applyInstance` documents it needs.
    const targetUri = withRole(
      withDatabase(opts.bootstrapUrl, opts.database),
      INSTANCE_MIGRATOR_ROLE,
    );
    const probe = await readInstanceState(admin, opts.database, null);
    let state = probe;
    if (probe.databaseExists) {
      const target = await createPostgresDb(targetUri);
      try {
        state = await readInstanceState(admin, opts.database, target);
      } finally {
        await target.close();
      }
    }

    // Read from the database, never guessed: planInstance REFUSES up front when the existing stamp
    // disagrees with the requested environment, so a wrong value here fails every future boot.
    const environment = state.inside?.stamp ?? "preproduction";
    // `migrate` survives the filter only on a cluster with no `app_user` — see rule 2 above.
    const appUserExists = await roleExists(admin, "app_user");
    const actions = planInstance(state, { database: opts.database, environment }).filter(
      (action) =>
        OWNED.has(action.kind) || (action.kind === "migrate" && !appUserExists),
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

    // AGAINST THE TARGET DATABASE, never the admin's `/postgres`: two of
    // `replicationBootstrapStatements`' statements are schema-local (`grant select on all tables in
    // schema public`, `alter default privileges … in schema public`), so run on the wrong database
    // they silently grant nothing to Waitron's tables. Both existing callers
    // (`packages/sync/src/testing/replication-node.ts`, `apps/server/scripts/dev-setup.ts`) connect
    // to the target for exactly this reason.
    await ensureReplicationRole(admin, targetUri, replicationPassword, opts.log);

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

Implement the four helpers the above names, reading `cli.ts`'s `withState` first as the reference:

- `openTarget()` — the `TargetConnection` `applyInstance` needs, built over `targetUri` (the
  `withRole(withDatabase(...))` string above), matching `cli.ts`.
- `roleExists(admin, name)` — `select 1 from pg_roles where rolname = $1`, parameterised.
- `passwordFrom(savedUrl)` — `new URL(saved).password`, throwing `server.config_invalid` with
  `reason: "instance_password_unrecoverable"` when the role exists but no saved URL does.
- `ensureReplicationRole(admin, targetUri, password, log)` — when `pg_roles` has no
  `REPLICATION_ROLE`, open a connection to `targetUri` and run `replicationBootstrapStatements(password)`
  there, each `sql.raw` and autocommit. **Never log the statement or the password** — it carries the
  credential, the same rule `CREATE ROLE` follows (spec's `sqlStateOf` convention).

- [ ] **Step 4: Run the tests**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/instance-bootstrap.pg.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Prove BOTH gates by deletion — each in the direction that fails**

*The stamp filter.* Add a test that pre-stamps the database `production` (migrate it first, then
`stampDeployment`), then calls `ensureInstance`. With the filter in place it must succeed and leave
the stamp `production`. Now let `"stamp"` through the filter and re-run: expect
`deployment.already_stamped`. Restore.

*The migrate gate.* On a genuinely blank cluster (a fresh container, no `app_user`), make the filter
drop `migrate` unconditionally and run the first test. Expected: it fails with
`role "app_user" does not exist` — that is the blank-box brick this gate exists to prevent. Restore
the gate and confirm it passes. Then, on an already-migrated cluster, assert the plan the entrypoint
applies contains NO `migrate` action, so a disabled module's migrations are never applied behind
`boot.ts`'s filter.

Record all four readings in the commit. A gate nobody has broken on purpose is not a proven gate.

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
  Task 7 calls it.

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

### Task 6: The recovery surface

**Files:**
- Create: `apps/server/src/recovery-surface.ts`
- Test: `apps/server/src/recovery-surface.test.ts`

**Interfaces:**
- Consumes: `RecoveryState` (Task 3), `readFile` for the log tail, `Hono`.
- Produces: `recoveryApp(deps: { state: RecoveryState; logDir: string; onRetry: (level: RecoveryLevel) => Promise<void> }): Hono`.
  Task 7's `serveRecovery` puts it behind the box's own TLS — this task produces only the app.

Serves: `GET /` (a plain HTML page — what failed, the count, the last error code, the last 200 log
lines), `GET /recovery-api/status` (the same as JSON), and `POST /recovery-api/retry` (reset the
counter and exit). Docker's restart policy performs the restart; the handler only writes and exits.
There is no safe-mode action — spec §9.1 says why that level is not built here.

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
  it("states the count and the last error on the page", async () => {
    const app = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry: vi.fn() });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("module.config_invalid");
    // NOT `toContain("3")`: the page also renders an ISO timestamp, which contains a 3 most of the
    // time, so that would pass with the count omitted entirely.
    expect(body).toMatch(/failed 3 times|3 consecutive/i);
  });

  it("serves exactly the same facts as JSON — no extra field leaks", async () => {
    const app = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry: vi.fn() });
    const res = await app.request("/recovery-api/status");
    // toEqual, not toMatchObject: an unlisted key is never checked, and this route must not leak a
    // log path or a raw error message (CLAUDE.md §4).
    expect(await res.json()).toEqual({
      failures: 3,
      level: "recovery",
      lastErrorCode: "module.config_invalid",
      lastFailureAt: state.lastFailureAt,
    });
  });

  it("retry resets the counter and asks for a normal boot", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const app = recoveryApp({ state, logDir: await mkdtemp(join(tmpdir(), "wt-log-")), onRetry });
    expect((await app.request("/recovery-api/retry", { method: "POST" })).status).toBe(200);
    expect(onRetry).toHaveBeenCalledWith("normal");
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
boot — which only writes the counter and exits; Docker's restart policy does
the restart. Markup is inline and dependency-free because this page has to
render when the app's own module graph is what failed."
```

---

### Task 7: The entrypoint

**Files:**
- Create: `apps/server/src/node-entry.ts`
- Modify: `apps/server/package.json` (bundle it)
- Test: `apps/server/src/node-entry.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5, 7.
- Produces: the container's `ENTRYPOINT`. Exports `runEntry(deps)` so the wiring is testable
  without spawning a process.

Order (spec §5, §9.3) — **the level is read FIRST**:

1. `readRecoveryState(stateDir)` → if the level is `recovery`, serve the page and return. Nothing
   before this may touch Postgres: a database-side failure is exactly what puts a box here, so
   ordering the decision after `waitForPostgres`/`ensureInstance` makes the page unreachable in most
   of the cases it exists for.
2. `waitForPostgres` → `ensureInstance` → `loadBoxEnv`, DELETING `WAITRON_BOOTSTRAP_DATABASE_URL`
   from what is passed on and setting `WAITRON_ADMIN_DATABASE_URL` to the migrator URL.
3. Write the incremented counter **before** `startServer`, then start it.

Two rules the tests must pin, both from spec §9.2:

- **The counter is incremented BEFORE the server starts, never only in a failure handler.** A boot
  that HANGS never throws, so a catch-only counter leaves such a box restart-looping forever without
  escalating — the exact case the ordering exists for.
- **It clears only on a boot that STAYS UP:** `startServer` resolved (migrations applied, pools
  open, listener bound) AND the process then survived `STAYED_UP_MS` (120 000). Clearing on
  "started" alone is a measurement where pass and fail look alike — a module throwing five seconds
  in would reset the counter on every attempt.

`startServer` resolving is deliberately the signal rather than a healthy `/health` probe: `/health`
is 503 on a setup box by design, so a health-gated reset would drive every unprovisioned box into
recovery.

**This task also implements the two collaborators its test injects** — no other task produces them:

- `waitForPostgres(url, deps)` — a bounded retry loop (the shape of `dev-setup.ts`'s own), throwing
  `server.config_missing` when `WAITRON_BOOTSTRAP_DATABASE_URL` is unset, as spec §5 step 1 requires.
- `serveRecovery(app, opts)` — serves Task 6's Hono app over the box's own CA + leaf read from the
  state volume, on `WAITRON_HTTP_PORT`, via `@hono/node-server`'s `serve` with a TLS option built
  the same way `boot.ts`'s `buildServeOptions` does. **When the state volume holds no leaf yet** (a
  box that has never completed a setup boot) it falls back to plain HTTP on the same port rather
  than failing — spec §9.3 states this limit rather than leaving it implicit.

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

  it("serves the recovery page and never starts the server at the recovery level", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) })),
    });
    await runEntry(d);
    expect(d.serveRecovery).toHaveBeenCalled();
    expect(d.startServer).not.toHaveBeenCalled();
  });

  it("decides BEFORE touching Postgres — the page is served even when the database is unreachable", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) })),
      waitForPostgres: vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
      ensureInstance: vi.fn(() => Promise.reject(new Error("must not be called"))),
    });
    await runEntry(d);
    expect(d.serveRecovery).toHaveBeenCalled();
    expect(d.waitForPostgres).not.toHaveBeenCalled();
  });

  it("increments the counter BEFORE the server starts, so a HANGING boot still escalates", async () => {
    const order: string[] = [];
    const d = deps({
      writeRecoveryState: vi.fn(() => {
        order.push("counter");
        return Promise.resolve();
      }),
      // Never resolves and never rejects — the boot that hangs. A catch-only counter loses this case.
      startServer: vi.fn(() => {
        order.push("start");
        return new Promise(() => {});
      }),
    });
    void runEntry(d);
    await vi.waitFor(() => expect(order).toEqual(["counter", "start"]));
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

### Task 8: The images, the compose file, and the one-time preparation

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

The image sets `ENTRYPOINT ["node", "/app/node-entry.js"]` and no `CMD`, so a bare
`docker run … <command>` passes the command as ARGUMENTS TO THE ENTRYPOINT rather than running it.
Every probe therefore overrides it:

```bash
docker build -f deploy/Dockerfile -t waitron:dev .
docker run --rm --entrypoint pg_dump waitron:dev --version            # expect 18.x
docker run --rm --entrypoint getcap  waitron:dev /usr/local/bin/node  # expect cap_net_bind_service=ep
docker run --rm --entrypoint sh waitron:dev -c 'id -u; ls -ldn /var/lib/waitron/state'
docker run --rm --entrypoint node waitron:dev /app/server.js 2>&1 | head -3  # expect server.config_missing
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

### Task 9: CI — build the image, smoke it, publish it

**Files:**
- Modify: `.github/workflows/ci.yml` (add the `image` job AND add it to `ci`'s `needs`)
- Test: `scripts/changed-scope.test.mjs` (a regression pin — green from the start),
  `scripts/ci-workflow.test.mjs` (existing; it pins ci.yml's job graph and must stay green)
- **Not** modified: `scripts/changed-scope.mjs` — `deploy/**` already classifies as code

**`deploy/**` already classifies as CODE — do not "fix" it.** `isInertPath`
(`scripts/changed-scope.mjs`) treats only `docs/`, `.codex/`, `.vscode/`, `.gitignore`,
`.editorconfig` and root-level `*.md` as inert, and `classify` returns `code: true` for the first
non-inert path. So a Dockerfile change already gates the image job in. This task therefore has NO
red step for the classifier; it adds a REGRESSION test pinning that behaviour, which is honest about
what it is.

Two further facts to match rather than invent: the exported helper is `classify`, not
`classifyPaths`, and the suite is `scripts/changed-scope.test.mjs`, not `.ts`.

- [ ] **Step 1: Add the regression test (green from the start — say so in the commit)**

```js
// scripts/changed-scope.test.mjs — append to the existing describe
it("classifies deploy/ as code, so a Dockerfile change still builds the image", () => {
  expect(classify(["deploy/Dockerfile"]).code).toBe(true);
  expect(classify(["deploy/compose.yml"]).code).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm exec vitest run scripts/changed-scope.test.mjs`
Expected: PASS immediately. This pins today's behaviour so a future narrowing of the classifier
cannot silently stop building the image.

- [ ] **Step 3: Add the `image` job — and satisfy the workflow guard**

**`scripts/ci-workflow.test.mjs` pins ci.yml's job graph** — it asserts that `ci`'s `needs` names
every other job and that no job needs something absent. Adding `image` without adding it to `ci`'s
`needs` fails that suite; run it as part of this step, not at the end.

The job: `needs: changes`, `if: needs.changes.outputs.code == 'true'`, buildx with GHA cache;
compose up against fresh volumes; assert `/setup-api/status` is 200 and `/setup-api/ca.crt` serves
a PEM; `down -v`. On a push to `main` only, log in to GHCR with `GITHUB_TOKEN` and push `:main`,
`:sha-<short>` and a `v*` tag's version, `linux/amd64,linux/arm64` (amd64 only on PRs). Add it to
the `ci` aggregate job's `needs`.

- [ ] **Step 4: Run the root suite, which includes the workflow guard**

Run: `pnpm exec vitest run`
Expected: PASS — in particular `scripts/ci-workflow.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/changed-scope.test.mjs
git commit -s -m "ci: build, smoke and publish the node image

deploy/ ALREADY classified as code (isInertPath lists only docs and a few
root config paths), so the added classifier test is a regression pin that
was green from the start, not a fix — it stops a future narrowing from
silently skipping the image build. The job
brings the compose stack up on fresh volumes and asserts the setup surface
answers over the box's own TLS, so the non-root bind to 443 under host
networking is exercised on every merge rather than only on a real box."
```

---

### Task 10: The run-it proof, the docs and the backlog

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
reach), restart three times and confirm the recovery page is served at the same URL with the box's
own certificate. Then use its "retry" button and confirm a normal boot resumes.
*Failing case for the counter rule:* if the box never escalates past `normal`, the stayed-up
condition is wrong — that is the exact bug Task 7's test exists to prevent.

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

**Spec coverage.** §3.1 → Task 8. §3.2 → Task 8. §4 → Task 8. §5 steps 1–5 → Tasks 4, 5, 7 (step 1's
`waitForPostgres` and §9.3's `serveRecovery` are both IMPLEMENTED in Task 7, not merely injected).
§6 → Task 2 + Task 8. §7 → Task 8. §8 → Task 8. §9.1 → no task, by design: the section's content is
the decision NOT to build a degraded-but-trading level. §9.2 → Tasks 3 and 7. §9.3 → Tasks 6 and 7.
§10 → Task 9. §11 → Tasks 4, 7, 9, 10.

**Corrections applied after the fresh-context plan review** (each was a defect in the first draft,
verified against the code before fixing):

1. The entrypoint's migrate filter was fatal — `app_user` comes from the core migration, so a virgin
   box could never provision. Now gated on `app_user`'s absence (Task 4, rule 2), with the
   blank-cluster failure proven by deletion.
2. `withDatabase(uri, database)` returns a connection STRING, not a scope function, and the target
   must be reached via `withRole` (Task 4).
3. The replication bootstrap's two schema-local statements must run against the TARGET database;
   the old test asserted only cluster-global `pg_roles`, where pass and fail look identical
   (Task 4).
4. Safe mode is removed entirely — it cannot be built on the `toggleable` tier, which includes
   `identity`, `credentials` and `payments`.
5. The recovery decision now precedes the Postgres wait, or the page is unreachable in most of the
   cases it exists for (Task 7).
6. Fabricated API details replaced with the real ones: `loadConfig(env, ROOT, MEDIA_ROOT,
   STATE_ROOT)` over `MIN_ENV` (not a `loadTestConfig`), `AppError.message` is the code alone,
   `classify` not `classifyPaths`, `changed-scope.test.mjs` not `.ts`.
7. `deploy/**` already classifies as code, so Task 9's classifier test is an honest regression pin,
   not a red-then-green fix; and `ci-workflow.test.mjs` pins ci.yml's job graph, so `image` must be
   added to `ci`'s `needs`.
8. Every `docker run` probe needs `--entrypoint`, since the image has an ENTRYPOINT and no CMD.

**Placeholders:** none — every code step carries the code. Task 6 step 3 and Task 8 steps 1/3 give
properties rather than full listings (an HTML page, a Dockerfile and a compose file), deliberately:
their content is fully determined by the spec sections cited, and transcribing them twice invites
the copies to drift.

**Type consistency:** `RecoveryLevel` is `"normal" | "recovery"` in both the Interfaces block and
the implementation. `RecoveryState`/`FRESH` (Task 3) are used unchanged in Tasks 6 and 7.
`InstanceUrls` (Task 4) is consumed in Task 7. `installShutdownHandlers` (Task 1) is called in
Task 7. `parseBoxAddresses` (Task 2) is read by `config.ts` in the same task. `recoveryApp` (Task 6)
is served by Task 7's `serveRecovery`.

**Known gap, stated rather than hidden:** nothing here proves a box can still SELL under any
degraded condition, because this spec no longer claims one exists. The only degraded level is
"no server", which needs no such proof.

**Review weight (CLAUDE.md):** this diff touches config/boot wiring, provisioning, a cross-package
contract and CI — a **risk trigger**, so the FULL ceremony applies: per-task reviews, and
`/finish-branch`'s wave with the simplify lenses plus the Codex run-it seat.
