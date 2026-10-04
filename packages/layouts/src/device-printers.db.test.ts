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
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  chooseDevicePrinter,
  firstUsablePrinters,
  printerChoices,
  readProfilePrinterLists,
  resettleDevicesOnProfile,
  setProfilePrinterLists,
} from "./device-printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

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
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [p3],
      }),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual({
      receiptPrinterIds: [p2, p1],
      paymentSlipPrinterIds: [p3],
    });
  });

  it("replaces the lists rather than adding to them", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p1, p2],
        paymentSlipPrinterIds: [p3],
      }),
    );
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [],
      }),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual({
      receiptPrinterIds: [p2, p1],
      paymentSlipPrinterIds: [],
    });
  });

  it("accepts the same printer on both lists", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p1],
      }),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual({
      receiptPrinterIds: [p1],
      paymentSlipPrinterIds: [p1],
    });
  });

  it("reads empty lists for a profile that has none", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    expect(await inTx((tx) => readProfilePrinterLists(tx, profileId))).toEqual({
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
    });
  });

  it("picks the first active printer at the device's location in each list", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [p3],
      }),
    );
    expect(await inTx((tx) => firstUsablePrinters(tx, profileId, loc))).toEqual({
      receiptPrinterId: p2,
      paymentSlipPrinterId: p3,
    });
    await setActive(p2, false);
    try {
      expect(await inTx((tx) => firstUsablePrinters(tx, profileId, loc))).toEqual({
        receiptPrinterId: p1,
        paymentSlipPrinterId: p3,
      });
    } finally {
      await setActive(p2, true);
    }
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, { receiptPrinterIds: [], paymentSlipPrinterIds: [] }),
    );
    expect(await inTx((tx) => firstUsablePrinters(tx, profileId, loc))).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
    });
  });

  it("offers a device's usable printers by name in list order", async () => {
    const { profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [away, p2, p3, p1],
        paymentSlipPrinterIds: [p3],
      }),
    );
    await setActive(p3, false);
    try {
      expect(await inTx((tx) => printerChoices(tx, profileId, loc))).toEqual({
        receipt: [
          { id: p2, name: "Counter" },
          { id: p1, name: "Bar" },
        ],
        paymentSlip: [],
      });
    } finally {
      await setActive(p3, true);
    }
  });

  it("moves a device whose printer leaves the list to the first one still listed, in the same transaction", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [p3],
      });
      expect(await chooseDevicePrinter(tx, deviceId, "receipt", p2)).toEqual({ ok: true });
      expect(await chooseDevicePrinter(tx, deviceId, "payment_slip", p3)).toEqual({ ok: true });
    });
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: p2,
      paymentSlipPrinterId: p3,
    });

    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p3],
      });
      const [inside] = await tx
        .select({ receiptPrinterId: devices.receiptPrinterId })
        .from(devices)
        .where(eq(devices.id, deviceId));
      expect(inside).toEqual({ receiptPrinterId: p1 });
    });
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: p1,
      paymentSlipPrinterId: p3,
    });

    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [p3],
      }),
    );
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: p3,
    });
  });

  it("leaves a device holding no printer on none when the lists change", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p3],
      }),
    );
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
    });
  });

  it("keeps a device on a switched-off printer that is still listed when another list changes", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [p3],
      });
      await chooseDevicePrinter(tx, deviceId, "receipt", p2);
    });
    await setActive(p2, false);
    try {
      await inTx((tx) =>
        setProfilePrinterLists(tx, profileId, {
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [p1],
        }),
      );
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p2);
    } finally {
      await setActive(p2, true);
    }
  });

  it("moves a device off a delisted printer to the first ACTIVE one still listed", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p3, p2, p1],
        paymentSlipPrinterIds: [],
      });
      await chooseDevicePrinter(tx, deviceId, "receipt", p3);
    });
    await setActive(p2, false);
    try {
      await inTx((tx) =>
        setProfilePrinterLists(tx, profileId, {
          receiptPrinterIds: [p2, p1],
          paymentSlipPrinterIds: [],
        }),
      );
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p1);
    } finally {
      await setActive(p2, true);
    }
  });

  it("resettles devices on one profile at two locations, each to its own location's printer", async () => {
    const here = await seedDevice(suite.db, { locationId: loc });
    const there = await seedDevice(suite.db, { locationId: elsewhere, profileId: here.profileId });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, here.profileId, {
        receiptPrinterIds: [p1, away, p2],
        paymentSlipPrinterIds: [],
      });
      await chooseDevicePrinter(tx, here.deviceId, "receipt", p1);
      await chooseDevicePrinter(tx, there.deviceId, "receipt", away);
      await setProfilePrinterLists(tx, here.profileId, {
        receiptPrinterIds: [p2],
        paymentSlipPrinterIds: [],
      });
    });
    expect((await devicePrinters(here.deviceId))?.receiptPrinterId).toBe(p2);
    expect((await devicePrinters(there.deviceId))?.receiptPrinterId).toBeNull();
  });

  it("leaves devices on other profiles untouched", async () => {
    const mine = await seedDevice(suite.db, { locationId: loc });
    const other = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, mine.profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [],
      });
      await setProfilePrinterLists(tx, other.profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [],
      });
      await chooseDevicePrinter(tx, mine.deviceId, "receipt", p1);
      await chooseDevicePrinter(tx, other.deviceId, "receipt", p1);
      await setProfilePrinterLists(tx, mine.profileId, {
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [],
      });
    });
    expect((await devicePrinters(other.deviceId))?.receiptPrinterId).toBe(p1);
    expect((await devicePrinters(mine.deviceId))?.receiptPrinterId).toBeNull();
  });

  it("resettles a device moved onto another profile off the printers that profile does not list", async () => {
    const from = await seedDevice(suite.db, { locationId: loc });
    const to = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, from.profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p1],
      });
      await setProfilePrinterLists(tx, to.profileId, {
        receiptPrinterIds: [p2, p3],
        paymentSlipPrinterIds: [p3, p1],
      });
      await chooseDevicePrinter(tx, from.deviceId, "receipt", p1);
      await chooseDevicePrinter(tx, from.deviceId, "payment_slip", p1);
      await tx
        .update(devices)
        .set({ deviceProfileId: to.profileId })
        .where(eq(devices.id, from.deviceId));
      await resettleDevicesOnProfile(tx, to.profileId);
    });
    // The receipt printer is not on the new receipt list; the slip printer is, so it stays.
    expect(await devicePrinters(from.deviceId)).toEqual({
      receiptPrinterId: p2,
      paymentSlipPrinterId: p1,
    });
  });

  it("refuses a printer not on the device's list for that role, naming the field, and leaves the device unchanged", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p1],
        paymentSlipPrinterIds: [p3],
      });
      await chooseDevicePrinter(tx, deviceId, "payment_slip", p3);
    });
    expect(await inTx((tx) => chooseDevicePrinter(tx, deviceId, "payment_slip", p1))).toEqual({
      ok: false,
      field: "paymentSlipPrinterId",
    });
    expect(await inTx((tx) => chooseDevicePrinter(tx, deviceId, "receipt", p3))).toEqual({
      ok: false,
      field: "receiptPrinterId",
    });
    expect(await devicePrinters(deviceId)).toEqual({
      receiptPrinterId: null,
      paymentSlipPrinterId: p3,
    });

    expect(await inTx((tx) => chooseDevicePrinter(tx, deviceId, "receipt", p1))).toEqual({
      ok: true,
    });
    expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p1);
    expect(await inTx((tx) => chooseDevicePrinter(tx, deviceId, "receipt", null))).toEqual({
      ok: true,
    });
    expect((await devicePrinters(deviceId))?.receiptPrinterId).toBeNull();
  });

  it("never picks or accepts a listed printer at another location", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx((tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [away, p1],
        paymentSlipPrinterIds: [away],
      }),
    );
    expect(await inTx((tx) => firstUsablePrinters(tx, profileId, loc))).toEqual({
      receiptPrinterId: p1,
      paymentSlipPrinterId: null,
    });
    expect(await inTx((tx) => chooseDevicePrinter(tx, deviceId, "receipt", away))).toEqual({
      ok: false,
      field: "receiptPrinterId",
    });
    expect((await devicePrinters(deviceId))?.receiptPrinterId).toBeNull();
  });

  it("refuses an unknown device as it refuses an unlisted printer", async () => {
    expect(
      await inTx((tx) =>
        chooseDevicePrinter(tx, "00000000-0000-4000-8000-000000000000", "receipt", p1),
      ),
    ).toEqual({ ok: false, field: "receiptPrinterId" });
  });

  it("keeps a deactivated current printer stored, and refuses choosing an inactive one", async () => {
    const { deviceId, profileId } = await seedDevice(suite.db, { locationId: loc });
    await inTx(async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2, p1],
        paymentSlipPrinterIds: [],
      });
      await chooseDevicePrinter(tx, deviceId, "receipt", p2);
    });
    await setActive(p2, false);
    try {
      expect((await devicePrinters(deviceId))?.receiptPrinterId).toBe(p2);
      await inTx((tx) => chooseDevicePrinter(tx, deviceId, "receipt", p1));
      expect(await inTx((tx) => chooseDevicePrinter(tx, deviceId, "receipt", p2))).toEqual({
        ok: false,
        field: "receiptPrinterId",
      });
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
      setProfilePrinterLists(tx, profile!.id, {
        receiptPrinterIds: [lonely],
        paymentSlipPrinterIds: [lonely],
      }),
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
