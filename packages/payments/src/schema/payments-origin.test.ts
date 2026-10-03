import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  NOT_NULL_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { freshNif, seedWorkingOrder } from "../../test/seed.js";
import { payments } from "./payments.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

async function insertPayment(source: string | null, deviceId: string | null, ref: string) {
  const { workingOrderId } = await seedWorkingOrder(suite.db, freshNif());
  return suite.db.insert(payments).values({
    workingOrderId,
    source: source as "device",
    deviceId,
    provider: "simulator",
    paymentRef: ref,
    amount: 1000,
    state: "captured",
  });
}

describe("payments — the device that started it", () => {
  it("refuses a payment checked by a background job", async () => {
    const error = await captureError(() => insertPayment("payment_check", null, "pay_job"));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: payments_source_ck");
  });

  it("refuses a device source with no device", async () => {
    const error = await captureError(() => insertPayment("device", null, "pay_no_device"));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: payments_source_device_ck");
  });

  it("refuses a payment with no source", async () => {
    const error = await captureError(() => insertPayment(null, null, "pay_no_source"));
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("NOT NULL constraint failed: payments.source");
  });

  it("accepts a payment started on a device", async () => {
    const { workingOrderId, deviceId } = await seedWorkingOrder(suite.db, freshNif());
    const [row] = await suite.db
      .insert(payments)
      .values({
        workingOrderId,
        source: "device",
        deviceId,
        provider: "simulator",
        paymentRef: "pay_device",
        amount: 1000,
        state: "captured",
      })
      .returning({ source: payments.source, deviceId: payments.deviceId });
    expect(row).toEqual({ source: "device", deviceId });
  });
});
