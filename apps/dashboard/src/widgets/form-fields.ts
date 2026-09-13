import { html } from "lit";
import { currentContentLanguages } from "@waitron/ui";
import { MAX_MODIFIER_INTEGER } from "@waitron/catalogue/src/modifier-limits.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";

/** What a field builder needs from the form that renders it. */
export interface FieldContext {
  busy: boolean;
  /** The content languages a translated name is entered in. */
  locales: readonly string[];
  /** The message for a field key, or "" when it is valid. */
  error: (key: string) => string;
}

/** A whole number from 1 to the largest quantity a modifier may store, written in plain digits. */
export const isPositiveInteger = (text: string) =>
  /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= MAX_MODIFIER_INTEGER;

/** A translated name without its blank entries, so a language left blank is not submitted. */
export const nonBlankNames = (value: Record<string, string>) =>
  Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim()));

export function textField(
  context: FieldContext,
  key: string,
  label: string,
  value: string,
  change: (value: string) => void,
  required = false,
) {
  return html`<wt-input
    name=${key}
    label=${label}
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
