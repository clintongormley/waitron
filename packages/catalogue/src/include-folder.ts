import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, contentLanguageCode, FALLBACK_LOCALE } from "@waitron/shared";
import { isStoredColor } from "./color-inheritance.js";
import { findContentTranslationGap } from "./content-languages.js";
import { folderPresentation } from "./include-folder-presentation.js";
import { sectionMembers } from "./schema/sections.js";
import { loadSectionGraph } from "./section-graph.js";
import type { IncludeFolder, IncludeFolderInput, IncludeFolderOverrides } from "./section-types.js";
import { sectionColorOf, sectionImageOf, writableMember } from "./sections.js";
import "./errors.js";

type Rows = readonly Record<string, unknown>[];

const OVERRIDE_FIELDS: readonly string[] = ["names", "image", "color"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isLanguageCode(key: string): boolean {
  try {
    return contentLanguageCode(key) === key;
  } catch {
    return false;
  }
}

function isNamesMap(value: unknown): value is Record<string, string> {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(([key, text]) => typeof text === "string" && isLanguageCode(key))
  );
}

/** The first field of `value` that cannot be an `IncludeFolderOverrides`, before any photo or
 * colour rule is applied; null when the shape is sound. */
function overridesShapeProblem(value: unknown): "overrides" | "names" | null {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !OVERRIDE_FIELDS.includes(key)))
    return "overrides";
  if (value.names !== undefined && !isNamesMap(value.names)) return "names";
  return null;
}

async function checkedOverrides(tx: Transaction, value: unknown): Promise<IncludeFolderOverrides> {
  const problem = overridesShapeProblem(value);
  if (problem !== null) throw new AppError("menu_section.invalid", { field: problem });
  const { names, image, color } = value as IncludeFolderOverrides;
  const trimmed =
    names === undefined
      ? {}
      : Object.fromEntries(
          Object.entries(names).map(([language, text]) => [language, text.trim()]),
        );
  return {
    ...(Object.keys(trimmed).length > 0 ? { names: trimmed } : {}),
    ...(image === undefined ? {} : { image: await sectionImageOf(tx, image) }),
    ...(color === undefined ? {} : { color: sectionColorOf(color) }),
  };
}

/**
 * Sets how one include of `listId` shows the menu it includes. Without `overrides` the stored ones
 * are kept. The names the folder would show are held to the venue's default content language, as a
 * section's own are. Which menus reach the include does not change, so no menu's offers are synced.
 */
export async function setIncludeFolder(
  tx: Transaction,
  listId: string,
  memberId: string,
  input: IncludeFolderInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<IncludeFolder> {
  const graph = await loadSectionGraph(tx);
  const { ref } = writableMember(graph, listId, memberId);
  if (ref.kind !== "section") throw new AppError("menu_section.membership_invalid", {});
  const role = graph.role(ref.sectionId)!;
  if (role !== "menu_root")
    throw new AppError("menu_section.wrong_role", { sectionId: ref.sectionId, role });
  const { showAsFolder } = input;
  if (typeof showAsFolder !== "boolean")
    throw new AppError("menu_section.invalid", { field: "showAsFolder" });
  let overrides = graph.folder(memberId).overrides;
  if (input.overrides !== undefined) {
    overrides = await checkedOverrides(tx, input.overrides);
    const own = graph.section(ref.sectionId)!;
    const { names } = folderPresentation(
      { names: own.names!, image: own.image!, color: own.color! },
      { showAsFolder: true, overrides },
    );
    if (Object.keys(names).length > 0) {
      const gap = await findContentTranslationGap(tx, [names], fallbackLanguage);
      if (gap !== null)
        throw new AppError("menu_section.translation_required", {
          field: "names",
          language: gap.language,
        });
    }
  }
  await tx
    .update(sectionMembers)
    .set({ showAsFolder, folderOverrides: overrides })
    .where(eq(sectionMembers.id, memberId));
  return { showAsFolder, overrides };
}

/** The member's `folder_overrides` as an object, or the column refused. */
function importedOverrides(row: Record<string, unknown>): Record<string, unknown> {
  const refuse = (): never => {
    throw new AppError("setup.request_invalid", { field: "section_members.folder_overrides" });
  };
  const text = row.folder_overrides;
  if (text === undefined) return {};
  if (typeof text !== "string") return refuse();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (overridesShapeProblem(value) !== null) return refuse();
  const { names, image, color } = value as Record<string, unknown>;
  // `setIncludeFolder` never stores an empty map. Patched with one, `json_patch` answers the included
  // menu's own names, so the content-language queries would count that menu's gap a second time.
  if (names !== undefined && Object.keys(names as object).length === 0) return refuse();
  if (image !== undefined && image !== null && typeof image !== "string") return refuse();
  if (color !== undefined && color !== null && !isStoredColor(color)) return refuse();
  return value as Record<string, unknown>;
}

/**
 * Refuses (`setup.request_invalid`) an imported member whose folder setting is malformed: a
 * `show_as_folder` other than a flag, `folder_overrides` that are not the JSON text of a sound
 * `IncludeFolderOverrides` or that hold an empty `names` map, or any setting but the default on a
 * member that is not an include of a menu in a list. Whether a named photo is in the library is the media triggers' to refuse.
 */
export function checkIncludeFolderRows(
  members: Rows | undefined,
  sections: Rows | undefined,
): void {
  const roles = new Map((sections ?? []).map((row) => [row.id, row.role]));
  for (const row of members ?? []) {
    const show = row.show_as_folder;
    if (![undefined, 0, 1, true, false].includes(show as never))
      throw new AppError("setup.request_invalid", { field: "section_members.show_as_folder" });
    const overrides = importedOverrides(row);
    const parentRole = roles.get(row.section_id);
    const isInclude =
      typeof row.child_section_id === "string" &&
      roles.get(row.child_section_id) === "menu_root" &&
      parentRole !== undefined &&
      parentRole !== "home_layout";
    if (isInclude) continue;
    if (show === 0 || show === false)
      throw new AppError("setup.request_invalid", { field: "section_members.show_as_folder" });
    if (Object.keys(overrides).length > 0)
      throw new AppError("setup.request_invalid", { field: "section_members.folder_overrides" });
  }
}
