import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import { mountThemesApi } from "./themes-api.js";

let managerCookie: string;
let supervisorCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    [managerCookie, supervisorCookie, staffCookie] = await withTransaction(db, async (tx) => {
      const cookieFor = async (role: "manager" | "supervisor" | "staff") => {
        const [person] = await tx
          .insert(persons)
          .values({ displayName: role, pinHash: hashPin("1234"), role })
          .returning({ id: persons.id });
        const session = await startManagementSession(tx, { personId: person!.id });
        return `${MANAGEMENT_COOKIE}=${session.token}`;
      };
      return [await cookieFor("manager"), await cookieFor("supervisor"), await cookieFor("staff")];
    });
  },
});

beforeEach(async () => {
  await suite.db.execute(sql`delete from custom_themes`);
});

const PATH = "/management-api/themes";

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};
const DARK_GREEN: ThemeChoices = { ...LEMON, brandColor: "#1e5b3a" };
const LEMON_WARNING = {
  field: "brandColor",
  mode: "light",
  against: ["field-fill", "bg", "surface", "surface-raised", "stepper-button"],
  fix: "#9d8a15",
  blockedBy: [],
};

function app(): Hono {
  const hono = new Hono();
  mountThemesApi(hono, { db: suite.db }, () => {});
  return hono;
}

const list = (cookie: string) => app().request(PATH, { headers: { cookie } });
const create = (cookie: string, body: unknown) =>
  app().request(PATH, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const save = (cookie: string, id: string, body: unknown) =>
  app().request(`${PATH}/${id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const switchTo = (cookie: string, body: unknown) =>
  app().request("/management-api/theme-in-use", {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function switched(customThemeId: string | null): Promise<void> {
  const res = await switchTo(managerCookie, { customThemeId });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ inUse: customThemeId });
}

async function venueTheme(): Promise<{ hash: string; css: string }> {
  const res = await app().request("/api/theme");
  expect(res.status).toBe(200);
  return (await res.json()) as { hash: string; css: string };
}

async function rowsInUse(): Promise<string[]> {
  const { rows } = await suite.db.execute<{ id: string }>(
    sql`select id from custom_themes where in_use = 1 order by id`,
  );
  return rows.map((row) => row.id);
}

async function created(name: string, theme: unknown): Promise<string> {
  const res = await create(managerCookie, { name, theme });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function storedRows(): Promise<{ id: string; name: string; theme: string }[]> {
  const { rows } = await suite.db.execute<{ id: string; name: string; theme: string }>(
    sql`select id, name, theme from custom_themes order by id`,
  );
  return rows;
}

const refusal = (code: string, params: Record<string, unknown> = {}) => ({
  error: { code, params },
});

describe("the custom theme routes", () => {
  it("refuses invalid choices naming the field", async () => {
    const id = await created("Lemon", LEMON);
    const before = await storedRows();
    for (const [theme, field, reason] of [
      [{ ...LEMON, handSet: { light: { bg: "#fff" }, dark: {} } }, "handSet.light.bg", "bad_value"],
      [
        { ...LEMON, brandColor: null, brandFix: { light: true } },
        "brandFix.light",
        "fix_without_brand",
      ],
      [
        {
          ...LEMON,
          brandFix: { light: true },
          handSet: { light: { primary: "#1e5b3a" }, dark: {} },
        },
        "brandFix.light",
        "fix_with_hand_set",
      ],
      [{ ...LEMON, logo: "x" }, "logo", "unknown_key"],
      [{ ...LEMON, textScale: 1 }, "textScale", "unknown_key"],
    ] as const) {
      const res = await save(managerCookie, id, { theme });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal("theme.invalid", { field, reason }));
      expect(await storedRows()).toEqual(before);
    }
  });

  it("stores the lemon brand (#f2d300) as sent and answers its warning in keys", async () => {
    const id = await created("Lemon", DARK_GREEN);
    const res = await save(managerCookie, id, { theme: LEMON });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices.brandColor).toBe("#f2d300");
    expect(body.choices.brandFix).toEqual({});
    expect(body.warnings).toEqual([LEMON_WARNING]);
    expect(body.light["--wt-color-primary"]).toEqual(expect.any(String));
    expect(body.dark["--wt-color-primary"]).toEqual(expect.any(String));
  });

  it("answers the same warning from GET, to a supervisor too", async () => {
    const id = await created("Lemon", LEMON);
    for (const cookie of [managerCookie, supervisorCookie]) {
      const res = await list(cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.inUse).toBeNull();
      expect(body.themes).toHaveLength(1);
      expect(body.themes[0].id).toBe(id);
      expect(body.themes[0].warnings).toEqual([LEMON_WARNING]);
    }
  });

  it("stores an uppercase document lowercase", async () => {
    const res = await create(managerCookie, {
      name: "Lemon",
      theme: { ...LEMON, brandColor: "#F2D300" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).choices.brandColor).toBe("#f2d300");
    const listed = await (await list(managerCookie)).json();
    expect(listed.themes[0].choices.brandColor).toBe("#f2d300");
    expect(JSON.parse((await storedRows())[0]!.theme).brandColor).toBe("#f2d300");
  });

  it("a supervisor reads the list and is refused every write here", async () => {
    const id = await created("Lemon", LEMON);
    const before = await storedRows();
    expect((await list(supervisorCookie)).status).toBe(200);
    for (const res of [
      await create(supervisorCookie, { name: "Green", theme: DARK_GREEN }),
      await save(supervisorCookie, id, { theme: DARK_GREEN }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(
        refusal("authorization.not_permitted", { permission: "layout.configure" }),
      );
    }
    expect(await storedRows()).toEqual(before);
  });

  it("staff are refused the read", async () => {
    const res = await list(staffCookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(
      refusal("authorization.not_permitted", { permission: "venue.view" }),
    );
  });

  it("a name another theme holds is name_taken, and Waitron's name is refused", async () => {
    await created("Red", LEMON);
    const taken = await create(managerCookie, { name: "red", theme: LEMON });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual(refusal("theme.name_taken", { field: "name" }));
    const reserved = await create(managerCookie, { name: "WaItRoN", theme: LEMON });
    expect(reserved.status).toBe(400);
    expect(await reserved.json()).toEqual(
      refusal("theme.invalid", { field: "name", reason: "reserved" }),
    );
    expect(await storedRows()).toHaveLength(1);
  });

  it("the list answers each theme's warnings, and null for a document this release cannot use", async () => {
    const lemon = await created("A", LEMON);
    const green = await created("B", DARK_GREEN);
    const broken = "5d9f0a8e-1c2b-4e3d-8f4a-6b7c8d9e0f1a";
    const refused = "5d9f0a8e-1c2b-4e3d-8f4a-6b7c8d9e0f1b";
    await suite.db.run(
      sql`insert into custom_themes (id, name, name_key, theme, updated_at) values
          (${broken}, 'C', 'c', '{broken', '2026-10-21T00:00:00.000Z'),
          (${refused}, 'D', 'd', '{"tokens":{}}', '2026-10-21T00:00:00.000Z')`,
    );
    const res = await list(managerCookie);
    expect(res.status).toBe(200);
    const { themes } = await res.json();
    expect(themes.map((theme: { id: string }) => theme.id)).toEqual([
      lemon,
      green,
      broken,
      refused,
    ]);
    expect(themes[0].warnings).toEqual([LEMON_WARNING]);
    expect(themes[1].warnings).toContainEqual(
      expect.objectContaining({ field: "brandColor", mode: "dark" }),
    );
    for (const theme of themes.slice(2)) {
      expect(theme).toMatchObject({ choices: null, light: null, dark: null, warnings: [] });
    }
    for (const id of [broken, refused]) {
      const saved = await save(managerCookie, id, { theme: LEMON });
      expect(saved.status).toBe(200);
      expect((await saved.json()).choices).toEqual(LEMON);
    }
  });

  it("checks a request in its stated order", async () => {
    const id = await created("Lemon", LEMON);
    const lacking = await save(staffCookie, id, {});
    expect(lacking.status).toBe(400);
    expect(await lacking.json()).toEqual(refusal("management.request_invalid", { field: "theme" }));
    const bad = { theme: { ...LEMON, logo: "x" } };
    const supervisor = await save(supervisorCookie, randomUUID(), bad);
    expect(supervisor.status).toBe(403);
    expect((await supervisor.json()).error.code).toBe("authorization.not_permitted");
    const manager = await save(managerCookie, randomUUID(), bad);
    expect(manager.status).toBe(404);
    expect(await manager.json()).toEqual(refusal("theme.not_found"));
  });

  it("an unknown or malformed id is theme.not_found", async () => {
    for (const id of [randomUUID(), "x"]) {
      const res = await save(managerCookie, id, { theme: LEMON });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(refusal("theme.not_found"));
    }
  });

  it("malformed bodies name their field", async () => {
    for (const [body, field] of [
      [{ theme: LEMON }, "name"],
      [{ name: 7, theme: LEMON }, "name"],
      [{ name: "Lemon" }, "theme"],
      [["Lemon", LEMON], "body"],
    ] as const) {
      const res = await create(managerCookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal("management.request_invalid", { field }));
    }
    expect(await storedRows()).toEqual([]);
  });
});

describe("switching the custom theme in use", () => {
  it("serves the lemon from /api/theme as picked once it is in use", async () => {
    const lemon = await created("A", LEMON);
    await switched(lemon);
    expect((await venueTheme()).css).toContain("--wt-color-primary: #f2d300;");
  });

  it("switching moves /api/theme's hash, and back to Waitron's returns it", async () => {
    const lemon = await created("A", LEMON);
    const green = await created("B", DARK_GREEN);
    const h0 = (await venueTheme()).hash;
    await switched(lemon);
    const h1 = (await venueTheme()).hash;
    expect(h1).not.toBe(h0);
    await switched(green);
    const h2 = (await venueTheme()).hash;
    expect(h2).not.toBe(h1);
    expect(h2).not.toBe(h0);
    await switched(null);
    expect((await venueTheme()).hash).toBe(h0);
    expect(await rowsInUse()).toEqual([]);
    await switched(lemon);
    expect((await venueTheme()).hash).toBe(h1);
  });

  it("switching to the theme already in use, or to Waitron's while it is in use, changes nothing", async () => {
    const lemon = await created("A", LEMON);
    const h0 = (await venueTheme()).hash;
    await switched(null);
    expect((await venueTheme()).hash).toBe(h0);
    expect(await rowsInUse()).toEqual([]);
    await switched(lemon);
    const h1 = (await venueTheme()).hash;
    await switched(lemon);
    expect((await venueTheme()).hash).toBe(h1);
    expect(await rowsInUse()).toEqual([lemon]);
  });

  it("an uppercase document hashes as the lowercase one", async () => {
    const upper = await created("C", { ...LEMON, brandColor: "#F2D300" });
    const lower = await created("D", LEMON);
    await switched(upper);
    const upperHash = (await venueTheme()).hash;
    await switched(lower);
    expect((await venueTheme()).hash).toBe(upperHash);
    await switched(null);
    expect((await venueTheme()).hash).not.toBe(upperHash);
  });

  it("saving or copying a theme not in use leaves the hash, and saving the one in use moves it", async () => {
    const lemon = await created("A", LEMON);
    const green = await created("B", DARK_GREEN);
    await switched(lemon);
    const h1 = (await venueTheme()).hash;
    expect((await save(managerCookie, green, { theme: LEMON })).status).toBe(200);
    expect((await venueTheme()).hash).toBe(h1);
    await created("A copy", LEMON);
    expect((await venueTheme()).hash).toBe(h1);
    expect(await rowsInUse()).toEqual([lemon]);
    expect((await save(managerCookie, lemon, { theme: DARK_GREEN })).status).toBe(200);
    expect((await venueTheme()).hash).not.toBe(h1);
  });

  it("POST with inUse switches in the same request", async () => {
    const lemon = await created("A", LEMON);
    await switched(lemon);
    const res = await create(managerCookie, { name: "B2", theme: DARK_GREEN, inUse: true });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await (await list(managerCookie)).json()).inUse).toBe(id);
    expect(await rowsInUse()).toEqual([id]);
  });

  it("POST with inUse false leaves the theme in use", async () => {
    const lemon = await created("A", LEMON);
    await switched(lemon);
    const res = await create(managerCookie, { name: "B2", theme: DARK_GREEN, inUse: false });
    expect(res.status).toBe(201);
    expect(await rowsInUse()).toEqual([lemon]);
  });

  it("a supervisor is refused the switch", async () => {
    const lemon = await created("A", LEMON);
    const green = await created("B", DARK_GREEN);
    await switched(lemon);
    const before = await storedRows();
    for (const res of [
      await switchTo(supervisorCookie, { customThemeId: green }),
      await switchTo(supervisorCookie, { customThemeId: null }),
      await create(supervisorCookie, { name: "C", theme: DARK_GREEN, inUse: true }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(
        refusal("authorization.not_permitted", { permission: "layout.configure" }),
      );
    }
    expect(await rowsInUse()).toEqual([lemon]);
    expect(await storedRows()).toEqual(before);
  });

  it("switching to an unknown or malformed id is theme.not_found", async () => {
    const lemon = await created("A", LEMON);
    await switched(lemon);
    for (const customThemeId of [randomUUID(), "x"]) {
      const res = await switchTo(managerCookie, { customThemeId });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(refusal("theme.not_found"));
    }
    expect(await rowsInUse()).toEqual([lemon]);
  });

  it("malformed bodies name their field", async () => {
    const lemon = await created("A", LEMON);
    await switched(lemon);
    for (const [body, field] of [
      [{}, "customThemeId"],
      [{ customThemeId: 7 }, "customThemeId"],
      [["x"], "body"],
    ] as const) {
      const res = await switchTo(managerCookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal("management.request_invalid", { field }));
    }
    const res = await create(managerCookie, { name: "B", theme: DARK_GREEN, inUse: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(refusal("management.request_invalid", { field: "inUse" }));
    expect(await rowsInUse()).toEqual([lemon]);
    expect(await storedRows()).toHaveLength(1);
  });
});
