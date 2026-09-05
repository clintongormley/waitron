import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * A reusable DEVICE PROFILE (design 2026-09-05 §5.1): the binding bundle a device uses — a name, a
 * reference to a reusable canvas, and the capabilities set (relocated off the canvas record). MANY per
 * tenant, keyed by name; a device (Task 5) points at one via a composite (tenant_id, id) FK, so two
 * UNIQUEs back that. Tenant-wide, NOT location-scoped (like canvases).
 *
 * `canvas_id` is a BARE uuid (nullable): the tenant-consistent (tenant_id, canvas_id) → canvases FK is
 * hand-written --custom (0107), the devices.station_id idiom. NULL ⇒ the resolver falls back to the
 * form-factor default canvas (design §5.3). MATCH SIMPLE skips the FK check on NULL.
 *
 * `capabilities` is PLAIN jsonb (a CapabilityFlag[]), NOT `.$type<>()`-annotated — @waitron/layouts
 * depends on @waitron/db, so importing its type here is circular; the store validates on write. Same
 * rationale as canvases.definition. DEFAULT '[]' so a profile carries no capability until configured.
 *
 * `.enableRLS()` emits only ENABLE. FORCE + the tenant-isolation policy + the app_user grant
 * (SELECT/INSERT/UPDATE/DELETE — profiles are deletable config) are hand-written --custom (0107).
 * inmutabilidad requires FORCE on every tenant_id-bearing table.
 */
export const deviceProfiles = pgTable(
  "device_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    canvasId: uuid("canvas_id"),
    capabilities: jsonb("capabilities").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("device_profiles_tenant_id_key").on(t.tenantId, t.id),
    unique("device_profiles_tenant_name_key").on(t.tenantId, t.name),
  ],
).enableRLS();
