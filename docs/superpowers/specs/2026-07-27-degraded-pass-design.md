# What a persistently-degraded pass looks like from outside (design)

**Date:** 2026-07-27 · **Main at design time:** `f757bd6` (`apps/server` landed, PR #35)

`apps/server` is correct about a degraded pass and unreadable about one. It flips `/health` to 503
when a tenant is skipped or a run is parked — that landed in #35 — but it then retries the
unfixable at the 5-second floor forever, reports no pass duration, and says nothing about a duty's
cumulative state. **This is the expected state of the first deployment**, not a corner case: no
qualified certificate exists yet, so every `drain` pass will skip every tenant while `apps/till`
writes sales against the same host.

Three changes, in three places. Two touch shared packages (`@waitron/fiscal`, `@waitron/scheduler`);
the rest is `apps/server`.

---

## 1. The problem, corrected

The `apps/server` handoff (`2026-07-27-apps-server-landed.md`, untracked scratch since handoffs were gitignored — `git show 86229c8:docs/handoffs/2026-07-27-apps-server-landed.md`) §7 lists four
deferrals. **One of them is already done**, and one is not what it claims.

**Already done: terminal-outcome logging.** The handoff says "*a `failed` or `parked` reconcile run
appears in no log line beyond the new counts; `RunRecord.errorCode` is never read*". It is read.
`logNonSucceededRun` ([`apps/server/src/pass.ts`](../../../apps/server/src/pass.ts), the function
below `attempt`) emits one line per non-succeeded run carrying `errorCode`, `tenantId`, `duty` and
`period`, at `warn` for `failed` and `error` for `parked`, and the server-host spec's §9 amendment
documents it as landed. Nothing to do; the bullet is stale.

**Not what it claims: the unclosed `Agent`.** The handoff couples it to the skip cadence — "*5
seconds × an unclosed pool is different arithmetic from one per hour*". It is not coupled.
`aeatClientResolver` ([`apps/server/src/aeat-transport.ts`](../../../apps/server/src/aeat-transport.ts))
throws inside `readCertMaterial` **before** it reaches `createClient`, so on the missing-certificate
path `mtlsFetch` is never called and no `Agent` is constructed. The leak is real and worth fixing on
its own merits, but its worst case is a **healthy** multi-tenant deployment, not a degraded one.

**Corrected arithmetic for the skip cadence.** The handoff estimates ~1.5M log lines/day. At the
5-second floor — today, before this branch — a pass emits five lines for a single skipped tenant —
`drain.tenant_skipped`, `drain.complete`, `reconcile.complete`, `pass.complete`, `loop.sleeping` —
over 17,280 passes/day. `duty.degraded` (§5 below) does not exist yet at that point, so five is
correct for the "today" row as-is. It does exist once this branch lands, though, and a skipped
tenant makes the pass it is in `degraded` by definition (§5's own rule: `ok: true` with `skipped >
0` still counts) — so the FIXED cadence's row is six lines per pass, not five, and the two rows are
deliberately counting a different number of lines each, not disagreeing about the same one:

| | passes/day | lines/pass (one skipped tenant) | lines/day |
| --- | --- | --- | --- |
| Today (5s floor, before `duty.degraded` existed) | 17,280 | 5 | ~86,400 |
| With a 5-minute skip retry (`duty.degraded` included) | 288 | 6 | ~1,728 |

Smaller than stated, still unbounded, still a disk-fill risk on a single-node deli host, and still
17,280 pointless vault reads a day. The fix does not change.

So: **three items, not four** — skip cadence, `Agent` lifetime, and the two observability gaps §9
promises and the code does not deliver.

## 2. Skip cadence

### 2.1 The defect

Both duties report "due now" when anything was skipped:

```ts
// packages/fiscal-verifactu/src/drain.ts
if (result.skipped.length > 0) result.nextDueAt = now;

// packages/scheduler/src/run.ts
result.nextDueAt = result.deferred > 0 || result.skipped.length > 0 ? now : …
```

`sleepMsFor` ([`apps/server/src/loop.ts`](../../../apps/server/src/loop.ts)) clamps that to
`minTickMs`, whose default is 5 seconds. Both comments justify it identically and correctly *for a
transient skip*: reporting the successful tenants' future answer — or `null`, when every tenant
skipped — would tell a long-running host that nothing is due, and one blip would stop it polling for
good.

The borrowed assumption is that a skip is transient. Drain's are not. A missing or unusable
certificate is fixable only by a human, and produces the identical answer every pass.

### 2.2 The fix

A fixed retry interval, folded as a **minimum** against whatever the successful tenants computed.

```ts
// drain.ts
if (result.skipped.length > 0) {
  const retryAt = new Date(now.getTime() + deps.skipRetryMs);
  result.nextDueAt =
    result.nextDueAt === null
      ? retryAt
      : new Date(Math.min(result.nextDueAt.getTime(), retryAt.getTime()));
}
```

**The fold is the correctness point, not an implementation detail.** Today's unconditional
overwrite is safe *only* because `now` is always earlier than any real gate or backoff time — the
existing comment says exactly that, and it stops being true the moment the value is in the future.
Overwriting with `now + skipRetryMs` would mask a successful tenant's genuinely earlier gate. **That
comment must be rewritten, not preserved**; a comment that survives the change it describes is this
branch's most common defect.

`runDue` takes the same interval on its skip branch and leaves `deferred > 0 → now` exactly as it
is — capped work is genuinely runnable now, and draining a backlog fast is the intent:

```ts
result.nextDueAt =
  result.deferred > 0
    ? now
    : result.skipped.length > 0
      ? new Date(Math.min(earliestFuture, now.getTime() + deps.skipRetryMs))
      : earliestFuture === Number.POSITIVE_INFINITY
        ? null
        : new Date(earliestFuture);
```

`earliestFuture` is `Number.POSITIVE_INFINITY` when every pair skipped, and
`Math.min(Infinity, retryAt)` is `retryAt` — the every-pair-skipped case needs no branch of its own.

### 2.3 Where the constant lives

**One literal, in `@waitron/scheduler`'s `DEFAULTS`** (`packages/scheduler/src/derive.ts`):
`skipRetryMs: 5 * 60 * 1000`, alongside the five knobs already there.
[`apps/server/src/config.ts`](../../../apps/server/src/config.ts) reads it as the fallback for a new
`WAITRON_SKIP_RETRY_MS` through the existing `positiveInt`, and `ServerConfig` gains
`skipRetryMs: number`, which `boot.ts` passes to **both** duties.

`skipRetryMs` is a **required** field on both `DrainDeps` and `SchedulerDeps` — a caller that forgets
is a compile error, not a silent five minutes.

`@waitron/fiscal-verifactu` needs a default of its own regardless, so it gets one:
`DEFAULT_SKIP_RETRY_MS = 5 * 60 * 1000`, exported from `drain.ts`, behind an **optional**
`VerifactuBackendOptions.skipRetryMs`. `VerifactuBackend.drain` is a second entry point into the
same function, and making its option required would edit **57 construction sites across 10 files**
to configure a cadence knob none of them care about. The strictness stays where it is cheap —
`DrainDeps` itself, whose direct callers are `boot.ts`, `backend.ts` and three test files.

**So there are two defaults, equal in value, and that is deliberate rather than overlooked.** They
are two duties' independent cadences: nothing requires them to agree, and `apps/server` overrides
both from a single `WAITRON_SKIP_RETRY_MS`, so they can only diverge in a deployment that does not
use this host. This is *not* the `DUTY_BUDGET_MS` hazard, where two literals that merely happened to
agree flipped `/health` by construction — there the equality was load-bearing and unstated; here the
independence is the point. **No test pins them equal**: policing a copy with an assertion is the
pattern the `apps/server` cycle recorded as the wrong instinct twice over, and a test that fails
when someone deliberately splits the two cadences would be actively wrong.

**Why `DEFAULTS` and not a host constant** (revised during planning; the first draft put the literal
in `config.ts`): `DEFAULTS` is spread as a *complete* `SchedulerDeps` in five places —
`run.test.ts`, `resweep.test.ts`, `scheduler.rls.test.ts` twice, and `apps/server`'s own
`pass.rls.test.ts`. Adding a required field to `SchedulerDeps` while withholding it from `DEFAULTS`
would make that table silently incomplete and force a hand-written literal into each of those call
sites — strictly more copies than it saves. It is also the established direction: `boot.ts` carries
an explicit comment that it does **not** import `DEFAULTS` because "`loadConfig` already applied the
scheduler's defaults, so reaching for them again here would be a second source of truth", and
`config.ts` already sources all five scheduler fallbacks from it.

The host applying the scheduler's number to `drain` as well is deliberate and commented at the read
site: one operator-visible skip cadence for both duties. There is **no invariant requiring them to
be equal** — unlike the budget/ceiling pair `DUTY_BUDGET_MS` warns about, where two literals that
merely happened to agree flipped `/health` by construction — so a future deployment that needs them
split can add a second variable without unpicking anything.

**Why five minutes.** It is bounded below by not spinning and above by the legal cadence: twelve
retries inside art. 16.4's hour means a transient skip costs minutes out of that budget rather than
the whole of it, while a permanent one costs 288 passes a day instead of 17,280. No validation
against `minTickMs`/`maxTickMs` is added — a value below the floor clamps up and a value above the
ceiling clamps down, both harmlessly, and inventing a boot check for a non-invariant is worse than
none.

**2026-07-27 amendment (pre-merge review): the below-the-floor half of that paragraph was wrong.**
Being clamped up is not harmless — it is this section's own opening paragraph happening again.
`sleepMsFor`'s `Math.max(minTickMs, wait)` (`apps/server/src/loop.ts`) would silently round a
`WAITRON_SKIP_RETRY_MS` below `WAITRON_MIN_TICK_MS` back up to the floor, reproducing the exact
5-second-forever retry for an unprovisioned tenant that this whole design exists to remove — with
nothing in the config, the loop, or `/health` ever surfacing that the operator's chosen interval was
never actually honoured. `loadConfig` (`apps/server/src/config.ts`) now refuses to boot when
`skipRetryMs < minTickMs`, a structured `server.config_invalid` with `reason: "below_min_tick"`,
following the same shape as the `minTickMs > maxTickMs` guard already beside it. Equal to
`minTickMs` still boots — the clamp is a no-op there, so nothing configured is lost, only a value
the clamp would actually raise is rejected. **The above-the-ceiling half is unchanged and still
correct**: a `skipRetryMs` above `maxTickMs` clamps DOWN, which only means the interval is folded
against a `nextDueAt` no later than `maxTickMs` away — never a silent restoration of the pathology
this design removes — so that direction remains deliberately unvalidated. See
`apps/server/README.md`'s `WAITRON_SKIP_RETRY_MS` row and `config.test.ts` for the enforced
boundary.

**2026-07-27 amendment (final pre-merge review, F1): the paragraph directly above is itself
wrong — "never a silent restoration of the pathology" does not hold.** The claim treats
`maxTickMs` as fixed at its one-hour default, where clamping `skipRetryMs` down still leaves it
far above `minTickMs`. It is not fixed: an operator who sets ONLY `WAITRON_MAX_TICK_MS=5000` and
nothing else hits `minTickMs` defaulting to 5000 too, so `minTickMs > maxTickMs` is false;
`skipRetryMs` defaults to 300,000 (five minutes), so `skipRetryMs < minTickMs` is also false —
every guard in `loadConfig` passes, and the host boots. Then `sleepMsFor(now + 300000, now, 5000,
5000)` (`apps/server/src/loop.ts`) computes `Math.min(5000, Math.max(5000, 300000))` = **5000** —
the exact 5-second-forever spin for an unprovisioned tenant that this whole design exists to
remove, restored silently, by a single innocuous-looking env var. The milder, likelier form: any
`WAITRON_MAX_TICK_MS` below five minutes (`60000`, say — a natural "make the host more
responsive" setting) silently divides the configured skip cadence by up to 5×, with nothing
anywhere saying so. **Shipping this false safety assertion would have been worse than shipping the
unguarded knob it was describing.** `loadConfig` now also refuses to boot when
`skipRetryMs > maxTickMs` — a structured `server.config_invalid`, `reason: "above_max_tick"`
(reusing, not duplicating, the reason string the `minTickMs > maxTickMs` guard already uses two
paragraphs up), with both variables and both effective values in the error so it is actionable
whichever one the operator actually set. Equal to `maxTickMs` still boots, for the same no-op-clamp
reason equality is accepted at the floor. See `config.test.ts`'s below/equal/above boundary tests
and `apps/server/README.md`'s `WAITRON_SKIP_RETRY_MS` and `WAITRON_MAX_TICK_MS` rows, both updated
to name the enforced boundary from each side. Recorded here rather than silently rewriting the
paragraph above, matching this section's own amendment convention.

### 2.4 A property to state rather than hide

**The interval is a floor on the retry gap, not a guarantee of one.** If another tenant has
genuinely earlier work, `nextDueAt` is that earlier time and the skipped tenant is re-attempted then
— possibly far sooner than five minutes. That is correct: the host cannot sleep past real work to
honour a backoff. The bound on re-attempts is real work, not the skip interval.

For the first deployment — one tenant, no certificate, nothing else due — there is no earlier work,
so the gap is exactly the interval and the table in §1 holds.

## 3. `Agent` lifetime

`mtlsFetch` constructs `new Agent({ connect: { pfx, passphrase } })` per call and returns a closure
over it. `aeatClientResolver` calls it once per tenant per pass, and `resolveClient` is built **once
at boot** ([`apps/server/src/boot.ts`](../../../apps/server/src/boot.ts)) and reused for the process
lifetime. Nothing ever closes an `Agent`, so its sockets and timers accumulate for as long as the
host runs. A client certificate is an `Agent`-level TLS setting rather than a per-request one, so
one `Agent` per tenant is not avoidable — bounding its lifetime is.

`mtlsFetch` returns `{ fetch, close }`; `aeatClientResolver` returns `{ resolve, closeAll }`; and
the resolver is constructed **per pass** rather than at boot, so the set of `Agent`s to close is
scoped by construction and there is no residue between passes to reset:

```ts
drain: async (at2) => {
  const transport = aeatClientResolver({ db, ring, endpointFor, fetchFor: mtlsFetch });
  try {
    return await drain({ db, resolveClient: transport.resolve, skipRetryMs: config.skipRetryMs }, at2);
  } finally {
    await transport.closeAll();
  }
}
```

Three constraints on `closeAll`:

- **It must not throw.** A `finally` that throws replaces `drain`'s return value *or* its error —
  a cleanup path that eats the finding it was cleaning up after. Per-`Agent` failures are caught and
  logged (`transport.close_failed`, `warn`), and every `Agent` is attempted regardless of an
  earlier one failing.
- **`close()`, not `destroy()`.** Graceful. Nothing is in flight once `drain` has returned, so
  there is nothing to abort, and `destroy()` would tear down a socket mid-response if that
  assumption were ever wrong.
- **`@waitron/fiscal` is not touched.** `DrainDeps.resolveClient` keeps its exact
  `(tenantId) => Promise<VerifactuClient>` shape. mTLS is a deployment concern the fiscal package
  deliberately knows nothing about, and this change must not be the one that teaches it.

`aeatClientResolver`'s existing doc comment — "*One client per tenant per pass*" — becomes true of
the `Agent` as well as the client, which it currently is not.

## 4. Pass duration

`PassDeps` gains `monotonicMs: () => number`; `boot.ts` passes `performance.now`. Monotonic rather
than the wall clock already threaded through `runPass(deps, now)`, so an NTP step cannot produce a
negative or absurd duration in the one field an operator would use to spot a slow pass.

`pass.complete` gains `durationMs`. `attempt` also stamps each duty's own `durationMs` into the
`duties` array of that line — **an extension beyond §9**, which promises only a pass duration. The
reason: a single number cannot answer "which duty is slow", the question the field exists to answer,
and `attempt` is already the wrapper around exactly the interval that needs measuring.

## 5. `duty.degraded`

### 5.1 The ordering problem

§9 promises "*one line per anomaly, at a level that escalates with the consecutive-failure count*".
`consecutiveFailures` is computed by `recordPass` ([`apps/server/src/health.ts`](../../../apps/server/src/health.ts)),
which the loop calls through `onPass` **after** `runPass` has already emitted every one of its
lines. `pass.ts` cannot see the count without reading state that does not exist yet.

### 5.2 The fix

Emit the line where the count is known, not where the pass is.

`recordPass` returns `DutyRecord[]` — what it just recorded, per duty: `duty`, `skipped`, `parked`,
`consecutiveFailures`, `stale`, `lastOkAt`, and **`degraded`**. `logDegradedDuties(log, records)` is
exported from `health.ts` alongside it and emits one line per `degraded` duty. `boot.ts` composes
them:

```ts
onPass: (report, at) => logDegradedDuties(log, recordPass(health, report, at)),
```

`recordPass` stays pure and returns data; the logging policy lives in `health.ts` next to the rule
it depends on rather than loose in `boot.ts`; both halves are unit-testable without the other.

The payload carries `duty`, `consecutiveFailures`, `skipped`, `parked`, `stale` and `lastOkAt`, and
**not** `errorCode` — `duty.failed` already carries the throw's code at the moment it happened, and
a skip-only degradation has no duty-level code to report.

`degraded` is computed by `recordPass` and **not re-derived at the logging site.** The rule —
`ok: false`, *or* `ok: true` with `skipped > 0` or `parked > 0` — is already the condition in
`recordPass`'s own `if`, the one deciding whether `lastOkAt` advances. Returning it means the log
line and the health verdict cannot disagree about what "degraded" means, because there is only one
expression computing it. A second copy in `logDegradedDuties` is precisely the kind of duplicated
rule that drifts.

### 5.3 The level is derived from staleness, not from the count

**This amends §9.** The level is `error` when the duty is stale and `warn` when it is not, with the
count carried in the payload rather than deciding anything.

A count threshold's meaning drifts with the retry cadence — three consecutive failures is fifteen
minutes at a five-minute retry and three hours at an hourly one, so "three" would mean two different
things depending on §2's tuning. Staleness is time-based and immune to that, and it is **already**
the 503 criterion: deriving the level from `isStale` makes an `error` line and a 503 the same
condition by construction, instead of two thresholds that can disagree about whether the host is in
trouble.

The consequence, stated rather than left to be discovered: a duty that fails on the first pass after
boot logs `error` immediately, because `lastOkAt === null` reads as stale. That is the same instant
`/health` returns 503 for it — the two agree, which is the point.

### 5.4 An accepted trade-off: the outage case gets noisier

**§2's fix and this section's line are both wins for the *skip* case and, together, a genuine cost
for the *whole-duty-throw* case.** `pass.ts:213`'s `attempt` catch still reports `now` for a duty
that threw — deliberate, unchanged by this branch (§2.2's fix only touches the *skip* branch,
`deferred > 0` and a throw are untouched) — so the 5-second `MIN_TICK` floor survives exactly there.
A database outage makes BOTH duties throw, every pass, at that floor: before this branch, one such
pass logged four lines (`duty.failed` × 2, `pass.complete`, `loop.sleeping`); `duty.degraded` now
adds one more per duty — both are `ok: false`, hence `degraded` by `recordPass`'s own rule — so the
same pass logs six. At 17,280 passes/day that is ~69,120 lines/day before this branch and ~103,680
after, roughly a **1.5× increase**, with four of the six (`duty.failed` × 2, `duty.degraded` × 2
once each duty has been down long enough to read `stale`) at `error`.

So this branch cuts the *skip* case's daily volume roughly **50×** (§1's ~86,400 → this section's
~1,728) while growing the *outage* case's roughly **1.5×** — on the very same single-node disk §1
cites as the motivation for caring about log volume at all. **This is not a defect, and must not be
"fixed" by changing what a whole-duty throw reports.** `now` is the only honest answer a throw has
— whatever the duty was going to say died with it, per `attempt`'s own doc comment
(`apps/server/src/pass.ts`) — and slowing the outage retry to match the skip cadence would trade a
faster recovery from a transient database blip for a quieter disk during a rarer, worse failure
mode. Recorded here as an explicitly accepted trade-off, not something a future reader should
rediscover mid-outage and assume is a regression.

## 6. Documentation to rewrite

- **Server-host spec §9** — two amendments: the `durationMs` shape (pass-level and per-duty), and
  the level criterion (staleness, not the consecutive-failure count, with the reason from §5.3).
- **`DrainResult.nextDueAt`'s comment** and **`drain`'s skip comment** — the overwrite justification
  is void; see §2.2.
- **`TickResult.nextDueAt`'s comment**, including "*Mirrors `DrainResult.nextDueAt`*", which must
  stay true: both sides change together or the sentence lies.
- **`aeatClientResolver`'s doc comment** — "one client per tenant per pass" now covers the `Agent`.
- **`apps/server/README.md`** — `WAITRON_SKIP_RETRY_MS` in the variable table, and whatever it says
  about log volume in a degraded state.
- **The handoff's §7** — the terminal-outcome bullet is stale and the `Agent` coupling is wrong
  (§1). Corrected in the next handoff rather than by editing a dated document.

## 7. Testing

Unit tests throughout, on PGlite where a database is needed; **nothing here needs Docker.**

**Four existing assertions change, and each is a place the old behaviour was pinned deliberately** —
they must be rewritten with their comments, not merely re-baselined:
`run.test.ts`'s "reports a (tenant, duty) whose claim failed" (`nextDueAt` was `NOW`) and "reports
`now`, never `null`, when the snapshot read itself fails" (both the assertion and the test's *name*),
the "reports null only when there is no (tenant, duty) pair at all" comment that asserts in prose
that "a pair that throws reports `now`", and `drain.tenancy.test.ts`'s "reports nextDueAt: now when
every due tenant this pass was skipped" (name, comment block and assertion). A test whose name
still says `now` while it asserts an interval is the defect class this branch keeps finding.

**`@waitron/fiscal`** — the fold: a skipped tenant with no other work reports `now + skipRetryMs`; a
skipped tenant alongside a successful tenant whose gate is *earlier* reports the gate, not the
interval (the assertion that would have caught an overwrite); one whose gate is *later* reports the
interval.

**`@waitron/scheduler`** — the same three, plus `deferred > 0` still reporting `now` even with a
skip present (the branch that must not change), and every-pair-skipped reporting the interval
through the `Infinity` path.

**`apps/server`** — `durationMs` present at pass level and per duty, from an injected `monotonicMs`
so the value is asserted rather than merely non-negative; `logDegradedDuties` emitting `error` when
stale and `warn` when not, nothing for a clean duty, and a line for `ok: true, skipped > 0`;
`config` parsing and defaulting `WAITRON_SKIP_RETRY_MS`; the resolver calling `close` once per
`Agent` built; and **a throwing `close` leaving `drain`'s result intact** — the §3 constraint that
is invisible until it is violated.

## 8. Out of scope

- **C3, the webhook endpoint.** Its own cycle; the tenant-discovery-before-signature-verification
  decision is unresolved.
- **The four remaining §7 one-liners** — `bin.ts`'s missing `try`/`catch`, bind-scoping
  `server.listen_failed`, validating that `WAITRON_MIGRATIONS_DATABASE_URL` and `DATABASE_URL`
  address the same database, and `packages/db`'s `onPoolError`.
- **Per-tenant health.** `/health` models one boolean per duty and continues to.
- **Cross-pass `Agent` reuse.** Considered and rejected: it would cache what the design
  deliberately does not cache — credentials are read per pass so a rotation needs no restart — and
  the cache-key fingerprint would become load-bearing for that property, to save one TLS handshake
  per tenant per hour.
- **Per-tenant skip backoff, error-code classification, and a persisted skip ledger.** All three
  were considered for §2 and rejected as more machinery than a bounded retry interval earns; the
  ledger option additionally reopens the settled decision that `drain` cannot be a ledger duty.
