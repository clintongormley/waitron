import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WAITRON_CHOICES } from "@waitron/ui-core/theme";
import { clearThemes, putThemeInUse, saveThemeThroughRoute } from "./theme-logo.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: seedTenant,
});

describe("saveThemeThroughRoute", () => {
  it("saves through the real route, which drops the stored dots with the logo", async () => {
    const id = await putThemeInUse(suite.db);
    const response = await saveThemeThroughRoute(suite.db, id, {
      ...WAITRON_CHOICES,
      logo: null,
    });
    expect(response.status).toBe(200);
    const rows = await suite.db.all<{ theme: string }>(
      sql`select theme from custom_themes where id = ${id}`,
    );
    const stored = JSON.parse(rows[0]!.theme) as Record<string, unknown>;
    expect(stored.logo).toBeNull();
    expect("printedLogo" in stored).toBe(false);
    await clearThemes(suite.db);
    expect(await suite.db.all(sql`select id from custom_themes`)).toEqual([]);
  });
});
