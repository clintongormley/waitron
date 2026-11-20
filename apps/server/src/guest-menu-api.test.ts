import { AppError } from "@waitron/shared";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi, onTestFinished } from "vitest";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { CORE_MIGRATIONS, withTransaction, saveSettings } from "@waitron/db";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { startManagementSession } from "@waitron/identity";
import { menusFixture } from "@waitron/menu/test/menus-fixture.js";
import {
  previewMenu,
  publishMenu,
  queueMenuPublication,
  updateProduct,
  setVenueDefaultMenu,
  writeContentLanguages,
  GUEST_MENU_SETTINGS,
  saveMenuSettings,
  readMenuSettings,
} from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountGuestMenuApi, mountPublicGuestMenu } from "./guest-menu-api.js";
import * as guestMenuApi from "./guest-menu-api.js";
import "./errors.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture(delivery?: Parameters<typeof mountGuestMenuApi>[1]["delivery"]) {
  const f = await menusFixture(suite.db);
  const cookies = await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] });
    const [manager, staff] = await seedPersons(tx, [
      { displayName: "Manager", role: "manager" },
      { displayName: "Staff", role: "staff" },
    ]);
    const m = await startManagementSession(tx, { method: "password", personId: manager!.id });
    const s = await startManagementSession(tx, { method: "password", personId: staff!.id });
    const preview = await previewMenu(tx, f.lunch);
    await publishMenu(tx, f.lunch, preview.hash, manager!.id);
    return {
      manager: `${MANAGEMENT_COOKIE}=${m.token}`,
      staff: `${MANAGEMENT_COOKIE}=${s.token}`,
      managerId: manager!.id,
    };
  });
  const app = new Hono();
  let serving = true;
  const wake = vi.fn();
  mountPublicGuestMenu(app, { db: suite.db, serving: () => serving }, () => {});
  mountGuestMenuApi(
    app,
    { db: suite.db, venueLocale: "en", serving: () => serving, delivery, wake },
    () => {},
  );
  return {
    ...f,
    app,
    cookies,
    wake,
    serve: (value: boolean) => {
      serving = value;
    },
  };
}
it("builds every Cloud page from published content without dropping content-language tags", async () => {
  const f = await fixture();
  await expect((async () => guestMenuApi.readGuestMenuPages(suite.db, "en"))()).resolves.toBeNull();
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, {
      defaultLanguage: "ca-ES-valencia",
      languages: ["ca-ES-valencia", "fr", "en"],
    });
    await setVenueDefaultMenu(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
    await updateProduct(tx, f.soup, { customerName: { en: "Unpublished soup" } });
  });
  const body = await guestMenuApi.readGuestMenuPages(suite.db, "en");
  expect(body!.defaultLanguage).toBe("ca-ES-valencia");
  expect(Object.keys(body!.pages)).toEqual(["ca-ES-valencia", "fr", "en"]);
  expect(body!.pages.en).toContain("Soup for guests");
  expect(body!.pages.en).toMatch(/<time datetime="[^"]+">/);
  for (const html of Object.values(body!.pages)) {
    expect(html).not.toContain("Unpublished soup");
    expect(html).toContain("?lang=ca-ES-valencia");
    expect(html).toContain("?lang=fr");
  }
});
it("renders the publication, keeping later draft names and prices out", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) =>
    updateProduct(tx, f.soup, { customerName: { en: "Unpublished soup" }, unitPrice: "92.34" }),
  );
  const answer = await f.app.request(`/management-api/menus/${f.lunch}/guest-preview?language=en`, {
    headers: { cookie: f.cookies.manager },
  });
  expect(answer.status).toBe(200);
  const body = await answer.json();
  expect(body.html).toContain("Soup for guests");
  expect(body.html).not.toContain("Unpublished soup");
  expect(body.html).not.toContain("92.34");
  expect(body.html).not.toContain("€92.34");
  expect(body.html).not.toContain(f.soup);
  expect(body).toMatchObject({ language: "en", languages: ["en"] });
  const unpublished = await f.app.request(`/management-api/menus/${f.dinner}/guest-preview`, {
    headers: { cookie: f.cookies.manager },
  });
  expect(unpublished.status).toBe(200);
  expect(await unpublished.json()).toBeNull();
});
it("serves live declarations in Cloud, preview, earlier-edition paper and public pages without publishing", async () => {
  const f = await fixture();
  const headers = { cookie: f.cookies.manager };
  const captured = await (
    await f.app.request(`/management-api/menus/${f.lunch}/guest-preview`, { headers })
  ).json();
  await withTransaction(suite.db, async (tx) => {
    await setVenueDefaultMenu(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
    await updateProduct(tx, f.lager, { unitPrice: "9.00" });
    await publishMenu(tx, f.lunch, (await previewMenu(tx, f.lunch)).hash, f.cookies.managerId);
    await updateProduct(tx, f.soup, { allergens: { milk: {} }, dietaryDeclarations: ["vegan"] });
  });
  const cloud = await guestMenuApi.readGuestMenuPages(suite.db, "en");
  const preview = await (
    await f.app.request(`/management-api/menus/${f.lunch}/guest-preview`, { headers })
  ).json();
  const paper = await f.app.request(`/management-api/menus/${f.lunch}/guest-paper`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      versionId: captured.versionId,
      language: "en",
      paper: {
        preset: "bistro",
        font: "serif",
        spacing: "compact",
        key: "end",
        ink: "#123456",
        accent: "#654321",
      },
      order: [0, 1],
      breaks: [],
      logo: null,
    }),
  });
  expect(paper.status, await paper.clone().text()).toBe(200);
  const publicPage = await f.app.request("/public/menu?lang=en");
  expect(publicPage.status).toBe(200);
  for (const html of [
    cloud!.pages.en,
    preview.html,
    (await paper.json()).html,
    await publicPage.text(),
  ]) {
    expect(html).toContain("Milk");
    expect(html).toContain("Vegan");
    expect(html).toContain("Soup for guests");
  }
  expect(preview.versionId).not.toBe(captured.versionId);
});

it("requires a signed-in manager with menu permission", async () => {
  const f = await fixture();
  for (const [cookie, status, code] of [
    ["", 401, "management_session.required"],
    [f.cookies.staff, 403, "authorization.not_permitted"],
  ] as const) {
    const res = await f.app.request(`/management-api/menus/${f.lunch}/guest-preview`, {
      headers: { cookie },
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  }
});

it("answers a live menu stored in an earlier document format as a server fault with the venue-reset code", async () => {
  const f = await fixture();
  const earlier = crypto.randomUUID();
  await suite.db.run(sql`
    insert into menu_versions (id, menu_id, number, document, content_hash, created_at, created_by)
    select ${earlier}, menu_id, number + 1, json_set(document, '$.format', 2), 'earlier',
      created_at, created_by
    from menu_versions where menu_id = ${f.lunch}`);
  await suite.db.run(
    sql`update menu_releases set version_id = ${earlier} where menu_id = ${f.lunch} and state = 'live'`,
  );
  const res = await f.app.request(`/management-api/menus/${f.lunch}/guest-preview`, {
    headers: { cookie: f.cookies.manager },
  });
  expect(await res.json()).toEqual({
    error: { code: "menu.reset_required", params: { menuId: f.lunch } },
  });
  expect(res.status).toBe(500);
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
  await withTransaction(suite.db, (tx) => setVenueDefaultMenu(tx, f.lunch));
  const save = (body: object, cookie = f.cookies.manager) =>
    f.app.request("/management-api/guest-menu", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const enabled = await save({ enabled: true, expectedRevision: 0 });
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ enabled: true, revision: 1, available: true });
  expect(f.wake).toHaveBeenCalledOnce();
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
    expect(f.wake).toHaveBeenCalledOnce();
    const current = await f.app.request("/management-api/guest-menu", {
      headers: { cookie: f.cookies.manager },
    });
    expect(await current.json()).toEqual({ enabled: true, revision: 1, available: true });
  }
  const disabled = await save({ enabled: false, expectedRevision: 1 });
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toEqual({ enabled: false, revision: 2, available: false });
  expect(f.wake).toHaveBeenCalledTimes(2);
});

it("serves only the opted-in publication without sign-in and closes it when serving stops", async () => {
  const f = await fixture();
  const read = (method = "GET", path = "/public/menu") => f.app.request(path, { method });
  expect((await read()).status).toBe(404);
  await withTransaction(suite.db, async (tx) => {
    await setVenueDefaultMenu(tx, f.lunch);
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
  expect(html).toContain("?lang=en");
  expect(html).not.toContain("Secret draft");
  expect(html).not.toContain(f.soup);
  expect((await read("HEAD")).status).toBe(200);
  const refusedWrite = await read("POST");
  expect(refusedWrite.status).toBe(405);
  expect(refusedWrite.headers.get("allow")).toBe("GET, HEAD");
  expect((await read("GET", `/public/menu/${f.dinner}`)).status).toBe(404);
  await withTransaction(suite.db, (tx) => setVenueDefaultMenu(tx, f.dinner));
  const missing = await read();
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("Menu unavailable");
  const status = await f.app.request("/management-api/guest-menu", {
    headers: { cookie: f.cookies.manager },
  });
  expect(await status.json()).toEqual({ enabled: true, revision: 1, available: false });
  await withTransaction(suite.db, (tx) => setVenueDefaultMenu(tx, f.lunch));
  f.serve(false);
  expect((await read()).status).toBe(503);
  const stopped = await f.app.request("/management-api/guest-menu", {
    headers: { cookie: f.cookies.manager },
  });
  expect(await stopped.json()).toEqual({ enabled: true, revision: 1, available: false });
  f.serve(true);
  expect((await read()).status).toBe(200);
});

it("serves a French venue's Spanish menu to a guest asking in Mexican Spanish", async () => {
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr", "es"] });
    await updateProduct(tx, f.soup, {
      customerName: { fr: "Soup in French", es: "Soup in Spanish" },
    });
    await publishMenu(tx, f.lunch, (await previewMenu(tx, f.lunch)).hash, f.cookies.managerId);
    await setVenueDefaultMenu(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
  });
  const mexican = await f.app.request("/public/menu?lang=es-MX");
  expect(mexican.status).toBe(200);
  const spanish = await mexican.text();
  expect(spanish).toContain('<html lang="es"');
  expect(spanish).toContain("Soup in Spanish");
  expect(spanish).not.toContain("Soup in French");
  const german = await f.app.request("/public/menu?lang=de-DE");
  expect(german.status).toBe(200);
  const french = await german.text();
  expect(french).toContain('<html lang="fr"');
  expect(french).toContain("Soup in French");
  expect(french).not.toContain("Soup in Spanish");
});

it("answers public reads from committed rows while a write is open", async () => {
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    await setVenueDefaultMenu(tx, f.lunch);
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
  suite.db.execute(
    sql`update settings set version = 2 where module = ${GUEST_MENU_SETTINGS.module}`,
  );
  const failure = await f.app.request("/public/menu");
  expect(failure.status).toBe(500);
  expect(failure.headers.get("content-type")).toContain("text/html");
  expect(await failure.text()).toContain("Menu unavailable");
});

it("saves paper appearance without sharing and preserves it when sharing changes", async () => {
  const f = await fixture();
  const paper = {
    preset: "bistro",
    font: "serif",
    spacing: "compact",
    ink: "#123456",
    accent: "#654321",
    key: "end",
  };
  const save = (body: object) =>
    f.app.request("/management-api/guest-menu", {
      method: "PUT",
      headers: { cookie: f.cookies.manager, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const saved = await save({ enabled: false, paper, expectedRevision: 0 });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ enabled: false, paper, revision: 1, available: false });
  expect(f.wake).not.toHaveBeenCalled();
  const shared = await save({ enabled: true, expectedRevision: 1 });
  expect(shared.status).toBe(200);
  expect(await shared.json()).toEqual({ enabled: true, paper, revision: 2, available: false });
  expect(f.wake).toHaveBeenCalledOnce();
  const repainted = { ...paper, font: "sans" };
  const restyled = await save({ enabled: true, paper: repainted, expectedRevision: 2 });
  expect(restyled.status).toBe(200);
  expect(await restyled.json()).toEqual({
    enabled: true,
    paper: repainted,
    revision: 3,
    available: false,
  });
  expect(f.wake).toHaveBeenCalledOnce();
  const invalid = await save({ enabled: true, paper: null, expectedRevision: 3 });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "paper" } },
  });
});

it("renders the captured publication for paper, with only the selected library logo", async () => {
  const f = await fixture();
  const preview = await f.app.request(`/management-api/menus/${f.lunch}/guest-preview`, {
    headers: { cookie: f.cookies.manager },
  });
  const captured = await preview.json();
  const { prepareImage, uploadImage } = await import("@waitron/media");
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  const prepared = await prepareImage(png, { maxUploadBytes: 100000 });
  const { image: logo } = await withTransaction(suite.db, (tx) =>
    uploadImage(tx, { image: prepared, names: { en: "Logo" } }),
  );
  await withTransaction(suite.db, async (tx) => {
    await updateProduct(tx, f.soup, {
      customerName: { en: "New publication" },
      unitPrice: "92.34",
    });
    const next = await previewMenu(tx, f.lunch);
    await publishMenu(tx, f.lunch, next.hash, f.cookies.managerId);
  });
  const body = {
    versionId: captured.versionId,
    language: "en",
    paper: {
      preset: "bistro",
      font: "serif",
      spacing: "compact",
      key: "end",
      ink: "#123456",
      accent: "#654321",
    },
    order: [0],
    breaks: [],
    logo: logo.filename,
  };
  const request = (value: unknown, cookie = f.cookies.manager) =>
    f.app.request(`/management-api/menus/${f.lunch}/guest-paper`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  const paper = await request(body);
  expect(paper.status, await paper.clone().text()).toBe(200);
  const printed = await paper.json();
  expect(printed.html).toContain("Soup for guests");
  expect(printed.html).not.toContain("New publication");
  expect(printed.html).toContain('src="data:image/webp;base64,');
  expect(printed.html).not.toContain(logo.filename);
  const plain = await request({ ...body, logo: null });
  expect((await plain.json()).html).not.toContain('src="data:');
  const missing = await request({ ...body, logo: "a".repeat(64) + ".webp" });
  expect((await missing.json()).html).not.toContain('src="data:');
  const wrongMenu = await f.app.request(`/management-api/menus/${f.dinner}/guest-paper`, {
    method: "POST",
    headers: { cookie: f.cookies.manager, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(await wrongMenu.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "versionId" } },
  });
  expect(captured.members).toContainEqual({ name: "Something to drink", section: true });
  for (const [cookie, code] of [
    ["", "management_session.required"],
    [f.cookies.staff, "authorization.not_permitted"],
  ]) {
    const refused = await request(body, cookie);
    expect(await refused.json()).toMatchObject({ error: { code } });
  }
  for (const value of [
    { ...body, paper: null },
    { ...body, order: [-1] },
    { ...body, breaks: "all" },
    { ...body, versionId: crypto.randomUUID() },
  ]) {
    const refused = await request(value);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
});

it("keeps sharing and paper settings usable when Cloud confirmation cannot be read", async () => {
  const f = await fixture(async () => {
    throw new AppError("cloud.state_invalid", {});
  });
  const response = await f.app.request("/management-api/guest-menu", {
    method: "PUT",
    headers: { cookie: f.cookies.manager, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, expectedRevision: 0 }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: true, revision: 1, available: false });
  const read = await f.app.request("/management-api/guest-menu", {
    headers: { cookie: f.cookies.manager },
  });
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({ enabled: true, revision: 1, available: false });
});

it("reads a due edition without a save and follows the new default on the next read", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(new Date("2026-11-14T05:00:00Z"));
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    await seedBusinessDay(tx, { timeZone: "Asia/Tokyo" });
    await setVenueDefaultMenu(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
    await updateProduct(tx, f.soup, { customerName: { en: "Scheduled soup" } });
    const preview = await previewMenu(tx, f.lunch);
    await queueMenuPublication(
      tx,
      f.lunch,
      preview.hash,
      new Date("2026-11-14T05:01:00Z"),
      f.cookies.managerId,
    );
  });
  expect((await guestMenuApi.readGuestMenuPages(suite.db, "en"))!.pages.en).toContain(
    "Soup for guests",
  );
  vi.setSystemTime(new Date("2026-11-14T05:02:00Z"));
  expect((await guestMenuApi.readGuestMenuPages(suite.db, "en"))!.pages.en).toContain(
    "Scheduled soup",
  );
  expect((await guestMenuApi.readGuestMenuPages(suite.db, "en"))!.pages.en).toContain("02:01 PM");
  await withTransaction(suite.db, async (tx) => {
    const preview = await previewMenu(tx, f.dinner);
    await publishMenu(tx, f.dinner, preview.hash, f.cookies.managerId);
    await setVenueDefaultMenu(tx, f.dinner);
  });
  const dinner = (await guestMenuApi.readGuestMenuPages(suite.db, "en"))!.pages.en;
  expect(dinner).toContain("Burger for guests");
  expect(dinner).not.toContain("Scheduled soup");
});

it("renders Cloud pages in UTC while the saved venue zone needs repair", async () => {
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    await seedBusinessDay(tx, { timeZone: "Invalid/Zone" });
    await setVenueDefaultMenu(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
  });
  expect((await guestMenuApi.readGuestMenuPages(suite.db, "en"))!.pages.en).toContain("UTC");
});

it("keeps guest sharing separate from saved menu defaults", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) =>
    saveMenuSettings(tx, { defaultProductVatClass: "reduced" }),
  );
  const headers = { cookie: f.cookies.manager };
  const status = await f.app.request("/management-api/guest-menu", { headers });
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual({ enabled: false, revision: 0, available: false });
  const saved = await f.app.request("/management-api/guest-menu", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, expectedRevision: 0 }),
  });
  expect(saved.status).toBe(200);
  expect((await saved.json()).enabled).toBe(true);
  expect(await readMenuSettings(suite.db)).toEqual({
    defaultProductVatClass: "reduced",
    defaultColor: null,
  });
});

it("serves the London regional names and distinct language links from the published menu", async () => {
  const f = await fixture();
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "en-US", "es"] });
    await updateProduct(tx, f.soup, { customerName: { en: "chips", "en-US": "fries" } });
    await setVenueDefaultMenu(tx, f.lunch);
    const preview = await previewMenu(tx, f.lunch);
    await publishMenu(tx, f.lunch, preview.hash, f.cookies.managerId);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
  });
  const response = await f.app.request("/public/menu?lang=en-US");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("fries");
  expect(html).toContain("English (United States)");
  for (const language of ["en", "en-GB", "es", "en-CA"]) {
    const answer = await f.app.request(`/public/menu?lang=${language}`);
    expect(answer.status).toBe(200);
    const body = await answer.text();
    expect(body).toContain("chips");
    expect(body).not.toContain("fries");
  }
});

it("follows phone languages unless lang is present, and varies successful and unavailable pages", async () => {
  const f = await fixture();
  const headers = { "Accept-Language": "fr, es-MX;q=0.8, en;q=0.5" };
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] });
    await updateProduct(tx, f.soup, {
      customerName: { en: "Soup for guests", es: "Soup in Spanish" },
    });
    await publishMenu(tx, f.lunch, (await previewMenu(tx, f.lunch)).hash, f.cookies.managerId);
    await setVenueDefaultMenu(tx, f.lunch);
    await saveSettings(tx, GUEST_MENU_SETTINGS, {
      doc: { enabled: true },
      expectedRevision: 0,
      personId: null,
    });
  });
  for (const [query, language, name] of [
    ["", "es", "Soup in Spanish"],
    ["?language=en", "es", "Soup in Spanish"],
    ["?lang=en", "en", "Soup for guests"],
    ["?lang=", "en", "Soup for guests"],
    ["?lang=invalid_tag", "en", "Soup for guests"],
  ]) {
    const response = await f.app.request(`/public/menu${query}`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Accept-Language");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain(`<html lang="${language}"`);
    expect(html).toContain(name);
  }
  const excluded = await f.app.request("/public/menu", {
    headers: { "Accept-Language": "*;q=1, es;q=0" },
  });
  expect(await excluded.text()).toContain('<html lang="en"');
  const repeated = await f.app.request("/public/menu", {
    headers: { "Accept-Language": "es;q=0, es, en;q=0.5" },
  });
  expect(await repeated.text()).toContain('<html lang="es"');
  f.serve(false);
  for (const [query, text] of [
    ["", "Carta no disponible"],
    ["?lang=en", "Menu unavailable"],
  ]) {
    const response = await f.app.request(`/public/menu${query}`, { headers });
    expect(response.status).toBe(503);
    expect(response.headers.get("vary")).toBe("Accept-Language");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain(text);
  }
});
