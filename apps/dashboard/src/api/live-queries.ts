import type { ResourceQuery } from "@waitron/dashboard-kit";
import type { DashboardApi, MenuReadPart } from "./client.js";

const MENU_PUBLICATION_READS = [
  "catalogue_settings",
  "catalogues",
  "categories",
  "category_details",
  "content_languages",
  "extra_list_items",
  "extra_lists",
  "menu_details",
  "menu_item_variant_overrides",
  "menu_items",
  "menu_publications",
  "menu_scheduled_publications",
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

const CURRENT_CLASSIFICATION_READS = ["products", "categories", "category_details"] as const;

/** Dependencies describe the read model, independently of which operation changes it. */
export const QUERY_DEPENDENCIES = {
  getCatalogueSettings: ["catalogue_settings"],
  getContentLanguages: ["content_languages"],
  // The server works the rules out once at boot, so no table change moves them.
  getContentLanguageRules: [],
  // `listTranslationGapReport` (packages/catalogue/src/content-translation-report.ts): the setting,
  // then each table it names a row from.
  getContentTranslationGaps: [
    "content_languages",
    "products",
    "option_lists",
    "option_labels",
    "extra_lists",
    "sections",
    "section_members",
    "catalogues",
    "units",
  ],
  getContentTranslationTargets: [
    "content_languages",
    "products",
    "option_lists",
    "option_labels",
    "extra_lists",
    "sections",
    "section_members",
    "menu_details",
    "catalogues",
    "units",
  ],
  listPrinters: ["printers", "print_jobs", "printer_holders"],
  listPrinterProfiles: ["device_profile_printers", "device_profiles"],
  listRecentJobs: ["print_jobs", "printers", "print_agents"],
  listAgents: ["print_agents"],
  listReaders: ["card_readers", "device_card_readers", "device_profile_card_readers", "devices"],
  listReaderHolders: ["card_reader_holders", "payments"],
  getProfileReaders: ["device_profile_card_readers", "card_readers"],
  // The route reads `tenant_credentials`, which no module declares as a live resource.
  listPaymentProviders: [],
  listStuckPayments: ["payments", "working_orders", "devices"],
  listStuckBillPayments: ["bill_payments", "payments", "working_orders", "devices"],
  listStuckBillRefunds: [
    "bill_payment_refunds",
    "bill_payments",
    "payments",
    "working_orders",
    "devices",
  ],
  pairingMode: ["pairing"],
  // A device's ask; `dependenciesOf` narrows a print agent's.
  joinRequests: ["join_requests", "devices", "device_profiles"],
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
  listOrderPages: [
    "working_orders",
    "working_order_lines",
    "order_amendments",
    "sales",
    "invoice_series",
    "sale_settlements",
    "sale_voids",
    "sale_substitutions",
    "unpaid_departures",
    "parties",
    "party_tables",
    "dining_tables",
    "bill_payments",
    "bill_payment_refunds",
    "persons",
  ],
  listOrderStaff: ["persons"],
  getOrder: [
    "working_orders",
    "working_order_lines",
    "order_amendments",
    "sales",
    "sale_lines",
    "invoice_series",
    "sale_settlements",
    "sale_voids",
    "sale_substitutions",
    "tenders",
    "unpaid_departures",
    "parties",
    "party_tables",
    "dining_tables",
    "bill_payments",
    "bill_payment_refunds",
    "persons",
    "receipt_reprints",
    "print_jobs",
    "printers",
  ],
  getOrderPrinters: ["printers"],
  // The current mode's list; `dependenciesOf` narrows it at time of sale.
  getCategorySales: [
    "sales",
    "sale_lines",
    "sale_voids",
    "sale_substitutions",
    "locations",
    ...CURRENT_CLASSIFICATION_READS,
  ],
  getReportPrinters: ["printers"],
  listStaff: ["persons", "webauthn_credentials"],
  getStaffRoster: ["persons"],
  listPendingAbsences: ["absences"],
  listPendingSwaps: ["shift_swaps", "shifts"],
  listCanvases: ["canvases"],
  getCanvas: ["canvases"],
  listCatalogues: ["catalogues"],
  // `readMenuStructure` reads the root from `menu_details`, then the whole section graph.
  getMenuStructure: ["menu_details", "sections", "section_members", "catalogues"],
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
    "content_languages",
    "product_modifiers",
    "extra_lists",
    "extra_list_items",
    "option_lists",
    "option_labels",
    "product_units",
    "units",
  ],
  // The tables `menuStatus` and `previewMenu` read (packages/catalogue/src/menu-publication.ts); a
  // category's colour and the venue default colour are part of each offer's colour.
  getMenuRead: MENU_PUBLICATION_READS,
  getMenuStatuses: MENU_PUBLICATION_READS,
  getMenuStatus: MENU_PUBLICATION_READS,
  getMenuPreview: MENU_PUBLICATION_READS,
  // The route converts each time with the location's zone.
  getMenuPublications: [
    "menu_scheduled_publications",
    "menu_publications",
    "menu_versions",
    "locations",
  ],
  // `readMenuHome` (packages/catalogue/src/menu-home.ts): the details row, the section graph with
  // its menus, and each shortcut's name.
  getMenuHome: ["menu_details", "sections", "section_members", "products", "catalogues"],
  listCategories: ["categories", "category_details"],
  getCategory: ["categories", "category_details"],
  listLibraryProducts: ["products"],
  listUnits: ["units"],
  listProducts: [
    "products",
    "categories",
    "recipe_lines",
    "ingredients",
    // A product's attached extras and options lists, read from `product_modifiers` alone
    // (`readProductModifiers`, packages/catalogue/src/product-modifiers.ts) — it names no list
    // table, so neither is named here.
    "product_modifiers",
  ],
  listMadeAt: [
    "products",
    "categories",
    "category_details",
    "routing_cells",
    "kitchen_stations",
    "floor_zones",
  ],
  getFolderRouting: [
    "categories",
    "category_details",
    "routing_cells",
    "routing_cell_periods",
    "kitchen_stations",
    "products",
    "floor_zones",
    "zone_service_policies",
    "station_day_states",
    "special_dates",
    "locations",
  ],
  // The extras and options lists: the list table, then its children (`listOptionLists` and
  // `getOptionList` in packages/catalogue/src/options.ts, `listExtraLists` and `getExtraList` in
  // extras.ts). The two list reads also count what carries each list: `product_modifiers` for
  // both. The single-list reads count nothing.
  listOptionLists: ["option_lists", "option_labels", "product_modifiers"],
  getOptionList: ["option_lists", "option_labels"],
  listExtraLists: ["extra_lists", "extra_list_items", "product_modifiers"],
  getExtraList: ["extra_lists", "extra_list_items"],
  listDeviceProfiles: [
    "device_profiles",
    "device_profile_printers",
    "devices",
    "canvases",
    "device_profile_service_access",
    "device_profile_zones",
    "device_profile_admission_roles",
    "device_profile_admission_persons",
  ],
  getDeviceProfile: [
    "device_profiles",
    "device_profile_printers",
    "canvases",
    "device_profile_service_access",
    "device_profile_zones",
    "device_profile_admission_roles",
    "device_profile_admission_persons",
  ],
  listProfileKitchenScreens: [
    "device_profiles",
    "device_profile_kitchen_screens",
    "device_profile_kitchen_screen_stations",
    "device_profile_kitchen_screen_zones",
    "kitchen_stations",
    "floor_zones",
  ],
  listDevices: [
    "devices",
    "device_profiles",
    "kitchen_stations",
    "device_made_here_stations",
    "device_approved_profiles",
    // Each device's equipment (`readDevicesEquipment`, apps/server/src/device-equipment.ts).
    "printer_holders",
    "card_reader_holders",
    "device_card_readers",
    "device_profile_printers",
    "device_profile_card_readers",
    "printers",
    "card_readers",
    // Each device's kitchen screens (`readDevicesKitchenScreens`, packages/venue-service).
    "device_kitchen_screens",
    "device_kitchen_screen_stations",
    "device_kitchen_screen_zones",
    "device_kitchen_screen_removals",
    "device_profile_kitchen_screens",
    "device_profile_kitchen_screen_stations",
    "device_profile_kitchen_screen_zones",
    "floor_zones",
  ],
  listStations: ["kitchen_stations"],
  listCourses: ["kitchen_courses"],
  // Not the order tables `inUse` also reads: a stale Delete is answered by disabling instead.
  listCoursesWithDisabled: ["kitchen_courses", "products"],
  listTables: ["dining_tables", "floor_zones", "working_orders", "table_service_statuses"],
  listZones: ["floor_zones"],
  getFloorPlan: [
    "floor_plans",
    "floor_plan_tables",
    "floor_plan_joins",
    "floor_plan_join_tables",
    "dining_tables",
  ],
  getFireControl: ["locations"],
  getBumpMode: ["locations"],
  getKitchenTimingDefaults: ["kitchen_timing_defaults"],
  listMyAbsences: ["absences"],
  listMyShifts: ["shifts", "employments", "locations"],
  listMySwaps: ["shift_swaps", "shifts"],
  getLocations: ["locations"],
  getPlannedVsActual: ["roster_versions", "locations", "shifts", "time_entries", "employments"],
  getRoster: ["shifts", "roster_versions", "employments", "absences"],
  listPrinterStations: ["station_printers"],
  listPurchaseInvoices: ["purchase_invoices", "purchase_invoice_vat"],
  getReceipt: ["tenant_receipts", "locations"],
  getVenueReceiptSettings: ["tenant_receipts"],
  getDepartmentReceipt: ["department_receipts", "tenant_receipts", "departments", "locations"],
  getLocationSettings: ["locations"],
  getVenueDetails: ["locations", "tenants", "sales", "working_orders", "daily_closes"],
  getReceiptLanguage: ["locations"],
  getProductRecipe: ["recipe_lines", "ingredients", "products"],
  listIngredients: ["ingredients"],
  listStatuses: ["table_service_statuses"],
  getProfile: ["persons", "webauthn_credentials"],
  // The venue's name; the language list itself is fixed.
  getLocales: ["tenants"],
  getGoogleConfig: ["google_config"],
  getEmailInbox: ["email_inbox"],
  // `removable` reads whether the machine has a `nodes` row here, so a new row moves it too.
  listServers: ["node_membership", "nodes"],
  getBackupStatus: ["backup_status"],
  getStreamSettings: ["backup_status"],
  // The answer is built from the box's own files and the process's role, not from any table.
  getCloudStatus: [],
  listAlerts: ["incidents"],
  listHandledAlerts: ["incidents", "persons"],
} as const;

export type DashboardQueryName = keyof typeof QUERY_DEPENDENCIES;
type Arguments<N extends DashboardQueryName> = Parameters<DashboardApi[N]>;
type Result<N extends DashboardQueryName> = Awaited<ReturnType<DashboardApi[N]>>;

function dependenciesOf<N extends DashboardQueryName>(
  name: N,
  args: Arguments<N>,
): readonly string[] {
  if (name === "getMenuRead") {
    const parts = (args as Parameters<DashboardApi["getMenuRead"]>)[1];
    const reads = {
      structure: QUERY_DEPENDENCIES.getMenuStructure,
      home: QUERY_DEPENDENCIES.getMenuHome,
      status: QUERY_DEPENDENCIES.getMenuStatus,
      preview: QUERY_DEPENDENCIES.getMenuPreview,
    } satisfies Record<MenuReadPart, readonly string[]>;
    return [...new Set(parts.flatMap((part) => [...reads[part]]))];
  }
  // At time of sale names each line's category from the snapshot the line recorded
  // (`computeCategorySales`, packages/reporting/src/category-sales.ts), so no catalogue edit moves
  // it. A subset of the declared list, so `scripts/live-subscriptions.test.ts` still covers it.
  if (name === "getCategorySales" && (args as readonly unknown[])[2] === "at_time_of_sale") {
    const current: readonly string[] = CURRENT_CLASSIFICATION_READS;
    return QUERY_DEPENDENCIES.getCategorySales.filter((type) => !current.includes(type));
  }
  // Only a device's ask reads a `devices` row (a returning device's own) and its profile, and a
  // stored battery report rewrites a `devices` row (`PUT /api/device/battery`,
  // apps/server/src/device-api.ts).
  if (name === "joinRequests" && (args as readonly unknown[])[0] === "print_agent") {
    return QUERY_DEPENDENCIES.joinRequests.filter((type) => type === "join_requests");
  }
  return QUERY_DEPENDENCIES[name];
}

export function dashboardQuery<N extends DashboardQueryName>(
  api: DashboardApi,
  name: N,
  args: Arguments<N>,
): ResourceQuery<Result<N>> {
  let initial = true;
  return {
    key: JSON.stringify([name, args]),
    dependencies: dependenciesOf(name, args).map((type) => ({ type })),
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
