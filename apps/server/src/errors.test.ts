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

// FP-2 spatial floor plan (Task 2). `placement.invalid` is the field-validation code
// `setTablePlacement` throws for an out-of-range coordinate/rotation or a bad shape. As with the zone
// codes above, this only proves it is registered with the right param SHAPE — the construction
// typechecks solely because errors.ts's `declare module` augmentation is loaded (the side-effect
// import above). Crucially it pins the NO-LEAK discipline (CLAUDE.md §1): the param carries the field
// NAME only, never the offending value.
describe("the placement error code carries its declared params", () => {
  it("constructs placement.invalid naming the offending field, never the value", () => {
    const error = new AppError("placement.invalid", { field: "posX" });
    expect(error.code).toBe("placement.invalid");
    expect(error.params).toEqual({ field: "posX" });
  });
});

// KDS-1 (Task 2) station config + routing. As with the zone/placement blocks above, each `it` only
// proves the code is REGISTERED with the right param SHAPE — the construction typechecks solely
// because errors.ts's `declare module` augmentation is loaded (the side-effect import above). The real
// throwers are kitchen.ts's config verbs (name_taken/not_found) and — from Task 3 — the fire-time
// station resolver (no_default). Each param NAME follows a shipped sibling so the family stays uniform:
// `name` mirrors zone.name_taken/table.label_taken; `stationId` the qualified domain-record not_found
// family (table.not_found's `tableId`, zone.not_found's `zoneId`); `locationId` the venue's own id.
describe("the station error codes carry their declared params", () => {
  it("constructs station.name_taken with the operator-supplied name, matching zone.name_taken's shape", () => {
    const error = new AppError("station.name_taken", { name: "Cocina" });
    expect(error.code).toBe("station.name_taken");
    expect(error.params).toEqual({ name: "Cocina" });
  });

  it("constructs station.not_found with the qualified stationId, matching zone.not_found's shape", () => {
    const stationId = "22222222-2222-2222-2222-222222222222";
    const error = new AppError("station.not_found", { stationId });
    expect(error.code).toBe("station.not_found");
    expect(error.params).toEqual({ stationId });
  });

  it("constructs station.no_default naming the misconfigured location", () => {
    const locationId = "33333333-3333-3333-3333-333333333333";
    const error = new AppError("station.no_default", { locationId });
    expect(error.code).toBe("station.no_default");
    expect(error.params).toEqual({ locationId });
  });
});
