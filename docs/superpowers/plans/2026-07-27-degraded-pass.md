# Degraded-pass cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a persistently-degraded pass legible from outside the process — bound the retry cadence for work only a human can unblock, bound the lifetime of each tenant's TLS connection pool, and deliver the pass duration and escalating anomaly line spec §9 already promises.

**Architecture:** Three independent changes. (1) `drain` and `runDue` stop reporting "due now" for a skipped tenant and instead fold `now + skipRetryMs` as a **minimum** against whatever the successful tenants computed. (2) `mtlsFetch` returns a closeable transport, `aeatClientResolver` is built per pass, and `boot.ts` closes every `Agent` in a `finally`. (3) `runPass` measures itself with an injected monotonic clock, and `recordPass` returns what it recorded so a `duty.degraded` line can be emitted where the failure count is actually known.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspace, vitest, Drizzle + PGlite for database-backed unit tests, undici, Hono.

## Global Constraints

- **Spec:** [`docs/superpowers/specs/2026-07-27-degraded-pass-design.md`](../specs/2026-07-27-degraded-pass-design.md). Read it before Task 1.
- **TDD is mandatory.** Every task writes a failing test first, runs it to see it fail for the right reason, then implements. Never write implementation before a red test.
- **Import specifiers end in `.js`** even for TypeScript sources (`./drain.js`, not `./drain`).
- **Branded ids**, never `as TenantId`. Use `tenantId as brandTenantId` from `@waitron/shared`.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** is required locally for real-Postgres suites. **No task in this plan needs one** — everything is PGlite or pure. Never commit that variable.
- **The pre-push hook runs the full workspace gates (~90s). Do not bypass it.**
- **A comment that no longer matches its code is a defect, not debt.** This plan changes four comments that currently justify the old behaviour; rewriting them is part of the task that changes the code, never a follow-up.
- Skip-retry default value, used in two places deliberately: `5 * 60 * 1000`.

---

## File Structure

**`packages/scheduler`**
- Modify `src/derive.ts` — `DEFAULTS` gains `skipRetryMs`.
- Modify `src/run.ts` — `SchedulerDeps.skipRetryMs`; the skip branch of `nextDueAt`; `TickResult.nextDueAt`'s doc comment.
- Modify `src/run.test.ts` — two rewritten tests, one rewritten comment, three new tests.

**`packages/fiscal-verifactu`**
- Modify `src/drain.ts` — `DEFAULT_SKIP_RETRY_MS`; `DrainDeps.skipRetryMs`; the fold; the skip comment.
- Modify `src/backend.ts` — `VerifactuBackendOptions.skipRetryMs?`; pass it through in `drain`.
- Modify `src/drain.tenancy.test.ts` — one rewritten test, new tests, `drain(` call sites.
- Modify `src/drain.concurrency.test.ts`, `src/drain.test.ts` — `drain(` call sites only if they call `drain` directly.

**`packages/fiscal`**
- Modify `src/backend.ts` — `DrainResult.nextDueAt`'s doc comment only.

**`apps/server`**
- Modify `src/config.ts` — `ServerConfig.skipRetryMs`, `WAITRON_SKIP_RETRY_MS`.
- Modify `src/aeat-transport.ts` — `mtlsFetch` returns `{ fetch, close }`; `aeatClientResolver` returns `{ resolve, closeAll }`.
- Modify `src/pass.ts` — `PassDeps.monotonicMs`, `DutyReport.durationMs`, `pass.complete.durationMs`.
- Modify `src/health.ts` — `DutyRecord`, `recordPass` return value, `logDegradedDuties`.
- Modify `src/boot.ts` — wire all of the above.
- Modify `src/config.test.ts`, `src/aeat-transport.test.ts`, `src/pass.test.ts`, `src/health.test.ts`, `src/boot.test.ts`.
- Modify `README.md` — the env-var table.

**`docs/superpowers/specs/2026-07-26-server-host-design.md`** — §9 amendments.

---

## Task 1: `@waitron/scheduler` — skip-retry cadence in `runDue`

**Files:**
- Modify: `packages/scheduler/src/derive.ts:108-114`
- Modify: `packages/scheduler/src/run.ts:17-25` (`SchedulerDeps`), `:53-62` (`TickResult.nextDueAt` doc), `:123-132` (the fold)
- Test: `packages/scheduler/src/run.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DEFAULTS.skipRetryMs: number` (value `5 * 60 * 1000`) and `SchedulerDeps.skipRetryMs: number` (required), both imported by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `packages/scheduler/src/run.test.ts`. Put `SKIP_RETRY_MS` next to the existing `NOW`/`HORIZON_START` constants at the top of the file:

```typescript
// Read from DEFAULTS rather than re-typed: a test that hardcodes 300000 keeps passing when the
// default changes and silently stops testing the default at all.
const SKIP_RETRY_MS = DEFAULTS.skipRetryMs;
const AFTER_SKIP_RETRY = new Date(NOW.getTime() + SKIP_RETRY_MS);
```

Then **rewrite** the two existing tests (do not add duplicates alongside them):

```typescript
  // An infrastructure failure has no ledger row to carry it — the claim is what would have created
  // one. Reporting it is the difference between "nothing was due" and "we never found out".
  it("reports a (tenant, duty) whose claim failed, rather than swallowing it", async () => {
    const duty = new FakeDuty();
    const missing = brandTenantId(randomUUID());
    const result = await runDue(deps([duty]), [missing], NOW);

    expect(result.ran).toEqual([]);
    expect(result.skipped).toEqual([
      { tenantId: missing, duty: "test.duty", errorCode: "unknown" },
    ]);
    expect(duty.calls).toEqual([]);
    // Skipped work is due on the skip-retry interval, NOT at the next day boundary the derivation
    // computed before the claim threw — a host sleeping on that would leave the failure untouched
    // for 20 hours. It is also not `now`: a pair that fails for a reason only a human can fix
    // answers the same way every pass, and reporting `now` pins the host's loop at its MIN_TICK
    // floor forever.
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // The sharper half of the same defect. Here the SNAPSHOT READ fails, before derivation runs at
  // all, so nothing ever moves `earliestFuture` — the state in which `nextDueAt` used to be
  // `null`, i.e. "no work will ever be due", from one transient database blip. A long-running host
  // reading that stops polling permanently. `Math.min(Infinity, retryAt)` is `retryAt`, which is
  // why this case needs no branch of its own in `runDue`.
  it("reports the skip-retry interval, never `null`, when the snapshot read itself fails", async () => {
    // A real driver failure rather than a stub: a closed PGlite connection is exactly what a
    // database that has gone away looks like at this seam, and it costs no cast.
    const dead = await createPgliteDb();
    await dead.close();

    const duty = new FakeDuty();
    const result = await runDue({ ...deps([duty]), db: dead }, [tenantId], NOW);

    expect(result.ran).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(duty.calls).toEqual([]);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });
```

**Rewrite the stale prose** in the comment above "reports null only when there is no (tenant, duty) pair at all" — it currently says "a pair that throws reports `now`":

```typescript
  // The ONLY state in which `nextDueAt` may be null, and now the only test that reaches it: a
  // tenant list with a duty list to cross against produces at least a next period boundary, and a
  // pair that throws reports the skip-retry interval. "No pair at all" is what null means, and
  // nothing else.
```

Then add three new tests after the snapshot-read one:

```typescript
  // THE FOLD, and the reason it is a fold rather than an assignment. Before this, a skip
  // overwrote `nextDueAt` unconditionally, which was safe only because the value written was
  // `now` — always earlier than any real future answer. A value in the FUTURE can mask a
  // successful pair's genuinely earlier one, so the skip time is folded as a MINIMUM.
  it("prefers a successful pair's earlier backoff over the skip-retry interval", async () => {
    // 1s, so the backoff this failing duty writes lands well inside the 5-minute skip interval.
    // The DEFAULT backoff (15 minutes) is longer than the skip interval, so this test cannot be
    // written without the override — and without it the assertion would pass for the wrong reason.
    const failing = throwingDuty("test.duty", new Error("boom"));
    const missing = brandTenantId(randomUUID());
    const result = await runDue(
      deps([failing], { backoffBaseMs: 1_000 }),
      [tenantId, missing],
      NOW,
    );

    expect(result.skipped).toHaveLength(1);
    expect(result.ran.some((r) => r.outcome === "failed")).toBe(true);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 1_000));
  });

  it("prefers the skip-retry interval over a successful pair's later answer", async () => {
    // The default 15-minute backoff is LATER than the 5-minute skip interval, so the skip wins.
    // Same shape as the test above with one knob changed — that is the point: the fold is a min,
    // not a preference for either side.
    const failing = throwingDuty("test.duty", new Error("boom"));
    const missing = brandTenantId(randomUUID());
    const result = await runDue(deps([failing]), [tenantId, missing], NOW);

    expect(result.skipped).toHaveLength(1);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // The branch that deliberately does NOT change. Capped work is genuinely runnable right now, so
  // draining the backlog fast is the intent — a skip present alongside it must not slow that down.
  it("still reports `now` when work was deferred, even with a skip present", async () => {
    const duty = new FakeDuty();
    const missing = brandTenantId(randomUUID());
    const result = await runDue(
      deps([duty], { maxPeriodsPerTick: 1 }),
      [tenantId, missing],
      NOW,
    );

    expect(result.deferred).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.nextDueAt).toEqual(NOW);
  });
```

Add `DEFAULTS` to the existing `import { DEFAULTS, dayPeriod } from "./derive.js";` line if it is not already there (it is), and confirm `throwingDuty` is in the existing `./testing/fake-duty.js` import (it is).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @waitron/scheduler test -- run.test.ts
```

Expected: TypeScript errors on `DEFAULTS.skipRetryMs` (property does not exist), and the rewritten assertions failing with `NOW` received where `AFTER_SKIP_RETRY` was expected.

- [ ] **Step 3: Add `skipRetryMs` to `DEFAULTS`**

In `packages/scheduler/src/derive.ts`, extend the existing object:

```typescript
export const DEFAULTS = {
  horizonDays: 30,
  maxPeriodsPerTick: 7,
  maxAttempts: 3,
  backoffBaseMs: 15 * 60 * 1000,
  staleAfterMs: 60 * 60 * 1000,
  /**
   * How long after a SKIPPED (tenant, duty) pair `runDue` reports work is due again.
   *
   * Bounded below by not spinning: a skip used to report `now`, which a host sleeping on
   * `nextDueAt` turns into its MIN_TICK floor — 5 seconds, forever, for a pair whose failure only
   * a human can fix. Bounded above by the cadence of the duty being retried: five minutes is
   * twelve attempts inside an hour, so a genuinely transient skip costs minutes of that budget
   * rather than all of it.
   *
   * Lives here rather than in the host because `DEFAULTS` is spread as a COMPLETE `SchedulerDeps`
   * by four test call sites and `apps/server`'s own `pass.rls.test.ts`; a required field withheld
   * from it would make this table silently incomplete.
   */
  skipRetryMs: 5 * 60 * 1000,
} as const;
```

- [ ] **Step 4: Add the field to `SchedulerDeps` and implement the fold**

In `packages/scheduler/src/run.ts`, add to `SchedulerDeps` (after `staleAfterMs`):

```typescript
  /** How long after a skipped pair to report work due again. `DEFAULTS.skipRetryMs` owns the
   * default and its reasoning; required here so a caller that forgets is a compile error rather
   * than a silent cadence. */
  skipRetryMs: number;
```

Replace the `nextDueAt` computation and its comment at the end of `runDue`:

```typescript
  // A skipped pair has nothing in `earliestFuture` of its own: nothing was claimed and no backoff
  // was written for it. Reporting the derivation's future answer — or, when every pair threw,
  // `null` — would tell a long-running host that nothing is due, and one transient database blip
  // would stop it polling for good.
  //
  // FOLDED AS A MINIMUM, not assigned. This used to assign `now`, which was safe only because
  // `now` is earlier than every real future answer; `now + skipRetryMs` is not, and assigning it
  // would mask a successful pair's genuinely earlier backoff. `Math.min` also absorbs the
  // every-pair-skipped case for free: `earliestFuture` is still `Infinity` there, and
  // `Math.min(Infinity, retryAt)` is `retryAt`.
  //
  // `deferred > 0` is untouched and still reports `now`: capped work is immediately runnable, and
  // draining that backlog fast is the intent — unlike a skip, which is often waiting on a human.
  result.nextDueAt =
    result.deferred > 0
      ? now
      : result.skipped.length > 0
        ? new Date(Math.min(earliestFuture, now.getTime() + deps.skipRetryMs))
        : earliestFuture === Number.POSITIVE_INFINITY
          ? null
          : new Date(earliestFuture);
  return result;
```

- [ ] **Step 5: Rewrite `TickResult.nextDueAt`'s doc comment**

It currently claims a skipped pair reports `now` and that it "Mirrors `DrainResult.nextDueAt`". Both halves must stay true — Task 2 changes the other side to match:

```typescript
  /**
   * `now` when work is available immediately — the per-tick cap deferred some. `now + skipRetryMs`
   * when a pair was skipped and nothing earlier is known, folded as a MINIMUM against the earliest
   * FUTURE time work appears as the ledger stands at the END of this tick: the derivation's own
   * answer, together with the backoff and re-sweep times this tick's own runs just wrote.
   *
   * Null only when there is no (tenant, duty) pair at all — which stays true only because a
   * skipped pair reports an interval rather than nothing. Mirrors `DrainResult.nextDueAt`, which
   * folds its own skip time the same way and for the same reason.
   */
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/scheduler test
```

Expected: PASS, all suites. If `resweep.test.ts` or `scheduler.rls.test.ts` fail to typecheck, they spread `...DEFAULTS` and should now be satisfied by Step 3 — investigate rather than patching them with a literal.

- [ ] **Step 7: Typecheck the workspace**

```bash
pnpm typecheck
```

Expected: failures **only** in `packages/fiscal-verifactu` (Task 2) and `apps/server` (Task 3) — nothing in `packages/scheduler`. `apps/server/src/pass.rls.test.ts` spreads `...DEFAULTS` and should now compile.

- [ ] **Step 8: Commit**

```bash
git add packages/scheduler/src/derive.ts packages/scheduler/src/run.ts packages/scheduler/src/run.test.ts
git commit -m "fix(scheduler): retry a skipped pair on an interval, not on the next tick

A skipped (tenant, duty) reported nextDueAt = now, which a host sleeping on
that value turns into its MIN_TICK floor forever when the skip is one only a
human can fix. Reports now + skipRetryMs instead, folded as a minimum so a
successful pair's earlier backoff still wins. deferred > 0 is unchanged."
```

---

## Task 2: `@waitron/fiscal-verifactu` — skip-retry cadence in `drain`

**Files:**
- Modify: `packages/fiscal-verifactu/src/drain.ts:62-80` (`DrainDeps`), `:145-157` (the fold)
- Modify: `packages/fiscal-verifactu/src/backend.ts:417-419` (`drain`) and `VerifactuBackendOptions`
- Modify: `packages/fiscal/src/backend.ts:106-120` (`DrainResult.nextDueAt` doc comment)
- Test: `packages/fiscal-verifactu/src/drain.tenancy.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — the two packages are independent.
- Produces: `DrainDeps.skipRetryMs: number` (required) and `DEFAULT_SKIP_RETRY_MS: number` exported from `packages/fiscal-verifactu/src/drain.ts`. Task 3 passes `config.skipRetryMs` into `DrainDeps`.

- [ ] **Step 1: Write the failing tests**

In `packages/fiscal-verifactu/src/drain.tenancy.test.ts`, add near the `SERVER_NOW`/`NOW` constants:

```typescript
const SKIP_RETRY_MS = DEFAULT_SKIP_RETRY_MS;
const AFTER_SKIP_RETRY = new Date(NOW.getTime() + SKIP_RETRY_MS);
```

and import it: `import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";`

**Rewrite** the existing test at line 131 — its name, its comment block and its assertion all assert the old behaviour:

```typescript
  it("reports the skip-retry interval when every due tenant this pass was skipped", async () => {
    // `nextDueAt` starts `null`, and only a tenant that reaches `drainTenant` ever advances it —
    // so a pass in which every due tenant was skipped would otherwise report `null`, meaning "no
    // work will ever be due", and a host sleeping on that stops polling for good.
    //
    // It is equally not `now`: a certificate a human has not provisioned yet produces the same
    // skip every pass, and `now` pins the host's loop at its 5-second MIN_TICK floor indefinitely
    // — the expected state of the first deployment, not a corner case.
    //
    // Asserted with `.some(...)` rather than an exact `toEqual` on the whole `skipped` array: this
    // suite shares one PGlite database across tests, so other tests' tenants may also be due. The
    // two facts this test owns — the failing tenant appearing among `skipped`, and `nextDueAt`
    // landing on the interval — hold regardless of what else got swept.
    …unchanged body…
    expect(result.skipped.some((s) => s.tenantId === failing)).toBe(true);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });
```

Add two new tests:

```typescript
  // THE FOLD. `drain` used to assign `now` on any skip, which was safe only because `now` is
  // earlier than every gate a successful tenant could compute. `now + skipRetryMs` is not, so it
  // is folded as a MINIMUM — otherwise a skipped tenant would delay a healthy tenant's own gate.
  it("prefers a successful tenant's earlier gate over the skip-retry interval", async () => {
    const early = new Date(NOW.getTime() + 30_000);
    const { resolveClient } = recordingResolver();
    const failing = await seedTenantWithSif(db);
    const result = await drain(
      { db, resolveClient, skipRetryMs: SKIP_RETRY_MS },
      NOW,
    );
    // The successful tenant's gate is 30s out, inside the 5-minute skip interval, so it wins.
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.nextDueAt!.getTime()).toBeLessThanOrEqual(early.getTime());
  });

  it("honours an explicit skipRetryMs rather than a package constant", async () => {
    // Pins that the value is READ from deps, not baked in — the assertion that would fail if the
    // fold quietly used DEFAULT_SKIP_RETRY_MS instead of what the caller passed.
    const { resolveClient } = recordingResolver();
    await seedTenantWithSif(db);
    const result = await drain({ db, resolveClient, skipRetryMs: 90_000 }, NOW);

    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 90_000));
  });
```

> **Implementer note on the first new test:** it needs a tenant that DRAINS SUCCESSFULLY and lands a gate 30s out, alongside one that skips. `recordingResolver`'s client rejects every `submit`, which produces a skip, not a success. Build the successful side with `createFakeAeat()` (already imported in this file) as `drain.test.ts` does, and set the fake's `TiempoEsperaEnvio` so the persisted gate is 30 seconds. **If wiring a genuinely-successful tenant into this suite proves to need fixture work beyond the task, delete this test and instead assert the fold directly in a new `drain.fold.test.ts` with a stub `resolveClient` and a hand-seeded `envio_flujo.proximo_envio_en` 30 seconds out.** Do not weaken it to an assertion that passes either way — the fold is the correctness point of this task.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @waitron/fiscal-verifactu test -- drain.tenancy.test.ts
```

Expected: TypeScript error — `DEFAULT_SKIP_RETRY_MS` is not exported, and `skipRetryMs` is not a property of `DrainDeps`.

- [ ] **Step 3: Add the constant and the deps field**

In `packages/fiscal-verifactu/src/drain.ts`, beside the existing `RECUPERACION_ENVIANDO_MS` constant:

```typescript
/**
 * How long after a SKIPPED tenant `drain` reports work is due again.
 *
 * A skip used to report `now`, which a host sleeping on `nextDueAt` turns into its MIN_TICK floor
 * — 5 seconds, forever, for a tenant whose certificate only a human can provision. Five minutes is
 * twelve retries inside art. 16.4's hour, so a transient skip (an expired vault key, a dead
 * credentials connection) costs minutes of that legal budget rather than all of it.
 *
 * `@waitron/scheduler`'s `DEFAULTS.skipRetryMs` holds the same value for `runDue`. The two are
 * DELIBERATELY independent — two duties, two cadences, no invariant requiring them to agree — and
 * `apps/server` overrides both from one `WAITRON_SKIP_RETRY_MS`, so they can only diverge in a
 * deployment that does not use that host. Nothing asserts they are equal, on purpose: a test
 * policing that copy would fail the day someone legitimately splits them.
 */
export const DEFAULT_SKIP_RETRY_MS = 5 * 60 * 1000;
```

Add to `DrainDeps`, after `resolveClient`:

```typescript
  /** How long after a skipped tenant to report work due again. `DEFAULT_SKIP_RETRY_MS` owns the
   * default and its reasoning; required here so a caller that forgets is a compile error rather
   * than a silent cadence. `VerifactuBackend` applies the default on its callers' behalf. */
  skipRetryMs: number;
```

- [ ] **Step 4: Implement the fold**

Replace the skip line and its comment at the end of `drain`:

```typescript
  // A skipped tenant has no future instant of its own: nothing about it was ever scheduled — no
  // gate, no backoff row — so `bumpNextDue` folded nothing in for it. Reporting whatever the
  // tenants that DID run computed, or `null` if every due tenant skipped, would tell a
  // long-running host nothing is due, and one transient failure (an expired vault key, a dead
  // credentials connection) would stop it polling while a `pendiente` row sits past its art. 16.4
  // hour.
  //
  // FOLDED AS A MINIMUM, not assigned. This used to assign `now` unconditionally, and the comment
  // here used to justify that by observing `now` is always earlier than any real gate — true, and
  // no longer the point: `now + skipRetryMs` IS later than a gate a successful tenant may have
  // computed this same pass, so assigning it would delay a healthy tenant's submission behind a
  // broken tenant's retry. The minimum can only pull the reported instant earlier.
  //
  // Not `now`, because a skip is frequently NOT transient: a certificate nobody has provisioned
  // produces the identical answer every pass, and `now` pins the host's loop at its MIN_TICK floor
  // indefinitely — the expected state of the first deployment.
  if (result.skipped.length > 0) {
    const retryAt = new Date(now.getTime() + deps.skipRetryMs);
    result.nextDueAt =
      result.nextDueAt === null
        ? retryAt
        : new Date(Math.min(result.nextDueAt.getTime(), retryAt.getTime()));
  }
  return result;
```

- [ ] **Step 5: Thread it through `VerifactuBackend`**

In `packages/fiscal-verifactu/src/backend.ts`, add to `VerifactuBackendOptions` (near `resolveClient`):

```typescript
  /**
   * Overrides `DEFAULT_SKIP_RETRY_MS` for this backend's `drain`. OPTIONAL, unlike
   * `DrainDeps.skipRetryMs` which is required: this option has 57 construction sites across 10
   * files, none of which care about a cadence knob, and making it required would edit every one of
   * them to say the same thing. The strictness stays where it is cheap — `DrainDeps` itself.
   */
  skipRetryMs?: number;
```

Store it on the instance the same way the other options are stored, then:

```typescript
  async drain(now: Date): Promise<DrainResult> {
    return runDrain(
      {
        db: this.db,
        resolveClient: this.resolveClient,
        skipRetryMs: this.skipRetryMs ?? DEFAULT_SKIP_RETRY_MS,
      },
      now,
    );
  }
```

Import `DEFAULT_SKIP_RETRY_MS` alongside the existing `import { drain as runDrain } from "./drain.js";`.

- [ ] **Step 6: Rewrite `DrainResult.nextDueAt`'s doc comment**

In `packages/fiscal/src/backend.ts` around line 106-120, whatever it says about a skipped tenant reporting `now` is now false. State the fold, and keep the mirror to `TickResult.nextDueAt` (Task 1) true.

- [ ] **Step 7: Fix remaining call sites and run the package suite**

```bash
grep -rn 'drain({\|runDrain({' packages apps --include='*.ts'
pnpm --filter @waitron/fiscal-verifactu test
```

Expected: every direct `drain({ … })` supplies `skipRetryMs`; PASS.

- [ ] **Step 8: Export the constant from the package index if the package has one**

```bash
grep -n "drain" packages/fiscal-verifactu/src/index.ts
```

If `drain` is re-exported there, add `DEFAULT_SKIP_RETRY_MS` beside it. `packages/fiscal-verifactu/src/index.test.ts` pins the public surface — update it in the same commit if it enumerates exports.

- [ ] **Step 9: Commit**

```bash
git add packages/fiscal-verifactu packages/fiscal/src/backend.ts
git commit -m "fix(fiscal): retry a skipped tenant on an interval, not on the next tick

drain reported nextDueAt = now whenever anything was skipped, borrowed from
runDue where a skip is transient. Drain's are not: a missing certificate only
a human can fix answers the same way every pass, pinning a host that sleeps on
nextDueAt at its 5-second floor. Reports now + skipRetryMs, folded as a
minimum so a successful tenant's earlier gate still wins."
```

---

## Task 3: `apps/server` — `WAITRON_SKIP_RETRY_MS` and wiring

**Files:**
- Modify: `apps/server/src/config.ts:15-39` (`ServerConfig`), `:124-171` (`loadConfig`)
- Modify: `apps/server/src/boot.ts:205` and `:209-221`
- Test: `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `DEFAULTS.skipRetryMs` (Task 1), `DrainDeps.skipRetryMs` (Task 2).
- Produces: `ServerConfig.skipRetryMs: number`, read by Task 4's `boot.ts` edits.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/config.test.ts`, matching however that file builds its env fixture:

```typescript
  it("defaults skipRetryMs to the scheduler's own default", () => {
    expect(loadConfig(baseEnv(), "/migrations").skipRetryMs).toBe(DEFAULTS.skipRetryMs);
  });

  it("reads WAITRON_SKIP_RETRY_MS", () => {
    const config = loadConfig({ ...baseEnv(), WAITRON_SKIP_RETRY_MS: "90000" }, "/migrations");
    expect(config.skipRetryMs).toBe(90_000);
  });

  it("rejects a non-positive-integer WAITRON_SKIP_RETRY_MS", () => {
    expect(() =>
      loadConfig({ ...baseEnv(), WAITRON_SKIP_RETRY_MS: "nope" }, "/migrations"),
    ).toThrow(
      expect.objectContaining({
        code: "server.config_invalid",
        params: expect.objectContaining({ variable: "WAITRON_SKIP_RETRY_MS" }),
      }),
    );
  });
```

Match the existing file's assertion idiom for thrown `AppError`s rather than copying the shape above verbatim — check how the `WAITRON_MIN_TICK_MS` tests assert it and follow that.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test -- config.test.ts
```

Expected: FAIL — `skipRetryMs` does not exist on `ServerConfig`.

- [ ] **Step 3: Implement**

Add to `ServerConfig`:

```typescript
  /** How long after a skipped tenant or pair either duty reports work due again. ONE value for
   * BOTH duties: they are independently defaulted in their own packages (no invariant ties them),
   * and this host deliberately presents a single operator-visible skip cadence. */
  skipRetryMs: number;
```

In `loadConfig`'s returned object, beside the other tick values:

```typescript
    skipRetryMs: positiveInt(env, "WAITRON_SKIP_RETRY_MS", DEFAULTS.skipRetryMs),
```

`DEFAULTS` is already imported at the top of `config.ts`.

- [ ] **Step 4: Wire both duties in `boot.ts`**

```typescript
          drain: (at2) => drain({ db, resolveClient, skipRetryMs: config.skipRetryMs }, at2),
```

and add to the `runDue` deps object, after `staleAfterMs`:

```typescript
                skipRetryMs: config.skipRetryMs,
```

- [ ] **Step 5: Run the package suite and typecheck**

```bash
pnpm --filter @waitron/server test && pnpm typecheck
```

Expected: PASS, and typecheck clean across the workspace.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts apps/server/src/boot.ts
git commit -m "feat(server): WAITRON_SKIP_RETRY_MS, one skip cadence for both duties"
```

---

## Task 4: `apps/server` — bound the undici `Agent`'s lifetime

**Files:**
- Modify: `apps/server/src/aeat-transport.ts:104-140`
- Modify: `apps/server/src/boot.ts:109-120` and `:205`
- Test: `apps/server/src/aeat-transport.test.ts`

**Interfaces:**
- Consumes: `config.skipRetryMs` (Task 3).
- Produces: `mtlsFetch(material, ca?) => TenantTransport`; `aeatClientResolver(deps) => ClientResolver` with `{ resolve, closeAll }`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("aeatClientResolver lifetime", () => {
  it("closes one transport per tenant it built", async () => {
    const closed: string[] = [];
    const resolver = aeatClientResolver({
      db,
      ring,
      endpointFor: () => "https://example.test/soap",
      fetchFor: (material) => ({
        fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
        close: () => {
          closed.push(material.certKind);
          return Promise.resolve();
        },
      }),
    });

    await resolver.resolve(TENANT_A);
    await resolver.resolve(TENANT_B);
    await resolver.closeAll();

    expect(closed).toHaveLength(2);
  });

  // The constraint that is invisible until it is violated: `closeAll` runs in boot's `finally`, so
  // a throw there would REPLACE drain's return value or its error — a cleanup path eating the
  // finding it was cleaning up after. Every transport is still attempted.
  it("does not throw when a transport's close fails, and still closes the rest", async () => {
    const closed: string[] = [];
    let n = 0;
    const resolver = aeatClientResolver({
      db,
      ring,
      endpointFor: () => "https://example.test/soap",
      fetchFor: () => ({
        fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
        close: () => {
          n += 1;
          if (n === 1) return Promise.reject(new Error("socket already gone"));
          closed.push("ok");
          return Promise.resolve();
        },
      }),
    });

    await resolver.resolve(TENANT_A);
    await resolver.resolve(TENANT_B);

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    expect(closed).toEqual(["ok"]);
  });

  it("mtlsFetch's close destroys the Agent it built", async () => {
    // Against the suite's existing mTLS fixture: a request succeeds, close resolves, and a request
    // after close rejects — which is what proves `close` reached the real Agent rather than a
    // no-op wrapper.
    const transport = mtlsFetch(material, ca);
    await transport.fetch(fixtureUrl);
    await transport.close();
    await expect(transport.fetch(fixtureUrl)).rejects.toThrow();
  });
});
```

`TENANT_A`/`TENANT_B`, `db`, `ring`, `material`, `ca` and `fixtureUrl` all follow whatever this suite already sets up — reuse its existing fixtures (`testing/tls.ts`) rather than building new ones. The two resolver tests need `readCertMaterial` to succeed for both tenants, so seed both in the vault the way the existing tests do.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test -- aeat-transport.test.ts
```

Expected: FAIL — `resolver.resolve` is not a function (the resolver is currently the function itself), and `mtlsFetch(...)` has no `.close`.

- [ ] **Step 3: Implement the transport shape**

```typescript
/** A tenant's mTLS `fetch` and the handle that releases the connection pool behind it. */
export interface TenantTransport {
  fetch: typeof globalThis.fetch;
  /** Graceful: `Agent.close()`, not `.destroy()`. Nothing is in flight by the time this runs — the
   * sweep has returned — so there is nothing to abort, and `destroy()` would tear down a socket
   * mid-response if that assumption ever stopped holding. */
  close: () => Promise<void>;
}

export function mtlsFetch(material: CertMaterial, ca?: string): TenantTransport {
  const dispatcher = new Agent({
    connect: {
      pfx: material.pfx,
      passphrase: material.passphrase,
      ...(ca === undefined ? {} : { ca }),
    },
  });
  return {
    fetch: ((input, init) =>
      undiciFetch(
        input as string,
        { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
      ) as unknown as Promise<Response>) as typeof globalThis.fetch,
    close: () => dispatcher.close(),
  };
}
```

Change `TransportDeps.fetchFor` to `(material: CertMaterial) => TenantTransport`.

- [ ] **Step 4: Implement the resolver**

```typescript
export interface ClientResolver {
  /** `DrainDeps.resolveClient`, unchanged in shape — `@waitron/fiscal` still knows nothing about
   * mTLS, and this change must not be the one that teaches it. */
  resolve: (tenantId: TenantId) => Promise<VerifactuClient>;
  /** Releases every transport this resolver built. NEVER throws: it runs in a `finally`, where a
   * throw would replace the sweep's own result or error. */
  closeAll: () => Promise<void>;
}

/**
 * `DrainDeps.resolveClient`, wired to the vault, plus the handle that releases what it built.
 * One client — and one connection pool — per tenant per pass, built only for tenants the sweep
 * actually has work for, and destroyed when that pass ends.
 *
 * Constructed PER PASS by `boot.ts` rather than once at boot: the set of transports to close is
 * then scoped by construction, with no residue between passes to reset and no way for one pass's
 * `closeAll` to reach another's.
 */
export function aeatClientResolver(deps: TransportDeps, log?: Logger): ClientResolver {
  const open: TenantTransport[] = [];
  return {
    resolve: async (tenantId) => {
      const material = await readCertMaterial(deps.db, deps.ring, tenantId);
      const transport = deps.fetchFor(material);
      open.push(transport);
      return createClient({
        endpoint: deps.endpointFor(material.certKind),
        fetch: transport.fetch,
      });
    },
    closeAll: async () => {
      for (const transport of open.splice(0)) {
        try {
          await transport.close();
        } catch (error) {
          log?.("warn", "transport.close_failed", { errorCode: codeOf(error) });
        }
      }
    },
  };
}
```

Import `codeOf` from `./error-code.js` and `type Logger` from `./logger.js`.

- [ ] **Step 5: Wire `boot.ts`**

Delete the boot-time `const resolveClient = aeatClientResolver({…})` at line 109 and build it per pass instead:

```typescript
          // Per pass, not once at boot: `closeAll` below must release exactly the transports THIS
          // pass built. Each holds a TLS connection pool keyed to one tenant's client certificate,
          // and nothing closed them before — they accumulated for the process lifetime.
          drain: async (at2) => {
            const transport = aeatClientResolver(
              {
                db,
                ring,
                endpointFor: aeatEndpointFor(config.aeatEnv),
                fetchFor: mtlsFetch,
              },
              log,
            );
            try {
              return await drain(
                { db, resolveClient: transport.resolve, skipRetryMs: config.skipRetryMs },
                at2,
              );
            } finally {
              await transport.closeAll();
            }
          },
```

The existing comment at line 113-118 explaining why `mtlsFetch` is passed directly still applies — move it with the code.

- [ ] **Step 6: Run the suite**

```bash
pnpm --filter @waitron/server test && pnpm typecheck
```

Expected: PASS. `boot.test.ts` may construct a resolver — update it to the new shape.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/aeat-transport.ts apps/server/src/aeat-transport.test.ts apps/server/src/boot.ts apps/server/src/boot.test.ts
git commit -m "fix(server): close each tenant's mTLS Agent at the end of the pass

mtlsFetch built an undici Agent per tenant per pass and nothing ever closed
it, so its sockets and timers accumulated for the process lifetime. The
resolver is now built per pass and returns closeAll, which boot runs in a
finally and which never throws."
```

---

## Task 5: `apps/server` — pass duration

**Files:**
- Modify: `apps/server/src/pass.ts:18-62` (`DutyReport`), `:70-74` (`PassDeps`), `:76-165` (`runPass`), `:177-197` (`attempt`)
- Modify: `apps/server/src/boot.ts:202-225`
- Test: `apps/server/src/pass.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PassDeps.monotonicMs: () => number`; `DutyReport.durationMs: number`.

- [ ] **Step 1: Write the failing tests**

In `pass.test.ts`, add `monotonicMs` to the `deps()` helper so every existing test keeps compiling:

```typescript
function deps(over: Partial<PassDeps> = {}): PassDeps & { lines: string[] } {
  const lines: string[] = [];
  // A monotonic clock that advances 10ms per read: two reads per duty plus two for the pass makes
  // every duration in the assertions below exact rather than merely non-negative.
  let ticks = 0;
  return {
    lines,
    drain: () => Promise.resolve(drainResult()),
    reconcile: () => Promise.resolve(tickResult()),
    monotonicMs: () => (ticks += 10),
    log: (level, event, fields) => lines.push(`${level} ${event} ${JSON.stringify(fields ?? {})}`),
    ...over,
  };
}
```

Then:

```typescript
  it("reports the pass duration and each duty's own", async () => {
    const d = deps();
    await runPass(d, NOW);

    const complete = d.lines.find((line) => line.startsWith("info pass.complete"));
    expect(complete).toBeDefined();
    const payload = JSON.parse(complete!.slice("info pass.complete ".length)) as {
      durationMs: number;
      duties: { duty: string; durationMs: number }[];
    };
    // Monotonic, injected, and asserted exactly: a `toBeGreaterThanOrEqual(0)` here would pass
    // against a field that was never wired up.
    expect(payload.durationMs).toBeGreaterThan(0);
    expect(payload.duties.map((entry) => entry.durationMs)).toEqual([10, 10]);
  });

  it("still reports a duration for a duty that threw", async () => {
    const d = deps({ drain: () => Promise.reject(new AppError("server.credential_unusable", {})) });
    const report = await runPass(d, NOW);

    expect(report.duties[0]!.ok).toBe(false);
    expect(report.duties[0]!.durationMs).toBeGreaterThan(0);
  });
```

Adjust the expected `[10, 10]` to whatever the tick scheme actually yields once `attempt` reads the clock twice per duty — run it and read the number rather than guessing, but **do assert an exact value**.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test -- pass.test.ts
```

Expected: FAIL — `monotonicMs` is not a `PassDeps` property; `durationMs` is absent from the log payload.

- [ ] **Step 3: Implement**

Add to `PassDeps`:

```typescript
  /**
   * A MONOTONIC millisecond clock — `performance.now` in `boot.ts`, injected here so the suite
   * asserts exact durations. Deliberately not the wall-clock `now` this function already receives:
   * an NTP step during a pass would make that produce a negative or absurd duration, in the one
   * field an operator uses to spot a slow one.
   */
  monotonicMs: () => number;
```

Add to `DutyReport`:

```typescript
  /** How long this duty took, from `attempt`'s own monotonic reads. Present for a duty that threw
   * too — the elapsed time is real either way, unlike `skipped`/`parked`, which a throw leaves
   * with no honest value. */
  durationMs: number;
```

In `attempt`, take `monotonicMs` and stamp both branches:

```typescript
async function attempt(
  duty: string,
  now: Date,
  log: Logger,
  monotonicMs: () => number,
  body: () => Promise<{ nextDueAt: Date | null; skipped: number; parked: number }>,
): Promise<DutyReport> {
  const startedAt = monotonicMs();
  try {
    const result = await body();
    return {
      duty,
      ok: true,
      nextDueAt: result.nextDueAt,
      skipped: result.skipped,
      parked: result.parked,
      durationMs: monotonicMs() - startedAt,
    };
  } catch (error) {
    const errorCode = codeOf(error);
    log("error", "duty.failed", { duty, errorCode });
    return { duty, ok: false, errorCode, nextDueAt: now, durationMs: monotonicMs() - startedAt };
  }
}
```

Pass `deps.monotonicMs` at both `attempt` call sites, and in `runPass` wrap the whole body:

```typescript
export async function runPass(deps: PassDeps, now: Date): Promise<PassReport> {
  const startedAt = deps.monotonicMs();
  const duties: DutyReport[] = [];
  …
  deps.log("info", "pass.complete", {
    duties: duties.map((entry) => ({
      duty: entry.duty,
      ok: entry.ok,
      durationMs: entry.durationMs,
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    })),
    durationMs: deps.monotonicMs() - startedAt,
    nextDueAt: nextDueAt?.toISOString() ?? null,
  });
```

- [ ] **Step 4: Wire `boot.ts`**

Add `monotonicMs: () => performance.now(),` to the `runPass` deps object. `performance` is a Node global; no import needed.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @waitron/server test && pnpm typecheck
```

```bash
git add apps/server/src/pass.ts apps/server/src/pass.test.ts apps/server/src/boot.ts
git commit -m "feat(server): report pass and per-duty duration on pass.complete"
```

---

## Task 6: `apps/server` — the `duty.degraded` line

**Files:**
- Modify: `apps/server/src/health.ts:110-128` (`recordPass`) and add `logDegradedDuties`
- Modify: `apps/server/src/boot.ts:232`
- Test: `apps/server/src/health.test.ts`

**Interfaces:**
- Consumes: `DutyReport` (Task 5, for `durationMs`, though this task does not read it).
- Produces: `DutyRecord`; `recordPass(state, report, at) => DutyRecord[]`; `logDegradedDuties(log, records) => void`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("recordPass returns what it recorded", () => {
  it("marks a duty with skips degraded even though its report reads ok", () => {
    const state = createHealthState(NOW);
    const records = recordPass(state, report([duty(DRAIN_DUTY, { ok: true, skipped: 1 })]), NOW);

    expect(records).toHaveLength(1);
    expect(records[0]!.degraded).toBe(true);
    expect(records[0]!.consecutiveFailures).toBe(1);
  });

  it("marks a clean duty not degraded", () => {
    const state = createHealthState(NOW);
    const records = recordPass(state, report([duty(DRAIN_DUTY, { ok: true })]), NOW);

    expect(records[0]!.degraded).toBe(false);
  });
});

describe("logDegradedDuties", () => {
  it("says nothing for a clean pass", () => {
    const lines: string[] = [];
    const state = createHealthState(NOW);
    logDegradedDuties(collect(lines), recordPass(state, report([duty(DRAIN_DUTY)]), NOW));

    expect(lines).toEqual([]);
  });

  // Level from staleness, not from a count: a count threshold means a different amount of TIME at
  // a different retry cadence, while `stale` is already the 503 criterion — so an `error` line and
  // a 503 are the same condition by construction rather than two thresholds that can disagree.
  it("logs error when the duty is stale and warn when it is not", () => {
    const lines: string[] = [];
    const state = createHealthState(NOW);
    // First: a duty that has succeeded recently, then fails — not yet stale.
    recordPass(state, report([duty(DRAIN_DUTY, { ok: true })]), NOW);
    logDegradedDuties(
      collect(lines),
      recordPass(state, report([duty(DRAIN_DUTY, { ok: false })]), NOW),
    );
    expect(lines[0]).toContain("warn duty.degraded");

    // Then: far enough past the budget that the same duty is stale.
    const late = new Date(NOW.getTime() + DUTY_BUDGET_MS[DRAIN_DUTY] + 1);
    lines.length = 0;
    logDegradedDuties(
      collect(lines),
      recordPass(state, report([duty(DRAIN_DUTY, { ok: false })]), late),
    );
    expect(lines[0]).toContain("error duty.degraded");
  });

  // A host that has never had a successful pass reads as stale (`lastOkAt === null`), which is
  // exactly when `/health` returns 503 — so the first failing pass after boot is an `error`, and
  // the two agree.
  it("logs error on the first failing pass after boot", () => {
    const lines: string[] = [];
    const state = createHealthState(NOW);
    logDegradedDuties(
      collect(lines),
      recordPass(state, report([duty(DRAIN_DUTY, { ok: false })]), NOW),
    );

    expect(lines[0]).toContain("error duty.degraded");
  });
});
```

Add `report`, `duty` and `collect` helpers matching whatever `health.test.ts` already uses to build a `PassReport` — reuse its existing builders if it has them rather than adding parallel ones.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test -- health.test.ts
```

Expected: FAIL — `recordPass` returns `void`; `logDegradedDuties` is not exported.

- [ ] **Step 3: Implement `DutyRecord` and the `recordPass` return**

```typescript
/** What `recordPass` just recorded for one duty, returned so a caller can log it at a level the
 * FRESH failure count supports. `pass.ts` cannot do this itself: it emits its lines before
 * `recordPass` runs, so the count it could see is always the previous pass's. */
export interface DutyRecord {
  duty: string;
  consecutiveFailures: number;
  skipped: number;
  parked: number;
  stale: boolean;
  lastOkAt: Date | null;
  /**
   * `ok: false`, OR `ok: true` with `skipped > 0` or `parked > 0` — computed HERE and returned
   * rather than re-derived at the logging site, because it is already the condition deciding
   * whether `lastOkAt` advances below. One expression, so the log line and the `/health` verdict
   * cannot disagree about what "degraded" means.
   */
  degraded: boolean;
}
```

Change `recordPass`'s signature to `: DutyRecord[]`, and inside the loop:

```typescript
    duty.skipped = entry.skipped ?? 0;
    duty.parked = entry.parked ?? 0;
    const degraded = !(entry.ok && duty.skipped === 0 && duty.parked === 0);
    if (degraded) {
      duty.consecutiveFailures += 1;
    } else {
      duty.lastOkAt = at;
      duty.consecutiveFailures = 0;
    }
    records.push({
      duty: entry.duty,
      consecutiveFailures: duty.consecutiveFailures,
      skipped: duty.skipped,
      parked: duty.parked,
      stale: isStale(duty, budgetFor(entry.duty), at),
      lastOkAt: duty.lastOkAt,
      degraded,
    });
```

Keep `recordPass`'s existing doc comment and extend it — do not delete the C2 reasoning.

- [ ] **Step 4: Implement `logDegradedDuties`**

```typescript
/**
 * One line per degraded duty, at a level derived from STALENESS rather than from the
 * consecutive-failure count — an amendment to spec §9, which named the count.
 *
 * A count threshold means a different amount of elapsed time at a different retry cadence: three
 * consecutive failures is fifteen minutes at a five-minute skip retry and three hours at an hourly
 * one, so "three" would silently mean two different things depending on `WAITRON_SKIP_RETRY_MS`.
 * `stale` is time-based and is ALREADY the criterion `/health` returns 503 on, so deriving the
 * level from it makes an `error` line and a 503 the same condition by construction instead of two
 * thresholds that can disagree about whether this host is in trouble. The count still ships in the
 * payload; it just does not decide anything.
 *
 * Consequence, stated rather than left to be discovered: a duty that fails on the FIRST pass after
 * boot logs `error`, because `lastOkAt === null` reads as stale. That is the same instant
 * `/health` starts answering 503 for it — the two agree, which is the point.
 *
 * No `errorCode`: `duty.failed` (pass.ts) already carries the throw's code at the moment it
 * happened, and a skip-only degradation has no duty-level code to report at all.
 */
export function logDegradedDuties(log: Logger, records: readonly DutyRecord[]): void {
  for (const record of records) {
    if (!record.degraded) continue;
    log(record.stale ? "error" : "warn", "duty.degraded", {
      duty: record.duty,
      consecutiveFailures: record.consecutiveFailures,
      skipped: record.skipped,
      parked: record.parked,
      stale: record.stale,
      lastOkAt: record.lastOkAt?.toISOString() ?? null,
    });
  }
}
```

Import `type Logger` from `./logger.js`.

- [ ] **Step 5: Wire `boot.ts`**

```typescript
    onPass: (report, at) => logDegradedDuties(log, recordPass(health, report, at)),
```

Add `logDegradedDuties` to the existing `./health.js` import.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @waitron/server test && pnpm typecheck
```

```bash
git add apps/server/src/health.ts apps/server/src/health.test.ts apps/server/src/boot.ts
git commit -m "feat(server): one duty.degraded line per pass, escalating on staleness

Spec §9 promised an anomaly line whose level escalates, but the failure count
is computed in recordPass, which runs after runPass has emitted every line.
recordPass now returns what it recorded and logDegradedDuties logs it — at
error when the duty is stale, which is already the 503 criterion, rather than
at a count threshold whose meaning drifts with the retry cadence."
```

---

## Task 7: Documentation

**Files:**
- Modify: `apps/server/README.md` (env-var table, and any claim about log volume when degraded)
- Modify: `docs/superpowers/specs/2026-07-26-server-host-design.md` §9

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Add `WAITRON_SKIP_RETRY_MS` to the README table**

Insert after the `WAITRON_MAX_TICK_MS` row, matching the table's existing column widths and tone:

| `WAITRON_SKIP_RETRY_MS` | no | `300000` (5m) | How long after a **skipped** tenant (`fiscal.drain`) or (tenant, duty) pair (`payments.reconcile.stripe`) either duty reports work due again. One value for both. Folded as a *minimum*, so a healthy tenant's earlier gate still wins. Before this existed a skip reported "due now", which `WAITRON_MIN_TICK_MS` turned into a 5-second retry **forever** for a tenant whose certificate only a human can provision — ~86,400 log lines a day, and the expected state of the first deployment. |

- [ ] **Step 2: Amend server-host spec §9**

Two amendments, written the way §9's existing 2026-07-27 amendment block is written — extending rather than rewriting:

1. **`durationMs`** — the pass-summary line now carries `durationMs` at pass level *and* per duty inside `duties`. §9's opening paragraph promised "pass duration"; the per-duty breakdown goes beyond it, because a single number cannot say which duty was slow.
2. **The escalating level** — §9 said the level escalates with the consecutive-failure count. It is derived from `stale` instead, and the reason (a count threshold's meaning drifts with `WAITRON_SKIP_RETRY_MS`; `stale` is already the 503 criterion, so the line and the endpoint agree by construction). Record that `duty.degraded` is a new event carrying `duty`, `consecutiveFailures`, `skipped`, `parked`, `stale` and `lastOkAt`, emitted from the recording site rather than from `runPass`.

- [ ] **Step 3: Check the README's own claims about a degraded host**

```bash
grep -n "5 second\|5s\|hot loop\|MIN_TICK\|log volume" apps/server/README.md
```

Anything asserting the old cadence is now false. Fix it in this commit.

- [ ] **Step 4: Commit**

```bash
git add apps/server/README.md docs/superpowers/specs/2026-07-26-server-host-design.md
git commit -m "docs: WAITRON_SKIP_RETRY_MS, pass duration and the duty.degraded level"
```

---

## Task 8: Whole-branch verification

- [ ] **Step 1: Full workspace gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm -r test
```

`format:check` is **not** covered by `lint` — both are required.

- [ ] **Step 2: Coverage for `@waitron/server`**

```bash
pnpm --filter @waitron/server test:coverage
```

`apps/server` was at 100% on all four metrics before this cycle. Restore it, or record in the PR body exactly which lines are uncovered and why.

- [ ] **Step 3: Read the whole diff against the spec**

```bash
git diff main...HEAD
```

Check specifically for the failure mode this branch's predecessor hit eleven times out of twelve: **a comment that asserts something the code no longer does.** The four comments this plan rewrites are the known ones — look for others the changes made stale, especially in `drain.ts`, `run.ts`, `health.ts` and `aeat-transport.ts`.

- [ ] **Step 4: Confirm the degraded-pass behaviour end to end**

There is no integration test for "a host with an unprovisioned tenant sleeps five minutes". Reason it through the diff instead and write the conclusion into the PR body: `drain` returns `nextDueAt = now + 300000` → `runPass` folds it → `sleepMsFor` clamps it between 5s and 1h → `loop.sleeping` logs `sleepMs: 300000`. If any step does not hold, it is a defect, not a documentation gap.

---

## Self-Review

**Spec coverage.** §2 skip cadence → Tasks 1, 2, 3. §2.3 constant placement → Tasks 1, 2, 3. §3 `Agent` lifetime → Task 4. §4 pass duration → Task 5. §5 `duty.degraded` → Task 6. §6 documentation → Tasks 1, 2, 6 (in-code comments) and Task 7 (README, spec §9). §7 testing → every task's Step 1. §8 out of scope → nothing in this plan touches it.

**Known soft spot.** Task 2's "prefers a successful tenant's earlier gate" test needs a genuinely-successful tenant in a suite whose existing resolver rejects every submission. The task carries an explicit fallback (a dedicated `drain.fold.test.ts` with a hand-seeded gate) and an explicit prohibition on weakening the assertion. That is the one place an implementer will need judgement.

**Exact-value assertions.** Task 5's `[10, 10]` depends on how many times `attempt` reads the injected clock. The step says to run it and read the real number rather than guess — but still to assert an exact value, because `toBeGreaterThanOrEqual(0)` passes against a field that was never wired up.
