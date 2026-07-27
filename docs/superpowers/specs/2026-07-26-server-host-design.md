# `apps/server` — the host process and its scheduler loop

**Date:** 2026-07-26
**Status:** Approved in brainstorming.
**Sub-project:** C (first half). Follows A (`packages/credentials`, landed `9e85d8a`); B (`DueAtDuty`)
was cancelled — see [`2026-07-26-provider-tenant-scoping-landed.md`](../../handoffs/2026-07-26-provider-tenant-scoping-landed.md) §2.

Amends [`2026-07-25-recurring-work-scheduler-design.md`](2026-07-25-recurring-work-scheduler-design.md)
§2's honest cost (*"nothing runs until that host exists"*) and its §8 (the reconcile adapter's owner).

---

## 1. What this is, in one idea

**A repository of tested behaviour has no process to run in.** This design builds the first one:
`apps/server`, a long-running Node process that boots, reads per-tenant credentials from the vault,
and drives the two duties with a durable obligation — the fiscal `drain` and the Stripe payments
reconcile — on a cadence it derives from what those duties themselves report.

It owns **no tables and no domain logic.** Everything it drives already exists and is already
tested. What is new is composition, configuration, cadence, lifecycle and packaging.

The single most important thing it changes about this repository: after this cycle, the legally
load-bearing hourly submission duty (art. 16.4) has a caller.

## 2. Scope: sub-project C is four subsystems, and this is two of them

| | Piece | This cycle |
| --- | --- | --- |
| C1 | Process skeleton — `apps/server`, config, keyring, pool, lifecycle, esbuild bundle | **yes** |
| C2 | Scheduler loop — `drain`'s caller, `runDue` + the payments-reconcile adapter, monitoring | **yes** |
| C3 | Webhook HTTP endpoint — per-tenant Stripe signature verification, then resolve → settle → chain → associate | no |
| C4 | The AEAT transport | **partly** — built and locally verified (§3.2, §5, §12); the round-trip is cert-blocked |

**C3 is deferred to its own cycle, not because it is small but because it is not.** Verifying a
Stripe signature requires *that tenant's* signing secret, while the tenant is only discoverable from
the payload that has not been verified yet. That is a design decision (tenant-in-the-path versus
per-secret trial versus a shared endpoint), it is Mode-3-only, and no till in this repo uses hosted
Checkout. The `/health` route this cycle adds gives it a server to attach to.

**`forward` is not in this cycle, and not in this process at all.** The handoff recorded it as
*"waiting on a consumer … i.e. on the host"*, which is right about the shape and wrong about the
host. `forward`'s work is `syncOfflineQueue`, which reconciles our pending refs against the
**device-local** offline queue through the on-device SDK; `apps/server` has no device, and
`device-provider.ts` documents the server-driven adapter's `forward` as all-zeros. Its consumer is
`apps/till`, and `FORWARD_RETRY_MS`'s cadence decision goes with it.

## 3. The decisions this design rests on

Taken in the brainstorm, recorded so a later reader can see they were choices.

**1. Long-running, sleeping on `nextDueAt`.** `runDue` and `drain` both compute and return the
earliest time work next appears, and both documents say the host decides cron versus long-running.
This host obeys that answer rather than logging it. It keeps ONE process for the standalone deli
(scheduler design §2), it needs no OS-level timer to be configured correctly for a legal duty to be
met, and a backoff that asked for a sooner or later wake gets one. **Honest cost:** a wedged
process is a silent breach until something notices, which is what §9 exists for.

**2. The AEAT transport is built from vault material now, not stubbed.** `packages/verifactu`
already ships the real SOAP client with `fetch` injected precisely so mTLS stays outside it. What
remains is small — read the PFX from the vault, build an undici `Agent`, pick the endpoint — and it
is testable without AEAT (§12). Stubbing it would ship a host that could not submit even if a
certificate arrived the next morning.

**3. Visibility is structured stdout plus one `/health` route.** `recordIncident` cannot carry a
host-level failure — `incidents.till_id` is `NOT NULL` and `drain` has no till — which is why the
provider-scoping handoff assigned durable visibility of a persistently-failing `drain` to
monitoring. Logs alone cannot distinguish up-but-stuck from healthy without parsing; a durable
`host_pass` table would give this package the schema it exists not to own. A route can be asked.

**4. A per-tenant client resolver, not one client per process.** §4. This is a correctness fix, not
a preference.

**5. Credentials are read per pass, never cached.** §6.

## 4. The change outside `apps/`: `drain` submits every tenant with one certificate

`VerifactuBackendOptions.client` is a single `VerifactuClient`, and `drain(deps, now)` loops over
every tenant `envios_tenants_with_work` returns, passing `deps.client` to each `drainTenant` call.
With per-tenant `fiscal.aeat` certificates in the vault, that presents tenant B's invoices under
tenant A's seal — the wrong presenter for the `Cabecera`'s declared obligado, and a rejection at
best. The chains themselves are per-tenant in the database and unharmed; what breaks is who AEAT
believes is submitting, on every batch, for every tenant but one.

Nothing has caught it because nothing has ever constructed a second tenant's backend: `drain`'s
whole test surface runs one certificate, and one certificate is indistinguishable from the right
number when there is only one tenant.

**The fix is the pattern this repo already uses twice** — `StripeReconcilerOptions.resolveAccount`
and `StripeTerminalProviderOptions.resolveReader`, both a function of `tenantId` for exactly this
reason:

```diff
- client: VerifactuClient
+ resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>
```

on `DrainDeps`, and correspondingly on `VerifactuBackendOptions`. `drainTenant` already receives
`tenantId`, so the change is threading one call through, not restructuring.

**`drain` also needs exporting.** It is absent from `packages/fiscal-verifactu`'s barrel; the only
route is `VerifactuBackend.drain(now)`, which requires constructing a backend — and therefore a
`TrustedClock` and a `db` handle `drain` never uses — per process. The host calls `drain` directly.

**One regulatory question is open, and the resolver is correct under either answer.** Whether one
node's certificate may lawfully submit on behalf of many issuers is asked of the asesor and
unanswered ([`asesor-questions.md`](../../compliance/asesor-questions.md) §97).
A deployment that learns a shared
certificate is permitted returns the same client for every tenant; the resolver does not care. A
single fixed client cannot express the other answer at all, which is why this is not "wait and see".

## 5. The endpoint depends on the certificate's kind, so the purpose grows a field

`SOAP_ENDPOINTS_SELLO` is a **different host** from `SOAP_ENDPOINTS` — `www10`/`prewww10` rather
than `www1`/`prewww1`. So the endpoint is a function of the certificate's kind, which is per-tenant
data, and `PURPOSES["fiscal.aeat"]` carries only `pfxBase64` and `passphrase`.

`fiscal.aeat` gains `certKind` (`"sello"` | `"representante"`), validated by the existing
exact-match `validatePayload`. This is precisely the change [`purposes.ts`](../../../packages/credentials/src/purposes.ts)
anticipated when it marked the purpose PROVISIONAL: *"the payload is an opaque blob, learning the
real answer changes this list — not a migration"*. It is cheap while nothing is provisioned and
awkward afterwards, because `validatePayload` rejects extras and omissions in both directions.

The alternative — inferring the kind by parsing the PFX's certificate — puts X.509 policy-OID
knowledge in the host to avoid one provisioning field. Rejected.

### 5.1 Adding the field forces the deferred `rotate`/read decision, so this cycle takes it

The credentials handoff asks that `rotate`'s coupling to `PURPOSES` **be decided before sub-project C
lands**. Adding `certKind` is precisely the edit that makes it bite, so the decision cannot be
deferred past this design:

- **Write side:** `rotateCredentials` re-runs `validatePayload`, so a row sealed under the old
  two-field list aborts the sweep mid-vault — and that can block retiring a compromised key.
- **Read side (the twin Copilot found):** reads validate nothing, so such a row returns a payload
  whose `certKind` is `undefined`. Left alone, the host would silently select the non-sello endpoint
  for a sello certificate and every submission for that tenant would fail at a wrong host, with no
  statement anywhere about why.

**The decision: the host validates the payload it reads, at its own read site, and fails that tenant
loudly.** Not in the store — that is the option the handoff correctly warns extends the blast radius
from "blocks rotation" to "takes the vault offline". The host reads one tenant per purpose per pass
and already has a report-and-continue path for exactly this shape of finding (§6), so a stale row
costs that tenant's duty for that pass, says so, and leaves every other tenant served.

That leaves `rotate`'s write-side coupling as a genuine known limit rather than a surprise: a
field-list edit still requires re-provisioning affected rows before the next rotation. It is
harmless today because nothing is provisioned, and the cheapness of that fact is the argument for
adding the field now rather than after the deli is live.

`VerifactuBackendOptions.environment` (which selects the QR validation host, defaulting to
`"production"`) must be fed from the same config value as the SOAP endpoint. Nothing in this cycle
calls `recordSale`, so no QR URL is built here yet; the coupling is stated so the till cycle does
not rediscover it.

## 6. Tenant enumeration and credential lifecycle

**The vault is the enrolment list.** `credentialTenants(db, "payments.stripe")` gives reconcile its
tenant set, through the `credential_tenants` SECURITY DEFINER seam that already exists for this
purpose — its own doc names the host as the caller. No new enumeration seam, no separate notion of
"which tenants are configured for Stripe", and a tenant nobody provisioned is not half-served.

**`drain` keeps enumerating its own** through `envios_tenants_with_work`, because it must: the
scheduler handoff records why that duty cannot be keyed per tenant in a ledger.

**A tenant with due fiscal work and no `fiscal.aeat` credential is reported every pass, loudly, and
never silently skipped.** That combination is an unsubmittable legal obligation and it is the single
most important thing this process can say. It is the one place where the absence of configuration is
itself the finding.

**Credentials are read per pass, not cached at boot.** The cost is one decrypt and one `Agent`
construction per enrolled tenant per pass, at a cadence measured in minutes. What it buys: a newly
provisioned tenant is served without a restart, a rotation takes effect without a restart, and
decrypted secrets live for one pass rather than for the process's lifetime. A cache keyed on
`updated_at` would need a cross-tenant read of a column `credentialTenants` deliberately does not
return.

## 7. One pass, and the sleep between passes

```text
pass(now):
  1. drain({ db, resolveClient }, now)          -> DrainResult
  2. runDue({ db, duties: [reconcileStripe], … },
            credentialTenants(db, "payments.stripe"),
            now)                                -> TickResult
  3. fold both nextDueAt, emit one log line, update health state
```

**Order is fixed: `drain` first, unconditionally.** It is the duty with a legal clock. A reconcile
sweep that is behind must never delay it.

**Sleep** is `clamp(min(nextDueAt) − now, MIN_TICK, MAX_TICK)`:

- `MAX_TICK` = 1 hour — a **liveness floor**, not a performance knob. `drain`'s own hourly duty must
  not be lengthened by a quiet ledger or by a `nextDueAt` computed from state that has since changed
  underneath the process (a till writing a sale, an operator provisioning a tenant).
- `MIN_TICK` = 5 seconds — stops a hot loop when a duty reports `now`, which both do for deferred
  or skipped work by design.

**2026-07-27 amendment (degraded-pass cadence review): skipped work no longer reports `now`.**
`deferred > 0` still does — capped work is genuinely runnable immediately, and draining a backlog
fast is still the intent, so that half of the bullet above is unchanged. A **skipped** tenant
(`fiscal.drain`) or (tenant, duty) pair (`payments.reconcile.stripe`) instead reports
`now + WAITRON_SKIP_RETRY_MS` (default five minutes), folded as a MINIMUM against whatever a
successful tenant or pair computed the same pass — because a skip is frequently not transient, and
`now` pinned this host at `MIN_TICK`'s five-second floor forever for exactly the tenant a human has
not yet provisioned a certificate for. `MIN_TICK` itself, and its role for `deferred` work and for a
whole-duty throw (§8), is unchanged. Full reasoning: §9's own amendment on `duty.degraded`, and
`apps/server/README.md`'s `WAITRON_SKIP_RETRY_MS` row.

**Folding is the minimum of the NON-NULL answers.** Each duty reports `null` for "no work exists at
all", which is not a time and must not win a `Math.min` against one: a `null` from reconcile while
`drain` has a batch due in ten minutes must sleep ten minutes, not an hour. `null` from both means
there is no work anywhere — sleep `MAX_TICK`.

**`runDue`'s duty list is one entry.** `payments.reconcile.stripe` is the only settlement identity
that exists. The list is a list because `runDue` takes one and a second provider adds an entry
rather than a code path.

## 8. Failure containment is asymmetric, deliberately

**Inside the loop, nothing escapes.** Each duty call is wrapped: the error's structured code is
recorded, its consecutive-failure counter increments, health state updates, and the loop sleeps and
tries again. Letting a throw out would end the hourly retry on one transient database blip — the
exact failure `TickResult.nextDueAt`'s "a skipped pair is due NOW" semantics were written to
prevent (superseded by §7's 2026-07-27 amendment above — a skipped pair now reports
`now + skipRetryMs`, folded as a minimum, not `now`). A duty that fails forever is therefore
*visible* (§9) rather than *fatal*.

**At boot, everything escapes.** Invalid config, an unloadable key ring, a failed migration, an
unreachable database: log the structured code and exit non-zero. A host that boots half-configured
and retries in the background is a host whose operator believes it is working. The supervisor
(systemd, Docker restart policy) decides what a non-zero exit means.

**SIGTERM/SIGINT** finish the pass in flight, close the pool, close the HTTP listener, exit zero.
Duties are already crash-safe — `drain`'s T1/T2 split and the ledger's stale-reclaim exist for the
harder case — so this is politeness, not correctness, and it must not become a reason to abandon a
partially-submitted batch.

## 9. What the process makes visible

**One structured JSON line per pass** on stdout: pass duration, `drain`'s counters, `runDue`'s
`ran`/`deferred`/`beyondHorizon`/`skipped`, the chosen sleep, and the folded `nextDueAt`. One line per
anomaly, at a level that escalates with the consecutive-failure count. Never prose, matching the
repo's structured-code convention.

**`GET /health`**, the only route this cycle:

```json
{
  "ok": false,
  "startedAt": "2026-07-26T08:00:00Z",
  "lastPassAt": "2026-07-26T09:14:02Z",
  "duties": {
    "fiscal.drain": { "lastOkAt": "…", "consecutiveFailures": 7, "skipped": 1, "parked": 0, "stale": true },
    "payments.reconcile.stripe": { "lastOkAt": "…", "consecutiveFailures": 0, "skipped": 0, "parked": 0, "stale": false }
  }
}
```

`200` when every duty is within its staleness budget, `503` otherwise — `drain`'s budget is the
legal cadence plus deliberate slack over the sleep ceiling (`DUTY_BUDGET_MS`, `health.ts`; see I1 of
the 2026-07-26 whole-branch review for why an exact one hour was wrong), reconcile's is 26 hours (a
daily period plus slack). A `503` is what turns up-but-stuck into a signal an uptime check can see.
Nothing else is served: no metrics endpoint, no readiness/liveness split, no auth, no webhook.

**`skipped` (C2 of the 2026-07-26 whole-branch review) counts tenants the duty abandoned THIS pass
even when the duty's own report otherwise reads as a success.** Before this field existed, a duty
that returned normally with a non-empty skip list still read `ok` and refreshed `lastOkAt` — so a
tenant with due fiscal work and no usable certificate accumulated `pendiente` rows past its art.
16.4 hour indefinitely while this endpoint answered `200`, with nothing but a `warn` log line to
show for it. A duty with `skipped > 0` is now treated as NOT ok: `lastOkAt` does not advance and
`consecutiveFailures` increments, however many other tenants were served that pass — per-tenant
health is not something this endpoint models (§6/§7's own framing: the absence of configuration IS
the finding), only per-duty.

**2026-07-27 amendment (pre-merge review): a terminal outcome has no representation above, one
duty over.** This section's own log-field list and health-input list, as originally written,
describe `runDue`'s `ran` only as a bare count and name `skipped` as the one thing that can make an
`ok: true` report read as not-ok. Both were incomplete: `RunRecord.outcome` (`packages/scheduler`)
can be `"succeeded"`, `"failed"` or `"parked"`, and a `"parked"` run — `next_attempt_at` written
`null`, nothing will claim that (tenant, duty, period) again — is exactly as terminal as a skipped
pair, reachable the identical way (three consecutive `"failed"` attempts against, say, a credential
rotated out from under the key ring mid-window), and was invisible to both this endpoint and the
log line before this amendment. The original reasoning above is UNCHANGED by this — it is extended:

- **The pass-summary log line** (this section's opening paragraph) now breaks `ran` down by outcome
  — `{ succeeded, failed, parked }` — in `reconcile.complete`, and emits one line per non-succeeded
  run: `reconcile.run_failed` (`warn`) or `reconcile.run_parked` (`error`), each carrying
  `errorCode` and enough identity (`tenantId`, `duty`, `period`) to act on.
- **The health-input list** gains `parked`, read the identical way `skipped` already is (this
  section's closing paragraph, `health.ts`'s `recordPass`): `ok: true, parked > 0` is NOT ok.
  `parked` deliberately excludes `"failed"` — a failed run still has a `next_attempt_at` and is
  retried on its own backoff, and flipping health on it would make an ordinary transient retry
  produce the same `503` as a genuine, permanent abandonment.
- **`fiscal.drain` gets no equivalent field.** `DrainResult` has no run-level terminal outcome at
  all — `packages/scheduler/src/duty.ts`'s own doc comment records why `drain` cannot use this
  ledger in the first place. A halted fiscal record is visible a different way instead: it is
  already written to the `incidents` table (tenant/till/sale-scoped, its own code and severity) the
  moment it happens, a persisted trail a parked reconcile run has no equivalent of, and it is not
  necessarily a system failure the way an abandoned run is — a rejected record can be a genuine
  per-invoice data problem. `apps/server/README.md`'s opening section states this boundary
  precisely; §9's own body above is the reason it can.
- **The `/health` example above** was also missing `stale` (the code has always emitted it) — added
  in the same edit as `parked`, both now present.

**2026-07-27 amendment (degraded-pass cadence review): `durationMs` exists now, and goes further
than this section originally promised.** This section's opening paragraph named "pass duration" as
one of the fields the per-pass line carries, without specifying its shape. It is `durationMs` on
`pass.complete` itself — but ALSO, beyond what the opening paragraph promised, one `durationMs`
inside EACH entry of `duties`, because a single pass-level number cannot say WHICH duty was slow: a
stretched database round-trip inside `drain` and a stretched Stripe call inside
`payments.reconcile.stripe` produce the identical pass-level total, and only the per-duty figure
tells them apart without a reader correlating against each provider's own latency separately. Both
are read off a MONOTONIC clock (`PassDeps.monotonicMs`, wired to `performance.now` in `boot.ts`),
deliberately not the wall-clock `now` a pass already takes as a parameter — an NTP step mid-pass
could otherwise turn the one field an operator uses to spot a slow pass negative or absurd. The
per-duty figure is present even when a duty THREW: elapsed time is real either way, unlike
`skipped`/`parked`, which a throw genuinely has no honest value for (`pass.ts`'s own comment on
`attempt`).

**2026-07-27 amendment (degraded-pass cadence review): the escalating level is derived from `stale`,
not the consecutive-failure count this section's opening paragraph named.** A count threshold means
a different amount of elapsed TIME depending on which retry cadence is in effect: three consecutive
failures is fifteen minutes at `WAITRON_SKIP_RETRY_MS`'s five-minute default and three hours at an
hourly one, so "three" would silently mean two different degrees of trouble depending on a value an
operator sets independently of this line. `stale` (this section's own `DutyHealth`/`isStale` above)
is time-based already, and is ALREADY the exact criterion `/health` returns `503` on — deriving the
anomaly line's level from it, rather than from the count, makes an `error` line and a `503` the same
condition BY CONSTRUCTION, not two thresholds that can independently disagree about whether this
host is in trouble. The count still ships in the line's payload; it no longer decides anything.
Consequence, stated rather than left to be discovered: a duty that fails on the FIRST pass after
boot logs `error`, not `warn`, because `lastOkAt === null` reads as stale — the identical instant
`/health` starts answering `503` for it, which is the point, not a flaw in the threshold.

This line is also a NEW event, `duty.degraded`, carrying `{ duty, consecutiveFailures, skipped,
parked, stale, lastOkAt }` — one per degraded duty per pass, `error` when `stale`, `warn` otherwise.
It is emitted from `health.ts`, the health-RECORDING site (`logDegradedDuties`, called by
`boot.ts`'s `onPass` immediately after `recordPass`), rather than from `runPass` (`pass.ts`) the way
this section's opening paragraph might suggest. `recordPass` is what computes the fresh
consecutive-failure count and the fresh `stale` reading for this pass; `runPass` cannot log at the
level those numbers justify because it emits its own lines (`drain.complete`, `pass.complete`, and
the rest) BEFORE `recordPass` ever runs — the count `runPass` could see would always be the
PREVIOUS pass's, never this one's. The loop calls `onPass` only after `runPass` has already
returned and logged, which is exactly what makes the count `logDegradedDuties` reads current rather
than stale by one pass.

## 10. Configuration

Environment only, matching `packages/credentials`' `bin.ts`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Must be the non-superuser deployment role. Same name `bin.ts` reads. |
| `WAITRON_MIGRATIONS_DATABASE_URL` | no | The connection `applyMigrations` runs over. **Defaults to `DATABASE_URL`.** Named separately because the two roles' required grants are not the same set — see §11. |
| `WAITRON_CREDENTIALS_KEY*` | yes | **Not redeclared** — `process.env` is passed straight to `loadKeyRing`, which owns those four names and their validation. |
| `WAITRON_AEAT_ENV` | no | `preproduction` \| `production`. **Defaults to `preproduction`.** |
| `WAITRON_HTTP_PORT` | no | Default 8080. |
| `WAITRON_HTTP_HOST` | no | Default `127.0.0.1`. `/health` is deliberately unauthenticated (§9), which is fine on a loopback listener and less fine on every interface — see I7 of the 2026-07-26 whole-branch review. |
| `WAITRON_MIN_TICK_MS` / `WAITRON_MAX_TICK_MS` | no | §7's clamps. |
| `WAITRON_SKIP_RETRY_MS` | no | **2026-07-27 amendment** — §7's amendment. How long after a skipped tenant (`fiscal.drain`) or (tenant, duty) pair (`payments.reconcile.stripe`) either duty reports work due again, folded as a minimum against whatever the successful tenants computed. Defaults to `@waitron/scheduler`'s own `DEFAULTS.skipRetryMs` (five minutes). One value, sourced to both duties. |
| `WAITRON_MIGRATIONS_DIR` | no | The migrations root §11 resolves folders from. **Defaults to `<bundle directory>/drizzle`** (`DEFAULT_MIGRATIONS_ROOT`, `boot.ts`) — named here explicitly because §11 originally called the root "overridable" without saying by what (I8 of the 2026-07-26 whole-branch review). |
| `WAITRON_SETTLEMENT_LAG_MS` | no | Passed to `StripeReconcilerOptions`; defaults to the neutral layer's seven days. |
| `WAITRON_SCHEDULER_*` | no | `horizonDays`, `maxPeriodsPerTick`, `maxAttempts`, `backoffBaseMs`, `staleAfterMs` — `SchedulerDeps`' fields, defaulted from `DEFAULTS`. |

**`WAITRON_AEAT_ENV` defaults to the safe value and production must be typed explicitly.**
Architecture §9 records that production numbering can never be reused even for test invoices, so
this is the one default in the file whose mistake is irreversible.

Validation is at boot, once, with a structured code per failure — the same posture `loadKeyRing`
takes and for the same reason.

## 11. Migrations at boot, behind an advisory lock

The host applies all migration sets — `CORE_MIGRATIONS`, `FISCAL_MIGRATIONS`, `PAYMENTS_MIGRATIONS`,
`SCHEDULER_MIGRATIONS`, `CREDENTIALS_MIGRATIONS` — at boot, over `WAITRON_MIGRATIONS_DATABASE_URL`
(§10). Drizzle's runner is journal-tracked and idempotent, so this is a no-op on a current database.

It is serialised behind a `pg_advisory_lock` the host takes itself, so two replicas starting
together cannot race the same journal — rather than a verify-or-refuse mechanism that would have to
reimplement the journal comparison Drizzle already does. The lock and the migration statements run
over the SAME connection string (`applyMigrations` opens its own short-lived `Database` from it,
separate from the long-running pool `DATABASE_URL` opens) so the lock's session-scoping actually
serialises whoever is about to migrate, not whoever happens to hold the unrelated pool.

**Why the connection is split from `DATABASE_URL` at all — C1 of the 2026-07-26 whole-branch
review.** §10's "must be the non-superuser deployment role" and "migrations run at every boot" are
not jointly satisfiable by ONE role. Against an already-migrated database, Postgres checks the
`CREATE`/`SELECT` privilege Drizzle's migrator needs BEFORE it evaluates any `IF NOT EXISTS`, so a
role carrying only ordinary duty-level grants fails on the first statement even though every
migration is a no-op. Against an empty database, the migrations that create `app_user` and its four
sibling support roles need `CREATEROLE` and a temporary ownership-transfer dance no duty-level role
can perform. `WAITRON_MIGRATIONS_DATABASE_URL` lets a deployment run migrations under a role that can
do both, while `DATABASE_URL` stays the least-privileged one this section already required.
`apps/server/README.md` has the concrete grant lists for both cases — the already-migrated one
empirically checked against a real Postgres container in `boot.test.ts`, the empty-database one
verified by hand while writing that document. It is this design's own §10, not a separate concern:
read it before deploying against a database this process has never touched.

**The descriptors cannot be used as-is from a bundle.** Every `*_MIGRATIONS` constant computes
`migrationsFolder` from its own `import.meta.url`, so under esbuild all five collapse onto the
bundle's directory and resolve to a `drizzle/` folder that does not exist — working in development
and failing at boot in the shipped artefact, which is the worst available failure mode. The host
therefore resolves folders from a **migrations root** (next to the bundle by default, overridable),
takes only the `migrationsTable` names from the packages, and the build copies each package's
`drizzle/` in beside the bundle. One manifest is the single source of truth for both the runtime
resolver and the copy step, and a test pins its table names against the packages' own descriptors so
a rename fails loudly here.

A migration failure is a boot failure (§8).

## 12. Testing

No new domain behaviour, so every test here is about composition, configuration and lifecycle.

- **Config** — table-driven parse and validate; every failure code reachable, per the repo's
  reachability convention.
- **The mTLS transport, against a locally generated CA.** A Node HTTPS server configured with
  `requestCert: true, rejectUnauthorized: true`, a self-signed CA, and a client PFX minted in the
  test. Asserts the vault-PFX → `Agent` → `fetch` path completes a real client-certificate
  handshake, that a client with no cert is rejected, and that the `certKind` → endpoint selection
  picks the sello host for a sello certificate. **This is the part the missing AEAT certificate does
  not block**, and it is the whole of what could be got wrong locally.
- **One pass on real Postgres as the non-superuser `app_user` role**, both duties wired to fakes
  (`createFakeAeat().client()` and the fake settlement report), asserting the `scheduled_runs` rows
  written and the folded `nextDueAt`. This is not optional and it is not belt-and-braces: PGlite
  connects as superuser and bypasses `FORCE ROW LEVEL SECURITY`, which has hidden a real defect in
  three consecutive cycles, and this is the first code in the repo that runs as the deployment role
  for real. The provider-scoping handoff's first carried-forward pattern — *an RLS suite must make
  the shipped object its subject at least once* — applies to the pass, not to the stores it calls.
- **A tenant with due fiscal work and no credential** is reported, with the pass still succeeding
  for every other tenant (§6).
- **A credential payload sealed under the old field list** — `certKind` absent — fails that tenant
  loudly at the host's read site rather than silently selecting a host, and the pass still serves
  every other tenant (§5.1).
- **The loop**, with injected clock and sleep: computed durations, both clamps, `null` from both
  duties, SIGTERM mid-pass, and — explicitly — that a duty throwing does not stop the loop.
- **Health**: staleness crossing a budget flips `200` to `503`; consecutive failures surface.
- **The reconcile adapter** moves here from `packages/scheduler/src/payments-fit.test.ts` with its
  existing assertions. That file stays as the structural type proof it was written to be.

## 13. A guard that must be extended, decided rather than discovered

`packages/db`'s `english-only.ts` enumerates `GENERIC_PACKAGES` explicitly and scans
`packages/<name>`, so **`apps/server` escapes it silently** — the identical trap the scheduler cycle
hit, which its design §3 called out as *"part of this work, not a follow-up"*.

`apps/server` is a genuinely mixed case: it must name `fiscal.aeat`, reach `drain`, and read
`envios`-derived results. The decision to make explicitly, either way, is whether the scan extends
to `apps/*` with an exemption for the fiscal vocabulary the host legitimately names, or whether the
host is recorded as out of the guard's scope and why. Silence is the one unacceptable outcome.

## 14. What this does not do

- **The webhook endpoint** (C3) — its own cycle, per §2.
- **`forward`** — `apps/till`'s, per §2, along with `FORWARD_RETRY_MS`'s cadence, the empty-queue
  `nextDueAt: null` hole, and the unresolvable-ref bound.
- **The AEAT round-trip.** The transport is built and locally verified; first contact with
  preproduction needs a certificate that [`getting-to-production.md`](../../compliance/getting-to-production.md)
  records as unobtained, unpriced, and of unverified exportability for unattended server use. **No
  code shortens that path.**
- **Sync intake, the wire protocol, auth, the till and dashboard apps** — architecture §8's
  `apps/server` in full is much more than this. This process is a background worker that will later
  also receive webhooks.
- **A remediation UI**, and therefore no time bound on a gated drift orphan's fund-hold — the
  scheduler design's decision 4, unchanged. This host makes the hold's age computable and tells
  nobody in particular.
- **Fixing `rotate`'s write-side coupling to `PURPOSES`.** §5.1 takes the decision the credentials
  handoff asked for and closes the read side, which is the half that would otherwise fail silently.
  The write side stays a documented limit: a field-list edit still needs affected rows
  re-provisioned before the next rotation.

**2026-07-27 addendum (Task 12), what the plan's own closing task discovered and left:**

- **`apps/server/src/testing/postgres.ts`'s `startRealPostgres` is a sixth verbatim-shaped copy** of
  the same helper, which now also exists in `packages/{payments,payments-stripe,fiscal-verifactu,
  scheduler,credentials}/src/testing/postgres.ts`. **`apps/server/test/seed.ts` is a smaller claim,
  corrected here**: it is byte-identical to `packages/scheduler/test/seed.ts` and near-identical to
  `packages/credentials/test/seed.ts` (differs only in the NIF prefix constant) — three 22-line
  copies of the same minimal fixture, not six. `packages/payments/test/seed.ts` (132 lines) and
  `packages/fiscal-verifactu/src/testing/seed.ts` (264 lines) are much larger, differently-shaped
  fixtures for their own domains that merely share the `freshNif` naming pattern, not the file. Both
  halves are blocked on the same thing the credentials cycle already found and deferred:
  `@waitron/db` has no `exports` map, so a package outside `packages/db` cannot import its
  `src/testing/*` helpers directly. Not this plan's to fix.
- **The per-tenant undici `Agent` `mtlsFetch` builds is never closed.** One per tenant per pass, each
  with its own TLS connection pool, bounded only by undici's idle keep-alive rather than an explicit
  lifecycle. Deferred at Task 4 specifically because closing it means changing what `mtlsFetch`
  returns, which reaches into the boot wiring Task 11 (and, transitively, this task's `boot.test.ts`)
  built on top of — still true after both.

  **Superseded 2026-07-27 (degraded-pass cadence review): no longer true.** The resolver is now
  built per pass rather than at boot, and its `closeAll` closes every `Agent` it built before the
  pass returns — see [`2026-07-27-degraded-pass-design.md`](2026-07-27-degraded-pass-design.md) §3
  and `aeat-transport.ts`'s `closeAll`, called from `boot.ts`'s per-pass `drain` closure's own
  `finally`. Recorded here rather than silently edited above, matching this file's own §7/§8/§9
  amendment convention.
- **`ALL_DUTIES` (`pass.ts`) is still a manual step.** Nothing forces a new `*_DUTY` const to be
  appended to it; Task 9's own review accepted this as downgraded rather than closed, because
  forgetting is now LOUD (an unlisted duty reads permanently stale in `/health`, a 503 that will not
  clear) rather than silently healthy forever. Unchanged by this task.
- **The shutdown path's automated coverage is now split, not absent.** `boot.ts`'s own `close()`
  sequence — abort the loop, close the listener, drain the pool, the new idempotency guard — had no
  test subject before this task; `boot.test.ts` closes that gap directly, against a real container.
  What remains uncovered is one layer up: `bin.ts`'s SIGTERM/SIGINT handling (the `once` guards, the
  shared latch against a losing concurrent signal) is still a documented MANUAL check, per Task 11's
  own ruling that a flaky timing test would be worse than an honest gap.
- **The capstone's (`pass.rls.test.ts`) deliberate narrowings**, carried forward rather than closed:
  it seeds zero `envios` rows, so `drain`'s WRITE path never runs under the probe role from this
  host — `packages/fiscal-verifactu/src/drain.concurrency.test.ts` already covers that write path
  under its own `app_user` probe, so the gap is redundancy avoided, not a hole. And the ledger-row
  assertion reads `scheduled_runs` as `admin` (the container's superuser default), not as the probe
  — the probe's own authorship of that row is established by elimination (the probe is the only
  role that touched the tenant-scoped connection in the test), not by a direct read under RLS.

## 15. Open questions inherited, not created

- Whether one node's certificate may submit for many issuers (§4). The resolver is correct either
  way; the answer changes deployment, not code.
- Whether an FNMT sello can be exported for unattended server use at all. If it cannot, `certKind`
  becomes `representante`-only and §5's field is still the right shape.
