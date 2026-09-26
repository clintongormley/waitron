import { AppError, contentLanguageCode, isUuid } from "@waitron/shared";
import type { OptionLabel, OptionList } from "./modifier-list-types.js";
import type { OptionSelection } from "@waitron/shared";
import { nonBlankTranslations } from "./product-presentation.js";
import "./errors.js";

export type { OptionSelection, OptionSnapshot } from "@waitron/shared";

export type {
  OptionLabel,
  OptionLabelInput,
  OptionList,
  OptionListInput,
} from "./modifier-list-types.js";

/** A body as `parseOptionListInput` hands it on: unlike the wire shape, every label has an id. */
export type ParsedOptionList = Omit<OptionList, "id">;

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
function staffName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(field);
  return value;
}
/**
 * The translated customer name: absent, null, or a map holding no text anywhere means "fall back to
 * the staff name". A bad language key is deliberately `options.invalid` carrying the field path, not
 * `content.language_invalid`: one save submits a map for the list AND one per label, so a refusal
 * that names no field cannot be put beside its input (CLAUDE.md §3).
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
 * `isUuid` accepts either case and an id column compares byte for byte (packages/shared/src/ids.ts),
 * so lower-casing is what makes a body's ids comparable to each other and to the stored rows.
 */
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value.toLowerCase();
}

export function parseOptionListInput(value: unknown): ParsedOptionList {
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
  const labels = row.labels.map((entry, index): OptionLabel => {
    const field = `labels.${index}`;
    const label = record(entry, field);
    keys(label, ["id", "name", "customerName", "kitchenName", "available"], field);
    const labelId =
      label.id === undefined ? globalThis.crypto.randomUUID() : id(label.id, `${field}.id`);
    if (seen.has(labelId)) invalid(`${field}.id`);
    seen.add(labelId);
    return {
      id: labelId,
      name: staffName(label.name, `${field}.name`),
      customerName: translations(label.customerName, `${field}.customerName`),
      kitchenName: kitchenName(label.kitchenName, `${field}.kitchenName`),
      available: flag(label.available, `${field}.available`),
    };
  });
  // An active list is asked on every order of a dish carrying it, and `validateOptionSelections`
  // below answers it from the available labels alone — so an active list with none is unanswerable
  // and is refused here. An inactive list is never asked, so it may have none.
  if (list.active && !labels.some((label) => label.available)) invalid("labels");
  const defaultLabelId =
    row.defaultLabelId == null ? null : id(row.defaultLabelId, "defaultLabelId");
  if (defaultLabelId !== null && !seen.has(defaultLabelId)) invalid("defaultLabelId");
  // Always a default while a label is available: the named one if it is on offer, else the first.
  const firstAvailable = labels.find((label) => label.available)?.id ?? null;
  const named = labels.some((label) => label.id === defaultLabelId && label.available)
    ? defaultLabelId
    : null;
  return { ...list, defaultLabelId: named ?? firstAvailable, labels };
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
    // Lower-cased for the same reason `id` above lower-cases an authored id. Deliberately NOT
    // `id()`: a `labelId` that is no uuid at all stays `options.label_required` — the list does not
    // carry it — rather than becoming a shape fault.
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
