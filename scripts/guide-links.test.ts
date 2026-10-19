// Weaker than its name: the second check reads the dashboard's source as text, so a guide path
// built from parts passes it.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { GUIDE_LINKS } from "../apps/dashboard/src/help-guide.js";
import {
  GUIDE_LANGUAGES,
  GUIDE_PAGES,
  guideRoot,
  readGuide,
} from "../apps/server/src/guide-catalogue.js";
import { renderGuide } from "../apps/server/src/guide-markdown.js";

const DASHBOARD_SRC = join(import.meta.dirname, "..", "apps", "dashboard", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

describe("dashboard guide links", () => {
  it.each(Object.entries(GUIDE_LINKS))(
    "%s names a page and section the server serves in every language",
    (key, { page, section }) => {
      expect(GUIDE_PAGES, `${key}: page "${page}"`).toContain(page);
      for (const lang of GUIDE_LANGUAGES) {
        const markdown = readGuide(guideRoot(), lang, page) ?? readGuide(guideRoot(), "en", page);
        expect(markdown, `${key}: ${lang}/${page}.md`).toBeDefined();
        const ids = renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id);
        expect(ids, `${key}: section "${section}" in ${lang}/${page}`).toContain(section);
      }
    },
  );

  it("only help-guide.ts writes a guide path in the dashboard's source", () => {
    const writers = sourceFiles(DASHBOARD_SRC)
      .filter((path) => !path.endsWith(".test.ts") && !path.endsWith("/help-guide.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("/help/"))
      .map((path) => relative(DASHBOARD_SRC, path));
    expect(writers).toEqual([]);
  });
});
