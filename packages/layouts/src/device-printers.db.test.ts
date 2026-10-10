import {
  CORE_MIGRATIONS,
  captureError,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  locations,
  printers,
  restrictRefused,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { selectDevicePrinter, settleProfilePrinterDevices } from "./device-equipment.js";
import {
  readProfilePrinterLists,
  setProfilePrinterLists,
  type ProfilePrinterLists,
} from "./device-printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function lists(partial: Partial<ProfilePrinterLists>): ProfilePrinterLists {
  return {
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    ...partial,
  };
}

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function seedLocation(name: string): Promise<LocationId> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name, invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

async function seedPrinter(location: string, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({ locationId: location, name, transport: "network_tcp", host: "10.0.0.1" })
    .returning({ id: printers.id });
  return row!.id;
}

async function devicePrinters(deviceId: string) {
  const [row] = await suite.db
    .select({
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row;
}

async function setActive(printerId: string, active: boolean): Promise<void> {
  await suite.db.update(printers).set({ active }).where(eq(printers.id, printerId));
}

describe("a profile's printer lists and each device's current printers", () => {
  let loc: LocationId;
  let elsewhere: LocationId;
  let p1: string;
  let p2: string;
  let p3: string;
  let away: string;

  // `useVenueDb` empties every table after each test.
  beforeEach(async () => {
    await seedTenant(suite.db);
    loc = await seedLocation("Here");
    elsewhere = await seedLocation("Elsewhere");
    p1 = await seedPrinter(loc, "Bar");
    p2 = await seedPrinter(loc, "Counter");
    p3 = await seedPrinter(loc, "Portable");
    away = await seedPrinter(elsewhere, "Other venue");
  });

  it("stores both lists in the order given and reads them back", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [p3],
        }),
      ),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(
      lists({
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [p3],
      }),
    );
  });

  it("replaces the lists rather than adding to them", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p1, p2],
          paymentSlipPrinterIds: [p3],
        }),
      ),
    );
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [],
        }),
      ),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(
      lists({
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [],
      }),
    );
  });

  it("accepts the same printer on both lists", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [p1],
        }),
      ),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(
      lists({
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p1],
      }),
    );
  });

  it("reads empty lists for a profile that has none", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(
      lists({
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [],
      }),
    );
  });

  it("returns a device whose printer leaves the list to Use default, in the same transaction", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [p3],
        }),
      );
      expect(
        await selectDevicePrinter(tx, {
          deviceId,
          role: "receipt",
          selection: { id: p2 },
          via: "list",
        }),
      ).toEqual({ ok: true, previousHolderDeviceId: null });
      expect(
        await selectDevicePrinter(tx, {
          deviceId,
          role: "payment_slip",
          selection: { id: p3 },
          via: "list",
        }),
      ).toEqual({ ok: true, previousHolderDeviceId: null });
    });
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: p2,
      paymentSlipPrinterId: p3,
    });

    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [p3],
        }),
      );
      const [inside] = await tx
        .select({ receiptPrinterId: devices.receiptPrinterId })
        .from(devices)
        .where(eq(devices.id, deviceId));
      expect(inside).toEqual({ receiptPrinterId: null });
    });
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: p3,
    });

    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [],
          paymentSlipPrinterIds: [p3],
        }),
      ),
    );
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: p3,
    });
  });

  it("leaves a device holding no printer on none when the lists change", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [p3],
        }),
      ),
    );
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
    });
  });

  it("keeps a device on a switched-off printer that is still listed when another list changes", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [p3],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId,
        role: "receipt",
        selection: { id: p2 },
        via: "list",
      });
    });
    await setActive(p2, false);
    try {
      await inTx((tx) =>
        setProfilePrinterLists(
          tx,
          profileId,
          lists({
            receiptPrinterIds: [p2, p1],
            paymentSlipPrinterIds: [p1],
          }),
        ),
      );
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p2);
    } finally {
      await setActive(p2, true);
    }
  });

  it("returns a device off a delisted printer to Use default rather than another listed one", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p3, p2, p1],
          paymentSlipPrinterIds: [],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId,
        role: "receipt",
        selection: { id: p3 },
        via: "list",
      });
    });
    await setActive(p2, false);
    try {
      await inTx((tx) =>
        setProfilePrinterLists(
          tx,
          profileId,
          lists({
            receiptPrinterIds: [p2, p1],
            paymentSlipPrinterIds: [],
          }),
        ),
      );
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBeNull();
    } finally {
      await setActive(p2, true);
    }
  });

  it("returns devices on one profile at two locations to Use default when their printers leave the list", async () => {
    const here = await seedDevice(suite.db, { locationId: loc });
    const there = await seedDevice(suite.db, { locationId: elsewhere, profileId: here.profileId });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        here.profileId,
        lists({
          receiptPrinterIds: [p1, away, p2],
          paymentSlipPrinterIds: [],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId: here.deviceId,
        role: "receipt",
        selection: { id: p1 },
        via: "list",
      });
      await selectDevicePrinter(tx, {
        deviceId: there.deviceId,
        role: "receipt",
        selection: { id: away },
        via: "list",
      });
      await setProfilePrinterLists(
        tx,
        here.profileId,
        lists({
          receiptPrinterIds: [p2],
          paymentSlipPrinterIds: [],
        }),
      );
    });
    expect((await devicePrinters(here.deviceId))?.receiptPrinterId).toBeNull();
    expect((await devicePrinters(there.deviceId))?.receiptPrinterId).toBeNull();
  });

  it("leaves devices on other profiles untouched", async () => {
    const mine = await seedDevice(suite.db, { locationId: loc });
    const other = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        mine.profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [],
        }),
      );
      await setProfilePrinterLists(
        tx,
        other.profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId: mine.deviceId,
        role: "receipt",
        selection: { id: p1 },
        via: "list",
      });
      await selectDevicePrinter(tx, {
        deviceId: other.deviceId,
        role: "receipt",
        selection: { id: p1 },
        via: "list",
      });
      await setProfilePrinterLists(
        tx,
        mine.profileId,
        lists({
          receiptPrinterIds: [],
          paymentSlipPrinterIds: [],
        }),
      );
    });
    expect((await devicePrinters(other.deviceId))?.receiptPrinterId).toBe(p1);
    expect((await devicePrinters(mine.deviceId))?.receiptPrinterId).toBeNull();
  });

  it("resettles a device moved onto another profile off the printers that profile does not list", async () => {
    const from = await seedDevice(suite.db, { locationId: loc });
    const to = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        from.profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [p1],
        }),
      );
      await setProfilePrinterLists(
        tx,
        to.profileId,
        lists({
          receiptPrinterIds: [p2, p3],
          paymentSlipPrinterIds: [p3, p1],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId: from.deviceId,
        role: "receipt",
        selection: { id: p1 },
        via: "list",
      });
      await selectDevicePrinter(tx, {
        deviceId: from.deviceId,
        role: "payment_slip",
        selection: { id: p1 },
        via: "list",
      });
      await tx
        .update(devices)
        .set({ deviceProfileId: to.profileId })
        .where(eq(devices.id, from.deviceId));
      await settleProfilePrinterDevices(tx, to.profileId);
    });
    // The receipt printer is not on the new receipt list; the slip printer is, so it stays.
    expect(await devicePrinters(from.deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: p1,
    });
  });

  it("refuses a printer not on the device's list for that role, naming the field, and leaves the device unchanged", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [p3],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId,
        role: "payment_slip",
        selection: { id: p3 },
        via: "list",
      });
    });
    expect(
      await inTx((tx) =>
        selectDevicePrinter(tx, {
          deviceId,
          role: "payment_slip",
          selection: { id: p1 },
          via: "list",
        }),
      ),
    ).toEqual({ ok: false, refusal: "not_permitted" });
    expect(
      await inTx((tx) =>
        selectDevicePrinter(tx, { deviceId, role: "receipt", selection: { id: p3 }, via: "list" }),
      ),
    ).toEqual({ ok: false, refusal: "not_permitted" });
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: p3,
    });

    expect(
      await inTx((tx) =>
        selectDevicePrinter(tx, { deviceId, role: "receipt", selection: { id: p1 }, via: "list" }),
      ),
    ).toEqual({ ok: true, previousHolderDeviceId: null });
    expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p1);
    expect(
      await inTx((tx) =>
        selectDevicePrinter(tx, { deviceId, role: "receipt", selection: "default", via: "list" }),
      ),
    ).toEqual({ ok: true, previousHolderDeviceId: null });
    expect((await devicePrinters(deviceId))?.receiptPrinterId).toBeNull();
  });

  it("never accepts a listed printer at another location", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [away, p1],
          paymentSlipPrinterIds: [away],
        }),
      ),
    );
    expect(
      await inTx((tx) =>
        selectDevicePrinter(tx, {
          deviceId,
          role: "receipt",
          selection: { id: away },
          via: "list",
        }),
      ),
    ).toEqual({ ok: false, refusal: "not_permitted" });
    expect((await devicePrinters(deviceId))?.receiptPrinterId).toBeNull();
  });

  it("refuses an unknown device as it refuses an unlisted printer", async () => {
    expect(
      await inTx((tx) =>
        selectDevicePrinter(tx, {
          deviceId: "00000000-0000-4000-8000-000000000000",
          role: "receipt",
          selection: { id: p1 },
          via: "list",
        }),
      ),
    ).toEqual({ ok: false, refusal: "not_permitted" });
  });

  it("keeps a deactivated current printer stored, and refuses choosing an inactive one", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(
        tx,
        profileId,
        lists({
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [],
        }),
      );
      await selectDevicePrinter(tx, {
        deviceId,
        role: "receipt",
        selection: { id: p2 },
        via: "list",
      });
    });
    await setActive(p2, false);
    try {
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p2);
      await inTx((tx) =>
        selectDevicePrinter(tx, { deviceId, role: "receipt", selection: { id: p1 }, via: "list" }),
      );
      expect(
        await inTx((tx) =>
          selectDevicePrinter(tx, {
            deviceId,
            role: "receipt",
            selection: { id: p2 },
            via: "list",
          }),
        ),
      ).toEqual({ ok: false, refusal: "not_permitted" });
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p1);
    } finally {
      await setActive(p2, true);
    }
  });

  it("deletes a profile's list rows with the profile, and refuses deleting a listed printer", async () => {
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "Deletable", formFactor: "till", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    const lonely = await seedPrinter(loc, "Listed only");
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile!.id,
        lists({
          receiptPrinterIds: [lonely],
          paymentSlipPrinterIds: [lonely],
        }),
      ),
    );

    const refusal = await captureError(() =>
      suite.db.delete(printers).where(eq(printers.id, lonely)),
    );
    expect(restrictRefused(refusal)).toBe(true);

    await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, profile!.id));
    const left = await suite.db
      .select({ id: deviceProfilePrinters.id })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile!.id));
    expect(left).toEqual([]);
    await suite.db.delete(printers).where(eq(printers.id, lonely));
  });
});

describe("a deleted printer on a profile's lists", () => {
  let loc: LocationId;
  let live: string;
  let gone: string;

  beforeEach(async () => {
    await seedTenant(suite.db);
    loc = await seedLocation("Here");
    live = await seedPrinter(loc, "Bar");
    const [row] = await suite.db
      .insert(printers)
      .values({
        locationId: loc,
        name: "Gone",
        transport: "network_tcp",
        host: "10.0.0.2",
        hasCashDrawer: true,
      })
      .returning({ id: printers.id });
    gone = row!.id;
  });

  // Only the tombstone is written: a real delete also removes the profile's rows
  // (apps/server/src/printer-delete.ts), so the resave cases pin a backstop for a state it never
  // leaves.
  async function tombstone(printerId: string): Promise<void> {
    await suite.db
      .update(printers)
      .set({ active: false, deletedAt: "2026-10-10T12:00:00.000Z" })
      .where(eq(printers.id, printerId));
  }

  const ROLES = [
    ["receipt", { receiptPrinterIds: ["GONE"] }],
    ["payment slip", { paymentSlipPrinterIds: ["GONE"] }],
    ["cash drawer", { cashDrawerPrinterIds: ["GONE"] }],
    ["receipt default", { receiptPrinterIds: ["GONE"], receiptPrinterDefaultId: "GONE" }],
    [
      "payment slip default",
      { paymentSlipPrinterIds: ["GONE"], paymentSlipPrinterDefaultId: "GONE" },
    ],
    ["cash drawer default", { cashDrawerPrinterIds: ["GONE"], cashDrawerPrinterDefaultId: "GONE" }],
  ] as const;

  function withGone(partial: Partial<Record<keyof ProfilePrinterLists, unknown>>) {
    return lists(
      Object.fromEntries(
        Object.entries(partial).map(([key, value]) => [
          key,
          !Array.isArray(value) ? gone : key === "cashDrawerPrinterIds" ? [gone] : [live, gone],
        ]),
      ) as Partial<ProfilePrinterLists>,
    );
  }

  it.each(ROLES)(
    "refuses newly listing it on the %s list with printer.not_found, storing nothing",
    async (_role, partial) => {
      const { profileId } = await seedDevice(suite.db, { locationId: loc });
      const stored = lists({ receiptPrinterIds: [live], receiptPrinterDefaultId: live });
      await inTx((tx) => setProfilePrinterLists(tx, profileId, stored));
      await tombstone(gone);
      const e = await captureError(() =>
        inTx((tx) => setProfilePrinterLists(tx, profileId, withGone(partial))),
      );
      expect(e).toBeInstanceOf(AppError);
      expect([(e as AppError).code, (e as AppError).params]).toEqual([
        "printer.not_found",
        { id: gone },
      ]);
      expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(stored);
    },
  );

  it.each(ROLES)(
    "refuses a %s list still naming it when the same lists are saved again, storing nothing",
    async (_role, partial) => {
      const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
      const stale = withGone(partial);
      await inTx((tx) => setProfilePrinterLists(tx, profileId, stale));
      await tombstone(gone);
      const e = await captureError(() =>
        inTx((tx) => setProfilePrinterLists(tx, profileId, stale)),
      );
      expect(e).toBeInstanceOf(AppError);
      expect([(e as AppError).code, (e as AppError).params]).toEqual([
        "printer.not_found",
        { id: gone },
      ]);
      expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(stale);
      expect(await devicePrinters(deviceId)).toEqual({
        receiptPrinterId: null,
        paymentSlipPrinterId: null,
      });
    },
  );

  it("still saves lists naming a switched-off printer that is not deleted", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    const saved = withGone(ROLES[5][1]);
    await inTx((tx) => setProfilePrinterLists(tx, profileId, saved));
    await setActive(gone, false);
    await inTx((tx) => setProfilePrinterLists(tx, profileId, saved));
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(saved);
  });

  it("saves lists that no longer name it", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, lists({ receiptPrinterIds: [live, gone] })),
    );
    await tombstone(gone);
    const next = lists({ receiptPrinterIds: [live], receiptPrinterDefaultId: live });
    await inTx((tx) => setProfilePrinterLists(tx, profileId, next));
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual(next);
  });
});
