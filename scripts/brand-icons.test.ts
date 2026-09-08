import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pins both halves of how the front-ends get their icons: each app's `index.html` icon `<link>`s,
 * and each app's `vite.config.ts` `publicDir`, against the one brand directory in `packages/ui`.
 *
 * Nothing else checks either. `packages/ui`'s own suite excludes `brand/**` from coverage, and no
 * app test reads its `index.html` or its Vite config. So renaming a file under `brand/public`, or
 * repointing a `publicDir` at a directory that does not exist, would ship apps with broken icon
 * links behind a fully green gate: Vite copies whatever the directory holds and warns about
 * nothing, and a missing favicon is invisible until someone looks at a browser tab.
 *
 * It lives in the ROOT project (CLAUDE.md §4) because it spans packages — the assertion is about
 * `apps/*` and `packages/ui` agreeing, which is a fact neither one's own suite owns. (Scope is NOT
 * the reason: all three apps depend on `@waitron/ui`, so a push touching only `packages/ui/brand`
 * already selects them as dependents.)
 *
 * It reads TEXT and never imports, renders or executes what it reads. What that cannot see, stated
 * rather than guarded, since none of the three files has ever carried any of it: a `<link>` inside
 * an HTML comment counts as real; `rel='icon'` in single quotes, `rel="shortcut icon"` and
 * `rel="icon shortcut"` are all legal HTML and all missed; an icon declared through a web app
 * manifest instead of a `<link>` is invisible; and a `publicDir` built by anything other than the
 * one literal `new URL(...)` shape below is not matched.
 *
 * Apps are discovered from the filesystem, not listed, so a fourth front-end is covered the day it
 * appears. Proven by deletion on 2026-09-08: renaming `brand/public/favicon.ico` turned four of
 * these tests red, each naming the missing href.
 */
const REPO_ROOT = join(import.meta.dirname, "..");
const BRAND_PUBLIC = join(REPO_ROOT, "packages", "ui", "brand", "public");
const ICON_LINK = /<link\b[^>]*\brel="(icon|apple-touch-icon)"[^>]*>/g;
const HREF = /\bhref="([^"]*)"/;
const PUBLIC_DIR = /publicDir:\s*fileURLToPath\(new URL\("([^"]+)", import\.meta\.url\)\)/;

/** The hrefs of every icon link in one HTML document, in source order. */
function iconHrefs(html: string): string[] {
  return [...html.matchAll(ICON_LINK)].map((tag) => tag[0].match(HREF)?.[1] ?? "");
}

/** Every `apps/<name>` that ships an `index.html` — the front-ends, whatever they are called. */
function frontEnds(): { app: string; html: string; viteConfig: string }[] {
  const apps = join(REPO_ROOT, "apps");
  return readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(apps, e.name, "index.html")))
    .map((e) => ({
      app: e.name,
      html: readFileSync(join(apps, e.name, "index.html"), "utf8"),
      viteConfig: readFileSync(join(apps, e.name, "vite.config.ts"), "utf8"),
    }));
}

describe("app icons resolve to the shared brand directory", () => {
  const apps = frontEnds();

  it("finds the front-ends", () => {
    expect(apps.map((a) => a.app).sort()).toEqual(["dashboard", "setup", "till"]);
  });

  it.each(apps)("$app links only to files that exist", ({ html }) => {
    const hrefs = iconHrefs(html);
    // Each app declares the .ico, the .svg and the Apple icon. A shorter list means a link was
    // dropped; a longer one means a new icon arrived and this guard has not been told about it.
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) {
      // Vite prefixes these with each app's `base` at BUILD time; in source they are origin paths.
      expect(href).toMatch(/^\/[\w.-]+$/);
      expect({ href, exists: existsSync(join(BRAND_PUBLIC, href.slice(1))) }).toEqual({
        href,
        exists: true,
      });
    }
  });

  it.each(apps)("$app serves that directory", ({ viteConfig }) => {
    const match = viteConfig.match(PUBLIC_DIR);
    expect(match?.[1]).toBe("../../packages/ui/brand/public");
  });

  it("every app carries the same icon set", () => {
    expect(new Set(apps.map((a) => iconHrefs(a.html).join(" "))).size).toBe(1);
  });
});

describe("the detector itself", () => {
  it("reads the href out of a link regardless of attribute order", () => {
    expect(iconHrefs('<link href="/a.ico" rel="icon" sizes="32x32" />')).toEqual(["/a.ico"]);
    expect(iconHrefs('<link rel="apple-touch-icon" href="/b.png" />')).toEqual(["/b.png"]);
  });

  it("ignores links that are not icons", () => {
    expect(iconHrefs('<link rel="stylesheet" href="/x.css" />')).toEqual([]);
    expect(iconHrefs('<link rel="preconnect" href="https://example.test" />')).toEqual([]);
  });

  it("does not match a publicDir pointing anywhere else", () => {
    expect(
      'publicDir: fileURLToPath(new URL("./public", import.meta.url))'.match(PUBLIC_DIR)?.[1],
    ).toBe("./public");
    expect('publicDir: "../../packages/ui/brand/public"'.match(PUBLIC_DIR)).toBeNull();
  });
});
