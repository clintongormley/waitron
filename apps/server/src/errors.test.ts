import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

// One assertion per zone.* code (FP-1 Task 2): each is constructible via `new AppError(code, params)`
// carrying the params errors.ts declares for it. The construction typechecks ONLY because errors.ts's
// `declare module "@waitron/shared"` augmentation is loaded — the side-effect import above — which is
// what makes the codes and their param shapes real for a consumer, mirroring
// packages/layouts/src/errors.test.ts and packages/sync/src/errors.test.ts (apps/server has no public
// barrel of its own to load the augmentation from — errors.ts's header comment explains why — so this
// file loads it directly, the same "every file that throws one of these imports ./errors.js" idiom
// tables.ts and till-api.ts already follow). Task 3's zone CRUD verbs are the real throwers; this only
// proves the two codes are registered with the right shape before any verb exists to throw them.
describe("the zone error codes carry their declared params", () => {
  it("constructs zone.not_found with the qualified zoneId, matching table.not_found's shape", () => {
    const zoneId = "11111111-1111-1111-1111-111111111111";
    const error = new AppError("zone.not_found", { zoneId });
    expect(error.code).toBe("zone.not_found");
    expect(error.params).toEqual({ zoneId });
  });

  it("constructs zone.name_taken with the operator-supplied name, matching table.label_taken's shape", () => {
    const error = new AppError("zone.name_taken", { name: "Terraza" });
    expect(error.code).toBe("zone.name_taken");
    expect(error.params).toEqual({ name: "Terraza" });
  });
});
