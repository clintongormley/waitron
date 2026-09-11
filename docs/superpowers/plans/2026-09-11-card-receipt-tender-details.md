# Card Receipt Tender Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the customer proof of a card payment on the receipt — scheme, masked card number, entry mode, auth code, and the tip/charged amounts — replacing the bogus `Efectivo`/`Cambio` lines a card sale prints today.

**Architecture:** The card provider contract gains an optional `CardDetails` block that SumUp fills from the transaction it already fetches at capture. Those facts persist as four nullable columns on `payments`. A new `readTenderBlock` helper reads the sale's tender row plus (for a card) its payment row and produces a tagged `tender` block on `TillSaleResult`; both the paper and on-screen renderers branch on it. Reading the card facts back from the stored row makes a reprint byte-identical to the first print by construction.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle (PostgreSQL), Vitest (+ real-Postgres via Testcontainers, and browser-mode Chromium for the till UI), ESC/POS byte rendering.

**Spec:** `docs/superpowers/specs/2026-09-11-card-receipt-tender-details-design.md` (read it alongside this plan).

## Global Constraints

- **Fiscal invariants untouched.** The card block renders BELOW `TOTAL` and ABOVE the QR, outside the invoice's mandated elements. No hash input, series, chain, or `registros_facturacion` row changes. Never move the block into the fiscal body.
- **Every read scopes to the tenant.** One-tenant-per-database is NOT the query boundary (project CLAUDE.md §3). Every new read carries its own `eq(table.tenantId, cfg.tenantId)`.
- **No backfill / no backwards-compat.** No production data exists; the migration is the columns and their constraints, nothing else (CLAUDE.md §5).
- **Degrade, never throw, on presentation.** A card tender whose payment row is missing or carries no card facts renders `card: null` ("Tarjeta" alone). The sale is filed and immutable by the time a ticket is built; a presentation gap must never throw where a fiscal read would not.
- **`entry_mode` values are normalised, never passed through:** exactly `contactless | chip | swipe | unknown`. SumUp's `contactless` and `chip` are measured (runbook §4b); map `magstripe`/`swipe` → `swipe`; everything else (including absent) → `unknown`.
- **`scheme` is printed as the provider gives it, underscores → spaces** (`VISA_ELECTRON` → `VISA ELECTRON`). Not a curated set.
- **The masked-PAN separator on paper is `****`, not `•`** — the ESC/POS builder encodes `latin1` (`packages/printing/src/escpos.ts:30`) and `•` (U+2022) is not a Latin-1 character. The on-screen twin uses the same for lock-step.
- **Coverage floors:** `payments` and the fiscal core carry `statements 98 / lines 98 / functions 98 / branches 95`; `payments-sumup`, `apps/server`, `apps/till` carry `90/90/85/85`. Keep every touched package above its floor.
- **Full review ceremony** (cross-package `PaymentProvider` contract + a migration are risk triggers): a per-task reviewer on every task, and the full `/finish-branch` wave.

---

### Task 1: `CardDetails` on the provider contract

**Files:**
- Modify: `packages/payments/src/provider.ts` (add `CardDetails`; add `card?` to `PaymentResult`)
- Modify: `packages/payments/src/index.ts` (export `CardDetails` as a type)
- Test: `packages/payments/src/provider.test.ts` (create if absent; a type-carrying round-trip)

**Interfaces:**
- Produces: `CardDetails = { scheme: string; last4: string; entryMode: "contactless" | "chip" | "swipe" | "unknown"; authCode: string | null }`, and `PaymentResult.card?: CardDetails` (optional; set only on a `captured` result whose provider can supply it).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/payments/src/provider.test.ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { CardDetails, PaymentResult } from "./provider.js";

describe("PaymentResult.card", () => {
  it("carries an optional CardDetails block on a captured result", () => {
    const card: CardDetails = {
      scheme: "VISA",
      last4: "5838",
      entryMode: "contactless",
      authCode: "328600",
    };
    const result: PaymentResult = {
      provider: "sumup_cloud",
      paymentRef: "ref_1",
      state: "captured",
      amount: decimal("1.00"),
      settledAt: new Date("2026-09-11T10:53:58Z"),
      card,
    };
    expect(result.card).toEqual(card);
  });

  it("omits card on a result whose provider supplies none", () => {
    const result: PaymentResult = {
      provider: "manual",
      paymentRef: "ref_2",
      state: "captured",
      amount: decimal("1.00"),
      settledAt: new Date(),
    };
    expect(result.card).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/payments test -- provider`
Expected: FAIL — TypeScript error, `CardDetails` is not exported from `./provider.js`.

- [ ] **Step 3: Add the type and field**

In `packages/payments/src/provider.ts`, above `PaymentResult`:

```typescript
/**
 * Card facts for the customer's proof of a card payment, filled by a provider that can supply them
 * (SumUp does; Stripe leaves it undefined for now). Present only on a `captured` result. `scheme` is
 * the network as the provider names it (underscores → spaces), NOT a curated set; `entryMode` is
 * normalised to these four values; `authCode` is null when the transaction carries none.
 */
export interface CardDetails {
  scheme: string;
  last4: string;
  entryMode: "contactless" | "chip" | "swipe" | "unknown";
  authCode: string | null;
}
```

Add to `PaymentResult` (after `settledAt`):

```typescript
  /** Card facts for a card-present capture — the receipt's card block. Present only on a `captured`
   * result whose provider can supply them; undefined for cash, manual, offline, failed, reversals. */
  card?: CardDetails;
```

In `packages/payments/src/index.ts`, add `CardDetails` to the existing `export type { … } from "./provider.js";` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/payments test -- provider`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/payments/src/provider.ts packages/payments/src/index.ts packages/payments/src/provider.test.ts
git commit -s -m "feat(payments): add CardDetails to the PaymentResult contract"
```

---

### Task 2: Persist card facts on `payments`

**Files:**
- Modify: `packages/payments/src/schema/payments.ts` (four nullable columns + two CHECKs)
- Generate: `packages/payments/drizzle/<NNNN>_*.sql` (via drizzle-kit)
- Modify: `packages/payments/src/store.ts` (`PaymentRow`, `PAYMENT_COLUMNS`, `NewPayment`, `insertPayment`, `insertCapturedPayment`, `captureAttempting` carry `card`)
- Test: `packages/payments/src/store.pg.test.ts` (real Postgres — CHECK constraints and grants)

**Interfaces:**
- Consumes: `CardDetails` (Task 1).
- Produces: `PaymentRow` AND `CapturedPaymentForOrder` gain `cardScheme: string | null; cardLast4: string | null; cardEntryMode: string | null; cardAuthCode: string | null`; `CapturedPaymentForOrder` also gains `provider: string`. `captureAttempting` and `insertCapturedPayment` accept an optional `card?: CardDetails` and persist it. New store reader `findCapturedPaymentForWorkingOrderAnyProvider(tx, { tenantId, workingOrderId }): Promise<CapturedPaymentForOrder | null>` — like `findCapturedPaymentForWorkingOrder` but WITHOUT the provider filter (the ticket path does not know which provider settled), returning the captured/accepted_offline row for that working order.

- [ ] **Step 1: Write the failing test (real Postgres)**

```typescript
// packages/payments/src/store.pg.test.ts  (add to the existing real-PG suite if present)
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
// ...existing seed helpers for a working order + tenant...

describe("payments card columns", () => {
  const pg = useRealPostgres(/* migrations incl. PAYMENTS_MIGRATIONS */);

  it("persists and reads back a captured payment's card facts", async () => {
    const s = await seedWorkingOrder(pg.db()); // tenant + working order
    await withTenant(pg.db(), s.tenantId, async (tx) => {
      await asAppUser(tx);
      await insertAttempting(tx, { tenantId: s.tenantId, workingOrderId: s.workingOrderId, provider: "sumup_cloud", paymentRef: "ref_1", amount: decimal("1.00") });
      const row = await captureAttempting(tx, {
        tenantId: s.tenantId, provider: "sumup_cloud", paymentRef: "ref_1",
        settledAt: new Date("2026-09-11T10:53:58Z"), externalRef: "txn_1",
        card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" },
      });
      expect(row.cardScheme).toBe("VISA");
      expect(row.cardLast4).toBe("5838");
      expect(row.cardEntryMode).toBe("contactless");
      expect(row.cardAuthCode).toBe("328600");
    });
  });

  it("rejects a card_last4 that is not four characters", async () => {
    const s = await seedWorkingOrder(pg.db());
    await expect(
      withTenant(pg.db(), s.tenantId, async (tx) => {
        await asAppUser(tx);
        await insertAttempting(tx, { tenantId: s.tenantId, workingOrderId: s.workingOrderId, provider: "sumup_cloud", paymentRef: "ref_2", amount: decimal("1.00") });
        await captureAttempting(tx, { tenantId: s.tenantId, provider: "sumup_cloud", paymentRef: "ref_2", settledAt: new Date(), externalRef: "txn_2", card: { scheme: "VISA", last4: "58380", entryMode: "chip", authCode: null } });
      }),
    ).rejects.toThrow(/card_last4|check/i);
  });

  it("rejects an out-of-range card_entry_mode", async () => {
    const s = await seedWorkingOrder(pg.db());
    await expect(
      withTenant(pg.db(), s.tenantId, async (tx) => {
        await asAppUser(tx);
        await insertAttempting(tx, { tenantId: s.tenantId, workingOrderId: s.workingOrderId, provider: "sumup_cloud", paymentRef: "ref_3", amount: decimal("1.00") });
        await captureAttempting(tx, { tenantId: s.tenantId, provider: "sumup_cloud", paymentRef: "ref_3", settledAt: new Date(), externalRef: "txn_3", card: { scheme: "VISA", last4: "5838", entryMode: "tap" as never, authCode: null } });
      }),
    ).rejects.toThrow(/card_entry_mode|check/i);
  });
});
```

(Use the package's existing real-PG harness and seed helpers; mirror the setup already in `store.pg.test.ts` / `reverse.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/payments test -- store.pg`
Expected: FAIL — `captureAttempting` has no `card` param; the columns do not exist.

- [ ] **Step 3: Add the columns + CHECKs to the schema**

In `packages/payments/src/schema/payments.ts`, inside the `payments` `pgTable` column block (after `externalRef`):

```typescript
    /** Card-present facts for the customer receipt's card block — written once at capture by the
     * provider that supplies them (SumUp), null for cash/manual/offline/failed. Plain text + CHECK,
     * not a pgEnum: adding an entry-mode value later must not hit the one-transaction ALTER TYPE
     * trap (CLAUDE.md §2). */
    cardScheme: text("card_scheme"),
    cardLast4: text("card_last4"),
    cardEntryMode: text("card_entry_mode"),
    cardAuthCode: text("card_auth_code"),
```

Add to the table's `extraConfig` array (where the existing FKs/checks live):

```typescript
    check("payments_card_last4_ck", sql`${table.cardLast4} is null or length(${table.cardLast4}) = 4`),
    check(
      "payments_card_entry_mode_ck",
      sql`${table.cardEntryMode} is null or ${table.cardEntryMode} in ('contactless','chip','swipe','unknown')`,
    ),
```

(Import `check` and `sql` if not already imported in this file — `check` from `drizzle-orm/pg-core`, `sql` from `drizzle-orm`; both are already imported per the file head.)

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/db exec drizzle-kit --version` is not needed; from the payments package:

Run: `cd packages/payments && pnpm db:generate --name card_details && cd -`
Expected: a new `packages/payments/drizzle/<NNNN>_card_details.sql` adding the four columns and the two CHECK constraints, plus a snapshot + `_journal.json` entry. Open the SQL and confirm it is only `ALTER TABLE "payments" ADD COLUMN …` ×4 and `ADD CONSTRAINT … CHECK …` ×2 — no grant lines (table-level grants already cover new columns), no data statements.

- [ ] **Step 5: Extend the store to carry `card`**

In `packages/payments/src/store.ts`:

Add to `PaymentRow`:

```typescript
  cardScheme: string | null;
  cardLast4: string | null;
  cardEntryMode: string | null;
  cardAuthCode: string | null;
```

Add to `PAYMENT_COLUMNS`:

```typescript
  cardScheme: payments.cardScheme,
  cardLast4: payments.cardLast4,
  cardEntryMode: payments.cardEntryMode,
  cardAuthCode: payments.cardAuthCode,
```

Import `CardDetails`:

```typescript
import type { CardDetails, PaymentState } from "./provider.js";
```

Add `card?: CardDetails` to `NewPayment`, and write it in `insertPayment`'s `.values({ … })`:

```typescript
    cardScheme: params.card?.scheme ?? null,
    cardLast4: params.card?.last4 ?? null,
    cardEntryMode: params.card?.entryMode ?? null,
    cardAuthCode: params.card?.authCode ?? null,
```

`insertCapturedPayment` already spreads `NewPayment`, so it accepts `card` for free. For `captureAttempting` (which resolves an existing `attempting` row via `resolveAttempting` rather than inserting), add `card?: CardDetails` to its params and set the four columns in the same `.update(...).set({ … })` that stamps `settledAt`/`externalRef`. Locate `resolveAttempting`'s `.set(...)` and thread the card columns through (add `card?: CardDetails` to its `extra` param, set the four columns from it).

Also extend the read side that the ticket path (Task 4) uses. `findCapturedPaymentForWorkingOrder` returns `CapturedPaymentForOrder` (defined near `store.ts:290`) whose projection is `CAPTURED_FOR_ORDER_COLUMNS = { ...PAYMENT_COLUMNS, paymentRef }` — so the four card columns flow in via the `PAYMENT_COLUMNS` spread once added above, BUT the `CapturedPaymentForOrder` interface must DECLARE them, and it also does not yet carry `provider`. So:

- Add to the `CapturedPaymentForOrder` interface the four `card*: string | null` fields AND `provider: string`.
- Add `provider: payments.provider` to `CAPTURED_FOR_ORDER_COLUMNS`.
- Add a provider-agnostic reader (the ticket path does not know which provider settled, and the reprint path has no provider in scope):

```typescript
/** The captured/accepted-offline payment for a working order, WITHOUT filtering by provider — the
 * ticket/reprint path (readTenderBlock) knows the working order but not which provider settled it.
 * Returns null when none (a cash sale, or a card sale whose payment row is absent). */
export async function findCapturedPaymentForWorkingOrderAnyProvider(
  tx: Transaction,
  key: { tenantId: string; workingOrderId: string },
): Promise<CapturedPaymentForOrder | null> {
  const [row] = await tx
    .select(CAPTURED_FOR_ORDER_COLUMNS)
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, key.tenantId),
        eq(payments.workingOrderId, key.workingOrderId),
        inArray(payments.state, ["captured", "accepted_offline"]),
      ),
    );
  return row ?? null;
}
```

(Model it on the existing `findCapturedPaymentForWorkingOrder`; drop only its `eq(payments.provider, …)` clause. `inArray` is already imported in `store.ts`.)

- [ ] **Step 5b: Test the new reader (keeps payments coverage above 98%)**

Add to `store.pg.test.ts`: `findCapturedPaymentForWorkingOrderAnyProvider` returns the captured row (with `provider` and the card columns) for a card working order, and returns `null` for a working order that has only a cash sale (no payment row). Assert the returned `cardScheme`/`provider` fields.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- store.pg`
Expected: PASS — round-trip returns the card facts; both CHECK violations reject; the reader returns the row and null as expected.

- [ ] **Step 7: Run the package's privilege + guard suites (grants receipt) and coverage**

Run: `pnpm --filter @waitron/payments test:coverage`
Expected: PASS, payments above `98/98/98/95`. The privilege suite must still pass unchanged — table-level `GRANT SELECT, INSERT, UPDATE ON payments` covers the new columns; if the suite fails, do NOT widen a grant (CLAUDE.md §3) — investigate.

Run the two root guards (a table changed shape, not count, but run them):
`pnpm exec vitest run scripts/classification-complete.test.ts scripts/append-only-enable-always.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/payments/src/schema/payments.ts packages/payments/drizzle packages/payments/src/store.ts packages/payments/src/store.pg.test.ts
git commit -s -m "feat(payments): persist card-present facts on the payments row"
```

---

### Task 3: SumUp adapter fills `CardDetails`

**Files:**
- Modify: `packages/payments-sumup/src/client.ts` (`SumUpTransaction` widens)
- Modify: `packages/payments-sumup/src/sumup-client.ts` (`findTransaction` reads card fields)
- Modify: `packages/payments-sumup/src/provider.ts` (build `CardDetails` at `captured`; entry-mode map; both capture paths pass `card`)
- Modify: `packages/payments-sumup/src/testing/fake-sumup.ts` (carry the fields)
- Test: `packages/payments-sumup/src/provider.test.ts`, `packages/payments-sumup/src/sumup-client.test.ts`

**Interfaces:**
- Consumes: `CardDetails` (Task 1), `captureAttempting`'s `card` param (Task 2).
- Produces: `SumUpTransaction` gains `card?: { last4: string; type: string }; entryMode?: string; authCode?: string | null`. A `mapEntryMode(raw: string | undefined): CardDetails["entryMode"]` and a `cardFromTransaction(t: SumUpTransaction): CardDetails | undefined` in `provider.ts`.

- [ ] **Step 1: Write the failing entry-mode + mapping test**

```typescript
// packages/payments-sumup/src/provider.test.ts (add a describe block)
import { cardFromTransaction, mapEntryMode } from "./provider.js";

describe("SumUp card details mapping", () => {
  it("maps SumUp entry modes to the four normalised values", () => {
    expect(mapEntryMode("contactless")).toBe("contactless");
    expect(mapEntryMode("chip")).toBe("chip");
    expect(mapEntryMode("magstripe")).toBe("swipe");
    expect(mapEntryMode("swipe")).toBe("swipe");
    expect(mapEntryMode("something_new")).toBe("unknown");
    expect(mapEntryMode(undefined)).toBe("unknown");
  });

  it("builds CardDetails from a transaction that carries the fields", () => {
    expect(
      cardFromTransaction({
        id: "t1", status: "SUCCESSFUL", amount: decimal("1.00"),
        card: { last4: "5838", type: "VISA_ELECTRON" }, entryMode: "contactless", authCode: "328600",
      }),
    ).toEqual({ scheme: "VISA ELECTRON", last4: "5838", entryMode: "contactless", authCode: "328600" });
  });

  it("returns undefined when the transaction carries no card object", () => {
    expect(cardFromTransaction({ id: "t2", status: "SUCCESSFUL", amount: decimal("1.00") })).toBeUndefined();
  });

  it("still builds a block when auth_code is missing (null), never throwing", () => {
    expect(
      cardFromTransaction({ id: "t3", status: "SUCCESSFUL", amount: decimal("1.00"), card: { last4: "6017", type: "VISA" }, entryMode: "chip" }),
    ).toEqual({ scheme: "VISA", last4: "6017", entryMode: "chip", authCode: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/payments-sumup test -- provider`
Expected: FAIL — `mapEntryMode`/`cardFromTransaction` not exported; `SumUpTransaction` has no `card`.

- [ ] **Step 3: Widen `SumUpTransaction`**

In `packages/payments-sumup/src/client.ts`, extend the interface:

```typescript
export interface SumUpTransaction {
  id: string;
  status: SumUpStatus | (string & {});
  amount: Decimal;
  /** Card facts SumUp returns on an in-person transaction; absent on some. */
  card?: { last4: string; type: string };
  entryMode?: string;
  authCode?: string | null;
}
```

- [ ] **Step 4: Read the fields in `findTransaction`**

In `packages/payments-sumup/src/sumup-client.ts`, in `findTransaction`, widen the parse and return:

```typescript
      const t = r.json as {
        id: string; status: string; amount: number;
        card?: { last_4_digits?: string; type?: string };
        entry_mode?: string; auth_code?: string | null;
      };
      return {
        id: t.id,
        status: t.status,
        amount: fromMajorUnits(t.amount),
        ...(t.card?.last_4_digits && t.card.type
          ? { card: { last4: t.card.last_4_digits, type: t.card.type } }
          : {}),
        ...(t.entry_mode === undefined ? {} : { entryMode: t.entry_mode }),
        ...(t.auth_code === undefined ? {} : { authCode: t.auth_code }),
      };
```

- [ ] **Step 5: Add `mapEntryMode` + `cardFromTransaction` and pass `card` on both capture paths**

In `packages/payments-sumup/src/provider.ts`:

```typescript
import type { CardDetails } from "@waitron/payments";
import type { SumUpTransaction } from "./client.js";

export function mapEntryMode(raw: string | undefined): CardDetails["entryMode"] {
  switch (raw) {
    case "contactless": return "contactless";
    case "chip": return "chip";
    case "magstripe":
    case "swipe": return "swipe";
    default: return "unknown";
  }
}

export function cardFromTransaction(t: SumUpTransaction): CardDetails | undefined {
  if (t.card === undefined) return undefined;
  return {
    scheme: t.card.type.replaceAll("_", " "),
    last4: t.card.last4,
    entryMode: mapEntryMode(t.entryMode),
    authCode: t.authCode ?? null,
  };
}
```

The `captured` `PollOutcome` must carry the transaction so both `collect` (T2) and `resolvePending` can build the card block. Add `card?: CardDetails` to the `captured` variant of `PollOutcome` (populated in `classify` from `cardFromTransaction(t)`), thread it into the `captureAttempting(tx, { …, card: outcome.card })` call (the `collect` path shown at `provider.ts:155-160`) AND into `resolvePending`'s capture call, and set `card: outcome.card` on the returned `PaymentResult`.

- [ ] **Step 6: Carry the fields in the fake**

In `packages/payments-sumup/src/testing/fake-sumup.ts`, let a seeded transaction hold `card`/`entryMode`/`authCode` and return them from its `findTransaction`, so the adapter tests and the sandbox suite share one shape. Default them to a VISA contactless block unless a test overrides, matching the live control run.

- [ ] **Step 7: Write the failing "both paths carry the card + missing-fields degrade" test**

```typescript
// packages/payments-sumup/src/provider.test.ts
it("a captured collect result carries the card block from the transaction", async () => {
  // drive collect() against the fake seeded with a VISA contactless transaction
  const result = await provider.collect({ /* … */ });
  expect(result.state).toBe("captured");
  expect(result.card).toEqual({ scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" });
});

it("resolvePending carries the card block on a row it captures", async () => {
  // seed an `attempting` row + a SUCCESSFUL transaction with card fields; run resolvePending
  // assert the persisted payments row now has cardScheme='VISA', cardLast4='5838', etc.
});

it("captures without failing when the transaction has no card fields", async () => {
  // fake transaction SUCCESSFUL but no card object
  const result = await provider.collect({ /* … */ });
  expect(result.state).toBe("captured");
  expect(result.card).toBeUndefined(); // never throws
});
```

- [ ] **Step 8: Run tests to verify they pass, then coverage**

Run: `pnpm --filter @waitron/payments-sumup test -- provider sumup-client`
Then: `pnpm --filter @waitron/payments-sumup test:coverage`
Expected: PASS; package above `90/90/85/85`.

- [ ] **Step 9: Commit**

```bash
git add packages/payments-sumup/src
git commit -s -m "feat(payments-sumup): fill CardDetails from the captured transaction"
```

---

### Task 4: `tender` block on `TillSaleResult` + `readTenderBlock`, wired into all FOUR ticket sites

`tender` is added as a REQUIRED member of `TillSaleResult` and `change` is kept alongside it (removed in Task 7). Because `tender` is required, EVERY object literal typed `TillSaleResult` must gain it in this task or the build breaks — so this task also updates the four production sites AND the explicitly-typed test fixtures (listed in Step 4). The renderers keep reading `change` until Tasks 5–6 switch them to `tender`; the task ends green.

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`TillSaleResult` gains `tender`; new `readTenderBlock`; populate at `readSettledTicket`, `fileImmediateSale`, `finalizeCapture`, AND `finalizeRecovery`)
- Modify: `apps/till/src/api/client.ts` (mirror `TillSaleResult.tender`)
- Modify: the typed-literal fixtures so they compile (Step 4)
- Test: `apps/server/src/till-sale-tender-block.test.ts` (new) + existing `till-sale-integrated.test.ts`

**Interfaces:**
- Consumes: `CapturedPaymentForOrder` (with `provider` + card columns, Task 2) and `findCapturedPaymentForWorkingOrderAnyProvider` (Task 2). Do NOT use `findCapturedPaymentForWorkingOrder` — it filters by provider, which the ticket path does not have (and the reprint path has no provider in scope at all).
- Produces:

```typescript
export type TenderBlock =
  | { method: "cash"; change: string }
  | { method: "card"; charged: string; tip: string; card: CardDetails | null; reference: string | null };
```

  on `TillSaleResult` as `tender: TenderBlock`. `readTenderBlock(tx, cfg, saleId, workingOrderId, opts?: { cashChange?: string }): Promise<TenderBlock>`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/till-sale-tender-block.test.ts
import { describe, expect, it } from "vitest";
// real-PG or PGlite harness with core + payments migrations; seed a settled sale.
describe("readTenderBlock", () => {
  it("returns a cash block with the passed change", async () => {
    // settle a cash sale for total 1.00, tender 2.00 → change 1.00
    const block = await readTenderBlock(tx, cfg, saleId, workingOrderId, { cashChange: "1.00" });
    expect(block).toEqual({ method: "cash", change: "1.00" });
  });

  it("returns a card block with facts read back from the payment row", async () => {
    // settle a card sale total 1.00, no tip; payments row captured with VISA/5838/contactless/328600
    const block = await readTenderBlock(tx, cfg, saleId, workingOrderId);
    expect(block).toEqual({
      method: "card", charged: "1.00", tip: "0.00",
      card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" },
      reference: null,
    });
  });

  it("shows tip and charged when a tip rode on the card", async () => {
    // card sale total 1.00 + tip 0.50 → tenders.amount 1.50, tip_amount 0.50
    const block = await readTenderBlock(tx, cfg, saleId, workingOrderId);
    expect(block).toMatchObject({ method: "card", charged: "1.50", tip: "0.50" });
  });

  it("a manual card tender carries the operator reference and null card", async () => {
    // manual card: payments row provider='manual', external_ref='4471', card columns null
    const block = await readTenderBlock(tx, cfg, saleId, workingOrderId);
    expect(block).toEqual({ method: "card", charged: "1.00", tip: "0.00", card: null, reference: "4471" });
  });

  it("degrades to card:null when the payment row has no card facts and is not manual", async () => {
    // integrated provider row, card columns null
    const block = await readTenderBlock(tx, cfg, saleId, workingOrderId);
    expect(block).toMatchObject({ method: "card", card: null, reference: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test -- till-sale-tender-block`
Expected: FAIL — `readTenderBlock` is not defined.

- [ ] **Step 3: Implement `readTenderBlock`**

In `apps/server/src/till-sale.ts`. First add imports: `tenders` to the existing `@waitron/db` import (the import block currently pulls `sales, invoiceSeries, workingOrders, workingOrderLines` only — `tenders` is exported from the `@waitron/db` barrel), and the payments types/reader:

```typescript
import type { CardDetails } from "@waitron/payments";
import { findCapturedPaymentForWorkingOrderAnyProvider } from "@waitron/payments"; // add to the module's existing @waitron/payments import
// and add `tenders` to the existing `import { sales, invoiceSeries, workingOrders, workingOrderLines } from "@waitron/db";`

export type TenderBlock =
  | { method: "cash"; change: string }
  | { method: "card"; charged: string; tip: string; card: CardDetails | null; reference: string | null };

function cardFromPaymentRow(row: {
  cardScheme: string | null; cardLast4: string | null;
  cardEntryMode: string | null; cardAuthCode: string | null;
}): CardDetails | null {
  if (row.cardScheme === null || row.cardLast4 === null || row.cardEntryMode === null) return null;
  return {
    scheme: row.cardScheme,
    last4: row.cardLast4,
    // The CHECK constraint guarantees one of the four values; cast is safe.
    entryMode: row.cardEntryMode as CardDetails["entryMode"],
    authCode: row.cardAuthCode,
  };
}

async function readTenderBlock(
  tx: Transaction,
  cfg: TillConfig,
  saleId: SaleId,
  workingOrderId: string,
  opts: { cashChange?: string } = {},
): Promise<TenderBlock> {
  const [tender] = await tx
    .select({ method: tenders.method, amount: tenders.amount, tip: tenders.tipAmount })
    .from(tenders)
    .where(and(eq(tenders.tenantId, cfg.tenantId), eq(tenders.saleId, saleId)));
  // A settled sale always has exactly one tender; if somehow absent, present as cash with no change
  // rather than throwing on a filed, immutable sale (Global Constraint: degrade, never throw).
  if (tender === undefined || tender.method === "cash") {
    return { method: "cash", change: opts.cashChange ?? "0.00" };
  }
  const payment = await findCapturedPaymentForWorkingOrderAnyProvider(tx, {
    tenantId: cfg.tenantId,
    workingOrderId,
  });
  return {
    method: "card",
    charged: tender.amount,
    tip: tender.tip,
    card: payment === null ? null : cardFromPaymentRow(payment),
    reference: payment !== null && payment.provider === "manual" ? payment.externalRef : null,
  };
}
```

`cardFromPaymentRow` takes a `CapturedPaymentForOrder` (which Task 2 gave the four `card*` columns + `provider` + `externalRef`). The reader is provider-agnostic (Task 2), so it finds a manual card row (`provider === "manual"`, card columns null → `card: null`, `reference` = the operator ref) exactly as it finds an integrated one.

- [ ] **Step 4: Add `tender` to `TillSaleResult` and populate it at all FOUR sites + the typed fixtures**

Add to the `TillSaleResult` interface (keep `change` for now):

```typescript
  tender: TenderBlock;
```

Populate `tender` (via `readTenderBlock`) at every function that builds a `TillSaleResult` literal — there are FOUR, not three:

- `readSettledTicket` (its `const ticket`/`return {` around `till-sale.ts:494`; it takes `change = "0.00"` and has `issued.saleId` + `workingOrderId`): add `const tender = await readTenderBlock(tx, cfg, brandSaleId(issued.saleId), workingOrderId, { cashChange: change });` before the return and include `tender,`.
- `fileImmediateSale` (ticket built ~`till-sale.ts:692`; has `saleId`, `workingOrderId`, `change`): the tender row is written by `recordSale` (~636) and, for a manual card, the payment row by `recordManualCardPayment` (~663) — BOTH before the ticket build, so read after them: `const tenderBlock = await readTenderBlock(tx, cfg, saleId, workingOrderId, { cashChange: change });` and include `tender: tenderBlock,`.
- `finalizeCapture` (ticket ~`till-sale.ts:1056`; integrated fresh capture; the `payments` row was captured in P2 and associated in this tx; `change` is `"0.00"`): `const tenderBlock = await readTenderBlock(tx, cfg, saleId, req.id, { cashChange: "0.00" });`, include `tender: tenderBlock,`.
- **`finalizeRecovery` (ticket ~`till-sale.ts:1229`) — the lost-T2 card-recovery path, a genuine card sale that prints a receipt.** It has the working-order id and the captured payment in scope. Add the same `readTenderBlock` call (`cashChange: "0.00"`) and include `tender: tenderBlock,`. (This is the fourth site the spec's "three sites" undercounted; the plan-review caught it.)

Then update every OTHER object literal explicitly typed `TillSaleResult`, or the build breaks the moment `tender` is required. These are test fixtures (production code has no other `TillSaleResult` literal):

- `apps/server/src/receipt-ticket.test.ts:31` (`FILED_SALE: TillSaleResult`) and `:199` (inline `result: TillSaleResult`) — add a `tender` (a cash block `{ method: "cash", change: <its existing change> }` unless the case is about a card).
- `apps/server/src/till-sale-integrated.test.ts:14` (`TICKET: TillSaleResult`) — add a `tender`.

Give each fixture a `tender` consistent with its existing `change` (cash fixtures → `{ method: "cash", change }`); the card-specific renderer fixtures come in Tasks 5–6.

- [ ] **Step 5: Mirror the type on the till client**

In `apps/till/src/api/client.ts`, add the `TenderBlock` union and `tender: TenderBlock` to the mirrored `TillSaleResult` (keep `change`), matching the server names exactly.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server test -- till-sale-tender-block till-sale-integrated`
Then run the package unfiltered (a wire body changed): `pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/till-sale.ts apps/server/src/till-sale-tender-block.test.ts apps/till/src/api/client.ts
git commit -s -m "feat(server): build a tender block on TillSaleResult (additive)"
```

---

### Task 5: Paper renderer — the card block

**Files:**
- Modify: `apps/server/src/receipt-ticket.ts` (`LABEL`, branch on `tender.method`)
- Test: `apps/server/src/receipt-ticket.test.ts`

**Interfaces:**
- Consumes: `TillSaleResult.tender` (Task 4).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/receipt-ticket.test.ts (add cases)
it("prints a card block with scheme, masked PAN, entry mode and auth code", () => {
  const bytes = formatReceipt({ ...base, tender: { method: "card", charged: "1.00", tip: "0.00", card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" }, reference: null } }, issuer, trim, "es-ES");
  const text = decodeLatin1(bytes);
  expect(text).toContain("Tarjeta VISA **** 5838");
  expect(text).toContain("Sin contacto");
  expect(text).toContain("Aut 328600");
  expect(text).not.toContain("Efectivo");
});

it("prints the tip and charged lines only when a tip rode on the card", () => {
  const text = decodeLatin1(formatReceipt({ ...base, tender: { method: "card", charged: "1.50", tip: "0.50", card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" }, reference: null } }, issuer, trim, "es-ES"));
  expect(text).toContain("Propina");
  expect(text).toContain("Cobrado");
});

it("omits the tip/charged lines when there is no tip", () => {
  const text = decodeLatin1(formatReceipt({ ...base, tender: { method: "card", charged: "1.00", tip: "0.00", card: { scheme: "VISA", last4: "5838", entryMode: "unknown", authCode: null }, reference: null } }, issuer, trim, "es-ES"));
  expect(text).not.toContain("Cobrado");
  expect(text).not.toContain("Propina");
});

it("prints Tarjeta alone when no card facts are known", () => {
  const text = decodeLatin1(formatReceipt({ ...base, tender: { method: "card", charged: "1.00", tip: "0.00", card: null, reference: null } }, issuer, trim, "es-ES"));
  expect(text).toContain("Tarjeta");
  expect(text).not.toContain("****");
});

it("prints a manual card reference when present", () => {
  const text = decodeLatin1(formatReceipt({ ...base, tender: { method: "card", charged: "1.00", tip: "0.00", card: null, reference: "4471" } }, issuer, trim, "es-ES"));
  expect(text).toContain("Ref. 4471");
});

it("still prints the cash block for a cash sale", () => {
  const text = decodeLatin1(formatReceipt({ ...base, tender: { method: "cash", change: "0.00" } }, issuer, trim, "es-ES"));
  expect(text).toContain("Efectivo");
  expect(text).toContain("Cambio");
});
```

(If `base` in the existing tests still carries `change`, keep it for now — `tender` is the field under test. Add a `decodeLatin1` helper if the suite lacks one: `Buffer.from(bytes).toString("latin1")`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @waitron/server test -- receipt-ticket`
Expected: FAIL — the renderer still prints the unconditional cash block; no card lines.

- [ ] **Step 3: Add labels and the branch**

In `apps/server/src/receipt-ticket.ts`, extend `LABEL`:

```typescript
  card: "Tarjeta",
  tip: "Propina",
  charged: "Cobrado",
```

And an entry-mode label map + a card mask helper near the other module constants:

```typescript
const ENTRY_MODE_LABEL: Record<string, string> = {
  contactless: "Sin contacto",
  chip: "Chip",
  swipe: "Banda",
};
```

Replace the unconditional cash block (the `LABEL.cash` / `LABEL.change` lines after `TOTAL`) with a branch on `result.tender`:

```typescript
  const t = result.tender;
  if (t.method === "cash") {
    b.line(twoColumn(LABEL.cash, formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale)));
    b.line(twoColumn(LABEL.change, formatMoney(t.change, locale)));
  } else {
    if (t.card === null) {
      b.line(LABEL.card);
    } else {
      b.line(`${LABEL.card} ${t.card.scheme} **** ${t.card.last4}`);
      const mode = ENTRY_MODE_LABEL[t.card.entryMode]; // undefined for "unknown"
      const auth = t.card.authCode === null ? undefined : `Aut ${t.card.authCode}`;
      const second = [mode, auth].filter((x) => x !== undefined).join(" · ");
      if (second !== "") b.line(second);
    }
    if (t.reference !== null) b.line(`Ref. ${t.reference}`);
    if (t.tip !== "0.00") {
      b.line(twoColumn(LABEL.tip, formatMoney(t.tip, locale)));
      b.line(twoColumn(LABEL.charged, formatMoney(t.charged, locale)));
    }
  }
  b.line();
```

(`·` is U+00B7, a Latin-1 character — safe on paper. Compare the tip as a STRING: `tenders.tip_amount` is `numeric(12,2)`, always canonical `"0.00"`/`"0.50"`, so `t.tip !== "0.00"` is correct — do NOT use `decimal(t.tip) !== decimal("0.00")`, which compares object identity and is always true. Task 6 uses the same string compare.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @waitron/server test -- receipt-ticket`
Expected: PASS (all variants).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-ticket.ts apps/server/src/receipt-ticket.test.ts
git commit -s -m "feat(server): render the card block on the paper receipt"
```

---

### Task 6: On-screen renderer — the card block

**Files:**
- Modify: `apps/till/src/screens/till-ticket-view.ts` (`LABEL`, branch on `tender.method`)
- Test: `apps/till/src/screens/till-ticket-view.test.ts`, `apps/till/src/screens/till-ticket-view.a11y.test.ts`

**Interfaces:**
- Consumes: `TillSaleResult.tender` (Task 4).

- [ ] **Step 1: Write the failing tests** — mirror Task 5's variants against the rendered DOM (the suite renders the component and queries text). Assert the card sale shows `Tarjeta VISA **** 5838` / `Sin contacto` / `Aut 328600`, the tip case shows `Propina`/`Cobrado`, the no-facts case shows `Tarjeta` alone, cash still shows `Efectivo`/`Cambio`. Add the same cases to the a11y test so the card block is included in the accessible receipt.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @waitron/till test -- till-ticket-view`
Expected: FAIL — component still renders the unconditional cash block.

- [ ] **Step 3: Add labels + branch** — extend the view's `LABEL` with `card`/`tip`/`charged` and the entry-mode label map, matching `receipt-ticket.ts` exactly (the two `LABEL` tables are kept identical by convention). Replace the `<div class="tender">` cash block with a branch on `r.tender.method` producing the same content as Task 5 (cash rows, or the card rows: `Tarjeta <scheme> **** <last4>`, the entry-mode·auth line when present, `Ref.` when a manual reference, and the `Propina`/`Cobrado` rows only when `tip !== "0.00"`; `Tarjeta` alone when `card === null`). Use `****` for the mask, matching paper.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/till test -- till-ticket-view`
Then: `pnpm --filter @waitron/till test:coverage`
Expected: PASS; package above `90/90/85/85`. (Browser-mode Chromium: check machine headroom first per CLAUDE.md — `memory_pressure | grep free`.)

- [ ] **Step 5: Commit**

```bash
git add apps/till/src/screens/till-ticket-view.ts apps/till/src/screens/till-ticket-view.test.ts apps/till/src/screens/till-ticket-view.a11y.test.ts
git commit -s -m "feat(till): render the card block on the on-screen receipt"
```

---

### Task 7: Remove the transitional `change` field; live sandbox assertion; full-workspace gate

**Files:**
- Modify: `apps/server/src/till-sale.ts` (drop `change` from `TillSaleResult` and the four sites)
- Modify: `apps/till/src/api/client.ts` (drop `change` from the mirror)
- Modify: EVERY `change` consumer (the plan-review found the original six was an undercount). Grep first: `rg -n '\.change\b' apps/server/src apps/till/src apps/server/scripts` and reconcile against this list before editing —
  - **Test files that assert `.change` on a `TillSaleResult`:** `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/till-sale-integrated.test.ts`, `apps/server/src/till-api.pg.test.ts` (~422, 525, 716, 766, 1081), `apps/server/src/till-sale-integrated.pg.test.ts` (~503, 816, 1195), `apps/server/src/till-sale.test.ts` (~268, 306, 778), `apps/server/src/working-order.pg.test.ts` (~16 assertions, 518–1776), `apps/till/src/screens/till-ticket-view.test.ts`, `apps/till/src/screens/till-ticket-view.a11y.test.ts`, `apps/till/src/till-app.test.ts`, `apps/till/src/api/client.test.ts`.
  - **Production/demo scripts that read `ticket.change`** (typechecked — `apps/server/tsconfig.json` includes `scripts`): `apps/server/scripts/park-retrieve-demo.ts:311`, `apps/server/scripts/integrated-card-demo.ts:218`, `apps/server/scripts/till-demo.ts:274` and `:352`.
  - **Excluded (not the field):** `apps/till/src/widgets/tender-pay.test.ts`'s `.change` is a CSS class / i18n key, not `TillSaleResult.change` — do not touch.
- Modify: `packages/payments-sumup/src/collect.sandbox.test.ts` (assert card columns after a live capture)

**Interfaces:** none new — this removes the deprecated `change` and finalises the shape.

- [ ] **Step 1: Remove `change`**

Delete `change: string;` from `TillSaleResult` (server) and its mirror (`apps/till/src/api/client.ts`). Remove `change` from the object literals at all FOUR sites (`readSettledTicket`, `fileImmediateSale`, `finalizeCapture`, `finalizeRecovery`) — the cash-change value now lives only in `readTenderBlock`'s `cashChange` arg. `readSettledTicket`'s `change = "0.00"` parameter stays — it feeds `cashChange`.

- [ ] **Step 2: Update every `change` consumer (the full list in this task's Files)**

Each test that constructs or asserts a `TillSaleResult` with `change: "…"` moves that expectation into `tender`: a cash fixture becomes `tender: { method: "cash", change: "…" }`; a card fixture becomes a card `tender`. Update the assertion to the new shape, never delete it (CLAUDE.md: a rewritten test must keep its behavioural claim). For the demo scripts (`park-retrieve-demo.ts`, `integrated-card-demo.ts`, `till-demo.ts`) that read `ticket.change` for display, switch each to read `ticket.tender.method === "cash" ? ticket.tender.change : "0.00"` (or print the card block — match what the script demonstrates). Grep `rg -n '\.change\b' apps/server/src apps/till/src apps/server/scripts` and confirm zero `TillSaleResult.change` reads remain before moving on.

- [ ] **Step 3: Add the live sandbox assertion**

In `packages/payments-sumup/src/collect.sandbox.test.ts`, after the real capture in the existing self-skipping suite, assert the persisted `payments` row carries the card facts:

```typescript
// after collect() drives a real €1 capture on the paired Solo:
const row = await getPaymentRowByRef(pg.db, s.tenantId, "sumup_cloud", paymentRef);
expect(row.cardScheme).toBe("VISA");
expect(row.cardLast4).toMatch(/^\d{4}$/);
expect(row.cardEntryMode).toBe("contactless"); // for a tap; "chip" for an inserted card
expect(row.cardAuthCode).not.toBeNull();
```

(This suite runs only on the owner's laptop with `SUMUP_API_KEY`/`MERCHANT_CODE`/`READER_ID` set; it never runs in CI.)

- [ ] **Step 4: Full-workspace gate**

The wire body is asserted by both `apps/server` and `apps/till`, so run the whole workspace (CLAUDE.md §2 — a value more than one package asserts):

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
Expected: PASS across the workspace. (Check machine headroom before the browser-mode packages run.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -s -m "refactor(server,till): finalise TillSaleResult.tender, drop change; sandbox card assertion"
```

---

## Self-Review

**Spec coverage:**
- §4.1 provider contract → Task 1. §4.2 SumUp adapter → Task 3. §4.3 storage → Task 2 (note: the plan uses plain `db:generate` for the CHECKs — verified against `0000_payments_baseline.sql`, which carries a generated CHECK; spec §4.3's "+ db:generate:custom" was the inaccurate one, the plan is right). §4.4 ticket data / `readTenderBlock` → Task 4, wired into FOUR construction sites (`readSettledTicket`, `fileImmediateSale`, `finalizeCapture`, `finalizeRecovery` — the spec/plan's original "three" undercounted; corrected after the plan-review), finalised in Task 7. §4.5 renderers → Tasks 5–6. §5 testing → each task's tests + Task 7's full gate + sandbox. §6 fiscal invariants → Global Constraints (nothing in any task touches the fiscal body). §7 out of scope → not built (Stripe leaves `card` undefined; no second slip; scheme not normalised beyond underscore→space).
- Stripe: no task fills its `card` — correct, it's optional and out of scope (§7). Logged as a backlog follow-up already.

**Placeholder scan:** all code steps carry real code; test steps that describe DOM/real-PG setup point at the existing harness in the named sibling suites rather than inventing one — acceptable because the exact harness is repo-established and named. No "TBD"/"handle edge cases".

**Type consistency:** `CardDetails` (Task 1) is the single card type used by the store (Task 2), the adapter (Task 3), and `readTenderBlock` (Task 4). `TenderBlock` is defined once (Task 4) and consumed unchanged by both renderers (5–6) and finalised (7). `entryMode` is the same four-value union everywhere. `readTenderBlock`'s signature is stated once and called identically at all three sites.

**Risk-trigger note for executors:** Task 2 (migration) and Task 4 (the `PaymentProvider`/`TillSaleResult` contract) are the risk triggers — full per-task review on every task, full `/finish-branch` wave.
