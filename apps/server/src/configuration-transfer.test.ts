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
import { sql } from "drizzle-orm";
import { uploadImage, readImageBytes } from "@waitron/media";
import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { asAppUser, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { recordSale } from "@waitron/core";
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
      select count(*)::int as count from tenants where tax_id = ${targetRequest.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });

  it("copies declared configuration into a fresh venue while scrubbing staff authenticators", async () => {
    const source = await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const uploaded = await uploadImage(
        tx,
        {
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
          names: { es: "Pan" },
          altText: { es: "Una hogaza" },
          labels: ["Food"],
        },
        { maxUploadBytes: 100 },
      );
      await tx.execute(sql`
        insert into persons
          (id, display_name, pin_hash, password_hash, email, role)
        values
          ('12121212-aaaa-aaaa-aaaa-121212121212', 'Second admin',
           'second-admin-pin', 'second-admin-password', 'second-admin@example.test', 'admin')`);
      await tx.execute(sql`
        insert into catalogues (id, name) values
          ('11111111-aaaa-aaaa-aaaa-111111111111', 'Prepared menu')`);
      await tx.execute(sql`
        insert into products
          (id, catalogue_id, name, pricing_unit, unit_price, vat_class)
        values
          ('22222222-aaaa-aaaa-aaaa-222222222222',
           '11111111-aaaa-aaaa-aaaa-111111111111', 'Café', 'each', 150, 'general')`);
      await tx.execute(
        sql`update products set image = ${uploaded.image.filename} where id = '22222222-aaaa-aaaa-aaaa-222222222222'`,
      );
      await tx.execute(sql`
        insert into categories (id, name) values
          ('23232323-aaaa-aaaa-aaaa-232323232323', '{"es":"Panadería"}'::jsonb)`);
      await tx.execute(sql`
        insert into category_details (category_id, image) values
          ('23232323-aaaa-aaaa-aaaa-232323232323', ${uploaded.image.filename})`);
      await tx.execute(sql`
        insert into product_categories (product_id, category_id) values
          ('22222222-aaaa-aaaa-aaaa-222222222222',
           '23232323-aaaa-aaaa-aaaa-232323232323')`);
      await tx.execute(sql`
        update products set category_id = '23232323-aaaa-aaaa-aaaa-232323232323'
        where id = '22222222-aaaa-aaaa-aaaa-222222222222'`);
      await tx.execute(sql`
        insert into persons
          (id, display_name, pin_hash, password_hash, email, role)
        values
          ('33333333-aaaa-aaaa-aaaa-333333333333', 'Ada',
           'source-pin-secret', 'source-password-secret', 'ada@example.test', 'manager')`);
      await tx.execute(sql`
        insert into employments
          (id, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate)
        values
          ('66666666-aaaa-aaaa-aaaa-666666666666',
           '33333333-aaaa-aaaa-aaaa-333333333333', 2400, 'permanent', '2026-01-01', 1250)`);
      await tx.execute(sql`
        insert into availability
          (id, person_id, weekday, available_from_minute, available_to_minute,
           effective_from)
        values
          ('77777777-aaaa-aaaa-aaaa-777777777777',
           '33333333-aaaa-aaaa-aaaa-333333333333', 1, 540, 1020, '2026-01-01')`);
      await tx.execute(sql`
        insert into shift_templates
          (id, location_id, label, weekday, starts_minute, ends_minute, role)
        values
          ('88888888-aaaa-aaaa-aaaa-888888888888', ${source.locationId},
           'Evening', 1, 1020, 120, 'bar')`);
      await tx.execute(sql`
        insert into convenio_config (id, location_id)
        values ('99999999-aaaa-aaaa-aaaa-999999999999', ${source.locationId})`);
      await tx.execute(sql`
        insert into payment_policy (offline_mode, offline_amount_cap) values ('cash_only', 5000)`);
      await tx.execute(sql`
        insert into working_orders
          (id, till_id, node_id, order_number, label)
        values
          ('aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa', ${source.tillId},
           ${source.nodeId}, 1, 'Practice tab')`);
      await tx.execute(sql`
        insert into dining_tables
          (id, location_id, label, tab_id)
        values
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ${source.locationId},
           'T1', 'aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa')`);
      await tx.execute(sql`
        insert into payments
          (id, working_order_id, node_id, provider, payment_ref, amount, state)
        values
          ('cccccccc-bbbb-bbbb-bbbb-cccccccccccc',
           'aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa', ${source.nodeId}, 'simulated',
           'practice-payment', 150, 'captured')`);
      await tx.execute(sql`
        insert into bookings
          (id, location_id, booking_date, booking_time, party_size, contact_name,
           table_id, created_by)
        values
          ('dddddddd-bbbb-bbbb-bbbb-dddddddddddd', ${source.locationId},
           '2026-09-10', '20:00', 2, 'Practice guest',
           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
           '33333333-aaaa-aaaa-aaaa-333333333333')`);
      await tx.execute(sql`
        insert into print_agents
          (id, location_id, name, token_hash, active, host)
        values
          ('44444444-aaaa-aaaa-aaaa-444444444444', ${source.locationId},
           'Kitchen agent', 'source-agent-token', true, 'source-box.local')`);
      await tx.execute(sql`
        insert into printers
          (id, location_id, name, transport, local_key, active,
           paper_width, resolution, character_set)
        values
          ('55555555-aaaa-aaaa-aaaa-555555555555', ${source.locationId},
           'Kitchen printer', 'usb', 'B120300001', true, '58mm', '203dpi', 'pc858')`);
      await tx.execute(sql`
        insert into sales
          (till_id, series_id, node_id, invoice_number, issued_at,
           issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
           fiscal_backend, fiscal_state)
        values
          (${source.tillId}, ${source.seriesIds[0]}, ${source.nodeId}, 99,
           '2026-09-09T10:00:00Z', 0, 150, '[]', 'es-ES', array['es-ES'],
           'verifactu', 'recorded')`);
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
      expect(bytes?.bytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1]));
      const attached = await tx.execute<{ image: string }>(sql`select image from products `);
      expect(attached.rows[0]!.image).toBe(metadata!.filename);
      const category = await tx.execute<{
        name: Record<string, string>;
        image: string;
        primary: boolean;
        member: boolean;
      }>(sql`
        select c.name, d.image,
          p.category_id = c.id as primary,
          exists (
            select 1 from product_categories pc
            where pc.product_id = p.id and pc.category_id = c.id
          ) as member
        from categories c
        join category_details d on d.category_id = c.id
        cross join products p
        where p.name = 'Café'
      `);
      expect(category.rows).toEqual([
        {
          name: { es: "Panadería" },
          image: metadata!.filename,
          primary: true,
          member: true,
        },
      ]);
    });
    const sourceSales = await suite.db.execute<{ count: number }>(
      sql`select count(*)::int as count from sales `,
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
        (select count(*)::int from products ) as products,
        (select count(*)::int from persons where role = 'manager') as staff,
        (select count(*)::int from persons where role = 'admin' and status = 'suspended') as suspended_admins,
        (select count(*)::int from persons where (pin_hash = 'source-pin-secret' or password_hash = 'source-password-secret')) as secret_hits,
        (select status from persons where role = 'manager') as status,
        (select count(*)::int from sales ) as target_sales,
        (select count(*)::int from print_agents
          where not active) as inactive_agents,
        (select count(*)::int from printers
          where not active and local_key = 'B120300001') as inactive_printers,
        (select count(*)::int from print_agents
          where token_hash = 'source-agent-token') as source_agent_secrets,
        (select count(*)::int from employments) as employments,
        (select count(*)::int from availability) as availability,
        (select count(*)::int from shift_templates) as shift_templates,
        (select count(*)::int from convenio_config) as convenio_config,
        (select count(*)::int from payment_policy) as payment_policy,
        (select count(*)::int from dining_tables
          where tab_id is not null) as linked_tables,
        (select count(*)::int from working_orders ) as target_orders,
        (select count(*)::int from payments) as target_payments,
        (select count(*)::int from bookings) as target_bookings
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
    const firstLive = await targetSuite.db.execute<{
      invoice_number: number;
      first_record: boolean;
      previous_hash: string | null;
    }>(
      sql`
        select s.invoice_number, r.primer_registro as first_record,
          r.anterior_huella as previous_hash
        from sales s
        join registros_facturacion r on r.sale_id = s.id
      `,
    );
    expect(firstLive.rows).toEqual([
      { invoice_number: 1, first_record: true, previous_hash: null },
    ]);
  });
});

it("transfers the extras and options lists, remaps their ids and preserves menu prices", async () => {
  const source = await applyVenue(planVenue(venue("B11223344"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
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
    // pointing at each other — the property the old option-group round trip checked with
    // `defaultChoiceId`.
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
    await asAppUser(tx);
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
