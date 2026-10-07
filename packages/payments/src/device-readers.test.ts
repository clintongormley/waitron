import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, devices, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { cardReaderHolders } from "./schema/card-reader-holders.js";
import { cardReaders } from "./schema/card-readers.js";
import { deviceCardReaders } from "./schema/device-card-readers.js";
import { deviceProfileCardReaders } from "./schema/device-profile-card-readers.js";
import { payments } from "./schema/payments.js";
import type { PaymentState } from "./provider.js";
import { DEMO_READER_ID } from "./simulator.js";
import { insertAttempting } from "./store.js";
import {
  clearUnlistedReaderChoice,
  readProfileReaderList,
  readReaderRole,
  readerHeldBy,
  readerPaymentInProgress,
  releaseDeviceReader,
  resolveDeviceReaderId,
  selectDeviceReader,
  setProfileReaderList,
  settleDeviceReader,
  settleProfileReaderDevices,
} from "./device-readers.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function seed() {
  const s = await seedWorkingOrder(suite.db, freshNif());
  const [a] = await suite.db
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, s.deviceId));
  const profileId = a!.profileId;
  const { deviceId: deviceB } = await seedDevice(suite.db, { locationId: s.locationId, profileId });
  const { deviceId: deviceC, profileId: otherProfileId } = await seedDevice(suite.db, {
    locationId: s.locationId,
  });
  const tag = randomUUID();
  const readers = await suite.db
    .insert(cardReaders)
    .values(
      ["r1", "r2", "r3", "off", "unpaired"].map((name) => ({
        provider: "sumup",
        providerRef: `${name}-${tag}`,
        name,
        active: name !== "off",
        unpairedAt: name === "unpaired" ? new Date().toISOString() : null,
      })),
    )
    .returning({ id: cardReaders.id });
  return {
    workingOrderId: s.workingOrderId,
    profileId,
    otherProfileId,
    deviceA: s.deviceId as string,
    deviceB: deviceB as string,
    deviceC: deviceC as string,
    r1: readers[0]!.id,
    r2: readers[1]!.id,
    r3: readers[2]!.id,
    off: readers[3]!.id,
    unpaired: readers[4]!.id,
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

async function hold(readerId: string, deviceId: string) {
  await inTx((tx) => tx.insert(cardReaderHolders).values({ readerId, deviceId }));
}

async function holders(...readerIds: string[]) {
  const rows = await suite.db.select().from(cardReaderHolders);
  return Object.fromEntries(
    rows.filter((r) => readerIds.includes(r.readerId)).map((r) => [r.readerId, r.deviceId]),
  );
}

async function chosen(deviceId: string) {
  const [row] = await suite.db
    .select({ readerId: deviceCardReaders.readerId })
    .from(deviceCardReaders)
    .where(eq(deviceCardReaders.deviceId, deviceId));
  return row?.readerId ?? null;
}

async function paymentOn(s: Seeded, readerId: string, deviceId: string, state: PaymentState) {
  await inTx((tx) =>
    tx.insert(payments).values({
      source: "device",
      deviceId,
      workingOrderId: s.workingOrderId,
      provider: "fake",
      paymentRef: randomUUID(),
      amount: 1000,
      state,
      readerId,
    }),
  );
}

function attempting(s: Seeded, readerId: string, paymentRef: string) {
  return inTx((tx) =>
    insertAttempting(tx, {
      origin: deviceOrigin(s.deviceA),
      workingOrderId: s.workingOrderId,
      provider: "fake",
      paymentRef,
      amount: decimal("10.00"),
      readerId,
    }),
  );
}

async function paymentReader(paymentRef: string) {
  const rows = await suite.db
    .select({ readerId: payments.readerId })
    .from(payments)
    .where(eq(payments.paymentRef, paymentRef));
  return rows;
}

describe("insertAttempting and the card reader", () => {
  it("records the reader it was given", async () => {
    const s = await seed();
    await hold(s.r1, s.deviceA);
    const ref = randomUUID();
    await attempting(s, s.r1, ref);
    expect(await paymentReader(ref)).toEqual([{ readerId: s.r1 }]);
  });

  it("refuses a reader another device holds, and one with another device's attempting payment, writing no row", async () => {
    const s = await seed();
    await hold(s.r1, s.deviceB);
    const heldRef = randomUUID();
    const notHeld = await captureError(() => attempting(s, s.r1, heldRef));
    expect(notHeld).toBeInstanceOf(AppError);
    expect((notHeld as AppError).code).toBe("reader.not_held");
    expect((notHeld as AppError).params).toEqual({ readerId: s.r1 });
    expect(await paymentReader(heldRef)).toEqual([]);

    await hold(s.r2, s.deviceA);
    await paymentOn(s, s.r2, s.deviceB, "attempting");
    const busyRef = randomUUID();
    const busy = await captureError(() => attempting(s, s.r2, busyRef));
    expect(busy).toBeInstanceOf(AppError);
    expect((busy as AppError).code).toBe("reader.payment_in_progress");
    expect((busy as AppError).params).toEqual({ readerId: s.r2 });
    expect(await paymentReader(busyRef)).toEqual([]);
  });

  it("the holder's own start is written, and a second start by the holder is not refused", async () => {
    const s = await seed();
    await hold(s.r1, s.deviceA);
    const first = randomUUID();
    const second = randomUUID();
    await attempting(s, s.r1, first);
    await attempting(s, s.r1, second);
    expect(await paymentReader(first)).toEqual([{ readerId: s.r1 }]);
    expect(await paymentReader(second)).toEqual([{ readerId: s.r1 }]);
  });
});

describe("readerPaymentInProgress", () => {
  it.each<[PaymentState, boolean]>([
    ["attempting", true],
    ["initiated", true],
    ["captured", false],
    ["failed", false],
    ["voided", false],
  ])("another device's %s payment makes the reader busy: %s", async (state, busy) => {
    const s = await seed();
    await paymentOn(s, s.r1, s.deviceB, state);
    expect(await inTx((tx) => readerPaymentInProgress(tx, s.r1, s.deviceA))).toBe(busy);
  });

  it("the starting device's own payment in progress does not make the reader busy for it", async () => {
    const s = await seed();
    await paymentOn(s, s.r1, s.deviceA, "attempting");
    expect(await inTx((tx) => readerPaymentInProgress(tx, s.r1, s.deviceA))).toBe(false);
    expect(await inTx((tx) => readerPaymentInProgress(tx, s.r1, s.deviceB))).toBe(true);
  });
});

describe("readerHeldBy", () => {
  it("names the holding device, and null for a reader nobody holds", async () => {
    const s = await seed();
    await hold(s.r1, s.deviceB);
    expect(await inTx((tx) => readerHeldBy(tx, s.r1))).toBe(s.deviceB);
    expect(await inTx((tx) => readerHeldBy(tx, s.r2))).toBeNull();
  });
});

describe("a profile's reader list", () => {
  it("stores the list in order with its default", async () => {
    const s = await seed();
    const result = await inTx((tx) =>
      setProfileReaderList(tx, s.profileId, { readerIds: [s.r2, s.r1], defaultReaderId: s.r1 }),
    );
    expect(result).toEqual({ ok: true });
    expect(await inTx((tx) => readProfileReaderList(tx, s.profileId))).toEqual({
      readerIds: [s.r2, s.r1],
      defaultReaderId: s.r1,
    });
  });

  it("refuses a default not in its list, storing nothing", async () => {
    const s = await seed();
    await inTx((tx) =>
      setProfileReaderList(tx, s.profileId, { readerIds: [s.r1], defaultReaderId: null }),
    );
    const result = await inTx((tx) =>
      setProfileReaderList(tx, s.profileId, { readerIds: [s.r2], defaultReaderId: s.r1 }),
    );
    expect(result).toEqual({ ok: false, refusal: "default_not_listed" });
    expect(await inTx((tx) => readProfileReaderList(tx, s.profileId))).toEqual({
      readerIds: [s.r1],
      defaultReaderId: null,
    });
  });
});

async function list(s: Seeded, readerIds: string[], defaultReaderId: string | null = null) {
  await inTx((tx) => setProfileReaderList(tx, s.profileId, { readerIds, defaultReaderId }));
}

describe("a device's card reader", () => {
  it("resolves an explicit choice it holds", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2], s.r1);
    const result = await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r2 }, via: "list" }),
    );
    expect(result).toEqual({ ok: true, previousHolderDeviceId: null });
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBe(s.r2);
    expect(await holders(s.r1, s.r2)).toEqual({ [s.r2]: s.deviceA });
  });

  it("Use default resolves the profile default, and None when the profile has no default", async () => {
    const s = await seed();
    await list(s, [s.r1], s.r1);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: "default", via: "list" }),
    );
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBe(s.r1);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceC, selection: "default", via: "list" }),
    );
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceC))).toBeNull();
  });

  it("an unknown device resolves None and is refused as not permitted", async () => {
    const s = await seed();
    expect(await inTx((tx) => resolveDeviceReaderId(tx, randomUUID()))).toBeNull();
    expect(await inTx((tx) => readReaderRole(tx, randomUUID()))).toBeNull();
    expect(
      await inTx((tx) =>
        selectDeviceReader(tx, { deviceId: randomUUID(), selection: { id: s.r1 }, via: "list" }),
      ),
    ).toEqual({ ok: false, refusal: "not_permitted" });
  });

  it.each(["unlisted", "off", "unpaired", "demo"] as const)(
    "refuses a %s reader as not permitted, storing nothing",
    async (kind) => {
      const s = await seed();
      await inTx((tx) =>
        tx
          .insert(cardReaders)
          .values({ id: DEMO_READER_ID, provider: "simulator", providerRef: "demo", name: "Demo" })
          .onConflictDoNothing(),
      );
      await list(s, [s.r1, s.off, s.unpaired, DEMO_READER_ID]);
      const id = { unlisted: s.r2, off: s.off, unpaired: s.unpaired, demo: DEMO_READER_ID }[kind];
      const result = await inTx((tx) =>
        selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id }, via: "scan" }),
      );
      expect(result).toEqual({ ok: false, refusal: "not_permitted" });
      expect(await chosen(s.deviceA)).toBeNull();
      expect(await holders(id)).toEqual({});
    },
  );

  it("a listed, active reader is accepted", async () => {
    const s = await seed();
    await list(s, [s.r1]);
    const result = await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "manage" }),
    );
    expect(result).toEqual({ ok: true, previousHolderDeviceId: null });
    expect(await chosen(s.deviceA)).toBe(s.r1);
  });

  it("a default held by another device resolves None and reports its holder, taking nothing", async () => {
    const s = await seed();
    await list(s, [s.r1], s.r1);
    await hold(s.r1, s.deviceB);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: "default", via: "list" }),
    );
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBeNull();
    expect(await inTx((tx) => readReaderRole(tx, s.deviceA))).toEqual({
      chosenId: null,
      chosenHolderDeviceId: null,
      defaultId: s.r1,
      defaultHolderDeviceId: s.deviceB,
      resolvedId: null,
    });
    expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceB });
  });

  it("an explicit reader choice this device does not hold resolves None", async () => {
    const s = await seed();
    await list(s, [s.r1]);
    await inTx((tx) =>
      tx.insert(deviceCardReaders).values({ deviceId: s.deviceA, readerId: s.r1 }),
    );
    await hold(s.r1, s.deviceB);
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBeNull();
    expect(await inTx((tx) => readReaderRole(tx, s.deviceA))).toMatchObject({
      chosenId: s.r1,
      chosenHolderDeviceId: s.deviceB,
      resolvedId: null,
    });
  });

  it("choosing Use default takes a free default", async () => {
    const s = await seed();
    await list(s, [s.r1], s.r1);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: "default", via: "list" }),
    );
    expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceA });
  });

  it("a free default another device has a payment in progress on is not taken", async () => {
    const s = await seed();
    await list(s, [s.r1], s.r1);
    await paymentOn(s, s.r1, s.deviceB, "attempting");
    await inTx((tx) => settleDeviceReader(tx, s.deviceA, { acquire: true }));
    expect(await holders(s.r1)).toEqual({});
  });

  it("a profile list edit takes nothing for a device on Use default", async () => {
    const s = await seed();
    await list(s, [s.r1], s.r1);
    expect(await holders(s.r1)).toEqual({});
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBeNull();
  });

  it("a disabled reader stays chosen and held", async () => {
    const s = await seed();
    await list(s, [s.r1]);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await inTx((tx) =>
      tx.update(cardReaders).set({ active: false }).where(eq(cardReaders.id, s.r1)),
    );
    await list(s, [s.r1, s.r2]);
    expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBe(s.r1);
    expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceA });
  });

  it("a list edit clears an explicit choice no longer listed, back to Use default, and releases its hold", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2]);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await list(s, [s.r2]);
    expect(await chosen(s.deviceA)).toBeNull();
    expect(await holders(s.r1)).toEqual({});
  });

  it("a list edit keeps a choice still listed", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2]);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await list(s, [s.r1]);
    expect(await chosen(s.deviceA)).toBe(s.r1);
    expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceA });
  });

  it("a list edit settles every device on the profile in four reads, releasing only what each no longer uses", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2], s.r2);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await inTx((tx) => settleDeviceReader(tx, s.deviceB, { acquire: true }));
    expect(await holders(s.r1, s.r2)).toEqual({ [s.r1]: s.deviceA, [s.r2]: s.deviceB });
    await suite.db
      .delete(deviceProfileCardReaders)
      .where(
        and(
          eq(deviceProfileCardReaders.deviceProfileId, s.profileId),
          eq(deviceProfileCardReaders.readerId, s.r1),
        ),
      );

    const reads = await inTx(async (tx) => {
      const selects = vi.spyOn(tx, "select");
      try {
        await settleProfileReaderDevices(tx, s.profileId);
        return selects.mock.calls.length;
      } finally {
        selects.mockRestore();
      }
    });

    expect(reads).toBe(4);
    expect(await chosen(s.deviceA)).toBeNull();
    expect(await holders(s.r1, s.r2)).toEqual({ [s.r2]: s.deviceB });
  });

  it("settling a profile with an empty list clears every device's choice and hold", async () => {
    const s = await seed();
    await list(s, [s.r1], s.r1);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await inTx((tx) =>
      setProfileReaderList(tx, s.profileId, { readerIds: [], defaultReaderId: null }),
    );
    await inTx((tx) => settleProfileReaderDevices(tx, s.profileId));
    expect(await chosen(s.deviceA)).toBeNull();
    expect(await holders(s.r1)).toEqual({});
  });

  it("after a move to another profile, clears a choice that profile does not list, keeping a listed one disabled or not", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2]);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceB, selection: { id: s.r2 }, via: "list" }),
    );
    await inTx((tx) =>
      setProfileReaderList(tx, s.otherProfileId, { readerIds: [s.r1], defaultReaderId: null }),
    );
    await inTx((tx) =>
      tx.update(cardReaders).set({ active: false }).where(eq(cardReaders.id, s.r1)),
    );
    await suite.db
      .update(devices)
      .set({ deviceProfileId: s.otherProfileId })
      .where(inArray(devices.id, [s.deviceA, s.deviceB]));
    await inTx((tx) => clearUnlistedReaderChoice(tx, s.deviceA));
    await inTx((tx) => clearUnlistedReaderChoice(tx, s.deviceB));
    expect(await chosen(s.deviceA)).toBe(s.r1);
    expect(await chosen(s.deviceB)).toBeNull();
  });

  it("clearing an unknown device's unlisted choice changes nothing", async () => {
    const s = await seed();
    await list(s, [s.r1]);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await inTx((tx) => clearUnlistedReaderChoice(tx, randomUUID()));
    expect(await chosen(s.deviceA)).toBe(s.r1);
  });

  it("a profile with no readers clears the device's choice", async () => {
    const s = await seed();
    await inTx((tx) =>
      tx.insert(deviceCardReaders).values({ deviceId: s.deviceC, readerId: s.r1 }),
    );
    await inTx((tx) => clearUnlistedReaderChoice(tx, s.deviceC));
    expect(await chosen(s.deviceC)).toBeNull();
  });

  it("choosing another reader lets go of the one it held", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2]);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r2 }, via: "list" }),
    );
    expect(await holders(s.r1, s.r2)).toEqual({ [s.r2]: s.deviceA });
  });

  it("release lets go of every hold and keeps the explicit choice", async () => {
    const s = await seed();
    await list(s, [s.r1, s.r2], s.r2);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
    );
    await hold(s.r3, s.deviceA);
    await inTx((tx) => releaseDeviceReader(tx, s.deviceA));
    expect(await chosen(s.deviceA)).toBe(s.r1);
    expect(await holders(s.r1, s.r2, s.r3)).toEqual({});
  });

  describe("a kept choice after release", () => {
    async function released() {
      const s = await seed();
      await list(s, [s.r1, s.r2], s.r2);
      await inTx((tx) =>
        selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via: "list" }),
      );
      await inTx((tx) => releaseDeviceReader(tx, s.deviceA));
      return s;
    }

    it("is taken again by a settle that acquires, when nobody holds it", async () => {
      const s = await released();
      await inTx((tx) => settleDeviceReader(tx, s.deviceA, { acquire: true }));
      expect(await chosen(s.deviceA)).toBe(s.r1);
      expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceA });
      expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBe(s.r1);
    });

    it("is cleared back to Use default by a settle that acquires, when another device holds it", async () => {
      const s = await released();
      await inTx((tx) =>
        selectDeviceReader(tx, { deviceId: s.deviceB, selection: { id: s.r1 }, via: "scan" }),
      );
      await inTx((tx) => settleDeviceReader(tx, s.deviceA, { acquire: true }));
      expect(await chosen(s.deviceA)).toBeNull();
      expect(await holders(s.r1, s.r2)).toEqual({ [s.r1]: s.deviceB, [s.r2]: s.deviceA });
      expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBe(s.r2);
    });

    it.each<PaymentState>(["attempting", "initiated"])(
      "is cleared back to Use default by a settle that acquires, when nobody holds it but another device has a payment %s on it",
      async (state) => {
        const s = await released();
        await paymentOn(s, s.r1, s.deviceB, state);
        await inTx((tx) => settleDeviceReader(tx, s.deviceA, { acquire: true }));
        expect(await chosen(s.deviceA)).toBeNull();
        expect(await holders(s.r1, s.r2)).toEqual({ [s.r2]: s.deviceA });
        expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceA))).toBe(s.r2);
      },
    );

    it("is neither taken nor cleared by a settle that acquires nothing", async () => {
      const s = await released();
      await inTx((tx) => settleDeviceReader(tx, s.deviceA, { acquire: false }));
      expect(await chosen(s.deviceA)).toBe(s.r1);
      expect(await holders(s.r1)).toEqual({});
    });
  });
});

describe("selecting a reader another device holds", () => {
  async function heldByB() {
    const s = await seed();
    await list(s, [s.r1, s.r2], s.r2);
    await inTx((tx) =>
      selectDeviceReader(tx, { deviceId: s.deviceB, selection: { id: s.r1 }, via: "list" }),
    );
    return s;
  }

  it.each([
    ["list", undefined],
    ["list", false],
    ["manage", true],
  ] as const)(
    "via %s with takeOver %s is refused as held, naming the holder",
    async (via, takeOver) => {
      const s = await heldByB();
      const result = await inTx((tx) =>
        selectDeviceReader(tx, {
          deviceId: s.deviceA,
          selection: { id: s.r1 },
          via,
          ...(takeOver === undefined ? {} : { takeOver }),
        }),
      );
      expect(result).toEqual({ ok: false, refusal: "held", holderDeviceId: s.deviceB });
      expect(await chosen(s.deviceA)).toBeNull();
      expect(await chosen(s.deviceB)).toBe(s.r1);
      expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceB });
    },
  );

  it.each([
    ["scan", undefined],
    ["list", true],
  ] as const)(
    "via %s with takeOver %s takes it over, clearing the previous holder's choice, which acquires nothing",
    async (via, takeOver) => {
      const s = await heldByB();
      const result = await inTx((tx) =>
        selectDeviceReader(tx, {
          deviceId: s.deviceA,
          selection: { id: s.r1 },
          via,
          ...(takeOver === undefined ? {} : { takeOver }),
        }),
      );
      expect(result).toEqual({ ok: true, previousHolderDeviceId: s.deviceB });
      expect(await chosen(s.deviceA)).toBe(s.r1);
      expect(await chosen(s.deviceB)).toBeNull();
      expect(await holders(s.r1, s.r2)).toEqual({ [s.r1]: s.deviceA });
      expect(await inTx((tx) => resolveDeviceReaderId(tx, s.deviceB))).toBeNull();
    },
  );

  it("a reader with another device's payment in progress is refused busy before asking to take it over", async () => {
    const s = await heldByB();
    await paymentOn(s, s.r1, s.deviceB, "attempting");
    for (const via of ["list", "scan"] as const) {
      const result = await inTx((tx) =>
        selectDeviceReader(tx, { deviceId: s.deviceA, selection: { id: s.r1 }, via }),
      );
      expect(result).toEqual({ ok: false, refusal: "busy" });
    }
    expect(await holders(s.r1)).toEqual({ [s.r1]: s.deviceB });
  });
});
