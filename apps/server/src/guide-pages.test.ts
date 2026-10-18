import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GUIDE_PAGE_TOKENS, GUIDE_THEME_KEY, mountGuidePages } from "./guide-pages.js";
import type { Logger } from "./logger.js";

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
  mountGuidePages(app, log, { root: dir });
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

  it("answers the 404 page in Spanish when the language is Spanish", async () => {
    const res = await appFor(root).request("/help/es/nada");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("Página no encontrada");
    expect(html).toContain('href="/help/es/products"');
  });

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
      lang: "es",
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
    mountGuidePages(app, vi.fn());
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
