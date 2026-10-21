import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createCustomTheme,
  listCustomThemes,
  readThemeInUse,
  saveCustomTheme,
  setThemeInUse,
} from "./theme-store.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};

const DARK_GREEN: ThemeChoices = { ...LEMON, brandColor: "#1e5b3a", background: "tinted" };

const BAD_DOCUMENT = { ...LEMON, brandColor: null, brandFix: { light: true } };

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Through drizzle rather than raw SQL: `persons.id` takes its value from a `$defaultFn`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: `Operator ${role}`, pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
}

async function errorOf(fn: () => Promise<unknown>): Promise<unknown> {
  const error = await captureError(fn);
  return isAppError(error)
    ? { code: error.code, params: error.params }
    : `did not throw an AppError: ${String(error)}`;
}

async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  const error = await errorOf(fn);
  return typeof error === "string" ? error : (error as { code: string }).code;
}

async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from custom_themes`);
  return rows.rows[0]!.n;
}

async function idsInUse(): Promise<string[]> {
  const rows = await suite.db.execute<{ id: string }>(
    sql`select id from custom_themes where in_use = 1`,
  );
  return rows.rows.map((row) => row.id);
}

async function rawRow(id: string): Promise<unknown> {
  const rows = await suite.db.execute(sql`select * from custom_themes where id = ${id}`);
  return rows.rows[0];
}

async function setup(): Promise<{ manager: string }> {
  await seedTenant(suite.db);
  return { manager: await seedSession("manager") };
}

function create(manager: string, name: string, theme: unknown = LEMON, inUse?: boolean) {
  return inTx((tx) => createCustomTheme(tx, { managementSessionId: manager, name, theme, inUse }));
}

function switchTo(manager: string, customThemeId: string | null) {
  return inTx((tx) => setThemeInUse(tx, { managementSessionId: manager, customThemeId }));
}

describe("custom theme store against a real migrated database", () => {
  it("creates a theme out of use, and lists it", async () => {
    const { manager } = await setup();
    const created = await create(manager, " Bar ");
    expect(created).toEqual({
      id: expect.any(String),
      name: "Bar",
      choices: LEMON,
      updatedAt: expect.any(String),
    });
    expect(await inTx(listCustomThemes)).toEqual({
      themes: [{ id: created.id, name: "Bar", choices: LEMON, updatedAt: created.updatedAt }],
      inUse: null,
    });
    expect(await inTx(readThemeInUse)).toBeNull();
  });

  it("lists themes ordered by their name key", async () => {
    const { manager } = await setup();
    await create(manager, "beta");
    await create(manager, "Alpha");
    const list = await inTx(listCustomThemes);
    expect(list.themes.map((theme) => theme.name)).toEqual(["Alpha", "beta"]);
  });

  it.each(["supervisor", "staff"] as const)(
    "refuses every write from a %s before writing",
    async (role) => {
      const { manager } = await setup();
      const existing = await create(manager, "Bar");
      const session = await seedSession(role);
      const before = await rawRow(existing.id);
      expect(await codeOf(() => create(session, "Other"))).toBe("authorization.not_permitted");
      expect(
        await codeOf(() =>
          inTx((tx) =>
            saveCustomTheme(tx, {
              managementSessionId: session,
              id: existing.id,
              theme: DARK_GREEN,
            }),
          ),
        ),
      ).toBe("authorization.not_permitted");
      expect(await codeOf(() => switchTo(session, existing.id))).toBe(
        "authorization.not_permitted",
      );
      expect(await rowCount()).toBe(1);
      expect(await rawRow(existing.id)).toEqual(before);
      expect(await idsInUse()).toEqual([]);
    },
  );

  it("refuses an invalid document before writing", async () => {
    const { manager } = await setup();
    expect(await errorOf(() => create(manager, "Bar", BAD_DOCUMENT))).toEqual({
      code: "theme.invalid",
      params: { field: "brandFix.light", reason: "fix_without_brand" },
    });
    expect(await rowCount()).toBe(0);
    const existing = await create(manager, "Bar");
    const before = await rawRow(existing.id);
    expect(
      await codeOf(() =>
        inTx((tx) =>
          saveCustomTheme(tx, {
            managementSessionId: manager,
            id: existing.id,
            theme: BAD_DOCUMENT,
          }),
        ),
      ),
    ).toBe("theme.invalid");
    expect(await rawRow(existing.id)).toEqual(before);
  });

  it("refuses an invalid name before writing", async () => {
    const { manager } = await setup();
    expect(await errorOf(() => create(manager, "WAITRON"))).toEqual({
      code: "theme.invalid",
      params: { field: "name", reason: "reserved" },
    });
    expect(await rowCount()).toBe(0);
  });

  it("refuses a name another theme holds, ignoring case and accent form", async () => {
    const { manager } = await setup();
    await create(manager, "Zoë Studio");
    for (const name of ["ZOË STUDIO", "zoë studio"]) {
      expect(await errorOf(() => create(manager, name))).toEqual({
        code: "theme.name_taken",
        params: { field: "name" },
      });
    }
    expect(await rowCount()).toBe(1);
    const control = await create(manager, "Zoë Studio 2");
    expect(control.name).toBe("Zoë Studio 2");
    expect(await rowCount()).toBe(2);
  });

  it("refuses a capital whose small letter composes only after lower-casing", async () => {
    const { manager } = await setup();
    await create(manager, "ẗ");
    expect(await errorOf(() => create(manager, "T̈"))).toEqual({
      code: "theme.name_taken",
      params: { field: "name" },
    });
    expect(await rowCount()).toBe(1);
  });

  it("switches by clearing the old theme before setting the new one", async () => {
    const { manager } = await setup();
    const a = await create(manager, "A", LEMON, true);
    const b = await create(manager, "B", DARK_GREEN);
    expect(await idsInUse()).toEqual([a.id]);
    expect(await switchTo(manager, b.id)).toBe(b.id);
    expect(await idsInUse()).toEqual([b.id]);
    expect(await inTx(readThemeInUse)).toEqual({ id: b.id, choices: DARK_GREEN });
    expect((await inTx(listCustomThemes)).inUse).toBe(b.id);
    expect(await switchTo(manager, null)).toBeNull();
    expect(await idsInUse()).toEqual([]);
    await switchTo(manager, b.id);
    await switchTo(manager, b.id);
    expect(await idsInUse()).toEqual([b.id]);
    await switchTo(manager, null);
    expect(await switchTo(manager, null)).toBeNull();
    expect(await idsInUse()).toEqual([]);
  });

  it("creates a theme in use in one call", async () => {
    const { manager } = await setup();
    await create(manager, "A", LEMON, true);
    const created = await create(manager, "B", DARK_GREEN, true);
    expect(await idsInUse()).toEqual([created.id]);
  });

  it("create and save change only their own row", async () => {
    const { manager } = await setup();
    const a = await create(manager, "A");
    const b = await create(manager, "B", DARK_GREEN);
    await suite.db.execute(
      sql`update custom_themes set updated_at = '2000-01-01T00:00:00.000Z' where id = ${b.id}`,
    );
    const bBefore = await rawRow(b.id);
    const ROUND: ThemeChoices = { ...LEMON, corners: "round" };
    const saved = await inTx((tx) =>
      saveCustomTheme(tx, { managementSessionId: manager, id: a.id, theme: ROUND }),
    );
    expect(saved).toEqual({ id: a.id, name: "A", choices: ROUND, updatedAt: expect.any(String) });
    const bAfter = (await rawRow(b.id)) as { theme: string; updated_at: string };
    expect(JSON.parse(bAfter.theme)).toEqual(DARK_GREEN);
    expect(bAfter.updated_at).toBe("2000-01-01T00:00:00.000Z");
    expect(bAfter).toEqual(bBefore);
    const aBefore = await rawRow(a.id);
    const copy = await create(manager, "C", saved.choices);
    expect(copy.choices).toEqual(ROUND);
    expect(await rawRow(a.id)).toEqual(aBefore);
    expect(await rawRow(b.id)).toEqual(bBefore);
  });

  it("stores the normalised document and stamps updated_at on save", async () => {
    const { manager } = await setup();
    const a = await create(manager, "A", { ...LEMON, brandColor: "#F2D300" });
    const stored = (await rawRow(a.id)) as { theme: string; updated_at: string };
    expect(JSON.parse(stored.theme)).toEqual(LEMON);
    await suite.db.execute(
      sql`update custom_themes set updated_at = '2000-01-01T00:00:00.000Z' where id = ${a.id}`,
    );
    const saved = await inTx((tx) =>
      saveCustomTheme(tx, { managementSessionId: manager, id: a.id, theme: LEMON }),
    );
    expect(saved.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(((await rawRow(a.id)) as { updated_at: string }).updated_at).toBe(saved.updatedAt);
  });

  it.each([randomUUID(), "not-a-uuid"])(
    "answers theme.not_found for the unknown or malformed id %s",
    async (id) => {
      const { manager } = await setup();
      await create(manager, "A", LEMON, true);
      expect(
        await codeOf(() =>
          inTx((tx) => saveCustomTheme(tx, { managementSessionId: manager, id, theme: LEMON })),
        ),
      ).toBe("theme.not_found");
      expect(await codeOf(() => switchTo(manager, id))).toBe("theme.not_found");
      expect(await rowCount()).toBe(1);
      expect(await idsInUse()).toHaveLength(1);
    },
  );

  // SQLite's json_valid accepts the trailing NUL that JSON.parse refuses (node:sqlite, SQLite 3.54.0).
  it.each(["{broken", '{"tokens":{}}', `${JSON.stringify(LEMON)}\u0000`])(
    "reads back the stored document %s this release cannot use as null choices",
    async (text) => {
      const { manager } = await setup();
      const id = randomUUID();
      await suite.db.execute(
        sql`insert into custom_themes (id, name, name_key, in_use, theme, updated_at)
            values (${id}, 'Old', 'old', 1, ${text}, '2026-10-01T00:00:00.000Z')`,
      );
      const lemon = await create(manager, "Lemon");
      expect(await inTx(listCustomThemes)).toEqual({
        themes: [
          { id: lemon.id, name: "Lemon", choices: LEMON, updatedAt: lemon.updatedAt },
          { id, name: "Old", choices: null, updatedAt: "2026-10-01T00:00:00.000Z" },
        ],
        inUse: id,
      });
      expect(await inTx(readThemeInUse)).toEqual({ id, choices: null });
      await inTx((tx) => saveCustomTheme(tx, { managementSessionId: manager, id, theme: LEMON }));
      expect(await inTx(readThemeInUse)).toEqual({ id, choices: LEMON });
    },
  );

  it("checks permission before the document and name on create", async () => {
    const { manager } = await setup();
    const supervisor = await seedSession("supervisor");
    const createBad = (session: string) => create(session, "Waitron", BAD_DOCUMENT);
    expect(await codeOf(() => createBad(supervisor))).toBe("authorization.not_permitted");
    expect(await codeOf(() => createBad(manager))).toBe("theme.invalid");
    expect(await rowCount()).toBe(0);
  });

  it.each([randomUUID(), "not-a-uuid"])(
    "checks permission before the id on switch, for the missing id %s",
    async (id) => {
      const { manager } = await setup();
      const supervisor = await seedSession("supervisor");
      expect(await codeOf(() => switchTo(supervisor, id))).toBe("authorization.not_permitted");
      expect(await codeOf(() => switchTo(manager, id))).toBe("theme.not_found");
    },
  );

  it("checks permission before the id, and the id before the document", async () => {
    const { manager } = await setup();
    const supervisor = await seedSession("supervisor");
    const saveUnknown = (session: string) =>
      inTx((tx) =>
        saveCustomTheme(tx, {
          managementSessionId: session,
          id: randomUUID(),
          theme: BAD_DOCUMENT,
        }),
      );
    expect(await codeOf(() => saveUnknown(supervisor))).toBe("authorization.not_permitted");
    expect(await codeOf(() => saveUnknown(manager))).toBe("theme.not_found");
  });
});
