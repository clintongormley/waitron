import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, label, newId, table } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * How a printer is reached. `local_key` is the USB serial or the Bluetooth MAC; `cloud_poll` is a
 * printer whose firmware dials out and polls for jobs.
 */
export const printTransport = enumType(["usb", "network_tcp", "bluetooth", "cloud_poll"]);

/** What a printer prints: `station`, one ticket per kitchen station; `order`, one per whole order. */
export const printTicketScope = enumType(["station", "order"]);

/** The paper roll's width: 30 columns of text on 58mm, 42 on 80mm. */
export const printPaperWidth = enumType(["58mm", "80mm"]);
/** The print head's dot density; it sets the QR dot size for the legal 30-40 mm. */
export const printResolution = enumType(["180dpi", "203dpi"]);
/** The character table the printer is switched to, so accents and the euro sign print correctly. */
export const printCharacterSet = enumType(["wpc1252", "pc858", "plain"]);

/**
 * A managed printer. Config lives centrally; printing runs on whichever `print_agents` agent can see
 * the device. No agent binding is stored, so the connection columns describe the device, and
 * `printers_transport_fields_ck` says which one each transport must carry.
 */
export const printers = table(
  "printers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    name: label("name").notNull(),
    transport: printTransport("transport").notNull(),
    // The stable device id an agent matches at run time.
    localKey: label("local_key"),
    host: label("host"),
    port: count("port").default(9100),
    pollId: label("poll_id"),
    pollTokenHash: label("poll_token_hash"),
    ticketScope: printTicketScope("ticket_scope").notNull().default("station"),
    // Defaults match the TM-T88III: 80mm, 180 dpi, character table 16 (WPC1252).
    paperWidth: printPaperWidth("paper_width").notNull().default("80mm"),
    resolution: printResolution("resolution").notNull().default("180dpi"),
    characterSet: printCharacterSet("character_set").notNull().default("wpc1252"),
    // `ESC t n` is model/firmware-specific even when the byte-to-glyph encoding is the same.
    characterTable: count("character_table").notNull().default(16),
    hasCashDrawer: flag("has_cash_drawer").notNull().default(false),
    // Deactivate via active := false, never a hard delete (print_jobs reference it).
    active: flag("active").notNull().default(true),
  },
  (t) => [
    // One registered printer per physical USB/BT device per venue.
    uniqueIndex("printers_local_key_key")
      .on(t.locationId, t.localKey)
      .where(sql`${t.localKey} is not null`),
    check("printers_transport_ck", enumCheck(t.transport)),
    check("printers_ticket_scope_ck", enumCheck(t.ticketScope)),
    check("printers_paper_width_ck", enumCheck(t.paperWidth)),
    check("printers_resolution_ck", enumCheck(t.resolution)),
    check("printers_character_set_ck", enumCheck(t.characterSet)),
    check("printers_character_table_ck", sql`${t.characterTable} between 0 and 255`),
    check(
      "printers_transport_fields_ck",
      sql`(${t.transport} = 'usb' and ${t.localKey} is not null)
          or (${t.transport} = 'bluetooth' and ${t.localKey} is not null)
          or (${t.transport} = 'network_tcp' and ${t.host} is not null)
          or (${t.transport} = 'cloud_poll' and ${t.pollId} is not null)`,
    ),
  ],
);
