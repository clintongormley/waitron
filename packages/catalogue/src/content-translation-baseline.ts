import { AppError, type ContentLanguages } from "@waitron/shared";
import { canonicalTranslationLanguage } from "./content-translation-cells.js";
import { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";
import type { TranslationStructure } from "./content-translation-targets.js";
import {
  translationCellKey,
  type TranslationCellEdit,
  type TranslationField,
  type TranslationOwners,
  type TranslationRef,
} from "./content-translation-types.js";
import "./errors.js";

export interface TranslationBaseline {
  ref: TranslationRef;
  language: string;
  field: TranslationField;
  owners: TranslationOwners;
  structure: TranslationStructure;
  selectedText: string | null;
  defaultText: string | null;
  effectiveSelectedText: string | null;
  effectiveDefaultText: string | null;
  inheritedSelectedText: string | null;
  inheritedDefaultText: string | null;
  config: ContentLanguages;
  required: string[];
}
function invalid(): never {
  throw new AppError("content.translation_batch_invalid", {});
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return (
    object(value) &&
    Object.keys(value).length === names.length &&
    names.every((key) => Object.hasOwn(value, key))
  );
}
function languageSet(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(canonicalTranslationLanguage) &&
    new Set(value).size === value.length
  );
}
const textKeys = [
  "selectedText",
  "defaultText",
  "effectiveSelectedText",
  "effectiveDefaultText",
  "inheritedSelectedText",
  "inheritedDefaultText",
];
const structureKeys = ["role", "active", "ownerActive", "rootMatched", "parentRole", "childActive"];
const ownerKeys: Record<TranslationRef["kind"], string[]> = {
  product: ["kind", "parentId"],
  variant: ["kind", "parentId"],
  option_list: ["kind"],
  option_label: ["kind", "listId"],
  extra_list: ["kind"],
  unit: ["kind"],
  menu: ["kind", "menuId", "rootId"],
  section: ["kind", "menuId"],
  included_menu: ["kind", "menuId", "sectionId", "includedMenuId", "includedRootId"],
};
export function parseTranslationBaseline(edit: TranslationCellEdit): TranslationBaseline {
  if (
    !TRANSLATION_GAP_KINDS.includes(edit.kind) ||
    typeof edit.id !== "string" ||
    !edit.id.trim() ||
    !canonicalTranslationLanguage(edit.language) ||
    (edit.field !== "name" && !(edit.kind === "unit" && edit.field === "abbreviation")) ||
    typeof edit.expected !== "string"
  )
    invalid();
  let value: unknown;
  try {
    value = JSON.parse(edit.expected);
  } catch {
    invalid();
  }
  if (
    !keys(value, [
      "ref",
      "language",
      "field",
      "owners",
      "structure",
      "config",
      "required",
      ...textKeys,
    ]) ||
    !keys(value.ref, ["kind", "id"]) ||
    value.ref.kind !== edit.kind ||
    value.ref.id !== edit.id ||
    value.language !== edit.language ||
    value.field !== edit.field ||
    textKeys.some((key) => value[key] !== null && typeof value[key] !== "string") ||
    !keys(value.config, ["defaultLanguage", "languages"]) ||
    !canonicalTranslationLanguage(value.config.defaultLanguage) ||
    !languageSet(value.config.languages) ||
    !value.config.languages.includes(value.config.defaultLanguage) ||
    !languageSet(value.required) ||
    !keys(value.structure, structureKeys)
  )
    invalid();
  const structure = value.structure;
  if (
    ["role", "parentRole"].some(
      (key) => structure[key] !== null && typeof structure[key] !== "string",
    ) ||
    ["active", "ownerActive", "rootMatched", "childActive"].some(
      (key) => typeof structure[key] !== "boolean",
    )
  )
    invalid();
  const owners = value.owners;
  if (
    !keys(owners, ownerKeys[edit.kind]) ||
    owners.kind !== edit.kind ||
    ownerKeys[edit.kind].some(
      (key) =>
        key !== "kind" &&
        (edit.kind === "product"
          ? owners[key] !== null
          : typeof owners[key] !== "string" || !(owners[key] as string).trim()),
    )
  )
    invalid();
  const result = value as unknown as TranslationBaseline;
  return {
    ...result,
    config: { ...result.config, languages: [...result.config.languages].sort() },
    required: [...result.required].sort(),
  };
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  return false;
}
export function sameTranslationBaseline(a: TranslationBaseline, b: TranslationBaseline): boolean {
  return equal(a, b);
}
export function projectTranslationBaselines(
  bases: readonly TranslationBaseline[],
  edits: readonly TranslationCellEdit[],
): TranslationBaseline[] {
  const peers = new Map(edits.map((edit) => [translationCellKey(edit), edit.text]));
  return bases.map((base) => {
    const ref = { ...base.ref, language: base.language, field: base.field };
    const ownKey = translationCellKey(ref);
    const defaultKey = translationCellKey({ ...ref, language: base.config.defaultLanguage });
    const selectedText = peers.has(ownKey) ? peers.get(ownKey)! : base.selectedText;
    const defaultText = peers.has(defaultKey) ? peers.get(defaultKey)! : base.defaultText;
    let inheritedSelectedText = base.inheritedSelectedText;
    let inheritedDefaultText = base.inheritedDefaultText;
    if (base.owners.kind === "included_menu") {
      const root = {
        kind: "menu" as const,
        id: base.owners.includedRootId,
        field: "name" as const,
      };
      const selectedRoot = translationCellKey({ ...root, language: base.language });
      const defaultRoot = translationCellKey({ ...root, language: base.config.defaultLanguage });
      if (peers.has(selectedRoot)) inheritedSelectedText = peers.get(selectedRoot)!;
      if (peers.has(defaultRoot)) inheritedDefaultText = peers.get(defaultRoot)!;
    }
    return {
      ...base,
      selectedText,
      defaultText,
      inheritedSelectedText,
      inheritedDefaultText,
      effectiveSelectedText: selectedText ?? inheritedSelectedText,
      effectiveDefaultText: defaultText ?? inheritedDefaultText,
    };
  });
}
