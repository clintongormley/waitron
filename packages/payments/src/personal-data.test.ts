import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import { seedWorkingOrder } from "../test/seed.js";
import * as paymentsModule from "./index.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { payments } from "./schema/payments.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const AT = "2026-11-02T10:00:00.000Z";

describe("payment hold decisions in a personal-data download", () => {
  it("exports only decisions made by the subject, without notes or internal references", async () => {
    const db = suite.db;
    const manager = await seedPerson(db, { displayName: "Manager" });
    const colleague = await seedPerson(db, { displayName: "Colleague" });
    const { workingOrderId, deviceId } = await seedWorkingOrder(db);
    const orders = await db.query.workingOrders.findMany();
    expect(orders.map((order) => order.id)).toEqual([workingOrderId]);
    const hold = {
      workingOrderId,
      deviceId,
      source: "device",
      provider: "stripe",
      amount: 1234,
      state: "captured",
      heldAt: "2026-11-02T09:00:00.000Z",
      holdProviderAmount: 1200,
    } as const;
    await withTransaction(db, async (tx) => {
      await tx.insert(payments).values([
        {
          ...hold,
          paymentRef: "private-1",
          holdDecidedBy: manager,
          holdDecidedAt: AT,
          holdOutcome: "kept",
          holdNote: "Manager's private note",
        },
        {
          ...hold,
          paymentRef: "private-2",
          holdDecidedBy: colleague,
          holdDecidedAt: AT,
          holdOutcome: "refunded_at_provider",
          holdNote: "Colleague's private note",
        },
        { ...hold, paymentRef: "private-3", requestedBy: manager },
      ]);
    });
    const part = paymentsModule.PAYMENTS_PERSONAL_DATA;
    expect(part?.files).toEqual(["payment-holds.json"]);
    const download = async (personId: string) => {
      const build = await db.withWriteLock(() =>
        part.prepare(db, { personId, language: "en", at: new Date(AT), timeZone: "UTC" }),
      );
      return build();
    };
    for (const [person, decision] of [
      [manager, "kept"],
      [colleague, "refunded_at_provider"],
    ] as const) {
      const files = await download(person);
      expect(files.map((file) => file.name)).toEqual(["payment-holds.json"]);
      expect(JSON.parse(files[0]!.content as string)).toEqual({
        entries: [{ order: orders[0]!.orderNumber, decision, at: AT }],
      });
    }
    expect(await download("nobody")).toEqual([]);
  });
});
