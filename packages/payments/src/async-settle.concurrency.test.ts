import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import {
  associatePaymentWithSale,
  getPaymentByRef,
  resolvePaymentTenant,
  settleInitiated,
} from "./store.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { startRealPostgres } from "./testing/postgres.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// This mirrors async.wiring.test.ts's capstone composition (verify -> resolveTenant ->
// withTenant{ settleInitiated + recordSale + associate }), but proves the SAME idempotency under
// real concurrent delivery instead of sequential redelivery: two independent Postgres connections,
// each running the full orchestration inside its own transaction, racing on the same settlement
// event via the acquired-signal pattern reversal.concurrency.test.ts / incident-dedup.concurrency
// .test.ts use — reused here, not reinvented.

const postgres = useRealPostgres({ start: startRealPostgres });

// Both doubles wrap the admin connection, so they cannot be built until the container is up —
// hence a second hook rather than a module-level construction. `install` creates the fake backend's
// own `fake_node_registrations`/`fake_fiscal_records` tables, which `recordSale` writes through it.
let backend: FakeFiscalBackend;
let provider: FakeAsyncProvider;

beforeAll(async () => {
  await FakeFiscalBackend.install(postgres.admin);
  backend = new FakeFiscalBackend(postgres.admin);
  provider = new FakeAsyncProvider(postgres.admin);
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
    tenantId: brandTenantId(s.tenantId),
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
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

/** Only the holder side gates: once it has advanced the row (settleInitiated returned non-null,
 * meaning it holds the row lock), it signals `acquired` and pauses on `held` BEFORE chaining the
 * sale, so the test can start the second delivery and prove it genuinely blocks on the still-open
 * first transaction. The second delivery calls this same function with no gate at all — nothing
 * needs to pause it; Postgres itself blocks its `settleInitiated` UPDATE on the row lock. */
async function orchestrate(
  db: Database,
  s: SeededForSale,
  payload: string,
  gate?: { acquired: () => void; held: Promise<void> },
): Promise<string | null> {
  const event = provider.verifyAndParse(payload, "signature");
  if (event === null) return null;
  const tenantId = await resolvePaymentTenant(db, event.provider, event.externalRef);
  if (tenantId === null) return null;
  return withTenant(db, tenantId, async (tx) => {
    const row = await settleInitiated(tx, {
      provider: event.provider,
      externalRef: event.externalRef,
      settledAt: event.settledAt,
    });
    if (row === null) return null; // redelivery — already chained; do nothing
    if (gate) {
      gate.acquired();
      await gate.held;
    }
    const recorded = await recordSale(tx, backend, buildInput(s, event.settledAt));
    await associatePaymentWithSale(tx, {
      tenantId,
      provider: event.provider,
      paymentRef: row.paymentRef,
      saleId: recorded.saleId,
    });
    return recorded.saleId;
  });
}

describe("two simultaneous deliveries of the same settlement race on settleInitiated's row lock", () => {
  it("chains exactly one sale — the second delivery's UPDATE matches nothing once the first has committed", async () => {
    const s = await seedForSale(postgres.admin, backend, freshNif());
    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
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

    const holder = await postgres.pg.connect();
    const waiter = await postgres.pg.connect();
    let release: () => void = () => {};
    let holderResult: Promise<string | null> | undefined;
    let waiterResult: Promise<string | null> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));

      // Holder: settles the tender (takes the row lock), signals it has, and pauses before
      // chaining the sale — holding its transaction, and the lock, open.
      holderResult = orchestrate(holder, s, payload, { acquired: acquire, held });
      await acquired; // do not race the waiter before the lock is actually held

      // Waiter: the real orchestration, unmodified. Its settleInitiated UPDATE targets the same
      // row, still (from its own snapshot) state='initiated' — it blocks on the holder's lock.
      let waiterResolved = false;
      waiterResult = orchestrate(waiter, s, payload).then((r) => {
        waiterResolved = true;
        return r;
      });
      const settledEarly = await Promise.race([
        waiterResult.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
      ]);
      expect(settledEarly).toBe(false); // still blocked on the row lock
      expect(waiterResolved).toBe(false);

      release(); // holder resumes: chains the sale, associates, commits — the lock is released
      const [holderSaleId, waiterSaleId] = await Promise.all([holderResult, waiterResult]);

      // Exactly one delivery chained a sale; the other's settleInitiated matched nothing.
      expect(holderSaleId).not.toBeNull();
      expect(waiterSaleId).toBeNull();

      const sales = await postgres.admin.execute<{ count: string }>(
        sql`select count(*)::text as count from sales where tenant_id = ${s.tenantId}`,
      );
      expect(sales.rows[0].count).toBe("1"); // never two invoice numbers for one settlement

      const row = await postgres.admin.transaction((tx) =>
        getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
      );
      expect(row?.state).toBe("captured");
      expect(row?.saleId).toBe(holderSaleId);
    } finally {
      release();
      if (holderResult) await holderResult.catch(() => {});
      if (waiterResult) await waiterResult.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
