import { expect, it } from "vitest";
import { Hono } from "hono";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { startManagementSession } from "@waitron/identity";
import { menusFixture } from "@waitron/catalogue/test/menus-fixture.js";
import { previewMenu, publishMenu, updateProduct } from "@waitron/catalogue";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountGuestMenuApi } from "./guest-menu-api.js";
import "./errors.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture() {
  const f = await menusFixture(suite.db);
  const cookies = await withTransaction(suite.db, async (tx) => {
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
  mountGuestMenuApi(app, { db: suite.db, venueLocale: "en" }, () => {});
  return { ...f, app, cookies };
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
    if (code === null) expect(await answer.json()).toEqual({ enabled: false, revision: 0 });
    else expect(await answer.json()).toMatchObject({ error: { code } });
  }
});

it("lets a manager change sharing with its current revision and keeps refusals from changing it", async () => {
  const f = await fixture();
  const save = (body: object, cookie = f.cookies.manager) =>
    f.app.request("/management-api/guest-menu", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const enabled = await save({ enabled: true, expectedRevision: 0 });
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ enabled: true, revision: 1 });
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
    expect(await current.json()).toEqual({ enabled: true, revision: 1 });
  }
  const disabled = await save({ enabled: false, expectedRevision: 1 });
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toEqual({ enabled: false, revision: 2 });
});
