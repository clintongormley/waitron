import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenCourses,
  products,
  setMenuDishCourses,
  setMenuLineCourses,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  patchLiveMenu,
  previewMenu,
  updateMenuDetails,
  updateMenuItem,
  updateProduct,
} from "@waitron/menu";
import {
  listZoneOffers,
  listZoneSetMenus,
  menuState,
  offeredKey,
  productsOfferedIn,
  resolveZoneContext,
} from "./operations.js";
import { setMenuFixture } from "./testing/set-menu-fixtures.js";
import { readBusinessDayScheduleRevision } from "./business-day-schedule.js";
import { replaceMenuWeek } from "./menu-timetable.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
type Fixture = Awaited<ReturnType<typeof setMenuFixture>>;
const scenario = (test: (tx: Transaction, f: Fixture) => Promise<void>) =>
  withTransaction(suite.db, async (tx) => test(tx, await setMenuFixture(tx)));
const served = (tx: Transaction, f: Fixture) => listZoneOffers(tx, f.zoneId, { at: f.midday });

afterEach(() => vi.useRealTimers());
function advanceClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 60_000);
}

async function differentCopies(tx: Transaction, f: Fixture) {
  await f.place(f.brunch);
  const lunch = await f.publish();
  advanceClock();
  await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
  const brunch = await f.publish(f.brunch);
  return { lunch: lunch.versionId, brunch: brunch.versionId };
}

it("serves Lunch's Daily menu with its published terms and keeps its dishes out of ordinary offers", () =>
  scenario(async (tx, f) => {
    const { versionId } = await f.publish();
    const result = await served(tx, f);
    expect(result.setMenus).toEqual(expect.any(Array));
    expect(result.setMenus).toHaveLength(1);
    const [copy] = result.setMenus;
    expect(copy).toMatchObject({
      menuId: f.daily,
      key: expect.stringMatching(new RegExp(`^${f.daily}:[0-9a-f]{64}$`)),
      versionIds: [versionId],
      orderable: true,
      name: "Daily menu",
      terms: { price: "14.00", vatClass: "reduced", takeawayVatClass: "general" },
      structure: {
        members: expect.arrayContaining([expect.objectContaining({ menuItemId: f.soupItem })]),
      },
    });
    expect(copy?.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: f.soupItem,
          productId: f.soup,
          unitPrice: "0.00",
          countsAsCourseId: f.starters,
        }),
        expect.objectContaining({ productId: f.sirloin, unitPrice: "5.00" }),
      ]),
    );
    expect(result.offers.map(({ productId, unitPrice }) => [productId, unitPrice])).toEqual([
      [f.sirloin, "18.00"],
    ]);
  }));

it("serves a copy held only by a menu outside its service period as not orderable", () =>
  scenario(async (tx, f) => {
    await f.publish();
    const result = await listZoneOffers(tx, f.zoneId, { at: f.evening });
    expect(result.defaultMenuId).toBe(f.dinner);
    expect(result.setMenus).toMatchObject([
      { menuId: f.daily, orderable: false, newestOnSale: false },
    ]);
  }));

it("polls copy-only availability and keeps the copy key when the dish sells out", () =>
  scenario(async (tx, f) => {
    await f.publish();
    const before = await served(tx, f);
    expect((await menuState(tx, f.zoneId, f.midday)).liveFields).toBe(before.liveFields);
    expect(before.setMenus?.[0]?.offers.find(({ id }) => id === f.soupItem)?.available).toBe(true);

    await tx.update(products).set({ available: false }).where(eq(products.id, f.soup));
    const after = await served(tx, f);
    const state = await menuState(tx, f.zoneId, f.midday);
    expect(after.setMenus?.[0]?.offers.find(({ id }) => id === f.soupItem)?.available).toBe(false);
    expect(after.setMenus?.[0]?.key).toBe(before.setMenus?.[0]?.key);
    expect(state.unavailable.products).toEqual([f.soup]);
    expect(state.liveFields).toBe(after.liveFields);
    expect(after.liveFields).not.toBe(before.liveFields);
  }));

it.each(["sirloin", "largeBravas"] as const)(
  "refreshes the copied availability after selling out %s",
  (dish) =>
    scenario(async (tx, f) => {
      await f.publish();
      const before = await served(tx, f);
      const productId = f[dish];
      await tx.update(products).set({ available: false }).where(eq(products.id, productId));
      const after = await served(tx, f);
      const state = await menuState(tx, f.zoneId, f.midday);
      expect(state.unavailable.products).toContain(productId);
      expect(state.liveFields).toBe(after.liveFields);
      expect(after.liveFields).not.toBe(before.liveFields);
    }),
);

it("keeps copy-only dishes out of ordinary product eligibility and keeps the ordinary price in Preview", () =>
  scenario(async (tx, f) => {
    await f.publish();
    const offered = await productsOfferedIn(
      tx,
      f.zoneId,
      [f.lunch],
      [
        { productId: f.soup, variantId: null },
        { productId: f.sirloin, variantId: null },
      ],
    );
    expect([...offered]).toEqual([offeredKey(f.sirloin, null)]);
    const ordinary = (await served(tx, f)).offers[0]!;
    await updateMenuItem(tx, f.lunch, ordinary.id, { grossPrice: "20.00" });
    const preview = await previewMenu(tx, f.lunch);
    expect(preview.changes).toEqual([
      expect.objectContaining({
        kind: "price_changed",
        from: "18.00",
        to: "20.00",
      }),
    ]);
  }));

it("serves the published price until the full menu is published again", () =>
  scenario(async (tx, f) => {
    const first = await f.publish();
    await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
    expect((await served(tx, f)).setMenus).toMatchObject([
      { versionIds: [first.versionId], terms: { price: "14.00" } },
    ]);
    const second = await f.publish();
    expect((await served(tx, f)).setMenus).toMatchObject([
      { versionIds: [second.versionId], terms: { price: "15.00" } },
    ]);
  }));

it("serves an identical copy once and holds two distinct copies side by side", () =>
  scenario(async (tx, f) => {
    await f.place(f.brunch);
    const lunch = await f.publish();
    const brunch = await f.publish(f.brunch);
    const versionIds = [lunch.versionId, brunch.versionId].sort();
    expect((await served(tx, f)).setMenus).toMatchObject([{ versionIds }]);

    advanceClock();
    await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
    const newer = await f.publish(f.brunch);
    const { setMenus } = await served(tx, f);
    expect(setMenus).toHaveLength(2);
    expect(setMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionIds: [lunch.versionId],
          newestOnSale: false,
          terms: expect.objectContaining({ price: "14.00" }),
        }),
        expect.objectContaining({
          versionIds: [newer.versionId],
          newestOnSale: true,
          terms: expect.objectContaining({ price: "15.00" }),
        }),
      ]),
    );
    expect(new Set(setMenus.map(({ key }) => key)).size).toBe(2);
    const republished = await f.publish();
    expect((await served(tx, f)).setMenus).toMatchObject([
      {
        versionIds: [republished.versionId, newer.versionId].sort(),
        newestOnSale: true,
      },
    ]);
  }));

it("keeps the published course for counting when a dish and its variant move courses", () =>
  scenario(async (tx, f) => {
    await f.publish();
    await tx.update(products).set({ courseId: f.mains }).where(eq(products.id, f.bravas));
    await tx.update(products).set({ courseId: f.sharing }).where(eq(products.id, f.largeBravas));
    const copy = (await served(tx, f)).setMenus?.[0];
    expect(copy?.offers.find(({ id }) => id === f.bravasItem)).toMatchObject({
      courseId: f.mains,
      countsAsCourseId: f.sharing,
      variantCountsAs: { [f.largeBravas]: f.drinks },
      variants: [{ id: f.largeBravas, courseId: f.sharing }],
    });
  }));

it.each(["inactive", "deleted"] as const)(
  "falls back to live sending courses when the copied override is %s",
  (disposition) =>
    scenario(async (tx, f) => {
      const [{ id: override }] = await tx
        .insert(kitchenCourses)
        .values({ name: "Special course", displayOrder: 4 })
        .returning({ id: kitchenCourses.id });
      await tx.insert(setMenuDishCourses).values({ menuItemId: f.bravasItem, courseId: override });
      await tx
        .update(setMenuLineCourses)
        .set({ courseId: override })
        .where(eq(setMenuLineCourses.courseId, f.drinks));
      await f.publish();
      await tx.update(products).set({ courseId: f.starters }).where(eq(products.id, f.bravas));
      const before = await served(tx, f);
      const bravas = (snapshot: typeof before) =>
        snapshot.setMenus?.[0]?.offers.find(({ id }) => id === f.bravasItem);
      expect(bravas(before)).toMatchObject({
        courseId: override,
        countsAsCourseId: override,
        variantCountsAs: { [f.largeBravas]: override },
        variants: [{ id: f.largeBravas, courseId: override }],
      });
      await tx.delete(setMenuDishCourses).where(eq(setMenuDishCourses.menuItemId, f.bravasItem));
      await tx.delete(setMenuLineCourses).where(eq(setMenuLineCourses.courseId, override));
      if (disposition === "inactive") {
        await tx
          .update(kitchenCourses)
          .set({ active: false })
          .where(eq(kitchenCourses.id, override));
      } else {
        await tx.delete(kitchenCourses).where(eq(kitchenCourses.id, override));
      }
      const after = await served(tx, f);
      expect(bravas(after)).toMatchObject({
        courseId: f.starters,
        countsAsCourseId: override,
        variantCountsAs: { [f.largeBravas]: override },
        variants: [{ id: f.largeBravas, courseId: f.drinks }],
      });
      expect(after.liveFields).not.toBe(before.liveFields);
      expect((await menuState(tx, f.zoneId, f.midday)).liveFields).toBe(after.liveFields);
    }),
);

it("omits copies from a read for named menu items", () =>
  scenario(async (tx, f) => {
    await f.publish();
    const whole = await served(tx, f);
    const ordinary = whole.offers[0]!;
    const named = await listZoneOffers(tx, f.zoneId, {
      at: f.midday,
      menuItemIds: [f.soupItem, ordinary.id],
    });
    expect(named.offers).toEqual([ordinary]);
    expect(named.setMenus).toEqual([]);
  }));

it("keeps the newer price selected after wording is corrected on the older copy", () =>
  scenario(async (tx, f) => {
    const versions = await differentCopies(tx, f);
    const before = await served(tx, f);
    const original = before.setMenus.find(({ versionIds }) => versionIds.includes(versions.lunch))!;
    advanceClock();
    const correction = await patchLiveMenu(
      tx,
      f.lunch,
      versions.lunch,
      [
        {
          target: { kind: "offer", menuItemId: before.offers[0]!.id },
          field: "name",
          value: "Grilled sirloin",
        },
      ],
      f.publisher,
    );
    const { setMenus } = await served(tx, f);
    expect(setMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionIds: [correction.versionId],
          changedAt: original.changedAt,
          newestOnSale: false,
          offers: expect.arrayContaining([
            expect.objectContaining({ productId: f.sirloin, name: "Grilled sirloin" }),
          ]),
        }),
        expect.objectContaining({ versionIds: [versions.brunch], newestOnSale: true }),
      ]),
    );
  }));

it("selects the copy from the most recent draft edit when its price is set back", () =>
  scenario(async (tx, f) => {
    const { brunch } = await differentCopies(tx, f);
    advanceClock();
    await updateMenuDetails(tx, f.daily, { setPrice: "14.00" });
    const lunch = await f.publish();
    expect((await served(tx, f)).setMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionIds: [lunch.versionId],
          terms: expect.objectContaining({ price: "14.00" }),
          newestOnSale: true,
        }),
        expect.objectContaining({ versionIds: [brunch], newestOnSale: false }),
      ]),
    );
  }));

it("breaks a tied draft timestamp by key and keeps each copy's own wording", () =>
  scenario(async (tx, f) => {
    await f.place(f.brunch);
    const lunch = await f.publish();
    await updateProduct(tx, f.soup, { name: "Soup of the day" });
    const brunch = await f.publish(f.brunch);
    const { setMenus } = await served(tx, f);
    const older = setMenus.find(({ versionIds }) => versionIds.includes(lunch.versionId))!;
    const later = setMenus.find(({ versionIds }) => versionIds.includes(brunch.versionId))!;
    expect(older.changedAt).toBe(later.changedAt);
    expect(older.offers.find(({ id }) => id === f.soupItem)?.name).toBe("Soup");
    expect(later.offers.find(({ id }) => id === f.soupItem)?.name).toBe("Soup of the day");
    const smallestKey = [older.key, later.key].sort()[0];
    expect(setMenus.filter(({ newestOnSale }) => newestOnSale).map(({ key }) => key)).toEqual([
      smallestKey,
    ]);
  }));

it("selects the newest copy on sale even when a later copy is held for another period", () =>
  scenario(async (tx, f) => {
    const lunch = await f.publish();
    await f.place(f.dinner);
    advanceClock();
    await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
    const dinner = await f.publish(f.dinner);
    expect((await served(tx, f)).setMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionIds: [lunch.versionId],
          orderable: true,
          newestOnSale: true,
        }),
        expect.objectContaining({
          versionIds: [dinner.versionId],
          orderable: false,
          newestOnSale: false,
        }),
      ]),
    );
    const republished = await f.publish();
    for (const at of [f.midday, f.evening]) {
      expect((await listZoneOffers(tx, f.zoneId, { at })).setMenus).toMatchObject([
        {
          versionIds: [republished.versionId, dinner.versionId].sort(),
          orderable: true,
          newestOnSale: true,
        },
      ]);
    }
  }));

it.each(["midday", "evening"] as const)(
  "answers the set-menu copies and selling versions the whole zone read answers, at %s",
  (when) =>
    scenario(async (tx, f) => {
      await differentCopies(tx, f);
      const whole = await listZoneOffers(tx, f.zoneId, { at: f[when] });
      const narrow = await listZoneSetMenus(tx, f.zoneId, f[when]);
      expect(narrow.setMenus).toEqual(whole.setMenus);
      expect(narrow.setMenus.length).toBeGreaterThan(1);
      expect(narrow.sellingVersionIds.length).toBeGreaterThan(0);
      expect(narrow.sellingVersionIds).toEqual(
        whole.menus.filter(({ orderable }) => orderable).map(({ versionId }) => versionId),
      );
    }),
);

it("answers the whole zone read's set menus for a department with no menu week", () =>
  scenario(async (tx, f) => {
    await differentCopies(tx, f);
    const { departmentId } = await resolveZoneContext(tx, f.zoneId);
    await replaceMenuWeek(
      tx,
      departmentId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
      f.midday,
      await readBusinessDayScheduleRevision(tx),
    );
    const whole = await listZoneOffers(tx, f.zoneId, { at: f.midday });
    const narrow = await listZoneSetMenus(tx, f.zoneId, f.midday);
    expect(narrow.setMenus).toEqual(whole.setMenus);
    expect(narrow.setMenus.length).toBeGreaterThan(1);
    expect(narrow.sellingVersionIds).toEqual(
      whole.menus.filter(({ orderable }) => orderable).map(({ versionId }) => versionId),
    );
  }));

it("answers no set menus and no selling versions for a zone whose live menus hold none", () =>
  scenario(async (tx, f) => {
    expect((await listZoneOffers(tx, f.zoneId, { at: f.midday })).setMenus).toEqual([]);
    expect(await listZoneSetMenus(tx, f.zoneId, f.midday)).toEqual({
      setMenus: [],
      sellingVersionIds: [],
    });
  }));
