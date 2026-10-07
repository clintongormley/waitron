import type { IncludeFolder, IncludeFolderOverrides, Presentation } from "./section-types.js";

export const FOLLOWING_FOLDER: IncludeFolder = Object.freeze({
  showAsFolder: true,
  overrides: Object.freeze({}),
});

/** What the include's folder shows: the included menu's own presentation, with each fixed field in
 * its place. Switched off, there is no folder, so `own` comes back unchanged. */
export function folderPresentation(own: Presentation, folder: IncludeFolder): Presentation {
  if (!folder.showAsFolder) return own;
  const { names, image, color } = folder.overrides;
  return {
    names:
      names === undefined
        ? own.names
        : Object.fromEntries(
            Object.entries({ ...own.names, ...names }).filter(([, text]) => text.trim() !== ""),
          ),
    image: image === undefined ? own.image : image,
    color: color === undefined ? own.color : color,
  };
}

/** The overrides that make the folder show `shown`: a field equal to the included menu's follows
 * it, whatever was stored; a fixed language outside `languages` is one the caller did not show, so
 * it is kept. */
export function folderOverridesFrom(
  own: Presentation,
  shown: Presentation,
  languages: readonly string[],
  stored: IncludeFolderOverrides,
): IncludeFolderOverrides {
  const names: Record<string, string> = Object.fromEntries(
    Object.entries(stored.names ?? {}).filter(([language]) => !languages.includes(language)),
  );
  for (const language of languages) {
    const text = (shown.names[language] ?? "").trim();
    if (text !== (own.names[language] ?? "").trim()) names[language] = text;
  }
  return {
    ...(Object.keys(names).length > 0 ? { names } : {}),
    ...(shown.image !== own.image ? { image: shown.image } : {}),
    ...(shown.color !== own.color ? { color: shown.color } : {}),
  };
}
