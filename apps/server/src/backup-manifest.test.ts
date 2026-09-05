import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { describe, expect, it } from "vitest";
import { buildManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";

// Real Postgres, not PGlite: `appliedSchemaVersion` reads the module's own drizzle journal table
// (`__drizzle_migrations_<name>`), which only exists once real migrations have run against it. The
// `manifest` template runs the FULL manifest through this host's own production path
// (`testing/global-setup.ts`), so every module in `ALL_MODULES` is actually migrated here. Needs
// `TESTCONTAINERS_RYUK_DISABLED=true` (CLAUDE.md §4).
const suite = useTemplateDb({ template: "manifest" });

describe("buildManifest", () => {
  it("stamps environment, createdAt, and a version per module", async () => {
    const manifest = await buildManifest({
      db: suite.admin,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date("2026-09-05T00:00:00Z"),
    });

    expect(manifest).toMatchObject({
      manifestVersion: 1,
      environment: "preproduction",
      createdAt: "2026-09-05T00:00:00.000Z",
    });
    expect(Object.keys(manifest.modules)).toEqual(
      expect.arrayContaining(ALL_MODULES.map((m) => m.name)),
    );
    // `core` is definitely migrated by the `manifest` template — it is mandatory — so its applied
    // schema version must be a real, positive count of the journal table's rows, not the "table
    // doesn't exist yet" 0 that `appliedSchemaVersion` returns for an unmigrated module.
    expect(manifest.modules.core).toBeGreaterThan(0);
  });
});
