import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_LANGUAGES = ["en", "es"] as const;
export const GUIDE_PAGES = ["products", "modifiers", "content-and-images"] as const;

export function guideRoot(): string {
  return fileURLToPath(new URL("./guide/", import.meta.url));
}

export function readGuide(root: string, lang: string, page: string): string | undefined {
  try {
    return readFileSync(join(root, lang, `${page}.md`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
