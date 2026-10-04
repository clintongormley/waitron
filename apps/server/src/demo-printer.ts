import { and, eq, isNull } from "drizzle-orm";
import {
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  kitchenStations,
  printAgents,
  printers,
  stationPrinters,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { readProfilePrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import { claimPrintJobs, reportPrintJob } from "@waitron/printing";

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
      .where(and(eq(printers.locationId, locationId), eq(printers.localKey, DEMO_PRINTER_KEY)));
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

/** Takes the printer off every profile list; `setProfilePrinterLists` moves the devices on it. */
async function unlistDemoPrinter(tx: Transaction, printerId: string): Promise<void> {
  const listing = await tx
    .selectDistinct({ id: deviceProfilePrinters.deviceProfileId })
    .from(deviceProfilePrinters)
    .where(eq(deviceProfilePrinters.printerId, printerId));
  for (const { id: profileId } of listing) {
    const lists = await readProfilePrinterLists(tx, profileId);
    const without = (ids: string[]) => ids.filter((id) => id !== printerId);
    await setProfilePrinterLists(tx, profileId, {
      receiptPrinterIds: without(lists.receiptPrinterIds),
      paymentSlipPrinterIds: without(lists.paymentSlipPrinterIds),
    });
  }
}

/**
 * Lists the printer last on every profile's receipt and payment slip lists, puts each active device
 * at the location on it for whichever of the two kinds it has no printer for, and gives it to every
 * preparation station there. A printer a device already holds stays. Safe to repeat.
 */
export async function routeToDemoPrinter(
  tx: Transaction,
  locationId: string,
  printerId: string,
): Promise<void> {
  const profiles = await tx.select({ id: deviceProfiles.id }).from(deviceProfiles);
  for (const profile of profiles) {
    const lists = await readProfilePrinterLists(tx, profile.id);
    if (
      lists.receiptPrinterIds.includes(printerId) &&
      lists.paymentSlipPrinterIds.includes(printerId)
    )
      continue;
    const append = (ids: string[]) => (ids.includes(printerId) ? ids : [...ids, printerId]);
    await setProfilePrinterLists(tx, profile.id, {
      receiptPrinterIds: append(lists.receiptPrinterIds),
      paymentSlipPrinterIds: append(lists.paymentSlipPrinterIds),
    });
  }
  const atLocation = and(eq(devices.locationId, locationId), eq(devices.active, true));
  await tx
    .update(devices)
    .set({ receiptPrinterId: printerId })
    .where(and(atLocation, isNull(devices.receiptPrinterId)));
  await tx
    .update(devices)
    .set({ paymentSlipPrinterId: printerId })
    .where(and(atLocation, isNull(devices.paymentSlipPrinterId)));
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
    claimPrintJobs(tx, identity.agentId, {
      locationId,
      visibleKeys: [DEMO_PRINTER_KEY],
      printerId: identity.printerId,
    }),
  );
  for (const job of jobs) {
    await withTransaction(db, (tx) =>
      reportPrintJob(tx, {
        agentId: identity.agentId,
        jobId: job.id,
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
