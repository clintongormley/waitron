import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { locations, nowIso, parties, partyTables, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashSessionToken, persons, sessions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId, nodeId } from "@waitron/shared";
import { serviceStepCompletions } from "@waitron/venue-service";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { SESSION_COOKIE } from "./till-session.js";
import { createZone } from "./testing/service-zone.js";
import { createTable } from "./testing/live-table.js";
import { departmentOf, setSteps } from "./testing/service-steps.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let cfg: TillConfig;
let personId: string;
let token: string;
let partyId: string;
let stepId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Dining room",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    })
    .returning();
  const locationKey = locationId(location!.id);
  cfg = {
    locationId: locationKey,
    nodeId: nodeId(await seedNode(suite.db, locationKey)),
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Ana", role: "staff" })
    .returning();
  personId = person!.id;
  const { deviceId } = await seedDevice(suite.db, {
    locationId: locationKey,
    capabilities: ["take-orders"],
  });
  token = randomUUID();
  await suite.db
    .insert(sessions)
    .values({ deviceId, personId, tokenHash: hashSessionToken(token) });
  const zone = await createZone(suite.db, cfg, { name: "Tables" });
  const table = await createTable(suite.db, cfg, { label: "Table 1", zoneId: zone.id });
  [stepId] = (await setSteps(
    { db: suite.db, cfg },
    await departmentOf({ db: suite.db, cfg }, zone.id),
    [{ name: "Set up", start: "seated", courseId: null, minutes: 0 }],
  )) as [string];
  const [party] = await suite.db.insert(parties).values({ openedBy: personId }).returning();
  partyId = party!.id;
  await suite.db.insert(partyTables).values({ partyId, tableId: table.id });
});

function app() {
  const hono = new Hono();
  mountTillApi(
    hono,
    {
      db: suite.db,
      cfg,
      backend: {} as TillApiDeps["backend"],
      clock: {
        now: () => ({
          instant: new Date(),
          offsetMinutes: 0,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
        anchor: () => {
          throw new Error("This fixture never anchors time");
        },
        currentAnchor: () => null,
      },
      secureCookies: false,
      venueLocale: "en-GB",
    } as TillApiDeps,
    () => {},
  );
  return hono;
}

function done(party: string, step: string, cookie = true) {
  return app().request(`/api/parties/${party}/service-steps/${step}/done`, {
    method: "POST",
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

function completions() {
  return withTransaction(suite.db, (tx) =>
    tx
      .select({ stepId: serviceStepCompletions.stepId, doneBy: serviceStepCompletions.doneBy })
      .from(serviceStepCompletions)
      .where(eq(serviceStepCompletions.partyId, partyId)),
  );
}

async function expectRefusal(
  response: Response,
  status: number,
  code: string,
  params: Record<string, unknown>,
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, params } });
}

describe("POST /api/parties/:id/service-steps/:stepId/done", () => {
  it("records the step Done by the session's person and names it", async () => {
    const res = await done(partyId, stepId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: [stepId] });
    expect(await completions()).toEqual([{ stepId, doneBy: personId }]);
  });

  it("a double tap answers nothing cleared and writes one row", async () => {
    await done(partyId, stepId);

    const res = await done(partyId, stepId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: [] });
    expect(await completions()).toHaveLength(1);
  });

  it("finds a step named in upper case", async () => {
    const res = await done(partyId, stepId.toUpperCase());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: [stepId] });
  });

  it("refuses a step id that names no step", async () => {
    const missing = randomUUID();
    await expectRefusal(await done(partyId, missing), 404, "service_step.not_found", {
      stepId: missing,
    });
    await expectRefusal(await done(partyId, "not-a-uuid"), 404, "service_step.not_found", {
      stepId: "not-a-uuid",
    });
    expect(await completions()).toEqual([]);
  });

  it("refuses an unknown party and a closed one", async () => {
    const unknown = randomUUID();
    await expectRefusal(await done(unknown, stepId), 409, "party.not_open", { partyId: unknown });
    await suite.db
      .update(parties)
      .set({ state: "closed", closedAt: nowIso() })
      .where(eq(parties.id, partyId));
    await expectRefusal(await done(partyId, stepId), 409, "party.not_open", { partyId });
  });

  it("refuses a request with no session", async () => {
    await expectRefusal(await done(partyId, stepId, false), 401, "session.required", {});
    expect(await completions()).toEqual([]);
  });
});
