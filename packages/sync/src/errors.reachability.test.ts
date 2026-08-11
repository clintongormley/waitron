import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** The augmentation is only real if it is reachable from the public barrel — a declaration in a
 * file nothing imports type-checks locally and vanishes for every consumer. Mirrors
 * packages/credentials/src/errors.reachability.test.ts.
 *
 * This does NOT truly test reachability, a limitation every errors.reachability.test.ts in the repo
 * shares (CLAUDE.md §4: `tsconfig`'s `include: ["src"]` makes every file a compilation root
 * regardless of the import graph, and `vitest run` does not typecheck). It is cloned for the
 * pattern, not for a guarantee it does not provide. */
describe("the sync error codes reach the public barrel", () => {
  it("constructs a sync.* AppError with typed params", () => {
    const error = new AppError("sync.table_not_enrolled", { table: "sales" });
    expect(error.code).toBe("sync.table_not_enrolled");
    expect(error.params).toEqual({ table: "sales" });
  });

  it("loads the public barrel, so errors.ts's side-effect import runs", () => {
    // Importing ./index.js runs `import "./errors.js"`, and if that threw this file would fail to
    // load at all. Task 2 added the first runtime re-export to the barrel (SYNC_MIGRATIONS, the
    // outbox migration descriptor the manifest consumes); asserting it is present confirms the
    // barrel module loaded AND that the re-export resolves (later tasks add the registry/apply
    // surface).
    expect(barrel).toBeTypeOf("object");
    expect(barrel.SYNC_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_sync");
  });
});
