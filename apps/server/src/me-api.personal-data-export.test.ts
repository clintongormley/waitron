import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, nodes, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { jobOrigin } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS, WorkforceBackend } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "@waitron/workforce-es";
import { PERSONAL_DATA_README_WORDS } from "./i18n/personal-data-readme.js";
import { mountMeApi } from "./me-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});
const NODE_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/management-api/me/personal-data/export";

// Leaves `now` unset, so the route's own clock and its server-parts default are both exercised.
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
        at: "2026-01-02T09:00:00.000Z",
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
    expect(strFromU8(files["time-record.csv"]!)).toContain("2026-01-02");
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
