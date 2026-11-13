import { withTransaction, persons, deviceProfiles } from "@waitron/db";
import { listStaffAdmittedTo } from "@waitron/identity";
import { STARTER_JOB_ROLE_NAMES, DEMO_JOB_ROLE_NAMES } from "@waitron/provisioning";
import { madridWithFoldedTables } from "./testing/madrid-folded-tables.js";
import { madridWithDocument } from "./testing/madrid-documents.js";
import { stable } from "./testing/madrid-semantics.js";
import {
  madridWithDroppedColumns,
  type MadridColumnDrops,
} from "./testing/madrid-dropped-columns.js";
import { afterEach, expect, it, vi } from "vitest";
import { STARTER_COURSE_NAMES } from "@waitron/venue-service";
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

const DROPPED_COLUMNS: MadridColumnDrops = {
  persons: ["role"],
  device_profile_admission_roles: ["role"],
  nodes: ["location_id"],
  adjustment_reasons: ["apply_roles", "approver_roles"],
  devices: ["location_id"],
  working_orders: ["location_id"],
  tender_refunds: ["location_id"],
  join_requests: ["location_id"],
  dining_tables: ["location_id"],
  floor_plan_sets: ["location_id"],
  floor_zones: ["location_id"],
  kitchen_stations: ["location_id"],
  kitchen_courses: ["location_id"],
  print_agents: ["location_id"],
  printers: ["location_id"],
  print_jobs: ["location_id"],
  page_printers: ["location_id"],
  department_sale_policies: ["receipt_print_mode"],
  zone_sale_policies: ["receipt_print_mode"],
  departments: ["location_id"],
  sales: ["operation_date"],
  order_service_contexts: ["location_id"],
  zone_service_policies: ["location_id"],
  routing_cells: ["location_id"],
  seasons: ["location_id"],
  special_days: ["location_id"],
  special_day_dates: ["location_id"],
  bookings: ["location_id"],
  attendance_day_work: ["location_id"],
  attendance_source_state: ["location_id"],
  attendance_operation_facts: ["location_id"],
  attendance_questions: ["location_id"],
  attendance_response_commands: ["location_id"],
  roster_versions: ["location_id"],
  shift_templates: ["location_id"],
  shifts: ["location_id"],
  staff_roles: ["location_id"],
  convenio_config: ["location_id"],
};

const RENAMED_COLUMNS: MadridColumnRenames = { sale_receipt_guests: { guests: "guest_count" } };
/** Tables added after the capture; the seed writes no row to them. */
const ADDED_TABLES = [
  "returned_invoice_records",
  "outgoing_mail",
  "adjustment_lines",
  "bill_identities",
  "bill_number_allocations",
  "device_invoice_revisions",
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
  "order_portion_events",
  "order_portions",
  "recovery_packs",
  "sale_line_portions",
  "deferred_closures",
  "working_line_portions",
  "declaraciones_responsables",
];
const REMOVED_TABLES_WITH_ROWS = ["location_catalogues"];
const REMOVED_TABLES = [
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
  payments: [["state", "requested_amount"]],
  persons: [
    ["first_names", "display_name_folded"],
    ["pending_email", "email_folded"],
    ["email_verified_at", "pending_email_folded"],
  ],
  print_agents: [["node_id", "setup_url", "setup_port"]],
  print_jobs: [["status", "receipt_copy", "receipt_handover"]],
  printers: [["active", "portable", "pickup_roles"]],
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
  tenants: [["created_at", "taxpayer_domicile", "privacy_notice_url", "privacy_email"]],
  ticket_items: [
    ["note", "requested_at", "pass_controlled", "station_chosen_at", "station_retained_at_release"],
  ],
  units: [["name", "staff_name", "staff_abbreviation"]],
  webauthn_credentials: [["created_at", "aaguid"]],
  working_line_contexts: [
    ["menu_name", "menu_version_id"],
    ["hardware_unit", "sold_in_each"],
  ],
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
  page_printers: [1, 0],
  print_jobs: [3, 4, 0, 1, 2],
  tenders: [1, 0],
  working_line_contexts: [2, 0, 1],
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
    expect(seeded.tables.management_sessions!.rows).toEqual(
      provisioned.tables.management_sessions!.rows,
    );
    expect(seeded.tables.products!.rows.length).toBeGreaterThan(45);
    const canonical = {
      before: await canonicalMadridSemantics(before),
      provisioned: await canonicalMadridSemantics(provisioned),
      seeded: await canonicalMadridSemantics(seeded),
    };
    const root = DEMO_BASELINE_FIXTURE_ROOTS[CASA_DELGADO_ES.id];
    expect(root).toBeInstanceOf(URL);
    const fixtureName = `madrid-before-move.${locale}.json`;
    const text = await readFile(new URL(fixtureName, root), "utf8");
    const expected = JSON.parse(text) as Record<
      "before" | "provisioned" | "seeded",
      CanonicalMadridSemantics
    >;
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
    expected.before = madridWithRenamedColumns(expected.before, RENAMED_COLUMNS);
    expected.provisioned = madridWithRenamedColumns(expected.provisioned, RENAMED_COLUMNS);
    expected.seeded = madridWithRenamedColumns(expected.seeded, RENAMED_COLUMNS);
    const phases = structuredClone(manifest.phases[locale]!);
    for (const phase of ["before", "provisioned", "seeded"] as const) {
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
          operation_description: "operationDescription",
          invoice_locales: "invoiceLocales",
          address_line1: "addressLine1",
          address_line2: "addressLine2",
          postal_code: "postalCode",
          city: "city",
          province: "province",
        },
        {
          ...venueMetadata,
          defaults: { contentLanguages: null, defaultContentLanguage: null, holidayArea: null },
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
      phases[phase]!.settings = phase === "before" ? 0 : 2;
      const revisions = phase === "before" ? [] : phase === "seeded" ? [1, 2, 3] : [1, 2];
      expected[phase].tables.activity_log = {
        ...structuredClone(canonical[phase].tables.activity_log!),
        rows: Object.fromEntries(
          [
            ...revisions.map((revision) => ({ revision, module: "venue" })),
            ...(phase === "before" ? [] : [{ revision: 1, module: "business_day" }]),
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
      phases[phase]!.activity_log = revisions.length + (phase === "before" ? 0 : 1);
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
          "catalogue.manage",
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
      const products = expected[phase].tables.products!;
      products.columns.splice(
        products.columns.findIndex((column) => column.name === "variant_order") + 1,
        0,
        { name: "set_lunch", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 },
      );
      for (const row of Object.values(products.rows)) row.set_lunch = 0;
      products.columns = products.columns.filter(
        (column) => !["recipe_derivation", "diet_derivation"].includes(column.name),
      );
      for (const row of Object.values(products.rows)) {
        delete row.recipe_derivation;
        delete row.diet_derivation;
      }
      const contexts = expected[phase].tables.working_line_contexts!;
      contexts.columns = contexts.columns.filter((column) => column.name !== "diet_derivation");
      for (const row of Object.values(contexts.rows)) delete row.diet_derivation;
      contexts.columns.splice(
        contexts.columns.findIndex((column) => column.name === "allergens") + 1,
        0,
        {
          name: "sent_nutrition",
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        },
      );
      for (const row of Object.values(contexts.rows)) row.sent_nutrition = null;
      for (const row of Object.values(expected[phase].tables.menu_versions!.rows)) {
        const document = row.document as {
          offers: Record<
            string,
            { dietDerivation?: unknown; variants: { dietDerivation?: unknown }[] }
          >;
        };
        for (const offer of Object.values(document.offers)) {
          delete offer.dietDerivation;
          for (const variant of offer.variants) delete variant.dietDerivation;
        }
      }
      expected[phase] = madridWithNameChanges(expected[phase], []);

      const parties = expected[phase].tables.parties!;
      parties.columns = parties.columns.filter((column) => column.name !== "main_bill_id");
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
      for (const name of ["workforce_chains", "time_entries", "pay_period_closures"]) {
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
      const commandLocation = expected[phase].tables.attendance_response_commands!.columns.find(
        (column) => column.name === "location_id",
      )!;
      commandLocation.notnull = 0;
      const questions = expected[phase].tables.attendance_questions!;
      questions.foreignKeys = questions.foreignKeys.filter(
        (key) => !(key.table === "time_entries" && key.from === "location_id"),
      );
      expected[phase].tables.webauthn_challenges!.columns.push({
        name: "purpose",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      });
      for (const [name, column, value] of [
        [
          "bill_payments",
          { name: "remaining_after", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "management_sessions",
          { name: "proved_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "management_sessions",
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
          "device_profile_kitchen_screens",
          {
            name: "show_non_pass_stations",
            type: "INTEGER",
            notnull: 1,
            dflt_value: "true",
            pk: 0,
          },
          1,
        ],
        [
          "device_kitchen_screens",
          { name: "show_non_pass_stations", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
          null,
        ],
        [
          "payments",
          { name: "requested_amount", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
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
      expected[phase] = madridWithDroppedColumns(expected[phase], DROPPED_COLUMNS);
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
        const accessData = { roleId: '@roles:["admin"]', builtInKey: "admin", name: null };
        const accessSubject = '@persons:["owner@example.test"]';
        const accessId = `@activity_log:${stable(["access_role.member_added", accessSubject, at, JSON.stringify(accessData)])}`;
        expected[phase].tables.activity_log!.rows[accessId] = {
          id: accessId,
          at,
          kind: "access_role.member_added",
          subject_kind: "person",
          subject_id: accessSubject,
          person_id: null,
          device_id: null,
          data: accessData,
        };
        phases[phase]!.activity_log! += 1;
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
