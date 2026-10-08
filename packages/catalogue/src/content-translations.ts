import type { Transaction } from "@waitron/db";
import { AppError, contentLanguageCode } from "@waitron/shared";
import {
  projectTranslationTarget,
  resolveTranslationTargets,
  type TranslationContext,
  type TranslationStructure,
} from "./content-translation-targets.js";
import type { TranslationGapKind } from "./content-translation-report-types.js";
import type {
  TranslationBatch,
  TranslationEdit,
  TranslationOwners,
  TranslationTarget,
} from "./content-translation-types.js";
import {
  validateTranslationNames,
  writeProductTranslation,
  writeVariantTranslation,
  writeOptionListTranslation,
  writeOptionLabelTranslation,
  writeExtraListTranslation,
  writeUnitTranslation,
  writeMenuTranslation,
  writeSectionTranslation,
  writeIncludedMenuTranslation,
} from "./content-translation-writes.js";
import "./errors.js";

const writers = {
  product: writeProductTranslation,
  variant: writeVariantTranslation,
  option_list: writeOptionListTranslation,
  option_label: writeOptionLabelTranslation,
  extra_list: writeExtraListTranslation,
  unit: writeUnitTranslation,
  menu: writeMenuTranslation,
  section: writeSectionTranslation,
  included_menu: writeIncludedMenuTranslation,
};
interface Baseline {
  ref: { kind: TranslationGapKind; id: string };
  language: string;
  owners: TranslationOwners;
  structure: TranslationStructure;
  selectedText: string | null;
  defaultText: string | null;
  effectiveSelectedText: string | null;
  effectiveDefaultText: string | null;
  inheritedSelectedText: string | null;
  inheritedDefaultText: string | null;
  config: { defaultLanguage: string; languages: string[] };
  required: string[];
}
function invalid(): never {
  throw new AppError("content.translation_batch_invalid", {});
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  return (
    object(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function languageCode(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return contentLanguageCode(value) === value;
  } catch {
    return false;
  }
}
function languageSet(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(languageCode);
}
function readBaseline(edit: TranslationEdit): Baseline {
  let value: unknown;
  try {
    value = JSON.parse(edit.expected);
  } catch {
    invalid();
  }
  const cells = [
    "selectedText",
    "defaultText",
    "effectiveSelectedText",
    "effectiveDefaultText",
    "inheritedSelectedText",
    "inheritedDefaultText",
  ];
  if (
    !keys(value, ["ref", "language", "owners", "structure", "config", "required", ...cells]) ||
    !keys(value.ref, ["kind", "id"]) ||
    value.ref.kind !== edit.kind ||
    value.ref.id !== edit.id ||
    !languageCode(value.language) ||
    cells.some((key) => value[key] !== null && typeof value[key] !== "string") ||
    !keys(value.config, ["defaultLanguage", "languages"]) ||
    !languageCode(value.config.defaultLanguage) ||
    !languageSet(value.config.languages) ||
    !value.config.languages.includes(value.config.defaultLanguage) ||
    !languageSet(value.required) ||
    !keys(value.structure, [
      "role",
      "active",
      "ownerActive",
      "rootMatched",
      "parentRole",
      "childActive",
    ])
  )
    invalid();
  const structure = value.structure as Record<string, unknown>;
  if (
    ["role", "parentRole"].some(
      (key) => structure[key] !== null && typeof structure[key] !== "string",
    ) ||
    ["active", "ownerActive", "rootMatched", "childActive"].some(
      (key) => typeof structure[key] !== "boolean",
    )
  )
    invalid();
  const ownerKeys: Record<TranslationGapKind, string[]> = {
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
  const result = value as unknown as Baseline;
  result.config.languages = [...new Set(result.config.languages)].sort();
  result.required = [...new Set(result.required)].sort();
  return result;
}
function checkedBatch(batch: TranslationBatch): TranslationEdit[] {
  if (
    !keys(batch, ["edits"]) ||
    !Array.isArray(batch.edits) ||
    batch.edits.length < 1 ||
    batch.edits.length > 100
  )
    invalid();
  const seen = new Set<string>();
  return batch.edits.map((value: unknown) => {
    if (
      !keys(value, ["kind", "id", "expected", "text"], ["defaultText"]) ||
      typeof value.kind !== "string" ||
      !Object.hasOwn(writers, value.kind) ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      typeof value.expected !== "string" ||
      typeof value.text !== "string" ||
      !value.text.trim() ||
      Buffer.byteLength(value.text, "utf8") > 4096 ||
      (Object.hasOwn(value, "defaultText") &&
        (typeof value.defaultText !== "string" ||
          !value.defaultText.trim() ||
          Buffer.byteLength(value.defaultText, "utf8") > 4096))
    )
      invalid();
    const key = `${value.kind}:${value.id}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    return {
      kind: value.kind as TranslationGapKind,
      id: value.id,
      expected: value.expected,
      text: value.text.trim(),
      ...(value.defaultText === undefined
        ? {}
        : { defaultText: (value.defaultText as string).trim() }),
    };
  });
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
function finalBaseline(
  base: Baseline,
  edit: TranslationEdit,
  roots: Map<string, TranslationEdit>,
): Baseline {
  const next = { ...base };
  if (base.owners.kind === "included_menu") {
    const root = roots.get(base.owners.includedRootId);
    if (root) {
      next.inheritedSelectedText = root.text;
      if (root.defaultText !== undefined) next.inheritedDefaultText = root.defaultText;
      if (base.language === base.config.defaultLanguage) next.inheritedDefaultText = root.text;
    }
  }
  next.selectedText = edit.text;
  if (edit.defaultText !== undefined) next.defaultText = edit.defaultText;
  if (base.language === base.config.defaultLanguage) next.defaultText = edit.text;
  next.effectiveSelectedText = next.selectedText ?? next.inheritedSelectedText;
  next.effectiveDefaultText = next.defaultText ?? next.inheritedDefaultText;
  return next;
}
export async function saveContentTranslations(
  tx: Transaction,
  language: string,
  batch: TranslationBatch,
  context: TranslationContext,
): Promise<{ saved: TranslationTarget[] }> {
  const edits = checkedBatch(batch);
  const baselines = edits.map(readBaseline);
  const resolution = await resolveTranslationTargets(
    tx,
    language,
    edits.map(({ kind, id }) => ({ kind, id })),
    context,
  );
  const current = resolution.targets.map((entry) => {
    if (entry.state !== "present" || !entry.target.eligible)
      throw new AppError("content.translation_unavailable", {
        kind: entry.target.kind,
        id: entry.target.id,
      });
    return entry;
  });
  const roots = new Map(
    edits.filter((edit) => edit.kind === "menu").map((edit) => [edit.id, edit]),
  );
  const currentBaselines = current.map((entry, i) =>
    readBaseline({ ...edits[i]!, expected: entry.target.expected }),
  );
  const baselineMatches = baselines.map((base, i) => equal(base, currentBaselines[i]));
  const retryMatches = baselines.map((base, i) =>
    equal(finalBaseline(base, edits[i]!, roots), currentBaselines[i]),
  );
  const unchanged = baselineMatches.every(Boolean);
  const retried = retryMatches.every(Boolean);
  if (!unchanged && !retried) {
    const conflict = baselineMatches.findIndex((same, i) => !same && !retryMatches[i]);
    const i = conflict === -1 ? baselineMatches.indexOf(false) : conflict;
    throw new AppError("content.translation_stale", { kind: edits[i]!.kind, id: edits[i]!.id });
  }
  for (const [i, edit] of edits.entries()) {
    const base = baselines[i]!;
    if (
      edit.defaultText !== undefined &&
      (language === resolution.config.defaultLanguage || (base.effectiveDefaultText ?? "").trim())
    )
      invalid();
  }
  const merged = current.map((entry, i) => ({
    ...entry.names,
    [language]: edits[i]!.text,
    ...(edits[i]!.defaultText === undefined
      ? {}
      : { [resolution.config.defaultLanguage]: edits[i]!.defaultText! }),
  }));
  const rootNames = new Map(
    current
      .filter((entry) => entry.target.kind === "menu")
      .map((entry) => [entry.target.id, merged[current.indexOf(entry)]!]),
  );
  const proposed = current.map((entry, i) => {
    const owners = entry.target.owners;
    const inherited =
      owners?.kind === "included_menu"
        ? (rootNames.get(owners.includedRootId) ?? entry.inheritedNames)
        : entry.inheritedNames;
    return projectTranslationTarget(entry, merged[i]!, inherited, language, resolution.required);
  });
  // Validate the whole projected batch before its first write; include folders use their final root.
  for (const entry of proposed) {
    try {
      validateTranslationNames(entry, entry.target.kind, entry.names!);
    } catch (cause) {
      if (!(cause instanceof AppError)) throw cause;
      const refusedLanguage =
        "language" in cause.params && typeof cause.params.language === "string"
          ? cause.params.language
          : language;
      throw new AppError("content.translation_refused", {
        causeCode: cause.code,
        causeParams: cause.params,
        kind: entry.target.kind,
        id: entry.target.id,
        field: refusedLanguage === language ? "text" : "defaultText",
        language: refusedLanguage,
      });
    }
  }
  if (!retried)
    for (const entry of proposed) await writers[entry.target.kind](tx, entry, entry.names!);
  return { saved: proposed.map((entry) => entry.target) };
}
