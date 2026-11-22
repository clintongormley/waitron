import "./errors.js";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  devices,
  invoiceDeliveries,
  isA4Printer,
  printers,
  printAgents,
  type Transaction,
} from "@waitron/db";
import { clearDeletedPagePrinter, readProfilesListingPrinter } from "@waitron/layouts";
import type { OfficePrinterReport } from "@waitron/print-agent";
import { AppError, type DeleteImpact } from "@waitron/shared";
import { named } from "./delete-impact.js";
import { isListed } from "./discovery-listing.js";
import { endA4PrintJobs } from "./invoice-delivery.js";

/** One agent's discovery report of a device, as the server holds it. */
export interface PagePrinterDiscovery {
  agentId: string;
  host: string;
  office?: OfficePrinterReport;
  /** Steady time of the agent's latest report of the device. */
  reportedAt: number;
}

/** The current steady time and the discovery window's steady deadline. */
export interface DiscoveryWindow {
  now: number;
  discoveryEnd: number;
}

export const pagePrinterColumns = {
  id: printers.id,
  name: printers.name,
  host: printers.host,
  port: printers.port,
  resourcePath: printers.resourcePath,
  documentFormat: printers.documentFormat,
  supportedFormats: printers.supportedFormats,
  media: printers.media,
  resolutionDpi: printers.resolutionDpi,
  active: printers.active,
  agentId: printers.agentId,
};

type Printer = Pick<typeof printers.$inferSelect, keyof typeof pagePrinterColumns>;
// printers_kind_fields_ck requires these fields on every row selected as A4.
export type PagePrinter = {
  [Key in Exclude<keyof Printer, "agentId">]: NonNullable<Printer[Key]>;
} & Pick<Printer, "agentId">;

export type PagePrinterRow = PagePrinter & { agentName: string | null };

export async function listPagePrinters(tx: Transaction): Promise<PagePrinterRow[]> {
  const rows = await tx
    .select({ ...pagePrinterColumns, agentName: printAgents.name })
    .from(printers)
    .leftJoin(printAgents, eq(printAgents.id, printers.agentId))
    .where(and(isA4Printer(), eq(printers.active, true)))
    .orderBy(asc(printers.name), asc(printers.id));
  return rows as PagePrinterRow[];
}

export async function registerPagePrinter(
  tx: Transaction,
  input: { name: string; entry: PagePrinterDiscovery | undefined },
  window: DiscoveryWindow,
): Promise<{ id: string; outcome: "created" | "enabled" | "repointed" }> {
  const { entry } = input;
  if (entry === undefined || !isListed(entry.reportedAt, window.now, window.discoveryEnd)) {
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
    .select({ id: printers.id, active: printers.active })
    .from(printers)
    .where(
      and(
        isA4Printer(),
        sql`lower(${printers.host}) = lower(${entry.host})`,
        eq(printers.port, report.port),
        eq(printers.resourcePath, report.resourcePath),
      ),
    );
  if (existing !== undefined) {
    await tx
      .update(printers)
      .set({ ...capabilities, active: true })
      .where(eq(printers.id, existing.id));
    return { id: existing.id, outcome: existing.active ? "repointed" : "enabled" };
  }
  const [created] = await tx
    .insert(printers)
    .values({
      kind: "a4",
      transport: "ipp",
      paperWidth: null,
      resolution: null,
      picksUpReceipts: false,
      picksUpPaymentSlips: false,
      name: input.name,
      host: entry.host,
      port: report.port,
      resourcePath: report.resourcePath,
      ...capabilities,
    })
    .returning({ id: printers.id });
  return { id: created!.id, outcome: "created" };
}

export async function renamePagePrinter(tx: Transaction, id: string, name: string): Promise<void> {
  const renamed = await tx
    .update(printers)
    .set({ name })
    .where(and(isA4Printer(), eq(printers.id, id)))
    .returning({ id: printers.id });
  if (renamed.length === 0) throw new AppError("page_printer.not_found", {});
}

export async function readPagePrinterDeleteImpact(
  tx: Transaction,
  id: string,
): Promise<DeleteImpact> {
  const [printer] = await tx
    .select({ id: printers.id, name: printers.name })
    .from(printers)
    .where(and(isA4Printer(), eq(printers.id, id), eq(printers.active, true)));
  if (printer === undefined) throw new AppError("page_printer.not_found", {});
  const deliveries = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.printerId, id),
        sql`${invoiceDeliveries.status} in ('queued', 'sending')`,
      ),
    );
  const choosing = await tx
    .select({ id: devices.id, name: devices.label })
    .from(devices)
    .where(eq(devices.invoicePrinterId, id));
  const profiles = (await readProfilesListingPrinter(tx, id))
    .filter(({ lists }) => lists.invoice?.ids.includes(id))
    .map(({ id: profileId, name, lists }) => ({
      id: profileId,
      name,
      isDefault: lists.invoice?.defaultId === id,
    }));
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
  await clearDeletedPagePrinter(tx, id);
  await tx
    .update(printers)
    .set({ active: false })
    .where(and(isA4Printer(), eq(printers.id, id)));
  const ofThisPrinter = eq(invoiceDeliveries.printerId, id);
  const queued = await tx
    .update(invoiceDeliveries)
    .set({ status: "failed", failureCode: "printer_disabled" })
    .where(and(ofThisPrinter, eq(invoiceDeliveries.status, "queued")))
    .returning({ printJobId: invoiceDeliveries.printJobId });
  const sending = await tx
    .update(invoiceDeliveries)
    .set({ status: "unknown", failureCode: "printer_disabled", expiredAt: now.toISOString() })
    .where(and(ofThisPrinter, eq(invoiceDeliveries.status, "sending")))
    .returning({ printJobId: invoiceDeliveries.printJobId });
  await endA4PrintJobs(tx, [...queued, ...sending], "printer_disabled");
  return impact;
}
