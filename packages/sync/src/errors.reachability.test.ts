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
    // Unlike the credentials clone, @waitron/sync's Task 1 barrel re-exports nothing at runtime yet
    // (later tasks add the registry/apply surface), so this asserts the barrel MODULE loaded rather
    // than that it re-exports a value: importing ./index.js runs `import "./errors.js"`, and if that
    // threw this file would fail to load at all.
    expect(barrel).toBeTypeOf("object");
  });
});
