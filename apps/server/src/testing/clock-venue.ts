import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import { loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { createDeviceProfile } from "@waitron/layouts";
import type { WaitronModule } from "@waitron/module";
import { planVenue } from "@waitron/provisioning";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { locationId, nodeId } from "@waitron/shared";
import { DEVICE_COOKIE } from "../device-session.js";
import { ALL_MODULES } from "../modules.js";
import { SESSION_COOKIE } from "../till-session.js";
import type { TillConfig } from "../till-config.js";
import { enrolDeviceForTest } from "./enrol.js";
import { mountTillClockApi } from "../till-clock-api.js";
import { fixturePinHash } from "./known-secret-hashes.js";

export interface ClockVenue {
  app: Hono;
  cfg: TillConfig;
  personId: string;
  deviceId: string;
  profileId: string;
  sessionId: string;
  cookie: string;
}

export async function createClockVenue(
  db: Database,
  now: () => Date,
  modules: readonly WaitronModule[] = ALL_MODULES,
): Promise<ClockVenue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "B10101010",
        legalName: "Clock venue SL",
        location: {
          name: "Clock venue",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurant",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Owner",
          pinHash: fixturePinHash("1234"),
          passwordHash: "scrypt$00$00",
          email: "owner@example.test",
        },
      },
      modules,
    ),
    { db, modules },
  );
  const cfg: TillConfig = {
    nodeId: nodeId(venue.nodeId),
    locationId: locationId(venue.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const { profile, person } = await withTransaction(db, async (tx) => {
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const management = await startManagementSession(tx, { personId: admin!.id });
    const profile = await createDeviceProfile(tx, {
      managementSessionId: management.token,
      name: "Clock only",
      formFactor: "till",
      capabilities: ["clock-in"],
    });
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: fixturePinHash("5555"), role: "staff" })
      .returning({ id: persons.id });
    return { profile, person: person! };
  });
  const device = await enrolDeviceForTest(db, cfg, { name: "Clock till", profileId: profile.id });
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { personId: person.id, deviceId: device.deviceId, pin: "5555" }),
  );
  const app = new Hono();
  mountTillClockApi(app, { db, cfg, now }, () => {});
  return {
    app,
    cfg,
    personId: person.id,
    deviceId: device.deviceId,
    profileId: profile.id,
    sessionId: session.id,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
  };
}
