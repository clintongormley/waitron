// Weaker than its name: the source checks read the dashboard's and the till's source as text, so a
// guide path built from parts passes them.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { GUIDE_LINKS } from "../apps/dashboard/src/help-guide.js";
import { GUIDE_LINKS as TILL_GUIDE_LINKS } from "../apps/till/src/help-guide.js";
import {
  GUIDE_LANGUAGES,
  GUIDE_PAGES,
  guideRoot,
  readGuide,
} from "../apps/server/src/guide-catalogue.js";
import { renderGuide } from "../apps/server/src/guide-markdown.js";

const DASHBOARD_SRC = join(import.meta.dirname, "..", "apps", "dashboard", "src");
const TILL_SRC = join(import.meta.dirname, "..", "apps", "till", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

function guideWriters(root: string): string[] {
  return sourceFiles(root)
    .filter((path) => !path.endsWith(".test.ts") && !path.endsWith("/help-guide.ts"))
    .filter((path) => readFileSync(path, "utf8").includes("/help/"))
    .map((path) => relative(root, path));
}

describe.each([
  { app: "dashboard", links: GUIDE_LINKS, src: DASHBOARD_SRC },
  { app: "till", links: TILL_GUIDE_LINKS, src: TILL_SRC },
])("$app guide links", ({ app, links, src }) => {
  it.each(Object.entries(links))(
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

  it(`only help-guide.ts writes a guide path in the ${app}'s source`, () => {
    expect(guideWriters(src)).toEqual([]);
  });
});
