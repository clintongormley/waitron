import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as db from "@waitron/db";
import * as identity from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { getCountryPack } from "@waitron/country-packs";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { nodeId, PERSON_HEADER } from "@waitron/shared";
import { setProfileServiceAccess } from "@waitron/venue-service";
import { ALL_MODULES, enabledFloorAnnotators, enabledTableRemovals } from "../../src/modules.js";
import { mountTillApi } from "../../src/till-api.js";
import { mountDeviceApi } from "../../src/device-api.js";
import { mountPrintApi } from "../../src/print-api.js";
import { createPairingMode } from "../../src/pairing-mode.js";
import { recordAttendanceFact } from "../../src/attendance-capture.js";
import { mountOrdersApi } from "../../src/orders-api.js";
import { mountCatalogueApi } from "../../src/catalogue-api.js";
import { moduleCoreServices } from "../../src/parties.js";
import { mountManagementApi } from "../../src/management-api.js";
import { systemClock } from "../../src/till-backend.js";
import { testTradingAdmission } from "../../src/testing/trading-admission.js";
import { seedSessionDevice, sessionCookieForTest } from "../../src/testing/session-device.js";
import { TOTP_KEY_RING } from "../../src/testing/authenticator.js";
import { roomRevision } from "../../src/floor-revision.js";
import { createDemoVenueProvisioner } from "../demo-seed/testing/provision-venue.js";
import { seedDemoRestaurant } from "../demo-seed/seed.js";
import { CASA_DELGADO_ES } from "../demo-seed/testing/data.js";
import { installBenchClock } from "../bench/bench-clock.js";

const clock = installBenchClock(new Date("2026-10-08T10:00:00Z"));
const dir = await mkdtemp(join(tmpdir(), "waitron-today-wake-"));
try {
  await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
  const store = await db.openVenueDatabase(dir);
  try {
    const venue = await createDemoVenueProvisioner(() => store.venue, {
      nifBase: 95_000_000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
      adminPin: "5555",
    })();
    await seedDemoRestaurant(store.venue, {
      venue,
      locale: "es",
      salesDays: 0,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      dataSet: CASA_DELGADO_ES,
    });
    const cfg = {
      nodeId: nodeId(venue.nodeId),
      locale: "es-ES",
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
    };
    const [person] = await store.venue
      .select()
      .from(identity.persons)
      .where(eq(identity.persons.email, "owner@example.test"));
    const [table] = await store.venue.select().from(db.diningTables);
    const [zone] = await store.venue
      .select()
      .from(db.floorZones)
      .where(eq(db.floorZones.id, table!.zoneId));
    const deviceId = await seedSessionDevice(store.venue);
    const [device] = await store.venue.select().from(db.devices).where(eq(db.devices.id, deviceId));
    await db.withTransaction(store.venue, (tx) =>
      setProfileServiceAccess(tx, device!.deviceProfileId!, {
        departmentId: zone!.departmentId,
        allowedZoneIds: null,
        startingZoneId: zone!.id,
      }),
    );
    const session = await db.withTransaction(store.venue, (tx) =>
      identity.loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" }),
    );
    const cookie = await sessionCookieForTest(store.venue, session.token);
    const management = await db.withTransaction(store.venue, (tx) =>
      identity.startManagementSession(tx, { personId: person!.id }),
    );
    const headers = { cookie, [PERSON_HEADER]: person!.id, "content-type": "application/json" };
    const managerHeaders = { cookie: `${MANAGEMENT_COOKIE}=${management.token}` };
    const app = new Hono();
    const backend = new VerifactuBackend({
      clock: systemClock(),
      db: store.venue,
      environment: "preproduction",
      deploymentEnvironment: "preproduction",
      resolveClient: () => Promise.reject(new Error("timing never files")),
    });
    const log = (...entry: unknown[]) => console.error(...entry);
    mountTillApi(
      app,
      {
        db: store.venue,
        cfg,
        backend,
        clock: systemClock(),
        admission: testTradingAdmission(),
        secureCookies: false,
        venueLocale: "es-ES",
        floorAnnotators: enabledFloorAnnotators(ALL_MODULES),
        tableRemovals: enabledTableRemovals(ALL_MODULES),
      },
      log,
    );
    const pairingMode = createPairingMode();
    mountDeviceApi(
      app,
      {
        db: store.venue,
        cfg,
        secureCookies: false,
        pairingMode,
        attendance: recordAttendanceFact,
        attendanceClock: systemClock(),
      },
      log,
    );
    const unused = () => Promise.reject(new Error("timing reads no document"));
    mountPrintApi(
      app,
      {
        db: store.venue,
        cfg,
        readMembership: () => Promise.resolve(null),
        pairingMode,
        venueLocale: "es-ES",
        readInvoiceDocument: unused,
        layOutSaleReceipt: unused,
      },
      log,
    );
    mountOrdersApi(
      app,
      {
        db: store.venue,
        backend,
        cfg: { nodeId: cfg.nodeId },
        tradingContext: cfg,
        invoiceEmailAvailable: () => Promise.resolve(false),
      },
      log,
    );
    mountCatalogueApi(app, { db: store.venue, venueLocale: "es-ES" }, log);
    const context = {
      db: store.venue,
      cfg: { contentDefaultLanguage: "es-ES" },
      core: moduleCoreServices(cfg, enabledTableRemovals(ALL_MODULES)),
    };
    for (const module of ALL_MODULES) module.routes?.mount(app, context, log);
    mountManagementApi(
      app,
      {
        db: store.venue,
        cfg: { nodeId: cfg.nodeId },
        venueCfg: cfg,
        secureCookies: false,
        rpId: "localhost",
        origin: "http://localhost",
        venueLocale: "es-ES",
        credentialKeyRing: TOTP_KEY_RING,
        tableRemovals: enabledTableRemovals(ALL_MODULES),
      },
      log,
    );
    async function answer(path: string, init: RequestInit) {
      const response = await app.request(path, init);
      const text = await response.text();
      if (response.status !== 200) throw new Error(`${path}: ${response.status} ${text}`);
      return JSON.parse(text) as Record<string, unknown>;
    }
    await answer("/api/tables/state", { headers });
    const seated = await answer(`/api/tables/${table!.id}/seat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ guestCount: 2 }),
    });
    const [plan] = await store.venue
      .select()
      .from(db.floorPlans)
      .where(eq(db.floorPlans.zoneId, zone!.id));
    const managementRoutes = [
      "/management-api/orders?limit=50",
      `/management-api/orders/${String(seated.tabId)}`,
      "/management-api/products/made-at",
      "/management-api/venue-service/routing",
      "/management-api/venue-service/departments-and-zones",
      "/management-api/device-profile-kitchen-screens",
      "/management-api/devices",
      "/management-api/zones",
      `/management-api/floor-plan-sets/${plan!.setId}/zones/${zone!.id}/floor-plan`,
      "/management-api/venue-service/floor-plan-sets",
      "/management-api/venue-service/floor-plan-sets/period-choices",
      "/management-api/stations/pass-coverage",
      "/management-api/venue-service/opening-hours/month?month=2026-10",
      "/management-api/venue-service/opening-hours",
      "/management-api/venue-service",
      // Routing and operations loaders also fetch these companion reads.
      "/management-api/stations",
      "/management-api/categories",
      "/management-api/products",
      "/management-api/printers",
    ];
    const stations = await store.venue
      .select({ id: db.kitchenStations.id })
      .from(db.kitchenStations);
    managementRoutes.push(
      ...stations.map((station) => `/management-api/stations/${station.id}/printers`),
    );
    const routes = [
      ...managementRoutes.map((path) => ({ path, headers: managerHeaders })),
      ...[
        `/api/menu-state?zoneId=${zone!.id}`,
        `/api/parties/${String(seated.partyId)}/drafts`,
        `/api/parties/${String(seated.partyId)}/bills`,
        `/api/working-orders/${String(seated.tabId)}/payments`,
        `/api/working-orders/${String(seated.tabId)}`,
        "/api/department-transfers/incoming",
        "/api/department-transfers/sent",
        "/api/department-transfers/destinations",
        `/api/parties/${String(seated.partyId)}/allergy`,
      ].map((path) => ({ path, headers })),
      { path: `/api/tables/${table!.id}/today/move`, headers },
    ];
    let revision = await db.withTransaction(store.venue, (tx) => roomRevision(tx, zone!.id));
    const moved = await answer(`/api/tables/${table!.id}/today/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ zoneRevision: revision, x: 10, y: 10 }),
    });
    revision = Number(moved.revision);
    let x = 10;
    for (const route of routes) {
      const samples: number[] = [];
      for (let n = -10; n < 200; n++) {
        const move = route.path.endsWith("/today/move");
        const init: RequestInit = {
          headers: route.headers,
          ...(move
            ? {
                method: "POST",
                body: JSON.stringify({
                  zoneRevision: revision,
                  x: (x = x === 10 ? 11 : 10),
                  y: 10,
                }),
              }
            : {}),
        };
        const start = performance.now();
        const body = await answer(route.path, init);
        const elapsed = performance.now() - start;
        if (move) revision = Number(body.revision);
        if (n >= 0) samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          route: route.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id"),
          samples: samples.length,
          medianMs: samples[100],
          p95Ms: samples[189],
        }),
      );
    }
  } finally {
    await store.close();
  }
} finally {
  await rm(dir, { recursive: true, force: true });
  clock.uninstall();
}
