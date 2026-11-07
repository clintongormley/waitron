import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const photo = (digit: string) => `${digit.repeat(64)}.jpg`;

async function imageExists(filename: string): Promise<boolean> {
  const rows = await suite.db.execute(sql`select 1 from media_images where filename = ${filename}`);
  return rows.rows.length === 1;
}

it("refuses names that are not an object, and accepts names that are", async () => {
  const insert = async (filename: string, names: string): Promise<void> => {
    await suite.db.execute(sql`
      insert into media_images (id, filename, names, created_at, updated_at)
      values (${filename}, ${filename}, ${names}, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`);
  };
  await expect(insert(photo("a"), "[]")).rejects.toMatchObject({
    message: expect.stringContaining("media_images_names_ck"),
  });
  await insert(photo("b"), "{}");
  expect(await imageExists(photo("b"))).toBe(true);
});
