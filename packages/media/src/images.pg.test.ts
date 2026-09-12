import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
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
function app<T>(
  db: Database,
  tenantId: string,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}
async function fixture() {
  const tenantId = await seedTenant(suite.admin);
  const { image } = await app(suite.admin, tenantId, (tx) =>
    uploadImage(tx, tenantId, metadata, options),
  );
  const menu = await suite.admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Lunch') returning id`,
  );
  const product = await suite.admin.execute<{
    id: string;
  }>(sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
    values (${tenantId}, ${menu.rows[0]!.id}, '{"en":"Bread"}'::jsonb, 'each', '2.00', 'general') returning id`);
  return { tenantId, image, productId: product.rows[0]!.id };
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
  const { tenantId, image } = await fixture();
  await app(suite.admin, tenantId, async (tx) => {
    const role = await tx.execute<{ role: string; superuser: boolean }>(
      sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    expect((await readImageBytes(tx, tenantId, image.filename))?.bytes).toEqual(photo);
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
  await expect(
    app(suite.admin, tenantId, (tx) => tx.execute(sql`truncate media_images cascade`)),
  ).rejects.toThrow();
  await expect(
    app(suite.admin, tenantId, (tx) =>
      tx.execute(sql`delete from media_image_data where tenant_id = ${tenantId}`),
    ),
  ).rejects.toThrow();
  await expect(
    app(suite.admin, tenantId, (tx) =>
      tx.execute(sql`update media_image_data set bytes = bytes where tenant_id = ${tenantId}`),
    ),
  ).rejects.toThrow();
});

it("refuses a product reference to another tenant's image or an absent filename", async () => {
  const { tenantId, image, productId } = await fixture();
  const other = await seedTenant(suite.admin);
  await app(suite.admin, other, (tx) =>
    uploadImage(tx, other, { ...metadata, bytes: new Uint8Array([...photo, 9]) }, options),
  );
  for (const filename of ["a".repeat(64) + ".jpg", image.filename]) {
    const targetTenant = filename === image.filename ? other : tenantId;
    await expect(
      app(suite.admin, targetTenant, async (tx) => {
        if (targetTenant === other) {
          const menu = await tx.execute<{ id: string }>(
            sql`insert into catalogues (tenant_id, name) values (${other}, 'Other') returning id`,
          );
          return tx.execute(
            sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class, image) values (${other}, ${menu.rows[0]!.id}, '{"en":"Bread"}'::jsonb, 'each', '2', 'general', ${filename})`,
          );
        }
        return tx.execute(
          sql`update products set image = ${filename} where tenant_id = ${tenantId} and id = ${productId}`,
        );
      }),
    ).rejects.toThrow();
  }
});

it("waits for an attaching product then reports its committed use instead of deleting", async () => {
  const { tenantId, image, productId } = await fixture();
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
    const adding = app(attach, tenantId, async (tx) => {
      await tx.execute(
        sql`update products set image = ${image.filename} where tenant_id = ${tenantId} and id = ${productId}`,
      );
      ready();
      await wait;
    });
    await attached;
    const deleting = app(remove, tenantId, (tx) => deleteImage(tx, tenantId, image.id));
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
  const { tenantId, image, productId } = await fixture();
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
    const deleting = app(remove, tenantId, async (tx) => {
      expect(await deleteImage(tx, tenantId, image.id)).toEqual({ deleted: true, uses: [] });
      ready();
      await wait;
    });
    await deleted;
    const adding = app(attach, tenantId, (tx) =>
      tx.execute(
        sql`update products set image = ${image.filename} where tenant_id = ${tenantId} and id = ${productId}`,
      ),
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
    expect(
      await app(suite.admin, tenantId, (tx) => readImageBytes(tx, tenantId, image.filename)),
    ).toBeNull();
  } finally {
    release();
    await Promise.all([attach.close(), remove.close()]);
  }
});
