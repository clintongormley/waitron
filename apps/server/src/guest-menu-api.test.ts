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
