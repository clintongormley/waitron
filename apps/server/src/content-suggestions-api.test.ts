import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  CATALOGUE_MIGRATIONS,
  contentSuggestionJobs,
  contentSuggestions,
  createCatalogue,
  createProduct,
  readActiveSuggestionJob,
  startSuggestionRun,
  writeContentLanguages,
  type ContentSuggestionRead,
  type TranslationContext,
  type TranslationItemPage,
} from "@waitron/catalogue";
import { AppError } from "@waitron/shared";
import { translationCloudFixture } from "../test/translation-cloud-fixture.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
import {
  mountContentSuggestionsApi,
  type ContentSuggestionsApiDeps,
} from "./content-suggestions-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const context: TranslationContext = { fallbackLanguage: "es-ES", required: [] };
const ORIGIN = "https://dashboard.example";
const CLOUD = "https://cloud.example";
const JOBS = "/management-api/content-suggestions/jobs";
const LIST = "/management-api/content-suggestions";
let managerCookie: string;
let staffCookie: string;
const wake = vi.fn();

beforeEach(async () => {
  wake.mockReset();
  await seedTenant(suite.db);
  await inTx(async (tx) => {
    for (const role of ["manager", "staff"] as const) {
      const [person] = await tx.insert(persons).values({ displayName: role, role }).returning();
      const session = await startManagementSession(tx, { personId: person!.id });
      const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
      if (role === "manager") managerCookie = cookie;
      else staffCookie = cookie;
    }
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
  });
});

function mount(overrides: Partial<ContentSuggestionsApiDeps> = {}): Hono {
  const http = new Hono();
  mountContentSuggestionsApi(
    http,
    {
      db: suite.db,
      connection: { translationService: async () => "on" },
      cloudOrigin: CLOUD,
      context,
      managementOrigin: ORIGIN,
      isPrimary: () => true,
      wake,
      ...overrides,
    },
    () => {},
  );
  return http;
}

function send(
  http: Hono,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  options: { body?: string; cookie?: string | null; origin?: string } = {},
) {
  const cookie = options.cookie === undefined ? managerCookie : options.cookie;
  return http.request(url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: options.origin ?? ORIGIN,
      "content-type": "application/json",
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

async function refused(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function read(http: Hono, language: string): Promise<ContentSuggestionRead> {
  const response = await send(http, "GET", `${LIST}?language=${language}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<ContentSuggestionRead>;
}

/** One complete menu and one product missing English; returns the product's id. */
async function bread(): Promise<string> {
  return inTx(async (tx) => {
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: { es: "CLIENT-es Almuerzo", en: "CLIENT-en Lunch" },
    });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      unitId: null,
      name: "STAFF Bread",
      kitchenName: "KITCHEN Bread",
      customerName: { es: "CLIENT-es Pan" },
      unitPrice: "3.00",
      vatClass: "reduced",
    });
    return product.id;
  });
}

async function connected() {
  const f = await translationCloudFixture();
  await f.client.refresh(); // renew: no lease yet
  await f.client.refresh(); // configuration, four services
  expect(await f.client.translationService()).toBe("on");
  return f;
}

async function runToIdle(runner: ReturnType<typeof createContentSuggestionRunner>) {
  for (let i = 0; i < 20; i++) if ((await runner.step()) === "idle") return;
  throw new Error("the runner did not finish");
}

const jobRows = () => suite.db.select().from(contentSuggestionJobs);

it("starts a run for a manager and wakes the runner", async () => {
  await bread();
  const response = await send(mount(), "POST", JOBS, { body: "{}" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    run: { state: "sending", total: 1, progress: 0, opened: false },
  });
  expect(wake).toHaveBeenCalledOnce();
  expect(await inTx((tx) => readActiveSuggestionJob(tx))).toMatchObject({ state: "submitting" });
});

it("answers no run and wakes nothing when nothing is missing", async () => {
  const response = await send(mount(), "POST", JOBS, { body: "{}" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ run: null });
  expect(wake).not.toHaveBeenCalled();
  expect(await jobRows()).toEqual([]);
});

it("refuses a start from another origin with authorization.not_permitted", async () => {
  await bread();
  await refused(
    await send(mount(), "POST", JOBS, { body: "{}", origin: "https://elsewhere.example" }),
    403,
    "authorization.not_permitted",
  );
  expect(await jobRows()).toEqual([]);
});

it.each([
  ["POST", JOBS, "{}"],
  ["GET", `${LIST}?language=en`, undefined],
  ["DELETE", `${LIST}/00000000-0000-4000-8000-000000000000`, undefined],
] as const)(
  "%s %s refuses no session with 401 and a person without catalogue.manage with 403",
  async (method, url, body) => {
    await bread();
    const http = mount();
    await refused(
      await send(http, method, url, { body, cookie: null }),
      401,
      "management_session.required",
    );
    await refused(
      await send(http, method, url, { body, cookie: staffCookie }),
      403,
      "authorization.not_permitted",
    );
    expect(await jobRows()).toEqual([]);
  },
);

it.each([
  ["an array", "[]"],
  ["a field", '{"language":"en"}'],
  ["text that is not JSON", "not json"],
  ["more than 1,024 bytes", `{"pad":"${"x".repeat(2000)}"}`],
])("refuses a start whose body is %s with content.translation_invalid", async (_name, body) => {
  await bread();
  await refused(await send(mount(), "POST", JOBS, { body }), 400, "content.translation_invalid");
  expect(await jobRows()).toEqual([]);
});

it.each([
  ["no Cloud connection", undefined],
  ["a connection without the service", "off"],
  ["a connection that is no longer registered", "not_connected"],
] as const)("refuses to start with %s as cloud.not_configured", async (_name, service) => {
  await bread();
  const http = mount({
    connection: service === undefined ? undefined : { translationService: async () => service },
  });
  await refused(await send(http, "POST", JOBS, { body: "{}" }), 409, "cloud.not_configured");
  expect(await jobRows()).toEqual([]);
  expect(wake).not.toHaveBeenCalled();
});

it("refuses to start off the primary with cloud.not_primary", async () => {
  await bread();
  await refused(
    await send(mount({ isPrimary: () => false }), "POST", JOBS, { body: "{}" }),
    409,
    "cloud.not_primary",
  );
  expect(await jobRows()).toEqual([]);
});

it("refuses a second run while one is active with content.suggestion_job_running", async () => {
  await bread();
  const http = mount();
  expect((await send(http, "POST", JOBS, { body: "{}" })).status).toBe(200);
  await refused(
    await send(http, "POST", JOBS, { body: "{}" }),
    409,
    "content.suggestion_job_running",
  );
  expect(wake).toHaveBeenCalledOnce();
  expect(await jobRows()).toHaveLength(1);
});

it("lists a language's suggestions with the run, the service and Cloud's origin, and marks a finished run opened once", async () => {
  const f = await connected();
  try {
    const id = await bread();
    const http = mount({ connection: f.client });
    expect((await send(http, "POST", JOBS, { body: "{}" })).status).toBe(200);
    expect(await read(http, "en")).toMatchObject({
      service: "on",
      cloudOrigin: CLOUD,
      run: { state: "sending", opened: false },
      suggestions: [],
    });

    await runToIdle(
      createContentSuggestionRunner({
        db: suite.db,
        connection: f.client,
        context,
        isPrimary: () => true,
      }),
    );
    expect(await read(http, "en")).toEqual({
      language: "en",
      service: "on",
      cloudOrigin: CLOUD,
      next: null,
      run: expect.objectContaining({ state: "done", waiting: 1, opened: true }),
      suggestions: [
        {
          id: expect.any(String),
          kind: "product",
          itemId: id,
          language: "en",
          text: "EN STAFF Bread",
          placeholder: false,
          fix: null,
          stale: false,
        },
      ],
    });
    const [opened] = await jobRows();
    expect(opened!.openedAt).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await read(http, "en");
    const [again] = await jobRows();
    expect(again!.openedAt).toBe(opened!.openedAt);
  } finally {
    await f.close();
  }
});

it("a read off the primary leaves a finished run unopened", async () => {
  const f = await connected();
  try {
    await bread();
    await inTx((tx) => startSuggestionRun(tx, context));
    await runToIdle(
      createContentSuggestionRunner({
        db: suite.db,
        connection: f.client,
        context,
        isPrimary: () => true,
      }),
    );
    const standby = mount({ connection: f.client, isPrimary: () => false });
    expect(await read(standby, "en")).toMatchObject({
      run: { state: "done", opened: false },
      suggestions: [{ text: "EN STAFF Bread" }],
    });
    const [job] = await jobRows();
    expect(job!.openedAt).toBeNull();
  } finally {
    await f.close();
  }
});

it("answers a damaged Cloud connection file with cloud.state_invalid as 409, on a start and a read", async () => {
  await bread();
  const http = mount({
    connection: {
      translationService: async () => {
        throw new AppError("cloud.state_invalid", {});
      },
    },
  });
  await refused(await send(http, "POST", JOBS, { body: "{}" }), 409, "cloud.state_invalid");
  await refused(await send(http, "GET", `${LIST}?language=en`), 409, "cloud.state_invalid");
  expect(await jobRows()).toEqual([]);
});

it("a read without Cloud says not_connected and has no Cloud origin", async () => {
  expect(await read(mount({ connection: undefined, cloudOrigin: undefined }), "en")).toEqual({
    language: "en",
    service: "not_connected",
    cloudOrigin: null,
    run: null,
    suggestions: [],
    next: null,
  });
});

it.each([
  ["no language", ""],
  ["two languages", "?language=en&language=es"],
  ["two cursors", "?language=en&after=a&after=b"],
  ["an unknown key", "?language=en&page=2"],
])("refuses a list with %s as content.translation_invalid", async (_name, query) => {
  await refused(await send(mount(), "GET", `${LIST}${query}`), 400, "content.translation_invalid");
});

it("refuses a list in a language the venue has not enabled with content.languages_invalid", async () => {
  await refused(
    await send(mount(), "GET", `${LIST}?language=fr`),
    400,
    "content.languages_invalid",
  );
});

it("discards a suggestion, and a second discard is content.suggestion_not_found with 404", async () => {
  const id = await bread();
  const [row] = await suite.db
    .insert(contentSuggestions)
    .values({ kind: "product", itemId: id, language: "en", text: "EN STAFF Bread", expected: "{}" })
    .returning();
  const http = mount();

  const first = await send(http, "DELETE", `${LIST}/${row!.id}`);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ deleted: row!.id });
  expect(await suite.db.select().from(contentSuggestions)).toEqual([]);

  const second = await send(http, "DELETE", `${LIST}/${row!.id}`);
  expect(second.status).toBe(404);
  expect(await second.json()).toEqual({
    error: { code: "content.suggestion_not_found", params: { suggestionId: row!.id } },
  });
});

it("saving the name through the translations route removes its suggestion", async () => {
  const id = await bread();
  await suite.db.insert(contentSuggestions).values({
    kind: "product",
    itemId: id,
    language: "en",
    text: "EN STAFF Bread",
    expected: "{}",
  });
  const http = mount();
  mountCatalogueApi(
    http,
    { db: suite.db, venueLocale: "es-ES", contentLanguageRules: { required: [], official: [] } },
    () => {},
  );
  const targets = await send(
    http,
    "GET",
    `/management-api/content-translations?language=en&target=product:${id}`,
  );
  const page = (await targets.json()) as TranslationItemPage;

  const save = await send(http, "PUT", ORIGIN + "/management-api/content-translations", {
    body: JSON.stringify({
      edits: [
        {
          kind: "product",
          id,
          language: "en",
          field: "name",
          expected: page.rows[0]!.cells[0]!.expected,
          text: "CLIENT-en Bread",
        },
      ],
    }),
  });
  expect(save.status).toBe(200);
  expect(await read(http, "en")).toMatchObject({ suggestions: [] });
});
