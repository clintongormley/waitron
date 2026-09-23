import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId } from "@waitron/shared";
import { mediaImageData, mediaImages } from "./schema/images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { MEDIA_ROUTES } from "./routes.js";
import { sampleImage } from "./testing/sample-image.js";

/**
 * Every image route refuses a caller without `image.manage`, and refusing leaves the library
 * untouched.
 *
 * Lifted from `routes.pg.test.ts`, deleted 2026-09-22 with the PostgreSQL test harness (recover it
 * with `git show aabdde6a8^:packages/media/src/routes.pg.test.ts`). `routes.test.ts` beside this
 * file already covers the manager happy path and a staff 403 on ONE route; the six-route matrix
 * and the "the library is unchanged afterwards" read are this file's, and had nothing running
 * behind them during #489.
 *
 * The authorization gate is the module's own code, and it is proven by deletion on this engine,
 * 2026-09-22 on Node v26.7.0: with the `authorizeManager` call in `MEDIA_ROUTES.mount`'s `gated`
 * helper (`packages/media/src/routes.ts`) made unreachable and nothing else changed, this case
 * FAILED on `GET /management-api/images: expected 200 to be 403`; restored, it passes. The
 * accepting control in the other direction is inside `fixture` below, where the manager's own
 * upload must answer 201.
 */
registerModulePermissions([{ permission: "image.manage", grantedFrom: "manager" }]);
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS, MEDIA_MIGRATIONS],
});

const original = { names: { en: "Bread" }, altText: { en: "A loaf" }, labels: ["Food"] };
const changed = {
  names: { en: "Sourdough" },
  altText: { en: "A sourdough loaf" },
  labels: ["Bakery"],
};

function uploadBody(bytes: Uint8Array<ArrayBuffer>): FormData {
  const form = new FormData();
  form.set("file", new File([bytes], "photo.jpg", { type: "image/jpeg" }));
  for (const [key, value] of Object.entries(original)) form.set(key, JSON.stringify(value));
  return form;
}

/** A live management session for `role`. Through the table definition, not raw SQL: `persons.id`
 * and its timestamps are JavaScript `$defaultFn` generators now, never column DEFAULTs, so a raw
 * insert naming none of them is refused `NOT NULL constraint failed`. A fresh display name per
 * call, because live display names are unique across the database and this fixture runs twice. */
async function session(role: "manager" | "staff"): Promise<Record<string, string>> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: `${role} ${crypto.randomUUID()}`, pinHash: hashPin("1234"), role })
    .returning({ id: persons.id });
  const started = await suite.db.transaction((tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return { Cookie: `${MANAGEMENT_COOKIE}=${started.id}` };
}

async function fixture() {
  await seedTenant(suite.db);
  const headers = await session("manager");
  const app = new Hono();
  MEDIA_ROUTES.mount(
    app,
    {
      db: suite.db,
      cfg: {
        locationId: locationId("00000000-0000-4000-8000-000000000001"),
        contentDefaultLanguage: "en",
      },
      maxUploadBytes: 1000,
      core: {
        openTab: async () => {
          throw new Error("unused");
        },
      },
    },
    () => {},
  );
  const created = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: uploadBody(await sampleImage({ width: 8, height: 6, format: "jpeg" })),
  });
  expect(created.status).toBe(201);
  const { image } = (await created.json()) as { image: { id: string; filename: string } };
  return { app, headers, image };
}

it("denies every library operation to a staff caller and preserves existing image data", async () => {
  const { app, image } = await fixture();
  const headers = await session("staff");
  const requests: [string, RequestInit][] = [
    ["/management-api/images", { headers }],
    ["/management-api/image-labels", { headers }],
    [`/management-api/images/${image.id}`, { headers }],
    // Deliberately NOT a decodable picture: authorisation comes before any image work, so a staff
    // caller gets 403 here, never the 422 these bytes would earn from the decoder.
    [
      "/management-api/images",
      { method: "POST", headers, body: uploadBody(new Uint8Array([0xff, 0xd8, 0xff, 1])) },
    ],
    [
      `/management-api/images/${image.id}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      },
    ],
    [`/management-api/images/${image.id}`, { method: "DELETE", headers }],
  ];
  for (const [path, options] of requests) {
    const response = await app.request(path, options);
    expect(response.status, `${options.method ?? "GET"} ${path}`).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "image.manage" } },
    });
  }

  // Nothing above wrote: the one image is still there with its ORIGINAL metadata (not `changed`),
  // and its bytes are still there. Read through the tables rather than raw SQL — `names`,
  // `alt_text` and `labels` are JSON text columns, and a raw select skips the read mapping that
  // parses them, handing back the stored string instead.
  const rows = await suite.db
    .select({
      id: mediaImages.id,
      filename: mediaImages.filename,
      names: mediaImages.names,
      altText: mediaImages.altText,
      labels: mediaImages.labels,
    })
    .from(mediaImages);
  expect(rows).toEqual([{ id: image.id, filename: image.filename, ...original }]);
  const data = await suite.db
    .select({ imageId: mediaImageData.imageId })
    .from(mediaImageData)
    .where(eq(mediaImageData.imageId, image.id));
  expect(data).toHaveLength(1);
});
