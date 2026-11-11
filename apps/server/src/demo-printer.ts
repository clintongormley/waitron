import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { codeOf } from "@waitron/server-kit";
// The registry of `printer.not_found`, which `routeToDemoPrinter` throws.
import "@waitron/printing";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  deviceProfiles,
  kitchenStations,
  printAgents,
  printers,
  stationPrinters,
  withTransaction,
  type Database,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { readProfilePrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import { createPrinter, PULL_BATCH_LIMIT } from "@waitron/printing";
import { deletePrinter } from "./printer-delete.js";
import { claimInvoicePrintJobs, reportInvoicePrintJob } from "./invoice-print.js";

export const DEMO_PRINTER_KEY = "WAITRON-DEMO-PRINTER";
const DEMO_AGENT_TOKEN_HASH = "waitron-demo-printer-disabled";

export interface DemoPrinterIdentity {
  printerId: string;
  agentId: string;
}

export async function configureDemoPrinter(
  db: Database,
  practiceMode: boolean,
): Promise<DemoPrinterIdentity | null> {
  return withTransaction(db, async (tx) => {
    // The venue condition keeps the lookup on `printers_local_key_key`, which leads with it.
    const venueId = await venueLocationId(tx);
    const [existing] = await tx
      .select({ id: printers.id })
      .from(printers)
      .where(
        and(
          eq(printers.locationId, venueId),
          eq(printers.localKey, DEMO_PRINTER_KEY),
          isNull(printers.deletedAt),
        ),
      );
    if (!practiceMode) {
      if (existing !== undefined) {
        await deletePrinter(tx, existing.id);
      }
      return null;
    }
    const printerId =
      existing?.id ??
      (
        await createPrinter(tx, {
          name: "Demo printer",
          transport: "usb",
          localKey: DEMO_PRINTER_KEY,
          hasCashDrawer: true,
        })
      ).id;
    if (existing !== undefined)
      await tx.update(printers).set({ active: true }).where(eq(printers.id, printerId));

    const [agent] = await tx
      .select({ id: printAgents.id })
      .from(printAgents)
      .where(eq(printAgents.tokenHash, DEMO_AGENT_TOKEN_HASH));
    const agentId =
      agent?.id ??
      (
        await tx
          .insert(printAgents)
          .values({
            name: "Demo printer",
            tokenHash: DEMO_AGENT_TOKEN_HASH,
            active: false,
          })
          .returning({ id: printAgents.id })
      )[0]!.id;

    await routeToDemoPrinter(tx, printerId);
    return { printerId, agentId };
  });
}

/**
 * Lists the printer last on every live profile's receipt, payment slip and invoice lists and makes
 * it the default of each that has none; while the printer has a cash drawer it does the same on the
 * cash drawer list, so devices on Use default print and open the drawer on it. Gives it to every
 * preparation station. A device's own choice, a profile's own default and a listing the
 * profile already has stay. Safe to repeat.
 */
export async function routeToDemoPrinter(tx: Transaction, printerId: string): Promise<void> {
  const [printer] = await tx
    .select({ hasCashDrawer: printers.hasCashDrawer })
    .from(printers)
    .where(and(eq(printers.id, printerId), isNull(printers.deletedAt)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
  // `setProfilePrinterLists` refuses a newly listed drawer printer without a drawer.
  const opensDrawer = printer.hasCashDrawer;
  const profiles = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt));
  for (const profile of profiles) {
    const lists = await readProfilePrinterLists(tx, profile.id);
    const listed = [lists.receiptPrinterIds, lists.paymentSlipPrinterIds, lists.invoicePrinterIds];
    const defaults = [
      lists.receiptPrinterDefaultId,
      lists.paymentSlipPrinterDefaultId,
      lists.invoicePrinterDefaultId,
    ];
    if (opensDrawer) {
      listed.push(lists.cashDrawerPrinterIds);
      defaults.push(lists.cashDrawerPrinterDefaultId);
    }
    if (listed.every((ids) => ids.includes(printerId)) && defaults.every((id) => id !== null))
      continue;
    const append = (ids: string[]) => (ids.includes(printerId) ? ids : [...ids, printerId]);
    await setProfilePrinterLists(tx, profile.id, {
      ...lists,
      receiptPrinterIds: append(lists.receiptPrinterIds),
      paymentSlipPrinterIds: append(lists.paymentSlipPrinterIds),
      cashDrawerPrinterIds: opensDrawer
        ? append(lists.cashDrawerPrinterIds)
        : lists.cashDrawerPrinterIds,
      invoicePrinterIds: append(lists.invoicePrinterIds),
      receiptPrinterDefaultId: lists.receiptPrinterDefaultId ?? printerId,
      paymentSlipPrinterDefaultId: lists.paymentSlipPrinterDefaultId ?? printerId,
      invoicePrinterDefaultId: lists.invoicePrinterDefaultId ?? printerId,
      cashDrawerPrinterDefaultId:
        lists.cashDrawerPrinterDefaultId ?? (opensDrawer ? printerId : null),
    });
  }
  const stations = await tx.select({ id: kitchenStations.id }).from(kitchenStations);
  for (const station of stations) {
    await tx
      .insert(stationPrinters)
      .values({ stationId: station.id, printerId })
      .onConflictDoNothing();
  }
}

export async function deliverDemoPrinterJobs(
  db: Database,
  identity: DemoPrinterIdentity,
): Promise<number> {
  let delivered = 0;
  for (let pull = 0; pull < PULL_BATCH_LIMIT; pull += 1) {
    const jobs = await withTransaction(db, (tx) =>
      claimInvoicePrintJobs(tx, identity.agentId, {
        visibleKeys: [DEMO_PRINTER_KEY],
        printerId: identity.printerId,
      }),
    );
    if (jobs.length === 0) break;
    for (const job of jobs) {
      await withTransaction(db, (tx) =>
        reportInvoicePrintJob(tx, {
          agentId: identity.agentId,
          jobId: job.id,
          invoiceClaim: job.invoiceClaim,
          outcome: { status: "done" },
        }),
      );
      delivered += 1;
    }
  }
  return delivered;
}

export function demoPrinterJob(
  db: Database,
  identity: DemoPrinterIdentity,
  log: Logger,
): JobDefinition {
  return {
    name: "demo.printer",
    applies: () => true,
    wakeOn: ["print_jobs"],
    minSleepMs: 500,
    maxSleepMs: 60_000,
    backoff: { firstMs: 500, maxMs: 60_000 },
    async pass() {
      try {
        await deliverDemoPrinterJobs(db, identity);
      } catch (error) {
        log("error", "demo_printer.delivery_failed", { errorCode: codeOf(error) });
        throw error;
      }
      return { nextDueAt: null };
    },
  };
}
