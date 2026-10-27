import { Hono } from "hono";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonalDataPart } from "@waitron/module";
import { savePrivacyContact } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId as brandLocationId } from "@waitron/shared";
import { PERSONAL_DATA_README_WORDS } from "./i18n/personal-data-readme.js";
import {
  mountPersonalDataExportApi,
  type PersonalDataExportDeps,
} from "./personal-data-export-api.js";
import { personalDataReadme } from "./personal-data-readme.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const PATH = "/management-api/me/personal-data/export";
const NOW = new Date("2026-10-04T22:30:00Z");
const PRIVACY = "https://venue.example/privacy";

const identityModules = ALL_MODULES.filter((m) => m.name === "identity");
let nodeId: string, martaId: string, martaToken: string;

const extraPart: PersonalDataPart = {
  owner: "server",
  part: {
    files: ["extra.json"],
    prepare: async () => async () => [{ name: "extra.json", content: '{"extra":true}\n' }],
  },
};
const silentPart: PersonalDataPart = {
  owner: "server",
  part: { files: ["silent.json"], prepare: async () => async () => [] },
};

function mounted(patch: Partial<PersonalDataExportDeps> = {}) {
  const app = new Hono();
  mountPersonalDataExportApi(
    app,
    {
      db: suite.db,
      nodeId,
      modules: identityModules,
      serverParts: [extraPart, silentPart],
      venueLocale: "en-GB",
      now: () => NOW,
      ...patch,
    },
    () => {},
  );
  return app;
}

async function download(app: Hono, acceptLanguage?: string) {
  const response = await app.request(PATH, {
    headers: {
      cookie: `${MANAGEMENT_COOKIE}=${martaToken}`,
      ...(acceptLanguage === undefined ? {} : { "accept-language": acceptLanguage }),
    },
  });
  expect(response.status).toBe(200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.entries(files).map(([name, data]) => [name, strFromU8(data)] as const);
}
async function readme(app: Hono, acceptLanguage?: string): Promise<string> {
  const entries = await download(app, acceptLanguage);
  expect(entries[0]![0]).toBe("README.txt");
  return entries[0]![1];
}
const lines = (text: string) => text.trimEnd().split("\n");

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["es"],
      operationDescription: "Sale on premises",
      timeZone: "Europe/Madrid",
    })
    .returning();
  nodeId = await seedNode(suite.db, brandLocationId(location!.id));
  const [marta] = await suite.db
    .insert(persons)
    .values({ displayName: "Marta López", email: "marta@example.test", role: "staff" })
    .returning();
  martaId = marta!.id;
  martaToken = await withTransaction(
    suite.db,
    async (tx) => (await startManagementSession(tx, { personId: martaId })).token,
  );
});

describe("the README in a person's own personal-data download", () => {
  it("describes the ZIP: first, naming the venue, dated in its zone, listing the built files", async () => {
    const entries = await download(mounted());
    expect(entries.map(([name]) => name)).toEqual([
      "README.txt",
      "profile.json",
      "sign-in.json",
      "extra.json",
    ]);
    expect(entries[0]![1]).toBe(
      personalDataReadme({
        language: "en",
        venue: "Test SL",
        person: "Marta López",
        date: "2026-10-05",
        files: ["profile.json", "sign-in.json", "extra.json"],
      }),
    );
  });

  it("lists the files built, not a file a part declared and did not build", async () => {
    expect(await readme(mounted())).not.toContain("silent.json");
  });

  it("ends with the privacy notice's address when one is set, and names none otherwise", async () => {
    const app = mounted();
    await withTransaction(suite.db, (tx) => savePrivacyContact(tx, { privacyNoticeUrl: PRIVACY }));
    const withNotice = lines(await readme(app));
    expect(withNotice.at(-1)!.endsWith(PRIVACY)).toBe(true);
    await withTransaction(suite.db, (tx) => savePrivacyContact(tx, { privacyNoticeUrl: null }));
    const without = lines(await readme(app));
    expect(without.some((line) => line.includes("https://"))).toBe(false);
  });

  const title = (language: "en" | "es") =>
    PERSONAL_DATA_README_WORDS[language].title.replace("{venue}", "Test SL");
  it.each([
    { row: 1, saved: "es-ES", accept: "en-GB", venue: "en-GB", expected: "es" },
    { row: 2, saved: "en-GB", accept: "es-ES", venue: "es-ES", expected: "en" },
    { row: 3, saved: null, accept: "es-ES,es;q=0.9", venue: "en-GB", expected: "es" },
    { row: 4, saved: null, accept: undefined, venue: "es-ES", expected: "es" },
    { row: 5, saved: null, accept: "fr-FR", venue: "es-ES", expected: "es" },
    { row: 6, saved: "de-DE", accept: "es-ES", venue: "en-GB", expected: "es" },
  ] as const)(
    "row $row: saved $saved, browser $accept, venue $venue gives $expected",
    async ({ saved, accept, venue, expected }) => {
      suite.db.run(sql`update persons set locale = ${saved} where id = ${martaId}`);
      const text = await readme(mounted({ venueLocale: venue }), accept);
      expect(lines(text)[0]).toBe(title(expected));
    },
  );

  it("names the venue generically when there is no tenant row", async () => {
    suite.db.run(sql`delete from tenants`);
    expect(lines(await readme(mounted()))[0]).toBe("Your data held by the venue");
  });
});
