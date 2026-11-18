import type { Transaction } from "./client.js";
import { eq } from "drizzle-orm";
import { kitchenStations } from "./schema/kitchen-stations.js";
import { KITCHEN_SCREEN_KINDS } from "./schema/venue-service/kitchen-screens.js";
import { deviceProfiles, printerListRoles } from "./schema/device-profiles.js";
import {
  AppError,
  isBumpMode,
  isChangesAfterSending,
  isShortNameShaped,
  isStationColour,
  isTicketGrouping,
  refusesShortNamePlus,
  shortNameKey,
} from "@waitron/shared";
import { storeTableShortNameKeys } from "./table-short-names.js";
import "./errors.js";

function validatePrinterLists(
  profiles: readonly Record<string, unknown>[],
  printers: readonly Record<string, unknown>[],
): void {
  const kinds = new Map(printers.map(({ id, kind }) => [id, kind]));
  const roles = new Set<string>(printerListRoles);
  const invalid = () =>
    new AppError("setup.request_invalid", { field: "device_profiles.printer_lists" });
  for (const profile of profiles) {
    const raw = profile.printer_lists;
    if (raw === undefined) continue;
    if (typeof raw !== "string") throw invalid();
    let lists: unknown;
    try {
      lists = JSON.parse(raw) as unknown;
    } catch {
      throw invalid();
    }
    if (lists === null || typeof lists !== "object" || Array.isArray(lists)) throw invalid();
    for (const [role, list] of Object.entries(lists) as [string, unknown][]) {
      if (!roles.has(role) || list === null || typeof list !== "object" || Array.isArray(list))
        throw invalid();
      const { ids, defaultId } = list as Record<string, unknown>;
      if (
        !Array.isArray(ids) ||
        ids.some(
          (id: unknown) =>
            typeof id !== "string" ||
            !kinds.has(id) ||
            (role !== "invoice" && kinds.get(id) === "a4"),
        ) ||
        new Set(ids).size !== ids.length ||
        (defaultId !== null && !ids.includes(defaultId))
      )
        throw invalid();
    }
  }
}

function validateKitchenViews(
  profiles: readonly Record<string, unknown>[],
  stations: readonly Record<string, unknown>[],
  zones: readonly Record<string, unknown>[],
): void {
  const stationIds = new Set(stations.map(({ id }) => id));
  const zoneIds = new Set(zones.map(({ id }) => id));
  const kinds = new Set<string>(KITCHEN_SCREEN_KINDS);
  const invalid = () =>
    new AppError("setup.request_invalid", { field: "device_profiles.kitchen_views" });
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const isBound = (value: unknown, ids: ReadonlySet<unknown>) =>
    value === null ||
    (Array.isArray(value) &&
      value.every((id: unknown) => typeof id === "string" && ids.has(id)) &&
      new Set(value).size === value.length);

  for (const { kitchen_views: raw } of profiles) {
    if (raw === undefined) continue;
    if (typeof raw !== "string") throw invalid();
    let views: unknown;
    try {
      views = JSON.parse(raw) as unknown;
    } catch {
      throw invalid();
    }
    if (!isObject(views)) throw invalid();
    const entries = Object.entries(views);
    if (entries.length > 1) throw invalid();
    for (const [kind, view] of entries) {
      if (!kinds.has(kind) || !isObject(view)) throw invalid();
      if (
        !isBound(view.stationIds, stationIds) ||
        !isBound(view.zoneIds, zoneIds) ||
        (kind === "station" && view.zoneIds !== null) ||
        (view.showNonPassStations !== undefined && typeof view.showNonPassStations !== "boolean")
      )
        throw invalid();
    }
  }
}

export function validateCoreConfiguration(
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): void {
  for (const row of tables.kitchen_stations ?? []) {
    if (row.colour !== undefined && !isStationColour(row.colour))
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.colour" });
    if (row.ticket_grouping !== undefined && !isTicketGrouping(row.ticket_grouping))
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.ticket_grouping" });
    if (row.bump_mode !== undefined && !isBumpMode(row.bump_mode))
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.bump_mode" });
    if (
      row.changes_after_sending !== undefined &&
      !isChangesAfterSending(row.changes_after_sending)
    )
      throw new AppError("setup.request_invalid", {
        field: "kitchen_stations.changes_after_sending",
      });
    if (row.waits_for_pass !== undefined && row.waits_for_pass !== 0 && row.waits_for_pass !== 1)
      throw new AppError("setup.request_invalid", { field: "kitchen_stations.waits_for_pass" });
  }
  for (const table of ["kitchen_courses", "kitchen_stations", "floor_zones"])
    for (const row of tables[table] ?? [])
      if (row.active === 0 || row.active === false)
        throw new AppError("setup.request_invalid", { field: `${table}.active` });
  for (const row of tables.printers ?? []) {
    if (row.deleted_at !== undefined && row.deleted_at !== null)
      throw new AppError("setup.request_invalid", { field: "printers.deleted_at" });
    for (const field of ["picks_up_receipts", "picks_up_payment_slips"]) {
      const value = row[field];
      if (value !== undefined && value !== 0 && value !== 1)
        throw new AppError("setup.request_invalid", { field: `printers.${field}` });
    }
  }
  validatePrinterLists(tables.device_profiles ?? [], tables.printers ?? []);
  validateKitchenViews(
    tables.device_profiles ?? [],
    tables.kitchen_stations ?? [],
    tables.floor_zones ?? [],
  );
  // An import makes a new venue, so the file's rows are all of its tables; the plan's tables have
  // no unique index to catch a clash later.
  for (const table of ["dining_tables", "floor_plan_tables"]) {
    const field = `${table}.short_name`;
    const keys = new Set<string>();
    for (const row of tables[table] ?? []) {
      const shortName = row.short_name;
      if (shortName === undefined || shortName === null) {
        // The till shows a table with no short name by its full name, where a "+" reads as a join.
        if (typeof row.label === "string" && row.label.includes("+"))
          throw new AppError("setup.request_invalid", { field });
        continue;
      }
      if (
        typeof shortName !== "string" ||
        shortName.trim() !== shortName ||
        !isShortNameShaped(shortName) ||
        refusesShortNamePlus(shortName)
      )
        throw new AppError("setup.request_invalid", { field });
      const key = shortNameKey(shortName);
      if (keys.has(key)) throw new AppError("setup.request_invalid", { field });
      keys.add(key);
    }
  }
}

export const CORE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "menus" },
    {
      name: "kitchen_stations",
      jsonReferences: [{ column: "printer_ids", paths: [["*"]] }],
      leaveBehindWhenFalse: "active",
      omit: ["closed_on_day", "closed_sends_to_station_id"],
    },
    { name: "kitchen_courses", leaveBehindWhenFalse: "active" },
    { name: "categories" },
    { name: "products" },
    {
      name: "device_profiles",
      omit: ["card_readers"],
      leaveBehindWhenSet: "retired_at",
      jsonReferences: [
        { column: "order_zone_ids", paths: [["*"]] },
        {
          column: "kitchen_views",
          paths: [
            ["*", "stationIds", "*"],
            ["*", "zoneIds", "*"],
          ],
        },
        {
          column: "printer_lists",
          paths: [
            ["*", "ids", "*"],
            ["*", "defaultId"],
          ],
        },
      ],
    },
    {
      name: "floor_zones",
      leaveBehindWhenFalse: "active",
      omit: [
        "kept_open_day",
        "kept_open_from",
        "kept_open_until",
        "today_business_day",
        "today_revision",
        "today_set_id",
        "today_layout_revision",
        "today_occurrence",
      ],
    },
    {
      name: "dining_tables",
      omit: [
        "needs_clearing_since",
        "short_name_key",
        "on_floor",
        "today_seats",
        "today_fixed",
        "today_x",
        "today_y",
        "today_width",
        "today_height",
        "today_shape",
        "today_rotation",
        "taken_off",
        "today_name",
        "merge_id",
        "merge_before_x",
        "merge_before_y",
        "merge_before_rotation",
      ],
    },
    { name: "floor_plan_sets" },
    { name: "floor_plans" },
    { name: "floor_plan_tables" },
    { name: "floor_plan_placements" },
    {
      name: "print_agents",
      // `node_id` names a node of the exporting venue; the importing venue makes its own. The setup
      // page's address and port are the exporting machine's; the agent reports its own with each pull.
      omit: ["token_hash", "last_seen_at", "host", "node_id", "setup_url", "setup_port"],
      reconnect: true,
    },
    {
      name: "printers",
      omit: ["poll_token_hash", "held_by_device_id", "held_at"],
      reconnect: true,
      leaveBehindWhenSet: "deleted_at",
    },
    { name: "custom_themes" },
  ],
  validate: validateCoreConfiguration,
  afterImport: async (tx: Transaction) => {
    await tx
      .update(deviceProfiles)
      .set({ printerLists: {} })
      .where(eq(deviceProfiles.formFactor, "kds"));
    await storeTableShortNameKeys(tx);
    for (const station of await tx
      .select({ id: kitchenStations.id, printerIds: kitchenStations.printerIds })
      .from(kitchenStations))
      await tx
        .update(kitchenStations)
        .set({ printerIds: [...new Set(station.printerIds)].sort() })
        .where(eq(kitchenStations.id, station.id));
  },
} as const;
