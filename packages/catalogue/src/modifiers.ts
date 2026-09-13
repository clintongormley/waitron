import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { optionGroups, optionGroupItems, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  parseModifierInput,
  type Modifier,
  type ModifierInput,
  type ExtraChoice,
  type ModifierChoice,
} from "./modifier-contract.js";
import { lockModifierDefinitions } from "./modifier-lock.js";
import { validateContentTranslations } from "./content-languages.js";
import "./errors.js";

export async function listModifiers(tx: Transaction, tenantId: string): Promise<Modifier[]> {
  const groups = await tx
    .select()
    .from(optionGroups)
    .where(eq(optionGroups.tenantId, tenantId))
    .orderBy(optionGroups.sort, optionGroups.id);
  if (groups.length === 0) return [];
  const items = await tx
    .select()
    .from(optionGroupItems)
    .where(
      and(
        eq(optionGroupItems.tenantId, tenantId),
        inArray(
          optionGroupItems.groupId,
          groups.map((g) => g.id),
        ),
      ),
    )
    .orderBy(optionGroupItems.sort, optionGroupItems.id);
  return groups.map((group): Modifier => {
    const common = { id: group.id, name: group.name, available: group.active };
    if (group.type === "text") return { ...common, type: "text" };
    if (group.type === "yes-no")
      return {
        ...common,
        type: "yes-no",
        defaultValue: group.defaultValue,
      };
    const choices = items
      .filter((item) => item.groupId === group.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        available: item.active,
        ...(item.addAllergens === null ? {} : { addAllergens: item.addAllergens }),
        ...(item.removeAllergens === null ? {} : { removeAllergens: item.removeAllergens }),
        ...(item.addOrigins === null ? {} : { addOrigins: item.addOrigins }),
        ...(item.removeOrigins === null ? {} : { removeOrigins: item.removeOrigins }),
        dietaryEffect: item.dietaryEffect,
        ...(group.type === "extras"
          ? {
              priceDelta: item.priceDelta,
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

export async function getModifier(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
): Promise<Modifier> {
  const found = (await listModifiers(tx, tenantId)).find((modifier) => modifier.id === modifierId);
  if (!found) throw new AppError("modifier.not_found", { modifierId });
  return found;
}

async function assertUnused(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
  retainedOrders: boolean,
): Promise<void> {
  const result = await tx.execute<{ dependency: string }>(sql`
    select 'product' as dependency from product_option_groups where tenant_id = ${tenantId} and group_id = ${modifierId}
    union all select 'menu' as dependency from menu_item_option_groups where tenant_id = ${tenantId} and group_id = ${modifierId}
    ${
      retainedOrders
        ? sql`union all select 'order' as dependency from working_order_lines where tenant_id = ${tenantId} and (
      modifier_snapshots @> ${JSON.stringify([{ modifierId }])}::jsonb or option_group_item_id in (select id from option_group_items where tenant_id = ${tenantId} and group_id = ${modifierId})
    )`
        : sql``
    }
    limit 1
  `);
  if (result.rows[0])
    throw new AppError("modifier.in_use", { modifierId, dependency: result.rows[0].dependency });
}

async function validateLabels(
  tx: Transaction,
  tenantId: string,
  input: ModifierInput,
  fallback: string,
) {
  await validateContentTranslations(tx, tenantId, input.name, fallback);
  if (input.type === "extras" || input.type === "options") {
    for (const choice of input.choices)
      await validateContentTranslations(tx, tenantId, choice.name, fallback);
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
    maxSelect: input.type === "extras" ? (input.maxTotalQuantity ?? 2147483647) : 1,
    maxTotalQuantity: input.type === "extras" ? input.maxTotalQuantity : null,
    defaultChoiceId: input.type === "options" ? input.defaultChoiceId : null,
    defaultValue: input.type === "yes-no" ? input.defaultValue : false,
  };
}
async function writeChoices(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
  input: ModifierInput,
) {
  const choices = input.type === "extras" || input.type === "options" ? input.choices : [];
  const old = await tx
    .select()
    .from(optionGroupItems)
    .where(and(eq(optionGroupItems.tenantId, tenantId), eq(optionGroupItems.groupId, modifierId)));
  const retained = new Set(choices.map((choice) => choice.id));
  for (const item of old) {
    if (retained.has(item.id)) continue;
    const usage =
      await tx.execute(sql`select 1 from menu_item_options where tenant_id = ${tenantId} and option_id = ${item.id}
      union all select 1 from working_order_lines where tenant_id = ${tenantId} and (option_group_item_id = ${item.id} or modifier_snapshots @> ${JSON.stringify([{ type: "options", choiceId: item.id }])}::jsonb) limit 1`);
    if (usage.rows.length)
      throw new AppError("modifier.in_use", { modifierId, dependency: "choice" });
    await tx
      .delete(optionGroupItems)
      .where(and(eq(optionGroupItems.tenantId, tenantId), eq(optionGroupItems.id, item.id)));
  }
  for (const [sort, choice] of choices.entries()) {
    const values = {
      name: choice.name,
      active: choice.available,
      sort,
      priceDelta: input.type === "extras" ? (choice as ExtraChoice).priceDelta : "0.00",
      maxQuantity: input.type === "extras" ? (choice as ExtraChoice).maxQuantity : 1,
      preselected: input.type === "extras" ? (choice as ExtraChoice).preselected : false,
      vatClass: input.type === "extras" ? ((choice as ExtraChoice).vatClass ?? null) : null,
      addAllergens: choice.addAllergens ?? null,
      removeAllergens: choice.removeAllergens ?? null,
      addOrigins: choice.addOrigins ?? null,
      removeOrigins: choice.removeOrigins ?? null,
      dietaryEffect: choice.dietaryEffect ?? null,
    };
    if (old.some((item) => item.id === choice.id)) {
      await tx
        .update(optionGroupItems)
        .set(values)
        .where(
          and(
            eq(optionGroupItems.tenantId, tenantId),
            eq(optionGroupItems.groupId, modifierId),
            eq(optionGroupItems.id, choice.id),
          ),
        );
    } else {
      const inserted = await tx
        .insert(optionGroupItems)
        .values({ tenantId, groupId: modifierId, id: choice.id, ...values })
        .onConflictDoNothing()
        .returning({ id: optionGroupItems.id });
      if (!inserted.length) throw new AppError("modifier.invalid", { field: `choices.${sort}.id` });
    }
  }
}
export async function createModifier(
  tx: Transaction,
  tenantId: string,
  value: unknown,
  fallbackLanguage: string,
): Promise<Modifier> {
  const input = parseModifierInput(value);
  await validateLabels(tx, tenantId, input, fallbackLanguage);
  await lockModifierDefinitions(tx, tenantId);
  const id = randomUUID();
  await tx.insert(optionGroups).values({ tenantId, id, ...groupValues(input) });
  await writeChoices(tx, tenantId, id, input);
  return getModifier(tx, tenantId, id);
}
export async function updateModifier(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
  value: unknown,
  fallbackLanguage: string,
): Promise<Modifier> {
  const input = parseModifierInput(value);
  await validateLabels(tx, tenantId, input, fallbackLanguage);
  await lockModifierDefinitions(tx, tenantId);
  const old = await getModifier(tx, tenantId, modifierId);
  if (old.type !== input.type) await assertUnused(tx, tenantId, modifierId, false);
  await tx
    .update(optionGroups)
    .set(groupValues(input))
    .where(and(eq(optionGroups.tenantId, tenantId), eq(optionGroups.id, modifierId)));
  await writeChoices(tx, tenantId, modifierId, input);
  return getModifier(tx, tenantId, modifierId);
}
export async function deleteModifier(
  tx: Transaction,
  tenantId: string,
  modifierId: string,
): Promise<void> {
  await lockModifierDefinitions(tx, tenantId);
  await getModifier(tx, tenantId, modifierId);
  await assertUnused(tx, tenantId, modifierId, true);
  await tx
    .delete(optionGroups)
    .where(and(eq(optionGroups.tenantId, tenantId), eq(optionGroups.id, modifierId)));
}
