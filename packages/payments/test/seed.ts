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

let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(10_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Seeds tenant → location → till → node → open working_order and returns their ids.
 *
 * Written through the table definitions rather than as raw SQL: `id` and `created_at` are
 * `$defaultFn` generators only the insert BUILDER runs, and `invoice_locales` is a list the
 * column's own mapping encodes.
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
  const [wo] = await db
    .insert(workingOrders)
    .values({ tillId: till!.id, orderNumber: 1 })
    .returning({ id: workingOrders.id });
  return { tillId: till!.id, nodeId: node!.id, workingOrderId: wo!.id };
}

const SEEDED_AT = new Date("2026-07-01T12:00:00Z").toISOString();

/**
 * Seeds the minimal commercial record `associatePaymentWithSale` needs to point a payment at,
 * without going through `@waitron/core`'s full `recordSale`, and returns the sale's id.
 *
 * A money column counts whole cents, so the 10.00 sale and the tender covering it are written as
 * 1000.
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
 * Seeds everything `@waitron/core`'s `recordSale` needs to chain a real sale on this node. The node
 * must be registered with the fiscal `backend`: `FakeFiscalBackend` refuses `recordSale` for an
 * unregistered node (`fiscal.node_not_registered`), and `recordSale` never registers one.
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
