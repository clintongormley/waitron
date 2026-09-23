import { nodeId as brandNodeId, stringToCents } from "@waitron/shared";
import {
  invoiceSeries,
  locations,
  nodes,
  sales,
  tenants,
  tenders,
  tills,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { paymentPolicy } from "../src/schema/payment-policy.js";
import type { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";

export interface Seeded {
  tillId: string;
  nodeId: string;
  workingOrderId: string;
}

export interface SeededForSale extends Seeded {
  seriesId: string;
}

// Each of this package's test files runs against its own venue database, and within a file tenants
// accumulate for the life of the suite unless the helper's per-test reset empties them, so every
// test that seeds a tenant needs its own NIF or collides with a prior one on
// `tenants_country_tax_id_key`. A single shared counter is enough — the databases never see each
// other's rows.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(10_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Seeds tenant → location → till → node → open working_order and returns their ids. The `node`
 * is what the fiscal chain/series/SIF identity is keyed on; it is
 * created at the same location as the till. Uses the fixture connection directly.
 *
 * Written through the table definitions rather than as raw SQL, and that is not a style choice:
 * `id` and `created_at` are `$defaultFn` generators only the insert BUILDER runs, and
 * `invoice_locales` is a list the column's own mapping encodes. The raw-SQL version this replaced
 * was refused `NOT NULL constraint failed: tenants.created_at` — measured 2026-09-22, the baseline
 * `pnpm --filter @waitron/payments test` run recorded at `/tmp/payments-baseline.txt`, where it was
 * the failure under `seedWorkingOrder test/seed.ts:33` in every wiring suite. The same shape is in
 * `packages/core/test/fixtures.ts`'s `seedTenant`.
 */
export async function seedWorkingOrder(db: Database, nif = "B00000000"): Promise<Seeded> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nif, legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
  const [location] = await db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Till 1" })
    .returning({ id: tills.id });
  const [node] = await db
    .insert(nodes)
    .values({ locationId, name: "Node 1" })
    .returning({ id: nodes.id });
  // order_number is NOT NULL since park & retrieve (@waitron/db Task 1); this seed just needs a value.
  const [wo] = await db
    .insert(workingOrders)
    .values({ tillId: till!.id, orderNumber: 1 })
    .returning({ id: workingOrders.id });
  return { tillId: till!.id, nodeId: node!.id, workingOrderId: wo!.id };
}

/** The instant the seeded sale and its covering tender are stamped with. A literal rather than the
 * engine's clock: SQLite has no `now()`, and a timestamp column here holds an ISO string. */
const SEEDED_AT = new Date("2026-07-01T12:00:00Z").toISOString();

/**
 * Seeds one `invoice_series` row for the node, one `sales` row against it, and the one `tenders`
 * row that covers it, and returns the new sale's id — the minimal commercial record
 * `associatePaymentWithSale` needs to point a payment at, without going through `@waitron/core`'s
 * full `recordSale` (that full path is exercised in the Task 10 wiring test).
 *
 * A money column counts whole cents, so the 10.00 sale and the tender covering it are written as
 * 1000.
 *
 * `total` is the only money column on `sales` now — `tip_amount`/`amount_charged` were dropped in
 * migration 0012 (the tip moved to `tenders.tip_amount`). No `sale_settlements` row is declared, so
 * this is a legitimate UNSETTLED sale (design §3) and NO coverage check runs against it: migration
 * 0012 retired the old commit-time deferred `sales_assert_tenders_cover` trigger, replacing it with
 * one that fires only when settlement is DECLARED (the `sale_settlements` INSERT). Every other NOT
 * NULL column on `sales` (`packages/db/src/schema/sales.ts`) is supplied, `locale` is a member of
 * `invoice_locales`, `issued_offset_minutes` is within range, and this is the series' first (and
 * only) sale, so `invoice_number = 1` never collides with `sales_series_invoice_number_key`. The
 * sale and its covering tender are wrapped in one transaction for atomic setup — not for the
 * FK (which a committed `sales` row satisfies across separate transactions too), but so a
 * partial failure can never leave a sale without its covering tender. Uses the fixture connection
 * directly, like `seedWorkingOrder`.
 */
export async function seedSale(db: Database, seeded: Seeded): Promise<string> {
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId: seeded.nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  return withTransaction(db, async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        tillId: seeded.tillId,
        nodeId: seeded.nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: SEEDED_AT,
        issuedOffsetMinutes: 60,
        total: 1000,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "fake",
        fiscalState: "not_applicable",
      })
      .returning({ id: sales.id });
    await tx
      .insert(tenders)
      .values({ saleId: sale!.id, method: "card", amount: 1000, settledAt: SEEDED_AT });
    return sale!.id;
  });
}

/**
 * Seeds everything `@waitron/core`'s `recordSale` needs to chain a real sale on this node, for the
 * Task 10 wiring test: tenant → location → till → node → open working_order (via
 * `seedWorkingOrder`), one `invoice_series` row for the node, and the node registered with the
 * injected fiscal `backend`. Returns the ids plus the new `seriesId`.
 *
 * `backend.registerNode` is required and not optional: `FakeFiscalBackend` refuses
 * `recordSale`/`recordVoid` for a node with no prior registration (`fiscal.node_not_registered`),
 * exactly like a real backend would, and `recordSale` itself never registers a node (provisioning
 * is a separate admin action). Registration runs in its OWN committed transaction here so the
 * `fake_node_registrations` row is visible to the later, separate `recordSale` transaction — the
 * node's `NodeId` is branded at the call site because `registerNode` requires the branded type.
 *
 * Uses the fixture connection directly, like `seedWorkingOrder`/`seedSale`.
 */
export async function seedForSale(
  db: Database,
  backend: FakeFiscalBackend,
  nif?: string,
): Promise<SeededForSale> {
  const seeded = await seedWorkingOrder(db, nif);
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId: seeded.nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  await withTransaction(db, async (tx) => {
    await backend.registerNode(tx, brandNodeId(seeded.nodeId));
  });
  return { ...seeded, seriesId: series!.id };
}

/** Seeds the venue's one `payment_policy` row (`id = 1`) through the fixture connection. `cap` is
 * a decimal literal such as "50.00"; the column holds its count of cents. */
export async function seedPaymentPolicy(
  db: Database,
  mode: "accept_offline" | "cash_only",
  cap: string,
): Promise<void> {
  await db
    .insert(paymentPolicy)
    .values({ offlineMode: mode, offlineAmountCap: stringToCents(cap) });
}
