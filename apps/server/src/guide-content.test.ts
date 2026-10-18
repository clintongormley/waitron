// Weaker than its name: it checks that the guides render and that their ids, links and twins' ids
// match, never that a guide or its twin says what the screen does or was updated with it.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GUIDE_LANGUAGES, GUIDE_PAGES, guideRoot, readGuide } from "./guide-catalogue.js";
import { renderGuide, type RenderedGuide } from "./guide-markdown.js";

type Language = (typeof GUIDE_LANGUAGES)[number];
type Page = (typeof GUIDE_PAGES)[number];

const root = guideRoot();

function rendered(lang: Language, page: Page): RenderedGuide | undefined {
  const markdown = readGuide(root, lang, page);
  return markdown === undefined ? undefined : renderGuide(markdown, GUIDE_PAGES);
}

function english(page: Page): RenderedGuide {
  const guide = rendered("en", page);
  if (guide === undefined) throw new Error(`no English ${page}.md`);
  return guide;
}

function isPage(name: string): name is Page {
  return (GUIDE_PAGES as readonly string[]).includes(name);
}

describe("the user guides", () => {
  it.each(GUIDE_PAGES)("every page renders in English: %s", (page) => {
    expect(english(page).sections.length).toBeGreaterThan(0);
  });

  it("every link names a guide page and a section that page has", () => {
    for (const lang of GUIDE_LANGUAGES) {
      for (const page of GUIDE_PAGES) {
        const guide = rendered(lang, page);
        if (guide === undefined) continue;
        for (const link of guide.links) {
          const where = `${lang}/${page}.md links to ${link.page}#${link.id ?? ""}`;
          expect(isPage(link.page), where).toBe(true);
          if (link.id === undefined || !isPage(link.page)) continue;
          const target = rendered(lang, link.page) ?? english(link.page);
          expect(
            target.sections.map(({ id }) => id),
            where,
          ).toContain(link.id);
        }
      }
    }
  });

  it("a Spanish twin, where one exists, has the English page's sections in the same order", () => {
    for (const page of GUIDE_PAGES) {
      const twin = rendered("es", page);
      if (twin === undefined) continue;
      expect(
        twin.sections.map(({ id }) => id),
        page,
      ).toEqual(english(page).sections.map(({ id }) => id));
    }
  });

  it("no other file sits in the guide folders", () => {
    for (const lang of GUIDE_LANGUAGES) {
      const folder = join(root, lang);
      const present = existsSync(folder) ? readdirSync(folder).sort() : [];
      const expected = GUIDE_PAGES.map((page) => `${page}.md`)
        .filter((name) => existsSync(join(folder, name)))
        .sort();
      expect(present, lang).toEqual(expected);
    }
  });
});
