import "./errors.js";
import { and, asc, eq, sql } from "drizzle-orm";
import { invoiceDeliveries, pagePrinters, printAgents, type Transaction } from "@waitron/db";
import type { OfficePrinterReport } from "@waitron/print-agent";
import { AppError } from "@waitron/shared";
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

export async function listPagePrinters(
  tx: Transaction,
  locationId: string,
): Promise<PagePrinterRow[]> {
  const rows = await tx
    .select({ printer: pagePrinters, agentName: printAgents.name })
    .from(pagePrinters)
    .leftJoin(printAgents, eq(printAgents.id, pagePrinters.agentId))
    .where(eq(pagePrinters.locationId, locationId))
    .orderBy(asc(pagePrinters.name), asc(pagePrinters.id));
  return rows.map((row) => ({ ...row.printer, agentName: row.agentName }));
}

/**
 * Adds the printer a current discovery entry reports, or brings back the row already at that IPP
 * queue under its id: a disabled one is enabled, and an active one is re-pointed to the reporting
 * agent. Either way its capabilities are refreshed from the report; `name` is used only for a new row.
 */
export async function registerPagePrinter(
  tx: Transaction,
  locationId: string,
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
    .where(
      and(
        eq(printAgents.id, entry.agentId),
        eq(printAgents.locationId, locationId),
        eq(printAgents.active, true),
      ),
    );
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
        eq(pagePrinters.locationId, locationId),
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
      locationId,
      name: input.name,
      host: entry.host,
      port: report.port,
      resourcePath: report.resourcePath,
      ...capabilities,
    })
    .returning({ id: pagePrinters.id });
  return { id: created!.id, outcome: "created" };
}

function inLocation(locationId: string, id: string) {
  return and(eq(pagePrinters.id, id), eq(pagePrinters.locationId, locationId));
}

export async function renamePagePrinter(
  tx: Transaction,
  locationId: string,
  id: string,
  name: string,
): Promise<void> {
  const renamed = await tx
    .update(pagePrinters)
    .set({ name })
    .where(inLocation(locationId, id))
    .returning({ id: pagePrinters.id });
  if (renamed.length === 0) throw new AppError("page_printer.not_found", {});
}

/**
 * Ends this printer's A4 deliveries that have not finished: a waiting one fails, and one an agent is
 * sending becomes uncertain, its claim kept so a late report is still accepted. Enabling the
 * printer again sends none of them.
 */
export async function disablePagePrinter(
  tx: Transaction,
  locationId: string,
  id: string,
  now = new Date(),
): Promise<void> {
  const disabled = await tx
    .update(pagePrinters)
    .set({ active: false, invoiceDefault: false })
    .where(inLocation(locationId, id))
    .returning({ id: pagePrinters.id });
  if (disabled.length === 0) throw new AppError("page_printer.not_found", {});
  const ofThisPrinter = eq(invoiceDeliveries.pagePrinterId, id);
  await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "printer_disabled" })
    .where(and(ofThisPrinter, eq(invoiceDeliveries.status, "queued")));
  await tx
    .update(invoiceDeliveries)
    .set({ status: "unknown", failureCode: "printer_disabled", expiredAt: now.toISOString() })
    .where(and(ofThisPrinter, eq(invoiceDeliveries.status, "sending")));
}

/** `null` clears it. The old default is cleared first: the unique index allows one per location. */
export async function setInvoicePrinter(
  tx: Transaction,
  locationId: string,
  pagePrinterId: string | null,
): Promise<void> {
  if (pagePrinterId !== null) {
    const [target] = await tx
      .select({ id: pagePrinters.id })
      .from(pagePrinters)
      .where(and(inLocation(locationId, pagePrinterId), eq(pagePrinters.active, true)));
    if (target === undefined) throw new AppError("page_printer.not_found", {});
  }
  await tx
    .update(pagePrinters)
    .set({ invoiceDefault: false })
    .where(and(eq(pagePrinters.locationId, locationId), eq(pagePrinters.invoiceDefault, true)));
  if (pagePrinterId !== null) {
    await tx
      .update(pagePrinters)
      .set({ invoiceDefault: true })
      .where(eq(pagePrinters.id, pagePrinterId));
  }
}
