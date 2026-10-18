import { Hono } from "hono";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  managementSessions,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ModuleRouteContext } from "@waitron/module";
import { locationId, type ReceiptLogoRasters } from "@waitron/shared";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { MEDIA_ROUTES } from "./routes.js";
import { DEFAULT_FRAMING } from "./framing.js";
import { readImage, readImageBytes, updateImage, uploadImage } from "./images.js";
import { mediaImageData, mediaImageEdits } from "./schema/images.js";
import { sampleImage, samplePreparedImage } from "./testing/sample-image.js";
import * as renditionRendering from "./renditions.js";

registerModulePermissions([{ permission: "image.manage", grantedFrom: "manager" }]);
const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    MEDIA_MIGRATIONS,
  ],
});
const first = await samplePreparedImage({ width: 20, height: 12 });
const replacement = await sampleImage({ width: 30, height: 20, format: "png" });
const frame = { x: 0, y: 10000, zoom: 200 };
const rasters: ReceiptLogoRasters = {
  "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
  "80mm": { widthDots: 8, heightDots: 1, data: "gA==" },
};
async function fixture(
  renderReceiptLogo?: (bytes: Uint8Array) => Promise<ReceiptLogoRasters>,
  role: "manager" | "staff" = "manager",
) {
  await seedTenant(suite.db);
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: crypto.randomUUID(), pinHash: hashPin("1234"), role })
    .returning();
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  const { image } = await withTransaction(suite.db, (tx) =>
    uploadImage(tx, { image: first, names: { en: "First" } }, { fallbackLanguage: "en" }),
  );
  const app = new Hono();
  const ctx = {
    db: suite.db,
    cfg: {
      locationId: locationId("00000000-0000-4000-8000-000000000001"),
      contentDefaultLanguage: "en",
    },
    maxUploadBytes: 1000,
    renderReceiptLogo,
    core: {
      floorPlanSets: {
        create: () => Promise.reject(new Error("unused floor plan sets")),
        copyLayouts: () => Promise.reject(new Error("unused floor plan sets")),
        readLayouts: () => Promise.reject(new Error("unused floor plan sets")),
        zonesShowing: () => Promise.reject(new Error("unused floor plan sets")),
      },
      floorDeletion: {
        removeSets: async () => {},
        readImpact: async () => {
          throw new Error("unused");
        },
        clear: async () => {
          throw new Error("unused");
        },
      },
      seatTable: async () => {
        throw new Error("unused");
      },
    },
  } as ModuleRouteContext;
  MEDIA_ROUTES.mount(app, ctx, () => {});
  const headers = { Cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  const edit = (body: unknown) =>
    app.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const multipart = (bytes = replacement) => {
    const form = new FormData();
    form.set("file", new File([bytes], "C:\\photos\\new.png"));
    form.set("names", JSON.stringify({ en: "Changed" }));
    form.set("framing", JSON.stringify(frame));
    form.set("expectedRevision", "1");
    return form;
  };
  return { app, person: person!, image, headers, edit, multipart };
}
it("commits names, replacement, upload basename and adjusted framing in one request while retaining raw bytes", async () => {
  const rendered = vi.fn(async (bytes: Uint8Array) => {
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 15, height: 10 });
    await withTransaction(suite.db, async (tx) => {
      await tx.update(persons).set({ firstNames: "Prepared outside lock" });
    });
    return rasters;
  });
  const { app, image, headers, multipart } = await fixture(rendered);
  const response = await app.request(`/management-api/images/${image.id}`, {
    method: "PATCH",
    headers,
    body: multipart(),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    image: {
      id: image.id,
      filename: image.filename,
      names: { en: "Changed" },
      originalFilename: "new.png",
      revision: 2,
      framing: frame,
    },
  });
  expect(rendered).toHaveBeenCalledTimes(1);
  expect((await readImageBytes(suite.db, image.filename))!.bytes).toEqual(first.bytes);
});
it("accepts revision zero and names-only edits without requiring image work", async () => {
  const { image, edit } = await fixture();
  await suite.db.delete(mediaImageEdits).where(eq(mediaImageEdits.imageId, image.id));
  const response = await edit({
    names: { en: "Renamed" },
    framing: DEFAULT_FRAMING,
    expectedRevision: 0,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    image: { names: { en: "Renamed" }, revision: 1, framing: DEFAULT_FRAMING },
  });
  const stale = await edit({
    names: { en: "Lost update" },
    framing: DEFAULT_FRAMING,
    expectedRevision: 0,
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({
    error: { code: "image.changed", params: { imageId: image.id } },
  });
  expect((await readImage(suite.db, image.id)).names).toEqual({ en: "Renamed" });
});
it("requires a raster hook for every framing save, even before a logo uses the photo", async () => {
  const { image, edit } = await fixture();
  const response = await edit({ names: { en: "Changed" }, framing: frame, expectedRevision: 1 });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "image.busy", params: {} } });
  expect(await readImage(suite.db, image.id)).toMatchObject({
    names: image.names,
    framing: DEFAULT_FRAMING,
    revision: 1,
  });
});
it("rejects stale and malformed fields before raster preparation", async () => {
  const render = vi.fn(async () => rasters);
  const { edit, image } = await fixture(render);
  const valid = { names: { en: "Changed" }, framing: frame, expectedRevision: 1 };
  for (const [body, code] of [
    [null, "image.invalid_metadata"],
    [[], "image.invalid_metadata"],
    [{ names: null, framing: frame, expectedRevision: 1 }, "image.invalid_metadata"],
    [{ ...valid, expectedRevision: null }, "image.invalid_metadata"],
    [{ ...valid, expectedRevision: 1.5 }, "image.invalid_metadata"],
    [{ ...valid, expectedRevision: -1 }, "image.invalid_metadata"],
    [{ names: valid.names, framing: frame }, "image.invalid_metadata"],
    [{ ...valid, framing: null }, "image.invalid_framing"],
    [{ ...valid, framing: { ...frame, other: 1 } }, "image.invalid_framing"],
    [{ ...valid, names: { en: 42 } }, "image.invalid_metadata"],
  ] as const) {
    const response = await edit(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
  }
  const stale = await edit({ ...valid, expectedRevision: 0 });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({
    error: { code: "image.changed", params: { imageId: image.id } },
  });
  expect(render).not.toHaveBeenCalled();
});
it("rechecks permission after preparation and rolls the entire save back", async () => {
  let personId = "";
  const render = vi.fn(async () => {
    await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, personId));
    return rasters;
  });
  const { image, person, edit } = await fixture(render);
  personId = person.id;
  const response = await edit({
    names: { en: "Unauthorized" },
    framing: frame,
    expectedRevision: 1,
  });
  expect(render).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "authorization.not_permitted", params: { permission: "image.manage" } },
  });
  expect(await readImage(suite.db, image.id)).toMatchObject({
    names: image.names,
    revision: 1,
    framing: DEFAULT_FRAMING,
  });
});
it("authorizes before parsing or decoding replacement bytes", async () => {
  const render = vi.fn(async () => rasters);
  const { app, image, headers, multipart } = await fixture(render, "staff");
  for (const requestHeaders of [{}, headers]) {
    const response = await app.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers: requestHeaders,
      body: multipart(new Uint8Array([0xff, 0xd8, 0xff])),
    });
    expect(response.status).toBe("Cookie" in requestHeaders ? 403 : 401);
    expect(await response.json()).toMatchObject({
      error: {
        code:
          "Cookie" in requestHeaders
            ? "authorization.not_permitted"
            : "management_session.required",
      },
    });
  }
  expect(render).not.toHaveBeenCalled();
});
it("applies upload and raw body bounds, unsupported and damaged-file refusals to replacements", async () => {
  const { app, image, headers, multipart } = await fixture(async () => rasters);
  for (const [bytes, status, code] of [
    [new Uint8Array(1001), 413, "image.too_large"],
    [new Uint8Array(70000), 413, "image.too_large"],
    [new Uint8Array([1, 2]), 415, "media.unsupported_type"],
    [new Uint8Array([0xff, 0xd8, 0xff, 1]), 422, "image.invalid_file"],
  ] as const) {
    const response = await app.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers,
      body: multipart(bytes),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  }
  expect((await readImage(suite.db, image.id)).revision).toBe(1);
});

it("leaves sessions passive while public presentation and rendition reads carry a cookie", async () => {
  const { app, image, headers } = await fixture();
  const earlier = new Date(Date.now() - 600_000).toISOString();
  await suite.db.update(managementSessions).set({ lastSeenAt: earlier });
  const response = await app.request(`/media/presentations?references=${image.filename}`, {
    headers,
  });
  expect(response.status).toBe(200);
  const images = ((await response.json()) as { images: Record<string, { square: string }> }).images;
  expect((await app.request(images[image.filename]!.square, { headers })).status).toBe(200);
  expect(
    await suite.db.select({ lastSeenAt: managementSessions.lastSeenAt }).from(managementSessions),
  ).toEqual([{ lastSeenAt: earlier }]);
});
it("refuses malformed multipart fields without preparing or changing the photo", async () => {
  const render = vi.fn(async () => rasters);
  const { app, image, headers, multipart } = await fixture(render);
  const request = (body: BodyInit, extra: Record<string, string> = {}) =>
    app.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers: { ...headers, ...extra },
      body,
    });
  for (const [field, value] of [
    ["file", "not a File"],
    ["names", new File(["{}"], "names.json")],
    ["framing", "not JSON"],
    ["expectedRevision", "null"],
  ] as const) {
    const form = multipart();
    form.set(field, value);
    const response = await request(form);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "image.invalid_metadata" } });
  }
  const duplicate = multipart();
  duplicate.append("expectedRevision", "1");
  expect((await request(duplicate)).status).toBe(400);
  const response = await request("broken multipart", {
    "Content-Type": "multipart/form-data; boundary=absent",
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "image.invalid_metadata" } });
  expect(render).not.toHaveBeenCalled();
  expect((await readImage(suite.db, image.id)).revision).toBe(1);
});
it("does not commit a framing save after preparation fails or finds missing source bytes", async () => {
  const render = vi.fn(async () => {
    throw new Error("Raster refused");
  });
  const { edit, image } = await fixture(render);
  expect(
    (await edit({ names: { en: "Changed" }, framing: frame, expectedRevision: 1 })).status,
  ).toBe(500);
  expect((await readImage(suite.db, image.id)).revision).toBe(1);
  await suite.db.delete(mediaImageData).where(eq(mediaImageData.imageId, image.id));
  const missing = await edit({ names: { en: "Changed" }, framing: frame, expectedRevision: 1 });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    error: { code: "image.not_found", params: { imageId: image.id } },
  });
  expect(render).toHaveBeenCalledTimes(1);
});

it("refuses a revision changed during preparation and retains the newer edit", async () => {
  let imageId = "";
  const render = vi.fn(async () => {
    await withTransaction(suite.db, (tx) =>
      updateImage(tx, imageId, { names: { en: "Newer edit" } }, "en"),
    );
    return rasters;
  });
  const { edit, image } = await fixture(render);
  imageId = image.id;
  const response = await edit({ names: { en: "Stale edit" }, framing: frame, expectedRevision: 1 });
  expect(render).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "image.changed", params: { imageId: image.id } },
  });
  expect(await readImage(suite.db, image.id)).toMatchObject({
    names: { en: "Newer edit" },
    framing: DEFAULT_FRAMING,
    revision: 2,
  });
});

it("saves names without needing source bytes or image decoding", async () => {
  const { edit, image } = await fixture();
  await suite.db.delete(mediaImageData).where(eq(mediaImageData.imageId, image.id));
  const response = await edit({
    names: { en: "Names only" },
    framing: DEFAULT_FRAMING,
    expectedRevision: 1,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    image: { names: { en: "Names only" }, revision: 2 },
  });
});
it("saves a framed photo while the public rendition queue is full", async () => {
  const { app, image, edit } = await fixture(async () => rasters);
  let release!: () => void;
  const held = new Promise<void>((yes) => (release = yes));
  const realRender = renditionRendering.renderRendition;
  const render = vi
    .spyOn(renditionRendering, "renderRendition")
    .mockImplementationOnce(async (...args) => {
      await held;
      return realRender(...args);
    });
  const publicRequests = Array.from({ length: 102 }, (_, i) =>
    app.request(`/media/renditions/v1/${image.filename}/square/${i}-5000-100.webp`),
  );
  try {
    const refused = await Promise.race(publicRequests);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "image.busy" } });
    const saved = await edit({ names: { en: "Still saved" }, framing: frame, expectedRevision: 1 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      image: { names: { en: "Still saved" }, revision: 2, framing: frame },
    });
  } finally {
    release();
    await Promise.all(publicRequests);
    render.mockRestore();
  }
});
