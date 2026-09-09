import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The device form factor a profile targets — the sizing guardrail a canvas is authored against. The
 * values MUST equal `FORM_FACTORS` in `packages/layouts/src/canvas.ts`; @waitron/layouts owns the
 * type, this pgEnum is the storage. A pgEnum, not a text CHECK, matching the repo precedent
 * (device_kind, working_order_status): adding a form factor is an `ALTER TYPE`, a deliberate change.
 */
export const deviceFormFactorEnum = pgEnum("device_form_factor", [
  "till",
  "phone-portrait",
  "tablet-landscape",
  "kds",
]);

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
    formFactor: deviceFormFactorEnum("form_factor").notNull(),
    canvasId: uuid("canvas_id"),
    capabilities: jsonb("capabilities").notNull().default([]),
    // Auto-logout idle timeout in seconds; NULL = never (KDS is always NULL — it is a display, not a
    // logged-in operator). Nullable because most profiles opt out; @waitron/layouts validates it on
    // write. Added --custom (snapshot-less) so `db:generate` never proposes dropping the module-owned
    // `bookings` table it still carries in the core snapshot chain.
    inactivityTimeoutSeconds: integer("inactivity_timeout_seconds"),
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
);
