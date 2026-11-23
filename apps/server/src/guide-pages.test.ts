import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BOX_FORM_HEAD,
  BOX_FORM_STYLE,
  GUIDE_PAGE_TOKENS,
  GUIDE_THEME_KEY,
  mountGuidePages,
  renderBoxPage,
  renderLogoBoxPage,
} from "./guide-pages.js";
import { renderDocument } from "./html-page.js";
import { fixedFontValue } from "./html-page-tokens.js";
import { renderWaitingPage } from "./waiting-page.js";
import type { Logger } from "./logger.js";
import { GUIDE_FRAME_WORDS } from "./i18n/guide-pages.js";
import { TABLE_SERVICE_GUIDE_TITLE } from "./i18n/table-service-guide.js";

const EN_PRODUCTS = [
  "# Products",
  "",
  "Products are what you sell.",
  "",
  "## Set the price {#price}",
  "",
  "Type the price.",
  "",
  "## Choose a unit {#units}",
  "",
  "Pick a unit.",
  "",
].join("\n");

const ES_PRODUCTS = [
  "# Productos",
  "",
  "Los productos son lo que vendes.",
  "",
  "## Pon el precio {#price}",
  "",
  "Escribe el precio.",
  "",
  "## Elige una unidad {#units}",
  "",
  "Elige una unidad.",
  "",
].join("\n");

const EN_MODIFIERS = "# Modifiers\n\nModifiers change a dish.\n";

let base: string;
let root: string;

function write(dir: string, lang: string, page: string, text: string): void {
  mkdirSync(join(dir, lang), { recursive: true });
  writeFileSync(join(dir, lang, `${page}.md`), text);
}

function newRoot(name: string): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "guide-pages-"));
  root = newRoot("root");
  write(root, "en", "products", EN_PRODUCTS);
  write(root, "es", "products", ES_PRODUCTS);
  write(root, "en", "modifiers", EN_MODIFIERS);
  write(root, "en", "secret", "# Secret\n\nSecret words.\n");
  // Above the root: what a request escaping the root would reach.
  write(base, "etc", "passwd", "# Leaked\n\nLeaked words.\n");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function appFor(dir: string, log: Logger = vi.fn()) {
  const app = new Hono();
  mountGuidePages(app, { root: dir }, log);
  app.get("*", (c) => c.text("later", 200));
  return app;
}

function between(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = html.indexOf(close, start + open.length);
  expect(end).toBeGreaterThan(start);
  return html.slice(start + open.length, end);
}

describe("guide pages", () => {
  it.each(["en", "es"] as const)("A803 serves the refund guide in %s", async (lang) => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const response = await app.request(`/help/${lang}/table-service`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain('<section id="refund-payment"');
    expect(html).toContain('<section id="separate-terminal"');
    expect(html).toContain(`<title>${TABLE_SERVICE_GUIDE_TITLE[lang]} · Waitron</title>`);
    expect(html).toContain(`<h1>${TABLE_SERVICE_GUIDE_TITLE[lang]}</h1>`);
  });

  it.each(["en", "es"] as const)("serves the service steps section in %s", async (lang) => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const response = await app.request(`/help/${lang}/table-service`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<section id="service-steps"');
  });

  it.each(["en", "es"] as const)("serves the shipped kitchen guide in %s", async (lang) => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const response = await app.request(`/help/${lang}/kitchen-service`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(
      `<title>${GUIDE_FRAME_WORDS[lang].names["kitchen-service"]} · Waitron</title>`,
    );
    for (const id of ["allergy-copies", "corrections", "held-work", "reprints", "service-lifetime"])
      expect(html).toContain(`<section id="${id}"`);
  });

  it("serves a guide page with its title, language, trail and sections", async () => {
    const res = await appFor(root).request("/help/es/products");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<title>Productos · Waitron</title>");
    expect(html).toContain('<p class="trail">Guía de Waitron › Productos</p>');
    expect(html).toContain('<section id="units"');
    expect(html).toContain("Elige una unidad.");
    expect(html).not.toContain('class="notice"');
  });

  it("serves the English page with one line saying so when the twin is missing", async () => {
    const app = appFor(root);
    const res = await app.request("/help/es/modifiers");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      '<p class="notice" lang="es">Esta página aún no está en español. Se muestra en inglés.</p>',
    );
    expect(html).toContain("Modifiers change a dish.");
    expect(html).toContain('<p class="trail">Waitron guide › Modifiers</p>');

    const english = await (await app.request("/help/en/modifiers")).text();
    expect(english).toContain("Modifiers change a dish.");
    expect(english).not.toContain('class="notice"');
  });

  it.each([
    "/help/fr/products",
    "/help/EN/products",
    "/help/en/Products",
    "/help/en/products.md",
    "/help/en/..%2F..%2Fetc%2Fpasswd",
    "/help/en/..%2Fes%2Fproducts",
    "/help/en/index",
    "/help",
    "/help/",
    "/help/en",
    "/help/en/products/",
    "/help/en/a/b",
    "/help/fr",
    "/help/fr/a/b",
    "/help/esp/a/b",
  ])("answers the English 404 page for %s", async (path) => {
    const res = await appFor(root).request(path);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Page not found");
    expect(html).toContain('href="/help/en/products"');
    expect(html).toContain('href="/help/en/modifiers"');
    expect(html).toContain('href="/help/en/content-and-images"');
    expect(html).not.toContain("Leaked");
    expect(html).not.toContain("Productos");
  });

  it.each(["/help/es/nada", "/help/es", "/help/es/", "/help/es/x/y", "/help/es/products/"])(
    "answers the 404 page in Spanish for %s",
    async (path) => {
      const res = await appFor(root).request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      const html = await res.text();
      expect(html).toContain('<html lang="es">');
      expect(html).toContain("Página no encontrada");
      expect(html).toContain('href="/help/es/products"');
    },
  );

  it("never builds a path from the request", async () => {
    const res = await appFor(root).request("/help/en/secret");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Secret words");
  });

  it("answers 500 and logs when the English file is missing", async () => {
    const empty = newRoot("empty");
    const log = vi.fn();
    const res = await appFor(empty, log).request("/help/en/products");
    expect(res.status).toBe(500);
    const english = await res.text();
    expect(english).toContain("Page unavailable");
    expect(english).toContain("This guide page could not be shown.");
    expect(log).toHaveBeenCalledWith("error", "guide.page_missing", {
      lang: "en",
      page: "products",
    });

    const spanish = await appFor(empty, log).request("/help/es/products");
    expect(spanish.status).toBe(500);
    const spanishText = await spanish.text();
    expect(spanishText).toContain("Página no disponible");
    expect(spanishText).toContain("No se ha podido mostrar esta página de la guía.");
    expect(log).toHaveBeenLastCalledWith("error", "guide.page_missing", {
      lang: "en",
      page: "products",
    });
  });

  it("answers 500 and logs, without the guide's words, when a guide does not render", async () => {
    const broken = newRoot("broken");
    write(broken, "en", "products", "# Products\n\n### hidden words\n");
    const log = vi.fn();
    const res = await appFor(broken, log).request("/help/en/products");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hidden words");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual([
      "error",
      "guide.render_failed",
      { lang: "en", page: "products" },
    ]);
  });

  it("answers its own 500 page and logs when a guide file cannot be read", async () => {
    const unreadable = newRoot("unreadable");
    // A directory where the file should be: reading it fails with EISDIR, not ENOENT.
    mkdirSync(join(unreadable, "en", "products.md"), { recursive: true });
    const log = vi.fn();
    const res = await appFor(unreadable, log).request("/help/en/products");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("This guide page could not be shown.");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("error", "guide.read_failed", {
      lang: "en",
      page: "products",
      code: "EISDIR",
    });
  });

  it("answers the Spanish 500 page and logs the English file it tried, when the twin is missing and the English file cannot be read", async () => {
    const unreadable = newRoot("unreadable-fallback");
    mkdirSync(join(unreadable, "en", "products.md"), { recursive: true });
    const log = vi.fn();
    const res = await appFor(unreadable, log).request("/help/es/products");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("No se ha podido mostrar esta página de la guía.");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("error", "guide.read_failed", {
      lang: "en",
      page: "products",
      code: "EISDIR",
    });
  });

  it("logs the English file's language when the twin is missing and the English guide does not render", async () => {
    const broken = newRoot("broken-fallback");
    write(broken, "en", "products", "# Products\n\n### hidden words\n");
    const log = vi.fn();
    const res = await appFor(broken, log).request("/help/es/products");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("No se ha podido mostrar esta página de la guía.");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("error", "guide.render_failed", {
      lang: "en",
      page: "products",
    });
  });

  it("sends no-cache and a policy that allows only the page's own script", async () => {
    for (const path of ["/help/en/products", "/help/en/nothing", "/help"]) {
      const res = await appFor(root).request(path);
      const html = await res.text();
      const script = between(html, "<script>", "</script>");
      const hash = createHash("sha256").update(script).digest("base64");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("content-security-policy")).toBe(
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      );
    }
    const broken = newRoot("broken-csp");
    const res = await appFor(broken).request("/help/en/products");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("escapes the title", async () => {
    const titled = newRoot("titled");
    write(titled, "en", "products", "# Use <b> well\n\nText.\n");
    const html = await (await appFor(titled).request("/help/en/products")).text();
    expect(html).toContain("<title>Use &lt;b&gt; well · Waitron</title>");
    expect(html).toContain("<h1>Use &lt;b&gt; well</h1>");
    expect(html).not.toContain("<b>");
  });

  it("declares every token it reads", async () => {
    const html = await (await appFor(root).request("/help/en/products")).text();
    const style = between(html, "<style>", "</style>");
    const reads = [...style.matchAll(/var\((--wt-[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(reads.length).toBeGreaterThan(0);
    for (const name of reads) expect(Object.keys(GUIDE_PAGE_TOKENS)).toContain(name);
    for (const name of Object.keys(GUIDE_PAGE_TOKENS)) expect(style).toContain(`${name}:`);
  });

  it("sets inline code apart from the page background in both themes", async () => {
    const html = await (await appFor(root).request("/help/en/products")).text();
    const style = between(html, "<style>", "</style>");
    const rule = /(?:^|\n)code \{([^}]*)\}/.exec(style)![1]!;
    const painted = [...rule.matchAll(/^(?:background|border)[a-z-]*:[^;]*;/gm)].flatMap((decl) =>
      [...decl[0].matchAll(/var\((--wt-[a-z0-9-]+)\)/g)].map((m) => m[1]!),
    );
    const page = GUIDE_PAGE_TOKENS["--wt-color-bg"]!;
    const apart = painted.filter((name) => {
      const value = GUIDE_PAGE_TOKENS[name];
      return Array.isArray(value) && value[0] !== page[0] && value[1] !== page[1];
    });
    expect(apart).not.toEqual([]);
  });

  it("serves the guides shipped with the server when no folder is given", async () => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const res = await app.request("/help/en/products");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<p class="trail">Waitron guide › Products</p>');
  });

  it("the theme script reads the key it exports", async () => {
    const html = await (await appFor(root).request("/help/en/products")).text();
    const script = between(html, "<script>", "</script>");
    expect(script).toContain(`localStorage.getItem(${JSON.stringify(GUIDE_THEME_KEY)})`);
    expect(script).toBe(
      'try{var t=localStorage.getItem("waitron-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}',
    );
  });
});

it.each(["en", "es"])(
  "serves the Opening hours holiday guide with a named frame in %s",
  async (lang) => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const response = await app.request(`/help/${lang}/opening-hours`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain('id="holiday-names"');
    expect(html).toContain('id="holiday-area"');
    expect(html).not.toContain("undefined");
  },
);

it.each(["en", "es"])("serves the email test guide in %s", async (lang) => {
  const app = new Hono();
  mountGuidePages(app, {}, vi.fn());
  const response = await app.request(`/help/${lang}/email`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('<section id="test-results"');
  expect(html).toContain(`<html lang="${lang}">`);
});

it("standalone guide pages keep fixed type with a larger browser default", async () => {
  const browser = await chromium.launch({ args: ["--blink-settings=defaultFontSize=32"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
      "32px",
    );
    await page.setContent(
      renderBoxPage(
        "en",
        "Appearance",
        "<h1>Appearance</h1><h2>Text size</h2><p>Change the venue's text.</p>",
      ),
    );
    for (const [selector, size] of [
      ["body", "14px"],
      ["h1", "22px"],
      ["h2", "18px"],
    ])
      expect(await page.locator(selector!).evaluate((el) => getComputedStyle(el).fontSize)).toBe(
        size,
      );
  } finally {
    await browser.close();
  }
});

describe("the box pages' form style", () => {
  const SYSTEM_COLOURS =
    /\b(?:Canvas|CanvasText|Highlight|HighlightText|GrayText|ButtonText|ButtonFace|LinkText)\b/;
  const outsideForcedColours = BOX_FORM_STYLE.replace(
    /@media \(forced-colors: active\) \{[\s\S]*\}\s*$/,
    "",
  );

  it("reads every colour, spacing, radius and font from a --wt-* token the page declares", () => {
    const reads = [...BOX_FORM_STYLE.matchAll(/var\((--wt-[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(reads.length).toBeGreaterThan(20);
    for (const name of reads) expect(Object.keys(GUIDE_PAGE_TOKENS), name).toContain(name);
    const values = [...outsideForcedColours.matchAll(/(?<![\w-])([a-z-]+)\s*:\s*([^;{}]+);/g)];
    expect(values.length).toBeGreaterThan(20);
    for (const [, property, value] of values) {
      const literal = value!.replace(/var\(--wt-[a-z0-9-]+\)/g, "");
      expect(literal, `${property}: ${value}`).not.toMatch(
        /#|\b\d*\.?\d+(?:px|rem|em)\b|\b(?:rgb|hsl)a?\(|\b(?:white|black|red|blue|grey|gray)\b/i,
      );
      expect(literal, `${property}: ${value}`).not.toMatch(SYSTEM_COLOURS);
    }
  });

  it("stays off the box pages that draw no form, and the head handed to a page drawn without one declares its tokens", async () => {
    expect(renderBoxPage("en", "Title", "<h1>Title</h1>")).not.toContain(".box-form");
    expect(renderLogoBoxPage("en-GB", "Title", "<h1>Title</h1>")).not.toContain(".box-form");
    expect(renderBoxPage("en", "Title", "<h1>Title</h1>", BOX_FORM_STYLE)).toContain(
      BOX_FORM_STYLE,
    );
    expect(renderLogoBoxPage("en-GB", "Title", "<h1>Title</h1>", BOX_FORM_STYLE)).toContain(
      BOX_FORM_STYLE,
    );
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    for (const path of ["/help/en/table-service", "/help/en/no-such-page"]) {
      const html = await (await app.request(path)).text();
      expect(html, path).toContain("<main>");
      expect(html, path).not.toContain(".box-form");
    }
    expect(BOX_FORM_HEAD.startsWith("<style>")).toBe(true);
    expect(BOX_FORM_HEAD).toContain(BOX_FORM_STYLE);
    for (const name of Object.keys(GUIDE_PAGE_TOKENS)) expect(BOX_FORM_HEAD).toContain(`${name}:`);
  });

  it("styles only the form on a page drawn without the box look, which still matches its neighbours", async () => {
    const form = `<form class="box-form" method="post" action="/x">
<p><label for="f-email">Email <span class="required">*</span></label></p>
<p><input type="email" id="f-email" name="email"></p>
</form>`;
    const browser = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"] as const) {
        const page = await browser.newPage({ colorScheme: scheme });
        const bodyLook = () =>
          page.locator("body").evaluate((el) => {
            const s = getComputedStyle(el);
            return [s.backgroundColor, s.color, s.fontFamily, s.fontSize, s.lineHeight];
          });
        await page.setContent(renderDocument("en-GB", "Next", "<p>Restarting.</p>\n"));
        const neighbour = await bodyLook();
        await page.setContent(renderWaitingPage("the other box", "en-GB", form));
        expect(await bodyLook(), scheme).toEqual(neighbour);
        expect(
          await page.locator("#f-email").evaluate((el) => getComputedStyle(el).fontFamily),
          scheme,
        ).toBe(neighbour[2]);
        // The head alone, ahead of no other style, still follows the scheme.
        await page.setContent(
          `<!doctype html><html><head>${BOX_FORM_HEAD}</head><body>${form}</body></html>`,
        );
        expect(
          await page.locator("#f-email").evaluate((el) => getComputedStyle(el).backgroundColor),
          scheme,
        ).toBe(scheme === "light" ? "rgb(240, 241, 244)" : "rgb(38, 42, 51)");
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

  it("turns each rem length a copied token holds into whole pixels, and refuses a fraction of one", () => {
    expect(fixedFontValue("--wt-font-size-md", "0.875rem")).toBe("14px");
    expect(fixedFontValue("--wt-x", "max(1rem, 1em, var(--wt-font-size-md))")).toBe(
      "max(16px, 1em, var(--wt-font-size-md))",
    );
    expect(fixedFontValue("--wt-x", "36rem")).toBe("576px");
    expect(fixedFontValue("--wt-x", "2px solid var(--wt-color-focus)")).toBe(
      "2px solid var(--wt-color-focus)",
    );
    expect(() => fixedFontValue("--wt-x", "0.3rem")).toThrow("not a whole-pixel rem size: --wt-x");
  });

  it("turns a signed rem length into signed pixels, and refuses a rem length it cannot read", () => {
    expect(fixedFontValue("--wt-x", "-0.5rem")).toBe("-8px");
    expect(fixedFontValue("--wt-x", "calc(100% - -1.5rem) +2REM")).toBe("calc(100% - -24px) +32px");
    for (const value of ["1e1rem", "var(--wt-gap-1rem)"])
      expect(() => fixedFontValue("--wt-x", value), value).toThrow(
        "a rem length left unconverted: --wt-x",
      );
  });

  it("keeps the form's typed text and width fixed with a larger browser default", async () => {
    const browser = await chromium.launch({ args: ["--blink-settings=defaultFontSize=32"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const form = `<form class="box-form"><p><input type="email" id="f-email" name="email"></p></form>`;
      for (const html of [
        renderBoxPage("en", "Form", form, BOX_FORM_STYLE),
        `<!doctype html><html><head>${BOX_FORM_HEAD}</head><body>${form}</body></html>`,
      ]) {
        await page.setContent(html);
        expect(await page.locator("#f-email").evaluate((el) => getComputedStyle(el).fontSize)).toBe(
          "16px",
        );
        expect(await page.locator("form").evaluate((el) => getComputedStyle(el).width)).toBe(
          "576px",
        );
      }
    } finally {
      await browser.close();
    }
  });

  it("paints a form's fields, errors and action from the tokens, light and dark", async () => {
    const form = `<form class="box-form" method="post" action="/x">
<p><label for="f-email">Email <span class="required">*</span></label></p>
<p><input type="email" id="f-email" name="email" aria-invalid="true" aria-describedby="f-email-error"></p>
<p id="f-email-error">Enter your email.</p>
<p><label for="f-password">Password <span class="required">*</span></label></p>
<p><input type="password" id="f-password" name="password"></p>
<p><label><input type="checkbox" id="f-tick" name="tick"> I agree <span class="required">*</span></label></p>
<p id="f-message" role="alert">Correct the highlighted fields to continue.</p>
<p><button type="submit">Go</button><button type="button" disabled>Off</button></p>
</form>`;
    const expected = {
      light: {
        fill: "rgb(240, 241, 244)",
        danger: "rgb(179, 38, 30)",
        primary: "rgb(0, 115, 146)",
        onPrimary: "rgb(255, 255, 255)",
        disabled: "rgb(122, 202, 233)",
      },
      dark: {
        fill: "rgb(38, 42, 51)",
        danger: "rgb(255, 127, 115)",
        primary: "rgb(113, 207, 235)",
        onPrimary: "rgb(0, 16, 22)",
        disabled: "rgb(22, 53, 62)",
      },
    } as const;
    const browser = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"] as const) {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
          colorScheme: scheme,
        });
        await page.setContent(renderBoxPage("en", "Form", form, BOX_FORM_STYLE));
        const style = (selector: string, property: string) =>
          page
            .locator(selector)
            .evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
        const colours = expected[scheme];
        expect(await style("#f-password", "background-color"), scheme).toBe(colours.fill);
        expect(await style("#f-password", "width"), scheme).toBe(await style("form", "width"));
        expect(await style("#f-email", "box-shadow"), scheme).toContain(colours.danger);
        expect(await style("#f-email-error", "color"), scheme).toBe(colours.danger);
        expect(await style("#f-message", "color"), scheme).toBe(colours.danger);
        expect(await style('label[for="f-email"] .required', "color"), scheme).toBe(colours.danger);
        expect(await style("#f-tick", "accent-color"), scheme).toBe(colours.primary);
        expect(await style('button[type="submit"]', "background-color"), scheme).toBe(
          colours.primary,
        );
        expect(await style('button[type="submit"]', "color"), scheme).toBe(colours.onPrimary);
        expect(await style("button[disabled]", "background-color"), scheme).toBe(colours.disabled);
        // A keyboard-focused invalid field keeps its red line and adds the focus ring, so focus
        // stays visible on it; unfocused, it has no ring.
        expect(await style("#f-email", "outline-style"), scheme).toBe("none");
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.id), scheme).toBe("f-email");
        expect(await style("#f-email", "outline-style"), scheme).toBe("solid");
        expect(await style("#f-email", "outline-width"), scheme).toBe("2px");
        expect(await style("#f-email", "outline-color"), scheme).toBe(colours.primary);
        expect(await style("#f-email", "box-shadow"), scheme).toContain(colours.danger);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});
