import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import { persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { mountThemesApi } from "../themes-api.js";

export const THEME_LOGO = `${"e".repeat(64)}.png`;

/** Printed bytes `[0xf0]` on 58 mm and `[0xf0, 0x0f]` on 80 mm. */
export const THEME_DOTS = {
  "58mm": { widthDots: 8, heightDots: 1, data: "8A==" },
  "80mm": { widthDots: 16, heightDots: 1, data: "8A8=" },
};

/** Clears before it inserts: the unique index on `in_use` refuses a second row holding 1. */
export async function putThemeInUse(
  db: Database,
  input: { light?: string; dark?: string; printedLogo?: unknown; name?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const name = input.name ?? `Theme ${id}`;
  const theme = {
    ...WAITRON_CHOICES,
    brandColor: "#1e5b3a",
    logo: {
      light: input.light ?? THEME_LOGO,
      ...(input.dark === undefined ? {} : { dark: input.dark }),
    },
    printedLogo: "printedLogo" in input ? input.printedLogo : THEME_DOTS,
  };
  await db.execute(sql`update custom_themes set in_use = null where in_use = 1`);
  await db.execute(
    sql`insert into custom_themes (id, name, name_key, in_use, theme, updated_at)
        values (${id}, ${name}, ${name.toLowerCase()}, 1, ${JSON.stringify(theme)},
                '2026-10-01T00:00:00.000Z')`,
  );
  return id;
}

export async function clearThemes(db: Database): Promise<void> {
  await db.execute(sql`delete from custom_themes`);
}

/** The request the Look card's Save makes, through the real route. */
export async function saveThemeThroughRoute(
  db: Database,
  id: string,
  theme: ThemeChoices,
): Promise<Response> {
  const cookie = await withTransaction(db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: `manager ${randomUUID()}`, role: "manager" })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: person!.id });
    return `${MANAGEMENT_COOKIE}=${session.token}`;
  });
  const app = new Hono();
  mountThemesApi(app, { db }, () => {});
  return app.request(`/management-api/themes/${id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ theme }),
  });
}

export type UntrustedAt = { departmentId: string };

export interface UntrustedCase {
  readonly name: string;
  apply(db: Database, at: UntrustedAt): Promise<void>;
  undo(db: Database, at: UntrustedAt): Promise<void>;
}

function storedDocument(name: string, receipt: string): UntrustedCase {
  return {
    name,
    async apply(db, at) {
      await db.execute(
        sql`insert into department_receipts (department_id, receipt, logo_rasters, updated_at)
            values (${at.departmentId}, ${receipt}, null, '2026-10-10T00:00:00Z')
            on conflict (department_id) do update set receipt = excluded.receipt`,
      );
    },
    async undo(db, at) {
      await db.execute(
        sql`delete from department_receipts where department_id = ${at.departmentId}`,
      );
    },
  };
}

export const UNTRUSTED_CASES: readonly UntrustedCase[] = [
  {
    name: "the read throws",
    async apply(db) {
      await db.execute(
        sql`alter table department_receipts rename to test_hidden_department_receipts`,
      );
    },
    async undo(db) {
      await db.execute(
        sql`alter table test_hidden_department_receipts rename to department_receipts`,
      );
    },
  },
  storedDocument("{bad json", "{bad json"),
  storedDocument("null", "null"),
  storedDocument("[]", "[]"),
  storedDocument("42", "42"),
  storedDocument("a numeric logo", `{"logo":7,"phone":"910111111"}`),
  storedDocument(
    "a logo longer than 255 bytes",
    JSON.stringify({ logo: `${"a".repeat(256)}.png` }),
  ),
  storedDocument("a logo that is not a library name", JSON.stringify({ logo: "../secret.png" })),
];
