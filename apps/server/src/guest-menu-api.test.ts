import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { CORE_MIGRATIONS, withTransaction, saveSettings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { startManagementSession } from "@waitron/identity";
import { menusFixture } from "@waitron/catalogue/test/menus-fixture.js";
import {
  previewMenu,
  publishMenu,
  updateProduct,
  setVenueDefaultCatalogue,
  writeContentLanguages,
  GUEST_MENU_SETTINGS,
} from "@waitron/catalogue";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountGuestMenuApi, mountPublicGuestMenu } from "./guest-menu-api.js";
import "./errors.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture() {
  const f = await menusFixture(suite.db);
  const cookies = await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] });
    const [manager, staff] = await seedPersons(tx, [
      { displayName: "Manager", role: "manager" },
      { displayName: "Staff", role: "staff" },
    ]);
    const m = await startManagementSession(tx, { personId: manager!.id });
    const s = await startManagementSession(tx, { personId: staff!.id });
    const preview = await previewMenu(tx, f.lunch);
    await publishMenu(tx, f.lunch, preview.hash, manager!.id);
    return { manager: `${MANAGEMENT_COOKIE}=${m.token}`, staff: `${MANAGEMENT_COOKIE}=${s.token}` };
  });
  const app = new Hono();
  let serving = true;
  mountPublicGuestMenu(app, { db: suite.db, serving: () => serving }, () => {});
  mountGuestMenuApi(app, { db: suite.db, venueLocale: "en", serving: () => serving }, () => {});
  return {
    ...f,
    app,
    cookies,
    serve: (value: boolean) => {
      serving = value;
    },
  };
}
it("renders the publication, keeping later draft names and prices out", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) =>
    updateProduct(tx, f.soup, { customerName: { en: "Unpublished soup" }, unitPrice: "92.34" }),
  );
  const answer = await f.app.request(
    `/management-api/catalogues/${f.lunch}/guest-preview?language=en`,
    { headers: { cookie: f.cookies.manager } },
  );
  expect(answer.status).toBe(200);
  const body = await answer.json();
  expect(body.html).toContain("Soup for guests");
  expect(body.html).not.toContain("Unpublished soup");
  expect(body.html).not.toContain("92.34");
  expect(body.html).not.toContain("€92.34");
  expect(body.html).not.toContain(f.soup);
  expect(body).toMatchObject({ language: "en", languages: ["en"] });
  const unpublished = await f.app.request(`/management-api/catalogues/${f.dinner}/guest-preview`, {
    headers: { cookie: f.cookies.manager },
  });
  expect(unpublished.status).toBe(200);
  expect(await unpublished.json()).toBeNull();
});
it("requires a signed-in manager with catalogue permission", async () => {
  const f = await fixture();
  for (const [cookie, status, code] of [
    ["", 401, "management_session.required"],
    [f.cookies.staff, 403, "authorization.not_permitted"],
  ] as const) {
    const res = await f.app.request(`/management-api/catalogues/${f.lunch}/guest-preview`, {
      headers: { cookie },
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  }
});

it("starts public sharing Off and limits its status to managers", async () => {
  const f = await fixture();
  for (const [cookie, status, code] of [
    ["", 401, "management_session.required"],
    [f.cookies.staff, 403, "authorization.not_permitted"],
    [f.cookies.manager, 200, null],
  ] as const) {
    const answer = await f.app.request("/management-api/guest-menu", { headers: { cookie } });
    expect(answer.status).toBe(status);
    if (code === null)
      expect(await answer.json()).toEqual({ enabled: false, revision: 0, available: false });
    else expect(await answer.json()).toMatchObject({ error: { code } });
  }
});

it("lets a manager change sharing with its current revision and keeps refusals from changing it", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) => setVenueDefaultCatalogue(tx, f.lunch));
  const save = (body: object, cookie = f.cookies.manager) =>
    f.app.request("/management-api/guest-menu", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const enabled = await save({ enabled: true, expectedRevision: 0 });
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ enabled: true, revision: 1, available: true });
  for (const [body, cookie, status, code] of [
    [{ enabled: false, expectedRevision: 1 }, f.cookies.staff, 403, "authorization.not_permitted"],
    [{ enabled: false, expectedRevision: 0 }, f.cookies.manager, 409, "settings.out_of_date"],
    [
      { enabled: "false", expectedRevision: 1 },
      f.cookies.manager,
      400,
      "management.request_invalid",
    ],
  ] as const) {
    const refused = await save(body, cookie);
    expect(refused.status).toBe(status);
    expect(await refused.json()).toMatchObject({ error: { code } });
    const current = await f.app.request("/management-api/guest-menu", {
      headers: { cookie: f.cookies.manager },
    });
    expect(await current.json()).toEqual({ enabled: true, revision: 1, available: true });
  }
  const disabled = await save({ enabled: false, expectedRevision: 1 });
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toEqual({ enabled: false, revision: 2, available: false });
});

it("serves only the opted-in publication without sign-in and closes it when serving stops", async () => {
  const f = await fixture();
  const read = (method = "GET", path = "/public/menu") => f.app.request(path, { method });
  expect((await read()).status).toBe(404);
  await withTransaction(suite.db, async (tx) => {
    await setVenueDefaultCatalogue(tx, f.lunch);
  });
  await f.app.request("/management-api/guest-menu", {
    method: "PUT",
    headers: { cookie: f.cookies.manager, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, expectedRevision: 0 }),
  });
  await withTransaction(suite.db, (tx) =>
    updateProduct(tx, f.soup, { customerName: { en: "Secret draft" } }),
  );
  const answer = await read();
  expect(answer.status).toBe(200);
  expect(answer.headers.get("cache-control")).toBe("no-store");
  expect(answer.headers.get("content-type")).toContain("text/html");
  const html = await answer.text();
  expect(html).toContain("Soup for guests");
  expect(html).toContain("?language=en");
  expect(html).not.toContain("Secret draft");
  expect(html).not.toContain(f.soup);
  expect((await read("HEAD")).status).toBe(200);
  const refusedWrite = await read("POST");
  expect(refusedWrite.status).toBe(405);
  expect(refusedWrite.headers.get("allow")).toBe("GET, HEAD");
  expect((await read("GET", `/public/menu/${f.dinner}`)).status).toBe(404);
  await withTransaction(suite.db, (tx) => setVenueDefaultCatalogue(tx, f.dinner));
  const missing = await read();
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("Menu unavailable");
  const status = await f.app.request("/management-api/guest-menu", {
    headers: { cookie: f.cookies.manager },
  });
  expect(await status.json()).toEqual({ enabled: true, revision: 1, available: false });
  await withTransaction(suite.db, (tx) => setVenueDefaultCatalogue(tx, f.lunch));
  f.serve(false);
  expect((await read()).status).toBe(503);
  const stopped = await f.app.request("/management-api/guest-menu", {
    headers: { cookie: f.cookies.manager },
  });
  expect(await stopped.json()).toEqual({ enabled: true, revision: 1, available: false });
  f.serve(true);
  expect((await read()).status).toBe(200);
});

it("answers public reads from committed rows while a write is open", async () => {
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    await setVenueDefaultCatalogue(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
  });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const turn = withTransaction(suite.db, async () => {
    started();
    await gate;
  });
  await begun;
  const read = f.app.request("/public/menu");
  try {
    expect((await Promise.race([read, delay(250).then(() => null)]))?.status).toBe(200);
  } finally {
    release();
    await turn;
    await read;
  }
});

it("gives guests a page rather than an internal settings failure", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) =>
    saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    }),
  );
  suite.db.execute(sql`update settings set version = 2 where module = 'catalogue'`);
  const failure = await f.app.request("/public/menu");
  expect(failure.status).toBe(500);
  expect(failure.headers.get("content-type")).toContain("text/html");
  expect(await failure.text()).toContain("Menu unavailable");
});
