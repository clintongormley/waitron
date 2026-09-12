import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { tenantId, locationId } from "@waitron/shared";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { MEDIA_ROUTES } from "./routes.js";

registerModulePermissions([{ permission: "image.manage", grantedFrom: "manager" }]);
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS, MEDIA_MIGRATIONS],
});
const photo = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
async function fixture(role = "manager") {
  const id = await seedTenant(suite.db);
  const person = await suite.db.execute<{ id: string }>(
    sql`insert into persons (tenant_id, display_name, pin_hash, role) values (${id},'Manager',${hashPin("1234")},${role}) returning id`,
  );
  const session = await suite.db.transaction((tx) =>
    startManagementSession(tx, { tenantId: id, personId: person.rows[0]!.id }),
  );
  const app = new Hono();
  MEDIA_ROUTES.mount(
    app,
    {
      db: suite.db,
      cfg: {
        tenantId: tenantId(id),
        locationId: locationId("00000000-0000-4000-8000-000000000001"),
        contentDefaultLanguage: "fr",
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
  return { app, id, headers: { Cookie: `${MANAGEMENT_COOKIE}=${session.id}` } };
}
function body() {
  const form = new FormData();
  form.set("file", new File([photo], "photo.jpg", { type: "image/jpeg" }));
  form.set("names", JSON.stringify({ fr: "Pain" }));
  form.set("altText", JSON.stringify({ fr: "Une miche" }));
  form.set("labels", JSON.stringify(["Food"]));
  return form;
}
describe("image routes", () => {
  it("identifies reused uploads and returns their original metadata unchanged", async () => {
    const { app, headers } = await fixture();
    const created = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: body(),
    });
    const first = (await created.json()) as { created: boolean; image: Record<string, unknown> };
    const duplicate = body();
    duplicate.set("names", JSON.stringify({ fr: "Nouveau nom" }));
    duplicate.set("altText", JSON.stringify({ fr: "Autre description" }));
    duplicate.set("labels", JSON.stringify(["Other"]));
    const reused = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: duplicate,
    });
    expect(reused.status).toBe(200);
    expect(await reused.json()).toEqual({ created: false, image: first.image });
    expect(first.created).toBe(true);
  });
  it("uploads, searches, serves public bytes, edits and deletes a photo", async () => {
    const { app, headers } = await fixture();
    const created = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: body(),
    });
    expect(created.status).toBe(201);
    const { image } = (await created.json()) as {
      image: { id: string; filename: string; names: Record<string, string> };
    };
    expect(image.names).toEqual({ fr: "Pain" });
    const publicImage = await app.request(`/media/${image.filename}`);
    expect(publicImage.status).toBe(200);
    expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(photo);
    expect(publicImage.headers.get("content-type")).toBe("image/jpeg");
    const list = await app.request("/management-api/images?search=Pain&sort=relevance", {
      headers,
    });
    expect(await list.json()).toMatchObject({ total: 1, images: [{ id: image.id }] });
    const detail = await app.request(`/management-api/images/${image.id}`, { headers });
    expect(await detail.json()).toMatchObject({ image: { id: image.id }, uses: [] });
    const edited = await app.request(`/management-api/images/${image.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        names: { fr: "Baguette" },
        altText: { fr: "Une baguette" },
        labels: [],
      }),
    });
    expect(edited.status).toBe(200);
    const removed = await app.request(`/management-api/images/${image.id}`, {
      method: "DELETE",
      headers,
    });
    expect(await removed.json()).toEqual({ deleted: true, uses: [] });
    expect((await app.request(`/media/${image.filename}`)).status).toBe(404);
  });
  it("requires manager access and rejects malformed input", async () => {
    const { app, headers } = await fixture("staff");
    expect((await app.request("/management-api/images")).status).toBe(401);
    expect((await app.request("/management-api/images", { headers })).status).toBe(403);
    const manager = await fixture();
    expect(
      (
        await manager.app.request("/management-api/images", {
          method: "POST",
          headers: manager.headers,
          body: new FormData(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await manager.app.request("/management-api/images?offset=no", { headers: manager.headers }))
        .status,
    ).toBe(400);
    expect(
      (await manager.app.request("/management-api/images/not-an-id", { headers: manager.headers }))
        .status,
    ).toBe(400);
  });
});

it("serves supported content types with immutable caching and rejects malformed public names", async () => {
  const { app, headers } = await fixture();
  for (const [bytes, contentType] of [
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
  ] as const) {
    const form = body();
    form.set("file", new File([bytes], "ignored.gif", { type: "image/gif" }));
    const created = await app.request("/management-api/images", {
      method: "POST",
      headers,
      body: form,
    });
    expect(created.status).toBe(201);
    const { image } = (await created.json()) as { image: { filename: string } };
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await app.request(`/media/${image.filename}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
  }
  for (const name of [
    "../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "x",
    "a".repeat(64) + ".gif",
    "a".repeat(63) + ".png",
    "a".repeat(65) + ".png",
    "A".repeat(64) + ".png",
    "a".repeat(64) + ".PNG",
    "a".repeat(64) + ".png",
  ]) {
    const response = await app.request(`/media/${encodeURIComponent(name)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  }
});
it("enforces file and raw request limits and rejects unsupported bytes or malformed metadata", async () => {
  const { app, headers } = await fixture();
  for (const [size, status] of [
    [101, 413],
    [70 * 1024, 413],
    [3, 415],
  ]) {
    const form = body();
    form.set("file", new File([new Uint8Array(size!)], "large.jpg"));
    expect(
      (await app.request("/management-api/images", { method: "POST", headers, body: form })).status,
    ).toBe(status);
  }
  for (const value of ["not-json", "null", "[]", JSON.stringify({ fr: 42 })]) {
    const form = body();
    form.set("names", value);
    expect(
      (await app.request("/management-api/images", { method: "POST", headers, body: form })).status,
    ).toBe(400);
  }
});
