import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, customThemes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import { mountThemesApi } from "./themes-api.js";
import { WAITRON_THEME_ANSWER, forgetVenueTheme, venueThemeAnswer } from "./venue-theme.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};

function app(): Hono {
  const hono = new Hono();
  mountThemesApi(hono, { db: suite.db }, () => {});
  return hono;
}

beforeEach(() => {
  forgetVenueTheme();
});

describe("GET /api/theme", () => {
  it("answers Waitron's sheet with no session and no theme in use", async () => {
    const res = await app().request("/api/theme");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(WAITRON_THEME_ANSWER);
  });

  it("serves the theme in use: the lemon brand (#f2d300)", async () => {
    const [row] = await suite.db
      .insert(customThemes)
      .values({ name: "Lemon", nameKey: "lemon", inUse: 1, theme: LEMON })
      .returning({ id: customThemes.id });
    const res = await app().request("/api/theme");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(venueThemeAnswer({ id: row!.id, choices: LEMON }));
    expect(body).not.toEqual(WAITRON_THEME_ANSWER);
  });

  it.each(["{broken", '{"tokens":{}}'])(
    "serves Waitron's sheet for a stored document this release cannot use: %s",
    async (text) => {
      await suite.db.run(
        sql`insert into custom_themes (id, name, name_key, in_use, theme, updated_at)
            values ('5d9f0a8e-1c2b-4e3d-8f4a-6b7c8d9e0f1a', 'Stored', 'stored', 1, ${text},
                    '2026-10-21T00:00:00.000Z')`,
      );
      const res = await app().request("/api/theme");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(WAITRON_THEME_ANSWER);
    },
  );
});
