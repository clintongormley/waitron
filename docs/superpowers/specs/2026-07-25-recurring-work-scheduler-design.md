# The recurring-work scheduler — `packages/scheduler`

**Date:** 2026-07-25
**Status:** design, approved in brainstorm; implementation plan to follow.
**Main at design time:** `59ded62`.

## 1. Why this exists

Four recurring duties have been built, each deliberately shaped for a caller that does not exist:

| Duty | Shape | Consequence of nothing calling it |
| --- | --- | --- |
| `FiscalBackend.drain(now)` | → `nextDueAt` | Verifactu submission never happens. The hourly retry is a **legal** obligation |
| `PaymentProvider.forward(now)` | → `nextDueAt` | `accepted_offline` payments never clear |
| `PaymentReconciler.reconcile(tenantId, period, now)` | period passed in | No payment audit runs |
| `FiscalBackend.reconcile(tenantId, {year, month})` | monthly | No fiscal audit runs |

`packages/fiscal`'s `backend.ts` already fixed the governing constraint: *"the repeating cadence is
the caller re-invoking on `nextDueAt`, **driven by the database, never an in-memory timer**."*

The immediate trigger is narrower. The orphan drift gate ([`2026-07-25-orphan-drift-gate-design.md`](./2026-07-25-orphan-drift-gate-design.md))
holds a customer's funds pending a human, and `listReconcilable` selects by `settled_at` within the
swept period, so under a closed-past-window cadence **nothing re-sweeps that period**. The row is
detected once. §7 below is what closes that.

This design covers the runner only. It ships no process — see §2.

## 2. The five decisions this design rests on

Taken in the brainstorm, recorded here so a later reader can see they were choices:

1. **Duty-neutral runner, payments `reconcile` wired first.** Not a reconcile-only scheduler: the
   four duties were shaped identically on purpose, and `drain` — the one with a legal deadline — must
   land without a rewrite.
2. **Library only.** `packages/scheduler` is a package; no process, no config loading, no secrets.
   The standalone deli deployment wants ONE process, so the runner and the deferred `apps/*` webhook
   endpoint belong in the same host; building a process here would mean building it twice.
   **Honest cost: nothing runs until that host exists.**
3. **A run ledger**, one row per `(tenant, duty, period, generation)`.
4. **No time bound on a gated drift orphan's fund-hold.** Nothing consumes incidents today — no till
   UI, no dashboard — so an age-triggered escalation would be a signal into a void, the "dead surface
   mutation testing cannot reach" this project avoids. The ledger makes the hold's age *computable*.
   The policy is an explicit deferred decision owned by the remediation-UI cycle, not a silent
   omission.
5. **Bounded retry, independent periods, then park.** Unbounded retry floods a down processor and
   re-fetches a full settlement report every tick; giving up silently is the gap the ledger exists to
   close.

## 3. Package shape and seams

`packages/scheduler` (`@waitron/scheduler`). Depends on `@waitron/db` and `@waitron/shared` **only**.
It must never import `@waitron/payments` or `@waitron/fiscal`: duties are injected and typed
structurally, the same trick `reconcile.ts`'s `IncidentSink` uses to keep `@waitron/core` a dev
dependency.

**`packages/db`'s `english-only.ts` enumerates `GENERIC_PACKAGES` explicitly**, so a new package
silently escapes that guard until it is added. Adding `"scheduler"` to that list is part of this
work, not a follow-up.

One entry point, one shot:

```ts
export async function runDue(
  deps: SchedulerDeps,
  tenantIds: readonly TenantId[],
  now: Date,
): Promise<TickResult>;

export interface SchedulerDeps {
  db: Database;
  duties: readonly PeriodDuty[];
  horizonDays: number;       // default 30
  maxPeriodsPerTick: number; // default 7
  maxAttempts: number;       // default 3
  backoffBaseMs: number;     // default 15 * 60_000
  staleAfterMs: number;      // default 60 * 60_000
}
```

No loop and no timer: the host decides cron versus long-running, and `now` is injected on exactly
the contract `drain(now)` / `forward(now)` / `reconcile(…, now)` already use — an injected clock is
what makes the boundary testable.

**Tenants are a parameter, not an interface.** Enumerating them means an RLS bypass whose correct
form differs per deployment model (standalone: one tenant from config; multi-tenant cloud: an admin
query). That is the host's knowledge. One tenant's failure never stops the others.

```ts
export interface PeriodDuty {
  /** Stable ledger key, e.g. "payments.reconcile.stripe". Changing it orphans that duty's
   *  history and restarts derivation from the most recent complete period. */
  readonly name: string;
  readonly cadence: "daily";
  run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome>;
}

/** Half-open `[from, to)`, matching `ReconcilePeriod`. */
export interface RunPeriod {
  from: Date;
  to: Date;
}

export interface DutyOutcome {
  /** Stored verbatim in `scheduled_runs.summary`. Structured data only — never prose, per the
   *  localisation rule, and never a `Date` (serialise to ISO first). */
  summary: Record<string, unknown>;
  /** See §7. Set when this run left something unresolved that a LATER sweep of the SAME period
   *  could resolve. */
  resweepAfter?: Date;
}
```

### No `DueAtDuty` is shipped

A second duty kind for `drain`/`forward` is **designed for but not built**. `packages/fiscal`'s
`backend.ts` states the rule this obeys: reserved names were *"deliberately absent until that plan
designed flow control… An interface method with no caller and no meaningful fake is dead surface
that mutation testing cannot reach."*

The neutrality that was actually asked for is still delivered: the runner has zero knowledge of
payments or fiscal. When `drain` lands it adds a derivation strategy and a migration — a new source
of due work alongside the three in §5 — not a rewrite. The ledger's `period_from`/`period_to` are
`NOT NULL` today precisely because inventing nullable columns for an unbuilt kind is the same
speculation in a different place.

> **Amended 2026-07-26 — the paragraph above is wrong about what `DueAtDuty` would cost, and the
> two duties it names do not have the same answer.** The claim that landing `drain` means "a
> derivation strategy and a migration" was written without checking either duty's actual shape.
>
> **`drain` is genuinely not schedulable by this ledger.** Three reasons, all specific to it:
>
> 1. **`drain(now)` takes no tenant.** It enumerates its own through `envios_tenants_with_work`, a
>    `SECURITY DEFINER` seam built precisely so it can read across tenants under FORCE RLS. Every
>    `scheduled_runs` row is `tenant_id NOT NULL` with an FK and RLS, so a cross-tenant duty has
>    nothing to key a row on — and running it once per tenant would repeat the whole sweep N times.
> 2. **It already owns durable schedule state.** `envio_flujo.proximo_envio_en` is per tenant and
>    persisted ("never an in-memory timer"), and `envios.proximo_intento_en` carries per-record
>    retry. A ledger row would duplicate scheduling this package does not own.
> 3. **`parked` is terminal.** Three throws would silently end `drain`'s hourly retry, which is a
>    legal obligation — the opposite of what scheduling it is for.
>
> **`forward` is a different case, and is DEFERRED rather than ruled out.** None of the three holds
> for it. It is now a per-tenant object (`StripeOnDeviceProviderOptions.tenantId`, landed the same
> day — see [`2026-07-26-provider-tenant-scoping-design.md`](./2026-07-26-provider-tenant-scoping-design.md)),
> so it keys onto `tenant_id NOT NULL` exactly as a `PeriodDuty` does. It owns **no** durable
> schedule state: its only cadence is an in-process `FORWARD_RETRY_MS` constant in the adapter,
> which is the very thing this package exists to replace. And nothing about its failure mode is
> legally load-bearing, so `parked` is survivable.
>
> What blocks it is not shape but consumption: `forward` returns a `nextDueAt` **no code reads**,
> because the host does not exist. An offline card queue that never clears is real revenue, so this
> is a real gap — it is just a gap the host closes first. Revisit when sub-project C lands, and
> treat `FORWARD_RETRY_MS` as the thing the host or this ledger should own instead of the adapter.
>
> Netting out for `drain`: what the runner would add is *a caller*, and the `apps/*` host is already
> that. It calls `runDue(…)` for period duties and `drain(now)`/`forward(now)` directly, then sleeps
> until the earliest of the three `nextDueAt`s. **No interface, no migration, no derivation
> strategy.** Nor could this library carry the legal cadence even if it wanted to — an hourly duty
> runs hourly only if the host ticks hourly, which is the host's configuration, so a `maxIntervalMs`
> knob here would look like a guarantee it cannot make.
>
> The one real loss is durable visibility of a `drain` that keeps throwing: `TickResult.skipped` is
> ephemeral and `incidents.till_id` is `NOT NULL` (§4), so there is nowhere to record it. That is
> **assigned to monitoring**, not to a duty abstraction. Record-level failures already raise
> incidents; this is about the sweep itself.
>
> Investigating this also surfaced that all three Stripe adapters were non-functional under a real
> deployment role — same spec.

## 4. The ledger

`scheduled_runs`, owned by this package: its own `src/schema/` directory, its own
`SCHEDULER_MIGRATIONS` descriptor, and its own `schema-ownership.test.ts` — the `packages/payments`
precedent. Core migrations run first (the `tenants` foreign key).

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid NOT NULL → `tenants` | RLS enabled, as on every table here |
| `duty` | text NOT NULL | `PeriodDuty.name` |
| `period_from` / `period_to` | timestamptz NOT NULL | the `[from, to)` stored explicitly, not derived |
| `generation` | int NOT NULL default 0 | 0 = scheduled; N > 0 = re-sweep (§7) |
| `state` | text NOT NULL | `pending` \| `running` \| `succeeded` \| `failed` \| `parked` |
| `attempts` | int NOT NULL default 0 | incremented at claim, not at completion |
| `next_attempt_at` | timestamptz | when this row becomes claimable; null unless `pending`/`failed` |
| `started_at` / `finished_at` | timestamptz | last claim and last completion |
| `summary` | jsonb | the duty's own result, verbatim. Null until a run finishes |
| `error_code` | text | structured code, never prose |

**Unique on `(tenant_id, duty, period_from, generation)`.**

The `generation` column is what makes that key safe. A table-wide unique on
`(tenant_id, duty, period_from)` is precisely the trap this project already hit once — a unique index
that breaks callers legitimately needing N rows per key. Re-sweep is such a caller: it must run a
period **again** without overwriting what the first sweep recorded.

Indexes: **`scheduled_runs_key` and nothing else.** Its own leading columns
`(tenant_id, duty, period_from)` already serve gap derivation, so no separate index for that — a
second one would be dead weight on a write path. The same sentence disposes of a partial index on
`next_attempt_at WHERE state IN ('pending','failed')` "for claimable pickup", which an earlier
draft of this design provisioned: every claim keys on `id` (the primary key), and derivation reads
by `(tenant_id, duty)` and then filters `next_attempt_at` in JavaScript over rows it has already
fetched, so no query would ever have read it. A cross-duty pickup query, if one ever lands, brings
its own index with it.

### Park raises no incident

`incidents.till_id` is `NOT NULL` and a scheduler-level failure has no till. Raising one would mean
fabricating an attribution. **The ledger row is the durable record** — which is exactly the hole the
reconcile design left open, calling `remediationFailures` *"the scheduler's to close, not this
package's"*. `summary` closes it: a sweep's `PaymentReconcileResult`, including its
`remediationFailures`, is persisted verbatim by a runner that never has to understand it.

## 5. Deriving what's due

The runner holds no queue. It asks the database what is missing — **a gap in the ledger IS the
work** — which is why there is no successor row to lose. Per `(tenant, duty)`, at `now`:

**Tile.** Daily cadence tiles UTC calendar days. A day is eligible the moment `period_to <= now`.

**There is no settle-grace knob, and that is justified rather than lazy.** A freshly-closed day
cannot produce false findings: `unsettled` escalates only past `settlementLagMs` (7 days), so
yesterday's rows are not eligible for it; `drift` requires a MATCHED settlement, so a settlement the
processor has not posted yet produces nothing rather than a false alarm; `orphan` is local-only and
never consults the report; and an unmatched settlement gets a targeted all-time, all-state existence
check before it can be classified `missingLocal`. A sweep of yesterday run at 00:05 is quiet by
construction.

**Floor.** The floor for a `(tenant, duty)` is `min(period_from)` over its existing rows. For one
with **no rows at all** it is the most recent complete period — not the horizon. You cannot have
missed periods before you existed, so a day-one deployment runs one sweep rather than thirty, and
`beyondHorizon` is 0 rather than unbounded. The horizon governs catch-up for a duty that HAS run and
fallen behind.

**Three sources of work, two claim statements.** Both are single-statement conditional writes — the
`markReconcileRemediated` pattern, already proven race-safe here under concurrent sweeps:

| Source | Found by | Claim |
| --- | --- | --- |
| **Gap** | an eligible day with no row | `INSERT … ON CONFLICT DO NOTHING RETURNING id`, at `generation` 0, `state='running'`, `attempts=1`. The insert IS the lock |
| **Retry** | `state='failed'`, `next_attempt_at <= now` | the claim `UPDATE` below |
| **Re-sweep** | `state='pending'`, `next_attempt_at <= now` | the same claim `UPDATE` |

```sql
UPDATE scheduled_runs SET state = 'running', attempts = attempts + 1, started_at = $now
 WHERE id = $1 AND state IN ('pending', 'failed') AND next_attempt_at <= $now
```

Rowcount-checked: exactly one concurrent runner wins. Retry and re-sweep differ only in which state
the row arrived in, so they share one statement rather than one being a widening of the other.

All ledger reads and writes run inside `withTenant` — the table is RLS-enabled like every other, and
an unscoped query would silently see nothing.

**Both bounds are visible in the result, never silent.** `maxPeriodsPerTick` (7) takes oldest-first
so catch-up is chronological, and reports `deferred`. The horizon (30 days) reports `beyondHorizon`:
the count of never-swept days between the floor and the horizon start. A duty broken for 31 days
loses those periods permanently — and the result says so, rather than reading as full coverage.

```ts
export interface TickResult {
  ran: RunRecord[];
  /** Eligible work this tick did not run, capped by maxPeriodsPerTick. */
  deferred: number;
  /** Never-swept days dropped permanently by the horizon. */
  beyondHorizon: number;
  /** A (tenant, duty) abandoned part-way by an INFRASTRUCTURE failure — the snapshot read, or a
   *  claim — rather than by a duty failing. A duty failure has a ledger row to carry it; this does
   *  not, so it is reported here rather than swallowed. Runs this pair completed before the throw
   *  still appear in `ran`. */
  skipped: { tenantId: TenantId; duty: string; errorCode: string }[];
  /** Earliest time runDue would find work again — the ledger as it stands at the END of the tick.
   *  `now` when work is available immediately (deferred > 0, or skipped is non-empty: skipped work
   *  was never claimed and no backoff was written for it); otherwise the earliest of each duty's
   *  next period boundary, the minimum next_attempt_at over claimable rows, AND the backoff and
   *  re-sweep times this tick's own runs just wrote. Null only when there is no (tenant, duty)
   *  pair at all. Mirrors DrainResult.nextDueAt — the only field a host needs. */
  nextDueAt: Date | null;
}

export interface RunRecord {
  tenantId: TenantId;
  duty: string;
  period: RunPeriod;
  /** 0 = derived from a gap; N > 0 = the Nth re-sweep of the same period (§7). */
  generation: number;
  outcome: "succeeded" | "failed" | "parked";
  errorCode?: string;
}
```

`RunRecord` carries no `summary`. The duty's own result is persisted to the ledger row — that is
what §4 means by "the ledger row is the durable record" — and a runner that never has to understand
it has no reason to hand it back up as well.

Execution is sequential across tenants and duties. Nothing in the design assumes that: the
conditional claims make concurrency safe whenever a host wants it.

## 6. Failure: retry, park, and stale claims

On a thrown duty: `state='failed'`, `finished_at`, a structured `error_code` (the `AppError` code, or
the literal `"unknown"` for a non-`AppError` — the `remediate()` convention), and
`next_attempt_at = now + backoffBaseMs × 2^(attempts - 1)`. At `maxAttempts` (3) the row goes
`parked` with a null `next_attempt_at` and is never retried automatically.

`attempts` is incremented at CLAIM, so with the defaults a period is attempted three times and waits
**15m then 30m** between them; the third failure parks it rather than waiting an hour for a fourth
that `maxAttempts` forbids.

Periods are separate rows derived independently, so **a parked 2026-07-24 never blocks 2026-07-25**.

**Stale claims are mandatory, not a nicety.** They need their own conditional `UPDATE` — the claim
statement in §5 matches `state IN ('pending','failed')` and a stranded row is `running`:

```sql
UPDATE scheduled_runs SET state = 'running', attempts = attempts + 1, started_at = $now
 WHERE id = $1 AND state = 'running' AND started_at < $now - $staleAfterMs
```

A stale row counts as claimable work in §5's derivation alongside the other three sources. Without
this, a process crashed mid-run locks that
period **forever** — the ledger's own worst failure mode, and one no gap would reveal, because the
row exists. `staleAfterMs` (default 1 hour) must exceed the duty's plausible runtime. Reclaiming
early means a double-run, which reconcile survives — its marker claim, incident dedup and reversal
guard are all single-statement conditional writes — but which should not be routine.

## 7. Re-sweep, and what it does to §4 of the drift-gate handoff

**The hole "re-sweep only" leaves, stated plainly:** a successfully-swept period has no gap, so under
§5 alone nothing would ever re-derive it. The ledger does not close re-detection by itself — it needs
someone to ask, and there is no UI to ask. So the duty asks, through `DutyOutcome.resweepAfter`.

When a run returns it, the runner enqueues generation N+1 as `pending` with
`next_attempt_at = resweepAfter`. The runner never learns why: `resweepAfter` is opaque to it, which
is what keeps it duty-neutral.

**Enqueue is guarded and idempotent.** A successor is inserted only when that
`(tenant, duty, period_from)` has no row at any generation in a non-terminal state — anything other
than `succeeded` or `parked`, so a `failed` row awaiting its own retry blocks it too. `generation` is
`max + 1` over that key. The completing row's own write and the enqueue share one transaction, so the
guard sees the run that is finishing as already terminal. Two racing enqueues collide on the unique
index; the loser treats the violation as "already enqueued" (`isUniqueViolation`). The chain stays
linear — one unresolved finding cannot fan out into an exponential number of rows.

**Wired to payments reconcile, this is a self-healing loop rather than a louder alarm.** A sweep that
found an orphan whose amount also drifted asks to be repeated. While the drift persists it
re-detects, incident dedup
keeps it from spamming, the gate still holds and no money moves. On the day a human corrects the
amount the row no longer drifts, the orphan is claimed normally, and **the reversal completes with no
further intervention** — provided the chain is still alive. The remediation UI that decision 4
defers shrinks to "fix the amount".

**The chain is not unconditional, and park is where it ends.** `resweepAfter` is read only from a
SUCCESSFUL outcome: a run that throws leaves it undefined, so no successor is enqueued. A re-sweep
row that then fails `maxAttempts` times — with the defaults, three attempts spanning §6's 15m and
30m of backoff — goes `parked`, and **nothing re-derives it**: the period has rows, so gap
derivation skips it, and `parked` is terminal, so no claim ever fires again. A settlement-report
outage of about 45 minutes, landing on a re-sweep attempt, therefore ends that period's loop
permanently — with the customer's funds still held, no incident (§4) and no UI (decision 4). The
paragraph above holds *while the chain is alive*; it is not a promise that it stays alive.

Changing that — an unbounded slow retry for chain rows, a distinct non-terminal `abandoned` state,
an explicit resurrection path — is a design decision, and it belongs with decision 4's fund-hold
bound in the cycle that owns the remediation UI. What this design owes that cycle is the hole
stated rather than implied.

**A monitor can key on it today, with no new surface.** A parked CHAIN row is distinguishable from
a parked one-off gap by `generation`: `claimGap` is the only writer of generation 0, and
`enqueueSuccessor` runs in the same transaction as a winning completion of an already-existing row,
so its `max(generation) + 1` is always at least 1. `RunRecord.generation` carries that out of every
tick and the ledger row carries it durably, so `state = 'parked' AND generation > 0` is exactly "a
self-healing loop that stopped healing".

It also closes the horizon cliff for exactly the case §4 cares about: a re-sweep row is explicit work
rather than gap-derived, so a 90-day-old unresolved drift keeps its chain alive well past the 30-day
gap horizon.

**No public `requestRun` is exported.** The enqueue mechanism is internal and driven by
`resweepAfter`; a manual re-sweep entry point with no caller is the dead surface §3 refuses. When the
remediation UI needs it, exposing it is one exported line over a mechanism that already exists and is
already tested.

## 8. Wiring payments reconcile

The adapter is about a dozen lines and **belongs to the host**, because `packages/scheduler` must not
import payments and `packages/payments` must not own cadence — both designs state that the period is
passed in and the cadence is an `apps/*` concern.

What this cycle can still do is prove the fit rather than assert it: `@waitron/payments` as a **dev
dependency**, with a type test that a `PaymentReconciler` adapts to a `PeriodDuty`. That is the house
pattern — *"`recordIncidentOnce` is assignable to it verbatim"*.

The adapter maps `PaymentReconcileResult` onto `DutyOutcome.summary` verbatim, and sets
`resweepAfter` when a `paymentRef` appears in **both** `result.orphan` and `result.drift`.

**That predicate is deliberate, and it is a superset of the strictly-gated set.** The `remediation`
reason (`amountDrifted` and its siblings) is not on the result at all — it reaches the incident's
params and nothing else — so an adapter cannot read it, and widening the result to carry it is a
change to a money-path package this design does not need. The intersection is computable from what
the result already exposes. It is wider because the gates are ordered: a drifting orphan on a
non-abandoned working order reports `workingOrderNotAbandoned`, yet still appears in both lists. That
costs one extra re-sweep of a period that would re-detect the same finding and act on none of it —
harmless, and preferable to reaching into `packages/payments` for exactness the loop does not need.

## 9. Testing

- **Derivation is a pure function** over `(now, existing rows, config)` — tiling, floor, gaps,
  horizon, cap, `nextDueAt`. No database, tested exhaustively, exactly as `classify` is. This is where
  the money-adjacent rules live, so this is where the coverage goes.
- **Real Postgres** for what only a database can prove: the three claim races under concurrency,
  stale reclaim, generation chains, unique-violation handling on racing enqueues, and RLS.
- **A fake duty in `src/testing/`**, per the `fake-provider.ts` precedent — including one that throws,
  one that returns `resweepAfter`, and one that hangs past `staleAfterMs`.
- The new `*.rls.test.ts` writes its `afterAll` correctly rather than inheriting the unconditional
  one the existing four share, which masks a `beforeAll` failure and leaks the container.
- Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally. Never commit it.

## 10. Rejected alternatives

**A work queue with enqueued successors.** One `scheduled_runs` table where every completed run
enqueues its successor's `due_at`; the runner claims due rows `FOR UPDATE SKIP LOCKED`. One structure
and one code path, and `nextDueAt` would map onto it directly. Rejected because the whole design
rests on an enqueue-successor invariant whose failure is silent and permanent: lose a successor and
that duty stops for ever, with no gap to notice it, and the mechanism that would detect the problem
is the queue that just broke. Derived work has no successor to lose.

**A rolling look-back window** — each run sweeps `[now - 30d, now)` instead of one day. Downtime
catch-up, re-sweep and drift re-detection would all be automatic with no ledger at all. Rejected
because it destroys the period as a **unit of audit**: "the 2026-07-24 sweep found X" stops being
answerable when every run's results overlap every other's, and that alignment with fiscal's
`{year, month}` periods and the daily close is worth more than the machinery it would save. It also
re-fetches a month of settlement report every night.

**Two duty kinds built now** (§3), **per-duty cadence state** — pushing period bookkeeping into
`packages/payments`, contradicting "the period is passed in" — and a **`TenantSource` interface**
instead of a parameter (§3).

**Tenant-local business days.** No timezone column exists on `tenants` or `locations`, so this would
mean introducing that concept — sub-project 6/8 territory. UTC days now; because each period is
stored as an explicit `[from, to)`, a later timezone-aware cadence changes how periods are *computed*,
not what is *stored*.

## 11. Out of scope

- **Any process, config loading, or secret handling.** Decision 2. Nothing runs until the `apps/*`
  host exists; that host wires this runner and the deferred webhook endpoint together.
- **`DueAtDuty`** and therefore `drain` / `forward` scheduling — §3. The legal exposure on `drain`
  is real and unchanged by this design; this makes landing it cheap, not done.
  **Amended 2026-07-26:** cheaper than "cheap" — it is not being built. The host calls `drain` and
  `forward` directly and folds their `nextDueAt` in beside `runDue`'s. See §3's amendment.
- **A time bound on the drift-orphan fund-hold** — decision 4, owned by the remediation-UI cycle.
  §7 makes the hold self-healing once a human acts, and its age computable; it does not decide how
  long is too long.
- **Reviving a parked re-sweep chain** — §7. A chain row that exhausts `maxAttempts` is `parked`,
  and nothing re-derives that period afterwards, so roughly 45 minutes of duty failure ends the
  loop for it permanently. Whether park should mean something different for a chain row belongs
  with decision 4 in the same cycle; `state = 'parked' AND generation > 0` identifies the case in
  the meantime.
- **An incident on park** — forced by `incidents.till_id` being `NOT NULL` (§4).
- **Leader election.** The conditional claims are sufficient for N concurrent hosts; nothing here
  needs a leader.
- **Cadences other than daily.** `cadence: "daily"` is a literal, not an enum with one member —
  fiscal's monthly `reconcile` will widen it when it is wired.
