import { createHash } from "node:crypto";
import { Hono } from "hono";
import sharp from "sharp";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { MEDIA_ROUTES } from "./routes.js";
import { uploadImage } from "./images.js";
import { saveImage } from "./image-edits.js";
import { DEFAULT_FRAMING } from "./framing.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const first = await samplePreparedImage({ width: 32, height: 24 });
const second = await samplePreparedImage({ width: 60, height: 40 });
async function fixture() {
  await seedTenant(suite.db);
  const { image } = await withTransaction(suite.db, (tx) =>
    uploadImage(tx, { image: first, names: { en: "Bread" } }, { fallbackLanguage: "en" }),
  );
  const app = new Hono();
  MEDIA_ROUTES.mount(
    app,
    {
      db: suite.db,
      cfg: { locationId: locationId("00000000-0000-4000-8000-000000000001") },
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
    },
    () => {},
  );
  const manifest = async () => {
    const response = await app.request(`/media/presentations?references=${image.filename}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return (
      (await response.json()) as {
        images: Record<
          string,
          {
            id: string;
            revision: number;
            source: string;
            square: string;
            till: string;
            display: string;
          }
        >;
      }
    ).images[image.filename]!;
  };
  return { app, image, manifest };
}
it("resolves current pictures without changing original bytes or earlier rendition recipes", async () => {
  const { app, image, manifest } = await fixture();
  const initial = await manifest();
  const base = `/media/renditions/v1/${first.filename}`;
  expect(initial).toEqual({
    id: image.id,
    revision: 1,
    source: `/media/${first.filename}`,
    square: `${base}/square/5000-5000-100.webp`,
    till: `${base}/till/5000-5000-100.webp`,
    display: `${base}/display/5000-5000-100.webp`,
  });
  const earlier = new Uint8Array(await (await app.request(initial.square)).arrayBuffer());
  expect(await sharp(earlier).metadata()).toMatchObject({ width: 24, height: 24, format: "webp" });
  await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: { en: "Replacement" }, framing: { x: 0, y: 10000, zoom: 200 }, expectedRevision: 1 },
      second,
      undefined,
      "en",
    ),
  );
  const current = await manifest();
  expect(current).toEqual({
    id: image.id,
    revision: 2,
    source: `/media/${second.filename}`,
    square: `/media/renditions/v1/${second.filename}/square/0-10000-200.webp`,
    till: `/media/renditions/v1/${second.filename}/till/0-10000-200.webp`,
    display: `/media/renditions/v1/${second.filename}/display/0-10000-200.webp`,
  });
  expect(new Uint8Array(await (await app.request(initial.square)).arrayBuffer())).toEqual(earlier);
  expect(new Uint8Array(await (await app.request(initial.source)).arrayBuffer())).toEqual(
    first.bytes,
  );
  expect(new Uint8Array(await (await app.request(current.source)).arrayBuffer())).toEqual(
    second.bytes,
  );
  for (const url of [current.square, current.till, current.display]) {
    const response = await app.request(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe(
      `"${createHash("sha256").update(bytes).digest("hex")}"`,
    );
    const cached = await app.request(url, {
      headers: { "If-None-Match": response.headers.get("etag")! },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
  }
  await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: image.names, framing: DEFAULT_FRAMING, expectedRevision: 2 },
      null,
      undefined,
      "en",
    ),
  );
  expect((await manifest()).square).toBe(
    `/media/renditions/v1/${second.filename}/square/5000-5000-100.webp`,
  );
});
it("omits missing references and refuses repeated, empty, excessive or malformed queries", async () => {
  const { app, image } = await fixture();
  const missing = `${"f".repeat(64)}.webp`;
  const response = await app.request(
    `/media/presentations?references=${image.filename},${missing}`,
  );
  expect(response.status).toBe(200);
  const data = (await response.json()) as { images: Record<string, unknown> };
  expect(Object.keys(data.images)).toEqual([image.filename]);
  for (const query of [
    "",
    "references=",
    "references=x",
    `references=${image.filename},${image.filename}`,
    `references=${image.filename}&references=${missing}`,
    `references=${image.filename}&other=1`,
    "references=" +
      Array.from({ length: 101 }, (_, i) => `${i.toString(16).padStart(64, "0")}.webp`).join(","),
  ]) {
    const refused = await app.request(`/media/presentations?${query}`);
    expect(refused.status, query).toBe(400);
    expect(await refused.json()).toEqual({ error: { code: "image.invalid_query", params: {} } });
  }
});
it("refuses unknown versions, noncanonical recipe arguments and absent immutable sources", async () => {
  const { app } = await fixture();
  for (const recipe of [
    `v0/${first.filename}/square/5000-5000-100.webp`,
    `v2/${first.filename}/square/5000-5000-100.webp`,
    `v1/${first.filename}/circle/5000-5000-100.webp`,
    `v1/${first.filename}/square/05000-5000-100.webp`,
    `v1/${first.filename}/square/10001-0-100.webp`,
    `v1/${first.filename}/square/0-0-401.webp`,
    `v1/${first.filename}/square/0-0-99.webp`,
    `v1/${first.filename}/square/0-0-100.jpg`,
    `v1/${"f".repeat(64)}.webp/square/0-0-100.webp`,
  ]) {
    const response = await app.request(`/media/renditions/${recipe}`);
    expect(response.status, recipe).toBe(404);
    expect(await response.text()).toBe("");
  }
});
