import { AppError, isUuid } from "@waitron/shared";
import {
  assertAllergenOverlayDisjoint,
  validateAllergens,
  validateRemoveAllergens,
} from "./allergens.js";
import { validateDietaryDeclarations } from "./dietary-declarations.js";
import type { VatClass } from "./pricing.js";
import { MAX_MODIFIER_INTEGER, isModifierPrice } from "./modifier-limits.js";
import "./errors.js";

export type {
  Modifier,
  ModifierInput,
  ModifierSelection,
  ModifierChoice,
  ExtraChoice,
  ModifierEffects,
  LocalizedText,
} from "@waitron/shared";
import type {
  Modifier,
  ModifierInput,
  ModifierSelection,
  ExtraChoice,
  ModifierEffects,
  LocalizedText,
} from "@waitron/shared";

function invalid(field: string): never {
  throw new AppError("modifier.invalid", { field });
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], field: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`);
}
function label(value: unknown, field: string): LocalizedText {
  const map = record(value, field);
  if (!Object.values(map).every((item) => typeof item === "string")) invalid(field);
  return { ...map } as LocalizedText;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}
function integer(value: unknown, field: string, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > MAX_MODIFIER_INTEGER
  )
    invalid(field);
  return value;
}
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value;
}
const effectKeys = ["addAllergens", "removeAllergens", "dietaryEffect"];
function effects(row: Record<string, unknown>): ModifierEffects {
  const out: ModifierEffects = {};
  if (row.addAllergens !== undefined)
    out.addAllergens = row.addAllergens === null ? null : validateAllergens(row.addAllergens);
  if (row.removeAllergens !== undefined)
    out.removeAllergens =
      row.removeAllergens === null ? null : validateRemoveAllergens(row.removeAllergens);
  assertAllergenOverlayDisjoint(out.addAllergens ?? null, out.removeAllergens ?? null);
  if (row.dietaryEffect !== undefined) {
    if (row.dietaryEffect === null) out.dietaryEffect = null;
    else {
      const effect = record(row.dietaryEffect, "dietaryEffect");
      keys(effect, ["invalidates"], "dietaryEffect");
      out.dietaryEffect = { invalidates: validateDietaryDeclarations(effect.invalidates) };
    }
  }
  return out;
}

export function parseModifierInput(value: unknown): ModifierInput {
  const row = record(value, "modifier");
  const common = {
    name: label(row.name, "name"),
    available: bool(row.available === undefined ? true : row.available, "available"),
  };
  const baseKeys = ["type", "name", "available"];
  if (row.type === "text") {
    keys(row, baseKeys, "modifier");
    return { ...common, type: "text" };
  }
  if (row.type === "yes-no") {
    keys(row, [...baseKeys, "defaultValue"], "modifier");
    return {
      ...common,
      type: "yes-no",
      defaultValue: bool(row.defaultValue === undefined ? false : row.defaultValue, "defaultValue"),
    };
  }
  if (row.type !== "extras" && row.type !== "options") invalid("type");
  const extras = row.type === "extras";
  keys(
    row,
    [...baseKeys, "choices", ...(extras ? ["required", "maxTotalQuantity"] : ["defaultChoiceId"])],
    "modifier",
  );
  if (!Array.isArray(row.choices)) invalid("choices");
  const seen = new Set<string>();
  const choices = row.choices.map((value, index) => {
    const field = `choices.${index}`;
    const choice = record(value, field);
    keys(
      choice,
      [
        "id",
        "name",
        "available",
        ...effectKeys,
        ...(extras ? ["priceDelta", "maxQuantity", "preselected", "vatClass"] : []),
      ],
      field,
    );
    const choiceId = id(choice.id, `${field}.id`);
    if (seen.has(choiceId)) invalid(`${field}.id`);
    seen.add(choiceId);
    const available = bool(
      choice.available === undefined ? true : choice.available,
      `${field}.available`,
    );
    const base = {
      id: choiceId,
      name: label(choice.name, `${field}.name`),
      available,
      ...effects(choice),
    };
    if (!extras) return base;
    const price = choice.priceDelta === undefined ? "0.00" : choice.priceDelta;
    if (typeof price !== "string" || !isModifierPrice(price)) invalid(`${field}.priceDelta`);
    const [whole, fraction = ""] = price.split(".");
    const maxQuantity = integer(
      choice.maxQuantity === undefined ? 1 : choice.maxQuantity,
      `${field}.maxQuantity`,
      1,
    );
    const preselected = bool(
      choice.preselected === undefined ? false : choice.preselected,
      `${field}.preselected`,
    );
    if (
      choice.vatClass !== undefined &&
      choice.vatClass !== null &&
      (typeof choice.vatClass !== "string" ||
        !["general", "reduced", "super_reduced", "zero"].includes(choice.vatClass))
    )
      invalid(`${field}.vatClass`);
    return {
      ...base,
      priceDelta: `${BigInt(whole!)}.${fraction.padEnd(2, "0")}`,
      maxQuantity,
      preselected: available ? preselected : false,
      ...(choice.vatClass === undefined ? {} : { vatClass: choice.vatClass as VatClass | null }),
    };
  });
  const required = extras
    ? bool(row.required === undefined ? false : row.required, "required")
    : true;
  if (common.available && required && !choices.some((choice) => choice.available))
    invalid("choices");
  if (!extras) {
    const defaultId =
      row.defaultChoiceId == null ? null : id(row.defaultChoiceId, "defaultChoiceId");
    if (defaultId !== null && !seen.has(defaultId)) invalid("defaultChoiceId");
    return {
      ...common,
      type: "options",
      choices,
      defaultChoiceId: choices.some((choice) => choice.id === defaultId && choice.available)
        ? defaultId
        : null,
    };
  }
  const maxTotalQuantity =
    row.maxTotalQuantity == null ? null : integer(row.maxTotalQuantity, "maxTotalQuantity", 1);
  const extraChoices = choices as ExtraChoice[];
  if (
    maxTotalQuantity !== null &&
    extraChoices.reduce((sum, choice) => sum + (choice.preselected ? 1 : 0), 0) > maxTotalQuantity
  )
    invalid("maxTotalQuantity");
  return { ...common, type: "extras", required, maxTotalQuantity, choices: extraChoices };
}

/** Prices and labels are resolved separately from this explicit, validated selection. */
export function validateModifierSelections(
  definitions: readonly Modifier[],
  value: unknown,
): ModifierSelection[] {
  if (!Array.isArray(value)) invalid("modifierSelections");
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const seen = new Set<string>();
  const out: ModifierSelection[] = [];
  for (const raw of value) {
    const row = record(raw, "modifierSelections");
    if (typeof row.modifierId !== "string" || seen.has(row.modifierId)) invalid("modifierId");
    seen.add(row.modifierId);
    const definition = byId.get(row.modifierId);
    if (!definition || !definition.available || row.type !== definition.type) invalid("modifierId");
    const base = { modifierId: definition.id };
    switch (definition.type) {
      case "text": {
        keys(row, ["modifierId", "type", "text"], "selection");
        if (typeof row.text !== "string" || row.text.length > 500) invalid("text");
        if (row.text.trim() !== "") out.push({ ...base, type: "text", text: row.text });
        break;
      }
      case "yes-no":
        keys(row, ["modifierId", "type", "value"], "selection");
        out.push({ ...base, type: "yes-no", value: bool(row.value, "value") });
        break;
      case "options":
        keys(row, ["modifierId", "type", "choiceId"], "selection");
        if (!definition.choices.some((choice) => choice.id === row.choiceId && choice.available))
          invalid("choiceId");
        out.push({ ...base, type: "options", choiceId: row.choiceId as string });
        break;
      case "extras": {
        keys(row, ["modifierId", "type", "choices"], "selection");
        if (!Array.isArray(row.choices)) invalid("choices");
        const choiceIds = new Set<string>();
        let total = 0;
        const choices = row.choices.map((raw) => {
          const choice = record(raw, "choices");
          keys(choice, ["choiceId", "quantity"], "choice");
          const offered = definition.choices.find(
            (item) => item.id === choice.choiceId && item.available,
          );
          if (!offered || choiceIds.has(offered.id)) invalid("choiceId");
          choiceIds.add(offered.id);
          const quantity = integer(choice.quantity, "quantity", 1);
          if (quantity > offered.maxQuantity) invalid("quantity");
          total += quantity;
          return { choiceId: offered.id, quantity };
        });
        if (
          (definition.required && total === 0) ||
          (definition.maxTotalQuantity !== null && total > definition.maxTotalQuantity)
        )
          invalid("choices");
        out.push({ ...base, type: "extras", choices });
        break;
      }
    }
  }
  for (const definition of definitions) {
    if (!definition.available) continue;
    if (
      (definition.type === "options" ||
        definition.type === "yes-no" ||
        (definition.type === "extras" && definition.required)) &&
      !seen.has(definition.id)
    )
      invalid("required");
  }
  return out;
}
