# Backup + recovery-key wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a non-technical operator a guided way to turn backups on, mint and record a recovery key, and set a schedule + retention policy — applied live without a box restart — closing the gap where a fresh box takes no backups until someone hand-edits an env file.

**Architecture:** A `BackupSupervisor` owns the backup duty's lifecycle so config changes hot-reload (both boot and an authenticated admin route call `supervisor.reload`). The wizard persists per-venue config to a new `backup.env` box-env file (never per-hardware data); an authenticated `mountBackupApi` surface drives it; a first-run nudge on the setup done-screen points operators to it. Two engine extensions ride along: a wall-clock scheduler and dual (count + age) retention. The archive also captures `backup.env` + `modules.json` so a restore keeps the settings.

**Tech Stack:** TypeScript, Hono (routes), Drizzle/pg, Vitest (+ Testcontainers real-PG, PGlite), Lit screen modules (`@waitron/setup`, `@waitron/dashboard`).

**Spec:** `docs/superpowers/specs/2026-09-09-backup-recovery-key-wizard-design.md` — read it alongside this plan; the plan argues from it. §12 logs the review round whose fixes this plan builds in.

## Global Constraints

- **One tenant per database; a config/by-id read still scopes to the tenant** (`CLAUDE.md` §3). The scheduler's `time_zone`/`day_cutover` read runs through `withTenant`.
- **No backwards-compat or data-migration code** — nothing is deployed; `backup.env` is a new file (`CLAUDE.md` §3). Existing tests that assert the OLD required-DB-URL behaviour are updated, not preserved.
- **An empty env value is UNSET everywhere** (`isUnset`, `apps/server/src/env-value.ts:15`). Task 1 makes `loadBoxEnv` honour that.
- **Error codes name the DOMAIN CONCEPT, never renamed once shipped** (`packages/shared/src/errors.ts:35-51`). New codes are all `backup.*`, declared in `apps/server/src/errors.ts`; every throwing file `import "./errors.js"`. HTTP status is set in the mounting surface's `STATUS` map, never in the registry.
- **`backup.env` holds ONLY per-venue config** — destination, recovery key, policy, `key_rotated_at`. NEVER the DB connection (per-hardware); the supervisor derives that at reload from `config.adminDatabaseUrl`.
- **Real Postgres for grants / the fiscal-read probe / pool lifecycle** — PGlite's superuser hides grant bugs (`CLAUDE.md` §4). `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Every commit is `git commit -s`.** Per-task verify: `pnpm --filter <pkg> test:coverage` + `pnpm typecheck` (whole-workspace, ~40s) + `pnpm --filter <pkg> exec prettier --check` on touched files. During TDD run one test with `pnpm --filter @waitron/server exec vitest run <path> -t "<name>"`.
- **This lands with owner sign-off at PR** (fiscal-adjacent, §5 recovery posture).

**Package filters:** server = `@waitron/server`, setup = `@waitron/setup`, dashboard = `@waitron/dashboard`.

---

## Task order and dependencies

1. **box-env empty-base fix + compose-env guard** — foundation; without it the feature is inert. Independent.
2. **`loadBackupConfig` extensions** — schedule + dual-retention + optional DB URL + `key_rotated_at`; `backup.schedule_invalid`. Pairs with Task 3's types.
3. **Wall-clock scheduler + dual-retention prune** in `runBackupSweep`. Depends on Task 2.
4. **`BackupSupervisor`** — reload lifecycle, latch, live singleton-role holder, runtime status + key fingerprint; refactor boot. Depends on Tasks 2–3.
5. **Capture `backup.env` + `modules.json`** via a sweep-only collector. Depends on Task 3.
6. **`mountBackupApi`** — 5 routes + provenance + passphrase guard + effective==requested + `not_primary` + latch + TLS-only recovery-key. Register in boot. Depends on Tasks 2, 4, 5.
7. **Dashboard backup admin screens**. Depends on Task 6.
8. **Setup done-screen first-run nudge** (demo-skip). Depends on Task 7 for the link target; testable alone.

---

## Task 1: box-env treats an empty base value as absent, + compose-env guard

**Why:** `deploy/compose.yml:40-42` passes the three backup vars as `${VAR:-}` → `""` in the container; `box-env.ts:31`'s `{ ...fromFiles, ...base }` lets that empty value override `backup.env`; `isUnset("")` is true, so backups stay off whatever the wizard wrote. Fix: a real-env value only wins when it is **non-empty**.

**Files:**
- Modify: `apps/server/src/box-env.ts` (the merge at :31)
- Test: `apps/server/src/box-env.test.ts` (extend)
- Modify: `apps/server/src/node-entry.test.ts` (the pin that asserts "base always wins" — update to "non-empty base wins")
- Create: `scripts/backup-compose-env.test.ts` (root project: rendered compose env vs the merge rule)
- Modify: `docs/superpowers/specs/2026-09-06-...node-containers...` receipt line that states "a variable already present in the environment always wins" → "present and non-empty" (grep for the exact phrase across `docs/` and `.github/instructions/` and update every paraphrase — `CLAUDE.md` §1 base-to-tip rule).

**Interfaces:**
- Produces: `loadBoxEnv(base, stateDir)` unchanged signature; new semantics — an empty-string value in `base` no longer masks a file value.

- [ ] **Step 1: Failing test — empty base value falls through to the file**

Add to `apps/server/src/box-env.test.ts`:

```ts
it("an empty base value does not mask a file value (compose ${VAR:-} case)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxenv-"));
  await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
  const merged = await loadBoxEnv({ WAITRON_BACKUP_DIR: "" }, dir);
  expect(merged.WAITRON_BACKUP_DIR).toBe("/mnt/usb");
});

it("a non-empty base value still wins over the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxenv-"));
  await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
  const merged = await loadBoxEnv({ WAITRON_BACKUP_DIR: "/mnt/env" }, dir);
  expect(merged.WAITRON_BACKUP_DIR).toBe("/mnt/env");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @waitron/server exec vitest run src/box-env.test.ts -t "empty base value"`
Expected: FAIL — merged value is `""`, not `/mnt/usb`.

- [ ] **Step 3: Add `backup.env` to the file list, and implement the non-empty-base merge**

First (Blocker: without this the wizard's file is never read and even Step 1's test fails), add `"backup.env"` to `FILES` at `box-env.ts:7`, LAST so it is read after the existing files:
```ts
const FILES = ["instance.env", "secrets.env", "trading.env", "backup.env"] as const;
```
Then, in `apps/server/src/box-env.ts`, replace the final `return { ...fromFiles, ...base };` with a merge that skips empty base values (import `isUnset` from `./env-value.js`):

```ts
import { isUnset } from "./env-value.js";
// ...
  const merged: Record<string, string | undefined> = { ...fromFiles };
  for (const [k, v] of Object.entries(base)) {
    // A real-env value wins ONLY when non-empty — an empty string is "unset"
    // everywhere in this codebase (env-value.ts), and compose passes backup vars
    // as `${VAR:-}` → "", which must not mask a file value (spec §3.2, Blocker 1).
    if (!isUnset(v)) merged[k] = v;
  }
  return merged;
```

Update the file header comment (`box-env.ts:9-18`) so its stated contract reads "a non-empty variable in `base` wins" and cite the spec.

- [ ] **Step 4: Run — passes**

Run: `pnpm --filter @waitron/server exec vitest run src/box-env.test.ts`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: Update the `node-entry.test.ts` pin**

Find the assertion that a base var overrides a file var and adjust it to use a **non-empty** base value (so it still passes) and add a case proving an empty base var no longer overrides. Run:
`pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts`
Expected: PASS.

- [ ] **Step 6: Root guard — compose does not silently disable backups**

Create `scripts/backup-compose-env.test.ts` (root Vitest project). It parses `deploy/compose.yml`, extracts the `server` service's `environment` map, and asserts: for each `WAITRON_BACKUP_*` entry, either it is NOT emitted with an empty default, OR (given the Step 3 fix) an empty rendered value is provably treated as absent by `loadBoxEnv`. Concretely, assert the invariant the fix guarantees:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("compose backup vars cannot silently disable a file-configured backup", () => {
  it("every WAITRON_BACKUP_* compose var uses the empty-default shape the merge is proven to ignore", () => {
    // Documents Blocker 1: compose passes these as `${VAR:-}` → "" ; box-env.test.ts proves
    // an empty base value no longer masks backup.env. This guard makes a future compose edit
    // that reintroduces a NON-empty hard-coded default (which WOULD win) visible.
    const composeText = readFileSync(join(__dirname, "../deploy/compose.yml"), "utf8");
    const backupLines = composeText.split("\n").filter((l) => /WAITRON_BACKUP_\w+:/.test(l));
    expect(backupLines.length).toBeGreaterThan(0);
    for (const line of backupLines) {
      expect(line).toMatch(/\$\{WAITRON_BACKUP_\w+:-\}\s*$/); // empty default only
    }
  });
});
```

Regex over the text — no YAML dependency, no cross-project import (the behavioural half is Step 1's box-env test). This guard documents the compose shape so a future edit that reintroduces the trap is visible.

- [ ] **Step 7: Sweep the prose receipts**

Grep `docs/` and `.github/instructions/` for "always wins" / "present in the environment" describing box-env precedence; update each to "non-empty" with a one-line pointer to this change (`CLAUDE.md` §1 base-to-tip rule).

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter @waitron/server test:coverage && pnpm typecheck`
```bash
git add -A && git commit -s -m "fix(box-env): a real-env value masks a file value only when non-empty (compose \${VAR:-} would otherwise disable backups)"
```

---

## Task 2: `loadBackupConfig` — schedule, dual retention, optional DB URL, key-rotated-at

**Files:**
- Modify: `apps/server/src/backup-config.ts`
- Modify: `apps/server/src/errors.ts` (add `backup.schedule_invalid`)
- Test: `apps/server/src/backup-config.test.ts`

**Interfaces:**
- Produces:
```ts
export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | { kind: "wall-clock"; days: "daily" | number[]; at: { hour: number; minute: number } | "auto" };
export interface BackupConfig {
  destinations: BackupDestination[];
  recoveryKey: string;
  databaseUrl: string | undefined;   // undefined → supervisor uses the box owner connection
  schedule: BackupSchedule;
  retain: number;                     // count cap
  retainDays: number;                 // age cap (new)
  staleAfterMs: number;
  keyRotatedAt: string | undefined;   // ISO; for status only
}
```
- New env vars: `WAITRON_BACKUP_SCHEDULE_DAYS` (`"daily"` or a comma list of `0`–`6`, Sun=0), `WAITRON_BACKUP_AT` (`"HH:MM"` or `"auto"`), `WAITRON_BACKUP_RETAIN_DAYS` (positive int, default 30), `WAITRON_BACKUP_KEY_ROTATED_AT` (ISO). Legacy `WAITRON_BACKUP_INTERVAL_MS` still accepted.
- New error code: `"backup.schedule_invalid": { reason: string }`.

- [ ] **Step 1: Register the error code**

In `apps/server/src/errors.ts`, inside the `declare module "@waitron/shared" { interface ErrorParams { ... } }` block, beside the other `backup.*` entries (~:1604):
```ts
"backup.schedule_invalid": { reason: string };
```

- [ ] **Step 2: Failing tests — schedule parsing, dual retention, optional DB URL, conflict**

Add to `apps/server/src/backup-config.test.ts`:
```ts
it("parses a wall-clock schedule (daily at HH:MM)", () => {
  const c = loadBackupConfig({
    WAITRON_BACKUP_DIR: "/mnt/usb", WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    WAITRON_BACKUP_SCHEDULE_DAYS: "daily", WAITRON_BACKUP_AT: "04:30",
  })!;
  expect(c.schedule).toEqual({ kind: "wall-clock", days: "daily", at: { hour: 4, minute: 30 } });
  expect(c.databaseUrl).toBeUndefined();  // derived by the supervisor, not required here
});

it("parses a weekday subset and 'auto' time", () => {
  const c = loadBackupConfig({
    WAITRON_BACKUP_DIR: "/mnt/usb", WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    WAITRON_BACKUP_SCHEDULE_DAYS: "1,3,5", WAITRON_BACKUP_AT: "auto",
  })!;
  expect(c.schedule).toEqual({ kind: "wall-clock", days: [1, 3, 5], at: "auto" });
});

it("applies dual-retention defaults (7 count, 30 days)", () => {
  const c = loadBackupConfig({
    WAITRON_BACKUP_DIR: "/mnt/usb", WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    WAITRON_BACKUP_SCHEDULE_DAYS: "daily", WAITRON_BACKUP_AT: "auto",
  })!;
  expect(c.retain).toBe(7);
  expect(c.retainDays).toBe(30);
});

it("uses the legacy interval mode when no wall-clock schedule is set", () => {
  const c = loadBackupConfig({
    WAITRON_BACKUP_DIR: "/mnt/usb", WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    WAITRON_BACKUP_INTERVAL_MS: "3600000",
  })!;
  expect(c.schedule).toEqual({ kind: "interval", ms: 3600000 });
});

it("rejects both an interval and a wall-clock schedule", () => {
  expect(() => loadBackupConfig({
    WAITRON_BACKUP_DIR: "/mnt/usb", WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    WAITRON_BACKUP_INTERVAL_MS: "3600000", WAITRON_BACKUP_AT: "04:00",
  })).toThrow(/schedule_invalid/);
});

it("rejects a malformed time", () => {
  expect(() => loadBackupConfig({
    WAITRON_BACKUP_DIR: "/mnt/usb", WAITRON_BACKUP_RECOVERY_KEY: "x".repeat(12),
    WAITRON_BACKUP_SCHEDULE_DAYS: "daily", WAITRON_BACKUP_AT: "25:99",
  })).toThrow(/schedule_invalid/);
});
```
Also update the EXISTING test that asserts `server.config_invalid` when `WAITRON_BACKUP_DATABASE_URL` is missing: that requirement is removed — assert `databaseUrl` is `undefined` and the config still loads. Keep a test that an explicitly-set `WAITRON_BACKUP_DATABASE_URL` is passed through.

- [ ] **Step 3: Run — verify failures**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-config.test.ts`
Expected: FAIL (new fields/parse not implemented).

- [ ] **Step 4: Implement**

In `backup-config.ts`: keep `import "./errors.js";`. Add a `parseSchedule(env)` and `parseRetainDays`:
```ts
function parseSchedule(env: Env): BackupSchedule {
  const daysRaw = env.WAITRON_BACKUP_SCHEDULE_DAYS;
  const atRaw = env.WAITRON_BACKUP_AT;
  const wallClockSet = !isUnset(daysRaw) || !isUnset(atRaw);
  const intervalSet = !isUnset(env.WAITRON_BACKUP_INTERVAL_MS);
  if (wallClockSet && intervalSet) {
    throw new AppError("backup.schedule_invalid", { reason: "interval_and_wall_clock" });
  }
  if (!wallClockSet) {
    return { kind: "interval", ms: positiveInt(env, "WAITRON_BACKUP_INTERVAL_MS", DEFAULT_BACKUP_INTERVAL_MS) };
  }
  const days = parseDays(daysRaw);          // "daily" | number[]; throws schedule_invalid on a bad token
  const at = parseAt(atRaw);                // { hour, minute } | "auto"; throws schedule_invalid
  return { kind: "wall-clock", days, at };
}

function parseDays(raw: string | undefined): "daily" | number[] {
  if (isUnset(raw) || raw === "daily") return "daily";
  const parts = raw.split(",").map((s) => s.trim());
  const nums = parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      throw new AppError("backup.schedule_invalid", { reason: "bad_day" });
    }
    return n;
  });
  if (nums.length === 0) throw new AppError("backup.schedule_invalid", { reason: "no_days" });
  return [...new Set(nums)].sort((a, b) => a - b);
}

function parseAt(raw: string | undefined): { hour: number; minute: number } | "auto" {
  if (isUnset(raw) || raw === "auto") return "auto";
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(raw);
  if (m === null) throw new AppError("backup.schedule_invalid", { reason: "bad_time" });
  const hour = Number(m[1]); const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new AppError("backup.schedule_invalid", { reason: "bad_time" });
  return { hour, minute };
}
```
In `loadBackupConfig`, after `destinations`:
```ts
  const recoveryKey = env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) throw new AppError("backup.recovery_key_missing", {});
  if (recoveryKey.length < MIN_PASSPHRASE_LENGTH) throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });

  const databaseUrl = isUnset(env.WAITRON_BACKUP_DATABASE_URL) ? undefined : env.WAITRON_BACKUP_DATABASE_URL;
  return {
    destinations, recoveryKey, databaseUrl,
    schedule: parseSchedule(env),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    retainDays: positiveInt(env, "WAITRON_BACKUP_RETAIN_DAYS", DEFAULT_BACKUP_RETAIN_DAYS),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
    keyRotatedAt: isUnset(env.WAITRON_BACKUP_KEY_ROTATED_AT) ? undefined : env.WAITRON_BACKUP_KEY_ROTATED_AT,
  };
```
Add `const DEFAULT_BACKUP_RETAIN_DAYS = 30;`. Delete the old `WAITRON_BACKUP_DATABASE_URL` required-throw block. Update the `BackupConfig` interface + its doc comments to the new shape.

- [ ] **Step 5: Run — passes**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Sweep the "DB-url required" receipts (CLAUDE.md §1 base-to-tip)**

Making `WAITRON_BACKUP_DATABASE_URL` optional retires the claim that it is required-when-a-destination-is-set. Grep and update each: `docs/superpowers/specs/2026-09-08-node-containers-design.md` (~:143-145), `docs/backlog.md` (~:95), `deploy/Dockerfile` (~:98), `deploy/.env.example` (~:33), and `.github/instructions/waitron.instructions.md` if it paraphrases it. Reword to "optional; the box derives the backup read connection from its own owner connection when unset" with a one-line pointer to this change.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @waitron/server test:coverage && pnpm typecheck`
```bash
git add -A && git commit -s -m "feat(backup-config): wall-clock schedule + age retention + optional (derived) DB url"
```

---

## Task 3: wall-clock scheduler + dual-retention prune in the sweep

**Files:**
- Create: `apps/server/src/backup-schedule.ts` (pure next-fire math + jitter)
- Test: `apps/server/src/backup-schedule.test.ts`
- Modify: `apps/server/src/backup-sweep.ts` (`BackupSweepDeps`, the loop, `pruneBackend`)
- Test: `apps/server/src/backup-sweep.test.ts` (extend the DI unit tests)

**Interfaces:**
- Produces:
```ts
// backup-schedule.ts
export interface ScheduleClock { timeZone: string; dayCutover: string; } // dayCutover "HH:MM"
export function nextFireMs(
  schedule: BackupSchedule, clock: ScheduleClock, now: Date, jitterSeed: string,
): number;                                         // absolute epoch ms of the next fire
export const AUTO_MARGIN_MINUTES = 30;
export const MAX_SLEEP_MS = 60 * 60 * 1000;        // 1h cap, recompute
```
- `BackupSweepDeps` changes: remove `intervalMs`; add `schedule: BackupSchedule`, `retainDays: number`, `jitterSeed: string`, `readClock: () => Promise<ScheduleClock>` (wall-clock only), and `onDump?: () => void` (called after a successful fan-out — the supervisor uses it to flip `archiveUnderCurrentKey`, Task 4/I7).
- `pruneBackend(backend, retain, retainDays, nowMs)` — age is measured off the artifact's OWN timestamp parsed from its key (clock-jump-safe, spec §3.3), NOT the filesystem `mtimeMs`. Add `backupArchiveTimestamp(key: string): Date` to `pg-dump.ts` as the inverse of `backupArchiveKey`'s stamp (the `basicIsoStamp` format at `pg-dump.ts:69-87`), with its own unit test round-tripping `backupArchiveTimestamp(backupArchiveKey(d))`.

- [ ] **Step 1: Failing tests — next-fire math (pure, no DB)**

Create `apps/server/src/backup-schedule.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { nextFireMs, AUTO_MARGIN_MINUTES } from "./backup-schedule.js";

const MADRID = { timeZone: "Europe/Madrid", dayCutover: "05:00" };

it("interval mode fires now+ms", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  expect(nextFireMs({ kind: "interval", ms: 3600000 }, MADRID, now, "n1"))
    .toBe(now.getTime() + 3600000);
});

it("daily fixed time picks the next local occurrence", () => {
  // 03:00 local, now is 04:00 local (already past) → tomorrow 03:00 local
  const now = new Date("2026-09-09T02:00:00Z"); // 04:00 Madrid (CEST, +2)
  const fire = new Date(nextFireMs({ kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } }, MADRID, now, "n1"));
  expect(fire.toISOString()).toBe("2026-09-10T01:00:00.000Z"); // 03:00 Madrid next day
});

it("weekday subset skips to the next allowed day", () => {
  const now = new Date("2026-09-09T00:00:00Z"); // Wed
  // days = [1,5] (Mon, Fri) at 02:00 local → next is Fri
  const fire = new Date(nextFireMs({ kind: "wall-clock", days: [1, 5], at: { hour: 2, minute: 0 } }, MADRID, now, "n1"));
  expect(fire.getUTCDay()).toBe(5); // Friday (00:00Z happens to be Fri here — assert the local weekday instead in impl)
});

it("auto resolves to dayCutover + margin, jittered and node-stable", () => {
  const now = new Date("2026-09-09T00:00:00Z");
  const a = nextFireMs({ kind: "wall-clock", days: "daily", at: "auto" }, MADRID, now, "node-A");
  const b = nextFireMs({ kind: "wall-clock", days: "daily", at: "auto" }, MADRID, now, "node-A");
  expect(a).toBe(b); // stable for the same seed
  // fires at ~ 05:00 + 30min local, within a small jitter window
});

it("a fixed time > MAX_SLEEP away is still returned as one absolute instant", () => {
  const now = new Date("2026-09-09T02:00:00Z");
  const fire = nextFireMs({ kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } }, MADRID, now, "n1");
  expect(fire).toBeGreaterThan(now.getTime());
});
```
(Refine the exact expected ISO strings when implementing against the real `Intl` output; the point is next-local-occurrence, weekday skip, auto=cutover+margin, and stable jitter.)

- [ ] **Step 2: Run — fails (module missing)**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-schedule.test.ts`
Expected: FAIL — `backup-schedule.js` not found.

- [ ] **Step 3: Implement `backup-schedule.ts`**

```ts
import { createHash } from "node:crypto";
import type { BackupSchedule } from "./backup-config.js";

export interface ScheduleClock { timeZone: string; dayCutover: string; }
export const AUTO_MARGIN_MINUTES = 30;
export const MAX_SLEEP_MS = 60 * 60 * 1000;
const AUTO_JITTER_MINUTES = 10;

/** Local wall-clock parts of an instant in a tz, via Intl (no tz dependency). */
function localParts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday as string]!;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: wd };
}

/** The epoch ms of a given local Y-M-D H:M in tz. Resolves by fixed-point over the tz offset. */
function instantOfLocal(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  // Start from the UTC guess, then correct by the offset the tz reports at that guess.
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    guess += (Date.UTC(year, month - 1, day, hour, minute, 0) - actual);
  }
  return guess;
}

function jitterMinutes(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return h[0] % (AUTO_JITTER_MINUTES + 1); // 0..10, stable per seed
}

export function nextFireMs(schedule: BackupSchedule, clock: ScheduleClock, now: Date, jitterSeed: string): number {
  if (schedule.kind === "interval") return now.getTime() + schedule.ms;

  let hour: number, minute: number;
  if (schedule.at === "auto") {
    const [ch, cm] = clock.dayCutover.split(":").map(Number);
    const total = ch * 60 + cm + AUTO_MARGIN_MINUTES + jitterMinutes(jitterSeed);
    hour = Math.floor(total / 60) % 24; minute = total % 60;
  } else { hour = schedule.at.hour; minute = schedule.at.minute; }

  const allowed = (wd: number) => schedule.days === "daily" || schedule.days.includes(wd);
  // scan today..+7 for the next allowed local day whose fire instant is strictly in the future
  for (let add = 0; add <= 7; add++) {
    const base = localParts(new Date(now.getTime() + add * 86400000), clock.timeZone);
    if (!allowed(base.weekday)) continue;
    const fire = instantOfLocal(base.year, base.month, base.day, hour, minute, clock.timeZone);
    if (fire > now.getTime()) return fire;
  }
  // fallback: 24h out (defensive; the 7-day scan should always find one)
  return now.getTime() + 86400000;
}
```
Fix the test's exact ISO expectations against this implementation's output (run it, read the values, pin them).

- [ ] **Step 4: Run — passes**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-schedule.test.ts`
Expected: PASS. Add a DST-boundary case (e.g. the Madrid spring-forward night) and assert no fire lands in the skipped hour.

- [ ] **Step 5: Failing test — sweep loop uses the schedule + dual-retention prune + abort-is-cancellation**

In `apps/server/src/backup-sweep.test.ts`, add (using the existing DI pattern with `vi.fn` sleep/runDump and a fake backend recording `delete`d keys):
```ts
it("prunes by count AND age, whichever bites first", async () => {
  // backend.list returns 5 objects newest-first; retain=3, retainDays=1
  // objects 3,4 exceed count; object 2 is 2 days old → also pruned
  // assert delete called for keys of index >=3 UNION age>1d
});

it("an aborted sleep ends the loop without logging backup.failed", async () => {
  const signal = AbortSignal.abort();
  const log = vi.fn();
  await runBackupSweep({ /* ...deps..., */ signal });
  expect(log).not.toHaveBeenCalledWith("warn", "backup.failed", expect.anything());
});

it("takes one dump immediately on start, then waits for the next fire", async () => {
  const runDump = vi.fn(); const sleep = vi.fn().mockResolvedValue(undefined);
  // abort after first tick via a controller the fake sleep triggers
  // assert runDump called once before any nextFire wait resolves
});
```

- [ ] **Step 6: Run — fails**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement the loop + prune changes**

`BackupSweepDeps`: remove `intervalMs`; add `schedule: BackupSchedule`, `retainDays: number`, `jitterSeed: string`, `readClock: () => Promise<ScheduleClock>`, `onDump?: () => void`. Thin the stale file-header comment (`backup-sweep.ts:1-9`, "sleeps `intervalMs`…") to describe the wall-clock loop (CLAUDE.md §1: a behaviour change retires the receipt). In `runOnce`, after the fan-out completes successfully, call `deps.onDump?.()`. Rework the loop:
```ts
export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  if (deps.signal.aborted) return;   // don't fire a dump into a shutdown (M15)
  // Immediate first dump on start (enable/rotate/boot) — preserves today's "runOnce first".
  await tick(deps);
  while (!deps.signal.aborted) {
    const clock = deps.schedule.kind === "wall-clock" ? await deps.readClock() : { timeZone: "UTC", dayCutover: "00:00" };
    const fireAt = nextFireMs(deps.schedule, clock, now(), deps.jitterSeed);
    // Sleep in <=1h chunks, recomputing, so a clock/tz/cutover change is picked up.
    while (!deps.signal.aborted && now().getTime() < fireAt) {
      const chunk = Math.min(MAX_SLEEP_MS, fireAt - now().getTime());
      await deps.sleep(chunk, deps.signal);
    }
    if (deps.signal.aborted) break;
    await tick(deps);
  }
}

async function tick(deps: BackupSweepDeps): Promise<void> {
  try {
    await runOnce(deps);
  } catch (err) {
    if (deps.signal.aborted) return;        // an abort mid-tick is a cancellation, not a failure
    deps.log("warn", "backup.failed", { errorCode: codeOf(err) });
  }
}
```
`pruneBackend` gains age:
```ts
async function pruneBackend(backend: StorageBackend, retain: number, retainDays: number, nowMs: number): Promise<void> {
  const objects = await backend.list(BACKUP_KEY_PREFIX); // newest-first
  const maxAgeMs = retainDays * 24 * 60 * 60 * 1000;
  const toDelete = objects.filter(
    (obj, i) => i >= retain || (nowMs - backupArchiveTimestamp(obj.key).getTime()) > maxAgeMs,
  );
  await Promise.all(toDelete.map((obj) => backend.delete(obj.key)));
}
```
Age is read from the key's own embedded stamp (`backupArchiveTimestamp`, new in `pg-dump.ts`), NOT `obj.mtimeMs` — the stamp is the immutable dump time, so a later clock change cannot resurrect a pruned window (spec §3.3). Update the call site (`backup-sweep.ts:170`) to pass `deps.retainDays` and `(deps.now ?? (() => new Date()))().getTime()`. `runOnce`'s `Omit` type now omits `"schedule" | "sleep" | "jitterSeed" | "readClock"` too. Add a `pruneBackend` unit test with a fake backend whose object keys carry stamps 0 / 2 / 10 days old and assert both caps (a within-count but too-old object IS pruned).

- [ ] **Step 8: Run — passes**

Run: `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts src/backup-schedule.test.ts`
Expected: PASS.

- [ ] **Step 9: Verify + commit**

Run: `pnpm --filter @waitron/server test:coverage && pnpm typecheck`
```bash
git add -A && git commit -s -m "feat(backup): wall-clock scheduler + dual (count/age) retention; abort mid-tick is a cancellation"
```

---

## Task 4: `BackupSupervisor` — the hot-reload lifecycle owner

**Files:**
- Create: `apps/server/src/backup-supervisor.ts`
- Test: `apps/server/src/backup-supervisor.pg.test.ts` (real Postgres)
- Modify: `apps/server/src/boot.ts` (replace the inline block ~1625-1692 + the box-status `readBackup` wiring with the supervisor)

**Interfaces:**
- Produces:
```ts
export interface BackupRuntimeStatus {           // SYNC, config-derived only (no I/O)
  enabled: boolean;
  isPrimary: boolean;                     // readSingletonRole() === "primary" (I5)
  managedByEnvironment: boolean;
  destinations: { id: string; dir: string }[];
  schedule: BackupSchedule | undefined;
  retention: { count: number; days: number } | undefined;
  keyFingerprint: string | undefined;    // short hash prefix — NEVER the key
  keyRotatedAt: string | undefined;
  recoveryKey: string | undefined;        // effective running key (for GET recovery-key; never logged)
}
export interface BackupSupervisorDeps {
  // Re-reads the box-env files from DISK each reload (B2) — closing over a boot-time value would
  // make hot-reload a no-op. ASYNC because it merges files off disk.
  buildConfig: () => Promise<BackupConfig | undefined>;   // async () => loadBackupConfig(await loadBoxEnv(base, stateDir))
  isManagedByEnvironment: () => boolean;            // any WAITRON_BACKUP_* non-empty in the RAW base env
  readSingletonRole: () => SingletonRole;           // holders.singletonRole.current (read live each reload/status)
  adminDatabaseUrl: string;                         // fallback backup read connection (the OWNER connection)
  modules: readonly WaitronModule[];
  environment: DeploymentEnvironment;
  stateDir: string; mediaDir: string; jitterSeed: string;
  readClock: () => Promise<ScheduleClock>;          // tenant-scoped tz/dayCutover
  log: Logger;
  openDb?: (url: string) => Promise<Database>;      // default createPostgresDb (DI for tests)
  now?: () => Date; sleep?: (ms: number, s: AbortSignal) => Promise<void>; runDump?: PgDumpRunner;
}
export class BackupSupervisor {
  constructor(deps: BackupSupervisorDeps);
  reload(): Promise<void>;          // latched; stop→close→awaited buildConfig→derive→probe→immediate dump→loop
  current(): BackupRuntimeStatus;   // SYNC config-derived snapshot (routes + status shell)
  status(): Promise<BackupRuntimeStatus & { backupStatus: BackupStatus; archiveUnderCurrentKey: boolean }>;  // current() + live readBackupStatus freshness (B3); archiveUnderCurrentKey derived (below)
  stop(): Promise<void>;
}
export function keyFingerprint(key: string): string; // e.g. sha256(key).hex().slice(0,8)
```

- [ ] **Step 1: Failing test — reload lifecycle on real Postgres**

Create `apps/server/src/backup-supervisor.pg.test.ts`. **Point `adminDatabaseUrl` at the migrator/owner role, NOT the container superuser** (CLAUDE.md §4: a superuser hides grant gaps, and the design's whole point is the derived OWNER connection can read the fiscal sources). Use the template suite's migrator connection string; assert the probe passes as that role.
```ts
import { describe, expect, it, vi } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
// build a supervisor whose buildConfig (async) returns a local-fs dest in a tmpdir + a strong key,
// and whose adminDatabaseUrl is the MIGRATOR (owner) role connection, not a superuser.

const suite = useTemplateDb({ template: "manifest" });

it("enable from off writes an archive and reports enabled", async () => { /* reload(); poll dest dir has one artifact; current().enabled true; keyFingerprint set; (await status()).archiveUnderCurrentKey true */ });
it("change destination closes the old pool and writes to the new dir", async () => { /* reload with dest A, reload with dest B; A stops, B receives */ });
it("rotate takes an immediate dump under the new key and updates the fingerprint", async () => { /* enable K1, reload K2; a new artifact exists that decrypts under K2, keyFingerprint changed, (await status()).archiveUnderCurrentKey true */ });
it("archiveUnderCurrentKey is false when every destination fails", async () => { /* dest dir made unwritable (or a failing backend); reload; the tick's fan-out fails; (await status()).archiveUnderCurrentKey stays FALSE — the Task 3 carry: onDump-style flag would have lied here */ });
it("a non-primary node runs no duty", async () => { /* readSingletonRole → 'secondary'; reload; current().enabled false, no artifact */ });
it("removing the probe lets a bad connection through (prove-by-deletion)", async () => { /* skipped/inverted control per CLAUDE.md §4 */ });
```

- [ ] **Step 2: Run — fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/backup-supervisor.pg.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `backup-supervisor.ts`**

```ts
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createPostgresDb, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import { runBackupSweep } from "./backup-sweep.js";
import { readBackupStatus } from "./backup-status.js";
import { buildBackend } from "./local-fs-backend.js";
import { realSleep } from "./loop.js";
import { realPgDump } from "./pg-dump.js";
import "./errors.js";

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export class BackupSupervisor {
  #deps: BackupSupervisorDeps;
  #controller: AbortController | undefined;
  #worker: Promise<void> | undefined;
  #db: Database | undefined;
  #config: BackupConfig | undefined;
  #reloading = false;
  #reloadedAt: Date | undefined;

  constructor(deps: BackupSupervisorDeps) { this.#deps = deps; }

  async reload(): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    try {
      await this.#teardown();
      const cfg = await this.#deps.buildConfig();   // re-read from DISK each reload (B2)
      this.#config = cfg;
      this.#reloadedAt = (this.#deps.now ?? (() => new Date()))();   // for archiveUnderCurrentKey (below)
      if (cfg === undefined || this.#deps.readSingletonRole() !== "primary") {
        this.#deps.log("info", "backup.disabled", {});
        return;   // #config kept for current(): enabled=(cfg!==undefined && isPrimary), so a non-primary reads disabled
      }
      const url = cfg.databaseUrl ?? this.#deps.adminDatabaseUrl;
      const openDb = this.#deps.openDb ?? createPostgresDb;
      const db = await openDb(url);
      try {
        await assertBackupCanReadFiscal(db);
      } catch (err) {
        await db.close().catch(() => {});
        this.#deps.log("error", "backup.disabled_probe_failed", { errorCode: codeOf(err) });
        this.#config = undefined;
        return;
      }
      this.#db = db;
      const controller = new AbortController();
      this.#controller = controller;
      const backends = cfg.destinations.map(buildBackend);
      this.#worker = runBackupSweep({
        backends, db, modules: this.#deps.modules, environment: this.#deps.environment,
        resolvers: { media: this.#deps.mediaDir }, stateDir: this.#deps.stateDir,
        stagingDir: join(this.#deps.stateDir, "backup-staging"),
        databaseUrl: url, recoveryKey: cfg.recoveryKey,
        schedule: cfg.schedule, retain: cfg.retain, retainDays: cfg.retainDays,
        jitterSeed: this.#deps.jitterSeed, readClock: this.#deps.readClock,
        signal: controller.signal, sleep: this.#deps.sleep ?? realSleep,
        runDump: this.#deps.runDump ?? realPgDump, now: this.#deps.now, log: this.#deps.log,
        onDump: () => { this.#firstDumpDone = true; },   // add a tiny hook in the sweep OR track via status read
      });
      this.#worker.catch((err) => this.#deps.log("error", "backup.worker_rejected", { errorCode: codeOf(err) }));
    } finally {
      this.#reloading = false;
    }
  }

  current(): BackupRuntimeStatus {
    const cfg = this.#config;
    const isPrimary = this.#deps.readSingletonRole() === "primary";
    return {
      enabled: cfg !== undefined && isPrimary && this.#db !== undefined,
      isPrimary,
      managedByEnvironment: this.#deps.isManagedByEnvironment(),
      destinations: cfg?.destinations.map((d) => ({ id: d.id, dir: d.dir })) ?? [],
      schedule: cfg?.schedule,
      retention: cfg === undefined ? undefined : { count: cfg.retain, days: cfg.retainDays },
      keyFingerprint: cfg === undefined ? undefined : keyFingerprint(cfg.recoveryKey),
      keyRotatedAt: cfg?.keyRotatedAt,
      recoveryKey: cfg?.recoveryKey,
    };
  }
  async status(): Promise<BackupRuntimeStatus & { backupStatus: BackupStatus; archiveUnderCurrentKey: boolean }> {
    const base = this.current();
    const cfg = this.#config;
    const now = (this.#deps.now ?? (() => new Date()))();
    const backends = cfg?.destinations.map(buildBackend) ?? [];
    const backupStatus = await readBackupStatus(backends, cfg?.staleAfterMs ?? 0, now);
    // Truthful: an archive exists under the CURRENT key iff a destination stored one at/after the
    // last reload (which is when the current key/config took effect). Never true on all-failed.
    const since = this.#reloadedAt?.getTime() ?? Infinity;
    const archiveUnderCurrentKey =
      backupStatus.configured &&
      backupStatus.destinations.some((d) => d.lastBackupAt !== null && Date.parse(d.lastBackupAt) >= since);
    return { ...base, backupStatus, archiveUnderCurrentKey };
  }
  async stop(): Promise<void> { await this.#teardown(); }
  async #teardown(): Promise<void> {
    this.#controller?.abort();
    if (this.#worker !== undefined) await this.#worker.catch(() => {});
    if (this.#db !== undefined) await this.#db.close().catch(() => {});
    this.#controller = undefined; this.#worker = undefined; this.#db = undefined;
  }
}
```
**`archiveUnderCurrentKey` is DERIVED truthfully, not flagged.** Task 3's `onDump` fires after the fan-out even when every destination FAILED (`allSettled` swallows per-backend faults), so a flag set off it would claim an archive exists when nothing was stored (Task 3 review carry). Instead: record `#reloadedAt = now()` when `reload()` starts a duty, and compute `archiveUnderCurrentKey` in the async `status()` from the freshness read — `true` iff some destination's `lastBackupAt` is at/after `#reloadedAt` (an archive was actually STORED under the current key). This reflects real stored state, survives a restart, and cannot lie on an all-destinations-failed tick. Because the flag needs the (async) `readBackupStatus`, it lives on `status()`'s return, not sync `current()`. **`onDump` is now unused by the supervisor** — if nothing else uses it, remove `onDump` from `BackupSweepDeps`, its call in `runOnce`, and its Task 3 test (do not leave a dead hook; CLAUDE.md §1/YAGNI). Register `"backup.reload_in_progress": Record<string, never>` in `errors.ts`. `status()` rebuilds the backends to read freshness; that is cheap (`buildBackend` is a constructor over a path) and keeps `current()` synchronous and I/O-free.

- [ ] **Step 4: Run — passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/backup-supervisor.pg.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire boot to use the supervisor**

**First, thread the raw base env into boot (I4).** Today `startServer(env)` gets only the merged env (`node-entry.ts:288-297`), which cannot tell a file-sourced value from an env-sourced one — but key-presence provenance (spec §3.2 Blocker 2) needs the RAW base. Add an optional second parameter `startServer(env, base?: NodeJS.ProcessEnv)` and pass `deps.baseEnv` from node-entry. Boot uses `base` for BOTH provenance and the on-disk re-read below. **Reconcile the existing boot tests** that inject `WAITRON_BACKUP_*` via the merged `env` arg (`boot.test.ts:1938`, `boot.singleton.test.ts:224`): pass those vars via the new `base` param instead (so the disk re-read sees them), or write a `backup.env` fixture into the test state dir. The `:1938` test awaiting `backup.disabled_probe_failed` survives because Task 2 keeps an explicitly-set `WAITRON_BACKUP_DATABASE_URL` honoured.

Then replace the inline block (~1625-1692) with:
```ts
const backupSupervisor = new BackupSupervisor({
  buildConfig: async () => loadBackupConfig(await loadBoxEnv(base, config.stateDir)),  // re-read from DISK each reload (B2)
  isManagedByEnvironment: () => BACKUP_ENV_KEYS.some((k) => !isUnset(base[k])),         // RAW base, not merged (I4)
  readSingletonRole: () => holders.singletonRole.current,
  adminDatabaseUrl: config.adminDatabaseUrl,
  modules: ALL_MODULES, environment: config.environment,
  stateDir: config.stateDir, mediaDir: config.mediaDir, jitterSeed: till.nodeId,
  readClock: () => withTenant(db, till.tenantId, async (tx) => { await asAppUser(tx); return resolveVenueClock(tx, till.tenantId, till.nodeId); }),
  log,
});
await backupSupervisor.reload();
```
Define `BACKUP_ENV_KEYS = ["WAITRON_BACKUP_DIR","WAITRON_BACKUP_DESTINATIONS","WAITRON_BACKUP_DATABASE_URL","WAITRON_BACKUP_RECOVERY_KEY","WAITRON_BACKUP_SCHEDULE_DAYS","WAITRON_BACKUP_AT","WAITRON_BACKUP_INTERVAL_MS","WAITRON_BACKUP_RETAIN","WAITRON_BACKUP_RETAIN_DAYS"]`. For the clock, **export and reuse `resolveVenueClock(tx, tenantId, nodeId)`** (`report-api.ts:112-133` — currently NOT exported; export it; it is tenant-scoped and keyed by `nodes.id` joined to `locations`, returning `{ timeZone, dayCutover }`, exactly `ScheduleClock`). Wire box-status to the async freshness reader: `readBackup: () => backupSupervisor.status().then((s) => s.backupStatus)` (B3 — `readBackup` is already `() => Promise<BackupStatus>` at `box-status.ts:216`). Register `await backupSupervisor.stop()` in the existing shutdown path beside the other teardowns.

- [ ] **Step 6: Run the server boot/e2e suites unfiltered (a value more than one suite asserts)**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS. Fix any boot test that asserted the old inline `backup.disabled` path.

- [ ] **Step 7: Verify + commit**

Run: `pnpm typecheck`
```bash
git add -A && git commit -s -m "feat(backup): BackupSupervisor owns the duty lifecycle; boot reloads through it"
```

---

## Task 5: capture `backup.env` + `modules.json` (sweep-only collector)

**Files:**
- Create: `apps/server/src/backup-optional-state.ts` (`collectOptionalStateFiles`)
- Test: `apps/server/src/backup-optional-state.test.ts`
- Modify: `apps/server/src/backup-sweep.ts` (merge the optional entries into the archive)
- Test: `apps/server/src/restore.pg.test.ts` (or the nearest restore round-trip suite) — round-trip both files; `skipSecrets` restores neither

**Interfaces:**
- Produces: `collectOptionalStateFiles(stateDir: string, names: readonly string[]): Promise<Record<string, string>>` — reads each name if present, silently skips ENOENT. `export const OPTIONAL_BACKUP_STATE = ["backup.env", "modules.json"] as const;`
- These are packed as `secrets/<name>` entries (so the existing restore applies them), but produced by a **sweep-only** collector — NOT added to `collectStateSecrets`/`RECOVERY_FILES`, so the operator recovery-bundle download is unchanged.

- [ ] **Step 1: Failing test — optional collector skips absent files**

```ts
it("collects present optional files and skips absent ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opt-"));
  await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
  const out = await collectOptionalStateFiles(dir, ["backup.env", "modules.json"]);
  expect(out).toEqual({ "backup.env": "WAITRON_BACKUP_DIR=/mnt/usb\n" }); // modules.json absent → skipped
});
```

- [ ] **Step 2: Run — fails.** `pnpm --filter @waitron/server exec vitest run src/backup-optional-state.test.ts` → FAIL.

- [ ] **Step 3: Implement `backup-optional-state.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const OPTIONAL_BACKUP_STATE = ["backup.env", "modules.json"] as const;
export async function collectOptionalStateFiles(stateDir: string, names: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    try { out[name] = await readFile(join(stateDir, name), "utf8"); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  }
  return out;
}
```

- [ ] **Step 4: Wire into the sweep's archive entries**

In `runOnce` (`backup-sweep.ts` ~128-158), after `collectStateSecrets`, also `collectOptionalStateFiles(deps.stateDir, OPTIONAL_BACKUP_STATE)` (concurrently in the `Promise.all`) and append them as `secrets/<name>` entries beside the existing secrets. Add a DI seam if the tests need it, else read directly.

- [ ] **Step 5: Run — the sweep unit test still packs + a real-PG restore round-trip**

Add to the restore round-trip suite: pack an archive with `backup.env` + `modules.json` present, restore into a **fresh** state dir (with a different `instance.env` so per-hardware safety is exercised), assert both files land; then a `skipSecrets: true` restore lands neither. Add a test that a restore MISSING `modules.json` (all modules enabled) fails boot with `module.fiscal_slot_ambiguous` (assert via `resolveFiscalSlot`/boot path).

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/backup-optional-state.test.ts src/restore.pg.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @waitron/server test:coverage && pnpm typecheck`
```bash
git add -A && git commit -s -m "feat(backup): capture backup.env + modules.json (sweep-only; recovery bundle unchanged)"
```

---

## Task 6: `mountBackupApi` — the authenticated routes

**Files:**
- Create: `apps/server/src/backup-api.ts`
- Test: `apps/server/src/backup-api.route.test.ts` (real-PG, `login` helper like `box-status.route.test.ts`)
- Modify: `apps/server/src/errors.ts` (`backup.managed_by_environment`, `backup.not_primary`, `backup.recovery_key_unstorable`, `backup.destination_failed` if not already, `backup.effective_mismatch`)
- Modify: `apps/server/src/boot.ts` (register `mountBackupApi`)
- Create/Modify: `apps/server/src/backup-env-writer.ts` (`writeBackupEnv`) + test

**Interfaces:**
- Consumes: `BackupSupervisor` (Task 4), `writeFileAtomic`, `formatEnvFile`/`parseEnvFile`, `authorizeManager`/`requireManagementSession`, `createErrorBoundary`.
- Produces: `mountBackupApi(app: Hono, deps: BackupApiDeps, log: Logger): void`, where
```ts
export interface BackupApiDeps {
  supervisor: BackupSupervisor;
  db: Database;
  cfg: { tenantId: string };
  stateDir: string;
}
export function assertStorableKey(key: string): void; // throws backup.recovery_key_unstorable
```
- Routes (all under the management-session + `till.configure` gate, mirroring `recovery-bundle-api.ts`):
  - `GET /api/backup/status` → `current()` projected (no `recoveryKey` field).
  - `POST /api/backup/mint-key` → `{ key }` (32 bytes base64url via `randomBytes(32).toString("base64url")`).
  - `POST /api/backup/apply` → body `{ destinationDir, recoveryKey, schedule, retention }`.
  - `GET /api/backup/recovery-key` → `{ key }` from `current().recoveryKey`; body never logged.
  - `POST /api/backup/rotate` → body `{ recoveryKey }`.

- [ ] **Step 1: Register error codes** in `errors.ts`: `"backup.managed_by_environment": Record<string, never>`, `"backup.not_primary": Record<string, never>`, `"backup.recovery_key_unstorable": { reason: string }`, `"backup.effective_mismatch": Record<string, never>`, and `"backup.request_invalid": { field: string }`. Do NOT register `backup.destination_failed` as a thrown code — it is a per-destination **status** signal derived from `readBackupStatus` (`DestinationStatus.stale`/`lastBackupAt`), surfaced in the status projection, not an `AppError` (M14; spec §5 wording "surfaced in status").

- [ ] **Step 2: Failing test — the passphrase round-trip guard (pure)**

Create `apps/server/src/backup-env-writer.test.ts`:
```ts
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { assertStorableKey } from "./backup-api.js";
it.each(["needs a space ", "has\nnewline", "tab\tthere", " leading"])("rejects %j", (k) => {
  expect(() => assertStorableKey(k)).toThrow(/recovery_key_unstorable/);
});
it("accepts a base64url key and round-trips", () => {
  const k = "abcDEF-_1234567890";
  expect(() => assertStorableKey(k)).not.toThrow();
  expect(parseEnvFile(formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: k })).WAITRON_BACKUP_RECOVERY_KEY).toBe(k);
});
```

- [ ] **Step 3: Run — fails.** → FAIL (module missing).

- [ ] **Step 4: Implement `assertStorableKey` + `writeBackupEnv`**

```ts
export function assertStorableKey(key: string): void {
  if (/[\r\n\t]/.test(key) || /[\x00-\x1f]/.test(key) || key.trim() !== key) {
    throw new AppError("backup.recovery_key_unstorable", { reason: "whitespace_or_control" });
  }
  // defensive: the value must survive the env-file round-trip byte-for-byte
  if (parseEnvFile(formatEnvFile({ K: key })).K !== key) {
    throw new AppError("backup.recovery_key_unstorable", { reason: "round_trip" });
  }
}
```
`backup-env-writer.ts`: `writeBackupEnv(stateDir, { destinationDir, recoveryKey, schedule, retention, keyRotatedAt })` → `writeFileAtomic(join(stateDir, "backup.env"), formatEnvFile({ WAITRON_BACKUP_DIR: destinationDir, WAITRON_BACKUP_RECOVERY_KEY: recoveryKey, WAITRON_BACKUP_SCHEDULE_DAYS: ..., WAITRON_BACKUP_AT: ..., WAITRON_BACKUP_RETAIN: ..., WAITRON_BACKUP_RETAIN_DAYS: ..., WAITRON_BACKUP_KEY_ROTATED_AT: ... }), 0o600)`. Never write `WAITRON_BACKUP_DATABASE_URL`.

- [ ] **Step 5: Failing test — routes (real-PG, login cookie)**

Create `apps/server/src/backup-api.route.test.ts` modelled on `box-status.route.test.ts` (`buildApp` mounts `mountManagementApi` + `mountBackupApi`; `login()` returns the cookie). Cases:
```ts
it("mint-key returns a strong key and stores nothing", async () => { /* POST /api/backup/mint-key; body.key length; status still off */ });
it("apply enables backups and hot-reloads (no restart)", async () => { /* apply {dir, key, schedule, retention}; GET status enabled, keyFingerprint set, archiveUnderCurrentKey true after a tick */ });
it("apply refuses a non-storable key", async () => { /* key with trailing space → 400 recovery_key_unstorable */ });
it("apply refuses when the env owns the config", async () => { /* supervisor.current().managedByEnvironment true → 409 managed_by_environment */ });
it("apply refuses on a non-primary node", async () => { /* readSingletonRole secondary → 409 not_primary */ });
it("recovery-key returns the EFFECTIVE key, not the file, under a partial env override", async () => {
  // env injects K1, file holds K2; GET recovery-key returns K1; rotate cannot orphan
});
it("rotate takes an immediate dump under the new key and bumps keyRotatedAt", async () => {});
it("unauthenticated requests 401", async () => {});
```

- [ ] **Step 6: Run — fails.** → FAIL.

- [ ] **Step 7: Implement `mountBackupApi`**

Mirror `recovery-bundle-api.ts`'s gate. Sketch:
```ts
export function mountBackupApi(app: Hono, deps: BackupApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "backup-api.failed");
  const authorize = (c: Context) => {
    const sessionId = requireManagementSession(c);
    return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "till.configure" });
    });
  };
  const guardWritable = () => {
    const s = deps.supervisor.current();   // sync snapshot; reads live singleton role
    if (s.managedByEnvironment) throw new AppError("backup.managed_by_environment", {});
    if (!s.isPrimary) throw new AppError("backup.not_primary", {});   // I5: refuse BEFORE writeBackupEnv
  };

  app.get("/api/backup/status", (c) => run(c, log, async () => { await authorize(c); return c.json(projectStatus(await deps.supervisor.status())); }));

  app.post("/api/backup/mint-key", (c) => run(c, log, async () => { await authorize(c); return c.json({ key: randomBytes(32).toString("base64url") }); }));

  app.post("/api/backup/apply", (c) => run(c, log, async () => {
    await authorize(c); guardWritable();
    const body = await readApplyBody(c);            // validate shape → backup.request_invalid
    assertStorableKey(body.recoveryKey);
    // dry-validate via loadBackupConfig over a synthetic env so route rejects exactly what boot rejects
    await writeBackupEnv(deps.stateDir, body);
    await deps.supervisor.reload();
    const s = deps.supervisor.current();
    if (s.recoveryKey !== body.recoveryKey) throw new AppError("backup.effective_mismatch", {});
    return c.json(projectStatus(s));
  }));

  app.get("/api/backup/recovery-key", (c) => run(c, log, async () => { await authorize(c); const s = deps.supervisor.current(); return c.json({ key: s.recoveryKey ?? null }); }));

  app.post("/api/backup/rotate", (c) => run(c, log, async () => {
    await authorize(c); guardWritable();
    const body = await readRotateBody(c); assertStorableKey(body.recoveryKey);
    // reuse current destination + schedule + retention; only the key + keyRotatedAt change
    const cur = deps.supervisor.current();
    await writeBackupEnv(deps.stateDir, { ...fromCurrent(cur), recoveryKey: body.recoveryKey, keyRotatedAt: new Date().toISOString() });
    await deps.supervisor.reload();
    const s = deps.supervisor.current();
    if (s.recoveryKey !== body.recoveryKey) throw new AppError("backup.effective_mismatch", {});
    return c.json(projectStatus(s));
  }));
}
```
`STATUS` map: `management_session.required/expired` → 401, `person.suspended`/`authorization.not_permitted` → 403, `backup.managed_by_environment`/`backup.not_primary` → 409, `backup.recovery_key_unstorable`/`recovery_key_too_short`/`destinations_invalid`/`schedule_invalid`/`request_invalid` → 400. `projectStatus` omits `recoveryKey`. `reload` throws `backup.not_primary` path is enforced by having `apply`/`rotate` check `deps.supervisor.current()`... — add a `readSingletonRole` check into `guardWritable` (thread it into `BackupApiDeps` or read it off `current()` which should expose `isPrimary`). Register the recovery-key route body in the never-log set (the boundary already logs only codes, not bodies — confirm no middleware logs the response).

- [ ] **Step 8: Register in boot**

`import { mountBackupApi } from "./backup-api.js";` at top; in body beside `mountRecoveryBundleApi`:
```ts
mountBackupApi(app, { supervisor: backupSupervisor, db, cfg: { tenantId: till.tenantId }, stateDir: config.stateDir }, log);
```

- [ ] **Step 8b: Harden `supervisor.stop()` vs a route-triggered `reload()` (Task 4 review carry)**

Until this task, `reload()` ran only once (boot, before `stop()` was wired into shutdown). Now `apply`/`rotate` call `reload()` on a live box, so a shutdown `stop()` can interleave with an in-flight `reload()` at an await point — and `stop()` currently bypasses the `#reloading` latch, so it could tear down a half-built duty that `reload()` then re-assigns, leaving a sweep running after `stop()` returned. In `backup-supervisor.ts`, give `stop()` a `#stopped` flag that `reload()` checks after each `await` (bail out + teardown if stopped), OR have `stop()` await an in-flight `reload()` before tearing down. Add a real-PG test: a `stop()` racing a `reload()` leaves NO running worker and NO open pool.

- [ ] **Step 9: Run — passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS. Then `pnpm typecheck`.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -s -m "feat(backup): authenticated backup admin routes (status/mint/apply/recovery-key/rotate) with env-provenance + passphrase + effective-key guards"
```

---

## Task 7: dashboard backup admin screens

**Files:**
- Create: `apps/dashboard/src/screens/backup-screen.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `apps/dashboard/src/api/client.ts` (add backup methods + response types)
- Modify: `apps/dashboard/src/dashboard-app.ts` (import, `CoreScreen`, `NAV_GROUPS` Configuration group `requiresManager: true`, `#renderScreen` case)
- Modify: `apps/dashboard/src/i18n/strings.ts` (en + es keys)

**Interfaces:**
- Consumes: the Task 6 routes.
- Produces on `DashboardApi`:
```ts
getBackupStatus(): Promise<BackupStatusView>;
mintBackupKey(): Promise<{ key: string }>;
applyBackup(body: BackupApplyBody): Promise<BackupStatusView>;
getBackupRecoveryKey(): Promise<{ key: string | null }>;
rotateBackupKey(body: { recoveryKey: string }): Promise<BackupStatusView>;
```
with local mirror types `BackupStatusView`, `BackupApplyBody` (do NOT import server barrels — bundle hygiene, `client.ts:6-17`).

- [ ] **Step 1: Failing screen test** — `backup-screen.test.ts` with `mountWidget<BackupScreen>("dashboard-backup-screen", { api: stubApi })`; assert: renders status; the destination + policy fields; the key step shows the minted key + copy + download link (`<a download>`) + the "saved it" checkbox that gates the apply button; the advanced paste toggle. Assert apply is disabled until the checkbox is ticked.

- [ ] **Step 2: Run — fails.** `pnpm --filter @waitron/dashboard exec vitest run src/screens/backup-screen.test.ts` → FAIL.

- [ ] **Step 3: Implement the screen** following `diagnostics-screen.ts`: `@customElement("dashboard-backup-screen")`, `@property({ attribute: false }) api!: DashboardApi`, `@state()` for the draft (destinationDir, key, savedItChecked, advancedPaste, schedule days/time, retention count/days), `errorKey`, and the loaded status. A short wizard flow within the card (steps or sections). The key file download uses a `Blob` + `URL.createObjectURL` on an `<a download="waitron-recovery-key-<node>-<ts>.txt">` (real download in a first-party app, unlike an artifact sandbox). Copy button uses `navigator.clipboard.writeText`. All copy via `t("backup.*")`. On apply: call `api.applyBackup(...)`, refresh status, surface `codeMessage(errorKey)` on failure. Add the `declare global` footer.

- [ ] **Step 4: Add the `DashboardApi` methods** in `client.ts` (mirror the diagnostics methods): each is `this.#request<T>("/api/backup/...", "GET"|"POST", body?)`.

- [ ] **Step 5: Register the screen** in `dashboard-app.ts`: side-effect import; add `"backup"` to `CoreScreen`; add `{ screen: "backup", labelKey: "nav.backup", requiresManager: true }` to the Configuration `NavGroup`; add the `#renderScreen` case returning `html`<dashboard-backup-screen .api=${this.api}></...>``.

- [ ] **Step 6: i18n** — add en + es keys together in `strings.ts` for every `t(...)` used (`nav.backup`, `backup.title`, `backup.destination.label/hint`, `backup.key.*`, `backup.schedule.*`, `backup.retention.*`, `backup.status.*`, `backup.savedIt`, `backup.apply`, `backup.rotate.warning`, ...). Register client-side error messages for the new `backup.*` codes via `registerCodeMessages`.

- [ ] **Step 7: a11y test** — `backup-screen.a11y.test.ts` with `describe.each(["light","dark"])` + `expectNoA11yViolations(host)` per the diagnostics a11y pattern.

- [ ] **Step 8: Run — passes**

Run: `pnpm --filter @waitron/dashboard test:coverage` (browser-mode; check memory headroom first per `CLAUDE.md` — `memory_pressure | grep free`).
Then `pnpm typecheck`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -s -m "feat(dashboard): backup admin screen (destination/key/policy/status) on the Configuration nav"
```

---

## Task 8: setup done-screen first-run nudge (demo-skip)

**Files:**
- Modify: `apps/setup/src/screens/done-screen.ts`
- Modify: `apps/setup/src/screens/done-screen.test.ts` (+ a11y if the card gains interactive content)
- Modify: `apps/setup/src/setup-app.ts` (pass a `devMode` flag to the done-screen if not already available)

**Interfaces:**
- Consumes: `SetupDoneScreen` gains `@property({ type: Boolean }) devMode = false`.
- The nudge is a link/button pointing at the dashboard's backup screen (e.g. `/dashboard#backup` or the app's route convention — confirm the dashboard route hash/path when implementing).

- [ ] **Step 1: Failing test** — in `done-screen.test.ts`:
```ts
it("shows a 'no backups yet' nudge with a link to backup setup", async () => {
  const el = mountWidget<SetupDoneScreen>("setup-done-screen", { api, devMode: false, ready: true });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=backup-nudge]")).not.toBeNull();
});
it("suppresses the nudge in demo mode", async () => {
  const el = mountWidget<SetupDoneScreen>("setup-done-screen", { api, devMode: true, ready: true });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=backup-nudge]")).toBeNull();
});
```

- [ ] **Step 2: Run — fails.** `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add to `done-screen.ts` `render()` a block gated on `!this.devMode`:
```ts
${this.devMode ? nothing : html`
  <div class="backup-nudge" data-test="backup-nudge">
    <p>${/* "Your box is trading — but it has no backups yet, so there is no way back from a disk failure." */}</p>
    <a class="nudge-link" href=${BACKUP_SETUP_URL}>Set up backups now</a>
  </div>`}
```
with a `css` fragment for `.backup-nudge`. Source `devMode` from the setup status/config already available to the shell and pass it through `#renderScreen` (`setup-app.ts`).

- [ ] **Step 4: Run — passes.** `pnpm --filter @waitron/setup test:coverage`. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "feat(setup): first-run backup nudge on the done screen (suppressed in demo mode)"
```

---

## Final verification (before finish-branch)

- [ ] `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` (the §2 gate; watch memory for the browser packages).
- [ ] Confirm `errors-reachable` and `classification-complete`/`append-only` guards pass (no new tables here, but the run confirms).
- [ ] Re-read the spec §12 checklist: every blocker/important has a landed test.

## Self-review notes (author)

- Spec coverage: §3.1 → T4; §3.2 (backup.env, provenance, capture, DB-url-derive) → T1/T2/T5/T6; §3.3 (schedule+retention) → T2/T3; §3.4 (routes) → T6; §3.5 (key mint/override/round-trip) → T6/T7; §3.6 (UI) → T7/T8; §5 codes → T2/T6; §7 tests → each task; §8 rotate → T6; Blocker 1 → T1; Blocker 2 → T4/T6; Blocker 3 → T6.
- Type consistency: `BackupSchedule`/`BackupConfig` defined in T2 and consumed unchanged in T3/T4; `BackupRuntimeStatus` defined in T4 (sync `current()`) with the async `status()` superset adding `backupStatus`, projected in T6, mirrored in T7.
- Open confirmation for the implementer (named, not a placeholder): the dashboard route path/hash for the nudge link (T8).
- **Fresh-context plan-vs-spec review (Opus, 2026-09-09) applied:** B1 (`backup.env` added to `loadBoxEnv`'s `FILES`, T1); B2 (`buildConfig` is async and re-reads from disk each reload, T4); B3 (sync `current()` + async `status()` for freshness, T4/T6); I4 (raw base env threaded via `startServer(env, base)`, existing boot tests reconciled, T4); I5 (`backup.not_primary` refused in `guardWritable` before any write, T6); I6 (export + reuse `resolveVenueClock`, not a non-existent helper/table, T4); I7 (`onDump` hook added in T3, consumed in T4); I8 (age from the archive-key stamp `backupArchiveTimestamp`, not fs `mtime`, T3); I9 (DB-url-required receipt sweep, T2); I10 (pg test pins the migrator/owner role, T4); M11 (`backup.request_invalid` registered, T6); M12 (sweep header comment thinned, T3); M13 (root guard regex-only, no cross-project import, T1); M14 (`destination_failed` is a status field, not a thrown code, T6); M15 (no dump fired into a pre-aborted signal, T3). Domain logic (config parsing, capture/restore, auth gate) was verified sound.
