import type { BuiltRelease } from "@waitron/shared";
import type { DeclarationFolder } from "./declaration-pages.js";
import type { CheckOutput } from "./producer-check.js";

/**
 * Whether this bundle and the declaration folder beside it are both the release `version`. A
 * failing line names the bundle's or the folder's own version, never the one typed.
 */
export function checkRelease(
  version: string,
  release: BuiltRelease,
  folder: DeclarationFolder,
  out: CheckOutput,
): 0 | 1 {
  const failures: string[] = [];
  const bundled = release.bundled ? release.version : null;
  if (bundled !== version) failures.push(`bundle version ${bundled ?? "none"}`);
  if (folder.kind === "none") failures.push("declaration folder none");
  else if (folder.kind === "damaged") failures.push(`declaration folder damaged ${folder.file}`);
  else if (folder.version !== version)
    failures.push(`declaration folder version ${folder.version}`);
  for (const line of failures) out.error(line);
  if (failures.length > 0) return 1;
  out.log("release: the bundle and the declaration folder match");
  return 0;
}
