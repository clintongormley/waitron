import { describe, expect, it } from "vitest";
import { bindingFkField } from "./device.js";
import "./errors.js";

// Pure unit tests — no database. The binding rules themselves are proven against real Postgres in
// device.pg.test.ts, and the two FK translations end-to-end in device-api.pg.test.ts; this file covers
// the crafted-error branches a DB cannot reach.

describe("bindingFkField", () => {
  // The 23503 → field accessor, exercised with CRAFTED errors (no DB) so every branch is covered: the
  // `tables.ts` `isZoneFkViolation` idiom. The end-to-end 23503 translation is proven against real
  // Postgres in device-api.pg.test.ts; here we pin the table+columns mapping and the deliberate
  // NON-matches (another column of the same table, the same column on another table, a different
  // SQLSTATE, a refusal naming no key).
  //
  // A crafted error carries the three fields `refusalOn` reads off one layer — `code`, `table` and
  // `detail`'s `Key (…)=(…)` clause. That this is the real drivers' shape is pinned in
  // packages/db/src/constraint-target.test.ts.
  const fk = (table: string, column: string): Error =>
    Object.assign(new Error("fk"), {
      code: "23503",
      table,
      detail: `Key (${column})=(0f9e) is not present in table "other".`,
    });

  it("maps the device binding FKs' table and column to their input fields", () => {
    // The device-binding FKs on the `devices` table: `devices_device_profile_fk (device_profile_id)`
    // (a reassign to a profile that names no row → `deviceProfileId`, the assign-device-profile route)
    // and `devices_receipt_printer_fk (receipt_printer_id)` (a hardware PATCH naming no such printer →
    // `receiptPrinterId`). Only `devices` carries a binding FK, so these are the only two.
    expect(bindingFkField(fk("devices", "device_profile_id"))).toBe("deviceProfileId");
    expect(bindingFkField(fk("devices", "receipt_printer_id"))).toBe("receiptPrinterId");
  });

  it("returns undefined for a target the list does not name — both near-misses included", () => {
    // The list keys on the table AND the column, so a 23503 on any other key rethrows raw rather than
    // being mislabelled `device.binding_invalid`. One near-miss per half. The COLUMN half: two more
    // FK columns of `devices` itself. The TABLE half: `devices` is the only table carrying a
    // `device_profile_id` today, so that case is crafted from a table that does not carry one — it
    // exists to pin that the table is compared at all, not just the column.
    expect(bindingFkField(fk("devices", "station_id"))).toBeUndefined();
    expect(bindingFkField(fk("devices", "till_id"))).toBeUndefined();
    expect(bindingFkField(fk("join_requests", "device_profile_id"))).toBeUndefined();
    expect(bindingFkField(fk("device_profiles", "canvas_id"))).toBeUndefined();
  });

  it("finds the 23503 wrapped in a DrizzleQueryError-style cause chain", () => {
    const wrapped = new Error("outer", {
      cause: new Error("mid", { cause: fk("devices", "device_profile_id") }),
    });
    expect(bindingFkField(wrapped)).toBe("deviceProfileId");
  });

  it("returns undefined for a 23503 on a NON-binding constraint (rethrown raw, not mislabelled)", () => {
    // A 23503 on the direct location FK is not a binding fault — the catch rethrows it raw.
    expect(bindingFkField(fk("devices", "location_id"))).toBeUndefined();
  });

  it("returns undefined for a 23503 that names no key at all", () => {
    expect(bindingFkField(Object.assign(new Error("fk"), { code: "23503" }))).toBeUndefined();
  });

  it("returns undefined for a non-23503 error, a self-referential cause loop, and nullish input", () => {
    // The SQLSTATE half is checked as well as the target: a 23505 naming a binding table and column is
    // still not a binding-FK fault, so it rethrows raw.
    expect(
      bindingFkField(
        Object.assign(new Error("dup"), {
          code: "23505",
          table: "devices",
          detail: "Key (device_profile_id)=(0f9e) already exists.",
        }),
      ),
    ).toBeUndefined();
    const looped: { code?: string; cause?: unknown } = {};
    looped.cause = looped; // a self-referential cause must not spin forever
    expect(bindingFkField(looped)).toBeUndefined();
    expect(bindingFkField(null)).toBeUndefined();
    expect(bindingFkField(undefined)).toBeUndefined();
  });
});
