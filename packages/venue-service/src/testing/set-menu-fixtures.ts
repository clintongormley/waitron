import { eq } from "drizzle-orm";
import { kitchenCourses, menuItems, products, type Transaction } from "@waitron/db";
import { seedPerson, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import {
  addMember,
  addProducts,
  buildMenuDocument,
  createMenu,
  publishMenu,
  requireMenuRoot,
  updateMenuItem,
} from "@waitron/menu";
import { readBusinessDayScheduleRevision } from "../business-day-schedule.js";
import { replaceMenuWeek, saveMenuPeriod } from "../menu-timetable.js";

const publisher = "set-menu-publisher";
const midday = new Date("2026-10-05T11:00:00Z");
const evening = new Date("2026-10-05T19:00:00Z");

function publish(tx: Transaction, menuId: string) {
  return buildMenuDocument(tx, menuId).then(({ workingHash }) =>
    publishMenu(tx, menuId, workingHash, publisher),
  );
}

export async function setMenuFixture(tx: Transaction) {
  await seedVenue(tx, { timeZone: "Europe/Madrid" });
  await seedPerson(tx, { id: publisher, displayName: "Set menu publisher" });
  const { id: zoneId, departmentId } = await seedZone(tx, { name: "Dining room" });
  const { id: lunch } = await createMenu(tx, { name: "Lunch" });
  const { id: brunch } = await createMenu(tx, { name: "Brunch" });
  const { id: dinner } = await createMenu(tx, { name: "Dinner" });
  const { id: daily } = await createMenu(tx, {
    kind: "set_menu",
    name: "Daily menu",
    setPrice: "14.00",
    setVatClass: "reduced",
    setTakeawayVatClass: "general",
  });
  const [starters, mains, drinks, sharing] = (
    await tx
      .insert(kitchenCourses)
      .values(
        ["Starters", "Mains", "Drinks", "Sharing plates"].map((name, displayOrder) => ({
          name,
          displayOrder,
        })),
      )
      .returning({ id: kitchenCourses.id })
  ).map(({ id }) => id!);
  const [soup, sirloin, bravas] = (
    await tx
      .insert(products)
      .values(
        [
          { name: "Soup", courseId: starters!, unitPrice: 700 },
          { name: "Sirloin", courseId: mains!, unitPrice: 1800 },
          { name: "Bravas", courseId: sharing!, unitPrice: 600 },
        ].map((dish) => ({ ...dish, vatClass: "reduced" as const, dietaryDeclarations: [] })),
      )
      .returning({ id: products.id })
  ).map(({ id }) => id);
  const [{ id: largeBravas }] = await tx
    .insert(products)
    .values({ name: "Large", parentId: bravas!, courseId: drinks!, unitPrice: 800 })
    .returning({ id: products.id });
  const root = await requireMenuRoot(tx, daily);
  await addProducts(tx, root, [soup!, sirloin!, bravas!]);
  const itemIds = new Map(
    (await tx.select().from(menuItems).where(eq(menuItems.menuId, daily))).map((item) => [
      item.productId,
      item.id,
    ]),
  );
  await updateMenuItem(tx, daily, itemIds.get(sirloin!)!, { grossPrice: "5.00" });
  await addMember(tx, await requireMenuRoot(tx, lunch), { kind: "product", productId: sirloin! });
  const place = async (menuId: string) =>
    addMember(tx, await requireMenuRoot(tx, menuId), { kind: "set_menu", menuId: daily });
  await place(lunch);

  const lunchPeriod = await saveMenuPeriod(tx, departmentId, {
    name: "Lunch",
    menuId: lunch,
    staffMenuIds: [brunch],
  });
  const dinnerPeriod = await saveMenuPeriod(tx, departmentId, {
    name: "Dinner",
    menuId: dinner,
    staffMenuIds: [],
  });
  await replaceMenuWeek(
    tx,
    departmentId,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots: [
        { periodId: lunchPeriod.id, startsAt: "12:00", endsAt: "15:00" },
        { periodId: dinnerPeriod.id, startsAt: "20:00", endsAt: "23:00" },
      ],
    })),
    midday,
    await readBusinessDayScheduleRevision(tx),
  );
  await publish(tx, dinner);
  return {
    publisher,
    zoneId,
    lunch,
    brunch,
    daily,
    dinner,
    place,
    midday,
    evening,
    soup: soup!,
    sirloin: sirloin!,
    bravas: bravas!,
    largeBravas,
    soupItem: itemIds.get(soup!)!,
    bravasItem: itemIds.get(bravas!)!,
    starters: starters!,
    mains: mains!,
    drinks: drinks!,
    sharing: sharing!,
    publish: (menuId = lunch) => publish(tx, menuId),
  };
}
