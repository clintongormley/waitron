import { Hono } from "hono";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
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
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { MEDIA_ROUTES } from "./routes.js";
import { prepareImage } from "./prepare.js";
import { sampleImage } from "./testing/sample-image.js";

registerModulePermissions([{ permission: "image.manage", grantedFrom: "manager" }]);
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photo = await sampleImage({ width: 8, height: 6, format: "jpeg" });
/** `maxUploadBytes: null` names no limit, and `contentDefaultLanguage: null` no default language,
 * leaving the route to its own fallback for each. */
async function fixture(
  role = "manager",
  maxUploadBytes: number | null = 1000,
  contentDefaultLanguage: string | null = "fr",
) {
  const id = await seedTenant(suite.db);
  // Through the table definition, not raw SQL: `id` and the timestamps are JavaScript generators
  // (`$defaultFn`), never column DEFAULTs, so a raw insert naming none of them is refused with
  // `NOT NULL constraint failed`.
  //
  // A fresh display name per call: live display names are unique across the database, and this
  // fixture runs twice in one test (a staff caller, then a manager).
  const [person] = await suite.db
    .insert(persons)
    .values({
      displayName: `Manager ${crypto.randomUUID()}`,
      pinHash: hashPin("1234"),
      role: role as "manager" | "staff",
    })
    .returning({ id: persons.id });
  const session = await suite.db.transaction((tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  const app = new Hono();
  MEDIA_ROUTES.mount(
    app,
    {
      db: suite.db,
      cfg: {
        locationId: locationId("00000000-0000-4000-8000-000000000001"),
        ...(contentDefaultLanguage === null ? {} : { contentDefaultLanguage }),
      },
      ...(maxUploadBytes === null ? {} : { maxUploadBytes }),
      core: {
        openTab: async () => {
          throw new Error("unused");
        },
      },
    },
    () => {},
  );
  return { app, id, headers: { Cookie: `${MANAGEMENT_COOKIE}=${session.token}` } };
}
function body() {
  const form = new FormData();
  form.set("file", new File([photo], "photo.jpg", { type: "image/jpeg" }));
  form.set("names", JSON.stringify({ fr: "Pain" }));
  form.set("altText", JSON.stringify({ fr: "Une miche" }));
  form.set("labels", JSON.stringify(["Food"]));
  return form;
}
describe("image routes", () => {
  it("identifies reused uploads and returns their original metadata unchanged", async () => {
    const { app, headers } = await fixture();
    const created = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: body(),
    });
    const first = (await created.json()) as { created: boolean; image: Record<string, unknown> };
    const duplicate = body();
    duplicate.set("names", JSON.stringify({ fr: "Nouveau nom" }));
    duplicate.set("altText", JSON.stringify({ fr: "Autre description" }));
    duplicate.set("labels", JSON.stringify(["Other"]));
    const reused = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: duplicate,
    });
    expect(reused.status).toBe(200);
    expect(await reused.json()).toEqual({ created: false, image: first.image });
    expect(first.created).toBe(true);
  });
  it("uploads, searches, serves public bytes, edits and deletes a photo", async () => {
    const { app, headers } = await fixture();
    const created = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(created.status).toBe(201);
    const { image } = (await created.json()) as {
      image: { id: string; filename: string; names: Record<string, string> };
    };
    expect(image.names).toEqual({ fr: "Pain" });
    const publicImage = await app.request(`/media/${image.filename}`);
    expect(publicImage.status).toBe(200);
    const stored = await prepareImage(photo, { maxUploadBytes: 1000 });
    expect(image.filename).toBe(stored.filename);
    expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(stored.bytes);
    expect(publicImage.headers.get("content-type")).toBe("image/webp");
    const list = await app.request("/management-api/images?search=Pain&sort=relevance", {
      headers,
    });
    expect(await list.json()).toMatchObject({ total: 1, images: [{ id: image.id }] });
    const detail = await app.request(`/management-api/images/${image.id}`, { headers });
    expect(await detail.json()).toMatchObject({ image: { id: image.id }, uses: [] });
    const edited = await app.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        names: { fr: "Baguette" },
        altText: { fr: "Une baguette" },
        labels: [],
      }),
    });
    expect(edited.status).toBe(200);
    const removed = await app.request(`/management-api/images/${image.id}`, {
      method: "DELETE",
      headers,
    });
    expect(await removed.json()).toEqual({ deleted: true, uses: [] });
    expect((await app.request(`/media/${image.filename}`)).status).toBe(404);
  });
  it("requires manager access and rejects malformed input", async () => {
    const { app, headers } = await fixture("staff");
    expect((await app.request("/management-api/images")).status).toBe(401);
    expect((await app.request("/management-api/images", { headers })).status).toBe(403);
    const manager = await fixture();
    expect(
      (
        await manager.app.request("/management-api/images", {
          method: "POST",
          headers: manager.headers,
          body: new FormData(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await manager.app.request("/management-api/images?offset=no", { headers: manager.headers }))
        .status,
    ).toBe(400);
    expect(
      (await manager.app.request("/management-api/images/not-an-id", { headers: manager.headers }))
        .status,
    ).toBe(400);
  });
});

it("stores a PNG or a WebP upload as WebP, serves it immutable, and rejects malformed public names", async () => {
  const { app, headers } = await fixture();
  for (const upload of [
    await sampleImage({ width: 20, height: 6, format: "png" }),
    await sampleImage({ width: 21, height: 6, format: "webp" }),
  ]) {
    const form = body();
    form.set("file", new File([upload], "ignored.gif", { type: "image/gif" }));
    const created = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: form,
    });
    expect(created.status).toBe(201);
    const { image } = (await created.json()) as { image: { filename: string } };
    const stored = await prepareImage(upload, { maxUploadBytes: 1000 });
    expect(image.filename).toBe(stored.filename);
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await app.request(`/media/${image.filename}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(stored.bytes);
    }
  }
  for (const name of [
    "../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "x",
    "a".repeat(64) + ".gif",
    "a".repeat(63) + ".png",
    "a".repeat(65) + ".png",
    "A".repeat(64) + ".png",
    "a".repeat(64) + ".PNG",
    "a".repeat(64) + ".png",
  ]) {
    const response = await app.request(`/media/${encodeURIComponent(name)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  }
});
it("enforces file and raw request limits and rejects unsupported bytes or malformed metadata", async () => {
  const { app, headers } = await fixture();
  for (const [size, status] of [
    [1001, 413],
    [70 * 1024, 413],
    [3, 415],
  ]) {
    const form = body();
    form.set("file", new File([new Uint8Array(size!)], "large.jpg"));
    expect(
      (await app.request("/management-api/images", { method: "POST", headers, body: form })).status,
    ).toBe(status);
  }
  const damaged = body();
  damaged.set("file", new File([photo.subarray(0, 134)], "cut.jpg"));
  const refused = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: damaged,
  });
  expect(refused.status).toBe(422);
  expect(await refused.json()).toEqual({ error: { code: "image.invalid_file", params: {} } });
  for (const value of ["not-json", "null", "[]", JSON.stringify({ fr: 42 })]) {
    const form = body();
    form.set("names", value);
    expect(
      (await app.request("/management-api/images", { method: "POST", headers, body: form })).status,
    ).toBe(400);
  }
});

it("refuses a picture declaring too many pixels as 413", async () => {
  const { app, headers } = await fixture("manager", 1024 * 1024);
  const bomb = await sharp({
    create: { width: 10_001, height: 10_000, channels: 3, background: "white" },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const form = body();
  form.set("file", new File([new Uint8Array(bomb)], "huge.png"));
  const response = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: form,
  });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    error: { code: "image.too_many_pixels", params: { maxPixels: 100_000_000 } },
  });
});

it("falls back to a 20 MiB upload limit when the host names none", async () => {
  const { app, headers } = await fixture("manager", null);
  // The size check passes, and the bytes (a JPEG start and nothing a decoder can read) are refused
  // by the decoder instead.
  const between = new Uint8Array(6 * 1024 * 1024);
  between.set([0xff, 0xd8, 0xff], 0);
  const accepted = body();
  accepted.set("file", new File([between], "big.jpg"));
  const decoded = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: accepted,
  });
  expect(decoded.status).toBe(422);
  expect(await decoded.json()).toEqual({ error: { code: "image.invalid_file", params: {} } });
  // One byte over 20 MiB: refused by size, naming the limit.
  const over = body();
  over.set("file", new File([new Uint8Array(20 * 1024 * 1024 + 1)], "huge.jpg"));
  const refused = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: over,
  });
  expect(refused.status).toBe(413);
  expect(await refused.json()).toEqual({
    error: { code: "image.too_large", params: { maxBytes: 20 * 1024 * 1024 } },
  });
});

it("reads labels and a limited page, and refuses an unknown id and malformed bodies", async () => {
  const { app, headers } = await fixture();
  expect(
    (await app.request("/management-api/images", { method: "POST", headers, body: body() })).status,
  ).toBe(201);
  const labels = await app.request("/management-api/image-labels", { headers });
  expect(labels.status).toBe(200);
  expect(await labels.json()).toEqual({ labels: ["Food"] });
  const page = await app.request("/management-api/images?limit=1", { headers });
  expect(page.status).toBe(200);
  expect(((await page.json()) as { images: unknown[] }).images).toHaveLength(1);

  const unknownId = crypto.randomUUID();
  const unknown = await app.request(`/management-api/images/${unknownId}`, { headers });
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({
    error: { code: "image.not_found", params: { imageId: unknownId } },
  });

  const invalid = { error: { code: "image.invalid_metadata", params: {} } };
  // A metadata field sent as a file rather than as JSON text.
  const fileField = body();
  fileField.set("names", new File(["{}"], "names.json"));
  const refusedField = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: fileField,
  });
  expect(refusedField.status).toBe(400);
  expect(await refusedField.json()).toEqual(invalid);
  // A multipart body the parser cannot read.
  const unreadable = await app.request("/management-api/images", {
    method: "POST",
    headers: { ...headers, "Content-Type": "multipart/form-data; boundary=missing" },
    body: "not multipart at all",
  });
  expect(unreadable.status).toBe(400);
  expect(await unreadable.json()).toEqual(invalid);
  // An edit whose body is JSON but not an object.
  const edit = await app.request(`/management-api/images/${unknownId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "[]",
  });
  expect(edit.status).toBe(400);
  expect(await edit.json()).toEqual(invalid);
});

it("requires a name in the shared fallback language when the venue configures no default", async () => {
  // No stored language settings either (`seedTenant` writes none), so nothing else names one.
  const { app, headers } = await fixture("manager", 1000, null);
  const french = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: body(),
  });
  expect(french.status).toBe(400);
  expect(await french.json()).toEqual({
    error: { code: "image.translation_required", params: { field: "names", language: "en" } },
  });
  const english = body();
  english.set("names", JSON.stringify({ en: "Bread" }));
  const created = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: english,
  });
  expect(created.status).toBe(201);
});
