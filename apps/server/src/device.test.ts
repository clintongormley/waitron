import { describe, expect, it } from "vitest";
import { bindingFkField } from "./device.js";
import "./errors.js";

// Pure unit tests — no database. The binding rules themselves are proven against real Postgres in
// device.pg.test.ts; this file covers the crafted-error branches a DB cannot reach.

describe("bindingFkField", () => {
  // The 23503 → field accessor, exercised with CRAFTED errors (no DB) so every branch is covered: the
  // `tables.ts` `isZoneFkViolation` / `uniqueViolationConstraint` idiom. The end-to-end 23503 translation
  // is proven against real Postgres in device.pg.test.ts; here we pin the constraint-name mapping and
  // the deliberate NON-matches (a different constraint, a different SQLSTATE, no constraint name).
  const fk = (constraint: string): Error =>
    Object.assign(new Error("fk"), { code: "23503", constraint });

  it("maps the device binding composite FKs' constraint names to their input fields", () => {
    // The device-binding composite FKs on the `devices` table: `devices_device_profile_fk` (a reassign
    // to a profile that names no row of this tenant → `deviceProfileId`, the assign-device-profile route)
    // and `devices_receipt_printer_fk` (a hardware PATCH naming a printer of no such tenant row →
    // `receiptPrinterId`). Only `devices` carries a binding FK, so these are the only two.
    expect(bindingFkField(fk("devices_device_profile_fk"))).toBe("deviceProfileId");
    expect(bindingFkField(fk("devices_receipt_printer_fk"))).toBe("receiptPrinterId");
  });

  it("returns undefined for a constraint the map does not name — a near-miss included", () => {
    // The map keys on the CONSTRAINT NAME, so a 23503 on any other FK rethrows raw rather than being
    // mislabelled `device.binding_invalid`. `devices_canvas_fk` is the near-miss worth pinning: it is a
    // `devices_*` name the Task 10 cutover removed, and a prefix match would wrongly claim it.
    expect(bindingFkField(fk("devices_canvas_fk"))).toBeUndefined();
    expect(bindingFkField(fk("devices_station_fk"))).toBeUndefined();
  });

  it("finds the 23503 wrapped in a DrizzleQueryError-style cause chain", () => {
    const wrapped = new Error("outer", {
      cause: new Error("mid", { cause: fk("devices_device_profile_fk") }),
    });
    expect(bindingFkField(wrapped)).toBe("deviceProfileId");
  });

  it("returns undefined for a 23503 on a NON-binding constraint (rethrown raw, not mislabelled)", () => {
    // A 23503 on the direct tenant/location FKs is not a binding fault — the catch rethrows it raw.
    expect(bindingFkField(fk("devices_location_id_locations_id_fk"))).toBeUndefined();
  });

  it("returns undefined when the 23503 carries no constraint name (PGlite may omit it)", () => {
    expect(bindingFkField(Object.assign(new Error("fk"), { code: "23503" }))).toBeUndefined();
  });

  it("returns undefined for a non-23503 error, a self-referential cause loop, and nullish input", () => {
    expect(bindingFkField(Object.assign(new Error("dup"), { code: "23505" }))).toBeUndefined();
    const looped: { code?: string; cause?: unknown } = {};
    looped.cause = looped; // a self-referential cause must not spin forever
    expect(bindingFkField(looped)).toBeUndefined();
    expect(bindingFkField(null)).toBeUndefined();
    expect(bindingFkField(undefined)).toBeUndefined();
  });
});
