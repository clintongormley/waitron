import { randomUUID } from "node:crypto";
import { printJobs, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { setProductCourse } from "../kitchen.js";
import { attachPrinterToStation } from "../station-printers.js";
import { routeProductTo } from "./zone-offers.js";

export function useKitchenPrintDb() {
  return useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
}

export let db: Database;

export function bindKitchenPrintDb(database: Database): void {
  db = database;
}

export const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

// Pins round independence and never-block (no socket opened).
export const LOCALE = "es-ES";

export function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Read the print-job outbox. This cannot tell `binary`'s read mapping from the driver's; the mapping
 *  is pinned in packages/db/src/schema/columns.test.ts ("binary binds a Uint8Array…"). */
export async function printJobsFor(
  tx: Transaction,
): Promise<{ id: string; printerId: string; status: string; payload: Uint8Array }[]> {
  return (
    await tx
      .select({
        id: printJobs.id,
        printerId: printJobs.printerId,
        status: printJobs.status,
        payload: printJobs.payload,
      })
      .from(printJobs)
  ).map((job) => ({ ...job, payload: job.payload! }));
}

/** A basket line for a product at quantity 1. */
export const line = (productId: string) => ({ productId, quantity: "1" });

/** Create a sellable product, optionally routed to a station and/or a course. */
export async function makeProduct(
  tx: Transaction,
  name: string,
  route: { stationId?: string; courseId?: string } = {},
): Promise<string> {
  const { id } = await createProduct(tx, {
    categoryId: null,
    name: name,
    pricingUnit: "each",
    unitPrice: "1.50",
  });
  if (route.stationId !== undefined) await routeProductTo(tx, id, route.stationId);
  if (route.courseId !== undefined) await setProductCourse(tx, id, route.courseId);
  return id;
}

/** Create a live station printer. */
export async function makePrinter(tx: Transaction, name: string): Promise<string> {
  const { id } = await createPrinter(tx, {
    name,
    transport: "cloud_poll",
    pollId: `poll-${randomUUID()}`,
  });
  return id;
}

/** Create a live printer attached to each of `stationIds`. */
export async function makeSharedPrinter(
  tx: Transaction,
  name: string,
  stationIds: string[],
): Promise<string> {
  const printerId = await makePrinter(tx, name);
  for (const stationId of stationIds) await attachPrinterToStation(tx, { stationId, printerId });
  return printerId;
}
