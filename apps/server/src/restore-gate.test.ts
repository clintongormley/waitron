import { describe, expect, it } from "vitest";
import { expectedSchemaVersion } from "@waitron/migrations";
import { modulesWithSets } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { checkRestoreCompatibility } from "./restore-gate.js";

const target = {
  environment: "preproduction" as const,
  expectedVersions: { core: 40, "fiscal-verifactu": 12 },
};

describe("checkRestoreCompatibility", () => {
  it("refuses a newer backup schema", () => {
    expect(() =>
      checkRestoreCompatibility(
        { manifestVersion: 1, createdAt: "x", environment: "preproduction", modules: { core: 41 } },
        target,
      ),
    ).toThrowError(expect.objectContaining({ code: "restore.schema_too_new" }));
  });

  it("refuses an environment mismatch", () => {
    expect(() =>
      checkRestoreCompatibility(
        { manifestVersion: 1, createdAt: "x", environment: "production", modules: { core: 40 } },
        target,
      ),
    ).toThrowError(expect.objectContaining({ code: "restore.environment_mismatch" }));
  });

  it("refuses a newer backup even when the target's expected version is 0 (pins `!== undefined`)", () => {
    // A truthiness check would read a target at 0 as a module it does not run.
    expect(() =>
      checkRestoreCompatibility(
        { manifestVersion: 1, createdAt: "x", environment: "preproduction", modules: { core: 1 } },
        { environment: "preproduction", expectedVersions: { core: 0 } },
      ),
    ).toThrowError(expect.objectContaining({ code: "restore.schema_too_new" }));
  });

  it("accepts equal/older and ignores unknown modules", () => {
    expect(() =>
      checkRestoreCompatibility(
        {
          manifestVersion: 1,
          createdAt: "x",
          environment: "preproduction",
          modules: { core: 40, ghost: 99 },
        },
        target,
      ),
    ).not.toThrow();
  });

  it("carries the backup/target environments on the mismatch error", () => {
    expect(() =>
      checkRestoreCompatibility(
        { manifestVersion: 1, createdAt: "x", environment: "production", modules: {} },
        target,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "restore.environment_mismatch",
        params: { backup: "production", target: "preproduction" },
      }),
    );
  });

  it("carries the module/backup/target versions on the schema_too_new error", () => {
    expect(() =>
      checkRestoreCompatibility(
        {
          manifestVersion: 1,
          createdAt: "x",
          environment: "preproduction",
          modules: { "fiscal-verifactu": 13 },
        },
        target,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "restore.schema_too_new",
        params: { module: "fiscal-verifactu", backup: 13, target: 12 },
      }),
    );
  });

  // The gate skips a module name this image lacks, so an old backup is refused on a set this image
  // still has; core's comes first.
  it("refuses a backup made before the migration squash, on core's count", () => {
    // Each set's migration count just before the squash.
    const oldCounts: Record<string, number> = {
      core: 207,
      node: 2,
      handover: 1,
      catalogue: 36,
      "venue-service": 74,
      media: 11,
      identity: 11,
      workforce: 14,
      "workforce-es": 1,
      payments: 11,
      scheduler: 1,
      credentials: 1,
      "fiscal-verifactu": 18,
      bookings: 2,
      adjustments: 11,
      staffing: 4,
    };
    const expectedVersions = Object.fromEntries(
      modulesWithSets(ALL_MODULES).map((m) => [m.name, expectedSchemaVersion(m.migrations, null)]),
    );
    expect(expectedVersions.core).toBe(4);

    expect(() =>
      checkRestoreCompatibility(
        {
          manifestVersion: 1,
          createdAt: "x",
          environment: "preproduction",
          modules: oldCounts,
        },
        { environment: "preproduction", expectedVersions },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "restore.schema_too_new",
        params: { module: "core", backup: oldCounts.core, target: 4 },
      }),
    );
  });
});
