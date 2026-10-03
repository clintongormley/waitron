import { and, eq, isNull } from "drizzle-orm";
import {
  kitchenStations,
  printAgents,
  printers,
  stationPrinters,
  tills,
  withTransaction,
  type Database,
} from "@waitron/db";
import { claimPrintJobs, reportPrintJob } from "@waitron/printing";

export const DEMO_PRINTER_KEY = "WAITRON-DEMO-PRINTER";

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
      if (existing !== undefined)
        await tx.update(printers).set({ active: false }).where(eq(printers.id, existing.id));
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
      .where(and(eq(printAgents.locationId, locationId), eq(printAgents.name, "Demo printer")));
    const agentId =
      agent?.id ??
      (
        await tx
          .insert(printAgents)
          .values({ locationId, name: "Demo printer", tokenHash: "disabled", active: false })
          .returning({ id: printAgents.id })
      )[0]!.id;

    await tx
      .update(tills)
      .set({ receiptPrinterId: printerId })
      .where(and(eq(tills.locationId, locationId), isNull(tills.receiptPrinterId)));
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
    return { printerId, agentId };
  });
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
