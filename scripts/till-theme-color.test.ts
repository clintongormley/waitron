// Weaker than its name: it calls the till config's manifest plugin hooks directly rather than
// running a Vite build, and it finds the expected colour with the same parseBlock call and
// light-block selector the config uses, so a misread of colors.css shared by both passes it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, it } from "vitest";
import type { Plugin, UserConfig } from "vite";
import { parseBlock } from "../packages/ui-core/src/theme/defaults.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const ENV = {
  WAITRON_STATE_DIR: join(import.meta.dirname, "till-theme-color-absent-state"),
  WAITRON_TILL_VITE_PORT: undefined,
  WAITRON_HTTP_PORT: undefined,
};

let plugin: Plugin;

beforeAll(async () => {
  const original = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    apply(ENV);
    const configPath = join(REPO_ROOT, "apps/till/vite.config.ts");
    const exported = (await import(`${pathToFileURL(configPath).href}?theme-color`)) as {
      default: UserConfig;
    };
    const plugins = (exported.default.plugins ?? []).flat() as Plugin[];
    const found = plugins.find((p) => p?.name === "waitron-webmanifest");
    expect(found, "no waitron-webmanifest plugin").toBeDefined();
    plugin = found!;
  } finally {
    apply(original);
  }
});

function lightPrimary(): string {
  const colors = readFileSync(join(REPO_ROOT, "packages/ui-core/src/tokens/colors.css"), "utf8");
  const value = parseBlock(colors, ':where([data-wt-theme-root][data-theme="light"])')[
    "--wt-color-primary"
  ];
  expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  return value!;
}

it("the till's manifest theme_color is the light --wt-color-primary", () => {
  const emitted: { fileName?: string; source?: unknown }[] = [];
  const generateBundle = plugin.generateBundle as (this: unknown) => void;
  generateBundle.call({ emitFile: (file: (typeof emitted)[number]) => emitted.push(file) });
  expect(emitted.map((file) => file.fileName)).toEqual(["manifest.webmanifest"]);
  const manifest = JSON.parse(String(emitted[0]!.source)) as { theme_color: unknown };
  expect(manifest.theme_color).toBe(lightPrimary());
});

it("the till's page gets exactly one theme-color meta, in <head>, in the light --wt-color-primary", () => {
  const transform = plugin.transformIndexHtml;
  expect(typeof transform).toBe("function");
  const html = readFileSync(join(REPO_ROOT, "apps/till/index.html"), "utf8");
  const out = (transform as (html: string) => string)(html);
  const metas = [...out.matchAll(/<meta\s+name="theme-color"\s+content="([^"]*)"\s*\/?>/g)];
  expect(metas.map((m) => m[1])).toEqual([lightPrimary()]);
  expect(out.indexOf('name="theme-color"')).toBeLessThan(out.indexOf("</head>"));
});
