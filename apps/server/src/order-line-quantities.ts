import {
  type Decimal,
  thousandthsToDecimal,
  centsToDecimal,
  decimal,
  multiplyDecimal,
  divideDecimal,
  MONEY_SCALE,
} from "@waitron/shared";

/** A dish's extras child, and how many of it go with one of the dish. */
export interface KeptExtra {
  child: { id: string; unitPriceGross: Decimal; priceQuantity?: Decimal };
  perDish: number;
}
/** The stored extras children of a dish of `dishQuantity` thousandths, as a reduction keeps them. */
export function keptExtrasOf(
  children: readonly {
    id: string;
    quantity: number;
    priceQuantity: number;
    unitPriceGross: number;
  }[],
  dishQuantity: number,
): KeptExtra[] {
  const dish = thousandthsToDecimal(dishQuantity);
  return children.map((child) => ({
    child: {
      id: child.id,
      unitPriceGross: centsToDecimal(child.unitPriceGross),
      priceQuantity: thousandthsToDecimal(child.priceQuantity),
    },
    perDish: perDishExtraPicks(
      thousandthsToDecimal(child.quantity),
      dish,
      thousandthsToDecimal(child.priceQuantity),
    ),
  }));
}
/** An extras child's quantity once its dish is `dishQuantity`. */
export function extraQuantityFor(
  perDish: number,
  dishQuantity: Decimal,
  priceQuantity: Decimal = decimal("1"),
): Decimal {
  return multiplyDecimal(multiplyDecimal(dishQuantity, decimal(String(perDish))), priceQuantity);
}
export function perDishExtraPicks(
  childQuantity: string,
  dishQuantity: string,
  priceQuantity: string,
): number {
  return Number(
    divideDecimal(
      decimal(childQuantity),
      multiplyDecimal(decimal(dishQuantity), decimal(priceQuantity)),
      0,
    ),
  );
}
/**
 * The same composition `grossRows` uses for a line's gross total, so a split line's `line_total` is
 * identical to an add-time line's.
 */
export function grossLineTotal(
  grossUnit: string,
  quantity: string,
  priceQuantity: string = "1",
): Decimal {
  return divideDecimal(
    multiplyDecimal(decimal(grossUnit), decimal(quantity)),
    decimal(priceQuantity),
    MONEY_SCALE,
  );
}
