import { withTransaction } from "@waitron/db";
import { seedPerson, seedVenue } from "@waitron/db/testing/seed.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMenuDb } from "../test/fixtures.js";
import {
  createMenu,
  duplicateMenu,
  previewMenu,
  queueMenuPublication,
  readCustomerMenuOnlineSettings,
  saveCustomerMenuOnlineSettings,
} from "./index.js";
import { liveVersions } from "./menu-publication.js";

const fx = useMenuDb();
const personId = "person-1";
const firstDay = new Date("2026-11-27T10:00:00.000Z");
const nextDay = new Date("2026-11-28T10:00:00.000Z");

beforeEach(async () => {
  await seedVenue(fx.db, { name: "Main" });
  await seedPerson(fx.db, { id: personId, displayName: "Menu manager" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(firstDay);
});
afterEach(() => vi.useRealTimers());

it("starts a new menu offline, without an address and with large photos", async () => {
  const value = await withTransaction(fx.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Lunch" });
    return readCustomerMenuOnlineSettings(tx, menu.id);
  });

  expect(value).toEqual({ enabled: false, address: null, photos: "large" });
});

it("duplicates the photo size without copying the source address or switching the copy on", async () => {
  const value = await withTransaction(fx.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Lunch" });
    const { hash } = await previewMenu(tx, menu.id);
    await queueMenuPublication(tx, menu.id, hash, nextDay, personId);
    vi.setSystemTime(nextDay);
    await saveCustomerMenuOnlineSettings(tx, menu.id, {
      enabled: true,
      address: "lunch",
      photos: "small",
    });
    const copy = await duplicateMenu(tx, menu.id, "Lunch copy");
    return readCustomerMenuOnlineSettings(tx, copy.id);
  });

  expect(value).toEqual({ enabled: false, address: null, photos: "small" });
});

it("reserves an offline menu's address and leaves a refused save unchanged", async () => {
  const otherId = await withTransaction(fx.db, async (tx) => {
    const held = await createMenu(tx, { name: "Lunch" });
    const other = await createMenu(tx, { name: "Dinner" });
    await saveCustomerMenuOnlineSettings(tx, held.id, {
      enabled: false,
      address: "lunch",
      photos: "small",
    });
    return other.id;
  });

  await expect(
    withTransaction(fx.db, (tx) =>
      saveCustomerMenuOnlineSettings(tx, otherId, {
        enabled: false,
        address: "lunch",
        photos: "none",
      }),
    ),
  ).rejects.toMatchObject({
    code: "customer_menu.address_taken",
    params: { field: "address" },
  });
  expect(await withTransaction(fx.db, (tx) => readCustomerMenuOnlineSettings(tx, otherId))).toEqual(
    { enabled: false, address: null, photos: "large" },
  );
});

it.each(["Lunch", "lunch/menu", "lunch\n", "-lunch", "x".repeat(64)])(
  "refuses the invalid address %j even while offline",
  async (address) => {
    await expect(
      withTransaction(fx.db, async (tx) => {
        const menu = await createMenu(tx, { name: "Lunch" });
        await saveCustomerMenuOnlineSettings(tx, menu.id, {
          enabled: false,
          address,
          photos: "large",
        });
      }),
    ).rejects.toMatchObject({
      code: "customer_menu.address_invalid",
      params: { field: "address" },
    });
  },
);

it("requires an address to go online", async () => {
  await expect(
    withTransaction(fx.db, async (tx) => {
      const menu = await createMenu(tx, { name: "Lunch" });
      await saveCustomerMenuOnlineSettings(tx, menu.id, {
        enabled: true,
        address: null,
        photos: "large",
      });
    }),
  ).rejects.toMatchObject({
    code: "customer_menu.address_invalid",
    params: { field: "address" },
  });
});

it("allows enabling a due edition without publishing another edition", async () => {
  const { menuId, edition } = await withTransaction(fx.db, async (tx) => {
    const menu = await createMenu(tx, { name: "Lunch" });
    const { hash } = await previewMenu(tx, menu.id);
    const edition = await queueMenuPublication(tx, menu.id, hash, nextDay, personId);
    return { menuId: menu.id, edition };
  });
  const settings = { enabled: true, address: "3-course-lunch", photos: "none" } as const;
  const save = () =>
    withTransaction(fx.db, (tx) => saveCustomerMenuOnlineSettings(tx, menuId, settings));

  await expect(save()).rejects.toMatchObject({ code: "customer_menu.not_published" });
  vi.setSystemTime(nextDay);
  await expect(save()).resolves.toEqual(settings);
  const live = await withTransaction(fx.db, async (tx) => {
    expect(await readCustomerMenuOnlineSettings(tx, menuId)).toEqual(settings);
    return (await liveVersions(tx, [menuId], "format")).get(menuId);
  });
  expect(live?.versionId).toBe(edition.versionId);
});
