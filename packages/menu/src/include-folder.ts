import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  AppError,
  contentLanguageTag,
  FALLBACK_LOCALE,
  type ContentLanguages,
  isStoredColor,
  MEDIA_FILENAME,
} from "@waitron/shared";
import { readContentLanguages } from "./content-languages.js";
import {
  mergeOptionalTranslations,
  validateOptionalTranslations,
} from "./optional-translations.js";
import { sectionMembers } from "@waitron/db";
import { loadSectionGraph } from "./section-graph.js";
import type { IncludeFolder, IncludeFolderInput, IncludeFolderOverrides } from "@waitron/shared";
import { sectionColorOf, sectionImageOf, writableMember } from "./sections.js";
import "./errors.js";

type Rows = readonly Record<string, unknown>[];

type FolderColumns = Pick<
  typeof sectionMembers.$inferSelect,
  "folderNames" | "folderImage" | "folderImageFixed" | "folderColor" | "folderColorFixed"
>;

export function overridesFromRow(row: Partial<FolderColumns>): IncludeFolderOverrides {
  return {
    ...(row.folderNames === undefined || row.folderNames === null
      ? {}
      : { names: row.folderNames }),
    ...(row.folderImageFixed ? { image: row.folderImage ?? null } : {}),
    ...(row.folderColorFixed ? { color: row.folderColor ?? null } : {}),
  };
}

export function columnsFromOverrides(overrides: IncludeFolderOverrides): FolderColumns {
  return {
    folderNames: overrides.names && Object.keys(overrides.names).length ? overrides.names : null,
    folderImage: overrides.image ?? null,
    folderImageFixed: overrides.image !== undefined,
    folderColor: overrides.color ?? null,
    folderColorFixed: overrides.color !== undefined,
  };
}

const OVERRIDE_FIELDS: readonly string[] = ["names", "image", "color"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isLanguageCode(key: string): boolean {
  try {
    return contentLanguageTag(key) === key;
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

async function checkedOverrides(
  tx: Transaction,
  value: unknown,
  stored: IncludeFolderOverrides,
  config: ContentLanguages,
): Promise<IncludeFolderOverrides> {
  const problem = overridesShapeProblem(value);
  if (problem !== null) throw new AppError("menu_section.invalid", { field: problem });
  const { names, image, color } = value as IncludeFolderOverrides;
  try {
    if (names !== undefined) validateOptionalTranslations(names);
  } catch {
    throw new AppError("menu_section.invalid", { field: "names" });
  }
  const trimmed = mergeOptionalTranslations(stored.names ?? null, names ?? {}, config);
  return {
    ...(trimmed !== null ? { names: trimmed } : {}),
    ...(image === undefined ? {} : { image: await sectionImageOf(tx, image) }),
    ...(color === undefined ? {} : { color: sectionColorOf(color) }),
  };
}

/**
 * Sets how one include of `listId` shows the menu it includes. Without `overrides` the stored ones
 * are kept. Which menus reach the include does not change, so no menu's offers are synced.
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
  if (ref.kind === "set_menu") throw new AppError("set_menu.wrong_place", { menuId: ref.menuId });
  if (ref.kind !== "section") throw new AppError("menu_section.membership_invalid", {});
  const role = graph.role(ref.sectionId)!;
  if (role !== "menu_root")
    throw new AppError("menu_section.wrong_role", { sectionId: ref.sectionId, role });
  const { showAsFolder } = input;
  if (typeof showAsFolder !== "boolean")
    throw new AppError("menu_section.invalid", { field: "showAsFolder" });
  let overrides = graph.folder(memberId).overrides;
  if (input.overrides !== undefined) {
    overrides = await checkedOverrides(
      tx,
      input.overrides,
      overrides,
      await readContentLanguages(tx, fallbackLanguage),
    );
  }
  await tx
    .update(sectionMembers)
    .set({ showAsFolder, ...columnsFromOverrides(overrides) })
    .where(eq(sectionMembers.id, memberId));
  return { showAsFolder, overrides };
}

function importedOverrides(row: Record<string, unknown>): IncludeFolderOverrides {
  const refuse = (column: string): never => {
    throw new AppError("setup.request_invalid", { field: `section_members.${column}` });
  };
  let names: Record<string, string> | undefined;
  if (row.folder_names !== undefined && row.folder_names !== null) {
    if (typeof row.folder_names !== "string") refuse("folder_names");
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.folder_names as string);
    } catch {
      refuse("folder_names");
    }
    if (!isNamesMap(parsed) || Object.keys(parsed).length === 0) refuse("folder_names");
    names = parsed as Record<string, string>;
  }
  for (const column of ["folder_image_fixed", "folder_color_fixed"])
    if (row[column] !== undefined && row[column] !== 0 && row[column] !== 1) refuse(column);
  const image = row.folder_image ?? null;
  const color = row.folder_color ?? null;
  if (
    image !== null &&
    (row.folder_image_fixed !== 1 || typeof image !== "string" || !MEDIA_FILENAME.test(image))
  )
    refuse("folder_image");
  if (color !== null && (row.folder_color_fixed !== 1 || !isStoredColor(color)))
    refuse("folder_color");
  return {
    ...(names === undefined ? {} : { names }),
    ...(row.folder_image_fixed === 1 ? { image: image as string | null } : {}),
    ...(row.folder_color_fixed === 1 ? { color: color as string | null } : {}),
  };
}

export function checkIncludeFolderRows(
  members: Rows | undefined,
  sections: Rows | undefined,
  menus: Rows | undefined,
): void {
  for (const row of sections ?? [])
    if (
      row.role === "menu_root" ? row.internal_name != null : typeof row.internal_name !== "string"
    )
      throw new AppError("setup.request_invalid", { field: "sections.internal_name" });
  const sets = new Set((menus ?? []).filter((row) => row.kind === "set_menu").map((row) => row.id));
  const byId = new Map((sections ?? []).map((row) => [row.id, row]));
  for (const row of members ?? []) {
    const show = row.show_as_folder;
    if (![undefined, 0, 1, true, false].includes(show as never))
      throw new AppError("setup.request_invalid", { field: "section_members.show_as_folder" });
    const overrides = importedOverrides(row);
    const parentRole = byId.get(row.section_id)?.role;
    const child = byId.get(row.child_section_id);
    const isInclude =
      typeof row.child_section_id === "string" &&
      child?.role === "menu_root" &&
      !sets.has(child.owner_menu_id) &&
      parentRole !== undefined &&
      parentRole !== "home_layout";
    if (isInclude) continue;
    if (show === 0 || show === false)
      throw new AppError("setup.request_invalid", { field: "section_members.show_as_folder" });
    for (const [key, column] of [
      ["names", "folder_names"],
      ["image", "folder_image_fixed"],
      ["color", "folder_color_fixed"],
    ] as const)
      if (Object.hasOwn(overrides, key))
        throw new AppError("setup.request_invalid", { field: `section_members.${column}` });
  }
}
