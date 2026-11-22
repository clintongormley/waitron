import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  AppError,
  type PrinterDeleteImpact,
  type DeleteImpactItem,
  type DeleteTarget,
} from "@waitron/shared";
import {
  deviceNotDeleted,
  deviceProfiles,
  devices,
  drawerNeedsClose,
  invoiceDeliveries,
  kitchenStations,
  isReceiptPrinter,
  printers,
  printJobs,
  stationPrinterPairs,
  removeIdFromJson,
  type Transaction,
} from "@waitron/db";
import { endDeletedPrinterJobs, readPrinterDeleteJobIds } from "@waitron/printing";
import {
  PRINTER_ROLE_COLUMNS,
  clearDeletedPrinter,
  profileAllows,
  readPrinterEquipment,
  readProfilesListingPrinter,
  type ProfilePrinterRole,
} from "@waitron/layouts";
import { named } from "./delete-impact.js";
import { endInvoicePrintDeliveries } from "./invoice-print.js";

type Rules = { impact: PrinterDeleteImpact; jobIds: string[]; invoiceJobIds: string[] };

/** The impact read and the delete both call this, so the delete acts on exactly what it reports. */
async function printerDeleteRules(tx: Transaction, id: string): Promise<Rules> {
  const [printer] = await tx
    .select({ id: printers.id, name: printers.name, hasCashDrawer: printers.hasCashDrawer })
    .from(printers)
    .where(and(isReceiptPrinter(), eq(printers.id, id), isNull(printers.deletedAt)));
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
    .from(printers)
    .innerJoin(devices, eq(devices.id, printers.heldByDeviceId))
    .where(and(isReceiptPrinter(), eq(printers.id, id)));

  const choosing = await tx
    .select({
      id: devices.id,
      name: devices.label,
      active: devices.active,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
      invoicePrinterId: devices.invoicePrinterId,
    })
    .from(devices)
    .where(or(...PRINTER_ROLE_COLUMNS.map(({ column }) => eq(devices[column], id))));
  const deviceChoices = PRINTER_ROLE_COLUMNS.map(({ role, column }) =>
    named(
      `device_${role}`,
      choosing
        .filter((device) => device[column] === id)
        .map((device) => ({
          id: device.id,
          name: device.name,
          ...(device.active ? {} : { deleted: true }),
        })),
    ),
  );

  const listed = await readProfilesListingPrinter(tx, id);
  const profileTargets = (role: ProfilePrinterRole, defaultOnly: boolean): DeleteTarget[] =>
    listed
      .filter(({ lists }) =>
        defaultOnly ? lists[role]?.defaultId === id : lists[role]?.ids.includes(id),
      )
      .map(({ id: profileId, name }) => ({ id: profileId, name }));

  // The resolver determines which devices the default actually serves.
  const defaults = listed
    .filter(({ lists }) => PRINTER_ROLE_COLUMNS.some(({ role }) => lists[role]?.defaultId === id))
    .map((profile) => profile.id);
  const needsClose = await drawerNeedsClose(tx, id);
  const candidates = await tx
    .select({
      id: devices.id,
      name: devices.label,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(devices.deviceProfileId, deviceProfiles.id))
    .where(
      and(
        or(
          inArray(devices.deviceProfileId, defaults),
          needsClose ? eq(devices.cashDrawerPrinterId, id) : undefined,
        ),
        eq(devices.active, true),
        deviceNotDeleted(),
      ),
    );
  const equipment = await readPrinterEquipment(
    tx,
    candidates.map((device) => device.id),
    { lists: false },
  );
  const inheritingTargets = (role: string): DeleteTarget[] =>
    candidates
      .filter((device) =>
        equipment.roles
          .get(device.id)
          ?.some(
            (state) => state.role === role && state.chosenId === null && state.resolvedId === id,
          ),
      )
      .map(({ id: deviceId, name }) => ({ id: deviceId, name }));
  const closeDevices =
    needsClose && printer.hasCashDrawer
      ? candidates
          .filter(
            (device) =>
              profileAllows(
                { ...device, capabilities: device.capabilities as string[] },
                "open-cash-drawer",
              ) &&
              equipment.roles
                .get(device.id)
                ?.some((state) => state.role === "cash_drawer" && state.resolvedId === id),
          )
          .map(({ id: deviceId, name }) => ({ id: deviceId, name }))
      : [];

  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(stationPrinterPairs)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinterPairs.stationId))
    .where(eq(stationPrinterPairs.printerId, id));

  const ends: DeleteImpactItem[] = [
    { key: "print_jobs", count: jobIds.length, targets: [] },
    { key: "invoice_receipts", count: deliveries.length, targets: [] },
    named("portable_holder", holders),
  ];
  const removes: DeleteImpactItem[] = [
    ...deviceChoices,
    ...PRINTER_ROLE_COLUMNS.map(({ role }) =>
      named(`profile_${role}`, profileTargets(role, false)),
    ),
    ...PRINTER_ROLE_COLUMNS.map(({ role }) =>
      named(`profile_${role}_default`, profileTargets(role, true)),
    ),
    ...PRINTER_ROLE_COLUMNS.map(({ role }) =>
      named(`device_${role}_default`, inheritingTargets(role)),
    ),
    named("station_printers", stations),
  ];
  return {
    impact: {
      target: { id: printer.id, name: printer.name },
      refusals: [],
      ...(needsClose
        ? {
            drawerClose: {
              devices: closeDevices,
              ...(printer.hasCashDrawer ? {} : { needsDrawerSetting: true as const }),
            },
          }
        : {}),
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
  id: string,
): Promise<PrinterDeleteImpact> {
  return (await printerDeleteRules(tx, id)).impact;
}

/**
 * Recomputes the impact on the caller's transaction and acts on it: ends the printer's live jobs and
 * receipts, clears and removes every setting naming it, releases its holder, and keeps the row,
 * switched off and marked deleted. Removing a default leaves the role with none.
 */
export async function deletePrinter(
  tx: Transaction,
  id: string,
  now = new Date(),
): Promise<PrinterDeleteImpact> {
  const rules = await printerDeleteRules(tx, id);
  await endDeletedPrinterJobs(tx, id);
  await endInvoicePrintDeliveries(tx, rules.invoiceJobIds, now);
  await clearDeletedPrinter(tx, id);
  await removeIdFromJson(tx, kitchenStations.printerIds, id);
  await tx
    .update(printers)
    .set({ active: false, deletedAt: now.toISOString() })
    .where(and(isReceiptPrinter(), eq(printers.id, id), isNull(printers.deletedAt)));
  return rules.impact;
}
