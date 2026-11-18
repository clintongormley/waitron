import { eq, sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, label, newId, table, tsString } from "./columns.js";
import { devices } from "./devices.js";

/**
 * How a printer is reached. `local_key` is the USB serial or the Bluetooth MAC; `cloud_poll` is a
 * printer whose firmware dials out and polls for jobs.
 */
export const printTransport = enumType(["usb", "network_tcp", "bluetooth", "cloud_poll"]);

export const printerKind = enumType(["receipt", "a4"]);

/** The paper roll's width: 30 columns of text on 58mm, 42 on 80mm. */
export const printPaperWidth = enumType(["58mm", "80mm"]);
/** The print head's dot density; it sets the QR dot size for the legal 30-40 mm. */
export const printResolution = enumType(["180dpi", "203dpi"]);

/**
 * A managed printer. Config lives centrally; printing runs on whichever `print_agents` agent can see
 * the device. No agent binding is stored, so the connection columns describe the device, and
 * `printers_transport_fields_ck` says which one each transport must carry.
 */
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
    paperWidth: printPaperWidth("paper_width").notNull().default("80mm"),
    resolution: printResolution("resolution").notNull().default("180dpi"),
    hasCashDrawer: flag("has_cash_drawer").notNull().default(false),
    portable: flag("portable").notNull().default(false),
    heldByDeviceId: id("held_by_device_id").references((): AnySQLiteColumn => devices.id),
    heldAt: tsString("held_at"),
    picksUpReceipts: flag("picks_up_receipts").notNull().default(true),
    picksUpPaymentSlips: flag("picks_up_payment_slips").notNull().default(true),
    // System switch-offs clear `active`; Delete also sets `deleted_at`; jobs keep the row.
    active: flag("active").notNull().default(true),
    deletedAt: tsString("deleted_at"),
  },
  (t) => [
    // One undeleted printer per physical USB/BT device per venue; a deleted row frees its key.
    uniqueIndex("printers_local_key_key")
      .on(t.localKey)
      .where(sql`${t.localKey} is not null and ${t.deletedAt} is null`),
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
          or (${t.transport} = 'cloud_poll' and ${t.pollId} is not null)`,
    ),
  ],
);

export const isReceiptPrinter = (): SQL => eq(printers.kind, "receipt");
