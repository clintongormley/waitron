# Handoff — every Stripe adapter was non-functional, and `DueAtDuty` is cancelled

**Date:** 2026-07-26
**Type:** *Backward-looking* — what shipped, why the task changed shape, and what is genuinely left.
**Main at handoff:** `9404344`.

| PR | Squash | What |
| --- | --- | --- |
| #34 | `9404344` | **Adapter tenant scoping** — all three Stripe adapters, plus the decision not to build `DueAtDuty` |

Spec: [`2026-07-26-provider-tenant-scoping-design.md`](../superpowers/specs/2026-07-26-provider-tenant-scoping-design.md).
Amended: [`2026-07-25-recurring-work-scheduler-design.md`](../superpowers/specs/2026-07-25-recurring-work-scheduler-design.md) §3 and §11.

There is no plan document. This cycle was a brainstorm that cancelled its own subject and turned into
a bug fix, so it never reached `writing-plans`.

---

## 1. What this is, in one idea

**Three adapter option interfaces required a `Database` handle that this repo cannot construct**, and
nobody noticed because the only test environment that could have shown it connects as a superuser.

The demand was *"Must be a TENANT-SCOPED `Database` handle (one that sets `app.tenant_id`)"*, written
on `StripeTerminalProviderOptions.db`, `StripeOnDeviceProviderOptions.db` and
`StripeHostedProviderOptions.db`. But `withTenant` is the only thing that sets that GUC and it does so
with `set_config(…, true)` — transaction-local, from *inside* a transaction it opens itself — while
`createPostgresDb` returns a plain handle. There is no third option. So every transaction those
adapters opened ran with `current_tenant_id()` NULL, and `payments`' `FORCE ROW LEVEL SECURITY`
rejected or hid all of it.

Every payment mode in the repo was affected: countertop reader (2a), tap-to-pay (2b), hosted checkout
(3), and every reversal.

## 2. The session started somewhere else

The task was **sub-project B — `DueAtDuty` in `packages/scheduler`**, the second of the three the
credentials handoff named. It does not exist any more, and the bug above is what the investigation
into it turned up.

`DueAtDuty` was to be a second duty kind for the two `nextDueAt`-shaped duties, `drain` and `forward`.
The scheduler design §3 predicted landing it would cost "a derivation strategy and a migration". That
prediction was wrong, and **the two duties do not have the same answer** — a distinction the first
draft of the amendment missed and a reviewer caught (§4).

**`drain` is ruled out.** It takes no tenant and enumerates its own through
`envios_tenants_with_work`, a `SECURITY DEFINER` seam built precisely so it can read across tenants
under FORCE RLS — while every `scheduled_runs` row is `tenant_id NOT NULL` under RLS, so there is
nothing to key a row on. It already owns durable schedule state (`envio_flujo.proximo_envio_en`,
`envios.proximo_intento_en`). And `parked` is terminal, so three throws would silently end a **legal**
hourly retry. What it needs is a caller, which the `apps/*` host is anyway.

**`forward` is deferred, not ruled out.** None of that applies to it, and this very PR made it a
per-tenant object, so it now fits the ledger *better* than before. It owns no durable cadence — just
an in-process constant — and its failure is not legally load-bearing. It is waiting on a consumer for
the `nextDueAt` it already returns, i.e. on the host.

Durable visibility of a `drain` that keeps throwing (`TickResult.skipped` is ephemeral,
`incidents.till_id` is `NOT NULL`) was **assigned to monitoring** — the only argument that had
favoured a ledger row.

## 3. The decisions worth knowing before you touch it

**Interactive providers take a `tenantId` at construction.** A terminal or on-device provider is a
per-till object and a till belongs to exactly one tenant, so the scope is known when the object is
built. That is what makes `forward` and the reversals scopable at all — neither carries a tenant in
its arguments. The host builds one provider per tenant.

**The hosted provider deliberately differs**, scoping from `params.tenantId`. `initiate` is its only
database method and already has the tenant; a constructor option would have no second caller and
would force a host to build one hosted provider per tenant for nothing. **The rule, so this reads as
a rule and not an exception:** an object with a per-tenant identity scopes from that identity; an
object without one scopes from its parameters.

**`collect` validates the two tenants up front rather than letting the database do it.** This is not
belt-and-braces — see §4.

**The comparison is case-insensitive.** `tenantId()` validates the UUID shape with an `/i` pattern and
returns the value unchanged, while Postgres renders `uuid` canonical-lowercase. A host holding
`A1B2…` from config and a caller holding `a1b2…` from a database read are the same tenant to Postgres
and different strings to JavaScript.

**`reverseViaStripe`'s `tenantId` is now required**, and the untenanted branch is deleted. It was
optional, and its own doc recommended omitting it for the two interactive providers — the advice that
caused the reversal defect.

**A scoped-handle constructor in `@waitron/db` was rejected for a mechanical reason**, recorded in
spec §5 so it is not re-proposed: `createPostgresDb` builds a `pg.Pool`, so a session-level `SET`
means either one pool per tenant (unbounded in multi-tenant) or a GUC that survives check-in and
leaks to the next borrower — the exact leak `set_config(…, true)` exists to prevent. That trades a
fail-closed bug for a cross-tenant leak.

## 4. Four things the reviews changed that a reader would not guess

**The fix's own comment defended re-creating the branch's worst defect.** `inTenant`'s doc said *"a
mis-wired host failing closed is the point"* — copied verbatim from the terminal adapter, where it is
true because T1 precedes the network call. On the on-device adapter it is **false**: that adapter
writes its row at `insertCapturedPayment`, *after* `collectOnDevice` has charged the card. Leaving a
constructed-vs-params tenant disagreement to the RLS policy there would reproduce defect #1 — money
taken, no local row, unattributed — as the *designed* behaviour. Both adapters now guard explicitly
with `stripe.tenant_mismatch` before any network call, and the on-device test asserts the device was
never asked for money.

**The structural guard had a hole in the one file that mattered.** Having made the invariant
structural (a source scan failing on a bare `.transaction(`), the exemption list read
`EXEMPT = ["reverse.ts"]` — justified by a rationale describing the code the fix had just deleted.
After `tenantId` became required, `reverse.ts` contains no such call at all, so the exemption
protected nothing while allowing someone to re-add the deleted line with CI green, returning every
reversal to `payment.not_found`. There are **no exemptions** now.

**The amendment generalised drain-only reasoning onto `forward`** — in the same commit that made
`forward` per-tenant. All three of its arguments were `drain` facts. §2 above is the corrected form.

**Two tenant comparisons were case-sensitive against values nothing normalises.** Latent, because
nothing constructs these providers yet, but it would have thrown `stripe.tenant_mismatch` on every
sale for a host whose config held an upper-case UUID, and denied a caller its own payment on the
reversal path.

## 5. Defects found, and by what

**None of the following were found by a green suite.** Six shipped defects, then four more in the fix.

| Defect | Found by |
| --- | --- |
| on-device `collect` — `42501` **after the device took the money**; a captured charge with no local row on every sale, unattributed so no incident | reading the option doc against `tenancy.ts`, then a RED test |
| terminal `collect` — `42501` on `insertAttempting` (fails closed) | same |
| hosted `initiate` — `42501` after the Checkout Session existed | same |
| on-device `forward` — matched zero rows, returned all-zeros **silently, for ever** | same |
| reversals on both interactive providers — `payment.not_found`, every time | `reverse.ts`'s own comment predicted it; a RED test confirmed |
| `forward` reported `nextDueAt: null` with refs still pending | reading the method against its own contract |
| **the `inTenant` doc defending a money-losing mis-wiring** | `simplify`'s altitude agent |
| **the fix applied to three instances rather than made structural** | `simplify`'s altitude agent |
| **the structural guard exempting `reverse.ts`** | fresh-context review |
| **case-sensitive UUID comparison** | fresh-context review |

Also from the reviews: `claimAcceptedOffline` silently diverging from its twin (flagged by three of
four agents); the `forward` tenant predicate covered only incidentally; `FakePaymentProvider`
guarding `forward` but not `collect`.

**Four patterns worth carrying forward.**

*First:* **an RLS suite must make the shipped object its subject at least once.** Every RLS suite here
tested store functions wrapped in `withTenant` and inferred the adapter was fine.
`stripe.rls.test.ts` even *named* the gap — *"`collect` opens its OWN transactions, so it can't have
`app.tenant_id` set on them from out here"* — and then tested the store lifecycle instead. That
sentence was the bug report, read as a test-design constraint.

*Second:* **`/finish-branch`'s simplify and review steps found defects in the fix three separate
times.** The credentials handoff already recorded that skipping them was a mistake; this cycle is the
stronger case, because what they found was not cleanup but the same defect class the branch existed
to eliminate.

*Third:* **a structural guard needs mutation-verifying, and its exemption list needs justifying
against the current code.** Both guards here were verified by reintroducing the bug and watching the
named file or test fail. The exemption was not, and it was wrong.

*Fourth:* **the comment-contradicts-code class is now four slices running**, and this time the
contradiction was authored *while fixing* three earlier instances of it.

*And on Copilot:* it reviewed all 26 files and generated **no comments**.

## 6. What remains

### Deferred from this PR, recorded in spec §6

- **`FORWARD_RETRY_MS` is a flat 5-minute cadence with no backoff.** A device offline through an
  eight-hour service produces ~96 passes, each carrying the whole pending set to `syncOfflineQueue`.
- **An empty queue still reports `nextDueAt: null`**, so a host that sleeps on the earliest
  `nextDueAt` never returns. Accept an offline payment five minutes after a clean sweep and nothing
  forwards it until some unrelated wake-up. The host is the right place to close this — it took the
  payment, so it knows.
- **An unresolvable ref polls forever** with no incident and no bound (replaced handset, wiped device
  queue, our T2 committed while the device forgot). The decline path raises an incident; this path
  raises nothing.

All three need durable per-queue state this adapter should not grow, and all three belong with the
deferred `forward`-scheduling decision.

- **`listAcceptedOffline(tx, tenantId: string, provider: string)`** takes two adjacent same-typed
  strings, so transposing them typechecks and returns nothing. `TenantId` is branded and every caller
  holds one, but the whole `payments` store uses `tenantId: string`; changing one function in
  isolation would be worse.

### Still open from earlier cycles

Unchanged: the **ten unguarded `*.rls.test.ts` `afterAll`s** (payments 3, payments-stripe 4,
fiscal-verifactu 3 — the count has been wrong twice, use the per-package breakdown) and the seven
`*.concurrency.test.ts` twins; `startRealPostgres` duplicated five times (blocked on `@waitron/db`
having no `exports` map); `bin.ts` connecting before validating argv; `rotate`'s coupling to
`PURPOSES` **and its read-side twin, which the credentials handoff asks be decided before
sub-project C lands**; `reverseViaStripe`'s full-refund amount on the interactive till paths, where
#31's spec still **disqualifies** the "send our amount" fix.

**`drain` still cannot submit.** It needs a `VerifactuClient` whose `fetch` carries client
certificate material, and per [`getting-to-production.md`](../compliance/getting-to-production.md) the
qualified seal certificate is unobtained, unpriced, and its exportability for unattended server use
explicitly unverified. That is the real critical path, and no code shortens it.

### Next

1. **Sub-project C — the `apps/*` host.** Now the *entire* remaining path, since B is cancelled. It
   inherits three things from this PR: building one provider per tenant, choosing `forward`'s
   cadence, and monitoring a persistently-failing `drain`. It also inherits the credentials package's
   esbuild packaging path.
2. The **tab/tip lifecycle**, the **refund/void role-gate**, and the **drift-orphan fund-hold
   policy** are unchanged deferrals.

## 7. Environment notes

- `pnpm --filter @waitron/payments-stripe test` runs 100 tests in ~10s; the real-Postgres suites need
  `TESTCONTAINERS_RYUK_DISABLED=true` locally. **Never commit it.**
- The pre-push hook runs the full workspace gates in ~83s. Do not bypass it.
- **Plain `gh pr merge --squash` worked again** — second cycle running, with no `--admin`. The
  credentials handoff's read looks right: resolved conversations, not admin rights, are the gate.
- **`gh pr merge --delete-branch` left the REMOTE branch behind**, because the worktree still held
  the local one — it aborts the whole delete step, not just the local half. Tear the worktree down
  first, or delete the ref afterwards with
  `gh api -X DELETE repos/:owner/:repo/git/refs/heads/<branch>`, which also sidesteps the pre-push
  hook that `git push --delete` would trigger.
- **PGlite connects as a superuser and bypasses `FORCE ROW LEVEL SECURITY`.** Third cycle this has
  bitten. It is not a surprising fact — treat it as structural, and assume any hermetic assertion
  about tenant scoping is worthless until a real-Postgres suite repeats it against the shipped
  object.
