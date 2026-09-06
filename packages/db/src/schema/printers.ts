import { boolean, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * How a printer is reached (printing subsystem, §0/§2b). `usb` and `network_tcp` (ESC/POS over
 * TCP:9100) are the two LOCAL transports wired this slice, driven by a `print_agents` agent that
 * pulls the printer's jobs and pushes the bytes. `cloud_poll` (Star CloudPRNT / Epson Server Direct
 * Print — the printer firmware dials out and polls for jobs) is carried in the enum FROM DAY ONE, its
 * adapter a fast-follow (§3e): an additive enum value already present is a config choice later, not a
 * destructive migration. A pgEnum, not a text check, matching `order_flow`'s precedent.
 */
export const printTransport = pgEnum("print_transport", ["usb", "network_tcp", "cloud_poll"]);

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
 * The connection columns are transport-specific and all NULLABLE at the column level; which ones must
 * be present is enforced by the `printers_transport_fields_ck` CHECK hand-written in the paired
 * --custom migration (usb needs agent_id+usb_path; network_tcp needs agent_id+host; cloud_poll needs
 * poll_id). `agent_id` is a BARE uuid: the tenant-consistent (tenant_id, agent_id) → print_agents
 * (tenant_id, id) composite FK is hand-written in the --custom migration (a bare column carries no
 * FK), exactly as `devices.station_id` does. NULLABLE — a `cloud_poll` printer has no agent (it
 * self-polls); MATCH SIMPLE skips the FK check on a NULL agent_id.
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
    // The serving agent for usb/network_tcp. Bare column: the tenant-consistent (tenant_id, agent_id)
    // → print_agents composite FK is hand-written in the --custom migration. NULLABLE — a cloud_poll
    // printer has no agent (MATCH SIMPLE skips the FK check on a NULL).
    agentId: uuid("agent_id"),
    // network_tcp: the printer's local IP/host.
    host: text("host"),
    // network_tcp: the ESC/POS port. DEFAULT 9100 (the deli-hardware ReceiptPrinter port); nullable so
    // a usb/cloud_poll printer need not carry it.
    port: integer("port").default(9100),
    // usb: the device identifier on the agent's box.
    usbPath: text("usb_path"),
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
