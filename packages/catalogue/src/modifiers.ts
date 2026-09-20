import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  optionGroups,
  optionGroupItems,
  products,
  productOptionGroups,
  type Transaction,
} from "@waitron/db";
import { AppError, centsToDecimal, decimal, decimalToCents } from "@waitron/shared";
import { menuItems, menuItemOptionGroups } from "./schema/menu.js";
import {
  parseModifierInput,
  type Modifier,
  type ModifierInput,
  type ExtraChoice,
  type ModifierChoice,
} from "./modifier-contract.js";
import { lockModifierDefinitions } from "./modifier-lock.js";
import { MAX_MODIFIER_INTEGER } from "./modifier-limits.js";
import { validateContentTranslations } from "./content-languages.js";
import "./errors.js";

export async function listModifiers(tx: Transaction): Promise<Modifier[]> {
  const groups = await tx.select().from(optionGroups).orderBy(optionGroups.sort, optionGroups.id);
  if (groups.length === 0) return [];
  const items = await tx
    .select()
    .from(optionGroupItems)
    .where(
      inArray(
        optionGroupItems.groupId,
        groups.map((g) => g.id),
      ),
    )
    .orderBy(optionGroupItems.sort, optionGroupItems.id);
  return groups.map((group): Modifier => {
    // Every modifier is offered as a whole; availability is toggled per choice. A stored active=false
    // on a group is an inconsistency; reading it back as unavailable would hide it from the till
    // while the projection still requires a selection.
    const common = {
      id: group.id,
      name: group.name,
      available: true,
    };
    if (group.type === "text") return { ...common, type: "text" };
    const choices = items
      .filter((item) => item.groupId === group.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        available: item.active,
        ...(item.addAllergens === null ? {} : { addAllergens: item.addAllergens }),
        suitableFor: item.dietarySuitability ?? [],
        ...(group.type === "extras"
          ? {
              // The `as ModifierChoice[]` below widens this object, so the compiler never checks
              // this conversion. What does: "saves complete definitions as app_user, preserving ids
              // and order" (modifiers.pg.test.ts), which asserts the decimal string read back.
              priceDelta: centsToDecimal(item.priceDelta),
              maxQuantity: item.maxQuantity,
              preselected: item.preselected,
              ...(item.vatClass === null
                ? {}
                : { vatClass: item.vatClass as ExtraChoice["vatClass"] }),
            }
          : {}),
      })) as ModifierChoice[];
    if (group.type === "options")
      return { ...common, type: "options", choices, defaultChoiceId: group.defaultChoiceId };
    return {
      ...common,
      type: "extras",
      required: group.required,
      maxTotalQuantity: group.maxTotalQuantity,
      choices: choices as ExtraChoice[],
    };
  });
}

export async function getModifier(tx: Transaction, modifierId: string): Promise<Modifier> {
  const found = (await listModifiers(tx)).find((modifier) => modifier.id === modifierId);
  if (!found) throw new AppError("modifier.not_found", { modifierId });
  return found;
}

async function assertUnused(tx: Transaction, modifierId: string): Promise<void> {
  const result = await tx.execute<{ dependency: string }>(sql`
    select 'product' as dependency from product_option_groups where group_id = ${modifierId}
    union all select 'menu' as dependency from menu_item_option_groups where group_id = ${modifierId}
    limit 1
  `);
  if (result.rows[0])
    throw new AppError("modifier.in_use", { modifierId, dependency: result.rows[0].dependency });
}

async function validateLabels(tx: Transaction, input: ModifierInput, fallback: string) {
  await validateContentTranslations(tx, input.name, fallback);
  if (input.type === "extras" || input.type === "options") {
    for (const choice of input.choices)
      await validateContentTranslations(tx, choice.name, fallback);
  }
}
function groupValues(input: ModifierInput) {
  const required = input.type === "options" || (input.type === "extras" && input.required);
  return {
    name: input.name,
    active: input.available,
    type: input.type,
    required,
    minSelect: required ? 1 : 0,
    maxSelect: input.type === "extras" ? (input.maxTotalQuantity ?? MAX_MODIFIER_INTEGER) : 1,
    maxTotalQuantity: input.type === "extras" ? input.maxTotalQuantity : null,
    defaultChoiceId: input.type === "options" ? input.defaultChoiceId : null,
  };
}
async function writeChoices(tx: Transaction, modifierId: string, input: ModifierInput) {
  const choices = input.type === "extras" || input.type === "options" ? input.choices : [];
  const old = await tx
    .select()
    .from(optionGroupItems)
    .where(eq(optionGroupItems.groupId, modifierId));
  const retained = new Set(choices.map((choice) => choice.id));
  for (const item of old) {
    if (retained.has(item.id)) continue;
    // Only a menu publication can still hold a choice: an open order line names none, for the reason
    // {@link deleteModifier} states.
    const usage = await tx.execute(
      sql`select 1 from menu_item_options where option_id = ${item.id} limit 1`,
    );
    if (usage.rows.length)
      throw new AppError("modifier.in_use", { modifierId, dependency: "choice" });
    await tx.delete(optionGroupItems).where(eq(optionGroupItems.id, item.id));
  }
  for (const [sort, choice] of choices.entries()) {
    const values = {
      name: choice.name,
      active: choice.available,
      sort,
      priceDelta:
        input.type === "extras" ? decimalToCents(decimal((choice as ExtraChoice).priceDelta)) : 0,
      maxQuantity: input.type === "extras" ? (choice as ExtraChoice).maxQuantity : 1,
      preselected: input.type === "extras" ? (choice as ExtraChoice).preselected : false,
      vatClass: input.type === "extras" ? ((choice as ExtraChoice).vatClass ?? null) : null,
      addAllergens: choice.addAllergens ?? null,
      dietarySuitability: choice.suitableFor ?? [],
    };
    if (old.some((item) => item.id === choice.id)) {
      await tx
        .update(optionGroupItems)
        .set(values)
        .where(and(eq(optionGroupItems.groupId, modifierId), eq(optionGroupItems.id, choice.id)));
    } else {
      const inserted = await tx
        .insert(optionGroupItems)
        .values({ groupId: modifierId, id: choice.id, ...values })
        .onConflictDoNothing()
        .returning({ id: optionGroupItems.id });
      if (!inserted.length) throw new AppError("modifier.invalid", { field: `choices.${sort}.id` });
    }
  }
}
export async function createModifier(
  tx: Transaction,
  value: unknown,
  fallbackLanguage: string,
): Promise<Modifier> {
  const input = parseModifierInput(value);
  await validateLabels(tx, input, fallbackLanguage);
  await lockModifierDefinitions(tx);
  const id = randomUUID();
  await tx.insert(optionGroups).values({ id, ...groupValues(input) });
  await writeChoices(tx, id, input);
  return getModifier(tx, id);
}
export async function updateModifier(
  tx: Transaction,
  modifierId: string,
  value: unknown,
  fallbackLanguage: string,
): Promise<Modifier> {
  const input = parseModifierInput(value);
  await validateLabels(tx, input, fallbackLanguage);
  await lockModifierDefinitions(tx);
  const old = await getModifier(tx, modifierId);
  if (old.type !== input.type) await assertUnused(tx, modifierId);
  await tx.update(optionGroups).set(groupValues(input)).where(eq(optionGroups.id, modifierId));
  await writeChoices(tx, modifierId, input);
  return getModifier(tx, modifierId);
}
export async function deleteModifier(tx: Transaction, modifierId: string): Promise<void> {
  await lockModifierDefinitions(tx);
  await getModifier(tx, modifierId); // 404s an absent id
  // A product or menu attachment is cascaded away by the delete, so neither blocks it. NOTHING ELSE
  // can: an open order line has no column naming a modifier or an option-group item since the order
  // path moved to extras and options (`packages/db/src/schema/orders.ts`), so the refusal that used
  // to stand here had nothing left to find. This whole file goes with Task 13 of
  // `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`.
  await tx.delete(optionGroups).where(eq(optionGroups.id, modifierId));
}

export interface ModifierDependants {
  products: { id: string; name: string }[];
  menus: { id: string; name: string }[];
  orders: number;
}

/** What deleting this modifier would touch — the preview the dashboard's delete confirmation reads.
 * Products and menus are detached (cascaded) by the delete. `orders` is always 0 now: an open order
 * line no longer carries a column that could name this modifier, for the reason {@link deleteModifier}
 * states. A menu publication has no name of its own here, so it is identified by the product the menu
 * item is (its staff name). */
export async function modifierDependants(
  tx: Transaction,
  modifierId: string,
): Promise<ModifierDependants> {
  await getModifier(tx, modifierId); // 404s an absent id
  const productRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .innerJoin(
      productOptionGroups,
      and(
        eq(productOptionGroups.productId, products.id),
        eq(productOptionGroups.groupId, modifierId),
      ),
    )
    .orderBy(products.id);
  const menuRows = await tx
    .select({ id: menuItems.id, name: products.name })
    .from(menuItemOptionGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemOptionGroups.menuItemId))
    .innerJoin(products, eq(products.id, menuItems.productId))
    .where(eq(menuItemOptionGroups.groupId, modifierId))
    .orderBy(menuItems.id);
  return {
    products: productRows,
    menus: menuRows,
    orders: 0,
  };
}
