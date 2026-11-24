import { MAX_SET_MENU_AMOUNT_CENTS, type SetMenuFitInput } from "./set-menu-fit.js";

export function boundTable(seed: number, menus = 40, capped = false): SetMenuFitInput {
  const next = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * limit);
  };
  const courses = ["starter", "main", "dessert", "coffee", "bread", "drink"];
  const lines = [[0], [1, 0], [2, 3], [4], [5]].map((choices) => ({
    count: 1,
    courseIds: choices.map((index) => courses[index]!),
  }));
  const products = Array.from({ length: 40 }, (_, index) => ({
    productId: `product-${index}`,
    variantId: null,
    course: courses[index % courses.length]!,
  }));
  const offers = Array.from({ length: 5 }, (_, index) => ({
    id: `offer-${index}`,
    priceCents: capped ? MAX_SET_MENU_AMOUNT_CENTS : 1400 + index * 100,
    dishes: products
      .filter((_, item) => item < 6 || next(10) < 6)
      .map(({ productId, variantId, course }) => ({
        productId,
        variantId,
        countsAsCourseId: course,
        surchargeCents: capped ? MAX_SET_MENU_AMOUNT_CENTS : next(2) * next(801),
      })),
    lines,
  }));
  const setMenus = Array.from({ length: menus }, (_, index) => ({
    id: `menu-${index}`,
    fixedOfferId: null,
  }));
  const dishes = setMenus.flatMap((menu, index) =>
    lines.map((line, position) => {
      const listed = offers[index % offers.length]!.dishes;
      const accepted = products.filter(
        ({ course, productId }) =>
          line.courseIds.includes(course) && listed.some((dish) => dish.productId === productId),
      );
      const item = accepted[next(accepted.length)]!;
      return {
        id: `${menu.id}-${position}`,
        productId: item.productId,
        variantId: null,
        pinnedTo: null,
      };
    }),
  );
  return { offers, setMenus, dishes, previous: null };
}
