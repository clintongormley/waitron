import { locationId as brandLocationId } from "@waitron/shared";
import {
  addMember,
  addShortcut,
  deleteSection,
  readMenuHome,
  createCatalogue,
  createCategory,
  createExtraList,
  addProductToMenu,
  createOptionList,
  createProduct,
  createSectionIn,
  listExtraLists,
  listMenuOffers,
  listOptionLists,
  menuStatus,
  menuVersions,
  menuPublications,
  menuDocumentHash,
  previewMenu,
  publishMenu,
  readMenuStructure,
  readSection,
  sectionMembers,
  sections,
  setProductVariants,
  updateOptionList,
  writeProductModifiers,
} from "@waitron/catalogue";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { uploadImage, readImageBytes } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import {
  catalogues,
  categories,
  deviceProfiles,
  devices,
  diningTables,
  floorZones,
  kitchenStations,
  kitchenStationTiming,
  kitchenTimingDefaults,
  locations,
  printAgents,
  printers,
  watchers,
  watcherStations,
  watcherZones,
  watcherPrinters,
  CORE_CONFIGURATION_TRANSFER,
  products,
  sales,
  tenantReceipts,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  deleteDeviceProfile,
  emptyPrinterLists,
  getPrintedReceipt,
  getReceipt,
  readProfilePrinterLists,
  setProfilePrinterLists,
} from "@waitron/layouts";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import {
  deviceProfileAdmissionPersons,
  deviceProfileAdmissionRoles,
  hashPassword,
  hashPin,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { recordSale } from "@waitron/core";
import { categoryDetails } from "@waitron/catalogue";
import { availability, employments, shiftTemplates } from "@waitron/workforce";
import { convenioConfig } from "@waitron/workforce-es";
import { bookings } from "@waitron/bookings";
import {
  createAdjustmentReason,
  deactivateAdjustmentReason,
  listAdjustmentReasons,
  readAdjustmentSettings,
  saveAdjustmentSettings,
} from "@waitron/adjustments";
import { payments } from "@waitron/payments";
import {
  createDepartment,
  setDepartmentTransferSettings,
  setProfileServiceScope,
  createServiceZone,
  departmentSalePolicies,
  departments,
  readHolidays,
  readLocalHolidayModel,
  readProfileServiceAccess,
  readSpecialDate,
  readWeekHours,
  replaceWeekHours,
  resolveOpeningDateHours,
  saveHolidayArea,
  saveLocalHoliday,
  saveSpecialDate,
  setDepartmentAllDayMenu,
  setDepartmentMenus,
  setProfileServiceAccess,
  setRoutingCell,
  setStationToday,
  setZoneAllDayMenu,
  stationStates,
  type WeekCell,
  type WeekDay,
  zoneSalePolicies,
} from "@waitron/venue-service";
import { decimal, locationId, nodeId, seriesId, deviceOrigin } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { readVenueDetails, writeVenueDetails } from "./venue-details.js";
import { drawLogoRasters } from "./receipt-logo.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { systemClock } from "./till-backend.js";
import {
  buildConfigurationBundle,
  applyPreparedLocation,
  exportConfigurationTables,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { createStatus } from "./tables.js";
import { setDefaultStation } from "./kitchen.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import type { TillConfig } from "./till-config.js";

// TWO databases: a transfer exports from a prepared venue's database and imports into a fresh
// production database, and each holds one tenant. `suite` holds the source venue, `targetSuite` the
// target the bundle is imported into.
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const targetSuite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function venue(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Prepared SL",
    taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
    location: {
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    },
    seriesCode: "F",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      email: `${taxId.toLowerCase()}@example.test`,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("a secure password"),
    },
  };
}

const bundle: ConfigurationBundle = {
  version: 2,
  createdAt: "2026-09-09T00:00:00.000Z",
  sourceOperatorId: "source-admin",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
    location: {
      id: "location",
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
      bumpMode: "line",
      fireControl: "waiter",
      catalogueId: null,
    },
    seriesCode: "F",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
  },
  modules: { core: 1 },
  tables: { products: [{ id: "p1", name: "Café" }] },
  reconnect: ["printers"],
};

describe("configuration transfer archive", () => {
  it("round-trips image bytes and metadata in the database payload", () => {
    const imageBundle: ConfigurationBundle = {
      ...bundle,
      tables: {
        products: [{ ...bundle.tables.products![0], image: "a".repeat(64) + ".png" }],
        media_images: [
          {
            id: "image",
            filename: "a".repeat(64) + ".png",
            names: { en: "Bread" },
          },
        ],
        media_image_data: [{ image_id: "image", bytes: "\\x89504e470d0a1a0a" }],
      },
    };
    expect(
      decodeConfigurationBundle(
        encodeConfigurationBundle(imageBundle, "a strong passphrase"),
        "a strong passphrase",
      ),
    ).toEqual(imageBundle);
  });
  it("round-trips the versioned payload under the export passphrase", () => {
    expect(
      decodeConfigurationBundle(
        encodeConfigurationBundle(bundle, "a strong passphrase"),
        "a strong passphrase",
      ),
    ).toEqual(bundle);
  });

  it("refuses a prepared bundle without its full invoice series", () => {
    const missing = { ...bundle, venue: { ...bundle.venue } };
    delete (missing.venue as Partial<typeof missing.venue>).fullSeriesCode;
    expect(() =>
      decodeConfigurationBundle(
        encodeConfigurationBundle(missing, "a strong passphrase"),
        "a strong passphrase",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "setup.request_invalid", params: { field: "artifact" } }),
    );
  });

  it("accepts a bundle that still carries a tillName, as it checks only the venue fields it names", () => {
    const older = { ...bundle, venue: { ...bundle.venue, tillName: "Till" } };
    expect(
      decodeConfigurationBundle(
        encodeConfigurationBundle(older, "a strong passphrase"),
        "a strong passphrase",
      ).venue,
    ).toMatchObject(bundle.venue);
  });

  it("rejects a short passphrase before creating an artifact", () => {
    expect(() => encodeConfigurationBundle(bundle, "short")).toThrowError(
      expect.objectContaining({ code: "setup.request_invalid", params: { field: "passphrase" } }),
    );
  });

  it("rejects an undeclared module contribution", async () => {
    const { exportConfigurationTables } = await import("./configuration-transfer.js");
    const module = { name: "probe" } as WaitronModule;
    await expect(exportConfigurationTables({} as never, [module])).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "module:probe" },
    });
  });
});

describe("configuration transfer database path", () => {
  it("rolls the new venue back when an imported row is invalid", async () => {
    const targetRequest = venue("B11111111");
    const coreOnly = [
      {
        name: "core",
        version: "0.0.0",
        tier: "mandatory",
        migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
        configurationTransfer: { kind: "tables", tables: [{ name: "products" }] },
      } satisfies WaitronModule,
    ];
    await expect(
      applyVenue(planVenue(targetRequest, ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
        beforeCommit: async (tx, result) => {
          await importConfigurationTables(
            tx,
            {
              ...bundle,
              tables: {
                products: [{ ...bundle.tables.products![0], injected_column: "refuse me" }],
              },
            },
            { locationId: result.locationId },
            coreOnly,
            { core: 1 },
          );
        },
      }),
    ).rejects.toMatchObject({ code: "setup.request_invalid" });
    const persisted = await suite.db.execute<{ count: number }>(sql`
      select count(*) as count from tenants where tax_id = ${targetRequest.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });

  it("copies declared configuration into a fresh venue while scrubbing staff authenticators", async () => {
    const photo = await samplePreparedImage({ width: 8 });
    const source = await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const uploaded = await uploadImage(
        tx,
        {
          image: photo,
          names: { es: "Pan" },
        },
        {},
      );
      // Rows are written through their table definitions: the NOT NULL timestamp columns are
      // `$defaultFn` generators a raw insert never reaches, and the definition encodes the JSON
      // columns. `payment_policy` is the one exception below.
      await tx.insert(persons).values({
        id: "12121212-aaaa-aaaa-aaaa-121212121212",
        displayName: "Second admin",
        pinHash: "second-admin-pin",
        passwordHash: "second-admin-password",
        email: "second-admin@example.test",
        role: "admin",
      });
      await tx
        .insert(catalogues)
        .values({ id: "11111111-aaaa-aaaa-aaaa-111111111111", name: "Prepared menu" });
      await tx.insert(products).values({
        id: "22222222-aaaa-aaaa-aaaa-222222222222",
        catalogueId: "11111111-aaaa-aaaa-aaaa-111111111111",
        name: "Café",
        pricingUnit: "each",
        unitPrice: 150,
        vatClass: "general",
      });
      await tx
        .update(products)
        .set({ image: uploaded.image.filename })
        .where(eq(products.id, "22222222-aaaa-aaaa-aaaa-222222222222"));
      await tx
        .insert(categories)
        .values({ id: "23232323-aaaa-aaaa-aaaa-232323232323", name: "Panadería" });
      await tx
        .insert(categoryDetails)
        .values({ categoryId: "23232323-aaaa-aaaa-aaaa-232323232323" });
      await tx
        .update(products)
        .set({ categoryId: "23232323-aaaa-aaaa-aaaa-232323232323" })
        .where(eq(products.id, "22222222-aaaa-aaaa-aaaa-222222222222"));
      await tx.insert(persons).values({
        id: "33333333-aaaa-aaaa-aaaa-333333333333",
        displayName: "Ada",
        pinHash: "source-pin-secret",
        passwordHash: "source-password-secret",
        email: "ada@example.test",
        role: "manager",
      });
      await tx.insert(employments).values({
        id: "66666666-aaaa-aaaa-aaaa-666666666666",
        personId: "33333333-aaaa-aaaa-aaaa-333333333333",
        contractedMinutesPerWeek: 2400,
        contractType: "permanent",
        startDate: "2026-01-01",
        payRate: 1250,
      });
      await tx.insert(availability).values({
        id: "77777777-aaaa-aaaa-aaaa-777777777777",
        personId: "33333333-aaaa-aaaa-aaaa-333333333333",
        weekday: 1,
        availableFromMinute: 540,
        availableToMinute: 1020,
        effectiveFrom: "2026-01-01",
      });
      await tx.insert(shiftTemplates).values({
        id: "88888888-aaaa-aaaa-aaaa-888888888888",
        locationId: source.locationId,
        label: "Evening",
        weekday: 1,
        startsMinute: 1020,
        endsMinute: 120,
        role: "bar",
      });
      await tx.insert(convenioConfig).values({
        id: "99999999-aaaa-aaaa-aaaa-999999999999",
        locationId: source.locationId,
      });
      // Raw because `@waitron/payments` does not export `paymentPolicy`, so the two `$defaultFn`
      // timestamps are supplied here.
      const policyStamp = new Date().toISOString();
      await tx.execute(sql`
        insert into payment_policy (offline_mode, offline_amount_cap, created_at, updated_at)
        values ('cash_only', 5000, ${policyStamp}, ${policyStamp})`);
      await tx.insert(workingOrders).values({
        id: "aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa",
        source: "dashboard",
        deviceId: null,
        locationId: source.locationId,
        nodeId: source.nodeId,
        orderNumber: 1,
        label: "Practice tab",
      });
      await tx.insert(diningTables).values({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        locationId: source.locationId,
        label: "T1",
      });
      await tx.insert(payments).values({
        id: "cccccccc-bbbb-bbbb-bbbb-cccccccccccc",
        workingOrderId: "aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa",
        source: "demo_seed",
        nodeId: source.nodeId,
        provider: "simulated",
        paymentRef: "practice-payment",
        amount: 150,
        state: "captured",
      });
      await tx.insert(bookings).values({
        id: "dddddddd-bbbb-bbbb-bbbb-dddddddddddd",
        locationId: source.locationId,
        bookingDate: "2026-09-10",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Practice guest",
        tableId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        createdBy: "33333333-aaaa-aaaa-aaaa-333333333333",
      });
      await tx.insert(printAgents).values({
        id: "44444444-aaaa-aaaa-aaaa-444444444444",
        locationId: source.locationId,
        name: "Kitchen agent",
        tokenHash: "source-agent-token",
        active: true,
        host: "source-box.local",
      });
      await tx.insert(printers).values({
        id: "55555555-aaaa-aaaa-aaaa-555555555555",
        locationId: source.locationId,
        name: "Kitchen printer",
        transport: "usb",
        localKey: "B120300001",
        active: true,
        paperWidth: "58mm",
        resolution: "203dpi",
      });
      await tx.insert(sales).values({
        source: "demo_seed",
        seriesId: source.seriesIds[0]!,
        nodeId: source.nodeId,
        invoiceNumber: 99,
        issuedAt: "2026-09-09T10:00:00Z",
        issuedOffsetMinutes: 0,
        total: 150,
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
    });
    const sourceOperator = await suite.db.execute<{ id: string }>(sql`
      select id from persons
      where role = 'admin'
        and id <> '12121212-aaaa-aaaa-aaaa-121212121212'
    `);
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: sourceOperator.rows[0]!.id },
      ALL_MODULES,
      new Date("2026-09-09T00:00:00.000Z"),
      versions,
    );
    expect(transferred.venue.fullSeriesCode).toBe("FF");
    expect(transferred.venue.taxpayerDomicile).toBe("Calle Fiscal 8, 28001 Madrid");
    expect(transferred.venue).not.toHaveProperty("tillName");
    expect(transferred.venue.location).not.toHaveProperty("orderFlow");
    for (const person of transferred.tables.persons ?? []) {
      expect(person).not.toHaveProperty("pin_hash");
      expect(person).not.toHaveProperty("password_hash");
      // The "a passkey was already offered" mark is per-device local state, not transferable config —
      // passkey credentials themselves never transfer, so the offered mark must not either.
      expect(person).not.toHaveProperty("passkey_offered_at");
    }
    expect(transferred.tables).not.toHaveProperty("sales");
    expect(transferred.tables.print_agents).toHaveLength(1);
    expect(transferred.tables.print_agents![0]).not.toHaveProperty("host");

    const target = await applyVenue(planVenue(venue("B87654323"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: async (tx, result) => {
        await importConfigurationTables(
          tx,
          transferred,
          { locationId: result.locationId },
          ALL_MODULES,
          versions,
        );
      },
    });
    const locationColumns = await targetSuite.db.execute<{ name: string }>(sql`
      select name from pragma_table_info('locations')
    `);
    expect(locationColumns.rows.map((column) => column.name)).not.toContain("order_flow");
    await withTransaction(targetSuite.db, async (tx) => {
      const [metadata] = transferred.tables.media_images!;
      const bytes = await readImageBytes(tx, metadata!.filename as string);
      expect(bytes?.bytes).toEqual(photo.bytes);
      const attached = await tx.execute<{ image: string }>(sql`select image from products `);
      expect(attached.rows[0]!.image).toBe(metadata!.filename);
      const named = await tx.select({ name: categories.name }).from(categories);
      expect(named).toEqual([{ name: "Panadería" }]);
      const category = await tx.execute<{ primary: number }>(sql`
        select
          -- The alias is quoted: primary is a keyword to this parser, so a bare "as primary" is
          -- refused with near "primary": syntax error while the quoted form returns the column.
          -- Measured on node:sqlite, Node v26.7.0, with "as member" as the control that needs no
          -- quoting.
          p.category_id = c.id as "primary"
        from categories c
        join category_details d on d.category_id = c.id
        cross join products p
        where p.name = 'Café'
      `);
      // 1, not `true`: an SQL expression, which the `flag` helper's boolean mapping never
      // reaches. A category that is not the product's main one would answer 0.
      expect(category.rows).toEqual([{ primary: 1 }]);
    });
    const sourceSales = await suite.db.execute<{ count: number }>(
      sql`select count(*) as count from sales `,
    );
    expect(sourceSales.rows[0]!.count).toBe(1);
    const imported = await targetSuite.db.execute<{
      products: number;
      staff: number;
      suspended_admins: number;
      secret_hits: number;
      status: string;
      target_sales: number;
      inactive_agents: number;
      inactive_printers: number;
      source_agent_secrets: number;
      employments: number;
      availability: number;
      shift_templates: number;
      convenio_config: number;
      payment_policy: number;
      target_orders: number;
      target_payments: number;
      target_bookings: number;
    }>(sql`
      select
        (select count(*) from products ) as products,
        (select count(*) from persons where role = 'manager') as staff,
        (select count(*) from persons where role = 'admin' and status = 'suspended') as suspended_admins,
        (select count(*) from persons where (pin_hash = 'source-pin-secret' or password_hash = 'source-password-secret')) as secret_hits,
        (select status from persons where role = 'manager') as status,
        (select count(*) from sales ) as target_sales,
        (select count(*) from print_agents
          where not active) as inactive_agents,
        (select count(*) from printers
          where not active and local_key = 'B120300001') as inactive_printers,
        (select count(*) from print_agents
          where token_hash = 'source-agent-token') as source_agent_secrets,
        (select count(*) from employments) as employments,
        (select count(*) from availability) as availability,
        (select count(*) from shift_templates) as shift_templates,
        (select count(*) from convenio_config) as convenio_config,
        (select count(*) from payment_policy) as payment_policy,
        (select count(*) from working_orders ) as target_orders,
        (select count(*) from payments) as target_payments,
        (select count(*) from bookings) as target_bookings
    `);
    expect(imported.rows[0]).toEqual({
      products: 1,
      staff: 1,
      suspended_admins: 1,
      secret_hits: 0,
      status: "suspended",
      target_sales: 0,
      inactive_agents: 1,
      inactive_printers: 1,
      source_agent_secrets: 0,
      employments: 1,
      availability: 1,
      shift_templates: 1,
      convenio_config: 1,
      payment_policy: 1,
      target_orders: 0,
      target_payments: 0,
      target_bookings: 0,
    });

    const printerSettings = await targetSuite.db.execute<{
      paper_width: string;
      resolution: string;
    }>(sql`
      select paper_width, resolution from printers
      where local_key = 'B120300001'`);
    expect(printerSettings.rows).toEqual([{ paper_width: "58mm", resolution: "203dpi" }]);

    const fiscal = ALL_MODULES.find((module) => module.fiscal?.id === "verifactu")!.fiscal!;
    const origin = deviceOrigin(await seedSessionDevice(targetSuite.db, target));
    await withTransaction(targetSuite.db, (tx) =>
      recordSale(
        tx,
        fiscal.makeBackend({ db: targetSuite.db, clock: systemClock(), environment: "production" }),
        {
          origin,
          nodeId: nodeId(target.nodeId),
          seriesId: seriesId(target.seriesIds[0]!),
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          total: "1.00",
          lines: [
            {
              lineNo: 1,
              name: "First live sale",
              descriptions: { "es-ES": "First live sale" },
              quantity: "1",
              unitPrice: "1.00",
              vatRate: "0.00",
              lineTotal: "1.00",
            },
          ],
          clock: systemClock(),
          settlement: {
            kind: "immediate",
            tenders: [
              {
                method: "cash",
                amount: "1.00",
                tipAmount: "0.00",
                settledAt: new Date("2026-09-09T12:00:00Z"),
              },
            ],
          },
        },
      ),
    );
    // `first_record` is 1, not `true`: this raw statement goes around the `flag` column's boolean
    // read mapping. A CONTINUED chain would answer 0 here and carry a non-null `anterior_huella`.
    const firstLive = await targetSuite.db.execute<{
      invoice_number: number;
      first_record: number;
      previous_hash: string | null;
    }>(
      sql`
        select s.invoice_number, r.primer_registro as first_record,
          r.anterior_huella as previous_hash
        from sales s
        join registros_facturacion r on r.sale_id = s.id
      `,
    );
    expect(firstLive.rows).toEqual([{ invoice_number: 1, first_record: 1, previous_hash: null }]);
  });

  it("carries the venue's authored new-product VAT default through export and import", async () => {
    const source = await applyVenue(planVenue(venue("B66778899"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await suite.db.execute(
      sql`update catalogue_settings set default_product_vat_class = 'zero' where id = 1`,
    );
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-05T12:00:00Z"),
      versions,
    );
    expect(transferred.tables.catalogue_settings).toEqual([
      { id: 1, default_product_vat_class: "zero" },
    ]);
    await applyVenue(planVenue(venue("B99887766"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    expect((await targetSuite.db.execute(sql`select * from catalogue_settings`)).rows).toEqual([
      { id: 1, default_product_vat_class: "zero" },
    ]);
  });

  it("carries a category's colour and a product's own colour", async () => {
    const source = await applyVenue(planVenue(venue("B66778899"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const category = await createCategory(tx, { name: "Postres", color: "#b12525" });
      const menu = await createCatalogue(tx, { name: "Colour menu" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Flan",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      });
      await tx.execute(sql`update products set color = '#256bb1' where id = ${product.id}`);
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-05T12:00:00Z"),
      versions,
    );
    await applyVenue(planVenue(venue("B99887766"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    const imported = await targetSuite.db.execute<{ category: string; product: string }>(sql`
      select d.color as category, p.color as product
      from products p
      join category_details d on d.category_id = p.category_id
      where p.name = 'Flan'
    `);
    expect(imported.rows).toEqual([{ category: "#b12525", product: "#256bb1" }]);
  });

  it("refuses a bundle whose product, category or section colour is not lowercase #rrggbb", async () => {
    const source = await applyVenue(planVenue(venue("B66778800"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const category = await createCategory(tx, { name: "Tartas", color: "#b12525" });
      const menu = await createCatalogue(tx, { name: "Painted menu", color: "#aabbcc" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Tarta",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      });
      await tx.execute(sql`update products set color = '#256bb1' where id = ${product.id}`);
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const clean = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-05T12:00:00Z"),
      versions,
    );
    const malformed = "#256bb1;position:fixed;inset:0";
    const repaint = (table: string, from: string): ConfigurationBundle => {
      expect(clean.tables[table]!.filter((row) => row.color === from)).toHaveLength(1);
      return {
        ...clean,
        tables: {
          ...clean.tables,
          [table]: clean.tables[table]!.map((row) =>
            row.color === from ? { ...row, color: malformed } : row,
          ),
        },
      };
    };
    const bundles = {
      products: repaint("products", "#256bb1"),
      category_details: repaint("category_details", "#b12525"),
      sections: repaint("sections", "#aabbcc"),
    };

    for (const [table, bundle] of Object.entries(bundles)) {
      expect(() => validateConfigurationBundle(bundle, ALL_MODULES, versions)).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: `${table}.color` },
        }),
      );
    }

    const target = venue("B66778811");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, result) =>
          importConfigurationTables(tx, bundles.products, result, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "products.color" } });
    const persisted = await targetSuite.db.execute<{ count: number }>(sql`
      select count(*) as count from tenants where tax_id = ${target.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });

  /** A source venue with one menu whose `till_columns` is 8 and `handheld_order` `menu_first`,
   * set with raw SQL, and the bundle exported from it. */
  async function bundleWithHomeDisplay(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Displayed menu" });
      await tx.execute(
        sql`update menu_details set till_columns = 8, handheld_order = 'menu_first' where menu_id = ${menu.id}`,
      );
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-05T12:00:00Z"),
      versions,
    );
    return { transferred, versions };
  }

  const homeDisplayOf = (db: typeof suite.db) =>
    db.execute<Record<string, unknown>>(sql`
      select d.handheld_columns, d.handheld_tiles, d.handheld_order,
             d.till_columns, d.till_tiles, d.till_order
      from menu_details d
      join catalogues c on c.id = d.menu_id
      where c.name = 'Displayed menu'
    `);

  it("carries a menu's home display settings", async () => {
    const { transferred, versions } = await bundleWithHomeDisplay("B44556601");
    const expected = {
      handheld_columns: 3,
      handheld_tiles: "colours",
      handheld_order: "menu_first",
      till_columns: 8,
      till_tiles: "colours",
      till_order: "home_first",
    };
    expect((await homeDisplayOf(suite.db)).rows).toEqual([expected]);
    await applyVenue(planVenue(venue("B44556602"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    expect((await homeDisplayOf(targetSuite.db)).rows).toEqual([expected]);
  });

  it("refuses a bundle whose display setting a save would refuse", async () => {
    const { transferred, versions } = await bundleWithHomeDisplay("B44556603");
    const details = transferred.tables.menu_details!;
    expect(details.filter((row) => row.till_columns === 8)).toHaveLength(1);
    const malformed: ConfigurationBundle = {
      ...transferred,
      tables: {
        ...transferred.tables,
        menu_details: details.map((row) =>
          row.till_columns === 8 ? { ...row, till_columns: 11 } : row,
        ),
      },
    };
    const refusal = {
      code: "setup.request_invalid",
      params: { field: "menu_details.till_columns" },
    };
    const target = venue("B44556604");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, result) =>
          importConfigurationTables(tx, malformed, result, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ count: number }>(sql`
      select count(*) as count from tenants where tax_id = ${target.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });

  /** A source venue holding a status painted `amber` and one painted `#ef4444`, created through
   * the dashboard's own save, and the bundle exported from it. */
  async function bundleWithStatuses(taxId: string) {
    const request = venue(taxId);
    const source = await applyVenue(planVenue(request, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.email, request.admin.email!));
      const session = await startManagementSession(tx, { personId: admin!.id });
      for (const [label, color] of [
        ["Needs cleaning", "amber"],
        ["Bill requested", "#ef4444"],
      ] as const) {
        await createStatus(tx, { managementSessionId: session.token, label, color });
      }
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-05T12:00:00Z"),
      versions,
    );
    return { transferred, versions };
  }

  it("carries a table service status's named and hex colours", async () => {
    const { transferred, versions } = await bundleWithStatuses("B55660011");
    await applyVenue(planVenue(venue("B55660022"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    const imported = await targetSuite.db.execute<{ label: string; color: string }>(sql`
      select label, color from table_service_statuses order by label
    `);
    expect(imported.rows).toEqual([
      { label: "Bill requested", color: "#ef4444" },
      { label: "Needs cleaning", color: "amber" },
    ]);
  });

  it("refuses a bundle whose table service status colour a save would refuse", async () => {
    const { transferred, versions } = await bundleWithStatuses("B55660033");
    const statuses = transferred.tables.table_service_statuses!;
    expect(statuses.filter((row) => row.color === "amber")).toHaveLength(1);
    const malformed: ConfigurationBundle = {
      ...transferred,
      tables: {
        ...transferred.tables,
        table_service_statuses: statuses.map((row) =>
          row.color === "amber" ? { ...row, color: "red;position:fixed" } : row,
        ),
      },
    };
    const refusal = {
      code: "setup.request_invalid",
      params: { field: "table_service_statuses.color" },
    };

    expect(() => validateConfigurationBundle(malformed, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B55660044");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, result) =>
          importConfigurationTables(tx, malformed, result, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ count: number }>(sql`
      select count(*) as count from tenants where tax_id = ${target.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });
});

it("transfers the extras and options lists, remaps their ids and preserves menu prices", async () => {
  const source = await applyVenue(planVenue(venue("B11223344"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Modifier menu" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    // The extra is a product in its own right, and not sold on its own.
    const shot = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Café extra",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      ordering: "not_sold_separately",
    });
    const optionList = await createOptionList(
      tx,
      {
        name: "Leche",
        customerName: null,
        kitchenName: null,
        defaultLabelId: null,
        active: true,
        labels: [
          { name: "Entera", customerName: null, kitchenName: null, available: true },
          { name: "Avena", customerName: null, kitchenName: null, available: true },
        ],
      },
      "es",
    );
    // The default names a label of the same list, so the import has to remap BOTH and keep them
    // pointing at each other.
    const withDefault = await updateOptionList(
      tx,
      optionList.id,
      {
        name: "Leche",
        customerName: null,
        kitchenName: null,
        defaultLabelId: optionList.labels[1]!.id,
        active: true,
        labels: optionList.labels.map((label) => ({
          id: label.id,
          name: label.name,
          customerName: null,
          kitchenName: null,
          available: true,
        })),
      },
      "es",
    );
    const extraList = await createExtraList(
      tx,
      {
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: shot.id, maxQuantity: 3, preselected: true, price: "0.90" }],
      },
      "es",
    );
    // Ordered: extras first, then options. The order is the product's own and the transfer has to
    // bring it across.
    await writeProductModifiers(tx, product.id, [
      { kind: "extras", id: extraList.id },
      { kind: "options", id: withDefault.id },
    ]);
    await addProductToMenu(tx, {
      menuId: menu.id,
      productId: product.id,
      grossPrice: "2.75",
    });

    // A menu that sets no price of its own: blank has to arrive blank, not as zero.
    const tea = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Té",
      pricingUnit: "each",
      unitPrice: "1.80",
      vatClass: "reduced",
    });
    await addProductToMenu(tx, {
      menuId: menu.id,
      productId: tea.id,
      grossPrice: null,
    });
    return { optionList: withDefault, extraList, shotId: shot.id };
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-12T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.option_lists).toHaveLength(1);
  expect(transferred.tables.option_labels).toHaveLength(2);
  expect(transferred.tables.extra_lists).toHaveLength(1);
  expect(transferred.tables.extra_list_items).toHaveLength(1);
  expect(transferred.tables.product_modifiers).toHaveLength(2);
  await applyVenue(planVenue(venue("B44332211"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const optionLists = await listOptionLists(tx);
    expect(optionLists).toHaveLength(1);
    const imported = optionLists[0]!;
    // Every id is minted fresh on import, and the default still names a label of its OWN list.
    expect(imported.id).not.toBe(original.optionList.id);
    expect(imported.labels.map((label) => label.id)).not.toContain(
      original.optionList.labels[1]!.id,
    );
    expect(imported.defaultLabelId).toBe(
      imported.labels.find((label) => label.name === "Avena")!.id,
    );

    const extraLists = await listExtraLists(tx);
    expect(extraLists).toHaveLength(1);
    expect(extraLists[0]!.id).not.toBe(original.extraList.id);
    expect(extraLists[0]!.items).toHaveLength(1);
    expect(extraLists[0]!.items[0]).toMatchObject({
      maxQuantity: 3,
      preselected: true,
      price: "0.90",
    });
    expect(extraLists[0]!.items[0]!.productId).not.toBe(original.shotId);
    const shot = await tx.execute<{ ordering: string }>(
      sql`select ordering from products where name = 'Café extra'`,
    );
    expect(shot.rows).toEqual([{ ordering: "not_sold_separately" }]);

    const menus = await tx.execute<{ id: string }>(
      sql`select id from catalogues where name = 'Modifier menu'`,
    );
    const offers = await listMenuOffers(tx, [menus.rows[0]!.id]);
    const coffee = offers.find((offer) => offer.name === "Café")!;
    expect(coffee.grossPrice).toBe("2.75");
    expect(offers.find((offer) => offer.name === "Té")).toMatchObject({
      grossPrice: null,
      unitPrice: "1.80",
    });
    // The product's own attachment ORDER, and the offer's republished price on the extra.
    expect(coffee.offeredModifiers.map((entry) => [entry.kind, entry.name])).toEqual([
      ["extras", "Extras"],
      ["options", "Leche"],
    ]);
    const extras = coffee.offeredModifiers[0]!;
    if (extras.kind !== "extras") throw new Error("expected the extras list first");
    expect(extras.items.map((item) => item.price)).toEqual(["0.90"]);
  });
});

it("transfers sections and their members, remapping ids, with a section's image", async () => {
  const photo = await samplePreparedImage({ width: 8 });
  const source = await applyVenue(planVenue(venue("B55667788"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { es: "Bebidas" } }, {});
    const menu = await createCatalogue(tx, { name: "Sections menu" });
    const water = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
    const drinksMenu = await createCatalogue(tx, {
      name: "Bebidas (interno)",
      names: { es: "Bebidas" },
      image: image.filename,
      color: "#aabbcc",
    });
    const drinks = await readSection(
      tx,
      (await readMenuStructure(tx, drinksMenu.id)).rootSectionId,
    );
    await createSectionIn(tx, drinks.id, { internalName: "Cervezas" });
    await addMember(tx, drinks.id, { kind: "product", productId: water.id }, 0);
    const { rootSectionId } = await readMenuStructure(tx, menu.id);
    await addMember(tx, rootSectionId, { kind: "section", sectionId: drinks.id });
    return { drinks: drinks.id, image: image.filename };
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-25T12:00:00Z"),
    versions,
  );
  // Three menu shells and Drinks' own Beer section.
  expect(transferred.tables.sections).toHaveLength(7);
  expect(transferred.tables.menu_details).toHaveLength(3);
  expect(transferred.tables.section_members).toHaveLength(3);
  await applyVenue(planVenue(venue("B88776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const [importedDrinks] = await tx
      .select({ id: catalogues.id })
      .from(catalogues)
      .where(eq(catalogues.name, "Bebidas (interno)"));
    const drinks = await readSection(
      tx,
      (await readMenuStructure(tx, importedDrinks!.id)).rootSectionId,
    );
    const [beer] = await tx.select().from(sections).where(eq(sections.internalName, "Cervezas"));
    expect(drinks.id).not.toBe(original.drinks);
    expect(drinks).toMatchObject({
      names: { es: "Bebidas" },
      image: original.image,
      color: "#aabbcc",
    });
    expect(beer!.ownerMenuId).toBe(importedDrinks!.id);
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, "Agua"));
    expect(drinks!.members.map((member) => member.ref)).toEqual([
      { kind: "product", productId: product!.id },
      { kind: "section", sectionId: beer!.id },
    ]);
    const [menu] = await tx
      .select({ id: catalogues.id })
      .from(catalogues)
      .where(eq(catalogues.name, "Sections menu"));
    const [root] = await tx
      .select({ id: sections.id })
      .from(sections)
      .where(and(eq(sections.ownerMenuId, menu!.id), eq(sections.role, "menu_root")));
    expect((await readMenuStructure(tx, menu!.id)).rootSectionId).toBe(root!.id);
    expect((await readSection(tx, root!.id)).members.map((member) => member.ref)).toEqual([
      { kind: "section", sectionId: drinks!.id },
    ]);
  });
});

it("an include's folder photo travels with the configuration", async () => {
  const photo = await samplePreparedImage({ width: 8 });
  const source = await applyVenue(planVenue(venue("B55667711"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const fixed = await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(
      tx,
      { image: photo, names: { es: "Foto de la barra" } },
      {},
    );
    const lunch = await createCatalogue(tx, { name: "Folder lunch" });
    const drinks = await createCatalogue(tx, { name: "Drinks (staff)", names: { es: "Bebidas" } });
    const desserts = await createCatalogue(tx, { name: "Desserts (staff)" });
    const { rootSectionId } = await readMenuStructure(tx, lunch.id);
    const folder = await addMember(tx, rootSectionId, {
      kind: "section",
      sectionId: (await readMenuStructure(tx, drinks.id)).rootSectionId,
    });
    const direct = await addMember(tx, rootSectionId, {
      kind: "section",
      sectionId: (await readMenuStructure(tx, desserts.id)).rootSectionId,
    });
    const overrides = { image: image.filename, names: { en: "Bar", es: "" }, color: "#112233" };
    await tx
      .update(sectionMembers)
      .set({ folderOverrides: overrides })
      .where(eq(sectionMembers.id, folder.id));
    await tx
      .update(sectionMembers)
      .set({ showAsFolder: false, folderOverrides: { image: null } })
      .where(eq(sectionMembers.id, direct.id));
    return overrides;
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-07T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B11776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const included = await tx
      .select({
        staffName: catalogues.name,
        showAsFolder: sectionMembers.showAsFolder,
        overrides: sectionMembers.folderOverrides,
      })
      .from(sectionMembers)
      .innerJoin(sections, eq(sections.id, sectionMembers.childSectionId))
      .innerJoin(catalogues, eq(catalogues.id, sections.ownerMenuId))
      .where(eq(sections.role, "menu_root"))
      .orderBy(catalogues.name);
    expect(included).toEqual([
      { staffName: "Desserts (staff)", showAsFolder: false, overrides: { image: null } },
      { staffName: "Drinks (staff)", showAsFolder: true, overrides: fixed },
    ]);
  });
});

it("refuses a bundle whose photo still carries alt text and labels, as it refuses any column the venue lacks", async () => {
  const photo = await samplePreparedImage({ width: 8 });
  const source = await applyVenue(planVenue(venue("B44556677"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    uploadImage(tx, { image: photo, names: { es: "Pan" } }, {}),
  );
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-25T12:00:00Z"),
    versions,
  );
  const [row] = transferred.tables.media_images!;
  const stale = {
    ...transferred,
    tables: {
      ...transferred.tables,
      media_images: [
        { ...row, alt_text: JSON.stringify({ es: "Una hogaza" }), labels: JSON.stringify([]) },
      ],
    },
  };
  await expect(
    applyVenue(planVenue(venue("B77665544"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, stale, result, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "table:media_images" },
  });
  const invented = {
    ...transferred,
    tables: { ...transferred.tables, media_images: [{ ...row, caption: "Pan" }] },
  };
  await expect(
    applyVenue(planVenue(venue("B77665544"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, invented, result, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "table:media_images" },
  });
});

it.each([3, 2])(
  "leaves format-%s publication behind, so an imported venue's menus arrive unpublished",
  async (format) => {
    const photo = await samplePreparedImage({ width: 9 });
    const source = await applyVenue(planVenue(venue("B11223344"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const { image } = await uploadImage(tx, { image: photo, names: { es: "Limonada" } }, {});
      const menu = await createCatalogue(tx, { name: "Published menu" });
      const lemonade = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Limonada",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "reduced",
        image: image.filename,
      });
      const { rootSectionId } = await readMenuStructure(tx, menu.id);
      await addMember(tx, rootSectionId, { kind: "product", productId: lemonade.id });
      await publishMenu(tx, menu.id, (await previewMenu(tx, menu.id)).hash, "source-admin");
      if (format === 2) {
        const [row] = await tx.select().from(menuVersions).where(eq(menuVersions.menuId, menu.id));
        const document = {
          ...row!.document,
          format: 2,
          home: undefined,
        } as unknown as typeof row.document;
        const [old] = await tx
          .insert(menuVersions)
          .values({
            ...row!,
            id: crypto.randomUUID(),
            number: 2,
            document,
            contentHash: menuDocumentHash(document),
          })
          .returning({ id: menuVersions.id });
        await tx
          .update(menuPublications)
          .set({ versionId: old!.id })
          .where(eq(menuPublications.menuId, menu.id));
      }
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-09-26T12:00:00Z"),
      versions,
    );
    for (const table of [
      "menu_versions",
      "menu_publications",
      "menu_version_images",
      "menu_scheduled_publications",
    ])
      expect(Object.keys(transferred.tables)).not.toContain(table);
    await applyVenue(planVenue(venue("B44332211"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    await withTransaction(targetSuite.db, async (tx) => {
      const [menu] = await tx
        .select({ id: catalogues.id })
        .from(catalogues)
        .where(eq(catalogues.name, "Published menu"));
      expect((await menuStatus(tx, [menu!.id])).get(menu!.id)).toEqual({
        state: "unpublished",
        clashes: 0,
      });
      expect(await tx.select().from(menuVersions)).toEqual([]);
      // The working menu came across whole, so publishing it on the new venue has something to show.
      expect((await readMenuStructure(tx, menu!.id)).nodes).toHaveLength(1);
    });
  },
);

it("transfers the adjustment reasons, inactive ones included, with their limits and order", async () => {
  const source = await applyVenue(planVenue(venue("B55667788"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const prepared = await withTransaction(suite.db, async (tx) => {
    const policy = {
      names: { en: "Complaint", es: "Queja" },
      actions: ["comp", "discount_percent"] as ("comp" | "discount_percent")[],
      maxPercentBp: 5000,
      maxAmount: decimal("30.00"),
      applyRole: "supervisor" as const,
      approverRole: "manager" as const,
      noteRequired: true,
    };
    await createAdjustmentReason(tx, { ...policy, name: "Complaint" });
    const retired = await createAdjustmentReason(tx, { ...policy, name: "Retired" });
    await deactivateAdjustmentReason(tx, retired.id);
    return listAdjustmentReasons(tx, { includeInactive: true });
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-26T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.adjustment_reasons).toHaveLength(3);
  await applyVenue(planVenue(venue("B88776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, (tx) =>
    listAdjustmentReasons(tx, { includeInactive: true }),
  );
  // The import gives each row a new id, so ids are left out of the comparison.
  const withoutId = (reasons: typeof imported) =>
    reasons.map((reason) => ({ ...reason, id: undefined }));
  expect(withoutId(imported)).toEqual(withoutId(prepared));
});

it("transfers the venue's limit on a bill's total discount", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: 4000 }));
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-30T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  expect(await withTransaction(targetSuite.db, readAdjustmentSettings)).toEqual({
    maxBillDiscountBp: 4000,
  });
});

it("transfers the receipt's logo with its image and pictures, and the imported receipt prints it", async () => {
  const photo = await samplePreparedImage({ width: 10 });
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const logo = await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { es: "Logo" } }, {});
    return image.filename;
  });
  const receipt = { logo, logoRasters: await drawLogoRasters(photo.bytes) };
  await withTransaction(suite.db, (tx) => tx.insert(tenantReceipts).values({ receipt }));
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-30T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const printed = async (db: typeof suite.db) =>
    withTransaction(db, async (tx) => ({
      receipt: await getReceipt(tx),
      narrow: (await getPrintedReceipt(tx, "58mm")).logo,
      wide: (await getPrintedReceipt(tx, "80mm")).logo,
      image: (await readImageBytes(tx, logo)) !== null,
    }));
  const imported = await printed(targetSuite.db);
  expect(imported).toEqual(await printed(suite.db));
  expect(imported.receipt).toEqual({ logo });
  // 10 × 6 fitted inside 160 dots high on either paper.
  expect([imported.narrow?.widthDots, imported.wide?.widthDots, imported.image]).toEqual([
    267,
    267,
    true,
  ]);
});

it("transfers a station's rest of the order switch", async () => {
  const source = await applyVenue(planVenue(venue("B13572469"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values({
      locationId: source.locationId,
      name: "Pase",
      showsRestOfOrder: true,
    }),
  );
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-01T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toContainEqual(
    expect.objectContaining({ name: "Pase", shows_rest_of_order: 1 }),
  );
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ showsRestOfOrder: kitchenStations.showsRestOfOrder })
    .from(kitchenStations)
    .where(eq(kitchenStations.name, "Pase"));
  expect(imported).toEqual([{ showsRestOfOrder: true }]);
});

it("transfers a watcher with its station, zone, and printer in configuration export", async () => {
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId: source.locationId, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [zone] = await tx
      .insert(floorZones)
      .values({ locationId: source.locationId, name: "Terrace" })
      .returning({ id: floorZones.id });
    const [printer] = await tx
      .insert(printers)
      .values({
        locationId: source.locationId,
        name: "Pass printer",
        transport: "network_tcp",
        host: "10.0.0.8",
      })
      .returning({ id: printers.id });
    const [watcher] = await tx
      .insert(watchers)
      .values({
        locationId: source.locationId,
        name: "Pass",
        everyStation: false,
        everyZone: false,
        runsPass: true,
      })
      .returning({ id: watchers.id });
    await tx.insert(watcherStations).values({ watcherId: watcher!.id, stationId: station!.id });
    await tx.insert(watcherZones).values({ watcherId: watcher!.id, zoneId: zone!.id });
    await tx.insert(watcherPrinters).values({ watcherId: watcher!.id, printerId: printer!.id });
  });
  const declared = CORE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
  expect(declared).toEqual(
    expect.arrayContaining(["watchers", "watcher_stations", "watcher_zones", "watcher_printers"]),
  );
  expect(declared).not.toContain("watcher_item_marks");
  expect(declared).not.toContain("devices");
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-01T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B97531866"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => {
    const [watcher] = await tx.select().from(watchers).where(eq(watchers.name, "Pass"));
    const [station] = await tx
      .select()
      .from(watcherStations)
      .where(eq(watcherStations.watcherId, watcher!.id));
    const [zone] = await tx
      .select()
      .from(watcherZones)
      .where(eq(watcherZones.watcherId, watcher!.id));
    const [printer] = await tx
      .select()
      .from(watcherPrinters)
      .where(eq(watcherPrinters.watcherId, watcher!.id));
    return { watcher, station, zone, printer };
  });
  expect(imported.watcher).toMatchObject({
    name: "Pass",
    everyStation: false,
    everyZone: false,
    runsPass: true,
  });
  expect(imported.station?.stationId).toBe(
    (
      await targetSuite.db
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.name, "Grill"))
    )[0]?.id,
  );
  expect(imported.zone?.zoneId).toBe(
    (
      await targetSuite.db
        .select({ id: floorZones.id })
        .from(floorZones)
        .where(eq(floorZones.name, "Terrace"))
    )[0]?.id,
  );
  expect(imported.printer?.printerId).toBe(
    (
      await targetSuite.db
        .select({ id: printers.id })
        .from(printers)
        .where(eq(printers.name, "Pass printer"))
    )[0]?.id,
  );
});

it("transfers a device profile's receipt and payment-slip printer lists, in order", async () => {
  const source = await applyVenue(planVenue(venue("B13572471"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const added = await tx
      .insert(printers)
      .values(
        ["Bar printer", "Back printer", "Slip printer"].map((name, index) => ({
          locationId: source.locationId,
          name,
          transport: "network_tcp" as const,
          host: `10.0.1.${index + 1}`,
        })),
      )
      .returning({ id: printers.id });
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: "Counter till", formFactor: "tablet-landscape" })
      .returning({ id: deviceProfiles.id });
    await setProfilePrinterLists(tx, profile!.id, {
      ...emptyPrinterLists(),
      receiptPrinterIds: [added[1]!.id, added[0]!.id],
      paymentSlipPrinterIds: [added[2]!.id],
    });
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-04T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B97531867"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => {
    const [profile] = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.name, "Counter till"));
    const names = new Map(
      (await tx.select({ id: printers.id, name: printers.name }).from(printers)).map((row) => [
        row.id,
        row.name,
      ]),
    );
    const lists = await readProfilePrinterLists(tx, profile!.id);
    return {
      receipt: lists.receiptPrinterIds.map((id) => names.get(id)),
      paymentSlip: lists.paymentSlipPrinterIds.map((id) => names.get(id)),
    };
  });
  expect(imported).toEqual({
    receipt: ["Back printer", "Bar printer"],
    paymentSlip: ["Slip printer"],
  });
});

it("leaves a table's clearing state behind", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(diningTables).values({
      id: "eeeeeeee-bbbb-bbbb-bbbb-eeeeeeeeeeee",
      locationId: source.locationId,
      label: "T9",
    });
    await tx.execute(sql`
      update dining_tables set needs_clearing_since = '2026-09-29T10:00:00.000Z'
      where id = 'eeeeeeee-bbbb-bbbb-bbbb-eeeeeeeeeeee'`);
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);

  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-29T12:00:00Z"),
    versions,
  );

  const rows = transferred.tables.dining_tables!;
  expect(rows.map((row) => row.label)).toContain("T9");
  for (const row of rows) {
    expect(row).not.toHaveProperty("needs_clearing_since");
  }
});

it("leaves out a print agent's node, so the importing venue does not show it as on this box", async () => {
  const configFor = (venue: {
    nodeId: string;
    seriesIds: string[];
    locationId: string;
  }): TillConfig => ({
    nodeId: nodeId(venue.nodeId),
    seriesId: seriesId(venue.seriesIds[0]!),
    locationId: locationId(venue.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    selfEnrolNodeAgent(tx, configFor(source), { nodeId: source.nodeId, name: "Source box" }),
  );
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.print_agents).toHaveLength(1);
  expect(transferred.tables.print_agents![0]).not.toHaveProperty("node_id");
  const target = await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, result) => {
      await importConfigurationTables(
        tx,
        transferred,
        { locationId: result.locationId },
        ALL_MODULES,
        versions,
      );
    },
  });

  const imported = await targetSuite.db
    .select({ name: printAgents.name, nodeId: printAgents.nodeId, active: printAgents.active })
    .from(printAgents);
  expect(imported).toEqual([{ name: "Source box", nodeId: null, active: false }]);

  // The box's own agent still enrols as a new row beside the imported one; had the imported row held
  // this node, self-enrolment would find it inactive and refuse it as revoked.
  await withTransaction(targetSuite.db, (tx) =>
    selfEnrolNodeAgent(tx, configFor(target), { nodeId: target.nodeId, name: "Target box" }),
  );
  const enrolled = await targetSuite.db
    .select({ name: printAgents.name, nodeId: printAgents.nodeId, active: printAgents.active })
    .from(printAgents)
    .where(eq(printAgents.nodeId, target.nodeId));
  expect(enrolled).toEqual([{ name: "Target box", nodeId: target.nodeId, active: true }]);

  const carryingNode: ConfigurationBundle = {
    ...transferred,
    tables: {
      ...transferred.tables,
      print_agents: [{ ...transferred.tables.print_agents![0], node_id: source.nodeId }],
    },
  };
  expect(() => validateConfigurationBundle(carryingNode, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "print_agents.node_id" },
    }),
  );
});

it("leaves out a print agent's setup page address and port, so the import links to no old machine", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(printAgents).values({
      locationId: source.locationId,
      name: "Bar agent",
      tokenHash: "source-agent-token",
      setupUrl: "http://192.168.10.40:9310",
      setupPort: 9210,
    });
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.print_agents).toHaveLength(1);
  expect(transferred.tables.print_agents![0]).not.toHaveProperty("setup_url");
  expect(transferred.tables.print_agents![0]).not.toHaveProperty("setup_port");
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, result) => {
      await importConfigurationTables(
        tx,
        transferred,
        { locationId: result.locationId },
        ALL_MODULES,
        versions,
      );
    },
  });

  const imported = await targetSuite.db
    .select({
      name: printAgents.name,
      setupUrl: printAgents.setupUrl,
      setupPort: printAgents.setupPort,
    })
    .from(printAgents);
  expect(imported).toEqual([{ name: "Bar agent", setupUrl: null, setupPort: null }]);

  // The last two cases list the columns empty, as an export made before this change did: an omitted
  // column is refused even when it holds null, and one made before W72c names node_id first.
  for (const [carried, field] of [
    [{ setup_url: "http://192.168.10.40:9310" }, "print_agents.setup_url"],
    [{ setup_port: 9210 }, "print_agents.setup_port"],
    [{ setup_url: null, setup_port: null }, "print_agents.setup_url"],
    [{ node_id: source.nodeId, setup_url: null, setup_port: null }, "print_agents.node_id"],
  ] as const) {
    const carrying: ConfigurationBundle = {
      ...transferred,
      tables: {
        ...transferred.tables,
        print_agents: [{ ...transferred.tables.print_agents![0], ...carried }],
      },
    };
    expect(() => validateConfigurationBundle(carrying, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining({ code: "setup.request_invalid", params: { field } }),
    );
  }
});

it("round-trips missing home slots alongside live tiles with fresh ids and unchanged positions", async () => {
  const source = await applyVenue(planVenue(venue("B55667788"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Missing slots" });
    const root = (await readMenuStructure(tx, menu.id)).rootSectionId;
    const beer = await createSectionIn(tx, root, { internalName: "Beer" });
    const water = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Water",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
    await addMember(tx, root, { kind: "product", productId: water.id });
    const home = await readMenuHome(tx, menu.id);
    const tile = await addShortcut(tx, menu.id, { kind: "section", sectionId: beer.id });
    await addShortcut(tx, menu.id, { kind: "product", productId: water.id });
    await deleteSection(tx, beer.id);
    return { menu: menu.id, tile: tile.id, home: home.homeSectionId };
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-25T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B88776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const [menu] = await tx.select().from(catalogues).where(eq(catalogues.name, "Missing slots"));
    const home = await readMenuHome(tx, menu!.id);
    expect(menu!.id).not.toBe(original.menu);
    expect(home.homeSectionId).not.toBe(original.home);
    expect(home.shortcuts[0]!.memberId).not.toBe(original.tile);
    expect(
      home.shortcuts.map((tile) => [tile.position, tile.ref.kind, tile.name, tile.missingName]),
    ).toEqual([
      [0, "missing", "Missing slots › Beer", "Missing slots › Beer"],
      [1, "product", "Water", null],
    ]);
    const preview = await previewMenu(tx, menu!.id);
    expect(preview.document.home.shortcuts[0]).toEqual({ kind: "empty" });
    expect(preview.warnings).toEqual([{ kind: "shortcut_missing", name: "Missing slots › Beer" }]);
  });
});

it("gives each imported product the folded key of its own name, whatever the bundle held", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const idShaped = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Keys" });
    const fields = { catalogueId: menu.id, categoryId: null, pricingUnit: "each" as const };
    await createProduct(tx, {
      ...fields,
      name: " Café Solo ",
      unitPrice: "1.20",
      vatClass: "general",
    });
    const name = menu.id.toUpperCase();
    await createProduct(tx, { ...fields, name, unitPrice: "2.00", vatClass: "general" });
    return name;
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B75318642"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ name: products.name, nameKey: products.nameKey, catalogueId: products.catalogueId })
    .from(products)
    .innerJoin(catalogues, eq(catalogues.id, products.catalogueId))
    .where(eq(catalogues.name, "Keys"));
  expect(imported.map(({ name, nameKey }) => ({ name, nameKey }))).toEqual(
    expect.arrayContaining([
      { name: " Café Solo ", nameKey: "café solo" },
      { name: idShaped, nameKey: idShaped.toLowerCase() },
    ]),
  );
  expect(imported).toHaveLength(2);
  const catalogueId = imported[0]!.catalogueId;
  for (const name of ["café solo", idShaped]) {
    await expect(
      withTransaction(targetSuite.db, (tx) =>
        createProduct(tx, {
          catalogueId,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ),
    ).rejects.toMatchObject({ code: "product.name_taken" });
  }

  // The key is derived from the name, so a bundle neither carries one nor may supply one.
  for (const row of transferred.tables.products!) expect(row).not.toHaveProperty("name_key");
  await expect(
    withTransaction(targetSuite.db, (tx) =>
      importConfigurationTables(
        tx,
        {
          ...transferred,
          tables: {
            ...transferred.tables,
            products: transferred.tables.products!.map((row) => ({ ...row, name_key: "wrong" })),
          },
        },
        { locationId: "unused" },
        ALL_MODULES,
        versions,
      ),
    ),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "products.name_key" },
  });
});

it("keeps a name that equals another row's id, while the ids that point at rows are rewritten", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Ids" });
    const category = await createCategory(tx, { name: menu.id });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: category.id,
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await setProductVariants(
      tx,
      product.id,
      [
        {
          name: product.id,
          customerName: { es: "Grande" },
          kitchenName: null,
          image: null,
          unitPrice: "2.50",
          available: true,
          active: true,
        },
      ],
      "es",
    );
    return { menu: menu.id, category: category.id, product: product.id };
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  const bundleIds = new Set(
    Object.values(transferred.tables).flatMap((rows) =>
      rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : [])),
    ),
  );
  for (const id of Object.values(sourceIds)) expect(bundleIds.has(id)).toBe(true);

  await applyVenue(planVenue(venue("B86420975"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });

  const [menu] = await targetSuite.db
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(eq(catalogues.name, "Ids"));
  const [category] = await targetSuite.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, sourceIds.menu));
  const [product] = await targetSuite.db
    .select({ id: products.id, catalogueId: products.catalogueId, categoryId: products.categoryId })
    .from(products)
    .where(eq(products.name, sourceIds.category));
  const [variant] = await targetSuite.db
    .select({ parentId: products.parentId })
    .from(products)
    .where(eq(products.name, sourceIds.product));
  expect(menu).toBeDefined();
  expect(category).toBeDefined();
  expect(product).toEqual({
    id: expect.any(String),
    catalogueId: menu!.id,
    categoryId: category!.id,
  });
  expect(variant).toEqual({ parentId: product!.id });
  for (const id of [menu!.id, category!.id, product!.id]) expect(bundleIds.has(id)).toBe(false);

  const policies = await targetSuite.db.execute<{
    zone_id: string;
  }>(sql`select zone_id from zone_service_policies`);
  expect(policies.rows.length).toBeGreaterThan(0);
  const targetMenus = new Set(
    (await targetSuite.db.select({ id: catalogues.id }).from(catalogues)).map((row) => row.id),
  );
  for (const policy of policies.rows) {
    expect(bundleIds.has(policy.zone_id)).toBe(false);
  }
  const defaults = await targetSuite.db.execute<{
    menu_id: string;
  }>(sql`select menu_id from department_all_day_menus`);
  expect(defaults.rows.length).toBeGreaterThan(0);
  for (const row of defaults.rows) {
    expect(bundleIds.has(row.menu_id)).toBe(false);
    expect(targetMenus.has(row.menu_id)).toBe(true);
  }
});

it("refuses a bundle holding duplicate names whole, at staging and at import", async () => {
  const source = await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Duplicates" });
    const category = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const clean = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  const category = clean.tables.categories!.find((row) => row.name === "Bebidas")!;
  const product = clean.tables.products!.find((row) => row.name === "Agua")!;
  const withCategory: ConfigurationBundle = {
    ...clean,
    tables: {
      ...clean.tables,
      categories: [...clean.tables.categories!, { ...category, id: "copy", name: " bebidas" }],
    },
  };
  const withProduct: ConfigurationBundle = {
    ...clean,
    tables: {
      ...clean.tables,
      products: [...clean.tables.products!, { ...product, id: "copy", name: "AGUA " }],
    },
  };

  expect(() => validateConfigurationBundle(withCategory, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "category.name_taken",
      params: { field: "name", name: "bebidas" },
    }),
  );
  expect(() => validateConfigurationBundle(withProduct, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "product.name_taken",
      params: { field: "name", name: "AGUA" },
    }),
  );

  const target = venue("B64208642");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, withProduct, result, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({ code: "product.name_taken" });
  const persisted = await targetSuite.db.execute<{ count: number }>(sql`
    select count(*) as count from tenants where tax_id = ${target.taxId}
  `);
  expect(persisted.rows[0]!.count).toBe(0);
});

it("counts an exported product with no Active flag as Active, as the column stores it", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Flagless" });
    await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const clean = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  const exported = clean.tables.products!.find((row) => row.name === "Agua")!;
  expect(exported.active).toBe(1);
  const flagless = { ...exported };
  delete flagless.active;
  const withProduct: ConfigurationBundle = {
    ...clean,
    tables: {
      ...clean.tables,
      products: [
        ...clean.tables.products!.filter((row) => row !== exported),
        flagless,
        { ...flagless, id: "copy", name: "AGUA " },
      ],
    },
  };
  const withTextFlag: ConfigurationBundle = {
    ...clean,
    tables: {
      ...clean.tables,
      products: [
        ...clean.tables.products!.filter((row) => row !== exported),
        { ...exported, active: "1" },
      ],
    },
  };

  expect(() => validateConfigurationBundle(withProduct, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "product.name_taken",
      params: { field: "name", name: "AGUA" },
    }),
  );
  expect(() => validateConfigurationBundle(withTextFlag, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "products.active" },
    }),
  );

  const target = venue("B75319864");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, withProduct, result, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({ code: "product.name_taken" });
  const persisted = await targetSuite.db.execute<{ count: number }>(sql`
    select count(*) as count from tenants where tax_id = ${target.taxId}
  `);
  expect(persisted.rows[0]!.count).toBe(0);
});

it("refuses a leave-behind name the table has no column for", async () => {
  for (const column of ["no_such_column", 'retired_at" or "1']) {
    const module = {
      name: "probe",
      configurationTransfer: {
        kind: "tables",
        tables: [{ name: "device_profiles", leaveBehindWhenSet: column }],
      },
    } as unknown as WaitronModule;
    await expect(exportConfigurationTables(suite.db, [module])).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: `device_profiles.${column}` },
    });
  }
});

it("leaves behind every row a chain of keys leads to a left-behind row, matching a key on all its columns, in any declared order", async () => {
  await suite.db.execute(sql`create table zz_parents (id text primary key, gone_at text)`);
  await suite.db.execute(sql`
    create table zz_children (
      id text primary key, code text, parent_id text references zz_parents(id),
      unique (code, parent_id)
    )
  `);
  await suite.db.execute(sql`
    create table zz_grandchildren (
      id text primary key, child_code text, child_parent_id text,
      foreign key (child_code, child_parent_id) references zz_children(code, parent_id)
    )
  `);
  try {
    await suite.db.execute(sql`
      insert into zz_parents values ('p-kept', null), ('p-gone', '2026-10-05T12:00:00.000Z')
    `);
    await suite.db.execute(sql`
      insert into zz_children values
        ('c-kept', 'A', 'p-kept'), ('c-gone', 'A', 'p-gone'), ('c-none', 'B', null)
    `);
    await suite.db.execute(sql`
      insert into zz_grandchildren values
        ('g-kept', 'A', 'p-kept'), ('g-gone', 'A', 'p-gone'), ('g-none', null, null)
    `);
    const module = {
      name: "probe",
      configurationTransfer: {
        kind: "tables",
        // Grandchildren first, so a single pass over the keys would not reach them.
        tables: [
          { name: "zz_grandchildren" },
          { name: "zz_children" },
          { name: "zz_parents", leaveBehindWhenSet: "gone_at" },
        ],
      },
    } as unknown as WaitronModule;
    const { tables } = await exportConfigurationTables(suite.db, [module]);
    const ids = (name: string) => tables[name]!.map((row) => row.id);
    expect(ids("zz_parents")).toEqual(["p-kept"]);
    expect(ids("zz_children")).toEqual(["c-kept", "c-none"]);
    expect(ids("zz_grandchildren")).toEqual(["g-kept", "g-none"]);
  } finally {
    for (const name of ["zz_grandchildren", "zz_children", "zz_parents"])
      await suite.db.execute(sql`drop table ${sql.identifier(name)}`);
  }
});

/** Hold `profileId` by a disabled device only, then delete it through the real path, which retires
 * the row rather than removing it. */
async function retireProfile(locationId: string, profileId: string): Promise<void> {
  await seedDevice(suite.db, { locationId, profileId });
  await suite.db
    .update(devices)
    .set({ active: false })
    .where(eq(devices.deviceProfileId, profileId));
  await withTransaction(suite.db, async (tx) => {
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const session = await startManagementSession(tx, { personId: admin!.id });
    await deleteDeviceProfile(tx, { managementSessionId: session.token, id: profileId });
  });
  const [row] = await suite.db
    .select({ retiredAt: deviceProfiles.retiredAt })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  expect(row?.retiredAt).not.toBeNull();
}

it("leaves behind a retired profile that no row uses, and the bundle still imports", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const [retired] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Old till", formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  await retireProfile(source.locationId, retired!.id);
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.device_profiles!.map((row) => row.name)).not.toContain("Old till");
  await applyVenue(planVenue(venue("B86420975"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const names = await targetSuite.db.select({ name: deviceProfiles.name }).from(deviceProfiles);
  expect(names.map((row) => row.name)).not.toContain("Old till");
});

it("leaves a retired profile's printer lists behind with it, while a live profile's rows travel", async () => {
  const source = await applyVenue(planVenue(venue("B13579246"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const [printer] = await tx
      .insert(printers)
      .values({
        locationId: source.locationId,
        name: "Bar printer",
        transport: "network_tcp",
        host: "10.0.2.1",
      })
      .returning({ id: printers.id });
    const [live, retired] = await tx
      .insert(deviceProfiles)
      .values([
        { name: "Handheld", formFactor: "phone-portrait" },
        { name: "Old till", formFactor: "till" },
      ])
      .returning({ id: deviceProfiles.id });
    for (const profile of [live!, retired!]) {
      await setProfilePrinterLists(tx, profile.id, {
        ...emptyPrinterLists(),
        receiptPrinterIds: [printer!.id],
        paymentSlipPrinterIds: [],
      });
    }
    return { live: live!.id, retired: retired!.id };
  });
  await retireProfile(source.locationId, original.retired);
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  const exportedProfiles = transferred.tables.device_profiles!.map((row) => row.id);
  expect(exportedProfiles).toContain(original.live);
  expect(exportedProfiles).not.toContain(original.retired);
  expect(transferred.tables.device_profile_printers!.map((row) => row.device_profile_id)).toEqual([
    original.live,
  ]);
  await applyVenue(planVenue(venue("B97531246"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const profiles = await tx
      .select({ id: deviceProfiles.id, name: deviceProfiles.name })
      .from(deviceProfiles);
    expect(profiles.map((row) => row.name)).not.toContain("Old till");
    const handheld = profiles.find((row) => row.name === "Handheld")!;
    const lists = await readProfilePrinterLists(tx, handheld.id);
    expect(lists.receiptPrinterIds).toHaveLength(1);
  });
});

it("transfers a profile's department, zones and station list, leaving a retired profile's behind", async () => {
  const source = await applyVenue(planVenue(venue("B24680135"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const cfg = { locationId: brandLocationId(source.locationId) };
  const original = await withTransaction(suite.db, async (tx) => {
    const restaurant = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    await createServiceZone(tx, cfg, { name: "Dining room", departmentId: restaurant.id });
    const terrace = await createServiceZone(tx, cfg, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const [grill] = await tx
      .insert(kitchenStations)
      .values({ locationId: source.locationId, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [live, retired] = await tx
      .insert(deviceProfiles)
      .values([
        { name: "Terrace handheld", formFactor: "phone-portrait" },
        { name: "Old till", formFactor: "till" },
      ])
      .returning({ id: deviceProfiles.id });
    for (const profile of [live!, retired!]) {
      await setProfileServiceAccess(tx, cfg, profile.id, {
        departmentId: restaurant.id,
        allowedZoneIds: [terrace.id],
        startingZoneId: terrace.id,
        stationIds: [grill!.id],
        watcherIds: [],
      });
    }
    // Provisioning gave the seeded ordering profiles a scope; clear it so the rows that travel are
    // this test's own.
    const seeded = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(sql`${deviceProfiles.id} not in (${live!.id}, ${retired!.id})`);
    for (const { id } of seeded) {
      await setProfileServiceAccess(tx, cfg, id, {
        departmentId: null,
        allowedZoneIds: null,
        startingZoneId: null,
        stationIds: [],
        watcherIds: [],
      });
    }
    return { live: live!.id, retired: retired!.id };
  });
  await retireProfile(source.locationId, original.retired);
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-06T12:00:00Z"),
    versions,
  );
  for (const table of [
    "device_profile_service_access",
    "device_profile_zones",
    "device_profile_stations",
  ]) {
    expect(
      transferred.tables[table]!.map((row) => row.device_profile_id),
      table,
    ).toEqual([original.live]);
  }
  await applyVenue(planVenue(venue("B13570246"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => {
    const [location] = await tx
      .select({ id: kitchenStations.locationId })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Grill"));
    const [profile] = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.name, "Terrace handheld"));
    const access = await readProfileServiceAccess(
      tx,
      { locationId: brandLocationId(location!.id) },
      profile!.id,
    );
    const zones = new Map(
      (await tx.select({ id: floorZones.id, name: floorZones.name }).from(floorZones)).map(
        (zone) => [zone.id, zone.name],
      ),
    );
    const stations = new Map(
      (
        await tx
          .select({ id: kitchenStations.id, name: kitchenStations.name })
          .from(kitchenStations)
      ).map((station) => [station.id, station.name]),
    );
    return {
      department: (
        await tx
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, access.departmentId ?? ""))
      )[0]?.name,
      allowed: (access.allowedZoneIds ?? []).map((id) => zones.get(id)),
      starting: zones.get(access.startingZoneId ?? ""),
      stations: access.stationIds.map((id) => stations.get(id)),
    };
  });
  expect(imported).toEqual({
    department: "Restaurant",
    allowed: ["Terrace"],
    starting: "Terrace",
    stations: ["Grill"],
  });
});

/** Creates `tables` in order, fills them, checks the fixture breaks no foreign key, exports them
 * declared in reverse order with the first as the leave-behind table, and drops them again. */
async function exportScratch(
  tables: Array<{ name: string; create: string; rows: string }>,
  leaveBehindWhenSet: string,
): Promise<Record<string, unknown[]>> {
  try {
    for (const table of tables) await suite.db.execute(sql.raw(table.create));
    for (const table of tables)
      await suite.db.execute(
        sql`insert into ${sql.identifier(table.name)} values ${sql.raw(table.rows)}`,
      );
    const violations = await suite.db.execute(sql`pragma foreign_key_check`);
    expect(violations.rows).toEqual([]);
    const declared = tables.map((table, index) =>
      index === 0 ? { name: table.name, leaveBehindWhenSet } : { name: table.name },
    );
    const module = {
      name: "probe",
      configurationTransfer: { kind: "tables", tables: declared.reverse() },
    } as unknown as WaitronModule;
    const { tables: exported } = await exportConfigurationTables(suite.db, [module]);
    return Object.fromEntries(
      Object.entries(exported).map(([name, rows]) => [name, rows.map((row) => row.id)]),
    );
  } finally {
    for (const table of [...tables].reverse())
      await suite.db.execute(sql`drop table if exists ${sql.identifier(table.name)}`);
  }
}

it("transfers a profile's admitted roles and person exceptions, leaving a retired profile's and the exporting operator's behind", async () => {
  const source = await applyVenue(planVenue(venue("B35792468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const [mia] = await tx
      .insert(persons)
      .values({ displayName: "Mia", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const [live, retired] = await tx
      .insert(deviceProfiles)
      .values([
        { name: "Bar till", formFactor: "till" },
        { name: "Old till", formFactor: "till" },
      ])
      .returning({ id: deviceProfiles.id });
    for (const profile of [live!, retired!]) {
      await tx
        .insert(deviceProfileAdmissionRoles)
        .values({ deviceProfileId: profile.id, role: "manager" });
      await tx.insert(deviceProfileAdmissionPersons).values([
        { deviceProfileId: profile.id, personId: mia!.id, admitted: true },
        { deviceProfileId: profile.id, personId: admin!.id, admitted: false },
      ]);
    }
    return { admin: admin!.id, mia: mia!.id, live: live!.id, retired: retired!.id };
  });
  await retireProfile(source.locationId, original.retired);
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    { ...source, sourceOperatorId: original.admin },
    ALL_MODULES,
    new Date("2026-10-06T12:00:00Z"),
    versions,
  );
  expect(
    transferred.tables.device_profile_admission_roles!.map((row) => row.device_profile_id),
  ).toEqual([original.live]);
  expect(
    transferred.tables
      .device_profile_admission_persons!.map((row) => `${row.device_profile_id} ${row.person_id}`)
      .sort(),
  ).toEqual([`${original.live} ${original.admin}`, `${original.live} ${original.mia}`].sort());
  await applyVenue(planVenue(venue("B46813579"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => ({
    roles: await tx
      .select({ profile: deviceProfiles.name, role: deviceProfileAdmissionRoles.role })
      .from(deviceProfileAdmissionRoles)
      .innerJoin(
        deviceProfiles,
        eq(deviceProfiles.id, deviceProfileAdmissionRoles.deviceProfileId),
      ),
    exceptions: await tx
      .select({
        profile: deviceProfiles.name,
        person: persons.displayName,
        admitted: deviceProfileAdmissionPersons.admitted,
      })
      .from(deviceProfileAdmissionPersons)
      .innerJoin(
        deviceProfiles,
        eq(deviceProfiles.id, deviceProfileAdmissionPersons.deviceProfileId),
      )
      .innerJoin(persons, eq(persons.id, deviceProfileAdmissionPersons.personId)),
  }));
  expect(imported).toEqual({
    roles: [{ profile: "Bar till", role: "manager" }],
    exceptions: [{ profile: "Bar till", person: "Mia", admitted: true }],
  });
});

it("follows a key that names no parent columns to the parent's primary key, composite ones included", async () => {
  const ids = await exportScratch(
    [
      {
        name: "zz_parents",
        create:
          "create table zz_parents (id text, part text, gone_at text, primary key (part, id))",
        rows: "('p-kept', 'A', null), ('p-gone', 'A', '2026-10-05T12:00:00.000Z')",
      },
      {
        name: "zz_children",
        create: `create table zz_children (
          id text primary key, parent_part text, parent_id text,
          foreign key (parent_part, parent_id) references zz_parents
        )`,
        rows: "('c-kept', 'A', 'p-kept'), ('c-gone', 'A', 'p-gone')",
      },
      {
        name: "zz_grandchildren",
        create:
          "create table zz_grandchildren (id text primary key, child_id text references zz_children)",
        rows: "('g-kept', 'c-kept'), ('g-gone', 'c-gone')",
      },
    ],
    "gone_at",
  );
  expect(ids).toEqual({
    zz_grandchildren: ["g-kept"],
    zz_children: ["c-kept"],
    zz_parents: ["p-kept"],
  });
});

it("matches a key as the engine does, with the parent column's affinity and collation", async () => {
  const ids = await exportScratch(
    [
      {
        name: "zz_parents",
        create: `create table zz_parents (
          id text primary key, num integer unique, name text collate nocase unique,
          code text unique, gone_at text
        )`,
        rows: `('p-kept', 2, 'Kept', '1', null),
          ('p-gone', 1, 'Gone', '01', '2026-10-05T12:00:00.000Z')`,
      },
      {
        name: "zz_children",
        create: `create table zz_children (
          id text primary key,
          num_ref text references zz_parents(num),
          name_ref text references zz_parents(name),
          code_ref integer references zz_parents(code)
        )`,
        // '1' is the integer 1 under the parent's affinity, 'gone' is 'Gone' under its collation,
        // and the integer 1 is the text '1' under the parent's affinity, so not '01'.
        rows: `('c-num', '1', null, null), ('c-name', null, 'gone', null),
          ('c-code', null, null, 1)`,
      },
    ],
    "gone_at",
  );
  expect(ids).toEqual({ zz_children: ["c-code"], zz_parents: ["p-kept"] });
});

it("follows a key whose parent table is spelled in another case", async () => {
  const ids = await exportScratch(
    [
      {
        name: "zz_parents",
        create: "create table zz_parents (id text primary key, gone_at text)",
        rows: "('p-kept', null), ('p-gone', '2026-10-05T12:00:00.000Z')",
      },
      {
        name: "zz_children",
        create:
          "create table zz_children (id text primary key, parent_id text references ZZ_Parents(id))",
        rows: "('c-kept', 'p-kept'), ('c-gone', 'p-gone')",
      },
    ],
    "gone_at",
  );
  expect(ids).toEqual({ zz_children: ["c-kept"], zz_parents: ["p-kept"] });
});

it("leaves behind by a generated column", async () => {
  const ids = await exportScratch(
    [
      {
        name: "zz_parents",
        create: `create table zz_parents (
          id text primary key, gone_at text, gone text generated always as (substr(gone_at, 1, 10))
        )`,
        rows: "('p-kept', null), ('p-gone', '2026-10-05T12:00:00.000Z')",
      },
    ],
    "gone",
  );
  expect(ids).toEqual({ zz_parents: ["p-kept"] });
});

it("never takes a key with a null in it as naming a left-behind row", async () => {
  const ids = await exportScratch(
    [
      {
        name: "zz_parents",
        create: `create table zz_parents (
          id text primary key, alt text unique, a text, b text, gone_at text, unique (a, b)
        )`,
        rows: "('p-gone', null, 'A', null, '2026-10-05T12:00:00.000Z')",
      },
      {
        name: "zz_children",
        create: `create table zz_children (
          id text primary key, alt_ref text references zz_parents(alt), a text, b text,
          foreign key (a, b) references zz_parents(a, b)
        )`,
        rows: "('c-alt', null, null, null), ('c-pair', null, 'A', null)",
      },
    ],
    "gone_at",
  );
  expect(ids).toEqual({ zz_children: ["c-alt", "c-pair"], zz_parents: [] });
});

it("pairs only the tables a left-behind row's keys reach, so an unrelated table need not have rowids", async () => {
  const ids = await exportScratch(
    [
      {
        name: "zz_parents",
        create: "create table zz_parents (id text primary key, gone_at text)",
        rows: "('p-kept', null), ('p-gone', '2026-10-05T12:00:00.000Z')",
      },
      {
        name: "zz_children",
        create:
          "create table zz_children (id text primary key, parent_id text references zz_parents(id))",
        rows: "('c-kept', 'p-kept'), ('c-gone', 'p-gone')",
      },
      {
        name: "zz_others",
        create: "create table zz_others (id text primary key) without rowid",
        rows: "('o-1')",
      },
      {
        name: "zz_other_children",
        create:
          "create table zz_other_children (id text primary key, other_id text references zz_others(id))",
        rows: "('oc-1', 'o-1')",
      },
    ],
    "gone_at",
  );
  expect(ids).toEqual({
    zz_other_children: ["oc-1"],
    zz_others: ["o-1"],
    zz_children: ["c-kept"],
    zz_parents: ["p-kept"],
  });
});

it("refuses a leave-behind export it cannot pair by rowid, or whose key it cannot resolve", async () => {
  const cases = [
    {
      create: [
        "create table zz_parents (id text primary key, gone_at text) without rowid",
        "create table zz_children (id text primary key, parent_id text references zz_parents(id))",
      ],
      field: "table:zz_parents",
    },
    {
      create: [
        "create table ZZ_Parents (id text primary key, gone_at text) without rowid",
        "create table zz_children (id text primary key, parent_id text references zz_parents(id))",
      ],
      field: "table:zz_parents",
    },
    {
      create: [
        "create table zz_parents (id text primary key, gone_at text, __export_rowid integer)",
        "create table zz_children (id text primary key, parent_id text references zz_parents(id))",
      ],
      field: "zz_parents.__export_rowid",
    },
    {
      create: [
        "create table zz_parents (id text primary key, gone_at text)",
        "create table zz_children (id text primary key, rowid text, parent_id text references zz_parents(id))",
      ],
      field: "zz_children.rowid",
    },
    {
      create: [
        "create table zz_parents (id text primary key, gone_at text)",
        "create table zz_children (id text primary key, RowId text, parent_id text references zz_parents(id))",
      ],
      field: "zz_children.RowId",
    },
    {
      create: [
        "create table zz_parents (id text primary key, gone_at text)",
        "create table zz_children (id text primary key, parent_id text references zz_parents(id), rowid text generated always as (parent_id) virtual)",
      ],
      field: "zz_children.rowid",
    },
    {
      create: [
        "create table zz_parents (id text unique, gone_at text)",
        "create table zz_children (id text primary key, parent_id text references zz_parents)",
      ],
      field: "table:zz_children",
    },
  ];
  for (const { create, field } of cases) {
    try {
      for (const statement of create) await suite.db.execute(sql.raw(statement));
      const module = {
        name: "probe",
        configurationTransfer: {
          kind: "tables",
          tables: [{ name: "zz_children" }, { name: "zz_parents", leaveBehindWhenSet: "gone_at" }],
        },
      } as unknown as WaitronModule;
      await expect(exportConfigurationTables(suite.db, [module])).rejects.toMatchObject({
        code: "setup.request_invalid",
        params: { field },
      });
    } finally {
      for (const name of ["zz_children", "zz_parents"])
        await suite.db.execute(sql`drop table if exists ${sql.identifier(name)}`);
    }
  }
});

it("transfers effective kitchen defaults and nullable overrides without retired column values", async () => {
  const source = await applyVenue(planVenue(venue("B13572471"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const stationId = await withTransaction(suite.db, async (tx) => {
    await tx
      .update(kitchenTimingDefaults)
      .set({ warmAfterMinutes: 4, overdueAfterMinutes: 9, forgottenAfterMinutes: 14 });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId: source.locationId, name: "Timing export" })
      .returning({ id: kitchenStations.id });
    await tx.insert(kitchenStationTiming).values({
      stationId: station!.id,
      warmAfterMinutes: 6,
      overdueAfterMinutes: null,
      forgottenAfterMinutes: 16,
    });
    return station!.id;
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_timing_defaults).toEqual([
    {
      location_id: source.locationId,
      warm_after_minutes: 4,
      overdue_after_minutes: 9,
      forgotten_after_minutes: 14,
    },
  ]);
  expect(transferred.tables.kitchen_station_timing).toEqual([
    {
      station_id: stationId,
      warm_after_minutes: 6,
      overdue_after_minutes: null,
      forgotten_after_minutes: 16,
    },
  ]);
  const exportedStation = transferred.tables.kitchen_stations!.find((row) => row.id === stationId)!;
  for (const field of ["warm_after_minutes", "overdue_after_minutes", "forgotten_after_minutes"])
    expect(exportedStation).not.toHaveProperty(field);
  const target = await applyVenue(planVenue(venue("B97531866"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  expect(await targetSuite.db.select().from(kitchenTimingDefaults)).toEqual([
    {
      locationId: target.locationId,
      warmAfterMinutes: 4,
      overdueAfterMinutes: 9,
      forgottenAfterMinutes: 14,
    },
  ]);
  const [importedStation] = await targetSuite.db
    .select()
    .from(kitchenStations)
    .where(eq(kitchenStations.name, "Timing export"));
  expect(await targetSuite.db.select().from(kitchenStationTiming)).toEqual([
    {
      stationId: importedStation!.id,
      warmAfterMinutes: 6,
      overdueAfterMinutes: null,
      forgottenAfterMinutes: 16,
    },
  ]);
});

it.each([
  [0, "warmAfterMinutes"],
  [12, "overdueAfterMinutes"],
] as const)("refuses imported station timing warm=%i atomically", async (warm, field) => {
  const source = await applyVenue(planVenue(venue("B13572472"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId: source.locationId, name: "Invalid imported timing" })
      .returning({ id: kitchenStations.id });
    await tx.insert(kitchenStationTiming).values({ stationId: station!.id, warmAfterMinutes: 3 });
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  transferred.tables.kitchen_station_timing![0]!.warm_after_minutes = warm;
  const target = venue("B97531867");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "station.thresholds_invalid",
    params: { name: "Invalid imported timing", field },
  });
  expect(
    (
      await targetSuite.db.execute<{ count: number }>(
        sql`select count(*) as count from tenants where tax_id = ${target.taxId}`,
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(await targetSuite.db.select().from(kitchenTimingDefaults)).toEqual([]);
  expect(await targetSuite.db.select().from(kitchenStationTiming)).toEqual([]);
});

describe("venue detail edits and configuration boundaries", () => {
  it("exports corrected details while a fresh import keeps its separately created target address and clock", async () => {
    const source = await applyVenue(planVenue(venue("B77112233"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const initial = await withTransaction(suite.db, (tx) => readVenueDetails(tx, source));
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, source, {
        expected: initial.details,
        changes: {
          name: "Corrected source",
          city: "Alcalá de Henares",
          timeZone: "UTC",
          dayCutover: "04:30",
        },
      }),
    );
    expect(saved.changed).toBe(true);
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const exported = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-06T12:00:00Z"),
      versions,
    );
    expect(exported.venue.location).toMatchObject({
      ...saved.model.details,
      dayCutover: "04:30:00",
    });
    const targetRequest = venue("B33221177");
    Object.assign(targetRequest.location, {
      name: "Created target",
      addressLine1: "Calle target 2",
      addressLine2: "Upper floor",
      postalCode: "28014",
      city: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "07:00",
    });
    const target = await applyVenue(planVenue(targetRequest, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, created) =>
        importConfigurationTables(tx, exported, created, ALL_MODULES, versions),
    });
    const model = await withTransaction(targetSuite.db, (tx) => readVenueDetails(tx, target));
    expect(model.details).toEqual({
      name: "Created target",
      addressLine1: "Calle target 2",
      addressLine2: "Upper floor",
      postalCode: "28014",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "07:00",
    });
    expect(model.issuer).toEqual({ country: "ES", legalName: "Prepared SL", taxId: "B33221177" });
  });
  it.each([false, true])(
    "applying prepared receipt settings keeps all target details with history=%s",
    async (history) => {
      const target = await applyVenue(planVenue(venue("B22334455"), ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
      });
      if (history)
        await suite.db.insert(sales).values({
          source: "demo_seed",
          seriesId: target.seriesIds[0]!,
          nodeId: target.nodeId,
          invoiceNumber: 1,
          issuedAt: "2026-10-06T12:00:00.000Z",
          issuedOffsetMinutes: 120,
          total: 0,
          vatBreakdown: [],
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "none",
          fiscalState: "not_applicable",
        });
      const initial = await withTransaction(suite.db, (tx) => readVenueDetails(tx, target));
      const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
      const exported = await buildConfigurationBundle(
        suite.db,
        target,
        ALL_MODULES,
        new Date("2026-10-06T12:00:00Z"),
        versions,
      );
      const foreignDetails = {
        ...exported.venue.location,
        name: "Foreign source name",
        addressLine1: "Foreign street",
        addressLine2: "Foreign line two",
        postalCode: "08001",
        city: "Barcelona",
        province: "Barcelona",
        timeZone: "UTC",
        dayCutover: "01:30:00",
      };
      const beforeSales = suite.db.all(sql`select * from sales`);
      const beforeSeries = suite.db.all(sql`select * from invoice_series`);
      await withTransaction(suite.db, (tx) => applyPreparedLocation(tx, target, foreignDetails));
      const after = await withTransaction(suite.db, (tx) => readVenueDetails(tx, target));
      expect(after.details).toEqual(initial.details);
      expect(after.issuer).toEqual(initial.issuer);
      expect(after.hasSales).toBe(history);
      expect(suite.db.all(sql`select * from sales`)).toEqual(beforeSales);
      expect(suite.db.all(sql`select * from invoice_series`)).toEqual(beforeSeries);
    },
  );
});

it("transfers department receipt choices and explicit or inherited zone choices in format 2", async () => {
  const source = await applyVenue(planVenue(venue("B13572476"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const scope = { locationId: brandLocationId(source.locationId) };
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, scope, {
      name: "Receipt department",
      defaultServiceMode: "table_tab",
    });
    await tx
      .update(departmentSalePolicies)
      .set({ receiptPrintMode: "on_request" })
      .where(eq(departmentSalePolicies.departmentId, department.id));
    const explicit = await createServiceZone(tx, scope, {
      name: "Explicit receipts",
      departmentId: department.id,
    });
    const inherited = await createServiceZone(tx, scope, {
      name: "Inherited receipts",
      departmentId: department.id,
    });
    await tx
      .update(zoneSalePolicies)
      .set({ receiptPrintMode: "never" })
      .where(eq(zoneSalePolicies.zoneId, explicit.id));
    await tx
      .update(zoneSalePolicies)
      .set({ receiptPrintMode: null })
      .where(eq(zoneSalePolicies.zoneId, inherited.id));
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const exported = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-06T10:00:00Z"),
    versions,
  );
  expect(exported.version).toBe(2);
  expect(exported.venue.location).not.toHaveProperty("receiptPrintMode");
  expect(exported.venue.location).not.toHaveProperty("drawerOpenPolicy");
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(exported, "a strong passphrase"),
    "a strong passphrase",
  );
  const target = await applyVenue(planVenue(venue("B13572477"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, result) =>
      importConfigurationTables(
        tx,
        decoded,
        { locationId: result.locationId },
        ALL_MODULES,
        versions,
      ),
  });
  expect(target.locationId).not.toBe(source.locationId);
  const modes = await targetSuite.db.execute(sql`
    select z.name, p.receipt_print_mode as department_mode, q.receipt_print_mode as zone_mode
    from floor_zones z join zone_service_policies s on s.zone_id=z.id
    join departments d on d.id=s.department_id
    join department_sale_policies p on p.department_id=d.id
    join zone_sale_policies q on q.zone_id=z.id
    where d.name='Receipt department' order by z.name`);
  expect(modes.rows).toEqual([
    { name: "Explicit receipts", department_mode: "on_request", zone_mode: "never" },
    { name: "Inherited receipts", department_mode: "on_request", zone_mode: null },
  ]);
});

it("transfers a department's menu list, its all-day menu and a zone's own all-day menu, under the new ids", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const scope = { locationId: brandLocationId(source.locationId) };
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, scope, {
      name: "Restaurante de cartas",
      defaultServiceMode: "table_tab",
    });
    const barra = await createServiceZone(tx, scope, {
      name: "Barra de cartas",
      departmentId: department.id,
    });
    const bebidas = await createCatalogue(tx, { name: "Bebidas transferidas" });
    const desayunos = await createCatalogue(tx, { name: "Desayunos transferidos" });
    await setDepartmentMenus(tx, scope, department.id, [bebidas.id, desayunos.id]);
    await setDepartmentAllDayMenu(tx, scope, department.id, bebidas.id);
    await setZoneAllDayMenu(tx, scope, barra.id, desayunos.id);
    return [department.id, barra.id, bebidas.id, desayunos.id];
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(
      await buildConfigurationBundle(
        suite.db,
        source,
        ALL_MODULES,
        new Date("2026-10-07T10:00:00Z"),
        versions,
      ),
      "a strong passphrase",
    ),
    "a strong passphrase",
  );
  await applyVenue(planVenue(venue("B24681358"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, result) =>
      importConfigurationTables(
        tx,
        decoded,
        { locationId: result.locationId },
        ALL_MODULES,
        versions,
      ),
  });
  const zone = await targetSuite.db.execute<{
    zone_id: string;
    department_id: string;
    menu_id: string;
    zone: string;
    department: string;
    menu: string;
  }>(sql`
    select o.zone_id, o.department_id, o.menu_id, z.name as zone, d.name as department,
      c.name as menu
    from zone_all_day_menus o
    join floor_zones z on z.id = o.zone_id
    join departments d on d.id = o.department_id
    join catalogues c on c.id = o.menu_id
    where z.name = 'Barra de cartas'`);
  expect(zone.rows).toEqual([
    {
      zone_id: expect.any(String),
      department_id: expect.any(String),
      menu_id: expect.any(String),
      zone: "Barra de cartas",
      department: "Restaurante de cartas",
      menu: "Desayunos transferidos",
    },
  ]);
  const department = await targetSuite.db.execute<{ menu: string; all_day: string }>(sql`
    select c.name as menu, a.name as all_day
    from department_menus m
    join departments d on d.id = m.department_id
    join catalogues c on c.id = m.menu_id
    join department_all_day_menus x on x.department_id = d.id
    join catalogues a on a.id = x.menu_id
    where d.name = 'Restaurante de cartas'
    order by m.display_order`);
  expect(department.rows).toEqual([
    { menu: "Bebidas transferidas", all_day: "Bebidas transferidas" },
    { menu: "Desayunos transferidos", all_day: "Bebidas transferidas" },
  ]);
  const row = zone.rows[0]!;
  for (const id of [row.zone_id, row.department_id, row.menu_id])
    expect(sourceIds).not.toContain(id);
});

it("exports and imports all seven cell classes into another venue, remapping every id and the location", async () => {
  const source = await applyVenue(planVenue(venue("B24681359"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const scope = { locationId: brandLocationId(source.locationId) };
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, scope, {
      name: "Comedor de rutas",
      defaultServiceMode: "table_tab",
    });
    const terraza = await createServiceZone(tx, scope, {
      name: "Terraza de rutas",
      departmentId: department.id,
    });
    const salon = await createServiceZone(tx, scope, {
      name: "Salón de rutas",
      departmentId: department.id,
    });
    const [barra, plancha] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: scope.locationId, name: "Barra de rutas" },
        { locationId: scope.locationId, name: "Plancha de rutas" },
      ])
      .returning();
    const category = await createCategory(tx, { name: "Bebidas de rutas" });
    const menu = await createCatalogue(tx, { name: "Carta de rutas" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: "Mojito de rutas",
      pricingUnit: "each",
      unitPrice: "7",
      vatClass: "general",
    });
    const atStation = (id: string) => ({ kind: "station" as const, stationId: id });
    const categoryRow = { kind: "category" as const, categoryId: category.id };
    const productRow = { kind: "product" as const, productId: product.id };
    await setRoutingCell(tx, scope, { row: categoryRow, zoneId: null }, atStation(barra!.id));
    await setRoutingCell(
      tx,
      scope,
      { row: categoryRow, zoneId: terraza.id },
      {
        kind: "no_preparation",
      },
    );
    await setRoutingCell(tx, scope, { row: productRow, zoneId: null }, atStation(plancha!.id));
    await setRoutingCell(tx, scope, { row: productRow, zoneId: salon.id }, atStation(barra!.id));
    await setRoutingCell(
      tx,
      scope,
      { row: { kind: "all" }, zoneId: terraza.id },
      atStation(plancha!.id),
    );
    const noCategoryRow = { kind: "no_category" as const };
    await setRoutingCell(
      tx,
      scope,
      { row: noCategoryRow, zoneId: null },
      { kind: "no_preparation" },
    );
    await setRoutingCell(
      tx,
      scope,
      { row: noCategoryRow, zoneId: terraza.id },
      atStation(barra!.id),
    );
    // A disabled station keeps its cells.
    await tx
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, plancha!.id));
    return [
      source.locationId,
      department.id,
      terraza.id,
      salon.id,
      barra!.id,
      plancha!.id,
      category.id,
      product.id,
    ];
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(
      await buildConfigurationBundle(
        suite.db,
        source,
        ALL_MODULES,
        new Date("2026-10-07T10:00:00Z"),
        versions,
      ),
      "a strong passphrase",
    ),
    "a strong passphrase",
  );
  expect(decoded.tables.routing_cells).toHaveLength(7);
  const target = await applyVenue(planVenue(venue("B24681360"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, result) =>
      importConfigurationTables(
        tx,
        decoded,
        { locationId: result.locationId },
        ALL_MODULES,
        versions,
      ),
  });
  const idOf = async (table: string, name: string) => {
    const result = await targetSuite.db.execute<{ id: string }>(
      sql`select id from ${sql.identifier(table)} where name = ${name}`,
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  };
  const terraza = await idOf("floor_zones", "Terraza de rutas");
  const salon = await idOf("floor_zones", "Salón de rutas");
  const barra = await idOf("kitchen_stations", "Barra de rutas");
  const plancha = await idOf("kitchen_stations", "Plancha de rutas");
  const category = await idOf("categories", "Bebidas de rutas");
  const product = await idOf("products", "Mojito de rutas");
  for (const id of [terraza, salon, barra, plancha, category, product])
    expect(sourceIds).not.toContain(id);
  expect(sourceIds).not.toContain(target.locationId);
  const cells = await targetSuite.db.execute<Record<string, unknown>>(sql`
    select location_id, category_id, product_id, zone_id, station_id, no_preparation, no_category
    from routing_cells`);
  const cell = (values: Record<string, unknown>) => ({
    location_id: target.locationId,
    category_id: null,
    product_id: null,
    zone_id: null,
    station_id: null,
    no_preparation: 0,
    no_category: 0,
    ...values,
  });
  expect(cells.rows).toEqual(
    expect.arrayContaining([
      cell({ category_id: category, station_id: barra }),
      cell({ category_id: category, zone_id: terraza, no_preparation: 1 }),
      cell({ product_id: product, station_id: plancha }),
      cell({ product_id: product, zone_id: salon, station_id: barra }),
      cell({ zone_id: terraza, station_id: plancha }),
      cell({ no_category: 1, no_preparation: 1 }),
      cell({ no_category: 1, zone_id: terraza, station_id: barra }),
    ]),
  );
  expect(cells.rows).toHaveLength(7);
});

describe("opening hours in a configuration transfer", () => {
  /** Tuesday 6 October 2026, 12:00 in Madrid. */
  const AT = new Date("2026-10-06T10:00:00Z");
  const p = (opensAt: string, closesAt: string) => ({ id: randomUUID(), opensAt, closesAt });
  const CLOSED = { mode: "closed" as const, periods: [] as [] };
  const ALL_DAY = { mode: "all_day" as const, periods: [] as [] };
  const week = (cell: (weekday: number) => WeekCell): WeekDay[] =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: cell(weekday) }));

  interface Named {
    cfg: { locationId: ReturnType<typeof locationId> };
    departments: Map<string, string>;
    stations: Map<string, string>;
  }

  async function named(db: typeof suite.db, located: { locationId: string }): Promise<Named> {
    const departmentRows = await db.execute<{ id: string; name: string }>(sql`
      select id, name from departments where location_id = ${located.locationId}`);
    const stationRows = await db.execute<{ id: string; name: string }>(sql`
      select id, name from kitchen_stations where location_id = ${located.locationId}`);
    return {
      cfg: { locationId: locationId(located.locationId) },
      departments: new Map(departmentRows.rows.map((row) => [row.name, row.id])),
      stations: new Map(stationRows.rows.map((row) => [row.name, row.id])),
    };
  }

  /** A venue's hours with every id replaced by its subject's name or dropped, to compare venues. */
  async function hoursByName(db: typeof suite.db, located: { locationId: string }) {
    const venue = await named(db, located);
    const nameOf = new Map([
      ...[...venue.departments].map(([name, id]) => [id, `department:${name}`] as const),
      ...[...venue.stations].map(([name, id]) => [id, `station:${name}`] as const),
    ]);
    const withoutIds = (cell: {
      mode: string;
      periods: { opensAt: string; closesAt: string }[];
    }) => ({
      mode: cell.mode,
      periods: cell.periods.map(({ opensAt, closesAt }) => ({ opensAt, closesAt })),
    });
    return withTransaction(db, async (tx) => {
      const weeks: Record<string, unknown> = {};
      for (const [name, id] of venue.departments)
        weeks[`department:${name}`] = (
          await readWeekHours(tx, venue.cfg, { kind: "department", id })
        ).map((day) => ({ weekday: day.weekday, cell: withoutIds(day.cell) }));
      for (const [name, id] of venue.stations)
        weeks[`station:${name}`] = (
          await readWeekHours(tx, venue.cfg, { kind: "station", id })
        ).map((day) => ({ weekday: day.weekday, cell: withoutIds(day.cell) }));
      const dateRows = await tx.execute<{ id: string }>(sql`
        select id from special_dates where location_id = ${located.locationId} order by date`);
      const dates = [];
      for (const { id } of dateRows.rows) {
        const date = await readSpecialDate(tx, venue.cfg, id);
        dates.push({
          date: date.date,
          name: date.name,
          colour: date.colour,
          closeWholeVenue: date.closeWholeVenue,
          cells: date.cells
            .map((entry) => ({
              subject: nameOf.get(entry.subject.id),
              cell: withoutIds(entry.cell),
            }))
            .sort((a, b) => String(a.subject).localeCompare(String(b.subject))),
        });
      }
      return { weeks, dates };
    });
  }

  /** A prepared venue with a second department, a bar and hours of every kind. */
  async function preparedWithHours(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(departments).values({
        locationId: source.locationId,
        name: "Deli",
        tradingName: "Deli",
        defaultServiceMode: "prepay",
      });
      await tx.insert(kitchenStations).values({ locationId: source.locationId, name: "Bar" });
    });
    const { cfg, departments: dept, stations } = await named(suite.db, source);
    const restaurant = { kind: "department" as const, id: dept.get("Prepared")! };
    const deli = { kind: "department" as const, id: dept.get("Deli")! };
    const bar = { kind: "station" as const, id: stations.get("Bar")! };
    await withTransaction(suite.db, async (tx) => {
      // Closed on Monday; lunch and a dinner running past midnight on the other days.
      await replaceWeekHours(
        tx,
        cfg,
        restaurant,
        week((weekday) =>
          weekday === 1
            ? CLOSED
            : { mode: "periods", periods: [p("12:00", "16:00"), p("20:00", "01:00")] },
        ),
        AT,
      );
      // Closed on Sunday, open all day on Monday, 09:00–18:00 otherwise. The bar has no hours set.
      await replaceWeekHours(
        tx,
        cfg,
        deli,
        week((weekday) =>
          weekday === 0
            ? CLOSED
            : weekday === 1
              ? ALL_DAY
              : { mode: "periods", periods: [p("09:00", "18:00")] },
        ),
        AT,
      );
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2026-12-24",
          name: "Christmas Eve",
          colour: "amber",
          closeWholeVenue: false,
          cells: [
            { subject: restaurant, cell: { mode: "periods", periods: [p("12:00", "18:00")] } },
            { subject: bar, cell: CLOSED },
          ],
        },
        AT,
      );
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2026-12-25",
          name: "Christmas",
          colour: "red",
          closeWholeVenue: true,
          cells: [{ subject: deli, cell: ALL_DAY }],
        },
        AT,
      );
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2027-01-01",
          name: "New Year",
          colour: "blue",
          closeWholeVenue: false,
          cells: [{ subject: bar, cell: ALL_DAY }],
        },
        AT,
      );
      await setStationToday(tx, cfg, bar.id, "closed", AT);
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    return { source, versions, transferred };
  }

  it("carries the standard weeks and special dates of every kind, with fresh ids that still link up", async () => {
    const { source, versions, transferred } = await preparedWithHours("B44001122");
    expect(transferred.tables).not.toHaveProperty("station_day_states");
    expect(transferred.tables.hours_week_periods).toContainEqual(
      expect.objectContaining({ opens_at: "20:00:00", closes_at: "01:00:00", position: 1 }),
    );

    const target = await applyVenue(planVenue(venue("B44001133"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });

    const expected = await hoursByName(suite.db, source);
    expect(expected.weeks["station:Bar"]).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: { mode: "not_set", periods: [] } })),
    );
    expect(expected.dates.map((date) => date.date)).toEqual([
      "2026-12-24",
      "2026-12-25",
      "2027-01-01",
    ]);
    expect(await hoursByName(targetSuite.db, target)).toEqual(expected);

    const sourceIds = new Set(
      [
        ...transferred.tables.hours_week_cells!,
        ...transferred.tables.hours_week_periods!,
        ...transferred.tables.special_dates!,
        ...transferred.tables.special_date_hours!,
        ...transferred.tables.special_date_hours_periods!,
      ].map((row) => row.id),
    );
    const imported = await targetSuite.db.execute<{ id: string; times: string | null }>(sql`
      select id, null as times from hours_week_cells
      union all select id, opens_at || '-' || closes_at from hours_week_periods
      union all select id, null from special_dates
      union all select id, null from special_date_hours
      union all select id, opens_at || '-' || closes_at from special_date_hours_periods`);
    expect(imported.rows).toHaveLength(sourceIds.size);
    for (const row of imported.rows) {
      expect(sourceIds.has(row.id)).toBe(false);
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    expect(imported.rows.flatMap((row) => (row.times === null ? [] : [row.times])).sort()).toEqual([
      ...Array<string>(5).fill("09:00:00-18:00:00"),
      ...Array<string>(6).fill("12:00:00-16:00:00"),
      "12:00:00-18:00:00",
      ...Array<string>(6).fill("20:00:00-01:00:00"),
    ]);
    const dayStates = await targetSuite.db.execute<{ n: number }>(sql`
      select cast(count(*) as int) as n from station_day_states`);
    expect(dayStates.rows[0]!.n).toBe(0);
  });

  it("carries a default station's retained hours, which leave it open", async () => {
    const source = await applyVenue(planVenue(venue("B44002211"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, (tx) =>
      tx.insert(kitchenStations).values({ locationId: source.locationId, name: "Pase" }),
    );
    const { cfg, stations } = await named(suite.db, source);
    const pase = { kind: "station" as const, id: stations.get("Pase")! };
    // Pase is Closed every day and on New Year's Eve, then becomes the default, which keeps both.
    await withTransaction(suite.db, async (tx) => {
      await replaceWeekHours(
        tx,
        cfg,
        pase,
        week(() => CLOSED),
        AT,
      );
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2026-12-31",
          name: "New Year's Eve",
          colour: "purple",
          closeWholeVenue: false,
          cells: [{ subject: pase, cell: CLOSED }],
        },
        AT,
      );
      await setDefaultStation(
        tx,
        {
          nodeId: nodeId(source.nodeId),
          seriesId: seriesId(source.seriesIds[0]!),
          locationId: cfg.locationId,
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          tipsEnabled: false,
          simplifiedInvoiceLimit: null,
        },
        pase.id,
      );
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    expect(transferred.tables.hours_week_cells).toHaveLength(7);
    expect(transferred.tables.special_date_hours).toEqual([
      expect.objectContaining({ station_id: pase.id, mode: "closed" }),
    ]);

    const target = await applyVenue(planVenue(venue("B44002222"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    const imported = await named(targetSuite.db, target);
    const importedPase = { kind: "station" as const, id: imported.stations.get("Pase")! };
    const read = await withTransaction(targetSuite.db, async (tx) => ({
      week: await readWeekHours(tx, imported.cfg, importedPase),
      eve: await resolveOpeningDateHours(tx, imported.cfg, importedPase, "2026-12-31"),
      tuesday: await resolveOpeningDateHours(tx, imported.cfg, importedPase, "2026-10-06"),
      // 23:00 in Madrid on New Year's Eve, and noon on an ordinary Tuesday.
      states: [
        await stationStates(tx, imported.cfg, new Date("2026-12-31T22:00:00Z")),
        await stationStates(tx, imported.cfg, AT),
      ],
    }));
    expect(read.week.map((day) => day.cell)).toEqual(Array(7).fill(CLOSED));
    for (const resolved of [read.eve, read.tuesday])
      expect(resolved).toMatchObject({
        source: "default_station",
        cell: { mode: "always_open", periods: [] },
      });
    for (const states of read.states)
      expect(states.get(importedPase.id)).toMatchObject({ isDefault: true, open: true });
  });

  it("carries a past special date that a later week edit made clash, as the saves allowed", async () => {
    const source = await applyVenue(planVenue(venue("B44005511"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const { cfg, departments: dept } = await named(suite.db, source);
    const restaurant = { kind: "department" as const, id: dept.get("Prepared")! };
    await withTransaction(suite.db, async (tx) => {
      await replaceWeekHours(
        tx,
        cfg,
        restaurant,
        week(() => CLOSED),
        AT,
      );
      // Friday 25 September is past at AT; its night runs into Saturday's small hours.
      await saveSpecialDate(
        tx,
        cfg,
        null,
        {
          date: "2026-09-25",
          name: "Late night",
          colour: "purple",
          closeWholeVenue: false,
          cells: [
            { subject: restaurant, cell: { mode: "periods", periods: [p("22:00", "03:00")] } },
          ],
        },
        AT,
      );
      // Saturdays from 01:00 overlap that past night, which the save lets through.
      await replaceWeekHours(
        tx,
        cfg,
        restaurant,
        week((weekday) =>
          weekday === 6 ? { mode: "periods", periods: [p("01:00", "05:00")] } : CLOSED,
        ),
        AT,
      );
    });
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    // Saturday 26 September ends at 22:00 UTC in Madrid, the bundle's zone, and not in UTC.
    expect(transferred.venue.location.timeZone).toBe("Europe/Madrid");
    expect(() =>
      validateConfigurationBundle(
        { ...transferred, createdAt: "2026-09-26T21:59:59.999Z" },
        ALL_MODULES,
        versions,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "special_date_hours" },
      }),
    );
    expect(() =>
      validateConfigurationBundle(
        { ...transferred, createdAt: "2026-09-26T22:00:00.000Z" },
        ALL_MODULES,
        versions,
      ),
    ).not.toThrow();

    expect(() => validateConfigurationBundle(transferred, ALL_MODULES, versions)).not.toThrow();
    const target = await applyVenue(planVenue(venue("B44005522"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });
    const expected = await hoursByName(suite.db, source);
    expect(expected.dates.map((date) => date.date)).toEqual(["2026-09-25"]);
    expect(await hoursByName(targetSuite.db, target)).toEqual(expected);
  });

  it("refuses an edited bundle whose hours a save would refuse, and writes no venue", async () => {
    const { versions, transferred } = await preparedWithHours("B44003311");
    const lunch = transferred.tables.hours_week_periods!.find(
      (row) => row.opens_at === "12:00:00" && row.closes_at === "16:00:00",
    )!;
    // A second period inside the lunch of the same day.
    const edited: ConfigurationBundle = {
      ...transferred,
      tables: {
        ...transferred.tables,
        hours_week_periods: [
          ...transferred.tables.hours_week_periods!,
          { ...lunch, id: randomUUID(), position: 2, opens_at: "13:00:00", closes_at: "14:00:00" },
        ],
      },
    };
    const refusal = { code: "setup.request_invalid", params: { field: "hours_week_cells" } };
    expect(() => validateConfigurationBundle(edited, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B44003322");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, result) =>
          importConfigurationTables(tx, edited, result, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ tenants: number; cells: number }>(sql`
      select
        (select cast(count(*) as int) from tenants where tax_id = ${target.taxId}) as tenants,
        (select cast(count(*) as int) from hours_week_cells) as cells`);
    expect(persisted.rows[0]).toEqual({ tenants: 0, cells: 0 });
  });

  it("refuses a bundle exported before the hours tables existed, as an older venue-service schema", async () => {
    const { versions, transferred } = await preparedWithHours("B44004411");
    const journal = JSON.parse(
      await readFile(
        new URL("../../../packages/venue-service/drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.map((entry) => entry.tag)).toContain("0021_hours_calendar");
    expect(versions["venue-service"]).toBe(journal.entries.length);
    const older: ConfigurationBundle = {
      ...transferred,
      modules: { ...transferred.modules, "venue-service": versions["venue-service"]! - 1 },
    };
    expect(() => validateConfigurationBundle(older, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "module:venue-service" },
      }),
    );
  });
});

describe("public holidays in a configuration transfer", () => {
  const AT = new Date("2026-10-06T10:00:00Z");
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const scope = (located: { locationId: string }) => ({
    locationId: locationId(located.locationId),
  });

  async function moveTo(
    db: typeof suite.db,
    located: { locationId: string },
    province: string,
    city: string,
  ) {
    await withTransaction(db, (tx) =>
      tx.update(locations).set({ province, city }).where(eq(locations.id, located.locationId)),
    );
  }

  /** Geographies and entries with ids replaced by the city they belong to, to compare venues. */
  async function holidaysByCity(db: typeof suite.db) {
    const geographies = await db.execute<Record<string, string | null>>(sql`
      select country, province_code, city, city_key, area_key
      from holiday_geographies order by city_key`);
    const ids = await db.execute<{ id: string; city: string }>(sql`
      select id, city from holiday_geographies`);
    const city = new Map(ids.rows.map((row) => [row.id, row.city]));
    const entries = await db.execute<{ geography_id: string; date: string; name: string }>(sql`
      select geography_id, date, name from local_holidays order by date, name`);
    return {
      geographies: geographies.rows,
      entries: entries.rows.map((row) => ({
        city: city.get(row.geography_id),
        date: row.date,
        name: row.name,
      })),
    };
  }

  /**
   * A Madrid venue with local holidays in two years, one of them on Epiphany, and a special date on
   * Epiphany; it then moved to Vielha, chose Arán and entered a day there, and moved back, spelling
   * Madrid differently. So it exports a matching geography and a retained one with an area.
   */
  async function preparedWithHolidays(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const cfg = scope(source);
    await withTransaction(suite.db, async (tx) => {
      await saveLocalHoliday(tx, cfg, null, { date: "2026-01-06", name: "Reyes en el barrio" });
      await saveLocalHoliday(tx, cfg, null, { date: "2026-05-15", name: "San Isidro" });
      await saveLocalHoliday(tx, cfg, null, { date: "2027-05-15", name: "San Isidro" });
      await saveSpecialDate(
        tx,
        cfg,
        null,
        { date: "2026-01-06", name: "Reyes", colour: "red", closeWholeVenue: true, cells: [] },
        AT,
      );
    });
    await moveTo(suite.db, source, "Lleida", "Vielha e Mijaran");
    await withTransaction(suite.db, async (tx) => {
      await saveHolidayArea(tx, cfg, { areaKey: "aran" });
      await saveLocalHoliday(tx, cfg, null, { date: "2026-07-20", name: "Santa Margarida" });
    });
    await moveTo(suite.db, source, "Madrid", "  MADRID ");
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    return { source, versions, transferred };
  }

  it("carries matching and retained geographies with their areas and entries, under fresh ids", async () => {
    const { source, versions, transferred } = await preparedWithHolidays("B45001122");
    expect(transferred.tables.holiday_geographies).toHaveLength(2);
    expect(transferred.tables.local_holidays).toHaveLength(4);
    for (const row of transferred.tables.holiday_geographies!)
      expect(Object.keys(row).sort()).toEqual([
        "area_key",
        "city",
        "city_key",
        "country",
        "id",
        "location_id",
        "province_code",
      ]);
    // Shipped facts, their hashes and their data version are the receiving build's, never the bundle's.
    const text = JSON.stringify(transferred);
    expect(text).not.toContain("shipped:");
    expect(text).not.toContain("f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0");
    expect(text).not.toContain("ES-2026.1");

    const target = await applyVenue(planVenue(venue("B45001133"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx, result) =>
        importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
    });

    const expected = await holidaysByCity(suite.db);
    expect(expected.geographies).toEqual([
      {
        country: "ES",
        province_code: "28",
        city: "Madrid",
        city_key: "madrid",
        area_key: null,
      },
      {
        country: "ES",
        province_code: "25",
        city: "Vielha e Mijaran",
        city_key: "vielha e mijaran",
        area_key: "aran",
      },
    ]);
    expect(await holidaysByCity(targetSuite.db)).toEqual(expected);

    const sourceIds = new Set(
      [...transferred.tables.holiday_geographies!, ...transferred.tables.local_holidays!].map(
        (row) => row.id,
      ),
    );
    const imported = await targetSuite.db.execute<{ id: string; owner: string }>(sql`
      select id, location_id as owner from holiday_geographies
      union all select l.id, g.location_id from local_holidays l
        join holiday_geographies g on g.id = l.geography_id`);
    expect(imported.rows).toHaveLength(6);
    for (const row of imported.rows) {
      expect(sourceIds.has(row.id)).toBe(false);
      expect(row.id).toMatch(UUID);
      expect(row.owner).toBe(target.locationId);
    }
    expect(target.locationId).not.toBe(source.locationId);

    // The target was set up in Madrid, so Madrid's entries are current and Vielha's are retained.
    const cfg = scope(target);
    const read = () =>
      withTransaction(targetSuite.db, async (tx) => ({
        model: await readLocalHolidayModel(tx, cfg),
        epiphany: await readHolidays(tx, cfg, "2026-01-06", "2026-01-06"),
        aran: await readHolidays(tx, cfg, "2026-06-17", "2026-06-17"),
      }));
    const inMadrid = await read();
    expect(inMadrid.model.entries.map(({ date, name }) => ({ date, name }))).toEqual([
      { date: "2026-01-06", name: "Reyes en el barrio" },
      { date: "2026-05-15", name: "San Isidro" },
      { date: "2027-05-15", name: "San Isidro" },
    ]);
    expect(
      inMadrid.model.geographies.map(({ city, areaKey, matchesVenue }) => ({
        city,
        areaKey,
        matchesVenue,
      })),
    ).toEqual([
      { city: "Madrid", areaKey: null, matchesVenue: true },
      { city: "Vielha e Mijaran", areaKey: "aran", matchesVenue: false },
    ]);
    // The shipped Epiphany and the venue's own entry on the same date stay two facts.
    expect(inMadrid.epiphany.facts.map(({ scope, name }) => ({ scope, name }))).toEqual([
      { scope: "national", name: "Epifanía del Señor" },
      { scope: "local", name: "Reyes en el barrio" },
    ]);
    expect(inMadrid.epiphany.coverage).toEqual([
      expect.objectContaining({
        year: 2026,
        nationalRegional: "complete",
        local: "owner_entered",
        dataVersion: "ES-2026.1",
      }),
    ]);
    expect(inMadrid.aran.facts).toEqual([]);
    const special = await targetSuite.db.execute<{ name: string; close_whole_venue: number }>(sql`
      select name, close_whole_venue from special_dates where date = '2026-01-06'`);
    expect(special.rows).toEqual([{ name: "Reyes", close_whole_venue: 1 }]);

    // Moving the target to Vielha makes that geography, its area and its entry current.
    await moveTo(targetSuite.db, target, "Lleida", "Vielha e Mijaran");
    const inVielha = await read();
    expect(inVielha.model.entries.map(({ date, name }) => ({ date, name }))).toEqual([
      { date: "2026-07-20", name: "Santa Margarida" },
    ]);
    expect(inVielha.model.areaRequired).toBe(false);
    expect(inVielha.aran.facts.map(({ scope, name }) => ({ scope, name }))).toEqual([
      { scope: "regional", name: "Fiesta de Arán" },
    ]);
    expect(inVielha.epiphany.facts.map(({ scope }) => scope)).toEqual(["national"]);

    // And moving back restores Madrid's entries under the same ids.
    await moveTo(targetSuite.db, target, "Madrid", "Madrid");
    expect((await read()).model.entries).toEqual(inMadrid.model.entries);
  });

  it.each<[string, (tables: ConfigurationBundle["tables"]) => void, string]>([
    [
      "an entry whose geography is not in the bundle",
      (t) => (t.local_holidays![0]!.geography_id = randomUUID()),
      "local_holidays.geography_id",
    ],
    [
      "a second geography for the same place",
      (t) =>
        t.holiday_geographies!.push({
          ...t.holiday_geographies!.find((row) => row.city === "Madrid")!,
          id: randomUUID(),
          city: "madrid",
        }),
      "holiday_geographies.city_key",
    ],
    [
      "an impossible date",
      (t) => (t.local_holidays![0]!.date = "2026-02-29"),
      "local_holidays.date",
    ],
    [
      "two entries of one geography on one date",
      (t) =>
        t.local_holidays!.push({
          ...t.local_holidays!.find((row) => row.date === "2027-05-15")!,
          id: randomUUID(),
          name: "Otra fiesta",
        }),
      "local_holidays.date",
    ],
    [
      "an area the data does not offer for the province",
      (t) => (t.holiday_geographies!.find((row) => row.area_key === "aran")!.area_key = "tenerife"),
      "holiday_geographies.area_key",
    ],
    ["a blank name", (t) => (t.local_holidays![0]!.name = "  "), "local_holidays.name"],
    [
      "a third Spanish local holiday in 2026, past the two Spain allows",
      (t) =>
        t.local_holidays!.push({
          ...t.local_holidays!.find((row) => row.date === "2026-05-15")!,
          id: randomUUID(),
          date: "2026-11-09",
        }),
      "local_holidays",
    ],
  ])("refuses an edited bundle with %s, and writes no venue", async (_, edit, field) => {
    const { versions, transferred } = await preparedWithHolidays("B45002211");
    const tables = structuredClone(transferred.tables);
    edit(tables);
    const edited: ConfigurationBundle = { ...transferred, tables };
    const refusal = { code: "setup.request_invalid", params: { field } };
    expect(() => validateConfigurationBundle(edited, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B45002222");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, result) =>
          importConfigurationTables(tx, edited, result, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<Record<string, number>>(sql`
      select
        (select cast(count(*) as int) from tenants where tax_id = ${target.taxId}) as tenants,
        (select cast(count(*) as int) from holiday_geographies) as geographies,
        (select cast(count(*) as int) from local_holidays) as entries,
        (select cast(count(*) as int) from special_dates) as special_dates`);
    expect(persisted.rows[0]).toEqual({ tenants: 0, geographies: 0, entries: 0, special_dates: 0 });
  });

  it("refuses a bundle exported before the holiday tables existed, as an older venue-service schema", async () => {
    const { versions, transferred } = await preparedWithHolidays("B45003311");
    const journal = JSON.parse(
      await readFile(
        new URL("../../../packages/venue-service/drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    const holidayMigration = journal.entries.findIndex(
      (entry) => entry.tag === "0023_public_holidays",
    );
    expect(holidayMigration).toBeGreaterThan(0);
    expect(versions["venue-service"]).toBe(journal.entries.length);
    const older: ConfigurationBundle = {
      ...transferred,
      modules: { ...transferred.modules, "venue-service": holidayMigration },
    };
    expect(() => validateConfigurationBundle(older, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "module:venue-service" },
      }),
    );
  });
});

it("round-trips departmental transfer directions and desks with remapped ids, leaving operational requests behind", async () => {
  const source = await applyVenue(planVenue(venue("B36472851"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const cfg = { locationId: brandLocationId(source.locationId) };
  const original = await withTransaction(suite.db, async (tx) => {
    const a = await createDepartment(tx, cfg, {
      name: "Transfer deli",
      defaultServiceMode: "table_tab",
    });
    const b = await createDepartment(tx, cfg, {
      name: "Transfer restaurant",
      defaultServiceMode: "table_tab",
    });
    const zone = await createServiceZone(tx, cfg, {
      name: "Transfer receiving zone",
      departmentId: b.id,
    });
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: "Transfer receiving desk",
        formFactor: "till",
        capabilities: ["take-orders"],
      })
      .returning();
    await setProfileServiceScope(tx, cfg, profile!.id, {
      departmentId: b.id,
      allowedZoneIds: null,
      startingZoneId: zone.id,
    });
    await setDepartmentTransferSettings(tx, cfg, a.id, {
      receivingProfileId: null,
      destinationDepartmentIds: [b.id],
    });
    await setDepartmentTransferSettings(tx, cfg, b.id, {
      receivingProfileId: profile!.id,
      destinationDepartmentIds: [],
    });
    return [a.id, b.id, profile!.id];
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const bundle = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-07T10:00:00Z"),
    versions,
  );
  expect(bundle.tables).not.toHaveProperty("department_transfer_requests");
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(bundle, "a strong passphrase"),
    "a strong passphrase",
  );
  await applyVenue(planVenue(venue("B36472852"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, result) =>
      importConfigurationTables(
        tx,
        decoded,
        { locationId: result.locationId },
        ALL_MODULES,
        versions,
      ),
  });
  const direction = await targetSuite.db.execute<{
    source: string;
    destination: string;
    source_id: string;
    destination_id: string;
  }>(sql`
    select a.name as source, b.name as destination, t.source_department_id as source_id, t.destination_department_id as destination_id
    from department_transfer_destinations t join departments a on a.id=t.source_department_id join departments b on b.id=t.destination_department_id
    where a.name='Transfer deli'`);
  expect(direction.rows).toEqual([
    {
      source: "Transfer deli",
      destination: "Transfer restaurant",
      source_id: expect.any(String),
      destination_id: expect.any(String),
    },
  ]);
  const desk = await targetSuite.db.execute<{
    department: string;
    profile: string;
    department_id: string;
    profile_id: string;
  }>(sql`
    select d.name as department, p.name as profile, t.department_id, t.receiving_profile_id as profile_id
    from department_transfer_desks t join departments d on d.id=t.department_id join device_profiles p on p.id=t.receiving_profile_id
    where d.name='Transfer restaurant'`);
  expect(desk.rows).toEqual([
    {
      department: "Transfer restaurant",
      profile: "Transfer receiving desk",
      department_id: expect.any(String),
      profile_id: expect.any(String),
    },
  ]);
  for (const id of [
    direction.rows[0]!.source_id,
    direction.rows[0]!.destination_id,
    desk.rows[0]!.profile_id,
  ])
    expect(original).not.toContain(id);
});
