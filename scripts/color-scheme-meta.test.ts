import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Each front-end's `index.html` declares `<meta name="color-scheme" content="light dark">` in its
 * `<head>`, so a device set to dark paints the page dark before the app's code loads instead of
 * flashing white.
 *
 * Weaker than its name: it reads TEXT and never renders the page. A tag inside an HTML comment
 * counts, and attributes in another order or in single quotes are missed.
 */
const REPO_ROOT = join(import.meta.dirname, "..");
const META = /<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/g;

function frontEnds(): { app: string; html: string }[] {
  const apps = join(REPO_ROOT, "apps");
  return readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(apps, e.name, "index.html")))
    .map((e) => ({ app: e.name, html: readFileSync(join(apps, e.name, "index.html"), "utf8") }));
}

describe("each front-end paints in the device's colour scheme before its code loads", () => {
  const apps = frontEnds();

  it("finds the front-ends", () => {
    expect(apps.map((a) => a.app).sort()).toEqual(["dashboard", "setup", "till"]);
  });

  it.each(apps)("$app declares color-scheme once, inside <head>", ({ html }) => {
    const found = [...html.matchAll(META)];
    expect(found).toHaveLength(1);
    expect(found[0]!.index).toBeGreaterThan(html.indexOf("<head>"));
    expect(found[0]!.index).toBeLessThan(html.indexOf("</head>"));
  });
});
