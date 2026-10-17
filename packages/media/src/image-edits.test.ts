import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { departmentReceipts, departments, VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import type { ReceiptLogoRasters } from "@waitron/shared";
import { DEFAULT_FRAMING } from "./framing.js";
import { readCurrentImage, saveImage } from "./image-edits.js";
import {
  deleteImage,
  listImages,
  readImage,
  readImageBytes,
  updateImage,
  uploadImage,
} from "./images.js";
import { mediaImageBlobs, mediaImageData, mediaImageEdits, mediaImages } from "./schema/images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, MEDIA_MIGRATIONS],
});
const first = await samplePreparedImage({ width: 18 });
const second = await samplePreparedImage({ width: 29 });
const third = await samplePreparedImage({ width: 43 });
const framing = { x: 2500, y: 7500, zoom: 200 };
const rasters: ReceiptLogoRasters = {
  "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
  "80mm": { widthDots: 16, heightDots: 1, data: "gAA=" },
};
const upload = (picture = first, name = "Original", originalFilename?: string) =>
  withTransaction(suite.db, (tx) =>
    uploadImage(
      tx,
      {
        image: picture,
        names: { en: name },
        originalFilename,
      },
      { fallbackLanguage: "en" },
    ),
  );

it("projects default framing and revisions in detail and both list paths without selecting bytes", async () => {
  const { image } = await upload(first, "Original", "C:\\photos\\dish.webp");
  expect(image).toMatchObject({
    framing: DEFAULT_FRAMING,
    revision: 1,
    sourceFilename: first.filename,
    originalFilename: "dish.webp",
  });
  await suite.db.delete(mediaImages).where(eq(mediaImages.id, image.id));
  const [legacy] = await suite.db
    .insert(mediaImages)
    .values({ filename: first.filename, names: { en: "Seed" } })
    .returning();
  await suite.db.insert(mediaImageData).values({ imageId: legacy!.id, bytes: first.bytes });
  for (const sort of ["date", "name"] as const) {
    const { images } = await listImages(suite.db, { sort, fallbackLanguage: "en" });
    expect(images).toEqual([
      expect.objectContaining({
        id: legacy!.id,
        framing: DEFAULT_FRAMING,
        revision: 0,
        sourceFilename: first.filename,
        originalFilename: null,
      }),
    ]);
    expect(images[0]).not.toHaveProperty("bytes");
  }
  const renamed = await withTransaction(suite.db, (tx) =>
    updateImage(tx, legacy!.id, { names: { en: "Renamed" } }, "en"),
  );
  expect(renamed).toMatchObject({ revision: 1, framing: DEFAULT_FRAMING, originalFilename: null });
});

it("keeps the alias and original bytes while replacement and framing advance together", async () => {
  const { image } = await upload();
  const replaced = await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: image.names, framing, expectedRevision: 1, originalFilename: "/upload/new.webp" },
      second,
      rasters,
      "en",
    ),
  );
  expect(replaced).toMatchObject({
    id: image.id,
    filename: first.filename,
    names: image.names,
    sourceFilename: second.filename,
    originalFilename: "new.webp",
    revision: 2,
    framing,
  });
  expect(await readCurrentImage(suite.db, first.filename)).toEqual({
    imageId: image.id,
    revision: 2,
    sourceFilename: second.filename,
    framing,
    bytes: second.bytes,
  });
  expect(await readImageBytes(suite.db, second.filename)).toEqual({
    bytes: second.bytes,
    contentType: "image/webp",
  });
  const original = await readImageBytes(suite.db, first.filename);
  expect(original?.bytes).toEqual(first.bytes);
  expect(createHash("sha256").update(original!.bytes).digest("hex") + ".webp").toBe(first.filename);
  const renamed = await withTransaction(suite.db, (tx) =>
    updateImage(tx, image.id, { names: { en: "New name" } }, "en"),
  );
  expect(renamed).toMatchObject({
    revision: 3,
    framing,
    sourceFilename: second.filename,
    originalFilename: "new.webp",
  });
  for (const sort of ["date", "name"] as const)
    expect((await listImages(suite.db, { sort, fallbackLanguage: "en" })).images[0]).toEqual(
      renamed,
    );
  expect(await readCurrentImage(suite.db, third.filename)).toBeNull();
});

it("stores a framing-only override and resets a replacement without changing either original", async () => {
  const image = (await upload(first, "Dish", "dish.webp")).image;
  const framed = await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: image.names, framing, expectedRevision: 1 },
      null,
      undefined,
      "en",
    ),
  );
  expect(framed).toMatchObject({
    framing,
    revision: 2,
    sourceFilename: first.filename,
    originalFilename: "dish.webp",
  });
  expect((await suite.db.select().from(mediaImageEdits))[0]!.sourceHash).toBeNull();
  expect(await suite.db.select().from(mediaImageBlobs)).toEqual([]);
  const reset = await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      {
        names: image.names,
        framing: DEFAULT_FRAMING,
        expectedRevision: 2,
        originalFilename: "new.webp",
      },
      second,
      undefined,
      "en",
    ),
  );
  expect(reset).toMatchObject({
    framing: DEFAULT_FRAMING,
    revision: 3,
    sourceFilename: second.filename,
    originalFilename: "new.webp",
  });
  expect((await readImageBytes(suite.db, first.filename))!.bytes).toEqual(first.bytes);
});

it("shares only source bytes, deduplicates by current source, and refuses a retired original alias", async () => {
  const a = (await upload()).image;
  const b = (await upload(second, "Second", "second.webp")).image;
  await withTransaction(suite.db, (tx) =>
    saveImage(tx, a.id, { names: a.names, framing, expectedRevision: 1 }, second, rasters, "en"),
  );
  expect(await readImage(suite.db, b.id)).toEqual(b);
  const duplicate = await upload(second, "Ignored", "ignored.webp");
  expect(duplicate.created).toBe(false);
  expect(duplicate.image.id).toBe(a.id);
  expect(duplicate.image.names).toEqual(a.names);
  expect(duplicate.image.framing).toEqual(framing);
  await expect(upload()).rejects.toMatchObject({
    code: "image.reference_conflict",
    params: { imageId: a.id },
  });
  expect((await suite.db.execute(sql`select count(*) as n from media_image_blobs`)).rows).toEqual([
    { n: 1 },
  ]);
  expect((await listImages(suite.db, {})).total).toBe(2);
});

it("breaks an equal upload date by image id rather than the insertion order", async () => {
  const at = new Date("2026-10-17T10:00:00Z");
  await suite.db
    .insert(mediaImageBlobs)
    .values({ hash: third.filename.slice(0, 64), bytes: third.bytes });
  for (const [id, photo] of [
    ["z", first],
    ["a", second],
  ] as const) {
    await suite.db
      .insert(mediaImages)
      .values({ id, filename: photo.filename, names: { en: id }, createdAt: at });
    await suite.db.insert(mediaImageData).values({ imageId: id, bytes: photo.bytes });
    await suite.db.insert(mediaImageEdits).values({
      imageId: id,
      sourceHash: third.filename.slice(0, 64),
      focusX: 1000,
      zoom: 175,
      originalFilename: `${id}.webp`,
    });
  }
  const reused = await upload(third, "Ignored", "ignored.webp");
  expect(reused).toEqual({ created: false, image: await readImage(suite.db, "a") });
  expect(reused.image).toMatchObject({
    names: { en: "a" },
    originalFilename: "a.webp",
    framing: { x: 1000, y: 5000, zoom: 175 },
  });
});

it("detects unequal stored bytes before deduplication or reuse of a hash", async () => {
  const a = (await upload()).image;
  await suite.db
    .update(mediaImageData)
    .set({ bytes: second.bytes })
    .where(eq(mediaImageData.imageId, a.id));
  await expect(upload()).rejects.toMatchObject({
    code: "image.hash_conflict",
    params: { filename: first.filename },
  });
  await suite.db
    .update(mediaImageData)
    .set({ bytes: first.bytes })
    .where(eq(mediaImageData.imageId, a.id));
  await suite.db.execute(
    sql`insert into media_image_blobs(hash,bytes) values (${second.filename.slice(0, 64)},${third.bytes})`,
  );
  await expect(
    withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        a.id,
        { names: { en: "Wrong" }, framing, expectedRevision: 1 },
        second,
        rasters,
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "image.hash_conflict", params: { filename: second.filename } });
  expect(await readImage(suite.db, a.id)).toEqual(a);
});

it("serializes expected-revision saves so exactly one wins", async () => {
  const image = (await upload()).image;
  const results = await Promise.allSettled(
    ["One", "Two"].map((name) =>
      withTransaction(suite.db, (tx) =>
        saveImage(
          tx,
          image.id,
          { names: { en: name }, framing: DEFAULT_FRAMING, expectedRevision: 1 },
          null,
          undefined,
          "en",
        ),
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toEqual([
    {
      status: "rejected",
      reason: expect.objectContaining({ code: "image.changed", params: { imageId: image.id } }),
    },
  ]);
  expect((await readImage(suite.db, image.id)).revision).toBe(2);
});

it("refuses a deleted image before edit validation", async () => {
  const image = (await upload()).image;
  await withTransaction(suite.db, (tx) => deleteImage(tx, image.id));
  await expect(
    withTransaction(suite.db, (tx) =>
      saveImage(tx, image.id, { names: {}, framing, expectedRevision: 1 }, second, rasters, "en"),
    ),
  ).rejects.toMatchObject({ code: "image.not_found", params: { imageId: image.id } });
});

describe("edit validation", () => {
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, "1", null])(
    "refuses revision %s without a write",
    async (revision) => {
      const image = (await upload()).image;
      await expect(
        withTransaction(suite.db, (tx) =>
          saveImage(
            tx,
            image.id,
            { names: image.names, framing, expectedRevision: revision as number },
            second,
            rasters,
            "en",
          ),
        ),
      ).rejects.toMatchObject({ code: "image.invalid_metadata" });
      expect(await readImage(suite.db, image.id)).toEqual(image);
    },
  );
  it.each([null, { ...framing, x: 0.1 }, { ...framing, y: 10001 }, { ...framing, zoom: 99 }])(
    "refuses bad framing %s",
    async (value) => {
      const image = (await upload()).image;
      await expect(
        withTransaction(suite.db, (tx) =>
          saveImage(
            tx,
            image.id,
            { names: image.names, framing: value as typeof framing, expectedRevision: 1 },
            null,
            rasters,
            "en",
          ),
        ),
      ).rejects.toMatchObject({ code: "image.invalid_framing" });
      expect(await readImage(suite.db, image.id)).toEqual(image);
    },
  );
  it.each(["bad\nname.webp", "bad\rname.webp", "bad\0name.webp", "x".repeat(256)])(
    "refuses an invalid upload basename",
    async (name) => {
      await expect(upload(first, "Name", name)).rejects.toMatchObject({
        code: "image.invalid_metadata",
      });
      expect((await listImages(suite.db, {})).total).toBe(0);
    },
  );
  it.each([42, [], "", "/folder/"])("refuses an unusable upload basename %s", async (name) => {
    await expect(upload(first, "Name", name as string)).rejects.toMatchObject({
      code: "image.invalid_metadata",
    });
    expect((await listImages(suite.db, {})).total).toBe(0);
  });
  it("refuses names and revision overflow without replacing pixels", async () => {
    const image = (await upload()).image;
    await expect(
      withTransaction(suite.db, (tx) =>
        saveImage(
          tx,
          image.id,
          { names: { en: " " }, framing, expectedRevision: 1 },
          second,
          rasters,
          "en",
        ),
      ),
    ).rejects.toMatchObject({
      code: "image.translation_required",
      params: { field: "names", language: "en" },
    });
    await suite.db.execute(
      sql`update media_image_edits set revision = ${Number.MAX_SAFE_INTEGER} where image_id = ${image.id}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveImage(
          tx,
          image.id,
          { names: image.names, framing, expectedRevision: Number.MAX_SAFE_INTEGER },
          second,
          rasters,
          "en",
        ),
      ),
    ).rejects.toMatchObject({ code: "image.invalid_metadata" });
    expect((await readCurrentImage(suite.db, image.filename))?.bytes).toEqual(first.bytes);
  });
});

async function attachLogo(filename: string, active: boolean) {
  const [place] = await suite.db
    .insert(locations)
    .values({ name: "Place", invoiceLocales: ["es-ES"], operationDescription: "Hospitality" })
    .returning();
  const [department] = await suite.db
    .insert(departments)
    .values({
      locationId: place!.id,
      name: active ? "Dining" : "Retired",
      tradingName: "Restaurant",
      active,
    })
    .returning();
  await suite.db.insert(departmentReceipts).values({
    departmentId: department!.id,
    receipt: { logo: filename, phone: "123", footerMessage: { en: "Bye" } },
  });
  return department!.id;
}

it("refreshes currently attached active and inactive logos atomically without overwriting receipt text", async () => {
  await seedTenant(suite.db);
  const image = (await upload()).image;
  const active = await attachLogo(image.filename, true);
  const inactive = await attachLogo(image.filename, false);
  const attachedImage = await readImage(suite.db, image.id);
  await expect(
    withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        image.id,
        { names: { en: "Refused" }, framing, expectedRevision: 1 },
        second,
        undefined,
        "en",
      ),
    ),
  ).rejects.toThrow("Receipt logo requires both printable pictures");
  expect(await readImage(suite.db, image.id)).toEqual(attachedImage);
  expect((await suite.db.execute(sql`select count(*) as n from media_image_blobs`)).rows).toEqual([
    { n: 0 },
  ]);
  await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: image.names, framing, expectedRevision: 1 },
      second,
      rasters,
      "en",
    ),
  );
  for (const id of [active, inactive]) {
    const [row] = await suite.db
      .select()
      .from(departmentReceipts)
      .where(eq(departmentReceipts.departmentId, id));
    expect(row!.receipt).toEqual({
      logo: image.filename,
      phone: "123",
      footerMessage: { en: "Bye" },
    });
    expect(row!.logoRasters).toEqual(rasters);
  }
  const before = await suite.db.select().from(departmentReceipts);
  await withTransaction(suite.db, (tx) =>
    updateImage(tx, image.id, { names: { en: "Name only" } }, "en"),
  );
  expect(await suite.db.select().from(departmentReceipts)).toEqual(before);
});

it("rolls back picture, names, framing and every raster if a final logo update throws", async () => {
  await seedTenant(suite.db);
  const image = (await upload()).image;
  await attachLogo(image.filename, true);
  const receipts = await suite.db.select().from(departmentReceipts);
  const attachedImage = await readImage(suite.db, image.id);
  await expect(
    withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`create trigger refuse_picture before update on department_receipts begin select raise(abort,'picture refused'); end`,
      );
      return saveImage(
        tx,
        image.id,
        { names: { en: "Changed" }, framing, expectedRevision: 1 },
        second,
        rasters,
        "en",
      );
    }),
  ).rejects.toThrow("picture refused");
  expect(await readImage(suite.db, image.id)).toEqual(attachedImage);
  expect(await suite.db.select().from(departmentReceipts)).toEqual(receipts);
  expect((await suite.db.execute(sql`select count(*) as n from media_image_blobs`)).rows).toEqual([
    { n: 0 },
  ]);
});

it("rolls back already refreshed rasters and names when the final override update fails", async () => {
  await seedTenant(suite.db);
  const image = (await upload()).image;
  await attachLogo(image.filename, true);
  const before = await readImage(suite.db, image.id);
  const receipts = await suite.db.select().from(departmentReceipts);
  await expect(
    withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`create trigger refuse_override before update on media_image_edits begin select raise(abort,'override refused'); end`,
      );
      return saveImage(
        tx,
        image.id,
        { names: { en: "Changed" }, framing, expectedRevision: 1 },
        second,
        rasters,
        "en",
      );
    }),
  ).rejects.toMatchObject({ message: "override refused", errcode: 1811 });
  expect(await readImage(suite.db, image.id)).toEqual(before);
  expect(await suite.db.select().from(departmentReceipts)).toEqual(receipts);
  expect((await suite.db.execute(sql`select count(*) as n from media_image_blobs`)).rows).toEqual([
    { n: 0 },
  ]);
});

it("keeps durable sources after deleting their last photo, while removing that photo's override", async () => {
  const image = (await upload()).image;
  await withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      image.id,
      { names: image.names, framing, expectedRevision: 1 },
      second,
      rasters,
      "en",
    ),
  );
  await expect(
    withTransaction(suite.db, (tx) => tx.execute(sql`delete from media_image_blobs`)),
  ).rejects.toMatchObject({ errcode: 1811, message: "FOREIGN KEY constraint failed" });
  expect(await withTransaction(suite.db, (tx) => deleteImage(tx, image.id))).toEqual({
    deleted: true,
    uses: [],
  });
  expect((await suite.db.execute(sql`select count(*) as n from media_image_edits`)).rows).toEqual([
    { n: 0 },
  ]);
  expect(await readImageBytes(suite.db, second.filename)).toEqual({
    bytes: second.bytes,
    contentType: "image/webp",
  });
  expect(await readCurrentImage(suite.db, image.filename)).toBeNull();
});

describe("stored edit constraints", () => {
  for (const [column, invalid] of [
    ["focus_x", [-1, 10001, 0.5, "text"]],
    ["focus_y", [-1, 10001, 0.5, "text"]],
    ["zoom", [99, 401, 100.5, "text"]],
    ["revision", [0, Number.MAX_SAFE_INTEGER + 1, 1.5, "text"]],
  ] as const) {
    it.each(invalid)(`refuses ${column}=%s in direct SQL`, async (value) => {
      const image = (await upload()).image;
      await expect(
        withTransaction(suite.db, (tx) =>
          tx.execute(
            sql`update media_image_edits set ${sql.identifier(column)} = ${value} where image_id = ${image.id}`,
          ),
        ),
      ).rejects.toMatchObject({ errcode: 275 });
      expect((await readImage(suite.db, image.id)).revision).toBe(1);
    });
  }
  it.each(["A".repeat(64), "a".repeat(63), "a".repeat(65), "a".repeat(64) + "\0x"])(
    "refuses an invalid blob key",
    async (hash) => {
      await expect(
        withTransaction(suite.db, (tx) =>
          tx.execute(
            sql`insert into media_image_blobs(hash,bytes) values (${hash},${second.bytes})`,
          ),
        ),
      ).rejects.toMatchObject({ errcode: 275 });
    },
  );
});
