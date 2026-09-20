import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  asAppUser,
  captureError,
  pgErrorCode,
  pgErrorMessage,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { deleteImage, readImageBytes, uploadImage } from "./images.js";

const suite = useTemplateDb({ template: "media" });
const photo = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const metadata = {
  bytes: photo,
  names: { en: "Bread" },
  altText: { en: "Loaf" },
  labels: ["Food"],
};
const options = { fallbackLanguage: "en", maxUploadBytes: 100 };
function app<T>(db: Database, action: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}
async function fixture() {
  await seedTenant(suite.admin);
  const { image } = await app(suite.admin, (tx) => uploadImage(tx, metadata, options));
  const menu = await suite.admin.execute<{ id: string }>(
    sql`insert into catalogues (name) values ('Lunch') returning id`,
  );
  const product = await suite.admin.execute<{
    id: string;
  }>(
    // `unit_price` counts whole cents, so 200 is the 2.00 this fixture means. A quoted decimal
    // here fails loudly with `22P02`, which is how this one was found.
    sql`insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class) values (${menu.rows[0]!.id}, 'Bread', 'each', 200, 'general') returning id`,
  );
  return { image, productId: product.rows[0]!.id };
}
async function blocked(pid: number) {
  await expect
    .poll(
      async () =>
        (
          await suite.admin.execute<{ blocked: boolean }>(
            sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`,
          )
        ).rows[0]!.blocked,
      { timeout: 5000 },
    )
    .toBe(true);
}

it("grants metadata CRUD and immutable byte insertion, and refuses truncation", async () => {
  const { image } = await fixture();
  await app(suite.admin, async (tx) => {
    const role = await tx.execute<{ role: string; superuser: boolean }>(
      sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    expect((await readImageBytes(tx, image.filename))?.bytes).toEqual(photo);
    const grants = await tx.execute<{ table: string; privileges: string }>(sql`
      select relname as table, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from pg_class cross join lateral aclexplode(relacl)
      where relname in ('media_images', 'media_image_data') and grantee = 'app_user'::regrole
      group by relname order by relname
    `);
    expect(grants.rows).toEqual([
      { table: "media_image_data", privileges: "INSERT,SELECT" },
      { table: "media_images", privileges: "DELETE,INSERT,SELECT,UPDATE" },
    ]);
  });
  for (const statement of [
    sql`truncate media_images cascade`,
    sql`delete from media_image_data where image_id = ${image.id}`,
    sql`update media_image_data set bytes = bytes where image_id = ${image.id}`,
  ]) {
    const error = await captureError(() => app(suite.admin, (tx) => tx.execute(statement)));
    expect(pgErrorCode(error)).toBe("42501");
  }
});

it("carries no tenant column and keys the image tables on their own columns", async () => {
  const columns = await suite.admin.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and table_name in ('media_images', 'media_image_data')
      and column_name = 'tenant_id'`);
  expect(columns.rows).toEqual([]);
  const constraints = await suite.admin.execute<{ name: string; def: string }>(sql`
    select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
    where contype in ('p', 'u', 'f') and (
      conrelid in ('public.media_images'::regclass, 'public.media_image_data'::regclass)
      or confrelid = 'public.media_images'::regclass)
    order by conname`);
  expect(constraints.rows).toEqual([
    {
      name: "category_details_media_image_fk",
      def: "FOREIGN KEY (image) REFERENCES media_images(filename) ON DELETE RESTRICT",
    },
    {
      name: "media_image_data_image_fk",
      def: "FOREIGN KEY (image_id) REFERENCES media_images(id) ON DELETE CASCADE",
    },
    { name: "media_image_data_image_id_pk", def: "PRIMARY KEY (image_id)" },
    { name: "media_images_filename_key", def: "UNIQUE (filename)" },
    { name: "media_images_pkey", def: "PRIMARY KEY (id)" },
    {
      name: "products_media_image_fk",
      def: "FOREIGN KEY (image) REFERENCES media_images(filename) ON DELETE RESTRICT",
    },
  ]);
  const indexes = await suite.admin.execute<{ name: string; def: string }>(sql`
    select indexname as name, indexdef as def from pg_indexes
    where schemaname = 'public' and tablename = 'media_images'
      and indexname not in ('media_images_pkey', 'media_images_filename_key')
    order by indexname`);
  expect(indexes.rows).toEqual([
    {
      name: "media_images_date_idx",
      def: "CREATE INDEX media_images_date_idx ON public.media_images USING btree (created_at, id)",
    },
    {
      name: "media_images_search_idx",
      def: "CREATE INDEX media_images_search_idx ON public.media_images USING gin (media_search_vector(names, alt_text, labels))",
    },
  ]);
});

it("refuses a product reference to an absent image filename", async () => {
  const { productId } = await fixture();
  const error = await captureError(() =>
    app(suite.admin, (tx) =>
      tx.execute(
        sql`update products set image = ${"a".repeat(64) + ".jpg"} where id = ${productId}`,
      ),
    ),
  );
  expect(pgErrorCode(error)).toBe("23503");
  expect(pgErrorMessage(error)).toMatch(/products_media_image_fk/);
});

it("refuses a category reference to an absent image filename", async () => {
  const { createCategory } = await import("@waitron/catalogue");
  await fixture();
  const category = await app(suite.admin, (tx) => createCategory(tx, { name: { en: "Bakery" } }));
  const error = await captureError(() =>
    app(suite.admin, (tx) =>
      tx.execute(
        sql`update category_details set image = ${"b".repeat(64) + ".jpg"} where category_id = ${category.id}`,
      ),
    ),
  );
  expect(pgErrorCode(error)).toBe("23503");
  expect(pgErrorMessage(error)).toMatch(/category_details_media_image_fk/);
});

it("refuses image bytes for an absent image and removes the bytes with their image", async () => {
  const { image } = await fixture();
  const error = await captureError(() =>
    app(suite.admin, (tx) =>
      tx.execute(
        sql`insert into media_image_data (image_id, bytes) values (gen_random_uuid(), ${Buffer.from([0])})`,
      ),
    ),
  );
  expect(pgErrorCode(error)).toBe("23503");
  expect(pgErrorMessage(error)).toMatch(/media_image_data_image_fk/);
  await suite.admin.execute(sql`delete from media_images where id = ${image.id}`);
  const data = await suite.admin.execute<{ count: number }>(
    sql`select count(*)::int as count from media_image_data where image_id = ${image.id}`,
  );
  expect(data.rows).toEqual([{ count: 0 }]);
});

it("waits for an attaching product then reports its committed use instead of deleting", async () => {
  const { image, productId } = await fixture();
  const [attach, remove] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const attached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const pid = (await remove.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const adding = app(attach, async (tx) => {
      await tx.execute(sql`update products set image = ${image.filename} where id = ${productId}`);
      ready();
      await wait;
    });
    await attached;
    const deleting = app(remove, (tx) => deleteImage(tx, image.id));
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [result] = await Promise.all([deleting, adding]);
    expect(result.deleted).toBe(false);
    expect(result.uses.map((use) => use.id)).toEqual([productId]);
  } finally {
    release();
    await Promise.all([attach.close(), remove.close()]);
  }
});

it("makes an attachment wait for deletion then rejects the missing reference", async () => {
  const { image, productId } = await fixture();
  const [attach, remove] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const deleted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const pid = (await attach.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const deleting = app(remove, async (tx) => {
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
      ready();
      await wait;
    });
    await deleted;
    const adding = app(attach, (tx) =>
      tx.execute(sql`update products set image = ${image.filename} where id = ${productId}`),
    );
    const settled = Promise.allSettled([adding, deleting]);
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [result, deletion] = await settled;
    expect(result.status).toBe("rejected");
    expect(deletion.status).toBe("fulfilled");
    expect(await app(suite.admin, (tx) => readImageBytes(tx, image.filename))).toBeNull();
  } finally {
    release();
    await Promise.all([attach.close(), remove.close()]);
  }
});

it("waits for an attaching category then reports its committed use instead of deleting", async () => {
  const { createCategory, updateCategory } = await import("@waitron/catalogue");
  const { image } = await fixture();
  const category = await app(suite.admin, (tx) => createCategory(tx, { name: { en: "Bakery" } }));
  const [attach, remove] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const attached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const pid = (await remove.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const adding = app(attach, async (tx) => {
      await updateCategory(tx, category.id, { image: image.filename });
      ready();
      await wait;
    });
    await attached;
    const deleting = app(remove, (tx) => deleteImage(tx, image.id));
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [result] = await Promise.all([deleting, adding]);
    expect(result).toEqual({
      deleted: false,
      uses: [{ kind: "category", id: category.id, names: { en: "Bakery" } }],
    });
  } finally {
    release();
    await Promise.all([attach.close(), remove.close()]);
  }
});

it("makes a category attachment wait for deletion then rejects the missing reference", async () => {
  const { createCategory, updateCategory } = await import("@waitron/catalogue");
  const { image } = await fixture();
  const category = await app(suite.admin, (tx) => createCategory(tx, { name: { en: "Bakery" } }));
  const [attach, remove] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const deleted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const pid = (await attach.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const deleting = app(remove, async (tx) => {
      expect(await deleteImage(tx, image.id)).toEqual({ deleted: true, uses: [] });
      ready();
      await wait;
    });
    await deleted;
    const adding = app(attach, (tx) => updateCategory(tx, category.id, { image: image.filename }));
    const settled = Promise.allSettled([adding, deleting]);
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [result, deletion] = await settled;
    expect(result.status).toBe("rejected");
    expect(deletion.status).toBe("fulfilled");
    expect(await app(suite.admin, (tx) => readImageBytes(tx, image.filename))).toBeNull();
  } finally {
    release();
    await Promise.all([attach.close(), remove.close()]);
  }
});
