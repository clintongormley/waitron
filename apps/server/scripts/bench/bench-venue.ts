import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { asc, eq, like, sql } from "drizzle-orm";
import {
  catalogues,
  devices,
  deviceProfiles,
  diningTables,
  floorZones,
  installChangeFeed,
  openVenueDatabase,
  products,
  venueLocationId,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
  menuItems,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { hashSecret, persons, startManagementSession } from "@waitron/identity";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { planVenue } from "@waitron/provisioning";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { nodeId as brandNodeId, type NodeId } from "@waitron/shared";
import {
  configureZone,
  createDepartment,
  departmentReceipts,
  departments,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { beginAttendanceDiscovery } from "../../src/attendance-discovery.js";
import { recordAttendanceFact } from "../../src/attendance-capture.js";
import { deploymentEnvironment } from "../../src/config.js";
import { mountDeviceApi } from "../../src/device-api.js";
import { createStation } from "../../src/kitchen.js";
import { DEVICE_COOKIE } from "../../src/device-session.js";
import type { Logger } from "../../src/logger.js";
import { mountManagementApi } from "../../src/management-api.js";
import { mountMeApi } from "../../src/me-api.js";
import { ALL_MODULES, enabledFloorAnnotators, enabledTableRemovals } from "../../src/modules.js";
import { createPairingMode } from "../../src/pairing-mode.js";
import { mountReportApi } from "../../src/report-api.js";
import { TOTP_KEY_RING } from "../../src/testing/authenticator.js";
import { enrolDeviceForTest } from "../../src/testing/enrol.js";
import { fixturePasswordHash, fixturePinHash } from "../../src/testing/known-secret-hashes.js";
import { createTable } from "../../src/testing/live-table.js";
import { BASIC_ACTIONS } from "../../src/testing/session-device.js";
import { testTradingAdmission } from "../../src/testing/trading-admission.js";
import type { WithVenueRowId } from "../../src/testing/venue-row-id.js";
import { offerProducts, routeCategoryTo } from "../../src/testing/zone-offers.js";
import { mountTillApi } from "../../src/till-api.js";
import { systemClock } from "../../src/till-backend.js";
import { BENCH_PROFILE } from "./profile.js";

const LOCALE = "es-ES";
const TILL_CAPABILITIES = [
  ...BASIC_ACTIONS,
  "integrated-card-payment",
  "open-cash-drawer",
  "take-cash",
] as const;
const TILL_PREFIX = "Bench till ";
const KDS_PREFIX = "Bench kitchen screen ";
const WAITER_PREFIX = "Bench waiter ";
const MANAGER_NAME = "Bench manager";
const CATALOGUE_NAME = "Bench menu";

/** The modules of a Veri*Factu box: every module but the other one filling the fiscal slot. */
const MODULES = ALL_MODULES.filter(
  (module) => module.fiscal === undefined || module.name === "fiscal-verifactu",
);

export interface BenchTill {
  id: string;
  name: string;
  /** The device proof alone; a staff member signs in on top of it each day. */
  cookie: string;
  departmentId: string;
}

export interface BenchKitchenScreen {
  id: string;
  name: string;
  cookie: string;
  stationId: string;
}

export interface BenchPerson {
  id: string;
  name: string;
  pin: string;
}

export interface BenchDish {
  productId: string;
  menuItemId: string;
}

export interface BenchZone {
  id: string;
  departmentId: string;
  tableIds: string[];
}

export interface BenchVenue {
  dir: string;
  seed: number;
  db: Database;
  nodeId: NodeId;
  cfg: WithVenueRowId;
  /** Till, device, report, me and management routes, mounted as boot mounts them. */
  app: Hono;
  tills: BenchTill[];
  kitchenScreens: BenchKitchenScreen[];
  waiters: BenchPerson[];
  manager: BenchPerson;
  /** A management session for `manager`, minted at this open. */
  managementCookie: string;
  dishes: BenchDish[];
  zones: BenchZone[];
  /** Every device's cookie by device id, for saving beside a copy: tokens are stored hashed. */
  deviceCookies(): Record<string, string>;
  /**
   * Writes everything both files hold into their main files, leaving their write-ahead files
   * empty, so a copy of the main files taken before the next write is the whole venue.
   */
  checkpoint(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenBenchVenueOptions {
  seed: number;
  /**
   * The cookies a previous open answered from `deviceCookies()`. Only for an already seeded
   * folder; absent there, each device is given a new token.
   */
  deviceCookies?: Record<string, string>;
  log?: Logger;
}

/**
 * The bench venue in `dir`: migrated, provisioned and seeded on first open, and reopened as it is
 * after that. Run under `installBenchClock`, so the provisioning is dated on the bench's day.
 */
export async function openBenchVenue(
  dir: string,
  options: OpenBenchVenueOptions,
): Promise<BenchVenue> {
  await applyMigrations(dir, migrationOptionsFor(orderedMigrationSets(MODULES), null));
  const store = await openVenueDatabase(dir);
  try {
    const db = store.venue;
    const seeded = await isProvisioned(db);
    if (!seeded) await provision(db);
    await installChangeFeed(
      db,
      MODULES.flatMap((module) => module.changes ?? []),
    );
    await withTransaction(db, (tx) => beginAttendanceDiscovery(tx, { generation: randomUUID() }));
    const nodeId = brandNodeId(
      db.all<{ id: string }>(sql`select id from nodes order by rowid limit 1`)[0]!.id,
    );
    const cfg: WithVenueRowId = {
      nodeId,
      locationId: await venueLocationId(db),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
    };
    const cookies = !seeded
      ? await seed(db, cfg, options.seed)
      : (options.deviceCookies ?? (await renewDeviceTokens(db)));
    const read = await readSeeded(db, cookies);
    const manager = read.manager;
    const { token } = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: manager.id }),
    );
    const app = mount(db, cfg, options.log ?? (() => {}));
    return {
      dir,
      seed: options.seed,
      db,
      nodeId,
      cfg,
      app,
      ...read,
      managementCookie: `${MANAGEMENT_COOKIE}=${token}`,
      deviceCookies: () => ({ ...cookies }),
      checkpoint: async () => {
        for (const file of [store.venue, store.node])
          if (!(await file.checkpointTruncate()).reclaimed)
            throw new Error("bench: a checkpoint left rows in a write-ahead file");
      },
      close: () => store.close(),
    };
  } catch (error) {
    await store.close();
    throw error;
  }
}

async function isProvisioned(db: Database): Promise<boolean> {
  return db.all<{ n: number }>(sql`select count(*) as n from tenants`)[0]!.n > 0;
}

async function provision(db: Database): Promise<void> {
  await applyHistoricalTestVenue(
    planVenue(
      {
        country: "ES",
        taxId: "61000002T",
        legalName: "Bench Restaurant SL",
        name: "Bench Restaurant",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Restaurant",
        addressLine1: "1 High Street",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: BENCH_PROFILE.timeZone,
        dayCutover: BENCH_PROFILE.dayCutover,
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Bench administrator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("bench-password"),
          email: "owner@bench.test",
        },
      },
      MODULES,
    ),
    { db, modules: MODULES },
  );
}

async function renewDeviceTokens(db: Database): Promise<Record<string, string>> {
  const renewed: Record<string, string> = {};
  const rows = await db.select({ id: devices.id }).from(devices);
  for (const { id } of rows) {
    const token = randomUUID();
    await db
      .update(devices)
      .set({ tokenHash: hashSecret(token) })
      .where(eq(devices.id, id));
    renewed[id] = `${DEVICE_COOKIE}=${id}.${token}`;
  }
  return renewed;
}

/** A seeded generator: one seed gives one sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COURSES = [
  { name: "Starters", share: 0.3, station: "kitchen", from: 6, to: 16 },
  { name: "Mains", share: 0.3, station: "kitchen", from: 14, to: 32 },
  { name: "Desserts", share: 0.13, station: "kitchen", from: 5, to: 9 },
  { name: "Drinks", share: 0.27, station: "bar", from: 2, to: 30 },
] as const;

/** Seeds the venue and answers each enrolled device's cookie by id. */
async function seed(
  db: Database,
  cfg: WithVenueRowId,
  seedValue: number,
): Promise<Record<string, string>> {
  const random = seededRandom(seedValue);
  const price = (from: number, to: number) => (from + random() * (to - from)).toFixed(2);
  const enrolled: Record<string, string> = {};
  const profiles = await withTransaction(db, async (tx) => {
    const departmentIds = await benchDepartments(tx);
    const printerIds: string[] = [];
    for (const [name, hasCashDrawer] of [
      ["Bench receipts", true],
      ["Bench kitchen", false],
      ["Bench bar", false],
    ] as const)
      printerIds.push(
        (
          await createPrinter(tx, {
            name,
            transport: "cloud_poll",
            pollId: `bench-${name}-${randomUUID()}`,
            hasCashDrawer,
          })
        ).id,
      );
    const stations = {
      kitchen: (
        await createStation(tx, {
          name: "Bench kitchen",
          isDefault: true,
          printerIds: [printerIds[1]!],
        })
      ).id,
      bar: (await createStation(tx, { name: "Bench bar", printerIds: [printerIds[2]!] })).id,
    };

    const catalogue = await createCatalogue(tx, { name: CATALOGUE_NAME });
    let made = 0;
    for (const [index, course] of COURSES.entries()) {
      const category = await createCategory(tx, { name: course.name });
      await routeCategoryTo(tx, category.id, stations[course.station]);
      const count =
        index === COURSES.length - 1
          ? BENCH_PROFILE.dishes - made
          : Math.round(BENCH_PROFILE.dishes * course.share);
      for (let n = 1; n <= count; n++) {
        const label = `${course.name} ${String(made + n).padStart(3, "0")}`;
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: label,
          customerName: { [LOCALE]: `House ${label.toLowerCase()}` },
          kitchenName: label.toUpperCase().replace(/\s+/g, "-"),
          pricingUnit: "each",
          unitPrice: price(course.from, course.to),
          vatClass: "general",
        });
      }
      made += count;
    }
    await assignCatalogueToVenue(tx, catalogue.id);

    const zonesPerDepartment = BENCH_PROFILE.zones / BENCH_PROFILE.departments;
    const zonesOf = new Map<string, string[]>();
    for (let z = 0; z < BENCH_PROFILE.zones; z++) {
      const departmentId = departmentIds[Math.floor(z / zonesPerDepartment)]!;
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name: `Bench zone ${z + 1}` })
        .returning({ id: floorZones.id });
      await configureZone(tx, { zoneId: zone!.id, departmentId, orderStart: "table" });
      await offerProducts(tx, cfg, { zone: { zoneId: zone!.id }, orderStart: "table" });
      for (let t = 1; t <= BENCH_PROFILE.tablesPerZone; t++)
        await createTable(tx, cfg, { label: `Table ${z + 1}.${t}`, zoneId: zone!.id });
      zonesOf.set(departmentId, [...(zonesOf.get(departmentId) ?? []), zone!.id]);
    }

    for (let w = 1; w <= BENCH_PROFILE.waiters; w++)
      await tx.insert(persons).values({
        displayName: `${WAITER_PREFIX}${w}`,
        pinHash: fixturePinHash(waiterPin(w)),
        role: "staff",
      });
    await tx.insert(persons).values({
      displayName: MANAGER_NAME,
      pinHash: fixturePinHash("9999"),
      role: "manager",
    });

    const tillProfiles: { profileId: string; departmentId: string }[] = [];
    for (const departmentId of departmentIds) {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({
          name: `Bench till ${tillProfiles.length + 1}`,
          formFactor: "till",
          capabilities: [...TILL_CAPABILITIES],
        })
        .returning({ id: deviceProfiles.id });
      const zoneIds = zonesOf.get(departmentId)!;
      await setProfileServiceAccess(tx, profile!.id, {
        departmentId,
        allowedZoneIds: zoneIds,
        startingZoneId: zoneIds[0]!,
      });
      tillProfiles.push({ profileId: profile!.id, departmentId });
    }
    const [kds] = await tx
      .insert(deviceProfiles)
      .values({ name: "Bench kitchen screen", formFactor: "kds", capabilities: ["prepare-orders"] })
      .returning({ id: deviceProfiles.id });
    return { tillProfiles, kdsProfileId: kds!.id, stations, receiptPrinterId: printerIds[0]! };
  });

  for (let t = 0; t < BENCH_PROFILE.tills; t++) {
    const { profileId } = profiles.tillProfiles[t % profiles.tillProfiles.length]!;
    const device = await enrolDeviceForTest(db, cfg, { name: `${TILL_PREFIX}${t + 1}`, profileId });
    enrolled[device.deviceId] = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
    await db
      .update(devices)
      .set({
        receiptPrinterId: profiles.receiptPrinterId,
        paymentSlipPrinterId: profiles.receiptPrinterId,
        cashDrawerPrinterId: profiles.receiptPrinterId,
      })
      .where(eq(devices.id, device.deviceId));
  }
  const screens = [profiles.stations.kitchen, profiles.stations.bar];
  for (let k = 0; k < BENCH_PROFILE.kitchenScreens; k++) {
    const device = await enrolDeviceForTest(db, cfg, {
      name: `${KDS_PREFIX}${k + 1}`,
      profileId: profiles.kdsProfileId,
      kitchenScreen: { kind: "station", stationIds: [screens[k % screens.length]!], zoneIds: null },
    });
    enrolled[device.deviceId] = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  }
  return enrolled;
}

function waiterPin(n: number): string {
  return String(2000 + n);
}

/** The venue's departments, made up to the profile's count. */
async function benchDepartments(tx: Transaction): Promise<string[]> {
  const ids = (
    await tx.select({ id: departments.id }).from(departments).orderBy(asc(departments.id))
  ).map((row) => row.id);
  while (ids.length < BENCH_PROFILE.departments)
    ids.push(
      (
        await createDepartment(tx, {
          name: `Bench department ${ids.length + 1}`,
          orderStart: "table",
        })
      ).id,
    );
  for (const departmentId of ids)
    await tx
      .insert(departmentReceipts)
      .values({ departmentId, receipt: { operationDescription: "Restaurant" } })
      .onConflictDoNothing({ target: departmentReceipts.departmentId });
  return ids.slice(0, BENCH_PROFILE.departments);
}

async function readSeeded(db: Database, cookies: Record<string, string>) {
  const deviceRows = await db
    .select({
      id: devices.id,
      name: devices.label,
      profileId: devices.deviceProfileId,
    })
    .from(devices)
    .orderBy(asc(devices.label));
  const cookieOf = (id: string) => {
    const cookie = cookies[id];
    if (cookie === undefined) throw new Error(`bench: no cookie saved for device ${id}`);
    return cookie;
  };
  const access = db.all<{ profileId: string; departmentId: string }>(
    sql`select device_profile_id as profileId, department_id as departmentId from device_profile_service_access`,
  );
  const tills: BenchTill[] = deviceRows
    .filter((row) => row.name.startsWith(TILL_PREFIX))
    .map((row) => ({
      id: row.id,
      name: row.name,
      cookie: cookieOf(row.id),
      departmentId: access.find((scope) => scope.profileId === row.profileId)!.departmentId,
    }));
  const screens = db.all<{ deviceId: string; stationId: string }>(
    sql`select device_id as deviceId, station_id as stationId from device_kitchen_screen_stations`,
  );
  const kitchenScreens: BenchKitchenScreen[] = deviceRows
    .filter((row) => row.name.startsWith(KDS_PREFIX))
    .map((row) => ({
      id: row.id,
      name: row.name,
      cookie: cookieOf(row.id),
      stationId: screens.find((screen) => screen.deviceId === row.id)!.stationId,
    }));
  const people = await db
    .select({ id: persons.id, name: persons.displayName })
    .from(persons)
    .where(like(persons.displayName, "Bench %"))
    .orderBy(asc(persons.displayName));
  const waiters = people
    .filter((person) => person.name.startsWith(WAITER_PREFIX))
    .map((person) => ({
      ...person,
      pin: waiterPin(Number(person.name.slice(WAITER_PREFIX.length))),
    }))
    .sort((a, b) => a.pin.localeCompare(b.pin));
  const managerRow = people.find((person) => person.name === MANAGER_NAME)!;
  const dishes = await db
    .select({ productId: products.id, menuItemId: menuItems.id })
    .from(menuItems)
    .innerJoin(products, eq(products.id, menuItems.productId))
    .innerJoin(catalogues, eq(catalogues.id, products.catalogueId))
    .where(eq(catalogues.name, CATALOGUE_NAME))
    .orderBy(asc(products.name));
  const zoneRows = db.all<{ id: string; departmentId: string }>(
    sql`select z.id as id, p.department_id as departmentId from floor_zones z
        join zone_service_policies p on p.zone_id = z.id
        where z.name like 'Bench zone %' order by z.name`,
  );
  const tableRows = await db
    .select({ id: diningTables.id, zoneId: diningTables.zoneId, label: diningTables.label })
    .from(diningTables)
    .orderBy(asc(diningTables.label));
  const zones: BenchZone[] = zoneRows.map((zone) => ({
    ...zone,
    tableIds: tableRows.filter((table) => table.zoneId === zone.id).map((table) => table.id),
  }));
  return {
    tills,
    kitchenScreens,
    waiters,
    manager: { ...managerRow, pin: "9999" },
    dishes,
    zones,
  };
}

function mount(db: Database, cfg: WithVenueRowId, log: Logger): Hono {
  const clock = systemClock();
  const environment = deploymentEnvironment({});
  const backend = new VerifactuBackend({
    clock,
    db,
    environment,
    deploymentEnvironment: environment,
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const admission = testTradingAdmission();
  const tableRemovals = enabledTableRemovals(MODULES);
  const app = new Hono();
  mountTillApi(
    app,
    {
      db,
      backend,
      admission,
      clock,
      cfg,
      floorAnnotators: enabledFloorAnnotators(MODULES),
      tableRemovals,
      secureCookies: false,
      cardProvider: new SimulatorPaymentProvider(db),
      venueLocale: LOCALE,
      workforceEnabled: true,
      attendance: recordAttendanceFact,
    },
    log,
  );
  mountDeviceApi(
    app,
    {
      db,
      cfg,
      secureCookies: false,
      pairingMode: createPairingMode(),
      attendance: recordAttendanceFact,
      attendanceClock: clock,
    },
    log,
  );
  mountReportApi(app, { db, cfg: { nodeId: cfg.nodeId }, venueLocale: LOCALE }, log);
  mountMeApi(
    app,
    {
      db,
      venueLocale: LOCALE,
      modules: MODULES.map((module) => module.name),
      credentialKeyRing: TOTP_KEY_RING,
    },
    log,
  );
  mountManagementApi(
    app,
    {
      db,
      cfg: { nodeId: cfg.nodeId },
      venueCfg: cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      venueLocale: LOCALE,
      credentialKeyRing: TOTP_KEY_RING,
      tableRemovals,
    },
    log,
  );
  return app;
}
