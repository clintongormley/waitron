import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  requireBodyUuid,
  requireEnum,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireString,
  requireUuidParam,
} from "./request-screens.js";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** The code an AppError thrown by `fn` carries, or the thrown value if it was not an AppError. */
function codeOfThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return isAppError(error) ? error.code : error;
  }
  throw new Error("expected a throw");
}

describe("requireUuidParam (branded-id screen → shared.invalid_id)", () => {
  it("returns a well-formed UUID unchanged", () => {
    expect(requireUuidParam(UUID, "tillId")).toBe(UUID);
  });
  it("throws shared.invalid_id for a malformed id", () => {
    expect(codeOfThrow(() => requireUuidParam("not-a-uuid", "tillId"))).toBe("shared.invalid_id");
  });
});

describe("requirePeriod (YYYY-MM-DD calendar-day screen → management.request_invalid)", () => {
  it("returns a real calendar day unchanged", () => {
    expect(requirePeriod("2026-02-28", "period")).toBe("2026-02-28");
  });
  it("rejects a non-string", () => {
    expect(codeOfThrow(() => requirePeriod(20260228, "period"))).toBe("management.request_invalid");
  });
  it("rejects a wrongly-shaped string", () => {
    expect(codeOfThrow(() => requirePeriod("2026-2-8", "period"))).toBe(
      "management.request_invalid",
    );
  });
  it("rejects an impossible day the regex admits", () => {
    // `2026-02-30` matches the shape but is not a real day — the Date round-trip catches it.
    expect(codeOfThrow(() => requirePeriod("2026-02-30", "period"))).toBe(
      "management.request_invalid",
    );
  });
});

describe("requireBodyUuid (body UUID → management.request_invalid)", () => {
  it("returns a well-formed UUID unchanged", () => {
    expect(requireBodyUuid(UUID, "workingOrderId")).toBe(UUID);
  });
  it("rejects a non-string", () => {
    expect(codeOfThrow(() => requireBodyUuid(42, "workingOrderId"))).toBe(
      "management.request_invalid",
    );
  });
  it("rejects a malformed string", () => {
    expect(codeOfThrow(() => requireBodyUuid("nope", "workingOrderId"))).toBe(
      "management.request_invalid",
    );
  });
});

describe("requireNullableBodyUuid", () => {
  it("passes null through", () => {
    expect(requireNullableBodyUuid(null, "toShiftId")).toBeNull();
  });
  it("returns a well-formed UUID unchanged", () => {
    expect(requireNullableBodyUuid(UUID, "toShiftId")).toBe(UUID);
  });
  it("rejects a malformed non-null value", () => {
    expect(codeOfThrow(() => requireNullableBodyUuid("nope", "toShiftId"))).toBe(
      "management.request_invalid",
    );
  });
});

describe("requireString", () => {
  it("returns a string unchanged", () => {
    expect(requireString("hello", "note")).toBe("hello");
  });
  it("rejects a non-string", () => {
    expect(codeOfThrow(() => requireString(null, "note"))).toBe("management.request_invalid");
  });
});

describe("requireNullableString", () => {
  it("passes null through", () => {
    expect(requireNullableString(null, "note")).toBeNull();
  });
  it("returns a string unchanged", () => {
    expect(requireNullableString("hello", "note")).toBe("hello");
  });
  it("rejects a non-null non-string", () => {
    expect(codeOfThrow(() => requireNullableString(7, "note"))).toBe("management.request_invalid");
  });
});

describe("requireEnum", () => {
  const ROLES = ["cook", "waiter"] as const;
  it("narrows a valid member", () => {
    expect(requireEnum("cook", "role", ROLES)).toBe("cook");
  });
  it("rejects a non-string", () => {
    expect(codeOfThrow(() => requireEnum(1, "role", ROLES))).toBe("management.request_invalid");
  });
  it("rejects a valid-looking but unknown string", () => {
    expect(codeOfThrow(() => requireEnum("manager", "role", ROLES))).toBe(
      "management.request_invalid",
    );
  });
});
