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
import { canvases } from "./canvases.js";

/**
 * The values MUST equal `FORM_FACTORS` in `packages/layouts/src/canvas.ts`; @waitron/layouts owns
 * the type, this declaration is the storage.
 */
export const deviceFormFactorEnum = enumType(["till", "phone-portrait", "tablet-landscape", "kds"]);

/**
 * A reusable device profile: the binding bundle a device resolves against. Not location-scoped.
 *
 * `canvas_id` NULL means the form-factor default canvas.
 *
 * `capabilities` is plain JSON (a CapabilityFlag[]) with no @waitron/layouts type: that package
 * depends on @waitron/db, so importing its type here would be circular. The store validates on write.
 */
export const deviceProfiles = table(
  "device_profiles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    formFactor: deviceFormFactorEnum("form_factor").notNull(),
    /* v8 ignore start */
    canvasId: id("canvas_id").references(() => canvases.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    capabilities: json("capabilities").notNull().default([]),
    // Auto-logout idle timeout in seconds; NULL = never. `validateInactivityTimeout`
    // (@waitron/layouts) forces NULL for a kds profile on write; the database does not.
    inactivityTimeoutSeconds: count("inactivity_timeout_seconds"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("device_profiles_tenant_name_key").on(t.name),
    check("device_profiles_form_factor_ck", enumCheck(t.formFactor)),
  ],
);
