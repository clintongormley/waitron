import { check, unique } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";

/**
 * The device form factor a profile targets — the sizing guardrail a canvas is authored against. The
 * values MUST equal `FORM_FACTORS` in `packages/layouts/src/canvas.ts`; @waitron/layouts owns the
 * type, this declaration is the storage. What refuses a value outside the set is the
 * `device_profiles_form_factor_ck` constraint below, built from this same array by `enumCheck`.
 */
export const deviceFormFactorEnum = enumType(["till", "phone-portrait", "tablet-landscape", "kds"]);

/**
 * A reusable DEVICE PROFILE (design 2026-09-05 §5.1): the binding bundle a device uses — a name, a
 * reference to a reusable canvas, and the capabilities set (relocated off the canvas record). MANY per
 * database, keyed by name; a device (Task 5) points at one by its `id`. NOT location-scoped (like
 * canvases).
 *
 * `canvas_id` is a BARE uuid (nullable): the `canvas_id` → canvases FK is
 * hand-written --custom (0107), the devices.station_id idiom. NULL ⇒ the resolver falls back to the
 * form-factor default canvas (design §5.3). MATCH SIMPLE skips the FK check on NULL.
 *
 * `capabilities` is PLAIN jsonb (a CapabilityFlag[]) carrying no @waitron/layouts type —
 * @waitron/layouts depends on @waitron/db, so importing its type here is circular; the store
 * validates on write. Same rationale as canvases.definition. DEFAULT '[]' so a profile carries no
 * capability until configured.
 */
export const deviceProfiles = table(
  "device_profiles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    formFactor: deviceFormFactorEnum("form_factor").notNull(),
    canvasId: id("canvas_id"),
    capabilities: json("capabilities").notNull().default([]),
    // Auto-logout idle timeout in seconds; NULL = never (KDS is always NULL — it is a display, not a
    // logged-in operator). Nullable because most profiles opt out; @waitron/layouts validates it on
    // write. Added --custom (snapshot-less) so `db:generate` never proposes dropping the module-owned
    // `bookings` table it still carries in the core snapshot chain.
    inactivityTimeoutSeconds: count("inactivity_timeout_seconds"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("device_profiles_tenant_name_key").on(t.name),
    // The values are read off the column itself (`enumCheck`), so the vocabulary is declared once,
    // in `deviceFormFactorEnum` above.
    check("device_profiles_form_factor_ck", enumCheck(t.formFactor)),
  ],
);
