import type { ResourceQuery } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./client.js";

/** Dependencies describe the read model, independently of which operation changes it. */
export const QUERY_DEPENDENCIES = {
  listPrinters: ["printers", "print_jobs"],
  listRecentJobs: ["print_jobs", "printers", "print_agents"],
  listAgents: ["print_agents"],
  listTills: ["tills"],
  pairingMode: ["pairing"],
  joinRequests: ["join_requests"],
  listDiscoveredPrinters: ["printer_discovery", "printers", "print_agents"],
  getSalesOverview: [
    "sales",
    "sale_voids",
    "sale_substitutions",
    "sale_lines",
    "tenders",
    "working_orders",
    "dining_tables",
    "products",
    "locations",
  ],
  getOverdueOrders: [
    "ticket_items",
    "working_orders",
    "working_order_lines",
    "order_amendments",
    "kitchen_stations",
    "dining_tables",
  ],
  getDailyClose: [
    "sale_substitutions",
    "sale_lines",
    "locations",
    "daily_closes",
    "sales",
    "sale_voids",
    "tenders",
    "sale_settlements",
  ],
  getSalesPeriod: [
    "sale_substitutions",
    "locations",
    "sales",
    "sale_lines",
    "sale_voids",
    "tenders",
    "sale_settlements",
    "products",
  ],
  listStaff: ["persons", "webauthn_credentials"],
  getStaffRoster: ["persons"],
  listPendingAbsences: ["absences"],
  listPendingSwaps: ["shift_swaps", "shifts"],
  listCanvases: ["canvases"],
  getCanvas: ["canvases"],
  listCatalogues: ["catalogues"],
  listCategories: ["categories"],
  listProducts: [
    "products",
    "categories",
    "recipe_lines",
    "ingredients",
    "product_option_groups",
    "option_groups",
    "option_group_items",
  ],
  listOptionGroupItems: ["option_group_items", "recipe_lines", "ingredients"],
  listOptionGroups: ["option_groups", "option_group_items"],
  listProductOptionGroupIds: ["product_option_groups"],
  listDeviceProfiles: ["device_profiles", "devices", "canvases"],
  getDeviceProfile: ["device_profiles", "canvases"],
  listDevices: ["devices", "device_profiles", "tills", "kitchen_stations"],
  listStations: ["kitchen_stations"],
  listCourses: ["kitchen_courses"],
  listTables: ["dining_tables", "floor_zones", "working_orders", "table_service_statuses"],
  listZones: ["floor_zones"],
  getFireControl: ["locations"],
  listMyAbsences: ["absences"],
  listMyShifts: ["shifts", "employments", "locations"],
  listMySwaps: ["shift_swaps", "shifts"],
  getLocations: ["locations"],
  getPlannedVsActual: ["roster_versions", "locations", "shifts", "time_entries", "employments"],
  getRoster: ["shifts", "roster_versions", "employments", "absences"],
  listPrinterStations: ["station_printers"],
  listPurchaseInvoices: ["purchase_invoices", "purchase_invoice_vat"],
  getReceipt: ["tenant_receipts"],
  getProductRecipe: ["recipe_lines", "ingredients", "products"],
  listIngredients: ["ingredients"],
  listStatuses: ["table_service_statuses"],
  getProfile: ["persons", "webauthn_credentials"],
  getGoogleConfig: ["google_config"],
  getEmailInbox: ["email_inbox"],
  getBackupStatus: ["backup_status"],
} as const;

export type DashboardQueryName = keyof typeof QUERY_DEPENDENCIES;
type Arguments<N extends DashboardQueryName> = Parameters<DashboardApi[N]>;
type Result<N extends DashboardQueryName> = Awaited<ReturnType<DashboardApi[N]>>;

export function dashboardQuery<N extends DashboardQueryName>(
  api: DashboardApi,
  name: N,
  args: Arguments<N>,
): ResourceQuery<Result<N>> {
  let initial = true;
  return {
    key: JSON.stringify([name, args]),
    dependencies: QUERY_DEPENDENCIES[name].map((type) => ({ type })),
    read: () => {
      const client = initial ? api : (api.background ?? api);
      initial = false;
      const read = client[name] as (...args: Arguments<N>) => Promise<Result<N>>;
      return read.apply(client, args);
    },
    refreshMs:
      name === "getOverdueOrders"
        ? 30_000
        : name === "pairingMode" || name === "listDiscoveredPrinters"
          ? 5_000
          : name === "getEmailInbox" || name === "getBackupStatus"
            ? 10_000
            : 60_000,
  };
}
