import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { buildManifest, schemaVersionsByModule } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("buildManifest", () => {
  it("stamps environment, createdAt, and a version per module", async () => {
    const manifest = await buildManifest({
      db: suite.db,
      node: suite.node,
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
    // A real count, not the 0 an unmigrated module reads.
    expect(manifest.modules.core).toBeGreaterThan(0);
  });
});

describe("schemaVersionsByModule", () => {
  it("has no key for a module with no set of its own", async () => {
    const setless = fakeSetlessModule("synthetic-setless", "core");
    const versions = await schemaVersionsByModule({ venue: suite.db, node: suite.node }, [
      ...ALL_MODULES,
      setless,
    ]);
    expect(Object.keys(versions)).toEqual(ALL_MODULES.map((m) => m.name));
    expect(versions.core).toBeGreaterThan(0);
  });
});
