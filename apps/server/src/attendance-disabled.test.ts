import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { expect, it } from "vitest";
import { Hono } from "hono";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { tillSessions } from "@waitron/identity";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { nodeId } from "@waitron/shared";
import { mountTillApi } from "./till-api.js";
import { DEV_DEVICE_HEADER } from "./device-session.js";
import { systemClock } from "./till-backend.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("signs in normally in a venue where workforce has never been migrated", async () => {
  await seedVenue(suite.db, {
    name: "No workforce",
    invoiceLocales: ["en"],
  });
  const node = await seedNode(suite.db);
  const device = await seedDevice(suite.db);
  const [person] = await seedPersons(suite.db, {
    displayName: "Worker",
    pinHash: fixturePinHash("1234"),
  });
  const clock = systemClock();
  const backend = new VerifactuBackend({
    db: suite.db,
    clock,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
  });
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      backend,
      clock,
      cfg: {
        nodeId: nodeId(node),
        locale: "en",
        simplifiedInvoiceLimit: null,
      },
      secureCookies: false,
      venueLocale: "en",
      devMode: true,
      workforceEnabled: false,
    },
    () => {},
  );
  const opened = await app.request("/api/session", {
    method: "POST",
    headers: { [DEV_DEVICE_HEADER]: device.deviceId, "content-type": "application/json" },
    body: JSON.stringify({ personId: person!.id, pin: "1234" }),
  });
  expect(opened.status).toBe(200);
  expect(await opened.json()).toMatchObject({ personId: person!.id });
  expect((await suite.db.select().from(tillSessions)).map((s) => [s.personId, s.deviceId])).toEqual(
    [[person!.id, device.deviceId]],
  );
  expect(
    (await app.request("/api/clock/state", { headers: { [DEV_DEVICE_HEADER]: device.deviceId } }))
      .status,
  ).toBe(404);
  await withTransaction(suite.db, async (tx) => {
    const { rows } = await tx.execute<{ name: string }>(
      "select name from sqlite_master where name like 'attendance_%' or name = 'time_entries'",
    );
    expect(rows).toEqual([]);
  });
});
