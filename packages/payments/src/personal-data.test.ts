import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedDevice, seedPerson, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import * as paymentsModule from "./index.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { payments } from "./schema/payments.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const AT = "2026-11-02T10:00:00.000Z";
const EARLIER = "2026-11-02T09:30:00.000Z";

describe("payment hold decisions in a personal-data download", () => {
  it("exports only decisions made by the subject, without notes or internal references", async () => {
    const db = suite.db;
    const manager = await seedPerson(db, { displayName: "Manager" });
    const colleague = await seedPerson(db, { displayName: "Colleague" });
    await seedVenue(db);
    const { deviceId } = await seedDevice(db);
    const first = await seedWorkingOrder(db, { orderNumber: 41 });
    const second = await seedWorkingOrder(db, { orderNumber: 42 });
    const hold = {
      workingOrderId: first.id,
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
        {
          ...hold,
          workingOrderId: second.id,
          paymentRef: "private-4",
          holdDecidedBy: manager,
          holdDecidedAt: EARLIER,
          holdOutcome: "refunded_at_provider",
        },
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
    const managerFiles = await download(manager);
    expect(managerFiles.map((file) => file.name)).toEqual(["payment-holds.json"]);
    expect(JSON.parse(managerFiles[0]!.content as string)).toEqual({
      entries: [
        { order: 42, decision: "refunded_at_provider", at: EARLIER },
        { order: 41, decision: "kept", at: AT },
      ],
    });
    const colleagueFiles = await download(colleague);
    expect(colleagueFiles.map((file) => file.name)).toEqual(["payment-holds.json"]);
    expect(JSON.parse(colleagueFiles[0]!.content as string)).toEqual({
      entries: [{ order: 41, decision: "refunded_at_provider", at: AT }],
    });
    expect(await download("nobody")).toEqual([]);
  });
});
