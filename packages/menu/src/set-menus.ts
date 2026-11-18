import { and, eq, inArray } from "drizzle-orm";
import {
  kitchenCourses,
  menuItems,
  menuItemVariantOverrides,
  menus,
  now,
  products,
  sectionMembers,
  setMenuDishCourses,
  setMenuLineCourses,
  setMenuLines,
  setMenuVariantExclusions,
  units,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  MAX_SET_MENU_AMOUNT_CENTS,
  stringToCents,
  VAT_CLASSES,
} from "@waitron/shared";
import type { SetMenuLine, SetMenuProblem, VatClass } from "@waitron/shared";
import { batches } from "./batches.js";
import { allTopLevelProducts } from "./categories.js";
import { reachableMenuItem, requireMenuRoot, syncMenuOffers } from "./menu-structure.js";
import { isProductPrice } from "./modifier-limits.js";
import { priceOrNull } from "./offer-price.js";
import { loadSectionGraph, menusContaining, type SectionGraph } from "./section-graph.js";
import { appendProductMembers, memberOrder, productsAbsentFromList } from "./section-members.js";
import {
  effectiveProductColumns as effective,
  parentJoin,
  parentProducts,
  unitOwnerJoin,
} from "./variant-fallback.js";
import { variantsOfProducts } from "./variants.js";
import "./errors.js";

async function setMenuRow(tx: Transaction, menuId: string) {
  const [menu] = await tx
    .select({ name: menus.name, price: menus.setPrice, vatClass: menus.setVatClass })
    .from(menus)
    .where(and(eq(menus.id, menuId), eq(menus.active, true), eq(menus.kind, "set_menu")));
  if (menu === undefined) throw new AppError("set_menu.not_found", { menuId });
  return {
    name: menu.name,
    price: centsToDecimal(menu.price!),
    vatClass: menu.vatClass as VatClass,
  };
}

export async function requireSetMenu(tx: Transaction, menuId: string): Promise<void> {
  await setMenuRow(tx, menuId);
}

export async function refuseSetMenu(tx: Transaction, menuId: string): Promise<void> {
  const [menu] = await tx.select({ kind: menus.kind }).from(menus).where(eq(menus.id, menuId));
  if (menu?.kind === "set_menu") throw new AppError("set_menu.wrong_place", { menuId });
}

export function setMenuPriceCents(price: string | null | undefined): number {
  if (typeof price !== "string" || !isProductPrice(price))
    throw new AppError("set_menu.invalid", { field: "setPrice" });
  const cents = stringToCents(price);
  if (cents > MAX_SET_MENU_AMOUNT_CENTS)
    throw new AppError("set_menu.invalid", { field: "setPrice" });
  return cents;
}

export function setMenuSurchargeCents(surcharge: string): number {
  if (typeof surcharge === "string" && isProductPrice(surcharge)) {
    const cents = stringToCents(surcharge);
    if (cents <= MAX_SET_MENU_AMOUNT_CENTS) return cents;
  }
  throw new AppError("set_menu.invalid", { field: "surcharge" });
}

export function setMenuVatClass(vatClass: VatClass | null | undefined): VatClass {
  if (vatClass == null || !VAT_CLASSES.includes(vatClass))
    throw new AppError("set_menu.invalid", { field: "setVatClass" });
  return vatClass;
}

export interface SetMenuDishSetting {
  menuItemId: string;
  productId: string;
  name: string;
  surcharge: string | null;
  courseId: string | null;
  productCourseId: string | null;
  courseOverrideId: string | null;
  vatClass: VatClass;
  soldByMeasure: boolean;
  variants: {
    id: string;
    name: string;
    included: boolean;
    surcharge: string | null;
    courseId: string | null;
    vatClass: VatClass;
  }[];
}

export interface SetMenuDetails {
  id: string;
  name: string;
  names: Record<string, string>;
  price: string;
  vatClass: VatClass;
  dishes: SetMenuDishSetting[];
  lines: SetMenuLine[];
  courses: { id: string; name: string }[];
  problems: SetMenuProblem[];
  heldBy: { id: string; name: string }[];
}

type DraftLine = Omit<SetMenuLine, "id" | "courseIds"> & { courseIds: readonly string[] };
type DishSelection = { productId: string; keptVariantIds: readonly string[] };
type VariantChoice = { variantId: string; included: boolean; surcharge: string | null };

export async function touchSetMenu(tx: Transaction, menuId: string): Promise<void> {
  await tx
    .update(menus)
    .set({ updatedAt: now() })
    .where(and(eq(menus.id, menuId), eq(menus.kind, "set_menu")));
}

async function activeCourses(tx: Transaction): Promise<SetMenuDetails["courses"]> {
  return tx
    .select({ id: kitchenCourses.id, name: kitchenCourses.name })
    .from(kitchenCourses)
    .where(eq(kitchenCourses.active, true))
    .orderBy(kitchenCourses.displayOrder, kitchenCourses.name, kitchenCourses.id);
}

type StoredLine = SetMenuLine & { position: number };

async function storedLines(tx: Transaction, menuId: string): Promise<StoredLine[]> {
  const rows = await tx
    .select({
      id: setMenuLines.id,
      position: setMenuLines.position,
      count: setMenuLines.count,
      courseId: kitchenCourses.id,
    })
    .from(setMenuLines)
    .leftJoin(setMenuLineCourses, eq(setMenuLineCourses.lineId, setMenuLines.id))
    .leftJoin(
      kitchenCourses,
      and(eq(kitchenCourses.id, setMenuLineCourses.courseId), eq(kitchenCourses.active, true)),
    )
    .where(eq(setMenuLines.menuId, menuId))
    .orderBy(
      setMenuLines.position,
      setMenuLines.id,
      kitchenCourses.displayOrder,
      kitchenCourses.name,
      kitchenCourses.id,
    );
  const lines = new Map<string, StoredLine>();
  for (const { id, position, count, courseId } of rows) {
    const line = lines.get(id) ?? { id, position, count, courseIds: [] };
    if (courseId !== null) line.courseIds.push(courseId);
    lines.set(id, line);
  }
  return [...lines.values()];
}

async function insertLines(
  tx: Transaction,
  menuId: string,
  lines: readonly DraftLine[],
  start: number,
) {
  const written: SetMenuLine[] = [];
  for (const { count, courseIds } of lines) {
    const [row] = await tx
      .insert(setMenuLines)
      .values({ menuId, count, position: start++ })
      .returning({ id: setMenuLines.id });
    const id = row!.id;
    for (const batch of batches(courseIds))
      await tx
        .insert(setMenuLineCourses)
        .values(batch.map((courseId) => ({ lineId: id, courseId })));
    written.push({ id, count, courseIds: [...courseIds] });
  }
  return written;
}

export async function saveSetMenuLines(
  tx: Transaction,
  menuId: string,
  lines: readonly DraftLine[],
): Promise<SetMenuLine[]> {
  await requireSetMenu(tx, menuId);
  if (lines.length > 20) throw new AppError("set_menu.invalid", { field: "lines" });
  const courses = await activeCourses(tx);
  const ordered = lines.map(({ count, courseIds }) => {
    if (!Number.isInteger(count) || count < 1 || count > 99)
      throw new AppError("set_menu.invalid", { field: "count" });
    const ids = new Set(courseIds);
    const inOrder = courses.filter(({ id }) => ids.has(id)).map(({ id }) => id);
    if (inOrder.length === 0 || inOrder.length !== courseIds.length)
      throw new AppError("set_menu.invalid", { field: "courseIds" });
    return { count, courseIds: inOrder };
  });
  await tx.delete(setMenuLines).where(eq(setMenuLines.menuId, menuId));
  const saved = await insertLines(tx, menuId, ordered, 0);
  await touchSetMenu(tx, menuId);
  return saved;
}

async function dishSettings(
  tx: Transaction,
  menuId: string,
  root: string,
  courses: SetMenuDetails["courses"],
): Promise<SetMenuDishSetting[]> {
  const rows = await tx
    .select({
      menuItemId: menuItems.id,
      productId: products.id,
      name: products.name,
      surcharge: menuItems.grossPrice,
      productCourseId: products.courseId,
      courseOverrideId: setMenuDishCourses.courseId,
      vatClass: products.vatClass,
      measure: units.measure,
    })
    .from(sectionMembers)
    .innerJoin(
      menuItems,
      and(eq(menuItems.menuId, menuId), eq(menuItems.productId, sectionMembers.productId)),
    )
    .innerJoin(products, eq(products.id, menuItems.productId))
    .leftJoin(units, eq(units.id, products.unitId))
    .leftJoin(setMenuDishCourses, eq(setMenuDishCourses.menuItemId, menuItems.id))
    .where(eq(sectionMembers.sectionId, root))
    .orderBy(...memberOrder);
  const active = new Set(courses.map(({ id }) => id));
  const activeCourse = (id: string | null) => (id !== null && active.has(id) ? id : null);
  const dishes = new Map<string, SetMenuDishSetting>();
  for (const { measure, ...row } of rows) {
    dishes.set(row.menuItemId, {
      ...row,
      vatClass: row.vatClass as VatClass,
      surcharge: priceOrNull(row.surcharge),
      productCourseId: activeCourse(row.productCourseId),
      courseId: activeCourse(row.courseOverrideId ?? row.productCourseId),
      soldByMeasure: measure === true,
      variants: [],
    });
  }
  for (const batch of batches([...dishes.keys()])) {
    const variants = await tx
      .select({
        menuItemId: menuItems.id,
        id: products.id,
        name: products.name,
        vatClass: effective.vatClass,
        courseId: effective.courseId,
        surcharge: menuItemVariantOverrides.price,
        excluded: setMenuVariantExclusions.variantId,
      })
      .from(menuItems)
      .innerJoin(products, eq(products.parentId, menuItems.productId))
      .leftJoin(parentProducts, parentJoin)
      .leftJoin(
        menuItemVariantOverrides,
        and(
          eq(menuItemVariantOverrides.menuItemId, menuItems.id),
          eq(menuItemVariantOverrides.variantId, products.id),
        ),
      )
      .leftJoin(
        setMenuVariantExclusions,
        and(
          eq(setMenuVariantExclusions.menuItemId, menuItems.id),
          eq(setMenuVariantExclusions.variantId, products.id),
        ),
      )
      .where(and(inArray(menuItems.id, batch), eq(products.active, true)))
      .orderBy(products.variantOrder, products.id);
    for (const { menuItemId, excluded, ...variant } of variants) {
      const dish = dishes.get(menuItemId)!;
      dish.variants.push({
        ...variant,
        vatClass: variant.vatClass as VatClass,
        included: excluded === null,
        surcharge: excluded === null ? priceOrNull(variant.surcharge) : null,
        courseId: activeCourse(dish.courseOverrideId ?? variant.courseId),
      });
    }
  }
  return [...dishes.values()];
}

export async function readSetMenu(
  tx: Transaction,
  menuId: string,
  graph?: SectionGraph,
): Promise<SetMenuDetails> {
  const menu = await setMenuRow(tx, menuId);
  const root = await requireMenuRoot(tx, menuId);
  graph ??= await loadSectionGraph(tx);
  const courses = await activeCourses(tx);
  const details = {
    ...menu,
    id: menuId,
    names: graph.section(root)?.names ?? {},
    dishes: await dishSettings(tx, menuId, root, courses),
    lines: (await storedLines(tx, menuId)).map(({ id, count, courseIds }) => ({
      id,
      count,
      courseIds,
    })),
    courses,
    heldBy: menusContaining(graph, root).flatMap((id) => {
      const parent = graph.menu(id);
      return parent?.kind === "menu" ? [{ id, name: parent.name }] : [];
    }),
  };
  return { ...details, problems: setMenuProblems(details) };
}

function includedDishChoices(dish: SetMenuDishSetting): {
  id: string;
  name: string;
  courseId: string | null;
  vatClass: VatClass;
  parentName: string | null;
}[] {
  if (dish.variants.length === 0) {
    const { productId, name, courseId, vatClass } = dish;
    return [{ id: productId, name, courseId, vatClass, parentName: null }];
  }
  return dish.variants
    .filter(({ included }) => included)
    .map(({ id, name, courseId, vatClass }) => ({
      id,
      name,
      courseId,
      vatClass,
      parentName: dish.name,
    }));
}

function dishVatClasses(dish: SetMenuDishSetting) {
  const choices = includedDishChoices(dish);
  if (dish.variants.length === 0) return choices;
  // The listed product must match the menu's class even when only its variants are sold.
  return [
    { id: dish.productId, name: dish.name, parentName: null, vatClass: dish.vatClass },
    ...choices,
  ];
}

export async function refuseSetMenuVatClassChange(
  tx: Transaction,
  menuId: string,
  requestedVatClass: VatClass,
): Promise<void> {
  const { vatClass } = await setMenuRow(tx, menuId);
  if (vatClass === requestedVatClass) return;
  const root = await requireMenuRoot(tx, menuId);
  const dishes = await dishSettings(tx, menuId, root, await activeCourses(tx));
  const differing = dishes
    .flatMap(dishVatClasses)
    .find((dish) => dish.vatClass !== requestedVatClass);
  if (differing !== undefined)
    throw new AppError("set_menu.vat_class_differs", {
      productId: differing.id,
      productVatClass: differing.vatClass,
      setMenuVatClass: vatClass,
      field: "setVatClass",
      requestedVatClass,
    });
}

export function setMenuProblems(details: Omit<SetMenuDetails, "problems">): SetMenuProblem[] {
  const choices = details.dishes.flatMap(includedDishChoices);
  const problems: SetMenuProblem[] = [];
  if (choices.length === 0) problems.push({ kind: "no_dishes" });
  if (details.lines.length === 0) problems.push({ kind: "no_lines" });

  const accepted = new Set(details.lines.flatMap(({ courseIds }) => courseIds));
  const possible = new Set(choices.map(({ courseId }) => courseId));
  const courseNames = new Map(details.courses.map(({ id, name }) => [id, name]));
  for (const { id, name, courseId, parentName } of choices) {
    const dish = { productId: id, name, parentName };
    if (courseId === null) problems.push({ kind: "dish_without_course", ...dish });
    else if (!accepted.has(courseId))
      problems.push({
        kind: "dish_not_included",
        ...dish,
        courseId,
        courseName: courseNames.get(courseId)!,
      });
  }
  for (const dish of details.dishes) {
    for (const { id: productId, name, parentName, vatClass } of dishVatClasses(dish))
      if (vatClass !== details.vatClass)
        problems.push({ kind: "dish_vat_class_differs", productId, name, parentName, vatClass });
    if (dish.soldByMeasure)
      problems.push({ kind: "dish_sold_by_measure", productId: dish.productId, name: dish.name });
  }
  for (const { id: lineId, courseIds } of details.lines) {
    if (courseIds.length === 0) problems.push({ kind: "line_without_course", lineId });
    else if (!courseIds.some((courseId) => possible.has(courseId)))
      problems.push({ kind: "line_unfillable", lineId });
  }
  return problems;
}

/** Appends a line only for a course offered by an added dish that no current line accepts. */
export async function addLinesForCourses(
  tx: Transaction,
  menuId: string,
  productIds: readonly string[],
): Promise<SetMenuLine[]> {
  if (productIds.length === 0) return [];
  const root = await requireMenuRoot(tx, menuId);
  const courses = await activeCourses(tx);
  const lines = await storedLines(tx, menuId);
  const dishes = await dishSettings(tx, menuId, root, courses);
  const added = new Set(productIds);
  const wanted = new Set(
    dishes
      .filter(({ productId }) => added.has(productId))
      .flatMap(includedDishChoices)
      .map(({ courseId }) => courseId),
  );
  return appendMissingCourseLines(tx, menuId, courses, lines, wanted);
}

function appendMissingCourseLines(
  tx: Transaction,
  menuId: string,
  courses: SetMenuDetails["courses"],
  lines: StoredLine[],
  wanted: ReadonlySet<string | null>,
): Promise<SetMenuLine[]> {
  const accepted = new Set(lines.flatMap(({ courseIds }) => courseIds));
  return insertLines(
    tx,
    menuId,
    courses
      .filter(({ id }) => wanted.has(id) && !accepted.has(id))
      .map(({ id }) => ({ count: 1, courseIds: [id] })),
    (lines.at(-1)?.position ?? -1) + 1,
  );
}

export async function saveSetMenuDishCourse(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  courseId: string | null,
): Promise<{ addedLines: SetMenuLine[]; removedLines: SetMenuLine[] }> {
  await requireSetMenu(tx, menuId);
  const root = await requireMenuRoot(tx, menuId);
  const courses = await activeCourses(tx);
  const before = await dishSettings(tx, menuId, root, courses);
  const dish = before.find((candidate) => candidate.menuItemId === menuItemId);
  if (dish === undefined) throw new AppError("set_menu.not_found", { menuId });
  if (courseId !== null && !courses.some(({ id }) => id === courseId))
    throw new AppError("set_menu.invalid", { field: "courseId" });

  const override = courseId === dish.productCourseId ? null : courseId;
  if (override === dish.courseOverrideId) return { addedLines: [], removedLines: [] };

  if (override === null)
    await tx.delete(setMenuDishCourses).where(eq(setMenuDishCourses.menuItemId, menuItemId));
  else
    await tx
      .insert(setMenuDishCourses)
      .values({ menuItemId, courseId: override })
      .onConflictDoUpdate({
        target: setMenuDishCourses.menuItemId,
        set: { courseId: override },
      });

  const lines = await storedLines(tx, menuId);
  const after = await dishSettings(tx, menuId, root, courses);
  const changedDish = after.find((candidate) => candidate.menuItemId === menuItemId)!;
  const previousByChoice = new Map(
    includedDishChoices(dish).map(({ id, courseId }) => [id, courseId]),
  );
  const changed = includedDishChoices(changedDish).filter(
    ({ id, courseId }) => previousByChoice.get(id) !== courseId,
  );
  const wanted = new Set(changed.map(({ courseId }) => courseId));
  const addedLines = await appendMissingCourseLines(tx, menuId, courses, lines, wanted);
  const previous = new Set(previousByChoice.values());
  const remaining = new Set(after.flatMap(includedDishChoices).map((choice) => choice.courseId));
  const removedLines = lines
    .filter(
      ({ count, courseIds }) =>
        count === 1 &&
        courseIds.length === 1 &&
        previous.has(courseIds[0]!) &&
        !remaining.has(courseIds[0]!),
    )
    .map(({ id, count, courseIds }) => ({ id, count, courseIds }));
  for (const batch of batches(removedLines.map(({ id }) => id)))
    await tx.delete(setMenuLines).where(inArray(setMenuLines.id, batch));
  await touchSetMenu(tx, menuId);
  return { addedLines, removedLines };
}

export async function refuseDishesSetMenuCannotHold(
  tx: Transaction,
  menuId: string,
  dishes: readonly DishSelection[],
): Promise<void> {
  if (dishes.length === 0) return;
  const { vatClass: setMenuVatClass } = await setMenuRow(tx, menuId);
  const ids = new Set(
    dishes.flatMap(({ productId, keptVariantIds }) => [productId, ...keptVariantIds]),
  );
  const eligibility = new Map<string, { vatClass: VatClass; measure: boolean | null }>();
  for (const batch of batches([...ids]))
    for (const { id, vatClass, measure } of await tx
      .select({ id: products.id, vatClass: effective.vatClass, measure: units.measure })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .leftJoin(units, unitOwnerJoin)
      .where(inArray(products.id, batch)))
      eligibility.set(id, { vatClass: vatClass as VatClass, measure });
  for (const { productId, keptVariantIds } of dishes) {
    if (eligibility.get(productId)?.measure)
      throw new AppError("set_menu.dish_sold_by_measure", { productId });
    for (const id of [productId, ...keptVariantIds]) {
      const productVatClass = eligibility.get(id)!.vatClass;
      if (productVatClass !== setMenuVatClass)
        throw new AppError("set_menu.vat_class_differs", {
          productId: id,
          productVatClass,
          setMenuVatClass,
        });
    }
  }
}

/** A member write starts with every active variant included. */
export async function refuseIneligibleSetMenuProducts(
  tx: Transaction,
  menuId: string,
  productIds: readonly string[],
): Promise<void> {
  const families = await activeVariantsByProduct(tx, productIds);
  await refuseDishesSetMenuCannotHold(
    tx,
    menuId,
    productIds.map((productId) => ({
      productId,
      keptVariantIds: [...(families.get(productId) ?? [])],
    })),
  );
}

export async function saveSetMenuVariantChoices(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  variants: readonly VariantChoice[],
): Promise<void> {
  await requireSetMenu(tx, menuId);
  const item = await reachableMenuItem(tx, menuItemId, menuId);
  if (item === undefined) throw new AppError("menu_item.not_found", { menuId, menuItemId });
  const { productId } = item;
  const active = await activeVariantsByProduct(tx, [productId]);
  const allowed = active.get(productId);
  const seen = new Set<string>();
  const exclusions = [];
  const surcharges = [];
  const keptVariantIds = [];
  for (const { variantId, included, surcharge } of variants) {
    if (!allowed?.has(variantId)) throw new AppError("product.variant_not_found", { variantId });
    if (seen.has(variantId) || typeof included !== "boolean")
      throw new AppError("set_menu.invalid", { field: "variants" });
    seen.add(variantId);
    const row = { menuItemId, productId, variantId };
    if (!included) exclusions.push(row);
    else {
      keptVariantIds.push(variantId);
      if (surcharge !== null) surcharges.push({ ...row, price: setMenuSurchargeCents(surcharge) });
    }
  }
  if (seen.size !== (allowed?.size ?? 0))
    throw new AppError("set_menu.invalid", { field: "variants" });
  if (keptVariantIds.length > 0)
    await refuseDishesSetMenuCannotHold(tx, menuId, [{ productId, keptVariantIds }]);
  for (const batch of batches([...seen])) {
    await tx
      .delete(setMenuVariantExclusions)
      .where(
        and(
          eq(setMenuVariantExclusions.menuItemId, menuItemId),
          inArray(setMenuVariantExclusions.variantId, batch),
        ),
      );
    await tx
      .delete(menuItemVariantOverrides)
      .where(
        and(
          eq(menuItemVariantOverrides.menuItemId, menuItemId),
          inArray(menuItemVariantOverrides.variantId, batch),
        ),
      );
  }
  for (const batch of batches(exclusions)) await tx.insert(setMenuVariantExclusions).values(batch);
  for (const batch of batches(surcharges)) await tx.insert(menuItemVariantOverrides).values(batch);
  await touchSetMenu(tx, menuId);
}

async function activeVariantsByProduct(tx: Transaction, productIds: readonly string[]) {
  const variants = new Map<string, Set<string>>();
  for (const batch of batches(productIds)) {
    for (const [id, family] of await variantsOfProducts(tx, batch))
      variants.set(id, new Set(family.filter(({ active }) => active).map(({ id }) => id)));
  }
  return variants;
}

async function appendDishes(tx: Transaction, menuId: string, dishes: readonly DishSelection[]) {
  const root = await requireMenuRoot(tx, menuId);
  const before = await loadSectionGraph(tx);
  const members = before.children(root);
  const ids = dishes.map(({ productId }) => productId);
  const adding = new Set(productsAbsentFromList(members, ids));
  await refuseDishesSetMenuCannotHold(
    tx,
    menuId,
    dishes.filter(({ productId }) => adding.has(productId)),
  );
  const added = await appendProductMembers(tx, root, members, ids);
  await syncMenuOffers(tx, [menuId], before);
  const items = new Map<string, string>();
  for (const batch of batches(added))
    for (const row of await tx
      .select({ id: menuItems.id, productId: menuItems.productId })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, menuId), inArray(menuItems.productId, batch))))
      items.set(row.productId, row.id);
  return { added, items };
}

export async function addSetMenuDishes(
  tx: Transaction,
  menuId: string,
  dishes: readonly { productId: string; excludedVariantIds: readonly string[] }[],
): Promise<SetMenuLine[]> {
  await requireSetMenu(tx, menuId);
  const ids = dishes.map(({ productId }) => productId);
  if (!(await allTopLevelProducts(tx, ids, { active: true })))
    throw new AppError("menu_section.membership_invalid", {});
  const families = await activeVariantsByProduct(tx, ids);
  for (const { productId, excludedVariantIds } of dishes)
    for (const variantId of excludedVariantIds)
      if (!families.get(productId)?.has(variantId))
        throw new AppError("product.variant_not_found", { variantId });
  const { added, items } = await appendDishes(
    tx,
    menuId,
    dishes.map(({ productId, excludedVariantIds }) => {
      const excluded = new Set(excludedVariantIds);
      return {
        productId,
        keptVariantIds: [...(families.get(productId) ?? [])].filter((id) => !excluded.has(id)),
      };
    }),
  );
  const exclusions = dishes.flatMap(({ productId, excludedVariantIds }) => {
    const menuItemId = items.get(productId);
    return menuItemId === undefined
      ? []
      : [...new Set(excludedVariantIds)].map((variantId) => ({ menuItemId, productId, variantId }));
  });
  for (const batch of batches(exclusions)) await tx.insert(setMenuVariantExclusions).values(batch);
  return addLinesForCourses(tx, menuId, added);
}

export async function copySetMenuDishes(
  tx: Transaction,
  menuId: string,
  fromMenuId: string,
): Promise<SetMenuLine[]> {
  await requireSetMenu(tx, menuId);
  const source = await readSetMenu(tx, fromMenuId);
  const { added, items } = await appendDishes(
    tx,
    menuId,
    source.dishes.map(({ productId, variants }) => ({
      productId,
      keptVariantIds: variants.filter(({ included }) => included).map(({ id }) => id),
    })),
  );
  const itemIds = new Map<string, string>();
  for (const dish of source.dishes) {
    const target = items.get(dish.productId);
    if (target === undefined) continue;
    itemIds.set(dish.menuItemId, target);
    if (dish.surcharge !== null)
      await tx
        .update(menuItems)
        .set({ grossPrice: stringToCents(dish.surcharge) })
        .where(eq(menuItems.id, target));
  }
  await copyMenuItemChoices(tx, itemIds, true);
  return addLinesForCourses(tx, menuId, added);
}

export async function copyMenuItemChoices(
  tx: Transaction,
  itemIds: ReadonlyMap<string, string>,
  setMenu: boolean,
): Promise<void> {
  for (const batch of batches([...itemIds.keys()])) {
    const overrides = await tx
      .select()
      .from(menuItemVariantOverrides)
      .where(inArray(menuItemVariantOverrides.menuItemId, batch));
    for (const rows of batches(overrides))
      await tx.insert(menuItemVariantOverrides).values(
        rows.map((row) => ({
          ...row,
          menuItemId: itemIds.get(row.menuItemId)!,
        })),
      );
    if (!setMenu) continue;
    const exclusions = await tx
      .select()
      .from(setMenuVariantExclusions)
      .where(inArray(setMenuVariantExclusions.menuItemId, batch));
    for (const rows of batches(exclusions))
      await tx.insert(setMenuVariantExclusions).values(
        rows.map((row) => ({
          ...row,
          menuItemId: itemIds.get(row.menuItemId)!,
        })),
      );
    const courses = await tx
      .select()
      .from(setMenuDishCourses)
      .where(inArray(setMenuDishCourses.menuItemId, batch));
    if (courses.length > 0)
      await tx.insert(setMenuDishCourses).values(
        courses.map((row) => ({
          ...row,
          menuItemId: itemIds.get(row.menuItemId)!,
        })),
      );
  }
}

export async function copySetMenuLines(tx: Transaction, from: string, to: string): Promise<void> {
  const source = await tx.select().from(setMenuLines).where(eq(setMenuLines.menuId, from));
  for (const line of source) {
    const [written] = await tx
      .insert(setMenuLines)
      .values({ menuId: to, position: line.position, count: line.count })
      .returning({ id: setMenuLines.id });
    const courses = await tx
      .select({ courseId: setMenuLineCourses.courseId })
      .from(setMenuLineCourses)
      .where(eq(setMenuLineCourses.lineId, line.id));
    for (const batch of batches(courses))
      await tx
        .insert(setMenuLineCourses)
        .values(batch.map((row) => ({ ...row, lineId: written!.id })));
  }
}
