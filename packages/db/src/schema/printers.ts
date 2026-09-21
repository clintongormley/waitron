import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, label, newId, table } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * How a printer is reached (printing subsystem, §0/§2b). `usb` and `bluetooth` are LOCAL transports
 * keyed on a stable device id (`local_key`: the USB serial, the Bluetooth MAC); `network_tcp`
 * (ESC/POS over TCP:9100) is keyed on `host`. Any agent serving the venue drives whichever devices it
 * can currently see — the binding is discovered at run time, not stored. `cloud_poll` (Star CloudPRNT
 * / Epson Server Direct Print — the printer firmware dials out and polls for jobs) is carried in the
 * vocabulary FROM DAY ONE, its adapter a fast-follow (§3e): an additive value already present is a
 * config choice later, not a destructive migration. One `enumType` declaration, matching
 * `order_flow`'s precedent: the values are written once here and reach the database as this table's
 * `printers_transport_ck`.
 */
export const printTransport = enumType(["usb", "network_tcp", "bluetooth", "cloud_poll"]);

/**
 * What a printer prints, for the KDS station→printer routing Slice B consumes (§2b). `station`
 * (default): one ticket per kitchen station. `order`: one ticket per whole order. Carried now, read
 * by Slice B — one `enumType` declaration matching the `bump_mode`/`fire_control_mode` precedent.
 */
export const printTicketScope = enumType(["station", "order"]);

/** The paper roll's width: 30 columns of text on 58mm, 42 on 80mm (design 2026-09-14). */
export const printPaperWidth = enumType(["58mm", "80mm"]);
/** The print head's dot density; it sets the QR dot size for the legal 30-40 mm. */
export const printResolution = enumType(["180dpi", "203dpi"]);
/** The character table the printer is switched to, so accents and the euro sign print correctly. */
export const printCharacterSet = enumType(["wpc1252", "pc858", "plain"]);

/**
 * A managed PRINTER (§2b) — central config, distributed execution. All config lives centrally (the one
 * Impresoras dashboard); the actual printing runs on the local `print_agents` agent that serves it.
 * Location scoped (a `location_id` FK, `onDelete restrict`, the
 * `devices` shape).
 *
 * No stored agent binding: which agent serves a printer is discovered at run time from the devices an
 * agent can see, so the connection columns describe the DEVICE, not an agent. They are transport-
 * specific and all NULLABLE at the column level; which ones must be present is enforced by the
 * `printers_transport_fields_ck` CHECK hand-written in the paired --custom migration (usb/bluetooth
 * need local_key; network_tcp needs host; cloud_poll needs poll_id). The partial UNIQUE
 * `printers_local_key_key` on (location_id, local_key) WHERE local_key IS NOT NULL — one
 * registered printer per physical USB/BT device per venue — is likewise hand-written there, as is
 * `print_jobs_printer_fk`, which targets this table's primary key.
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
    // The human label ("Impresora Cocina"), shown in the Impresoras management surface.
    name: label("name").notNull(),
    transport: printTransport("transport").notNull(),
    // usb: the device serial; bluetooth: the MAC. The stable device id an agent matches to bind at run
    // time. NULL for network_tcp/cloud_poll. Unique per location when set (partial index).
    localKey: label("local_key"),
    // network_tcp: the printer's local IP/host.
    host: label("host"),
    // network_tcp: the ESC/POS port. DEFAULT 9100 (the deli-hardware ReceiptPrinter port); nullable so
    // a usb/bluetooth/cloud_poll printer need not carry it.
    port: count("port").default(9100),
    // cloud_poll: the printer's poll identifier (the vendor endpoint key).
    pollId: label("poll_id"),
    // cloud_poll: scrypt hash of the printer's poll token — the firmware authenticates its poll. Never
    // the plaintext.
    pollTokenHash: label("poll_token_hash"),
    // What the printer prints (Slice B routing). DEFAULT 'station' so an existing printer stays inert.
    ticketScope: printTicketScope("ticket_scope").notNull().default("station"),
    // Layout settings (design 2026-09-14). Defaults match the TM-T88III: 80mm, 180 dpi, character
    // table 16 (WPC1252).
    paperWidth: printPaperWidth("paper_width").notNull().default("80mm"),
    resolution: printResolution("resolution").notNull().default("180dpi"),
    characterSet: printCharacterSet("character_set").notNull().default("wpc1252"),
    // `ESC t n` is model/firmware-specific even when the byte-to-glyph encoding is the same.
    characterTable: count("character_table").notNull().default(16),
    // Deactivate via active := false, never a hard delete (print_jobs reference it).
    active: flag("active").notNull().default(true),
  },
  (t) => [
    check("printers_transport_ck", enumCheck(t.transport)),
    check("printers_ticket_scope_ck", enumCheck(t.ticketScope)),
    check("printers_paper_width_ck", enumCheck(t.paperWidth)),
    check("printers_resolution_ck", enumCheck(t.resolution)),
    check("printers_character_set_ck", enumCheck(t.characterSet)),
    check("printers_character_table_ck", sql`${t.characterTable} between 0 and 255`),
  ],
);
