import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { runMigrations } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { tenantId as brandTenantId, locationId } from "@waitron/shared";
import { MEDIA_ROUTES } from "./routes.js";

registerModulePermissions([{ permission: "image.manage", grantedFrom: "manager" }]);
const suite = useTemplateDb({
  template: "media",
  setup: async ({ admin }) => {
    await runMigrations(admin, IDENTITY_MIGRATIONS);
    await admin.execute(sql`
      create function media_route_role_probe() returns trigger language plpgsql as $$
      begin
        if current_user <> 'app_user' or (select rolsuper from pg_roles where rolname = current_user) then
          raise exception 'image route wrote outside non-superuser app_user';
        end if;
        if tg_op = 'DELETE' then return old; else return new; end if;
      end
      $$;
      create trigger media_route_role_probe before insert or update or delete on media_images
        for each row execute function media_route_role_probe();
    `);
  },
});
const original = { names: { en: "Bread" }, altText: { en: "A loaf" }, labels: ["Food"] };
const changed = {
  names: { en: "Sourdough" },
  altText: { en: "A sourdough loaf" },
  labels: ["Bakery"],
};
function uploadBody() {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], "photo.jpg", { type: "image/jpeg" }),
  );
  for (const [key, value] of Object.entries(original)) form.set(key, JSON.stringify(value));
  return form;
}
async function session(tenantId: string, role: "manager" | "staff") {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, ${role}, ${hashPin("1234")}, ${role}) returning id
  `);
  const session = await suite.admin.transaction((tx) =>
    startManagementSession(tx, { tenantId, personId: person.rows[0]!.id }),
  );
  return { Cookie: `${MANAGEMENT_COOKIE}=${session.id}` };
}
async function fixture() {
  const tenantId = await seedTenant(suite.admin);
  const headers = await session(tenantId, "manager");
  const app = new Hono();
  MEDIA_ROUTES.mount(
    app,
    {
      db: suite.admin,
      cfg: {
        tenantId: brandTenantId(tenantId),
        locationId: locationId("00000000-0000-4000-8000-000000000001"),
        contentDefaultLanguage: "en",
      },
      maxUploadBytes: 100,
      core: {
        openTab: async () => {
          throw new Error("unused");
        },
      },
    },
    () => {},
  );
  const created = await app.request("/management-api/images", {
    method: "POST",
    headers,
    body: uploadBody(),
  });
  expect(created.status).toBe(201);
  const { image } = (await created.json()) as { image: { id: string; filename: string } };
  return { app, headers, tenantId, image };
}

it("allows its own manager to upload, read, edit and delete using non-superuser app_user", async () => {
  const { app, headers, image } = await fixture();
  for (const path of [
    "/management-api/images",
    "/management-api/image-labels",
    `/management-api/images/${image.id}`,
  ]) {
    expect((await app.request(path, { headers })).status).toBe(200);
  }
  const patch = await app.request(`/management-api/images/${image.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(changed),
  });
  expect(patch.status).toBe(200);
  expect(await patch.json()).toMatchObject({ image: { id: image.id, ...changed } });
  const deletion = await app.request(`/management-api/images/${image.id}`, {
    method: "DELETE",
    headers,
  });
  expect(deletion.status).toBe(200);
  expect(await deletion.json()).toEqual({ deleted: true, uses: [] });
});

it.each(["staff", "foreign manager"] as const)(
  "denies every library operation to a %s and preserves existing image data",
  async (actor) => {
    const { app, tenantId, image } = await fixture();
    const actorTenant = actor === "staff" ? tenantId : await seedTenant(suite.admin);
    const headers = await session(actorTenant, actor === "staff" ? "staff" : "manager");
    const requests: [string, RequestInit][] = [
      ["/management-api/images", { headers }],
      ["/management-api/image-labels", { headers }],
      [`/management-api/images/${image.id}`, { headers }],
      ["/management-api/images", { method: "POST", headers, body: uploadBody() }],
      [
        `/management-api/images/${image.id}`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(changed),
        },
      ],
      [`/management-api/images/${image.id}`, { method: "DELETE", headers }],
    ];
    for (const [path, options] of requests) {
      const response = await app.request(path, options);
      expect(response.status, `${options.method ?? "GET"} ${path}`).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "image.manage" } },
      });
    }
    const images = await suite.admin.execute(
      sql`select id, filename, names, alt_text as "altText", labels from media_images where tenant_id = ${tenantId}`,
    );
    expect(images.rows).toEqual([{ id: image.id, filename: image.filename, ...original }]);
    const data = await suite.admin.execute<{ count: number }>(
      sql`select count(*)::int as count from media_image_data where tenant_id = ${tenantId} and image_id = ${image.id}`,
    );
    expect(data.rows).toEqual([{ count: 1 }]);
  },
);
