import "./errors.js";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  invoiceDeliveries,
  pagePrinters,
  printAgents,
  type Transaction,
} from "@waitron/db";
import type { OfficePrinterReport } from "@waitron/print-agent";
import { AppError, type DeleteImpact } from "@waitron/shared";
import { named } from "./delete-impact.js";
import { isListed } from "./discovery-listing.js";

/** One agent's discovery report of a device, as the server holds it. */
export interface PagePrinterDiscovery {
  agentId: string;
  host: string;
  office?: OfficePrinterReport;
  /** Epoch ms of the agent's latest report of the device. */
  lastSeenAt: number;
}

/** When the caller asks, and until when (epoch ms, 0 when closed) a discovery window is open. */
export interface DiscoveryWindow {
  now: number;
  discoveryUntil: number;
}

export type PagePrinterRow = typeof pagePrinters.$inferSelect & { agentName: string | null };

export async function listPagePrinters(tx: Transaction): Promise<PagePrinterRow[]> {
  const rows = await tx
    .select({ printer: pagePrinters, agentName: printAgents.name })
    .from(pagePrinters)
    .leftJoin(printAgents, eq(printAgents.id, pagePrinters.agentId))
    .where(eq(pagePrinters.active, true))
    .orderBy(asc(pagePrinters.name), asc(pagePrinters.id));
  return rows.map((row) => ({ ...row.printer, agentName: row.agentName }));
}

export async function registerPagePrinter(
  tx: Transaction,
  input: { name: string; entry: PagePrinterDiscovery | undefined },
  window: DiscoveryWindow,
): Promise<{ id: string; outcome: "created" | "enabled" | "repointed" }> {
  const { entry } = input;
  if (entry === undefined || !isListed(entry.lastSeenAt, window.now, window.discoveryUntil)) {
    throw new AppError("page_printer.not_found", {});
  }
  // Revoking an agent leaves its discovery entries listed until they age out.
  const [agent] = await tx
    .select({ id: printAgents.id })
    .from(printAgents)
    .where(and(eq(printAgents.id, entry.agentId), eq(printAgents.active, true)));
  if (agent === undefined) throw new AppError("page_printer.not_found", {});
  const report = entry.office;
  if (report?.printable !== true) throw new AppError("page_printer.not_printable", {});
  const capabilities = {
    documentFormat: report.documentFormat,
    supportedFormats: report.supportedFormats,
    media: report.media,
    resolutionDpi: report.resolutionDpi,
    agentId: entry.agentId,
  };
  const [existing] = await tx
    .select({ id: pagePrinters.id, active: pagePrinters.active })
    .from(pagePrinters)
    .where(
      and(
        sql`lower(${pagePrinters.host}) = lower(${entry.host})`,
        eq(pagePrinters.port, report.port),
        eq(pagePrinters.resourcePath, report.resourcePath),
      ),
    );
  if (existing !== undefined) {
    await tx
      .update(pagePrinters)
      .set({ ...capabilities, active: true })
      .where(eq(pagePrinters.id, existing.id));
    return { id: existing.id, outcome: existing.active ? "repointed" : "enabled" };
  }
  const [created] = await tx
    .insert(pagePrinters)
    .values({
      name: input.name,
      host: entry.host,
      port: report.port,
      resourcePath: report.resourcePath,
      ...capabilities,
    })
    .returning({ id: pagePrinters.id });
  return { id: created!.id, outcome: "created" };
}

export async function renamePagePrinter(tx: Transaction, id: string, name: string): Promise<void> {
  const renamed = await tx
    .update(pagePrinters)
    .set({ name })
    .where(eq(pagePrinters.id, id))
    .returning({ id: pagePrinters.id });
  if (renamed.length === 0) throw new AppError("page_printer.not_found", {});
}

export async function readPagePrinterDeleteImpact(
  tx: Transaction,
  id: string,
): Promise<DeleteImpact> {
  const [printer] = await tx
    .select({ id: pagePrinters.id, name: pagePrinters.name })
    .from(pagePrinters)
    .where(and(eq(pagePrinters.id, id), eq(pagePrinters.active, true)));
  if (printer === undefined) throw new AppError("page_printer.not_found", {});
  const deliveries = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.pagePrinterId, id),
        sql`${invoiceDeliveries.status} in ('queued', 'sending')`,
      ),
    );
  const choosing = await tx
    .select({ id: devices.id, name: devices.label })
    .from(devices)
    .where(eq(devices.invoicePagePrinterId, id));
  const profiles = await tx
    .select({
      id: deviceProfiles.id,
      name: deviceProfiles.name,
      isDefault: deviceProfilePrinters.isDefault,
    })
    .from(deviceProfilePrinters)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceProfilePrinters.deviceProfileId))
    .where(eq(deviceProfilePrinters.pagePrinterId, id));
  const removes = [
    named("device_invoice", choosing),
    named("profile_invoice", profiles),
    named(
      "profile_invoice_default",
      profiles.filter((row) => row.isDefault),
    ),
  ];
  return {
    target: printer,
    refusals: [],
    ends:
      deliveries.length === 0 ? [] : [{ key: "invoice_a4", count: deliveries.length, targets: [] }],
    removes: removes.filter((item) => item.count > 0),
  };
}

export async function deletePagePrinter(
  tx: Transaction,
  id: string,
  now = new Date(),
): Promise<DeleteImpact> {
  const impact = await readPagePrinterDeleteImpact(tx, id);
  await tx
    .update(devices)
    .set({ invoicePagePrinterId: null })
    .where(eq(devices.invoicePagePrinterId, id));
  await tx.delete(deviceProfilePrinters).where(eq(deviceProfilePrinters.pagePrinterId, id));
  await tx.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, id));
  const ofThisPrinter = eq(invoiceDeliveries.pagePrinterId, id);
  await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "printer_disabled" })
    .where(and(ofThisPrinter, eq(invoiceDeliveries.status, "queued")));
  await tx
    .update(invoiceDeliveries)
    .set({ status: "unknown", failureCode: "printer_disabled", expiredAt: now.toISOString() })
    .where(and(ofThisPrinter, eq(invoiceDeliveries.status, "sending")));
  return impact;
}
