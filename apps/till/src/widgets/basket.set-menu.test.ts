import { afterEach, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import { seaBass } from "../../test/set-menu-widgets.js";

afterEach(cleanupWidgets);

it("tags the actual draft placement price and uses a fixed quantity for set-menu dishes", async () => {
  const sirloin = {
    ...seaBass,
    draftLineId: "sirloin",
    product: { ...seaBass.product, id: "sirloin", name: "Sirloin", unitPrice: "8.00" },
  };
  const ordinary = { ...sirloin, setMenuId: undefined, draftLineId: "ordinary" };
  const unplaced = {
    ...sirloin,
    draftLineId: "unplaced",
    product: { ...sirloin.product, id: "hake", name: "Hake" },
  };
  const store = new WorkingOrderStore();
  store.loadFrom("bill", [seaBass, sirloin, ordinary, unplaced]);
  const prices = new Map([
    ["fresh-sea-bass", "0.00"],
    ["sirloin", "5.00"],
  ]);
  const { el } = await mountWidget<TillBasket>("till-basket", {
    store,
    placedPrice: (line) => prices.get(line.draftLineId ?? ""),
  });
  const root = el.shadowRoot!;
  const names = Array.from(root.querySelectorAll("[part=name]"), (name) =>
    name.textContent!.replace(/\s+/g, " ").trim(),
  );
  expect(names).toEqual(["Sea bass menu", "Sirloin +€5.00", "Sirloin", "Hake"]);
  expect(root.querySelectorAll(".qty.stepper")).toHaveLength(1);
});
