import { it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { insertCapturedPayment, PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { seedHeldReader } from "@waitron/payments/test/seed.js";
import { setup } from "./testing/setup.js";
import { SumUpCloudProvider } from "./provider.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const SETTLED = new Date("2026-11-21T11:00:00Z");
const transaction = {
  id: "txn-captured",
  status: "SUCCESSFUL",
  amount: decimal("12.50"),
  currency: "EUR",
  card: { last4: "0421", type: "VISA" },
  entryMode: "chip",
  authCode: "A123",
};

async function captured() {
  const { fake, params, row } = await setup(suite);
  const readerId = await seedHeldReader(suite.db, params.origin.deviceId);
  const addCapture = (paymentRef: string) =>
    withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        ...params,
        readerId,
        settledAt: SETTLED,
        provider: "sumup",
        paymentRef,
        externalRef: `txn-${paymentRef}`,
      }),
    );
  await addCapture("captured");
  let current = SETTLED.getTime();
  const provider = new SumUpCloudProvider({
    client: fake,
    db: suite.db,
    captureAlerts,
    incidents: captureAlerts.raise,
    now: () => new Date(current),
  });
  const outcome = vi.fn();
  const owners = { nodeId: params.nodeId, takenOverFrom: [], unowned: false };
  return {
    fake,
    addCapture,
    outcome,
    row: (ref = "captured") => row(ref),
    pass: (seconds: number, signal?: AbortSignal) => {
      current = SETTLED.getTime() + seconds * 1_000;
      return provider.fillMissingCardDetails(owners, outcome, signal);
    },
  };
}

it("tries again 20 seconds after a refusal and saves details without changing the capture", async () => {
  const { fake, outcome, pass, row } = await captured();
  const fetch = vi
    .spyOn(fake, "findTransaction")
    .mockRejectedValueOnce(new Error("provider refused"))
    .mockResolvedValue(transaction);
  expect(await pass(60)).toEqual(new Date("2026-11-21T11:01:20Z"));
  expect(await pass(79)).toEqual(new Date("2026-11-21T11:01:20Z"));
  expect((await row()).cardLast4).toBeNull();
  expect(await pass(80)).toBeNull();
  expect(await pass(100)).toBeNull();
  expect(fetch.mock.calls).toEqual([[{ id: "txn-captured" }], [{ id: "txn-captured" }]]);
  expect(await row()).toMatchObject({
    state: "captured",
    amount: "12.50",
    settledAt: "2026-11-21T11:00:00.000Z",
    cardLast4: "0421",
    cardScheme: "VISA",
    cardEntryMode: "chip",
    cardAuthCode: "A123",
  });
  expect(outcome.mock.calls).toEqual([
    [{ paymentRef: "captured", outcome: "filled", attempts: 2, ageSeconds: 80 }],
  ]);
});

it.each([
  { id: "different-txn" },
  { status: "PENDING" },
  { amount: decimal("12.51") },
  { currency: "USD" },
  { card: { last4: "123", type: "VISA" } },
  { card: undefined },
])("exhausts three reads without writing invalid details: %j", async (change) => {
  const { fake, outcome, pass, row } = await captured();
  const fetch = vi.spyOn(fake, "findTransaction").mockResolvedValue({ ...transaction, ...change });
  await pass(1);
  await pass(21);
  expect(await pass(41)).toBeNull();
  expect(await pass(61)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect((await row()).cardLast4).toBeNull();
  expect(outcome.mock.calls).toEqual([
    [{ paymentRef: "captured", outcome: "exhausted", attempts: 3, ageSeconds: 41 }],
  ]);
});

it("ends a discovered retry when its capture ages out between passes", async () => {
  const { fake, outcome, pass } = await captured();
  const fetch = vi.spyOn(fake, "findTransaction").mockResolvedValue(null);
  await pass(60);
  expect(await pass(121)).toBeNull();
  expect(await pass(141)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(outcome.mock.calls).toEqual([
    [{ paymentRef: "captured", outcome: "exhausted", attempts: 1, ageSeconds: 121 }],
  ]);
});

it("caps retries after a database refusal and still fills another payment", async () => {
  const { addCapture, fake, outcome, pass, row } = await captured();
  await addCapture("other");
  await suite.db.execute(sql`
    CREATE TRIGGER refuse_card_details BEFORE UPDATE OF card_last4 ON payments
    WHEN old.payment_ref = 'captured' BEGIN SELECT raise(ABORT, 'injected write refusal'); END
  `);
  const fetch = vi.spyOn(fake, "findTransaction").mockImplementation(async (query) => ({
    ...transaction,
    id: "id" in query ? query.id : "",
  }));
  expect(await pass(1)).toEqual(new Date("2026-11-21T11:00:21Z"));
  expect((await row("other")).cardLast4).toBe("0421");
  await pass(21);
  expect(await pass(41)).toBeNull();
  expect(await pass(61)).toBeNull();
  expect(
    fetch.mock.calls.filter(([query]) => "id" in query && query.id === "txn-captured"),
  ).toHaveLength(3);
  expect((await row()).cardLast4).toBeNull();
  expect(outcome).toHaveBeenCalledWith({
    paymentRef: "captured",
    outcome: "exhausted",
    attempts: 3,
    ageSeconds: 41,
  });
});

it("allows an independent write during a GET and stops a queued card write at shutdown", async () => {
  const { fake, pass, addCapture, row } = await captured();
  let entered!: () => void;
  let respond!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reply = new Promise<void>((resolve) => {
    respond = resolve;
  });
  vi.spyOn(fake, "findTransaction").mockImplementation(async () => {
    entered();
    await reply;
    return transaction;
  });
  const controller = new AbortController();
  const inFlight = pass(10, controller.signal);
  await waiting;
  try {
    await addCapture("unrelated");
    await suite.db.withWriteLock(async () => {
      const writeTurn = vi.spyOn(suite.db, "withWriteLock");
      try {
        respond();
        await vi.waitFor(() => expect(writeTurn).toHaveBeenCalledOnce());
        controller.abort();
      } finally {
        writeTurn.mockRestore();
      }
    });
  } finally {
    respond();
    await inFlight;
  }
  expect((await row()).cardLast4).toBeNull();
});
