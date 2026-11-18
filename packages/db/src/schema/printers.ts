import { eq, sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  newId,
  table,
  tsString,
} from "./columns.js";
import { devices } from "./devices.js";
import { printAgents } from "./print-agents.js";

/**
 * How a printer is reached. `local_key` is the USB serial or the Bluetooth MAC; `cloud_poll` is a
 * printer whose firmware dials out and polls for jobs.
 */
export const receiptPrintTransport = enumType(["usb", "network_tcp", "bluetooth", "cloud_poll"]);
export const printTransport = enumType([...receiptPrintTransport.enumValues, "ipp"]);

export const printerDocumentFormat = enumType(["application/pdf", "image/pwg-raster", "image/urf"]);
export const printerMedia = enumType(["iso_a4_210x297mm", "na_letter_8.5x11in"]);

export const printerKind = enumType(["receipt", "a4"]);

/** The paper roll's width: 30 columns of text on 58mm, 42 on 80mm. */
export const printPaperWidth = enumType(["58mm", "80mm"]);
/** The print head's dot density; it sets the QR dot size for the legal 30-40 mm. */
export const printResolution = enumType(["180dpi", "203dpi"]);

export const printers = table(
  "printers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    kind: printerKind("kind").notNull().default("receipt"),
    name: label("name").notNull(),
    transport: printTransport("transport").notNull(),
    // The stable device id an agent matches at run time.
    localKey: label("local_key"),
    host: label("host"),
    port: count("port").default(9100),
    pollId: label("poll_id"),
    pollTokenHash: label("poll_token_hash"),
    // Defaults match the TM-T88III: 80mm, 180 dpi.
    paperWidth: printPaperWidth("paper_width").default("80mm"),
    resolution: printResolution("resolution").default("180dpi"),
    hasCashDrawer: flag("has_cash_drawer").notNull().default(false),
    portable: flag("portable").notNull().default(false),
    heldByDeviceId: id("held_by_device_id").references((): AnySQLiteColumn => devices.id),
    heldAt: tsString("held_at"),
    picksUpReceipts: flag("picks_up_receipts").notNull().default(true),
    picksUpPaymentSlips: flag("picks_up_payment_slips").notNull().default(true),
    resourcePath: label("resource_path"),
    documentFormat: printerDocumentFormat("document_format"),
    supportedFormats: json<string[]>("supported_formats"),
    media: printerMedia("media"),
    resolutionDpi: count("resolution_dpi"),
    agentId: id("agent_id").references(() => printAgents.id),
    // Receipt Delete records a timestamp so discovery can pick the latest matching row.
    active: flag("active").notNull().default(true),
    deletedAt: tsString("deleted_at"),
  },
  (t) => [
    // One undeleted printer per physical USB/BT device per venue; a deleted row frees its key.
    uniqueIndex("printers_local_key_key")
      .on(t.localKey)
      .where(sql`${t.localKey} is not null and ${t.deletedAt} is null`),
    uniqueIndex("printers_endpoint_uq")
      .on(t.host, t.port, t.resourcePath)
      .where(sql`${t.kind} = 'a4'`),
    check("printers_kind_ck", enumCheck(t.kind)),
    check("printers_transport_ck", enumCheck(t.transport)),
    check("printers_paper_width_ck", enumCheck(t.paperWidth)),
    check("printers_resolution_ck", enumCheck(t.resolution)),
    check("printers_held_pair_ck", sql`(${t.heldByDeviceId} is null) = (${t.heldAt} is null)`),
    check("printers_held_portable_ck", sql`${t.heldByDeviceId} is null or ${t.portable} = 1`),
    check("printers_deleted_ck", sql`${t.deletedAt} is null or ${t.active} = 0`),
    check(
      "printers_transport_fields_ck",
      sql`(${t.transport} = 'usb' and ${t.localKey} is not null)
          or (${t.transport} = 'bluetooth' and ${t.localKey} is not null)
          or (${t.transport} = 'network_tcp' and ${t.host} is not null)
          or (${t.transport} = 'cloud_poll' and ${t.pollId} is not null)
          or (${t.transport} = 'ipp' and ${t.host} is not null)`,
    ),
    check(
      "printers_kind_fields_ck",
      sql`(${t.kind} = 'receipt' and ${t.transport} <> 'ipp'
           and ${t.paperWidth} is not null and ${t.resolution} is not null
           and ${t.resourcePath} is null and ${t.documentFormat} is null
           and ${t.supportedFormats} is null and ${t.media} is null
           and ${t.resolutionDpi} is null and ${t.agentId} is null)
          or (${t.kind} = 'a4' and ${t.transport} = 'ipp' and ${t.host} is not null
              and ${t.port} is not null and ${t.resourcePath} is not null
              and ${t.documentFormat} is not null and ${t.supportedFormats} is not null
              and ${t.media} is not null and ${t.resolutionDpi} is not null
              and ${t.paperWidth} is null and ${t.resolution} is null
              and ${t.hasCashDrawer} = 0 and ${t.portable} = 0
              and ${t.picksUpReceipts} = 0 and ${t.picksUpPaymentSlips} = 0
              and ${t.localKey} is null and ${t.pollId} is null and ${t.pollTokenHash} is null
              and ${t.heldByDeviceId} is null and ${t.deletedAt} is null)`,
    ),
    check("printers_document_format_ck", enumCheck(t.documentFormat)),
    check("printers_media_ck", enumCheck(t.media)),
    check("printers_port_ck", sql`${t.kind} <> 'a4' or ${t.port} between 1 and 65535`),
    check("printers_resolution_dpi_ck", sql`${t.resolutionDpi} is null or ${t.resolutionDpi} > 0`),
  ],
);

export const isReceiptPrinter = (): SQL => eq(printers.kind, "receipt");
