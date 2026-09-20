import { AppError, contentLanguageCode, isUuid } from "@waitron/shared";
import type { OptionSelection } from "@waitron/shared";
import { nonBlankTranslations } from "./product-presentation.js";
import "./errors.js";

export type { OptionSelection, OptionSnapshot } from "@waitron/shared";

/**
 * A label and its list each carry the same three names as a product: plain staff `name`, a translated
 * `customerName` map, and a plain `kitchenName`. A null customer or kitchen name falls back to
 * `name`; only `name` is required.
 */
export interface OptionLabel {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  available: boolean;
}

/** A reusable list of labels the diner picks exactly one of. It owns no price, VAT or allergens. */
export interface OptionList {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  /** A label of THIS list, preselected when the list is asked; null when nothing is preselected. */
  defaultLabelId: string | null;
  active: boolean;
  /** Presentation order: the caller writes each label's `sort` from its position here. */
  labels: OptionLabel[];
}

export type OptionLabelInput = Omit<OptionLabel, "id"> & { id?: string };
export type OptionListInput = Omit<OptionList, "id" | "labels"> & { labels: OptionLabelInput[] };

function invalid(field: string): never {
  throw new AppError("options.invalid", { field });
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], field: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`);
}
/** The staff name: plain text, required, and blank is the same as missing. */
function staffName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(field);
  return value;
}
/**
 * The translated customer name: absent, null, or a map holding no text anywhere means "fall back to
 * the staff name". Every key must be a language code and every value text. This is the same handling
 * `nullableTranslations` gives a product's and a variant's customer name (product-editor-input.ts),
 * so the same body is accepted here and there — with one deliberate difference: a bad language key
 * is reported as `options.invalid` carrying the field path, where the product path lets
 * `contentLanguageCode`'s own `content.language_invalid` out with no field on it. An option-list save
 * submits a translated map for the list AND one per label, so a refusal that names no field cannot be
 * put beside the input that caused it (CLAUDE.md §3).
 */
function translations(value: unknown, field: string): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  const map = record(value, field);
  for (const [language, text] of Object.entries(map)) {
    if (typeof text !== "string") invalid(field);
    try {
      contentLanguageCode(language);
    } catch {
      invalid(field);
    }
  }
  return nonBlankTranslations({ ...map } as Record<string, string>);
}
/** The kitchen name: plain text, and blank is the same as missing. */
function kitchenName(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid(field);
  return value.trim() === "" ? null : value;
}
function flag(value: unknown, field: string): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") invalid(field);
  return value;
}
/**
 * `isUuid` accepts either case and so does a PostgreSQL `uuid` column, which hands the value back
 * lower-cased. Lower-casing here is what makes a body's own ids comparable to each other and to the
 * stored rows — the same normalisation `product-editor-input.ts` applies.
 */
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value.toLowerCase();
}

export function parseOptionListInput(value: unknown): OptionListInput {
  const row = record(value, "optionList");
  keys(
    row,
    ["name", "customerName", "kitchenName", "defaultLabelId", "active", "labels"],
    "optionList",
  );
  // The list's own name and flag fields are checked before its labels. `defaultLabelId` is NOT: it
  // has to name one of the labels, so it is checked after them and a body faulty in both places
  // reports the label fault first.
  const list = {
    name: staffName(row.name, "name"),
    customerName: translations(row.customerName, "customerName"),
    kitchenName: kitchenName(row.kitchenName, "kitchenName"),
    active: flag(row.active, "active"),
  };
  if (!Array.isArray(row.labels)) invalid("labels");
  const seen = new Set<string>();
  const labels = row.labels.map((entry, index): OptionLabelInput => {
    const field = `labels.${index}`;
    const label = record(entry, field);
    keys(label, ["id", "name", "customerName", "kitchenName", "available"], field);
    let labelId: string | undefined;
    if (label.id !== undefined) {
      labelId = id(label.id, `${field}.id`);
      if (seen.has(labelId)) invalid(`${field}.id`);
      seen.add(labelId);
    }
    return {
      ...(labelId === undefined ? {} : { id: labelId }),
      name: staffName(label.name, `${field}.name`),
      customerName: translations(label.customerName, `${field}.customerName`),
      kitchenName: kitchenName(label.kitchenName, `${field}.kitchenName`),
      available: flag(label.available, `${field}.available`),
    };
  });
  // An active list is asked on every order of a dish carrying it, and `validateOptionSelections`
  // below answers it from the available labels alone — so an active list with none is unanswerable
  // and is refused here. An inactive list is never asked, so it may have none.
  // `parseModifierInput` refuses the same shape (modifier-contract.ts:147-148).
  if (list.active && !labels.some((label) => label.available)) invalid("labels");
  const defaultLabelId =
    row.defaultLabelId == null ? null : id(row.defaultLabelId, "defaultLabelId");
  if (defaultLabelId !== null && !seen.has(defaultLabelId)) invalid("defaultLabelId");
  return {
    ...list,
    // A default naming a label that is not on offer is dropped rather than refused, so withdrawing a
    // label does not make every later save of its list fail — the same handling
    // `parseModifierInput` gives `defaultChoiceId` (modifier-contract.ts).
    defaultLabelId: labels.some((label) => label.id === defaultLabelId && label.available)
      ? defaultLabelId
      : null,
    labels,
  };
}

/**
 * An active list is always "pick exactly one available label". The names are resolved separately
 * from this validated answer, which carries ids alone.
 *
 * A structural fault in the body — including an answer for a list that is not on offer — is
 * `options.invalid`; a list left unanswered, or answered with a label it does not carry or has
 * withdrawn, is `options.label_required` carrying that list's id. The answers come back in the order
 * `lists` gives, never the order they were sent, so the caller freezes them deterministically.
 */
export function validateOptionSelections(
  lists: readonly OptionList[],
  value: unknown,
): OptionSelection[] {
  if (!Array.isArray(value)) invalid("optionSelections");
  const offered = new Map(lists.filter((list) => list.active).map((list) => [list.id, list]));
  const answers = new Map<string, string>();
  for (const entry of value) {
    const row = record(entry, "optionSelections");
    keys(row, ["listId", "labelId"], "optionSelections");
    const sentListId = row.listId;
    const sentLabelId = row.labelId;
    if (typeof sentListId !== "string") invalid("listId");
    if (typeof sentLabelId !== "string") invalid("labelId");
    // Lower-cased for the same reason `id` above lower-cases an authored id: the stored rows come
    // back from their `uuid` columns lower-cased, so an answer sent in upper case has to be folded
    // before it is compared to them. Deliberately NOT `id()`: a `labelId` that is no uuid at all
    // stays `options.label_required` — the list does not carry it — rather than becoming a shape
    // fault, which is what this function's docblock promises.
    const listId = sentListId.toLowerCase();
    const labelId = sentLabelId.toLowerCase();
    if (!offered.has(listId) || answers.has(listId)) invalid("listId");
    answers.set(listId, labelId);
  }
  const out: OptionSelection[] = [];
  for (const list of lists) {
    if (!list.active) continue;
    const answered = answers.get(list.id);
    const label = list.labels.find((item) => item.id === answered && item.available);
    if (!label) throw new AppError("options.label_required", { optionListId: list.id });
    out.push({ listId: list.id, labelId: label.id });
  }
  return out;
}
