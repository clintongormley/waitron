import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workingOrders } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProductToMenu, createCatalogue, createProduct } from "@waitron/catalogue";
import {
  createServiceZone,
  replaceMenuWeek,
  saveMenuPeriod,
  seasons,
} from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  createBareDepartment,
  provisionSignedInTill,
  sendAsTill,
} from "./testing/signed-in-till.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** 00:15 on Sunday 1 December 2030 in Madrid (UTC+1): business day Saturday 30 November, Autumn. */
const SUNDAY_00_15 = new Date("2030-11-30T23:15:00Z");
const SATURDAY = 6;

afterEach(() => {
  vi.useRealTimers();
});

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(72_000_000 + ++nifCounter);

/** Autumn's Saturday runs Dinner (Cena) 20:00–02:00; Winter's Saturday runs Late bar (Copas). */
async function seasonVenue() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_00_15);
  return provisionSignedInTill(suite.db, {
    taxId: nextNif(),
    dayCutover: "06:00",
    seed: async (tx, cfg) => {
      const restaurant = await createBareDepartment(tx, cfg, "Restaurant", SUNDAY_00_15);
      const sala = (await createServiceZone(tx, cfg, { name: "Sala", departmentId: restaurant }))
        .id;
      const dish = async (menuName: string, name: string) => {
        const menuId = (await createCatalogue(tx, { name: menuName })).id;
        const product = await createProduct(tx, {
          catalogueId: menuId,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: "12.00",
          vatClass: "general",
        });
        const itemId = (await addProductToMenu(tx, { menuId, productId: product.id })).id;
        return { menuId, itemId, versionId: await publishWorkingMenu(tx, menuId) };
      };
      const cena = await dish("Cena", "Solomillo");
      const copas = await dish("Copas", "Gin tonic");
      const period = async (name: string, menuId: string) =>
        (await saveMenuPeriod(tx, cfg, restaurant, { name, menuId, staffMenuIds: [] })).id;
      const dinner = await period("Dinner", cena.menuId);
      const lateBar = await period("Late bar", copas.menuId);
      const seasonId = async (name: string) =>
        (
          await tx
            .select({ id: seasons.id, name: seasons.name })
            .from(seasons)
            .where(eq(seasons.locationId, cfg.locationId))
        ).find((season) => season.name === name)!.id;
      const saturday = (periodId: string) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === SATURDAY ? [{ periodId, startsAt: "20:00", endsAt: "02:00" }] : [],
        }));
      await replaceMenuWeek(tx, cfg, restaurant, saturday(dinner), SUNDAY_00_15, 0, {
        seasonId: await seasonId("Autumn"),
      });
      await replaceMenuWeek(tx, cfg, restaurant, saturday(lateBar), SUNDAY_00_15, 0, {
        seasonId: await seasonId("Winter"),
      });
      return {
        departmentId: restaurant,
        startingZoneId: sala,
        restaurant,
        sala,
        cena,
        copas,
      };
    },
  });
}
type Venue = Awaited<ReturnType<typeof seasonVenue>>;

const park = async (v: Venue, dish: { itemId: string; versionId: string }) => {
  const id = randomUUID();
  const answer = await sendAsTill(v, "POST", "/api/working-orders", {
    id,
    zoneId: v.sala,
    lines: [{ menuItemId: dish.itemId, quantity: "1", menuVersionId: dish.versionId }],
  });
  return { ...answer, id };
};

const stored = (id: string) =>
  suite.db.select({ id: workingOrders.id }).from(workingOrders).where(eq(workingOrders.id, id));

describe("the till sells the business day's season", () => {
  it("accepts a dish from Autumn's Dinner at 00:15 on Sunday 1 December 2030", async () => {
    const v = await seasonVenue();
    const parked = await park(v, v.cena);
    expect(parked.status).toBe(200);
    expect(await stored(parked.id)).toEqual([{ id: parked.id }]);
  });

  it("refuses a dish only Winter's Late bar offers, and writes no order", async () => {
    const v = await seasonVenue();
    const parked = await park(v, v.copas);
    expect(parked).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.copas.menuId },
        },
      },
    });
    expect(await stored(parked.id)).toEqual([]);
  });

  it("names Dinner in the menu state", async () => {
    const v = await seasonVenue();
    const answer = await sendAsTill(v, "GET", `/api/menu-state?zoneId=${v.sala}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      defaultMenuId: v.cena.menuId,
      service: { open: true, periodName: "Dinner" },
    });
  });
});
