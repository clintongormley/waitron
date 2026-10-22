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

describe("a bill's card when a transaction ahead in the write queue notes a full disk", () => {
  /** A real state with nothing noted; a free-space read would find room and clear any refusal. */
  const roomyState = (): DiskFullState =>
    createDiskFullState({
      dir: "/unused",
      now: () => new Date(),
      log: () => {},
      statfs: () => Promise.resolve({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 }),
    });

  /** Holds the write queue until the returned `release`, then runs `inside` in that transaction. */
  function holdQueue(inside: () => void) {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const held = withTransaction(suite.db, async () => {
      await gate;
      inside();
    });
    return async () => {
      open();
      await held;
    };
  }

  async function payBehind(inside: (disk: DiskFullState) => void) {
    const expectedEdit = await withTransaction(suite.db, (tx) => readBillEditState(tx, billId));
    const reader = new FakePaymentProvider(suite.db);
    const disk = roomyState();
    const release = holdQueue(() => inside(disk));
    const paying = takeReaderBillPayment(
      { db: suite.db, backend: v.backend, clock: v.clock, provider: reader, disk },
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
    ).then(
      (paid) => ({ paid }),
      (error: unknown) => ({ error }),
    );
    await release();
    return { result: await paying, reader };
  }

  const paymentsOfBill = () =>
    withTransaction(suite.db, (tx) =>
      tx
        .select({ state: billPayments.state })
        .from(billPayments)
        .where(eq(billPayments.workingOrderId, billId)),
    );

  it("refuses with storage.disk_full inside the first transaction, asking no reader and writing no payment", async () => {
    const { result, reader } = await payBehind((disk) => disk.noteRefused());

    expect(result).toMatchObject({ error: { code: "storage.disk_full" } });
    expect(reader.collectCalls.length).toBe(0);
    expect(await paymentsOfBill()).toEqual([]);
  });

  it("asks the reader when the transaction ahead notes nothing", async () => {
    const { result, reader } = await payBehind(() => {});

    expect(result).toMatchObject({ paid: { payment: { state: "received" } } });
    expect(reader.collectCalls.length).toBe(1);
  });
});
