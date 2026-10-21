import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { createDiskFullState, type DiskFullState } from "./disk-full-state.js";
import {
  paymentRows,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import type { Logger } from "./logger.js";
import "./errors.js";

// Every payment here is a part payment of a 35.00 Paella bill, so no case records a sale: the
// database never holds a record dated after the 28-10-2024 control.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

const quiet = () => {};

function diskState(free: { bytes: number }): DiskFullState {
  return createDiskFullState({
    dir: "/unused",
    now: () => new Date(),
    log: quiet,
    statfs: () => Promise.resolve({ bavail: free.bytes, frsize: 1 }),
  });
}

function clockAt(iso: string): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(iso), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

const readerPart = (submissionId = randomUUID()) => ({
  submissionId,
  kind: "contribution",
  amount: "10.00",
  method: "card",
  entry: "reader",
  applied: "10.00",
  tip: "0.00",
});

const cashPart = () => ({
  submissionId: randomUUID(),
  kind: "contribution",
  amount: "10.00",
  method: "cash",
  tendered: "10.00",
  applied: "10.00",
  tip: "0.00",
});

const manualCardPart = () => ({
  submissionId: randomUUID(),
  kind: "contribution",
  amount: "10.00",
  method: "card",
  entry: "manual",
  externalRef: `OP-${randomUUID().slice(0, 8)}`,
  applied: "10.00",
  tip: "0.00",
});

function pay(
  billId: string,
  body: Record<string, unknown>,
  opts: { clock?: TrustedClock; disk?: DiskFullState; log?: Logger } = {},
) {
  return send(
    venue.appWith(opts),
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    body,
  );
}

const paella = () => tabWith(venue, "Paella");
const collects = () => venue.card.collectCalls.length;

describe("bill payments under a clock before 28-10-2024", () => {
  it("takes a reader payment at 00:00 local on 28-10-2024, and refuses one a millisecond earlier", async () => {
    const before = collects();

    const early = await paella();
    const refused = await pay(early, readerPart(), {
      clock: clockAt("2024-10-27T22:59:59.999Z"),
    });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({
      code: "clock.unusable",
      params: { clockAt: "2024-10-27T22:59:59.999Z", offsetMinutes: 60 },
    });
    expect(collects()).toBe(before);

    const billId = await paella();
    const taken = await pay(billId, readerPart(), { clock: clockAt("2024-10-27T23:00:00.000Z") });
    expect(taken.status).toBe(200);
    expect(taken.json.outcome).toBe("received");
    expect(collects()).toBe(before + 1);
  });

  it("refuses a reader payment under a clock in 2001, before the reader", async () => {
    const billId = await paella();
    const before = collects();

    const answer = await pay(billId, readerPart(), { clock: clockAt("2001-01-01T11:00:00.000Z") });

    expect(answer.status).toBe(409);
    expect(answer.json).toEqual({
      code: "clock.unusable",
      params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
    });
    expect(collects()).toBe(before);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  it("refuses a cash part payment and a manual card under such a clock", async () => {
    const billId = await paella();
    const clock = clockAt("2001-01-01T11:00:00.000Z");

    for (const body of [cashPart(), manualCardPart()]) {
      const answer = await pay(billId, body, { clock });
      expect(answer.status).toBe(409);
      expect(answer.json).toEqual({
        code: "clock.unusable",
        params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
      });
    }
    expect(await paymentRows(venue, billId)).toEqual([]);
  });
});

describe("a reader bill payment while the full-disk stop holds", () => {
  it("refuses a reader payment while a refused write is noted, before the reader", async () => {
    const billId = await paella();
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();
    const before = collects();

    const answer = await pay(billId, readerPart(), { disk });

    expect(answer.status).toBe(507);
    expect(answer.json.code).toBe("storage.disk_full");
    expect(collects()).toBe(before);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  it("asks the reader when nothing is noted", async () => {
    const billId = await paella();
    const before = collects();

    const answer = await pay(billId, readerPart(), { disk: diskState({ bytes: 0 }) });

    expect(answer.status).toBe(200);
    expect(answer.json.outcome).toBe("received");
    expect(collects()).toBe(before + 1);
  });

  it("logs the refusal with the bill it refused", async () => {
    const entries: { level: string; event: string; fields: Record<string, unknown> }[] = [];
    const log: Logger = (level, event, fields) => {
      entries.push({ level, event, fields: fields ?? {} });
    };
    const billId = await paella();
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();

    const answer = await pay(billId, readerPart(), { disk, log });

    expect(answer.status).toBe(507);
    expect(entries.filter((entry) => entry.event === "storage.disk_full_stop_refused")).toEqual([
      {
        level: "warn",
        event: "storage.disk_full_stop_refused",
        fields: { workingOrderId: billId },
      },
    ]);
  });

  it("answers a retry of a payment already taken while the stop holds", async () => {
    const billId = await paella();
    const body = readerPart();
    const first = await pay(billId, body);
    expect(first.status).toBe(200);
    const disk = diskState({ bytes: 0 });
    disk.noteRefused();
    const before = collects();

    const retry = await pay(billId, body, { disk });

    expect(retry.status).toBe(200);
    expect((retry.json.payment as { id: string }).id).toBe(
      (first.json.payment as { id: string }).id,
    );
    expect(collects()).toBe(before);
  });

  it("takes a reader payment again once the folder has 16 MiB free", async () => {
    const free = { bytes: FULL_DISK_BYTES - 1 };
    const disk = diskState(free);
    disk.noteRefused();
    const before = collects();

    const short = await pay(await paella(), readerPart(), { disk });
    expect(short.status).toBe(507);
    expect(short.json.code).toBe("storage.disk_full");
    expect(collects()).toBe(before);

    free.bytes = FULL_DISK_BYTES;
    const answer = await pay(await paella(), readerPart(), { disk });
    expect(answer.status).toBe(200);
    expect(answer.json.outcome).toBe("received");
    expect(collects()).toBe(before + 1);
    expect(disk.since()).toBeNull();
  });

  it("refuses before the reader when the free-space read answers full", async () => {
    const billId = await paella();
    const disk: DiskFullState = {
      noteRefused: () => {},
      noted: () => false,
      since: () => null,
      full: () => Promise.resolve(true),
    };
    const before = collects();

    const answer = await pay(billId, readerPart(), { disk });

    expect(answer.status).toBe(507);
    expect(answer.json.code).toBe("storage.disk_full");
    expect(collects()).toBe(before);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  describe("a refusal noted while the payment waits for the write queue", () => {
    /** Wraps a real state; its `full()` queues a write body, ahead of the payment's, that runs `queued`. */
    function queuingState(queued: (state: DiskFullState) => void) {
      const state = diskState({ bytes: 0 });
      let pending: Promise<void> = Promise.resolve();
      const disk: DiskFullState = {
        noteRefused: () => state.noteRefused(),
        noted: () => state.noted(),
        since: () => state.since(),
        async full() {
          const answer = await state.full();
          pending = withTransaction(venue.db, () => {
            queued(state);
            return Promise.resolve();
          });
          return answer;
        },
      };
      return { disk, queuedBody: () => pending };
    }

    it("refuses before the reader when a refusal is noted while the payment waits", async () => {
      const { disk, queuedBody } = queuingState((state) => state.noteRefused());
      const billId = await paella();
      const before = collects();

      const answer = await pay(billId, readerPart(), { disk });
      await queuedBody();

      expect(answer.status).toBe(507);
      expect(answer.json.code).toBe("storage.disk_full");
      expect(collects()).toBe(before);
      expect(await paymentRows(venue, billId)).toEqual([]);
    });

    it("asks the reader when the queued write notes nothing", async () => {
      const { disk, queuedBody } = queuingState(() => {});
      const before = collects();

      const answer = await pay(await paella(), readerPart(), { disk });
      await queuedBody();

      expect(answer.status).toBe(200);
      expect(answer.json.outcome).toBe("received");
      expect(collects()).toBe(before + 1);
    });
  });

  describe("a refusal noted after the first transaction", () => {
    function scriptedState(notedFromCall: number): DiskFullState & { calls: () => number } {
      let calls = 0;
      return {
        noteRefused: () => {},
        noted: () => {
          calls += 1;
          return calls >= notedFromCall;
        },
        since: () => null,
        full: () => Promise.resolve(false),
        calls: () => calls,
      };
    }

    it("refuses before the reader when a refusal is noted after the first transaction, and fails the payment", async () => {
      const billId = await paella();
      const disk = scriptedState(2);
      const before = collects();

      const answer = await pay(billId, readerPart(), { disk });

      expect(answer.status).toBe(507);
      expect(answer.json.code).toBe("storage.disk_full");
      expect(collects()).toBe(before);
      expect(disk.calls()).toBe(2);
      expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["failed"]);
    });

    it("asks the reader when nothing is noted after the first transaction", async () => {
      const disk = scriptedState(Number.POSITIVE_INFINITY);
      const before = collects();

      const answer = await pay(await paella(), readerPart(), { disk });

      expect(answer.status).toBe(200);
      expect(answer.json.outcome).toBe("received");
      expect(collects()).toBe(before + 1);
    });
  });
});
