// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_ROOT/payment-slip names, or
// on macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each
// case is reported SKIPPED; with CI=true or WAITRON_REQUIRE_TEST_TOOLS=1 it FAILS instead
// (testing-guide.md, "The full-disk start tests run on a small filesystem").
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, onTestFinished, vi } from "vitest";
import { billPayments, deviceProfiles, printJobs, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { cardReaders } from "@waitron/payments";
import { validateCapabilities } from "@waitron/layouts";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const MIB = 1024 * 1024;

// While set, a payment slip is larger than the room left, and nothing else in the payment is.
let oversized = false;
vi.mock("./payment-slip.js", async (original) => {
  const real = await original<typeof import("./payment-slip.js")>();
  return {
    ...real,
    formatPaymentSlip: (input: Parameters<typeof real.formatPaymentSlip>[0]) =>
      oversized ? new Uint8Array(8 * MIB).fill(0x41) : real.formatPaymentSlip(input),
  };
});

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;
const tmpBefore = process.env.TMPDIR;

// Registered before `useVenueDb`, so its database is made in the folder this points at.
beforeAll(() => {
  opened = openSmallDisk("payment-slip", 32);
  if (opened.ok) {
    disk = opened.disk;
    process.env.TMPDIR = disk.folder("tmp");
  } else if (!REQUIRE_FULL_DISK)
    console.warn(`payment-slip full-disk tests SKIPPED: ${opened.reason}`);
});

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      for (const profile of await tx.select().from(deviceProfiles))
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [...validateCapabilities(profile.capabilities), "print-receipt"] })
          .where(eq(deviceProfiles.id, profile.id));
      await tx.update(cardReaders).set({ printsOwnSlipAutomatically: false });
    });
  },
});

afterEach(() => {
  oversized = false;
  disk?.unfill();
});
afterAll(() => {
  if (tmpBefore === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = tmpBefore;
  disk?.close();
});

function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

/** Fills the disk to 1 MiB free, room for a payment but not for its 8 MiB slip. */
function slipsDoNotFit(small: SmallDisk) {
  small.fill(1 * MIB);
  oversized = true;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  onTestFinished(() => warn.mockRestore());
  return warn;
}

const pay = (id: string) =>
  send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "10.00",
    method: "card",
    entry: "reader",
    applied: "10.00",
    tip: "0.00",
    printCardSlip: true,
  });

async function stateOf(id: string) {
  const [row] = await venue.db
    .select({ state: billPayments.state })
    .from(billPayments)
    .where(eq(billPayments.workingOrderId, id));
  return row!.state;
}

const printJobCount = async () => (await venue.db.select().from(printJobs)).length;

it("the payment check records a charged payment whose slip does not fit on the disk", async (ctx) => {
  const small = needDisk(ctx);
  const id = await tabWith(venue, "Red wine bottle");
  venue.card.crashNextCollect("captured");
  expect((await pay(id)).status).toBe(500);
  expect(await stateOf(id)).toBe("pending");
  const before = await printJobCount();
  const warn = slipsDoNotFit(small);

  const pass = await settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg: venue.cfg,
  });

  expect(pass).toMatchObject({ received: 1, errors: [] });
  expect(await stateOf(id)).toBe("received");
  expect(await printJobCount()).toBe(before);
  expect(warn).toHaveBeenCalledWith("receipt.optional_document_failed", {
    operation: "printSettledPaymentSlip",
    workingOrderId: id,
    code: "storage.disk_full",
  });
});

it("a card charged while the till waits is recorded when its slip does not fit on the disk", async (ctx) => {
  const small = needDisk(ctx);
  const id = await tabWith(venue, "Red wine bottle");
  const before = await printJobCount();
  slipsDoNotFit(small);

  const paid = await pay(id);

  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  expect(paid.json).toMatchObject({ outcome: "received", slipPrintFailed: true });
  expect(await stateOf(id)).toBe("received");
  expect(await printJobCount()).toBe(before);
});
