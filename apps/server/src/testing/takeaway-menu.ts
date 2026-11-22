import type { Transaction } from "@waitron/db";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/menu";
import type { VatClass } from "@waitron/menu";

/**
 * Products whose served-here class and takeaway rate differ, for the A1522 suites: a cola served
 * here at `reduced` and taken away at 21%; a cheese at `super_reduced` and 4% both ways; a cheese
 * board served here at `reduced` and taken away at 4%; a burger whose extras list offers a lemon
 * soda at a class and a rate unlike the burger's. Call before `offerProducts`, which publishes them.
 */
export async function seedTakeawayProducts(tx: Transaction): Promise<{
  cola: string;
  cheese: string;
  cheeseBoard: string;
  burger: string;
  lemonSoda: string;
  burgerExtras: string;
}> {
  const product = async (
    name: string,
    unitPrice: string,
    vatClass: VatClass,
    takeawayVatRate: string,
  ) =>
    (
      await createProduct(tx, {
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass,
        takeawayVatRate,
      })
    ).id;
  const cola = await product("Cola", "1.80", "reduced", "21.00");
  const cheese = await product("Cheese", "4.00", "super_reduced", "4.00");
  const cheeseBoard = await product("Cheese board", "4.00", "reduced", "4.00");
  const burger = await product("Burger", "10.00", "general", "21.00");
  const lemonSoda = await product("Lemon soda", "2.00", "reduced", "0.00");
  const extras = await createExtraList(
    tx,
    {
      name: "Drinks",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 1,
      active: true,
      items: [{ productId: lemonSoda, maxQuantity: 1, preselected: false, price: "2.00" }],
    },
    "es-ES",
  );
  await writeProductModifiers(tx, burger, [{ kind: "extras", id: extras.id }]);
  return { cola, cheese, cheeseBoard, burger, lemonSoda, burgerExtras: extras.id };
}
