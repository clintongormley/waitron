import { describe, expect, it } from "vitest";
import { checkRestoreCompatibility } from "./restore-gate.js";

const target = {
  environment: "preproduction" as const,
  expectedVersions: { core: 40, fiscal: 12 },
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
    // A truthiness regression — `if (targetVersion && backupVersion > targetVersion)` — would treat a
    // target expecting version 0 (a module with no migrations applied yet) as "not run" and let a
    // newer backup through. The guard is `targetVersion !== undefined`, so a target at 0 is still a
    // module the target runs, and backup 1 > 0 must refuse.
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
          modules: { fiscal: 13 },
        },
        target,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "restore.schema_too_new",
        params: { module: "fiscal", backup: 13, target: 12 },
      }),
    );
  });
});
