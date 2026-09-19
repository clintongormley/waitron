import { inArray } from "drizzle-orm";
import { productOptionGroups, type Transaction } from "@waitron/db";
import { type Modifier } from "@waitron/shared";
import { listModifiers } from "./modifiers.js";
import { menuItemOptionGroups, menuItemOptions } from "./schema/menu.js";

function projectModifier(modifier: Modifier, prices?: Map<string, string>): Modifier {
  if (modifier.type === "text") return modifier;
  const available = modifier.choices.filter(
    (choice) => choice.available && (prices === undefined || prices.has(choice.id)),
  );
  if (modifier.type === "options")
    return {
      ...modifier,
      choices: available,
      defaultChoiceId: available.some((choice) => choice.id === modifier.defaultChoiceId)
        ? modifier.defaultChoiceId
        : null,
    };
  return {
    ...modifier,
    choices: modifier.choices
      .filter((choice) => choice.available && (prices === undefined || prices.has(choice.id)))
      .map((choice) => ({
        ...choice,
        priceDelta: prices?.get(choice.id) ?? choice.priceDelta,
      })),
  };
}

/**
 * A product's OLD `product_option_groups` attachments, read as `Modifier` definitions for the
 * till. "Legacy" is in the name because `readProductModifiers` (product-modifiers.ts) is the one
 * that reads what a product carries TODAY — the ordered `product_modifiers` list — and two
 * functions of the same name forced every importer to alias both. This one goes with the old
 * tables in Task 13 of `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`.
 */
export async function readLegacyProductModifiers(
  tx: Transaction,
  productIds: string[],
): Promise<Map<string, Modifier[]>> {
  const result = new Map<string, Modifier[]>();
  if (productIds.length === 0) return result;
  const definitions = new Map((await listModifiers(tx)).map((modifier) => [modifier.id, modifier]));
  const attachments = await tx
    .select({ productId: productOptionGroups.productId, modifierId: productOptionGroups.groupId })
    .from(productOptionGroups)
    .where(inArray(productOptionGroups.productId, productIds))
    .orderBy(productOptionGroups.sort, productOptionGroups.groupId);
  for (const attachment of attachments) {
    const definition = definitions.get(attachment.modifierId);
    if (!definition) continue;
    const modifiers = result.get(attachment.productId) ?? [];
    modifiers.push(projectModifier(definition));
    result.set(attachment.productId, modifiers);
  }
  return result;
}

export async function readMenuModifiers(
  tx: Transaction,
  menuItemIds: string[],
): Promise<Map<string, Modifier[]>> {
  const result = new Map<string, Modifier[]>();
  if (menuItemIds.length === 0) return result;
  const definitions = new Map((await listModifiers(tx)).map((modifier) => [modifier.id, modifier]));
  const publications = await tx
    .select({
      menuItemId: menuItemOptionGroups.menuItemId,
      modifierId: menuItemOptionGroups.groupId,
    })
    .from(menuItemOptionGroups)
    .where(inArray(menuItemOptionGroups.menuItemId, menuItemIds))
    .orderBy(menuItemOptionGroups.displayOrder, menuItemOptionGroups.groupId);
  const options = await tx
    .select()
    .from(menuItemOptions)
    .where(inArray(menuItemOptions.menuItemId, menuItemIds));
  for (const publication of publications) {
    const definition = definitions.get(publication.modifierId);
    if (!definition) continue;
    const prices = new Map(
      options
        .filter(
          (option) =>
            option.menuItemId === publication.menuItemId &&
            option.groupId === publication.modifierId,
        )
        .map((option) => [option.optionId, option.priceDelta]),
    );
    const modifiers = result.get(publication.menuItemId) ?? [];
    modifiers.push(projectModifier(definition, prices));
    result.set(publication.menuItemId, modifiers);
  }
  return result;
}
