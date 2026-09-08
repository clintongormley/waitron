import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bindingFkField, encodePairingCode, normalizePairingCode } from "./device.js";
import "./errors.js";

// Pure unit tests — no database. generatePairingCode's own round-trip/TTL/collision coverage was
// dropped with the pairing-code enrolment flow (join-and-accept replaces it, apps/server/src/testing/
// enrol.ts); generatePairingCode itself is untouched here and still exercised via device-api.pg.test.ts
// until Task 7 deletes the pairing-code routes and verbs together.

describe("normalizePairingCode", () => {
  it("is the identity on any code the encoder emits (round-trip)", () => {
    // A code the operator typed exactly as shown must survive normalization unchanged — so redemption of
    // the canonical string is never altered. Every encoder output is uppercase, alphabet-only and
    // separator-free, i.e. already canonical.
    for (const bytes of [
      Buffer.from([0, 0, 0, 0, 0]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89]),
      randomBytes(5),
      randomBytes(5),
    ]) {
      const canonical = encodePairingCode(bytes);
      expect(normalizePairingCode(canonical)).toBe(canonical);
    }
  });

  it("is lenient about case, the ambiguous letters I/L/O, spaces and hyphens", () => {
    // INJECTIVITY: the Crockford alphabet excludes I, L, O and U, so mapping I/L → 1 and O → 0 only ever
    // rewrites a character the encoder NEVER emits. It therefore cannot merge two distinct real codes —
    // leniency here is not a security regression.
    expect(normalizePairingCode("abcdefgh")).toBe("ABCDEFGH"); // case
    expect(normalizePairingCode("O0O0O0O0")).toBe("00000000"); // O → 0
    expect(normalizePairingCode("ILILILIL")).toBe("11111111"); // I / L → 1
    expect(normalizePairingCode("ilILoO09")).toBe("11110009"); // mixed, all lenient rules at once
    expect(normalizePairingCode("ABCD-EFGH")).toBe("ABCDEFGH"); // hyphen stripped
    expect(normalizePairingCode("ABCD EFGH")).toBe("ABCDEFGH"); // space stripped
    expect(normalizePairingCode("  ab-cd ef-gh ")).toBe("ABCDEFGH"); // combined
  });
});

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
    // `receiptPrinterId`). Since Task 6 the pairing code carries no bindings, so these are the only two.
    expect(bindingFkField(fk("devices_device_profile_fk"))).toBe("deviceProfileId");
    expect(bindingFkField(fk("devices_receipt_printer_fk"))).toBe("receiptPrinterId");
  });

  it("returns undefined for the dropped pairing-code composite FKs (bindings gone, Tasks 4/6)", () => {
    // The pairing code's former mint-time FKs (till / receipt printer / device profile) went with the
    // columns, so a 23503 naming one no longer maps to a field — it would rethrow raw.
    expect(bindingFkField(fk("device_pairing_codes_till_fk"))).toBeUndefined();
    expect(bindingFkField(fk("device_pairing_codes_receipt_printer_fk"))).toBeUndefined();
    expect(bindingFkField(fk("device_pairing_codes_device_profile_fk"))).toBeUndefined();
  });

  it("returns undefined for the dropped device→canvas composite FKs (Task 10 cutover)", () => {
    // The direct device→canvas binding (and its `assign-canvas` route) was removed in the Task 10 cutover,
    // so the old constraint names no longer map to a field — a 23503 on one would rethrow raw. (A bad
    // profile canvas reference is now `device_profile.invalid`, translated in the device-profile store.)
    expect(bindingFkField(fk("device_pairing_codes_canvas_fk"))).toBeUndefined();
    expect(bindingFkField(fk("devices_canvas_fk"))).toBeUndefined();
  });

  it("finds the 23503 wrapped in a DrizzleQueryError-style cause chain", () => {
    const wrapped = new Error("outer", {
      cause: new Error("mid", { cause: fk("devices_device_profile_fk") }),
    });
    expect(bindingFkField(wrapped)).toBe("deviceProfileId");
  });

  it("returns undefined for a 23503 on a NON-binding constraint (rethrown raw, not mislabelled)", () => {
    // A 23503 on the direct tenant/location FKs is not a binding fault — the catch rethrows it raw.
    expect(bindingFkField(fk("device_pairing_codes_location_id_locations_id_fk"))).toBeUndefined();
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
