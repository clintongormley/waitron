import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  readContentLanguages,
  validateContentTranslations,
  writeContentLanguages,
} from "./content-languages.js";

const suite = useTemplateDb({ template: "core" });
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
async function configuredTenant() {
  const tenantId = await seedTenant(suite.admin);
  await app(suite.admin, tenantId, (tx) =>
    writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en", "fr"] }),
  );
  const menu = await suite.admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Lunch') returning id`,
  );
  return { tenantId, menuId: menu.rows[0]!.id };
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

it("reads and edits only the requested tenant as app_user with SELECT/INSERT/UPDATE grants", async () => {
  const { tenantId } = await configuredTenant();
  const other = await seedTenant(suite.admin);
  await app(suite.admin, other, async (tx) => {
    const role = await tx.execute<{ role: string; superuser: boolean }>(
      sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    expect(await readContentLanguages(tx, other, "it-IT")).toEqual({
      defaultLanguage: "it",
      languages: ["it"],
    });
    await writeContentLanguages(tx, other, { defaultLanguage: "it", languages: ["it", "de"] });
    await writeContentLanguages(tx, other, { defaultLanguage: "de", languages: ["it", "de"] });
    expect(await readContentLanguages(tx, tenantId, "es")).toEqual({
      defaultLanguage: "en",
      languages: ["en", "fr"],
    });
    expect(await readContentLanguages(tx, other, "es")).toEqual({
      defaultLanguage: "de",
      languages: ["de", "it"],
    });
    const grants = await tx.execute<{ privileges: string }>(sql`
      select string_agg(privilege_type, ',' order by privilege_type) as privileges
      from pg_class cross join lateral aclexplode(relacl)
      where relname = 'content_languages' and grantee = 'app_user'::regrole
    `);
    expect(grants.rows).toEqual([{ privileges: "INSERT,SELECT,UPDATE" }]);
  });
  await expect(
    app(suite.admin, other, (tx) =>
      tx.execute(sql`delete from content_languages where tenant_id = ${other}`),
    ),
  ).rejects.toThrow();
});

it("a default switch waits for an authoring transaction and rejects its newly committed missing translation", async () => {
  const { tenantId, menuId } = await configuredTenant();
  const [author, configuration] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const validated = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const pid = (await configuration.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const writing = app(author, tenantId, async (tx) => {
      await validateContentTranslations(tx, tenantId, { en: "Bread" }, "es");
      ready();
      await wait;
      await tx.execute(sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${tenantId}, ${menuId}, '{"en":"Bread"}'::jsonb, 'each', '2', 'general')`);
    });
    await validated;
    const changing = app(configuration, tenantId, (tx) =>
      writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["en", "fr"] }),
    );
    const settled = Promise.allSettled([changing, writing]);
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [change, write] = await settled;
    expect(write.status).toBe("fulfilled");
    expect(change.status).toBe("rejected");
    if (change.status === "rejected")
      expect(change.reason).toMatchObject({
        code: "content.default_missing",
        params: { language: "fr", count: 1 },
      });
    expect(
      (await app(suite.admin, tenantId, (tx) => readContentLanguages(tx, tenantId, "es")))
        .defaultLanguage,
    ).toBe("en");
  } finally {
    release();
    await Promise.all([author.close(), configuration.close()]);
  }
});

it("an authoring transaction waits for the default switch and validates against the committed new language", async () => {
  const { tenantId } = await configuredTenant();
  const [author, configuration] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const changed = new Promise<void>((resolve) => {
    ready = resolve;
  });
  try {
    const pid = (await author.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const changing = app(configuration, tenantId, async (tx) => {
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["en", "fr"] });
      ready();
      await wait;
    });
    await changed;
    const writing = app(author, tenantId, (tx) =>
      validateContentTranslations(tx, tenantId, { en: "Bread" }, "es"),
    );
    const settled = Promise.allSettled([writing, changing]);
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [write, change] = await settled;
    expect(change.status).toBe("fulfilled");
    expect(write.status).toBe("rejected");
    if (write.status === "rejected")
      expect(write.reason).toMatchObject({
        code: "content.translation_required",
        params: { language: "fr" },
      });
  } finally {
    release();
    await Promise.all([author.close(), configuration.close()]);
  }
});
