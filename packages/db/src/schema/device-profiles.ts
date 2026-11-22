import { sql } from "drizzle-orm";
import { check, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  jsonShapeCheck,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { floorZones } from "./floor-zones.js";
import type { StoredKitchenViews } from "./venue-service/kitchen-screens.js";
import { departments } from "./venue-service/service.js";

/**
 * The values MUST equal `FORM_FACTORS` in `packages/layouts/src/device-types.ts`; @waitron/layouts owns
 * the type, this declaration is the storage.
 */
export const deviceFormFactorEnum = enumType(["till", "phone-portrait", "tablet-landscape", "kds"]);

export const printerListRoles = ["receipt", "payment_slip", "cash_drawer", "invoice"] as const;
export type PrinterListRole = (typeof printerListRoles)[number];

/** An absent or empty role offers no printer. A stored default is on its role's list. */
export type StoredPrinterLists = Partial<
  Record<PrinterListRole, { readonly ids: readonly string[]; readonly defaultId: string | null }>
>;

export interface DeviceProfileCardReaders {
  ids?: string[];
  defaultId?: string | null;
}

/**
 * A reusable device profile: the binding bundle a device resolves against.
 *
 * `retired_at` set means RETIRED: deleted while only disabled devices held it, which the
 * `devices.device_profile_id` key would refuse. The database does not stop an active device
 * holding one: retiring refuses an active holder, and `getDeviceProfile`, through which device joins
 * and edits resolve a profile, hides retired ones.
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
    capabilities: json("capabilities").notNull().default([]),
    // Auto-logout idle timeout in seconds; NULL = never.
    inactivityTimeoutSeconds: count("inactivity_timeout_seconds"),
    // The store refuses a screen the profile does not show. NULL opens the fixed home screen.
    startingScreen: label("starting_screen"),
    orderDepartmentId: id("order_department_id").references((): AnySQLiteColumn => departments.id),
    orderStartingZoneId: id("order_starting_zone_id").references(
      (): AnySQLiteColumn => floorZones.id,
    ),
    // With a department, NULL allows every zone and an empty list allows none.
    // The scope writer checks the zone ids. Deleting a zone removes it from the list.
    orderZoneIds: json<string[]>("order_zone_ids"),
    // Printer ids have no foreign key. The product's Delete clears them before retiring a printer.
    printerLists: json<StoredPrinterLists>("printer_lists").notNull().default({}),
    kitchenViews: json<StoredKitchenViews>("kitchen_views").notNull().default({}),
    cardReaders: json<DeviceProfileCardReaders>("card_readers").notNull().default({}),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
    retiredAt: tsString("retired_at"),
  },
  (t) => [
    uniqueIndex("device_profiles_live_name_key")
      .on(t.name)
      .where(sql`${t.retiredAt} is null`),
    check("device_profiles_form_factor_ck", enumCheck(t.formFactor)),
    check("device_profiles_printer_lists_ck", jsonShapeCheck(t.printerLists, "object")),
    check("device_profiles_kitchen_views_ck", jsonShapeCheck(t.kitchenViews, "object")),
    check("device_profiles_card_readers_ck", jsonShapeCheck(t.cardReaders, "object")),
    check(
      "device_profiles_order_scope_ck",
      sql`(${t.orderDepartmentId} is null) = (${t.orderStartingZoneId} is null)
          and (${t.orderDepartmentId} is not null or ${t.orderZoneIds} is null)`,
    ),
    check("device_profiles_order_zone_ids_ck", jsonShapeCheck(t.orderZoneIds, "array")),
  ],
);
