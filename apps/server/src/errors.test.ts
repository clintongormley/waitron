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

// KDS-1 (Task 3) the per-line ticket-item advance surface. As with the blocks above, this only proves
// the code is REGISTERED with the right param SHAPE — the construction typechecks solely because
// errors.ts's `declare module` augmentation is loaded (the side-effect import above). The real thrower is
// Task 4's `advanceTicketItem` (an illegal bump — a skip, a repeat, or backwards). `ticketItemId` names
// the affected ticket item's own id, qualified like the domain-record family (`station.not_found`'s
// `stationId`), NOT the order — a ticket item advances per line, so the id that failed IS the line's.
describe("the ticket error code carries its declared params", () => {
  it("constructs ticket.invalid_transition with the qualified ticketItemId", () => {
    const ticketItemId = "44444444-4444-4444-4444-444444444444";
    const error = new AppError("ticket.invalid_transition", { ticketItemId });
    expect(error.code).toBe("ticket.invalid_transition");
    expect(error.params).toEqual({ ticketItemId });
  });
});

// KDS-2 (Task 2) courses + hold-and-fire. As with every block above, each `it` only proves the code
// is REGISTERED with the right param SHAPE — the construction typechecks solely because errors.ts's
// `declare module` augmentation is loaded (the side-effect import above), so the fail-first signal for
// these registration tests is `tsc --noEmit`, not the runtime run (AppError does no runtime validation
// of the code). The real throwers arrive in later KDS-2 tasks: the course config verbs
// (name_taken/not_found) and `advanceTicketItem`'s new held-line gate (item_held). Each param NAME
// follows a shipped sibling so the family stays uniform: `name` mirrors station.name_taken/
// zone.name_taken; `courseId` the qualified domain-record not_found family (station.not_found's
// `stationId`, zone.not_found's `zoneId`); `ticketItemId` mirrors ticket.invalid_transition — a ticket
// item advances (or is held) per line, so the id is the line's ticket item, not the order.
describe("the course error codes carry their declared params", () => {
  it("constructs course.name_taken with the operator-supplied name, matching station.name_taken's shape", () => {
    const error = new AppError("course.name_taken", { name: "Entrantes" });
    expect(error.code).toBe("course.name_taken");
    expect(error.params).toEqual({ name: "Entrantes" });
  });

  it("constructs course.not_found with the qualified courseId, matching station.not_found's shape", () => {
    const courseId = "55555555-5555-5555-5555-555555555555";
    const error = new AppError("course.not_found", { courseId });
    expect(error.code).toBe("course.not_found");
    expect(error.params).toEqual({ courseId });
  });
});

// KDS-2 (Task 2) the held-line refusal on the per-line advance surface. Same registration-only proof
// as the block above (typecheck-gated). The real thrower is a later task's `advanceTicketItem`, whose
// new `fired_at IS NOT NULL` gate refuses a bump of a line still HELD (a later course not yet fired).
// `ticketItemId` mirrors ticket.invalid_transition — the same per-line ticket item, not the order.
describe("the held-ticket error code carries its declared params", () => {
  it("constructs ticket.item_held with the qualified ticketItemId, matching ticket.invalid_transition's shape", () => {
    const ticketItemId = "66666666-6666-6666-6666-666666666666";
    const error = new AppError("ticket.item_held", { ticketItemId });
    expect(error.code).toBe("ticket.item_held");
    expect(error.params).toEqual({ ticketItemId });
  });
});

// device-identity-1 (Task 2) station enrolment + device authentication. As with every block above,
// each `it` only proves the code is REGISTERED with the right param SHAPE — the construction
// typechecks solely because errors.ts's `declare module` augmentation is loaded (the side-effect
// import above), so the fail-first signal for these registration tests is `tsc --noEmit`, NOT the
// runtime run (AppError does no runtime validation of the code, so `new AppError("device.unauthorized",
// {})` would run green even with the code undeclared). The real throwers arrive in later tasks: the
// enrol verb (pairing_invalid/pairing_expired, T3), `requireDevice` (unauthorized, T4), and the
// device-scoped advance + management routes (forbidden_station/not_found, T5). The two no-param codes
// carry `Record<string, never>` — a pairing code and the device cookie are bearer SECRETS never echoed
// (the no-leak discipline, CLAUDE.md §1); `stationId`/`deviceId` follow the qualified domain-record
// family (station.not_found's `stationId`). The HTTP statuses (401/403/400/400/404) are NOT here — they
// live in device-api.ts's local STATUS map (Task 5), the same declare-here / status-in-route split the
// station.*/course.* codes above follow.
describe("the device error codes carry their declared params", () => {
  it("constructs device.unauthorized with no params (a bearer device cookie is never echoed)", () => {
    const error = new AppError("device.unauthorized", {});
    expect(error.code).toBe("device.unauthorized");
    expect(error.params).toEqual({});
  });

  it("constructs device.forbidden_station naming the item's station, matching station.not_found's shape", () => {
    const stationId = "77777777-7777-7777-7777-777777777777";
    const error = new AppError("device.forbidden_station", { stationId });
    expect(error.code).toBe("device.forbidden_station");
    expect(error.params).toEqual({ stationId });
  });

  it("constructs device.pairing_invalid with no params (a pairing code is never echoed)", () => {
    const error = new AppError("device.pairing_invalid", {});
    expect(error.code).toBe("device.pairing_invalid");
    expect(error.params).toEqual({});
  });

  it("constructs device.pairing_expired with no params (a pairing code is never echoed)", () => {
    const error = new AppError("device.pairing_expired", {});
    expect(error.code).toBe("device.pairing_expired");
    expect(error.params).toEqual({});
  });

  it("constructs device.not_found with the qualified deviceId, matching station.not_found's shape", () => {
    const deviceId = "88888888-8888-8888-8888-888888888888";
    const error = new AppError("device.not_found", { deviceId });
    expect(error.code).toBe("device.not_found");
    expect(error.params).toEqual({ deviceId });
  });
});
