import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, locations, withTransaction } from "@waitron/db";
import { loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createServiceZone, setProfileServiceAccess } from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { createCourse, updateCourse } from "./kitchen.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import {
  createBareDepartment,
  provisionSignedInTill,
  sendAsTill,
} from "./testing/signed-in-till.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(72_000_000 + ++nifCounter);

async function setupTill() {
  return provisionSignedInTill(suite.db, {
    taxId: nextNif(),
    dayCutover: "05:00",
    seed: async (tx, cfg) => {
      const departmentId = await createBareDepartment(tx, cfg, "Restaurant", new Date());
      const zone = await createServiceZone(tx, cfg, { name: "Barra", departmentId });
      return { departmentId, startingZoneId: zone.id };
    },
  });
}

type Till = Awaited<ReturnType<typeof setupTill>>;

/** A second device in the same venue, on a profile of its own that times out after 300 s. */
async function secondDeviceOnOwnProfile(till: Till) {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Till ${randomUUID()}`,
      formFactor: "till",
      capabilities: [...BASIC_ACTIONS, "take-cash"],
      inactivityTimeoutSeconds: 300,
    })
    .returning({ id: deviceProfiles.id });
  await withTransaction(suite.db, (tx) =>
    setProfileServiceAccess(tx, till.cfg, profile!.id, {
      departmentId: till.departmentId,
      allowedZoneIds: null,
      startingZoneId: till.startingZoneId,
    }),
  );
  const device = await enrolDeviceForTest(suite.db, till.cfg, {
    name: `Till ${randomUUID()}`,
    profileId: profile!.id,
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: till.personId, pin: "5555" }),
  );
  return {
    profileId: profile!.id,
    till: {
      app: till.app,
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    },
  };
}

async function startRevision(till: Pick<Till, "app" | "cookie">): Promise<unknown> {
  const answer = await sendAsTill(till, "GET", "/api/till");
  expect(answer.status).toBe(200);
  return answer.body.setupRevision;
}

async function menuStateRevision(till: Pick<Till, "app" | "cookie">): Promise<unknown> {
  const answer = await sendAsTill(till, "GET", "/api/menu-state");
  expect(answer.status).toBe(200);
  return answer.body.setupRevision;
}

describe("the till's setup revision", () => {
  it("the start read and menu-state name the same setup revision for one till", async () => {
    const till = await setupTill();
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.status).toBe(200);
    expect(typeof start.body.setupRevision).toBe("string");
    expect(await menuStateRevision(till)).toBe(start.body.setupRevision);
  });

  it("the revision stays while nothing changes", async () => {
    const till = await setupTill();
    const first = await menuStateRevision(till);
    expect(typeof first).toBe("string");
    expect(await menuStateRevision(till)).toBe(first);
  });

  it("the revision moves when a course is added, when one is renamed, and when bump mode changes", async () => {
    const till = await setupTill();
    const seen = [await menuStateRevision(till)];
    const course = await withTransaction(suite.db, (tx) =>
      createCourse(tx, till.cfg, { name: "Entrantes" }),
    );
    seen.push(await menuStateRevision(till));
    await withTransaction(suite.db, (tx) =>
      updateCourse(tx, till.cfg, course.id, { name: "Primeros" }),
    );
    seen.push(await menuStateRevision(till));
    await withTransaction(suite.db, (tx) =>
      tx.update(locations).set({ bumpMode: "ticket" }).where(eq(locations.id, till.cfg.locationId)),
    );
    seen.push(await menuStateRevision(till));
    expect(seen.every((revision) => typeof revision === "string")).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("two devices on different profiles name different revisions, which meet once the profiles match", async () => {
    const first = await setupTill();
    const second = await secondDeviceOnOwnProfile(first);
    const firstRevision = await startRevision(first);
    const secondRevision = await startRevision(second.till);
    expect(typeof firstRevision).toBe("string");
    expect(typeof secondRevision).toBe("string");
    expect(secondRevision).not.toBe(firstRevision);
    expect(await menuStateRevision(first)).toBe(firstRevision);
    expect(await menuStateRevision(second.till)).toBe(secondRevision);
    await suite.db
      .update(deviceProfiles)
      .set({ inactivityTimeoutSeconds: null })
      .where(eq(deviceProfiles.id, second.profileId));
    expect(await startRevision(second.till)).toBe(firstRevision);
    expect(await menuStateRevision(second.till)).toBe(firstRevision);
  });
});
