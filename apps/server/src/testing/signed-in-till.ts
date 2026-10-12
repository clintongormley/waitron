import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deviceProfiles, withTransaction, type Database, type Transaction } from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import {
  createDepartment,
  deleteMenuPeriod,
  menuPeriods,
  replaceMenuWeek,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { deploymentEnvironment } from "../config.js";
import { DEVICE_COOKIE } from "../device-session.js";
import { ALL_MODULES } from "../modules.js";
import { systemClock } from "../till-backend.js";
import { mountTillApi } from "../till-api.js";
import type { TillConfig } from "../till-config.js";
import { SESSION_COOKIE } from "../till-session.js";
import { enrolDeviceForTest } from "./enrol.js";
import { BASIC_ACTIONS } from "./session-device.js";

export const SIGNED_IN_TILL_LOCALE = "es-ES";

/** What a suite's seed must name: the department the till serves and the zone it starts in. */
export interface TillSeed {
  departmentId: string;
  startingZoneId: string;
}

export interface SignedInTill {
  cfg: TillConfig;
  app: Hono;
  cookie: string;
  personId: string;
}

/**
 * A Madrid venue provisioned with every module, seeded by the suite, and a till whose profile
 * serves the seed's department, enrolled and signed in as staff member Ana (PIN 5555), with the
 * till routes mounted on a fresh app. Filing never reaches AEAT.
 */
export async function provisionSignedInTill<S extends TillSeed>(
  db: Database,
  options: {
    taxId: string;
    dayCutover: string;
    seed: (tx: Transaction, cfg: TillConfig) => Promise<S>;
  },
): Promise<SignedInTill & S> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: options.taxId,
        legalName: "Casa Delgado SL",
        location: {
          name: "Casa Delgado",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SIGNED_IN_TILL_LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: options.dayCutover,
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: SIGNED_IN_TILL_LOCALE,
    invoiceLocales: [SIGNED_IN_TILL_LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const seeded = await withTransaction(db, async (tx) => {
    const seed = await options.seed(tx, cfg);
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return { ...seed, personId: person!.id };
  });
  const [profile] = await db
    .insert(deviceProfiles)
    .values({
      name: `Till ${randomUUID()}`,
      formFactor: "till",
      capabilities: [...BASIC_ACTIONS, "take-cash"],
    })
    .returning({ id: deviceProfiles.id });
  await withTransaction(db, (tx) =>
    setProfileServiceAccess(tx, cfg, profile!.id, {
      departmentId: seeded.departmentId,
      allowedZoneIds: null,
      startingZoneId: seeded.startingZoneId,
    }),
  );
  const device = await enrolDeviceForTest(db, cfg, {
    name: `Till ${randomUUID()}`,
    profileId: profile!.id,
  });
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: seeded.personId, pin: "5555" }),
  );
  const clock = systemClock();
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("signed-in-till: resolveClient is never called")),
  });
  const app = new Hono();
  mountTillApi(
    app,
    { db, backend, clock, cfg, secureCookies: false, venueLocale: SIGNED_IN_TILL_LOCALE },
    () => {},
  );
  return {
    cfg,
    app,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    ...seeded,
  };
}

/** A counter department with no periods and an empty week, for a seed that paints its own. */
export async function createBareDepartment(
  tx: Transaction,
  cfg: TillConfig,
  name: string,
  at: Date,
): Promise<string> {
  const departmentId = (await createDepartment(tx, cfg, { name, orderStart: "counter" })).id;
  const initialPeriods = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId));
  await replaceMenuWeek(
    tx,
    cfg,
    departmentId,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
    at,
    0,
  );
  for (const period of initialPeriods) await deleteMenuPeriod(tx, cfg, period.id);
  return departmentId;
}

/** One request to the till's app with its session and device cookies; the body parsed as JSON. */
export async function sendAsTill(
  till: Pick<SignedInTill, "app" | "cookie">,
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await till.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: till.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) };
}
