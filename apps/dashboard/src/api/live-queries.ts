import type { ResourceQuery } from "@waitron/dashboard-kit";
import type { DashboardApi, MenuReadPart } from "./client.js";

const MENU_PUBLICATION_READS = [
  "settings.menu",
  "menus",
  "categories",
  "settings.venue",
  "extra_list_items",
  "extra_lists",
  "kitchen_courses",
  "menu_item_variant_overrides",
  "menu_items",
  "menu_releases",
  "menu_versions",
  "option_labels",
  "option_lists",
  "product_modifiers",
  "products",
  "section_members",
  "sections",
  "set_menu_dish_courses",
  "set_menu_line_courses",
  "set_menu_lines",
  "set_menu_variant_exclusions",
  "units",
] as const;

const CURRENT_CLASSIFICATION_READS = ["products", "categories"] as const;

/** Dependencies describe the read model, independently of which operation changes it. */
const HIERARCHY_DELETE_READS = [
  "floor_zones",
  "floor_zones.today",
  "dining_tables",
  "dining_tables.today",
  "floor_plans",
  "floor_plan_tables",
  "floor_reset_tables",
  "table_merges",
  "parties",
  "party_tables",
  "working_orders",
  "working_order_lines",
  "ticket_items",
  "departments",
  "device_profiles",
  "device_approved_profiles",
  "devices",
  "routing_cells",
  "routing_cell_periods",
  "service_steps",
  "menu_periods",
  "opening_hours",
  "department_transfer_destinations",
  "department_transfer_requests",
  "floor_plan_sets",
] as const;

const TRANSLATION_READS = [
  "settings.venue",
  "products",
  "option_lists",
  "option_labels",
  "extra_lists",
  "sections",
  "section_members",
  "menus",
  "units",
] as const;

export const QUERY_DEPENDENCIES = {
  getZoneDeleteImpact: HIERARCHY_DELETE_READS,
  getDepartmentDeleteImpact: HIERARCHY_DELETE_READS,
  getMenuSettings: ["settings.menu", "settings.venue", "taxpayer"],
  getContentLanguages: ["settings.venue"],
  getVenueTheme: ["custom_themes", "media_images"],
  listThemes: ["custom_themes"],
  // The server works the rules out once at boot, so no table change moves them.
  getContentLanguageRules: [],
  getContentTranslationGaps: TRANSLATION_READS,
  getContentSuggestions: ["content_suggestions", "content_suggestion_jobs", ...TRANSLATION_READS],
  getContentTranslationTargets: [...TRANSLATION_READS, "content_suggestions"],
  getContentTranslationCells: TRANSLATION_READS,
  listPrinters: ["printers", "print_jobs"],
  listPrinterProfiles: ["device_profiles", "departments"],
  listPrinterStationNames: ["kitchen_stations"],
  listPagePrinters: ["printers", "print_agents"],
  getPagePrinterDeleteImpact: ["printers", "invoice_deliveries", "devices", "device_profiles"],
  getPrinterDeleteImpact: [
    "printers",
    "drawer_entries",
    "print_jobs",
    "invoice_deliveries",
    // The impact names devices by their printer choices.
    "devices",
    "device_profiles",
    "kitchen_stations",
  ],
  getDeviceDeleteImpact: [
    "devices",
    "payments",
    "bill_payments",
    "refunds",
    "working_orders",
    // Not `till_sessions`, which no module declares as a live resource.
    "printers",
    "card_readers",
    "join_requests",
    "kitchen_stations",
    "device_approved_profiles",
    "device_profiles",
  ],
  listRecentJobs: ["print_jobs", "printers", "print_agents", "invoice_deliveries"],
  listAgents: ["print_agents"],
  listReaders: ["card_readers", "device_profiles", "devices"],
  // Its provider check also reads `venue_credentials`, which no module declares as a live resource.
  getReaderDeleteImpact: ["card_readers", "payments", "devices", "device_profiles"],
  listReaderHolders: ["card_readers", "payments"],
  getProfileReaders: ["device_profiles", "card_readers"],
  // The route reads `venue_credentials`, which no module declares as a live resource.
  listPaymentProviders: [],
  getPaymentSettings: ["settings.payments"],
  // Scheduled runs have no live resource; the query polls passively.
  getBackupAudit: [],
  listModules: ["settings.payments", "settings.modules"],
  listStuckTenderRefunds: ["refunds", "sales", "invoice_series"],
  listStuckBillPayments: [
    "bill_payments",
    "payments",
    "payment_refunds",
    "working_orders",
    "devices",
  ],
  listAbandonedRefunds: ["payments", "payment_refunds", "working_orders"],
  listHeldPayments: ["payments", "working_orders"],
  listStuckBillRefunds: ["refunds", "bill_payments", "payments", "working_orders", "devices"],
  pairingMode: ["pairing"],
  // A device's ask; `dependenciesOf` narrows a print agent's.
  joinRequests: ["join_requests", "devices", "device_profiles", "pairing"],
  listDiscoveredPrinters: ["printer_discovery", "printers", "print_agents"],
  getSalesOverview: [
    "sales",
    "sale_voids",
    "sale_substitutions",
    "sale_lines",
    "tenders",
    "refunds",
    "bill_payments",
    "working_orders",
    "dining_tables",
    "dining_tables.today",
    "floor_zones",
    "party_tables",
    "products",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
  ],
  getOverdueOrders: [
    "ticket_items",
    "working_orders",
    "working_order_lines",
    "order_amendments",
    "kitchen_stations",
    "dining_tables",
    "dining_tables.today",
    "party_tables",
    "parties",
    "table_merges",
  ],
  getDailyClose: [
    "sale_substitutions",
    "sale_lines",
    "settings.business_day",
    "settings.venue",
    "sales",
    "sale_voids",
    "tenders",
    "refunds",
    "bill_payments",
    "working_orders",
    "sale_settlements",
    "devices",
    "day_cutover_changes",
  ],
  getSalesPeriod: [
    "sale_substitutions",
    "settings.business_day",
    "settings.venue",
    "sales",
    "sale_lines",
    "sale_voids",
    "tenders",
    "sale_settlements",
    "products",

    "day_cutover_changes",
  ],
  listOrdersPage: [
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
    "refunds",
    "persons",
    "settings.business_day",
    "day_cutover_changes",
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
    "refunds",
    "persons",
    "receipt_reprints",
    "print_jobs",
    "printers",
    "invoice_deliveries",
    "invoice_pdf_downloads",
    "outgoing_mail",
    "settings.business_day",
    "day_cutover_changes",
  ],
  getOrderPrinters: ["printers"],
  // The current mode's list; `dependenciesOf` narrows it at time of sale.
  getCategorySales: [
    "sales",
    "sale_lines",
    "sale_voids",
    "sale_substitutions",
    "settings.business_day",
    "settings.venue",
    ...CURRENT_CLASSIFICATION_READS,
    "day_cutover_changes",
  ],
  getDrawerCloses: [
    "drawer_entries",
    "printers",
    "devices",
    "persons",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
  ],
  getReportPrinters: ["printers"],
  listJobRoles: ["staff_roles", "person_staff_roles", "persons"],
  listStaff: ["persons", "person_roles", "webauthn_credentials"],
  listStaffPage: ["persons", "person_roles", "roles"],
  listAccessRoles: ["roles", "person_roles"],
  getStaffRoster: ["persons"],
  listPendingAbsences: ["absences"],
  listPendingSwaps: ["shift_swaps", "shifts"],
  listMenus: ["menus"],
  getMenuStructure: ["sections", "section_members", "menus"],
  getMenuStructures: ["sections", "section_members", "menus"],
  // `menuPrices` (packages/menu/src/operations.ts): the structure's tables for the placements,
  // then each reached product's menu item, menu and price, and its variants' overrides.
  getMenuPrices: [
    "sections",
    "section_members",
    "menu_items",
    "menus",
    "products",
    "menu_item_variant_overrides",
    "settings.venue",
    "product_modifiers",
    "extra_lists",
    "extra_list_items",
    "option_lists",
    "option_labels",
    "units",
  ],
  // The tables `menuStatus` and `previewMenu` read (packages/menu/src/menu-publication.ts); a
  // category's colour and the venue default colour are part of each offer's colour.
  getMenuRead: MENU_PUBLICATION_READS,
  getMenuStatuses: MENU_PUBLICATION_READS,
  getMenuStatus: MENU_PUBLICATION_READS,
  getMenuPreview: MENU_PUBLICATION_READS,
  getLiveMenu: ["menu_releases", "menu_versions"],
  // The route converts each time with the venue's zone.
  getMenuPublications: [
    "menu_releases",
    "menu_versions",
    "settings.business_day",
    "settings.venue",
  ],
  getMenuHome: ["sections", "section_members", "products", "menus"],
  listCategories: ["categories"],
  getCategory: ["categories"],
  listLibraryProducts: ["products"],
  listUnits: ["units"],
  listProducts: [
    "products",
    "categories",
    // A product's attached extras and options lists, read from `product_modifiers` alone
    // (`readProductModifiers`, packages/menu/src/product-modifiers.ts) — it names no list
    // table, so neither is named here.
    "product_modifiers",
  ],
  getFolderRouting: [
    "categories",
    "routing_cells",
    "routing_cell_periods",
    "kitchen_stations",
    "products",
    "floor_zones",
    "settings.business_day",
    "settings.venue",
    "day_cutover_changes",
  ],
  // The extras and options lists: the list table, then its children (`listOptionLists` and
  // `getOptionList` in packages/menu/src/options.ts, `listExtraLists` and `getExtraList` in
  // extras.ts). The two list reads also count what carries each list: `product_modifiers` for
  // both. The single-list reads count nothing.
  listOptionLists: ["option_lists", "option_labels", "product_modifiers"],
  getOptionList: ["option_lists", "option_labels"],
  listExtraLists: ["extra_lists", "extra_list_items", "product_modifiers"],
  getExtraList: ["extra_lists", "extra_list_items"],
  listDeviceProfiles: [
    "device_profiles",
    "devices",
    "device_profile_admission_roles",
    "staff_roles",
  ],
  getDeviceProfile: ["device_profiles", "device_profile_admission_roles", "staff_roles"],
  getProfileScopeChoices: ["departments", "floor_zones"],
  listProfileKitchenScreens: ["device_profiles", "kitchen_stations", "floor_zones"],
  listDevices: [
    "devices",
    "device_profiles",
    "kitchen_stations",
    "device_approved_profiles",
    // Each device's equipment (`readDevicesEquipment`, apps/server/src/device-equipment.ts).
    "printers",
    "card_readers",
    // Each device's kitchen screens (`readDevicesKitchenScreens`, packages/venue-service).
    "floor_zones",
  ],
  getStationDeleteImpact: [
    "ticket_items",
    "working_order_lines",
    "working_orders",
    "dining_tables",
    "dining_tables.today",
    "party_tables",
    "parties",
    "order_drafts",
    "order_draft_lines",
    "kitchen_stations",
    "printers",
    "devices",
    "device_profiles",
    "routing_cells",
    "routing_cell_periods",
    "floor_zones",
    "table_merges",
  ],
  getCourseDeleteImpact: ["kitchen_courses", "products", "service_steps"],
  listStations: ["kitchen_stations"],
  listCourses: ["kitchen_courses"],
  listZones: ["floor_zones"],
  getFloorPlan: [
    "floor_plans",
    "floor_plan_sets",
    "departments",
    "floor_zones",
    "floor_plan_placements",
    "floor_plan_tables",
    "dining_tables",
  ],
  listMyAbsences: ["absences"],
  listMyShifts: [
    "shifts",
    "roster_versions",
    "employments",
    "settings.business_day",
    "settings.venue",
  ],
  listMySwaps: ["shift_swaps", "shifts"],
  getPlannedVsActual: [
    "roster_versions",
    "settings.business_day",
    "settings.venue",
    "shifts",
    "time_entries",
    "employments",
  ],
  getRoster: ["shifts", "roster_versions", "employments", "absences"],
  listPrinterStations: ["kitchen_stations"],
  listPurchaseInvoices: ["purchase_invoices", "purchase_invoice_vat"],
  getDepartmentReceipt: ["departments", "settings.business_day", "settings.venue"],
  // Each active device's resolved receipt printer (`activeReceiptSettings` in receipt-preview-api.ts).
  getReceiptPaperWidths: ["printers", "devices", "device_profiles"],
  getVenueDetails: [
    "settings.business_day",
    "settings.venue",
    "taxpayer",
    "sales",
    "working_orders",

    "day_cutover_changes",
  ],
  getReceiptLanguage: ["settings.business_day", "settings.venue"],
  getVenueDefaults: ["settings.business_day", "settings.venue", "settings.menu"],
  getVenuePrivacy: ["settings.venue"],
  getProfile: ["persons", "webauthn_credentials"],
  // The taxpayer's legal name; the language list itself is fixed.
  getLocales: ["taxpayer"],
  getGoogleConfig: ["google_config", "settings.venue"],
  getEmailInbox: ["email_inbox"],
  listReturnedInvoices: ["nodes", "settings.venue", "settings.business_day", "day_cutover_changes"],
  // `removable` reads whether the machine has a `nodes` row here, so a new row moves it too.
  // `box_joins`: a new box's join request is held in memory, so the store announces it.
  listServers: ["node_membership", "nodes", "box_joins"],
  getBackupStatus: ["backup_status", "settings.backup"],
  getStreamSettings: ["backup_status", "settings.backup"],
  // Its answer ages with time and reads the box's key files, the running backups' key, node.db's
  // server key name and Cloud's emergency state, none of which send an event, so its timer stays.
  getRecoveryPackStatus: [
    "recovery_packs",
    "persons",
    "backup_status",
    "settings.backup",
    "settings.business_day",
  ],
  // The answer is built from the box's own files and the process's role, not from any table.
  getCloudStatus: [],
  // Read from Cloud, which no table change reports; the server lets one read a minute through.
  getCloudBilling: [],
  getCloudEmergency: [],
  getCloudEmergencyPeople: ["persons", "person_roles", "roles"],
  // Mostly the box's disk, clock and processes, which no table change reports, so the timer
  // refreshes it; its sales, printer and reader rows wait for the timer too.
  getBoxHealth: [],
  getBoxNetwork: [],
  listAlerts: ["incidents", "content_suggestion_jobs", "content_suggestions", ...TRANSLATION_READS],
  listHandledAlerts: ["incidents", "persons"],
  // The stop is process state no table reports, so the timer reads it; `incidents` holds the
  // deletion it names.
  getDiskStop: ["incidents"],
  // In-memory build state, published on each change. The shell reads it faster while a file of the
  // person's is being prepared and the stream is down.
  getTaxOfficeMonthDownload: ["tax_office_download"],
} as const;

export type DashboardQueryName = keyof typeof QUERY_DEPENDENCIES;

export const QUIET_WHILE_CONNECTED: ReadonlySet<DashboardQueryName> = new Set([
  "getMenuSettings",
  "listMenus",
  "getMenuStructure",
  "getMenuStructures",
  "getMenuPrices",
  "getMenuHome",
  "listCategories",
  "getCategory",
  "listLibraryProducts",
  "listProducts",
  "listUnits",
  "listOptionLists",
  "getOptionList",
  "listExtraLists",
  "getExtraList",
  "getVenueTheme",
  "listThemes",
  "listPrinters",
  "listPrinterProfiles",
  "listPrinterStationNames",
  "listPagePrinters",
  "listPrinterStations",
  "getPrinterDeleteImpact",
  "listReaders",
  "listReaderHolders",
  "getProfileReaders",
  "listHeldPayments",
  "getDailyClose",
  "getSalesPeriod",
  "getCategorySales",
  "getDrawerCloses",
  "getReportPrinters",
  "getOrderPrinters",
  "listOrderStaff",
  "listStaff",
  "listStaffPage",
  "getStaffRoster",
  "getProfile",
  "listPendingAbsences",
  "listPendingSwaps",
  "getRoster",
  "listMySwaps",
  "listMyAbsences",
  "listDeviceProfiles",
  "getDeviceProfile",
  "listProfileKitchenScreens",
  "getProfileScopeChoices",
  "listDevices",
  "listStations",
  "listCourses",
  "listZones",
  "getFloorPlan",
  "getStationDeleteImpact",
  "getCourseDeleteImpact",
  "getReceiptLanguage",
  "getVenueDefaults",
  "getVenuePrivacy",
  "listPurchaseInvoices",
  "getContentLanguages",
  "getContentTranslationGaps",
  "getContentTranslationTargets",
  "getContentTranslationCells",
  "getGoogleConfig",
  "getLocales",
  "getDepartmentReceipt",
  "getReceiptPaperWidths",
  "pairingMode",
  "getTaxOfficeMonthDownload",
]);

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
  // (`computeCategorySales`, packages/reporting/src/category-sales.ts), so no menu edit moves
  // it. A subset of the declared list, so `scripts/live-subscriptions.test.ts` still covers it.
  if (name === "getCategorySales" && (args as readonly unknown[])[2] === "at_time_of_sale") {
    const current: readonly string[] = CURRENT_CLASSIFICATION_READS;
    return QUERY_DEPENDENCIES.getCategorySales.filter((type) => !current.includes(type));
  }
  // Print-agent requests omit returning-device details and pairing claims.
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
    quietWhileConnected: QUIET_WHILE_CONNECTED.has(name),
    read: () => {
      const client = initial ? api : (api.background ?? api);
      initial = false;
      const read = client[name] as (...args: Arguments<N>) => Promise<Result<N>>;
      return read.apply(client, args);
    },
    refreshMs:
      name === "getOverdueOrders" || name === "getDiskStop"
        ? 30_000
        : name === "pairingMode" || name === "listDiscoveredPrinters"
          ? 5_000
          : name === "getBoxHealth" || name === "listRecentJobs"
            ? 15_000
            : name === "getEmailInbox" || name === "getBackupStatus" || name === "getStreamSettings"
              ? 10_000
              : 60_000,
  };
}
