import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountMeApi } from "./me-api.js";

// A database with no `tenants` row: the boot configuration named no taxpayer.
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
});

describe("mountMeApi — a database holding no tenant", () => {
  it("answers the public locales request with an opaque 500 and logs it as a me failure", async () => {
    const lines: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const log: Logger = (level, message, fields) => void lines.push([level, message, fields]);
    const app = new Hono();
    mountMeApi(
      app,
      {
        db: suite.db,
        cfg: { nodeId: "11111111-1111-4111-8111-111111111111" },
        venueLocale: "en-GB",
        modules: ["core"],
      },
      log,
    );

    const res = await app.request("/management-api/locales");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    expect(lines.map(([level, message]) => [level, message])).toEqual([["error", "me.failed"]]);
  });
});
