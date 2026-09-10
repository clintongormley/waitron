# SumUp Cloud API Card-Present Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `@waitron/payments-sumup` package whose `SumUpCloudProvider` drives a paired SumUp Solo from the till's existing pay flow over SumUp's Cloud API, so that on 2026-09-11 the owner can set `WAITRON_TILL_CARD_PROVIDER=sumup_cloud`, seal the merchant credential, tap the Card button, and the Solo wakes.

**Architecture:** The provider spec's shape, unchanged: `collect` is T1 (commit an `attempting` row) → network (create a reader checkout keyed by OUR `payment_ref`) → poll the transaction until its status leaves `PENDING` → T2. The one neutral addition is `resolvePending(now)` on `PaymentProvider`, the sweep that resolves rows `collect` could not (a poll timeout leaves the row `attempting`, never `failed`, because the customer may have paid). Reversals map onto SumUp's refund endpoint. Webhooks are NOT wired (spec §4: polling is the floor; webhooks are an accelerator, deferred). The host wires the provider exactly as it wires `StripeTerminalProvider`: a sealed per-tenant credential, a per-till reader id, one provider per boot.

**Tech Stack:** TypeScript (ESM, Node 24), Drizzle + PostgreSQL, Vitest (PGlite + real Postgres via `@waitron/db/testing`), Node `fetch` for the SumUp HTTP binding (no SDK).

**Spec:** `docs/superpowers/specs/2026-07-30-sumup-card-present-provider-design.md` (approved 2026-07-30), read together with `docs/research/2026-09-10-sumup-solo-experiments.md`, which records what SumUp's documentation says on 2026-09-10 (several endpoints moved since the spec was written) and the experiments the owner runs on the real Solo. This plan builds the adapter BEFORE those experiments have results, so every design choice that depends on an experiment is made defensively and named in *Decisions* below.

## Global Constraints

- **Worktree + branch:** `python3 ~/workspace/tools/worktree.py new waitron feat/payments-sumup` (CLAUDE.md §6 — never a plain `git worktree add`). Every commit `git commit -s`.
- **Coverage:** `@waitron/payments` holds the HIGH bar `statements 98 / lines 98 / functions 98 / branches 95` (it is one of the six in `scripts/coverage-thresholds.test.ts`); `@waitron/payments-sumup`, `@waitron/payments-stripe` and `apps/server` hold the floor `90/90/85/85`. Run each touched package's `test:coverage` UNFILTERED (a name-filtered run skips the guard suites — CLAUDE.md §2).
- **Every `verify` step runs:** `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test:coverage`, and `pnpm format:check` at the root. `pnpm typecheck` (whole workspace, ~40 s) after any task that changes a cross-package type (`PaymentProvider` in Task 1; `CardProvider` in Task 6).
- **Error codes name the DOMAIN CONCEPT, never the throwing package, and are never renamed once shipped** (CLAUDE.md §3). This plan adds exactly two: `payment.pending_outcome_unactionable` (neutral, in `@waitron/payments`) and `sumup.tenant_mismatch` (the sibling of the shipped `stripe.tenant_mismatch`, same concept, same shape — grep-verified at `packages/payments-stripe/src/errors.ts`). Every file that throws imports its registry with a bare `import "./errors.js"`.
- **Money:** exact `Decimal` everywhere; a monetary value becomes a JS number ONLY at the SumUp HTTP boundary (`sumup-client.ts`), the way `toMinorUnits` does in `packages/payments-stripe/src/client.ts`.
- **Transactions:** every database phase the adapter opens runs through `withTenant(db, tenantId, fn)`; no transaction is held across a network call (T1/T2). Every read carries its own `tenant_id` predicate, by-id reads included (CLAUDE.md §3).
- **No new table, no migration.** The `payments` table and its states already carry everything (`attempting`, `captured`, `failed`, `external_ref`).
- **Nothing external blocks a sale** (CLAUDE.md §5): a poll timeout returns an `attempting` result with `settledAt: null`, so `recordSale` refuses and the till offers cash / manual card. `Terminate Checkout` is never called on timeout (spec §2).
- **Real Postgres suites** need Docker and `TESTCONTAINERS_RYUK_DISABLED=true`; run `pnpm reap` first after any interrupted run (CLAUDE.md §4).
- **Comments state the invariant and the non-obvious why, never the history** (CLAUDE.md §1).
- **No webhook endpoint, no reconciler, no Square adapter, no reader provisioning UI** (spec §6 deferred list). The reader id is till config, exactly as `WAITRON_TILL_STRIPE_READER_ID` is.

## Decisions this plan makes (each depends on an experiment not yet run — flag for review)

1. **Our `payment_ref` is sent to SumUp as `affiliate.foreign_transaction_id`.** SumUp's create-checkout body has no client-supplied `client_transaction_id`; the `affiliate` block (`app_id`, `key`, `foreign_transaction_id`, all required by the OpenAPI file) is the only client-supplied key, and the retrieve endpoint looks up by it. If experiment 2a shows the lookup works while `PENDING`, the crash window between T1 and the first poll is closed for free. If the merchant has no affiliate key (experiment 0.2 fails), the host seals `affiliateAppId`/`affiliateKey` as the literal `-` and the client OMITS the `affiliate` block; the sweep then relies on the `client_transaction_id` stamped in T1.5 (below). Both paths are built and tested. Accepted residual in the no-affiliate branch: a create SumUp accepted but whose response was lost (crash before T1.5) leaves the row with no key SumUp knows — neither a stamped `client_transaction_id` nor a sent `foreign_transaction_id` — so the sweep finds nothing and, past the grace period, resolves it `failed` though the customer may have paid. The spec's orphan self-heal (§3) that catches this lives in the deferred reconciler (§6); until it lands, the affiliate key is what closes the window, which is why the build strongly prefers it. Flagged for the owner at finish-branch.
2. **A T1.5 write stamps SumUp's `client_transaction_id` into `external_ref` while the row is still `attempting`.** On capture, `captureAttempting` overwrites `external_ref` with the SumUp transaction `id`, which is what the refund endpoint addresses. So `external_ref` means "the poll key" on an `attempting` row and "the refundable id" on a `captured` one; the adapter's header says so.
3. **`resolvePending` treats "not found at SumUp" as still pending for a grace period (15 minutes from the row's `created_at`), then resolves it `failed` without an incident**: SumUp holds no transaction, so no money moved. `REFUNDED` and any unknown status resolve `failed` WITH the new incident (spec §3).
4. **Refunds go to `POST /v1.0/merchants/{merchant_code}/payments/{transaction_id}/refunds`** (the spec's `/v0.1/me/refund/{txn_id}` is gone from SumUp's OpenAPI file). `void` and `refund` both call it in full; `partialRefund` passes `amount`. If experiment 4a shows an immediate refund is refused (`409`), the recorded failed refund and the reconcile sweep are the backstop, and `void` becomes a follow-up.
5. **A definite HTTP rejection of the create call (4xx) resolves the row `failed`; a thrown network error leaves it `attempting`.** A 4xx means SumUp did not accept the checkout, so the reader never woke. A timeout or connection reset means we do not know.
6. **`resolvePending` runs on every tick as a LOGGED side-effect of the pass loop, wrapping the singleton pass — not as a health-tracked duty** (revised from the first draft's "third pass duty" after the pre-flight review, which found that path both fails to run on a non-primary node and 503s `/health`). It runs on every node that has a card provider, independent of the singleton gate, because the rows it resolves are THIS node's own `attempting` card rows and a sell-only local secondary that never drains/reconciles (`singletonPass` returns an empty pass there — `apps/server/src/singleton-pass.ts:13`) must still sweep the card sales it took. It is deliberately NOT a `Duty` on `/health`: `createHealthState` seeds every `ALL_DUTIES` member on every node and a never-run seeded duty reads stale → 503 (`apps/server/src/health.ts:74,220`), so a conditional duty cannot join that set without 503ing a no-card node; a stuck sweep surfaces as a `resolve_pending.failed` log line instead — the same channel a mirror's stalled pull uses, and the deferred SumUp reconciler is the same criticality tier and likewise off `/health`. Honouring the returned `nextDueAt` to back the cadence off is a deferred refinement; the loop's own tick drives re-runs, and the sweep is a cheap no-op (one empty `SELECT`) when there is nothing pending.
7. **The SumUp reversal path is written in `@waitron/payments-sumup` against a structural `ProcessorRefunder`, not by importing `reverseViaStripe`.** Importing `@waitron/payments-stripe` from a SumUp package would make one vendor depend on another. The two files are the same T1/T2 shape; lifting them into a neutral `@waitron/payments` primitive is a follow-up (Task 7 records it in the backlog), because two shipped Stripe providers depend on the existing one and that move deserves its own review.

## File map

| Path | Responsibility | Task |
| --- | --- | --- |
| `packages/payments/src/provider.ts` | add `resolvePending(now): Promise<ForwardResult>` to `PaymentProvider` | 1 |
| `packages/payments/src/store.ts` (+ `store.test.ts`) | add `listAttempting`, `stampAttemptingRef`, `AttemptingPayment` | 1 |
| `packages/payments/src/errors.ts` | add `payment.pending_outcome_unactionable` | 1 |
| `packages/payments/src/simulator.ts`, `src/testing/fake-provider.ts` | all-zeros `resolvePending` | 1 |
| `packages/payments/src/index.ts` (+ `index.test.ts`) | export the two store functions and the type | 1 |
| `packages/payments-stripe/src/provider.ts`, `src/device-provider.ts` | all-zeros `resolvePending` | 1 |
| `apps/server/src/till-sale-integrated.pg.test.ts` | all-zeros `resolvePending` on the `cannedProvider` structural test double | 1 |
| `packages/payments-sumup/package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.sandbox.config.ts` | package scaffold | 2 |
| `packages/payments-sumup/src/errors.ts` | `sumup.tenant_mismatch` | 2 |
| `packages/payments-sumup/src/client.ts` (+ `client.test.ts`) | the narrow `SumUpClient` seam, `toMinorUnits`, `toMajorUnits`, `fromMajorUnits` | 2 |
| `packages/payments-sumup/src/testing/fake-sumup.ts` (+ `.test.ts`) | deterministic in-memory `SumUpClient` | 2 |
| `packages/payments-sumup/src/testing/global-setup.ts` | shared real-PG container + `sumup_probe` role | 2 |
| `packages/db/src/english-only.ts`, `scripts/english-only.test.ts`, `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `eslint.config.js` | register the new package | 2 |
| `packages/payments-sumup/src/provider.ts` (+ `provider.test.ts`, `sumup.test.ts`) | `SumUpCloudProvider.collect` | 3 |
| `packages/payments-sumup/src/provider.ts` (+ `resolve-pending.test.ts`) | `SumUpCloudProvider.resolvePending` | 4 |
| `packages/payments-sumup/src/reverse.ts` (+ `reverse.test.ts`) | void / refund / partialRefund | 5 |
| `packages/payments-sumup/src/sumup-client.ts` | the real `fetch` binding (coverage-excluded) | 5 |
| `packages/payments-sumup/src/index.ts` | barrel | 5 |
| `packages/credentials/src/purposes.ts` (+ `purposes.test.ts`) | `payments.sumup` purpose | 6 |
| `apps/server/src/sumup-account.ts` (+ `.test.ts`) | credential → `SumUpClient` resolver | 6 |
| `apps/server/src/till-config.ts` (+ `.test.ts`) | `sumup_cloud` + `WAITRON_TILL_SUMUP_READER_ID` | 6 |
| `apps/server/src/boot.ts`, `boot-card-provider.test.ts` | the `sumup_cloud` branch; the pass-loop duty | 6 |
| `apps/server/src/boot.ts` (+ `boot.test.ts` if the wrapper needs a boot-level assertion) | `withPendingSweep` wrapper around the singleton pass; runs `resolvePending` per tick when a provider exists | 6 |
| `apps/server/src/till-sale.ts` (+ `till-sale-integrated.test.ts`) | `attempting` → `timeout` outcome | 6 |
| `apps/till/src/api/client.ts`, `src/widgets/tender-pay.ts` | `"sumup_cloud"` in the two `CardProvider` unions | 6 |
| `packages/payments-sumup/src/collect.sandbox.test.ts` | the live plug-in suite against the paired Solo | 7 |
| `docs/backlog.md` | Track H item 4 in build; the reversal-lift follow-up | 7 |

---

### Task 1: `resolvePending` on the neutral seam, plus the two store reads it needs

**Files:**
- Modify: `packages/payments/src/provider.ts` (the `PaymentProvider` interface, after `forward`)
- Modify: `packages/payments/src/store.ts` (after `listAcceptedOffline`)
- Modify: `packages/payments/src/errors.ts` (after `payment.offline_forward_declined`)
- Modify: `packages/payments/src/simulator.ts`, `packages/payments/src/testing/fake-provider.ts`
- Modify: `packages/payments/src/index.ts`, `packages/payments/src/index.test.ts`
- Modify: `packages/payments-stripe/src/provider.ts`, `packages/payments-stripe/src/device-provider.ts`
- Test: `packages/payments/src/store.test.ts`

**Interfaces:**
- Produces: `PaymentProvider.resolvePending(now: Date): Promise<ForwardResult>`; `listAttempting(tx, tenantId, provider): Promise<AttemptingPayment[]>`; `stampAttemptingRef(tx, key, externalRef): Promise<void>`; `AttemptingPayment { tenantId; paymentRef; workingOrderId; amount: string; externalRef: string | null; createdAt: string }`; error code `payment.pending_outcome_unactionable: { paymentRef: string; status: string }`.

- [ ] **Step 1: Write the failing store tests**

Append to `packages/payments/src/store.test.ts` (it already boots PGlite with `CORE_MIGRATIONS` + `PAYMENTS_MIGRATIONS` and has `seedWorkingOrder`; reuse its `suite`/`db` accessor and seed helper names as the file defines them — read the file's top 60 lines first):

```ts
describe("listAttempting / stampAttemptingRef", () => {
  it("lists only this tenant's and provider's attempting rows, oldest first, with their poll key", async () => {
    const t = await seedWorkingOrder(db(), freshNif());
    const other = await seedWorkingOrder(db(), freshNif());
    await db().transaction(async (tx) => {
      await insertAttempting(tx, { tenantId: t.tenantId, workingOrderId: t.workingOrderId, provider: "sumup", paymentRef: "ref-a", amount: decimal("10.00") });
      await insertAttempting(tx, { tenantId: t.tenantId, workingOrderId: t.workingOrderId, provider: "sumup", paymentRef: "ref-b", amount: decimal("11.00") });
      await insertAttempting(tx, { tenantId: t.tenantId, workingOrderId: t.workingOrderId, provider: "stripe", paymentRef: "ref-c", amount: decimal("12.00") });
      await insertAttempting(tx, { tenantId: other.tenantId, workingOrderId: other.workingOrderId, provider: "sumup", paymentRef: "ref-d", amount: decimal("13.00") });
      await captureAttempting(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: "ref-b", settledAt: new Date(), externalRef: "txn_b" });
      await stampAttemptingRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: "ref-a" }, "ctx_a");
    });
    const rows = await db().transaction((tx) => listAttempting(tx, t.tenantId, "sumup"));
    expect(rows.map((r) => [r.paymentRef, r.externalRef, r.amount])).toEqual([["ref-a", "ctx_a", "10.00"]]);
    expect(rows[0]!.workingOrderId).toBe(t.workingOrderId);
    expect(typeof rows[0]!.createdAt).toBe("string");
  });

  it("stampAttemptingRef touches only a row still attempting (a captured row keeps its refundable id)", async () => {
    const t = await seedWorkingOrder(db(), freshNif());
    const key = { tenantId: t.tenantId, provider: "sumup", paymentRef: "ref-e" };
    await db().transaction(async (tx) => {
      await insertAttempting(tx, { ...key, workingOrderId: t.workingOrderId, amount: decimal("5.00") });
      await captureAttempting(tx, { ...key, settledAt: new Date(), externalRef: "txn_e" });
      await stampAttemptingRef(tx, key, "ctx_late");
    });
    const row = await db().transaction((tx) => getPaymentByRef(tx, key));
    expect(row.externalRef).toBe("txn_e");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/payments test store.test`
Expected: FAIL — `listAttempting is not defined` / `stampAttemptingRef is not defined`.

- [ ] **Step 3: Add the interface method, the error code, the store functions**

`packages/payments/src/provider.ts`, inside `PaymentProvider` after `forward`:

```ts
  /** Resolve this provider's `attempting` rows whose outcome `collect` did not learn — a poll
   * timeout, a crash between T1 and T2, a create call whose response was lost. One pass: each row
   * is polled at the processor and resolved `captured` or `failed`; a row the processor still
   * reports pending is left for the next pass (`nextDueAt`). Reuses `ForwardResult`: `forwarded`
   * counts rows captured, `declined` rows failed. A synchronous adapter (its `collect` never leaves
   * a row `attempting`) answers all-zeros — exactly how `forward` joined this interface. */
  resolvePending(now: Date): Promise<ForwardResult>;
```

`packages/payments/src/errors.ts`, inside `ErrorParams`:

```ts
    /** Raised as an INCIDENT (never thrown) by a `resolvePending` sweep when the processor reports
     * an outcome that is neither a capture nor a refusal — `REFUNDED` (money moved and came back
     * through a payment that never carried a sale) or a status this adapter does not know. The row
     * is resolved `failed` so the sweep terminates; the incident is what makes a human look. */
    "payment.pending_outcome_unactionable": { paymentRef: string; status: string };
```

`packages/payments/src/store.ts`, after `listAcceptedOffline`:

```ts
/** One in-flight payment as `resolvePending` reads it. `externalRef` is the processor's POLL key
 * (stamped by `stampAttemptingRef` after the create call), null when the adapter crashed before
 * stamping it; `createdAt` bounds how long a not-found row is still considered pending. */
export interface AttemptingPayment {
  tenantId: string;
  paymentRef: string;
  workingOrderId: string;
  amount: string;
  externalRef: string | null;
  createdAt: string;
}

/** This tenant's and provider's `attempting` rows, oldest first, unlocked — the T1 read of a
 * `resolvePending` pass. Unlocked for the same reason `listAcceptedOffline` is: the processor
 * lookup that follows is a network call, and the T2 advances (`captureAttempting` /
 * `failAttempting`) each match only a row still `attempting`, so two concurrent passes are
 * harmless. Tenant-scoped explicitly (CLAUDE.md §3). */
export async function listAttempting(
  tx: Transaction,
  tenantId: string,
  provider: string,
): Promise<AttemptingPayment[]> {
  return tx
    .select({
      tenantId: payments.tenantId,
      paymentRef: payments.paymentRef,
      workingOrderId: payments.workingOrderId,
      amount: payments.amount,
      externalRef: payments.externalRef,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.provider, provider),
        eq(payments.state, "attempting"),
      ),
    )
    .orderBy(payments.createdAt);
}

/** Stamp the processor's poll key onto an `attempting` row (T1.5 — after the create call returned,
 * before the poll). Matches only a row still `attempting`: a row already resolved keeps the
 * REFUNDABLE reference `captureAttempting` wrote, so a late stamp can never clobber it. A no-match
 * is silent, not an error — the race it loses to is a concurrent resolution, which is correct. */
export async function stampAttemptingRef(
  tx: Transaction,
  params: Key,
  externalRef: string,
): Promise<void> {
  await tx
    .update(payments)
    .set({ externalRef, updatedAt: sql`now()` })
    .where(and(keyWhere(params), eq(payments.state, "attempting")));
}
```

`packages/payments/src/index.ts`: add `listAttempting`, `stampAttemptingRef` to the `store.js` export list and `AttemptingPayment` to the type list. `packages/payments/src/index.test.ts` pins the barrel — add the two names to whatever list it asserts (read it; it is a sorted-keys assertion).

- [ ] **Step 4: All-zeros implementations on the four existing providers**

`packages/payments/src/simulator.ts`, after `forward`:

```ts
  /** The simulator's `collect` is synchronous (it writes `captured`/`failed` in one transaction),
   * so it never leaves a row `attempting`; nothing to resolve. */
  resolvePending(now: Date): Promise<ForwardResult> {
    void now;
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }
```

`packages/payments/src/testing/fake-provider.ts`, after `forward` (same body, doc: "the fake's collect resolves in one transaction"). `packages/payments-stripe/src/provider.ts` after `forward`:

```ts
  /** `drive` resolves every stall and error to `failed` inside `collect` (it cancels the reader
   * action first), so this adapter never leaves a row `attempting`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface
  resolvePending(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }
```

`packages/payments-stripe/src/device-provider.ts`: same, doc "the device SDK returns a terminal outcome before `collect` writes its row". Add a one-line `it("resolvePending is all-zeros")` beside each provider's existing `forward` all-zeros test (`packages/payments/src/simulator.test.ts`, `packages/payments/src/testing/fake-provider.test.ts`, `packages/payments-stripe/src/provider.test.ts`, `packages/payments-stripe/src/device-provider.test.ts`) — coverage in `@waitron/payments` is at 98%, an untested method fails the gate.

There is a FIFTH implementer the class-grep misses: `cannedProvider` in `apps/server/src/till-sale-integrated.pg.test.ts` returns an object literal typed `: PaymentProvider` (five methods, no `resolvePending`). Adding the interface method makes it a compile error, so add `resolvePending: () => Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 })` to that literal. It is a test double, so no separate test is owed — the suite that uses it exercises it.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @waitron/payments lint && pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments test:coverage
pnpm --filter @waitron/payments-stripe lint && pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe test:coverage
pnpm typecheck && pnpm format:check
```

Expected: all green; the whole-workspace typecheck is what proves every `PaymentProvider` implementer was updated — four classes (simulator, fake, terminal, on-device) PLUS the `cannedProvider` structural double in `till-sale-integrated.pg.test.ts` (Step 4). A missed implementer surfaces here as a "Property 'resolvePending' is missing" compile error; fix it and re-run rather than treating the typecheck as a surprise.

- [ ] **Step 6: Commit**

```bash
git add packages/payments packages/payments-stripe
git commit -s -m "payments: resolvePending on PaymentProvider, listAttempting/stampAttemptingRef, unactionable-outcome incident code"
```

---

### Task 2: `@waitron/payments-sumup` scaffold, the client seam, the fake, registration

**Files:**
- Create: `packages/payments-sumup/package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.sandbox.config.ts`
- Create: `packages/payments-sumup/src/errors.ts`, `src/client.ts`, `src/client.test.ts`, `src/testing/fake-sumup.ts`, `src/testing/fake-sumup.test.ts`, `src/testing/global-setup.ts`, `src/index.ts` (temporary barrel — Task 5 completes it)
- Modify: `packages/db/src/english-only.ts` (`GENERIC_PACKAGES`: add `"payments-sumup"` after `"payments-stripe"`), `scripts/english-only.test.ts:83` (the pinned list — add beside `"payments-stripe"`), `scripts/changed-scope.mjs` (`LIGHT_B_PACKAGES`: add `"@waitron/payments-sumup"` after `"@waitron/payments-stripe"`), `.github/workflows/ci.yml` (the `LIGHT_B_PACKAGES` subtraction list at ~line 1235: add `set -- "$@" --filter "!@waitron/payments-sumup"` after the stripe line — `scripts/ci-workflow.test.mjs` checks the two agree), `eslint.config.js` (the `packages/credentials` zone `from` list: add `"./packages/payments-sumup/**"`)

**Interfaces:**
- Produces:

```ts
export type SumUpStatus = "SUCCESSFUL" | "CANCELLED" | "FAILED" | "PENDING" | "REFUNDED";
export interface SumUpTransaction { id: string; status: SumUpStatus | (string & {}); amount: Decimal }
export type CreateCheckoutOutcome =
  | { accepted: true; checkoutId: string; clientTransactionId: string }
  | { accepted: false; reason: string };
export type TransactionQuery = { clientTransactionId: string } | { foreignTransactionId: string } | { id: string };
export interface SumUpClient {
  createCheckout(p: { readerId: string; amount: Decimal; currency: string; description: string; foreignTransactionId: string }): Promise<CreateCheckoutOutcome>;
  findTransaction(q: TransactionQuery): Promise<SumUpTransaction | null>;
  refund(p: { transactionId: string; amount?: Decimal }): Promise<{ status: "accepted" | "refused" }>;
}
export function toMinorUnits(amount: Decimal): number;
export function toMajorUnits(amount: Decimal): number;
export function fromMajorUnits(major: number): Decimal;
```

- [ ] **Step 1: Scaffold the package**

`packages/payments-sumup/package.json`:

```json
{
  "name": "@waitron/payments-sumup",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:sandbox": "vitest run --config vitest.sandbox.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/payments": "workspace:*",
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "@waitron/core": "workspace:*",
    "@waitron/fiscal": "workspace:*",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

(`@waitron/core` is a DEV dependency only: the sweep's incident sink is typed structurally via `@waitron/payments`'s `IncidentSink`, the same reason `@waitron/payments` keeps core dev-only. `@waitron/fiscal` is what `@waitron/payments/test/seed.js` needs.)

`tsconfig.json`: copy `packages/payments-stripe/tsconfig.json` byte for byte. `vitest.config.ts`: copy `packages/payments-stripe/vitest.config.ts`, then replace the coverage `exclude` list's four `stripe-*-client.ts` entries with one `"src/sumup-client.ts"` (comment: "the real HTTP boundary — a thin fetch mapping exercised only by the live sandbox suite against the paired Solo, never the hermetic run; its logic is SumUp's"), keep `"src/index.ts"`, `"src/testing/**"`, `"src/**/*.sandbox.test.ts"`, `"vitest.sandbox.config.ts"`; thresholds `{ statements: 90, lines: 90, functions: 85, branches: 85 }`. `vitest.sandbox.config.ts`: copy Stripe's, edit the comment to name the paired Solo.

Then `pnpm install` (the lockfile gains the member; CI's `--frozen-lockfile` needs it committed).

- [ ] **Step 2: Write the failing client tests** (`src/client.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { fromMajorUnits, toMajorUnits, toMinorUnits } from "./client.js";

describe("SumUp amount conversions (the only place money becomes a number)", () => {
  it("toMinorUnits: exact scale-2 decimal → integer cents", () => {
    expect(toMinorUnits(decimal("10.00"))).toBe(1000);
    expect(toMinorUnits(decimal("0.01"))).toBe(1);
    expect(toMinorUnits(decimal("1234.5"))).toBe(123450);
  });
  it("toMajorUnits: exact scale-2 decimal → the number the refund body carries", () => {
    expect(toMajorUnits(decimal("10.00"))).toBe(10);
    expect(toMajorUnits(decimal("0.40"))).toBe(0.4);
  });
  it("fromMajorUnits: SumUp's JSON number → exact scale-2 decimal, no float residue", () => {
    expect(fromMajorUnits(10.5)).toBe(decimal("10.50"));
    expect(fromMajorUnits(0.1 + 0.2)).toBe(decimal("0.30"));
    expect(fromMajorUnits(1)).toBe(decimal("1.00"));
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `pnpm --filter @waitron/payments-sumup test client.test`
Expected: FAIL — cannot resolve `./client.js`.

- [ ] **Step 4: Write `errors.ts`, `client.ts`, the fake, the global setup**

`src/errors.ts`:

```ts
import "@waitron/shared";

/** `@waitron/payments-sumup`'s contribution to the shared error registry — the one SumUp-adapter
 * failure the neutral `payment.*` codes do not cover. The sibling of `stripe.tenant_mismatch`
 * (`packages/payments-stripe/src/errors.ts`): same concept, same shape. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A `collect` was handed params for a different tenant than the provider was constructed
     * for — a host wiring error. Raised BEFORE any network call, so no money moves. */
    "sumup.tenant_mismatch": { expected: string; supplied: string };
  }
}
```

`src/client.ts`:

```ts
import { decimal, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/** The `status` values SumUp documents on a transaction (`GET /v2.1/merchants/{mc}/transactions`).
 * `SumUpTransaction.status` is deliberately wider: a value SumUp adds later must reach the adapter as
 * a string it does not recognise, not be silently narrowed away by a type. */
export type SumUpStatus = "SUCCESSFUL" | "CANCELLED" | "FAILED" | "PENDING" | "REFUNDED";

export interface SumUpTransaction {
  /** SumUp's transaction id — what the refund endpoint addresses. */
  id: string;
  status: SumUpStatus | (string & {});
  amount: Decimal;
}

/** A create call has three outcomes, not two: accepted (the reader will wake), REFUSED by SumUp
 * with a definite 4xx (the reader will not wake — `reason` is the problem title, never the body),
 * or THROWN (network error, timeout: we do not know whether SumUp accepted it). The adapter treats
 * the three differently (T2 `failed` only for the second). */
export type CreateCheckoutOutcome =
  | { accepted: true; checkoutId: string; clientTransactionId: string }
  | { accepted: false; reason: string };

export type TransactionQuery =
  | { clientTransactionId: string }
  | { foreignTransactionId: string }
  | { id: string };

/** The narrow SumUp surface `SumUpCloudProvider` depends on — the calls it makes, not the API. The
 * real impl (`./sumup-client.ts`) maps these onto `fetch`; `FakeSumUp` (`./testing/`) models them
 * deterministically. Amounts cross this seam as exact `Decimal`; the real impl converts at the
 * boundary. Mirrors `StripeClient`. `findTransaction` returns null for a 404 — before the reader
 * has started a checkout, SumUp may hold no transaction yet, and the adapter reads null as
 * "still pending", never as an error. */
export interface SumUpClient {
  createCheckout(params: {
    readerId: string;
    amount: Decimal;
    currency: string;
    description: string;
    /** OUR `payment_ref`, sent as `affiliate.foreign_transaction_id` when the merchant holds an
     * affiliate key — the client-supplied lookup key. */
    foreignTransactionId: string;
  }): Promise<CreateCheckoutOutcome>;
  findTransaction(query: TransactionQuery): Promise<SumUpTransaction | null>;
  refund(params: { transactionId: string; amount?: Decimal }): Promise<{ status: "accepted" | "refused" }>;
}

/** Exact major→minor for `total_amount.value` (SumUp wants integer minor units with
 * `minor_unit: 2`). Same construction as payments-stripe's `toMinorUnits`: scale to "NN.MM", drop
 * the point, parse a pure integer string — never a float. */
export function toMinorUnits(amount: Decimal): number {
  return Number(toScale(amount, 2).replace(".", ""));
}

/** Major units as a number — the refund body's `amount` (SumUp's documented example is `5`, major
 * units). A float, unavoidably; built from the scale-2 string so it is the nearest double to the
 * exact value, and used only in an outbound request body. */
export function toMajorUnits(amount: Decimal): number {
  return Number(toScale(amount, 2));
}

/** SumUp reports `amount` as a JSON number in major units. Round to cents via integer arithmetic
 * on the scaled value so `0.30000000000000004` becomes `"0.30"`, then rebuild the exact decimal. */
export function fromMajorUnits(major: number): Decimal {
  const cents = Math.round(major * 100);
  const sign = cents < 0 ? "-" : "";
  const s = String(Math.abs(cents)).padStart(3, "0");
  return decimal(`${sign}${s.slice(0, -2)}.${s.slice(-2)}`);
}
```

`src/testing/fake-sumup.ts`:

```ts
import type { Decimal } from "@waitron/shared";
import type { CreateCheckoutOutcome, SumUpClient, SumUpTransaction, TransactionQuery } from "../client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

interface Held {
  id: string;
  clientTransactionId: string;
  foreignTransactionId: string;
  status: SumUpTransaction["status"];
  amount: Decimal;
}

/** A deterministic in-memory `SumUpClient`. NOT barrel-exported. Test controls shape the NEXT
 * checkout: `declineNext` (the customer's card is refused → `FAILED`), `cancelNext` (→ `CANCELLED`),
 * `stallNext` (stays `PENDING` until `settle`/`decline` is called by name), `refuseNext` (SumUp
 * rejects the create with a 4xx), `throwOnCreateNext` (network error on create),
 * `throwOnFindNext` (network error mid-poll), `invisibleUntilSettled` (the transaction is not
 * findable — 404 — until it resolves; models a reader that has not started the checkout),
 * `refundRefusesNext`; `setStatus(clientTransactionId, status)` writes any status, including
 * `REFUNDED` or an unknown one, for the sweep tests. */
export class FakeSumUp implements SumUpClient {
  lastCreate: Parameters<SumUpClient["createCheckout"]>[0] | undefined;
  lastRefund: { transactionId: string; amount?: Decimal } | undefined;
  private next: "SUCCESSFUL" | "FAILED" | "CANCELLED" | "PENDING" = "SUCCESSFUL";
  private nextCreateRefused = false;
  private nextCreateThrows = false;
  private nextFindThrows = false;
  private nextRefundRefuses = false;
  private hideUntilSettled = false;
  private readonly held: Held[] = [];

  declineNext(): void { this.next = "FAILED"; }
  cancelNext(): void { this.next = "CANCELLED"; }
  stallNext(): void { this.next = "PENDING"; }
  refuseNext(): void { this.nextCreateRefused = true; }
  throwOnCreateNext(): void { this.nextCreateThrows = true; }
  throwOnFindNext(): void { this.nextFindThrows = true; }
  invisibleUntilSettled(): void { this.hideUntilSettled = true; }
  refundRefusesNext(): void { this.nextRefundRefuses = true; }

  /** Resolve a stalled checkout by its client transaction id. */
  settle(clientTransactionId: string): void { this.setStatus(clientTransactionId, "SUCCESSFUL"); }
  decline(clientTransactionId: string): void { this.setStatus(clientTransactionId, "FAILED"); }
  setStatus(clientTransactionId: string, status: SumUpTransaction["status"]): void {
    const h = this.held.find((x) => x.clientTransactionId === clientTransactionId);
    if (h === undefined) throw new Error(`FakeSumUp: no checkout ${clientTransactionId}`);
    h.status = status;
  }
  /** Register a transaction the adapter never created through this fake (a crash-before-stamp row
   * the sweep must find by OUR key) — `foreignTransactionId` is the adapter's payment_ref. */
  hold(t: { foreignTransactionId: string; status: SumUpTransaction["status"]; amount: Decimal }): string {
    const clientTransactionId = nextId("ctx");
    this.held.push({ id: nextId("txn"), clientTransactionId, ...t });
    return clientTransactionId;
  }

  createCheckout(params: Parameters<SumUpClient["createCheckout"]>[0]): Promise<CreateCheckoutOutcome> {
    this.lastCreate = params;
    if (this.nextCreateThrows) { this.nextCreateThrows = false; return Promise.reject(new Error("sumup unreachable")); }
    if (this.nextCreateRefused) { this.nextCreateRefused = false; return Promise.resolve({ accepted: false, reason: "Unprocessable Entity" }); }
    const clientTransactionId = nextId("ctx");
    this.held.push({ id: nextId("txn"), clientTransactionId, foreignTransactionId: params.foreignTransactionId, status: this.next, amount: params.amount });
    this.next = "SUCCESSFUL";
    return Promise.resolve({ accepted: true, checkoutId: nextId("chk"), clientTransactionId });
  }

  findTransaction(query: TransactionQuery): Promise<SumUpTransaction | null> {
    if (this.nextFindThrows) { this.nextFindThrows = false; return Promise.reject(new Error("sumup unreachable")); }
    const h = this.held.find((x) =>
      "clientTransactionId" in query ? x.clientTransactionId === query.clientTransactionId
      : "foreignTransactionId" in query ? x.foreignTransactionId === query.foreignTransactionId
      : x.id === query.id);
    if (h === undefined) return Promise.resolve(null);
    if (this.hideUntilSettled && h.status === "PENDING") return Promise.resolve(null);
    return Promise.resolve({ id: h.id, status: h.status, amount: h.amount });
  }

  refund(params: { transactionId: string; amount?: Decimal }): Promise<{ status: "accepted" | "refused" }> {
    this.lastRefund = params;
    if (this.nextRefundRefuses) { this.nextRefundRefuses = false; return Promise.resolve({ status: "refused" }); }
    const h = this.held.find((x) => x.id === params.transactionId);
    if (h !== undefined && params.amount === undefined) h.status = "REFUNDED";
    return Promise.resolve({ status: "accepted" });
  }
}
```

`src/testing/fake-sumup.test.ts`: one `describe` proving each control does what its doc says (default create → `SUCCESSFUL`; `stallNext` → `PENDING` then `settle` → `SUCCESSFUL`; `invisibleUntilSettled` → `null` while pending, found after `settle`; `refuseNext` → `{accepted:false}`; `throwOnCreateNext` rejects; lookup by all three query shapes; `refund` without amount flips to `REFUNDED`; `refundRefusesNext`). Fakes are coverage-excluded, but the test is what makes the controls trustworthy.

`src/testing/global-setup.ts`: copy `packages/payments-stripe/src/testing/global-setup.ts`; keep the `core_payments` template; replace the three roles with one, `{ name: "sumup_probe", password: "probe", inRole: "app_user" }`; shorten the docblock to the invariant (one shared container, one template, cluster-global roles must be distinct, so this package names its own).

`src/index.ts` (temporary — Task 5 completes it):

```ts
import "./errors.js";
export type { SumUpClient, SumUpTransaction, SumUpStatus, CreateCheckoutOutcome, TransactionQuery } from "./client.js";
export { toMinorUnits, toMajorUnits, fromMajorUnits } from "./client.js";
```

- [ ] **Step 5: Register the package in the five lists** named in *Files* above, then run the root guards

Run: `pnpm -w vitest run scripts/english-only.test.ts scripts/ci-workflow.test.mjs scripts/errors-reachable.test.ts scripts/coverage-thresholds.test.ts` (the root project — read `vitest.config.ts` for the exact invocation the repo uses; `pnpm test` at the root also runs it).
Expected: green. `errors-reachable` discovers `packages/payments-sumup` (it ships `src/index.ts` + `src/errors.ts`) and sees the `import "./errors.js"` edge from the barrel.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @waitron/payments-sumup lint && pnpm --filter @waitron/payments-sumup typecheck && pnpm --filter @waitron/payments-sumup test:coverage && pnpm format:check
git add packages/payments-sumup pnpm-lock.yaml packages/db/src/english-only.ts scripts/english-only.test.ts scripts/changed-scope.mjs .github/workflows/ci.yml eslint.config.js
git commit -s -m "payments-sumup: package scaffold, SumUpClient seam, FakeSumUp, CI registration"
```

---

### Task 3: `SumUpCloudProvider.collect`

**Files:**
- Create: `packages/payments-sumup/src/provider.ts`, `src/provider.test.ts` (PGlite, hermetic), `src/sumup.test.ts` (real PG, `sumup_probe`)

**Interfaces:**
- Consumes: Task 1's store functions; Task 2's `SumUpClient`, `FakeSumUp`.
- Produces:

```ts
export interface SumUpCloudProviderOptions {
  client: SumUpClient;
  db: Database;
  tenantId: TenantId;
  nodeId: string;
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  incidents: IncidentSink;           // @waitron/payments — the sweep's incident writer (Task 4)
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  now?: () => Date;
}
export class SumUpCloudProvider implements PaymentProvider  // provider = "sumup"
```

- [ ] **Step 1: Write the failing hermetic tests** (`src/provider.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal, isAppError, tenantId as brandTenantId, tillId as brandTillId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { SumUpCloudProvider } from "./provider.js";

// PGlite: this file proves the adapter's LOGIC (T1/T1.5/T2 sequencing, outcome mapping, the poll
// window). Whether the same writes land as a non-superuser app_user member is sumup.test.ts's
// question, which needs real Postgres (CLAUDE.md §4). Nothing here depends on the role or on
// concurrency.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS], timeoutMs: 60_000 });
const NODE = "11111111-1111-4111-8111-111111111111";

async function setup(tune?: (f: FakeSumUp) => void) {
  const t = await seedWorkingOrder(suite.db, freshNif());
  const fake = new FakeSumUp();
  tune?.(fake);
  const provider = new SumUpCloudProvider({
    client: fake,
    db: suite.db,
    tenantId: brandTenantId(t.tenantId),
    nodeId: NODE,
    resolveReader: () => Promise.resolve("rdr_1"),
    incidents: () => Promise.resolve(true),
    poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
  });
  const params = {
    tenantId: brandTenantId(t.tenantId),
    tillId: brandTillId(t.tillId),
    workingOrderId: brandWorkingOrderId(t.workingOrderId),
    amount: decimal("12.50"),
  };
  const row = (ref: string) =>
    withTenant(suite.db, t.tenantId, (tx) => getPaymentByRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: ref }));
  return { t, fake, provider, params, row };
}

describe("SumUpCloudProvider.collect", () => {
  it("captures: T1 attempting → checkout keyed by our payment_ref → poll → T2 captured with SumUp's transaction id", async () => {
    const { fake, provider, params, row } = await setup();
    const result = await provider.collect(params);
    expect(result).toMatchObject({ provider: "sumup", state: "captured", amount: decimal("12.50") });
    expect(result.settledAt).toBeInstanceOf(Date);
    expect(fake.lastCreate).toMatchObject({ readerId: "rdr_1", currency: "EUR", amount: decimal("12.50"), foreignTransactionId: result.paymentRef });
    const r = await row(result.paymentRef);
    expect(r.state).toBe("captured");
    expect(r.externalRef).toMatch(/^txn_/); // the REFUNDABLE id, not the ctx_ poll key
  });

  it("a declined card resolves failed with settledAt null", async () => {
    const { provider, params, row } = await setup((f) => f.declineNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "failed", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("failed");
  });

  it("a cancelled checkout resolves failed", async () => {
    const { provider, params } = await setup((f) => f.cancelNext());
    expect((await provider.collect(params)).state).toBe("failed");
  });

  it("a definite 4xx refusal of the create resolves failed (the reader never woke)", async () => {
    const { provider, params, row } = await setup((f) => f.refuseNext());
    const result = await provider.collect(params);
    expect(result.state).toBe("failed");
    expect((await row(result.paymentRef)).state).toBe("failed");
  });

  it("a network error on the create leaves the row attempting (we do not know whether SumUp accepted it)", async () => {
    const { provider, params, row } = await setup((f) => f.throwOnCreateNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("attempting");
  });

  it("a poll timeout leaves the row attempting with the ctx poll key stamped, and never calls terminate", async () => {
    const { provider, params, row } = await setup((f) => f.stallNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    const r = await row(result.paymentRef);
    expect(r.state).toBe("attempting");
    expect(r.externalRef).toMatch(/^ctx_/);
  });

  it("a transaction SumUp cannot find yet is still pending, not an error", async () => {
    const { provider, params } = await setup((f) => { f.stallNext(); f.invisibleUntilSettled(); });
    expect((await provider.collect(params)).state).toBe("attempting");
  });

  it("a network error mid-poll leaves the row attempting", async () => {
    const { provider, params } = await setup((f) => f.throwOnFindNext());
    expect((await provider.collect(params)).state).toBe("attempting");
  });

  it("REFUNDED during collect is not a basis for T2: the row stays attempting for the sweep", async () => {
    const { provider, params, row } = await setup((f) => f.resolveOnFirstFind("REFUNDED"));
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("attempting");
  });

  it("refuses a collect for another tenant before any network call (sumup.tenant_mismatch)", async () => {
    const { fake, provider, params } = await setup();
    const other = brandTenantId("22222222-2222-4222-8222-222222222222");
    await expect(provider.collect({ ...params, tenantId: other })).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "sumup.tenant_mismatch");
    expect(fake.lastCreate).toBeUndefined();
  });
});
```

(`resolveOnFirstFind(status)` is one more `FakeSumUp` control: the next checkout created is given `status` the first time it is looked up. Add it to `fake-sumup.ts` and `fake-sumup.test.ts` in this task.)

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/payments-sumup test provider.test`
Expected: FAIL — cannot resolve `./provider.js`.

- [ ] **Step 3: Write `provider.ts`** (`collect` and the constructor; `resolvePending` is a throwing stub until Task 4, reversals until Task 5)

```ts
import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { CollectParams, ForwardResult, IncidentSink, PaymentProvider, PaymentResult, ProviderCapabilities } from "@waitron/payments";
import { captureAttempting, failAttempting, insertAttempting, stampAttemptingRef } from "@waitron/payments";
import type { SumUpClient, SumUpTransaction } from "./client.js";
import "./errors.js";

export const SUMUP_PROVIDER = "sumup";
const CURRENCY = "EUR";
/** SumUp gives the reader 60 s to START the checkout, then the customer taps; two minutes covers
 * a slow tap. Longer than Stripe's 60 s window for that reason. */
const DEFAULT_POLL = {
  maxAttempts: 120,
  intervalMs: 1000,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export interface SumUpCloudProviderOptions {
  client: SumUpClient;
  /** A plain `Database` handle; every phase is scoped with `withTenant(db, tenantId, …)`. */
  db: Database;
  /** The tenant this provider serves — a per-till object, one tenant, known at construction. */
  tenantId: TenantId;
  nodeId: string;
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  /** Where `resolvePending` raises `payment.pending_outcome_unactionable`. */
  incidents: IncidentSink;
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  now?: () => Date;
}

/** One SumUp status mapped onto a T2 decision, as DATA. `pending` = keep polling; `deferred` = a
 * status this adapter is not entitled to act on (`REFUNDED`, unknown) — the loop stops, the row
 * stays `attempting`, and `resolvePending` decides (spec §2/§3). */
type PollOutcome =
  | { kind: "captured"; transactionId: string; settledAt: Date }
  | { kind: "failed" }
  | { kind: "pending" }
  | { kind: "deferred" };

/**
 * The SumUp Cloud API `PaymentProvider` (server-driven, asynchronous outcome). `collect`:
 *  T1   commit an `attempting` row keyed by a fresh `payment_ref` (before any network);
 *  net  create a reader checkout carrying that `payment_ref` as `foreign_transaction_id`;
 *  T1.5 stamp SumUp's `client_transaction_id` into `external_ref` (the POLL key — on a captured row
 *       `external_ref` becomes SumUp's transaction id, the REFUNDABLE key; see `captureAttempting`);
 *  poll the transaction until `status` leaves `PENDING`;
 *  T2   `captured` on `SUCCESSFUL`, `failed` on `FAILED`/`CANCELLED` or a definite create refusal.
 * Anything else — a timeout, a network error, `REFUNDED`, an unknown status — is NOT resolved here:
 * the row stays `attempting` and the result carries `state: "attempting"`, `settledAt: null`, so
 * `recordSale` refuses and staff retry or take cash. `Terminate Checkout` is never called: it races
 * the customer's tap (spec §2). `resolvePending` (the sweep) is what terminates those rows.
 */
export class SumUpCloudProvider implements PaymentProvider {
  readonly provider = SUMUP_PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private readonly poll: Required<NonNullable<SumUpCloudProviderOptions["poll"]>>;
  private readonly now: () => Date;

  constructor(private readonly opts: SumUpCloudProviderOptions) {
    this.poll = { ...DEFAULT_POLL, ...opts.poll };
    this.now = opts.now ?? (() => new Date());
  }

  /** Case-insensitive, as `StripeTerminalProvider.requireOwnTenant` explains (Postgres renders a
   * uuid lowercase; `tenantId()` preserves the caller's case). Before any network call. */
  private requireOwnTenant(supplied: TenantId): void {
    if (supplied.toLowerCase() !== this.opts.tenantId.toLowerCase()) {
      throw new AppError("sumup.tenant_mismatch", { expected: this.opts.tenantId, supplied });
    }
  }

  private inTenant<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(this.opts.db, this.opts.tenantId, fn);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    this.requireOwnTenant(params.tenantId);
    const readerId = await this.opts.resolveReader(params.tenantId, params.tillId);
    const paymentRef = randomUUID();
    const key = { tenantId: params.tenantId, provider: SUMUP_PROVIDER, paymentRef };

    // T1
    await this.inTenant((tx) =>
      insertAttempting(tx, { tenantId: params.tenantId, workingOrderId: params.workingOrderId, provider: SUMUP_PROVIDER, paymentRef, amount: params.amount }),
    );

    // Network: create. Three outcomes (see `CreateCheckoutOutcome`).
    let created;
    try {
      created = await this.opts.client.createCheckout({
        readerId,
        amount: params.amount,
        currency: CURRENCY,
        description: `waitron ${params.workingOrderId}`,
        foreignTransactionId: paymentRef,
      });
    } catch {
      return this.pendingResult(paymentRef, params.amount);
    }
    if (!created.accepted) {
      const row = await this.inTenant((tx) => failAttempting(tx, key));
      return { provider: SUMUP_PROVIDER, paymentRef, state: row.state, amount: params.amount, settledAt: null };
    }

    // T1.5
    await this.inTenant((tx) => stampAttemptingRef(tx, key, created.clientTransactionId));

    // Poll — outside any transaction.
    const outcome = await this.pollUntilResolved({ clientTransactionId: created.clientTransactionId });

    // T2 — only a captured or failed outcome is a basis for it.
    if (outcome.kind === "pending" || outcome.kind === "deferred") {
      return this.pendingResult(paymentRef, params.amount);
    }
    const row = await this.inTenant((tx) =>
      outcome.kind === "captured"
        ? captureAttempting(tx, { ...key, settledAt: outcome.settledAt, externalRef: outcome.transactionId })
        : failAttempting(tx, key),
    );
    return {
      provider: SUMUP_PROVIDER,
      paymentRef,
      state: row.state,
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  private pendingResult(paymentRef: string, amount: Decimal): PaymentResult {
    return { provider: SUMUP_PROVIDER, paymentRef, state: "attempting", amount, settledAt: null };
  }

  /** Only the three documented terminal statuses resolve a row; `REFUNDED` and anything
   * unrecognised are `deferred` to the sweep (spec §2). A null (SumUp holds no transaction yet —
   * the reader has not started the checkout) is `pending`. */
  static classify(t: SumUpTransaction | null, now: Date): PollOutcome {
    if (t === null || t.status === "PENDING") return { kind: "pending" };
    if (t.status === "SUCCESSFUL") return { kind: "captured", transactionId: t.id, settledAt: now };
    if (t.status === "FAILED" || t.status === "CANCELLED") return { kind: "failed" };
    return { kind: "deferred" };
  }

  /** Poll until a T2 decision or the window closes. A network error mid-poll and an exhausted
   * window both come back as `pending`: the caller leaves the row `attempting` either way. */
  private async pollUntilResolved(query: { clientTransactionId: string }): Promise<PollOutcome> {
    try {
      for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
        const outcome = SumUpCloudProvider.classify(await this.opts.client.findTransaction(query), this.now());
        if (outcome.kind !== "pending") return outcome;
        await this.poll.sleep(this.poll.intervalMs);
      }
      return { kind: "pending" };
    } catch {
      return { kind: "pending" };
    }
  }

  forward(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }
  resolvePending(_now: Date): Promise<ForwardResult> {
    throw new Error("Task 4");
  }
  void(_ref: string): Promise<PaymentResult> {
    throw new Error("Task 5");
  }
  refund(_ref: string): Promise<PaymentResult> {
    throw new Error("Task 5");
  }
  partialRefund(_ref: string, _amount: Decimal): Promise<PaymentResult> {
    throw new Error("Task 5");
  }
}
```

Add `eslint-disable-next-line @typescript-eslint/no-unused-vars` lines for the unused `_now`/`_ref`/`_amount` parameters on the four stubs, exactly as the Stripe provider does for `forward`.

- [ ] **Step 4: Run the hermetic suite to see it pass**

Run: `pnpm --filter @waitron/payments-sumup test provider.test`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the real-PG suite** (`src/sumup.test.ts`) — copy `packages/payments-stripe/src/stripe.test.ts`'s shape: `useTemplateDb({ template: "core_payments" })`, `connectAs("sumup_probe", "probe")`, one test that `collect` lands a `captured` row when handed the probe's `Database`, and ONE two-tenant probe:

```ts
  it("resolvePending as app_user never touches another tenant's attempting row", async () => {
    // Written now, asserted in Task 4: a second tenant's attempting row for provider "sumup"
    // must still be attempting after this tenant's provider sweeps. Skip until Task 4 lands
    // resolvePending, then remove the skip.
  });
```

(Leave it as `it.todo` with that text; Task 4 fills it in. The reason the two-tenant probe runs here and not on PGlite is CLAUDE.md §3's till-reroute receipt: only a run as `app_user` on a real cluster caught the by-id leak.)

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-sumup test:coverage`
Expected: green, coverage over the floor (the stubs' throw lines are uncovered — acceptable until Tasks 4–5; if the floor fails, mark ALL FOUR stub bodies (`resolvePending`, `void`, `refund`, `partialRefund`) `/* v8 ignore next */` and REMOVE each ignore in the task that implements that method — `resolvePending` in Task 4, the three reversals in Task 5).

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @waitron/payments-sumup lint && pnpm --filter @waitron/payments-sumup typecheck && pnpm format:check
git add packages/payments-sumup
git commit -s -m "payments-sumup: SumUpCloudProvider.collect — T1, checkout keyed by payment_ref, T1.5 poll-key stamp, poll, T2"
```

---

### Task 4: `resolvePending` — the sweep

**Files:**
- Modify: `packages/payments-sumup/src/provider.ts` (replace the stub)
- Create: `packages/payments-sumup/src/resolve-pending.test.ts` (PGlite)
- Modify: `packages/payments-sumup/src/sumup.test.ts` (fill in the two-tenant probe)
- Modify: `packages/payments-sumup/src/testing/fake-sumup.ts` if a control is missing

**Interfaces:**
- Consumes: `listAttempting`, `captureAttempting`, `failAttempting`, `tillsForWorkingOrders` (all `@waitron/payments`), `IncidentSink`.
- Produces: `SumUpCloudProvider.resolvePending(now)`; exported constants `RESOLVE_RETRY_MS = 60_000`, `NOT_FOUND_GRACE_MS = 15 * 60_000`.

- [ ] **Step 1: Write the failing sweep tests** (`src/resolve-pending.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal, tenantId as brandTenantId, tillId as brandTillId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef, insertAttempting, stampAttemptingRef } from "@waitron/payments";
import type { IncidentSink } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { NOT_FOUND_GRACE_MS, RESOLVE_RETRY_MS, SumUpCloudProvider } from "./provider.js";

// PGlite — the sweep's logic. The grant/tenant questions are sumup.test.ts's (real PG).
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS], timeoutMs: 60_000 });
const T0 = new Date("2026-09-11T10:00:00Z");

async function setup() {
  const t = await seedWorkingOrder(suite.db, freshNif());
  const fake = new FakeSumUp();
  const raised: Parameters<IncidentSink>[1][] = [];
  const incidents: IncidentSink = (_tx, input) => { raised.push(input); return Promise.resolve(true); };
  const provider = new SumUpCloudProvider({
    client: fake, db: suite.db, tenantId: brandTenantId(t.tenantId), nodeId: "11111111-1111-4111-8111-111111111111",
    resolveReader: () => Promise.resolve("rdr_1"), incidents, poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() }, now: () => T0,
  });
  /** An attempting row as `collect` leaves one after a timeout: T1 + T1.5 done, poll key stamped. */
  const attempting = async (paymentRef: string, opts: { stamped?: boolean; status?: string } = {}) => {
    await withTenant(suite.db, t.tenantId, (tx) =>
      insertAttempting(tx, { tenantId: t.tenantId, workingOrderId: t.workingOrderId, provider: "sumup", paymentRef, amount: decimal("7.00") }));
    const ctx = fake.hold({ foreignTransactionId: paymentRef, status: opts.status ?? "PENDING", amount: decimal("7.00") });
    if (opts.stamped !== false) await withTenant(suite.db, t.tenantId, (tx) => stampAttemptingRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef }, ctx));
    return ctx;
  };
  const state = (ref: string) => withTenant(suite.db, t.tenantId, (tx) => getPaymentByRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: ref }));
  return { t, fake, provider, raised, attempting, state };
}

describe("SumUpCloudProvider.resolvePending", () => {
  it("captures a row SumUp now reports SUCCESSFUL, stamping the refundable transaction id", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("a", { status: "SUCCESSFUL" });
    const r = await provider.resolvePending(T0);
    expect(r).toEqual({ nextDueAt: null, forwarded: 1, declined: 0, incidentsRaised: 0 });
    const row = await state("a");
    expect(row.state).toBe("captured");
    expect(row.externalRef).toMatch(/^txn_/);
    expect(row.settledAt).not.toBeNull();
  });

  it("fails a row SumUp reports FAILED or CANCELLED, no incident", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("f", { status: "FAILED" });
    await attempting("c", { status: "CANCELLED" });
    expect(await provider.resolvePending(T0)).toEqual({ nextDueAt: null, forwarded: 0, declined: 2, incidentsRaised: 0 });
    expect((await state("f")).state).toBe("failed");
    expect((await state("c")).state).toBe("failed");
  });

  it("leaves a still-PENDING row alone and asks to be run again in RESOLVE_RETRY_MS", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("p");
    expect(await provider.resolvePending(T0)).toEqual({ nextDueAt: new Date(T0.getTime() + RESOLVE_RETRY_MS), forwarded: 0, declined: 0, incidentsRaised: 0 });
    expect((await state("p")).state).toBe("attempting");
  });

  it("finds a crash-before-stamp row by OUR key (foreign_transaction_id) and resolves it", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("u", { stamped: false, status: "SUCCESSFUL" });
    expect((await provider.resolvePending(T0)).forwarded).toBe(1);
    expect((await state("u")).state).toBe("captured");
  });

  it("a row SumUp holds nothing for is pending inside the grace period and failed after it", async () => {
    const { t, provider, state } = await setup();
    await withTenant(suite.db, t.tenantId, (tx) =>
      insertAttempting(tx, { tenantId: t.tenantId, workingOrderId: t.workingOrderId, provider: "sumup", paymentRef: "ghost", amount: decimal("7.00") }));
    // created_at is now(); T0 is in the past relative to it, so the row is "young" at T0…
    expect((await provider.resolvePending(T0)).nextDueAt).not.toBeNull();
    expect((await state("ghost")).state).toBe("attempting");
    // …and old once `now` is past created_at + grace.
    const later = new Date(Date.now() + NOT_FOUND_GRACE_MS + 1000);
    expect(await provider.resolvePending(later)).toMatchObject({ declined: 1, incidentsRaised: 0 });
    expect((await state("ghost")).state).toBe("failed");
  });

  it("REFUNDED resolves failed WITH a payment.pending_outcome_unactionable incident naming the till", async () => {
    const { t, provider, attempting, state, raised } = await setup();
    await attempting("r", { status: "REFUNDED" });
    expect(await provider.resolvePending(T0)).toMatchObject({ declined: 1, incidentsRaised: 1 });
    expect((await state("r")).state).toBe("failed");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ tenantId: t.tenantId, tillId: t.tillId, severity: "error", detectedAt: T0 });
    expect(raised[0]!.error.code).toBe("payment.pending_outcome_unactionable");
    expect(raised[0]!.error.params).toEqual({ paymentRef: "r", status: "REFUNDED" });
  });

  it("an unknown status resolves failed with an incident naming the value", async () => {
    const { provider, attempting, raised } = await setup();
    await attempting("x", { status: "CHARGE_BACK" });
    expect(await provider.resolvePending(T0)).toMatchObject({ declined: 1, incidentsRaised: 1 });
    expect(raised[0]!.error.params).toEqual({ paymentRef: "x", status: "CHARGE_BACK" });
  });

  it("a network error on one row defers that row and still resolves the others", async () => {
    const { fake, provider, attempting, state } = await setup();
    await attempting("first", { status: "SUCCESSFUL" });
    await attempting("second", { status: "SUCCESSFUL" });
    fake.throwOnFindNext();
    const r = await provider.resolvePending(T0);
    expect(r.forwarded).toBe(1);
    expect(r.nextDueAt).not.toBeNull();
    const states = [(await state("first")).state, (await state("second")).state].sort();
    expect(states).toEqual(["attempting", "captured"]);
  });

  it("an empty sweep is all-zeros", async () => {
    const { provider } = await setup();
    expect(await provider.resolvePending(T0)).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @waitron/payments-sumup test resolve-pending`
Expected: FAIL — `Task 4` thrown / `RESOLVE_RETRY_MS` not exported.

- [ ] **Step 3: Implement the sweep** (replace the stub in `provider.ts`)

```ts
export const RESOLVE_RETRY_MS = 60_000;
/** How long a row SumUp holds NO transaction for is still "pending". A create whose response was
 * lost may have been accepted; SumUp's own 60 s reader window plus a generous tap allowance is far
 * inside 15 min. After it, SumUp having nothing means no money moved: `failed`, no incident. */
export const NOT_FOUND_GRACE_MS = 15 * 60_000;

  /**
   * One pass over this tenant's `attempting` rows (spec §3). T1 lists them (unlocked); each is
   * looked up at SumUp OUTSIDE any transaction — by the stamped poll key, else by OUR
   * `payment_ref` (`foreign_transaction_id`) for a row that crashed before T1.5 — and resolved in
   * its own short T2:
   *   SUCCESSFUL → captured;  FAILED / CANCELLED → failed;
   *   PENDING, or not found inside the grace period, or a network error → left, `nextDueAt` set;
   *   not found past the grace period → failed (SumUp holds nothing: no money moved), no incident;
   *   REFUNDED / unknown → failed + `payment.pending_outcome_unactionable` (money may have moved
   *   through a payment that never carried a sale — a human must look).
   * This is the one place a terminal state is written on incomplete information, safe only because
   * the outcome has stopped moving by the time the sweep sees it. The sweep MUST terminate every
   * row it can, or a deferred status would be swept forever (spec §3).
   */
  async resolvePending(now: Date): Promise<ForwardResult> {
    const rows = await this.inTenant((tx) => listAttempting(tx, this.opts.tenantId, SUMUP_PROVIDER));
    if (rows.length === 0) return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };

    let forwarded = 0, declined = 0, incidentsRaised = 0, deferred = false;
    for (const row of rows) {
      const key = { tenantId: row.tenantId, provider: SUMUP_PROVIDER, paymentRef: row.paymentRef };
      let t: SumUpTransaction | null;
      try {
        t = await this.opts.client.findTransaction(
          row.externalRef === null ? { foreignTransactionId: row.paymentRef } : { clientTransactionId: row.externalRef },
        );
      } catch {
        deferred = true;
        continue;
      }
      if (t === null) {
        if (now.getTime() - new Date(row.createdAt).getTime() < NOT_FOUND_GRACE_MS) { deferred = true; continue; }
        await this.inTenant((tx) => failAttempting(tx, key));
        declined++;
        continue;
      }
      if (t.status === "PENDING") { deferred = true; continue; }
      if (t.status === "SUCCESSFUL") {
        await this.inTenant((tx) => captureAttempting(tx, { ...key, settledAt: now, externalRef: t.id }));
        forwarded++;
        continue;
      }
      const unactionable = t.status !== "FAILED" && t.status !== "CANCELLED";
      const raised = await this.inTenant(async (tx) => {
        await failAttempting(tx, key);
        if (!unactionable) return false;
        const tills = await tillsForWorkingOrders(tx, row.tenantId, [row.workingOrderId]);
        const tillId = tills.get(row.workingOrderId);
        if (tillId === undefined) return false;
        return this.opts.incidents(tx, {
          tenantId: brandTenantId(row.tenantId),
          tillId: brandTillId(tillId),
          error: new AppError("payment.pending_outcome_unactionable", { paymentRef: row.paymentRef, status: t.status }),
          severity: "error",
          detectedAt: now,
        });
      });
      declined++;
      if (raised) incidentsRaised++;
    }
    return { nextDueAt: deferred ? new Date(now.getTime() + RESOLVE_RETRY_MS) : null, forwarded, declined, incidentsRaised };
  }
```

Add the imports (`listAttempting`, `tillsForWorkingOrders` from `@waitron/payments`; `tenantId as brandTenantId`, `tillId as brandTillId` from `@waitron/shared`). `IncidentSink`'s `tenantId`/`tillId` are branded, hence the brands; `saleId` is omitted (an attempting row has none).

Known, accepted: because the incident carries no `saleId`, `recordIncidentOnce` dedups per open `(tenant, till, code, sale_id=null)`, so two unactionable rows on the SAME till in one sweep collapse to ONE incident and `incidentsRaised` undercounts (the Task-4 tests use a pass-through sink, so they count each call and do not see this — that is fine, the count is a log field, not an assertion of DB state). Spec §3 only requires that a human be alerted, which one incident per till satisfies. State this in the method's header so a future reader does not expect one incident per row.

- [ ] **Step 4: Run the sweep suite and the hermetic suite**

Run: `pnpm --filter @waitron/payments-sumup test`
Expected: PASS.

- [ ] **Step 5: Fill in the two-tenant probe** in `src/sumup.test.ts`, as `sumup_probe` (real PG):

```ts
  it("resolvePending as app_user resolves only its own tenant's rows (a second tenant's stays attempting)", async () => {
    const a = await seedWorkingOrder(suite.admin, freshNif());
    const b = await seedWorkingOrder(suite.admin, freshNif());
    const fake = new FakeSumUp();
    for (const t of [a, b]) {
      await withTenant(suite.admin, t.tenantId, (tx) =>
        insertAttempting(tx, { tenantId: t.tenantId, workingOrderId: t.workingOrderId, provider: "sumup", paymentRef: `ref-${t.tenantId}`, amount: decimal("1.00") }));
      fake.hold({ foreignTransactionId: `ref-${t.tenantId}`, status: "SUCCESSFUL", amount: decimal("1.00") });
    }
    const probe = await suite.pg.connectAs("sumup_probe", "probe");
    try {
      const provider = new SumUpCloudProvider({ client: fake, db: probe, tenantId: brandTenantId(a.tenantId), nodeId: NODE, resolveReader: () => Promise.resolve("rdr_1"), incidents: () => Promise.resolve(true) });
      expect((await provider.resolvePending(new Date())).forwarded).toBe(1);
    } finally {
      await probe.close();
    }
    const stateOf = (t: typeof a) => withTenant(suite.admin, t.tenantId, (tx) => getPaymentByRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: `ref-${t.tenantId}` }));
    expect((await stateOf(a)).state).toBe("captured");
    expect((await stateOf(b)).state).toBe("attempting");
  });
```

**Prove the guard by deletion:** temporarily remove `eq(payments.tenantId, tenantId)` from `listAttempting`'s `where` (Task 1) and run this test; it must fail with tenant b's row `captured`. Restore it. Record the run in the commit message.

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-sumup test:coverage`
Expected: green; remove any `v8 ignore` left on the `resolvePending` stub.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @waitron/payments-sumup lint && pnpm --filter @waitron/payments-sumup typecheck && pnpm format:check
git add packages/payments-sumup
git commit -s -m "payments-sumup: resolvePending sweep — capture/fail by poll key or our own key, grace period, unactionable-outcome incident (tenant predicate proven by deletion)"
```

---

### Task 5: Reversals, the real HTTP binding, the barrel

**Files:**
- Create: `packages/payments-sumup/src/reverse.ts`, `src/reverse.test.ts` (PGlite), `src/sumup-client.ts`
- Modify: `packages/payments-sumup/src/provider.ts` (replace the three stubs), `src/index.ts`

**Interfaces:**
- Produces: `reverseViaSumUp(db, client, ref, kind, amount, { tenantId, nodeId })`; `sumupClient(opts: { apiKey; merchantCode; affiliate?: { appId; key }; baseUrl?; fetch? }): SumUpClient`; barrel exports `SumUpCloudProvider`, `SumUpCloudProviderOptions`, `SUMUP_PROVIDER`, `sumupClient`, `SumUpClientOptions`, the seam types, the three amount functions.

- [ ] **Step 1: Write the failing reversal tests** (`src/reverse.test.ts`, PGlite; the reversal path is the same T1/T2 shape as `packages/payments-stripe/src/provider.test.ts`'s reversal block — read that block first and mirror its four cases)

```ts
describe("SumUpCloudProvider reversals", () => {
  it("void: full refund at SumUp addressed by the captured transaction id, row → voided", async () => {
    const { fake, provider, params, row } = await setup();
    const c = await provider.collect(params);
    const v = await provider.void(c.paymentRef);
    expect(v).toMatchObject({ state: "voided", amount: decimal("12.50"), settledAt: null });
    expect(fake.lastRefund).toEqual({ transactionId: (await row(c.paymentRef)).externalRef });
    expect((await row(c.paymentRef)).state).toBe("voided");
  });
  it("refund: full, row → refunded", async () => { /* same shape, expect state "refunded" */ });
  it("partialRefund: passes the amount and reports the amount REFUNDED", async () => {
    const { fake, provider, params } = await setup();
    const c = await provider.collect(params);
    const p = await provider.partialRefund(c.paymentRef, decimal("2.00"));
    expect(p).toMatchObject({ state: "partially_refunded", amount: decimal("2.00") });
    expect(fake.lastRefund).toMatchObject({ amount: decimal("2.00") });
  });
  it("a SumUp-refused refund records a failed refund and leaves the row captured", async () => {
    const { fake, provider, params, row } = await setup();
    const c = await provider.collect(params);
    fake.refundRefusesNext();
    const r = await provider.refund(c.paymentRef);
    expect(r.state).toBe("captured");
    expect((await row(c.paymentRef)).state).toBe("captured");
  });
  it("a reversal for another tenant's payment is payment.not_found (no refund issued)", async () => { /* construct a second provider for another tenant, expect rejects with code payment.not_found and fake.lastRefund undefined */ });
  it("a reversal of an attempting row is refused locally before any network (payment.not_voidable / not_refundable)", async () => { /* stallNext → collect → void → rejects; fake.lastRefund undefined */ });
});
```

Write the two elided bodies in full in the file (the comments show what each asserts); `setup` is Task 3's helper, moved to `src/testing/setup.ts` and shared by the three PGlite suites.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @waitron/payments-sumup test reverse` → FAIL (`Task 5` thrown).

- [ ] **Step 3: Write `reverse.ts`**

```ts
import { AppError, decimal } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { PaymentResult } from "@waitron/payments";
import { assertReversible, findPaymentByRef, recordFailedRefund, recordRefund, recordVoid } from "@waitron/payments";
import type { SumUpClient } from "./client.js";
import { SUMUP_PROVIDER } from "./provider.js";

/**
 * void / refund / partialRefund via SumUp's refund endpoint (there is no separate void: spec §5,
 * confirmed against SumUp's OpenAPI file 2026-09-10). T1: find + read-only reversibility pre-check
 * inside `withTenant`, refusing a payment of another tenant with the same `payment.not_found` as an
 * absent one; network: the refund, OUTSIDE every transaction; T2: `recordVoid`/`recordRefund`, or
 * `recordFailedRefund` when SumUp refused (the row's state is untouched). The same T1/T2 shape as
 * `reverseViaStripe`; not shared with it because one vendor's package must not import another's —
 * lifting both into a neutral `@waitron/payments` primitive is recorded in the backlog.
 */
export async function reverseViaSumUp(
  db: Database,
  client: Pick<SumUpClient, "refund">,
  ref: string,
  kind: "void" | "refund",
  amount: Decimal | undefined,
  { tenantId }: { tenantId: TenantId; nodeId: string },
): Promise<PaymentResult> {
  const inTransaction = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTenant(db, tenantId, fn);
  const found = await inTransaction(async (tx) => {
    const f = await findPaymentByRef(tx, SUMUP_PROVIDER, ref);
    if (f === undefined || f.externalRef === null || f.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
      throw new AppError("payment.not_found", { provider: SUMUP_PROVIDER, paymentRef: ref });
    }
    await assertReversible(tx, { tenantId: f.tenantId, provider: SUMUP_PROVIDER, paymentRef: ref, kind, amount });
    return { ...f, externalRef: f.externalRef };
  });
  const key = { tenantId: found.tenantId, provider: SUMUP_PROVIDER, paymentRef: ref };
  const attempted = amount ?? decimal(found.amount);

  const outcome = await client.refund({ transactionId: found.externalRef, ...(amount ? { amount } : {}) });
  if (outcome.status === "refused") {
    await inTransaction((tx) => recordFailedRefund(tx, { ...key, amount: attempted }));
    return { provider: SUMUP_PROVIDER, paymentRef: ref, state: found.state, amount: attempted, settledAt: null };
  }
  const row = await inTransaction((tx) => (kind === "void" ? recordVoid(tx, key) : recordRefund(tx, { ...key, amount: attempted })));
  return { provider: SUMUP_PROVIDER, paymentRef: ref, state: row.state, amount: amount ?? decimal(row.amount), settledAt: null };
}
```

Note the circular import (`reverse.ts` imports `SUMUP_PROVIDER` from `provider.ts`, which imports `reverseViaSumUp`): move `SUMUP_PROVIDER` to `client.ts` (export it there) and import it in both. In `provider.ts`, replace the three stubs:

```ts
  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaSumUp(this.opts.db, this.opts.client, ref, kind, amount, { tenantId: this.opts.tenantId, nodeId: this.opts.nodeId });
  }
  void(ref: string): Promise<PaymentResult> { return this.reverse("void", ref); }
  refund(ref: string): Promise<PaymentResult> { return this.reverse("refund", ref); }
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> { return this.reverse("refund", ref, amount); }
```

- [ ] **Step 4: Write `sumup-client.ts`** (the real binding; coverage-excluded, exercised by Task 7's live suite)

```ts
import type { Decimal } from "@waitron/shared";
import { fromMajorUnits, toMajorUnits, toMinorUnits } from "./client.js";
import type { CreateCheckoutOutcome, SumUpClient, SumUpTransaction, TransactionQuery } from "./client.js";

export interface SumUpClientOptions {
  apiKey: string;
  merchantCode: string;
  /** The merchant's affiliate key (developer portal → Affiliate Keys). Absent → the `affiliate`
   * block is omitted and our `payment_ref` is NOT sent; the sweep then relies on the stamped
   * `client_transaction_id` alone. */
  affiliate?: { appId: string; key: string };
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * `SumUpClient` over SumUp's REST API (paths and shapes from SumUp's OpenAPI file, read
 * 2026-09-10 — docs/research/2026-09-10-sumup-solo-experiments.md, Provenance). Every request is
 * a bearer-keyed JSON call; a 5xx or a transport failure THROWS (the caller does not know whether
 * the operation happened), a 4xx is a definite refusal and is returned as data. Error bodies are
 * never included in a thrown message: they can echo request fields.
 */
export function sumupClient(opts: SumUpClientOptions): SumUpClient {
  const base = (opts.baseUrl ?? "https://api.sumup.com").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const mc = encodeURIComponent(opts.merchantCode);
  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status >= 500) throw new Error(`sumup ${method} ${path}: HTTP ${res.status}`);
    const text = await res.text();
    return { status: res.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
  };
  const problemTitle = (json: unknown): string =>
    typeof json === "object" && json !== null && typeof (json as { title?: unknown }).title === "string" ? (json as { title: string }).title : "refused";

  return {
    async createCheckout(p): Promise<CreateCheckoutOutcome> {
      const body = {
        total_amount: { currency: p.currency, minor_unit: 2, value: toMinorUnits(p.amount) },
        description: p.description,
        ...(opts.affiliate ? { affiliate: { app_id: opts.affiliate.appId, key: opts.affiliate.key, foreign_transaction_id: p.foreignTransactionId } } : {}),
      };
      const r = await call("POST", `/v0.1/merchants/${mc}/readers/${encodeURIComponent(p.readerId)}/checkout`, body);
      if (r.status >= 400) return { accepted: false, reason: problemTitle(r.json) };
      const data = (r.json as { data: { checkout_id: string; client_transaction_id: string } }).data;
      return { accepted: true, checkoutId: data.checkout_id, clientTransactionId: data.client_transaction_id };
    },
    async findTransaction(q: TransactionQuery): Promise<SumUpTransaction | null> {
      const param = "clientTransactionId" in q ? `client_transaction_id=${encodeURIComponent(q.clientTransactionId)}`
        : "foreignTransactionId" in q ? `foreign_transaction_id=${encodeURIComponent(q.foreignTransactionId)}`
        : `id=${encodeURIComponent(q.id)}`;
      const r = await call("GET", `/v2.1/merchants/${mc}/transactions?${param}`);
      if (r.status === 404) return null;
      if (r.status >= 400) throw new Error(`sumup GET transactions: HTTP ${r.status}`);
      const t = r.json as { id: string; status: string; amount: number };
      return { id: t.id, status: t.status, amount: fromMajorUnits(t.amount) };
    },
    async refund(p: { transactionId: string; amount?: Decimal }) {
      const r = await call("POST", `/v1.0/merchants/${mc}/payments/${encodeURIComponent(p.transactionId)}/refunds`,
        p.amount === undefined ? {} : { amount: toMajorUnits(p.amount) });
      return { status: r.status >= 400 ? "refused" : "accepted" } as const;
    },
  };
}
```

- [ ] **Step 5: Complete the barrel** (`src/index.ts`)

```ts
import "./errors.js";
export type { SumUpClient, SumUpTransaction, SumUpStatus, CreateCheckoutOutcome, TransactionQuery } from "./client.js";
export { SUMUP_PROVIDER, toMinorUnits, toMajorUnits, fromMajorUnits } from "./client.js";
export { SumUpCloudProvider, NOT_FOUND_GRACE_MS, RESOLVE_RETRY_MS } from "./provider.js";
export type { SumUpCloudProviderOptions } from "./provider.js";
export { sumupClient } from "./sumup-client.js";
export type { SumUpClientOptions } from "./sumup-client.js";
```

- [ ] **Step 6: Verify and commit**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-sumup test:coverage
pnpm --filter @waitron/payments-sumup lint && pnpm --filter @waitron/payments-sumup typecheck && pnpm format:check
git add packages/payments-sumup
git commit -s -m "payments-sumup: reversals via the refund endpoint, the fetch binding, the barrel"
```

---

### Task 6: Host wiring — credential, till config, boot, the sweep duty, the till's outcome

**Files:**
- Modify: `packages/credentials/src/purposes.ts` (+ its test, which pins the purpose keys)
- Create: `apps/server/src/sumup-account.ts`, `apps/server/src/sumup-account.test.ts`
- Modify: `apps/server/src/till-config.ts`, `till-config.test.ts`
- Modify: `apps/server/src/boot.ts` (`buildCardProvider` + the pass loop), `boot-card-provider.test.ts`
- Modify: `apps/server/src/pass.ts`, `pass.test.ts`
- Modify: `apps/server/src/till-sale.ts` (`toPayOutcome`), `till-sale-integrated.test.ts`
- Modify: `apps/till/src/api/client.ts:99`, `apps/till/src/widgets/tender-pay.ts:50`
- Modify: `apps/server/package.json` (add `"@waitron/payments-sumup": "workspace:*"` to dependencies), then `pnpm install`

**Interfaces:**
- Produces: purpose `"payments.sumup": ["apiKey", "merchantCode", "affiliateAppId", "affiliateKey"]`; `CardProvider` gains `"sumup_cloud"`; `TillConfig.sumupReaderId?: string` (required iff `sumup_cloud`, env `WAITRON_TILL_SUMUP_READER_ID`); `sumupClientResolver(deps: SumUpAccountDeps): (tenantId) => Promise<SumUpClient>`; `withPendingSweep(inner, provider, log)` in `boot.ts` (the per-tick sweep wrapper, Decision 6) — no `PassDeps`/`pass.ts` change.

- [ ] **Step 1: The purpose.** Add to `PURPOSES` after `"payments.stripe"`:

```ts
  /** SumUp Cloud API. `affiliateAppId`/`affiliateKey` come from the developer portal's Affiliate
   * Keys page and carry our `payment_ref` to SumUp as the client-supplied lookup key; a merchant
   * without one seals the literal `-` in both, and the host then omits the affiliate block. */
  "payments.sumup": ["apiKey", "merchantCode", "affiliateAppId", "affiliateKey"],
```

Update `packages/credentials/src/purposes.test.ts` (it pins the key list) and run `pnpm --filter @waitron/credentials test:coverage`.

- [ ] **Step 2: Write the failing `sumup-account.test.ts`** (PGlite + a seeded credential, the shape of `boot-card-provider.test.ts`)

```ts
describe("sumupClientResolver", () => {
  it("builds a client from the tenant's sealed payments.sumup credential, with the affiliate block", async () => {
    const tenantId = await seedTenantWithSumUp({ apiKey: "sup_sk_x", merchantCode: "MABC123", affiliateAppId: "com.waitron.pos", affiliateKey: "aff-key" });
    const seen: string[] = [];
    const client = await sumupClientResolver(deps({ fetch: recordingFetch(seen) }))(tenantId);
    await client.createCheckout({ readerId: "rdr_1", amount: decimal("1.00"), currency: "EUR", description: "d", foreignTransactionId: "ref" });
    expect(seen[0]).toContain("/v0.1/merchants/MABC123/readers/rdr_1/checkout");
    expect(seen[1]).toContain('"foreign_transaction_id":"ref"');
  });
  it("omits the affiliate block when both affiliate fields are the literal '-'", async () => { /* same, expect seen[1] not to contain "affiliate" */ });
  it("throws server.credential_unusable when apiKey is missing from the sealed payload", async () => { /* putCredential cannot seal an empty required field, so drive sumupClientOptionsFrom({...}) directly, like stripeSecretKeyFrom's test */ });
  it("throws credentials.not_found-shaped error when the tenant has no payments.sumup credential", async () => { /* mirror boot-card-provider.test.ts's 'fails loudly' case */ });
});
```

`recordingFetch(seen)` pushes the URL and the body of every call and returns `new Response(JSON.stringify({ data: { checkout_id: "c", client_transaction_id: "x" } }), { status: 201 })`.

- [ ] **Step 3: Write `sumup-account.ts`**

```ts
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";
import { AppError } from "@waitron/shared";
import { sumupClient } from "@waitron/payments-sumup";
import type { SumUpClient, SumUpClientOptions } from "@waitron/payments-sumup";
import { readCredential } from "./credentials.js";
import "./errors.js";

export interface SumUpAccountDeps {
  db: Database;
  ring: KeyRing;
  /** Injected so a test observes the requests and never reaches the network. */
  fetch?: typeof fetch;
}

/** The literal an operator seals when the merchant has no affiliate key. */
const NO_AFFILIATE = "-";

/** Validates the decrypted payload at the READ site (the `stripeSecretKeyFrom` convention: a row
 * sealed under an older field list decrypts to a payload missing a field, and the host must name
 * the tenant and the field rather than fail somewhere far away). */
export function sumupClientOptionsFrom(
  payload: Record<string, string | undefined>,
  ref: { tenantId: string; purpose: string },
): Pick<SumUpClientOptions, "apiKey" | "merchantCode" | "affiliate"> {
  for (const field of ["apiKey", "merchantCode", "affiliateAppId", "affiliateKey"] as const) {
    if (payload[field] === undefined) throw new AppError("server.credential_unusable", { ...ref, field });
  }
  const affiliate =
    payload.affiliateAppId === NO_AFFILIATE || payload.affiliateKey === NO_AFFILIATE
      ? undefined
      : { appId: payload.affiliateAppId!, key: payload.affiliateKey! };
  return { apiKey: payload.apiKey!, merchantCode: payload.merchantCode!, ...(affiliate ? { affiliate } : {}) };
}

export function sumupClientResolver(deps: SumUpAccountDeps): (tenantId: TenantId) => Promise<SumUpClient> {
  return async (tenantId) => {
    const payload = await readCredential(deps.db, deps.ring, tenantId, "payments.sumup");
    const options = sumupClientOptionsFrom(payload, { tenantId, purpose: "payments.sumup" });
    return sumupClient({ ...options, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  };
}
```

(`readCredential`'s purpose parameter is typed `Purpose`; Step 1 made `"payments.sumup"` one.)

- [ ] **Step 4: Till config.** In `till-config.ts`: `CardProvider` gains `"sumup_cloud"`, `CARD_PROVIDERS` gains it, `TillConfig` gains `sumupReaderId?: string` (doc: "the paired SumUp reader this till drives (`WAITRON_TILL_SUMUP_READER_ID`). Present iff `cardProvider === 'sumup_cloud'`"), and beside the `stripeReaderId` resolution:

```ts
  const sumupReaderId =
    cardProvider === "sumup_cloud" ? required(env, "WAITRON_TILL_SUMUP_READER_ID") : undefined;
```

spread into the return like `stripeReaderId`. Tests in `till-config.test.ts`, mirroring the three `stripe_terminal` cases at lines 121, 155, 165: reads `sumup_cloud` + reader id; refuses a missing reader id (`server.till_config_missing`, `{ key: "WAITRON_TILL_SUMUP_READER_ID" }`); refuses an empty one.

- [ ] **Step 5: Boot.** `buildCardProvider` takes a second deps object — add a parameter `sumupDeps: SumUpAccountDeps` after `deps`. NOTE the signature is `buildCardProvider(cfg, deps, onboardingIntent?, paymentTestProviders = false)` (`boot.ts:313`): inserting after `deps` SHIFTS the two trailing optional args, so the one live call site (`boot.ts:1699`, which passes `config.onboardingIntent, config.paymentTestProviders` positionally) and `boot-card-provider.test.ts`'s calls must be REORDERED, not just extended. Typecheck catches a miss, but reorder deliberately. New branch before the `stripe_on_device` fall-through:

```ts
  if (cfg.cardProvider === "sumup_cloud") {
    const client = await sumupClientResolver(sumupDeps)(cfg.tenantId);
    // Present because `loadTillConfig` `required`s WAITRON_TILL_SUMUP_READER_ID on exactly this branch.
    const readerId = cfg.sumupReaderId!;
    return new SumUpCloudProvider({
      client,
      db: deps.db,
      tenantId: cfg.tenantId,
      nodeId: cfg.nodeId,
      resolveReader: () => Promise.resolve(readerId),
      incidents: recordIncidentOnce,
    });
  }
```

(`recordIncidentOnce` from `@waitron/core` — `boot.ts` already imports from core; it is what `StripeReconciler` passes.) `boot-card-provider.test.ts`: add `seedTenantWithSumUpKey`, a `cfgFor` variant carrying `sumupReaderId`, and two cases: builds a `SumUpCloudProvider` for `sumup_cloud`; fails loudly with no `payments.sumup` credential.

**The sweep, wired as a wrapper (revised from the first draft's pass-duty — see Decision 6).** Do NOT add `resolvePending` to `PassDeps`, `ALL_DUTIES`, `DUTY_BUDGET_MS`, or `health.ts`; do NOT touch `pass.ts`. Instead add a wrapper in `boot.ts` that runs the sweep around the singleton pass. Define, near the other `boot.ts` helpers:

```ts
/** Run the card provider's own `resolvePending` sweep on every tick, wrapping (not replacing) the
 * singleton fiscal pass. Independent of the singleton gate because the sweep resolves THIS node's
 * own `attempting` card rows — a sell-only local secondary that takes card sales must sweep them
 * even though it never drains/reconciles (`singletonPass` returns an empty pass there). Log-only:
 * NOT a health-tracked `Duty`, because `createHealthState` seeds every `ALL_DUTIES` member on every
 * node and a conditional duty that never runs on a no-card node would read stale → `/health` 503
 * (health.ts:74,220). A stuck sweep surfaces as `resolve_pending.failed`, the channel a mirror's
 * stalled pull uses; it is a card-settlement backstop, not a fiscal-legal or process-liveness
 * signal, so it does not gate `/health` (the deferred SumUp reconciler is the same tier, likewise
 * off it). The returned `nextDueAt` is logged, not yet used to pace the loop. */
function withPendingSweep(
  inner: (now: Date) => Promise<PassReport>,
  provider: PaymentProvider | undefined,
  log: Logger,
): (now: Date) => Promise<PassReport> {
  if (provider === undefined) return inner;
  return async (now) => {
    const report = await inner(now);
    try {
      const r = await provider.resolvePending(now);
      log("info", "resolve_pending.complete", {
        captured: r.forwarded,
        failed: r.declined,
        incidentsRaised: r.incidentsRaised,
        nextDueAt: r.nextDueAt?.toISOString() ?? null,
      });
    } catch (error) {
      log("warn", "resolve_pending.failed", { error: String(error) });
    }
    return report;
  };
}
```

Then wrap the loop's `pass` at `boot.ts:2386`:

```ts
    pass: withPendingSweep(
      singletonPass(
        () => holders.singletonRole.current,
        (at) => runPass({ /* …unchanged… */ }, at),
      ),
      cardProvider,   // the PaymentProvider | undefined already built at boot.ts:1699
      log,
    ),
```

`PaymentProvider` and `Logger` are already imported in `boot.ts` (the provider from `@waitron/payments`, `Logger` from its logging import — confirm and add if absent). This runs the sweep on EVERY trading node with a provider (primary or secondary), leaves the `PassReport`/`/health` contract untouched, and needs no `pass.ts` change (so the first draft's stale-comment concern is moot). Test `withPendingSweep` directly in `boot.test.ts` (or a small `boot-pending-sweep.test.ts`): (a) with `provider === undefined` it returns `inner` unchanged and never calls the provider; (b) with a fake provider whose `resolvePending` returns a known `ForwardResult`, it calls it once per invocation, logs `resolve_pending.complete`, and returns the INNER report verbatim (health unaffected); (c) when `resolvePending` rejects, it logs `resolve_pending.failed` and still returns the inner report (a sweep failure never breaks the pass). A stubbed `inner` and a `FakePaymentProvider`-shaped double suffice — no container needed.

- [ ] **Step 6: The till's outcome.** `toPayOutcome` in `till-sale.ts`:

```ts
  if (result.state === "attempting") {
    return { outcome: "timeout" };
  }
```

before the final `declined` return, and rewrite the docblock: the `timeout` arm is now PRODUCED — the SumUp adapter reports a poll-window stall as `attempting` (the row stays open for `resolvePending`), which is the case the arm was reserved for; Stripe still collapses a stall into `failed`. `till-sale-integrated.test.ts`: add the case `maps an attempting result (SumUp poll timeout) to the timeout arm`. Then `apps/till/src/api/client.ts:99` and `apps/till/src/widgets/tender-pay.ts:50`: add `| "sumup_cloud"` to both unions (the till already renders `timeout` and `declined` the same; a server-driven provider needs no other branch — the on-device-only branches key on `"stripe_on_device"` explicitly).

- [ ] **Step 7: Verify**

```bash
pnpm --filter @waitron/credentials test:coverage
pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage      # ~10 min, real PG
pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till lint          # the till's browser suite: run it if the union change touches a test; otherwise typecheck+lint
pnpm typecheck && pnpm format:check
```

- [ ] **Step 8: Commit**

```bash
git add packages/credentials apps/server apps/till pnpm-lock.yaml
git commit -s -m "server: wire SumUpCloudProvider — payments.sumup credential, sumup_cloud till provider, resolve_pending pass duty, timeout pay outcome"
```

---

### Task 7: The live plug-in suite, the docs, and tomorrow's checklist

**Files:**
- Create: `packages/payments-sumup/src/collect.sandbox.test.ts`
- Modify: `docs/backlog.md` (Track H item 4; the *Debt → SumUp* entry; a follow-up line for the reversal lift)
- Modify: `docs/research/2026-09-10-sumup-solo-experiments.md` (a short section 7: "Through the adapter")

- [ ] **Step 1: The live suite.** Self-skipping unless `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE` and `SUMUP_READER_ID` are set (optional `SUMUP_AFFILIATE_APP_ID`/`SUMUP_AFFILIATE_KEY`). It is experiment 0.6 driven through the real binding: PGlite database, `sumupClient(...)`, `SumUpCloudProvider` with the default poll, one `collect` of €1.00, `console.log("TAP THE CARD NOW")` before the call, expect `state: "captured"`, then `refund` it and expect `refunded`. 180 s test timeout. Header comment: "Runs only on the owner's laptop with the paired Solo in reach; never in CI (no `.github` workflow calls `test:sandbox` for this package). It is the receipt for the runbook's experiments 0.6, 2a and 4a through the adapter rather than curl."

```bash
SUMUP_API_KEY=… SUMUP_MERCHANT_CODE=… SUMUP_READER_ID=… pnpm --filter @waitron/payments-sumup test:sandbox
```

- [ ] **Step 2: Docs.** `docs/backlog.md`: Track H item 4 → "**IN BUILD** (`feat/payments-sumup`, plan `2026-09-10-payments-sumup.md`); the runbook's experiments run through it on 2026-09-11". *Debt → SumUp*: add "Follow-up: lift `reverseViaStripe` and `reverseViaSumUp` into one neutral `@waitron/payments` reversal primitive (structural refunder seam) — deferred from the SumUp build because two shipped Stripe providers depend on the existing one". Runbook section 7: the three env vars, the `test:sandbox` command, and the dev-stack plug-in steps below.

- [ ] **Step 3: Tomorrow's plug-in checklist** (goes into the runbook's new section 7, verbatim)

1. Run the runbook's sections 0–1 with curl first (pairing, the control run, the standalone question). The adapter needs the reader id from 0.4.
2. `wa-wt demo waitron-feat-payments-sumup` (the dev stack from the worktree — CLAUDE.md §6), then seal the credential from a file outside the repo:
   ```bash
   cat > ~/.sumup-experiments/credential.json <<'EOF'
   {"apiKey":"…","merchantCode":"…","affiliateAppId":"…","affiliateKey":"…"}
   EOF
   pnpm --filter @waitron/credentials build && node packages/credentials/dist/bin.js set --tenant <tenant uuid from apps/server/.env> --purpose payments.sumup --file ~/.sumup-experiments/credential.json
   ```
   (`-` for both affiliate fields if 0.2 produced no affiliate key.)
3. In the worktree's `apps/server/.env`: `WAITRON_TILL_CARD_PROVIDER=sumup_cloud`, `WAITRON_TILL_SUMUP_READER_ID=<reader id from 0.4>`. Restart the stack. Boot fails loudly if the credential is missing or unusable.
4. On the till (http://localhost:5190, enrolled with pairing code `DEMO`): ring a €1 item, Card. The Solo wakes. Tap. The ticket prints. Cancel the sale from the dashboard → the refund lands (experiment 4a through the adapter).
5. Pull the reader's Wi-Fi mid-checkout, or simply do not tap: after two minutes the till shows the timed-out screen (cash / manual card offered); `pnpm --filter @waitron/server` logs show `resolve_pending.complete` on the next pass resolving the row. That is experiment 5a through the adapter.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @waitron/payments-sumup lint && pnpm --filter @waitron/payments-sumup typecheck && pnpm --filter @waitron/payments-sumup test:coverage && pnpm format:check
git add packages/payments-sumup docs/backlog.md docs/research/2026-09-10-sumup-solo-experiments.md
git commit -s -m "payments-sumup: live sandbox suite against the paired Solo; backlog + runbook plug-in steps"
```

Then the §2 gate (`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`) once, and `/finish-branch`. This diff touches a cross-package contract (`PaymentProvider`) and a by-id/tenant read path, so it takes the FULL review ceremony (global CLAUDE.md, review weight).

---

## Self-review against the spec (done 2026-09-10 while writing)

- §1 no new interface → `resolvePending` is the one neutral addition the spec itself names (§3). ✔ Task 1.
- §2 T1 / create / poll / T2; only `SUCCESSFUL`/`FAILED`/`CANCELLED` resolve; `REFUNDED`/unknown deferred; never `simple_status`; no terminate on timeout. ✔ Task 3 (`classify`, the timeout test, no `terminate` on the seam at all).
- §3 row stays `attempting`, `settledAt: null`; `resolvePending` terminates every row; `REFUNDED` → failed + incident; unknown → failed + incident naming the value; all-zeros on existing adapters (four classes + the `cannedProvider` double). ✔ Tasks 1, 4. The not-found grace period is an addition the spec did not foresee (it assumed a transaction always exists once created) — Decision 3. Wiring is a logged per-tick wrapper (`withPendingSweep`), not a health duty — Decision 6, revised after the pre-flight review found the duty path both skipped non-primary nodes and 503'd `/health`.
- §4 webhooks deferred. ✔ Not built; the runbook's experiment 3 informs the later wiring.
- §5 `partialRefund: true`; `void` → refund endpoint. ✔ Task 5, Decision 4.
- §6 scope: `resolvePending` + all-zeros; `SumUpCloudProvider`; narrow client seam (create, get transaction, refund); hermetic fake; real binding coverage-excluded; wiring tests following payments-stripe's layout. ✔ Tasks 1–5. Deferred list untouched.
- §7 unverified items: each is a Decision above and an experiment in the runbook.
- Placeholder scan: Task 5 Step 1 and Task 6 Step 2 carry elided test bodies whose assertions are stated in the comment on each — the implementer writes them in full; no "TBD" elsewhere.
- Type consistency: `SUMUP_PROVIDER` lives in `client.ts` from Task 5 on (Task 3 defines it in `provider.ts` and Task 5 moves it — the implementer of Task 5 updates the import in `provider.ts` and the barrel). `ForwardResult` is the sweep's return everywhere. `IncidentSink` is `@waitron/payments`'s. `AttemptingPayment.createdAt` is a string (Drizzle `mode: "string"`), parsed with `new Date()` in Task 4.
