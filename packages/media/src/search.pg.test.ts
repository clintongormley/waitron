import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listImages, uploadImage } from "./images.js";

const suite = useTemplateDb({ template: "media" });

it("preserves exclusions, phrases and OR while stemming multilingual searches as app_user", async () => {
  const tenantId = await seedTenant(suite.admin);
  await withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    const role = await tx.execute<{ role: string; superuser: boolean }>(
      sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
    );
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    const names = ["Bread roll", "Bread loaf", "Roll bread", "Bread with roll", "Fish plate"];
    for (const [index, name] of names.entries()) {
      await uploadImage(
        tx,
        tenantId,
        {
          bytes: new Uint8Array([0xff, 0xd8, 0xff, index]),
          names: { en: name },
          altText: { en: "Photo" },
          labels: [],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
    }
    const cases: [string, string[]][] = [
      ["-bread", ["Fish plate"]],
      ["bread -roll", ["Bread loaf"]],
      ["bread -rolls", ["Bread loaf"]],
      ["roll -rolls", []],
      ['"bread roll"', ["Bread roll"]],
      ['"breads with rolls"', ["Bread with roll"]],
      ['-"bread roll"', ["Bread loaf", "Bread with roll", "Fish plate", "Roll bread"]],
      ["bread -roll OR fish", ["Bread loaf", "Fish plate"]],
    ];
    for (const [query, expected] of cases) {
      const result = await listImages(tx, tenantId, { query, fallbackLanguage: "en" });
      expect.soft(result.images.map((image) => image.names.en).sort(), query).toEqual(expected);
      expect.soft(result.total, query).toBe(expected.length);
    }
  });
});

it("ranks, filters and paginates multilingual results as app_user", async () => {
  const tenantId = await seedTenant(suite.admin);
  await withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    const add = async (
      marker: number,
      names: Record<string, string>,
      altText: string,
      labels: string[],
    ) =>
      (
        await uploadImage(
          tx,
          tenantId,
          {
            bytes: new Uint8Array([0xff, 0xd8, 0xff, marker]),
            names,
            altText: { en: altText },
            labels,
          },
          { fallbackLanguage: "en", maxUploadBytes: 100 },
        )
      ).image;
    const name = await add(1, { en: "Bread", ca: "Formatges", eu: "Etxeak", es: "Peras" }, "Loaf", [
      "Food",
    ]);
    const alt = await add(2, { en: "Bakery" }, "Bread ".repeat(100), ["Summer"]);
    const label = await add(3, { en: "Cake" }, "Slice", ["Summer menu"]);
    expect(
      (
        await listImages(tx, tenantId, {
          query: "bread",
          sort: "relevance",
          fallbackLanguage: "en",
        })
      ).images.map((image) => image.id),
    ).toEqual([name.id, alt.id]);
    const page = await listImages(tx, tenantId, {
      query: "bread",
      offset: 1,
      limit: 1,
      fallbackLanguage: "en",
    });
    expect(page.total).toBe(2);
    expect(page.images.map((image) => image.id)).toEqual([alt.id]);
    const filtered = await listImages(tx, tenantId, {
      query: "bread",
      label: " FOOD ",
      fallbackLanguage: "en",
    });
    expect(filtered.total).toBe(1);
    expect(filtered.images.map((image) => image.id)).toEqual([name.id]);
    expect(
      (
        await listImages(tx, tenantId, { query: '"summer menu"', fallbackLanguage: "en" })
      ).images.map((image) => image.id),
    ).toEqual([label.id]);
    for (const query of ["formatge", "etxe", "pera"]) {
      const result = await listImages(tx, tenantId, { query, fallbackLanguage: "en" });
      expect(result.total, query).toBe(1);
      expect(
        result.images.map((image) => image.id),
        query,
      ).toEqual([name.id]);
    }
    for (const query of ["bread -formatge", "bread -etxe"]) {
      expect(
        (await listImages(tx, tenantId, { query, fallbackLanguage: "en" })).images.map(
          (image) => image.id,
        ),
        query,
      ).toEqual([alt.id]);
    }
  });
});

it.each([
  { name: "Chef's bread", query: "chef's", matched: true },
  { name: "Back\\slash", query: "Back\\slash", matched: true },
  { name: "Pan-fried", query: "pan-fried", matched: true },
  { name: "The plate", query: "the", matched: true },
  { name: "The plate", query: "-the", matched: false },
  { name: "Bread", query: "", matched: true },
  { name: "Bread", query: "---", matched: false },
  { name: "Bread", query: "!!!", matched: false },
  { name: "Bread", query: "\\", matched: false },
  { name: "Bread", query: '""', matched: false },
])("handles $query against $name", async ({ name, query, matched }) => {
  const tenantId = await seedTenant(suite.admin);
  await withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    const { image } = await uploadImage(
      tx,
      tenantId,
      {
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        names: { en: name },
        altText: { en: "Photo" },
        labels: [],
      },
      { fallbackLanguage: "en", maxUploadBytes: 100 },
    );
    const result = await listImages(tx, tenantId, { query, fallbackLanguage: "en" });
    expect(result.images.map((row) => row.id)).toEqual(matched ? [image.id] : []);
    expect(result.total).toBe(matched ? 1 : 0);
  });
});

it("returns rows for the default relevance sort when the search is empty", async () => {
  // The library's first load sends sort=relevance with no query. Without a query the rank and
  // name-match expressions collapse to bare constants (`0`, `false`), which PostgreSQL rejects in
  // ORDER BY ("non-integer constant in ORDER BY") — a 500 on every first load. No earlier test
  // exercised this combination: the search suite only used relevance WITH a query, and an empty
  // query fell through to the date default. listImages must fall back to a date ordering instead.
  const tenantId = await seedTenant(suite.admin);
  await withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    for (const [index, name] of ["First", "Second"].entries()) {
      await uploadImage(
        tx,
        tenantId,
        {
          bytes: new Uint8Array([0xff, 0xd8, 0xff, index]),
          names: { en: name },
          altText: { en: "Photo" },
          labels: [],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
    }
    const result = await listImages(tx, tenantId, {
      query: "",
      sort: "relevance",
      fallbackLanguage: "en",
    });
    expect(result.total).toBe(2);
    expect(result.images.map((image) => image.names.en).sort()).toEqual(["First", "Second"]);
  });
});

it("separates parser tokens from rewrite placeholders and expands an empty query safely", async () => {
  const result = await suite.admin.execute<{ tokens: string[]; query: string; empty: number }>(sql`
    select tsvector_to_array(to_tsvector('pg_catalog.simple', chr(1) || '1 ' || chr(1) || '2 bread')) as tokens,
      public.media_search_query(chr(1) || '1 ' || chr(1) || '2 bread')::text as query,
      numnode(public.media_search_query('')) as empty
  `);
  expect(result.rows[0]!.tokens).toEqual(["1", "2", "bread"]);
  expect(result.rows[0]!.query).not.toContain(String.fromCharCode(1));
  expect(result.rows[0]!.empty).toBe(0);
});
