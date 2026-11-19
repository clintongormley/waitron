import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
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
  const light = input.light ?? THEME_LOGO;
  for (const filename of [light, input.dark]) {
    if (filename !== undefined) await seedPhotoMetadata(db, { filename, names: {} });
  }
  const { logo: _, ...choices } = WAITRON_CHOICES;
  const theme = {
    ...choices,
    brandColor: "#1e5b3a",
    printedLogo: "printedLogo" in input ? input.printedLogo : THEME_DOTS,
  };
  await db.execute(sql`update custom_themes set in_use = null where in_use = 1`);
  await db.execute(
    sql`insert into custom_themes (id, name, name_key, in_use, theme, logo_light_image, logo_dark_image, updated_at)
        values (${id}, ${name}, ${name.toLowerCase()}, 1, ${JSON.stringify(theme)}, ${light}, ${input.dark ?? null},
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
    const [person] = await seedPersons(tx, {
      displayName: `manager ${randomUUID()}`,
      role: "manager",
    });
    const session = await startManagementSession(tx, { method: "password", personId: person!.id });
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
        sql`update departments set receipt_text = ${receipt}, receipt_logo_image_id = null, receipt_logo_rasters = null, receipt_updated_at = '2026-10-10T00:00:00Z' where id = ${at.departmentId}`,
      );
    },
    async undo(db, at) {
      await db.execute(
        sql`update departments set receipt_text = null, receipt_updated_at = null where id = ${at.departmentId}`,
      );
    },
  };
}

export const UNTRUSTED_CASES: readonly UntrustedCase[] = [
  {
    name: "the read throws",
    async apply(db) {
      await db.execute(
        sql`alter table departments rename column receipt_text to test_hidden_receipt_text`,
      );
    },
    async undo(db) {
      await db.execute(
        sql`alter table departments rename column test_hidden_receipt_text to receipt_text`,
      );
    },
  },
  storedDocument("{bad json", "{bad json"),
  storedDocument("null", "null"),
  storedDocument("[]", "[]"),
  storedDocument("42", "42"),
];
