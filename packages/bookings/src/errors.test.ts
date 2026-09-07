// The four booking.* codes are REGISTERED with the right param SHAPE. Each `it` typechecks solely
// because errors.ts's `declare module` augmentation is loaded (the side-effect import below), so the
// fail-first signal for these registration tests is `tsc --noEmit`, NOT the runtime run — AppError does
// no runtime validation of the code, so `new AppError("booking.not_found", {})` would run green even
// with the code undeclared. The verbs are the real throwers; the HTTP statuses live in routes.ts's
// STATUS map. Relocated verbatim from apps/server/src/errors.test.ts when the codes became the module's.
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

describe("the booking error codes carry their declared params", () => {
  it("constructs booking.not_found with the qualified bookingId, matching table.not_found's shape", () => {
    const bookingId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const error = new AppError("booking.not_found", { bookingId });
    expect(error.code).toBe("booking.not_found");
    expect(error.params).toEqual({ bookingId });
  });

  it("constructs booking.invalid echoing the offending party size, matching tab.transfer_quantity_invalid's echo shape", () => {
    const error = new AppError("booking.invalid", { partySize: 0 });
    expect(error.code).toBe("booking.invalid");
    expect(error.params).toEqual({ partySize: 0 });
  });

  it("constructs booking.invalid_transition with the qualified bookingId, matching ticket.invalid_transition's shape", () => {
    const bookingId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const error = new AppError("booking.invalid_transition", { bookingId });
    expect(error.code).toBe("booking.invalid_transition");
    expect(error.params).toEqual({ bookingId });
  });

  it("constructs booking.table_required with no params (the seat request identifies the booking)", () => {
    const error = new AppError("booking.table_required", {});
    expect(error.code).toBe("booking.table_required");
    expect(error.params).toEqual({});
  });
});
