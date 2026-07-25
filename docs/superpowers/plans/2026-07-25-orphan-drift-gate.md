# Reconcile orphan drift gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the reconcile sweep auto-reversing an orphan whose amount it has just classified as
`drift`, and make the orphan incident say which of the four gates stopped each payment.

**Architecture:** Two tasks in `packages/payments`. Task 1 replaces the orphan incident's
`remediating: boolean` with a structured `OrphanRemediation` reason code covering the three gates
that exist today — reporting only, no behaviour change. Task 2 adds the fourth gate, which skips a
row that also classified `drift`, and the `amountDrifted` reason that names it. Splitting this way
means a reviewer can accept the richer reporting and still reject the gate.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Drizzle ORM, PGlite for hermetic
tests, Postgres via Testcontainers for RLS suites.

**Spec:** [`docs/superpowers/specs/2026-07-25-orphan-drift-gate-design.md`](../specs/2026-07-25-orphan-drift-gate-design.md)

## Global Constraints

- `packages/payments-stripe` is NOT touched. `reverseViaStripe` keeps its current behaviour — see
  spec §4 and §7 for why that is deliberate and not an oversight.
- No migration, no schema change, no new dependency.
- Incident params are structured data only, never prose — the display layer localises from the code.
- Import specifiers inside the package end in `.js` (ESM), e.g. `./errors.js`.
- Run targeted test files, never the whole `@waitron/payments` suite (>10 min):
  `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts`. Pass an explicit long Bash
  timeout. Never `run_in_background`.
- Real-Postgres suites need the `TESTCONTAINERS_RYUK_DISABLED=true` prefix locally, and it must
  NEVER be committed.
- Every commit must pass `pnpm exec prettier --check` on the files it touches.

---

### Task 1: `OrphanRemediation` replaces `remediating: boolean`

Reporting only. The three gates that exist today keep their exact behaviour and order; all that
changes is that each one records WHY it stopped, instead of the incident carrying one boolean that
already meant three different things.

**Files:**
- Modify: `packages/payments/src/errors.ts` — declare and export the type; rewrite the
  `payment.reconcile_orphan` doc comment (lines 63-81)
- Modify: `packages/payments/src/index.ts:57` — re-export the type from the barrel
- Modify: `packages/payments/src/reconcile.ts` — the claim loop (lines 347-360), the
  `raiseRowIncidents` signature (line 398), and `incidentFor` (lines 434, 463-473)
- Test: `packages/payments/src/reconcile.test.ts` — three existing `remediating` assertion sites
  (around lines 463-489, 535-546, 571-574), plus one new test

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OrphanRemediation`, a union of the five string literals
  `"claimed" | "workingOrderNotAbandoned" | "stateNotCaptured" | "amountDrifted" | "alreadyClaimed"`,
  exported from `packages/payments/src/errors.ts` and re-exported from the barrel. The
  `payment.reconcile_orphan` params' per-payment field is `remediation: OrphanRemediation`, replacing
  `remediating: boolean`. Task 2 adds the only producer of `"amountDrifted"`.

- [ ] **Step 1: Write the failing tests**

Three existing assertion sites change from `remediating` to `remediation`. In
`packages/payments/src/reconcile.test.ts`, in the test
`"auto-reverses an orphan on an ABANDONED order and stamps the marker"`, replace the incident type
and assertion (currently at ~lines 466-489):

```typescript
    // `remediation` tells a human whether the sweep is handing this customer their money back and,
    // when it is not, which gate stopped it — so the whole params shape is asserted here and each
    // other reason is asserted in its own test below. Hardcoding any single value must fail one of
    // them.
    const incident = await db.execute<{
      params: {
        count: number;
        payments: {
          paymentRef: string;
          amount: string;
          workingOrderId: string;
          workingOrderStatus: string;
          remediation: string;
        }[];
      };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(incident.rows[0].params).toEqual({
      count: 1,
      payments: [
        {
          paymentRef: "p1",
          amount: "10.00",
          workingOrderId: seeded.workingOrderId,
          workingOrderStatus: "abandoned",
          remediation: "claimed",
        },
      ],
    });
```

In the SETTLED-order test (currently ~lines 535-546), replace the incident type and assertion:

```typescript
    const incident = await db.execute<{
      params: { payments: { workingOrderStatus: string; remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(incident.rows[0].params.payments).toEqual([
      {
        paymentRef: "p1",
        amount: "10.00",
        workingOrderId: seeded.workingOrderId,
        workingOrderStatus: "settled",
        remediation: "workingOrderNotAbandoned",
      },
    ]);
```

In the `"does NOT claim a SETTLED-state orphan on an abandoned order"` test (currently ~lines
571-574), replace the incident type and assertion:

```typescript
    const incident = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(incident.rows[0].params.payments[0].remediation).toBe("stateNotCaptured");
```

Then add one new test at the end of the `describe("orphan remediation", ...)` block, for the reason
no existing test covers — a row a PREVIOUS sweep already claimed:

```typescript
  it("reports alreadyClaimed for an orphan an earlier sweep already stamped", async () => {
    // The marker is permanent by design, so a second sweep over the same period must not reverse
    // the payment again — and must say WHY it is standing down, rather than reading identically to
    // an orphan it was never allowed to touch.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const first = recordingReverse();
    await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), first.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(first.calls).toEqual(["p1"]);

    // Acknowledge the first sweep's incident before the second runs. Without this the assertion
    // below would read the FIRST incident (`claimed`) and fail for a reason that has nothing to do
    // with what is under test: the open-incident dedup index is partial on `acknowledged_at IS
    // NULL`, so while the first stays open the second sweep's insert is deduplicated away.
    await db.execute(sql`
      update incidents set acknowledged_at = now()
      where tenant_id = ${seeded.tenantId} and code = 'payment.reconcile_orphan'`);

    const second = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), second.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(second.calls).toEqual([]);
    const incident = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`
      select params from incidents
      where code = 'payment.reconcile_orphan' and acknowledged_at is null`);
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].params.payments[0].remediation).toBe("alreadyClaimed");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts -t "orphan"`

Expected: FAIL. The three edited assertions fail because the incident params still carry
`remediating: true` / `false` and no `remediation` key, so `toEqual` reports the extra/missing
property. The new test fails on `expect(...).toBe("alreadyClaimed")` receiving `undefined`.

- [ ] **Step 3: Declare the type and rewrite the doc comment**

In `packages/payments/src/errors.ts`, add the exported type ABOVE the `declare module` block (after
the `import "@waitron/shared";` line and its comment):

```typescript
/**
 * Why the sweep is, or is not, reversing one orphaned payment — the four gates of the claim loop in
 * `./reconcile.ts`, plus the claimed case, as a single code per payment.
 *
 * A code rather than a boolean because "not remediating" has four distinct causes with four
 * different human responses, and a bare `false` told a reader none of them. Structured data the
 * display layer localises; never prose.
 */
export type OrphanRemediation =
  /** This sweep stamped the marker and will attempt the reversal. The marker is stamped in T2,
   * BEFORE the network call, so this means "is reversing it", NOT "succeeded" — a claimed-but-refused
   * reversal still reads `claimed` here and separately raises `payment.reconcile_remediation_failed`. */
  | "claimed"
  /** The working order is settled, not abandoned, so a sale exists: the orphan may be a lost
   * associate-back, and refunding would hand back money owed against a live invoice. */
  | "workingOrderNotAbandoned"
  /** The payment is in the `settled` state, which the local state machine gives NO reversal path
   * out of. Claiming it would stamp a permanent marker for a reversal that must fail. */
  | "stateNotCaptured"
  /** The same sweep also classified this payment `drift` — our amount and the processor's disagree,
   * so the amount any reversal would move is exactly the figure we have just proven untrustworthy.
   * Reported for a human, with the `payment.reconcile_drift` incident carrying both figures. */
  | "amountDrifted"
  /** An earlier sweep, or a concurrent one that won the race, already owns the reversal. */
  | "alreadyClaimed";
```

Then replace the `payment.reconcile_orphan` doc comment and params (currently lines 63-81) with:

```typescript
    /** Reconcile INCIDENT: money captured against a working order that is settled or abandoned but
     * carries no sale. `remediation` says what the sweep is doing about each payment and, when it is
     * standing down, which gate stopped it — see `OrphanRemediation`, whose members carry the
     * reasoning. Aggregated per till. */
    "payment.reconcile_orphan": {
      payments: {
        paymentRef: string;
        amount: string;
        workingOrderId: string;
        workingOrderStatus: string;
        remediation: OrphanRemediation;
      }[];
      count: number;
    };
```

- [ ] **Step 4: Re-export from the barrel**

In `packages/payments/src/index.ts`, add a line immediately after the existing
`export { DEFAULT_SETTLEMENT_LAG_MS, classify, reconcilePayments } from "./reconcile.js";` (line 57):

```typescript
export type { OrphanRemediation } from "./errors.js";
```

- [ ] **Step 5: Produce the reason in the claim loop**

In `packages/payments/src/reconcile.ts`, add the type import after the existing
`import type { PaymentState } from "./provider.js";`:

```typescript
import type { OrphanRemediation } from "./errors.js";
```

Replace the claim loop's leading comment and the loop itself (currently lines 327-360) with the
version below. The three gates and their ORDER are unchanged; each now records its reason, and
`claimedRefs: Set<string>` becomes `remediation: Map<string, OrphanRemediation>`.

**Keep the existing closing paragraph** — the one beginning "A row that ALSO classified `drift` is
still claimed, and reversed at OUR amount" — verbatim at the end of the comment block. It is still
TRUE after this task: nothing here changes which rows get claimed. Task 2 is what makes it false, and
Task 2 is what deletes it. Removing it now would leave the code documented as doing something it does
not yet do.

```typescript
    // Decide what happens to each orphan, and record WHY on every one of them. The gates narrow to
    // money that can actually be handed back, and their ORDER is what a human is shown when a row
    // trips more than one, so it is deliberate:
    //
    //   - ABANDONED working order only. On a `settled` one a sale exists, so the orphan may be a
    //     lost associate-back and refunding would take back money the customer owes against a live
    //     invoice (see the design's orphan section).
    //   - state `captured` only. This gate is not a preference: the local state machine has NO path
    //     out of `settled`, and the reversal pre-check accepts `captured` for a void and
    //     `captured`/`partially_refunded` for a refund — `settled` is in neither set. A `settled`
    //     orphan claimed here would stamp the marker, fail its reversal, and, because the marker is
    //     permanent by design, never be retried by any later sweep: the customer's money kept for
    //     good, on every occurrence. It is reported and incident-raised instead, exactly like a
    //     `settled`-working-order orphan. DO NOT drop this gate to "cover more orphans" until
    //     `settled` has a reversal path.
    //   - not already claimed by an earlier or concurrent sweep.
    //
    // Every orphan gets exactly one entry in this map, which is what lets `incidentFor` read it
    // without a fallback.
    const remediation = new Map<string, OrphanRemediation>();
    for (const entry of classified.rows) {
      if (entry.klass !== "orphan") continue;
      const ref = entry.row.paymentRef;
      if (entry.row.workingOrderStatus !== "abandoned") {
        remediation.set(ref, "workingOrderNotAbandoned");
        continue;
      }
      if (entry.row.state !== "captured") {
        remediation.set(ref, "stateNotCaptured");
        continue;
      }
      if (entry.row.reconcileRemediatedAt !== null) {
        remediation.set(ref, "alreadyClaimed");
        continue;
      }
      const claimed = await markReconcileRemediated(tx, {
        tenantId,
        provider: deps.provider,
        paymentRef: ref,
        at: now,
      });
      // A lost race is the same fact as an earlier sweep's marker — another sweep owns the reversal
      // — so it reports the same reason.
      remediation.set(ref, claimed ? "claimed" : "alreadyClaimed");
      if (claimed) remediable.push(entry.row);
    }
```

Delete the now-dead `const claimedRefs = new Set(remediable.map((row) => row.paymentRef));` line
(currently line 360) and pass `remediation` to `raiseRowIncidents` in its place:

```typescript
    result.incidentsRaised += await raiseRowIncidents(
      tx,
      deps,
      tenantId,
      classified,
      remediation,
      now,
    );
```

- [ ] **Step 6: Thread the map through to the incident**

In `packages/payments/src/reconcile.ts`, change `raiseRowIncidents`'s parameter (currently line 403)
from `claimedRefs: Set<string>,` to:

```typescript
  remediation: Map<string, OrphanRemediation>,
```

and its call to `incidentFor` (currently line 420) from `incidentFor(first.klass, group, claimedRefs)`
to:

```typescript
      error: incidentFor(first.klass, group, remediation),
```

Change `incidentFor`'s parameter (currently line 437) from `claimedRefs: Set<string>,` to:

```typescript
  remediation: Map<string, OrphanRemediation>,
```

and its orphan branch (currently lines 463-473) to:

```typescript
  if (klass === "orphan") {
    return new AppError(CODE.orphan, {
      count,
      payments: group.map(({ row }) => ({
        paymentRef: row.paymentRef,
        amount: row.amount,
        workingOrderId: row.workingOrderId,
        workingOrderStatus: row.workingOrderStatus,
        // Never undefined: the claim loop above sets an entry for EVERY orphan entry in
        // `classified.rows`, and this branch groups over that same array.
        remediation: remediation.get(row.paymentRef)!,
      })),
    });
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts`

Expected: PASS, all tests in the file, output pristine.

- [ ] **Step 8: Run the neighbouring suites and typecheck**

Run each, expecting PASS:

```bash
pnpm --filter @waitron/payments exec vitest run src/reconcile.wiring.test.ts src/index.test.ts src/errors.reachability.test.ts
pnpm --filter @waitron/payments typecheck
pnpm --filter @waitron/payments-stripe typecheck
```

The two typechecks are the point of this step: `packages/payments-stripe` consumes the barrel, so a
type error there would mean the change is not as contained as the spec claims.

- [ ] **Step 9: Verify formatting and lint**

```bash
pnpm exec prettier --check packages/payments/src/reconcile.ts packages/payments/src/errors.ts packages/payments/src/index.ts packages/payments/src/reconcile.test.ts
pnpm --filter @waitron/payments exec eslint src/reconcile.ts src/errors.ts src/index.ts src/reconcile.test.ts
```

Expected: both clean. `format:check` is not the same gate as `lint` — run both.

- [ ] **Step 10: Commit**

```bash
git add packages/payments/src/errors.ts packages/payments/src/index.ts packages/payments/src/reconcile.ts packages/payments/src/reconcile.test.ts
git commit -m "refactor(payments): report WHY an orphan is not being remediated

\`remediating: boolean\` already meant three different things — working order
not abandoned, state not captured, claimed by an earlier sweep — and a human
reading \`false\` could not tell which. Replaced with a structured
\`OrphanRemediation\` code per payment.

Behaviour is unchanged: the same three gates, in the same order, claim the
same rows."
```

---

### Task 2: The drift gate

**Files:**
- Modify: `packages/payments/src/reconcile.ts` — the claim loop from Task 1
- Test: `packages/payments/src/reconcile.test.ts`
- Test: `packages/payments/src/reconcile.concurrency.test.ts` — one added assertion

**Interfaces:**
- Consumes: `OrphanRemediation` from Task 1, and the `remediation` map built in the claim loop.
- Produces: no new exported surface. The observable change is that an orphan whose row also
  classified `drift` is never claimed, never stamped, never passed to `deps.reverse`, and reports
  `remediation: "amountDrifted"`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/payments/src/reconcile.test.ts`, at the end of the
`describe("orphan remediation", ...)` block. Note `settlement({ amount: decimal("12.50") })` against
the `capture` helper's default `"10.00"` — that difference is what makes `classify` emit a `drift`
entry alongside the `orphan` one:

```typescript
  it("does NOT claim an orphan whose amount has DRIFTED — it reports both instead", async () => {
    // The one case where the sweep would move money at a figure it has, in the same pass, proven it
    // cannot trust. The reversal primitive sends no amount, so the processor refunds ITS figure
    // while we would record OURS; and the marker is permanent, so the row would leave the audited
    // set with the books wrong and nothing to re-examine it. Report both, move nothing.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );

    expect(result.orphan).toHaveLength(1);
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(0);
    // Not a failed remediation — one correctly never attempted.
    expect(result.remediationFailures).toEqual([]);
    expect(reverse.calls).toEqual([]);
    // No marker: the row stays in the audited state set, so every later sweep re-detects it until
    // the drift is settled. This is the whole difference from a claimed-then-failed reversal.
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([
      "payment.reconcile_drift",
      "payment.reconcile_orphan",
    ]);
    const orphan = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(orphan.rows[0].params.payments[0].remediation).toBe("amountDrifted");
    // The drift incident still carries BOTH figures — the human settling the difference reads them
    // from here, which is what makes reporting-instead-of-reversing actionable.
    const drift = await db.execute<{
      params: { payments: { paymentRef: string; captured: string; settled: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_drift'`);
    expect(drift.rows[0].params.payments).toEqual([
      { paymentRef: "p1", captured: "10.00", settled: "12.50" },
    ]);
  });

  it("still claims an orphan whose amount MATCHES — this is a gate, not a disabling", async () => {
    // The regression guard for the test above: if the drift set were built wrongly (say, over every
    // classified row rather than the `drift` ones), auto-reversal would silently stop entirely and
    // every other orphan test would still pass.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toEqual([]);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
  });

  it("reports the FIRST gate when a row trips several — not the drift one", async () => {
    // A settled-order orphan whose amount ALSO drifted. Both gates apply, and the order matters to
    // the human: reporting `amountDrifted` would suggest that settling the difference unblocks the
    // reversal, when the settled working order forbids it whatever the amount says.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "settled");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(reverse.calls).toEqual([]);
    const orphan = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(orphan.rows[0].params.payments[0].remediation).toBe("workingOrderNotAbandoned");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts -t "orphan"`

Expected: FAIL on the first and third new tests. The first fails at `expect(reverse.calls).toEqual([])`
receiving `["p1"]` — today the drifting orphan IS reversed, which is the defect. The third fails at
`toBe("workingOrderNotAbandoned")` only if the gate is inserted in the wrong position, so it may pass
before the change; that is expected and it stays as the guard against a later reordering. The second
test passes before and after — it is the regression guard.

- [ ] **Step 3: Add the gate**

In `packages/payments/src/reconcile.ts`, immediately before the claim loop, build the set:

```typescript
    // `classify` emits INDEPENDENT predicates, so a drifting orphan is TWO entries over one row and
    // the `orphan` entry carries no knowledge of the `drift` one. This set is the join, keyed on
    // paymentRef — which the sweep already treats as unique per row.
    const driftedRefs = new Set(
      classified.rows.filter((e) => e.klass === "drift").map((e) => e.row.paymentRef),
    );
```

Add the fourth gate to the loop, between the `state` gate and the `reconcileRemediatedAt` gate:

```typescript
      if (driftedRefs.has(ref)) {
        remediation.set(ref, "amountDrifted");
        continue;
      }
```

And add this bullet to the gate list in the loop's leading comment, between the `state` bullet and
the `not already claimed` one — and DELETE the comment's closing paragraph, the one beginning "A row
that ALSO classified `drift` is still claimed, and reversed at OUR amount", which this task is
precisely what makes false:

```text
    //   - amount AGREES with the processor. A drifting row is the one case where the sweep would
    //     move money at a figure it has, in the same pass, proven untrustworthy: the reversal
    //     primitive sends no amount, so the processor refunds ITS figure while we record OURS.
    //     Sending our amount instead is NOT the fix — when the processor's charge is the smaller of
    //     the two it exceeds the charge, the refund is refused, and the marker is already stamped,
    //     so it becomes money kept for good. Gated out and reported: no marker, so it stays in the
    //     audited set and every later sweep re-detects it until a human settles the difference. The
    //     separate `drift` incident carries both figures.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts`

Expected: PASS, all tests in the file, output pristine.

- [ ] **Step 5: Add the race-loser assertion to the concurrency suite**

The loser's OWN reason is not observable here, and it is worth knowing why before writing the
assertion: the dedup index leaves exactly one open orphan incident, and the winner's is always the
one that survives. The loser blocks on the row lock inside `markReconcileRemediated`, which is in the
winner's still-open T2 — so by the time the loser evaluates its gate at all, the winner's T2 has
committed, incident included. The loser's insert is then deduplicated away.

So the assertion worth having is that the SURVIVING incident says `claimed`, not `alreadyClaimed` — a
guard against a future reordering in which the loser's incident wins the dedup race and a human is
told another sweep owns a reversal that this one is in fact performing.

The file already imports `sql` from `drizzle-orm` and queries through the `admin` handle. Extend the
existing count query rather than adding a second one — replace it (currently ~lines 126-130) with:

```typescript
      const { rows } = await admin.execute<{ n: string; params: { payments: { remediation: string }[] } }>(sql`
        select count(*) over () as n, params from incidents
        where tenant_id = ${seeded.tenantId} and code = 'payment.reconcile_orphan'
          and acknowledged_at is null`);
      expect(Number(rows[0].n)).toBe(1);
      // The surviving incident is the WINNER's. The loser blocks on the row lock inside the
      // winner's T2, so the winner has committed — incident and all — before the loser evaluates
      // its own gate, and the loser's `alreadyClaimed` insert is deduplicated away. If a future
      // change let the loser's incident win instead, a human would read "another sweep owns this"
      // about the sweep that is actually doing the reversal.
      expect(rows[0].params.payments[0].remediation).toBe("claimed");
```

Do NOT weaken the `expect(a.remediated + b.remediated).toBe(1)` or `incidentsRaised` assertions to
make a shape fit.

- [ ] **Step 6: Run the concurrency suite**

Run: `pnpm --filter @waitron/payments exec vitest run src/reconcile.concurrency.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the remaining reconcile suites and typecheck**

```bash
pnpm --filter @waitron/payments exec vitest run src/reconcile.wiring.test.ts src/classify.test.ts
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments exec vitest run src/reconcile.rls.test.ts
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-stripe exec vitest run src/reconcile.rls.test.ts
pnpm --filter @waitron/payments typecheck
pnpm --filter @waitron/payments-stripe typecheck
```

Expected: all PASS. The two RLS suites reference `payment.reconcile_orphan` but never read the
changed field, so they are a check that nothing else moved — if either fails, the change is wider
than the spec claims and that needs raising, not patching.

- [ ] **Step 8: Verify formatting and lint**

```bash
pnpm exec prettier --check packages/payments/src/reconcile.ts packages/payments/src/reconcile.test.ts packages/payments/src/reconcile.concurrency.test.ts
pnpm --filter @waitron/payments exec eslint src/reconcile.ts src/reconcile.test.ts src/reconcile.concurrency.test.ts
```

Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add packages/payments/src/reconcile.ts packages/payments/src/reconcile.test.ts packages/payments/src/reconcile.concurrency.test.ts
git commit -m "fix(payments): don't auto-reverse an orphan whose amount has drifted

The sweep claimed a drifting orphan and reversed it, which moves money at a
figure the same pass has just classified as untrustworthy: the reversal
primitive sends no amount, so the processor refunds ITS figure while
recordRefund writes OURS, and the permanent marker takes the row out of the
audited set with the books wrong.

Sending our amount instead is not the fix — when the processor's charge is
the smaller figure that refund exceeds the charge and is refused, and the
marker is stamped before the network call, so it becomes money kept for
good. Gated out and reported instead, with no marker, so every later sweep
re-detects it until a human settles the difference."
```

---

### Task 3: Update the coverage floor if it moved

**Files:**
- Modify: `packages/payments/vitest.config.ts` (only if thresholds are declared there and now fail)

**Interfaces:**
- Consumes: the finished code from Tasks 1 and 2.
- Produces: nothing.

- [ ] **Step 1: Run coverage**

Run: `pnpm --filter @waitron/payments test:coverage`

This is the >10 minute run — pass an explicit Bash timeout of at least 900000ms. Do not background it.

- [ ] **Step 2: Act on the result**

If it passes, this task is a no-op — say so and skip to the next step without editing anything. The
thresholds are floors, not exact pins (`{ statements: 98, lines: 98, functions: 98, branches: 95 }`
in `packages/payments/vitest.config.ts`), so coverage rising needs no edit at all.

If it fails a threshold, read the uncovered lines first. A newly-uncovered line in the claim loop
means a gate has no test, and the right fix is a TEST added the same way as Task 2's — never a
lowered floor.

One branch is known to be genuinely untestable: the `claimed ? "claimed" : "alreadyClaimed"`
ternary's FALSE arm. It is reached only by a sweep that loses the `markReconcileRemediated` race, and
that sweep's incident is always deduplicated away by the winner's (see Task 2 Step 5), so no
assertion anywhere can observe the value. If — and only if — the branches threshold fails on that
specific arm, wrap it in the `/* v8 ignore start */` … `/* v8 ignore stop */` idiom this repo already
uses (`packages/payments-stripe/src/device-provider.ts:135`, `packages/fiscal-verifactu/src/registro-sif.ts:75`)
with a comment giving that reason. Do not reach for it for any other uncovered line.

- [ ] **Step 3: Commit only if something changed**

```bash
git add packages/payments/vitest.config.ts
git commit -m "test(payments): adjust the coverage floor after the drift gate"
```

---

## Notes for the reviewer

- The behaviour change is one `continue`. Everything else is reporting.
- The three things most worth checking: that the gate sits AFTER the working-order and state gates
  (spec §2 — order decides which reason a human sees), that a gated row stamps NO marker (the
  difference between "re-examined every sweep" and "money kept for good"), and that
  `packages/payments-stripe` is untouched.
- `reverseViaStripe`'s full-refund amount is deliberately NOT fixed here. Spec §4 and §7 explain why
  and what remains open for the interactive till paths.
