import { html } from "lit";
import { currentContentLanguages } from "@waitron/ui";
import { MAX_MODIFIER_INTEGER } from "@waitron/catalogue/src/modifier-limits.js";
import { t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";

export interface FieldContext {
  busy: boolean;
  /** The content languages a translated name is entered in. */
  locales: readonly string[];
  /** The message for a field key, or "" when it is valid. */
  error: (key: string) => string;
}

export function wholeWithin(text: string, minimum: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= minimum && value <= MAX_MODIFIER_INTEGER ? value : null;
}

export const isModifierQuantity = (text: string) => wholeWithin(text, 1) !== null;

export const priceLabel = (unitLabel: string) =>
  unitLabel.trim() ? t("editor.price_unit").replace("{unit}", unitLabel) : t("editor.price");

export const nonBlankNames = (value: Record<string, string>) =>
  Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim()));

/** {@link nonBlankNames} as an optional translated map: null when nothing was entered at all, which
 * is the shape the catalogue's contracts read an optional customer name as. */
export function translations(value: Record<string, string>): Record<string, string> | null {
  const named = nonBlankNames(value);
  return Object.keys(named).length ? named : null;
}

export function textField(
  context: FieldContext,
  key: string,
  label: string,
  value: string,
  change: (value: string) => void,
  required = false,
  placeholder = "",
) {
  return html`<wt-input
    name=${key}
    label=${label}
    placeholder=${placeholder}
    .value=${value}
    .required=${required}
    .disabled=${context.busy}
    .error=${context.error(key)}
    .invalid=${!!context.error(key)}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      change(event.detail.value);
    }}
  ></wt-input>`;
}

/** One input per content language, named `<key>-<locale>`. Only the default language is required,
 * and it also shows the error reported for the name as a whole (`key`). */
export function nameFields(
  context: FieldContext,
  key: string,
  label: string,
  value: Record<string, string>,
  change: (value: Record<string, string>) => void,
) {
  return context.locales.map((locale) => {
    const required = locale === currentContentLanguages().defaultLanguage;
    const error = context.error(`${key}-${locale}`) || (required ? context.error(key) : "");
    return html`<wt-input
      name=${`${key}-${locale}`}
      label=${`${label} (${locale})`}
      .value=${value[locale] ?? ""}
      .required=${required}
      .disabled=${context.busy}
      .error=${error}
      .invalid=${!!error}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        change({ ...value, [locale]: event.detail.value });
      }}
    ></wt-input>`;
  });
}

/**
 * Unlike {@link nameFields} no language is required: a customer-facing name left blank falls back to
 * the staff name rather than being a missing value. `placeholder` is what it falls back TO, shown
 * rather than stored.
 */
export function optionalTextFields(
  context: FieldContext,
  key: string,
  label: string,
  value: Record<string, string>,
  change: (value: Record<string, string>) => void,
  placeholder = "",
) {
  return context.locales.map((locale) =>
    textField(
      context,
      `${key}-${locale}`,
      `${label} (${locale})`,
      value[locale] ?? "",
      (text) => change({ ...value, [locale]: text }),
      false,
      placeholder,
    ),
  );
}

export function switchField(
  context: FieldContext,
  key: string,
  label: string,
  checked: boolean,
  change: (checked: boolean) => void,
) {
  return html`<wt-switch
    name=${key}
    label=${label}
    .checked=${checked}
    .disabled=${context.busy}
    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
      event.stopPropagation();
      change(event.detail.checked);
    }}
  ></wt-switch>`;
}
