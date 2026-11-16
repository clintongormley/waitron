import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  withTransaction,
  mediaBlobs,
  mediaImages,
  readActivityForSubject,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { deleteImage, readImageBytes, uploadImage } from "./images.js";
import { saveImage } from "./image-edits.js";
import { samplePreparedImage } from "./testing/sample-image.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const photo = await samplePreparedImage({ width: 8 });
const replacement = await samplePreparedImage({ width: 12 });
const next = await samplePreparedImage({ width: 15 });
const upload = (image = photo) =>
  withTransaction(suite.db, (tx) =>
    uploadImage(tx, { image, names: { en: "Bread" } }, { fallbackLanguage: "en" }),
  );
const replace = (id: string, picture: typeof photo, expectedRevision: number) =>
  withTransaction(suite.db, (tx) =>
    saveImage(
      tx,
      id,
      { names: { en: "Bread" }, framing: { x: 5000, y: 5000, zoom: 100 }, expectedRevision },
      picture,
      undefined,
      "en",
    ),
  );

it("stores identical uploads once", async () => {
  const a = await upload();
  const b = await upload();
  expect(b).toEqual({ created: false, image: a.image });
  expect(suite.db.get(sql`select count(*) as n from media_blobs`)).toEqual({ n: 1 });
});
it("prunes a replaced source and deletes unused originals and sources with their photo", async () => {
  const { image } = await upload();
  await replace(image.id, replacement, 1);
  await replace(image.id, next, 2);
  expect(await readImageBytes(suite.db, replacement.filename)).toBeNull();
  expect((await readImageBytes(suite.db, photo.filename))!.bytes).toEqual(photo.bytes);
  const person = await seedPerson(suite.db);
  expect(await withTransaction(suite.db, (tx) => deleteImage(tx, image.id, person))).toEqual({
    deleted: true,
    uses: [],
  });
  expect(await suite.db.select().from(mediaBlobs)).toEqual([]);
  expect(await suite.db.select().from(mediaImages)).toEqual([]);
  const events = await readActivityForSubject(suite.db, { kind: "media_image", id: image.id });
  expect(events).toEqual([
    expect.objectContaining({
      kind: "photo.deleted",
      personId: person,
      data: { filename: photo.filename, names: { en: "Bread" } },
    }),
  ]);
});
it("keeps an original used as another photo's replacement until neither names it", async () => {
  const a = (await upload()).image;
  const b = (await upload(replacement)).image;
  await replace(b.id, photo, 1);
  await withTransaction(suite.db, (tx) => deleteImage(tx, a.id, null));
  expect((await readImageBytes(suite.db, photo.filename))!.bytes).toEqual(photo.bytes);
  expect(
    await suite.db
      .select({ hash: mediaBlobs.hash })
      .from(mediaBlobs)
      .where(eq(mediaBlobs.hash, photo.filename.slice(0, 64))),
  ).toHaveLength(1);
  await withTransaction(suite.db, (tx) => deleteImage(tx, b.id, null));
  expect(await suite.db.select().from(mediaBlobs)).toEqual([]);
});
