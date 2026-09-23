import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  associatePaymentWithSale,
  getPaymentByRef,
  hasPaymentWithExternalRef,
  settleInitiated,
} from "./store.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// This mirrors async.wiring.test.ts's capstone composition (verify -> hasPaymentWithExternalRef ->
// withTransaction{ settleInitiated + recordSale + associate }), but proves the SAME idempotency
// under two deliveries arriving TOGETHER rather than under sequential redelivery.
//
// `resetPerTest` is left at its default: the suite's one case seeds inside its own body.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

// Both doubles wrap the suite handle, so they cannot be built until the database is open — hence a
// hook rather than a module-level construction. `install` creates the fake backend's own
// `fake_node_registrations`/`fake_fiscal_records` tables, which `recordSale` writes through it.
let backend: FakeFiscalBackend;
let provider: FakeAsyncProvider;

beforeAll(async () => {
  await FakeFiscalBackend.install(suite.db);
  backend = new FakeFiscalBackend(suite.db);
  provider = new FakeAsyncProvider(suite.db);
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

function buildInput(s: SeededForSale, settledAt: Date | null): RecordSaleInput {
  return {
    tillId: brandTillId(s.tillId),
    nodeId: brandNodeId(s.nodeId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "12.10",
    lines: [
      {
        lineNo: 1,
        name: "Item",
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    // Immediate settlement, tip on the tender (zero here): sum(amount) 12.10 = total 12.10 + tip 0.00.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "12.10", tipAmount: "0.00", settledAt }],
    },
    clock: steadyClock,
  };
}

/**
 * The real orchestration, with no gate in it.
 *
 * It had one on PostgreSQL: the holder paused after `settleInitiated` had taken the payment row's
 * `FOR UPDATE` lock, so the second delivery could be started and PROVEN to block on it. There is
 * no row lock to hold open here, and a paused transaction would not let the second delivery start
 * at all — one writer holds the venue file at a time
 * (`packages/store/src/write-queue.ts`) — so the pause and the two connections are gone together.
 */
async function orchestrate(
  db: Database,
  s: SeededForSale,
  payload: string,
): Promise<string | null> {
  const event = provider.verifyAndParse(payload, "signature");
  if (event === null) return null;
  if (!(await hasPaymentWithExternalRef(db, event.provider, event.externalRef))) return null;
  return withTransaction(db, async (tx) => {
    const row = await settleInitiated(tx, {
      provider: event.provider,
      externalRef: event.externalRef,
      settledAt: event.settledAt,
    });
    if (row === null) return null; // redelivery — already chained; do nothing
    const recorded = await recordSale(tx, backend, buildInput(s, event.settledAt));
    await associatePaymentWithSale(tx, {
      provider: event.provider,
      paymentRef: row.paymentRef,
      saleId: recorded.saleId,
    });
    return recorded.saleId;
  });
}

/**
 * LOSS, stated rather than left to be noticed: what this suite asserted about WAITING is gone. The
 * PostgreSQL version could show the second delivery still unsettled after a 200ms pause while the
 * first held its lock, which distinguished "blocked" from "ran second". This version cannot make
 * that distinction and does not try to; what it still discriminates is the OUTCOME — exactly one
 * sale for one settlement, which is the fiscal invariant (`CLAUDE.md` §5: an invoice number is
 * never reused, and a second one for this settlement could not be withdrawn afterwards).
 *
 * The arbiter is `settleInitiated`'s state-guarded UPDATE (`store.ts`, it matches only a row still
 * `initiated`), not anything in this file.
 *
 * Proof by deletion, 2026-09-22: with `eq(payments.state, "initiated")` removed from that UPDATE's
 * `where` and nothing else changed, this case fails — and it fails INSIDE the second delivery's
 * `recordSale`, on `UNIQUE constraint failed: sales.working_order_id`
 * (`packages/core/src/record-sale.ts:317`). That is the receipt for the thing a passing run cannot
 * show on its own: both deliveries really do get past `hasPaymentWithExternalRef` — which reads
 * outside the transaction — and both really do reach the settle, so the single sale below is the
 * guard's doing and not an artifact of the second delivery giving up early. The guard was restored
 * immediately; the command was
 * `pnpm --filter @waitron/payments exec vitest run src/async-settle.concurrency.test.ts`.
 */
describe("two simultaneous deliveries of the same settlement", () => {
  it("chains exactly one sale — the second delivery's UPDATE matches nothing once the first has committed", async () => {
    const s = await seedForSale(suite.db, backend, freshNif());
    const minted = await provider.initiate({
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "settled",
      amount: "12.10",
      settledAt: BASE,
    });

    // Started together on the one handle a host can build. Neither is awaited before the other
    // begins, so both run `hasPaymentWithExternalRef` against a row still `initiated`.
    const [holderSaleId, waiterSaleId] = await Promise.all([
      orchestrate(suite.db, s, payload),
      orchestrate(suite.db, s, payload),
    ]);

    // Exactly one delivery chained a sale; the other's settleInitiated matched nothing. Which one
    // won is not asserted — that is the order the queue happened to take, not an invariant.
    const chained = [holderSaleId, waiterSaleId].filter((id) => id !== null);
    expect(chained).toHaveLength(1);

    const sales = await suite.db.execute<{ count: number }>(
      // `count(*)::text` on PostgreSQL. SQLite has no `::` cast; `cast(… as int)` is the spelling
      // `packages/db/src/testing/venue-db.test.ts` settled on, and the count arrives as a number.
      sql`select cast(count(*) as int) as count from sales`,
    );
    expect(sales.rows[0]!.count).toBe(1); // never two invoice numbers for one settlement

    const row = await withTransaction(suite.db, (tx) =>
      getPaymentByRef(tx, { provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.saleId).toBe(chained[0]);
  });
});
