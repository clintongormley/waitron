import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { isRefusal, restrictRefused, checkFailed, FOREIGN_KEY_VIOLATION } from "../index.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const light = `${"a".repeat(64)}.webp`;
const dark = `${"b".repeat(64)}.webp`;
const unused = `${"c".repeat(64)}.webp`;

function photo(filename: string) {
  const hash = filename.slice(0, 64);
  suite.db.execute(
    sql`insert into media_blobs (hash, format, bytes) values (${hash}, 'webp', x'00')`,
  );
  suite.db.execute(sql`
    insert into media_images (id, filename, names, original_hash, created_at, updated_at)
    values (${hash}, ${filename}, '{}', ${hash}, 0, 0)
  `);
}

function theme(name: string, lightImage: string | null, darkImage: string | null) {
  return suite.db.execute(sql`
    insert into custom_themes (id, name, name_key, theme, updated_at, logo_light_image, logo_dark_image)
    values (${name}, ${name}, ${name}, '{}', '2026-11-19T00:00:00Z', ${lightImage}, ${darkImage})
  `);
}

it("accepts neither logo, a light logo alone, or both logos", () => {
  photo(light);
  photo(dark);
  theme("none", null, null);
  theme("light", light, null);
  theme("both", light, dark);
  expect(
    suite.db.all(
      sql`select name, logo_light_image, logo_dark_image from custom_themes order by name`,
    ),
  ).toEqual([
    { name: "both", logo_light_image: light, logo_dark_image: dark },
    { name: "light", logo_light_image: light, logo_dark_image: null },
    { name: "none", logo_light_image: null, logo_dark_image: null },
  ]);
});

it("refuses a dark logo without a light logo", async () => {
  photo(dark);
  expect(
    checkFailed(await captureError(() => theme("dark", null, dark)), "custom_themes_logo_ck"),
  ).toBe(true);
});

it("refuses a filename absent from the library in either logo position", async () => {
  photo(light);
  for (const [lightImage, darkImage] of [
    [unused, null],
    [light, unused],
  ] as const) {
    expect(
      isRefusal(
        await captureError(() => theme("missing", lightImage, darkImage)),
        FOREIGN_KEY_VIOLATION,
      ),
    ).toBe(true);
  }
});

it("refuses deletion of either named image and allows deletion of an unused one", async () => {
  for (const filename of [light, dark, unused]) photo(filename);
  theme("both", light, dark);
  const remove = (filename: string) =>
    suite.db.execute(sql`delete from media_images where filename = ${filename}`);
  for (const filename of [light, dark]) {
    expect(restrictRefused(await captureError(() => remove(filename)))).toBe(true);
  }
  remove(unused);
  expect(suite.db.all(sql`select filename from media_images order by filename`)).toEqual([
    { filename: light },
    { filename: dark },
  ]);
});
