// The registry of `printer.not_found`, which `routeToDemoPrinter` throws.
import "@waitron/printing";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  deviceProfilePrinters,
  deviceProfiles,
  kitchenStations,
  printAgents,
  printers,
  stationPrinters,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { readProfilePrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import { claimInvoicePrintJobs, reportInvoicePrintJob } from "./invoice-print.js";

export const DEMO_PRINTER_KEY = "WAITRON-DEMO-PRINTER";
const DEMO_AGENT_TOKEN_HASH = "waitron-demo-printer-disabled";

export interface DemoPrinterIdentity {
  printerId: string;
  agentId: string;
}

export async function configureDemoPrinter(
  db: Database,
  locationId: string,
  practiceMode: boolean,
): Promise<DemoPrinterIdentity | null> {
  return withTransaction(db, async (tx) => {
    const [existing] = await tx
      .select({ id: printers.id })
      .from(printers)
      .where(
        and(
          eq(printers.locationId, locationId),
          eq(printers.localKey, DEMO_PRINTER_KEY),
          isNull(printers.deletedAt),
        ),
      );
    if (!practiceMode) {
      if (existing !== undefined) {
        await unlistDemoPrinter(tx, existing.id);
        await tx.delete(stationPrinters).where(eq(stationPrinters.printerId, existing.id));
        await tx.update(printers).set({ active: false }).where(eq(printers.id, existing.id));
      }
      return null;
    }
    const printerId =
      existing?.id ??
      (
        await tx
          .insert(printers)
          .values({
            locationId,
            name: "Demo printer",
            transport: "usb",
            localKey: DEMO_PRINTER_KEY,
            hasCashDrawer: true,
          })
          .returning({ id: printers.id })
      )[0]!.id;
    if (existing !== undefined)
      await tx.update(printers).set({ active: true }).where(eq(printers.id, printerId));

    const [agent] = await tx
      .select({ id: printAgents.id })
      .from(printAgents)
      .where(
        and(
          eq(printAgents.locationId, locationId),
          eq(printAgents.tokenHash, DEMO_AGENT_TOKEN_HASH),
        ),
      );
    const agentId =
      agent?.id ??
      (
        await tx
          .insert(printAgents)
          .values({
            locationId,
            name: "Demo printer",
            tokenHash: DEMO_AGENT_TOKEN_HASH,
            active: false,
          })
          .returning({ id: printAgents.id })
      )[0]!.id;

    await routeToDemoPrinter(tx, locationId, printerId);
    return { printerId, agentId };
  });
}

/** Takes the printer off every profile list and default; `setProfilePrinterLists` clears the
 * devices' choices of it. */
async function unlistDemoPrinter(tx: Transaction, printerId: string): Promise<void> {
  const listing = await tx
    .selectDistinct({ id: deviceProfilePrinters.deviceProfileId })
    .from(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.printerId, printerId));
  for (const { id: profileId } of listing) {
    const lists = await readProfilePrinterLists(tx, profileId);
    const without = (ids: string[]) => ids.filter((id) => id !== printerId);
    const unlessIt = (id: string | null) => (id === printerId ? null : id);
    await setProfilePrinterLists(tx, profileId, {
      receiptPrinterIds: without(lists.receiptPrinterIds),
      paymentSlipPrinterIds: without(lists.paymentSlipPrinterIds),
      cashDrawerPrinterIds: without(lists.cashDrawerPrinterIds),
      receiptPrinterDefaultId: unlessIt(lists.receiptPrinterDefaultId),
      paymentSlipPrinterDefaultId: unlessIt(lists.paymentSlipPrinterDefaultId),
      cashDrawerPrinterDefaultId: unlessIt(lists.cashDrawerPrinterDefaultId),
    });
  }
}

/**
 * Lists the printer last on every live profile's receipt and payment slip lists and makes it the
 * default of each that has none; while the printer has a cash drawer it does the same on the cash
 * drawer list, so devices on Use default print and open the drawer on it. Gives it to every
 * preparation station there. A device's own choice, a profile's own default and a listing the
 * profile already has stay. Safe to repeat.
 */
export async function routeToDemoPrinter(
  tx: Transaction,
  locationId: string,
  printerId: string,
): Promise<void> {
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
    const listed = [lists.receiptPrinterIds, lists.paymentSlipPrinterIds];
    const defaults = [lists.receiptPrinterDefaultId, lists.paymentSlipPrinterDefaultId];
    if (opensDrawer) {
      listed.push(lists.cashDrawerPrinterIds);
      defaults.push(lists.cashDrawerPrinterDefaultId);
    }
    if (listed.every((ids) => ids.includes(printerId)) && defaults.every((id) => id !== null))
      continue;
    const append = (ids: string[]) => (ids.includes(printerId) ? ids : [...ids, printerId]);
    await setProfilePrinterLists(tx, profile.id, {
      receiptPrinterIds: append(lists.receiptPrinterIds),
      paymentSlipPrinterIds: append(lists.paymentSlipPrinterIds),
      cashDrawerPrinterIds: opensDrawer
        ? append(lists.cashDrawerPrinterIds)
        : lists.cashDrawerPrinterIds,
      receiptPrinterDefaultId: lists.receiptPrinterDefaultId ?? printerId,
      paymentSlipPrinterDefaultId: lists.paymentSlipPrinterDefaultId ?? printerId,
      cashDrawerPrinterDefaultId:
        lists.cashDrawerPrinterDefaultId ?? (opensDrawer ? printerId : null),
    });
  }
  const stations = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(eq(kitchenStations.locationId, locationId));
  for (const station of stations) {
    await tx
      .insert(stationPrinters)
      .values({ stationId: station.id, printerId })
      .onConflictDoNothing();
  }
}

export async function deliverDemoPrinterJobs(
  db: Database,
  locationId: string,
  identity: DemoPrinterIdentity,
): Promise<number> {
  const jobs = await withTransaction(db, (tx) =>
    claimInvoicePrintJobs(tx, identity.agentId, {
      locationId,
      visibleKeys: [DEMO_PRINTER_KEY],
      printerId: identity.printerId,
    }),
  );
  for (const job of jobs) {
    await withTransaction(db, (tx) =>
      reportInvoicePrintJob(tx, {
        agentId: identity.agentId,
        jobId: job.id,
        invoiceClaim: job.invoiceClaim,
        outcome: { status: "done" },
      }),
    );
  }
  return jobs.length;
}

export function startDemoPrinterLoop(
  db: Database,
  locationId: string,
  identity: DemoPrinterIdentity,
  intervalMs = 500,
  onError: (error: unknown) => void = () => {},
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  const tick = () => {
    inFlight = deliverDemoPrinterJobs(db, locationId, identity)
      .then(() => {})
      .catch(onError)
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
          timer.unref();
        }
      });
  };
  tick();
  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}
