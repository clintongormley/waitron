import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const hash = "a".repeat(64);
const source = "b".repeat(64);
const blob = (key = hash, format = "jpg") =>
  suite.db.execute(sql`
  insert into media_blobs(hash,format,bytes) values (${key},${format},x'1234')`);
const image = (filename = `${hash}.jpg`, original = hash) =>
  suite.db.execute(sql`
  insert into media_images(id,filename,names,original_hash,created_at,updated_at)
  values ('photo',${filename},'{}',${original},'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`);

it.each(["jpg", "png", "webp"])("accepts a %s original with default framing", async (format) => {
  await blob(hash, format);
  await image(`${hash}.${format}`);
  expect(
    suite.db.get(
      sql`select original_hash,source_hash,focus_x,focus_y,zoom,revision,original_filename from media_images`,
    ),
  ).toEqual({
    original_hash: hash,
    source_hash: null,
    focus_x: 5000,
    focus_y: 5000,
    zoom: 100,
    revision: 1,
    original_filename: null,
  });
});
it.each([".png\0evil", ".jpg\0"])("refuses embedded NUL in %j", async (suffix) => {
  await blob();
  expect(() => image(hash + suffix)).toThrow("media_images_filename_ck");
  await image();
});
it("ties an original hash to its filename", async () => {
  await blob();
  await blob(source);
  expect(() => image(`${hash}.jpg`, source)).toThrow("media_images_original_hash_ck");
  await image();
});
it("refuses deleting original and source bytes while named and allows unnamed bytes", async () => {
  await blob();
  await blob(source, "webp");
  await image();
  suite.db.execute(sql`update media_images set source_hash=${source}`);
  for (const key of [hash, source])
    expect(() => suite.db.execute(sql`delete from media_blobs where hash=${key}`)).toThrow(
      "FOREIGN KEY constraint failed",
    );
  suite.db.execute(sql`update media_images set source_hash=null`);
  suite.db.execute(sql`delete from media_blobs where hash=${source}`);
  expect(suite.db.get(sql`select count(*) as n from media_blobs`)).toEqual({ n: 1 });
});
it.each(["missing-original", "missing-source"])("refuses %s references", async (kind) => {
  if (kind === "missing-original") expect(() => image()).toThrow("FOREIGN KEY constraint failed");
  await blob();
  await image();
  if (kind === "missing-source")
    expect(() => suite.db.execute(sql`update media_images set source_hash=${source}`)).toThrow(
      "FOREIGN KEY constraint failed",
    );
  await blob(source, "webp");
  suite.db.execute(sql`update media_images set source_hash=${source}`);
});
it("refuses blob updates but allows insertion and deletion", async () => {
  await blob();
  expect(() => suite.db.execute(sql`update media_blobs set bytes=x'00'`)).toThrow(
    "media_blobs rows are never changed",
  );
  suite.db.execute(sql`delete from media_blobs`);
  expect(suite.db.get(sql`select count(*) as n from media_blobs`)).toEqual({ n: 0 });
});
it.each(["", "A".repeat(64), "a".repeat(63), hash + "\0"])(
  "refuses a malformed blob hash %j",
  async (key) => {
    expect(() => blob(key)).toThrow("media_blobs_hash_ck");
    await blob();
  },
);
it("refuses an unknown blob format", async () => {
  expect(() => blob(hash, "gif")).toThrow("media_blobs_format_ck");
  await blob();
});
it("uses the original and source indexes when pruning unused bytes", () => {
  const plan = suite.db
    .all<{ detail: string }>(
      sql`explain query plan delete from media_blobs
    where hash=${hash} and not exists (
      select 1 from media_images where original_hash=${hash} or source_hash=${hash}
    )`,
    )
    .map((row) => row.detail);
  expect(plan).toEqual(
    expect.arrayContaining([
      expect.stringContaining("media_images_original_hash_idx"),
      expect.stringContaining("media_images_source_hash_idx"),
    ]),
  );
});
