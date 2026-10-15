import { CEREAL_KINDS, NUT_KINDS, type Kind } from "@waitron/catalogue/src/allergens.js";
import { ALLERGEN_CODES, allergenName, allergenKindName } from "../i18n/domain.js";
import type { AllergenDeclaration } from "../api/client.js";

export const ALLERGEN_CHOICES = ALLERGEN_CODES.flatMap((code) =>
  code === "gluten"
    ? CEREAL_KINDS.map((kind) => `${code}:${kind}`)
    : code === "nuts"
      ? NUT_KINDS.map((kind) => `${code}:${kind}`)
      : [code],
);

export function allergenChoiceName(choice: string): string {
  const [code, kind] = choice.split(":");
  return kind === undefined
    ? allergenName(code!)
    : `${allergenName(code!)} (${allergenKindName(kind)})`;
}

export function allergenChoices(value: AllergenDeclaration): string[] {
  return Object.entries(value ?? {}).flatMap(([code, entry]) =>
    entry.kinds ? entry.kinds.map((kind) => `${code}:${kind}`) : [code],
  );
}

export function allergensFromChoices(values: readonly string[]): NonNullable<AllergenDeclaration> {
  const result: NonNullable<AllergenDeclaration> = {};
  for (const choice of values) {
    if (!ALLERGEN_CHOICES.includes(choice)) continue;
    const [code, kind] = choice.split(":");
    if (kind === undefined) result[code!] = {};
    else {
      const entry = (result[code!] ??= { kinds: [] });
      if (!entry.kinds!.includes(kind as Kind)) entry.kinds!.push(kind as Kind);
    }
  }
  return result;
}

export function allergensForComparison(value: AllergenDeclaration): AllergenDeclaration {
  return value === null ? null : allergensFromChoices(allergenChoices(value).sort());
}
