# Provider tenant scoping — every Stripe adapter was non-functional under a real role

**Date:** 2026-07-26
**Status:** implemented.
**Main at design time:** `9e85d8a`.

Found while investigating sub-project B (`DueAtDuty`), which this same investigation cancelled — see
[`2026-07-25-recurring-work-scheduler-design.md`](./2026-07-25-recurring-work-scheduler-design.md)
§3's amendment.

## 1. The defect, in one sentence

Three adapter option interfaces required a *"TENANT-SCOPED `Database` handle (one that sets
`app.tenant_id`)"*, and no such handle can be constructed anywhere in this repo — so every
transaction those adapters opened ran with `current_tenant_id()` NULL, and under the non-superuser
deployment role `payments`' `FORCE ROW LEVEL SECURITY` rejected or hid all of it.

`withTenant` is the only thing that sets the GUC, and it does so with `set_config(…, true)` —
transaction-local, from **inside** a transaction it opens itself ([`tenancy.ts:40`](../../packages/db/src/tenancy.ts)).
`createPostgresDb` returns an unscoped handle. There is no third option. The requirement was never
satisfiable.

## 2. What was broken

Six defects, each proven by a failing test before any fix:

| # | Subject | Failure | Severity |
| --- | --- | --- | --- |
| 1 | `StripeOnDeviceProvider.collect` (2b) | `42501` on `insertCapturedPayment` | **fails OPEN** — `collectOnDevice` already took the money |
| 2 | `StripeTerminalProvider.collect` (2a) | `42501` on `insertAttempting` | fails closed — T1 precedes the network call |
| 3 | `StripeHostedProvider.initiate` (3) | `42501` on `insertInitiated` | Checkout Session created, no local row |
| 4 | `StripeOnDeviceProvider.forward` | `listAcceptedOffline` matched zero rows | **silent** — returned all-zeros for ever |
| 5 | reversals on both interactive providers | `payment.not_found` | fails closed, every time |
| 6 | `forward`'s `nextDueAt` | returned `null` with refs still pending | independent of RLS |

**#1 is the worst.** The row insert happens *after* the device has charged the card, so under a real
role every on-device sale produced a captured charge with no local record — reconcile's
`missingLocal`, which for on-device is *unattributed* (no till, therefore no incident, per the class
doc's own deferred list). Not "the feature is broken": money taken and not recorded, silently.

**#5 was described in prose and left in place.** [`reverse.ts`](../../packages/payments-stripe/src/reverse.ts)
states the failure exactly — *"the reversal fails closed with `payment.not_found` — for a payment
that is sitting right there… it fails every single time"* — and then defaults the two interactive
providers to omitting `tenantId` on the grounds that their options *"already REQUIRE a tenant-scoped
handle and document it"*. The diagnosis was correct and the mitigation rested on the requirement
that could not be met.

**#6 is not an RLS problem** and would have bitten the moment anything called `forward`:
`ForwardResult.nextDueAt` is documented as "null = nothing pending", and `forward` returned null
even for refs its own comment describes as "left for a later pass" — so a host sleeping until the
earliest `nextDueAt` would never come back, and accepted-offline card revenue would never clear.

## 3. Why no suite caught it

Two causes, both worth carrying forward.

**PGlite connects as superuser and bypasses `FORCE ROW LEVEL SECURITY`.** Every hermetic test
therefore passed against code that could not work in production. This is the third time it has bitten
(see the credentials handoff §7); it is not a surprising fact, it is a *structural* one.

**Every RLS suite tested store functions, never a constructed adapter.**
[`stripe.rls.test.ts`](../../packages/payments-stripe/src/stripe.rls.test.ts) names the gap and steps
around it: *"`collect` opens its OWN transactions, so it can't have `app.tenant_id` set on them from
out here; instead this suite exercises that SAME store lifecycle directly under the probe/withTenant,
proving the tenant-isolation policy the adapter relies on holds."* That proves the **policy**. It
then treats the **adapter** as covered by implication — and the adapter was the broken part. The
observation that collect's transactions cannot be scoped from outside was the bug report, read as a
test-design constraint.

**The rule this yields:** an RLS suite must make the *shipped object* its subject at least once. A
suite that only exercises the store under `withTenant` proves the policy is sound, not that anything
uses it correctly.

## 4. The fix

**Interactive providers take a `tenantId` at construction.** A terminal or on-device provider is a
per-till object and a till belongs to exactly one tenant, so the scope is known when the object is
built — which is what makes `forward` and the reversals scopable at all, since neither carries a
tenant in its arguments. Every database phase runs through one private `inTenant` helper, so no
transaction can be left unscoped, and the reversals now pass `tenantId` to `reverseViaStripe` (an
option it already supported).

The scope is the **constructed** tenant, not `params.tenantId`, and `collect` validates the two
against each other up front — `requireOwnTenant`, throwing `stripe.tenant_mismatch` before any
network call.

An earlier version of this design relied on the isolation policy's `WITH CHECK` to reject a
mis-wired write instead, and said so in a comment on both adapters. That is wrong on the on-device
path, and wrong in a way this branch should have recognised: on-device writes its row at
`insertCapturedPayment`, **after** `collectOnDevice` has charged the card. Leaving the disagreement
to the database would therefore reproduce defect #1 — money taken, no local row, unattributed — as
the *designed* behaviour for a mis-wiring, defended by a comment copied verbatim from the terminal
adapter where it happened to be true. The guard is what makes "fails closed" a fact rather than a
claim.

The comparison is case-insensitive: `tenantId()` validates the UUID shape case-insensitively and
returns the value unchanged, so a host holding `A1B2…` from config and a caller holding the
canonical lower-case form Postgres renders are the same tenant to the database and different
strings to JavaScript. A `!==` would have rejected every sale on that till.

**The hosted provider scopes from `params.tenantId` instead**, deliberately differing. `initiate` is
its only database method and it has the tenant right there; a constructor option would be surface
with no second caller, and would force a host to build one hosted provider per tenant for no reason.
The webhook path stays untenanted by design and keeps resolving through `resolvePaymentTenant`.

**`listAcceptedOffline` gained an explicit `tenant_id` predicate** — defence in depth alongside the
policy, the convention fiscal's `pendingCount` already follows. Not belt-and-braces: relying on the
policy alone made the query's result differ between environments, because under PGlite's superuser
bypass it listed *every* tenant's rows, so `forward` counted other tenants' unresolved refs as its
own. The predicate makes both environments agree, which is what makes the hermetic test meaningful.

**`forward` now returns `now + FORWARD_RETRY_MS` when any ref is unresolved.** Five minutes, a local
constant rather than a knob: unlike fiscal's drain — paced by AEAT's own `TiempoEsperaEnvio` —
nothing Stripe-side supplies a wait, and an unresolved ref clears when the device regains
connectivity rather than on a schedule we control.

## 5. What this does not fix

- **`StripeReconciler` was already correct** — it holds a plain handle and wraps its own phases in
  `withTenant`. Untouched.
- **Nothing constructs these providers yet.** The host is still sub-project C, so all six defects
  were latent. That is why this is a fix rather than an incident.

### Why not a tenant-scoped `Database` constructor in `@waitron/db`

The obvious alternative — make the handle the option docs demanded actually constructible — is
rejected for a **mechanical** reason, not a taste one, and it is recorded here because otherwise
the next author proposes it again.

`createPostgresDb` builds a `pg.Pool`. Establishing the tenant at session level (a `SET` on
connect) leaves exactly two options, and both are worse than the disease:

1. **One pool per tenant** — connection count multiplied by tenant count, unbounded in a
   multi-tenant deployment.
2. **A GUC that survives check-in** — the value leaks to whoever borrows that connection next.

The second is precisely the failure `set_config(…, true)` exists to make impossible, argued in
`tenancy.ts`'s own doc. A pooled session-scoped tenant would trade a fail-closed bug (which is what
we had) for a cross-tenant leak (which is worse than what we had). Transaction-local scoping is
correct; the adapters were simply not using it.

### 6. Deliberately left alone

- **An empty queue still reports `nextDueAt: null`, and nothing wakes `forward` when a new offline
  payment arrives.** The fix above makes `forward` ask to be re-run while refs are *outstanding*;
  it does not make it ask to be re-run when the queue is *empty*, because "null = nothing pending"
  is then true. But a host that sleeps on the earliest `nextDueAt` will not return: accept an
  offline card payment five minutes after a clean sweep and nothing forwards it until the next
  unrelated wake-up. The host is the right place to close this — it is the thing that took the
  payment, so it knows an offline acceptance happened — and making `forward` poll unconditionally
  instead would be this adapter inventing a cadence, which is the same mistake as
  `FORWARD_RETRY_MS` only larger. Belongs with the `forward`-scheduling decision the scheduler
  design's §3 amendment defers.
- **An unresolvable ref polls forever with no escalation.** If the device never reports a ref
  either way — replaced handset, wiped local queue, our T2 committed while the device forgot — then
  `unresolved` stays true, T2 is skipped every pass, and `forward` returns `now + 5min`
  indefinitely with no incident and no attempt count. The decline path raises
  `payment.offline_forward_declined`; this path raises nothing. Bounding it needs durable
  per-ref attempt state, which is the same missing machinery as backoff — same owner, same
  deferral.

- **`FORWARD_RETRY_MS` is a flat cadence with no backoff.** A device offline through an 8-hour
  service produces ~96 passes. Backoff would need durable per-queue state, which this adapter does
  not have and should not grow — it is the kind of thing `packages/scheduler` or the host should
  own. Noted in the scheduler design's §3 amendment as the reason `forward` scheduling is
  *deferred* rather than ruled out.
- **`listAcceptedOffline(tx, tenantId: string, provider: string)`** takes two adjacent same-typed
  strings, so transposing them typechecks and silently returns nothing. `TenantId` is branded in
  `@waitron/shared` and every caller holds one, so this could be made self-enforcing — but the
  whole `payments` store uses `tenantId: string` consistently, and changing one function's
  convention in isolation would be worse than the risk.
