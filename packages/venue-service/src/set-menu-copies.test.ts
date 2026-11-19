import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
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
import { createMenu, updateMenuDetails } from "@waitron/menu";
import { listZoneOffers } from "./operations.js";
import { serveRecordedSetMenus } from "./set-menu-copies.js";
import { setMenuFixture } from "./testing/set-menu-fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
type Fixture = Awaited<ReturnType<typeof setMenuFixture>>;
const scenario = (test: (tx: Transaction, f: Fixture) => Promise<void>) =>
  withTransaction(suite.db, async (tx) => test(tx, await setMenuFixture(tx)));

it("reads recorded versions in the requested order after the full menu is republished", () =>
  scenario(async (tx, f) => {
    const old = await f.publish();
    const before = (await listZoneOffers(tx, f.zoneId, { at: f.midday })).setMenus[0]!;
    await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
    const live = await f.publish();
    const current = (await listZoneOffers(tx, f.zoneId, { at: f.midday })).setMenus[0]!;
    const ask = (versionId: string) => ({ versionId, menuId: f.daily });
    const copies = await serveRecordedSetMenus(tx, [
      ask(live.versionId),
      ask(old.versionId),
      ask(live.versionId),
    ]);
    expect(copies.map(({ key, terms }) => [key, terms.price])).toEqual([
      [current.key, "15.00"],
      [before.key, "14.00"],
      [current.key, "15.00"],
    ]);
    expect(copies[1]).toEqual({
      key: before.key,
      menuId: before.menuId,
      name: before.name,
      terms: before.terms,
      changedAt: before.changedAt,
      structure: before.structure,
      offers: before.offers,
    });
  }));

it("applies the same live availability and course rule to a recorded copy", () =>
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
    const { versionId } = await f.publish();
    await tx.update(products).set({ available: false }).where(eq(products.id, f.bravas));
    const requested = [{ versionId, menuId: f.daily }];
    const recordedDish = async () =>
      (await serveRecordedSetMenus(tx, requested))[0]?.offers.find(({ id }) => id === f.bravasItem);
    expect(await recordedDish()).toMatchObject({
      available: false,
      courseId: override,
      countsAsCourseId: override,
    });
    await tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, override));
    expect(await recordedDish()).toMatchObject({
      available: false,
      courseId: f.sharing,
      countsAsCourseId: override,
    });
  }));

it.each(["without copies", "with another copy", "missing altogether"] as const)(
  "refuses a set menu missing from a version %s",
  (fixture) =>
    scenario(async (tx, f) => {
      const versionId =
        fixture === "missing altogether"
          ? crypto.randomUUID()
          : (await f.publish(fixture === "without copies" ? f.dinner : f.lunch)).versionId;
      const menuId =
        fixture === "with another copy"
          ? (
              await createMenu(tx, {
                kind: "set_menu",
                name: "Special",
                setPrice: "20.00",
                setVatClass: "reduced",
              })
            ).id
          : f.daily;
      await expect(serveRecordedSetMenus(tx, [{ versionId, menuId }])).rejects.toMatchObject({
        code: "set_menu.not_found",
        params: { menuId },
      });
    }),
);
