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
  it.each(GUIDE_LANGUAGES)(
    "serves the purchase invoice guide and its year section in %s",
    (lang) => {
      expect(GUIDE_PAGES).toContain("purchases");
      const markdown = readGuide(root, lang, "purchases");
      expect(markdown).toBeDefined();
      expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
        "enter-invoice",
        "invoice-numbers",
        "deduction-period",
      ]);
    },
  );

  it.each(GUIDE_LANGUAGES)(
    "the kitchen guide in %s registers its allergy and service sections",
    (lang) => {
      expect(GUIDE_PAGES).toContain("kitchen-service");
      const markdown = readGuide(root, lang, "kitchen-service");
      expect(markdown).toBeDefined();
      expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
        "counter-send-retry",
        "allergy-copies",
        "corrections",
        "held-work",
        "reprints",
        "service-lifetime",
        "kitchen-screen",
        "kitchen-help",
        "identical-dishes",
        "after-period",
        "request-cooking",
        "delete-prep-station",
        "paper-language",
      ]);
    },
  );

  it.each(GUIDE_LANGUAGES)("the Box status guide in %s registers its sections", (lang) => {
    expect(GUIDE_PAGES).toContain("box-status");
    const markdown = readGuide(root, lang, "box-status");
    expect(markdown).toBeDefined();
    expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
      "open",
      "rows",
      "retry-now",
      "invoice-conflict",
      "free-space",
      "out-of-space",
      "clock-behind",
      "clock-at-start",
      "clock-service",
      "sales-dated-wrongly",
      "clock-witnesses",
      "emails",
    ]);
  });

  it.each(GUIDE_LANGUAGES)("the appearance guide in %s registers its sections", (lang) => {
    expect(GUIDE_PAGES).toContain("appearance");
    const markdown = readGuide(root, lang, "appearance");
    expect(markdown).toBeDefined();
    expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
      "look",
      "edit",
      "text-size",
      "logo",
      "logo-screens",
      "logo-receipts",
      "advanced",
      "text-by-hand",
      "hard-to-read",
      "save",
      "themes",
      "names",
      "switch",
      "delete",
    ]);
  });

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

it.each(GUIDE_LANGUAGES)(
  "serves the staff guide in %s with account and self-service sections",
  (lang) => {
    expect(GUIDE_PAGES).toContain("staff");
    const markdown = readGuide(root, lang, "staff");
    expect(markdown).toBeDefined();
    expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
      "staff-details",
      "account-access",
      "own-account",
      "own-data",
      "person-data",
      "invoice-customer-data",
      "delete-staff-role",
    ]);
  },
);

it.each(GUIDE_LANGUAGES)(
  "the staff guide's own-data section in %s names adjustments.json",
  (lang) => {
    const html = rendered(lang, "staff")!.html;
    const start = html.indexOf('<section id="own-data"');
    expect(start).toBeGreaterThanOrEqual(0);
    const section = html.slice(start, html.indexOf("</section>", start));
    expect(section).toContain("adjustments.json");
  },
);

it.each(GUIDE_LANGUAGES)(
  "the staff guide's invoice-customer-data section in %s names invoices.json",
  (lang) => {
    const html = rendered(lang, "staff")!.html;
    const start = html.indexOf('<section id="invoice-customer-data"');
    expect(start).toBeGreaterThanOrEqual(0);
    const section = html.slice(start, html.indexOf("</section>", start));
    expect(section).toContain("invoices.json");
  },
);

it.each(GUIDE_LANGUAGES)("serves the till notices guide in %s with its sections", (lang) => {
  expect(GUIDE_PAGES).toContain("till-notices");
  const markdown = readGuide(root, lang, "till-notices");
  expect(markdown).toBeDefined();
  expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
    "notice-line",
    "notices",
  ]);
});

it.each(GUIDE_LANGUAGES)("serves the data protection guide in %s with its sections", (lang) => {
  expect(GUIDE_PAGES).toContain("data-protection");
  const markdown = readGuide(root, lang, "data-protection");
  expect(markdown).toBeDefined();
  expect(renderGuide(markdown!, GUIDE_PAGES).sections.map(({ id }) => id)).toEqual([
    "who-does-what",
    "staff-notice",
    "invoice-notice",
    "booking-notice",
    "full-notice",
    "privacy-settings",
    "record",
    "breach",
    "breach-records",
    "breach-losses",
  ]);
});

// Weaker than its name: it looks for three phrases, not for every way of saying whether to notify.
it("the data protection guide marks placeholders and never says whether to notify", () => {
  const html = (lang: Language) => rendered(lang, "data-protection")?.html ?? "";
  const section = (lang: Language, id: string) => {
    const start = html(lang).indexOf(`<section id="${id}"`);
    expect(start, `${lang} #${id}`).toBeGreaterThanOrEqual(0);
    return html(lang).slice(start, html(lang).indexOf("</section>", start));
  };
  for (const id of ["staff-notice", "invoice-notice", "full-notice"]) {
    expect(section("en", id), id).toContain("<em>");
  }
  for (const lang of GUIDE_LANGUAGES) {
    const text = html(lang).toLowerCase();
    expect(text, lang).not.toBe("");
    for (const verdict of ["you must notify", "debes notificar", "no es necesario notificar"]) {
      expect(text, `${lang}: ${verdict}`).not.toContain(verdict);
    }
  }
});
