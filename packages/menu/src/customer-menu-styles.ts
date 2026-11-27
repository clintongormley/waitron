import { isStoredColor, type CustomerMenuAppearance } from "@waitron/shared";

const isTypeface = (value: unknown) => value === "system" || value === "serif";

const fields = {
  pageColor: isStoredColor,
  textColor: isStoredColor,
  headingColor: isStoredColor,
  headingFont: isTypeface,
  textFont: isTypeface,
} satisfies Record<keyof CustomerMenuAppearance, (value: unknown) => boolean>;

export function checkedCustomerMenuAppearance(
  value: unknown,
  refuse: (field: string) => never,
): CustomerMenuAppearance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse("appearance");
  for (const [name, field] of Object.entries(value)) {
    if (!Object.hasOwn(fields, name) || !fields[name as keyof CustomerMenuAppearance](field))
      refuse(name);
  }
  return value as CustomerMenuAppearance;
}
