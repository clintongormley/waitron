import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import {
  readPrinterHoldsForTest,
  holdPrinterForTest,
  seedPerson,
} from "@waitron/db/testing/seed.js";
import { columnsFromOverrides, overridesFromRow } from "@waitron/menu";
import { STARTER_STEP_NAMES } from "@waitron/venue-service";
import { departmentCourses, withFoldedPersonChanges } from "@waitron/db";
import type { TradingContext } from "./trading-context.js";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { roles, personRoles, readSettings } from "@waitron/db";
import { listAdminHolders, readPersonAuthority } from "@waitron/identity";
import { STARTER_PROFILE_NAMES } from "@waitron/provisioning";
import { personStaffRoles, staffRoles } from "@waitron/db";
import { canUseDeviceProfile } from "@waitron/identity";
import { STARTER_JOB_ROLE_NAMES } from "@waitron/provisioning";
import { seedPersons, builtInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { listPagePrinters, registerPagePrinter } from "./page-printers.js";
import {
  seedBusinessDay,
  seedDeviceProfiles,
  seedZone,
  seedActivityActor,
  attachStationPrinterForTest,
  seedDepartmentReceipt,
} from "@waitron/db/testing/seed.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { deleteCourse } from "./course-delete.js";
import { deleteStation } from "./station-delete.js";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import {
  addMember,
  addShortcut,
  deleteSection,
  readMenuHome,
  createMenu,
  createMenuShell,
  setVenueDefaultMenu,
  createCategory,
  createExtraList,
  addProductToMenu,
  createOptionList,
  createProduct,
  updateProduct,
  createSectionIn,
  listExtraLists,
  listMenuOffers,
  listOptionLists,
  menuStatus,
  menuVersions,
  menuReleases,
  menuDocumentHash,
  previewMenu,
  publishMenu,
  readMenuStructure,
  readSection,
  sectionMembers,
  sections,
  setMenuVariantPrice,
  setProductVariants,
  updateOptionList,
  writeProductModifiers,
} from "@waitron/menu";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { loadKeyRing } from "@waitron/credentials";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  uploadImage,
  readImageBytes,
  readCurrentImage,
  readImage,
  saveImage,
  mediaImages,
  mediaBlobs,
  renderRendition,
  listImageUsages,
} from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import {
  activityLog,
  outgoingMail,
  menus,
  saveVenueFields,
  readVenueSettings,
  categories,
  deviceZoneSelections,
  deviceProfiles,
  devices,
  diningTables,
  floorPlanTables,
  floorZones,
  routingCells,
  routingCellPeriods,
  kitchenStations,
  kitchenCourses,
  menuItems,
  dayCutoverChanges,
  settings as businessDaySettingsTable,
  printAgents,
  printers,
  printJobs,
  deviceProfilePrinters,
  drawerOpens,
  stationPrinterPairs,
  CORE_CONFIGURATION_TRANSFER,
  customThemes,
  products,
  sales,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  deleteDeviceProfile,
  emptyPrinterLists,
  listCustomThemes,
  readProfilePrinterLists,
  setProfilePrinterLists,
} from "@waitron/layouts";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { deviceProfileAdmissionRoles, persons, startManagementSession } from "@waitron/identity";
import { recordSale } from "@waitron/core";
import { units, MENU_SETTINGS, saveMenuSettings, saveMenuDefaultColor } from "@waitron/menu";
import { availability, employments, shiftTemplates } from "@waitron/workforce";
import { convenioConfig, resolveWorkTimeRuleset } from "@waitron/workforce-es";
import { bookings } from "@waitron/bookings";
import {
  adjustmentReasons,
  createAdjustmentReason,
  listAdjustmentReasons,
  readAdjustmentSettings,
  saveAdjustmentSettings,
} from "@waitron/adjustments";
import { payments } from "@waitron/payments";
import {
  configureZone,
  createDepartment,
  saveServiceSteps,
  listServiceSteps,
  deleteDepartment,
  deleteZone,
  setDepartmentSalePolicyField,
  setDepartmentTransferSettings,
  setProfileServiceScope,
  createServiceZone,
  departments,
  readHolidays,
  readHolidayAreaModel,
  readDepartmentDeleteImpact,
  readProfileServiceAccess,
  readProfileServiceScopes,
  saveHolidayArea,
  saveMenuPeriod,
  replaceMenuWeek,
  replaceZoneClosedWeek,
  routingModel,
  seasons,
  setProfileServiceAccess,
  setRoutingCell,
  setStationToday,
  stationStates,
  STARTER_SEASON_NAMES,
} from "@waitron/venue-service";
import { decimal, nodeId, seriesId, deviceOrigin } from "@waitron/shared";
import { moduleCoreServices } from "./parties.js";
import { createTable } from "./testing/live-table.js";
import { saveLayout } from "./floor-plan.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { ALL_MODULES, enabledTableRemovals, VENUE_SERVICE } from "./modules.js";
import { readVenueDetails, writeVenueDetails } from "./venue-details.js";
import { drawLogoRasters } from "./receipt-logo.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { systemClock } from "./till-backend.js";
import {
  buildConfigurationBundle,
  exportConfigurationTables,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { setDefaultStation } from "./kitchen.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import { deletePrinter } from "./printer-delete.js";
import { stageConfigurationImport } from "./configuration-import.js";
import { useTestProducer } from "./testing/test-producer.js";

useTestProducer();

// TWO databases: a transfer exports from a prepared venue's database and imports into a fresh
// production database, and each holds one taxpayer. `suite` holds the source venue, `targetSuite` the
// target the bundle is imported into.
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const targetSuite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("an export carrying kitchen printer rows imports without assigning kitchen equipment", async () => {
  const source = await applyVenue(planVenue(venue("B16734129"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const [kitchen] = await suite.db
    .select()
    .from(deviceProfiles)
    .where(eq(deviceProfiles.formFactor, "kds"));
  const [till] = await suite.db
    .select()
    .from(deviceProfiles)
    .where(eq(deviceProfiles.formFactor, "till"));
  const [printer] = await suite.db
    .insert(printers)
    .values({ name: "Configuration printer", transport: "network_tcp", host: "10.0.0.9" })
    .returning();
  await suite.db.insert(deviceProfilePrinters).values([
    {
      deviceProfileId: kitchen!.id,
      printerId: printer!.id,
      role: "receipt",
      position: 0,
      isDefault: true,
    },
    {
      deviceProfileId: till!.id,
      printerId: printer!.id,
      role: "receipt",
      position: 0,
      isDefault: true,
    },
  ]);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-11-15T10:00:00Z"),
    versions,
  );
  expect(
    transferred.tables.device_profile_printers!.some(
      (row) => row.device_profile_id === kitchen!.id,
    ),
  ).toBe(true);
  await applyVenue(planVenue(venue("B16734130"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const rows = await targetSuite.db
    .select({
      formFactor: deviceProfiles.formFactor,
      role: deviceProfilePrinters.role,
      printerName: printers.name,
    })
    .from(deviceProfilePrinters)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceProfilePrinters.deviceProfileId))
    .innerJoin(printers, eq(printers.id, deviceProfilePrinters.printerId));
  expect(rows).toEqual([
    { formFactor: "till", role: "receipt", printerName: "Configuration printer" },
  ]);
});

it("transfers two photo identities sharing replacement bytes with framing, names and printable logos", async () => {
  const originalA = await samplePreparedImage({ width: 31 });
  const originalB = await samplePreparedImage({ width: 37 });
  const replacement = await samplePreparedImage({ width: 41 });
  const frames = [
    { x: 1000, y: 8000, zoom: 175 },
    { x: 9000, y: 2500, zoom: 225 },
  ];
  const pictures: Awaited<ReturnType<typeof drawLogoRasters>>[] = [];
  for (const frame of frames)
    pictures.push(
      await drawLogoRasters(await renderRendition(replacement.bytes, "display", frame)),
    );
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const originals = await withTransaction(suite.db, async (tx) => {
    const a = (
      await uploadImage(tx, {
        image: originalA,
        names: { es: "Primera" },
        originalFilename: "first.webp",
      })
    ).image;
    const b = (
      await uploadImage(tx, {
        image: originalB,
        names: { es: "Segunda" },
        originalFilename: "second.webp",
      })
    ).image;
    const department = await createDepartment(tx, { name: "Photo receipt" });
    await seedDepartmentReceipt(tx, department.id, {
      logo: a.filename,
      phone: "+34 600 111 222",
      operationDescription: "Exported dining meals",
    });
    for (const [index, image] of [a, b].entries())
      await saveImage(
        tx,
        image.id,
        {
          names: image.names,
          framing: frames[index]!,
          expectedRevision: 1,
          originalFilename: "replacement.webp",
        },
        replacement,
        pictures[index],
        "es",
      );
    return [a, b];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-17T10:00:00Z"),
    versions,
  );
  expect(transferred.tables.media_blobs).toHaveLength(3);
  expect(transferred.tables.media_images).toHaveLength(2);
  const originalBundle = structuredClone(transferred);
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  expect(transferred).toEqual(originalBundle);
  const rows = await targetSuite.db.select().from(mediaImages);
  expect(rows).toHaveLength(2);
  expect(await targetSuite.db.select().from(mediaBlobs)).toHaveLength(3);
  expect(await targetSuite.db.select().from(mediaBlobs)).toEqual(
    expect.arrayContaining(
      [originalA, originalB, replacement].map((image) => ({
        hash: image.filename.slice(0, 64),
        format: "webp",
        bytes: image.bytes,
      })),
    ),
  );
  for (const [index, original] of originals.entries()) {
    const imported = rows.find((row) => row.filename === original!.filename)!;
    expect(imported.id).not.toBe(original!.id);
    expect(imported.names).toEqual(original!.names);
    expect(imported).toMatchObject({
      sourceHash: replacement.filename.slice(0, 64),
      focusX: frames[index]!.x,
      focusY: frames[index]!.y,
      zoom: frames[index]!.zoom,
      revision: 2,
      originalFilename: "replacement.webp",
    });
    expect(await readCurrentImage(targetSuite.db, imported.filename)).toEqual({
      imageId: imported.id,
      revision: 2,
      sourceFilename: replacement.filename,
      framing: frames[index]!,
      bytes: replacement.bytes,
    });
    expect((await readImage(targetSuite.db, imported.id)).originalFilename).toBe(
      "replacement.webp",
    );
    expect((await readImageBytes(targetSuite.db, imported.filename))?.bytes).toEqual(
      index === 0 ? originalA.bytes : originalB.bytes,
    );
  }
  const { readPrintedDepartmentReceipt } = await import("@waitron/venue-service");
  const [department] = await targetSuite.db
    .select()
    .from(departments)
    .where(eq(departments.name, "Photo receipt"));
  expect(department!.operationDescription).toBe("Exported dining meals");
  const scope = { receiptLanguages: ["es-ES"] };
  for (const paper of ["58mm", "80mm"] as const) {
    const printed = await readPrintedDepartmentReceipt(
      targetSuite.db,
      scope,
      department!.id,
      paper,
    );
    expect(printed.logo).toEqual({
      widthDots: pictures[0]![paper].widthDots,
      heightDots: pictures[0]![paper].heightDots,
      bits: new Uint8Array(Buffer.from(pictures[0]![paper].data, "base64")),
    });
    expect(printed.receipt.phone).toBe("+34 600 111 222");
    expect(printed.receipt.operationDescription).toBe("Exported dining meals");
  }
});

it("refuses corrupt photo override configuration before writing any target rows", async () => {
  const original = await samplePreparedImage({ width: 31 });
  const replacement = await samplePreparedImage({ width: 41 });
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: original, names: { es: "Foto" } });
    await saveImage(
      tx,
      image.id,
      { names: image.names, framing: { x: 2000, y: 8000, zoom: 175 }, expectedRevision: 1 },
      replacement,
      undefined,
      "es",
    );
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const bundle = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-17T10:00:00Z"),
    versions,
  );
  for (const fault of ["bytes", "source", "revision", "framing", "duplicate"] as const) {
    const corrupt = structuredClone(bundle);
    if (fault === "bytes") corrupt.tables.media_blobs![0]!.bytes = "\\x0001";
    if (fault === "source") corrupt.tables.media_images![0]!.source_hash = "a".repeat(64);
    if (fault === "revision")
      corrupt.tables.media_images![0]!.revision = Number.MAX_SAFE_INTEGER + 1;
    if (fault === "framing") corrupt.tables.media_images![0]!.focus_x = 0.5;
    if (fault === "duplicate")
      corrupt.tables.media_blobs!.push({ ...corrupt.tables.media_blobs![0]! });
    expect(() => validateConfigurationBundle(corrupt, ALL_MODULES, versions)).toThrow(
      expect.objectContaining({ code: "image.invalid_metadata" }),
    );
    await expect(
      withTransaction(targetSuite.db, (tx) =>
        importConfigurationTables(tx, corrupt, ALL_MODULES, versions),
      ),
    ).rejects.toMatchObject({ code: "image.invalid_metadata" });
    expect(
      (await targetSuite.db.execute(sql`select count(*) as n from media_images`)).rows,
    ).toEqual([{ n: 0 }]);
    expect((await targetSuite.db.execute(sql`select count(*) as n from media_blobs`)).rows).toEqual(
      [{ n: 0 }],
    );
  }
});

function venue(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Prepared SL",
    taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
    name: "Prepared",
    invoiceLocales: ["es-ES"],
    fiscalTerritory: "ES-common",
    addressLine1: "Calle 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    seriesCode: "F",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      email: `${taxId.toLowerCase()}@example.test`,
      pinHash: fixturePinHash("1234"),
      passwordHash: fixturePasswordHash("a secure password"),
    },
  };
}

const bundle: ConfigurationBundle = {
  version: 50,
  contentLanguages: null,
  holidayArea: null,
  settings: {},
  createdAt: "2026-09-09T00:00:00.000Z",
  sourceOperatorId: "source-admin",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
    name: "Prepared",
    invoiceLocales: ["es-ES"],
    fiscalTerritory: "ES-common",
    addressLine1: "Calle 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
    seriesCode: "F",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
  },
  privacyContact: { privacyNoticeUrl: null, privacyEmail: null },
  modules: { core: 1 },
  tables: { products: [{ id: "p1", name: "Coffee" }] },
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
            original_hash: "a".repeat(64),
            source_hash: null,
            focus_x: 5000,
            focus_y: 5000,
            zoom: 100,
            revision: 1,
            original_filename: null,
            names: { en: "Bread" },
          },
        ],
        media_blobs: [{ hash: "a".repeat(64), format: "png", bytes: "\\x89504e470d0a1a0a" }],
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

  it.each([7, null])(
    "accepts a bundle that still carries a venue bump mode, whatever its value, as it no longer checks it (%s)",
    (leftover) => {
      const older = {
        ...bundle,
        venue: { ...bundle.venue, bumpMode: leftover },
      };
      expect(
        decodeConfigurationBundle(
          encodeConfigurationBundle(older, "a strong passphrase"),
          "a strong passphrase",
        ).venue,
      ).toMatchObject(bundle.venue);
    },
  );

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
  it("exports venue fields and restores languages, holiday area and a non-starter default menu", async () => {
    const source = await applyVenue(planVenue(venue("B13579246"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const holidayArea = { country: "ES", provinceCode: "28", cityKey: "madrid", areaKey: null };
    await withTransaction(suite.db, (tx) =>
      saveVenueFields(
        tx,
        {
          contentLanguages: ["es", "en"],
          defaultContentLanguage: "es",
          holidayArea,
        },
        null,
      ),
    );
    const chosen = await withTransaction(suite.db, async (tx) => {
      const menu = await createMenu(tx, { name: "Evening menu" });
      await setVenueDefaultMenu(tx, menu.id);
      return menu;
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const exported = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-11-10T10:00:00Z"),
      versions,
    );
    expect(Object.keys(exported.venue).sort()).toEqual(Object.keys(bundle.venue).sort());
    expect(exported.contentLanguages).toEqual({ defaultLanguage: "es", languages: ["es", "en"] });
    expect(exported.holidayArea).toEqual(holidayArea);
    expect(exported.tables).not.toHaveProperty("content_languages");
    expect(exported.tables).not.toHaveProperty("holiday_geographies");
    await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, exported, ALL_MODULES, versions),
    });
    const defaults = await targetSuite.db
      .select({ id: menus.id, name: menus.name })
      .from(menus)
      .where(eq(menus.isDefault, true));
    expect(defaults).toEqual([{ id: expect.any(String), name: "Evening menu" }]);
    expect(defaults[0]!.id).not.toBe(chosen.id);
    expect((await readVenueSettings(targetSuite.db)).doc).toMatchObject({
      contentLanguages: ["es", "en"],
      defaultContentLanguage: "es",
      holidayArea,
    });
  });

  it("imports the first venue's explicit agreement limits with the other rule defaults", async () => {
    const source = await applyVenue(planVenue(venue("B13579246"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-11-08T08:00:00Z"),
      versions,
    );
    transferred.tables.convenio_config = [
      {
        id: 1,
        created_at: "2026-11-08T08:00:00.000Z",
        weekly_rest_minutes: 2880,
        break_threshold_minutes: 300,
        min_break_minutes: 20,
      },
    ];
    await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    const [row] = await targetSuite.db.select().from(convenioConfig);
    expect(row!.id).toBe(1);
    expect(await resolveWorkTimeRuleset(targetSuite.db)).toMatchObject({
      weeklyRestMinutes: 2880,
      breakThresholdMinutes: 300,
      minBreakMinutes: 20,
      breaksCountAsWorked: false,
      maxWeeklyMinutes: 2400,
      workingDaysPerWeek: 5,
    });
  });

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
        beforeCommit: async (tx) => {
          await importConfigurationTables(
            tx,
            {
              ...bundle,
              tables: {
                products: [{ ...bundle.tables.products![0], injected_column: "refuse me" }],
              },
            },
            coreOnly,
            { core: 1 },
          );
        },
      }),
    ).rejects.toMatchObject({ code: "setup.request_invalid" });
    const persisted = await suite.db.execute<{ count: number }>(sql`
      select count(*) as count from taxpayer where tax_id = ${targetRequest.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });

  it("transfers page-printer capabilities to the target venue, waits in Add, then restores its id and saved name", async () => {
    const source = await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const [agent] = await suite.db
      .insert(printAgents)
      .values({ name: "Back office", tokenHash: "hash" })
      .returning({ id: printAgents.id });
    await insertA4Printer(suite.db, {
      id: "55555555-aaaa-aaaa-aaaa-555555555555",
      name: "Invoice office",
      host: "192.0.2.20",
      port: 8631,
      resourcePath: "/ipp/printer",
      documentFormat: "image/urf",
      supportedFormats: ["application/pdf", "image/urf"],
      resolutionDpi: 600,
      active: true,
      agentId: agent!.id,
    });
    const [operator] = await suite.db.select({ id: persons.id }).from(persons);
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: operator!.id },
      ALL_MODULES,
      new Date("2026-10-07T12:00:00.000Z"),
      versions,
    );
    expect(transferred.tables.printers!.filter((row) => row.kind === "a4")).toHaveLength(1);
    expect(transferred.reconnect).toContain("printers");
    await applyVenue(planVenue(venue("B87654323"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });

    const [imported] = await targetSuite.db.select().from(printers).where(eq(printers.kind, "a4"));
    expect(imported).toMatchObject({
      name: "Invoice office",
      host: "192.0.2.20",
      port: 8631,
      resourcePath: "/ipp/printer",
      documentFormat: "image/urf",
      supportedFormats: ["application/pdf", "image/urf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
      active: false,
      agentId: null,
    });
    // The agent itself travels, so a kept key would have been remapped to the imported agent.
    expect(await targetSuite.db.select({ id: printAgents.id }).from(printAgents)).toHaveLength(1);
    expect(imported!.id).not.toBe("55555555-aaaa-aaaa-aaaa-555555555555");
    expect(await listPagePrinters(targetSuite.db)).toEqual([]);
    const [localAgent] = await targetSuite.db
      .insert(printAgents)
      .values({
        name: "New office agent",
        tokenHash: "hash",
      })
      .returning({ id: printAgents.id });
    const now = Date.parse("2026-10-07T12:00:00.000Z");
    const restored = await withTransaction(targetSuite.db, (tx) =>
      registerPagePrinter(
        tx,
        {
          name: "Discovered office label",
          entry: {
            agentId: localAgent!.id,
            host: "192.0.2.20",
            lastSeenAt: now,
            office: {
              port: 8631,
              resourcePath: "/ipp/printer",
              printable: true,
              documentFormat: "application/pdf",
              supportedFormats: ["application/pdf"],
              media: "iso_a4_210x297mm",
              resolutionDpi: 300,
            },
          },
        },
        { now, discoveryUntil: 0 },
      ),
    );
    expect(restored).toEqual({ id: imported!.id, outcome: "enabled" });
    expect(await listPagePrinters(targetSuite.db)).toEqual([
      expect.objectContaining({
        id: imported!.id,
        name: "Invoice office",
        active: true,
        agentId: localAgent!.id,
        agentName: "New office agent",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        resolutionDpi: 300,
      }),
    ]);
    expect(
      await targetSuite.db.select().from(printers).where(eq(printers.kind, "receipt")),
    ).toEqual([]);
  });

  it("carries a profile's invoice list naming an A4 printer, pointing at the imported A4 printer", async () => {
    const source = await applyVenue(planVenue(venue("B13579246"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const sourcePagePrinterId = "56565656-aaaa-aaaa-aaaa-565656565656";
    await withTransaction(suite.db, async (tx) => {
      await insertA4Printer(tx, { id: sourcePagePrinterId, name: "Office A4", host: "192.0.2.40" });
      const [profile] = await seedDeviceProfiles(tx, { name: "Office till", formFactor: "till" });
      await setProfilePrinterLists(tx, profile!.id, {
        ...emptyPrinterLists(),
        invoicePrinterIds: [sourcePagePrinterId],
        invoicePrinterDefaultId: sourcePagePrinterId,
      });
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-15T12:00:00Z"),
      versions,
    );
    expect(transferred.tables.device_profile_printers!.map((row) => row.printer_id)).toContain(
      sourcePagePrinterId,
    );
    await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    const [imported] = await targetSuite.db
      .select({ id: printers.id })
      .from(printers)
      .where(eq(printers.name, "Office A4"));
    expect(imported!.id).not.toBe(sourcePagePrinterId);
    const [profile] = await targetSuite.db
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.name, "Office till"));
    const rows = await targetSuite.db
      .select({
        printerId: deviceProfilePrinters.printerId,
        isDefault: deviceProfilePrinters.isDefault,
      })
      .from(deviceProfilePrinters)
      .where(
        and(
          eq(deviceProfilePrinters.deviceProfileId, profile!.id),
          eq(deviceProfilePrinters.role, "invoice"),
        ),
      );
    expect(rows).toEqual([{ printerId: imported!.id, isDefault: true }]);
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
      // columns.
      await seedPersons(tx, {
        id: "12121212-aaaa-aaaa-aaaa-121212121212",
        displayName: "Second admin",
        pinHash: "second-admin-pin",
        passwordHash: "second-admin-password",
        email: "second-admin@example.test",
        role: "admin",
      });
      await tx
        .insert(menus)
        .values({ id: "11111111-aaaa-aaaa-aaaa-111111111111", name: "Prepared menu" });
      const [sourceUnit] = await tx
        .insert(units)
        .values({
          staffName: "Source kilogram",
          staffAbbreviation: "kg",
          name: {},
          abbreviation: {},
          precision: 3,
          hardwareUnit: "kg",
        })
        .returning({ id: units.id });
      await tx.insert(products).values({
        id: "22222222-aaaa-aaaa-aaaa-222222222222",
        unitId: sourceUnit!.id,
        name: "Coffee",

        unitPrice: 150,
        vatClass: "general",
      });
      await tx
        .update(products)
        .set({ image: uploaded.image.filename })
        .where(eq(products.id, "22222222-aaaa-aaaa-aaaa-222222222222"));
      await tx
        .insert(categories)
        .values({ id: "23232323-aaaa-aaaa-aaaa-232323232323", name: "Bakery" });
      await tx
        .update(products)
        .set({ categoryId: "23232323-aaaa-aaaa-aaaa-232323232323" })
        .where(eq(products.id, "22222222-aaaa-aaaa-aaaa-222222222222"));
      await seedPersons(tx, {
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
        label: "Evening",
        weekday: 1,
        startsMinute: 1020,
        endsMinute: 120,
      });
      await tx.insert(convenioConfig).values({
        id: 1,
        weeklyRestMinutes: 2880,
        breakThresholdMinutes: 300,
        minBreakMinutes: 20,
      });
      await seedWorkingOrder(tx, {
        id: "aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa",
        source: "dashboard",
        deviceId: null,
        nodeId: source.nodeId,
        orderNumber: 1,
        label: "Practice tab",
      });
      const [defaultDepartment] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.isDefault, true));
      const practiceZone = await createServiceZone(tx, {
        name: "Practice tables",
        departmentId: defaultDepartment!.id,
      });
      await tx.insert(diningTables).values({
        zoneId: practiceZone.id,
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        label: "T1",
      });
      await tx
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
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
        bookingDate: "2026-09-10",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Practice guest",
        tableId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        createdBy: "33333333-aaaa-aaaa-aaaa-333333333333",
      });
      await tx.insert(printAgents).values({
        id: "44444444-aaaa-aaaa-aaaa-444444444444",
        name: "Kitchen agent",
        tokenHash: "source-agent-token",
        active: true,
        host: "source-box.local",
      });
      await tx.insert(printers).values({
        id: "55555555-aaaa-aaaa-aaaa-555555555555",
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
      where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')
        and id <> '12121212-aaaa-aaaa-aaaa-121212121212'
    `);
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: sourceOperator.rows[0]!.id },
      ALL_MODULES,
      new Date("2026-09-09T00:00:00.000Z"),
      versions,
    );
    expect(transferred.tables.products![0]!.unit_id).toEqual(expect.stringMatching(/.+/));
    expect(transferred.venue.fullSeriesCode).toBe("FF");
    expect(transferred.venue.taxpayerDomicile).toBe("Calle Fiscal 8, 28001 Madrid");
    expect(transferred.venue).not.toHaveProperty("tillName");
    expect(transferred.venue).not.toHaveProperty("orderFlow");
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
      beforeCommit: async (tx) => {
        await importConfigurationTables(tx, transferred, ALL_MODULES, versions);
      },
    });
    await withTransaction(targetSuite.db, async (tx) => {
      const [metadata] = transferred.tables.media_images!;
      const bytes = await readImageBytes(tx, metadata!.filename as string);
      expect(bytes?.bytes).toEqual(photo.bytes);
      const attached = await tx.execute<{ image: string }>(sql`select image from products `);
      expect(attached.rows[0]!.image).toBe(metadata!.filename);
      const [importedUnit] = await tx
        .select({ id: units.id, staffName: units.staffName, hardwareUnit: units.hardwareUnit })
        .from(products)
        .innerJoin(units, eq(units.id, products.unitId))
        .where(eq(products.name, "Coffee"));
      expect(importedUnit).toMatchObject({ staffName: "Source kilogram", hardwareUnit: "kg" });
      expect(importedUnit!.id).not.toBe(transferred.tables.products![0]!.unit_id);
      const named = await tx.select({ name: categories.name }).from(categories);
      expect(named).toEqual([{ name: "Bakery" }]);
      const category = await tx.execute<{ primary: number }>(sql`
        select
          -- The alias is quoted: primary is a keyword to this parser, so a bare "as primary" is
          -- refused with near "primary": syntax error while the quoted form returns the column.
          -- Measured on node:sqlite, Node v26.7.0, with "as member" as the control that needs no
          -- quoting.
          p.category_id = c.id as "primary"
        from categories c
        cross join products p
        where p.name = 'Coffee'
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
      target_orders: number;
      target_payments: number;
      target_bookings: number;
    }>(sql`
      select
        (select count(*) from products ) as products,
        (select count(*) from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'manager')) as staff,
        (select count(*) from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin') and status = 'suspended') as suspended_admins,
        (select count(*) from persons where (pin_hash = 'source-pin-secret' or password_hash = 'source-password-secret')) as secret_hits,
        (select status from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'manager')) as status,
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
      target_orders: 0,
      target_payments: 0,
      target_bookings: 0,
    });

    expect(await resolveWorkTimeRuleset(targetSuite.db)).toMatchObject({
      weeklyRestMinutes: 2880,
      breakThresholdMinutes: 300,
      minBreakMinutes: 20,
      breaksCountAsWorked: false,
    });

    const printerSettings = await targetSuite.db.execute<{
      paper_width: string;
      resolution: string;
    }>(sql`
      select paper_width, resolution from printers
      where local_key = 'B120300001'`);
    expect(printerSettings.rows).toEqual([{ paper_width: "58mm", resolution: "203dpi" }]);

    const fiscal = ALL_MODULES.find((module) => module.fiscal?.id === "verifactu")!.fiscal!;
    const origin = deviceOrigin(await seedSessionDevice(targetSuite.db));
    await withTransaction(targetSuite.db, (tx) =>
      recordSale(
        tx,
        fiscal.makeBackend({ db: targetSuite.db, clock: systemClock(), environment: "production" }),
        {
          operationDescription: "Restaurant",
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
    await withTransaction(suite.db, (tx) =>
      saveMenuSettings(tx, { defaultProductVatClass: "zero" }),
    );
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-05T12:00:00Z"),
      versions,
    );
    expect(transferred.settings.menu).toEqual({
      version: 1,
      doc: { defaultProductVatClass: "zero", defaultColor: "#abcced", starterUnitsCreated: true },
    });
    await applyVenue(planVenue(venue("B99887766"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    expect((await readSettings(targetSuite.db, MENU_SETTINGS)).doc).toEqual({
      defaultProductVatClass: "zero",
      defaultColor: "#abcced",
      starterUnitsCreated: true,
    });
  });

  it("carries the venue's default colour through export and import", async () => {
    const source = await applyVenue(planVenue(venue("B66778899"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, (tx) => saveMenuDefaultColor(tx, "#b12525"));
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
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
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    expect((await readSettings(targetSuite.db, MENU_SETTINGS)).doc.defaultColor).toBe("#b12525");
  });

  it("carries a category's colour and a product's own colour", async () => {
    const source = await applyVenue(planVenue(venue("B66778899"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const category = await createCategory(tx, { name: "Sweets", color: "#b12525" });
      const product = await createProduct(tx, {
        categoryId: category.id,
        name: "Flan",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      });
      await tx.execute(sql`update products set color = '#256bb1' where id = ${product.id}`);
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
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
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    const imported = await targetSuite.db.execute<{ category: string; product: string }>(sql`
      select d.color as category, p.color as product
      from products p
      join categories d on d.id = p.category_id
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
      const category = await createCategory(tx, { name: "Cakes", color: "#b12525" });
      await createMenu(tx, { name: "Painted menu", color: "#aabbcc" });
      const product = await createProduct(tx, {
        categoryId: category.id,
        name: "Cake",
        pricingUnit: "each",
        unitPrice: "4",
        vatClass: "general",
      });
      await tx.execute(sql`update products set color = '#256bb1' where id = ${product.id}`);
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
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
      categories: repaint("categories", "#b12525"),
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
        beforeCommit: (tx) =>
          importConfigurationTables(tx, bundles.products, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "products.color" } });
    const persisted = await targetSuite.db.execute<{ count: number }>(sql`
      select count(*) as count from taxpayer where tax_id = ${target.taxId}
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
      const menu = await createMenu(tx, { name: "Displayed menu" });
      await tx.execute(
        sql`update menus set till_columns = 8, handheld_order = 'menu_first' where id = ${menu.id}`,
      );
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
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
      from menus d
      where d.name = 'Displayed menu'
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
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    expect((await homeDisplayOf(targetSuite.db)).rows).toEqual([expected]);
  });

  it("refuses a bundle whose display setting a save would refuse", async () => {
    const { transferred, versions } = await bundleWithHomeDisplay("B44556603");
    const details = transferred.tables.menus!;
    expect(details.filter((row) => row.till_columns === 8)).toHaveLength(1);
    const malformed: ConfigurationBundle = {
      ...transferred,
      tables: {
        ...transferred.tables,
        menus: details.map((row) => (row.till_columns === 8 ? { ...row, till_columns: 11 } : row)),
      },
    };
    const refusal = {
      code: "setup.request_invalid",
      params: { field: "menus.till_columns" },
    };
    const target = venue("B44556604");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, malformed, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ count: number }>(sql`
      select count(*) as count from taxpayer where tax_id = ${target.taxId}
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
    const menu = await createMenu(tx, { name: "Modifier menu" });
    const product = await createProduct(tx, {
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    // The extra is a product in its own right, and not sold on its own.
    const shot = await createProduct(tx, {
      categoryId: null,
      name: "Coffee extra",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      ordering: "not_sold_separately",
    });
    const optionList = await createOptionList(
      tx,
      {
        name: "Milk",
        customerName: null,
        kitchenName: null,
        defaultLabelId: null,
        active: true,
        labels: [
          { name: "Whole", customerName: null, kitchenName: null, available: true },
          { name: "Oat", customerName: null, kitchenName: null, available: true },
        ],
      },
      "es",
    );
    const withDefault = await updateOptionList(
      tx,
      optionList.id,
      {
        name: "Milk",
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
      categoryId: null,
      name: "Tea",
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
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
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
    expect(imported.defaultLabelId).toBe(imported.labels.find((label) => label.name === "Oat")!.id);

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
      sql`select ordering from products where name = 'Coffee extra'`,
    );
    expect(shot.rows).toEqual([{ ordering: "not_sold_separately" }]);

    const menus = await tx.execute<{ id: string }>(
      sql`select id from menus where name = 'Modifier menu'`,
    );
    const offers = await listMenuOffers(tx, [menus.rows[0]!.id]);
    const coffee = offers.find((offer) => offer.name === "Coffee")!;
    expect(coffee.grossPrice).toBe("2.75");
    expect(offers.find((offer) => offer.name === "Tea")).toMatchObject({
      grossPrice: null,
      unitPrice: "1.80",
    });
    // The product's own attachment ORDER, and the offer's republished price on the extra.
    expect(coffee.offeredModifiers.map((entry) => [entry.kind, entry.name])).toEqual([
      ["extras", "Extras"],
      ["options", "Milk"],
    ]);
    const extras = coffee.offeredModifiers[0]!;
    if (extras.kind !== "extras") throw new Error("expected the extras list first");
    expect(extras.items.map((item) => item.price)).toEqual(["0.90"]);
  });
});

it("transfers set-menu terms, course choices, dish overrides and variant exclusions", async () => {
  const source = await applyVenue(planVenue(venue("B55667788"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Lunch special" });
    const dish = await createProduct(tx, {
      categoryId: null,
      name: "Soup",
      pricingUnit: "each",
      unitPrice: "6.00",
      vatClass: "reduced",
    });
    const { rootSectionId } = await readMenuStructure(tx, menu.id);
    await addMember(tx, rootSectionId, { kind: "product", productId: dish.id });
    const [offer] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.menuId, menu.id));
    await tx.insert(products).values({ id: "cup", parentId: dish.id, name: "Cup" });
    await tx.insert(kitchenCourses).values({ id: "starter", name: "Starters" });
    await tx.execute(sql`
      update menus set kind = 'set_menu', set_price = 1400, set_vat_class = 'reduced'
      where id = ${menu.id}
    `);
    await tx.execute(sql`
      insert into set_menu_lines (id, menu_id, position, count) values ('line', ${menu.id}, 0, 2)
    `);
    await tx.execute(sql`
      insert into set_menu_line_courses (line_id, course_id) values ('line', 'starter')
    `);
    await tx.execute(sql`
      insert into set_menu_dish_courses (menu_item_id, course_id) values (${offer!.id}, 'starter')
    `);
    await tx.execute(sql`
      insert into set_menu_variant_exclusions (menu_item_id, product_id, variant_id)
      values (${offer!.id}, ${dish.id}, 'cup')
    `);
    return { menuId: menu.id, itemId: offer!.id, productId: dish.id };
  });

  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const bundle = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-11-18T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B88776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, bundle, ALL_MODULES, versions),
  });
  const { rows } = await targetSuite.db.execute(sql`
    select menus.id as menu_id, menus.kind, menus.set_price, menus.set_vat_class,
           line.id as line_id, line.count, course.id as course_id, course.name as course,
           menu_items.id as item_id, dish.id as product_id, dish.name as dish,
           variant.id as variant_id, variant.name as excluded_variant
    from menus
    join set_menu_lines line on line.menu_id = menus.id
    join set_menu_line_courses choice on choice.line_id = line.id
    join kitchen_courses course on course.id = choice.course_id
    join menu_items on menu_items.menu_id = menus.id
    join set_menu_dish_courses override on override.menu_item_id = menu_items.id and override.course_id = course.id
    join set_menu_variant_exclusions excluded on excluded.menu_item_id = menu_items.id
    join products dish on dish.id = excluded.product_id
    join products variant on variant.id = excluded.variant_id
    where menus.name = 'Lunch special'
  `);
  expect(rows).toEqual([
    {
      menu_id: expect.any(String),
      kind: "set_menu",
      set_price: 1400,
      set_vat_class: "reduced",
      line_id: expect.any(String),
      count: 2,
      course_id: expect.any(String),
      course: "Starters",
      item_id: expect.any(String),
      product_id: expect.any(String),
      dish: "Soup",
      variant_id: expect.any(String),
      excluded_variant: "Cup",
    },
  ]);
  expect(rows[0]!.menu_id).not.toBe(original.menuId);
  expect(rows[0]!.line_id).not.toBe("line");
  expect(rows[0]!.course_id).not.toBe("starter");
  expect(rows[0]!.item_id).not.toBe(original.itemId);
  expect(rows[0]!.product_id).not.toBe(original.productId);
  expect(rows[0]!.variant_id).not.toBe("cup");
});

it("transfers sections and their members, remapping ids, with a section's image", async () => {
  const photo = await samplePreparedImage({ width: 8 });
  const source = await applyVenue(planVenue(venue("B55667788"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { es: "Bebidas" } }, {});
    const menu = await createMenu(tx, { name: "Sections menu" });
    const water = await createProduct(tx, {
      categoryId: null,
      name: "Still water",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
    const drinksMenu = await createMenu(tx, {
      name: "Drinks (internal)",
      names: { es: "Bebidas" },
      image: image.filename,
      color: "#aabbcc",
    });
    const drinks = await readSection(
      tx,
      (await readMenuStructure(tx, drinksMenu.id)).rootSectionId,
    );
    await createSectionIn(tx, drinks.id, { internalName: "Beers" });
    await addMember(tx, drinks.id, { kind: "product", productId: water.id }, 0);
    const { rootSectionId } = await readMenuStructure(tx, menu.id);
    await addMember(tx, rootSectionId, { kind: "section", sectionId: drinks.id });
    return { drinks: drinks.id, image: image.filename };
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-25T12:00:00Z"),
    versions,
  );
  // Three menu shells and Drinks' own Beer section.
  expect(transferred.tables.sections).toHaveLength(7);
  expect(transferred.tables.menus).toHaveLength(3);
  expect(transferred.tables.section_members).toHaveLength(3);
  await applyVenue(planVenue(venue("B88776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const [importedDrinks] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(eq(menus.name, "Drinks (internal)"));
    const drinks = await readSection(
      tx,
      (await readMenuStructure(tx, importedDrinks!.id)).rootSectionId,
    );
    const [beer] = await tx.select().from(sections).where(eq(sections.internalName, "Beers"));
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
      .where(eq(products.name, "Still water"));
    expect(drinks!.members.map((member) => member.ref)).toEqual([
      { kind: "product", productId: product!.id },
      { kind: "section", sectionId: beer!.id },
    ]);
    const [menu] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(eq(menus.name, "Sections menu"));
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
    const lunch = await createMenu(tx, { name: "Folder lunch" });
    const drinks = await createMenu(tx, { name: "Drinks (staff)", names: { es: "Bebidas" } });
    const desserts = await createMenu(tx, { name: "Desserts (staff)" });
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
      .set({ ...columnsFromOverrides(overrides) })
      .where(eq(sectionMembers.id, folder.id));
    await tx
      .update(sectionMembers)
      .set({ showAsFolder: false, ...columnsFromOverrides({ image: null }) })
      .where(eq(sectionMembers.id, direct.id));
    return overrides;
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const included = await tx
      .select({
        staffName: menus.name,
        showAsFolder: sectionMembers.showAsFolder,
        folderNames: sectionMembers.folderNames,
        folderImage: sectionMembers.folderImage,
        folderImageFixed: sectionMembers.folderImageFixed,
        folderColor: sectionMembers.folderColor,
        folderColorFixed: sectionMembers.folderColorFixed,
      })
      .from(sectionMembers)
      .innerJoin(sections, eq(sections.id, sectionMembers.childSectionId))
      .innerJoin(menus, eq(menus.id, sections.ownerMenuId))
      .where(eq(sections.role, "menu_root"))
      .orderBy(menus.name);
    expect(
      included.map((row) => ({
        staffName: row.staffName,
        showAsFolder: row.showAsFolder,
        overrides: overridesFromRow(row),
      })),
    ).toEqual([
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
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
      beforeCommit: (tx) => importConfigurationTables(tx, stale, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "table:media_images" },
  });
  const invented = {
    ...transferred,
    tables: { ...transferred.tables, media_images: [{ ...row, caption: "Bread" }] },
  };
  await expect(
    applyVenue(planVenue(venue("B77665544"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, invented, ALL_MODULES, versions),
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
      const menu = await createMenu(tx, { name: "Published menu" });
      const lemonade = await createProduct(tx, {
        categoryId: null,
        name: "Lemonade",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "reduced",
        image: image.filename,
      });
      const { rootSectionId } = await readMenuStructure(tx, menu.id);
      await addMember(tx, rootSectionId, { kind: "product", productId: lemonade.id });
      await seedPerson(tx, { id: "source-admin", displayName: "Test source-admin" });
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
          .update(menuReleases)
          .set({ versionId: old!.id })
          .where(eq(menuReleases.menuId, menu.id));
      }
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-09-26T12:00:00Z"),
      versions,
    );
    for (const table of ["menu_versions", "menu_releases", "menu_version_images"])
      expect(Object.keys(transferred.tables)).not.toContain(table);
    await applyVenue(planVenue(venue("B44332211"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    await withTransaction(targetSuite.db, async (tx) => {
      const [menu] = await tx
        .select({ id: menus.id })
        .from(menus)
        .where(eq(menus.name, "Published menu"));
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

it("transfers the adjustment reasons with their limits and order", async () => {
  const source = await applyVenue(planVenue(venue("B55667788"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const prepared = await withTransaction(suite.db, async (tx) => {
    const policy = {
      names: { en: "Guest complaint", es: "Queja" },
      kind: "comp" as const,
      actions: ["comp", "discount_percent"] as ("comp" | "discount_percent")[],
      maxPercentBp: null,
      maxAmount: decimal("30.00"),

      noteRequired: true,
    };
    await createAdjustmentReason(tx, { ...policy, name: "Guest complaint" });
    return listAdjustmentReasons(tx);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-26T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.adjustment_reasons).toHaveLength(10);
  await applyVenue(planVenue(venue("B88776655"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, (tx) => listAdjustmentReasons(tx));
  // The import gives each row a new id, so ids are left out of the comparison.
  const withoutId = (reasons: typeof imported) =>
    reasons.map((reason) => ({ ...reason, id: undefined }));
  expect(withoutId(imported)).toEqual(withoutId(prepared));
});

/** A starter venue's bundle, its reason rows as the export writes them. */
async function starterReasonsBundle(taxId: string, change?: (tx: Transaction) => Promise<void>) {
  const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  if (change !== undefined) await withTransaction(suite.db, change);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-19T12:00:00Z"),
    versions,
  );
  const encoded = transferred.tables.adjustment_reasons!.map((row) => [
    row.kind,
    row.note_required,
  ]);
  return { transferred, versions, encoded };
}

it("imports a starter venue's reasons, which keep a Void reason asking for a note", async () => {
  const { transferred, versions, encoded } = await starterReasonsBundle("B19283746");
  expect(encoded).toEqual([
    ["void", 0],
    ["void", 0],
    ["void", 0],
    ["void", 0],
    ["void", 1],
    ["comp", 0],
    ["comp", 0],
    ["comp", 0],
    ["comp", 0],
  ]);
  await applyVenue(planVenue(venue("B19283747"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, (tx) => listAdjustmentReasons(tx));
  expect(imported.filter((reason) => reason.kind === "void" && reason.noteRequired)).toHaveLength(
    1,
  );
});

it("refuses a bundle whose only Void reason asking for a note cannot cancel", async () => {
  const { transferred, versions } = await starterReasonsBundle("B19283750", async (tx) => {
    // Straight to the row: the operations refuse a Void reason that does not cancel.
    await tx
      .update(adjustmentReasons)
      .set({ actions: ["comp"] })
      .where(and(eq(adjustmentReasons.kind, "void"), eq(adjustmentReasons.noteRequired, true)));
  });
  expect(
    transferred.tables
      .adjustment_reasons!.filter((row) => row.kind === "void" && row.note_required === 1)
      .map((row) => row.actions),
  ).toEqual(['["comp"]']);
  const target = venue("B19283751");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "adjustment_reasons.actions" },
  });
  const persisted = await targetSuite.db.execute<{ count: number }>(sql`
    select count(*) as count from taxpayer where tax_id = ${target.taxId}
  `);
  expect(persisted.rows[0]!.count).toBe(0);
});

it("transfers staff roles, who holds them and a painted season week under new ids", async () => {
  const source = await applyVenue(planVenue(venue("B24681390"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Staffed room" });
    const [season] = await tx
      .select({ id: seasons.id })
      .from(seasons)

      .limit(1);
    const [holder] = await seedPersons(tx, { displayName: "Holder", role: "staff", jobRoles: [] });
    const waiter = randomUUID();
    const runner = randomUUID();
    await tx.execute(sql`
      insert into staff_roles (id, name, colour, position)
      values (${waiter}, 'Waiter', 'blue', 0),
             (${runner}, 'Runner', 'green', 1)`);
    await tx.execute(sql`
      insert into person_staff_roles (person_id, staff_role_id) values (${holder!.id}, ${waiter})`);
    const days: string[] = [];
    for (const weekday of [5, 6]) {
      const day = randomUUID();
      days.push(day);
      await tx.execute(sql`
        insert into staffing_days (id, department_id, season_id, weekday)
        values (${day}, ${department.id}, ${season!.id}, ${weekday})`);
      await tx.execute(sql`
        insert into staffing_blocks (id, day_id, staff_role_id, headcount, starts_at, ends_at)
        values (${randomUUID()}, ${day}, ${waiter}, 3, '19:00', '23:30'),
               (${randomUUID()}, ${day}, ${runner}, 1, '20:15', '23:00')`);
    }
    return [department.id, season!.id, holder!.id, waiter, runner, ...days];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    {
      ...source,
      sourceOperatorId: suite.db.all<{ id: string }>(
        sql`select id from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')`,
      )[0]!.id,
    },
    ALL_MODULES,
    new Date("2026-10-14T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.staffing_blocks).toHaveLength(4);
  await applyVenue(planVenue(venue("B42086431"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const baseline = await targetSuite.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.kind, "job_role.member_added"));
  const importedHolder = await targetSuite.db.execute<{ person_id: string; staff_role_id: string }>(
    sql`select person_id, staff_role_id from person_staff_roles where person_id = (select id from persons where display_name = 'Holder')`,
  );
  expect(baseline).toHaveLength(2);
  expect(baseline.filter((row) => row.subjectId === importedHolder.rows[0]!.person_id)).toEqual([
    expect.objectContaining({
      personId: null,
      subjectKind: "person",
      subjectId: importedHolder.rows[0]!.person_id,
      data: { staffRoleId: importedHolder.rows[0]!.staff_role_id, name: "Waiter" },
    }),
  ]);
  expect(await targetSuite.db.select().from(outgoingMail)).toEqual([]);
  const roles = await targetSuite.db.execute(sql`
    select r.name, r.colour, r.position, r.hidden_at, p.display_name as holder
    from staff_roles r
    left join person_staff_roles h on h.staff_role_id = r.id
    left join persons p on p.id = h.person_id
    order by r.position, r.name`);
  expect(roles.rows).toEqual([
    {
      name: STARTER_JOB_ROLE_NAMES.Team.es,
      colour: "grey",
      position: 0,
      holder: "Admin",
      hidden_at: null,
    },
    {
      name: "Waiter",
      colour: "blue",
      position: 0,
      holder: "Holder",
      hidden_at: null,
    },
    { name: "Runner", colour: "green", position: 1, holder: null, hidden_at: null },
  ]);
  const week = await targetSuite.db.execute(sql`
    select d.id as day_id, d.department_id, d.season_id, h.person_id, b.staff_role_id,
      dep.name as department, d.weekday, d.station_id,
      d.special_day_date_id, r.name as role, b.headcount, b.starts_at, b.ends_at
    from staffing_days d
    join departments dep on dep.id = d.department_id
    join seasons s on s.id = d.season_id
    join staffing_blocks b on b.day_id = d.id
    join staff_roles r on r.id = b.staff_role_id
    left join person_staff_roles h on h.staff_role_id = r.id
    order by d.weekday, b.starts_at`);
  const block = (weekday: number, role: string, headcount: number, from: string, to: string) => ({
    day_id: expect.any(String),
    department_id: expect.any(String),
    season_id: expect.any(String),
    person_id: role === "Waiter" ? expect.any(String) : null,
    staff_role_id: expect.any(String),
    department: "Staffed room",

    weekday,
    station_id: null,
    special_day_date_id: null,
    role,
    headcount,
    starts_at: from,
    ends_at: to,
  });
  expect(week.rows).toEqual([
    block(5, "Waiter", 3, "19:00", "23:30"),
    block(5, "Runner", 1, "20:15", "23:00"),
    block(6, "Waiter", 3, "19:00", "23:30"),
    block(6, "Runner", 1, "20:15", "23:00"),
  ]);
  for (const row of week.rows)
    for (const key of ["day_id", "department_id", "season_id", "person_id", "staff_role_id"])
      expect(original).not.toContain(row[key]);
});

it("transfers a station's painted season day and a special day's painted date under new ids", async () => {
  const source = await applyVenue(planVenue(venue("B35792468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });

  const original = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Terrace" });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ name: "Staffed grill" })
      .returning({ id: kitchenStations.id });
    const [season] = await tx
      .select({ id: seasons.id })
      .from(seasons)

      .limit(1);
    const cook = randomUUID();
    const specialDay = randomUUID();
    const date = randomUUID();
    const stationDay = randomUUID();
    const dateDay = randomUUID();
    // Raw: apps/server does not depend on @waitron/staffing.
    await tx.execute(sql`
      insert into staff_roles (id, name, colour, position)
      values (${cook}, 'Cook', 'red', 0)`);
    await tx.execute(sql`
      insert into special_days (id, name) values (${specialDay}, 'Feast day')`);
    await tx.execute(sql`
      insert into special_day_dates (id, special_day_id, date)
      values (${date}, ${specialDay}, '2027-08-03')`);
    await tx.execute(sql`
      insert into staffing_days (id, station_id, season_id, weekday)
      values (${stationDay}, ${station!.id}, ${season!.id}, 2)`);
    await tx.execute(sql`
      insert into staffing_days (id, department_id, special_day_date_id)
      values (${dateDay}, ${department.id}, ${date})`);
    await tx.execute(sql`
      insert into staffing_blocks (id, day_id, staff_role_id, headcount, starts_at, ends_at)
      values (${randomUUID()}, ${stationDay}, ${cook}, 2, '12:00', '16:00'),
             (${randomUUID()}, ${dateDay}, ${cook}, 4, '19:00', '23:45')`);
    return [department.id, station!.id, season!.id, cook, specialDay, date, stationDay, dateDay];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-14T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.staffing_days).toHaveLength(2);
  await applyVenue(planVenue(venue("B53197428"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });

  const days = await targetSuite.db.execute(sql`
    select d.id as day_id, d.department_id, d.station_id, d.season_id, d.special_day_date_id,
      b.staff_role_id, dep.name as department, st.name as station,
      d.weekday, sd.date, sp.name as special_day,
      r.name as role, b.headcount, b.starts_at, b.ends_at
    from staffing_days d
    left join departments dep on dep.id = d.department_id
    left join kitchen_stations st on st.id = d.station_id
    left join seasons s on s.id = d.season_id
    left join special_day_dates sd on sd.id = d.special_day_date_id
    left join special_days sp on sp.id = sd.special_day_id
    join staffing_blocks b on b.day_id = d.id
    join staff_roles r on r.id = b.staff_role_id
    order by b.starts_at`);
  expect(days.rows).toEqual([
    {
      day_id: expect.any(String),
      department_id: null,
      station_id: expect.any(String),
      season_id: expect.any(String),
      special_day_date_id: null,
      staff_role_id: expect.any(String),
      department: null,
      station: "Staffed grill",

      weekday: 2,
      date: null,
      special_day: null,

      role: "Cook",
      headcount: 2,
      starts_at: "12:00",
      ends_at: "16:00",
    },
    {
      day_id: expect.any(String),
      department_id: expect.any(String),
      station_id: null,
      season_id: null,
      special_day_date_id: expect.any(String),
      staff_role_id: expect.any(String),
      department: "Terrace",
      station: null,

      weekday: null,
      date: "2027-08-03",
      special_day: "Feast day",

      role: "Cook",
      headcount: 4,
      starts_at: "19:00",
      ends_at: "23:45",
    },
  ]);
  for (const row of days.rows)
    for (const key of [
      "day_id",
      "department_id",
      "station_id",
      "season_id",
      "special_day_date_id",
      "staff_role_id",
    ])
      if (row[key] !== null) expect(original).not.toContain(row[key]);
});

it("transfers the venue's limit on a bill's comps and who approves past it", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const settings = {
    maxBillComp: decimal("40.00"),
  };
  await withTransaction(suite.db, async (tx) =>
    saveAdjustmentSettings(tx, settings, {
      expectedRevision: (await readAdjustmentSettings(tx)).revision,
      personId: null,
    }),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  expect(await withTransaction(targetSuite.db, readAdjustmentSettings)).toEqual({
    ...settings,
    revision: 1,
  });
});

it("transfers a department's receipt logo with its image and pictures, and the imported receipt prints it", async () => {
  const photo = await samplePreparedImage({ width: 10 });
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const logo = await withTransaction(suite.db, async (tx) => {
    const { image } = await uploadImage(tx, { image: photo, names: { es: "Logo" } }, {});
    return image.filename;
  });
  const { writeDepartmentReceipt, readDepartmentReceipt, readPrintedDepartmentReceipt } =
    await import("@waitron/venue-service");
  const cfg = { receiptLanguages: ["es-ES"] };
  const pictures = await drawLogoRasters(photo.bytes);
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Logo receipt" });
    await writeDepartmentReceipt(tx, department.id, { logo }, pictures);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-09-30T12:00:00Z"),
    versions,
  );

  expect(transferred.tables).not.toHaveProperty("tenant_receipts");
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const printed = async (db: typeof suite.db) =>
    withTransaction(db, async (tx) => {
      const [department] = await tx
        .select()
        .from(departments)
        .where(eq(departments.name, "Logo receipt"));
      return {
        receipt: await readDepartmentReceipt(tx, cfg, department!.id),
        narrow: (await readPrintedDepartmentReceipt(tx, cfg, department!.id, "58mm")).logo,
        wide: (await readPrintedDepartmentReceipt(tx, cfg, department!.id, "80mm")).logo,
        image: (await readImageBytes(tx, logo)) !== null,
      };
    });
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
      name: "Pass",
      showsRestOfOrder: true,
    }),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-01T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toContainEqual(
    expect.objectContaining({ name: "Pass", shows_rest_of_order: 1 }),
  );
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ showsRestOfOrder: kitchenStations.showsRestOfOrder })
    .from(kitchenStations)
    .where(eq(kitchenStations.name, "Pass"));
  expect(imported).toEqual([{ showsRestOfOrder: true }]);
});

it("transfers each station's MOVED slips choice, print, don't print, or never set", async () => {
  const source = await applyVenue(planVenue(venue("B13572469"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values([
      { name: "Moved print", printMovedSlips: true },
      { name: "Moved quiet", printMovedSlips: false },
      { name: "Moved unset", printMovedSlips: null },
    ]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-01T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ name: kitchenStations.name, printMovedSlips: kitchenStations.printMovedSlips })
    .from(kitchenStations)
    .where(inArray(kitchenStations.name, ["Moved print", "Moved quiet", "Moved unset"]))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { name: "Moved print", printMovedSlips: true },
    { name: "Moved quiet", printMovedSlips: false },
    { name: "Moved unset", printMovedSlips: null },
  ]);
});

it("transfers a station's colour", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values({
      name: "Cocktail bar",
      colour: "teal",
    }),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-01T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toContainEqual(
    expect.objectContaining({ name: "Cocktail bar", colour: "teal" }),
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ colour: kitchenStations.colour })
    .from(kitchenStations)
    .where(eq(kitchenStations.name, "Cocktail bar"));
  expect(imported).toEqual([{ colour: "teal" }]);
});

it("transfers each station's ticket grouping and held printing", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values([
      {
        name: "Grill",
        ticketGrouping: "separate",
        printHeldWork: true,
      },
      {
        name: "Cold",
        ticketGrouping: "combined",
        printHeldWork: false,
      },
    ]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Grill", ticket_grouping: "separate", print_held_work: 1 }),
      expect.objectContaining({ name: "Cold", ticket_grouping: "combined", print_held_work: 0 }),
    ]),
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({
      name: kitchenStations.name,
      ticketGrouping: kitchenStations.ticketGrouping,
      printHeldWork: kitchenStations.printHeldWork,
    })
    .from(kitchenStations)
    .where(inArray(kitchenStations.name, ["Grill", "Cold"]))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { name: "Cold", ticketGrouping: "combined", printHeldWork: false },
    { name: "Grill", ticketGrouping: "separate", printHeldWork: true },
  ]);
});

it("refuses an imported ticket grouping outside the two values before writing anything", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  const station = transferred.tables.kitchen_stations![0]!;
  station.ticket_grouping = "bogus";
  await expect(
    applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "kitchen_stations.ticket_grouping" },
  });
  expect((await targetSuite.db.execute(sql`select count(*) as n from taxpayer`)).rows).toEqual([
    { n: 0 },
  ]);
  expect(
    (await targetSuite.db.execute(sql`select count(*) as n from kitchen_stations`)).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    await targetSuite.db
      .select({ name: kitchenStations.name })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, String(station.name))),
  ).toEqual([]);
});

it("transfers each station's bump mode", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values([
      { name: "Grill", bumpMode: "ticket" },
      { name: "Cold", bumpMode: "line" },
    ]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Grill", bump_mode: "ticket" }),
      expect.objectContaining({ name: "Cold", bump_mode: "line" }),
    ]),
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ name: kitchenStations.name, bumpMode: kitchenStations.bumpMode })
    .from(kitchenStations)
    .where(inArray(kitchenStations.name, ["Grill", "Cold"]))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { name: "Cold", bumpMode: "line" },
    { name: "Grill", bumpMode: "ticket" },
  ]);
});

it("transfers each station's ready warning time", async () => {
  const source = await applyVenue(planVenue(venue("B13572960"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx
      .insert(kitchenStations)
      .values([{ name: "Grill", readyWarningAfterMinutes: 6 }, { name: "Cold" }]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-26T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Grill", ready_warning_after_minutes: 6 }),
      expect.objectContaining({ name: "Cold", ready_warning_after_minutes: 3 }),
    ]),
  );
  await applyVenue(planVenue(venue("B97531960"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({
      name: kitchenStations.name,
      readyWarningAfterMinutes: kitchenStations.readyWarningAfterMinutes,
    })
    .from(kitchenStations)
    .where(inArray(kitchenStations.name, ["Grill", "Cold"]))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { name: "Cold", readyWarningAfterMinutes: 3 },
    { name: "Grill", readyWarningAfterMinutes: 6 },
  ]);
});

it("refuses an imported bump mode outside the two values before writing anything", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  const station = transferred.tables.kitchen_stations![0]!;
  station.bump_mode = "bogus";
  await expect(
    applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "kitchen_stations.bump_mode" },
  });
  expect((await targetSuite.db.execute(sql`select count(*) as n from taxpayer`)).rows).toEqual([
    { n: 0 },
  ]);
  expect(
    (await targetSuite.db.execute(sql`select count(*) as n from kitchen_stations`)).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    await targetSuite.db
      .select({ name: kitchenStations.name })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, String(station.name))),
  ).toEqual([]);
});

it("transfers each station's changes after sending", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values([
      { name: "Grill", changesAfterSending: "never" },
      { name: "Cold", changesAfterSending: "held" },
    ]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Grill", changes_after_sending: "never" }),
      expect.objectContaining({ name: "Cold", changes_after_sending: "held" }),
    ]),
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({
      name: kitchenStations.name,
      changesAfterSending: kitchenStations.changesAfterSending,
    })
    .from(kitchenStations)
    .where(inArray(kitchenStations.name, ["Grill", "Cold"]))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { name: "Cold", changesAfterSending: "held" },
    { name: "Grill", changesAfterSending: "never" },
  ]);
});

it("refuses an imported changes after sending outside the three values before writing anything", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  const station = transferred.tables.kitchen_stations![0]!;
  station.changes_after_sending = "bogus";
  await expect(
    applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "kitchen_stations.changes_after_sending" },
  });
  expect((await targetSuite.db.execute(sql`select count(*) as n from taxpayer`)).rows).toEqual([
    { n: 0 },
  ]);
  expect(
    (await targetSuite.db.execute(sql`select count(*) as n from kitchen_stations`)).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    await targetSuite.db
      .select({ name: kitchenStations.name })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, String(station.name))),
  ).toEqual([]);
});

it("A773 station policy: transfers each station's pass waiting", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values([
      { name: "Grill", waitsForPass: true },
      { name: "Cold", waitsForPass: false },
    ]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Grill", waits_for_pass: 1 }),
      expect.objectContaining({ name: "Cold", waits_for_pass: 0 }),
    ]),
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ name: kitchenStations.name, waitsForPass: kitchenStations.waitsForPass })
    .from(kitchenStations)
    .where(inArray(kitchenStations.name, ["Grill", "Cold"]))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { name: "Cold", waitsForPass: false },
    { name: "Grill", waitsForPass: true },
  ]);
});

it("A773 station policy: a copy without waits_for_pass imports every station not waiting", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    tx.insert(kitchenStations).values([
      { name: "Grill", waitsForPass: true },
      { name: "Cold", waitsForPass: false },
    ]),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  for (const row of transferred.tables.kitchen_stations!) delete row.waits_for_pass;
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ name: kitchenStations.name, waitsForPass: kitchenStations.waitsForPass })
    .from(kitchenStations)
    .orderBy(kitchenStations.name);
  expect(imported.map((station) => station.name)).toEqual(
    expect.arrayContaining(["Cold", "Grill"]),
  );
  expect(imported.every((station) => station.waitsForPass === false)).toBe(true);
});

it("A773 station policy: refuses an imported waits_for_pass outside 0 and 1 before writing anything", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-23T12:00:00Z"),
    versions,
  );
  const station = transferred.tables.kitchen_stations![0]!;
  station.waits_for_pass = "yes";
  await expect(
    applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "kitchen_stations.waits_for_pass" },
  });
  expect((await targetSuite.db.execute(sql`select count(*) as n from taxpayer`)).rows).toEqual([
    { n: 0 },
  ]);
  expect(
    (await targetSuite.db.execute(sql`select count(*) as n from kitchen_stations`)).rows,
  ).toEqual([{ n: 0 }]);
});

it("A725 allocates omitted imported colours after reserving explicit colours later in the bundle", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(kitchenStations).values([
      { name: "Desserts", colour: "orange", warmAfterMinutes: 7 },
      { name: "Pastry", colour: "amber" },
      { name: "Bar", colour: "blue" },
    ]);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-17T10:00:00Z"),
    versions,
  );
  const rows = transferred.tables.kitchen_stations!;
  const missing = ["Desserts", "Pastry"].map((name) => rows.find((row) => row.name === name)!);
  for (const row of missing) delete row.colour;
  transferred.tables.kitchen_stations = [
    ...missing,
    ...rows.filter((row) => !missing.includes(row)),
  ];
  const before = structuredClone(transferred);
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      colour: kitchenStations.colour,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .orderBy(kitchenStations.name);
  expect(imported.map(({ name, colour, isDefault }) => ({ name, colour, isDefault }))).toEqual([
    { name: "Bar", colour: "blue", isDefault: false },
    { name: "Cocina", colour: "red", isDefault: true },
    { name: "Desserts", colour: "orange", isDefault: false },
    { name: "Pastry", colour: "amber", isDefault: false },
  ]);
  const sourceIds = new Set(rows.map((row) => row.id));
  expect(imported.every((row) => !sourceIds.has(row.id))).toBe(true);
  expect(
    await targetSuite.db
      .select({ name: kitchenStations.name, warm: kitchenStations.warmAfterMinutes })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Desserts")),
  ).toEqual([{ name: "Desserts", warm: 7 }]);
  expect(transferred).toEqual(before);
});

it.each([null, [], {}, 1, false, "invalid-colour"])(
  "A725 refuses invalid imported station colour %j without retaining venue rows",
  async (colour) => {
    const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-17T10:00:00Z"),
      versions,
    );
    transferred.tables.kitchen_stations![0]!.colour = colour;
    await expect(
      applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "kitchen_stations.colour" },
    });
    expect((await targetSuite.db.execute(sql`select count(*) as n from taxpayer`)).rows).toEqual([
      { n: 0 },
    ]);
    expect(
      (await targetSuite.db.execute(sql`select count(*) as n from kitchen_stations`)).rows,
    ).toEqual([{ n: 0 }]);
  },
);

describe("custom themes in a configuration copy", () => {
  const lemon = {
    brandColor: "#f2d300",
    brandFix: {},
    background: "neutral",
    corners: "standard",
    logo: null,
    handSet: { light: {}, dark: {} },
    textScale: 100,
    text: {},
  };
  const darkGreen = { ...lemon, brandColor: "#1e5b3a", background: "tinted" };

  async function themedBundle(taxId: string, logo: "none" | "stored" | "redrawn" = "none") {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await suite.db.insert(customThemes).values([
      { name: "Lemon Bar", nameKey: "lemon bar", inUse: null, theme: lemon },
      { name: "Green Room", nameKey: "green room", inUse: 1, theme: darkGreen },
    ]);
    if (logo !== "none") {
      const photo = await samplePreparedImage({ width: 10 });
      const image = await withTransaction(
        suite.db,
        async (tx) => (await uploadImage(tx, { image: photo, names: { es: "Logo" } }, {})).image,
      );
      const printedLogo = await drawLogoRasters(
        await renderRendition(photo.bytes, "display", image.framing),
      );
      await suite.db.insert(customThemes).values({
        name: "Logo Bar",
        nameKey: "logo bar",
        inUse: null,
        theme: { ...lemon, logo: { light: image.filename }, printedLogo },
      });
      if (logo === "redrawn") {
        const framing = { x: 2500, y: 7500, zoom: 300 };
        // A plain sample image draws the same dots at any framing, so a wider one stands in.
        const wider = await samplePreparedImage({ width: 23 });
        const redrawn = await drawLogoRasters(
          await renderRendition(wider.bytes, "display", framing),
        );
        expect(redrawn).not.toEqual(printedLogo);
        await withTransaction(suite.db, (tx) =>
          saveImage(
            tx,
            image.id,
            { names: image.names, framing, expectedRevision: image.revision },
            null,
            redrawn,
            "es",
          ),
        );
        const [stored] = await suite.db
          .select({ theme: customThemes.theme })
          .from(customThemes)
          .where(eq(customThemes.name, "Logo Bar"));
        expect(stored!.theme).toMatchObject({ printedLogo: redrawn });
      }
    }
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-21T10:00:00Z"),
      versions,
    );
    return { transferred, versions };
  }

  function importInto(
    taxId: string,
    transferred: ConfigurationBundle,
    versions: Awaited<ReturnType<typeof schemaVersionsByModule>>,
  ) {
    return applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
  }

  async function expectNothingKept(): Promise<void> {
    expect((await targetSuite.db.execute(sql`select count(*) as n from taxpayer`)).rows).toEqual([
      { n: 0 },
    ]);
    expect(
      (await targetSuite.db.execute(sql`select count(*) as n from custom_themes`)).rows,
    ).toEqual([{ n: 0 }]);
  }

  it("carries the custom themes and which one is in use, a hard-to-read one included", async () => {
    const { transferred, versions } = await themedBundle("B13572480");
    await importInto("B97531880", transferred, versions);
    const sourceIds = new Set(
      (await suite.db.select({ id: customThemes.id }).from(customThemes)).map((row) => row.id),
    );
    const imported = await targetSuite.db.select().from(customThemes);
    expect(
      imported
        .map((row) => ({
          name: row.name,
          nameKey: row.nameKey,
          inUse: row.inUse,
          choices: row.theme,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "Green Room", nameKey: "green room", inUse: 1, choices: darkGreen },
      { name: "Lemon Bar", nameKey: "lemon bar", inUse: null, choices: lemon },
    ]);
    expect(imported.every((row) => !sourceIds.has(row.id))).toBe(true);
  });

  it("refuses a copy with two themes in use without keeping venue rows", async () => {
    const { transferred, versions } = await themedBundle("B13572481");
    for (const row of transferred.tables.custom_themes!) row.in_use = 1;
    await expect(importInto("B97531881", transferred, versions)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.in_use" },
    });
    await expectNothingKept();
  });

  function themeRow(transferred: ConfigurationBundle, name: string): Record<string, unknown> {
    const row = transferred.tables.custom_themes!.find((candidate) => candidate.name === name);
    if (row === undefined) throw new Error(`no theme ${name} in the copy`);
    return row;
  }

  function rewriteTheme(
    transferred: ConfigurationBundle,
    name: string,
    change: (theme: Record<string, unknown>) => void,
  ): void {
    const row = themeRow(transferred, name);
    const theme = JSON.parse(row.theme as string) as Record<string, unknown>;
    change(theme);
    row.theme = JSON.stringify(theme);
  }

  it("carries a theme's logo and its printed dots", async () => {
    const { transferred, versions } = await themedBundle("B13572483", "stored");
    await importInto("B97531883", transferred, versions);
    const [source] = await suite.db
      .select({ theme: customThemes.theme })
      .from(customThemes)
      .where(eq(customThemes.name, "Logo Bar"));
    const [imported] = await targetSuite.db
      .select({ id: customThemes.id, theme: customThemes.theme })
      .from(customThemes)
      .where(eq(customThemes.name, "Logo Bar"));
    expect(imported!.theme).toEqual(source!.theme);
    expect(imported!.theme).toHaveProperty("printedLogo");
    const filename = (source!.theme as { logo: { light: string } }).logo.light;
    const [image] = await targetSuite.db
      .select({ id: mediaImages.id })
      .from(mediaImages)
      .where(eq(mediaImages.filename, filename));
    const uses = await withTransaction(targetSuite.db, (tx) => listImageUsages(tx, image!.id));
    expect(uses).toEqual([{ kind: "theme_logo", id: imported!.id, name: "Logo Bar" }]);
  });

  it("refuses a copy whose theme names an image it does not carry", async () => {
    const { transferred, versions } = await themedBundle("B13572484", "stored");
    rewriteTheme(transferred, "Logo Bar", (theme) => {
      theme.logo = { light: "f".repeat(64) + ".webp" };
    });
    await expect(importInto("B97531884", transferred, versions)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.theme" },
    });
    await expectNothingKept();
  });

  it("refuses a copy whose theme names a logo without its printed dots", async () => {
    const { transferred, versions } = await themedBundle("B13572485", "stored");
    rewriteTheme(transferred, "Logo Bar", (theme) => {
      delete theme.printedLogo;
    });
    await expect(importInto("B97531885", transferred, versions)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.theme" },
    });
    await expectNothingKept();
  });

  it("imports a copied theme with no logo key", async () => {
    const { transferred, versions } = await themedBundle("B13572486");
    rewriteTheme(transferred, "Lemon Bar", (theme) => {
      delete theme.logo;
    });
    await importInto("B97531886", transferred, versions);
    const list = await withTransaction(targetSuite.db, (tx) => listCustomThemes(tx));
    const lemonBar = list.themes.find((theme) => theme.name === "Lemon Bar");
    expect(lemonBar?.choices?.logo).toBeNull();
    expect(lemonBar?.choices).toEqual(lemon);
  });

  it("imports a copied theme with no text size key", async () => {
    const { transferred, versions } = await themedBundle("B13572490");
    rewriteTheme(transferred, "Lemon Bar", (theme) => {
      delete theme.textScale;
    });
    await importInto("B97531890", transferred, versions);
    const list = await withTransaction(targetSuite.db, (tx) => listCustomThemes(tx));
    const lemonBar = list.themes.find((theme) => theme.name === "Lemon Bar");
    expect(lemonBar?.choices?.textScale).toBe(100);
    expect(lemonBar?.choices).toEqual(lemon);
  });

  it("imports a copied theme with no text key", async () => {
    const { transferred, versions } = await themedBundle("B13572491");
    rewriteTheme(transferred, "Lemon Bar", (theme) => {
      delete theme.text;
    });
    await importInto("B97531891", transferred, versions);
    const list = await withTransaction(targetSuite.db, (tx) => listCustomThemes(tx));
    const lemonBar = list.themes.find((theme) => theme.name === "Lemon Bar");
    expect(lemonBar?.choices?.text).toEqual({});
    expect(lemonBar?.choices).toEqual(lemon);
  });

  // JSON.parse reads a repeated key's last value, SQLite's json_extract its first: stored, the
  // venue would show the logo while the image library counted no use of it.
  it.each<[string, (text: string, carried: string) => string, string, string]>([
    [
      "a logo key given twice",
      (text) => text.replace('"logo":{', '"logo":null,"logo":{'),
      "B13572487",
      "B97531887",
    ],
    [
      "a light key given twice",
      (text, carried) =>
        text.replace(
          `"light":"${carried}"`,
          `"light":"${"f".repeat(64)}.webp","light":"${carried}"`,
        ),
      "B13572488",
      "B97531888",
    ],
  ])("refuses a copy whose theme names %s", async (_label, repeat, taxId, targetTaxId) => {
    const { transferred, versions } = await themedBundle(taxId, "stored");
    const row = themeRow(transferred, "Logo Bar");
    const text = row.theme as string;
    const carried = (JSON.parse(text) as { logo: { light: string } }).logo.light;
    row.theme = repeat(text, carried);
    expect(row.theme).not.toBe(text);
    expect(JSON.parse(row.theme as string)).toEqual(JSON.parse(text));
    await expect(importInto(targetTaxId, transferred, versions)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.theme" },
    });
    await expectNothingKept();
  });

  it("carries a theme whose dots the image library redrew", async () => {
    const { transferred, versions } = await themedBundle("B13572489", "redrawn");
    const [source] = (
      await suite.db.execute(sql`select theme from custom_themes where name = 'Logo Bar'`)
    ).rows as { theme: string }[];
    expect(themeRow(transferred, "Logo Bar").theme).toBe(source!.theme);
    await importInto("B97531889", transferred, versions);
    const [imported] = (
      await targetSuite.db.execute(sql`select theme from custom_themes where name = 'Logo Bar'`)
    ).rows as { theme: string }[];
    expect(imported!.theme).toBe(source!.theme);
  });

  it("refuses a copy whose name key is not its name's", async () => {
    const { transferred, versions } = await themedBundle("B13572482");
    transferred.tables.custom_themes![0]!.name_key = "another theme";
    await expect(importInto("B97531882", transferred, versions)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.name_key" },
    });
    await expectNothingKept();
  });
});

it("transfers a printer on two stations in configuration export", async () => {
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const stations = await tx
      .insert(kitchenStations)
      .values([{ name: "Grill" }, { name: "Fryer" }])
      .returning({ id: kitchenStations.id });
    const [printer] = await tx
      .insert(printers)
      .values({
        name: "Pass printer",
        transport: "network_tcp",
        host: "10.0.0.8",
      })
      .returning({ id: printers.id });
    for (const { id } of stations) await attachStationPrinterForTest(tx, id, printer!.id);
  });
  const declared = CORE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
  expect(declared).toContain("kitchen_stations");
  expect(declared).not.toContain("station_printers");
  for (const retired of [
    "watchers",
    "watcher_stations",
    "watcher_zones",
    "watcher_printers",
    "watcher_item_marks",
  ])
    expect(declared).not.toContain(retired);
  expect(declared).not.toContain("devices");
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ station: kitchenStations.name, printer: printers.name })
    .from(stationPrinterPairs)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinterPairs.stationId))
    .innerJoin(printers, eq(printers.id, stationPrinterPairs.printerId))
    .where(eq(printers.name, "Pass printer"))
    .orderBy(kitchenStations.name);
  expect(imported).toEqual([
    { station: "Fryer", printer: "Pass printer" },
    { station: "Grill", printer: "Pass printer" },
  ]);
});

it("transfers a printer's pick-up flags, leaves the holder behind and refuses an invalid flag", async () => {
  const source = await applyVenue(planVenue(venue("B31415920"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const { deviceId } = await seedDevice(tx, {});
    const [printer] = await tx
      .insert(printers)
      .values({
        name: "Slip pickup",
        transport: "network_tcp",
        host: "10.0.0.90",
        portable: true,
        picksUpReceipts: false,
        picksUpPaymentSlips: true,
      })
      .returning({ id: printers.id });
    await holdPrinterForTest(tx, printer!.id, deviceId);
    await insertA4Printer(tx);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-13T10:00:00Z"),
    versions,
  );
  const exportedPrinter = transferred.tables.printers!.find((row) => row.name === "Slip pickup")!;
  expect(exportedPrinter.kind).toBe("receipt");
  expect(transferred.tables.printers).toContainEqual(
    expect.objectContaining({
      kind: "a4",
      name: "Office printer",
      document_format: "application/pdf",
    }),
  );
  expect(exportedPrinter).toMatchObject({ picks_up_receipts: 0, picks_up_payment_slips: 1 });
  expect(exportedPrinter).not.toHaveProperty("held_by_device_id");
  expect(exportedPrinter).not.toHaveProperty("held_at");
  const malformed = {
    ...transferred,
    tables: {
      ...transferred.tables,
      printers: transferred.tables.printers!.map((row) => ({
        ...row,
        picks_up_payment_slips: 2,
      })),
    },
  };
  expect(() => validateConfigurationBundle(malformed, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "printers.picks_up_payment_slips" },
    }),
  );
  await applyVenue(planVenue(venue("B27182810"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const [office] = await targetSuite.db.select().from(printers).where(eq(printers.kind, "a4"));
  expect(office).toMatchObject({
    name: "Office printer",
    transport: "ipp",
    active: false,
    agentId: null,
    documentFormat: "application/pdf",
    resourcePath: "/ipp/print",
  });
  const imported = await targetSuite.db
    .select({
      name: printers.name,
      picksUpReceipts: printers.picksUpReceipts,
      picksUpPaymentSlips: printers.picksUpPaymentSlips,
      heldByDeviceId: printers.heldByDeviceId,
      heldAt: printers.heldAt,
    })
    .from(printers)
    .where(eq(printers.name, "Slip pickup"));
  expect(imported).toEqual([
    {
      name: "Slip pickup",
      picksUpReceipts: false,
      picksUpPaymentSlips: true,
      heldByDeviceId: null,
      heldAt: null,
    },
  ]);
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
          name,
          transport: "network_tcp" as const,
          host: `10.0.1.${index + 1}`,
        })),
      )
      .returning({ id: printers.id });
    const [profile] = await seedDeviceProfiles(tx, {
      name: "Counter till",
      formFactor: "tablet-landscape",
    });
    await setProfilePrinterLists(tx, profile!.id, {
      ...emptyPrinterLists(),
      receiptPrinterIds: [added[1]!.id, added[0]!.id],
      paymentSlipPrinterIds: [added[2]!.id],
    });
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-04T12:00:00Z"),
    versions,
  );
  expect(transferred.tables).not.toHaveProperty("canvases");
  for (const profile of transferred.tables.device_profiles!)
    expect(profile).not.toHaveProperty("canvas_id");
  await applyVenue(planVenue(venue("B97531867"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
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
      zoneId: [await seedZone(tx, { name: "Clearing tables" })][0]!.id,
      id: "eeeeeeee-bbbb-bbbb-bbbb-eeeeeeeeeeee",
      label: "T9",
    });
    await tx
      .update(diningTables)
      .set({ onFloor: true })
      .where(eq(diningTables.id, "eeeeeeee-bbbb-bbbb-bbbb-eeeeeeeeeeee"));
    await tx.execute(sql`
      update dining_tables set needs_clearing_since = '2026-09-29T10:00:00.000Z'
      where id = 'eeeeeeee-bbbb-bbbb-bbbb-eeeeeeeeeeee'`);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);

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

it("carries a department's Needs clearing switch to the importing venue", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Cleared terrace" });
    await tx
      .update(departments)
      .set({ needsClearing: true })
      .where(eq(departments.id, department.id));
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-19T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B97531864"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const [imported] = await withTransaction(targetSuite.db, (tx) =>
    tx
      .select({ needsClearing: departments.needsClearing })
      .from(departments)
      .where(eq(departments.name, "Cleared terrace")),
  );
  expect(imported).toEqual({ needsClearing: true });
});

describe("a department's late-send manager setting in a configuration transfer", () => {
  it("carries it on the exported departments row and to the importing venue", async () => {
    const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const department = await createDepartment(tx, { name: "Late send terrace" });
      await tx
        .update(departments)
        .set({ lateSendNeedsManager: true })
        .where(eq(departments.id, department.id));
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-19T12:00:00Z"),
      versions,
    );
    const exported = transferred.tables.departments!.find(
      (row) => row.name === "Late send terrace",
    );
    expect(exported?.late_send_needs_manager).toBe(1);
    await applyVenue(planVenue(venue("B97531866"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    const [imported] = await withTransaction(targetSuite.db, (tx) =>
      tx
        .select({ lateSendNeedsManager: departments.lateSendNeedsManager })
        .from(departments)
        .where(eq(departments.name, "Late send terrace")),
    );
    expect(imported).toEqual({ lateSendNeedsManager: true });
  });
});

it("carries a department's course firing and reminder minutes to remapped rows in the importing venue", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Reminded terrace" });
    const [course] = await tx.insert(kitchenCourses).values({ name: "House mains" }).returning();
    await tx.insert(departmentCourses).values({
      departmentId: department.id,
      courseId: course!.id,
      heldUntilFired: false,
      reminderMinutes: 25,
    });
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-19T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B86420975"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const [imported] = await withTransaction(targetSuite.db, (tx) =>
    tx
      .select({
        minutes: departmentCourses.reminderMinutes,
        heldUntilFired: departmentCourses.heldUntilFired,
        course: kitchenCourses.name,
      })
      .from(departmentCourses)
      .innerJoin(departments, eq(departments.id, departmentCourses.departmentId))
      .innerJoin(kitchenCourses, eq(kitchenCourses.id, departmentCourses.courseId))
      .where(and(eq(departments.name, "Reminded terrace"), eq(kitchenCourses.name, "House mains"))),
  );
  expect(imported).toEqual({ minutes: 25, heldUntilFired: false, course: "House mains" });
});

it("leaves out a print agent's node, so the importing venue does not show it as on this box", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, (tx) =>
    selfEnrolNodeAgent(tx, { nodeId: source.nodeId, name: "Source box" }),
  );
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: async (tx) => {
      await importConfigurationTables(tx, transferred, ALL_MODULES, versions);
    },
  });

  const imported = await targetSuite.db
    .select({ name: printAgents.name, nodeId: printAgents.nodeId, active: printAgents.active })
    .from(printAgents);
  expect(imported).toEqual([{ name: "Source box", nodeId: null, active: false }]);

  // The box's own agent still enrols as a new row beside the imported one; had the imported row held
  // this node, self-enrolment would find it inactive and refuse it as revoked.
  await withTransaction(targetSuite.db, (tx) =>
    selfEnrolNodeAgent(tx, { nodeId: target.nodeId, name: "Target box" }),
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
      name: "Bar agent",
      tokenHash: "source-agent-token",
      setupUrl: "http://192.168.10.40:9310",
      setupPort: 9210,
    });
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: async (tx) => {
      await importConfigurationTables(tx, transferred, ALL_MODULES, versions);
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
    const menu = await createMenu(tx, { name: "Missing slots" });
    const root = (await readMenuStructure(tx, menu.id)).rootSectionId;
    const beer = await createSectionIn(tx, root, { internalName: "Beer" });
    const water = await createProduct(tx, {
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
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const [menu] = await tx.select().from(menus).where(eq(menus.name, "Missing slots"));
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
    const [water] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, "Water"));
    expect(preview.warnings).toEqual([
      { kind: "shortcut_missing", name: "Missing slots › Beer" },
      {
        kind: "allergens_unreviewed",
        products: [{ id: water!.id, name: "Water", parentName: null }],
      },
    ]);
  });
});

it("preserves imported product names and refuses their duplicates without stored keys", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const idShaped = await withTransaction(suite.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Keys" });
    const fields = { menuId: menu.id, categoryId: null, pricingUnit: "each" as const };
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
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .select({ name: products.name })
    .from(products)
    .where(inArray(products.name, [" Café Solo ", idShaped]));
  expect(imported).toEqual(expect.arrayContaining([{ name: " Café Solo " }, { name: idShaped }]));
  expect(imported).toHaveLength(2);
  for (const name of ["café solo", idShaped]) {
    await expect(
      withTransaction(targetSuite.db, (tx) =>
        createProduct(tx, {
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
        }),
      ),
    ).rejects.toMatchObject({ code: "product.name_taken" });
  }

  // Unknown columns are refused, including a retired folded-name key.
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
        ALL_MODULES,
        versions,
      ),
    ),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "table:products" },
  });
});

async function shortNamedBundle(taxId: string) {
  const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const cfg: TradingContext = {
    nodeId: nodeId(source.nodeId),
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Short service" });
    const zone = await createServiceZone(tx, {
      name: "Short zone",
      departmentId: department.id,
    });
    await createTable(tx, cfg, { label: "Rt table 1", zoneId: zone.id, shortName: "Rt1" });
    await saveLayout(
      tx,
      enabledTableRemovals(ALL_MODULES),
      await defaultLayout(tx, cfg, zone.id),
      {
        revision: 0,
        tables: [
          {
            key: "rt1",
            label: "Rt table 1",
            shortName: "Rt1",
            fixed: false,
            seats: 2,
            placement: { x: 0, y: 0, width: 8, height: 8, rotation: 0, shape: "rect" },
            partKeys: [],
          },
        ],
      },
      new Date("2026-10-11T12:00:00Z"),
    );
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-11T12:00:00Z"),
    versions,
  );
  return { transferred, versions };
}

async function importedShortNames() {
  return targetSuite.db
    .select({ shortName: diningTables.shortName, shortNameKey: diningTables.shortNameKey })
    .from(diningTables)
    .where(and(eq(diningTables.label, "Rt table 1")));
}

it("carries each table's short name, and the import sets the live table's key from it", async () => {
  const { transferred, versions } = await shortNamedBundle("B16180339");
  const live = transferred.tables.dining_tables!.filter((row) => row.label === "Rt table 1");
  expect(live.map((row) => row.short_name)).toEqual(["Rt1"]);
  for (const row of transferred.tables.dining_tables!)
    expect(row).not.toHaveProperty("short_name_key");
  expect(
    transferred.tables
      .floor_plan_tables!.filter((row) => row.label === "Rt table 1")
      .map((row) => row.short_name),
  ).toEqual(["Rt1"]);

  await applyVenue(planVenue(venue("B14142135"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  expect(await importedShortNames()).toEqual([{ shortName: "Rt1", shortNameKey: "rt1" }]);
  const plan = await targetSuite.db
    .select({ shortName: floorPlanTables.shortName })
    .from(floorPlanTables)
    .where(eq(floorPlanTables.label, "Rt table 1"));
  expect(plan).toEqual([{ shortName: "Rt1" }]);

  await expect(
    withTransaction(targetSuite.db, (tx) =>
      importConfigurationTables(
        tx,
        {
          ...transferred,
          tables: {
            ...transferred.tables,
            dining_tables: transferred.tables.dining_tables!.map((row) => ({
              ...row,
              short_name_key: "wrong",
            })),
          },
        },
        ALL_MODULES,
        versions,
      ),
    ),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "dining_tables.short_name_key" },
  });
});

it("imports a file with no short names, at this version, with none", async () => {
  const { transferred, versions } = await shortNamedBundle("B17320508");
  const withoutShortNames = (rows: readonly Record<string, unknown>[]) =>
    rows.map((row) => {
      const copy = { ...row };
      delete copy.short_name;
      return copy;
    });
  await applyVenue(planVenue(venue("B22360679"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) =>
      importConfigurationTables(
        tx,
        {
          ...transferred,
          tables: {
            ...transferred.tables,
            dining_tables: withoutShortNames(transferred.tables.dining_tables!),
            floor_plan_tables: withoutShortNames(transferred.tables.floor_plan_tables!),
          },
        },
        ALL_MODULES,
        versions,
      ),
  });
  expect(await importedShortNames()).toEqual([{ shortName: null, shortNameKey: null }]);
  const plan = await targetSuite.db
    .select({ shortName: floorPlanTables.shortName })
    .from(floorPlanTables)
    .where(eq(floorPlanTables.label, "Rt table 1"));
  expect(plan).toEqual([{ shortName: null }]);
});

it("keeps a name that equals another row's id, while the ids that point at rows are rewritten", async () => {
  const source = await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Ids" });
    const category = await createCategory(tx, { name: menu.id });
    const product = await createProduct(tx, {
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
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });

  const [menu] = await targetSuite.db
    .select({ id: menus.id })
    .from(menus)
    .where(eq(menus.name, "Ids"));
  const [category] = await targetSuite.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, sourceIds.menu));
  const [product] = await targetSuite.db
    .select({ id: products.id, categoryId: products.categoryId })
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
    categoryId: category!.id,
  });
  expect(variant).toEqual({ parentId: product!.id });
  for (const id of [menu!.id, category!.id, product!.id]) expect(bundleIds.has(id)).toBe(false);

  const policies = await targetSuite.db.execute<{
    zone_id: string;
  }>(sql`select id as zone_id from floor_zones`);
  expect(policies.rows.length).toBeGreaterThan(0);
  const targetMenus = new Set(
    (await targetSuite.db.select({ id: menus.id }).from(menus)).map((row) => row.id),
  );
  for (const policy of policies.rows) {
    expect(bundleIds.has(policy.zone_id)).toBe(false);
  }
  const defaults = await targetSuite.db.execute<{
    menu_id: string;
  }>(sql`select menu_id from menu_periods`);
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
    const category = await createCategory(tx, { name: "Drinks" });
    await createProduct(tx, {
      categoryId: category.id,
      name: "Water",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const clean = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  const category = clean.tables.categories!.find((row) => row.name === "Drinks")!;
  const product = clean.tables.products!.find((row) => row.name === "Water")!;
  const withCategory: ConfigurationBundle = {
    ...clean,
    tables: {
      ...clean.tables,
      categories: [...clean.tables.categories!, { ...category, id: "copy", name: " drinks" }],
    },
  };
  const withProduct: ConfigurationBundle = {
    ...clean,
    tables: {
      ...clean.tables,
      products: [...clean.tables.products!, { ...product, id: "copy", name: "WATER " }],
    },
  };

  expect(() => validateConfigurationBundle(withCategory, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "category.name_taken",
      params: { field: "name", name: "drinks" },
    }),
  );
  expect(() => validateConfigurationBundle(withProduct, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "product.name_taken",
      params: { field: "name", name: "WATER" },
    }),
  );

  const target = venue("B64208642");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, withProduct, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({ code: "product.name_taken" });
  const persisted = await targetSuite.db.execute<{ count: number }>(sql`
    select count(*) as count from taxpayer where tax_id = ${target.taxId}
  `);
  expect(persisted.rows[0]!.count).toBe(0);
});

it("refuses an Inactive product in a menu list and a menu price for an Inactive variant", async () => {
  const source = await applyVenue(planVenue(venue("B31415926"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const ids = await withTransaction(suite.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Inactive rows" });
    const gin = await createProduct(tx, {
      categoryId: null,
      name: "Gin",
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "general",
    });
    const [single] = await setProductVariants(
      tx,
      gin.id,
      [
        {
          name: "Single",
          customerName: { es: "Sencillo" },
          kitchenName: null,
          image: null,
          unitPrice: "5.50",
          available: true,
          active: true,
        },
      ],
      "es",
    );
    const item = await addProductToMenu(tx, { menuId: menu.id, productId: gin.id });
    await setMenuVariantPrice(tx, item.id, single!.id, "6.00", menu.id);
    return { gin: gin.id, single: single!.id };
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const clean = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-07T12:00:00Z"),
    versions,
  );
  expect(clean.tables.section_members!.some((row) => row.product_id === ids.gin)).toBe(true);
  expect(
    clean.tables.menu_item_variant_overrides!.some((row) => row.variant_id === ids.single),
  ).toBe(true);
  expect(() => validateConfigurationBundle(clean, ALL_MODULES, versions)).not.toThrow();
  const inactive = (id: string): ConfigurationBundle => ({
    ...clean,
    tables: {
      ...clean.tables,
      products: clean.tables.products!.map((row) => (row.id === id ? { ...row, active: 0 } : row)),
    },
  });

  expect(() =>
    validateConfigurationBundle(inactive(ids.single), ALL_MODULES, versions),
  ).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "menu_item_variant_overrides.variant_id" },
    }),
  );
  const target = venue("B27182818");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, inactive(ids.gin), ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "section_members.product_id" },
  });
  const persisted = await targetSuite.db.execute<{ count: number }>(sql`
    select count(*) as count from taxpayer where tax_id = ${target.taxId}
  `);
  expect(persisted.rows[0]!.count).toBe(0);
});

it("counts an exported product with no Active flag as Active, as the column stores it", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    await createProduct(tx, {
      categoryId: null,
      name: "Water",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const clean = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  const exported = clean.tables.products!.find((row) => row.name === "Water")!;
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
        { ...flagless, id: "copy", name: "WATER " },
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
      params: { field: "name", name: "WATER" },
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
      beforeCommit: (tx) => importConfigurationTables(tx, withProduct, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({ code: "product.name_taken" });
  const persisted = await targetSuite.db.execute<{ count: number }>(sql`
    select count(*) as count from taxpayer where tax_id = ${target.taxId}
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
async function retireProfile(profileId: string): Promise<void> {
  await seedDevice(suite.db, { profileId });
  await suite.db
    .update(devices)
    .set({ active: false })
    .where(eq(devices.deviceProfileId, profileId));
  await withTransaction(suite.db, async (tx) => {
    const candidates = await tx.select({ id: persons.id }).from(persons);
    let admin: { id: string } | undefined;
    for (const person of candidates) {
      if ((await builtInRoleForTest(tx, person.id)) === "admin") {
        admin = person;
        break;
      }
    }
    const session = await startManagementSession(tx, { method: "password", personId: admin!.id });
    await deleteDeviceProfile(tx, { managementSessionId: session.token, id: profileId });
  });
  const [row] = await suite.db
    .select({ retiredAt: deviceProfiles.retiredAt })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  expect(row?.retiredAt).not.toBeNull();
}

it("leaves a retired receiving profile behind while its department and zone still import", async () => {
  const source = await applyVenue(
    planVenue({ ...venue("B24681357"), name: "Transfer venue" }, ALL_MODULES),
    {
      db: suite.db,
      modules: ALL_MODULES,
    },
  );

  const [retired] = await seedDeviceProfiles(suite.db, { name: "Old till", formFactor: "till" });
  const [department] = await suite.db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.isDefault, true));
  await withTransaction(suite.db, async (tx) => {
    await createServiceZone(tx, { name: "Receiving zone", departmentId: department!.id });
    await tx
      .update(departments)
      .set({ transferDeskProfileId: retired!.id })
      .where(eq(departments.id, department!.id));
  });
  await retireProfile(retired!.id);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.device_profiles!.map((row) => row.name)).not.toContain("Old till");
  expect(transferred.tables.departments).toContainEqual(
    expect.objectContaining({
      id: department!.id,
      name: "Transfer venue",
      transfer_desk_profile_id: null,
    }),
  );
  expect(transferred.tables.floor_zones).toContainEqual(
    expect.objectContaining({
      name: "Receiving zone",
      department_id: department!.id,
    }),
  );
  await applyVenue(planVenue(venue("B86420975"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const names = await targetSuite.db.select({ name: deviceProfiles.name }).from(deviceProfiles);
  expect(names.map((row) => row.name)).not.toContain("Old till");
  expect(
    await targetSuite.db
      .select({ profileId: departments.transferDeskProfileId })
      .from(departments)
      .where(eq(departments.name, "Transfer venue")),
  ).toEqual([{ profileId: null }]);
  expect(
    await targetSuite.db
      .select({ name: floorZones.name })
      .from(floorZones)
      .where(eq(floorZones.name, "Receiving zone")),
  ).toEqual([{ name: "Receiving zone" }]);
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
        name: "Bar printer",
        transport: "network_tcp",
        host: "10.0.2.1",
      })
      .returning({ id: printers.id });
    const [live, retired] = await seedDeviceProfiles(tx, [
      { name: "Handheld", formFactor: "phone-portrait" },
      { name: "Old till", formFactor: "till" },
    ]);
    for (const profile of [live!, retired!]) {
      await setProfilePrinterLists(tx, profile.id, {
        ...emptyPrinterLists(),
        receiptPrinterIds: [printer!.id],
        paymentSlipPrinterIds: [],
      });
    }
    return { live: live!.id, retired: retired!.id };
  });
  await retireProfile(original.retired);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
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

describe("device profile scope round trip (M4)", () => {
  it.each([
    {
      description: "keeps the profile when department deletion is refused",
      hasFallback: false,
      department: true,
    },
    {
      description: "keeps the profile when zone deletion is refused",
      hasFallback: false,
      department: false,
    },
    {
      description: "exports the replacement starting zone after department deletion",
      hasFallback: true,
      department: true,
    },
  ])(
    "$description after moving its starting zone to another department",
    async ({ hasFallback, department }) => {
      const source = await applyVenue(planVenue(venue("B13572476"), ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
      });
      const cfg: TradingContext = {
        nodeId: nodeId(source.nodeId),
        locale: "es-ES",
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      };
      const ids = await withTransaction(suite.db, async (tx) => {
        const home = await createDepartment(tx, { name: "Home department", orderStart: "table" });
        const other = await createDepartment(tx, { name: "Other department", orderStart: "table" });
        const moved = await createServiceZone(tx, { name: "Moved zone", departmentId: home.id });
        const retained = await createServiceZone(tx, {
          name: "Retained zone",
          departmentId: home.id,
        });
        const [desk, remaining] = await seedDeviceProfiles(tx, [
          { name: "Transfer desk", formFactor: "till", capabilities: ["take-orders"] },
          { name: "Remaining till", formFactor: "till", capabilities: ["take-orders"] },
        ]);
        await setProfileServiceScope(tx, desk!.id, {
          departmentId: home.id,
          startingZoneId: moved.id,
          allowedZoneIds: hasFallback ? [moved.id, retained.id] : [moved.id],
        });
        await setProfileServiceScope(tx, remaining!.id, {
          departmentId: home.id,
          startingZoneId: retained.id,
          allowedZoneIds: null,
        });
        await setDepartmentTransferSettings(tx, home.id, {
          receivingProfileId: desk!.id,
          destinationDepartmentIds: [],
        });
        if (hasFallback) await configureZone(tx, { zoneId: moved.id, departmentId: other.id });
        else
          // Exercise deletion with the starting zone already in another department.
          await tx
            .update(floorZones)
            .set({ departmentId: other.id })
            .where(eq(floorZones.id, moved.id));
        return {
          home: home.id,
          other: other.id,
          desk: desk!.id,
          remaining: remaining!.id,
          moved: moved.id,
          retained: retained.id,
        };
      });
      const at = new Date("2026-10-11T12:00:00Z");
      const { floorDeletion } = moduleCoreServices(
        cfg,
        enabledTableRemovals(ALL_MODULES),
        () => at,
      );
      const impact =
        department &&
        (await withTransaction(suite.db, (tx) =>
          readDepartmentDeleteImpact(tx, floorDeletion, ids.other, at),
        ));
      if (impact)
        expect(impact.refusals).toEqual(
          hasFallback
            ? []
            : [
                {
                  code: "zone.profile_in_use",
                  params: { zoneId: ids.moved, profileId: ids.desk },
                  targets: [{ id: ids.desk, name: "Transfer desk" }],
                },
              ],
        );
      const remove = withTransaction(suite.db, (tx) =>
        department
          ? deleteDepartment(tx, floorDeletion, ids.other, at)
          : deleteZone(tx, floorDeletion, ids.moved, at),
      );
      if (hasFallback) await remove;
      else
        await expect(remove).rejects.toMatchObject({
          code: "zone.profile_in_use",
          params: { zoneId: ids.moved, profileId: ids.desk },
        });

      const { tables } = await exportConfigurationTables(suite.db, ALL_MODULES);
      const expectedStart = hasFallback ? ids.retained : ids.moved;
      expect(tables.departments!.find((row) => row.id === ids.home)?.transfer_desk_profile_id).toBe(
        ids.desk,
      );
      expect(tables.device_profiles!.find((row) => row.id === ids.desk)).toMatchObject({
        order_department_id: ids.home,
        order_starting_zone_id: expectedStart,
        order_zone_ids: JSON.stringify([expectedStart]),
      });
      expect(
        tables.device_profiles!.find((row) => row.id === ids.remaining)?.order_starting_zone_id,
      ).toBe(ids.retained);
      expect(tables.floor_zones!.some((row) => row.id === ids.retained)).toBe(true);
      expect(tables.floor_zones!.some((row) => row.id === ids.moved)).toBe(!hasFallback);
    },
  );

  it("exports a zone list without its deleted zone id", async () => {
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "Profile with a stale zone",
      formFactor: "till",
      admitted: [],
    });
    const start = await seedZone(suite.db, { name: "Profile starting zone" });
    await suite.db
      .update(deviceProfiles)
      .set({
        orderDepartmentId: start.departmentId,
        orderStartingZoneId: start.id,
        orderZoneIds: [start.id, "7e260e77-2ec3-4dd4-a510-a9f11837c563"],
      })
      .where(eq(deviceProfiles.id, profile!.id));

    const { tables } = await exportConfigurationTables(suite.db, ALL_MODULES);
    const exported = tables.device_profiles!.find((row) => row.id === profile!.id);
    expect(exported?.order_zone_ids).toBe(JSON.stringify([start.id]));
  });

  it("keeps the profile and remaps its scope after a list member switches off", async () => {
    const source = await applyVenue(planVenue(venue("B24680136"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const original = await withTransaction(suite.db, async (tx) => {
      const department = await createDepartment(tx, {
        name: "Scope restaurant",
        orderStart: "table",
      });
      const start = await createServiceZone(tx, {
        name: "Scope dining room",
        departmentId: department.id,
      });
      const closed = await createServiceZone(tx, {
        name: "Scope terrace",
        departmentId: department.id,
      });
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Scope handheld",
        formFactor: "phone-portrait",
      });
      await setProfileServiceScope(tx, profile!.id, {
        departmentId: department.id,
        startingZoneId: start.id,
        allowedZoneIds: [start.id, closed.id],
      });
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, closed.id));
      return { profile: profile!.id, department: department.id, start: start.id };
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const bundle = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-06T12:00:00Z"),
      versions,
    );
    await applyVenue(planVenue(venue("B13570247"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, bundle, ALL_MODULES, versions),
    });
    await withTransaction(targetSuite.db, async (tx) => {
      const [profile] = await tx
        .select({ id: deviceProfiles.id })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.name, "Scope handheld"));
      const [department] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.name, "Scope restaurant"));
      const zones = await tx
        .select({ id: floorZones.id, name: floorZones.name })
        .from(floorZones)
        .where(eq(floorZones.departmentId, department!.id));
      expect(zones.map((zone) => zone.name)).toEqual(["Scope dining room"]);
      expect(profile!.id).not.toBe(original.profile);
      expect(department!.id).not.toBe(original.department);
      expect(zones[0]!.id).not.toBe(original.start);
      expect(await readProfileServiceScopes(tx, [profile!.id])).toEqual([
        {
          profileId: profile!.id,
          departmentId: department!.id,
          startingZoneId: zones[0]!.id,
          allowedZoneIds: [zones[0]!.id],
        },
      ]);
    });
  });
});

it("transfers a profile's department and zones, leaving a retired profile's behind", async () => {
  const source = await applyVenue(planVenue(venue("B24680135"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });

  const original = await withTransaction(suite.db, async (tx) => {
    const restaurant = await createDepartment(tx, {
      name: "Restaurant",
      orderStart: "table",
    });
    await createServiceZone(tx, { name: "Dining room", departmentId: restaurant.id });
    const terrace = await createServiceZone(tx, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const [live, retired] = await seedDeviceProfiles(tx, [
      { name: "Terrace handheld", formFactor: "phone-portrait" },
      { name: "Old till", formFactor: "till" },
    ]);
    for (const profile of [live!, retired!]) {
      await setProfileServiceAccess(tx, profile.id, {
        departmentId: restaurant.id,
        allowedZoneIds: [terrace.id],
        startingZoneId: terrace.id,
      });
    }
    // Provisioning gave the seeded ordering profiles a scope; clear it so the rows that travel are
    // this test's own.
    const seeded = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(sql`${deviceProfiles.id} not in (${live!.id}, ${retired!.id})`);
    for (const { id } of seeded) {
      await setProfileServiceAccess(tx, id, {
        departmentId: null,
        allowedZoneIds: null,
        startingZoneId: null,
      });
    }
    return { live: live!.id, retired: retired!.id };
  });
  await retireProfile(original.retired);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-06T12:00:00Z"),
    versions,
  );
  const profiles = transferred.tables.device_profiles!;
  expect(profiles.filter((row) => row.order_department_id !== null).map((row) => row.id)).toEqual([
    original.live,
  ]);
  expect(profiles.filter((row) => row.order_zone_ids !== null).map((row) => row.id)).toEqual([
    original.live,
  ]);
  expect(profiles.map((row) => row.id)).not.toContain(original.retired);
  await applyVenue(planVenue(venue("B13570246"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => {
    const [profile] = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.name, "Terrace handheld"));
    const access = await readProfileServiceAccess(tx, profile!.id);
    const zones = new Map(
      (await tx.select({ id: floorZones.id, name: floorZones.name }).from(floorZones)).map(
        (zone) => [zone.id, zone.name],
      ),
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
    };
  });
  expect(imported).toEqual({
    department: "Restaurant",
    allowed: ["Terrace"],
    starting: "Terrace",
  });
});

it("transfers a profile's kitchen screens, leaving a retired profile's behind", async () => {
  const source = await applyVenue(planVenue(venue("B35791246"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });

  const original = await withTransaction(suite.db, async (tx) => {
    const restaurant = await createDepartment(tx, {
      name: "Restaurant",
      orderStart: "table",
    });
    const terrace = await createServiceZone(tx, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const [grill] = await tx
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [till, wall, retired] = await seedDeviceProfiles(tx, [
      { name: "Pass till", formFactor: "till" },
      { name: "Pass wall", formFactor: "kds" },
      { name: "Old till", formFactor: "till" },
    ]);
    await VENUE_SERVICE.setProfileKitchenScreens(tx, till!.id, {
      pass: { stationIds: [grill!.id], zoneIds: [terrace.id] },
    });
    await VENUE_SERVICE.setProfileKitchenScreens(tx, wall!.id, {
      pass_monitor: { stationIds: null, zoneIds: null },
    });
    await VENUE_SERVICE.setProfileKitchenScreens(tx, retired!.id, {
      station: { stationIds: [grill!.id], zoneIds: null },
    });
    return { till: till!.id, wall: wall!.id, retired: retired!.id };
  });
  await retireProfile(original.retired);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-09T12:00:00Z"),
    versions,
  );
  const exported = (table: string) =>
    transferred.tables[table]!.map(
      (row) => `${String(row.device_profile_id)}:${String(row.screen)}`,
    ).sort();
  expect(exported("device_profile_kitchen_screens")).toEqual(
    [`${original.till}:pass`, `${original.wall}:pass_monitor`].sort(),
  );
  expect(exported("device_profile_kitchen_screen_stations")).toEqual([`${original.till}:pass`]);
  expect(exported("device_profile_kitchen_screen_zones")).toEqual([`${original.till}:pass`]);
  await applyVenue(planVenue(venue("B46802357"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => {
    const names = new Map<string, string>([
      ...(await tx.select({ id: floorZones.id, name: floorZones.name }).from(floorZones)).map(
        (zone): [string, string] => [zone.id, zone.name],
      ),
      ...(
        await tx
          .select({ id: kitchenStations.id, name: kitchenStations.name })
          .from(kitchenStations)
      ).map((row): [string, string] => [row.id, row.name]),
      ...(
        await tx.select({ id: deviceProfiles.id, name: deviceProfiles.name }).from(deviceProfiles)
      ).map((row): [string, string] => [row.id, row.name]),
    ]);
    const named = (ids: readonly string[] | null) => ids?.map((id) => names.get(id)) ?? null;
    return (await VENUE_SERVICE.readProfileKitchenScreens(tx))
      .filter(({ screens }) => Object.keys(screens).length > 0)
      .map(({ profileId, screens }) => ({
        profile: names.get(profileId),
        screens: Object.fromEntries(
          Object.entries(screens).map(([kind, scope]) => [
            kind,
            { stations: named(scope!.stationIds), zones: named(scope!.zoneIds) },
          ]),
        ),
      }))
      .sort((a, b) => String(a.profile).localeCompare(String(b.profile)));
  });
  expect(imported).toEqual([
    {
      profile: "Pass till",
      screens: {
        pass: { stations: ["Grill"], zones: ["Terrace"] },
      },
    },
    { profile: "Pass wall", screens: { pass_monitor: { stations: null, zones: null } } },
  ]);
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

it("transfers job-role admission, omits retired profiles, and admits the importing administrator through their imported jobs", async () => {
  const source = await applyVenue(planVenue(venue("B35792468"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const candidates = await tx.select({ id: persons.id }).from(persons);
    let admin = "";
    for (const person of candidates)
      if ((await builtInRoleForTest(tx, person.id)) === "admin") admin = person.id;
    const [job] = await tx.insert(staffRoles).values({ name: "Cook" }).returning();
    await tx.insert(personStaffRoles).values({ personId: admin, staffRoleId: job!.id });
    const [live, retired] = await seedDeviceProfiles(tx, [
      { name: "Bar till", formFactor: "till", admitted: [job!.id] },
      { name: "Old till", formFactor: "till", admitted: [job!.id] },
    ]);
    return { admin, job: job!.id, live: live!.id, retired: retired!.id };
  });
  await retireProfile(original.retired);
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    { ...source, sourceOperatorId: original.admin },
    ALL_MODULES,
    new Date("2026-10-06T12:00:00Z"),
    versions,
  );
  const admissions = transferred.tables.device_profile_admission_roles!;
  expect(admissions).toContainEqual({
    device_profile_id: original.live,
    staff_role_id: original.job,
  });
  expect(admissions.some((row) => row.device_profile_id === original.retired)).toBe(false);
  expect(transferred.tables).not.toHaveProperty("device_profile_admission_persons");
  await applyVenue(planVenue(venue("B46813579"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  await withTransaction(targetSuite.db, async (tx) => {
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .innerJoin(personRoles, eq(personRoles.personId, persons.id))
      .innerJoin(roles, eq(roles.id, personRoles.roleId))
      .where(eq(roles.builtInKey, "admin"));
    const rows = await tx
      .select({ profile: deviceProfiles.name, job: staffRoles.name })
      .from(deviceProfileAdmissionRoles)
      .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceProfileAdmissionRoles.deviceProfileId))
      .innerJoin(staffRoles, eq(staffRoles.id, deviceProfileAdmissionRoles.staffRoleId))
      .orderBy(deviceProfiles.name);
    expect(rows).toEqual([
      { profile: "Bar till", job: "Cook" },
      { profile: STARTER_PROFILE_NAMES.Kitchen.es, job: STARTER_JOB_ROLE_NAMES.Team.es },
      { profile: STARTER_PROFILE_NAMES.Counter.es, job: STARTER_JOB_ROLE_NAMES.Team.es },
      { profile: STARTER_PROFILE_NAMES.Handheld.es, job: STARTER_JOB_ROLE_NAMES.Team.es },
    ]);
    for (const profile of await tx.select().from(deviceProfiles))
      expect(await canUseDeviceProfile(tx, profile.id, admin!.id), profile.name).toBe(true);
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

it("carries each station's own late flags to the importing venue", async () => {
  const source = await applyVenue(planVenue(venue("B13572471"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({
      name: "Timing export",
      warmAfterMinutes: 6,
      overdueAfterMinutes: 12,
      forgottenAfterMinutes: 16,
    })
    .returning({ id: kitchenStations.id });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  expect(transferred.tables.kitchen_stations!.find((row) => row.id === station!.id)).toMatchObject({
    warm_after_minutes: 6,
    overdue_after_minutes: 12,
    forgotten_after_minutes: 16,
  });
  expect(transferred.tables).not.toHaveProperty("kitchen_timing_defaults");
  expect(transferred.tables).not.toHaveProperty("kitchen_station_timing");
  await applyVenue(planVenue(venue("B97531866"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  expect(
    await targetSuite.db
      .select({
        warmAfterMinutes: kitchenStations.warmAfterMinutes,
        overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
        forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Timing export")),
  ).toEqual([{ warmAfterMinutes: 6, overdueAfterMinutes: 12, forgottenAfterMinutes: 16 }]);
});

it.each([
  [0, "warmAfterMinutes"],
  [12, "overdueAfterMinutes"],
] as const)("refuses imported station timing warm=%i atomically", async (warm, field) => {
  const source = await applyVenue(planVenue(venue("B13572472"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await suite.db.insert(kitchenStations).values({
    name: "Invalid imported timing",
    warmAfterMinutes: 3,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  transferred.tables.kitchen_stations!.find(
    (row) => row.name === "Invalid imported timing",
  )!.warm_after_minutes = warm;
  const target = venue("B97531867");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "station.thresholds_invalid",
    params: { name: "Invalid imported timing", field },
  });
  expect(
    (
      await targetSuite.db.execute<{ count: number }>(
        sql`select count(*) as count from taxpayer where tax_id = ${target.taxId}`,
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(
    await targetSuite.db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Invalid imported timing")),
  ).toEqual([]);
});

it("refuses an imported ready warning of 0 before writing anything", async () => {
  const source = await applyVenue(planVenue(venue("B13572961"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await suite.db.insert(kitchenStations).values({ name: "Invalid imported ready warning" });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-26T12:00:00Z"),
    versions,
  );
  transferred.tables.kitchen_stations!.find(
    (row) => row.name === "Invalid imported ready warning",
  )!.ready_warning_after_minutes = 0;
  const target = venue("B97531961");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "station.thresholds_invalid",
    params: { name: "Invalid imported ready warning", field: "readyWarningAfterMinutes" },
  });
  expect(
    (
      await targetSuite.db.execute<{ count: number }>(
        sql`select count(*) as count from taxpayer where tax_id = ${target.taxId}`,
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(
    await targetSuite.db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Invalid imported ready warning")),
  ).toEqual([]);
});

it("imports a station row with no ready warning as 3", async () => {
  const source = await applyVenue(planVenue(venue("B13572962"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await suite.db.insert(kitchenStations).values({
    name: "Older file station",
    readyWarningAfterMinutes: 8,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-26T12:00:00Z"),
    versions,
  );
  delete transferred.tables.kitchen_stations!.find((row) => row.name === "Older file station")!
    .ready_warning_after_minutes;
  await applyVenue(planVenue(venue("B97531962"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  expect(
    await targetSuite.db
      .select({ readyWarningAfterMinutes: kitchenStations.readyWarningAfterMinutes })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Older file station")),
  ).toEqual([{ readyWarningAfterMinutes: 3 }]);
});

it("exports no service settings", async () => {
  const source = await applyVenue(planVenue(venue("B13572499"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-24T12:00:00Z"),
    versions,
  );
  expect(transferred.tables).not.toHaveProperty("service_settings");
});

it("refuses an imported minute that is not a whole number", async () => {
  const source = await applyVenue(planVenue(venue("B13572473"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await suite.db.insert(kitchenStations).values({ name: "Fractional imported timing" });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-05T12:00:00Z"),
    versions,
  );
  transferred.tables.kitchen_stations!.find(
    (row) => row.name === "Fractional imported timing",
  )!.warm_after_minutes = 2.5;
  const target = venue("B97531868");
  await expect(
    applyVenue(planVenue(target, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    }),
  ).rejects.toMatchObject({
    code: "station.thresholds_invalid",
    params: { field: "warmAfterMinutes", name: "Fractional imported timing" },
  });
  expect(
    (
      await targetSuite.db.execute<{ count: number }>(
        sql`select count(*) as count from taxpayer where tax_id = ${target.taxId}`,
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(
    await targetSuite.db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Fractional imported timing")),
  ).toEqual([]);
});

describe("venue detail edits and configuration boundaries", () => {
  it("exports corrected details while a fresh import keeps its separately created target address and clock", async () => {
    const source = await applyVenue(planVenue(venue("B77112233"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    await seedBusinessDay(suite.db, { dayCutover: "04:30:00" });
    const initial = await withTransaction(suite.db, (tx) => readVenueDetails(tx));
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(tx, {
        expected: initial.details,
        changes: {
          name: "Corrected source",
          city: "Alcalá de Henares",
          timeZone: "Atlantic/Canary",
        },
      }),
    );
    expect(saved.changed).toBe(true);
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const exported = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-06T12:00:00Z"),
      versions,
    );
    expect(exported.venue).toMatchObject({
      ...saved.model.details,
      dayCutover: "04:30:00",
    });
    const targetRequest = venue("B33221177");
    Object.assign(targetRequest, {
      name: "Created target",
      addressLine1: "Calle target 2",
      addressLine2: "Upper floor",
      postalCode: "28014",
      city: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "07:00",
    });
    await applyVenue(planVenue(targetRequest, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, exported, ALL_MODULES, versions),
    });
    const model = await withTransaction(targetSuite.db, (tx) => readVenueDetails(tx));
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
    "importing configuration keeps all target details with history=%s",
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
      const initial = await withTransaction(suite.db, (tx) => readVenueDetails(tx));
      const versions = await schemaVersionsByModule(
        { venue: suite.db, node: suite.node },
        ALL_MODULES,
      );
      const exported = await buildConfigurationBundle(
        suite.db,
        {
          ...target,
          sourceOperatorId: suite.db.all<{ id: string }>(
            sql`select id from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')`,
          )[0]!.id,
        },
        ALL_MODULES,
        new Date("2026-10-06T12:00:00Z"),
        versions,
      );
      const foreignDetails = {
        ...exported.venue,
        name: "Foreign source name",
        addressLine1: "Foreign street",
        addressLine2: "Foreign line two",
        postalCode: "45001",
        city: "Toledo",
        province: "Toledo",
        timeZone: "Atlantic/Canary",
        dayCutover: "01:30:00",
      };
      const beforeSales = suite.db.all(sql`select * from sales`);
      const beforeSeries = suite.db.all(sql`select * from invoice_series`);
      await withTransaction(suite.db, (tx) =>
        importConfigurationTables(
          tx,
          { ...exported, venue: foreignDetails },
          ALL_MODULES,
          versions,
        ),
      );
      const after = await withTransaction(suite.db, (tx) => readVenueDetails(tx));
      expect(after.details).toEqual(initial.details);
      expect(after.issuer).toEqual(initial.issuer);
      expect(after.hasSales).toBe(history);
      expect(suite.db.all(sql`select * from sales`)).toEqual(beforeSales);
      expect(suite.db.all(sql`select * from invoice_series`)).toEqual(beforeSeries);
    },
  );
});

it.each(["departments", "floor_zones"])(
  "refuses obsolete %s receipt data before changing the target venue",
  async (table) => {
    const source = await applyVenue(planVenue(venue("B13572476"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await applyVenue(planVenue(venue("B13572477"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const exported = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-06T10:00:00Z"),
      versions,
    );
    const bad = {
      ...exported,
      tables: {
        ...exported.tables,
        [table]: exported.tables[table]!.map((row) => ({ ...row, receipt_print_mode: "auto" })),
      },
    };
    expect(bad.tables[table]).not.toHaveLength(0);
    const before = {
      departments: targetSuite.db.all(sql`select * from departments`),
      zonePolicies: targetSuite.db.all(sql`select * from floor_zones`),
    };
    await expect(
      withTransaction(targetSuite.db, (tx) =>
        importConfigurationTables(tx, bad, ALL_MODULES, versions),
      ),
    ).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: `table:${table}` },
    });
    expect(targetSuite.db.all(sql`select * from departments`)).toEqual(before.departments);
    expect(targetSuite.db.all(sql`select * from floor_zones`)).toEqual(before.zonePolicies);
  },
);

it("A725 transfers station and department choices", async () => {
  const source = await applyVenue(planVenue(venue("B13572476"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, {
      name: "Receipt department",
      orderStart: "table",
    });
    const explicit = await createServiceZone(tx, {
      name: "Explicit receipts",
      departmentId: department.id,
    });
    await createServiceZone(tx, {
      name: "Inherited receipts",
      departmentId: department.id,
    });
    await tx
      .update(departments)
      .set({ printTradingName: false })
      .where(eq(departments.id, department.id));
    await tx
      .update(floorZones)
      .set({ collectionNumber: "numbered" })
      .where(eq(floorZones.id, explicit.id));
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const exported = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-06T10:00:00Z"),
    versions,
  );
  expect(exported.version).toBe(50);
  expect(exported.tables).not.toHaveProperty("table_service_statuses");
  expect(exported.tables.kitchen_stations!.length).toBeGreaterThan(0);
  for (const station of exported.tables.kitchen_stations!)
    expect(station).not.toHaveProperty("display_order");
  expect(exported.venue).not.toHaveProperty("receiptPrintMode");
  expect(exported.venue).not.toHaveProperty("drawerOpenPolicy");
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(exported, "a strong passphrase"),
    "a strong passphrase",
  );
  await applyVenue(planVenue(venue("B13572477"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const modes = await targetSuite.db.execute(sql`
    select z.name, d.print_trading_name as trading_name, z.collection_number as zone_collection
    from floor_zones z
    join departments d on d.id=z.department_id
    where d.name='Receipt department' order by z.name`);
  expect(modes.rows).toEqual([
    { name: "Explicit receipts", trading_name: 0, zone_collection: "numbered" },
    { name: "Inherited receipts", trading_name: 0, zone_collection: null },
  ]);
});

it("transfers a department's customer and staff period menus to its zone under new ids", async () => {
  const source = await applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, {
      name: "Menus restaurant",
      orderStart: "table",
    });
    const bar = await createServiceZone(tx, {
      name: "Menus bar",
      departmentId: department.id,
    });
    const drinks = await createMenu(tx, { name: "Transferred drinks" });
    const breakfasts = await createMenu(tx, { name: "Transferred breakfasts" });
    const period = await saveMenuPeriod(tx, department.id, {
      name: "Menus service",
      colour: "red",
      menuId: drinks.id,
      staffMenuIds: [breakfasts.id],
    });
    return [department.id, bar.id, drinks.id, breakfasts.id, period.id];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: async (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const zone = await targetSuite.db.execute<{
    zone_id: string;
    department_id: string;
    menu_id: string;
    zone: string;
    department: string;
    menu: string;
  }>(sql`
    select z.id as zone_id, z.department_id, p.menu_id, z.name as zone, d.name as department,
      c.name as menu
    from floor_zones z
    join menu_periods p on p.department_id=z.department_id and p.name='Menus service'
    join departments d on d.id = z.department_id
    join menus c on c.id = p.menu_id
    where z.name = 'Menus bar'`);
  expect(zone.rows).toEqual([
    {
      zone_id: expect.any(String),
      department_id: expect.any(String),
      menu_id: expect.any(String),
      zone: "Menus bar",
      department: "Menus restaurant",
      menu: "Transferred drinks",
    },
  ]);
  const periodMenus = await targetSuite.db.execute<{
    customer: string;
    staff: string;
    colour: string;
    period_id: string;
    staff_id: string;
  }>(sql`
    select c.name as customer, s.name as staff, p.colour, p.id as period_id, x.value as staff_id
    from menu_periods p join departments d on d.id=p.department_id
    join menus c on c.id=p.menu_id join json_each(p.staff_menu_ids) x
    join menus s on s.id=x.value
    where d.name='Menus restaurant' and p.name='Menus service' order by x.key`);
  expect(periodMenus.rows).toEqual([
    {
      customer: "Transferred drinks",
      staff: "Transferred breakfasts",
      colour: "red",
      period_id: expect.any(String),
      staff_id: expect.any(String),
    },
  ]);
  expect(sourceIds).not.toContain(periodMenus.rows[0]!.period_id);
  expect(sourceIds).not.toContain(periodMenus.rows[0]!.staff_id);
  const row = zone.rows[0]!;
  for (const id of [row.zone_id, row.department_id, row.menu_id])
    expect(sourceIds).not.toContain(id);
});

it("exports and imports all seven cell classes into another venue, remapping every id and the venue", async () => {
  const source = await applyVenue(planVenue(venue("B24681359"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });

  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, {
      name: "Routes dining room",
      orderStart: "table",
    });
    const terrace = await createServiceZone(tx, {
      name: "Routes terrace",
      departmentId: department.id,
    });
    const lounge = await createServiceZone(tx, {
      name: "Routes lounge",
      departmentId: department.id,
    });
    const [bar, griddle] = await tx
      .insert(kitchenStations)
      .values([{ name: "Routes bar" }, { name: "Routes griddle" }])
      .returning();
    const category = await createCategory(tx, { name: "Routes drinks" });
    const product = await createProduct(tx, {
      categoryId: category.id,
      name: "Routes mojito",
      pricingUnit: "each",
      unitPrice: "7",
      vatClass: "general",
    });
    const atStation = (id: string) => ({ kind: "station" as const, stationId: id });
    const categoryRow = { kind: "category" as const, categoryId: category.id };
    const productRow = { kind: "product" as const, productId: product.id };
    await setRoutingCell(tx, { row: categoryRow, zoneId: null }, atStation(bar!.id));
    await setRoutingCell(
      tx,
      { row: categoryRow, zoneId: terrace.id },
      {
        kind: "no_preparation",
      },
    );
    await setRoutingCell(tx, { row: productRow, zoneId: null }, atStation(griddle!.id));
    await setRoutingCell(tx, { row: productRow, zoneId: lounge.id }, atStation(bar!.id));
    await setRoutingCell(tx, { row: { kind: "all" }, zoneId: terrace.id }, atStation(griddle!.id));
    const noCategoryRow = { kind: "no_category" as const };
    await setRoutingCell(tx, { row: noCategoryRow, zoneId: null }, { kind: "no_preparation" });
    await setRoutingCell(tx, { row: noCategoryRow, zoneId: terrace.id }, atStation(bar!.id));
    return [department.id, terrace.id, lounge.id, bar!.id, griddle!.id, category.id, product.id];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
  await applyVenue(planVenue(venue("B24681360"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const idOf = async (table: string, name: string) => {
    const result = await targetSuite.db.execute<{ id: string }>(
      sql`select id from ${sql.identifier(table)} where name = ${name}`,
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  };
  const terrace = await idOf("floor_zones", "Routes terrace");
  const lounge = await idOf("floor_zones", "Routes lounge");
  const bar = await idOf("kitchen_stations", "Routes bar");
  const griddle = await idOf("kitchen_stations", "Routes griddle");
  const category = await idOf("categories", "Routes drinks");
  const product = await idOf("products", "Routes mojito");
  for (const id of [terrace, lounge, bar, griddle, category, product])
    expect(sourceIds).not.toContain(id);
  const cells = await targetSuite.db.execute<Record<string, unknown>>(sql`
    select category_id, product_id, zone_id, station_id, no_preparation, no_category
    from routing_cells`);
  const cell = (values: Record<string, unknown>) => ({
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
      cell({ category_id: category, station_id: bar }),
      cell({ category_id: category, zone_id: terrace, no_preparation: 1 }),
      cell({ product_id: product, station_id: griddle }),
      cell({ product_id: product, zone_id: lounge, station_id: bar }),
      cell({ zone_id: terrace, station_id: griddle }),
      cell({ no_category: 1, no_preparation: 1 }),
      cell({ no_category: 1, zone_id: terrace, station_id: bar }),
    ]),
  );
  expect(cells.rows).toHaveLength(7);
});

it("carries a cell's period choices with their cell, including a period whose menu holds none of the cell's products", async () => {
  const source = await applyVenue(planVenue(venue("B24681361"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });

  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, {
      name: "Periods dining room",
      orderStart: "table",
    });
    const terrace = await createServiceZone(tx, {
      name: "Periods terrace",
      departmentId: department.id,
    });
    const [bar, griddle] = await tx
      .insert(kitchenStations)
      .values([{ name: "Periods bar" }, { name: "Periods griddle" }])
      .returning();
    const category = await createCategory(tx, { name: "Periods drinks" });
    const product = await createProduct(tx, {
      categoryId: category.id,
      name: "Periods mojito",
      pricingUnit: "each",
      unitPrice: "7",
      vatClass: "general",
    });
    const emptyMenu = await createMenu(tx, { name: "Periods empty menu" });
    const period = await saveMenuPeriod(tx, department.id, {
      name: "Periods lunches",
      colour: "red",
      menuId: emptyMenu.id,
      staffMenuIds: [],
    });
    const atBar = { kind: "station" as const, stationId: bar!.id };
    await setRoutingCell(
      tx,
      { row: { kind: "product", productId: product.id }, zoneId: null },
      atBar,
    );
    await setRoutingCell(
      tx,
      { row: { kind: "category", categoryId: category.id }, zoneId: terrace.id },
      atBar,
    );
    const cellIds = await tx.execute<{ id: string; product_id: string | null }>(
      sql`select id, product_id from routing_cells`,
    );
    const productCell = cellIds.rows.find((row) => row.product_id !== null)!.id;
    const categoryCell = cellIds.rows.find((row) => row.product_id === null)!.id;
    await tx.execute(sql`insert into routing_cell_periods
      (id, cell_id, period_id, station_id, no_preparation)
      values (${randomUUID()}, ${productCell}, ${period.id}, ${griddle!.id}, 0),
        (${randomUUID()}, ${categoryCell}, ${period.id}, null, 1)`);
    const [redundant] = await tx
      .insert(routingCells)
      .values({ noCategory: true, stationId: bar!.id })
      .returning();
    await tx
      .insert(routingCellPeriods)
      .values({ cellId: redundant!.id, periodId: period.id, stationId: bar!.id });
    return [department.id, terrace.id, bar!.id, griddle!.id, period.id, productCell, categoryCell];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(
      await buildConfigurationBundle(
        suite.db,
        source,
        ALL_MODULES,
        new Date("2026-10-09T10:00:00Z"),
        versions,
      ),
      "a strong passphrase",
    ),
    "a strong passphrase",
  );
  expect(decoded.tables.routing_cell_periods).toHaveLength(3);
  await applyVenue(planVenue(venue("B24681362"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const choices = await targetSuite.db.execute<Record<string, unknown>>(sql`
    select x.cell_id, x.period_id, p.department_id, x.station_id,
      c.product_id is not null as product_cell,
      z.name as zone, p.name as period, d.name as department, s.name as station, x.no_preparation
    from routing_cell_periods x
    join routing_cells c on c.id = x.cell_id
    left join floor_zones z on z.id = c.zone_id
    join menu_periods p on p.id = x.period_id
    join departments d on d.id = p.department_id
    left join kitchen_stations s on s.id = x.station_id
    order by product_cell desc`);
  expect(
    choices.rows.map((row) => ({
      product_cell: row.product_cell,
      zone: row.zone,
      period: row.period,
      department: row.department,
      station: row.station,
      no_preparation: row.no_preparation,
    })),
  ).toEqual([
    {
      product_cell: 1,
      zone: null,
      period: "Periods lunches",
      department: "Periods dining room",
      station: "Periods griddle",
      no_preparation: 0,
    },
    {
      product_cell: 0,
      zone: "Periods terrace",
      period: "Periods lunches",
      department: "Periods dining room",
      station: null,
      no_preparation: 1,
    },
  ]);
  for (const row of choices.rows)
    for (const id of [row.cell_id, row.period_id, row.department_id])
      expect(sourceIds).not.toContain(id);
  const model = await withTransaction(targetSuite.db, (tx) =>
    routingModel(tx, new Date("2026-10-09T10:00:00Z")),
  );
  const [productLine, categoryLine] = choices.rows;
  expect(
    model.cells
      .filter((cell) => cell.periods !== undefined)
      .map(({ row, periods }) => ({ kind: row.kind, periods }))
      .sort((a, b) => b.kind.localeCompare(a.kind)),
  ).toStrictEqual([
    {
      kind: "product",
      periods: [
        {
          periodId: productLine!.period_id,
          target: { kind: "station", stationId: productLine!.station_id },
          notOffered: true,
        },
      ],
    },
    {
      kind: "category",
      periods: [
        {
          periodId: categoryLine!.period_id,
          target: { kind: "no_preparation" },
          notOffered: true,
        },
      ],
    },
  ]);
});

async function insertSpecialDay(
  tx: Parameters<Parameters<typeof withTransaction>[1]>[0],
  day: { date: string; name: string; closedAllDay?: boolean },
) {
  const id = randomUUID();
  await tx.execute(sql`insert into special_days (id, name, repeats_yearly)
    values (${id}, ${day.name}, 0)`);
  await tx.execute(sql`insert into special_day_dates (id, special_day_id, date, closed_all_day)
    values (${randomUUID()}, ${id}, ${day.date}, ${day.closedAllDay ? 1 : 0})`);
  return { id };
}

describe("special days in a configuration transfer", () => {
  /** Tuesday 6 October 2026, 12:00 in Madrid. */
  const AT = new Date("2026-10-06T10:00:00Z");

  interface Named {
    departments: Map<string, string>;
    stations: Map<string, string>;
  }

  async function named(db: typeof suite.db): Promise<Named> {
    const departmentRows = await db.execute<{ id: string; name: string }>(sql`
      select id, name from departments `);
    const stationRows = await db.execute<{ id: string; name: string }>(sql`
      select id, name from kitchen_stations `);
    return {
      departments: new Map(departmentRows.rows.map((row) => [row.name, row.id])),
      stations: new Map(stationRows.rows.map((row) => [row.name, row.id])),
    };
  }

  async function specialDaysByName(db: typeof suite.db) {
    const rows = await db.execute<{ date: string; name: string; closed_all_day: number }>(sql`
      select d.date, s.name, d.closed_all_day from special_day_dates d
      join special_days s on s.id = d.special_day_id
       order by d.date`);
    return {
      dates: rows.rows.map((row) => ({
        date: row.date,
        name: row.name,
        closeWholeVenue: row.closed_all_day === 1,
      })),
    };
  }

  async function preparedWithSpecialDays(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(departments).values({ name: "Deli", tradingName: "Deli" });
      await tx
        .insert(kitchenStations)
        .values([{ name: "Bar" }, { name: "Pass" }, { name: "Grill" }]);
    });
    const { stations } = await named(suite.db);
    const bar = { kind: "station" as const, id: stations.get("Bar")! };
    await withTransaction(suite.db, async (tx) => {
      await insertSpecialDay(tx, { date: "2026-12-24", name: "Christmas Eve" });
      await insertSpecialDay(tx, {
        date: "2026-12-25",
        name: "Christmas",
        closedAllDay: true,
      });
      await insertSpecialDay(tx, { date: "2027-01-01", name: "New Year" });
      await setStationToday(tx, bar.id, "closed", AT, await seedActivityActor(tx));
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    return { source, versions, transferred };
  }

  it.each([
    "station_fallbacks",
    "hours_week_cells",
    "hours_week_periods",
    "special_date_hours",
    "special_date_hours_periods",
  ])("exports special days without retired %s", async (table) => {
    const { transferred } = await preparedWithSpecialDays("B44009911");
    expect(transferred.tables).not.toHaveProperty(table);
    expect(transferred.tables.special_days).toHaveLength(3);
    for (const row of transferred.tables.kitchen_stations ?? []) {
      expect(row).not.toHaveProperty("closed_on_day");
      expect(row).not.toHaveProperty("closed_sends_to_station_id");
    }
  });

  it("carries special dates with fresh ids while leaving station schedules behind", async () => {
    const { versions, transferred } = await preparedWithSpecialDays("B44001122");
    for (const row of transferred.tables.kitchen_stations ?? []) {
      expect(row).not.toHaveProperty("closed_on_day");
      expect(row).not.toHaveProperty("closed_sends_to_station_id");
    }
    for (const table of [
      "station_fallbacks",
      "hours_week_cells",
      "hours_week_periods",
      "special_date_hours",
      "special_date_hours_periods",
    ])
      expect(transferred.tables).not.toHaveProperty(table);

    await applyVenue(planVenue(venue("B44001133"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });

    const expected = await specialDaysByName(suite.db);
    expect(expected.dates.map((date) => date.date)).toEqual([
      "2026-12-24",
      "2026-12-25",
      "2027-01-01",
    ]);
    const actual = await specialDaysByName(targetSuite.db);
    expect(actual.dates).toEqual(expected.dates);

    const sourceIds = new Set(transferred.tables.special_days!.map((row) => row.id));
    const imported = await targetSuite.db.execute<{ id: string }>(sql`select id from special_days`);
    expect(imported.rows).toHaveLength(sourceIds.size);
    for (const row of imported.rows) {
      expect(sourceIds.has(row.id)).toBe(false);
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    const dayStates = await targetSuite.db.execute<{ n: number }>(sql`
      select cast(count(*) as int) as n from kitchen_stations where closed_on_day is not null`);
    expect(dayStates.rows[0]!.n).toBe(0);
  });

  const namedOn = async (tx: Parameters<Parameters<typeof withTransaction>[1]>[0], date: string) =>
    (
      await tx.execute<{ date: string; name: string }>(sql`
        select d.date, s.name from special_day_dates d
        join special_days s on s.id = d.special_day_id
        where d.date = ${date}`)
    ).rows[0] ?? null;

  it("leaves default station hours behind while keeping its special day and open state", async () => {
    const source = await applyVenue(planVenue(venue("B44002211"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, (tx) => tx.insert(kitchenStations).values({ name: "Pass" }));
    const { stations } = await named(suite.db);
    const pass = { kind: "station" as const, id: stations.get("Pass")! };
    await withTransaction(suite.db, async (tx) => {
      await insertSpecialDay(tx, { date: "2026-12-31", name: "New Year's Eve" });
      await setDefaultStation(tx, pass.id);
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    expect(transferred.tables).not.toHaveProperty("hours_week_cells");
    expect(transferred.tables).not.toHaveProperty("special_date_hours");

    await applyVenue(planVenue(venue("B44002222"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    const imported = await named(targetSuite.db);
    const importedPass = { kind: "station" as const, id: imported.stations.get("Pass")! };
    const read = await withTransaction(targetSuite.db, async (tx) => ({
      eve: await namedOn(tx, "2026-12-31"),
      tuesday: await namedOn(tx, "2026-10-06"),
      // 23:00 in Madrid on New Year's Eve, and noon on an ordinary Tuesday.
      states: [
        await stationStates(tx, new Date("2026-12-31T22:00:00Z")),
        await stationStates(tx, AT),
      ],
    }));
    expect(read.eve).toMatchObject({
      date: "2026-12-31",
      name: "New Year's Eve",
    });
    expect(read.tuesday).toBeNull();
    for (const states of read.states)
      expect(states.get(importedPass.id)).toMatchObject({ isDefault: true, open: true });
  });

  it.each([
    "station_fallbacks",
    "hours_week_cells",
    "hours_week_periods",
    "special_date_hours",
    "special_date_hours_periods",
  ] as const)("refuses retired %s rows without retaining the target taxpayer", async (table) => {
    const { versions, transferred } = await preparedWithSpecialDays("B44006611");
    const edited = structuredClone(transferred);
    edited.tables[table] = [
      { id: randomUUID(), station_id: edited.tables.kitchen_stations![0]!.id },
    ];
    const refusal = { code: "setup.request_invalid", params: { field: "tables" } };
    expect(() => validateConfigurationBundle(edited, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B44006622");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, edited, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ taxpayer: number }>(sql`
        select cast(count(*) as int) as taxpayer from taxpayer where tax_id = ${target.taxId}`);
    expect(persisted.rows).toEqual([{ taxpayer: 0 }]);
  });

  it("refuses a reintroduced station-hours table and writes no venue", async () => {
    const { versions, transferred } = await preparedWithSpecialDays("B44003311");
    const edited: ConfigurationBundle = {
      ...transferred,
      tables: { ...transferred.tables, hours_week_periods: [] },
    };
    const refusal = { code: "setup.request_invalid", params: { field: "tables" } };
    expect(() => validateConfigurationBundle(edited, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B44003322");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, edited, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ taxpayer: number }>(
      sql`select cast(count(*) as int) as taxpayer from taxpayer where tax_id = ${target.taxId}`,
    );
    expect(persisted.rows[0]).toEqual({ taxpayer: 0 });
  });
});

describe("public holidays in a configuration transfer", () => {
  const AT = new Date("2026-10-06T10:00:00Z");
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  async function moveTo(db: typeof suite.db, province: string, city: string) {
    await withTransaction(db, (tx) => seedVenueSettings(tx, { province, city }));
  }

  async function holidaysByCity(db: typeof suite.db) {
    const { doc } = await readVenueSettings(db);
    const entries = await db.execute<{ city: string; date: string; name: string }>(sql`
      select (select json_extract(doc, '$.city') from settings where module = 'venue') as city, d.date, s.name from special_day_dates d
      join special_days s on s.id = d.special_day_id order by d.date, s.name`);
    return {
      area: doc.holidayArea,
      entries: entries.rows.map((row) => ({
        city: row.city?.trim().toLowerCase(),
        date: row.date,
        name: row.name,
      })),
    };
  }

  async function preparedWithHolidays(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      await insertSpecialDay(tx, {
        date: "2026-01-06",
        name: "Three Kings",
        closedAllDay: true,
      });
    });
    await moveTo(suite.db, "Lleida", "Vielha e Mijaran");
    await withTransaction(suite.db, async (tx) => {
      await saveHolidayArea(tx, { areaKey: "aran" });
    });
    await moveTo(suite.db, "Madrid", "  MADRID ");
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(suite.db, source, ALL_MODULES, AT, versions);
    return { source, versions, transferred };
  }

  it("carries the chosen holiday area and named holidays under fresh ids without retired local entries", async () => {
    const { versions, transferred } = await preparedWithHolidays("B45001122");
    expect(transferred.tables).not.toHaveProperty("holiday_geographies");
    expect(transferred.tables.local_holidays).toBeUndefined();
    expect(transferred.holidayArea).toEqual({
      country: "ES",
      provinceCode: "25",
      cityKey: "vielha e mijaran",
      areaKey: "aran",
    });

    const text = JSON.stringify(transferred);
    expect(text).not.toContain("shipped:");
    expect(text).not.toContain("f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0");
    expect(text).not.toContain("ES-2026.1");

    await applyVenue(planVenue(venue("B45001133"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });

    const expected = await holidaysByCity(suite.db);
    expect(expected.area).toEqual({
      country: "ES",
      provinceCode: "25",
      cityKey: "vielha e mijaran",
      areaKey: "aran",
    });
    expect(expected.entries).toEqual([{ city: "madrid", date: "2026-01-06", name: "Three Kings" }]);
    expect(await holidaysByCity(targetSuite.db)).toEqual(expected);

    const read = () =>
      withTransaction(targetSuite.db, async (tx) => ({
        model: await readHolidayAreaModel(tx),
        epiphany: await readHolidays(tx, "2026-01-06", "2026-01-06"),
        aran: await readHolidays(tx, "2026-06-17", "2026-06-17"),
      }));
    const inMadrid = await read();

    expect(inMadrid.epiphany.facts.map(({ scope, name }) => ({ scope, name }))).toEqual([
      { scope: "national", name: "Epifanía del Señor" },
    ]);
    expect(inMadrid.epiphany.coverage).toEqual([
      expect.objectContaining({
        year: 2026,
        nationalRegional: "complete",
        local: "none_entered",
        dataVersion: "ES-2026.1",
      }),
    ]);
    expect(inMadrid.aran.facts).toEqual([]);
    const special = await targetSuite.db.execute<{
      id: string;
      name: string;
      close_whole_venue: number;
    }>(sql`
      select s.id, s.name, d.closed_all_day as close_whole_venue
      from special_day_dates d join special_days s on s.id = d.special_day_id
      where d.date = '2026-01-06'`);
    expect(special.rows).toEqual([
      {
        id: expect.any(String),

        name: "Three Kings",
        close_whole_venue: 1,
      },
    ]);
    expect(special.rows[0]!.id).toMatch(UUID);
    expect(transferred.tables.special_days!.map((row) => row.id)).not.toContain(
      special.rows[0]!.id,
    );

    await moveTo(targetSuite.db, "Lleida", "Vielha e Mijaran");
    const inVielha = await read();
    expect(inVielha.model.areaRequired).toBe(false);
    expect(inVielha.aran.facts.map(({ scope, name }) => ({ scope, name }))).toEqual([
      { scope: "regional", name: "Fiesta de Arán" },
    ]);
    expect(inVielha.epiphany.facts.map(({ scope }) => scope)).toEqual(["national"]);

    await moveTo(targetSuite.db, "Madrid", "Madrid");
    expect((await read()).model.chosen).toEqual(inMadrid.model.chosen);
  });

  it.each<[string, (bundle: ConfigurationBundle) => void, string]>([
    [
      "an area the data does not offer for the province",
      (bundle) => (bundle.holidayArea!.areaKey = "tenerife"),
      "holidayArea.areaKey",
    ],
  ])("refuses an edited bundle with %s, and writes no venue", async (_, edit, field) => {
    const { versions, transferred } = await preparedWithHolidays("B45002211");
    const edited = structuredClone(transferred);
    edit(edited);
    const refusal = { code: "setup.request_invalid", params: { field } };
    expect(() => validateConfigurationBundle(edited, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B45002222");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, edited, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<Record<string, number>>(sql`
      select
        (select cast(count(*) as int) from taxpayer where tax_id = ${target.taxId}) as taxpayer,
        (select cast(count(*) as int) from settings where module = 'venue') as geographies,
        (select cast(count(*) as int) from special_days) as entries,
        (select cast(count(*) as int) from special_day_dates) as special_day_dates`);
    expect(persisted.rows[0]).toEqual({
      taxpayer: 0,
      geographies: 0,
      entries: 0,
      special_day_dates: 0,
    });
  });

  it("refuses a retired local-holiday table in a bundle and writes no venue", async () => {
    const { versions, transferred } = await preparedWithHolidays("B45004411");
    const edited: ConfigurationBundle = {
      ...transferred,
      tables: { ...transferred.tables, local_holidays: [] },
    };
    const refusal = { code: "setup.request_invalid", params: { field: "tables" } };
    expect(() => validateConfigurationBundle(edited, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    const target = venue("B45004422");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, edited, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const persisted = await targetSuite.db.execute<{ taxpayer: number }>(
      sql`select cast(count(*) as int) as taxpayer from taxpayer where tax_id = ${target.taxId}`,
    );
    expect(persisted.rows).toEqual([{ taxpayer: 0 }]);
  });

  it("refuses a bundle whose core version is older than this box's as outdated", async () => {
    const { versions, transferred } = await preparedWithHolidays("B45003311");
    const journal = JSON.parse(
      await readFile(
        new URL("../../../packages/db/drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    expect(versions.core).toBeGreaterThanOrEqual(1);
    expect(versions.core).toBe(journal.entries.length);
    const older: ConfigurationBundle = {
      ...transferred,
      modules: { ...transferred.modules, core: versions.core! - 1 },
    };
    expect(() => validateConfigurationBundle(older, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining({ code: "setup.configuration_outdated", params: {} }),
    );
  });
});

it("round-trips departmental transfer directions and desks with remapped ids, leaving operational requests behind", async () => {
  const source = await applyVenue(planVenue(venue("B36472851"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const a = await createDepartment(tx, {
      name: "Transfer deli",
      orderStart: "table",
    });
    const b = await createDepartment(tx, {
      name: "Transfer restaurant",
      orderStart: "table",
    });
    const zone = await createServiceZone(tx, {
      name: "Transfer receiving zone",
      departmentId: b.id,
    });
    const [profile] = await seedDeviceProfiles(tx, {
      name: "Transfer receiving desk",
      formFactor: "till",
      capabilities: ["take-orders"],
    });
    await setProfileServiceScope(tx, profile!.id, {
      departmentId: b.id,
      allowedZoneIds: null,
      startingZoneId: zone.id,
    });
    await setDepartmentTransferSettings(tx, a.id, {
      receivingProfileId: null,
      destinationDepartmentIds: [b.id],
    });
    await setDepartmentTransferSettings(tx, b.id, {
      receivingProfileId: profile!.id,
      destinationDepartmentIds: [],
    });
    return [a.id, b.id, profile!.id];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
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
    beforeCommit: async (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
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
    select d.name as department, p.name as profile, d.id as department_id, d.transfer_desk_profile_id as profile_id
    from departments d join device_profiles p on p.id=d.transfer_desk_profile_id
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

it("round-trips service periods with colours, ordered staff menus and remapped business-day ranges", async () => {
  const source = await applyVenue(planVenue(venue("B24681367"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    await seedBusinessDay(tx, { dayCutover: "04:30:00" });
    const department = await createDepartment(tx, {
      name: "Period transfer",
      orderStart: "table",
    });
    const customer = await createMenu(tx, { name: "Period customer" });
    const staff = [
      { id: "00000000-0000-4000-8000-000000000003", name: "Period staff first" },
      { id: "00000000-0000-4000-8000-000000000001", name: "Period staff second" },
      { id: "00000000-0000-4000-8000-000000000002", name: "Period staff third" },
    ];
    for (const menu of staff) {
      await tx.insert(menus).values(menu);
      await createMenuShell(tx, menu.id);
    }
    const period = await saveMenuPeriod(tx, department.id, {
      name: "Night transfer",
      colour: "blue",
      menuId: customer.id,
      staffMenuIds: staff.map((menu) => menu.id),
    });
    await replaceMenuWeek(
      tx,
      department.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekday === 5 ? [{ periodId: period.id, startsAt: "21:00", endsAt: "03:00" }] : [],
      })),
      new Date("2026-10-07T10:00:00Z"),
      1,
    );
    return [department.id, customer.id, ...staff.map((menu) => menu.id), period.id];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const bundle = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-07T10:00:00Z"),
    versions,
  );
  const period = bundle.tables.menu_periods!.find((row) => row.name === "Night transfer")!;
  expect(period).toMatchObject({
    colour: "blue",
    menu_id: original[1],
  });
  expect(JSON.parse(period.staff_menu_ids as string)).toEqual(original.slice(2, 5));
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(bundle, "a strong passphrase"),
    "a strong passphrase",
  );
  await applyVenue(planVenue(venue("B24681368"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const importedStaff = (
    await targetSuite.db.execute<{ staff_menu_ids: string }>(sql`
    select staff_menu_ids from menu_periods where name = 'Night transfer'`)
  ).rows[0]!;
  const importedMenus = (
    await targetSuite.db.execute<{ id: string; name: string }>(sql`
    select id, name from menus where name like 'Period staff %'`)
  ).rows;
  expect(JSON.parse(importedStaff.staff_menu_ids)).toEqual(
    ["Period staff first", "Period staff second", "Period staff third"].map(
      (name) => importedMenus.find((menu) => menu.name === name)!.id,
    ),
  );
  const seasonsHolding = await targetSuite.db.execute(sql`
    select count(distinct x.season_id) as seasons
    from opening_hours x
    join menu_periods p on p.id=x.period_id where p.name='Night transfer'`);
  expect(seasonsHolding.rows).toEqual([{ seasons: 4 }]);
  const rows = await targetSuite.db.execute(sql`
    select distinct p.id as period_id, d.id as department_id, c.id as customer_id, s.value as staff_id,
      p.name, p.colour, c.name as customer, sc.name as staff, s.key as display_order,
      x.weekday, x.starts_at, x.ends_at
    from menu_periods p join departments d on d.id=p.department_id
    join menus c on c.id=p.menu_id join json_each(p.staff_menu_ids) s
    join menus sc on sc.id=s.value
    join opening_hours x on x.department_id=d.id and x.period_id=p.id
    where p.name='Night transfer' order by s.key`);
  expect(rows.rows).toEqual([
    {
      period_id: expect.any(String),
      department_id: expect.any(String),
      customer_id: expect.any(String),
      staff_id: expect.any(String),

      name: "Night transfer",
      colour: "blue",
      customer: "Period customer",
      staff: "Period staff first",
      display_order: 0,
      weekday: 5,
      starts_at: "21:00:00",
      ends_at: "03:00:00",
    },
    {
      period_id: expect.any(String),
      department_id: expect.any(String),
      customer_id: expect.any(String),
      staff_id: expect.any(String),

      name: "Night transfer",
      colour: "blue",
      customer: "Period customer",
      staff: "Period staff second",
      display_order: 1,
      weekday: 5,
      starts_at: "21:00:00",
      ends_at: "03:00:00",
    },
    {
      period_id: expect.any(String),
      department_id: expect.any(String),
      customer_id: expect.any(String),
      staff_id: expect.any(String),

      name: "Night transfer",
      colour: "blue",
      customer: "Period customer",
      staff: "Period staff third",
      display_order: 2,
      weekday: 5,
      starts_at: "21:00:00",
      ends_at: "03:00:00",
    },
  ]);
  for (const row of rows.rows)
    for (const key of ["period_id", "department_id", "customer_id", "staff_id"])
      expect(original).not.toContain(row[key]);
  const bad = structuredClone(bundle);
  const range = bad.tables.opening_hours!.find((row) => row.period_id === original[5])!;
  range.ends_at = "05:00:00";
  expect(() => validateConfigurationBundle(bad, ALL_MODULES, versions)).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "opening_hours" },
    }),
  );
});

it("transfers order start policies under new department and zone ids", async () => {
  const source = await applyVenue(planVenue(venue("B13572478"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, {
      name: "Order start department",
      orderStart: "table",
    });
    const explicit = await createServiceZone(tx, {
      name: "Counter override",
      departmentId: department.id,
    });
    const inherited = await createServiceZone(tx, {
      name: "Department follower",
      departmentId: department.id,
    });
    await tx.execute(sql`update departments set order_start = 'table'
      where id = ${department.id}`);
    await tx.execute(sql`update floor_zones set order_start = 'counter'
      where id = ${explicit.id}`);
    return { departmentId: department.id, explicitId: explicit.id, inheritedId: inherited.id };
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const exported = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-09T10:00:00Z"),
    versions,
  );
  expect(
    exported.tables.departments!.find((row) => row.id === sourceIds.departmentId)!.order_start,
  ).toBe("table");
  expect(
    exported.tables.floor_zones!.find((row) => row.id === sourceIds.explicitId)!.order_start,
  ).toBe("counter");
  expect(
    exported.tables.floor_zones!.find((row) => row.id === sourceIds.inheritedId)!.order_start,
  ).toBeNull();
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(exported, "a strong passphrase"),
    "a strong passphrase",
  );
  await applyVenue(planVenue(venue("B13572479"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db.execute<{
    department_id: string;
    zone_id: string;
    name: string;
    department_start: string;
    zone_start: string | null;
  }>(sql`select d.id as department_id, z.id as zone_id, z.name,
    d.order_start as department_start, z.order_start as zone_start
    from floor_zones z
    join departments d on d.id = z.department_id
    where d.name = 'Order start department' order by z.name`);
  expect(
    imported.rows.map(({ name, department_start, zone_start }) => ({
      name,
      department_start,
      zone_start,
    })),
  ).toEqual([
    { name: "Counter override", department_start: "table", zone_start: "counter" },
    { name: "Department follower", department_start: "table", zone_start: null },
  ]);
  for (const row of imported.rows) {
    expect(row.department_id).not.toBe(sourceIds.departmentId);
    expect(row.zone_id).not.toBe(sourceIds.explicitId);
    expect(row.zone_id).not.toBe(sourceIds.inheritedId);
  }
});

it("transfers how each department sells and how its till-choice orders start", async () => {
  const source = await applyVenue(planVenue(venue("B13572478"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const choosing = await createDepartment(tx, { name: "Choosing department" });
    await setDepartmentSalePolicyField(tx, choosing.id, "dining", "till_choice");
    await setDepartmentSalePolicyField(tx, choosing.id, "diningStartsAs", "takeaway");
    const takeaway = await createDepartment(tx, { name: "Takeaway department" });
    await setDepartmentSalePolicyField(tx, takeaway.id, "dining", "takeaway");
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const exported = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-09T10:00:00Z"),
    versions,
  );
  const decoded = decodeConfigurationBundle(
    encodeConfigurationBundle(exported, "a strong passphrase"),
    "a strong passphrase",
  );
  await applyVenue(planVenue(venue("B13572479"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
  });
  const imported = await targetSuite.db
    .execute(sql`select name, dining, dining_starts_as from departments
    where name in ('Choosing department', 'Takeaway department') order by name`);
  expect(imported.rows).toEqual([
    { name: "Choosing department", dining: "till_choice", dining_starts_as: "takeaway" },
    { name: "Takeaway department", dining: "takeaway", dining_starts_as: "eat_in" },
  ]);
});

it("transfers department receipt maps and pictures with remapped ids and no venue defaults", async () => {
  const source = await applyVenue(planVenue(venue("B13572476"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const { readDepartmentReceipt, readPrintedDepartmentReceipt, writeDepartmentReceipt } =
    await import("@waitron/venue-service");
  const { resolveReceiptTrim } = await import("@waitron/shared");
  const cfg = {
    receiptLanguages: ["es-ES", "ca-ES"],
  };
  const photo = await samplePreparedImage({ width: 12 });
  const logo = photo.filename;
  const pictures = {
    "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
    "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
  };

  const authored = {
    printAddress: true,
    operationDescription: "Dining service",
    logo,
    email: "dining@example.com",
    headerSubtitle: { "es-ES": "Hola", "ca-ES": "Bon dia" },
    footerMessage: { "ca-ES": "Gràcies" },
  };
  const ids = await withTransaction(suite.db, async (tx) => {
    const own = await createDepartment(tx, { name: "Own receipt" });
    const empty = await createDepartment(tx, { name: "Empty receipt" });
    const imported = await createDepartment(tx, { name: "Bad optional receipt" });
    await uploadImage(tx, { image: photo, names: { es: "Receipt logo" } }, {});
    await writeDepartmentReceipt(tx, own.id, authored, pictures);
    await seedDepartmentReceipt(tx, imported.id, {
      email: "good@example.com",
      headerSubtitle: { "es-ES": "x".repeat(100_000), "ca-ES": "Good" },
    });
    return [own.id, empty.id, imported.id];
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const exported = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-10T00:00:00Z"),
    versions,
  );
  expect(
    exported.tables.departments!.filter((row) => row.receipt_updated_at !== null),
  ).toHaveLength(2);
  expect(exported.tables).not.toHaveProperty("tenant_receipts");

  await applyVenue(planVenue(venue("B13572477"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, exported, ALL_MODULES, versions),
  });

  const imported = await withTransaction(targetSuite.db, async (tx) => {
    const rows = await tx.select().from(departments);
    const idFor = (name: string) => rows.find((row) => row.name === name)!.id;
    const empty = await readDepartmentReceipt(tx, cfg, idFor("Empty receipt"));
    return {
      ids: [idFor("Own receipt"), idFor("Empty receipt"), idFor("Bad optional receipt")],
      own: await readDepartmentReceipt(tx, cfg, idFor("Own receipt")),
      printed: await readPrintedDepartmentReceipt(tx, cfg, idFor("Own receipt"), "58mm"),
      empty,
      inherited: resolveReceiptTrim(empty, {}, "es-ES", "es-ES"),
      bad: await readDepartmentReceipt(tx, cfg, idFor("Bad optional receipt")),
    };
  });
  for (const id of imported.ids) expect(ids).not.toContain(id);
  expect(imported.own).toEqual(authored);
  expect(imported.printed.logo).toEqual({
    widthDots: 8,
    heightDots: 1,
    bits: new Uint8Array([128]),
  });
  expect(imported.empty).toEqual({});
  expect(imported.inherited).toEqual({});
  expect(imported.bad).toEqual({ email: "good@example.com", headerSubtitle: { "ca-ES": "Good" } });
});

describe("a deleted printer in a configuration transfer", () => {
  /** A venue with a live, a disabled and a deleted printer. The deleted one had a station, a
   * profile list, a holder, a job and a drawer audit before its delete; afterwards a station and
   * a profile row naming it are written straight into the tables, a state the
   * delete never leaves, so the exporter's own exclusion is what keeps them out. */
  async function venueWithDeletedPrinter(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const ids = await withTransaction(suite.db, async (tx) => {
      const [live, disabled, old] = await tx
        .insert(printers)
        .values([
          {
            name: "Live bar",
            transport: "cloud_poll" as const,
            pollId: "poll-live",
            pollTokenHash: "live-poll-hash",
          },
          {
            name: "Disabled bar",
            transport: "network_tcp" as const,
            host: "10.0.3.2",
            active: false,
          },
          {
            name: "Old kitchen",
            transport: "cloud_poll" as const,
            pollId: "poll-old",
            pollTokenHash: "old-poll-hash",
            portable: true,
          },
        ])
        .returning({ id: printers.id });
      const [station] = await tx
        .insert(kitchenStations)
        .values({ name: "Grill" })
        .returning({ id: kitchenStations.id });
      const [profile] = await seedDeviceProfiles(tx, { name: "Counter till", formFactor: "till" });
      await attachStationPrinterForTest(tx, station!.id, live!.id);
      await attachStationPrinterForTest(tx, station!.id, old!.id);
      await setProfilePrinterLists(tx, profile!.id, {
        ...emptyPrinterLists(),
        receiptPrinterIds: [old!.id, live!.id],
      });
      return {
        live: live!.id,
        disabled: disabled!.id,
        old: old!.id,
        station: station!.id,
        profile: profile!.id,
      };
    });
    const { deviceId } = await seedDevice(suite.db, {});
    await holdPrinterForTest(suite.db, ids.old, deviceId);
    await suite.db.insert(printJobs).values([
      { printerId: ids.old, payload: new Uint8Array([1]) },
      {
        printerId: ids.live,
        payload: new Uint8Array([2]),
        status: "done",
      },
    ]);
    await suite.db
      .insert(drawerOpens)
      .values({ printerId: ids.old, personId: "admin", reason: "calibration" });
    await withTransaction(suite.db, (tx) => deletePrinter(tx, ids.old));
    await attachStationPrinterForTest(suite.db, ids.station, ids.old);
    await suite.db.insert(deviceProfilePrinters).values({
      deviceProfileId: ids.profile,
      printerId: ids.old,
      role: "payment_slip",
      position: 0,
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-10T12:00:00Z"),
      versions,
    );
    return { source, ids, versions, transferred };
  }

  it("leaves the deleted printer and every row naming it behind, and the rest arrives switched off under new ids", async () => {
    const { ids, versions, transferred } = await venueWithDeletedPrinter("B30303031");
    expect(
      transferred.tables.printers!.map((row) => [row.id, row.name, row.deleted_at]).sort(),
    ).toEqual(
      [
        [ids.disabled, "Disabled bar", null],
        [ids.live, "Live bar", null],
      ].sort(),
    );
    for (const row of transferred.tables.printers!)
      expect(row).not.toHaveProperty("poll_token_hash");
    expect(JSON.stringify(transferred)).not.toContain("poll-hash");
    expect(
      transferred.tables.kitchen_stations!.find((row) => row.id === ids.station)!.printer_ids,
    ).toBe(JSON.stringify([ids.live]));
    expect(
      transferred.tables.device_profile_printers!.map((row) => [
        row.device_profile_id,
        row.printer_id,
      ]),
    ).toEqual([[ids.profile, ids.live]]);
    for (const table of ["print_jobs", "drawer_opens"])
      expect(transferred.tables).not.toHaveProperty(table);
    expect(transferred.reconnect).toContain("printers");

    await applyVenue(planVenue(venue("B30303032"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });

    const imported = await targetSuite.db
      .select({
        id: printers.id,
        name: printers.name,
        active: printers.active,
        deletedAt: printers.deletedAt,
        pollTokenHash: printers.pollTokenHash,
      })
      .from(printers)
      .orderBy(printers.name);
    expect(imported).toEqual([
      {
        id: expect.any(String),
        name: "Disabled bar",
        active: false,
        deletedAt: null,
        pollTokenHash: null,
      },
      {
        id: expect.any(String),
        name: "Live bar",
        active: false,
        deletedAt: null,
        pollTokenHash: null,
      },
    ]);
    for (const row of imported) expect([ids.live, ids.disabled, ids.old]).not.toContain(row.id);
    const live = imported.find((row) => row.name === "Live bar")!;
    expect(
      (
        await targetSuite.db
          .select({ printerId: stationPrinterPairs.printerId })
          .from(stationPrinterPairs)
      ).map((row) => row.printerId),
    ).toEqual([live.id]);
    expect(
      (
        await targetSuite.db
          .select({ printerId: deviceProfilePrinters.printerId })
          .from(deviceProfilePrinters)
      ).map((row) => row.printerId),
    ).toEqual([live.id]);
    expect(await targetSuite.db.select().from(printJobs)).toEqual([]);
    expect(await readPrinterHoldsForTest(targetSuite.db)).toEqual([]);
    expect(await targetSuite.db.select().from(drawerOpens)).toEqual([]);
  });

  it("refuses a bundle carrying a deleted printer and a setting naming it, at staging and at import, before writing anything", async () => {
    const { ids, versions, transferred } = await venueWithDeletedPrinter("B30303033");
    const forged: ConfigurationBundle = {
      ...transferred,
      tables: {
        ...transferred.tables,
        printers: [
          ...transferred.tables.printers!,
          {
            ...transferred.tables.printers!.find((row) => row.id === ids.live)!,
            id: ids.old,
            name: "Old kitchen",
            poll_id: "poll-old",
            deleted_at: "2026-10-10T10:00:00.000Z",
          },
        ],
        kitchen_stations: transferred.tables.kitchen_stations!.map((row) =>
          row.id === ids.station
            ? { ...row, printer_ids: JSON.stringify([ids.live, ids.old]) }
            : row,
        ),
      },
    };
    const refusal = { code: "setup.request_invalid", params: { field: "printers.deleted_at" } };
    expect(() => validateConfigurationBundle(forged, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );

    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    try {
      const names = [
        "flows/setup/import/artifact",
        "flows/setup/import/key",
        "flows/setup/import/marker.json",
      ];
      for (const name of names) {
        await mkdir(dirname(join(stateDir, name)), { recursive: true });
        await writeFile(join(stateDir, name), `retained ${name}`);
      }
      const ring = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 17).toString("base64"),
      });
      await expect(
        stageConfigurationImport(
          stateDir,
          ring,
          encodeConfigurationBundle(forged, "a strong passphrase"),
          "a strong passphrase",
          async (decoded) => {
            validateConfigurationBundle(decoded, ALL_MODULES, versions);
            return ALL_MODULES;
          },
        ),
      ).rejects.toMatchObject(refusal);
      expect((await readdir(join(stateDir, "flows/setup/import"))).sort()).toEqual([
        "artifact",
        "key",
        "marker.json",
      ]);
      for (const name of names)
        expect(await readFile(join(stateDir, name), "utf8")).toBe(`retained ${name}`);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }

    const counts = async () =>
      (
        await targetSuite.db.execute<Record<string, number>>(sql`
          select (select count(*) from taxpayer) as taxpayer,
                 (select count(*) from printers) as printers,
                 (select coalesce(sum(json_array_length(printer_ids)), 0) from kitchen_stations) as station_printers,
                 (select count(*) from kitchen_stations) as kitchen_stations
        `)
      ).rows[0];
    const before = await counts();
    const target = venue("B30303034");
    await expect(
      applyVenue(planVenue(target, ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, forged, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    expect(await counts()).toEqual(before);
  });
});

it("refuses an absent leaveBehindWhenFalse column before exporting", async () => {
  await applyVenue(planVenue(venue("B55558888"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const module = {
    name: "probe",
    configurationTransfer: {
      kind: "tables",
      tables: [{ name: "device_profiles", leaveBehindWhenFalse: "missing_active" }],
    },
  } as unknown as WaitronModule;
  await expect(exportConfigurationTables(suite.db, [module])).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "device_profiles.missing_active" },
  });
});

it("round-trips deleted kitchen configuration and preserves archived products and empty profile bounds", async () => {
  const source = await applyVenue(planVenue(venue("B12348765"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  nodeId(source.nodeId);
  const ids = await withTransaction(suite.db, async (tx) => {
    for (const course of await tx.select({ id: kitchenCourses.id }).from(kitchenCourses))
      await deleteCourse(tx, course.id);
    const course = await createCourse(tx, { name: "Retired dessert", displayOrder: 2 });
    const station = await createStation(tx, { name: "Retired pastry" });
    const product = await createProduct(tx, {
      name: "Archived flan",
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "general",
    });
    await setProductCourse(tx, product.id, course.id);
    await updateProduct(tx, product.id, { active: false });
    const [profile] = await seedDeviceProfiles(tx, { name: "Bound till", formFactor: "till" });
    await VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
      station: { stationIds: [station.id], zoneIds: null },
    });
    await setRoutingCell(
      tx,
      { row: { kind: "product", productId: product.id }, zoneId: null },
      { kind: "station", stationId: station.id },
    );
    await deleteCourse(tx, course.id);
    await deleteStation(tx, station.id);
    const live = await createCourse(tx, { name: "Live starters", displayOrder: 0 });
    await tx
      .update(kitchenCourses)
      .set({ starterKey: "mains" })
      .where(eq(kitchenCourses.id, live.id));
    return {
      course: course.id,
      station: station.id,
      product: product.id,
      profile: profile!.id,
      live: live.id,
    };
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-10T12:00:00Z"),
    versions,
  );
  expect(
    transferred.tables.kitchen_courses!.map(({ id, name, active, starter_key }) => ({
      id,
      name,
      active,
      starter_key,
    })),
  ).toEqual([{ id: ids.live, name: "Live starters", active: 1, starter_key: "mains" }]);
  expect(transferred.tables.kitchen_stations!.some((row) => row.id === ids.station)).toBe(false);
  const archived = transferred.tables.products!.find((row) => row.id === ids.product)!;
  expect(archived).toBeDefined();
  expect(archived.active).toBe(0);
  expect(archived.course_id).toBeNull();
  expect(transferred.tables.device_profile_kitchen_screen_stations).toEqual([]);
  expect(
    transferred.tables.device_profile_kitchen_screens!.filter(
      (row) => row.device_profile_id === ids.profile,
    ),
  ).toEqual([
    {
      device_profile_id: ids.profile,
      screen: "station",
      every_station: 0,
      every_zone: 0,
      show_non_pass_stations: 1,
    },
  ]);
  for (const table of ["kitchen_courses", "kitchen_stations"]) {
    const forged = {
      ...transferred,
      tables: {
        ...transferred.tables,
        [table]: transferred.tables[table]!.map((row) => ({ ...row, active: 0 })),
      },
    };
    const refusal = { code: "setup.request_invalid", params: { field: `${table}.active` } };
    expect(() => validateConfigurationBundle(forged, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(refusal),
    );
    await expect(
      applyVenue(planVenue(venue("B98765431"), ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, forged, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(refusal);
    const rows = await targetSuite.db.execute(sql`select count(*) as count from taxpayer`);
    expect(rows.rows).toEqual([{ count: 0 }]);
  }
  await applyVenue(planVenue(venue("B98765431"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const imported = await withTransaction(targetSuite.db, async (tx) => ({
    courses: await tx.select().from(kitchenCourses),
    stations: await tx.select({ name: kitchenStations.name }).from(kitchenStations),
    products: await tx
      .select({
        id: products.id,
        name: products.name,
        active: products.active,
        courseId: products.courseId,
      })
      .from(products)
      .where(eq(products.name, "Archived flan")),
    screens: (await VENUE_SERVICE.readProfileKitchenScreens(tx)).filter(
      (row) => row.screens.station !== undefined,
    ),
  }));
  expect(
    imported.courses.map(({ id, name, active, starterKey }) => ({ id, name, active, starterKey })),
  ).toEqual([
    { id: imported.courses[0]!.id, name: "Live starters", active: true, starterKey: "mains" },
  ]);
  expect(imported.courses[0]!.id).not.toBe(ids.live);
  expect(imported.stations.some((row) => row.name === "Retired pastry")).toBe(false);
  expect(imported.products).toEqual([
    { id: imported.products[0]!.id, name: "Archived flan", active: false, courseId: null },
  ]);
  expect(imported.products[0]!.id).not.toBe(ids.product);
  const [bound] = imported.screens;
  expect(bound).toBeDefined();
  expect(bound!.profileId).not.toBe(ids.profile);
  expect(bound!.screens).toEqual({ station: { stationIds: [], zoneIds: null } });
});

it("round-trips a deleted service hierarchy while remapping only its live namesake and floor links", async () => {
  const source = await applyVenue(planVenue(venue("B12348765"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const cfg: TradingContext = {
    nodeId: nodeId(source.nodeId),
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const removals = enabledTableRemovals(ALL_MODULES);
  const ids = await withTransaction(suite.db, async (tx) => {
    const old = await createDepartment(tx, {
      name: "Shared service name",
      tradingName: "Retained brand",
    });
    const zone = await createServiceZone(tx, {
      name: "Shared zone name",
      departmentId: old.id,
    });
    await seedDepartmentReceipt(tx, old.id, { headerSubtitle: { "es-ES": "Retained subtitle" } });
    await createTable(tx, cfg, { label: "Old table", zoneId: zone.id });
    await deleteDepartment(
      tx,
      moduleCoreServices(cfg, removals, () => new Date()).floorDeletion,
      old.id,
      new Date("2026-10-11T12:00:00Z"),
    );
    const live = await createDepartment(tx, {
      name: "Shared service name",
      tradingName: "Live brand",
    });
    const liveZone = await createServiceZone(tx, {
      name: "Shared zone name",
      departmentId: live.id,
    });
    await seedDepartmentReceipt(tx, live.id, { headerSubtitle: { "es-ES": "Live subtitle" } });
    await createTable(tx, cfg, { label: "Live table", zoneId: liveZone.id });
    await saveLayout(
      tx,
      removals,
      await defaultLayout(tx, cfg, liveZone.id),
      {
        revision: 0,
        tables: [
          {
            key: "live",
            label: "Live table",
            fixed: false,
            seats: 2,
            placement: { x: 0, y: 0, width: 8, height: 8, rotation: 0, shape: "rect" },
            partKeys: [],
          },
        ],
      },
      new Date("2026-10-11T12:00:00Z"),
    );
    const [linked] = await tx
      .select()
      .from(diningTables)
      .where(eq(diningTables.zoneId, liveZone.id));
    return {
      old: old.id,
      oldZone: zone.id,
      live: live.id,
      liveZone: liveZone.id,
      table: linked!.id,
    };
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-11T12:00:00Z"),
    versions,
  );
  expect(
    transferred.tables
      .departments!.filter((row) => row.name === "Shared service name")
      .map((row) => row.id),
  ).toEqual([ids.live]);
  expect(
    transferred.tables
      .floor_zones!.filter((row) => row.name === "Shared zone name")
      .map((row) => row.id),
  ).toEqual([ids.liveZone]);
  expect(transferred.tables.departments!.filter((row) => row.receipt_updated_at !== null)).toEqual([
    expect.objectContaining({
      id: ids.live,
      receipt_text: JSON.stringify({ headerSubtitle: { "es-ES": "Live subtitle" } }),
      receipt_logo_rasters: null,
      receipt_updated_at: expect.any(String),
    }),
  ]);
  for (const table of ["departments", "floor_zones"])
    expect(JSON.stringify(transferred.tables[table])).not.toContain(ids.old);
  expect(JSON.stringify(transferred.tables.floor_zones)).not.toContain(ids.oldZone);
  expect(transferred.tables.dining_tables!.map((row) => row.id)).toEqual([ids.table]);
  await applyVenue(planVenue(venue("B98765431"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const rows = await targetSuite.db.execute<{
    department: string;
    zone: string;
    table_id: string;
    receipt: string;
  }>(
    sql`select d.id department, z.id zone, t.id table_id, d.receipt_text as receipt from departments d join floor_zones z on z.department_id=d.id join dining_tables t on t.zone_id=z.id where d.name='Shared service name'`,
  );
  expect(rows.rows).toHaveLength(1);
  const imported = rows.rows[0]!;
  expect(imported.department).not.toBe(ids.live);
  expect(imported.zone).not.toBe(ids.liveZone);
  expect(imported.table_id).not.toBe(ids.table);
  expect(imported.receipt).toBe(JSON.stringify({ headerSubtitle: { "es-ES": "Live subtitle" } }));
  const links = await targetSuite.db.execute(
    sql`select f.zone_id, t.id table_id from floor_plans f join floor_plan_tables p on p.zone_id=f.zone_id join dining_tables t on t.plan_table_id=p.id where f.zone_id=${imported.zone}`,
  );
  expect(links.rows).toEqual([{ zone_id: imported.zone, table_id: imported.table_id }]);
});

it("carries Long table's parts, naming the imported tables", async () => {
  const source = await applyVenue(planVenue(venue("B12348765"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const cfg: TradingContext = {
    nodeId: nodeId(source.nodeId),
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const removals = enabledTableRemovals(ALL_MODULES);
  const offPlan = (key: string, label: string, seats: number) => ({
    key,
    label,
    fixed: false,
    seats,
    placement: null,
    partKeys: [],
  });
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Joined service" });
    const zone = await createServiceZone(tx, {
      name: "Joined zone",
      departmentId: department.id,
    });
    const { ids } = await saveLayout(
      tx,
      removals,
      await defaultLayout(tx, cfg, zone.id),
      {
        revision: 0,
        tables: [
          offPlan("c3", "Counter 3", 2),
          offPlan("c4", "Counter 4", 6),
          offPlan("c5", "Counter 5", 4),
          {
            key: "long",
            label: "Long table",
            fixed: false,
            seats: 10,
            placement: { x: 0, y: 0, width: 8, height: 8, rotation: 0, shape: "rect" },
            partKeys: ["c3", "c4", "c5"],
          },
        ],
      },
      new Date("2026-10-11T12:00:00Z"),
    );
    return Object.values(ids);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-11T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B98765431"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const rows = await targetSuite.db.execute<{
    id: string;
    joined_id: string;
    joined: string;
    part_id: string;
    part: string;
  }>(
    sql`select p.id, j.id joined_id, j.label joined, p.id part_id, p.label part from floor_plan_tables p join floor_plan_tables j on j.id=p.part_of_table_id join floor_zones z on z.id=j.zone_id where z.name='Joined zone' order by p.label`,
  );
  expect(rows.rows.map((row) => [row.joined, row.part])).toEqual([
    ["Long table", "Counter 3"],
    ["Long table", "Counter 4"],
    ["Long table", "Counter 5"],
  ]);
  for (const row of rows.rows)
    for (const id of [row.id, row.joined_id, row.part_id]) expect(sourceIds).not.toContain(id);
});

it("carries a kept size, naming the imported table", async () => {
  const source = await applyVenue(planVenue(venue("B12348765"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const cfg: TradingContext = {
    nodeId: nodeId(source.nodeId),
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const sourceIds = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Sized service" });
    const zone = await createServiceZone(tx, {
      name: "Sized zone",
      departmentId: department.id,
    });
    const { ids } = await saveLayout(
      tx,
      enabledTableRemovals(ALL_MODULES),
      await defaultLayout(tx, cfg, zone.id),
      {
        revision: 0,
        tables: [
          { key: "c3", label: "Counter 3", fixed: false, seats: 2, placement: null, partKeys: [] },
        ],
      },
      new Date("2026-10-11T12:00:00Z"),
    );
    await tx.execute(
      sql`insert into floor_plan_placements (id, plan_id, plan_table_id, width, height) values (${randomUUID()}, (select id from floor_plans where zone_id = ${zone.id}), ${ids.c3!}, 2, 2)`,
    );
    return Object.values(ids);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const transferred = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-11T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B98765431"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
  });
  const rows = await targetSuite.db.execute<{
    plan_table_id: string;
    label: string;
    width: number;
    height: number;
  }>(
    sql`select s.plan_table_id, p.label, s.width, s.height from floor_plan_placements s join floor_plan_tables p on p.id=s.plan_table_id`,
  );
  expect(rows.rows).toEqual([
    { plan_table_id: expect.any(String), label: "Counter 3", width: 2, height: 2 },
  ]);
  expect(sourceIds).not.toContain(rows.rows[0]!.plan_table_id);
});

describe("dated business-day configuration transfer", () => {
  it("exports the active start, leaves history behind and imports a fresh clock", async () => {
    const source = await applyVenue(planVenue(venue("B77112233"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    await withTransaction(suite.db, async (tx) => {
      const department = await createDepartment(tx, {
        name: "Clock service",
        orderStart: "table",
      });
      const menu = await createMenu(tx, { name: "Clock menu" });
      const period = await saveMenuPeriod(tx, department.id, {
        name: "Clock period",
        menuId: menu.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        department.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }],
        })),
        new Date("2026-11-02T12:00:00Z"),
        1,
      );
    });
    await suite.db.insert(dayCutoverChanges).values([
      { effectiveBusinessDay: "2026-11-04", dayCutover: "03:00:00" },
      { effectiveBusinessDay: "2026-11-10", dayCutover: "07:00:00" },
    ]);
    await suite.db
      .update(businessDaySettingsTable)
      .set({ revision: 5 })
      .where(eq(businessDaySettingsTable.module, "business_day"));
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const exported = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-11-10T08:00:00Z"),
      versions,
    );
    expect(exported.venue.dayCutover).toBe("07:00:00");
    expect(exported.tables).not.toHaveProperty("day_cutover_changes");
    expect(exported.settings).not.toHaveProperty("business_day");
    const request = venue("B33221177");
    request.dayCutover = exported.venue.dayCutover;
    await applyVenue(planVenue(request, ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, exported, ALL_MODULES, versions),
    });
    const model = await withTransaction(targetSuite.db, (tx) =>
      readVenueDetails(tx, new Date("2026-11-10T08:00:00Z")),
    );
    expect(model.businessDayClock).toEqual({
      clock: { timeZone: "Europe/Madrid", dayCutover: "07:00", cutoverChanges: [] },
      revision: 1,
      currentBusinessDay: "2026-11-10",
      pending: null,
    });
    const slots = await targetSuite.db.execute<{
      weekday: number;
      startsAt: string;
      endsAt: string;
    }>(sql`
      select distinct s.weekday, s.starts_at as "startsAt", s.ends_at as "endsAt"
      from opening_hours s join menu_periods p on p.id=s.period_id
      where p.name='Clock period' order by s.weekday`);
    const seasonsHolding = await targetSuite.db.execute(sql`
      select count(distinct s.season_id) as seasons
      from opening_hours s
      join menu_periods p on p.id=s.period_id where p.name='Clock period'`);
    expect(seasonsHolding.rows).toEqual([{ seasons: 4 }]);
    expect(slots.rows).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startsAt: "09:00:00",
        endsAt: "17:00:00",
      })),
    );
    expect(await targetSuite.db.select().from(dayCutoverChanges)).toEqual([
      { effectiveBusinessDay: "2000-01-01", dayCutover: "07:00:00" },
    ]);
    expect(
      await targetSuite.db
        .select({ revision: businessDaySettingsTable.revision })
        .from(businessDaySettingsTable)
        .where(eq(businessDaySettingsTable.module, "business_day")),
    ).toEqual([{ revision: 1 }]);
    expect(await suite.db.select().from(dayCutoverChanges)).toHaveLength(3);
    expect(
      await suite.db
        .select({ revision: businessDaySettingsTable.revision })
        .from(businessDaySettingsTable)
        .where(eq(businessDaySettingsTable.module, "business_day")),
    ).toEqual([{ revision: 5 }]);
  });

  it("keeps dated target history when configuration is imported", async () => {
    const target = await applyVenue(planVenue(venue("B77112233"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    await suite.db.insert(dayCutoverChanges).values({
      effectiveBusinessDay: "2026-11-04",
      dayCutover: "03:00:00",
    });
    await suite.db
      .update(businessDaySettingsTable)
      .set({ revision: 2 })
      .where(eq(businessDaySettingsTable.module, "business_day"));
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const exported = await buildConfigurationBundle(
      suite.db,
      {
        ...target,
        sourceOperatorId: suite.db.all<{ id: string }>(
          sql`select id from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')`,
        )[0]!.id,
      },
      ALL_MODULES,
      new Date("2026-11-05T12:00:00Z"),
      versions,
    );
    const rows = await suite.db.select().from(dayCutoverChanges);
    const model = await withTransaction(suite.db, (tx) =>
      readVenueDetails(tx, new Date("2026-11-05T12:00:00Z")),
    );
    await withTransaction(suite.db, (tx) =>
      importConfigurationTables(tx, exported, ALL_MODULES, versions),
    );
    expect(
      await withTransaction(suite.db, (tx) =>
        readVenueDetails(tx, new Date("2026-11-05T12:00:00Z")),
      ),
    ).toEqual(model);
    expect(await suite.db.select().from(dayCutoverChanges)).toEqual(rows);
    expect(
      await suite.db
        .select({ revision: businessDaySettingsTable.revision })
        .from(businessDaySettingsTable)
        .where(eq(businessDaySettingsTable.module, "business_day")),
    ).toEqual([{ revision: 2 }]);
  });

  it("refuses pending export even before and during the transition lock", async () => {
    const source = await applyVenue(planVenue(venue("B77112233"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    await suite.db.insert(dayCutoverChanges).values({
      effectiveBusinessDay: "2026-11-04",
      dayCutover: "07:00:00",
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    for (const at of ["2026-11-02T12:00:00Z", "2026-11-04T05:59:59.999Z"]) {
      await expect(
        buildConfigurationBundle(suite.db, source, ALL_MODULES, new Date(at), versions),
      ).rejects.toMatchObject({
        code: "setup.request_invalid",
        params: { field: "businessDayStart" },
      });
    }
    expect(await suite.db.select().from(dayCutoverChanges)).toHaveLength(2);
  });
});

describe("seasons in a configuration transfer", () => {
  // 21:00 in Madrid (UTC+1): Saturday 30 November 2030 is in Harvest, Saturday 7 December in Winter.
  const HARVEST_SATURDAY = new Date("2030-11-30T20:00:00Z");
  const WINTER_SATURDAY = new Date("2030-12-07T20:00:00Z");
  const saturday = <T>(entries: T[]) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === 6 ? entries : []));

  async function seasonsOf(db: typeof suite.db) {
    return db
      .select({ name: seasons.name, startsOn: seasons.startsOn, colour: seasons.colour })
      .from(seasons)

      .orderBy(seasons.startsOn);
  }

  async function saturdays(db: typeof suite.db) {
    const rows = await db.execute(sql`
      select s.name as season, p.name as period, r.starts_at, r.ends_at
      from opening_hours r
      join seasons s on s.id=r.season_id join menu_periods p on p.id=r.period_id
      join departments dep on dep.id=r.department_id
      where dep.name='Season transfer' and r.weekday=6 and s.name in ('Harvest', ${STARTER_SEASON_NAMES.Winter.es})
      order by s.starts_on`);
    return rows.rows;
  }

  it("arrives as exactly the exported seasons, and the imported venue sells and closes by them", async () => {
    const source = await applyVenue(planVenue(venue("B35792468"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(seasons)
        .set({ name: "Harvest", startsOn: "09-15", colour: "teal" })
        .where(and(eq(seasons.name, STARTER_SEASON_NAMES.Autumn.es)));
      const ids = new Map(
        (await tx.select({ id: seasons.id, name: seasons.name }).from(seasons)).map((season) => [
          season.name,
          season.id,
        ]),
      );
      const department = await createDepartment(tx, {
        name: "Season transfer",
        orderStart: "table",
      });
      const period = async (name: string) =>
        (
          await saveMenuPeriod(tx, department.id, {
            name,
            menuId: (await createMenu(tx, { name: `${name} menu` })).id,
            staffMenuIds: [],
          })
        ).id;
      const dinner = await period("Dinner");
      const lateBar = await period("Late bar");
      const week = (periodId: string) =>
        saturday([{ periodId, startsAt: "20:00", endsAt: "02:00" }]).map((slots, weekday) => ({
          weekday,
          slots,
        }));
      await replaceMenuWeek(tx, department.id, week(dinner), HARVEST_SATURDAY, 1, {
        seasonId: ids.get("Harvest")!,
      });
      await replaceMenuWeek(tx, department.id, week(lateBar), HARVEST_SATURDAY, 1, {
        seasonId: ids.get(STARTER_SEASON_NAMES.Winter.es)!,
      });
      const terrace = await createServiceZone(tx, {
        name: "Season terrace",
        departmentId: department.id,
      });
      await replaceZoneClosedWeek(
        tx,
        terrace.id,
        saturday([{ startsAt: "20:00", endsAt: "23:00" }]).map((ranges, weekday) => ({
          weekday,
          ranges,
        })),
        1,
        HARVEST_SATURDAY,
        { seasonId: ids.get(STARTER_SEASON_NAMES.Winter.es)! },
      );
    });
    const exported = await seasonsOf(suite.db);
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const bundle = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-07T10:00:00Z"),
      versions,
    );
    const decoded = decodeConfigurationBundle(
      encodeConfigurationBundle(bundle, "a strong passphrase"),
      "a strong passphrase",
    );
    await applyVenue(planVenue(venue("B35792469"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
    });

    expect(exported).toEqual([
      { name: STARTER_SEASON_NAMES.Spring.es, startsOn: "03-01", colour: "green" },
      { name: STARTER_SEASON_NAMES.Summer.es, startsOn: "06-01", colour: "amber" },
      { name: "Harvest", startsOn: "09-15", colour: "teal" },
      { name: STARTER_SEASON_NAMES.Winter.es, startsOn: "12-01", colour: "blue" },
    ]);
    expect(await seasonsOf(targetSuite.db)).toEqual(exported);
    expect(await saturdays(targetSuite.db)).toEqual([
      { season: "Harvest", period: "Dinner", starts_at: "20:00:00", ends_at: "02:00:00" },
      {
        season: STARTER_SEASON_NAMES.Winter.es,
        period: "Late bar",
        starts_at: "20:00:00",
        ends_at: "02:00:00",
      },
    ]);
    expect(await saturdays(targetSuite.db)).toEqual(await saturdays(suite.db));

    const [department] = await targetSuite.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.name, "Season transfer"));
    const zone = await targetSuite.db.execute<{ id: string }>(
      sql`select id from floor_zones where name='Season terrace'`,
    );
    const answers = await withTransaction(targetSuite.db, async (tx) => ({
      harvest: await VENUE_SERVICE.resolveDepartmentService(tx, department!.id, HARVEST_SATURDAY),
      winter: await VENUE_SERVICE.resolveDepartmentService(tx, department!.id, WINTER_SATURDAY),
      closedInHarvest: await VENUE_SERVICE.closedZoneIdsAt(tx, HARVEST_SATURDAY, [
        zone.rows[0]!.id,
      ]),
      closedInWinter: await VENUE_SERVICE.closedZoneIdsAt(tx, WINTER_SATURDAY, [zone.rows[0]!.id]),
    }));
    expect(answers.harvest).toMatchObject({ open: true, periodName: "Dinner" });
    expect(answers.winter).toMatchObject({ open: true, periodName: "Late bar" });
    expect([...answers.closedInHarvest]).toEqual([]);
    expect([...answers.closedInWinter]).toEqual([zone.rows[0]!.id]);
  });
});

describe("special days in a configuration transfer", () => {
  // 21:30 in Madrid (UTC+2) on Thursday 15 and Friday 16 August 2030.
  const FIESTA_EVENING = new Date("2030-08-15T19:30:00Z");
  const CLOSED_EVENING = new Date("2030-08-16T19:30:00Z");

  async function fiestaRows(db: typeof suite.db) {
    const paint = await db.execute(sql`
      select s.name, s.repeats_yearly, d.date, d.closed_all_day, dep.name as department,
        p.name as period, r.starts_at, r.ends_at
      from special_days s join special_day_dates d on d.special_day_id=s.id
      left join opening_hours r on r.special_day_date_id=d.id and r.department_id is not null
      left join departments dep on dep.id=r.department_id
      left join menu_periods p on p.id=r.period_id

      order by d.date, r.starts_at`);
    const zones = await db.execute(sql`
      select d.date, z.name as zone, r.kind, r.starts_at, r.ends_at
      from special_day_dates d join opening_hours r on r.special_day_date_id=d.id
      join floor_zones z on z.id=r.zone_id
       order by d.date, r.starts_at`);
    return { paint: paint.rows, zones: zones.rows };
  }

  /** Fiesta repeats from 15 August 2029: Bar 20:00–23:00 and Closed 12:00–16:00, the terrace
   *  closed 21:00–22:00; its 16 August is Closed all day. */
  async function fiestaVenue(cif: string) {
    const source = await applyVenue(planVenue(venue(cif), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const department = await createDepartment(tx, {
        name: "Fiesta restaurant",
        orderStart: "table",
      });
      const { id: bar } = await saveMenuPeriod(tx, department.id, {
        name: "Bar",
        menuId: (await createMenu(tx, { name: "Fiesta bar menu" })).id,
        staffMenuIds: [],
      });
      const terrace = await createServiceZone(tx, {
        name: "Fiesta terrace",
        departmentId: department.id,
      });
      const [fiesta, fifteenth, sixteenth, terraceDay] = [1, 2, 3, 4].map(() => randomUUID());
      await tx.execute(sql`insert into special_days (id, name, repeats_yearly)
        values (${fiesta}, 'Fiesta', 1)`);
      await tx.execute(sql`insert into special_day_dates (id, special_day_id, date, closed_all_day)
        values (${fifteenth}, ${fiesta}, '2029-08-15', 0),
          (${sixteenth}, ${fiesta}, '2029-08-16', 1)`);
      await tx.execute(sql`insert into opening_hours (id, special_day_date_id, department_id, kind, period_id, starts_at, ends_at)
        values (${randomUUID()}, ${fifteenth}, ${department.id}, 'period', ${bar}, '20:00:00', '23:00:00'),
          (${randomUUID()}, ${fifteenth}, ${department.id}, 'closed', null, '12:00:00', '16:00:00')`);
      await tx.execute(sql`insert into opening_hours
        (id, zone_id, special_day_date_id, kind, starts_at, ends_at)
        values (${terraceDay}, ${terrace.id}, ${fifteenth}, 'closed', '21:00:00', '22:00:00')`);
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const bundle = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-10-07T10:00:00Z"),
      versions,
    );
    return { source, versions, bundle };
  }

  it("arrives by value under the importing venue, and the imported venue serves and closes by it", async () => {
    const { versions, bundle } = await fiestaVenue("B35792474");
    const decoded = decodeConfigurationBundle(
      encodeConfigurationBundle(bundle, "a strong passphrase"),
      "a strong passphrase",
    );
    await applyVenue(planVenue(venue("B35792475"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, decoded, ALL_MODULES, versions),
    });
    const exported = await fiestaRows(suite.db);
    expect(exported).toEqual({
      paint: [
        {
          name: "Fiesta",
          repeats_yearly: 1,
          date: "2029-08-15",
          closed_all_day: 0,
          department: "Fiesta restaurant",
          period: null,
          starts_at: "12:00:00",
          ends_at: "16:00:00",
        },
        {
          name: "Fiesta",
          repeats_yearly: 1,
          date: "2029-08-15",
          closed_all_day: 0,
          department: "Fiesta restaurant",
          period: "Bar",
          starts_at: "20:00:00",
          ends_at: "23:00:00",
        },
        {
          name: "Fiesta",
          repeats_yearly: 1,
          date: "2029-08-16",
          closed_all_day: 1,
          department: null,
          period: null,
          starts_at: null,
          ends_at: null,
        },
      ],
      zones: [
        {
          date: "2029-08-15",
          zone: "Fiesta terrace",
          kind: "closed",
          starts_at: "21:00:00",
          ends_at: "22:00:00",
        },
      ],
    });
    expect(await fiestaRows(targetSuite.db)).toEqual(exported);

    const [department] = await targetSuite.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.name, "Fiesta restaurant")));
    const zone = await targetSuite.db.execute<{ id: string }>(
      sql`select z.id from floor_zones z
        where z.name='Fiesta terrace'`,
    );
    const answers = await withTransaction(targetSuite.db, async (tx) => ({
      fiesta: await VENUE_SERVICE.resolveDepartmentService(tx, department!.id, FIESTA_EVENING),
      closedAllDay: await VENUE_SERVICE.resolveDepartmentService(
        tx,
        department!.id,
        CLOSED_EVENING,
      ),
      terrace: await VENUE_SERVICE.closedZoneIdsAt(tx, FIESTA_EVENING, [zone.rows[0]!.id]),
    }));
    expect(answers.fiesta).toMatchObject({ open: true, periodName: "Bar" });
    expect(answers.closedAllDay).toMatchObject({ open: false });
    expect([...answers.terrace]).toEqual([zone.rows[0]!.id]);
  });

  it("refuses a bundle with two special-day dates on one date, and writes nothing", async () => {
    const { versions, bundle } = await fiestaVenue("B35792476");
    const [first] = bundle.tables.special_day_dates!;
    bundle.tables.special_day_dates!.push({ ...first!, id: randomUUID(), closed_all_day: 1 });
    const error = { code: "setup.request_invalid", params: { field: "special_day_dates.date" } };
    expect(() => validateConfigurationBundle(bundle, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining(error),
    );
    await expect(
      applyVenue(planVenue(venue("B35792477"), ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, bundle, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(error);
    expect(
      (await targetSuite.db.execute<{ n: number }>(sql`select count(*) as n from taxpayer`)).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("refuses a bundle whose service periods still carry an end offset, and writes nothing", async () => {
    const { versions, bundle } = await fiestaVenue("B35792478");
    expect(bundle.tables.menu_periods!.length).toBeGreaterThan(0);
    bundle.tables.menu_periods = bundle.tables.menu_periods!.map((row) => ({
      ...row,
      end_offset_minutes: 0,
    }));
    const error = { code: "setup.request_invalid", params: { field: "table:menu_periods" } };
    await expect(
      applyVenue(planVenue(venue("B35792479"), ALL_MODULES), {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: (tx) => importConfigurationTables(tx, bundle, ALL_MODULES, versions),
      }),
    ).rejects.toMatchObject(error);
    expect(
      (await targetSuite.db.execute<{ n: number }>(sql`select count(*) as n from taxpayer`)).rows,
    ).toEqual([{ n: 0 }]);
  });
});

it("exports profile zone settings but leaves enrolled device zone selections behind", async () => {
  await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await withTransaction(suite.db, async (tx) => {
    const [profile] = await seedDeviceProfiles(tx, { name: "Selected till", formFactor: "till" });
    const device = {
      id: (await seedDevice(tx, { profileId: profile!.id, label: "Selected till" })).deviceId,
    };
    const current = await VENUE_SERVICE.readDeviceZoneSelection(tx, device!.id);
    expect(current.startingZoneId).not.toBeNull();
    await VENUE_SERVICE.setDeviceZoneSelection(tx, device!.id, {
      ...current,
      startingZoneId: current.startingZoneId!,
    });
    expect(
      (
        await tx
          .select()
          .from(deviceZoneSelections)
          .where(eq(deviceZoneSelections.deviceId, device!.id))
      ).length,
    ).toBe(1);
  });
  const exported = await exportConfigurationTables(suite.db, ALL_MODULES);
  expect(exported.tables.device_profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        order_department_id: expect.any(String),
        order_starting_zone_id: expect.any(String),
        order_zone_ids: null,
      }),
    ]),
  );
  expect(exported.tables).not.toHaveProperty("device_zone_selections");
  expect(exported.tables).not.toHaveProperty("device_zone_selection_zones");
});

it("round-trips explicit unit staff identity, empty and disabled translations and seed markers", async () => {
  const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  await suite.db
    .update(units)
    .set({ staffName: "Mass", staffAbbreviation: "M", name: { de: "Gewicht" }, abbreviation: {} })
    .where(eq(units.seedKey, "kg"));
  const original = await suite.db.select().from(units).orderBy(units.seedKey);
  const marker = (await readSettings(suite.db, MENU_SETTINGS)).doc.starterUnitsCreated;
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const bundle = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-17T10:00:00Z"),
    versions,
  );
  expect(bundle.tables.units?.find((row) => row.seed_key === "kg")).toMatchObject({
    staff_name: "Mass",
    staff_abbreviation: "M",
    name: '{"de":"Gewicht"}',
    abbreviation: "{}",
    precision: 3,
    hardware_unit: "kg",
  });
  expect(() => validateConfigurationBundle(bundle, ALL_MODULES, versions)).not.toThrow();
  const before = structuredClone(bundle);
  await applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: (tx) => importConfigurationTables(tx, bundle, ALL_MODULES, versions),
  });
  expect(bundle).toEqual(before);
  const imported = await targetSuite.db.select().from(units).orderBy(units.seedKey);
  expect(imported.map((row) => ({ ...row, id: null }))).toEqual(
    original.map((row) => ({ ...row, id: null })),
  );
  expect(imported.every((row) => !original.some((sourceRow) => sourceRow.id === row.id))).toBe(
    true,
  );
  expect((await readSettings(targetSuite.db, MENU_SETTINGS)).doc.starterUnitsCreated).toEqual(
    marker,
  );
});

describe("A773 pass display policy", () => {
  async function exportPassProfile(taxId: string) {
    const source = await applyVenue(planVenue(venue(taxId), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await seedDeviceProfiles(tx, { name: "Hidden pass", formFactor: "till" });
      await VENUE_SERVICE.setProfileKitchenScreens(tx, profile!.id, {
        pass: { stationIds: null, zoneIds: null, showNonPassStations: false },
      });
      await seedDevice(tx, { profileId: profile!.id });
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-11-03T12:00:00Z"),
      versions,
    );
    return { transferred, versions };
  }

  async function importedPassValues() {
    return (
      await targetSuite.db.execute(sql`
        select s.screen, s.show_non_pass_stations as shown
        from device_profile_kitchen_screens s
        join device_profiles p on p.id = s.device_profile_id
        where p.name = 'Hidden pass'
        order by s.screen`)
    ).rows;
  }

  it("carries a profile's hidden choice through export and import, and no device's rows", async () => {
    const { transferred, versions } = await exportPassProfile("B24681357");
    expect(Object.keys(transferred.tables).filter((t) => t.startsWith("device_kitchen"))).toEqual(
      [],
    );
    await applyVenue(planVenue(venue("B13572468"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, transferred, ALL_MODULES, versions),
    });
    expect(await importedPassValues()).toEqual([{ screen: "pass", shown: 0 }]);
    expect((await targetSuite.db.execute(sql`select count(*) as n from devices`)).rows).toEqual([
      { n: 0 },
    ]);
  });

  it("imports a profile row exported before the choice existed as showing other stations", async () => {
    const { transferred, versions } = await exportPassProfile("B35792468");
    const older = {
      ...transferred,
      tables: {
        ...transferred.tables,
        device_profile_kitchen_screens: transferred.tables.device_profile_kitchen_screens!.map(
          (row) => {
            const stripped: Record<string, unknown> = { ...row };
            delete stripped.show_non_pass_stations;
            return stripped;
          },
        ),
      },
    };
    await applyVenue(planVenue(venue("B46802468"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, older, ALL_MODULES, versions),
    });
    expect(await importedPassValues()).toEqual([{ screen: "pass", shown: 1 }]);
  });
});

it.each([true, false])(
  "imports a current-version paid-break policy, configured=%s",
  async (configured) => {
    const source = await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await suite.db.insert(convenioConfig).values({
      breakThresholdMinutes: 300,
      splitMinSegmentMinutes: 180,
      splitMaxSegmentMinutes: 300,
      splitMinGapMinutes: 90,
      continuousPaidBreakMinutes: 20,
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const prepared = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-01-01T00:00:00Z"),
      versions,
    );
    const corrupt = structuredClone(prepared);
    corrupt.tables.convenio_config![0]!.continuous_paid_break_minutes = 0;
    expect(() => validateConfigurationBundle(corrupt, ALL_MODULES, versions)).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "convenio_config.continuous_paid_break_minutes" },
      }),
    );
    if (!configured)
      for (const name of [
        "split_min_segment_minutes",
        "split_max_segment_minutes",
        "split_min_gap_minutes",
        "continuous_paid_break_minutes",
      ])
        delete prepared.tables.convenio_config![0]![name];
    await applyVenue(planVenue(venue("B87654323"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: (tx) => importConfigurationTables(tx, prepared, ALL_MODULES, versions),
    });
    const [row] = await targetSuite.db.select().from(convenioConfig);
    expect(row).toMatchObject({
      splitMinSegmentMinutes: configured ? 180 : null,
      splitMaxSegmentMinutes: configured ? 300 : null,
      splitMinGapMinutes: configured ? 90 : null,
      continuousPaidBreakMinutes: configured ? 20 : null,
      breaksCountAsWorked: false,
    });
  },
);

it.each([false, true])(
  "imports access-role memberships and validates declared permissions (unknown: %s)",
  async (unknown) => {
    const source = await applyVenue(planVenue(venue("B13572470"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const sourceAdmin = (await listAdminHolders(suite.db))[0]!.id;
    const [staff] = await seedPersons(suite.db, {
      displayName: "Imported supervisor",
      role: "supervisor",
    });
    await suite.db
      .update(roles)
      .set({ permissions: [unknown ? "access_test.unknown" : "report.view"] })
      .where(eq(roles.builtInKey, "supervisor"));
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const bundle = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: sourceAdmin },
      ALL_MODULES,
      new Date(),
      versions,
    );
    expect(bundle.tables.roles).toHaveLength(4);
    expect(bundle.tables.person_roles).toHaveLength(2);
    let targetId = "";
    let targetRoles: (typeof roles.$inferSelect)[] = [];
    const imported = applyVenue(planVenue(venue("B97531865"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: async (tx) => {
        targetId = (await listAdminHolders(tx))[0]!.id;
        targetRoles = await tx.select().from(roles);
        await importConfigurationTables(tx, bundle, ALL_MODULES, versions);
      },
    });
    if (unknown) {
      await expect(imported).rejects.toMatchObject({
        code: "setup.request_invalid",
        params: { field: "roles.permissions" },
      });
      return;
    }
    await imported;
    expect((await listAdminHolders(targetSuite.db)).map((person) => person.id)).toEqual([targetId]);
    expect((await targetSuite.db.select().from(roles)).map((role) => role.id).sort()).toEqual(
      targetRoles.map((role) => role.id).sort(),
    );
    const [supervisor] = await targetSuite.db
      .select()
      .from(roles)
      .where(eq(roles.builtInKey, "supervisor"));
    expect(supervisor!.permissions).toEqual(["report.view"]);
    const [member] = await targetSuite.db
      .select()
      .from(personRoles)
      .where(eq(personRoles.roleId, supervisor!.id));
    expect(member!.personId).not.toBe(staff!.id);
    expect((await readPersonAuthority(targetSuite.db, member!.personId)).permissions).toEqual(
      new Set(["report.view"]),
    );
    expect(
      await targetSuite.db
        .select({ personId: activityLog.personId, data: activityLog.data })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.kind, "access_role.member_added"),
            eq(activityLog.subjectId, member!.personId),
          ),
        ),
    ).toEqual([
      { personId: null, data: { roleId: supervisor!.id, builtInKey: "supervisor", name: null } },
    ]);
    expect(await targetSuite.db.select().from(outgoingMail)).toEqual([]);
  },
);

it.each([false, true])(
  "configuration import requires a usable target Admin (usable=%s)",
  async (usable) => {
    const source = await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const versions = await schemaVersionsByModule(
      { venue: suite.db, node: suite.node },
      ALL_MODULES,
    );
    const transferred = await buildConfigurationBundle(
      suite.db,
      source,
      ALL_MODULES,
      new Date("2026-11-13T12:00:00Z"),
      versions,
    );
    const importing = applyVenue(planVenue(venue("B24681357"), ALL_MODULES), {
      db: targetSuite.db,
      modules: ALL_MODULES,
      beforeCommit: async (tx) => {
        await tx.update(persons).set(
          withFoldedPersonChanges({
            passwordHash: null,
            googleSubject: usable ? "google-only-admin" : null,
          }),
        );
        await importConfigurationTables(tx, transferred, ALL_MODULES, versions);
      },
    });
    if (!usable) {
      await expect(importing).rejects.toMatchObject({ code: "person.last_admin" });
      expect(await targetSuite.db.select().from(persons)).toEqual([]);
    } else {
      await importing;
      const admins = await listAdminHolders(targetSuite.db, { status: "active" });
      expect(admins).toHaveLength(1);
      expect(admins[0]!.passwordHash).toBeNull();
      const [admin] = await targetSuite.db
        .select()
        .from(persons)
        .where(eq(persons.id, admins[0]!.id));
      expect(admin!.googleSubject).toBe("google-only-admin");
    }
  },
);

it("imports named starts under new ids and replaces existing dependent steps", async () => {
  const source = await applyVenue(planVenue(venue("B12348765"), ALL_MODULES), {
    db: suite.db,
    modules: ALL_MODULES,
  });
  const original = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Named meal", orderStart: "table" });
    await saveServiceSteps(tx, department.id, [
      {
        key: "child",
        name: "Order",
        start: "after_step",
        afterStepKey: "parent",
        courseId: null,
        minutes: 2,
      },
      { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
    ]);
    return (await listServiceSteps(tx)).filter((row) => row.departmentId === department.id);
  });
  const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES);
  const bundle = await buildConfigurationBundle(
    suite.db,
    source,
    ALL_MODULES,
    new Date("2026-10-10T12:00:00Z"),
    versions,
  );
  await applyVenue(planVenue(venue("B98765431"), ALL_MODULES), {
    db: targetSuite.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx) => {
      await createDepartment(tx, { name: "Old dependent meal", orderStart: "table" });
      await importConfigurationTables(tx, bundle, ALL_MODULES, versions);
    },
  });
  const imported = await withTransaction(targetSuite.db, (tx) => listServiceSteps(tx));
  const child = imported.find((row) => row.name === "Order")!;
  const parent = imported.find((row) => row.id === child.afterStepId)!;
  expect(child.id).not.toBe(original[0]!.id);
  expect(parent.id).not.toBe(original[1]!.id);
  expect(parent.name).toBe("Set up");
  expect(parent.departmentId).toBe(child.departmentId);
  expect(imported.some((row) => original.some((old) => old.id === row.id))).toBe(false);
  expect(imported.filter((row) => row.departmentId === child.departmentId)).toHaveLength(2);
  const courses = await targetSuite.db.select().from(kitchenCourses);
  const importedVisits = imported.filter((row) => row.start === "course_served");
  expect(importedVisits.map(({ name, courseId }) => ({ name, courseId }))).toEqual([
    {
      name: STARTER_STEP_NAMES["Dessert?"].es,
      courseId: courses.find((row) => row.starterKey === "mains")!.id,
    },
    {
      name: STARTER_STEP_NAMES["Coffee or bill?"].es,
      courseId: courses.find((row) => row.starterKey === "desserts")!.id,
    },
  ]);
  const later = await withTransaction(targetSuite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Later dining" });
    return (await listServiceSteps(tx)).filter(
      (row) => row.departmentId === department.id && row.start === "course_served",
    );
  });
  expect(later.map(({ name, courseId }) => ({ name, courseId }))).toEqual(
    importedVisits.map(({ name, courseId }) => ({ name, courseId })),
  );
});
