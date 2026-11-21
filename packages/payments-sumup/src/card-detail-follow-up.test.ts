import { it, expect, vi } from "vitest";
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
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      ...params,
      readerId,
      settledAt: SETTLED,
      provider: "sumup",
      paymentRef: "captured",
      externalRef: "txn-captured",
    }),
  );
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
    params,
    outcome,
    row: () => row("captured"),
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
  expect(outcome.mock.calls).toEqual([["captured", "filled"]]);
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
  expect(outcome.mock.calls).toEqual([["captured", "exhausted"]]);
});

it("does not read a capture past the age limit", async () => {
  const { fake, pass } = await captured();
  const fetch = vi.spyOn(fake, "findTransaction").mockResolvedValue(transaction);
  expect(await pass(121)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("leaves the write turn free during a GET and discards its reply at shutdown", async () => {
  const { fake, pass, params, row } = await captured();
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
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        ...params,
        settledAt: SETTLED,
        provider: "manual",
        paymentRef: "unrelated",
      }),
    );
    controller.abort();
  } finally {
    respond();
    await inFlight;
  }
  expect((await row()).cardLast4).toBeNull();
});
