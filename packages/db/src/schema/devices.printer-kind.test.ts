import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError } from "../testing/errors.js";
import { insertA4Printer } from "../testing/printers.js";
import { seedDeviceProfiles } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { devices } from "./devices.js";
import { printers } from "./printers.js";

const REFUSAL = "a receipt, slip or drawer printer must be a receipt printer";

describe("device printer kinds", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let profileId: string;
  let officeId: string;

  beforeEach(async () => {
    const [profile] = await seedDeviceProfiles(suite.db, { name: "Till", formFactor: "till" });
    profileId = profile!.id;
    officeId = await insertA4Printer(suite.db);
  });

  function till() {
    return { id: "till", deviceProfileId: profileId, label: "Till", tokenHash: "test-hash" };
  }

  it.each(["receiptPrinterId", "paymentSlipPrinterId", "cashDrawerPrinterId"] as const)(
    "refuses an office printer on insert and update of %s",
    async (column) => {
      const insertError = await captureError(() =>
        suite.db.insert(devices).values({ ...till(), [column]: officeId }),
      );
      expect(triggerRaised(insertError, REFUSAL)).toBe(true);

      await suite.db.insert(devices).values(till());
      const updateError = await captureError(() =>
        suite.db
          .update(devices)
          .set({ [column]: officeId })
          .where(eq(devices.id, "till")),
      );
      expect(triggerRaised(updateError, REFUSAL)).toBe(true);
    },
  );

  it("keeps the office invoice choice and the receipt choices when renaming a till", async () => {
    const [receipt] = await suite.db
      .insert(printers)
      .values({ name: "Receipt printer", transport: "network_tcp", host: "10.0.0.2" })
      .returning({ id: printers.id });
    const receiptId = receipt!.id;
    const choices = {
      invoicePrinterId: officeId,
      receiptPrinterId: receiptId,
      paymentSlipPrinterId: receiptId,
      cashDrawerPrinterId: receiptId,
    };
    await suite.db.insert(devices).values({ ...till(), ...choices });
    await suite.db.update(devices).set({ label: "Front till" }).where(eq(devices.id, "till"));

    const [device] = await suite.db.select().from(devices).where(eq(devices.id, "till"));
    expect(device).toMatchObject({ label: "Front till", ...choices });
  });
});
