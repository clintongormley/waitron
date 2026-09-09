import { boolean, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * How a printer is reached (printing subsystem, §0/§2b). `usb` and `bluetooth` are LOCAL transports
 * keyed on a stable device id (`local_key`: the USB serial, the Bluetooth MAC); `network_tcp`
 * (ESC/POS over TCP:9100) is keyed on `host`. Any agent serving the venue drives whichever devices it
 * can currently see — the binding is discovered at run time, not stored. `cloud_poll` (Star CloudPRNT
 * / Epson Server Direct Print — the printer firmware dials out and polls for jobs) is carried in the
 * enum FROM DAY ONE, its adapter a fast-follow (§3e): an additive enum value already present is a
 * config choice later, not a destructive migration. A pgEnum, not a text check, matching
 * `order_flow`'s precedent.
 */
export const printTransport = pgEnum("print_transport", [
  "usb",
  "network_tcp",
  "bluetooth",
  "cloud_poll",
]);

/**
 * What a printer prints, for the KDS station→printer routing Slice B consumes (§2b). `station`
 * (default): one ticket per kitchen station. `order`: one ticket per whole order. Carried now, read
 * by Slice B — a pgEnum matching the `bump_mode`/`fire_control_mode` precedent.
 */
export const printTicketScope = pgEnum("print_ticket_scope", ["station", "order"]);

/**
 * A managed PRINTER (§2b) — central config, distributed execution. All config lives centrally (the one
 * Impresoras dashboard); the actual printing runs on the local `print_agents` agent that serves it.
 * Tenant + location scoped (separate `tenant_id`/`location_id` FKs, `onDelete restrict`, the
 * `devices` shape).
 *
 * No stored agent binding: which agent serves a printer is discovered at run time from the devices an
 * agent can see, so the connection columns describe the DEVICE, not an agent. They are transport-
 * specific and all NULLABLE at the column level; which ones must be present is enforced by the
 * `printers_transport_fields_ck` CHECK hand-written in the paired --custom migration (usb/bluetooth
 * need local_key; network_tcp needs host; cloud_poll needs poll_id). The partial UNIQUE
 * `printers_local_key_key` on (tenant_id, location_id, local_key) WHERE local_key IS NOT NULL — one
 * registered printer per physical USB/BT device per venue — and the (tenant_id, id) composite UNIQUE
 * that print_jobs.printer_id targets are likewise hand-written there.
 */
export const printers = pgTable(
  "printers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // The human label ("Impresora Cocina"), shown in the Impresoras management surface.
    name: text("name").notNull(),
    transport: printTransport("transport").notNull(),
    // usb: the device serial; bluetooth: the MAC. The stable device id an agent matches to bind at run
    // time. NULL for network_tcp/cloud_poll. Unique per (tenant, location) when set (partial index).
    localKey: text("local_key"),
    // network_tcp: the printer's local IP/host.
    host: text("host"),
    // network_tcp: the ESC/POS port. DEFAULT 9100 (the deli-hardware ReceiptPrinter port); nullable so
    // a usb/bluetooth/cloud_poll printer need not carry it.
    port: integer("port").default(9100),
    // cloud_poll: the printer's poll identifier (the vendor endpoint key).
    pollId: text("poll_id"),
    // cloud_poll: scrypt hash of the printer's poll token — the firmware authenticates its poll. Never
    // the plaintext.
    pollTokenHash: text("poll_token_hash"),
    // What the printer prints (Slice B routing). DEFAULT 'station' so an existing printer stays inert.
    ticketScope: printTicketScope("ticket_scope").notNull().default("station"),
    // Deactivate via active := false, never a hard delete (print_jobs reference it).
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target `print_jobs.printer_id`'s tenant-consistent
    // (tenant_id, printer_id) FK points at (print-jobs.ts), the same role devices_tenant_id_key plays.
    unique("printers_tenant_id_key").on(t.tenantId, t.id),
  ],
);
