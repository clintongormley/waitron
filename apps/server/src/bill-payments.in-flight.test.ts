import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { billPayments, newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { readBillEditState } from "./bill-editing.js";
import { billPaymentIsLive, takeReaderBillPayment } from "./bill-payments.js";
import { createDiskFullState, type DiskFullState } from "./disk-full-state.js";
import { setupPartyVenue, seat, order, type PartyVenue } from "./testing/party-venue.js";
import { openTillSession } from "./testing/session-device.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, billId: string, collector: { personId: string; sessionId: string };
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [worker] = await suite.db
    .insert(persons)
    .values({ displayName: "Collector", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
  collector = {
    personId: worker!.id,
    sessionId: await openTillSession(suite.db, {
      deviceId: v.cfg.origin.deviceId,
      personId: worker!.id,
    }),
  };
  ({ tabId: billId } = await seat(v, await v.table("In flight")));
  await order(v, billId, "Burger");
});

const nothingNoted = (): DiskFullState =>
  createDiskFullState({
    dir: "/nonexistent",
    now: () => new Date(),
    log: () => {},
    statfs: () => Promise.reject(new Error("nothing noted: free space is not read")),
  });

describe("where a bill's card registers itself as in flight", () => {
  it.each([
    { label: "with no full-disk state", disk: (): DiskFullState | undefined => undefined },
    { label: "with a full-disk state that has nothing noted", disk: nothingNoted },
  ])(
    "$label: the card's first transaction registers it before any later transaction runs (database-level probe: relies on the queue running the payment's first transaction first)",
    async ({ disk }) => {
      const expectedEdit = await withTransaction(suite.db, (tx) => readBillEditState(tx, billId));
      const reader = new FakePaymentProvider(suite.db);
      const release = reader.holdNextCollect();
      let paying: ReturnType<typeof takeReaderBillPayment> | undefined;
      let live: boolean | undefined;
      try {
        paying = takeReaderBillPayment(
          { db: suite.db, backend: v.backend, clock: v.clock, provider: reader, disk: disk() },
          v.cfg,
          billId,
          {
            submissionId: newId(),
            kind: "contribution",
            amount: "1.00",
            method: "card",
            entry: "reader",
            applied: "1.00",
            tip: "0.00",
            expectedEdit,
          },
          collector,
        );
        live = await withTransaction(suite.db, async (tx) => {
          const rows = await tx
            .select({ id: billPayments.id })
            .from(billPayments)
            .where(eq(billPayments.workingOrderId, billId));
          return rows.length === 1 && billPaymentIsLive(suite.db, rows[0]!.id);
        });
      } finally {
        release();
      }
      const paid = await paying;

      expect(live).toBe(true);
      expect(paid.payment.state).toBe("received");
    },
  );
});
