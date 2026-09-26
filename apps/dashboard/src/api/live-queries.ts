import type { ResourceQuery } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./client.js";

const MENU_PUBLICATION_READS = [
  "catalogues",
  "categories",
  "content_languages",
  "extra_list_items",
  "extra_lists",
  "menu_details",
  "menu_item_extra_items",
  "menu_item_extra_lists",
  "menu_item_variant_overrides",
  "menu_items",
  "menu_publications",
  "menu_versions",
  "option_labels",
  "option_lists",
  "product_modifiers",
  "product_units",
  "products",
  "section_members",
  "sections",
  "units",
] as const;

/** Dependencies describe the read model, independently of which operation changes it. */
export const QUERY_DEPENDENCIES = {
  getContentLanguages: ["content_languages"],
  listPrinters: ["printers", "print_jobs"],
  listRecentJobs: ["print_jobs", "printers", "print_agents"],
  listAgents: ["print_agents"],
  listTills: ["tills"],
  // The venue's card readers, plus the per-reader device count aggregated over `device_card_readers`,
  // so a reader added/retired OR a device re-pointed refreshes the list.
  listReaders: ["card_readers", "device_card_readers"],
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
  // `readMenuStructure` reads the root from `menu_details`, then the whole section graph.
  getMenuStructure: ["menu_details", "sections", "section_members"],
  // `menuPrices` (packages/catalogue/src/operations.ts): the structure's tables for the placements,
  // then each reached product's menu item, menu and price, and its variants' overrides.
  getMenuPrices: [
    "menu_details",
    "sections",
    "section_members",
    "menu_items",
    "catalogues",
    "products",
    "menu_item_variant_overrides",
  ],
  // Every table `menuStatus` and `previewMenu` read (packages/catalogue/src/menu-publication.ts),
  // recorded from the statements they prepared.
  getMenuStatuses: MENU_PUBLICATION_READS,
  getMenuStatus: MENU_PUBLICATION_READS,
  getMenuPreview: MENU_PUBLICATION_READS,
  listCategories: ["categories", "category_details"],
  getCategory: ["categories", "category_details"],
  listCategoryProducts: ["categories", "category_details", "products", "product_labels"],
  listLibraryProducts: ["products", "product_labels"],
  listSections: ["sections", "section_members"],
  // The usages name each menu from `catalogues` (`librarySectionUsages`, sections.ts).
  listSectionUsages: ["sections", "section_members", "catalogues"],
  listLabels: ["labels", "product_labels"],
  getProductLabels: ["products", "product_labels"],
  listUnits: ["units"],
  listProducts: [
    "product_labels",
    "products",
    "categories",
    "recipe_lines",
    "ingredients",
    // A product's attached extras and options lists, read from `product_modifiers` alone
    // (`readProductModifiers`, packages/catalogue/src/product-modifiers.ts) — it names no list
    // table, so neither is named here.
    "product_modifiers",
  ],
  // The extras and options lists. Each read is two SELECTs and nothing else: the list table, then
  // its children (`listOptionLists`/`readOptionListsByIds` in packages/catalogue/src/options.ts,
  // `listExtraLists`/`readExtraListsByIds` in extras.ts). Neither joins `products`,
  // `product_modifiers` or the `menu_item_extra_*` tables, so none of those is named here.
  listOptionLists: ["option_lists", "option_labels"],
  getOptionList: ["option_lists", "option_labels"],
  listExtraLists: ["extra_lists", "extra_list_items"],
  getExtraList: ["extra_lists", "extra_list_items"],
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
  getLocationSettings: ["locations"],
  getProductRecipe: ["recipe_lines", "ingredients", "products"],
  listIngredients: ["ingredients"],
  listStatuses: ["table_service_statuses"],
  getProfile: ["persons", "webauthn_credentials"],
  getGoogleConfig: ["google_config"],
  getEmailInbox: ["email_inbox"],
  getBackupStatus: ["backup_status"],
  getStreamSettings: ["backup_status"],
  listAlerts: ["incidents"],
  listHandledAlerts: ["incidents", "persons"],
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
          : name === "getEmailInbox" || name === "getBackupStatus" || name === "getStreamSettings"
            ? 10_000
            : 60_000,
  };
}
