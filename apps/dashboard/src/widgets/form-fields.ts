import { html } from "lit";
import { currentContentLanguages, type SummaryField } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { MAX_MODIFIER_INTEGER, isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { currentLocale, t } from "../i18n/t.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-price-input.js";
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

/** A price in euros as the dashboard's language writes it. Text that is not a price — a draft still
 * being typed — is shown as it stands. */
export const priceText = (value: string) =>
  isProductPrice(value) ? formatMoney(value, currentLocale()) : value;

/** What a table's search finds a price by: the text shown, again with the no-break space Spanish
 * writes before the sign read as the space a keyboard types, and the raw amounts. */
export const priceSearchText = (shown: string, raw: readonly string[]) =>
  [shown, shown.replace(/\u00a0/g, " "), ...raw].join(" ");

/** Each language's text after its upper-case code, blank ones left out: a folded names section's
 * closed line as `wt-disclosure`'s `summaryFields`. */
export function namesLine(
  locales: readonly string[],
  text: Record<string, string>,
): { label: string; value: string }[] {
  return locales.flatMap((locale) => {
    const value = text[locale]?.trim();
    return value ? [{ label: locale.toUpperCase(), value }] : [];
  });
}

/** {@link namesLine} with every blank language shown as the name it falls back to, marked as a
 * placeholder: the default language's text, then `staffName`, as {@link optionalTextFields} hints it.
 * A language with nothing to fall back to is left out. */
export function effectiveNamesLine(
  locales: readonly string[],
  text: Record<string, string>,
  defaultLanguage: string,
  staffName: string,
): SummaryField[] {
  return locales.flatMap((locale) => {
    const own = text[locale]?.trim();
    if (own) return [{ label: locale.toUpperCase(), value: own }];
    const inherited = defaultLanguageHint(text, locale, defaultLanguage) || staffName.trim();
    return inherited ? [{ label: locale.toUpperCase(), value: inherited, placeholder: true }] : [];
  });
}

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
  hint = "",
) {
  return html`<wt-input
    name=${key}
    label=${label}
    placeholder=${placeholder}
    hint=${hint}
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

/** {@link textField} for an amount in euros: the field draws the sign where the dashboard's language
 * writes it, and has no unit. */
export function priceField(
  context: FieldContext,
  key: string,
  label: string,
  value: string,
  change: (value: string) => void,
  required = false,
  placeholder = "",
  hint = "",
) {
  return html`<wt-price-input
    name=${key}
    label=${label}
    fixed-unit
    locale=${currentLocale()}
    placeholder=${placeholder}
    hint=${hint}
    .value=${value}
    .required=${required}
    .disabled=${context.busy}
    .error=${context.error(key)}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      change(event.detail.value);
    }}
  ></wt-price-input>`;
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

/** The default language's text in `value`, as the hint of a blank field in any OTHER language; ""
 * in the default language itself, which has nothing to fall back to. */
export function defaultLanguageHint(
  value: Record<string, string>,
  locale: string,
  defaultLanguage: string | undefined,
): string {
  if (defaultLanguage === undefined || locale === defaultLanguage) return "";
  return value[defaultLanguage]?.trim() ?? "";
}

/**
 * Unlike {@link nameFields} no language is required: a customer-facing name left blank falls back to
 * the staff name rather than being a missing value. `placeholder` is what it falls back TO, shown
 * rather than stored. Given `defaultLanguage`, every other language falls back to the default
 * language's text first, as `resolveContentText` (`packages/shared/src/content-languages.ts`) does.
 */
export function optionalTextFields(
  context: FieldContext,
  key: string,
  label: string,
  value: Record<string, string>,
  change: (value: Record<string, string>) => void,
  placeholder = "",
  defaultLanguage?: string,
) {
  return context.locales.map((locale) =>
    textField(
      context,
      `${key}-${locale}`,
      `${label} (${locale})`,
      value[locale] ?? "",
      (text) => change({ ...value, [locale]: text }),
      false,
      defaultLanguageHint(value, locale, defaultLanguage) || placeholder,
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
