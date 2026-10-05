import {
  addMember,
  addShortcut,
  deleteSection,
  listHomeLayouts,
  createCatalogue,
  createCategory,
  createHomeLayout,
  deviceHomeLayouts,
  setDeviceHomeLayout,
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
  previewMenu,
  publishMenu,
  readMenuStructure,
  readSection,
  sections,
  setProductVariants,
  updateOptionList,
  writeProductModifiers,
} from "@waitron/catalogue";
import { and, eq, sql } from "drizzle-orm";
import { uploadImage, readImageBytes } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  catalogues,
  categories,
  deviceProfiles,
  diningTables,
  floorZones,
  kitchenStations,
  printAgents,
  printers,
  watchers,
  watcherStations,
  watcherZones,
  watcherPrinters,
  CORE_CONFIGURATION_TRANSFER,
  products,
  sales,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readProfilePrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { hashPassword, hashPin, persons } from "@waitron/identity";
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
import { decimal, nodeId, seriesId, deviceOrigin } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { systemClock } from "./till-backend.js";
import {
  buildConfigurationBundle,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import { seedSessionDevice } from "./testing/session-device.js";

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
  version: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  sourceOperatorId: "source-admin",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
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
      receiptPrintMode: "auto",
      drawerOpenPolicy: "gated",
      catalogueId: null,
    },
    seriesCode: "F",
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
    await suite.db.execute(
      sql`update locations set order_flow = 'invoice_first' where id = ${source.locationId}`,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: sourceOperator.rows[0]!.id },
      ALL_MODULES,
      new Date("2026-09-09T00:00:00.000Z"),
      versions,
    );
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
    const targetOrderFlow = await targetSuite.db.execute<{ order_flow: string }>(sql`
      select order_flow from locations where id = ${target.locationId}
    `);
    expect(targetOrderFlow.rows).toEqual([{ order_flow: "prepay" }]);
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

it("carries a device profile's home layout choice, remapped to the imported menu and layout", async () => {
  const source = await applyVenue(planVenue(venue("B66778899"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Layout menu" });
    const counter = await createHomeLayout(tx, menu.id, "Counter");
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: "Handheld", formFactor: "phone-portrait" })
      .returning({ id: deviceProfiles.id });
    await setDeviceHomeLayout(tx, profile!.id, menu.id, counter.id);
    return { menu: menu.id, counter: counter.id, profile: profile!.id };
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-27T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.device_profile_home_layouts).toEqual([
    { device_profile_id: original.profile, menu_id: original.menu, layout_id: original.counter },
  ]);
  await applyVenue(planVenue(venue("B99887766"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, result) =>
      importConfigurationTables(tx, transferred, result, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const [profile] = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.name, "Handheld"));
    const menus = await deviceHomeLayouts(tx, profile!.id);
    const menu = menus.find((entry) => entry.menuName === "Layout menu")!;
    expect(menu.menuId).not.toBe(original.menu);
    const counter = menu.layouts.find((layout) => layout.name === "Counter")!;
    expect(counter.id).not.toBe(original.counter);
    expect(menu).toMatchObject({ selectedLayoutId: counter.id, selectedRemoved: false });
  });
});

it("leaves publication behind, so an imported venue's menus arrive unpublished", async () => {
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
  });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-26T12:00:00Z"),
    versions,
  );
  for (const table of ["menu_versions", "menu_publications", "menu_version_images"])
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
});

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
    const [home] = await listHomeLayouts(tx, menu.id);
    const tile = await addShortcut(tx, home!.id, { kind: "section", sectionId: beer.id });
    await addShortcut(tx, home!.id, { kind: "product", productId: water.id });
    await deleteSection(tx, beer.id);
    return { menu: menu.id, tile: tile.id, home: home!.id };
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
    const [home] = await listHomeLayouts(tx, menu!.id);
    expect(menu!.id).not.toBe(original.menu);
    expect(home!.id).not.toBe(original.home);
    expect(home!.tiles[0]!.memberId).not.toBe(original.tile);
    expect(
      home!.tiles.map((tile) => [tile.position, tile.ref.kind, tile.name, tile.missingName]),
    ).toEqual([
      [0, "missing", "Missing slots › Beer", "Missing slots › Beer"],
      [1, "product", "Water", null],
    ]);
    const preview = await previewMenu(tx, menu!.id);
    expect(preview.document.homeLayouts[0]!.tiles[0]).toEqual({ kind: "empty" });
    expect(preview.warnings).toEqual([
      { kind: "shortcut_missing", layoutName: "Home", name: "Missing slots › Beer" },
    ]);
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
    default_menu_id: string | null;
  }>(sql`select zone_id, default_menu_id from zone_service_policies`);
  expect(policies.rows.length).toBeGreaterThan(0);
  const targetMenus = new Set(
    (await targetSuite.db.select({ id: catalogues.id }).from(catalogues)).map((row) => row.id),
  );
  for (const policy of policies.rows) {
    expect(bundleIds.has(policy.zone_id)).toBe(false);
    expect(bundleIds.has(policy.default_menu_id!)).toBe(false);
    expect(targetMenus.has(policy.default_menu_id!)).toBe(true);
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
