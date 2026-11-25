import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  menuItems,
  menuItemVariantOverrides,
  products,
  sectionMembers,
  sections,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  decimalToCents,
  isAppError,
  stringToCents,
  type ContentLanguages,
  type MenuStructureSaveInput,
  type MenuStructureSaveResult,
  type SectionMember,
} from "@waitron/shared";
import { batches } from "./batches.js";
import { readContentLanguages } from "./content-languages.js";
import { checkedOverrides, columnsFromOverrides } from "./include-folder.js";
import { isProductPrice } from "./modifier-limits.js";
import { mergeOptionalTranslations } from "./optional-translations.js";
import {
  loadSectionGraph,
  menusContaining,
  reachableProducts,
  wouldCreateCycle,
} from "./section-graph.js";
import { refColumns, refKey } from "./section-members.js";
import { onStructureChanged } from "./section-structure.js";
import { keepMissingTile, sectionPatchValues } from "./sections.js";
import { parentsWithActiveVariants, validatePrice } from "./variants.js";
import "./errors.js";

type Dropped = MenuStructureSaveResult["dropped"];
type CheckedSection = typeof sections.$inferInsert & { id: string };
type CheckedMember = typeof sectionMembers.$inferInsert;

async function atField<T>(prefix: string, fallback: string, check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch (cause) {
    if (
      !isAppError(cause) ||
      !["menu_section.invalid", "content.translation_invalid", "content.language_invalid"].includes(
        cause.code,
      )
    )
      throw cause;
    const field = "field" in cause.params ? cause.params.field : undefined;
    throw new AppError(
      cause.code,
      { field: prefix + "." + (field ?? fallback) },
      { reason: cause.reason },
    );
  }
}

function retainedNames(
  stored: Record<string, string> | undefined,
  draft: Record<string, string> | undefined,
  config: ContentLanguages,
): Record<string, string> | null {
  const shown = Object.fromEntries(
    Object.entries(draft ?? {}).filter(([language]) => config.languages.includes(language)),
  );
  return mergeOptionalTranslations(stored ?? null, shown, config);
}

async function heldProducts(tx: Transaction, input: MenuStructureSaveInput) {
  const ids = new Set<string>();
  for (const list of [input.rootMembers, ...input.sections.map((section) => section.members)])
    for (const { ref } of list) if (ref.kind === "product") ids.add(ref.productId);
  for (const { productId, variantId } of input.prices) {
    ids.add(productId);
    if (variantId !== undefined) ids.add(variantId);
  }
  const held = new Map<string, { parentId: string | null; active: boolean }>();
  for (const batch of batches([...ids]))
    for (const row of await tx
      .select({ id: products.id, parentId: products.parentId, active: products.active })
      .from(products)
      .where(inArray(products.id, batch)))
      held.set(row.id, row);
  return held;
}

async function heldMembers(tx: Transaction, input: MenuStructureSaveInput) {
  const ids = new Set(
    [input.rootMembers, ...input.sections.map((section) => section.members)].flatMap((list) =>
      list.map(({ id }) => id),
    ),
  );
  const held = new Map<string, { sectionId: string; childSectionId: string | null }>();
  for (const batch of batches([...ids]))
    for (const row of await tx
      .select({
        id: sectionMembers.id,
        sectionId: sectionMembers.sectionId,
        childSectionId: sectionMembers.childSectionId,
      })
      .from(sectionMembers)
      .where(inArray(sectionMembers.id, batch)))
      held.set(row.id, row);
  return held;
}

async function writePrices(
  tx: Transaction,
  menuId: string,
  prices: MenuStructureSaveInput["prices"],
  catalogue: Awaited<ReturnType<typeof heldProducts>>,
  reachable: ReadonlySet<string>,
  dropped: Dropped,
): Promise<void> {
  const hasVariants = new Set<string>();
  for (const batch of batches(
    prices.filter(({ variantId }) => variantId === undefined).map(({ productId }) => productId),
  ))
    for (const productId of await parentsWithActiveVariants(tx, batch)) hasVariants.add(productId);
  const offers = new Map(
    (
      await tx
        .select({ id: menuItems.id, productId: menuItems.productId })
        .from(menuItems)
        .where(eq(menuItems.menuId, menuId))
    ).map(({ id, productId }) => [productId, id]),
  );
  const seen = new Set<string>();
  const parents = new Map<string, number>();
  const variants: (typeof menuItemVariantOverrides.$inferInsert)[] = [];
  for (const [index, { productId, variantId, price }] of prices.entries()) {
    const key = productId + ":" + (variantId ?? "");
    const path = "prices." + index;
    if (seen.has(key)) throw new AppError("product.invalid", { field: path + ".price" });
    seen.add(key);
    if (variantId === undefined && !isProductPrice(price))
      throw new AppError("product.invalid", { field: path + ".price" });
    const cents =
      variantId === undefined
        ? stringToCents(price)
        : decimalToCents(validatePrice(price, path + ".price")!);
    const product = catalogue.get(productId);
    if (product?.parentId !== null)
      throw new AppError("product.not_found", { productId, field: path + ".productId" });
    const variant = variantId === undefined ? undefined : catalogue.get(variantId);
    if (variantId !== undefined && variant?.parentId !== productId)
      throw new AppError("product.variant_not_found", { variantId, field: path + ".variantId" });
    const reason =
      !product.active || variant?.active === false
        ? "deleted"
        : variantId === undefined && hasVariants.has(productId)
          ? "has_variants"
          : !reachable.has(productId)
            ? "unreachable"
            : undefined;
    if (reason !== undefined) {
      dropped.push({ productId, ...(variantId === undefined ? {} : { variantId }), reason });
      continue;
    }
    const menuItemId = offers.get(productId)!;
    if (variantId === undefined) parents.set(menuItemId, cents);
    else variants.push({ menuItemId, productId, variantId, price: cents });
  }

  await tx
    .delete(menuItemVariantOverrides)
    .where(
      inArray(
        menuItemVariantOverrides.menuItemId,
        tx.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.menuId, menuId)),
      ),
    );
  await tx
    .update(menuItems)
    .set({ grossPrice: null })
    .where(and(eq(menuItems.menuId, menuId), isNotNull(menuItems.grossPrice)));
  for (const [menuItemId, grossPrice] of parents)
    await tx.update(menuItems).set({ grossPrice }).where(eq(menuItems.id, menuItemId));
  for (const batch of batches(variants)) await tx.insert(menuItemVariantOverrides).values(batch);
}

export async function saveMenuStructure(
  tx: Transaction,
  menuId: string,
  input: MenuStructureSaveInput,
  venueLocale: string,
): Promise<MenuStructureSaveResult> {
  const before = await loadSectionGraph(tx);
  const target = before.menu(menuId);
  const roots = new Map(before.roots().map(({ menuId: id, sectionId }) => [id, sectionId]));
  const root = roots.get(menuId);
  if (target === undefined || root === undefined) throw new AppError("menu.not_found", { menuId });
  if (!target.active) throw new AppError("menu.deleted", { menuId });
  if (target.kind === "set_menu") throw new AppError("set_menu.wrong_place", { menuId });
  const owned = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.ownerMenuId, menuId), eq(sections.role, "section")));
  const oldLists = new Set([root, ...owned.map(({ id }) => id)]);
  const catalogue = await heldProducts(tx, input);
  const storedMembers = await heldMembers(tx, input);
  const languages = await readContentLanguages(tx, venueLocale);
  const dropped: Dropped = [];
  const checkedSections = new Map<string, CheckedSection>();
  for (const [index, draft] of input.sections.entries()) {
    const { id } = draft;
    const field = "sections." + index;
    const stored = before.section(id);
    if (stored !== undefined && (stored.role !== "section" || !oldLists.has(id)))
      throw new AppError("menu_section.wrong_role", {
        sectionId: id,
        role: stored.role,
        field: field + ".id",
      });
    if (checkedSections.has(id))
      throw new AppError("menu_section.member_duplicate", { sectionId: id, field: field + ".id" });
    const values = await atField(field, "names", () => sectionPatchValues(tx, draft, venueLocale));
    if (stored !== undefined)
      values.names = retainedNames(stored.names, values.names, languages) ?? {};
    checkedSections.set(id, { ...values, id, ownerMenuId: menuId });
  }

  const seenMembers = new Set<string>();
  const checkedMembers: CheckedMember[] = [];
  const children = new Map<string, SectionMember[]>();
  const placedSections = new Set<string>();
  const lists = [
    { id: root, members: input.rootMembers, field: "rootMembers" },
    ...input.sections.map(({ id, members }, index) => ({
      id,
      members,
      field: "sections." + index + ".members",
    })),
  ];
  for (const { id: sectionId, members, field: listPath } of lists) {
    const seen = new Set<string>();
    const list: SectionMember[] = [];
    children.set(sectionId, list);
    for (const [index, { id, ref, folder }] of members.entries()) {
      const path = listPath + "." + index;
      const stored = storedMembers.get(id);
      if (seenMembers.has(id) || (stored !== undefined && !oldLists.has(stored.sectionId)))
        throw new AppError("menu_section.membership_invalid", { field: path + ".id" });
      seenMembers.add(id);

      let childSectionId: string | undefined;
      let include = false;
      let deleted = false;
      if (ref.kind === "product") {
        const product = catalogue.get(ref.productId);
        if (product?.parentId !== null)
          throw new AppError("menu_section.membership_invalid", { field: path + ".ref" });
        deleted = !product.active;
      } else if (ref.kind === "set_menu") {
        const set = before.menu(ref.menuId);
        const setRoot = roots.get(ref.menuId);
        if (set?.kind !== "set_menu" || setRoot === undefined)
          throw new AppError("set_menu.not_found", { menuId: ref.menuId, field: path + ".ref" });
        deleted = !set.active;
        childSectionId = setRoot;
      } else if (checkedSections.has(ref.sectionId)) {
        if (placedSections.has(ref.sectionId))
          throw new AppError("menu_section.member_duplicate", { sectionId, field: path + ".ref" });
        placedSections.add(ref.sectionId);
      } else {
        const section = before.section(ref.sectionId);
        if (section === undefined)
          throw new AppError("menu_section.not_found", {
            sectionId: ref.sectionId,
            field: path + ".ref",
          });
        if (section.role !== "menu_root")
          throw new AppError("menu_section.wrong_role", {
            sectionId: ref.sectionId,
            role: section.role,
            field: path + ".ref",
          });
        const included = before.menu(section.ownerMenuId)!;
        if (included.kind === "set_menu")
          throw new AppError("set_menu.wrong_place", {
            menuId: section.ownerMenuId,
            field: path + ".ref",
          });
        include = true;
        deleted = !included.active;
        if (!deleted && wouldCreateCycle(before, root, ref.sectionId))
          throw new AppError("menu_section.member_cycle", {
            sectionId,
            childSectionId: ref.sectionId,
            field: path + ".ref",
          });
      }

      if (deleted) {
        dropped.push({ memberId: id, reason: "deleted" });
        continue;
      }
      const key = refKey(ref);
      if (seen.has(key))
        throw new AppError("menu_section.member_duplicate", { sectionId, field: path + ".ref" });
      seen.add(key);
      if (include !== (folder !== undefined))
        throw new AppError("menu_section.invalid", { field: path + ".folder" });
      const position = list.length;
      list.push({ id, ref, position });
      const storedRef =
        ref.kind === "set_menu" ? { kind: "section" as const, sectionId: childSectionId! } : ref;
      const columns = { id, sectionId, position, ...refColumns(storedRef) };
      if (folder === undefined) checkedMembers.push(columns);
      else {
        const overrides = await atField(path + ".folder", "names", () =>
          checkedOverrides(tx, folder.overrides, undefined, languages),
        );
        if (stored?.childSectionId === columns.childSectionId)
          overrides.names =
            retainedNames(before.folder(id).overrides.names, overrides.names, languages) ??
            undefined;
        checkedMembers.push({
          ...columns,
          showAsFolder: folder.showAsFolder,
          ...columnsFromOverrides(overrides),
        });
      }
    }
  }

  // Each owned section has at most one placement. Requiring a path from the root
  // also refuses a loop in a group of sections detached from it.
  const reached = new Set([root]);
  const pending = [root];
  while (pending.length > 0) {
    for (const { ref } of children.get(pending.pop()!) ?? [])
      if (ref.kind === "section" && checkedSections.has(ref.sectionId)) {
        reached.add(ref.sectionId);
        pending.push(ref.sectionId);
      }
  }
  for (const [index, { id }] of input.sections.entries())
    if (!reached.has(id))
      throw new AppError("menu_section.membership_invalid", { field: "sections." + index + ".id" });

  const removed = owned.filter(({ id }) => !checkedSections.has(id)).map(({ id }) => id);
  for (const id of removed)
    for (const parent of before.parents(id))
      if (before.role(parent) === "home_layout") await keepMissingTile(tx, before, parent, id);
  for (const batch of batches([...oldLists]))
    await tx.delete(sectionMembers).where(inArray(sectionMembers.sectionId, batch));
  for (const batch of batches(removed))
    await tx.delete(sections).where(inArray(sections.id, batch));
  for (const { id, ...values } of checkedSections.values()) {
    if (oldLists.has(id)) await tx.update(sections).set(values).where(eq(sections.id, id));
    else await tx.insert(sections).values({ id, ...values });
  }
  for (const batch of batches(checkedMembers)) await tx.insert(sectionMembers).values(batch);
  await onStructureChanged(tx, menusContaining(before, root), before);

  const draftGraph = {
    ...before,
    children: (id: string) => children.get(id) ?? before.children(id),
  };
  await writePrices(
    tx,
    menuId,
    input.prices,
    catalogue,
    new Set(reachableProducts(draftGraph, root)),
    dropped,
  );
  return { dropped };
}
