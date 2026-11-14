import { readSettings, VENUE_SETTINGS } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import {
  billPayments,
  invoiceSeries,
  nodes,
  sales,
  tenants,
  tenders,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  seedDevice,
  seedNode,
  seedVenue,
  seedWorkingOrder as seedOrder,
} from "@waitron/db/testing/seed.js";
import { cardReaderHolders } from "../src/schema/card-reader-holders.js";
import { cardReaders } from "../src/schema/card-readers.js";
import type { CollectionOwners } from "../src/provider.js";
import type { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";

export interface Seeded {
  deviceId: string;
  nodeId: NodeId;
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
 * Seeds the tenant, the venue (on first use), a node, a till device and an open working order,
 * and returns their ids.
 */
export async function seedWorkingOrder(db: Database, nif = "B00000000"): Promise<Seeded> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nif, legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
  const venue = await readSettings(db, VENUE_SETTINGS);
  if (venue.revision === 0)
    await seedVenue(db, {
      name: "Counter",
      invoiceLocales: ["es"],
      operationDescription: "Retail",
    });
  const nodeId = await seedNode(db);
  const { deviceId } = await seedDevice(db);
  const order = await seedOrder(db, { source: "device", deviceId });
  return { deviceId, nodeId, workingOrderId: order.id };
}

/** Owners that cover every payment in the database, for a sweep test about something other than
 * which box owns a payment. */
export async function ownsEveryPayment(db: Database): Promise<CollectionOwners> {
  const [first, ...rest] = (await db.select({ id: nodes.id }).from(nodes)).map((row) =>
    brandNodeId(row.id),
  );
  return { nodeId: first ?? brandNodeId(randomUUID()), takenOverFrom: rest, unowned: true };
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
        source: "device",
        deviceId: seeded.deviceId,
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

/** A pending card bill payment on the seeded order, for a provider's `payments` row to name. */
export async function seedBillPayment(db: Database, seeded: Seeded): Promise<string> {
  const [row] = await db
    .insert(billPayments)
    .values({
      workingOrderId: seeded.workingOrderId,
      submissionId: `submission-${Math.random()}`,
      fingerprint: "fingerprint",
      kind: "contribution",
      method: "card",
      applied: 1000,
      state: "pending",
      requestedBy: "11111111-1111-1111-1111-111111111111",
      source: "device",
      deviceId: seeded.deviceId,
    })
    .returning({ id: billPayments.id });
  return row!.id;
}

/** The bill payment a provider's `payments` row names, read by its reference. */
export async function billPaymentOfRow(db: Database, paymentRef: string): Promise<string | null> {
  const rows = await db.execute<{ bill_payment_id: string | null }>(
    sql`select bill_payment_id from payments where payment_ref = ${paymentRef}`,
  );
  return rows.rows[0]!.bill_payment_id;
}

/** Pairs a card reader and makes `deviceId` its holder, as a device that selected it would be. */
export async function seedHeldReader(db: Database, deviceId: string): Promise<string> {
  const [reader] = await db
    .insert(cardReaders)
    .values({ provider: "sumup", providerRef: `rdr_${randomUUID()}`, name: "Reader" })
    .returning({ id: cardReaders.id });
  await db.insert(cardReaderHolders).values({ readerId: reader!.id, deviceId });
  return reader!.id;
}

export async function readerOfRow(db: Database, paymentRef: string): Promise<string | null> {
  const rows = await db.execute<{ reader_id: string | null }>(
    sql`select reader_id from payments where payment_ref = ${paymentRef}`,
  );
  return rows.rows[0]!.reader_id;
}
