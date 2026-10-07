import {
  CORE_MIGRATIONS,
  captureError,
  deviceProfilePrinters,
  devices,
  locations,
  printerHolders,
  printers,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUnlistedPrinterChoices,
  readPrinterEquipment,
  readPrinterRoles,
  releaseDevicePrinters,
  resolveDevicePrinterId,
  resolveDevicePrinterIds,
  selectDevicePrinter,
  setPrinterPortable,
  settleDevicePrinters,
  settleProfilePrinterDevices,
} from "./device-equipment.js";
import {
  readProfilePrinterLists,
  setProfilePrinterLists,
  type ProfilePrinterLists,
  type ProfilePrinterRole,
} from "./device-printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

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

async function seedLocation(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name, invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  return row!.id;
}

async function seedPrinter(
  locationId: string,
  name: string,
  opts: { portable?: boolean; hasCashDrawer?: boolean } = {},
): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId,
      name,
      transport: "network_tcp",
      host: "10.0.0.1",
      portable: opts.portable ?? false,
      hasCashDrawer: opts.hasCashDrawer ?? false,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function columns(deviceId: string) {
  const [row] = await suite.db
    .select({
      receipt: devices.receiptPrinterId,
      slip: devices.paymentSlipPrinterId,
      drawer: devices.cashDrawerPrinterId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row!;
}

async function holders(): Promise<[string, string][]> {
  const rows = await suite.db
    .select({ printerId: printerHolders.printerId, deviceId: printerHolders.deviceId })
    .from(printerHolders)
    .orderBy(asc(printerHolders.printerId));
  return rows.map((r) => [r.printerId, r.deviceId]);
}

async function setActive(printerId: string, active: boolean): Promise<void> {
  await suite.db.update(printers).set({ active }).where(eq(printers.id, printerId));
}

function resolve(deviceId: string, role: ProfilePrinterRole): Promise<string | null> {
  return inTx((tx) => resolveDevicePrinterId(tx, deviceId, role));
}

function choose(
  deviceId: string,
  role: ProfilePrinterRole,
  selection: "default" | { id: string },
  via: "scan" | "list" | "manage" = "list",
  takeOver = false,
) {
  return inTx((tx) => selectDevicePrinter(tx, { deviceId, role, selection, via, takeOver }));
}

describe("which printer each of a device's roles resolves to", () => {
  let loc: string;
  let elsewhere: string;
  let profile: string;
  let a: string;
  let b: string;
  let f1: string;
  let f2: string;
  let p1: string;
  let drawer: string;
  let away: string;

  // `useVenueDb` empties every table after each test.
  beforeEach(async () => {
    await seedTenant(suite.db);
    loc = await seedLocation("Here");
    elsewhere = await seedLocation("Elsewhere");
    const first = await seedDevice(suite.db, { locationId: loc, label: "Till A" });
    profile = first.profileId;
    a = first.deviceId;
    b = (await seedDevice(suite.db, { locationId: loc, label: "Till B", profileId: profile }))
      .deviceId;
    f1 = await seedPrinter(loc, "Bar");
    f2 = await seedPrinter(loc, "Counter");
    p1 = await seedPrinter(loc, "Handheld", { portable: true });
    await seedPrinter(loc, "Handheld 2", { portable: true });
    drawer = await seedPrinter(loc, "Drawer", { hasCashDrawer: true });
    away = await seedPrinter(elsewhere, "Other venue");
  });

  it.each<[ProfilePrinterRole, "receipt" | "slip" | "drawer"]>([
    ["receipt", "receipt"],
    ["payment_slip", "slip"],
    ["cash_drawer", "drawer"],
  ])("resolves the %s role's explicit choice", async (role, column) => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({
          receiptPrinterIds: [f1, f2],
          paymentSlipPrinterIds: [f1, f2],
          cashDrawerPrinterIds: [drawer],
        }),
      ),
    );
    const chosen = role === "cash_drawer" ? drawer : f2;
    expect(await choose(a, role, { id: chosen })).toEqual({
      ok: true,
      previousHolderDeviceId: null,
    });
    expect((await columns(a))[column]).toBe(chosen);
    expect(await resolve(a, role)).toBe(chosen);
  });

  it("Use default resolves the profile default, and None when the profile has no default", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({
          receiptPrinterIds: [f1, f2],
          receiptPrinterDefaultId: f2,
          paymentSlipPrinterIds: [f1],
        }),
      ),
    );
    expect(await resolve(a, "receipt")).toBe(f2);
    expect(await resolve(a, "payment_slip")).toBeNull();
    expect(await resolve(a, "cash_drawer")).toBeNull();
    expect(await inTx((tx) => readProfilePrinterLists(tx, profile))).toEqual(
      lists({
        receiptPrinterIds: [f1, f2],
        receiptPrinterDefaultId: f2,
        paymentSlipPrinterIds: [f1],
      }),
    );
  });

  it.each([
    ["receiptPrinterDefaultId", { receiptPrinterIds: [], receiptPrinterDefaultId: "F2" }],
    ["paymentSlipPrinterDefaultId", { paymentSlipPrinterDefaultId: "F2" }],
    ["cashDrawerPrinterDefaultId", { cashDrawerPrinterDefaultId: "F2" }],
  ] as const)(
    "refuses a default not in its list as device_profile.invalid naming %s, storing nothing",
    async (field, partial) => {
      const stored = lists({ receiptPrinterIds: [f1] });
      await inTx((tx) => setProfilePrinterLists(tx, profile, stored));
      const resolved = Object.fromEntries(
        Object.entries(partial).map(([k, v]) => [k, v === "F2" ? f2 : v]),
      );
      const e = await captureError(() =>
        inTx((tx) =>
          setProfilePrinterLists(tx, profile, lists({ receiptPrinterIds: [f1], ...resolved })),
        ),
      );
      expect(e).toBeInstanceOf(AppError);
      expect([(e as AppError).code, (e as AppError).params]).toEqual([
        "device_profile.invalid",
        { reason: "default_not_listed", field },
      ]);
      expect(await inTx((tx) => readProfilePrinterLists(tx, profile))).toEqual(stored);
    },
  );

  it("refuses a newly listed drawer printer without a cash drawer, storing nothing", async () => {
    const e = await captureError(() =>
      inTx((tx) =>
        setProfilePrinterLists(tx, profile, lists({ cashDrawerPrinterIds: [drawer, f1] })),
      ),
    );
    expect(e).toBeInstanceOf(AppError);
    expect([(e as AppError).code, (e as AppError).params]).toEqual([
      "device_profile.invalid",
      { reason: "no_cash_drawer", field: "cashDrawerPrinterIds" },
    ]);
    expect(await inTx((tx) => readProfilePrinterLists(tx, profile))).toEqual(lists({}));
  });

  it("accepts a newly listed drawer printer with a cash drawer", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ cashDrawerPrinterIds: [drawer], cashDrawerPrinterDefaultId: drawer }),
      ),
    );
    expect(await inTx((tx) => readProfilePrinterLists(tx, profile))).toEqual(
      lists({ cashDrawerPrinterIds: [drawer], cashDrawerPrinterDefaultId: drawer }),
    );
    expect(await resolve(a, "cash_drawer")).toBe(drawer);
  });

  it("a listed drawer printer whose drawer flag was switched off later does not block an unrelated save", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(tx, profile, lists({ cashDrawerPrinterIds: [drawer] })),
    );
    await suite.db.update(printers).set({ hasCashDrawer: false }).where(eq(printers.id, drawer));
    const next = lists({ receiptPrinterIds: [f1], cashDrawerPrinterIds: [drawer] });
    await inTx((tx) => setProfilePrinterLists(tx, profile, next));
    expect(await inTx((tx) => readProfilePrinterLists(tx, profile))).toEqual(next);
  });

  it.each(["at another location", "unlisted", "switched off"] as const)(
    "refuses a printer %s as not_permitted, leaving the device unchanged",
    async (shape) => {
      await inTx((tx) =>
        setProfilePrinterLists(tx, profile, lists({ receiptPrinterIds: [away, f1] })),
      );
      if (shape === "switched off") await setActive(f1, false);
      const target = shape === "at another location" ? away : shape === "unlisted" ? f2 : f1;
      expect(await choose(a, "receipt", { id: target })).toEqual({
        ok: false,
        refusal: "not_permitted",
      });
      expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer: null });
    },
  );

  it("accepts a listed, switched-on printer at the device's location", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(tx, profile, lists({ receiptPrinterIds: [away, f1] })),
    );
    expect(await choose(a, "receipt", { id: f1 })).toEqual({
      ok: true,
      previousHolderDeviceId: null,
    });
    expect(await columns(a)).toEqual({ receipt: f1, slip: null, drawer: null });
  });

  it("a portable default held by another device resolves None and reports its holder, taking nothing", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1], receiptPrinterDefaultId: p1 }),
      ),
    );
    await choose(b, "receipt", "default");
    expect(await holders()).toEqual([[p1, b]]);

    expect(await choose(a, "receipt", "default")).toEqual({
      ok: true,
      previousHolderDeviceId: null,
    });
    await inTx((tx) => settleDevicePrinters(tx, a, { acquire: true }));

    expect(await resolve(a, "receipt")).toBeNull();
    const roles = await inTx((tx) => readPrinterRoles(tx, a));
    expect(roles.find((r) => r.role === "receipt")).toEqual({
      role: "receipt",
      chosenId: null,
      chosenHolderDeviceId: null,
      defaultId: p1,
      defaultHolderDeviceId: b,
      resolvedId: null,
    });
    expect(await holders()).toEqual([[p1, b]]);
  });

  it("an explicit portable choice this device does not hold resolves None", async () => {
    await suite.db.update(devices).set({ receiptPrinterId: p1 }).where(eq(devices.id, a));
    await suite.db.insert(printerHolders).values({ printerId: p1, deviceId: b });
    expect(await resolve(a, "receipt")).toBeNull();
    const roles = await inTx((tx) => readPrinterRoles(tx, a));
    expect(roles.find((r) => r.role === "receipt")).toMatchObject({
      chosenId: p1,
      chosenHolderDeviceId: b,
      resolvedId: null,
    });
  });

  it("resolving several devices at once answers what each resolves alone, leaving unknown devices out", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1, f1], receiptPrinterDefaultId: p1 }),
      ),
    );
    await choose(a, "receipt", "default");
    const other = await seedDevice(suite.db, { locationId: loc, label: "Till C" });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        other.profileId,
        lists({ receiptPrinterIds: [f2], receiptPrinterDefaultId: f2 }),
      ),
    );
    // Its profile's default is a fixed printer at another location, so it resolves None.
    const awayTill = (
      await seedDevice(suite.db, {
        locationId: elsewhere,
        label: "Away",
        profileId: other.profileId,
      })
    ).deviceId;
    const unknown = "00000000-0000-4000-8000-000000000000";
    const ids = [a, b, other.deviceId, awayTill];

    const batch = await inTx((tx) => resolveDevicePrinterIds(tx, [...ids, unknown], "receipt"));

    const alone = new Map<string, string | null>();
    for (const id of ids) alone.set(id, await resolve(id, "receipt"));
    expect(batch).toEqual(alone);
    expect(batch).toEqual(
      new Map([
        [a, p1],
        [b, null],
        [other.deviceId, f2],
        [awayTill, null],
      ]),
    );
    expect(await inTx((tx) => resolveDevicePrinterIds(tx, [], "receipt"))).toEqual(new Map());
    expect(await inTx((tx) => resolveDevicePrinterIds(tx, [unknown], "receipt"))).toEqual(
      new Map(),
    );
  });

  it("reads each device's roles with every printer its profile lists, in list order, and who holds each", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({
          receiptPrinterIds: [away, p1, f1],
          receiptPrinterDefaultId: p1,
          cashDrawerPrinterIds: [drawer],
        }),
      ),
    );
    await choose(b, "receipt", "default");
    await setActive(f1, false);
    const unknown = "00000000-0000-4000-8000-000000000000";

    const read = await inTx((tx) => readPrinterEquipment(tx, [a, b, unknown], { lists: true }));

    expect(read.devices.map((device) => device.id).sort()).toEqual([a, b].sort());
    expect(read.devices.find((device) => device.id === a)).toEqual({
      id: a,
      profileId: profile,
      locationId: loc,
    });
    expect(read.roles.get(a)).toEqual(await inTx((tx) => readPrinterRoles(tx, a)));
    expect(read.roles.get(b)).toEqual(await inTx((tx) => readPrinterRoles(tx, b)));
    expect(read.listed.filter((row) => row.role === "receipt")).toEqual([
      {
        profileId: profile,
        role: "receipt",
        id: away,
        locationId: elsewhere,
        active: true,
        isDefault: false,
      },
      {
        profileId: profile,
        role: "receipt",
        id: p1,
        locationId: loc,
        active: true,
        isDefault: true,
      },
      {
        profileId: profile,
        role: "receipt",
        id: f1,
        locationId: loc,
        active: false,
        isDefault: false,
      },
    ]);
    expect(read.listed.filter((row) => row.role !== "receipt")).toEqual([
      {
        profileId: profile,
        role: "cash_drawer",
        id: drawer,
        locationId: loc,
        active: true,
        isDefault: false,
      },
    ]);
    expect(read.printers.get(p1)).toEqual({
      id: p1,
      name: "Handheld",
      portable: true,
      active: true,
      holderDeviceId: b,
    });
    expect(read.printers.get(f1)).toMatchObject({ active: false, holderDeviceId: null });
    expect([...read.printers.keys()].sort()).toEqual([away, p1, f1, drawer].sort());
    const unlisted = await inTx((tx) => readPrinterEquipment(tx, [a, b], { lists: false }));
    expect(unlisted.roles).toEqual(read.roles);
    expect(unlisted.listed).toEqual([]);
    expect([...unlisted.printers.keys()]).toEqual([p1]);
    expect(await inTx((tx) => readPrinterEquipment(tx, [], { lists: true }))).toEqual({
      devices: [],
      roles: new Map(),
      printers: new Map(),
      listed: [],
    });
    expect(
      (await inTx((tx) => readPrinterEquipment(tx, [unknown], { lists: true }))).devices,
    ).toEqual([]);
  });

  it("a fixed explicit choice resolves with no holder row", async () => {
    await suite.db.update(devices).set({ receiptPrinterId: f1 }).where(eq(devices.id, a));
    expect(await resolve(a, "receipt")).toBe(f1);
    expect(await holders()).toEqual([]);
  });

  it("choosing Use default takes a free portable default", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1], receiptPrinterDefaultId: p1 }),
      ),
    );
    expect(await choose(a, "receipt", "default")).toEqual({
      ok: true,
      previousHolderDeviceId: null,
    });
    expect(await holders()).toEqual([[p1, a]]);
    expect(await resolve(a, "receipt")).toBe(p1);
  });

  it("a profile list edit takes nothing for a device on Use default", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1], receiptPrinterDefaultId: p1 }),
      ),
    );
    expect(await holders()).toEqual([]);
    expect(await resolve(a, "receipt")).toBeNull();
  });

  it("a list selection of a portable printer another device holds is refused, and a scan takes it over", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1, f1], paymentSlipPrinterIds: [p1] }),
      ),
    );
    await choose(b, "receipt", { id: p1 });
    await choose(b, "payment_slip", { id: p1 });
    expect(await choose(a, "receipt", { id: p1 })).toEqual({
      ok: false,
      refusal: "held",
      holderDeviceId: b,
    });
    expect(await choose(a, "receipt", { id: p1 }, "manage", true)).toEqual({
      ok: false,
      refusal: "held",
      holderDeviceId: b,
    });
    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await holders()).toEqual([[p1, b]]);

    expect(await choose(a, "receipt", { id: p1 }, "scan")).toEqual({
      ok: true,
      previousHolderDeviceId: b,
    });
    expect(await holders()).toEqual([[p1, a]]);
    expect(await columns(a)).toEqual({ receipt: p1, slip: null, drawer: null });
    expect(await columns(b)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await resolve(b, "receipt")).toBeNull();
  });

  it("a switched-off explicit choice stays chosen and held", async () => {
    await inTx((tx) => setProfilePrinterLists(tx, profile, lists({ receiptPrinterIds: [p1, f1] })));
    await choose(a, "receipt", { id: p1 });
    await setActive(p1, false);
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1, f1], paymentSlipPrinterIds: [f1] }),
      ),
    );
    await inTx((tx) => settleDevicePrinters(tx, a, { acquire: true }));
    expect((await columns(a)).receipt).toBe(p1);
    expect(await holders()).toEqual([[p1, a]]);
    expect(await resolve(a, "receipt")).toBe(p1);
  });

  it("a list edit clears an explicit choice no longer listed, back to Use default, and releases its hold", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1, f1], cashDrawerPrinterIds: [drawer] }),
      ),
    );
    await choose(a, "receipt", { id: p1 });
    await choose(a, "cash_drawer", { id: drawer });
    expect(await holders()).toEqual([[p1, a]]);
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [f1], receiptPrinterDefaultId: f1 }),
      ),
    );
    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await holders()).toEqual([]);
    expect(await resolve(a, "receipt")).toBe(f1);
  });

  it("a list edit settles every device on the profile in three reads, releasing only what each no longer uses", async () => {
    const p2 = await seedPrinter(loc, "Handheld 3", { portable: true });
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [p1, p2], receiptPrinterDefaultId: p2 }),
      ),
    );
    await choose(a, "receipt", { id: p1 });
    await inTx((tx) => settleDevicePrinters(tx, b, { acquire: true }));
    expect(Object.fromEntries(await holders())).toEqual({ [p1]: a, [p2]: b });
    await suite.db
      .delete(deviceProfilePrinters)
      .where(
        and(
          eq(deviceProfilePrinters.deviceProfileId, profile),
          eq(deviceProfilePrinters.printerId, p1),
        ),
      );

    const reads = await inTx(async (tx) => {
      const selects = vi.spyOn(tx, "select");
      try {
        await settleProfilePrinterDevices(tx, profile);
        return selects.mock.calls.length;
      } finally {
        selects.mockRestore();
      }
    });

    expect(reads).toBe(3);
    expect((await columns(a)).receipt).toBeNull();
    expect(await holders()).toEqual([[p2, b]]);
  });

  it("after a move to another profile, clears each choice that profile does not list, keeping a listed one switched off or not", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({
          receiptPrinterIds: [f1],
          paymentSlipPrinterIds: [f2],
          cashDrawerPrinterIds: [drawer],
        }),
      ),
    );
    await choose(a, "receipt", { id: f1 });
    await choose(a, "payment_slip", { id: f2 });
    await choose(a, "cash_drawer", { id: drawer });
    const other = (await seedDevice(suite.db, { locationId: loc })).profileId;
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        other,
        lists({ receiptPrinterIds: [f1], paymentSlipPrinterIds: [f1] }),
      ),
    );
    await setActive(f1, false);
    await suite.db.update(devices).set({ deviceProfileId: other }).where(eq(devices.id, a));
    await inTx((tx) => clearUnlistedPrinterChoices(tx, a));
    expect(await columns(a)).toEqual({ receipt: f1, slip: null, drawer: null });
  });

  it("clearing an unknown device's unlisted choices changes nothing", async () => {
    await inTx((tx) => clearUnlistedPrinterChoices(tx, crypto.randomUUID()));
    expect(await holders()).toEqual([]);
  });

  it("a list edit keeps a choice still listed, switched off or not", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [f1, f2], paymentSlipPrinterIds: [f1] }),
      ),
    );
    await choose(a, "receipt", { id: f1 });
    await choose(b, "receipt", { id: f2 });
    await setActive(f2, false);
    await inTx((tx) => setProfilePrinterLists(tx, profile, lists({ receiptPrinterIds: [f1, f2] })));
    expect((await columns(a)).receipt).toBe(f1);
    expect((await columns(b)).receipt).toBe(f2);
  });

  it("the drawer choice is unchanged when the receipt choice changes", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({
          receiptPrinterIds: [f1, f2, drawer],
          receiptPrinterDefaultId: f1,
          cashDrawerPrinterIds: [drawer],
        }),
      ),
    );
    await choose(a, "cash_drawer", { id: drawer });
    await choose(a, "receipt", { id: drawer });
    expect((await columns(a)).drawer).toBe(drawer);
    await choose(a, "receipt", { id: f2 });
    expect((await columns(a)).drawer).toBe(drawer);
    await choose(a, "receipt", "default");
    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer });
    expect(await resolve(a, "cash_drawer")).toBe(drawer);
  });

  it("release lets go of every hold, keeping every choice", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({
          receiptPrinterIds: [p1],
          paymentSlipPrinterIds: [f1],
          cashDrawerPrinterIds: [drawer],
        }),
      ),
    );
    await choose(a, "receipt", { id: p1 });
    await choose(a, "payment_slip", { id: f1 });
    await choose(a, "cash_drawer", { id: drawer });
    await inTx((tx) => releaseDevicePrinters(tx, a));
    expect(await columns(a)).toEqual({ receipt: p1, slip: f1, drawer });
    expect(await holders()).toEqual([]);
  });

  describe("a kept portable choice after release", () => {
    beforeEach(async () => {
      await inTx((tx) =>
        setProfilePrinterLists(
          tx,
          profile,
          lists({ receiptPrinterIds: [p1, f1], receiptPrinterDefaultId: f1 }),
        ),
      );
      await choose(a, "receipt", { id: p1 });
      await inTx((tx) => releaseDevicePrinters(tx, a));
    });

    it("is taken again by a settle that acquires, when nobody holds it", async () => {
      await inTx((tx) => settleDevicePrinters(tx, a, { acquire: true }));
      expect(await columns(a)).toMatchObject({ receipt: p1 });
      expect(await holders()).toEqual([[p1, a]]);
      expect(await resolve(a, "receipt")).toBe(p1);
    });

    it("is cleared back to Use default by a settle that acquires, when another device holds it", async () => {
      await choose(b, "receipt", { id: p1 }, "scan");
      await inTx((tx) => settleDevicePrinters(tx, a, { acquire: true }));
      expect(await columns(a)).toMatchObject({ receipt: null });
      expect(await holders()).toEqual([[p1, b]]);
      expect(await resolve(a, "receipt")).toBe(f1);
    });

    it("is neither taken nor cleared by a settle that acquires nothing", async () => {
      await choose(b, "receipt", { id: p1 }, "scan");
      await inTx((tx) => settleDevicePrinters(tx, a, { acquire: false }));
      expect(await columns(a)).toMatchObject({ receipt: p1 });
      expect(await holders()).toEqual([[p1, b]]);
    });
  });

  it("marking a printer portable clears every device's receipt/slip choice of it", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [f1], paymentSlipPrinterIds: [f1] }),
      ),
    );
    await choose(a, "receipt", { id: f1 });
    await choose(b, "receipt", { id: f1 });
    await choose(b, "payment_slip", { id: f1 });
    await inTx((tx) => setPrinterPortable(tx, f1, true));
    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await columns(b)).toEqual({ receipt: null, slip: null, drawer: null });
    expect(await holders()).toEqual([]);
    const [row] = await suite.db
      .select({ portable: printers.portable })
      .from(printers)
      .where(eq(printers.id, f1));
    expect(row!.portable).toBe(true);
  });

  it("marking a drawer printer portable keeps every device's drawer choice", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [drawer], cashDrawerPrinterIds: [drawer] }),
      ),
    );
    await choose(a, "cash_drawer", { id: drawer });
    await choose(b, "cash_drawer", { id: drawer });
    await choose(a, "receipt", { id: drawer });
    await inTx((tx) => setPrinterPortable(tx, drawer, true));
    expect(await columns(a)).toEqual({ receipt: null, slip: null, drawer });
    expect(await columns(b)).toEqual({ receipt: null, slip: null, drawer });
    expect(await resolve(b, "cash_drawer")).toBe(drawer);
  });

  it("marking a portable printer fixed drops its holder and keeps the holder's choice", async () => {
    await inTx((tx) => setProfilePrinterLists(tx, profile, lists({ receiptPrinterIds: [p1] })));
    await choose(a, "receipt", { id: p1 });
    expect(await holders()).toEqual([[p1, a]]);
    await inTx((tx) => setPrinterPortable(tx, p1, false));
    expect(await holders()).toEqual([]);
    expect((await columns(a)).receipt).toBe(p1);
    expect(await resolve(a, "receipt")).toBe(p1);
  });

  it("keeps the profile's rows in list order with one default flag", async () => {
    await inTx((tx) =>
      setProfilePrinterLists(
        tx,
        profile,
        lists({ receiptPrinterIds: [f2, f1], receiptPrinterDefaultId: f1 }),
      ),
    );
    const rows = await suite.db
      .select({
        printerId: deviceProfilePrinters.printerId,
        position: deviceProfilePrinters.position,
        isDefault: deviceProfilePrinters.isDefault,
      })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, profile))
      .orderBy(asc(deviceProfilePrinters.position));
    expect(rows).toEqual([
      { printerId: f2, position: 0, isDefault: false },
      { printerId: f1, position: 1, isDefault: true },
    ]);
  });
});
