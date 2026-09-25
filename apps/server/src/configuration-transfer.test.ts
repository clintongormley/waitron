import {
  createCatalogue,
  createExtraList,
  createMenuItem,
  createMenuSection,
  createOptionList,
  createProduct,
  listExtraLists,
  listMenuOffers,
  listOptionLists,
  setMenuItemExtraLists,
  updateOptionList,
  writeProductModifiers,
} from "@waitron/catalogue";
import { eq, sql } from "drizzle-orm";
import { uploadImage, readImageBytes } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  catalogues,
  categories,
  diningTables,
  printAgents,
  printers,
  products,
  sales,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { recordSale } from "@waitron/core";
import { categoryDetails, productCategories } from "@waitron/catalogue";
import { availability, employments, shiftTemplates } from "@waitron/workforce";
import { convenioConfig } from "@waitron/workforce-es";
import { bookings } from "@waitron/bookings";
import { payments } from "@waitron/payments";
import { nodeId, seriesId, tillId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { systemClock } from "./till-backend.js";
import {
  buildConfigurationBundle,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  type ConfigurationBundle,
} from "./configuration-transfer.js";

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
    tillName: "Till",
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
      orderFlow: "prepay",
      bumpMode: "line",
      fireControl: "waiter",
      receiptPrintMode: "auto",
      drawerOpenPolicy: "gated",
      catalogueId: null,
    },
    tillName: "Till",
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
            alt_text: { en: "A loaf" },
            labels: ["Food"],
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
          altText: { es: "Una hogaza" },
          labels: ["Food"],
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
        .values({ id: "23232323-aaaa-aaaa-aaaa-232323232323", name: { es: "Panadería" } });
      await tx.insert(categoryDetails).values({
        categoryId: "23232323-aaaa-aaaa-aaaa-232323232323",
        image: uploaded.image.filename,
      });
      await tx.insert(productCategories).values({
        productId: "22222222-aaaa-aaaa-aaaa-222222222222",
        categoryId: "23232323-aaaa-aaaa-aaaa-232323232323",
      });
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
        tillId: source.tillId,
        nodeId: source.nodeId,
        orderNumber: 1,
        label: "Practice tab",
      });
      await tx.insert(diningTables).values({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        locationId: source.locationId,
        label: "T1",
        tabId: "aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa",
      });
      await tx.insert(payments).values({
        id: "cccccccc-bbbb-bbbb-bbbb-cccccccccccc",
        workingOrderId: "aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa",
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
        characterSet: "pc858",
      });
      await tx.insert(sales).values({
        tillId: source.tillId,
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

    const target = await applyVenue(planVenue(venue("B87654321"), ALL_MODULES), {
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
    await withTransaction(targetSuite.db, async (tx) => {
      const [metadata] = transferred.tables.media_images!;
      const bytes = await readImageBytes(tx, metadata!.filename as string);
      expect(bytes?.bytes).toEqual(photo.bytes);
      const attached = await tx.execute<{ image: string }>(sql`select image from products `);
      expect(attached.rows[0]!.image).toBe(metadata!.filename);
      // Read through the TABLE, not the raw select below: `name` is a `json` column, and a raw
      // select hands back the stored text.
      const named = await tx.select({ name: categories.name }).from(categories);
      expect(named).toEqual([{ name: { es: "Panadería" } }]);
      const category = await tx.execute<{
        image: string;
        primary: number;
        member: number;
      }>(sql`
        select d.image,
          -- The alias is quoted: primary is a keyword to this parser, so a bare "as primary" is
          -- refused with near "primary": syntax error while the quoted form returns the column.
          -- Measured on node:sqlite, Node v26.7.0, with "as member" as the control that needs no
          -- quoting.
          p.category_id = c.id as "primary",
          exists (
            select 1 from product_categories pc
            where pc.product_id = p.id and pc.category_id = c.id
          ) as member
        from categories c
        join category_details d on d.category_id = c.id
        cross join products p
        where p.name = 'Café'
      `);
      // 1, not `true`: both are SQL expressions, which the `flag` helper's boolean mapping never
      // reaches. A category the product did NOT belong to would answer 0.
      expect(category.rows).toEqual([
        {
          image: metadata!.filename,
          primary: 1,
          member: 1,
        },
      ]);
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
      linked_tables: number;
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
        (select count(*) from dining_tables
          where tab_id is not null) as linked_tables,
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
      linked_tables: 0,
      target_orders: 0,
      target_payments: 0,
      target_bookings: 0,
    });

    const printerSettings = await targetSuite.db.execute<{
      paper_width: string;
      resolution: string;
      character_set: string;
    }>(sql`
      select paper_width, resolution, character_set from printers
      where local_key = 'B120300001'`);
    expect(printerSettings.rows).toEqual([
      { paper_width: "58mm", resolution: "203dpi", character_set: "pc858" },
    ]);

    const fiscal = ALL_MODULES.find((module) => module.fiscal?.id === "verifactu")!.fiscal!;
    await withTransaction(targetSuite.db, (tx) =>
      recordSale(
        tx,
        fiscal.makeBackend({ db: targetSuite.db, clock: systemClock(), environment: "production" }),
        {
          tillId: tillId(target.tillId),
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
    const section = await createMenuSection(tx, {
      menuId: menu.id,
      name: { es: "Bebidas" },
    });
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
      soldAlone: false,
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
        items: [{ productId: shot.id, maxQuantity: 3, preselected: true, price: "1.50" }],
      },
      "es",
    );
    // Ordered: extras first, then options. The order is the product's own and the transfer has to
    // bring it across.
    await writeProductModifiers(tx, product.id, [
      { kind: "extras", id: extraList.id },
      { kind: "options", id: withDefault.id },
    ]);
    const offer = await createMenuItem(tx, {
      menuId: menu.id,
      sectionId: section.id,
      productId: product.id,
      grossPrice: "2.75",
    });
    // An extras list reaches a menu offer only when the offer PUBLISHES it (`readMenuExtras`,
    // packages/catalogue/src/offered-modifiers.ts), and this offer republishes the shot at its own
    // price rather than the list's 1.50.
    await setMenuItemExtraLists(tx, offer.id, [
      { listId: extraList.id, items: [{ productId: shot.id, price: "0.90", available: true }] },
    ]);
    // A menu that sets no price of its own: blank has to arrive blank, not as zero.
    const tea = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Té",
      pricingUnit: "each",
      unitPrice: "1.80",
      vatClass: "reduced",
    });
    await createMenuItem(tx, {
      menuId: menu.id,
      sectionId: section.id,
      productId: tea.id,
      grossPrice: null,
      displayOrder: 1,
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
  expect(transferred.tables.menu_item_extra_lists).toHaveLength(1);
  expect(transferred.tables.menu_item_extra_items).toHaveLength(1);
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
      price: "1.50",
    });
    expect(extraLists[0]!.items[0]!.productId).not.toBe(original.shotId);

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
