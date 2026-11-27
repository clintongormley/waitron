import type { Transaction } from "@waitron/db";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/menu";

/**
 * Products with differing takeaway rates, for the A1522 suites: a cola taken away at 21%; a cheese
 * and a cheese board at 4%; a burger whose extras list offers a lemon soda at a rate unlike the
 * burger's. Call before `offerProducts`, which publishes them.
 */
export async function seedTakeawayProducts(tx: Transaction): Promise<{
  cola: string;
  cheese: string;
  cheeseBoard: string;
  burger: string;
  lemonSoda: string;
  burgerExtras: string;
}> {
  const product = async (name: string, unitPrice: string, takeawayVatRate: string) =>
    (
      await createProduct(tx, {
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        takeawayVatRate,
      })
    ).id;
  const cola = await product("Cola", "1.80", "21.00");
  const cheese = await product("Cheese", "4.00", "4.00");
  const cheeseBoard = await product("Cheese board", "4.00", "4.00");
  const burger = await product("Burger", "10.00", "21.00");
  const lemonSoda = await product("Lemon soda", "2.00", "0.00");
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
