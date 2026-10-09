import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  persons,
  startManagementSession,
  managementSessions,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  writeContentLanguages,
  setProductVariants,
  addMember,
  setIncludeFolder,
  menuDetails,
  sections,
  optionLists,
  optionLabels,
  extraLists,
  units,
} from "@waitron/catalogue";
import type {
  TranslationBatch,
  TranslationPage,
  TranslationTarget,
} from "@waitron/catalogue/src/content-translation-types.js";
import { mountCatalogueApi } from "./catalogue-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
let managerCookie: string;
let managerId: string;
let staffCookie: string;
let http: Hono;
beforeEach(async () => {
  await seedTenant(suite.db);
  await app(async (tx) => {
    for (const role of ["manager", "staff"] as const) {
      const [person] = await tx.insert(persons).values({ displayName: role, role }).returning();
      const session = await startManagementSession(tx, { personId: person!.id });
      const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
      if (role === "manager") {
        managerCookie = cookie;
        managerId = person!.id;
      } else staffCookie = cookie;
    }
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "ca"] });
  });
  http = new Hono();
  mountCatalogueApi(
    http,
    {
      db: suite.db,
      venueLocale: "es-ES",
      contentLanguageRules: { required: ["es", "ca"], official: [] },
    },
    () => {},
  );
});
const path = "/management-api/content-translations/en";
function send(
  method: "GET" | "PUT",
  body?: unknown,
  cookie: string | null = managerCookie,
  url = path,
) {
  return http.request(url, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    ...(method === "GET" || body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function page(query = "", cookie: string | null = managerCookie): Promise<TranslationPage> {
  const response = await send("GET", undefined, cookie, path + query);
  expect(response.status).toBe(200);
  return response.json() as Promise<TranslationPage>;
}
async function batch(
  refs: { kind: TranslationTarget["kind"]; id: string }[],
): Promise<TranslationBatch> {
  const rows: TranslationTarget[] = [];
  for (let i = 0; i < refs.length; i += 50)
    rows.push(
      ...(
        await page(
          "?" +
            new URLSearchParams(refs.slice(i, i + 50).map((r) => ["target", `${r.kind}:${r.id}`])),
        )
      ).rows,
    );
  return {
    edits: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      expected: r.expected,
      text: `  CLIENT English ${r.kind}  `,
    })),
  };
}
async function many(count: number) {
  const rows = await suite.db
    .insert(units)
    .values(
      Array.from({ length: count }, (_, i) => ({
        name: { es: `Unit ${i}` },
        abbreviation: { es: `u${i}` },
        precision: 2,
      })),
    )
    .returning();
  return rows.map((r) => ({ kind: "unit" as const, id: r.id }));
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
const kinds = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
] as const;
async function fixture() {
  await seedTenant(suite.db);
  return app(async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "ca", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: { es: "CLIENT Almuerzo" },
    });
    const child = await createCatalogue(tx, {
      name: "STAFF Drinks",
      names: { es: "CLIENT Bebidas" },
    });
    const roots = await tx.select().from(menuDetails);
    const root = roots.find((row) => row.menuId === menu.id)!.rootSectionId;
    const childRoot = roots.find((row) => row.menuId === child.id)!.rootSectionId;
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      unitId: null,
      name: "STAFF Bread",
      kitchenName: "KITCHEN Bread",
      customerName: { es: "CLIENT Pan" },
      unitPrice: "3.00",
      vatClass: "reduced",
    });
    const [variant] = await setProductVariants(
      tx,
      product.id,
      [
        {
          name: "STAFF Small",
          kitchenName: "KITCHEN Small",
          customerName: { es: "CLIENT Pequeño" },
          unitPrice: "2.00",
          image: null,
          available: true,
        },
      ],
      "es",
    );
    const [list] = await tx
      .insert(optionLists)
      .values({
        name: "STAFF Doneness",
        kitchenName: "KITCHEN Doneness",
        customerName: { es: "CLIENT Punto" },
      })
      .returning();
    const [label] = await tx
      .insert(optionLabels)
      .values({
        listId: list!.id,
        name: "STAFF Rare",
        kitchenName: "KITCHEN Rare",
        customerName: { es: "CLIENT Poco" },
        available: false,
      })
      .returning();
    const [extra] = await tx
      .insert(extraLists)
      .values({
        name: "STAFF Sides",
        kitchenName: "KITCHEN Sides",
        customerName: { es: "CLIENT Guarnición" },
      })
      .returning();
    const [section] = await tx
      .insert(sections)
      .values({ internalName: "STAFF Mains", names: { es: "CLIENT Platos" }, ownerMenuId: menu.id })
      .returning();
    const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
    await setIncludeFolder(
      tx,
      root,
      member.id,
      {
        showAsFolder: false,
        overrides: { names: { ca: "CLIENT Begudes" }, color: "#123456", image: null },
      },
      "es",
    );
    const [unit] = await tx
      .insert(units)
      .values({ name: { es: "CLIENT Ración" }, abbreviation: { es: "rac" }, precision: 2 })
      .returning();
    return {
      product: product!.id,
      variant: variant!.id,
      option_list: list!.id,
      option_label: label!.id,
      extra_list: extra!.id,
      menu: root,
      section: section!.id,
      included_menu: member.id,
      unit: unit!.id,
      menuId: menu.id,
      childMenuId: child.id,
      childRoot,
    };
  });
}

describe("inline translation routes", () => {
  it("a manager saves nine own target ids and retries without changing other columns", async () => {
    const ids = await fixture();
    const refs = kinds.map((kind) => ({ kind, id: ids[kind] }));
    const input = await batch(refs);
    const before = (await suite.db.execute(sql`select * from products order by id`)).rows;
    const result = await send("PUT", input);
    expect(result.status).toBe(200);
    const saved = (await result.json()) as { saved: TranslationTarget[] };
    expect(
      saved.saved.map((r) => ({ kind: r.kind, id: r.id, selectedText: r.selectedText })),
    ).toEqual(refs.map((r) => ({ ...r, selectedText: `CLIENT English ${r.kind}` })));
    expect(
      (await page("?" + new URLSearchParams(refs.map((r) => ["target", `${r.kind}:${r.id}`]))))
        .rows,
    ).toEqual(saved.saved);
    const after = (await suite.db.execute(sql`select * from products order by id`)).rows;
    expect(
      after.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([key]) => key !== "customer_name")),
      ),
    ).toEqual(
      before.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([key]) => key !== "customer_name")),
      ),
    );
    expect((await send("PUT", input)).status).toBe(200);
    expect((await suite.db.execute(sql`select * from products order by id`)).rows).toEqual(after);
    expect(result.headers.get("x-waitron-menu-revision")).not.toBeNull();
  });
  it("a conflicting target refuses a mixed batch without saving any other target", async () => {
    const ids = await fixture();
    const input = await batch(kinds.map((kind) => ({ kind, id: ids[kind] })));
    await suite.db
      .update(products)
      .set({ customerName: { es: "CLIENT Pan", en: "Other person's name" } })
      .where(eq(products.id, ids.product));
    const response = await send("PUT", input);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "content.translation_stale", params: { kind: "product", id: ids.product } },
    });
    expect((await page("?target=unit:" + ids.unit)).rows[0]!.selectedText).toBeNull();
  });
  it("preserves the domain cause and the refused target/field/language", async () => {
    const ids = await fixture();
    await suite.db.update(products).set({ customerName: null }).where(eq(products.id, ids.product));
    const input = await batch([{ kind: "product", id: ids.product }]);
    const response = await send("PUT", input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "content.translation_refused",
        params: {
          causeCode: "content.translation_required",
          causeParams: { language: "es" },
          kind: "product",
          id: ids.product,
          field: "defaultText",
          language: "es",
        },
      },
    });
    input.edits[0]!.defaultText = "CLIENT Pan";
    expect((await send("PUT", input)).status).toBe(200);
  });
  it.each(["GET", "PUT"] as const)("%s requires a live manager", async (method) => {
    const refs = await many(1);
    const input = await batch(refs);
    await error(await send(method, input, null), 401, "management_session.required");
    await error(await send(method, input, staffCookie), 403, "authorization.not_permitted");
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(managementSessions.personId, managerId));
    await error(await send(method, input), 401, "management_session.expired");
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(managementSessions.personId, managerId));
    expect((await send(method, method === "PUT" ? input : undefined)).status).toBe(200);
  });
  it.each(["role", "session"] as const)(
    "rechecks %s after body upload inside the write transaction",
    async (change) => {
      const refs = await many(1);
      const input = await batch(refs);
      const raw = JSON.stringify(input);
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            if (change === "role")
              await suite.db
                .update(persons)
                .set({ role: "staff" })
                .where(eq(persons.id, managerId));
            else
              await suite.db
                .update(managementSessions)
                .set({ endedAt: new Date().toISOString() })
                .where(eq(managementSessions.personId, managerId));
            controller.enqueue(new TextEncoder().encode(raw));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const req = new Request("http://localhost" + path, {
        method: "PUT",
        headers: { cookie: managerCookie },
        body: stream,
        duplex: "half",
      } as RequestInit);
      await error(
        await http.request(req),
        change === "role" ? 403 : 401,
        change === "role" ? "authorization.not_permitted" : "management_session.required",
      );
      expect((await suite.db.select().from(units))[0]!.name).toEqual({ es: "Unit 0" });
    },
  );
  it.each(["role", "session"] as const)(
    "GET checks %s after an earlier queued write commits",
    async (change) => {
      let signalStarted!: () => void;
      let releaseWriter!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const earlier = app(async (tx) => {
        signalStarted();
        await release;
        if (change === "role")
          await tx.update(persons).set({ role: "staff" }).where(eq(persons.id, managerId));
        else
          await tx
            .update(managementSessions)
            .set({ endedAt: new Date().toISOString() })
            .where(eq(managementSessions.personId, managerId));
      });
      await started;
      const request = send("GET");
      releaseWriter();
      await earlier;
      await error(
        await request,
        change === "role" ? 403 : 401,
        change === "role" ? "authorization.not_permitted" : "management_session.required",
      );
    },
  );
  it("accepts exactly 262144 bytes delivered in chunks without Content-Length", async () => {
    const input = await batch(await many(1));
    const json = JSON.stringify(input);
    const bytes = new TextEncoder().encode(json + " ".repeat(262144 - Buffer.byteLength(json)));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let start = 0; start < bytes.length; start += 137)
          c.enqueue(bytes.slice(start, start + 137));
        c.close();
      },
    });
    const req = new Request("http://localhost" + path, {
      method: "PUT",
      headers: { cookie: managerCookie },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await http.request(req)).status).toBe(200);
    expect((await suite.db.select().from(units))[0]!.name).toEqual({
      es: "Unit 0",
      en: "CLIENT English unit",
    });
  });
  it("refuses a missing body and an interrupted upload", async () => {
    await error(await send("PUT"), 400, "content.translation_batch_invalid");
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("Interrupted upload"));
      },
    });
    const req = new Request("http://localhost" + path, {
      method: "PUT",
      headers: { cookie: managerCookie },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await error(await http.request(req), 400, "content.translation_batch_invalid");
  });
  it("uses a valid cursor to fetch the next ordered page without repeats", async () => {
    const refs = await many(51);
    const first = await page();
    expect(first.rows).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await page("?after=" + encodeURIComponent(first.next!));
    expect(second.rows).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id))).toEqual(
      new Set(refs.map((r) => r.id)),
    );
  });
  it("GET accepts 50 distinct explicit targets and refuses 51", async () => {
    const refs = await many(51);
    expect(
      (
        await page(
          "?" + new URLSearchParams(refs.slice(0, 50).map((r) => ["target", `unit:${r.id}`])),
        )
      ).rows,
    ).toHaveLength(50);
    await error(
      await send(
        "GET",
        undefined,
        managerCookie,
        path + "?" + new URLSearchParams(refs.map((r) => ["target", `unit:${r.id}`])),
      ),
      400,
      "content.translation_invalid",
    );
  });
  it("PUT saves 100 distinct targets and refuses 101 atomically", async () => {
    const refs = await many(101);
    const input = await batch(refs);
    await error(await send("PUT", input), 400, "content.translation_batch_invalid");
    expect((await suite.db.select().from(units)).every((r) => r.name.en === undefined)).toBe(true);
    input.edits.pop();
    expect((await send("PUT", input)).status).toBe(200);
    expect((await suite.db.select().from(units)).filter((r) => r.name.en)).toHaveLength(100);
  });
  it.each(["text", "defaultText"] as const)(
    "%s uses UTF-8 bytes at the 4096/4097 limit",
    async (field) => {
      const refs = await many(1);
      if (field === "defaultText") await suite.db.update(units).set({ name: {} });
      const input = await batch(refs);
      input.edits[0]![field] = "é".repeat(2048);
      const tooLong = structuredClone(input);
      tooLong.edits[0]![field] += "x";
      await error(await send("PUT", tooLong), 400, "content.translation_batch_invalid");
      expect((await send("PUT", input)).status).toBe(200);
    },
  );
  it.each([undefined, "1", "999999"])(
    "counts 262144/262145 actual bytes regardless of Content-Length %s",
    async (length) => {
      const input = await batch(await many(1));
      const json = JSON.stringify(input);
      async function raw(bytes: number) {
        const body = json + " ".repeat(bytes - Buffer.byteLength(json));
        return http.request(path, {
          method: "PUT",
          headers: { cookie: managerCookie, ...(length ? { "content-length": length } : {}) },
          body,
        });
      }
      expect((await raw(262144)).status).toBe(200);
      await error(await raw(262145), 400, "content.translation_batch_invalid");
    },
  );
  it("bounds streamed chunks and cancels after an oversized chunk", async () => {
    const input = await batch(await many(1));
    const json = JSON.stringify(input);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(json));
        c.enqueue(new Uint8Array(262145).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://localhost" + path, {
      method: "PUT",
      headers: { cookie: managerCookie, "content-length": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await error(await http.request(req), 400, "content.translation_batch_invalid");
    expect(cancelled).toBe(true);
    expect((await suite.db.select().from(units))[0]!.name).toEqual({ es: "Unit 0" });
  });
  it.each([
    "?unknown=1",
    "?after=null",
    "?after={}",
    "?after=oops",
    "?after=" + encodeURIComponent('{"kind":"unit","id":"x","extra":true}'),
    "?target=unknown:x",
    "?target=unit",
    "?target=unit",
    "?target=unit:",
    "?target=unit:x&target=unit:x",
    "?target=unit:x&after=oops",
    "?after=oops&after=oops",
  ])("rejects malformed GET query %s", async (query) => {
    await error(
      await send("GET", undefined, managerCookie, path + query),
      400,
      "content.translation_invalid",
    );
  });
  it.each(["!!", "es-ES", "fr"])(
    "refuses invalid/noncanonical/disabled language %s",
    async (language) => {
      const refs = await many(1);
      const input = await batch(refs);
      for (const method of ["GET", "PUT"] as const) {
        const response = await send(
          method,
          method === "PUT" ? input : undefined,
          managerCookie,
          "/management-api/content-translations/" + encodeURIComponent(language),
        );
        expect(response.status).toBe(400);
        expect((await response.json()) as unknown).toMatchObject({
          error: {
            code:
              language === "fr"
                ? "content.languages_invalid"
                : language === "!!"
                  ? "content.language_invalid"
                  : "content.translation_invalid",
          },
        });
      }
    },
  );
  it.each([null, [], {}, { edits: [] }, { edits: null }, { edits: [null] }])(
    "refuses malformed batch %j",
    async (body) => {
      await error(await send("PUT", body), 400, "content.translation_batch_invalid");
    },
  );
  it.each(["unknown", "null", "kind", "duplicate", "token", "textNull", "companionNull"])(
    "refuses malformed edits: %s",
    async (fault) => {
      const input = await batch(await many(1));
      const edit = input.edits[0]!;
      const bad: unknown =
        fault === "unknown"
          ? { ...input, extra: true }
          : fault === "null"
            ? { edits: [{ ...edit, extra: true }] }
            : fault === "kind"
              ? { edits: [{ ...edit, kind: "toString" }] }
              : fault === "duplicate"
                ? { edits: [edit, edit] }
                : fault === "token"
                  ? { edits: [{ ...edit, expected: "null" }] }
                  : fault === "textNull"
                    ? { edits: [{ ...edit, text: null }] }
                    : { edits: [{ ...edit, defaultText: null }] };
      await error(await send("PUT", bad), 400, "content.translation_batch_invalid");
    },
  );
  it("refuses deleted targets without recreating them", async () => {
    const refs = await many(1);
    const input = await batch(refs);
    await suite.db.delete(units);
    const response = await send("PUT", input);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "content.translation_unavailable", params: refs[0] },
    });
    expect(await suite.db.select().from(units)).toEqual([]);
  });
  it.each(["", "{", "null", "[]"])("refuses non-object JSON %s", async (body) => {
    await error(
      await http.request(path, { method: "PUT", headers: { cookie: managerCookie }, body }),
      400,
      "content.translation_batch_invalid",
    );
  });
});

it("an archived product and variant accept explicit translation fixes through HTTP without unrelated writes", async () => {
  const ids = await fixture();
  await app(async (tx) => {
    await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
    await tx.update(products).set({ active: false }).where(eq(products.id, ids.variant));
  });
  const before = await suite.db.select().from(products).orderBy(products.id);
  const refs = [
    { kind: "product" as const, id: ids.product },
    { kind: "variant" as const, id: ids.variant },
  ];
  const named = await page(
    "?" + new URLSearchParams(refs.map((ref) => ["target", `${ref.kind}:${ref.id}`])),
  );
  expect(named.rows.map((row) => [row.kind, row.id, row.eligible, row.unavailableReason])).toEqual([
    ["product", ids.product, true, null],
    ["variant", ids.variant, true, null],
  ]);
  const response = await send("PUT", await batch(refs));
  expect(response.status).toBe(200);
  const output = (await response.json()) as { saved: TranslationTarget[] };
  expect(output.saved.map((row) => [row.kind, row.id, row.selectedText])).toEqual([
    ["product", ids.product, "CLIENT English product"],
    ["variant", ids.variant, "CLIENT English variant"],
  ]);
  const after = await suite.db.select().from(products).orderBy(products.id);
  expect(after).toEqual(
    before.map((row) => {
      const kind = refs.find((ref) => ref.id === row.id)?.kind;
      return kind
        ? { ...row, customerName: { ...row.customerName, en: `CLIENT English ${kind}` } }
        : row;
    }),
  );
  expect((await page()).rows.map((row) => row.id)).not.toContain(ids.product);
  expect((await page()).rows.map((row) => row.id)).not.toContain(ids.variant);
});
