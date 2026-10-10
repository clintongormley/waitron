import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  AppError,
  createLabelComparator,
  type DeleteImpact,
  type DeleteImpactItem,
  type DeleteTarget,
} from "@waitron/shared";
import {
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  invoiceDeliveries,
  kitchenStations,
  printerHolders,
  printers,
  printJobs,
  stationPrinters,
  type Transaction,
} from "@waitron/db";
import {
  endDeletedPrinterJobs,
  readPrinterDeleteJobIds,
  type PrintConfig,
} from "@waitron/printing";
import { readPrinterEquipment } from "@waitron/layouts";
import { endInvoicePrintDeliveries } from "./invoice-print.js";

const ROLES = [
  { role: "receipt", column: "receiptPrinterId" },
  { role: "payment_slip", column: "paymentSlipPrinterId" },
  { role: "cash_drawer", column: "cashDrawerPrinterId" },
] as const;

type Rules = { impact: DeleteImpact; jobIds: string[]; invoiceJobIds: string[] };

/** One item naming each distinct target once; its count is how many distinct rows it affects. */
function named(key: string, targets: DeleteTarget[]): DeleteImpactItem {
  const unique = [...new Map(targets.map((target) => [target.id, target])).values()];
  const compare = createLabelComparator();
  unique.sort((a, b) => compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { key, count: unique.length, targets: unique };
}

/** The impact read and the delete both call this, so the delete acts on exactly what it reports. */
async function printerDeleteRules(tx: Transaction, cfg: PrintConfig, id: string): Promise<Rules> {
  void cfg;
  const [printer] = await tx
    .select({ id: printers.id, name: printers.name, locationId: printers.locationId })
    .from(printers)
    .where(and(eq(printers.id, id), isNull(printers.deletedAt)));
  if (printer === undefined) throw new AppError("printer.not_found", { id });

  const jobIds = await readPrinterDeleteJobIds(tx, id);
  const deliveries = await tx
    .select({ printJobId: printJobs.id })
    .from(invoiceDeliveries)
    .innerJoin(printJobs, eq(printJobs.id, invoiceDeliveries.printJobId))
    .where(
      and(
        eq(printJobs.printerId, id),
        eq(invoiceDeliveries.medium, "receipt"),
        inArray(invoiceDeliveries.status, ["queued", "sending"]),
      ),
    );
  const invoiceJobIds = deliveries.map((row) => row.printJobId);
  const holders = await tx
    .select({ id: devices.id, name: devices.label })
    .from(printerHolders)
    .innerJoin(devices, eq(devices.id, printerHolders.deviceId))
    .where(eq(printerHolders.printerId, id));

  const choosing = await tx
    .select({
      id: devices.id,
      name: devices.label,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
    })
    .from(devices)
    .where(or(...ROLES.map(({ column }) => eq(devices[column], id))));
  const deviceChoices = ROLES.map(({ role, column }) =>
    named(
      `device_${role}`,
      choosing
        .filter((device) => device[column] === id)
        .map((device) => ({ id: device.id, name: device.name })),
    ),
  );

  const listed = await tx
    .select({
      id: deviceProfiles.id,
      name: deviceProfiles.name,
      role: deviceProfilePrinters.role,
      isDefault: deviceProfilePrinters.isDefault,
    })
    .from(deviceProfilePrinters)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceProfilePrinters.deviceProfileId))
    .where(eq(deviceProfilePrinters.printerId, id));
  const profileTargets = (role: string, defaultOnly: boolean): DeleteTarget[] =>
    listed
      .filter((row) => row.role === role && (!defaultOnly || row.isDefault))
      .map(({ id: profileId, name }) => ({ id: profileId, name }));

  // Devices whose profile defaults to the printer at its location, then the product's own resolver
  // decides which of them it serves: a portable printer serves only the device holding it.
  const candidates = await tx
    .selectDistinct({ id: devices.id, name: devices.label })
    .from(devices)
    .innerJoin(
      deviceProfilePrinters,
      and(
        eq(deviceProfilePrinters.deviceProfileId, devices.deviceProfileId),
        eq(deviceProfilePrinters.printerId, id),
        eq(deviceProfilePrinters.isDefault, true),
      ),
    )
    .where(eq(devices.locationId, printer.locationId));
  const equipment = await readPrinterEquipment(
    tx,
    candidates.map((device) => device.id),
    { lists: false },
  );
  const inheritingTargets = (role: string): DeleteTarget[] =>
    candidates.filter((device) =>
      equipment.roles
        .get(device.id)
        ?.some(
          (state) => state.role === role && state.chosenId === null && state.resolvedId === id,
        ),
    );

  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(stationPrinters)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinters.stationId))
    .where(eq(stationPrinters.printerId, id));

  const ends: DeleteImpactItem[] = [
    { key: "print_jobs", count: jobIds.length, targets: [] },
    { key: "invoice_receipts", count: deliveries.length, targets: [] },
    named("portable_holder", holders),
  ];
  const removes: DeleteImpactItem[] = [
    ...deviceChoices,
    ...ROLES.map(({ role }) => named(`profile_${role}`, profileTargets(role, false))),
    ...ROLES.map(({ role }) => named(`profile_${role}_default`, profileTargets(role, true))),
    ...ROLES.map(({ role }) => named(`device_${role}_default`, inheritingTargets(role))),
    named("station_printers", stations),
  ];
  return {
    impact: {
      target: { id: printer.id, name: printer.name },
      refusals: [],
      ends: ends.filter((item) => item.count > 0),
      removes: removes.filter((item) => item.count > 0),
    },
    jobIds,
    invoiceJobIds,
  };
}

/** What deleting the printer would end and remove now; `printer.not_found` once it is deleted. */
export async function readPrinterDeleteImpact(
  tx: Transaction,
  cfg: PrintConfig,
  id: string,
): Promise<DeleteImpact> {
  return (await printerDeleteRules(tx, cfg, id)).impact;
}

/**
 * Recomputes the impact on the caller's transaction and acts on it: ends the printer's live jobs and
 * receipts, clears and removes every setting naming it, releases its holder, and keeps the row,
 * switched off and marked deleted. Removing a default leaves the role with none.
 */
export async function deletePrinter(
  tx: Transaction,
  cfg: PrintConfig,
  id: string,
  now = new Date(),
): Promise<DeleteImpact> {
  const rules = await printerDeleteRules(tx, cfg, id);
  await endDeletedPrinterJobs(tx, id);
  await endInvoicePrintDeliveries(tx, rules.invoiceJobIds, now);
  for (const { column } of ROLES) {
    await tx
      .update(devices)
      .set({ [column]: null })
      .where(eq(devices[column], id));
  }
  await tx.delete(deviceProfilePrinters).where(eq(deviceProfilePrinters.printerId, id));
  await tx.delete(stationPrinters).where(eq(stationPrinters.printerId, id));
  await tx.delete(printerHolders).where(eq(printerHolders.printerId, id));
  await tx
    .update(printers)
    .set({ active: false, deletedAt: now.toISOString() })
    .where(and(eq(printers.id, id), isNull(printers.deletedAt)));
  return rules.impact;
}
