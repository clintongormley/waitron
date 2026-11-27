import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Each front-end declares its initial colour scheme in its HTML head. Staff apps follow the device
 * until their code loads. The customer menu starts in its built-in light palette.
 *
 * Weaker than its name: it reads TEXT and never renders the page. A tag inside an HTML comment
 * counts, and attributes in another order or in single quotes are missed.
 */
const REPO_ROOT = join(import.meta.dirname, "..");
const META = /<meta\s+name="color-scheme"\s+content="([^"]*)"\s*\/?>/g;

function frontEnds(): { app: string; html: string }[] {
  const apps = join(REPO_ROOT, "apps");
  return readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(apps, e.name, "index.html")))
    .map((e) => ({ app: e.name, html: readFileSync(join(apps, e.name, "index.html"), "utf8") }));
}

describe("each front-end declares its initial colour scheme", () => {
  const apps = frontEnds();

  it("finds the front-ends", () => {
    expect(apps.map((a) => a.app).sort()).toEqual(["customer-menu", "dashboard", "setup", "till"]);
  });

  it.each(apps)("$app declares color-scheme once, inside <head>", ({ app, html }) => {
    const found = [...html.matchAll(META)];
    expect(found).toHaveLength(1);
    expect(found[0]![1]).toBe(app === "customer-menu" ? "light" : "light dark");
    expect(found[0]!.index).toBeGreaterThan(html.indexOf("<head>"));
    expect(found[0]!.index).toBeLessThan(html.indexOf("</head>"));
  });
});
