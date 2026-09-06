import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { describe, expect, it } from "vitest";
import { buildManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("buildManifest", () => {
  it("stamps environment, createdAt, and a version per module", async () => {
    const manifest = await buildManifest({
      db: suite.db,
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
    // `core` is definitely migrated by the migration manifest — it is mandatory — so its applied
    // schema version must be a real, positive count of the journal table's rows, not the "table
    // doesn't exist yet" 0 that `appliedSchemaVersion` returns for an unmigrated module.
    expect(manifest.modules.core).toBeGreaterThan(0);
  });
});
