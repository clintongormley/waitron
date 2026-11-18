import { madridWithPhotos } from "./testing/madrid-photos.js";
import { madridWithMenuReleases } from "./testing/madrid-releases.js";
import { withTransaction, persons, deviceProfiles } from "@waitron/db";
import { listStaffAdmittedTo } from "@waitron/identity";
import { STARTER_JOB_ROLE_NAMES, DEMO_JOB_ROLE_NAMES } from "@waitron/provisioning";
import { madridWithRenamedTables } from "./testing/madrid-renamed-tables.js";
import { madridWithFoldedTables } from "./testing/madrid-folded-tables.js";
import {
  madridWithDocument,
  madridWithMenuSettings,
  madridWithProductUnits,
  madridWithOptionDefaults,
  madridWithSectionColumns,
} from "./testing/madrid-documents.js";
import { stable, recomputeMadridHashes } from "./testing/madrid-semantics.js";
import {
  madridWithDroppedColumns,
  type MadridColumnDrops,
} from "./testing/madrid-dropped-columns.js";
import { afterEach, expect, it, vi } from "vitest";
import { STARTER_COURSE_NAMES, STARTER_STEP_NAMES } from "@waitron/venue-service";
import { createHash } from "node:crypto";
import {
  canonicalMadridSemantics,
  readMadridSemantics,
  type CanonicalMadridSemantics,
} from "./testing/madrid-semantics.js";
import { readFile } from "node:fs/promises";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEMO_BASELINE_FIXTURE_ROOTS } from "@waitron/country-packs/demo/testing";
import { getCountryPack } from "@waitron/country-packs";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";
import { seedDemoRestaurant } from "./seed.js";
import { CASA_DELGADO_ES } from "./testing/data.js";
import { madridWithNameChanges, type MadridNameChange } from "./testing/madrid-name-changes.js";
import {
  madridWithVatClassChanges,
  type MadridVatClassChange,
} from "./testing/madrid-vat-class-changes.js";
import { madridWithSharedOffers, type MadridSharedOffers } from "./testing/madrid-shared-offers.js";
import {
  madridWithPeriodChanges,
  type MadridPeriodChange,
} from "./testing/madrid-period-changes.js";
import {
  madridWithRenamedColumns,
  type MadridColumnRenames,
} from "./testing/madrid-renamed-columns.js";

const madridProduct = (image: string) => `@products:${JSON.stringify([`${image}.webp`])}`;
// Food and drink served to consume on the spot take the reduced rate (LIVA art. 91.Uno.2.2.º);
// cheese sold as takeaway goods takes the super-reduced rate (art. 91.Dos.1.1.º d).
const VAT_CLASS_CHANGES: MadridVatClassChange[] = [
  ...[
    "280134add33e12b0502b965b87238409e8c250f7c3a42c6924bc427e9471a1f1", // cola
    "3484f1297e957c98ea54ac37a61f8bc699987bca90de4038d5255aa253110bfc", // beer
    "6a8776dad20e3c5c33c9250d1a6194a4a2ed84d0801d4d8a6ee369898191766c", // house red
    "881a1845feb901650439bc8782fe901e1dfa72ddfa2f3a6eb567ff38571d2db9", // orange juice
    "8e1f6221032d4b13be3b36a7498ac093fd0a367ef884cc8e55b1b3c359f1371e", // Negroni
    "b42524320b8b00b22ddf5505d841e69f543ccc24a86329d6b2afe502a5f0212c", // coffee
  ].map((image) => ({ product: madridProduct(image), old: "general", new: "reduced" })),
  {
    product: madridProduct("f4ae2b215528535991520043d04b31ec065084db5e64ad95c0649588d9f1cd0a"), // house bread
    old: "super_reduced",
    new: "reduced",
  },
  ...[
    "9aac018dd11a92b4e5ebd758d6b20546e8950d4afe302ba785b8c1b1d55ad4c7", // Manchego
    "e3b26cf7fdac8abf2376845694333860c2d1ea55879192c260da50e5ee753b60", // Cabrales
    "480a3dcb16ce22d82ffbffbd33eb533533371bf424ebc3cdd3a447bae089e721", // Idiazábal
    "97ea61c280d89434fd67716ef312f28862c9b689c8d8fb397408cff31a39c1f0", // Torta del Casar
    "d51ec2b2e6c7f9ff0e66731d405ec20f103ea2caade5dd4aa9ea61a77ad22401", // Mahón
  ].map((image) => ({ product: madridProduct(image), old: "reduced", new: "super_reduced" })),
];

const DRINK_IMAGES = {
  cola: "280134add33e12b0502b965b87238409e8c250f7c3a42c6924bc427e9471a1f1.webp",
  colaZero: "1697b140ce241b4ec3c003b86fc62e4212780eff2c2659b3ee71117aa85564a6.webp",
  beer: "4b2c42eed14559d95309ef3b2e63ad31a625ee1d9db7212326c6b2258eb14a5c.webp",
};
interface SharedDrinkNames {
  department: string;
  menus: { drinks: string; casa: string; lunch: string; deli: string };
  categories: { soft: string; wineAndBeer: string };
  deliSection: string;
  zone: string;
  station: string;
  colaZero: { name: string; kitchenName: string };
  beer: { name: string; kitchenName: string };
}
// The restaurant's cola, and its new Coca-Cola Zero and bottled beer, are listed in the deli and
// take away at the general class; the deli sells to take away and makes its drinks itself.
const sharedDrinks = (names: SharedDrinkNames): MadridSharedOffers => {
  const menu = (name: string) => `@catalogues:${stable([name])}`;
  const product = (image: string) => `@products:${stable([image])}`;
  const category = (name: string) => `@categories:${stable([name])}`;
  const section = (menuName: string, role: string, name: string) =>
    `@sections:${stable([menu(menuName), role, name])}`;
  const menus = names.menus;
  const restaurantMenus = [menus.drinks, menus.casa, menus.lunch];
  const added = [DRINK_IMAGES.colaZero, DRINK_IMAGES.beer];
  const deliSection = section(menus.deli, "section", names.deliSection);
  return {
    changed: [
      {
        table: "departments",
        row: `@departments:${stable([names.department])}`,
        column: "dining",
        from: "eat_in",
        to: "takeaway",
      },
      {
        table: "products",
        row: product(DRINK_IMAGES.cola),
        column: "takeaway_vat_class",
        from: null,
        to: "general",
      },
    ],
    products: [
      {
        image: DRINK_IMAGES.colaZero,
        ...names.colaZero,
        customerName: { en: "Coca-Cola Zero can (33 cl)", es: "Coca-Cola Zero en lata (33 cl)" },
        category: names.categories.soft,
        vatClass: "reduced",
        takeawayVatClass: "general",
        unitPrice: 180,
        pricingUnit: "each",
      },
      {
        image: DRINK_IMAGES.beer,
        ...names.beer,
        customerName: { en: "Bottle of lager (33 cl)", es: "Botellín de cerveza (33 cl)" },
        category: names.categories.wineAndBeer,
        vatClass: "reduced",
        takeawayVatClass: "general",
        unitPrice: 160,
        pricingUnit: "each",
      },
    ],
    added: {
      products: added.map((image) => [product(image)]),
      media_images: added.map((image) => [image]),
      media_blobs: added.map((image) => [image.split(".")[0]]),
      menu_items: [
        ...restaurantMenus.flatMap((name) => added.map((image) => [menu(name), product(image)])),
        ...[DRINK_IMAGES.cola, ...added].map((image) => [menu(menus.deli), product(image)]),
      ],
      menu_version_images: [
        ...restaurantMenus.flatMap((name) =>
          added.map((image) => [`@menu_versions:${stable([menu(name), 1])}`, image]),
        ),
        ...[DRINK_IMAGES.cola, ...added].map((image) => [
          `@menu_versions:${stable([menu(menus.deli), 1])}`,
          image,
        ]),
      ],
      sections: [[deliSection]],
      section_members: [
        [
          section(menus.drinks, "section", names.categories.soft),
          product(DRINK_IMAGES.colaZero),
          null,
        ],
        [
          section(menus.drinks, "section", names.categories.wineAndBeer),
          product(DRINK_IMAGES.beer),
          null,
        ],
        [section(menus.deli, "menu_root", menus.deli), null, deliSection],
        ...[DRINK_IMAGES.cola, ...added].map((image) => [deliSection, product(image), null]),
      ],
      routing_cells: [names.categories.soft, names.categories.wineAndBeer].map((name) => [
        category(name),
        null,
        `@floor_zones:${stable([names.zone])}`,
        `@kitchen_stations:${stable([names.station])}`,
      ]),
    },
    changedOffers: restaurantMenus.map((name) => ({
      menuItem: `@menu_items:${stable([menu(name), product(DRINK_IMAGES.cola)])}`,
      field: "takeawayVatClass",
      from: "reduced",
      to: "general",
    })),
  };
};
const SHARED_DRINKS: Record<"en" | "es", MadridSharedOffers> = {
  en: sharedDrinks({
    department: "Deli",
    menus: { drinks: "Drinks", casa: "Casa Delgado", lunch: "Set lunch", deli: "Deli takeaway" },
    categories: { soft: "Soft drinks", wineAndBeer: "Wine and beer" },
    deliSection: "Drinks",
    zone: "Deli counter",
    station: "Deli prep",
    colaZero: { name: "Coca-Cola Zero", kitchenName: "COCA-COLA ZERO · BAR" },
    beer: { name: "Bottled beer", kitchenName: "BOTTLED BEER · BAR" },
  }),
  es: sharedDrinks({
    department: "Charcutería",
    menus: {
      drinks: "Bebidas",
      casa: "Casa Delgado",
      lunch: "Menú del Día",
      deli: "Charcutería para llevar",
    },
    categories: { soft: "Refrescos", wineAndBeer: "Vino y cerveza" },
    deliSection: "Bebidas",
    zone: "Mostrador de charcutería",
    station: "Preparación de charcutería",
    colaZero: { name: "Coca-Cola Zero", kitchenName: "COCA-COLA ZERO · BARRA" },
    beer: { name: "Botellín", kitchenName: "BOTELLÍN · BARRA" },
  }),
};
const periodChange = (
  department: string,
  replaced: string,
  [bar, lunch, dinner]: [string, string, string],
  menus: { drinks: string; casa: string; lunch: string },
): MadridPeriodChange => ({
  department: `@departments:${JSON.stringify([department])}`,
  replaced,
  periods: [
    { name: bar, colour: "red", menu: menus.drinks, staffMenus: [] },
    { name: lunch, colour: "orange", menu: menus.casa, staffMenus: [menus.lunch] },
    { name: dinner, colour: "amber", menu: menus.casa, staffMenus: [] },
  ],
  week: [
    { period: bar, startsAt: "09:00:00", endsAt: "13:00:00" },
    { period: lunch, startsAt: "13:00:00", endsAt: "16:00:00" },
    { period: bar, startsAt: "16:00:00", endsAt: "20:00:00" },
    { period: dinner, startsAt: "20:00:00", endsAt: "23:00:00" },
    { period: bar, startsAt: "23:00:00", endsAt: "00:00:00" },
  ],
  occurrence: { period: bar, startsAt: "09:00" },
});
const menu = (name: string) => `@catalogues:${JSON.stringify([name])}`;
const PERIOD_CHANGES: Record<"en" | "es", MadridPeriodChange> = {
  en: periodChange("Restaurant and bar", "Open", ["Bar", "Lunch", "Dinner"], {
    drinks: menu("Drinks"),
    casa: menu("Casa Delgado"),
    lunch: menu("Set lunch"),
  }),
  es: periodChange("Restaurante y bar", "Abierto", ["Bar", "Comida", "Cena"], {
    drinks: menu("Bebidas"),
    casa: menu("Casa Delgado"),
    lunch: menu("Menú del Día"),
  }),
};

const DROPPED_COLUMNS: MadridColumnDrops = {
  webauthn_credentials: ["name"],
  card_readers: ["active"],
  taxpayer: ["privacy_notice_url", "privacy_email"],
  payment_refunds: ["provider", "payment_ref"],
  node_membership: ["term"],
  persons: ["role"],
  device_profile_admission_roles: ["role"],
  nodes: ["location_id"],
  adjustment_reasons: ["apply_roles", "approver_roles"],
  devices: ["location_id", "created_at"],
  working_orders: ["location_id"],
  tender_refunds: ["location_id"],
  join_requests: ["location_id"],
  dining_tables: ["location_id"],
  floor_plan_sets: ["location_id"],
  floor_zones: ["location_id"],
  kitchen_stations: ["location_id"],
  kitchen_courses: ["location_id"],
  print_agents: ["location_id"],
  printers: ["location_id", "ticket_scope", "pickup_roles"],
  print_jobs: ["location_id"],
  department_sale_policies: ["receipt_print_mode"],
  zone_sale_policies: ["receipt_print_mode"],
  departments: ["location_id"],
  sales: ["operation_date"],
  zone_service_policies: ["location_id"],
  routing_cells: ["location_id"],
  seasons: ["location_id"],
  special_days: ["location_id"],
  special_day_dates: ["location_id"],
  bookings: ["location_id"],
  attendance_days: ["location_id", "deferred_shift_ids"],
  attendance_questions: ["location_id", "business_day", "start_at", "end_at"],
  attendance_answers: ["location_id"],
  roster_versions: ["location_id"],
  shift_templates: ["location_id"],
  shifts: ["location_id"],
  staff_roles: ["location_id"],
  convenio_config: ["location_id"],
};

const RENAMED_COLUMNS: MadridColumnRenames = {};
/** Tables added after the capture; the seed writes no row to them. */
const ADDED_TABLES = [
  "sign_in_challenges",
  "staff_activity",
  "returned_invoice_records",
  "outgoing_mail",
  "adjustment_lines",
  "device_invoice_save_operations",
  "document_delivery_requests",
  "document_delivery_sequences",
  "document_page_jobs",
  "document_page_reprints",
  "fiscal_conflict_evidence",
  "fiscal_lookup_conflicts",
  "fiscal_series_conflicts",
  "handover_activations",
  "handover_return_batches",
  "invoice_correction_refunds",
  "invoice_corrections",
  "order_events",
  "recovery_packs",
  "sale_line_dishes",
  "deferred_closures",
  "declaraciones_responsables",
  "set_menu_lines",
  "set_menu_line_courses",
  "set_menu_variant_exclusions",
  "set_menu_dish_courses",
];
const REMOVED_TABLES_WITH_ROWS = ["location_catalogues", "locations"];
const REMOVED_TABLES = [
  "sale_receipt_guests",
  "sale_receipt_headers",
  "order_group_events",
  "order_draft_events",
  "working_line_contexts",
  "printer_holders",
  "page_printers",
  "order_service_contexts",
  "bill_edit_states",
  "working_order_counters",
  "shift_assignments",
  "webauthn_challenges",
  "google_oidc_states",
  "totp_enrollments",
  "workforce_chains",
  "attendance_source_state",
  "attendance_operation_facts",
  "device_kitchen_screens",
  "device_kitchen_screen_stations",
  "device_kitchen_screen_zones",
  "device_kitchen_screen_removals",
  "device_profile_kitchen_screens",
  "device_profile_kitchen_screen_stations",
  "device_profile_kitchen_screen_zones",
  "device_zone_selections",
  "device_zone_selection_zones",
  "device_profile_admission_persons",
  "floor_plan_table_parts",
  "floor_plan_table_sizes",
  "floor_reset_table_parts",
  "order_draft_recalled_lines",
  "payment_policy",
  "tenant_receipts",
  "ingredients",
  "recipe_lines",
  "attendance_mail",
  "membership_clearances",
  "membership_removals",
  "adjustment_settings",
  "mirror_config",
  "node_roles",
  "pass_item_marks",
  "content_languages",
  "holiday_geographies",
];
// The baseline rebuild moves these columns before the named anchor, retaining their metadata.
const REBUILT_COLUMN_ORDER: Record<string, readonly (readonly string[])[]> = {
  adjustments: [
    ["line_name", "comped_extras"],
    ["created_at", "charge_kept", "preparation_started", "refund_handoff", "refund_value"],
  ],
  bookings: [["tab_id", "table_label"]],
  bill_payments: [["state", "remaining_after"]],
  card_readers: [["created_at", "prints_own_slip_automatically"]],
  convenio_config: [
    [
      "created_at",
      "split_min_segment_minutes",
      "split_max_segment_minutes",
      "split_min_gap_minutes",
      "continuous_paid_break_minutes",
    ],
  ],
  departments: [
    ["created_at", "needs_clearing", "late_send_needs_manager", "release_reminder_minutes"],
  ],
  devices: [
    ["label", "invoice_printer_id", "invoice_page_printer_id"],
    ["last_seen_at", "deleted_at"],
  ],
  dining_tables: [["zone_id", "short_name", "short_name_key"]],
  envios: [["csv", "technical_incidence"]],
  floor_plan_tables: [["seats", "short_name"]],
  floor_reset_tables: [["seats", "short_name"]],
  invoice_deliveries: [["person_id", "made_by_retry", "printer_chosen"]],
  kitchen_courses: [["created_at", "held_until_fired"]],
  kitchen_stations: [
    ["is_default", "ready_warning_after_minutes"],
    [
      "created_at",
      "shows_rest_of_order",
      "print_moved_slips",
      "colour",
      "ticket_grouping",
      "print_held_work",
      "bump_mode",
      "changes_after_sending",
      "waits_for_pass",
    ],
  ],
  order_draft_lines: [
    ["no_merge", "make_at_station_id", "slot", "join_group_id", "after_group_id"],
  ],
  order_drafts: [["owner_id", "bill_id"]],
  order_groups: [
    ["state", "display_number", "number_party_id"],
    ["created_at", "request_kind"],
  ],
  payment_refunds: [["created_at", "provider_refund_ref"]],
  payments: [
    ["state", "requested_amount"],
    ["card_scheme", "external_provider", "external_machine"],
  ],
  persons: [
    ["first_names", "display_name_folded"],
    ["pending_email", "email_folded"],
    ["email_verified_at", "pending_email_folded"],
  ],
  print_agents: [["node_id", "setup_url", "setup_port"]],
  print_jobs: [["status", "receipt_copy", "receipt_handover"]],
  printers: [["active", "portable"]],
  products: [
    ["customer_name", "name_key"],
    ["allergens", "color"],
  ],
  registros_facturacion: [
    ["source", "corrects_registro_id"],
    ["tipo_rectificativa", "subsanacion", "rechazo_previo", "sin_registro_previo"],
  ],
  sale_lines: [["classification", "list_gross", "list_unit_price_gross"]],
  sales: [
    [
      "authorized_by",
      "counterparty_identifier_type",
      "counterparty_identifier_country_code",
      "counterparty_address",
      "taxpayer_domicile",
    ],
  ],
  taxpayer: [["created_at", "taxpayer_domicile", "privacy_notice_url", "privacy_email"]],
  ticket_items: [
    ["note", "requested_at", "pass_controlled", "station_chosen_at", "station_retained_at_release"],
  ],
  units: [["name", "staff_name", "staff_abbreviation"]],
  webauthn_credentials: [["created_at", "aaguid"]],
  working_orders: [
    ["collected_at", "delivery_table_label"],
    [
      "payment_attempt_at",
      "invoice_type",
      "recipient_tax_id",
      "recipient_legal_name",
      "recipient_address",
      "recipient_country_code",
      "recipient_identifier_type",
      "recipient_identifier_country_code",
      "invoice_delivery",
      "receipt_locale",
    ],
  ],
};
// Each entry lists the captured foreign-key groups in their rebuilt id order.
const REBUILT_FOREIGN_KEY_ORDER: Record<string, readonly number[]> = {
  devices: [5, 6, 0, 1, 2, 3, 4],
  floor_today_zones: [1, 0],
  order_draft_lines: [2, 3, 4, 0, 1],
  order_drafts: [1, 0],
  print_jobs: [3, 4, 0, 1, 2],
  tenders: [1, 0],
};
const byName = <T>(tables: Record<string, T>) =>
  Object.fromEntries(Object.entries(tables).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
afterEach(() => vi.useRealTimers());
for (const locale of ["en", "es"] as const) {
  it(`preserves every Madrid seed row (${locale})`, async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
    const before = await readMadridSemantics(suite.db);
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 95_000_000,
      invoiceLocale: "es-ES",
      nifFormat: "calculated",
      adminPin: "5555",
    })();
    const provisioned = await readMadridSemantics(suite.db);
    await seedDemoRestaurant(suite.db, {
      venue,
      locale,
      salesDays: 0,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      dataSet: CASA_DELGADO_ES,
    });
    await withTransaction(suite.db, async (tx) => {
      const admitted = new Set<string>();
      for (const profile of await tx.select().from(deviceProfiles))
        for (const person of await listStaffAdmittedTo(tx, profile.id))
          admitted.add(person.personId);
      expect(admitted.size).toBe(6);
      expect((await tx.select().from(persons)).every((person) => admitted.has(person.id))).toBe(
        true,
      );
    });
    const seeded = await readMadridSemantics(suite.db);
    expect(seeded.tables.dashboard_sessions!.rows).toEqual(
      provisioned.tables.dashboard_sessions!.rows,
    );
    expect(seeded.tables.products!.rows.length).toBeGreaterThan(45);
    const canonical = {
      before: await canonicalMadridSemantics(before),
      provisioned: await canonicalMadridSemantics(provisioned),
      seeded: await canonicalMadridSemantics(seeded),
    };
    const historicalSeeded = madridWithRenamedTables(canonical.seeded, { menus: "catalogues" });
    for (const row of Object.values(historicalSeeded.tables.sections!.rows))
      if (row.role === "menu_root")
        row.internal_name =
          historicalSeeded.tables.catalogues!.rows[String(row.owner_menu_id)]!.name;
    for (const row of Object.values(historicalSeeded.tables.section_members!.rows)) {
      row.folder_overrides = {
        ...(row.folder_names === null ? {} : { names: row.folder_names }),
        ...(row.folder_image_fixed === 1 ? { image: row.folder_image } : {}),
        ...(row.folder_color_fixed === 1 ? { color: row.folder_color } : {}),
      };
      for (const column of [
        "folder_names",
        "folder_image",
        "folder_image_fixed",
        "folder_color",
        "folder_color_fixed",
      ])
        delete row[column];
    }
    const root = DEMO_BASELINE_FIXTURE_ROOTS[CASA_DELGADO_ES.id];
    expect(root).toBeInstanceOf(URL);
    const fixtureName = `madrid-before-move.${locale}.json`;
    const text = await readFile(new URL(fixtureName, root), "utf8");
    const expected = JSON.parse(text) as Record<
      "before" | "provisioned" | "seeded",
      CanonicalMadridSemantics
    >;
    for (const [email, displayNameFolded] of [
      ["diego@demo.waitron.local", "diego molina"],
      ["javier@demo.waitron.local", "javier torres"],
      ["lucia@demo.waitron.local", "luc\u00eda fern\u00e1ndez"],
      ["manager@demo.waitron.local", "marta ruiz"],
      ["sofia@demo.waitron.local", "sof\u00eda navarro"],
    ] as const) {
      const row = expected.seeded.tables.persons!.rows[`@persons:${stable([email])}`]!;
      expect([row.display_name_folded, row.email_folded]).toEqual([null, null]);
      row.display_name_folded = displayNameFolded;
      row.email_folded = email;
    }
    expect(historicalSeeded.tables.payments!.rows).toEqual({});
    historicalSeeded.tables.payments = structuredClone(expected.seeded.tables.payments!);
    for (const name of ["payment_resolutions", "payment_holds", "payment_hold_outcomes"]) {
      expect(expected.seeded.tables[name]!.rows).toEqual({});
      historicalSeeded.tables[name] = structuredClone(expected.seeded.tables[name]!);
    }
    const publicationTemplate = expected.seeded.tables.menu_publications!;
    const rows = Object.values(historicalSeeded.tables.menu_releases!.rows).map((row) => ({
      menu_id: row.menu_id,
      version_id: row.version_id,
      published_at: row.activates_at,
    }));
    historicalSeeded.tables.menu_publications = {
      ...publicationTemplate,
      rows: Object.fromEntries(rows.map((row) => [stable(row), row])),
    };
    historicalSeeded.tables.menu_scheduled_publications = structuredClone(
      expected.seeded.tables.menu_scheduled_publications!,
    );
    delete historicalSeeded.tables.menu_releases;
    const historicalVersions = historicalSeeded.tables.menu_versions!;
    historicalVersions.columns = expected.seeded.tables.menu_versions!.columns;
    for (const row of Object.values(historicalVersions.rows)) {
      row.published_at = row.created_at;
      expect(row.created_by).toBe('@persons:["owner@example.test"]');
      row.published_by = "demo-seed";
      delete row.created_at;
      delete row.created_by;
    }
    for (const [side, parent, key, fields] of [
      ["category_details", "categories", "category_id", ["parent_id", "color"]],
      [
        "menu_details",
        "catalogues",
        "menu_id",
        [
          "handheld_columns",
          "handheld_tiles",
          "handheld_order",
          "till_columns",
          "till_tiles",
          "till_order",
        ],
      ],
    ] as const) {
      const target = historicalSeeded.tables[parent]!;
      const rows: Record<string, Record<string, unknown>> = {};
      for (const row of Object.values(target.rows)) {
        const detail: Record<string, unknown> = { [key]: row.id };
        for (const field of fields) {
          detail[field] = row[field];
          delete row[field];
        }
        if (side === "menu_details") {
          const owned = Object.values(historicalSeeded.tables.sections!.rows).filter(
            (section) => section.owner_menu_id === row.id,
          );
          detail.root_section_id = owned.find((section) => section.role === "menu_root")!.id;
          detail.default_home_layout_id = owned.find(
            (section) => section.role === "home_layout",
          )!.id;
          row.version = 1;
        }
        rows[stable(detail)] = detail;
      }
      historicalSeeded.tables[side] = {
        ...structuredClone(expected.seeded.tables[side]!),
        rows: Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b))),
      };
      target.columns = target.columns.filter((column) => !fields.includes(column.name as never));
      if (parent === "catalogues")
        target.columns.splice(
          target.columns.findIndex((column) => column.name === "created_at"),
          0,
          { name: "version", type: "INTEGER", notnull: 1, dflt_value: "1", pk: 0 },
        );
      else target.foreignKeys = expected.seeded.tables.categories!.foreignKeys;
    }
    // The checked added-row adapter consumes the frozen schema before the unit fold below.
    historicalSeeded.tables.product_units = {
      ...structuredClone(expected.seeded.tables.product_units!),
      rows: {},
    };
    const historicalProducts = historicalSeeded.tables.products!;
    historicalProducts.columns = historicalProducts.columns.map((column) =>
      column.name === "unit_id" ? { ...column, name: "pricing_unit" } : column,
    );
    historicalProducts.foreignKeys = expected.seeded.tables.products!.foreignKeys;
    for (const row of Object.values(historicalProducts.rows)) {
      const unitId = row.unit_id;
      const unit =
        unitId === null ? undefined : historicalSeeded.tables.units!.rows[String(unitId)];
      row.pricing_unit =
        row.parent_id !== null ? null : unit?.hardware_unit == null ? "each" : "weight";
      if (unitId !== null) {
        const assignment = { product_id: row.id!, unit_id: unitId! };
        historicalSeeded.tables.product_units.rows[stable(assignment)] = assignment;
      }
      delete row.unit_id;
    }
    historicalSeeded.tables.product_units.rows = Object.fromEntries(
      Object.entries(historicalSeeded.tables.product_units.rows).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
    const historicalLabels = historicalSeeded.tables.option_labels!;
    const historicalLists = historicalSeeded.tables.option_lists!;
    historicalLists.columns = expected.seeded.tables.option_lists!.columns;
    historicalLabels.columns = expected.seeded.tables.option_labels!.columns;
    for (const row of Object.values(historicalLists.rows))
      row.default_label_id =
        Object.values(historicalLabels.rows).find(
          (label) => label.list_id === row.id && label.is_default === 1,
        )?.id ?? null;
    for (const row of Object.values(historicalLabels.rows)) delete row.is_default;
    const manifest = JSON.parse(
      await readFile(new URL("madrid-before-move.manifest.json", root), "utf8"),
    ) as {
      originalMain: string;
      fixtures: Record<string, string>;
      phases: Record<string, Record<string, Record<string, number>>>;
      seedChanges: Record<
        string,
        Record<string, { added: string[]; changed: string[]; deleted: string[] }>
      >;
    };
    expect(manifest.originalMain).toBe("d5c7ccb1a7ad8c0a936f6bc7a10b98c56b463360");
    expect(createHash("sha256").update(text).digest("hex")).toBe(manifest.fixtures[fixtureName]);
    const originalChanges: Record<
      string,
      { added: string[]; changed: string[]; deleted: string[] }
    > = {};
    for (const [name, table] of Object.entries(expected.seeded.tables)) {
      const before = expected.provisioned.tables[name]!.rows;
      const after = table.rows;
      const delta = {
        added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
        changed: Object.keys(after).filter(
          (key) =>
            Object.hasOwn(before, key) &&
            JSON.stringify(after[key]) !== JSON.stringify(before[key]),
        ),
        deleted: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
      };
      if (Object.values(delta).some((keys) => keys.length > 0)) originalChanges[name] = delta;
    }
    expect(originalChanges).toEqual(manifest.seedChanges[locale]);
    const nameChanges = JSON.parse(
      await readFile(new URL(`plain-name-changes.${locale}.json`, root), "utf8"),
    ) as MadridNameChange[];
    expected.seeded = madridWithNameChanges(expected.seeded, nameChanges);
    expected.seeded = madridWithVatClassChanges(expected.seeded, VAT_CLASS_CHANGES);
    if (locale === "en") {
      const department = '@departments:["Deli"]';
      for (const [position, name] of ["Set up", "Take order", "Anything else?"].entries()) {
        const key = `@service_steps:${JSON.stringify([department, position])}`;
        const row = expected.seeded.tables.service_steps!.rows[key]!;
        expect(row.name).toBe(["Montar mesa", "Tomar nota", "¿Algo más?"][position]);
        row.name = name;
      }
    }
    const tableRenames = {
      attendance_day_work: "attendance_days",
      attendance_response_commands: "attendance_answers",
      tenants: "taxpayer",
      tenant_credentials: "venue_credentials",
      scheduled_runs: "reconciliation_runs",
      sessions: "till_sessions",
      management_sessions: "dashboard_sessions",
      management_account_actions: "account_actions",
    };
    for (const phase of ["before", "provisioned", "seeded"] as const)
      expected[phase] = madridWithRenamedTables(expected[phase], tableRenames);
    expected.before = madridWithRenamedColumns(expected.before, RENAMED_COLUMNS);
    expected.provisioned = madridWithRenamedColumns(expected.provisioned, RENAMED_COLUMNS);
    expected.seeded = madridWithRenamedColumns(expected.seeded, RENAMED_COLUMNS);
    const phases = structuredClone(manifest.phases[locale]!);
    for (const phase of ["before", "provisioned", "seeded"] as const) {
      const profilePrinters = expected[phase].tables.device_profile_printers!;
      const kitchenProfiles = new Set(
        Object.values(expected[phase].tables.device_profiles!.rows)
          .filter((profile) => profile.form_factor === "kds")
          .map((profile) => profile.id),
      );
      const kitchenPrinterRows = Object.entries(profilePrinters.rows).filter(([, row]) =>
        kitchenProfiles.has(row.device_profile_id),
      );
      expect(kitchenPrinterRows.map(([, row]) => row.role).sort()).toEqual(
        phase === "seeded" ? ["cash_drawer", "invoice", "payment_slip", "receipt"] : [],
      );
      for (const [id] of kitchenPrinterRows) delete profilePrinters.rows[id];
      phases[phase]!.device_profile_printers! -= kitchenPrinterRows.length;
      for (const [old, next] of Object.entries(tableRenames)) {
        phases[phase]![next] = phases[phase]![old]!;
        delete phases[phase]![old];
      }
      const at = "2026-10-08T10:00:00.000Z";
      const accessMemberships = Object.values(expected[phase].tables.persons!.rows).map(
        (person) => ({ person_id: person.id, role_id: `@roles:${stable([person.role])}` }),
      );
      const venueMetadata = {
        module: "venue",
        version: 1,
        revision: phase === "seeded" ? 3 : 2,
        updatedAt: at,
        updatedBy: null,
      };
      expected[phase] = madridWithDocument(
        expected[phase],
        "locations",
        {
          name: "name",
          fiscal_territory: "fiscalTerritory",
          invoice_locales: "invoiceLocales",
          address_line1: "addressLine1",
          address_line2: "addressLine2",
          postal_code: "postalCode",
          city: "city",
          province: "province",
        },
        {
          ...venueMetadata,
          defaults: {
            cloudVenueId: null,
            streamId: null,
            contentLanguages: null,
            defaultContentLanguage: null,
            holidayArea: null,
            privacyNoticeUrl:
              Object.values(expected[phase].tables.taxpayer!.rows)[0]?.privacy_notice_url ?? null,
            privacyEmail:
              Object.values(expected[phase].tables.taxpayer!.rows)[0]?.privacy_email ?? null,
          },
        },
      );
      for (const [table, fields, targetField] of [
        [
          "content_languages",
          { default_language: "defaultContentLanguage", languages: "contentLanguages" },
          undefined,
        ],
        [
          "holiday_geographies",
          {
            country: "country",
            province_code: "provinceCode",
            city_key: "cityKey",
            area_key: "areaKey",
          },
          "holidayArea",
        ],
      ] as const) {
        expect(Object.keys(expected[phase].tables[table]!.rows)).toHaveLength(
          phases[phase]![table]!,
        );
        expected[phase] = madridWithDocument(expected[phase], table, fields, {
          ...venueMetadata,
          mode: "row",
          targetField,
        });
        phases[phase]![table] = 0;
      }
      expected[phase] = madridWithDocument(
        expected[phase],
        "locations",
        { catalogue_id: "id" },
        {
          mode: "column-flag",
          targetTable: "catalogues",
          targetField: "is_default",
          beforeColumn: "version",
        },
      );
      expected[phase] = madridWithDocument(
        expected[phase],
        "locations",
        { time_zone: "timeZone" },
        { ...venueMetadata, module: "business_day", revision: 1, mode: "business-day" },
      );
      delete phases[phase]!.location_business_day_settings;
      delete phases[phase]!.location_day_cutover_changes;
      phases[phase]!.day_cutover_changes = Object.keys(
        expected[phase].tables.day_cutover_changes!.rows,
      ).length;
      expected[phase] = madridWithMenuSettings(expected[phase], at);
      delete phases[phase]!.catalogue_settings;
      delete phases[phase]!.unit_seed_states;
      const runTotalColumn = expected[phase].tables.content_suggestion_jobs!.columns.find(
        ({ name }) => name === "run_total",
      )!;
      runTotalColumn.notnull = 0;
      phases[phase]!.settings = phase === "before" ? 0 : 3;
      const revisions = phase === "before" ? [] : phase === "seeded" ? [1, 2, 3] : [1, 2];
      expected[phase].tables.activity_log = {
        ...structuredClone(canonical[phase].tables.activity_log!),
        rows: Object.fromEntries(
          [
            ...revisions.map((revision) => ({ revision, module: "venue" })),
            ...(phase === "before"
              ? []
              : [
                  { revision: 1, module: "business_day" },
                  { revision: 1, module: "menu" },
                ]),
          ].map(({ revision, module }) => {
            const id = `@activity_log:${stable(["settings.saved", module, at, JSON.stringify({ revision })])}`;
            return [
              id,
              {
                id,
                at,
                kind: "settings.saved",
                subject_kind: "settings",
                subject_id: module,
                person_id: null,
                device_id: null,
                data: { revision },
              },
            ];
          }),
        ),
      };
      phases[phase]!.activity_log = revisions.length + (phase === "before" ? 0 : 2);
      if (phase !== "before") {
        const subject = '@persons:["owner@example.test"]';
        const data = { method: "setup" };
        const id = `@activity_log:${stable(["dashboard.signed_in", subject, at, JSON.stringify(data)])}`;
        expected[phase].tables.activity_log!.rows[id] = {
          id,
          at,
          kind: "dashboard.signed_in",
          subject_kind: "person",
          subject_id: subject,
          person_id: subject,
          device_id: null,
          data,
        };
        const endData = { reason: "operation_finished" };
        const endId = `@activity_log:${stable(["dashboard.signed_out", subject, at, JSON.stringify(endData)])}`;
        expected[phase].tables.activity_log!.rows[endId] = {
          id: endId,
          at,
          kind: "dashboard.signed_out",
          subject_kind: "person",
          subject_id: subject,
          person_id: subject,
          device_id: null,
          data: endData,
        };
        expected[phase].tables.dashboard_sessions!.rows = {};
        phases[phase]!.dashboard_sessions = 0;
        phases[phase]!.activity_log! += 2;
      }

      for (const name of ADDED_TABLES) {
        const added = canonical[phase].tables[name];
        expect(added, `${phase}/${name}`).toBeDefined();
        expect(Object.keys(added!.rows), `${phase}/${name} rows`).toEqual([]);
        expect(expected[phase].tables[name], `${phase}/${name} in the capture`).toBeUndefined();
        expected[phase].tables[name] = structuredClone(added!);
        phases[phase]![name] = 0;
      }
      const roleDefaults = {
        admin: [],
        staff: ["payment.take", "adjustment.apply"],
        supervisor: [
          "payment.take",
          "sale.void",
          "sale.refund",
          "sale.rectify",
          "venue.view",
          "report.view",
          "cash.drawer",
          "workforce.correct",
          "adjustment.apply",
          "adjustment.approve",
        ],
        manager: [
          "payment.take",
          "sale.void",
          "sale.refund",
          "sale.rectify",
          "person.manage",
          "menu.manage",
          "person.admin",
          "venue.configure",
          "venue.view",
          "system.manage",
          "schedule.manage",
          "purchase.manage",
          "report.export",
          "report.view",
          "hardware.manage",
          "cash.drawer",
          "fiscal.view",
          "invoice.inspect",
          "workforce.correct",
          "booking.manage",
          "adjustment.manage",
          "adjustment.apply",
          "adjustment.approve",
        ],
      };
      expected[phase].tables.roles = {
        ...structuredClone(canonical[phase].tables.roles!),
        rows: Object.fromEntries(
          phase === "before"
            ? []
            : Object.entries(roleDefaults)
                .map(([built_in_key, permissions]) => {
                  const id = `@roles:${stable([built_in_key])}`;
                  return [
                    id,
                    {
                      id,
                      built_in_key,
                      name: null,
                      name_folded: null,
                      permissions,
                      created_at: at,
                    },
                  ];
                })
                .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ),
      };
      phases[phase]!.roles = phase === "before" ? 0 : 4;
      expected[phase].tables.person_roles = {
        ...structuredClone(canonical[phase].tables.person_roles!),
        rows: Object.fromEntries(
          accessMemberships
            .map((row) => [stable(row), row])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ),
      };
      phases[phase]!.person_roles = phase === "before" ? 0 : phase === "seeded" ? 6 : 1;
      for (const name of REMOVED_TABLES_WITH_ROWS) {
        expect(expected[phase].tables[name], `${phase}/${name} in the capture`).toBeDefined();
        delete expected[phase].tables[name];
        delete phases[phase]![name];
      }
      for (const name of REMOVED_TABLES) {
        const removed = expected[phase].tables[name];
        expect(removed, `${phase}/${name} in the capture`).toBeDefined();
        expect(Object.keys(removed!.rows), `${phase}/${name} captured rows`).toEqual([]);
        expect(phases[phase]![name], `${phase}/${name} captured count`).toBe(0);
        delete expected[phase].tables[name];
        delete phases[phase]![name];
      }
      expected[phase].tables = byName(expected[phase].tables);
      phases[phase] = byName(phases[phase]!);
      for (const [name, columns] of [
        ["sales", ["counterparty_identifier_type", "counterparty_identifier_country_code"]],
        ["working_orders", ["recipient_identifier_type", "recipient_identifier_country_code"]],
      ] as const) {
        expected[phase].tables[name]!.columns.push(
          ...columns.map((name) => ({ name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 })),
        );
      }
      const records = expected[phase].tables.registros_facturacion!;
      for (const name of [
        "corrects_registro_id",
        "subsanacion",
        "rechazo_previo",
        "sin_registro_previo",
      ]) {
        records.columns.push({ name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
        for (const row of Object.values(records.rows)) row[name] = null;
      }
      records.columns.splice(
        records.columns.findIndex((column) => column.name === "destinatarios"),
        0,
        { name: "fecha_operacion", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(records.rows)) row.fecha_operacion = null;
      const salesTable = expected[phase].tables.sales!;
      salesTable.columns.splice(
        salesTable.columns.findIndex((column) => column.name === "corrects_sale_id") + 1,
        0,
        { name: "replaces_original", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
        { name: "supply_day", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(salesTable.rows)) {
        row.replaces_original = 0;
        row.supply_day = null;
      }
      const saleReceiptColumns = [
        ["receipt_guest_count", "INTEGER"],
        ["receipt_department_id", "TEXT"],
        ["receipt_trading_name", "TEXT"],
        ["receipt_prints_trading_name", "INTEGER"],
      ] as const;
      salesTable.columns.splice(
        salesTable.columns.findIndex((column) => column.name === "working_order_id"),
        0,
        ...saleReceiptColumns.map(([name, type]) => ({
          name,
          type,
          notnull: 0,
          dflt_value: null,
          pk: 0,
        })),
      );
      for (const row of Object.values(salesTable.rows))
        for (const [name] of saleReceiptColumns) row[name] = null;
      for (const [name, added] of [
        [
          "sales",
          [
            ["receipt_department_id", "departments", "NO ACTION"],
            ["operator_id", "persons", "RESTRICT"],
            ["authorized_by", "persons", "RESTRICT"],
          ],
        ],
        ["sale_voids", [["voided_by", "persons", "RESTRICT"]]],
        [
          "unpaid_departures",
          [
            ["authorized_by", "persons", "RESTRICT"],
            ["recorded_by", "persons", "RESTRICT"],
          ],
        ],
      ] as const) {
        const table = expected[phase].tables[name]!;
        table.foreignKeys = [
          ...added.map(([from, table, on_delete], id) => ({
            id,
            seq: 0,
            table,
            from,
            to: "id",
            on_update: "NO ACTION",
            on_delete,
            match: "NONE",
          })),
          ...table.foreignKeys.map((key) => ({ ...key, id: key.id + added.length })),
        ];
      }
      records.foreignKeys.push({
        id: 4,
        seq: 0,
        table: "registros_facturacion",
        from: "corrects_registro_id",
        to: "id",
        on_update: "NO ACTION",
        on_delete: "NO ACTION",
        match: "NONE",
      });
      for (const row of Object.values(expected[phase].tables.catalogues!.rows)) {
        row.kind = "menu";
        row.set_price = null;
        row.set_vat_class = null;
      }
      const products = expected[phase].tables.products!;
      products.columns.splice(
        products.columns.findIndex((column) => column.name === "vat_class") + 1,
        0,
        { name: "takeaway_vat_class", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(products.rows)) row.takeaway_vat_class = null;
      const salePolicies = expected[phase].tables.department_sale_policies!;
      for (const name of ["dining", "dining_starts_as"]) {
        salePolicies.columns.push({
          name,
          type: "TEXT",
          notnull: 1,
          dflt_value: "'eat_in'",
          pk: 0,
        });
        for (const row of Object.values(salePolicies.rows)) row[name] = "eat_in";
      }
      const orders = expected[phase].tables.working_orders!;
      orders.columns.splice(
        orders.columns.findIndex((column) => column.name === "party_id") + 1,
        0,
        { name: "dining", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(orders.rows)) row.dining = "eat_in";
      orders.columns.splice(
        orders.columns.findIndex((column) => column.name === "party_id") + 1,
        0,
        { name: "bill_number", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
        { name: "bill_name", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        { name: "editor_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        { name: "editor_version", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
      );
      for (const name of ["zone_id", "department_id", "service_mode"])
        orders.columns.push({ name, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
      for (const row of Object.values(orders.rows))
        Object.assign(row, {
          bill_number: null,
          bill_name: null,
          editor_id: null,
          editor_version: 0,
          zone_id: null,
          department_id: null,
          service_mode: null,
        });
      orders.foreignKeys = [
        ...orders.foreignKeys.map((key) => ({ ...key, id: key.id + (key.id >= 2 ? 3 : 2) })),
        {
          id: 4,
          seq: 0,
          table: "persons",
          from: "editor_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        ...(
          [
            ["departments", "department_id"],
            ["floor_zones", "zone_id"],
          ] as const
        ).map(([table, from], id) => ({
          id,
          seq: 0,
          table,
          from,
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        })),
      ].sort((a, b) => a.id - b.id);
      const orderLines = expected[phase].tables.working_order_lines!;
      orderLines.columns.splice(
        orderLines.columns.findIndex((column) => column.name === "vat_class") + 1,
        0,
        { name: "takeaway_vat_class", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(orderLines.rows)) row.takeaway_vat_class = row.vat_class;
      products.columns = products.columns.filter(
        (column) => !["recipe_derivation", "diet_derivation"].includes(column.name),
      );
      for (const row of Object.values(products.rows)) {
        delete row.recipe_derivation;
        delete row.diet_derivation;
      }
      for (const name of [
        "menu_item_id",
        "menu_id",
        "menu_name",
        "menu_version_id",
        "offer_department_id",
        "department_name",
        "unit_id",
        "sold_in_each",
        "hardware_unit",
        "allergens",
        "diet",
        "diet_override",
        "late_period_name",
        "late_confirmed_by",
        "sent_nutrition",
        "offer_unit_name",
        "offer_unit_precision",
        "offer_vat_class",
        "offer_category_name",
        "cohort_id",
        "cohort_ordinal",
        "whole_portion",
      ]) {
        const type = [
          "sold_in_each",
          "offer_unit_precision",
          "cohort_ordinal",
          "whole_portion",
        ].includes(name)
          ? "INTEGER"
          : "TEXT";
        orderLines.columns.push({ name, type, notnull: 0, dflt_value: null, pk: 0 });
        for (const row of Object.values(orderLines.rows)) row[name] = null;
      }
      orderLines.foreignKeys = [
        ...[
          ["credited_to", "persons"],
          ["late_confirmed_by", "persons"],
          ["menu_version_id", "menu_versions"],
          ["menu_item_id", "menu_items"],
        ].map(([from, table], id) => ({
          id,
          seq: 0,
          table: table!,
          from: from!,
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        })),
        ...orderLines.foreignKeys.map((key) => ({ ...key, id: key.id + 4 })),
      ];
      type Classed = { vatClass: string; takeawayVatClass?: string };
      for (const row of Object.values(expected[phase].tables.menu_versions!.rows)) {
        const document = row.document as {
          format: number;
          offers: Record<
            string,
            Classed & {
              dietDerivation?: unknown;
              variants: (Classed & { dietDerivation?: unknown })[];
              offeredModifiers: ({ kind: "extras"; items: Classed[] } | { kind: "options" })[];
            }
          >;
        };
        document.format = 4;
        for (const offer of Object.values(document.offers)) {
          delete offer.dietDerivation;
          for (const variant of offer.variants) delete variant.dietDerivation;
          for (const copy of [
            offer,
            ...offer.variants,
            ...offer.offeredModifiers.flatMap((list) => (list.kind === "extras" ? list.items : [])),
          ])
            copy.takeawayVatClass = copy.vatClass;
        }
      }
      expected[phase] = madridWithNameChanges(expected[phase], []);

      const parties = expected[phase].tables.parties!;
      parties.columns = parties.columns.filter((column) => column.name !== "main_bill_id");
      parties.columns.splice(
        parties.columns.findIndex((column) => column.name === "revision") + 1,
        0,
        { name: "last_bill_number", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
      );
      for (const row of Object.values(parties.rows)) row.last_bill_number = 0;
      parties.foreignKeys = parties.foreignKeys.filter((key) => key.from !== "main_bill_id");
      const answers = expected[phase].tables.party_allergy!;
      for (const [name, source] of [
        ["allergy_answer", "answer"],
        ["allergy_answered_by", "changed_by"],
        ["allergy_answered_at", "changed_at"],
      ] as const) {
        parties.columns.push({
          ...answers.columns.find((column) => column.name === source)!,
          name,
          notnull: 0,
        });
        for (const row of Object.values(parties.rows)) {
          const answer = Object.values(answers.rows).find((entry) => entry.party_id === row.id);
          row[name] = answer?.[source] ?? null;
        }
      }
      delete expected[phase].tables.party_allergy;
      delete phases[phase]!.party_allergy;
      const personKey = (from: string, id: number) => ({
        id,
        seq: 0,
        table: "persons",
        from,
        to: "id",
        on_update: "NO ACTION",
        on_delete: "RESTRICT",
        match: "NONE",
      });
      const incidentTable = expected[phase].tables.incidents!;
      incidentTable.foreignKeys = [
        personKey("acknowledged_by", 0),
        ...incidentTable.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];
      parties.foreignKeys = [
        personKey("allergy_answered_by", 0),
        personKey("closed_by", 1),
        personKey("opened_by", 2),
        ...parties.foreignKeys.map((key) => ({ ...key, id: key.id + 3 })),
      ];
      for (const [name, column] of [
        ["service_step_completions", "done_by"],
        ["ticket_item_moves", "moved_by_person_id"],
        ["bookings", "created_by"],
      ]) {
        const table = expected[phase].tables[name!]!;
        table.foreignKeys.push(personKey(column!, table.foreignKeys.length));
      }
      for (const key of expected[phase].tables.party_allergy_guests!.foreignKeys) {
        if (key.from === "party_id") {
          key.table = "parties";
          key.to = "id";
        }
      }
      const ticketItems = expected[phase].tables.ticket_items!;
      ticketItems.columns = ticketItems.columns.filter((column) => column.name !== "away_at");
      for (const name of ["time_entries", "pay_period_closures"]) {
        const table = expected[phase].tables[name]!;
        table.columns = table.columns.filter((column) => column.name !== "location_id");
        const kept = table.foreignKeys.filter((key) => key.from !== "location_id");
        const ids = [...new Set(kept.map((key) => key.id))];
        table.foreignKeys = kept.map((key) => ({ ...key, id: ids.indexOf(key.id) }));
      }
      // Workforce 0013's rebuild writes self_approved before author_kind; the capture has it
      // last, where 0006's ALTER added it.
      const entryColumns = expected[phase].tables.time_entries!.columns;
      const selfApproved = entryColumns.splice(
        entryColumns.findIndex((column) => column.name === "self_approved"),
        1,
      );
      entryColumns.splice(
        entryColumns.findIndex((column) => column.name === "author_kind"),
        0,
        ...selfApproved,
      );
      const commandLocation = expected[phase].tables.attendance_answers!.columns.find(
        (column) => column.name === "location_id",
      )!;
      commandLocation.notnull = 0;
      const questions = expected[phase].tables.attendance_questions!;
      questions.foreignKeys = questions.foreignKeys.filter(
        (key) => !(key.table === "time_entries" && key.from === "location_id"),
      );
      for (const [name, column, value] of [
        [
          "bill_payments",
          { name: "remaining_after", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "dashboard_sessions",
          { name: "proved_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "dashboard_sessions",
          { name: "proof_method", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "kitchen_stations",
          { name: "waits_for_pass", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
          0,
        ],
        [
          "ticket_items",
          { name: "requested_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "ticket_items",
          { name: "pass_controlled", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
          0,
        ],
        [
          "order_groups",
          { name: "request_kind", type: "TEXT", notnull: 1, dflt_value: "'new_order'", pk: 0 },
          "new_order",
        ],
        [
          "payments",
          { name: "requested_amount", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "payments",
          { name: "external_provider", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "payments",
          { name: "external_machine", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "staff_roles",
          { name: "hidden_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
      ] as const) {
        const table = expected[phase].tables[name]!;
        table.columns.push(column);
        for (const row of Object.values(table.rows)) row[column.name] = value;
      }
      for (const name of [
        "split_min_segment_minutes",
        "split_max_segment_minutes",
        "split_min_gap_minutes",
        "continuous_paid_break_minutes",
      ]) {
        const table = expected[phase].tables.convenio_config!;
        table.columns.push({ name, type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 });
        for (const row of Object.values(table.rows)) row[name] = null;
      }
      for (const [name, column] of [
        ["floor_plan_tables", "part_of_table_id"],
        ["floor_reset_tables", "part_of_reset_table_id"],
      ]) {
        const table = expected[phase].tables[name!]!;
        table.columns.push({ name: column!, type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
        for (const row of Object.values(table.rows)) row[column!] = null;
        const position = name === "floor_reset_tables" ? 2 : table.foreignKeys.length;
        table.foreignKeys.splice(position, 0, {
          id: position,
          seq: 0,
          table: name!,
          from: column!,
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        });
        table.foreignKeys = table.foreignKeys.map((key, id) => ({ ...key, id }));
      }
      for (const column of expected[phase].tables.floor_plan_placements!.columns)
        if (["x", "y", "shape", "rotation"].includes(column.name)) column.notnull = 0;
      for (const [name, moves] of Object.entries(REBUILT_COLUMN_ORDER)) {
        const columns = expected[phase].tables[name]!.columns;
        for (const [anchor, ...names] of moves) {
          const moved = names.map((name) => {
            const index = columns.findIndex((column) => column.name === name);
            expect(index, `${phase}/${name} captured column`).toBeGreaterThanOrEqual(0);
            return columns.splice(index, 1)[0]!;
          });
          const index = columns.findIndex((column) => column.name === anchor);
          expect(index, `${phase}/${name}/${anchor} anchor`).toBeGreaterThanOrEqual(0);
          columns.splice(index, 0, ...moved);
        }
      }
      for (const [name, order] of Object.entries(REBUILT_FOREIGN_KEY_ORDER)) {
        const table = expected[phase].tables[name]!;
        expect([...new Set(table.foreignKeys.map((key) => key.id))].sort()).toEqual(
          [...order].sort(),
        );
        table.foreignKeys = order.flatMap((capturedId, id) =>
          table.foreignKeys.filter((key) => key.id === capturedId).map((key) => ({ ...key, id })),
        );
      }
      const draftLineKeys = expected[phase].tables.order_draft_lines!.foreignKeys;
      draftLineKeys.splice(
        4,
        1,
        {
          id: 4,
          seq: 0,
          table: "menu_items",
          from: "menu_item_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        { ...draftLineKeys[4]!, id: 5 },
      );
      const invoiceChoiceTable = expected[phase].tables.devices!;
      invoiceChoiceTable.columns = invoiceChoiceTable.columns.filter(
        ({ name }) => name !== "invoice_page_printer_id",
      );
      invoiceChoiceTable.foreignKeys = invoiceChoiceTable.foreignKeys
        .filter((key) => key.from !== "invoice_page_printer_id")
        .map((key, id) => ({ ...key, id }));
      for (const row of Object.values(invoiceChoiceTable.rows)) {
        row.invoice_printer_id ??= row.invoice_page_printer_id;
        delete row.invoice_page_printer_id;
      }
      const deliveries = expected[phase].tables.invoice_deliveries!;
      deliveries.columns.find(({ name }) => name === "page_printer_id")!.name = "printer_id";
      const deliveryPrinter = deliveries.foreignKeys.find(
        ({ from }) => from === "page_printer_id",
      )!;
      deliveryPrinter.from = "printer_id";
      deliveryPrinter.table = "printers";
      const printerTable = expected[phase].tables.printers!;
      printerTable.columns.splice(1, 0, {
        name: "kind",
        type: "TEXT",
        notnull: 1,
        dflt_value: "'receipt'",
        pk: 0,
      });
      const afterPortable =
        printerTable.columns.findIndex((column) => column.name === "portable") + 1;
      printerTable.columns.splice(
        afterPortable,
        0,
        { name: "held_by_device_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        { name: "held_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        { name: "picks_up_receipts", type: "INTEGER", notnull: 1, dflt_value: "true", pk: 0 },
        { name: "picks_up_payment_slips", type: "INTEGER", notnull: 1, dflt_value: "true", pk: 0 },
      );
      for (const column of printerTable.columns) {
        if (column.name === "paper_width" || column.name === "resolution") column.notnull = 0;
      }
      const officeColumns = [
        ["resource_path", "TEXT"],
        ["document_format", "TEXT"],
        ["supported_formats", "TEXT"],
        ["media", "TEXT"],
        ["resolution_dpi", "INTEGER"],
        ["agent_id", "TEXT"],
      ] as const;
      printerTable.columns.splice(
        printerTable.columns.findIndex((column) => column.name === "active"),
        0,
        ...officeColumns.map(([name, type]) => ({
          name,
          type,
          notnull: 0,
          dflt_value: null,
          pk: 0,
        })),
      );
      printerTable.foreignKeys.push(
        {
          id: 0,
          seq: 0,
          table: "print_agents",
          from: "agent_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        {
          id: 1,
          seq: 0,
          table: "devices",
          from: "held_by_device_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
      );
      for (const row of Object.values(printerTable.rows)) {
        expect(row.pickup_roles).toEqual(["receipt", "payment_slip"]);
        row.kind = "receipt";
        row.held_by_device_id = null;
        row.held_at = null;
        row.picks_up_receipts = 1;
        row.picks_up_payment_slips = 1;
        for (const [name] of officeColumns) row[name] = null;
      }
      expected[phase] = madridWithDroppedColumns(expected[phase], DROPPED_COLUMNS);
      for (const name of ["attendance_days", "attendance_questions", "attendance_answers"]) {
        expect(expected[phase].tables[name]!.rows, `${phase}/${name} captured rows`).toEqual({});
        expect(canonical[phase].tables[name]!.rows, `${phase}/${name} seeded rows`).toEqual({});
      }
      const attendanceQuestions = expected[phase].tables.attendance_questions!;
      attendanceQuestions.columns.splice(2, 0, {
        name: "attendance_day_id",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      });
      attendanceQuestions.foreignKeys = [
        ...attendanceQuestions.foreignKeys.map((key) => ({
          ...key,
          id: key.id + (key.from === "person_id" && key.table === "persons" ? 1 : 0),
        })),
        {
          id: 4,
          seq: 0,
          table: "attendance_days",
          from: "attendance_day_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        },
      ].sort((a, b) => a.id - b.id || a.seq - b.seq);
      const shiftTable = expected[phase].tables.shifts!;
      expect(shiftTable.rows, `${phase}/shifts captured rows`).toEqual({});
      shiftTable.columns.find((column) => column.name === "roster_version_id")!.notnull = 1;
      shiftTable.columns.splice(
        shiftTable.columns.findIndex((column) => column.name === "created_at"),
        0,
        ...["staff_role_id", "department_id", "station_id"].map((name) => ({
          name,
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        })),
      );
      shiftTable.foreignKeys = [
        ...[
          ["station_id", "kitchen_stations"],
          ["department_id", "departments"],
          ["staff_role_id", "staff_roles"],
        ].map(([from, table], id) => ({
          id,
          seq: 0,
          table: table!,
          from: from!,
          to: "id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        })),
        ...shiftTable.foreignKeys.map((key) => ({
          ...key,
          id: key.id + 3,
          on_delete: key.from === "roster_version_id" ? "CASCADE" : key.on_delete,
        })),
      ];
      const live = expected[phase].tables.dining_tables!;
      const todayIds = new Set(
        Object.values(expected[phase].tables.floor_today_tables!.rows).map((row) => row.table_id),
      );
      live.columns.push({
        name: "on_floor",
        type: "INTEGER",
        notnull: 1,
        dflt_value: "false",
        pk: 0,
      });
      for (const row of Object.values(live.rows)) row.on_floor = todayIds.has(row.id) ? 1 : 0;
      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "department_sale_policies",
          into: "departments",
          match: { from: "department_id", into: "id" },
          columns: {
            order_start: "order_start",
            paid_when: "paid_when",
            collection_number: "collection_number",
            print_trading_name: "print_trading_name",
            dining: "dining",
            dining_starts_as: "dining_starts_as",
          },
        },
        {
          from: "department_transfer_desks",
          into: "departments",
          match: { from: "department_id", into: "id" },
          columns: { receiving_profile_id: "transfer_desk_profile_id" },
        },
        {
          from: "department_floor_plan_sets",
          into: "floor_plan_sets",
          match: { from: "set_id", into: "id" },
          columns: { department_id: "department_id", name: "name", is_default: "is_default" },
        },
        {
          from: "zone_service_policies",
          into: "floor_zones",
          match: { from: "zone_id", into: "id" },
          columns: { department_id: "department_id", is_counter_default: "is_counter_default" },
        },
        {
          from: "zone_sale_policies",
          into: "floor_zones",
          match: { from: "zone_id", into: "id" },
          columns: {
            order_start: "order_start",
            paid_when: "paid_when",
            collection_number: "collection_number",
          },
        },
        {
          from: "zone_extensions",
          into: "floor_zones",
          match: { from: "zone_id", into: "id" },
          columns: {
            business_day: "kept_open_day",
            starts_at: "kept_open_from",
            ends_at: "kept_open_until",
          },
        },
        {
          from: "floor_today_tables",
          into: "dining_tables",
          match: { from: "table_id", into: "id" },
          columns: {
            seats: "today_seats",
            fixed: "today_fixed",
            x: "today_x",
            y: "today_y",
            width: "today_width",
            height: "today_height",
            shape: "today_shape",
            rotation: "today_rotation",
            taken_off: "taken_off",
            name: "today_name",
          },
        },
        {
          from: "floor_today_zones",
          into: "floor_zones",
          match: { from: "zone_id", into: "id" },
          columns: {
            business_day: "today_business_day",
            generation: "today_revision",
            set_id: "today_set_id",
            layout_revision: "today_layout_revision",
            occurrence: "today_occurrence",
          },
        },
        {
          from: "floor_today_join_tables",
          into: "dining_tables",
          match: { from: "table_id", into: "id" },
          columns: {
            join_id: "merge_id",
            before_x: "merge_before_x",
            before_y: "merge_before_y",
            before_rotation: "merge_before_rotation",
          },
        },
        {
          from: "station_printers",
          into: "kitchen_stations",
          match: { from: "station_id", into: "id" },
          columns: {},
          collect: { from: "printer_id", into: "printer_ids" },
        },
        {
          from: "station_day_states",
          into: "kitchen_stations",
          match: { from: "station_id", into: "id" },
          columns: {
            business_day: "closed_on_day",
            sends_to_station_id: "closed_sends_to_station_id",
          },
        },
      ]);
      const department = expected[phase].tables.departments!;
      const policyColumns = department.columns.splice(-7);
      department.columns.splice(
        department.columns.findIndex((column) => column.name === "release_reminder_minutes"),
        0,
        ...policyColumns,
      );
      const deskColumn = department.columns.find(
        (column) => column.name === "transfer_desk_profile_id",
      )!;
      deskColumn.notnull = 0;
      department.foreignKeys.find((key) => key.from === "transfer_desk_profile_id")!.on_delete =
        "SET NULL";
      delete phases[phase]!.department_sale_policies;
      delete phases[phase]!.department_transfer_desks;
      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "department_receipts",
          into: "departments",
          match: { from: "department_id", into: "id" },
          columns: {
            receipt: "receipt_text",
            logo_rasters: "receipt_logo_rasters",
            updated_at: "receipt_updated_at",
          },
        },
      ]);
      const receiptDepartment = expected[phase].tables.departments!;
      const receiptColumns = receiptDepartment.columns.splice(-3);
      for (const column of receiptColumns) column.notnull = 0;
      receiptDepartment.columns.splice(
        receiptDepartment.columns.findIndex((column) => column.name === "created_at"),
        0,
        { name: "operation_description", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        receiptColumns[0]!,
        { name: "receipt_logo_image_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        ...receiptColumns.slice(1),
      );
      for (const row of Object.values(receiptDepartment.rows)) {
        const receipt = row.receipt_text as Record<string, unknown> | null;
        row.operation_description = receipt?.operationDescription ?? null;
        if (receipt) delete receipt.operationDescription;
        row.receipt_logo_image_id = null;
        if (receipt?.logo !== undefined) {
          const image = Object.values(expected[phase].tables.media_images!.rows).find(
            (image) => image.filename === receipt.logo,
          );
          expect(image, `${phase} captured receipt logo`).toBeDefined();
          row.receipt_logo_image_id = image!.id;
          delete receipt.logo;
        }
      }
      receiptDepartment.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "media_images",
          from: "receipt_logo_image_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        },
        ...receiptDepartment.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];
      delete phases[phase]!.department_receipts;
      const frozenTickets = new Set(
        Object.values(expected[phase].tables.ticket_item_allergies!.rows).map(
          (row) => row.ticket_item_id,
        ),
      );
      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "ticket_item_allergies",
          into: "ticket_items",
          match: { from: "ticket_item_id", into: "id" },
          columns: { original_block: "allergy_original", current_block: "allergy_current" },
        },
      ]);
      const tickets = expected[phase].tables.ticket_items!;
      const allergyColumns = tickets.columns.splice(-2);
      tickets.columns.splice(
        tickets.columns.findIndex((column) => column.name === "note") + 1,
        0,
        { name: "allergy_frozen", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
        ...allergyColumns,
      );
      for (const row of Object.values(tickets.rows))
        row.allergy_frozen = frozenTickets.has(row.id) ? 1 : 0;
      expected[phase] = madridWithDroppedColumns(expected[phase], {
        ticket_items: ["node_id", "working_order_id"],
        routing_cell_periods: ["department_id"],
      });
      const notices = expected[phase].tables.kitchen_notices!;
      notices.columns.splice(
        notices.columns.findIndex((column) => column.name === "order_label"),
        0,
        { name: "ticket_item_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(notices.rows)) row.ticket_item_id = null;
      notices.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "ticket_items",
          from: "ticket_item_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "SET NULL",
          match: "NONE",
        },
        ...notices.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];
      delete phases[phase]!.ticket_item_allergies;
      const memberKeys = expected[phase].tables.dining_tables!.foreignKeys;
      const zoneKey = memberKeys.find((key) => key.from === "zone_id")!;
      const mergeKey = memberKeys.find((key) => key.from === "merge_id")!;
      const planKey = memberKeys.find((key) => key.from === "plan_table_id")!;
      expected[phase].tables.dining_tables!.foreignKeys = [zoneKey, mergeKey, planKey].map(
        (key, id) => ({ ...key, id }),
      );
      for (const column of expected[phase].tables.dining_tables!.columns)
        if (column.name.startsWith("merge_")) column.notnull = 0;
      expected[phase].tables.table_merges = expected[phase].tables.floor_today_joins!;
      delete expected[phase].tables.floor_today_joins;
      expect(expected[phase].tables.floor_today_split_parts!.rows).toEqual({});
      delete expected[phase].tables.floor_today_split_parts;
      for (const table of Object.values(expected[phase].tables))
        for (const key of table.foreignKeys)
          if (key.table === "floor_today_joins") key.table = "table_merges";
      phases[phase]!.table_merges = phases[phase]!.floor_today_joins!;
      delete phases[phase]!.floor_today_joins;
      delete phases[phase]!.floor_today_join_tables;
      delete phases[phase]!.floor_today_split_parts;
      expected[phase].tables = Object.fromEntries(
        Object.entries(expected[phase].tables).sort(([a], [b]) => a.localeCompare(b)),
      );
      phases[phase] = Object.fromEntries(
        Object.entries(phases[phase]!).sort(([a], [b]) => a.localeCompare(b)),
      );
      const zoneColumns = expected[phase].tables.floor_zones!.columns;
      const todayZoneColumns = zoneColumns.splice(-5);
      todayZoneColumns.find((column) => column.name === "today_business_day")!.notnull = 0;
      zoneColumns.splice(
        zoneColumns.findIndex((column) => column.name === "kept_open_day"),
        0,
        ...todayZoneColumns,
      );
      expected[phase].tables.floor_zones!.foreignKeys = expected[phase].tables
        .floor_zones!.foreignKeys.reverse()
        .map((key, id) => ({ ...key, id }));
      const stations = expected[phase].tables.kitchen_stations!;
      stations.columns.push({
        name: "when_closed_sends_to_station_id",
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
        pk: 0,
      });
      for (const row of Object.values(stations.rows)) row.when_closed_sends_to_station_id = null;
      stations.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "kitchen_stations",
          from: "when_closed_sends_to_station_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        ...stations.foreignKeys,
      ].map((key, id) => ({ ...key, id }));
      delete phases[phase]!.station_printers;
      const printerColumn = stations.columns.splice(
        stations.columns.findIndex((column) => column.name === "printer_ids"),
        1,
      )[0]!;
      stations.columns.splice(
        stations.columns.findIndex((column) => column.name === "created_at"),
        0,
        printerColumn,
      );
      delete phases[phase]!.floor_today_tables;
      delete phases[phase]!.floor_today_zones;
      for (const table of ["floor_zones", "kitchen_stations"])
        for (const column of expected[phase].tables[table]!.columns)
          if (
            ["kept_open_day", "kept_open_from", "kept_open_until", "closed_on_day"].includes(
              column.name,
            )
          )
            column.notnull = 0;
      delete phases[phase]!.zone_extensions;
      delete phases[phase]!.station_day_states;
      delete phases[phase]!.department_floor_plan_sets;
      delete phases[phase]!.zone_service_policies;
      delete phases[phase]!.zone_sale_policies;
      expected[phase].tables.convenio_config!.columns.find((column) => column.name === "id")!.type =
        "INTEGER";
      if (phase !== "before") {
        for (const row of Object.values(expected[phase].tables.adjustment_reasons!.rows)) {
          const names = row.names as Record<string, string>;
          if (["Complaint", "On the house", "Discount"].includes(names.en!)) row.max_amount = 0;
        }
        const courses = expected[phase].tables.kitchen_courses!;
        expect(courses.rows).toEqual({});
        expect(phases[phase]!.kitchen_courses).toBe(0);
        const names = [
          STARTER_COURSE_NAMES["Sharing plates"].es,
          STARTER_COURSE_NAMES.Starters.es,
          STARTER_COURSE_NAMES.Mains.es,
          STARTER_COURSE_NAMES.Desserts.es,
        ];
        courses.rows = Object.fromEntries(
          names.map((name, displayOrder) => {
            const id = `@kitchen_courses:${JSON.stringify([name])}`;
            return [
              id,
              {
                id,
                name,
                display_order: displayOrder,
                active: 1,
                held_until_fired: displayOrder >= 2 ? 1 : 0,
                created_at: "2026-10-08T10:00:00.000Z",
              },
            ];
          }),
        );
        phases[phase]!.kitchen_courses = 4;
      }
      const coursesNow = expected[phase].tables.kitchen_courses!;
      coursesNow.columns.splice(
        coursesNow.columns.findIndex((column) => column.name === "name") + 1,
        0,
        { name: "starter_key", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );
      for (const row of Object.values(coursesNow.rows))
        row.starter_key =
          row.name === STARTER_COURSE_NAMES.Mains.es
            ? "mains"
            : row.name === STARTER_COURSE_NAMES.Desserts.es
              ? "desserts"
              : null;
      const overrides = Object.values(expected[phase].tables.departments!.rows).flatMap(
        (department) =>
          Object.values(coursesNow.rows)
            .filter((course) => course.held_until_fired === 0)
            .map((course) => ({
              department_id: department.id,
              course_id: course.id,
              held_until_fired: 0,
              reminder_minutes: 10,
            })),
      );
      expected[phase].tables.department_courses = {
        ...structuredClone(canonical[phase].tables.department_courses!),
        rows: Object.fromEntries(
          overrides
            .map((row) => [stable(row), row])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ),
      };
      phases[phase]!.department_courses = overrides.length;
      expected[phase] = madridWithDroppedColumns(expected[phase], {
        kitchen_courses: ["held_until_fired"],
        departments: ["release_reminder_minutes"],
      });
      const stepsNow = expected[phase].tables.service_steps!;
      stepsNow.columns.splice(
        stepsNow.columns.findIndex((column) => column.name === "course_id") + 1,
        0,
        { name: "after_step_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );
      stepsNow.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "service_steps",
          from: "department_id",
          to: "department_id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        },
        {
          id: 0,
          seq: 1,
          table: "service_steps",
          from: "after_step_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          match: "NONE",
        },
        ...stepsNow.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];
      for (const row of Object.values(stepsNow.rows)) {
        row.after_step_id =
          row.start === "after_previous"
            ? Object.values(stepsNow.rows).find(
                (parent) =>
                  parent.department_id === row.department_id &&
                  parent.position === Number(row.position) - 1,
              )!.id!
            : null;
        if (row.start === "after_previous") row.start = "after_step";
      }
      if (phase !== "before") {
        const departments = Object.values(expected[phase].tables.departments!.rows);
        for (const department of departments) {
          const visits = Object.values(stepsNow.rows).filter(
            (row) => row.department_id === department.id,
          );
          const old = visits.find((row) => row.position === 2)!;
          expect(old.start).toBe("all_served");
          expect(old.minutes).toBe(10);
          const english =
            locale === "en" && phase === "seeded" && department.id === '@departments:["Deli"]';
          old.name = english ? "Dessert?" : STARTER_STEP_NAMES["Dessert?"].es;
          old.start = "course_served";
          old.minutes = 5;
          old.course_id = Object.values(coursesNow.rows).find(
            (row) => row.starter_key === "mains",
          )!.id;
          const id = `@service_steps:${JSON.stringify([department.id, 3])}`;
          stepsNow.rows[id] = {
            ...old,
            id,
            position: 3,
            name: english ? "Coffee or bill?" : STARTER_STEP_NAMES["Coffee or bill?"].es,
            course_id: Object.values(coursesNow.rows).find((row) => row.starter_key === "desserts")!
              .id,
          };
        }
        phases[phase]!.service_steps += departments.length;
      }
      const admissions = expected[phase].tables.device_profile_admission_roles!;
      admissions.columns = [
        { name: "device_profile_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "staff_role_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 2 },
      ];
      admissions.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "staff_roles",
          from: "staff_role_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "CASCADE",
          match: "NONE",
        },
        {
          id: 1,
          seq: 0,
          table: "device_profiles",
          from: "device_profile_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "CASCADE",
          match: "NONE",
        },
      ];
      if (phase !== "before") {
        const team = STARTER_JOB_ROLE_NAMES.Team.es;
        const names = [
          team,
          ...(phase === "seeded"
            ? locale === "en"
              ? ["Waiter", "Kitchen", "Manager on duty"]
              : Object.values(DEMO_JOB_ROLE_NAMES).map((row) => row.es)
            : []),
        ];
        const roleId = (name: string) => `@staff_roles:${stable([name])}`;
        expected[phase].tables.staff_roles!.rows = Object.fromEntries(
          names
            .map((name) => {
              const id = roleId(name);
              return [id, { id, name, colour: "grey", position: 0, hidden_at: null }];
            })
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        );
        phases[phase]!.staff_roles = phase === "seeded" ? 4 : 1;
        const ticks = Object.values(expected[phase].tables.device_profiles!.rows).flatMap(
          (profile) => {
            const selected = [
              team,
              ...(phase === "seeded"
                ? profile.form_factor === "kds"
                  ? [names[2]!]
                  : [names[1]!, names[3]!]
                : []),
            ];
            return selected.map((name) => ({
              device_profile_id: String(profile.id),
              staff_role_id: roleId(name),
            }));
          },
        );
        admissions.rows = Object.fromEntries(
          ticks
            .map((row) => [stable(row), row])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        );
        phases[phase]!.device_profile_admission_roles = phase === "seeded" ? 8 : 3;

        const memberships = [
          ["owner@example.test", team],
          ...(phase === "seeded"
            ? [
                ["diego@demo.waitron.local", names[2]!],
                ["javier@demo.waitron.local", names[1]!],
                ["lucia@demo.waitron.local", names[1]!],
                ["manager@demo.waitron.local", names[1]!],
                ["manager@demo.waitron.local", names[3]!],
                ["sofia@demo.waitron.local", names[2]!],
              ]
            : []),
        ].map(([email, name]) => ({
          person_id: `@persons:${stable([email])}`,
          staff_role_id: roleId(name!),
        }));
        expected[phase].tables.person_staff_roles!.rows = Object.fromEntries(
          memberships
            .map((row) => [stable(row), row])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        );
        phases[phase]!.person_staff_roles = phase === "seeded" ? 7 : 1;
        for (const { person_id, role_id } of accessMemberships) {
          const accessData = {
            roleId: role_id,
            builtInKey: expected[phase].tables.roles!.rows[role_id]!.built_in_key,
            name: null,
          };
          const accessId = `@activity_log:${stable(["access_role.member_added", person_id, at, JSON.stringify(accessData)])}`;
          expected[phase].tables.activity_log!.rows[accessId] = {
            id: accessId,
            at,
            kind: "access_role.member_added",
            subject_kind: "person",
            subject_id: person_id,
            person_id: null,
            device_id: null,
            data: accessData,
          };
        }
        phases[phase]!.activity_log! += accessMemberships.length;
        const data = { staffRoleId: roleId(team), name: team };
        const subject = '@persons:["owner@example.test"]';
        const id = `@activity_log:${stable(["job_role.member_added", subject, at, JSON.stringify(data)])}`;
        expected[phase].tables.activity_log!.rows[id] = {
          id,
          at,
          kind: "job_role.member_added",
          subject_kind: "person",
          subject_id: subject,
          person_id: null,
          device_id: null,
          data,
        };
        expected[phase].tables.activity_log!.rows = Object.fromEntries(
          Object.entries(expected[phase].tables.activity_log!.rows).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        );
        phases[phase]!.activity_log! += 1;
      }
      recomputeMadridHashes(expected[phase], {
        editDocumentRow(row) {
          if (typeof row.productId === "string" && Array.isArray(row.variants))
            for (const product of [row, ...row.variants] as Record<string, unknown>[])
              for (const field of ["allergens", "diet", "dietOverride", "dietaryDeclarations"])
                delete product[field];
          if (row.kind === "extras" && Array.isArray(row.items))
            for (const item of row.items as Record<string, unknown>[])
              for (const field of ["addAllergens", "suitableFor"]) delete item[field];
        },
      });
      const tables = expected[phase].tables;
      const rows = [
        ...Object.values(tables.zone_day_ranges!.rows).map((range) => ({
          range,
          day: tables.zone_days!.rows[String(range.day_id)]!,
          department: false,
        })),
        ...Object.values(tables.department_day_ranges!.rows).map((range) => ({
          range,
          day: tables.department_days!.rows[String(range.day_id)]!,
          department: true,
        })),
      ].map(({ range, day, department }) => {
        const row = {
          department_id: department ? day.department_id : null,
          zone_id: department ? null : day.zone_id,
          season_id: day.season_id,
          weekday: day.weekday,
          special_day_date_id: day.special_day_date_id,
          period_id: department ? range.period_id : null,
          kind: department ? (range.period_id === null ? "closed" : "period") : range.kind,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
        };
        const id = `@opening_hours:${stable([
          row.department_id,
          row.zone_id,
          row.season_id,
          row.special_day_date_id,
          row.weekday,
          row.starts_at,
        ])}`;
        return [id, { id, ...row }] as const;
      });
      const columns = [
        "id",
        "department_id",
        "zone_id",
        "season_id",
        "weekday",
        "special_day_date_id",
        "kind",
        "period_id",
        "starts_at",
        "ends_at",
      ];
      tables.opening_hours = {
        columns: columns.map((name) => ({
          name,
          type: name === "weekday" ? "INTEGER" : "TEXT",
          notnull: ["id", "kind", "starts_at", "ends_at"].includes(name) ? 1 : 0,
          dflt_value: null,
          pk: name === "id" ? 1 : 0,
        })),
        foreignKeys: [
          [0, 0, "menu_periods", "period_id", "id", "NO ACTION"],
          [0, 1, "menu_periods", "department_id", "department_id", "NO ACTION"],
          [1, 0, "special_day_dates", "special_day_date_id", "id", "CASCADE"],
          [2, 0, "seasons", "season_id", "id", "CASCADE"],
          [3, 0, "floor_zones", "zone_id", "id", "CASCADE"],
          [4, 0, "departments", "department_id", "id", "CASCADE"],
        ].map(([id, seq, table, from, to, on_delete]) => ({
          id: Number(id),
          seq: Number(seq),
          table: String(table),
          from: String(from),
          to: String(to),
          on_delete: String(on_delete),
          on_update: "NO ACTION",
          match: "NONE",
        })),
        rows: Object.fromEntries(rows.sort(([a], [b]) => a.localeCompare(b))),
      };
      delete tables.department_days;
      delete tables.department_day_ranges;
      delete tables.zone_days;
      delete tables.zone_day_ranges;
      expected[phase].tables = byName(tables);
      phases[phase]!.opening_hours =
        phases[phase]!.zone_day_ranges! + phases[phase]!.department_day_ranges!;
      delete phases[phase]!.department_days;
      delete phases[phase]!.department_day_ranges;
      delete phases[phase]!.zone_days;
      delete phases[phase]!.zone_day_ranges;
      phases[phase] = byName(phases[phase]!);

      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "card_reader_holders",
          into: "card_readers",
          match: { from: "reader_id", into: "id" },
          columns: { device_id: "held_by_device_id" },
        },
      ]);
      const readerTable = expected[phase].tables.card_readers!;
      const holderColumn = readerTable.columns.pop()!;
      holderColumn.notnull = 0;
      readerTable.columns.splice(4, 0, holderColumn);
      readerTable.foreignKeys[0]!.on_delete = "SET NULL";
      delete phases[phase]!.card_reader_holders;

      const profileReaders = expected[phase].tables.device_profile_card_readers!;
      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "device_made_here_stations",
          into: "devices",
          match: { from: "device_id", into: "id" },
          columns: {},
          collect: { from: "station_id", into: "made_here_station_ids" },
        },
        {
          from: "device_card_readers",
          into: "devices",
          match: { from: "device_id", into: "id" },
          columns: { reader_id: "card_reader_id" },
        },
      ]);
      const deviceTable = expected[phase].tables.devices!;
      const choiceColumn = deviceTable.columns.pop()!;
      choiceColumn.notnull = 0;
      deviceTable.columns.splice(
        deviceTable.columns.findIndex((column) => column.name === "invoice_printer_id") + 1,
        0,
        choiceColumn,
      );
      deviceTable.columns.push({
        name: "invoice_revision",
        type: "INTEGER",
        notnull: 1,
        dflt_value: "0",
        pk: 0,
      });
      for (const row of Object.values(deviceTable.rows)) row.invoice_revision = 0;
      deviceTable.foreignKeys = deviceTable.foreignKeys
        .filter((key) => key.from !== "card_reader_id")
        .map((key) => ({ ...key, id: key.id - 1 }));
      const approvals = expected[phase].tables.device_approved_profiles!;
      approvals.columns.push(
        ...["starting_zone_id", "zone_ids"].map((name) => ({
          name,
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        })),
      );
      approvals.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "floor_zones",
          from: "starting_zone_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        ...approvals.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];
      for (const row of Object.values(approvals.rows)) {
        row.starting_zone_id = null;
        row.zone_ids = null;
      }
      const profileTable = expected[phase].tables.device_profiles!;
      const scopes = expected[phase].tables.device_profile_service_access!;
      const profileZones = expected[phase].tables.device_profile_zones!;
      const scopeByProfile = new Map(
        Object.values(scopes.rows).map((row) => [row.device_profile_id, row]),
      );
      profileTable.columns.splice(
        profileTable.columns.findIndex((column) => column.name === "created_at"),
        0,
        ...["order_department_id", "order_starting_zone_id", "order_zone_ids"].map((name) => ({
          name,
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        })),
      );
      profileTable.foreignKeys = ["starting_zone_id", "department_id"].map((from, id) => ({
        ...scopes.foreignKeys.find((key) => key.from === from)!,
        from: "order_" + from,
        id,
      }));
      for (const row of Object.values(profileTable.rows)) {
        const scope = scopeByProfile.get(row.id);
        row.order_department_id = scope?.department_id ?? null;
        row.order_starting_zone_id = scope?.starting_zone_id ?? null;
        row.order_zone_ids =
          scope === undefined || scope.every_zone === 1
            ? null
            : Object.values(profileZones.rows)
                .filter((link) => link.device_profile_id === row.id)
                .map((link) => link.zone_id)
                .sort();
      }
      delete expected[phase].tables.device_profile_service_access;
      delete expected[phase].tables.device_profile_zones;
      delete phases[phase]!.device_profile_service_access;
      delete phases[phase]!.device_profile_zones;
      profileTable.columns.splice(
        profileTable.columns.findIndex((column) => column.name === "created_at"),
        0,
        { name: "card_readers", type: "TEXT", notnull: 1, dflt_value: "'{}'", pk: 0 },
      );
      for (const row of Object.values(profileTable.rows)) {
        const listed = Object.values(profileReaders.rows)
          .filter((link) => link.device_profile_id === row.id)
          .sort((a, b) => Number(a.position) - Number(b.position));
        row.card_readers =
          listed.length === 0
            ? {}
            : {
                ids: listed.map((link) => link.reader_id),
                defaultId: listed.find((link) => link.is_default === 1)?.reader_id ?? null,
              };
      }
      profileTable.columns.splice(
        profileTable.columns.findIndex(({ name }) => name === "card_readers"),
        0,
        { name: "printer_lists", type: "TEXT", notnull: 1, dflt_value: "'{}'", pk: 0 },
        { name: "kitchen_views", type: "TEXT", notnull: 1, dflt_value: "'{}'", pk: 0 },
      );
      const printerLinks = Object.values(expected[phase].tables.device_profile_printers!.rows);
      for (const profile of Object.values(profileTable.rows)) {
        const lists: Record<string, { ids: unknown[]; defaultId: unknown }> = {};
        for (const row of printerLinks
          .filter((row) => row.device_profile_id === profile.id)
          .sort((a, b) => Number(a.position) - Number(b.position))) {
          const list = (lists[String(row.role)] ??= { ids: [], defaultId: null });
          const id = row.printer_id ?? row.page_printer_id;
          list.ids.push(id);
          if (row.is_default === 1) list.defaultId = id;
        }
        profile.printer_lists = lists;
        profile.kitchen_views = {};
      }
      delete expected[phase].tables.device_profile_printers;
      delete phases[phase]!.device_profile_printers;
      delete expected[phase].tables.device_profile_card_readers;
      delete phases[phase]!.device_made_here_stations;
      delete phases[phase]!.device_card_readers;
      delete phases[phase]!.device_profile_card_readers;

      const staffMenuFold = {
        from: "menu_period_staff_menus",
        into: "menu_periods",
        match: { from: "period_id", into: "id" },
        columns: {},
        collect: { from: "menu_id", into: "staff_menu_ids", orderBy: "display_order" },
      };
      if (phase === "seeded") {
        const periods = madridWithPeriodChanges(expected.seeded, PERIOD_CHANGES[locale]);
        expected.seeded = periods.semantics;
        for (const [name, count] of Object.entries(periods.added)) phases.seeded![name]! += count;
        const terrace = `@floor_zones:${stable([locale === "en" ? "Terrace" : "Terraza"])}`;
        const closureRows = expected.seeded.tables.opening_hours!.rows;
        for (const [oldId, row] of Object.entries(closureRows)) {
          if (row.zone_id !== terrace) continue;
          expect({ kind: row.kind, startsAt: row.starts_at, endsAt: row.ends_at }).toEqual({
            kind: "closed",
            startsAt: "23:00:00",
            endsAt: "00:00:00",
          });
          closureRows[oldId] = { ...row, ends_at: "05:00:00" };
        }
        expected.seeded.tables.opening_hours!.rows = Object.fromEntries(
          Object.entries(closureRows).sort(([a], [b]) => a.localeCompare(b)),
        );
        const { semantics, added } = madridWithSharedOffers(
          madridWithDroppedColumns(
            madridWithPhotos(madridWithFoldedTables(expected.seeded, [staffMenuFold])),
            {
              products: ["catalogue_id", "name_key", "manual_allergens", "diet"],
            },
          ),
          historicalSeeded,
          SHARED_DRINKS[locale],
        );
        expected.seeded = semantics;
        for (const [name, count] of Object.entries(added)) phases.seeded![name]! += count;
      }
      expected[phase] = madridWithRenamedTables(expected[phase], { catalogues: "menus" });
      expected[phase] = madridWithDroppedColumns(expected[phase], {
        products: ["catalogue_id", "name_key", "manual_allergens", "diet"],
      });
      phases[phase]!.menus = phases[phase]!.catalogues!;
      delete phases[phase]!.catalogues;
      phases[phase] = Object.fromEntries(
        Object.entries(phases[phase]!).sort(([a], [b]) => a.localeCompare(b)),
      );
      expected[phase] = madridWithProductUnits(expected[phase]);
      expected[phase] = madridWithOptionDefaults(expected[phase]);
      delete phases[phase]!.product_units;
      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "menu_details",
          into: "menus",
          match: { from: "menu_id", into: "id" },
          columns: {
            handheld_columns: "handheld_columns",
            handheld_tiles: "handheld_tiles",
            handheld_order: "handheld_order",
            till_columns: "till_columns",
            till_tiles: "till_tiles",
            till_order: "till_order",
          },
        },
        {
          from: "category_details",
          into: "categories",
          match: { from: "category_id", into: "id" },
          columns: { parent_id: "parent_id", color: "color" },
        },
      ]);
      expected[phase] = madridWithDroppedColumns(expected[phase], { menus: ["version"] });
      const menus = expected[phase].tables.menus!;
      menus.columns.push(
        { name: "kind", type: "TEXT", notnull: 1, dflt_value: "'menu'", pk: 0 },
        { name: "set_price", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
        { name: "set_vat_class", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      );

      delete phases[phase]!.menu_details;
      delete phases[phase]!.category_details;
      expected[phase] = madridWithSectionColumns(expected[phase]);
      expected[phase] = madridWithMenuReleases(expected[phase]);
      for (const [tableName, column] of [
        ["menu_versions", "created_by"],
        ["menu_releases", "cancelled_by"],
      ] as const) {
        const table = expected[phase].tables[tableName]!;
        table.foreignKeys = [
          personKey(column, 0),
          ...table.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
        ];
      }
      for (const row of Object.values(expected[phase].tables.menu_versions!.rows)) {
        expect(row.created_by).toBe("demo-seed");
        row.created_by = '@persons:["owner@example.test"]';
      }
      phases[phase]!.menu_releases =
        phases[phase]!.menu_publications! + phases[phase]!.menu_scheduled_publications!;
      delete phases[phase]!.menu_publications;
      delete phases[phase]!.menu_scheduled_publications;
      phases[phase] = byName(phases[phase]!);

      if (phase !== "seeded")
        expected[phase] = madridWithFoldedTables(expected[phase], [staffMenuFold]);
      delete phases[phase]!.menu_period_staff_menus;

      for (const table of ["payment_resolutions", "payment_holds", "payment_hold_outcomes"]) {
        expect(expected[phase].tables[table]!.rows).toEqual({});
        delete phases[phase]![table];
      }
      expected[phase] = madridWithFoldedTables(expected[phase], [
        {
          from: "payment_hold_outcomes",
          into: "payment_holds",
          match: { from: "hold_id", into: "id" },
          columns: {
            outcome: "outcome",
            note: "note",
            person_id: "person_id",
            recorded_at: "recorded_at",
          },
        },
        {
          from: "payment_resolutions",
          into: "payments",
          match: { from: "payment_id", into: "id" },
          columns: {
            outcome: "resolution_outcome",
            cancelled_at_provider: "resolution_cancelled_at_provider",
            provider_status: "resolution_provider_status",
            person_id: "resolved_by",
            resolved_at: "resolved_at",
          },
        },
        {
          from: "payment_holds",
          into: "payments",
          match: { from: "payment_id", into: "id" },
          columns: {
            provider_amount: "hold_provider_amount",
            found_at: "held_at",
            outcome: "hold_outcome",
            note: "hold_note",
            person_id: "hold_decided_by",
            recorded_at: "hold_decided_at",
          },
        },
      ]);
      const paymentTable = expected[phase].tables.payments!;
      for (const column of paymentTable.columns.slice(-11)) column.notnull = 0;
      paymentTable.columns.push({
        name: "requested_by",
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
        pk: 0,
      });
      for (const row of Object.values(paymentTable.rows)) row.requested_by = null;
      expected[phase].tables.persons!.columns.find(
        (column) => column.name === "display_name_folded",
      )!.notnull = 1;
      const actions = expected[phase].tables.account_actions!;
      actions.columns = actions.columns.filter((column) => column.name !== "target_email");
      for (const row of Object.values(actions.rows)) delete row.target_email;
      for (const name of ["till_sessions", "dashboard_sessions"]) {
        const table = expected[phase].tables[name]!;
        table.foreignKeys = [
          personKey("person_id", 0),
          ...table.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
        ];
      }
      const refundTable = expected[phase].tables.payment_refunds!;
      refundTable.foreignKeys = [
        personKey("authorized_by", 0),
        ...refundTable.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];
      expected[phase].tables = byName(expected[phase].tables);

      paymentTable.foreignKeys = [
        personKey("hold_decided_by", 0),
        personKey("resolved_by", 1),
        ...paymentTable.foreignKeys.map((key) => ({
          ...key,
          id: key.id + (key.from === "device_id" ? 3 : 2),
        })),
        personKey("requested_by", paymentTable.foreignKeys.length + 1),
      ];
      paymentTable.foreignKeys.sort((a, b) => a.id - b.id);

      const deliveriesTable = expected[phase].tables.invoice_deliveries!;
      deliveriesTable.foreignKeys.splice(2, 0, {
        ...personKey("person_id", 2),
        on_delete: "NO ACTION",
      });
      deliveriesTable.foreignKeys = deliveriesTable.foreignKeys.map((key, id) => ({ ...key, id }));
      const printJobsTable = expected[phase].tables.print_jobs!;
      printJobsTable.columns.push({
        name: "tender_refund_id",
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
        pk: 0,
      });
      for (const row of Object.values(printJobsTable.rows)) row.tender_refund_id = null;
      printJobsTable.foreignKeys = [
        {
          id: 0,
          seq: 0,
          table: "tender_refunds",
          from: "tender_refund_id",
          to: "id",
          on_update: "NO ACTION",
          on_delete: "NO ACTION",
          match: "NONE",
        },
        ...printJobsTable.foreignKeys.map((key) => ({ ...key, id: key.id + 1 })),
      ];

      if (phase !== "seeded") expected[phase] = madridWithPhotos(expected[phase]);
      phases[phase]!.media_blobs = Object.keys(expected[phase].tables.media_blobs!.rows).length;
      delete phases[phase]!.media_image_data;
      delete phases[phase]!.media_image_blobs;
      delete phases[phase]!.media_image_edits;
      phases[phase] = byName(phases[phase]!);
      expect(Object.keys(canonical[phase].tables)).toEqual(Object.keys(expected[phase].tables));
      expect(Object.keys(canonical[phase].tables)).toEqual(Object.keys(phases[phase]!));
      for (const [name, actual] of Object.entries(canonical[phase].tables)) {
        expect(Object.keys(actual.rows).length, `${phase}/${name} row count`).toBe(
          phases[phase]![name],
        );
        expect(actual, `${phase}/${name}`).toEqual(expected[phase].tables[name]);
      }
    }
    const changes: Record<string, { added: string[]; changed: string[]; deleted: string[] }> = {};
    for (const [name, table] of Object.entries(canonical.seeded.tables)) {
      const before = canonical.provisioned.tables[name]!.rows;
      const after = table.rows;
      const delta = {
        added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
        changed: Object.keys(after).filter(
          (key) =>
            Object.hasOwn(before, key) &&
            JSON.stringify(after[key]) !== JSON.stringify(before[key]),
        ),
        deleted: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
      };
      if (Object.values(delta).some((keys) => keys.length > 0)) changes[name] = delta;
    }
    const expectedChanges: typeof changes = {};
    for (const [name, table] of Object.entries(expected.seeded.tables)) {
      const before = expected.provisioned.tables[name]!.rows;
      const after = table.rows;
      const delta = {
        added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
        changed: Object.keys(after).filter(
          (key) =>
            Object.hasOwn(before, key) &&
            JSON.stringify(after[key]) !== JSON.stringify(before[key]),
        ),
        deleted: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
      };
      if (Object.values(delta).some((keys) => keys.length > 0)) expectedChanges[name] = delta;
    }
    expect(changes).toEqual(expectedChanges);
  });
}
