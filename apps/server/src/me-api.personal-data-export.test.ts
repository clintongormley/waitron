import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  nodes,
  sales,
  saleVoids,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS, WorkforceBackend } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "@waitron/workforce-es";
import { PERSONAL_DATA_README_WORDS } from "./i18n/personal-data-readme.js";
import { mountMeApi } from "./me-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});
const NODE_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/management-api/me/personal-data/export";

// Leaves `now` unset, so the route's own clock is exercised.
function mounted(
  modules: string[],
  patch: { venueLocale?: string; privacyNoticeUrl?: string } = {},
): Hono {
  const app = new Hono();
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: NODE_ID },
      venueLocale: "en-GB",
      modules,
      credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 6) } },
      ...patch,
    },
    () => {},
  );
  return app;
}

async function download(
  modules: string[],
  patch: { venueLocale?: string; privacyNoticeUrl?: string } = {},
): Promise<Record<string, string>> {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: "Marta Canary", role: "staff" })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: row!.id }),
  );
  const response = await mounted(modules, patch).request(PATH, {
    headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

describe("the own personal-data download, mounted by mountMeApi", () => {
  it("reads the identity part when identity is enabled", async () => {
    const files = await download(["core", "identity"]);
    expect(Object.keys(files).sort()).toEqual(["README.txt", "profile.json", "sign-in.json"]);
    expect(files["profile.json"]).toContain("Marta Canary");
  });

  it("reads only the enabled modules, not every module", async () => {
    const files = await download(["core"]);
    expect(files).toEqual({ "README.txt": expect.any(String) });
  });

  it("adds the working-time record when workforce and an exporter are enabled", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({
        name: "Venue",
        invoiceLocales: ["es"],
        operationDescription: "Sale on premises",
        timeZone: "Europe/Madrid",
      })
      .returning({ id: locations.id });
    await suite.db.insert(nodes).values({ id: NODE_ID, locationId: location!.id, name: "Box" });
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: "Marta Canary", role: "staff" })
      .returning({ id: persons.id });
    await withTransaction(suite.db, (tx) =>
      new WorkforceBackend().clockIn(tx, {
        nodeId: NODE_ID,
        locationId: location!.id,
        personId: row!.id,
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
        at: "2026-01-02T23:30:00.000Z",
      }),
    );
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: row!.id }),
    );
    const response = await mounted(["core", "identity", "workforce", "workforce-es"]).request(
      PATH,
      { headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` } },
    );
    expect(response.status).toBe(200);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.hasOwn(files, "time-record.csv")).toBe(true);
    // 23:30Z at +60 is 00:30 on the next local day: a UTC reading would print 2026-01-02.
    const csv = strFromU8(files["time-record.csv"]!);
    expect([
      csv.includes('"document","from","2026-01-03"'),
      csv.includes('"2026-01-03T00:30:00+01:00"'),
      csv.includes("2026-01-02"),
    ]).toEqual([true, true, false]);
  });

  it("adds the actions file for a person who authorised a void", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en"], operationDescription: "Meals" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const nodeId = await seedNode(suite.db, locationId);
    const { deviceId } = await seedDevice(suite.db, { locationId });
    const [series] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId, code: "TA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const [sale] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 7,
        issuedAt: "2026-10-20T08:00:00.000Z",
        issuedOffsetMinutes: 0,
        total: 1250,
        vatBreakdown: [],
        locale: "en",
        invoiceLocales: ["en"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning({ id: sales.id });
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: "Marta Canary", role: "staff" })
      .returning({ id: persons.id });
    await suite.db.insert(saleVoids).values({
      saleId: sale!.id,
      reason: "Wrong table",
      voidedAt: "2026-10-20T09:00:00.000Z",
      voidedBy: row!.id,
    });
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: row!.id }),
    );
    const response = await mounted(["core", "identity"]).request(PATH, {
      headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
    });
    expect(response.status).toBe(200);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      "README.txt",
      "profile.json",
      "sign-in.json",
      "actions.json",
    ]);
    expect(JSON.parse(strFromU8(files["actions.json"]!))).toEqual({
      counts: { voids: 1, refunds: 0, drawerOpenings: 0 },
      voids: [{ sale: "TA/7", amount: "12.50", at: "2026-10-20T09:00:00.000Z" }],
      refunds: [],
      drawerOpenings: [],
    });
    const words = PERSONAL_DATA_README_WORDS.en.files["actions.json"]!;
    expect(strFromU8(files["README.txt"]!)).toContain(
      `- actions.json: ${words.holds} ${words.use}`,
    );
  });

  it("passes the venue's language and the privacy notice's address to the README", async () => {
    const url = "https://venue.example/privacy";
    const files = await download(["core", "identity"], {
      venueLocale: "es-ES",
      privacyNoticeUrl: url,
    });
    const readme = files["README.txt"]!.trimEnd().split("\n");
    expect(readme[0]).toBe(PERSONAL_DATA_README_WORDS.es.title.replace("{venue}", "Test SL"));
    expect(readme.at(-1)!.endsWith(url)).toBe(true);
  });
});
